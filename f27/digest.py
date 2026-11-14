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
  4. (A "Mai fogyasztás" külön rész 2026.11.14-én megszűnt: a Statisztika dobozai mutatják.)
  5. Statisztika (f27.report_stats): ASCII-táblázat körönként (ma eddig, tegnap és 7/30 napos átlag
     ugyanaddig az óráig, DoD, hónap eddig, Ft), havi előrejelzés, órás oszlopsor, hőmérők,
     hőfokhíd és kályha-hatékonyság, bejárati ajtó nyitásai, előző hónap az app előzményéből.
  6. Az érzékelők mostani értéke és a térkép linkje. A levél tetején ASCII-kép; a levél HTML
     változata fix szélességű "terminál" betűvel megy, hogy a táblázat ne csússzon szét.

A publikus logba csak ennyi kerül: "Napi összefoglaló: elküldve" / "nem kellett" / "hiba (Osztály)".
"""

from __future__ import annotations

import os
import re
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
KIND = {"fired": "Riasztás", "resolved": "Megszűnt", "test": "Próba"}


def day_label(d: date) -> str:
    return f"{MONTHS[d.month - 1]} {d.day}. {DAYS[d.weekday()]}"


def due(cfg: dict, now: datetime) -> bool:
    loc = now.astimezone(BUDAPEST)
    t = cfg["digest"]["time"]
    return loc.hour * 60 + loc.minute >= int(t[:2]) * 60 + int(t[3:])


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

    # 1. Riasztások ma: listában, kezdet-vég, időtartam, ment-e push (a tulaj választása, 3B)
    logs = _safe(lambda: sb.select("alert_log", "ts,rule_key,kind,text,channels", ts=f"gte.{start.isoformat()}",
                                   order="ts.asc", limit="200"), None)
    state = _safe(lambda: sb.select("alert_state", "rule_key,active,last_text"), [])
    active = [r for r in state if r.get("active")]
    out += stripe("RELEASE NOTES") + [""] + notes("Riasztások ma")
    if logs is None:
        out.append("- nincs adat (alert_log)")
    else:
        items = alert_items(logs, now)
        if not items:
            out.append("- Nem volt riasztás.")
        for n, it in enumerate(items, 1):
            out.append(f"{n}. {it['span']} {it['what']}")
            out.append(f"   {it['detail']}")
        out.append(f"Összesen: {len(items)} · aktív most: {len(active)}")

    # 2. Teendők
    todo: list[str] = []
    for r in active:
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

    # 4. Mai fogyasztás: a STATISZTIKA dobozai mutatják (a tulaj kérése, 2026.11.14: a külön rész duplikáció volt)
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
    top += tldr(head, books, snap, active, todo, today) + [""]
    marked = "\n".join(top + out) + "\n"                 # a HTML-hez jelölt részekkel (összecsukott jelmagyarázat)
    text = "\n".join(l for l in top + out if l not in ("<<LEGEND>>", "<</LEGEND>>")) + "\n"
    return {"subject": subject_line(now, head, len(active)), "email_body": text,
            "email_html": to_html(marked, MAP_URL)}


def _dur(sec: float) -> str:
    m = max(0, int(sec // 60))
    return f"{m // 60}ó{m % 60:02d}p" if m >= 60 else f"{m}p"


def _short(text: str) -> str:
    t = (text or "").strip()
    for pre in ("F27 riasztás (még fennáll): ", "F27 riasztás: ", "F27 (még fennáll): ", "F27: "):
        if t.startswith(pre):
            t = t[len(pre):]
    return t.rstrip(".")


def alert_items(logs: list[dict], now: datetime) -> list[dict]:
    """A nap riasztásai párba állítva (riasztás -> megszűnés): {span, what, detail}."""
    hm = lambda t: t.astimezone(BUDAPEST).strftime("%H:%M")
    open_, items = {}, []
    for r in logs:
        k, t = r.get("kind"), parse_ts(r.get("ts"))
        if t is None:
            continue
        if k == "fired":
            open_.setdefault(r.get("rule_key"), r)
        elif k == "resolved":
            f = open_.pop(r.get("rule_key"), None)
            items.append((f, r))
        elif k == "test":
            items.append(("test", r))
    items += [(f, None) for f in open_.values()]

    def start_of(it):
        f, r = it
        src = r if f in (None, "test") else f
        return parse_ts(src.get("ts"))
    out = []
    for f, r in sorted(items, key=start_of):
        if f == "test":
            out.append({"span": hm(parse_ts(r["ts"])), "what": "próba-értesítés", "detail": "push: " + _push(r)})
            continue
        t0 = parse_ts(f["ts"]) if f else None
        t1 = parse_ts(r["ts"]) if r else None
        a = hm(t0) if t0 else "éjfél előtt óta"
        b = hm(t1) if t1 else "most"
        dur = f" ({_dur(((t1 or now) - t0).total_seconds())})" if t0 else ""
        what = _short((f or r).get("text") or (f or r).get("rule_key") or "")
        detail = "push: " + _push(f) if f else "push: korábban"
        if r is None:
            detail += " · még aktív"
        out.append({"span": f"{a}-{b}{dur}", "what": what, "detail": detail})
    return out


def _push(r: dict) -> str:
    ch = str(r.get("channels") or "")
    if ch.startswith("visszatartva"):
        return "nem (" + ch[len("visszatartva: "):] + ")"
    return "igen" if "push" in ch else "nem"


def tldr(head: dict, books, snap: dict, active: list, todo: list, today: date) -> list[str]:
    """TL;DR blokk a fejléc alatt (a tulaj választása, 1C): mennyibe került a nap, mi a legnagyobb
    pazarlás most, mennyi az ára, egy teendő, és mennyi spórolható. Csak javaslat, semmit nem kapcsol."""
    from .report_stats import W, kv
    V = W - 15                                              # az érték szélessége
    cut = lambda v: v if len(v) <= V else v[:V - 1] + "."
    kwh, ky, ft = head.get("kwh"), head.get("kwh_y"), head.get("ft")
    dod = ""
    if kwh and ky and ky >= 0.05:
        p = (kwh - ky) / ky * 100
        dod = f" ({'▲' if p >= 0 else '▼'}{abs(p):.0f}% DoD)"
    cost = f"~{int(round(ft)):,} Ft ma".replace(",", " ") + dod if ft else "nincs adat"
    covers = lambda d: books is not None and any(b["start_date"] <= d.isoformat() < b["end_date"] for b in books)
    empty = books is not None and not covers(today)
    nxt = None
    if books is not None:
        fut = sorted((b for b in books if b["start_date"] > today.isoformat()), key=lambda b: b["start_date"])
        nxt = date.fromisoformat(fut[0]["start_date"]) if fut else None
    ss = stove_state(snap)
    x7 = snap.get("X7")
    boiler_on = bool(x7 and x7.get("online") is not False and x7["status"].get("switch") is True)
    openheat = [r for r in active if str(r.get("rule_key", "")).startswith("open_heat:")]
    waste, price, todo1, save = "nincs nagy tétel", "--", (todo[0] if todo else "nincs"), "--"
    if openheat:
        waste, price = "ablak nyitva fűtés közben", "a meleg kimegy"
        m = re.search(r"közben: (.+?) \d+ perce", openheat[0].get("last_text") or "")
        todo1 = "csukd be: " + (m.group(1) if m else "a nyitott ablakot")
    elif empty and (ss["heating"] or ss["idle_on"]):
        kday = head.get("stove_y") or (ss["stage"] or 1) * 24
        day_ft = kday * 60.9
        waste = f"kályha BE, üres lakás"
        price = f"~{int(round(day_ft, -1)):,} Ft/nap".replace(",", " ")
        todo1 = "kályha LE" + (f", vissza {nxt:%m.%d.} 12h" if nxt else "")
        if nxt:
            days = max(1, (nxt - today).days)
            save = f"~{int(round(day_ft * days, -2)):,} Ft az érkezésig".replace(",", " ")
        else:
            save = price
    elif empty and boiler_on:
        waste, price = "bojler megy, üres lakás", "~60-90 Ft/nap"
        save = price
        todo1 = "bojler LE (7-es kör)" + (f", vissza {nxt:%m.%d.} 12h" if nxt else "")
    return ["TL;DR ▒ ▒▒ ▓▓ ▓▓▓▓ " + "█" * (W - 20),
            " " + kv("Költség", cut(cost), 12), " " + kv("Pazarlás", cut(waste), 12), " " + kv("Ára", cut(price), 12),
            " " + kv("Teendő", cut(todo1), 12), " " + kv("Megtakarít", cut(save), 12)]


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
