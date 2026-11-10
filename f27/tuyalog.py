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
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .crypto import password_from_env, write_encrypted_json
from .supa import SupabaseError, SupabaseRest
from .tuya import TuyaClient, TuyaError

BUDAPEST = ZoneInfo("Europe/Budapest")
DATA = Path(__file__).resolve().parent.parent / "data"
CONTACTS = ("5", "6", "7", "8", "9", "10")
BREAKERS = ("X5", "X7", "X8", "X9")
THERMOS = ("1", "2", "3", "4")
COUNTER_CODES = ("total_forward_energy", "forward_energy_total", "add_ele")
CONTACT_CODES = ("doorcontact_state", "contact_state")
PAGE = 100


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

def fetch_logs(tc, dev_id: str, start_ms: int, end_ms: int, max_pages: int) -> dict:
    """Az eszköz adatpont-jelentései az időablakban, lapozva. Hibánál a Tuya hibakódja."""
    logs: list[dict] = []
    key, pages = None, 0
    while pages < max_pages:
        params = {"type": 7, "start_time": start_ms, "end_time": end_ms, "size": PAGE, "query_type": 1}
        if key:
            params["start_row_key"] = key
        try:
            res = tc.get(f"/v1.0/devices/{dev_id}/logs", params) or {}
        except TuyaError as e:
            return {"logs": logs, "pages": pages, "error": str(e.code), "truncated": False}
        pages += 1
        logs.extend(res.get("logs") or [])
        nxt = res.get("next_row_key")
        if not res.get("has_next") or not nxt or nxt == key:
            return {"logs": logs, "pages": pages, "error": None, "truncated": False}
        key = nxt
    return {"logs": logs, "pages": pages, "error": None, "truncated": True}


def fetch_stats(tc, dev_id: str, days: int, today: datetime) -> dict:
    """A Tuya napi fogyasztási statisztikája (ha a felhőprojekt eléri). {kód: {nap: kWh}}."""
    out: dict = {"types": None, "days": {}, "errors": {}}
    try:
        types = tc.get(f"/v1.0/devices/{dev_id}/all-statistic-type") or []
        out["types"] = types
    except TuyaError as e:
        out["errors"]["all-statistic-type"] = str(e.code)
        types = []
    codes = [t.get("code") for t in types if isinstance(t, dict) and t.get("code")] or ["add_ele"]
    start = (today - timedelta(days=days)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")
    for code in dict.fromkeys(codes):
        try:
            res = tc.get(f"/v1.0/devices/{dev_id}/statistics/days",
                         {"code": code, "start_day": start, "end_day": end}) or {}
        except TuyaError as e:
            out["errors"][f"days:{code}"] = str(e.code)
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

def run(tc, sb, now: datetime, days: int, stat_days: int, max_pages: int) -> dict:
    devs = [d for d in sb.select("devices", "pink,role,tuya_device_id,meta") if d.get("tuya_device_id")]
    start = now - timedelta(days=days)
    start_ms, end_ms = int(start.timestamp() * 1000), int(now.timestamp() * 1000)
    rows = _paged(sb, "device_status", "pink,ts,status", ts=f"gte.{start.isoformat()}", order="ts.asc")
    by_pink: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_pink[r["pink"]].append(r)
    try:
        ed = _paged(sb, "energy_daily", "day,pink,kwh", day=f"gte.{(now - timedelta(days=stat_days)).date().isoformat()}")
    except SupabaseError:
        ed = []
    energy_db: dict[str, dict[str, float]] = defaultdict(dict)
    for r in ed:
        energy_db[r["pink"]][str(r["day"])[:10]] = _num(r.get("kwh"))

    result = {"generated": now.isoformat(), "days": days, "stat_days": stat_days, "devices": {}}
    for d in sorted(devs, key=lambda x: str(x["pink"])):
        pink, did, meta = str(d["pink"]), d["tuya_device_id"], d.get("meta") or {}
        lg = fetch_logs(tc, did, start_ms, end_ms, max_pages)
        codes = Counter(x.get("code") for x in lg["logs"])
        dev = {"role": d.get("role"), "log_count": len(lg["logs"]), "log_pages": lg["pages"],
               "log_error": lg["error"], "log_truncated": lg["truncated"], "codes": dict(codes),
               "logs": lg["logs"], "db_rows": len(by_pink.get(pink, []))}
        if pink in CONTACTS:
            dev["opens_log"] = count_opens_log(lg["logs"])
            dev["opens_db"] = count_opens_rows(by_pink.get(pink, []))
        if pink == "P":
            dev["changes_log"] = count_stage_changes_log(lg["logs"])
            dev["changes_db"] = count_stage_changes_rows(by_pink.get(pink, []))
        if pink in BREAKERS:
            code = next((c for c in COUNTER_CODES if c in codes), None)
            m = meta.get(code) if code else None
            scale = int(m["scale"]) if isinstance(m, dict) and isinstance(m.get("scale"), int) else 2
            from_log = daily_kwh_from_counter_log(lg["logs"], scale)
            stats = fetch_stats(tc, did, stat_days, now.astimezone(BUDAPEST))
            tstat = next(iter(stats["days"].values()), {}) if stats["days"] else {}
            dev.update({"counter_code": code, "kwh_log": from_log, "stats": stats, "kwh_db": energy_db.get(pink, {}),
                        "cmp_stat_db": compare_days(tstat, energy_db.get(pink, {})),
                        "cmp_log_db": compare_days(from_log, energy_db.get(pink, {})),
                        "cmp_stat_log": compare_days(tstat, from_log)})
        result["devices"][pink] = dev
    return result


def summary_lines(res: dict) -> list[str]:
    """Publikus összefoglaló: csak darabszámok, kódnevek, hibakódok és egyezési arányok."""
    L = [f"## Tuya-napló próba ({res['days']} nap napló, {res['stat_days']} nap statisztika)", "",
         "| Pink | Naplóbejegyzés | Oldal | Hiba | Kódok (darab) | Adatgyűjtő sorai | Egyeztetés |",
         "|---|---|---|---|---|---|---|"]
    for pink, d in res["devices"].items():
        codes = ", ".join(f"{k} {v}" for k, v in sorted(d["codes"].items(), key=lambda kv: -kv[1])[:6]) or "-"
        rec = "-"
        if "opens_log" in d:
            rec = f"nyitás: naplóban {d['opens_log']}, nálunk {d['opens_db']}"
        elif "changes_log" in d:
            rec = f"fokozatváltás: naplóban {d['changes_log']}, nálunk {d['changes_db']}"
        elif "cmp_log_db" in d:
            s = d["stats"]
            st = ("statisztika: " + (", ".join(f"{k} {len(v)} nap" for k, v in s["days"].items()) or "nincs")
                  + ("; hiba: " + ", ".join(f"{k}={v}" for k, v in s["errors"].items()) if s["errors"] else ""))
            c1, c2 = d["cmp_stat_db"], d["cmp_log_db"]
            rec = (f"{st}; napi kWh Tuya-stat vs nálunk: {c1['same']}/{c1['common']} nap egyezik; "
                   f"napló-számláló vs nálunk: {c2['same']}/{c2['common']} nap egyezik")
        L.append(f"| {pink} | {d['log_count']}{' (csonkolva)' if d['log_truncated'] else ''} | {d['log_pages']} | "
                 f"{d['log_error'] or '-'} | {codes} | {d['db_rows']} | {rec} |")
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
