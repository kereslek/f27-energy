"""Elemcsere-előrejelzés minden elemes eszközre (hőmérők, nyitás- és mozgásérzékelők).

Két fajta jelzést kapunk a Tuyától:
  - százalékot (battery_percentage: a Zigbee nyitásérzékelők, a mozgásérzékelő; CR2032 gombelem),
  - csak három szintet (battery_state: high / middle / low: a Wi-Fi hőmérők; 2 × AAA alkáli).

Az elem nem lineárisan merül: az eszköz a feszültségből számol százalékot, az alkáli elem
feszültsége a vége felé gyorsabban esik, a gombelemé sokáig szinte vízszintes, aztán zuhan.
Ezért a becslés a "térd" (knee) alatt gyorsabb merüléssel számol, és mindig dátumtartományt ad.

Eszközönként egy sor a Supabase public.battery_status táblában (supabase/migrations/008_battery.sql):
napi minták (naponta egy), a legutóbbi elemcsere ideje, a korábbi élettartamok (ebből tanul),
a becslés és hogy ment-e már push. A csere magától kiderül: ha a százalék nagyot ugrik felfelé,
vagy a hőmérő "low"-ról "high"-ra vált.

Figyelmeztetés (a tulaj kérése, 2026.11.14):
  - 30 napon belül: dashboard + esti e-mail, folyamatosan,
  - 14 napon belül: ezen felül EGY push eszközönként,
  - lemerült: egy utolsó push.
A publikus logba csak darabszám kerül.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .site import SITE
from .supa import SupabaseError, SupabaseRest

MIGRATION = "supabase/migrations/008_battery.sql"
MISSING_TABLE = ("PGRST205", "42P01", "PGRST204", "42703")

# Elemprofilok. life_days: egy készlet várható élettartama az adott eszközben, amíg nincs saját
# mérésünk (a korábbi cserék közti idő felülírja). knee: e százalék alatt gyorsul a merülés.
CHEM = {
    "AAA": {"life_days": 150, "dead_pct": 10, "knee_pct": 40, "knee_factor": 1.6,
            "_note": "2 × AAA alkáli Wi-Fi hőmérőben: a Wi-Fi miatt kb. 3-6 hónap"},
    "CR2032": {"life_days": 365, "dead_pct": 10, "knee_pct": 30, "knee_factor": 2.5,
               "_note": "CR2032 lítium gombelem Zigbee érzékelőben: sokáig lapos, a végén zuhan"},
}
STATE_RANK = {"low": 0, "middle": 1, "high": 2}
DUE30, DUE14 = 30, 14
MAX_SAMPLES = 200
JUMP_PCT = 25              # ennyi százalékpontos ugrás felfelé = elemcsere


def reading(status: dict) -> tuple[str, object] | None:
    """('pct', 0-100) vagy ('state', 'high'|'middle'|'low'); None, ha az eszköz nem jelent elemet."""
    st = status or {}
    for c in ("battery_percentage", "va_battery", "battery_value"):
        v = st.get(c)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return "pct", max(0, min(100, int(v)))
    v = st.get("battery_state")
    if v in STATE_RANK:
        return "state", v
    return None


def _d(s) -> date:
    return s if isinstance(s, date) else date.fromisoformat(str(s)[:10])


def update(row: dict, kind: str, value, today: date) -> dict:
    """A napi minta beírása, csereészleléssel. A row a battery_status sor (dict), módosított másolatot ad."""
    row = dict(row or {})
    samples = [list(s) for s in (row.get("samples") or [])]
    lifetimes = list(row.get("lifetimes") or [])
    prev = samples[-1][1] if samples else None
    replaced = False
    if prev is not None and kind == "pct" and isinstance(prev, (int, float)):
        replaced = value >= prev + JUMP_PCT and value >= 60
    elif prev is not None and kind == "state" and prev in STATE_RANK:
        replaced = STATE_RANK[value] > STATE_RANK[prev] and value == "high"
    if replaced:
        start = row.get("changed_at") or (samples[0][0] if samples else None)
        if start:
            life = (today - _d(start)).days
            if life >= 7:
                lifetimes = (lifetimes + [life])[-6:]
        row["changed_at"] = today.isoformat()
        samples = []
        row["notified"] = {}
    iso = today.isoformat()
    if samples and samples[-1][0] == iso:
        if kind == "pct":
            samples[-1][1] = min(samples[-1][1], value)
        else:
            samples[-1][1] = value
    else:
        samples.append([iso, value])
    row["samples"] = samples[-MAX_SAMPLES:]
    row["lifetimes"] = lifetimes
    row["kind"] = kind
    return row


def _theil_sen(pts: list[tuple[float, float]]) -> float | None:
    """Robusztus meredekség (a páronkénti meredekségek mediánja): egy-egy kiugró jelentés nem viszi el."""
    sl = []
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            dx = pts[j][0] - pts[i][0]
            if dx > 0:
                sl.append((pts[j][1] - pts[i][1]) / dx)
    if not sl:
        return None
    sl.sort()
    n = len(sl)
    return sl[n // 2] if n % 2 else (sl[n // 2 - 1] + sl[n // 2]) / 2


def _life(row: dict, prof: dict) -> float:
    lt = sorted(row.get("lifetimes") or [])
    if lt:
        return float(lt[len(lt) // 2])
    return float(prof["life_days"])


def forecast(row: dict, chem: str, online: bool | None, today: date) -> dict:
    """{'level': ok|due30|due14|dead|offline|unknown, 'eta_lo', 'eta_hi' (nap), 'basis', 'value'}."""
    prof = CHEM.get(chem) or CHEM["AAA"]
    samples = row.get("samples") or []
    if not samples:
        if online is False:          # elemes eszköz, amely nem jelentkezik: legtöbbször elem kell bele
            return {"level": "offline", "eta_lo": 0, "eta_hi": 0, "basis": "nem jelentkezik, elemjelzés nincs", "value": None}
        return {"level": "unknown", "eta_lo": None, "eta_hi": None, "basis": "nincs adat", "value": None}
    value = samples[-1][1]
    life = _life(row, prof)
    learned = bool(row.get("lifetimes"))
    changed = row.get("changed_at")
    age = (today - _d(changed)).days if changed else None
    dead, knee, kf = prof["dead_pct"], prof["knee_pct"], prof["knee_factor"]

    if row.get("kind") == "pct":
        p = float(value)
        if p <= dead or (online is False and p <= 20):
            return {"level": "dead", "eta_lo": 0, "eta_hi": 0, "basis": f"{int(p)}%", "value": int(p)}
        window = 30 if p > knee else 14
        pts = [((_d(s[0]) - today).days, float(s[1])) for s in samples if (today - _d(s[0])).days <= window]
        slope = _theil_sen(pts) if len(pts) >= 2 and pts[-1][0] - pts[0][0] >= 3 else None
        if slope is not None and slope < 0:
            rate, basis, spread = -slope, "mért merülés", 0.3
        else:
            # nincs még mérhető esés: az elemprofil átlagos üteme (90 százalékpont / élettartam)
            rate, basis, spread = 90.0 / life, ("tanult élettartam" if learned else "elemprofil"), 0.5
        if p > knee:
            days = (p - knee) / rate + (knee - dead) / (rate * kf)
        else:
            days = (p - dead) / (rate * (1 if basis == "mért merülés" else kf))
        lo, hi = days * (1 - spread), days * (1 + spread)
    else:
        if value == "low":
            if online is False:
                return {"level": "dead", "eta_lo": 0, "eta_hi": 0, "basis": "alacsony, offline", "value": value}
            lo, hi, basis = 0.0, 14.0, "alacsony szint"
        elif online is False:
            return {"level": "offline", "eta_lo": 0, "eta_hi": 0, "value": value,
                    "basis": f"nem jelentkezik (utoljára: {'közepes' if value == 'middle' else 'magas'})"}
        elif value == "middle":
            if age is not None:
                lo = max(0.0, 0.85 * life - age)
                hi = max(lo + 7, 1.05 * life - age)
            else:
                lo, hi = 0.15 * life, 0.35 * life
            basis = "közepes szint"
        else:
            if age is None:
                return {"level": "ok", "eta_lo": None, "eta_hi": None, "basis": "magas szint, csere ideje ismeretlen",
                        "value": value}
            lo, hi = max(0.0, 0.85 * life - age), max(7.0, 1.2 * life - age)
            basis = "tanult élettartam" if learned else "elemprofil"
    lo, hi = round(lo), round(hi)
    level = "due14" if lo <= DUE14 else "due30" if lo <= DUE30 else "ok"
    return {"level": level, "eta_lo": lo, "eta_hi": hi, "basis": basis, "value": value}


def eta_text(fc: dict, today: date) -> str:
    """Rövid, emberi szöveg: 'cseréld most', 'kb. 5-12 nap (11.19-11.26)'."""
    if fc["level"] == "dead":
        return "lemerült, cseréld most"
    if fc["level"] == "offline":
        return "nem jelentkezik, valószínűleg elem kell"
    if fc.get("eta_lo") is None:
        return "rendben"
    a, b = today + timedelta(days=fc["eta_lo"]), today + timedelta(days=fc["eta_hi"])
    if fc["eta_lo"] <= 0:
        return f"bármikor, legkésőbb {b:%m.%d.}"
    return f"kb. {fc['eta_lo']}-{fc['eta_hi']} nap ({a:%m.%d.}-{b:%m.%d.})"


# ----------------------------------------------------------------------------- konfig

def battery_devices(cfg: dict | None = None) -> dict[str, dict]:
    """pink -> {'label', 'chem', 'count'} az eszközkonfig 'battery' szerepkör-táblájából."""
    cfg = cfg if cfg is not None else json.loads(Path(SITE.devices_config).read_text(encoding="utf-8"))
    roles = {k: v for k, v in (cfg.get("battery") or {}).items() if not k.startswith("_")}
    out = {}
    for d in cfg.get("devices") or []:
        b = roles.get(d.get("role"))
        if b:
            out[d["pink"]] = {"label": d.get("label") or d["pink"], "chem": b.get("type", "AAA"),
                              "count": b.get("count", 1)}
    return out


# ----------------------------------------------------------------------------- futtatás

def plan(devs: dict, latest: dict, rows: dict, today: date) -> tuple[list[dict], list[dict]]:
    """Visszaad: (upsert sorok, push-esemény lista). Tiszta függvény, tesztelhető."""
    upserts, pushes = [], []
    for pink, info in devs.items():
        cur = latest.get(pink)
        if not cur:
            continue
        r = reading(cur.get("status") or {})
        if r is None:
            if cur.get("online") is not False:
                continue
            row = dict(rows.get(pink) or {"pink": pink})     # offline, elemjelzés nélkül: "offline" szint, push nélkül
        else:
            row = update(rows.get(pink) or {"pink": pink}, r[0], r[1], today)
        fc = forecast(row, info["chem"], cur.get("online"), today)
        notified = dict(row.get("notified") or {})
        if fc["level"] == "due14" and "due14" not in notified:          # 14 napon belül: egyetlen push
            pushes.append({"pink": pink, "label": info["label"], "level": "due14", "text": eta_text(fc, today),
                           "chem": info["chem"], "count": info["count"]})
            notified["due14"] = today.isoformat()
        if fc["level"] == "dead" and dead_push_due(notified, today):    # lemerült: ritkuló push, aztán csend
            pushes.append({"pink": pink, "label": info["label"], "level": "dead", "text": eta_text(fc, today),
                           "chem": info["chem"], "count": info["count"], "n": int(notified.get("dead_n") or 0) + 1})
            notified["dead_n"] = int(notified.get("dead_n") or 0) + 1
            notified.setdefault("dead", today.isoformat())                # az első lemerült push napja
            notified["dead_last"] = today.isoformat()
        row.update({"pink": pink, "label": info["label"], "chem": info["chem"], "notified": notified,
                    "level": fc["level"], "eta_lo": fc["eta_lo"], "eta_hi": fc["eta_hi"], "basis": fc["basis"],
                    "value": str(fc["value"])})
        upserts.append(row)
    return upserts, pushes


DEAD_DAILY = 10          # lemerült elem: az első 10 napon naponta egy push (legfeljebb 10)
DEAD_WEEKLY_UNTIL = 40   # utána hetente egy, az első push után 40 napig; aztán nincs több push
                          # (a tulaj kérése, 2026.11.14: ennyi után "értette, de nem érdekli";
                          # az esti e-mail és a dashboard továbbra is mutatja, amíg ki nem cseréli)


def dead_push_due(notified: dict, today: date) -> bool:
    """Kell-e ma push a lemerült elemről. A számláló az elemcserénél nullázódik (update)."""
    n = int(notified.get("dead_n") or 0)
    first = notified.get("dead")
    last = notified.get("dead_last") or first
    if n == 0 or not first:
        return True
    since_first = (today - _d(first)).days
    since_last = (today - _d(last)).days
    if since_last < 1:
        return False
    if n < DEAD_DAILY and since_first < DEAD_DAILY:
        return True
    return since_first < DEAD_WEEKLY_UNTIL and since_last >= 7


def push_text(p: dict) -> tuple[str, str]:
    elem = f"{p['count']} × {p['chem']}" if p.get("count", 1) > 1 else p["chem"]
    if p["level"] == "dead":
        n = p.get("n") or 1
        tail = "" if n < DEAD_DAILY else " (hetente emlékeztetek még egy ideig, utána csak az esti e-mail és a térkép szól)"
        return (f"{SITE.tag}: elem lemerült: {p['label']}",
                f"{SITE.tag}: lemerült az elem: {p['label']}. Cseréld most ({elem}).{tail}")
    return (f"{SITE.tag}: elemcsere 2 héten belül: {p['label']}",
            f"{SITE.tag}: elemcsere esedékes: {p['label']}, {p['text']} ({elem}).")


def run_battery(sb: SupabaseRest, now: datetime | None = None, environ=None, senders: dict | None = None,
                cfg: dict | None = None) -> dict:
    """Visszaad: {'devices', 'due30', 'due14', 'dead', 'pushed', 'note', 'error'}; a note csak darabszám."""
    from .alerts import SENDERS, channels_ready, dispatch, merge_config   # körkörös import elkerülése

    now = now or datetime.now(timezone.utc)
    environ = os.environ if environ is None else environ
    today = now.astimezone(SITE.tz).date()
    res = {"devices": 0, "due30": 0, "due14": 0, "dead": 0, "offline": 0, "pushed": 0, "note": "", "error": False}
    devs = battery_devices(cfg)
    if not devs:
        res["note"] = "Elemek: nincs elemes eszköz a konfigban."
        return res
    try:
        rows = {r["pink"]: r for r in sb.select("battery_status", "*")}
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            res["note"] = f"Elemek: kihagyva, hiányzik a battery_status tábla (futtasd a {MIGRATION}-t)."
        else:
            res["note"], res["error"] = f"Elemek: HIBA ({e}).", True
        return res
    try:
        latest = {r["pink"]: r for r in sb.select("device_latest", "pink,online,status")}
    except SupabaseError as e:
        res["note"], res["error"] = f"Elemek: HIBA ({e}).", True
        return res
    upserts, pushes = plan(devs, latest, rows, today)

    if pushes:
        try:
            srow = sb.select("alert_settings", "config", id="eq.1")
            acfg = merge_config(srow[0].get("config") if srow else None)
            channels = [c for c in channels_ready(acfg, environ) if c in SENDERS]   # push, whatsapp; e-mail: az esti levélben
        except SupabaseError:
            channels = []
        sendable = []
        for p in pushes:
            title, text = push_text(p)
            body = text + "\n\nTérkép: " + SITE.map_url
            msg = {"title": title, "body": body, "plain": title + "\n" + body,
                   "priority": "high" if p["level"] == "dead" else "default", "tags": "battery"}
            if channels and dispatch(msg, channels, environ, dict(SENDERS, **(senders or {})), []):
                res["pushed"] += 1
                sendable.append(p["pink"])
        if not channels:
            sendable = [p["pink"] for p in pushes]     # nincs csatorna: ne próbálja minden körben újra
        for row in upserts:                             # sikertelen küldésnél a következő kör újrapróbálja
            if row["pink"] not in sendable:
                for p in pushes:
                    if p["pink"] == row["pink"]:
                        row["notified"].pop(p["level"], None)
    stamp = now.isoformat(timespec="seconds")
    for row in upserts:
        row["updated_at"] = stamp
    try:
        if upserts:
            try:
                sb.upsert("battery_status", upserts, on_conflict="pink")
            except SupabaseError as e:
                if e.code != "23514" or not any(r["level"] == "offline" for r in upserts):
                    raise
                # régi tábla, még nem ismeri az 'offline' szintet: addig 'unknown'-ként írjuk
                sb.upsert("battery_status", [dict(r, level="unknown") if r["level"] == "offline" else r
                                             for r in upserts], on_conflict="pink")
    except SupabaseError as e:
        res["note"], res["error"] = f"Elemek: HIBA ({e}).", True
        return res
    res["devices"] = len(upserts)
    for lvl in ("due30", "due14", "dead", "offline"):
        res[lvl] = sum(1 for r in upserts if r["level"] == lvl)
    res["note"] = (f"Elemek: {res['devices']} eszköz, 30 napon belül {res['due30']}, 14 napon belül "
                   f"{res['due14']}, lemerült {res['dead']}, nem jelentkezik {res['offline']}; push: {res['pushed']}.")
    return res


def digest_lines(rows: list[dict], today: date) -> list[str]:
    """Az esti e-mail ELEMCSERE doboza: csak a 30 napon belül esedékesek, a legsürgősebb elöl."""
    order = {"dead": 0, "offline": 1, "due14": 2, "due30": 3}
    hot = sorted((r for r in rows or [] if r.get("level") in order),
                 key=lambda r: (order[r["level"]], r.get("eta_lo") if r.get("eta_lo") is not None else 0))
    out = []
    for r in hot:
        fc = {"level": r["level"], "eta_lo": r.get("eta_lo"), "eta_hi": r.get("eta_hi")}
        mark = "!!" if r["level"] in ("dead", "offline", "due14") else " ."
        ch = charge_text(r)
        out.append(f"{mark} {r.get('label') or r['pink']}: {ch + ' · ' if ch else ''}{eta_text(fc, today)}")
    return out


LEVEL_HU = {"high": "magas", "middle": "közepes", "low": "alacsony"}


def charge_text(r: dict) -> str:
    """Az elem szintje: százalék, ha az eszköz ad; a Wi-Fi hőmérőknél a szint és „% nincs” (2026.11.21)."""
    v = r.get("value")
    if v is None or v == "":
        return ""
    if r.get("kind") == "pct" or str(v).isdigit():
        return f"{v}%"
    return f"{LEVEL_HU[v]} szint (% nincs)" if v in LEVEL_HU else ""


MAIL_HOUR = 20           # a telephely helyi ideje szerint, mint az F27 esti levele


def battery_email(sb: SupabaseRest, now: datetime | None = None, environ=None, sender=None) -> dict:
    """Ideiglenes esti elemcsere-levél azoknak a telephelyeknek, amelyeknek még nincs saját esti
    levele (O2B). Naponta legfeljebb egy, 20:00 után, és csak ha van 30 napon belül esedékes vagy
    lemerült elem: így a lemerült elemről az e-mail folyamatosan szól, akkor is, amikor a push
    már elhallgatott. Visszaad: {'sent', 'note', 'error'}; a note nem tartalmaz értéket."""
    from .alerts import email_ready, send_email          # körkörös import elkerülése
    now = now or datetime.now(timezone.utc)
    environ = os.environ if environ is None else environ
    loc = now.astimezone(SITE.tz)
    res = {"sent": False, "note": "Elem-levél: nem kellett.", "error": False}
    if loc.hour < MAIL_HOUR or not email_ready(environ):
        return res
    key = f"battery-mail:{loc.date().isoformat()}"
    try:
        if sb.select("alert_log", "id", rule_key=f"eq.{key}", limit="1"):
            return res
        rows = sb.select("battery_status", "*")
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            return res
        res["note"], res["error"] = f"Elem-levél: HIBA ({e}).", True
        return res
    lines = digest_lines(rows, loc.date())
    if not lines:
        return res
    from .report_stats import box, to_html
    dead = sum(1 for r in rows if r.get("level") == "dead")
    subject = f"▓▒░ {SITE.tag}·NRG ░▒▓ {loc:%m.%d} ⚠ ELEMCSERE · {len(lines)}"
    body = ([f"{SITE.brand} · elemcsere ({loc:%Y.%m.%d})", ""] + box("ELEMCSERE", lines + ["!! = 2 héten belül vagy lemerült"])
            + ["", ("A lemerült elemről a push egy idő után elhallgat, ez a levél viszont minden este szól, "
                    "amíg ki nem cseréled." if dead else "Ez a levél csak akkor jön, ha van esedékes elem."),
               "", f"Térkép: {SITE.map_url}"])
    text = "\n".join(body) + "\n"
    try:
        (sender or send_email)({"subject": subject, "email_body": text, "email_html": to_html(text, SITE.map_url)}, environ)
    except Exception as e:                                  # SMTP, hálózat: holnap újra
        res["note"], res["error"] = f"Elem-levél: küldési hiba ({type(e).__name__}).", True
        return res
    try:
        sb.insert("alert_log", [{"rule_key": key, "kind": "digest", "text": subject[:1000], "channels": "email",
                                 "ts": now.isoformat()}])
    except SupabaseError:
        pass
    res.update(sent=True, note="Elem-levél: elküldve.")
    return res
