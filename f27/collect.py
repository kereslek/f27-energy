"""Adatgyűjtő: 10 percenként (GitHub Actions) a Tuya állapotokat a Supabase-be írja.

Folyamat egy futásban:
  1. Supabase: public.devices (pink, role, tuya_device_id, meta) és public.device_latest.
  2. Tuya: token + az eszközlista egyetlen hívással (állapot és online jelző együtt).
     Csak ha egy párosított eszköz hiányzik a listából, akkor jön egy status-batch hívás.
     Szokásos költség: 2 API-hívás futásonként (kb. 288/nap, kb. 8 700/hó).
  3. public.device_status: új sor csak akkor, ha az állapot vagy az online jelző
     érdemben változott, vagy a legutóbbi sor 60 percnél régebbi (óránkénti életjel).
     A gyorsan ingadozó mérések (feszültség, áram, fogyasztásmérő-számláló) nem
     számítanak változásnak, a teljesítmény csak legalább 25 W eltérésnél.
  4. public.energy_daily: a kismegszakítók napi kWh-ja (Europe/Budapest szerinti nap)
     a kumulatív fogyasztásszámlálóból (total_forward_energy, forward_energy_total,
     vagy add_ele), a devices.meta skálájával.
  5. public.weather_hourly: óránként egyszer az időjárás (f27.weather, Open-Meteo), a Tuya
     részétől függetlenül (akkor is, ha a Tuya hívás hibára fut).
  6. public.bookings: óránként egyszer a foglaltság az Airbnb naptárexportból (f27.bookings,
     AIRBNB_ICAL_URL, ha van BOOKING_ICAL_URL), szintén a Tuyától függetlenül. A logba csak
     darabszám kerül.
  7. Riasztások (f27.alerts): minden körben a szabályok kiértékelése a friss device_latest-ből,
     azonnali értesítés ntfy pushon (alert_settings, alert_state, alert_log), és naponta egyszer
     (alapból 20:00) e-mail összefoglaló (f27.digest). A Tuya és a többi lépés hibájától
     független; a logba csak darabszám kerül.

A publikus logba csak darabszámok kerülnek: név, device ID, mérési érték soha.

Futtatás:  python -m f27.collect
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .supa import SupabaseError, SupabaseRest
from .tuya import TuyaClient, TuyaError, fetch_logs
from .alerts import run_alerts
from .bookings import collect_bookings
from .digest import run_digest
from .weather import collect_weather

BUDAPEST = ZoneInfo("Europe/Budapest")
HEARTBEAT = timedelta(minutes=60)
POWER_DELTA_W = 25
ENERGY_CODES = ("total_forward_energy", "forward_energy_total", "add_ele")
DEFAULT_SCALE = {"total_forward_energy": 2, "forward_energy_total": 2, "add_ele": 3, "cur_power": 1}
# Ezek változása önmagában nem ok új sorra (zaj, vagy a napi energia kezeli).
SIG_IGNORE = {"cur_voltage", "cur_current", "phase_a", "phase_b", "phase_c",
              "total_forward_energy", "forward_energy_total", "add_ele", "reverse_energy_total"}
MAX_STEP_KWH = 100.0   # ennél nagyobb ugrás a számlálóban hibának számít


def scale_of(meta: dict | None, code: str) -> int:
    try:
        return int((meta or {}).get(code, {}).get("scale", DEFAULT_SCALE.get(code, 0)))
    except (TypeError, ValueError):
        return DEFAULT_SCALE.get(code, 0)


def signature(status: dict) -> dict:
    """Az állapot "érdemi" része: a zajos és számláló kódok, a teljesítmény és a saját,
    aláhúzással kezdődő kiegészítő kulcsok (pl. _upd) nélkül."""
    return {k: v for k, v in (status or {}).items()
            if k not in SIG_IGNORE and k != "cur_power" and not str(k).startswith("_")}


def device_update_time(t: dict) -> int | None:
    """A Tuya eszközlista utolsó jelentés-ideje (epoch másodperc): update_time, vagy active_time.
    Milliszekundumban érkező értéket másodpercre vált."""
    for key in ("update_time", "active_time"):
        v = (t or {}).get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            v = int(v)
            return v // 1000 if v > 10**11 else v
    return None


def watts(status: dict, meta: dict | None) -> float | None:
    v = (status or {}).get("cur_power")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v / 10 ** scale_of(meta, "cur_power")
    return None


def power_changed(old: dict, new: dict, meta: dict | None) -> bool:
    """Teljesítmény: csak legalább POWER_DELTA_W eltérés számít (küszöb, nem kerekítés,
    így a sávhatáron ingadozó érték sem okoz felesleges írást)."""
    a, b = watts(old, meta), watts(new, meta)
    if a is None or b is None:
        return (a is None) != (b is None)
    return abs(a - b) >= POWER_DELTA_W


STALE_POWER_W = 300   # ennyivel (és a mért érték felével) nagyobb jelentett teljesítmény már gyanús


def counter_check(status: dict, meta: dict | None, pink: str, now: datetime, cache: dict) -> bool:
    """A felhőben ragadt teljesítmény javítása a fogyasztásszámlálóból.

    Egyes mérős kismegszakítók a felhőbe nem jelentik, amikor a teljesítmény visszaesik
    (pl. a bojler termosztátja lekapcsol): a felhő a régi 1,8 kW-ot mutatja, az app 0 W-ot.
    Ha a jelentett érték két kör óta változatlan, és a számláló az elmúlt kb. 10 percben
    ennél sokkal kevesebbet nőtt, a cur_power helyére a számlálóból számolt átlag kerül
    (a nyers érték _cur_power_raw néven megmarad). Visszaad: történt-e javítás."""
    c, raw = energy_counter(status, meta), status.get("cur_power")
    prev = cache.get(pink) or {}
    cache[pink] = {"t": now.timestamp(), "c": c, "raw": raw}
    if c is None or not isinstance(raw, (int, float)) or prev.get("c") is None:
        return False
    dt = now.timestamp() - float(prev.get("t") or 0)
    if dt < 300 or dt > 1800:
        return False
    dk = c - prev["c"]
    if dk < 0:
        return False
    avg = dk * 1000 * 3600 / dt
    status["_avgw"] = round(avg)
    w = watts(status, meta) or 0.0
    if prev.get("raw") == raw and w - avg > max(STALE_POWER_W, 0.5 * w):
        status["_cur_power_raw"] = raw
        status["cur_power"] = round(avg * 10 ** scale_of(meta, "cur_power"))
        status["_power_from"] = "counter"
        return True
    return False


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def needs_write(prev: dict | None, status: dict, online, now: datetime, meta: dict | None) -> bool:
    if prev is None:
        return True
    if prev.get("online") != online:
        return True
    old = prev.get("status") or {}
    if signature(old) != signature(status) or power_changed(old, status, meta):
        return True
    try:
        return now - parse_ts(prev["ts"]) >= HEARTBEAT
    except (KeyError, TypeError, ValueError):
        return True


def energy_counter(status: dict, meta: dict | None) -> float | None:
    for code in ENERGY_CODES:
        v = (status or {}).get(code)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return v / 10 ** scale_of(meta, code)
    return None


def next_energy_row(prev_rows: list[dict], pink: str, counter: float, today: str) -> tuple[dict, bool]:
    """A mai energia-sor új állapota. prev_rows: a pink sorai, legújabb elöl.

    Visszaad: (sor, anomália-e).
    """
    last = prev_rows[0] if prev_rows else None
    base_kwh = float(last["kwh"]) if last and last.get("day") == today else 0.0
    if not last or last.get("last_counter") is None:
        delta, anomaly = 0.0, False                       # első megfigyelés: innen számolunk
    else:
        delta = counter - float(last["last_counter"])
        anomaly = False
        if delta < 0:                                     # számláló nullázódott
            delta = counter
        if delta > MAX_STEP_KWH:                          # irreális ugrás: nem számoljuk
            delta, anomaly = 0.0, True
    return {"day": today, "pink": pink, "kwh": round(base_kwh + delta, 3),
            "last_counter": round(counter, 4)}, anomaly


def collect(client: TuyaClient, sb: SupabaseRest, now: datetime | None = None, uid: str | None = None,
            cache: dict | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    cache = {} if cache is None else cache
    stats = {"devices": 0, "received": 0, "written": 0, "unchanged": 0, "energy": 0,
             "energy_skipped": 0, "anomalies": 0, "errors": 0, "tuya_calls": 0, "notes": [],
             "power_fixed": 0, "log_events": 0, "log_calls": 0, "log_errors": 0}

    try:
        devs = sb.select("devices", "pink,role,tuya_device_id,meta")
    except SupabaseError as e:
        if e.code not in ("PGRST204", "42703"):
            raise
        devs = sb.select("devices", "pink,role,tuya_device_id")
        stats["notes"].append("A devices.meta oszlop hiányzik: a skálák alapértelmezettek "
                              "(futtasd a supabase/migrations/002_device_meta.sql-t).")
    devs = [d for d in devs if d.get("tuya_device_id")]
    stats["devices"] = len(devs)
    if not devs:
        stats["notes"].append("Nincs párosított eszköz a Supabase-ben: előbb futtasd az Eszközfelderítést.")
        return stats

    latest = {r["pink"]: r for r in sb.select("device_latest", "pink,ts,online,status")}

    by_id: dict[str, dict] = {}
    for d in client.list_devices(uid):
        by_id[d.get("id")] = d
    missing = [d["tuya_device_id"] for d in devs if d["tuya_device_id"] not in by_id]
    extra_status = client.status_batch(missing) if missing else {}
    stats["tuya_calls"] = client.calls

    rows = []
    for d in devs:
        tid, pink, meta = d["tuya_device_id"], d["pink"], d.get("meta") or {}
        t = by_id.get(tid)
        if t is not None:
            status = {s["code"]: s.get("value") for s in t.get("status") or [] if "code" in s}
            online = t.get("online")
            upd = device_update_time(t)
            if upd is not None:
                status["_upd"] = upd       # utolsó jelentés; a változásfigyelés nem nézi
        elif tid in extra_status:
            status = {s["code"]: s.get("value") for s in extra_status[tid] if "code" in s}
            online = None
        else:
            stats["errors"] += 1
            continue
        stats["received"] += 1
        if d.get("role") == "breaker" and counter_check(status, meta, pink, now, cache):
            stats["power_fixed"] += 1
        if needs_write(latest.get(pink), status, online, now, meta):
            rows.append({"pink": pink, "online": online, "status": status, "ts": now.isoformat()})
        else:
            stats["unchanged"] += 1
        d["_status"] = status
    # Nyitásérzékelők: a pontos nyitások és csukások a Tuya eseménynaplójából (a 10 perces
    # pillanatkép a rövid be- és kilépéseket nem látja). Hibája nem állítja meg a kört.
    calls0 = client.calls
    try:
        rows += contact_log_rows(client, sb, devs, now, cache, stats)
    except (TuyaError, SupabaseError):
        stats["log_errors"] += 1
    stats["log_calls"] = client.calls - calls0
    sb.insert("device_status", sorted(rows, key=lambda r: r["ts"]))
    stats["written"] = len(rows)

    # Napi energia a kismegszakítókhoz.
    breakers = [d for d in devs if d.get("role") == "breaker" and "_status" in d]
    today = now.astimezone(BUDAPEST).date().isoformat()
    if breakers:
        pinks = ",".join(sorted(d["pink"] for d in breakers))
        try:
            prev = sb.select("energy_daily", "day,pink,kwh,last_counter",
                             pink=f"in.({pinks})", order="day.desc", limit="40")
        except SupabaseError as e:
            if e.code not in ("PGRST204", "42703"):
                raise
            stats["notes"].append("Az energy_daily.last_counter oszlop hiányzik: napi energia kihagyva "
                                  "(futtasd a supabase/migrations/002_device_meta.sql-t).")
            prev = None
        if prev is not None:
            erows = []
            for d in breakers:
                c = energy_counter(d["_status"], d.get("meta"))
                if c is None:
                    stats["energy_skipped"] += 1
                    continue
                row, anomaly = next_energy_row([r for r in prev if r["pink"] == d["pink"]], d["pink"], c, today)
                stats["anomalies"] += int(anomaly)
                erows.append(row)
            sb.upsert("energy_daily", erows, on_conflict="day,pink")
            stats["energy"] = len(erows)
    return stats


CONTACT_CODES = ("doorcontact_state", "contact_state")
LOG_BACKFILL = timedelta(days=7)      # első alkalommal ennyit töltünk vissza (a Tuya ingyenes naplója kb. ennyi)
LOG_MAX_PAGES = 5


def _bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, str) and v.strip().lower() in ("true", "false"):
        return v.strip().lower() == "true"
    if isinstance(v, (int, float)):
        return v != 0
    return None


def contact_log_rows(client, sb, devs: list[dict], now: datetime, cache: dict, stats: dict) -> list[dict]:
    """device_status sorok a nyitásérzékelők Tuya-naplójából, a nyitás/csukás pontos idejével.

    Mikor kérdez: egy futás első körében minden érzékelőt (felzárkózás), utána csak azt, amelyik
    a Tuya eszközlistája szerint jelentett az előző kör óta (_upd nőtt). Honnan: az utolsó már
    beírt naplósor után (a Supabase-ben status._src = "log"), vagy ha még nincs ilyen, az elmúlt
    LOG_BACKFILL időből. A sor állapota a mostani pillanatkép, az érintett kóddal felülírva,
    _src = "log" és _upd = az esemény ideje; a változásfigyelés az aláhúzásos kulcsokat nem nézi."""
    # csak ha a Tuya ad jelentésidőt (update_time): ebből tudjuk, jelentett-e azóta
    contacts = [d for d in devs if "_status" in d and d["_status"].get("_upd")
                and any(c in d["_status"] for c in CONTACT_CODES)]
    if not contacts:
        return []
    lc = cache.setdefault("contact_logs", {})          # pink -> {"seen": utolsó látott _upd, "upto": ms}
    need = [d for d in contacts if d["pink"] not in lc
            or (d["_status"].get("_upd") or 0) > lc[d["pink"]].get("seen", 0)]
    if not need:
        return []
    floor_ms = int((now - LOG_BACKFILL).timestamp() * 1000)
    hwm: dict[str, int] = {}
    for r in sb.select("device_status", "pink,ts", **{"status->>_src": "eq.log"},
                       ts=f"gte.{(now - LOG_BACKFILL).isoformat()}", order="ts.desc", limit="500"):
        hwm.setdefault(r["pink"], int(parse_ts(r["ts"]).timestamp() * 1000))
    now_ms = int(now.timestamp() * 1000)
    out: list[dict] = []
    for d in need:
        pink, st = d["pink"], d["_status"]
        upto = max(lc.get(pink, {}).get("upto", 0), hwm.get(pink, 0), floor_ms)
        res = fetch_logs(client, d["tuya_device_id"], upto + 1, now_ms, LOG_MAX_PAGES, pause=0.3)
        if res["error"]:
            stats["log_errors"] += 1
            if res["error"].startswith("40000309"):      # túl sűrű lekérdezés: ebben a körben elég
                break
            continue
        base = {k: v for k, v in st.items() if not str(k).startswith("_")}
        last = upto
        for e in sorted(res["logs"], key=lambda x: int(x.get("event_time") or 0)):
            t, code, v = int(e.get("event_time") or 0), e.get("code"), _bool(e.get("value"))
            if code not in CONTACT_CODES or v is None or t <= upto or t > now_ms:
                continue
            row_st = dict(base, **{code: v, "_upd": t // 1000, "_src": "log"})
            out.append({"pink": pink, "online": True, "status": row_st,
                        "ts": datetime.fromtimestamp(t / 1000, timezone.utc).isoformat()})
            last = max(last, t)
        lc[pink] = {"seen": st.get("_upd") or 0, "upto": last}
    stats["log_events"] += len(out)
    return out


def report(stats: dict) -> str:
    lines = [
        "| Mérőszám | Érték |", "|---|---|",
        f"| Párosított eszköz (Supabase) | {stats['devices']} |",
        f"| Tuya-tól kapott állapot | {stats['received']} |",
        f"| Új állapotsor (változás vagy óránkénti életjel) | {stats['written']} |",
        f"| Változatlan, nem írtuk | {stats['unchanged']} |",
        f"| Napi energia frissítve (kismegszakító) | {stats['energy']} |",
        f"| Fogyasztásszámláló nélküli kismegszakító | {stats['energy_skipped']} |",
        f"| Kiszűrt számláló-ugrás | {stats['anomalies']} |",
        f"| Hiányzó eszköz (hiba) | {stats['errors']} |",
        f"| Tuya API-hívás ebben a futásban | {stats['tuya_calls']} |",
        f"| Felhőben ragadt teljesítmény javítva a számlálóból | {stats.get('power_fixed', 0)} |",
        f"| Ajtó/ablak esemény a Tuya-naplóból | {stats.get('log_events', 0)} |",
        f"| Napló-lekérés (Tuya-hívás) | {stats.get('log_calls', 0)} |",
        f"| Napló-hiba | {stats.get('log_errors', 0)} |",
    ]
    if stats["notes"]:
        lines += [""] + [f"- {n}" for n in stats["notes"]]
    return "\n".join(lines)


def main() -> int:
    sb = SupabaseRest.from_env()
    if sb is None:
        print("::error::Hiányzik a SUPABASE_URL (Variables) vagy a SUPABASE_SECRET_KEY (Secrets).")
        return 1
    try:
        client = TuyaClient.from_env()
    except ValueError:
        print("::error::Hiányzik a TUYA_ACCESS_ID vagy a TUYA_ACCESS_SECRET (Secrets).")
        return 1
    uid = os.environ.get("TUYA_UID", "").strip() or None
    rc = 0
    text = ""
    # körök közti állapot (a számláló előző értéke) ugyanabban a GitHub-futásban
    state_path = os.environ.get("F27_STATE_FILE", "/tmp/f27-collect-state.json")
    try:
        with open(state_path, encoding="utf-8") as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    try:
        stats = collect(client, sb, uid=uid, cache=cache)
        try:
            with open(state_path, "w", encoding="utf-8") as f:
                json.dump(cache, f)
        except OSError:
            pass
        if stats["errors"]:
            print(f"::warning::{stats['errors']} párosított eszköz nem jött vissza a Tuya-tól.")
        text = report(stats)
    except TuyaError as e:
        print(f"::error::Tuya hiba: code={e.code} msg={e.msg}")
        rc = 1
    except SupabaseError as e:
        print(f"::error::{e}")
        rc = 1
    wx = collect_weather(sb)
    if wx["error"]:
        print(f"::warning::{wx['note']}")
    text = (text + "\n\n" if text else "") + wx["note"]
    bk = collect_bookings(sb)
    if bk["error"]:
        print(f"::warning::{bk['note']}")
    text += "\n\n" + bk["note"]
    try:
        al = run_alerts(sb)
    except Exception as e:              # a riasztás hibája ne állítsa meg a gyűjtést
        al = {"error": True, "note": f"Riasztások: HIBA ({type(e).__name__})."}
    if al["error"]:
        print(f"::warning::{al['note']}")
    text += "\n\n" + al["note"]
    try:
        dg = run_digest(sb)
    except Exception as e:
        dg = {"error": True, "note": f"Napi összefoglaló: hiba ({type(e).__name__})."}
    if dg["error"]:
        print(f"::warning::{dg['note']}")
    text += "\n" + dg["note"]
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Adatgyűjtés\n\n" + text + "\n")
    return rc


if __name__ == "__main__":
    sys.exit(main())
