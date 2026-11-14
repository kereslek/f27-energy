"""Napi e-mail összefoglaló: naponta legfeljebb egy levél, alapból 20:00-kor (Europe/Budapest).

Az adatgyűjtő (f27.collect) minden 10 perces körben meghívja. Akkor küld, ha a budapesti idő
elérte a beállított időpontot (alert_settings.config.digest.time, alapból 20:00), és ma még nem
ment ki összefoglaló (alert_log: kind = 'digest', rule_key = 'digest:ÉÉÉÉ-HH-NN'). Ha a 20:00-s
kör elmaradt, az első későbbi kör pótolja, de csak éjfélig (a nap kulcsa a budapesti dátum).

Tartalom (csak a levélben, név és cím nélkül):
  1. Ma történt: a mai riasztások, megszűnések, próbák időponttal (alert_log).
  2. Teendők: aktív riasztások, nyitott ablakok/ajtó, merülő elemek (< 20 %), nem elérhető vagy
     régóta hallgató érzékelők, üres lakásban menő kályha, holnapi érkezés előtt lekapcsolt bojler.
  3. Holnap: érkezés és távozás a foglalási naptárból (bookings), csak dátum és idő.
  4. Mai fogyasztás: a 4 mért kör kWh-ja (energy_daily) becsült forinttal, és a mai átlagos
     külső hőmérséklet (weather_daily), ha van.
  5. Statisztika (f27.report_stats): ASCII-táblázat körönként (ma eddig, tegnap és 7/30 napos átlag
     ugyanaddig az óráig, DoD, hónap eddig, Ft), havi előrejelzés, órás oszlopsor, hőmérők,
     hőfokhíd és kályha-hatékonyság, bejárati ajtó nyitásai, előző hónap az app előzményéből.
  6. Az érzékelők mostani értéke és a térkép linkje. A levél tetején ASCII-kép; a levél HTML
     változata fix szélességű "terminál" betűvel megy, hogy a táblázat ne csússzon szét.

A publikus logba csak ennyi kerül: "Napi összefoglaló: elküldve" / "nem kellett" / "hiba (Osztály)".
"""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta, timezone

from .alerts import (BUDAPEST, MAP_URL, MIGRATION, MISSING_TABLE, OPENINGS, battery_of, context_lines,
                     email_ready, fmt_num, last_report, merge_config, parse_ts, send_email, snapshot,
                     fmt_w, stove_state)
from .report_stats import banner, build_stats, footer, notes, stripe, subject_line, to_html
from .supa import SupabaseError, SupabaseRest

MONTHS = ("jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec.")
DAYS = ("hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat", "vasárnap")
CHECKIN, CHECKOUT, HEAT_START = "15:00", "10:00", "12:00"   # mint a térkép STAY-e (web/js/app.js)
NAMES = {
    "1": "Hőmérő, kis szoba", "2": "Hőmérő, nagy szoba", "3": "Hőmérő, kályha mögött", "4": "Hőmérő, fürdő",
    "5": "Bejárati ajtó", "6": "Tároló ajtó", "7": "Konyha ablak", "8": "Kis szoba ablak",
    "9": "Nagy szoba bal ablak", "10": "Nagy szoba jobb ablak", "P": "Kályhakapcsoló (LUXION)",
    "X5": "Kör 5: cserépkályha", "X7": "Kör 7: bojler", "X8": "Kör 8: főzőlap és sütő", "X9": "Kör 9: klíma",
    "G": "Zigbee + IR gateway",
}
BATTERY_SENSORS = ("1", "2", "3", "4", "5", "6", "7", "8", "9", "10")
# Csak a hőmérők: ők rendszeresen jelentenek, a hallgatásuk hiba. A nyílászárók csak nyitáskor és
# záráskor szólnak, egy zárt, nem használt ablak napokig hallgat, ez nem hír (a tulaj kérése); náluk
# csak a NYITVA jelzés mellé írjuk oda, ha régi lehet.
STALE = {"1": 6, "2": 6, "3": 6, "4": 6}   # óra
CONTACT_STALE_H = 24
# kör, név, Ft/kWh (alsó, felső): B kör keret felett 60,9; A1 kereten belül 36,2, felett 70,1 (brief, 2026)
CIRCUITS = (("X5", "Kályha (5-ös kör)", 60.9, 60.9), ("X7", "Bojler (7-es kör)", 60.9, 60.9),
            ("X8", "Konyha (8-as kör)", 36.2, 70.1), ("X9", "Klíma (9-es kör)", 36.2, 70.1))
KIND = {"fired": "Riasztás", "resolved": "Megszűnt", "test": "Próba"}


def day_label(d: date) -> str:
    return f"{MONTHS[d.month - 1]} {d.day}. {DAYS[d.weekday()]}"


def due(cfg: dict, now: datetime) -> bool:
    loc = now.astimezone(BUDAPEST)
    t = cfg["digest"]["time"]
    return loc.hour * 60 + loc.minute >= int(t[:2]) * 60 + int(t[3:])


def _ft(v: float) -> str:
    s = f"{int(round(v)):,}".replace(",", " ")
    return s


def _safe(fn, default):
    try:
        return fn()
    except SupabaseError:
        return default


def build(sb: SupabaseRest, cfg: dict, now: datetime) -> dict:
    """A levél tárgya és szövege. Minden rész külön olvas; ami hiányzik, az "nincs adat"."""
    loc = now.astimezone(BUDAPEST)
    today, tomorrow = loc.date(), loc.date() + timedelta(days=1)
    start = datetime.combine(today, time(0, 0), BUDAPEST).astimezone(timezone.utc)
    out: list[str] = []

    # 1. Ma történt
    logs = _safe(lambda: sb.select("alert_log", "ts,rule_key,kind,text,channels", ts=f"gte.{start.isoformat()}",
                                   order="ts.asc", limit="200"), None)
    out += stripe("RELEASE NOTES") + [""] + notes("Ma történt")
    happened = [r for r in logs or [] if r.get("kind") in KIND]
    if logs is None:
        out.append("- nincs adat (alert_log)")
    elif not happened:
        out.append("- Nem volt riasztás.")
    for r in happened:
        t = parse_ts(r.get("ts"))
        hm = t.astimezone(BUDAPEST).strftime("%H:%M") if t else "--:--"
        held = " (nem ment ki: " + r["channels"][len("visszatartva: "):] + ")" if str(r.get("channels") or "").startswith("visszatartva") else ""
        out.append(f"- {hm} {KIND[r['kind']]}: {r.get('text') or r.get('rule_key')}{held}")

    # 2. Teendők
    todo: list[str] = []
    state = _safe(lambda: sb.select("alert_state", "rule_key,active,last_text"), [])
    for r in state:
        if r.get("active"):
            todo.append(f"Aktív riasztás: {r.get('last_text') or r.get('rule_key')}")
    devs = _safe(lambda: sb.select("devices", "pink,meta"), None)
    if devs is None:
        devs = _safe(lambda: sb.select("devices", "pink"), [])
    latest = _safe(lambda: sb.select("device_latest", "pink,ts,online,status"), [])
    snap = snapshot(devs, latest)
    for pink, name in OPENINGS.items():
        d = snap.get(pink)
        if d and d.get("online") is not False and (d["status"].get("doorcontact_state", d["status"].get("contact_state"))):
            t = last_report(d)
            if t is not None and now - t > timedelta(hours=CONTACT_STALE_H):
                todo.append(f"Nyitva jelez, de {int((now - t).total_seconds() // 3600)} órája nem jelentett (lehet régi jelzés): {name}")
            else:
                todo.append(f"Nyitva: {name}")
    for pink in BATTERY_SENSORS:
        d = snap.get(pink)
        b = battery_of(d["status"]) if d else None
        if b is not None and b < 20:
            todo.append(f"{'Elem lemerült' if b < 10 else 'Elem merül'} ({b} %): {NAMES[pink]}")
    for pink, name in NAMES.items():
        d = snap.get(pink)
        if not d:
            continue
        if d.get("online") is False:
            todo.append(f"Nem elérhető: {name}")
        elif pink in STALE:
            t = last_report(d)
            if t is not None and now - t > timedelta(hours=STALE[pink]):
                todo.append(f"Régóta hallgat ({int((now - t).total_seconds() // 3600)} órája): {name}")
    books = _safe(lambda: sb.select("bookings", "source,kind,start_date,end_date",
                                    end_date=f"gte.{today.isoformat()}", order="start_date.asc", limit="50"), None)
    if books is not None:
        def covers(d: date) -> bool:
            k = d.isoformat()
            return any(b["start_date"] <= k < b["end_date"] for b in books)
        arrive_tomorrow = [b for b in books if b["start_date"] == tomorrow.isoformat()]
        x7 = snap.get("X7")
        ss = stove_state(snap)                      # a mérés dönt, nem a kapcsoló
        if not covers(today) and not arrive_tomorrow:
            if ss["heating"]:
                now_txt = f"most fűt ({fmt_w(ss['w'])})" if ss["measured"] else f"a kapcsoló {ss['stage']}/3 fokozaton (mérés nincs)"
                todo.append(f"A kályha {now_txt}, pedig ma éjjel nincs vendég és holnap sem érkezik: lekapcsolható (csak javaslat).")
            elif ss["idle_on"]:
                todo.append("A kályha most nem fűt (feltöltött), de a kapcsolója BE: ha lehűl, magától újra tölt. "
                            "Ma éjjel nincs vendég és holnap sem érkezik: lekapcsolható (csak javaslat).")
        if arrive_tomorrow and x7 and x7.get("online") is not False and x7["status"].get("switch") is False:
            todo.append(f"Holnap érkezik vendég, de a bojler (7-es kör) le van kapcsolva: legkésőbb holnap {HEAT_START}-kor kapcsold vissza.")
        if (not covers(today) and not arrive_tomorrow and x7 and x7.get("online") is not False
                and x7["status"].get("switch") is True):
            todo.append("Ma éjjel nincs vendég és holnap sem érkezik: a bojler (7-es kör) lekapcsolható (csak javaslat).")
    out += [""] + notes("Teendők") + ([f"{i}. {t}" for i, t in enumerate(todo, 1)] if todo else ["- Nincs teendő."])

    # 3. Holnap
    out += [""] + notes(f"Holnap ({day_label(tomorrow)})")
    if books is None:
        out.append("- nincs foglalási adat")
    else:
        what = lambda b: ("Airbnb-foglalás" if b["source"] == "airbnb" else "Booking-foglalás") if b["kind"] == "reservation" \
            else "Booking-foglalás (az Airbnb naptárából)"
        lines = [f"- Távozás {CHECKOUT} ({what(b)})" for b in books if b["end_date"] == tomorrow.isoformat()]
        lines += [f"- Érkezés {CHECKIN} ({what(b)}), felfűtés {HEAT_START}-tól" for b in books if b["start_date"] == tomorrow.isoformat()]
        if not lines:
            nxt = [b for b in books if b["start_date"] > tomorrow.isoformat()]
            lines.append("- Se érkezés, se távozás." + (f" Következő érkezés: {day_label(date.fromisoformat(nxt[0]['start_date']))} {CHECKIN}."
                                                        if nxt else ""))
        out += lines

    # 4. Mai fogyasztás
    out += [""] + notes("Mai fogyasztás (eddig)")
    energy = _safe(lambda: sb.select("energy_daily", "pink,kwh", day=f"eq.{today.isoformat()}"), None)
    if energy is None:
        out.append("- nincs adat (energy_daily)")
    else:
        kwh = {r["pink"]: float(r["kwh"]) for r in energy if r.get("kwh") is not None}
        lo_sum = hi_sum = 0.0
        for pink, name, lo, hi in CIRCUITS:
            if pink not in kwh:
                out.append(f"- {name}: nincs adat")
                continue
            k = kwh[pink]
            lo_sum, hi_sum = lo_sum + k * lo, hi_sum + k * hi
            ft = f"kb. {_ft(k * lo)} Ft" if lo == hi else f"kb. {_ft(k * lo)}-{_ft(k * hi)} Ft"
            out.append(f"- {name}: {fmt_num(k, 1)} kWh, {ft}")
        if kwh:
            out.append(f"- Összesen: kb. {_ft(lo_sum)}" + (f"-{_ft(hi_sum)}" if round(hi_sum) != round(lo_sum) else "") + " Ft")
    wx = _safe(lambda: sb.select("weather_daily", "t_avg", day=f"eq.{today.isoformat()}"), [])
    if wx and wx[0].get("t_avg") is not None:
        out.append(f"- Kint ma átlagosan {fmt_num(float(wx[0]['t_avg']), 1)} °C")

    # 4b. Statisztika: ASCII-táblázat, órás oszlopsor, összevetések (f27.report_stats)
    stats, head = build_stats(sb, now, _safe)
    out += [""] + stripe("STATISZTIKA") + ["(a Tuya-naplóból)"] + stats

    # 5. Érzékelők most + link
    out += [""] + stripe("ÉRZÉKELŐK MOST") + [f"- {x}" for x in context_lines(snap, now)]
    out += footer() + ["", f"Térkép: {MAP_URL}", "",
            f"Ezt az F27 adatgyűjtő küldte {loc.strftime('%H:%M')}-kor (csak jelez, semmit nem kapcsol). "
            "Naponta legfeljebb egy ilyen levél jön; az azonnali riasztások pushon (ntfy) mennek. "
            "Beállítás: a térkép Riasztások panelje."]
    top = banner(now, head["kwh"], head["ft"], head["guest"], head.get("kwh_y")) + ["", f">> DASHBOARD: {MAP_URL}", ""]
    text = "\n".join(top + out) + "\n"
    return {"subject": subject_line(now, head), "email_body": text,
            "email_html": to_html(text, MAP_URL)}


def run_digest(sb: SupabaseRest, now: datetime | None = None, environ=None, sender=None) -> dict:
    """Visszaad: {'sent', 'note', 'error'}; a note nem tartalmaz értéket, címet, nevet."""
    now = now or datetime.now(timezone.utc)
    environ = os.environ if environ is None else environ
    res = {"sent": False, "note": "", "error": False}
    try:
        srow = sb.select("alert_settings", "config", id="eq.1")
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            res["note"] = f"Napi összefoglaló: kihagyva, hiányzik az alert_settings tábla (futtasd a {MIGRATION}-t)."
            return res
        res["note"], res["error"] = f"Napi összefoglaló: hiba ({e}).", True
        return res
    cfg = merge_config(srow[0].get("config") if srow else None)
    if not cfg["digest"]["on"]:
        res["note"] = "Napi összefoglaló: kikapcsolva."
        return res
    if not email_ready(environ):
        res["note"] = "Napi összefoglaló: nincs beállított e-mail (SMTP_HOST, ALERT_EMAIL_TO)."
        return res
    key = "digest:" + now.astimezone(BUDAPEST).date().isoformat()
    try:
        if not due(cfg, now) or sb.select("alert_log", "id", rule_key=f"eq.{key}", limit="1"):
            res["note"] = "Napi összefoglaló: nem kellett."
            return res
        msg = build(sb, cfg, now)
    except SupabaseError as e:
        res["note"], res["error"] = f"Napi összefoglaló: hiba ({e}).", True
        return res
    try:
        (sender or send_email)(msg, environ)
    except Exception as e:              # SMTP, hálózat: a szöveg címet vagy hosztot is tartalmazhatna
        res["note"], res["error"] = f"Napi összefoglaló: hiba ({type(e).__name__}).", True
        return res
    try:
        sb.insert("alert_log", [{"rule_key": key, "kind": "digest", "text": msg["subject"], "channels": "email",
                                 "ts": now.isoformat()}])
    except SupabaseError as e:
        res["note"], res["error"] = f"Napi összefoglaló: elküldve, de a naplózás hibás ({e}).", True
        res["sent"] = True
        return res
    res["sent"] = True
    res["note"] = "Napi összefoglaló: elküldve."
    return res
