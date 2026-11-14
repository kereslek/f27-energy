"""Tuya-napló és fogyasztási statisztika: próba és egyeztetés (csak olvas, semmit nem kapcsol).

Minden párosított eszközre (a Supabase public.devices táblából):
  1. Eszköznapló: GET /v1.0/devices/{id}/logs (type=7: adatpont-jelentések), az utolsó
     TUYALOG_DAYS nap (alapból 7; a Tuya ingyenes naplója kb. ennyit őriz), lapozva
     (100 bejegyzés / oldal, next_row_key). Ebben minden nyitás, csukás, kapcsolás és
     számlálóállás benne van, időbélyeggel, a 10 perces mintavételtől függetlenül.
  2. A kismegszakítóknál a Tuya napi fogyasztási statisztikája, ha a felhőprojekt eléri:
     GET /v1.0/devices/{id}/all-statistic-type, majd /statistics/days (add_ele, napi kWh).
  3. Egyeztetés az adatgyűjtő adataival (Supabase):
     - nyitásérzékelők: nyitások száma a Tuya-naplóban és az adatgyűjtő device_status
       soraiban (ami a naplóban megvan, de nálunk nincs, azt a 10 perces mintavétel elnyelte);
     - LUXION kapcsoló: fokozatváltások száma ugyanígy;
     - kismegszakítók: napi kWh a Tuya-statisztikából, a Tuya-naplóban jelentett
       számlálóállásokból és az energy_daily táblából, napra (Europe/Budapest) egyeztetve.

Kimenet:
  - A publikus logba (és a step summarybe) csak darabszámok és egyezési arányok kerülnek:
    pink szám, kód neve, darabszám, hibakód. Időpont, mérési érték, device ID soha.
  - A teljes eredmény (naplóbejegyzések, statisztika, napi összevetés) TITKOSÍTVA:
    data/tuyalog.json.enc (F27_DATA_PASSWORD), a workflow commitolja.

Futtatás:  python -m f27.tuyalog      (GitHub Actions: Tuya-napló próba)
"""

from __future__ import annotations

import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .site import SITE
from .crypto import password_from_env, write_encrypted_json
from .supa import SupabaseError, SupabaseRest
from .tuya import TuyaClient, TuyaError, err_text, fetch_logs  # noqa: F401 (a tesztek innen is elérik)

BUDAPEST = SITE.tz
DATA = SITE.data_dir
CONTACTS = ("5", "6", "7", "8", "9", "10")
BREAKERS = ("X5", "X7", "X8", "X9")
THERMOS = ("1", "2", "3", "4")
COUNTER_CODES = ("total_forward_energy", "forward_energy_total")   # halmozott állás (add_ele: növekmény)
CONTACT_CODES = ("doorcontact_state", "contact_state")
PAUSE = float(os.environ.get("TUYALOG_PAUSE", "0.5") or 0.5)   # lapok között (mp)
EVENT_TYPES = {"1": "online", "2": "offline", "3": "aktiválás", "4": "reset", "5": "parancs", "6": "firmware",
               "7": "adatpont", "8": "jelzés", "9": "újraindulás", "10": "időzítő"}


def _truthy(v) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "1", "open", "on"):
            return True
        if s in ("false", "0", "close", "closed", "off"):
            return False
    return None


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def bud_day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone(BUDAPEST).date().isoformat()


# ----------------------------------------------------------------------------- Tuya

def fetch_stats(tc, dev_id: str, days: int, today: datetime) -> dict:
    """A Tuya napi fogyasztási statisztikája (ha a felhőprojekt eléri). {kód: {nap: kWh}}."""
    out: dict = {"types": None, "days": {}, "errors": {}}
    try:
        types = tc.get(f"/v1.0/devices/{dev_id}/all-statistic-type") or []
        out["types"] = types
    except TuyaError as e:
        out["errors"]["all-statistic-type"] = err_text(e)
        types = []
    codes = [t.get("code") for t in types if isinstance(t, dict) and t.get("code")] or ["add_ele"]
    start = (today - timedelta(days=days)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")
    for code in dict.fromkeys(codes):
        try:
            res = tc.get(f"/v1.0/devices/{dev_id}/statistics/days",
                         {"code": code, "start_day": start, "end_day": end}) or {}
        except TuyaError as e:
            out["errors"][f"days:{code}"] = err_text(e)
            continue
        raw = res.get("days") if isinstance(res, dict) else None
        if isinstance(raw, dict):
            out["days"][code] = {f"{k[:4]}-{k[4:6]}-{k[6:8]}": _num(v) for k, v in raw.items() if len(str(k)) == 8}
    return out


# ----------------------------------------------------------------------------- egyeztetés

def log_series(logs: list[dict], codes) -> list[tuple[int, object]]:
    """(event_time ms, érték) időrendben a megadott kódokra."""
    pts = [(int(x["event_time"]), x.get("value")) for x in logs
           if x.get("code") in codes and x.get("event_time") is not None]
    return sorted(pts)


def count_opens_log(logs: list[dict]) -> int:
    """Nyitások a naplóban: zárt (vagy ismeretlen) állapotból nyitottba váltás."""
    n, prev = 0, None
    for _, v in log_series(logs, CONTACT_CODES):
        o = _truthy(v)
        if o is True and prev is not True:
            n += 1
        if o is not None:
            prev = o
    return n


def count_opens_rows(rows: list[dict]) -> int:
    """Nyitások az adatgyűjtő device_status soraiban (időrendben)."""
    n, prev = 0, None
    for r in rows:
        st = r.get("status") or {}
        o = None
        for c in CONTACT_CODES:
            if c in st:
                o = _truthy(st[c])
                break
        if o is True and prev is not True:
            n += 1
        if o is not None:
            prev = o
    return n


def count_stage_changes_log(logs: list[dict]) -> int:
    """A LUXION kapcsoló fokozatváltásai a naplóban (switch_1..3 bármelyik váltása)."""
    state: dict = {}
    n = 0
    for x in sorted((l for l in logs if l.get("code") in ("switch_1", "switch_2", "switch_3")
                     and l.get("event_time") is not None), key=lambda l: int(l["event_time"])):
        v = _truthy(x.get("value"))
        if v is None:
            continue
        if x["code"] in state and state[x["code"]] != v:
            n += 1
        state[x["code"]] = v
    return n


def count_stage_changes_rows(rows: list[dict]) -> int:
    n, prev = 0, None
    for r in rows:
        st = r.get("status") or {}
        cur = tuple(_truthy(st.get(c)) for c in ("switch_1", "switch_2", "switch_3"))
        if all(c is None for c in cur):
            continue
        if prev is not None and cur != prev:
            n += 1
        prev = cur
    return n


def daily_kwh_from_counter_log(logs: list[dict], scale: int) -> dict[str, float]:
    """Napi kWh a naplóban jelentett kumulatív számlálóállásokból: napon belüli növekmények
    összege (a nap határán átnyúló növekmény a későbbi naphoz kerül), visszaesést nem számol."""
    pts = [(t, _num(v)) for t, v in log_series(logs, COUNTER_CODES)]
    pts = [(t, v) for t, v in pts if v is not None]
    out: dict[str, float] = defaultdict(float)
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        d = v1 - v0
        if d > 0:
            out[bud_day(t1)] += d / (10 ** scale)
    return {k: round(v, 3) for k, v in out.items()}


def daily_kwh_from_increments(logs: list[dict], scale: int, since_ms: int = 0) -> dict[str, float]:
    """Napi kWh az add_ele jelentésekből: ez a kód jelentésenként a legutóbbi jelentés óta
    hozzáadott fogyasztás (növekmény), nem halmozott állás, ezért összeadjuk (Budapest napja)."""
    out: dict[str, float] = defaultdict(float)
    for t, v in log_series(logs, ("add_ele",)):
        x = _num(v)
        if x is not None and x > 0 and t >= since_ms:
            out[bud_day(t)] += x / (10 ** scale)
    return {k: round(v, 3) for k, v in out.items()}


def compare_days(a: dict, b: dict, tol_abs: float = 0.05, tol_rel: float = 0.05) -> dict:
    """Két napi kWh-sor összevetése a közös napokon: egyező / eltérő napok száma."""
    common = sorted(set(a) & set(b))
    same = diff = 0
    rows = []
    for d in common:
        x, y = a[d], b[d]
        if x is None or y is None:
            continue
        ok = abs(x - y) <= max(tol_abs, tol_rel * max(abs(x), abs(y)))
        same += ok
        diff += not ok
        rows.append({"day": d, "a": x, "b": y, "ok": ok})
    return {"common": len(common), "same": same, "diff": diff, "rows": rows,
            "only_a": len(set(a) - set(b)), "only_b": len(set(b) - set(a))}


def _paged(sb, table: str, columns: str, **filters) -> list[dict]:
    out: list[dict] = []
    for page in range(50):
        rows = sb.select(table, columns, limit="1000", offset=str(page * 1000), **filters)
        out.extend(rows)
        if len(rows) < 1000:
            break
    return out


# ----------------------------------------------------------------------------- futtatás

def _ms(ts: str) -> int:
    return int(datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp() * 1000)


def _since(logs: list[dict], since_ms: int) -> list[dict]:
    return [x for x in logs if x.get("event_time") is not None and int(x["event_time"]) >= since_ms]


def _order(logs: list[dict]) -> str:
    t = [int(x["event_time"]) for x in logs if x.get("event_time") is not None]
    if len(t) < 2:
        return "-"
    return "csökkenő" if t[0] >= t[-1] else "növekvő"


def _median(xs: list[float]) -> float | None:
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else None


def run(tc, sb, now: datetime, days: int, stat_days: int, max_pages: int) -> dict:
    devs = [d for d in sb.select("devices", "pink,role,tuya_device_id,meta") if d.get("tuya_device_id")]
    start = now - timedelta(days=days)
    start_ms, end_ms = int(start.timestamp() * 1000), int(now.timestamp() * 1000)
    rows = _paged(sb, "device_status", "pink,ts,status", ts=f"gte.{start.isoformat()}", order="ts.asc")
    by_pink: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_pink[r["pink"]].append(r)
    try:
        latest = {str(r["pink"]): r.get("status") or {} for r in sb.select("device_latest", "pink,status")}
    except SupabaseError:
        latest = {}
    try:
        ed = _paged(sb, "energy_daily", "day,pink,kwh", day=f"gte.{(now - timedelta(days=stat_days)).date().isoformat()}")
    except SupabaseError:
        ed = []
    energy_db: dict[str, dict[str, float]] = defaultdict(dict)
    for r in ed:
        energy_db[r["pink"]][str(r["day"])[:10]] = _num(r.get("kwh"))
    today = now.astimezone(BUDAPEST).date().isoformat()

    result = {"generated": now.isoformat(), "days": days, "stat_days": stat_days, "devices": {}}
    for d in sorted(devs, key=lambda x: str(x["pink"])):
        pink, did, meta = str(d["pink"]), d["tuya_device_id"], d.get("meta") or {}
        mine = by_pink.get(pink, [])
        since = _ms(mine[0]["ts"]) if mine else end_ms           # az adatgyűjtő első sora az ablakban
        # a codes szűrőt a /logs végpont nem fogadja el ("Parameter error"), ezért a teljes naplót kérjük
        lg = fetch_logs(tc, did, start_ms, end_ms, max_pages, pause=PAUSE)
        all_types = None
        if not lg["logs"] and not lg["error"]:                   # nincs adatpont-jelentés: minden eseménytípus
            all_types = fetch_logs(tc, did, start_ms, end_ms, 5, types="1,2,3,4,5,6,7,8,9,10", pause=PAUSE)
        codes = Counter(x.get("code") for x in lg["logs"])
        dev = {"role": d.get("role"), "log_count": len(lg["logs"]), "log_pages": lg["pages"],
               "log_error": lg["error"], "log_truncated": lg["truncated"], "codes": dict(codes),
               "order": _order(lg["logs"]), "logs": lg["logs"], "db_rows": len(mine), "db_since": since,
               "log_since_db": len(_since(lg["logs"], since))}
        if all_types is not None:
            dev["all_types"] = {"count": len(all_types["logs"]), "error": all_types["error"],
                                "types": dict(Counter(str(x.get("event_id") or x.get("type") or "?") for x in all_types["logs"])),
                                "logs": all_types["logs"]}
        if pink in CONTACTS:
            dev["opens_log_all"] = count_opens_log(lg["logs"])
            dev["opens_log"] = count_opens_log(_since(lg["logs"], since))
            dev["opens_db"] = count_opens_rows(mine)
        if pink == "P":
            dev["changes_log"] = count_stage_changes_log(_since(lg["logs"], since))
            dev["changes_db"] = count_stage_changes_rows(mine)
        if pink in BREAKERS:
            st = latest.get(pink, {})
            dev["collector_codes"] = [c for c in COUNTER_CODES + ("add_ele",) if c in st]
            code = next((c for c in COUNTER_CODES if c in codes), None)
            m = meta.get(code) if code else None
            scale = int(m["scale"]) if isinstance(m, dict) and isinstance(m.get("scale"), int) else 2
            ma = meta.get("add_ele")
            ascale = int(ma["scale"]) if isinstance(ma, dict) and isinstance(ma.get("scale"), int) else 3
            from_counter = daily_kwh_from_counter_log(lg["logs"], scale)
            from_inc = daily_kwh_from_increments(lg["logs"], ascale)
            mine_days = energy_db.get(pink, {})
            first_day = min(mine_days) if mine_days else None
            full = {k: v for k, v in mine_days.items() if first_day and first_day < k < today}   # csak teljes napok
            stats = fetch_stats(tc, did, stat_days, now.astimezone(BUDAPEST))
            tstat = next(iter(stats["days"].values()), {}) if stats["days"] else {}
            ratios = [from_inc[k] / v for k, v in full.items() if k in from_inc and v]
            dev.update({"counter_code": code, "add_ele_scale": ascale, "kwh_counter_log": from_counter,
                        "kwh_add_ele": from_inc, "stats": stats, "kwh_db": mine_days, "full_days": sorted(full),
                        "cmp_stat_db": compare_days(tstat, full),
                        "cmp_inc_db": compare_days(from_inc, full),
                        "cmp_counter_db": compare_days(from_counter, full),
                        "ratio_inc_db": _median(ratios)})
        result["devices"][pink] = dev
    return result


def summary_lines(res: dict) -> list[str]:
    """Publikus összefoglaló: csak darabszámok, kódnevek, hibakódok és egyezési arányok."""
    L = [f"## Tuya-napló próba ({res['days']} nap napló, {res['stat_days']} nap statisztika)", "",
         "Az egyeztetés az adatgyűjtő első sorától számít (ami előtte van, csak a naplóban létezik).", "",
         "| Pink | Naplóbejegyzés (ebből a közös időszakban) | Oldal | Sorrend | Hiba | Kódok (darab) | Adatgyűjtő sorai | Egyeztetés |",
         "|---|---|---|---|---|---|---|---|"]
    for pink, d in res["devices"].items():
        codes = ", ".join(f"{k} {v}" for k, v in sorted(d["codes"].items(), key=lambda kv: -kv[1])[:6]) or "-"
        rec = "-"
        if "opens_log" in d:
            rec = f"nyitás a közös időszakban: naplóban {d['opens_log']}, nálunk {d['opens_db']} (7 nap alatt a naplóban: {d['opens_log_all']})"
        elif "changes_log" in d:
            rec = f"fokozatváltás: naplóban {d['changes_log']}, nálunk {d['changes_db']}"
        elif "cmp_inc_db" in d:
            s = d["stats"]
            st = ("Tuya-statisztika: " + (", ".join(f"{k} {len(v)} nap" for k, v in s["days"].items()) or "nincs")
                  + ("; hiba: " + ", ".join(f"{k}={v}" for k, v in s["errors"].items()) if s["errors"] else ""))
            c = d["cmp_inc_db"]
            r = d["ratio_inc_db"]
            rec = (f"adatgyűjtő számlálója: {', '.join(d['collector_codes']) or 'nincs'}; teljes napok: {len(d['full_days'])}; "
                   f"napi kWh (add_ele összeg, skála {d['add_ele_scale']}) vs nálunk: {c['same']}/{c['common']} nap egyezik"
                   + (f", arány medián {r:.2f}" if r is not None else "") + f"; {st}")
        extra = ""
        if "all_types" in d:
            a = d["all_types"]
            tp = ", ".join(f"{EVENT_TYPES.get(k, k)} {v}" for k, v in sorted(a["types"].items(), key=lambda kv: -kv[1]))
            extra = f"; minden eseménytípus: {a['count']} ({tp})" + (f" (hiba {a['error']})" if a["error"] else "")
        L.append(f"| {pink} | {d['log_count']} ({d['log_since_db']}){' csonkolva' if d['log_truncated'] else ''} | {d['log_pages']} | "
                 f"{d['order']} | {d['log_error'] or '-'} | {codes}{extra} | {d['db_rows']} | {rec} |")
    return L


def main() -> int:
    days = int(os.environ.get("TUYALOG_DAYS", "7") or 7)
    stat_days = int(os.environ.get("TUYALOG_STAT_DAYS", "60") or 60)
    max_pages = int(os.environ.get("TUYALOG_MAX_PAGES", "40") or 40)
    sb = SupabaseRest.from_env()
    if sb is None:
        print("HIBA: SUPABASE_URL / SUPABASE_SECRET_KEY hiányzik.")
        return 1
    password = password_from_env()
    tc = TuyaClient.from_env()
    now = datetime.now(timezone.utc)
    try:
        res = run(tc, sb, now, days, stat_days, max_pages)
    except TuyaError as e:
        print(f"HIBA: Tuya API, kód: {e.code}")
        return 1
    except SupabaseError as e:
        print(f"HIBA: Supabase ({e})")
        return 1
    lines = summary_lines(res)
    print("\n".join(lines))
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        with open(summ, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    write_encrypted_json(DATA / "tuyalog.json.enc", res, password)
    print("Titkosítva: data/tuyalog.json.enc")
    return 0


if __name__ == "__main__":
    sys.exit(main())
