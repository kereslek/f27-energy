"""Riasztások: az adatgyűjtő minden 10 perces körében kiértékeli a szabályokat, és értesít.

Csak jelez, semmit nem kapcsol (lásd a brief 9. fejezetét).

Folyamat egy körben (f27.collect hívja a Tuya rész után, attól függetlenül):
  1. public.alert_settings (id = 1): a térkép Riasztások paneljén mentett beállítás. Ha nincs
     sor, az alapértelmezett szabályok élnek (DEFAULT_CONFIG). Ha nincs tábla: kihagyva, a
     Summary-ban egy megjegyzés a 006-os migrációról.
  2. public.device_latest + public.devices.meta: a hőmérők, nyílászárók, a kályhakapcsoló és a
     kismegszakítók legutóbbi állapota (a skála a térkép liveTemp-jével azonos).
  3. Szabályok, stabil kulcsokkal:
       temp_hi:<pink> / temp_lo:<pink>  hőmérő a beállított sávon kívül (1-4)
       open_heat:<pink>                 fűtés vagy klíma megy, és nyitva van egy ablak/ajtó
                                        (5, 7, 8, 9, 10; a 6-os privát tároló kimarad)
       ac_max_open                      a klíma a beállított teljesítmény felett megy, és nyitva
                                        van egy ablak (7-10)
  4. public.alert_state szabályonként: since = mióta áll fenn; ha legalább a beállított percig
     fennáll, active = igaz, és megy az értesítés (szabályonként legfeljebb cooldownMin
     percenként egyszer). Ha megszűnik és ment róla értesítés, "megszűnt" üzenet megy
     (resolvedMsg). Csendes órákban (Europe/Budapest) nem megy ki semmi, kivéve ha a kályha
     mögötti hőmérő a quietExceptStoveC fölött van; a még élő riasztás a csend végén kimegy.
  5. Próba-értesítés: ha az alert_settings.test_requested_at frissebb a legutóbbi 'test'
     naplósornál, egy próbaüzenet megy ki (a csendes órák erre nem vonatkoznak).
  6. public.alert_log: minden elküldött (vagy visszatartott) riasztás és próba egy sorban.

Csatornák (csak ha a beállításban be vannak kapcsolva ÉS a GitHub Secret meg van adva):
  push      ntfy: POST {NTFY_URL, alapból https://ntfy.sh}/{NTFY_TOPIC}  (azonnali riasztás, próba)
  whatsapp  CallMeBot: CALLMEBOT_PHONE, CALLMEBOT_APIKEY (alapból kikapcsolva, azonnali)
  e-mail    csak a napi összefoglaló (f27.digest, naponta legfeljebb egy, alapból 20:00):
            SMTP_HOST, SMTP_PORT (587 STARTTLS vagy 465 SSL), SMTP_USER, SMTP_PASS,
            ALERT_EMAIL_TO (vesszővel több cím), ALERT_EMAIL_FROM (nem kötelező)

A publikus logba csak darabszám kerül: cím, topic, telefonszám, kulcs, üzenetszöveg, mérési
érték soha. Csatornahibánál csak a kivétel osztályneve, és az is csak a hibaszámlálóba.
"""

from __future__ import annotations

import base64
import copy
import json
import os
import re
import smtplib
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate
from zoneinfo import ZoneInfo

from .supa import SupabaseError, SupabaseRest

BUDAPEST = ZoneInfo("Europe/Budapest")
MAP_URL = "https://kereslek.github.io/f27-energy/"
MIGRATION = "supabase/migrations/006_alerts.sql"
MISSING_TABLE = ("PGRST205", "42P01", "PGRST204", "42703")
CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php"

DEFAULT_CONFIG = {
    "temps": {
        "1": {"on": True, "lo": 19, "hi": 24},
        "2": {"on": True, "lo": 19, "hi": 22},
        "3": {"on": True, "lo": 20, "hi": 38},
        "4": {"on": False, "lo": 19, "hi": 25},
    },
    "minDuration": {"minutes": 10},
    "openHeat": {"on": True, "minutes": 10},
    "acMaxOpen": {"on": True, "watts": 900},
    "skipDeadContacts": True,
    "watchKitchen": False,    # a két ablakos szabály a konyhaablakot is figyelje? alapból NEM (a tulaj kérése);
                              # a régi skipKitchen kulcsot szándékosan nem olvassuk, hogy az új alapérték érvényesüljön
    "cooldownMin": 60,
    "resolvedMsg": True,
    "quiet": {"on": False, "from": "23:00", "to": "07:00"},   # a tulaj kérése: nincs csendes időszak (a telefonon szundiz)
    "quietExceptStoveC": 40,
    "channels": {"push": True, "whatsapp": False},
    "digest": {"on": True, "time": "20:00"},
}

THERMO = {"1": "Kis szoba", "2": "Nagy szoba", "3": "Kályha mögött", "4": "Fürdő"}
OPENINGS = {"5": "Bejárati ajtó", "7": "Konyha ablak", "8": "Kis szoba ablak",
            "9": "Nagy szoba bal ablak", "10": "Nagy szoba jobb ablak"}
WINDOWS = ("7", "8", "9", "10")
STOVE_KEY = "temp_hi:3"
THERMO_STALE = timedelta(hours=6)
CONTACT_STALE = timedelta(hours=24)
DEAD_BATTERY = 10
STOVE_ON_W, AC_ON_W = 300, 100
TEMP_CODES = ("va_temperature", "temp_current", "temperature")
BATT_CODES = ("battery_percentage", "va_battery", "battery_value")
BATT_STATE = {"low": 12, "middle": 55, "high": 90}
HM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


# ----------------------------------------------------------------------------- beállítás

def _num(v, lo, hi, default):
    if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi:
        return v
    return default


def _bool(v, default):
    return v if isinstance(v, bool) else default


def merge_config(stored) -> dict:
    """A mentett beállítás az alapértelmezettre fésülve; hibás vagy hiányzó mező helyett az
    alapértelmezett érték marad (a térkép régebbi vagy újabb változata sem ronthat el semmit)."""
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    s = stored if isinstance(stored, dict) else {}
    temps = s.get("temps") if isinstance(s.get("temps"), dict) else {}
    for pink, d in cfg["temps"].items():
        t = temps.get(pink) if isinstance(temps.get(pink), dict) else {}
        d["on"] = _bool(t.get("on"), d["on"])
        lo, hi = _num(t.get("lo"), -10, 80, d["lo"]), _num(t.get("hi"), -10, 80, d["hi"])
        if lo < hi:
            d["lo"], d["hi"] = lo, hi
    for key, field, lo, hi in (("minDuration", "minutes", 0, 240), ("openHeat", "minutes", 0, 240),
                               ("acMaxOpen", "watts", 100, 5000)):
        sub = s.get(key) if isinstance(s.get(key), dict) else {}
        cfg[key][field] = _num(sub.get(field), lo, hi, cfg[key][field])
        if "on" in cfg[key]:
            cfg[key]["on"] = _bool(sub.get("on"), cfg[key]["on"])
    cfg["skipDeadContacts"] = _bool(s.get("skipDeadContacts"), cfg["skipDeadContacts"])
    cfg["watchKitchen"] = _bool(s.get("watchKitchen"), cfg["watchKitchen"])
    cfg["cooldownMin"] = _num(s.get("cooldownMin"), 5, 1440, cfg["cooldownMin"])
    cfg["resolvedMsg"] = _bool(s.get("resolvedMsg"), cfg["resolvedMsg"])
    cfg["quietExceptStoveC"] = _num(s.get("quietExceptStoveC"), 20, 80, cfg["quietExceptStoveC"])
    q = s.get("quiet") if isinstance(s.get("quiet"), dict) else {}
    cfg["quiet"]["on"] = _bool(q.get("on"), cfg["quiet"]["on"])
    for k in ("from", "to"):
        if isinstance(q.get(k), str) and HM.match(q[k]):
            cfg["quiet"][k] = q[k]
    ch = s.get("channels") if isinstance(s.get("channels"), dict) else {}
    for k in cfg["channels"]:
        cfg["channels"][k] = _bool(ch.get(k), cfg["channels"][k])
    dg = s.get("digest") if isinstance(s.get("digest"), dict) else {}
    cfg["digest"]["on"] = _bool(dg.get("on"), cfg["digest"]["on"])
    if isinstance(dg.get("time"), str) and HM.match(dg["time"]):
        cfg["digest"]["time"] = dg["time"]
    return cfg


def rules_on(cfg: dict) -> int:
    return (sum(1 for t in cfg["temps"].values() if t["on"]) + int(cfg["openHeat"]["on"])
            + int(cfg["acMaxOpen"]["on"]))


def in_quiet(cfg: dict, now: datetime) -> bool:
    q = cfg["quiet"]
    if not q["on"]:
        return False
    loc = now.astimezone(BUDAPEST)
    m = loc.hour * 60 + loc.minute
    a = int(q["from"][:2]) * 60 + int(q["from"][3:])
    b = int(q["to"][:2]) * 60 + int(q["to"][3:])
    if a == b:
        return False
    return a <= m < b if a < b else (m >= a or m < b)


# ----------------------------------------------------------------------------- eszközállapot

def fmt_num(v: float, dec: int = 1) -> str:
    return f"{v:.{dec}f}".replace(".", ",")


def fmt_thr(v: float) -> str:
    """Küszöb: egész számnál tizedes nélkül (38), különben egy tizedessel (19,5)."""
    return str(int(round(v))) if abs(v - round(v)) < 1e-9 else fmt_num(v, 1)


def fmt_w(w: float) -> str:
    return f"{fmt_num(w / 1000, 1)} kW" if w >= 1000 else f"{int(round(w))} W"


def _scale(meta, code):
    try:
        sc = (meta or {}).get(code, {}).get("scale")
        return int(sc) if sc is not None else None
    except (AttributeError, TypeError, ValueError):
        return None


def temp_of(status: dict, meta: dict | None) -> float | None:
    """A térkép liveTemp-jével azonos: a devices.meta skálája, különben a 60 feletti egész /10."""
    for code in TEMP_CODES:
        v = (status or {}).get(code)
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            continue
        sc = _scale(meta, code)
        if sc is not None:
            return v / 10 ** sc
        return v / 10 if isinstance(v, int) and abs(v) > 60 else float(v)
    return None


def watts_of(status: dict, meta: dict | None) -> float | None:
    st = status or {}
    if st.get("switch") is False:
        return 0.0
    v = st.get("cur_power")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        sc = _scale(meta, "cur_power")
        return v / 10 ** (1 if sc is None else sc)
    return None


def stage_of(status: dict) -> int | None:
    st = status or {}
    codes = [c for c in ("switch_1", "switch_2", "switch_3") if c in st]
    return sum(1 for c in codes if st[c] is True) if codes else None


def open_of(status: dict) -> bool | None:
    st = status or {}
    v = st.get("doorcontact_state", st.get("contact_state"))
    return None if v is None else bool(v)


def battery_of(status: dict) -> int | None:
    st = status or {}
    for c in BATT_CODES:
        v = st.get(c)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return int(v)
    return BATT_STATE.get(st.get("battery_state"))


def parse_ts(s) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def last_report(dev: dict) -> datetime | None:
    upd = (dev.get("status") or {}).get("_upd")
    if isinstance(upd, (int, float)) and not isinstance(upd, bool) and upd > 0:
        return datetime.fromtimestamp(upd, timezone.utc)
    return parse_ts(dev.get("ts"))


def snapshot(devices: list[dict], latest: list[dict]) -> dict:
    meta = {d.get("pink"): d.get("meta") for d in devices or []}
    return {r["pink"]: {"online": r.get("online"), "status": r.get("status") or {}, "ts": r.get("ts"),
                        "meta": meta.get(r["pink"])} for r in latest or [] if r.get("pink")}


def thermo_value(snap: dict, pink: str, now: datetime) -> float | None:
    d = snap.get(pink)
    if not d or d.get("online") is False:
        return None
    t = last_report(d)
    if t is None or now - t > THERMO_STALE:
        return None
    return temp_of(d["status"], d.get("meta"))


def contact_open(snap: dict, pink: str, now: datetime, skip_dead: bool) -> bool | None:
    """Nyitva-e (None: nem tudni, vagy kihagyott, mert merült / nem elérhető / régóta hallgat)."""
    d = snap.get(pink)
    if not d:
        return None
    if skip_dead:
        if d.get("online") is False:
            return None
        b = battery_of(d["status"])
        if b is not None and b < DEAD_BATTERY:
            return None
        t = last_report(d)
        if t is None or now - t > CONTACT_STALE:
            return None
    return open_of(d["status"])


def heat_sources(snap: dict) -> tuple[list[str], bool, bool] | None:
    """(leírások, kályha megy, klíma megy); None, ha egyik forrásról sincs adat."""
    known, descs, stove, ac = False, [], False, False
    p, x5, x9 = snap.get("P"), snap.get("X5"), snap.get("X9")
    stage = stage_of(p["status"]) if p and p.get("online") is not False else None
    w5 = watts_of(x5["status"], x5.get("meta")) if x5 and x5.get("online") is not False else None
    w9 = watts_of(x9["status"], x9.get("meta")) if x9 and x9.get("online") is not False else None
    known = stage is not None or w5 is not None or w9 is not None
    if (stage or 0) > 0:
        stove = True
        descs.append(f"a kályha {stage} kW-on")
    elif w5 is not None and w5 > STOVE_ON_W:
        stove = True
        descs.append(f"a kályha fűt ({fmt_w(w5)})")
    if w9 is not None and w9 > AC_ON_W:
        ac = True
        descs.append(f"a klíma megy ({fmt_w(w9)})")
    return (descs, stove, ac) if known else None


def context_lines(snap: dict, now: datetime) -> list[str]:
    """Az e-mail rövid összefoglalója: a mostani értékek (név és cím nélkül)."""
    out = []
    for pink, name in THERMO.items():
        v = thermo_value(snap, pink, now)
        out.append(f"{name}: {fmt_num(v, 1)} °C" if v is not None else f"{name}: nincs friss adat")
    p = snap.get("P")
    st = stage_of(p["status"]) if p and p.get("online") is not False else None
    out.append(f"Kályhakapcsoló: {st}/3 fokozat" if st is not None else "Kályhakapcsoló: nincs adat")
    for pink, name in (("X5", "Kályha kör"), ("X9", "Klíma kör")):
        d = snap.get(pink)
        w = watts_of(d["status"], d.get("meta")) if d and d.get("online") is not False else None
        out.append(f"{name}: {fmt_w(w)}" if w is not None else f"{name}: nincs adat")
    opened = [name for pink, name in OPENINGS.items() if contact_open(snap, pink, now, False)]
    out.append("Nyitva: " + (", ".join(opened) if opened else "semmi"))
    return out


# ----------------------------------------------------------------------------- szabályok

def evaluate(cfg: dict, snap: dict, now: datetime) -> tuple[dict, set]:
    """Visszaad: (feltételek kulcsonként, ismeretlen kulcsok). Egy feltétel:
    {on, short, title, text(perc), rtext, minutes, quiet_ok}. Ismeretlen: a szabály be van
    kapcsolva, de nincs friss adat; ilyenkor az állapota változatlan marad."""
    conds, unknown = {}, set()
    mins = cfg["minDuration"]["minutes"]
    for pink, name in THERMO.items():
        t = cfg["temps"][pink]
        if not t["on"]:
            continue
        v = thermo_value(snap, pink, now)
        for kind in ("hi", "lo"):
            key = f"temp_{kind}:{pink}"
            if v is None:
                unknown.add(key)
                continue
            thr = t[kind]
            on = v > thr if kind == "hi" else v < thr
            short = f"{name} {fmt_num(v, 1)} °C"
            limit = f"(határ {fmt_thr(thr)} °C)" if kind == "hi" else f"(alsó határ {fmt_thr(thr)} °C)"
            conds[key] = {
                "on": on, "short": short, "title": f"F27 riasztás: {short}",
                "text": (lambda age, s=short, lm=limit: f"F27 riasztás: {s} {lm}."),
                "rtext": f"F27: megszűnt: {short} {limit}.",
                "minutes": mins,
                "quiet_ok": key == STOVE_KEY and v > cfg["quietExceptStoveC"],
            }
    skip = cfg["skipDeadContacts"]
    kitchen_out = set() if cfg["watchKitchen"] else {"7"}
    if cfg["openHeat"]["on"]:
        hs = heat_sources(snap)
        for pink, name in OPENINGS.items():
            if pink in kitchen_out:
                continue
            key = f"open_heat:{pink}"
            o = contact_open(snap, pink, now, skip)
            if hs is None or (o is None and hs[0]):
                unknown.add(key)
                continue
            descs, stove, _ac = hs
            on = bool(o) and bool(descs)
            what = "ajtó" if pink == "5" else "ablak"
            verb = "fűtés" if stove else "klímázás"
            heat = " és ".join(descs) if descs else "a fűtés áll"
            if o:
                rtext = f"F27: megszűnt: a fűtés és a klíma leállt ({name} még nyitva)."
            elif o is None:
                rtext = "F27: megszűnt: a fűtés és a klíma leállt."
            else:
                rtext = f"F27: megszűnt: {name} becsukva."
            conds[key] = {
                "on": on, "short": f"{name} nyitva", "title": f"F27: {what} nyitva {verb} közben",
                "text": (lambda age, w=what, vb=verb, n=name, h=heat:
                         f"F27: {w} nyitva {vb} közben: {n} {age} perce, közben {h}."),
                "rtext": rtext, "minutes": cfg["openHeat"]["minutes"], "quiet_ok": False,
            }
    if cfg["acMaxOpen"]["on"]:
        key = "ac_max_open"
        x9 = snap.get("X9")
        w9 = watts_of(x9["status"], x9.get("meta")) if x9 and x9.get("online") is not False else None
        states = {p: contact_open(snap, p, now, skip) for p in WINDOWS if p not in kitchen_out}
        opened = [OPENINGS[p] for p, o in states.items() if o]
        kitchen_open = bool(kitchen_out) and bool(contact_open(snap, "7", now, skip))
        if w9 is None or (not opened and any(o is None for o in states.values()) and w9 > cfg["acMaxOpen"]["watts"]):
            unknown.add(key)
        else:
            limit = cfg["acMaxOpen"]["watts"]
            on = w9 > limit and bool(opened)
            where = ", ".join(opened)
            conds[key] = {
                "on": on, "short": f"klíma {fmt_w(w9)}, ablak nyitva", "title": "F27: a klíma nagy teljesítményen, ablak nyitva",
                "text": (lambda age, w=w9, lm=limit, wh=where:
                         f"F27: a klíma nagy teljesítményen megy ({fmt_w(w)}, határ {lm} W), és nyitva: {wh}."),
                "rtext": (f"F27: megszűnt: a klíma már nem megy nagy teljesítményen ({fmt_w(w9)})." if w9 <= limit
                          else "F27: megszűnt: csak a konyhaablak van nyitva, azt nem figyeljük." if kitchen_open
                          else "F27: megszűnt: az ablakok zárva."),
                "minutes": mins, "quiet_ok": False,
            }
    return conds, unknown


def step(cfg: dict, conds: dict, unknown: set, state: dict, now: datetime, quiet: bool) -> tuple[dict, list]:
    """Az állapotgép egy köre. state: rule_key -> alert_state sor. Visszaad: (módosított sorok
    kulcsonként, események). Esemény: {key, kind ('fired'|'reminder'|'resolved'), title, text,
    short, send (bool), reason}. A last_sent-et csak a sikeres küldés után állítja a hívó."""
    changed, events = {}, []
    cool = timedelta(minutes=cfg["cooldownMin"])
    for key, c in conds.items():
        old = state.get(key) or {"rule_key": key, "active": False, "since": None, "last_sent": None, "last_text": None}
        row = dict(old)
        since, last = parse_ts(row.get("since")), parse_ts(row.get("last_sent"))
        if c["on"]:
            if since is None:
                since = now
            age = now - since
            row["since"] = since.isoformat()
            if age >= timedelta(minutes=c["minutes"]):
                first = not row.get("active")
                row["active"] = True
                text = c["text"](max(0, int(age.total_seconds() // 60)))
                row["last_text"] = text
                notified = last is not None and last >= since
                kind = "reminder" if notified else "fired"
                if kind == "reminder":
                    text = (text.replace("F27 riasztás:", "F27 riasztás (még fennáll):", 1) if text.startswith("F27 riasztás:")
                            else text.replace("F27:", "F27 (még fennáll):", 1))
                ev = {"key": key, "kind": kind, "title": c["title"], "short": c["short"], "text": text,
                      "send": False, "reason": ""}
                if last is not None and now - last < cool:
                    ev["reason"] = "türelmi idő"
                elif quiet and not c["quiet_ok"]:
                    ev["reason"] = "csendes órák"
                else:
                    ev["send"] = True
                if ev["send"] or (first and kind == "fired"):
                    events.append(ev)
        elif since is not None or row.get("active"):
            notified = bool(row.get("active")) and last is not None and since is not None and last >= since
            if notified and cfg["resolvedMsg"]:
                ev = {"key": key, "kind": "resolved", "title": "F27: megszűnt", "short": c["short"],
                      "text": c["rtext"], "send": True, "reason": ""}
                if quiet and key != STOVE_KEY:
                    ev["send"], ev["reason"] = False, "csendes órák"
                events.append(ev)
            row.update(active=False, since=None, last_text=c["rtext"])
        if row != old:
            changed[key] = row
    for key, old in state.items():
        if key in conds or key in unknown:
            continue
        if old.get("active") or old.get("since"):          # kikapcsolt szabály: csendben lezárjuk
            row = dict(old)
            row.update(active=False, since=None)
            changed[key] = row
    return changed, events


# ----------------------------------------------------------------------------- csatornák

def channels_ready(cfg: dict, environ) -> list[str]:
    """Az azonnali értesítés csatornái: push (ntfy) és, ha be van kapcsolva, WhatsApp. E-mail
    itt nincs: az csak a napi összefoglalóban megy (f27.digest)."""
    e = lambda k: (environ.get(k) or "").strip()
    ch = cfg["channels"]
    out = []
    if ch.get("push") and e("NTFY_TOPIC"):
        out.append("push")
    if ch.get("whatsapp") and e("CALLMEBOT_PHONE") and e("CALLMEBOT_APIKEY"):
        out.append("whatsapp")
    return out


def email_ready(environ) -> bool:
    e = lambda k: (environ.get(k) or "").strip()
    return bool(e("SMTP_HOST") and e("ALERT_EMAIL_TO"))


def _hdr(v: str) -> str:
    """HTTP fejléc: a nem ASCII szöveg RFC 2047 szerint kódolva (az ntfy ezt elfogadja)."""
    try:
        v.encode("ascii")
        return v
    except UnicodeEncodeError:
        return "=?UTF-8?B?" + base64.b64encode(v.encode()).decode() + "?="


def send_ntfy(msg: dict, environ, opener=None) -> None:
    base = (environ.get("NTFY_URL") or "").strip() or "https://ntfy.sh"
    url = base.rstrip("/") + "/" + urllib.parse.quote(environ["NTFY_TOPIC"].strip(), safe="")
    headers = {"Title": _hdr(msg["title"]), "Priority": msg["priority"], "Tags": msg["tags"],
               "Click": MAP_URL, "Content-Type": "text/plain; charset=utf-8"}
    req = urllib.request.Request(url, data=msg["body"].encode("utf-8"), method="POST", headers=headers)
    with (opener or urllib.request.urlopen)(req, timeout=20) as r:
        r.read()


def send_email(msg: dict, environ, smtp=None) -> None:
    """msg: {'subject', 'email_body'}. Csak a napi összefoglaló használja (f27.digest)."""
    smtp = smtp or smtplib
    host = environ["SMTP_HOST"].strip()
    port = int((environ.get("SMTP_PORT") or "587").strip() or 587)
    user = (environ.get("SMTP_USER") or "").strip()
    password = environ.get("SMTP_PASS") or ""
    to = [a.strip() for a in environ["ALERT_EMAIL_TO"].split(",") if a.strip()]
    if not to:
        raise ValueError("nincs címzett")
    m = EmailMessage()
    m["Subject"] = msg["subject"]
    m["From"] = (environ.get("ALERT_EMAIL_FROM") or "").strip() or user or to[0]
    m["To"] = ", ".join(to)
    m["Date"] = formatdate(localtime=False)
    m.set_content(msg["email_body"])
    ctx = ssl.create_default_context()
    if port == 465:
        server = smtp.SMTP_SSL(host, port, timeout=20, context=ctx)
    else:
        server = smtp.SMTP(host, port, timeout=20)
    with server as s:
        if port != 465:
            s.ehlo()
            s.starttls(context=ctx)
            s.ehlo()
        if user:
            s.login(user, password)
        s.send_message(m)


def send_whatsapp(msg: dict, environ, opener=None) -> None:
    q = urllib.parse.urlencode({"phone": environ["CALLMEBOT_PHONE"].strip(), "text": msg["plain"],
                                "apikey": environ["CALLMEBOT_APIKEY"].strip()})
    req = urllib.request.Request(CALLMEBOT_URL + "?" + q, headers={"User-Agent": "f27-energy-alerts"})
    with (opener or urllib.request.urlopen)(req, timeout=30) as r:
        r.read()


SENDERS = {"push": send_ntfy, "whatsapp": send_whatsapp}


def compose(events: list[dict], snap: dict, now: datetime, test: bool = False) -> dict:
    """Egy kör eseményei egyetlen push-értesítésben (csatornánként egy üzenet)."""
    lines = [e["text"] for e in events]
    if test:
        title = "F27 próba-értesítés"
    elif len(events) == 1:
        e = events[0]
        title = e["title"] if e["kind"] != "resolved" else f"F27: megszűnt: {e['short']}"
    else:
        title = f"F27 riasztás: {len(events)} esemény"
    fired = any(e["kind"] in ("fired", "reminder") for e in events)
    body = "\n".join(lines) + "\n\nTérkép: " + MAP_URL
    return {"title": title, "body": body, "plain": title + "\n" + body, "priority": "high" if fired else "default",
            "tags": "rotating_light" if fired else ("white_check_mark" if not test else "bell")}


def dispatch(msg: dict, channels: list[str], environ, senders: dict, errs: list) -> list[str]:
    """Visszaad: a sikeres csatornák listája. Hibánál csak a csatorna és a kivétel osztályneve
    kerül az errs listába (a kivétel szövege címet, hosztot vagy kulcsot is tartalmazhatna)."""
    ok = []
    for ch in channels:
        try:
            senders[ch](msg, environ)
            ok.append(ch)
        except Exception as e:          # hálózat, HTTP, SMTP
            errs.append(f"{ch} ({type(e).__name__})")
    return ok


# ----------------------------------------------------------------------------- futtatás

def _missing(res: dict) -> dict:
    res["note"] = f"Riasztások: kihagyva, hiányzik az alert_settings tábla (futtasd a {MIGRATION}-t)."
    return res


def run_alerts(sb: SupabaseRest, now: datetime | None = None, environ=None, senders: dict | None = None) -> dict:
    """Visszaad: {'active', 'sent', 'errors', 'events', 'test', 'note', 'error'}; a note csak darabszám."""
    now = now or datetime.now(timezone.utc)
    environ = os.environ if environ is None else environ
    senders = dict(SENDERS, **(senders or {}))
    errs: list[str] = []
    res = {"active": 0, "sent": 0, "errors": 0, "events": 0, "test": False, "note": "", "error": False}
    try:
        srow = sb.select("alert_settings", "config,test_requested_at", id="eq.1")
        state = {r["rule_key"]: r for r in sb.select("alert_state", "rule_key,active,since,last_sent,last_text")}
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            return _missing(res)
        res["note"], res["error"] = f"Riasztások: HIBA ({e}).", True
        return res
    cfg = merge_config(srow[0].get("config") if srow else None)
    try:
        try:
            devs = sb.select("devices", "pink,meta")
        except SupabaseError as e:
            if e.code not in MISSING_TABLE:
                raise
            devs = sb.select("devices", "pink")
        latest = sb.select("device_latest", "pink,ts,online,status")
    except SupabaseError as e:
        res["note"], res["error"] = f"Riasztások: HIBA ({e}).", True
        return res
    snap = snapshot(devs, latest)
    quiet = in_quiet(cfg, now)
    conds, unknown = evaluate(cfg, snap, now)
    changed, events = step(cfg, conds, unknown, state, now, quiet)
    channels = channels_ready(cfg, environ)
    logs = []

    to_send = [e for e in events if e["send"]]
    label = ""
    if to_send:
        if channels:
            ok = dispatch(compose(to_send, snap, now), channels, environ, senders, errs)
            label = ",".join(ok) if ok else "hiba"
            res["sent"] += 1 if ok else 0
        else:
            ok, label = [], "nincs beállított csatorna"
        if ok or not channels:          # teljes hibánál a következő kör újra próbálja
            for e in to_send:
                row = changed.get(e["key"]) or dict(state.get(e["key"]) or {"rule_key": e["key"]})
                row["last_sent"] = now.isoformat()
                changed[e["key"]] = row
    for e in events:
        ch = label if e["send"] else "visszatartva: " + e["reason"]
        logs.append({"rule_key": e["key"], "kind": "resolved" if e["kind"] == "resolved" else "fired",
                     "text": e["text"][:1000], "channels": ch[:200], "ts": now.isoformat()})
    res["events"] = len(to_send)

    # próba-értesítés
    req = parse_ts(srow[0].get("test_requested_at")) if srow else None
    if req is not None and now - req < timedelta(days=1) and req <= now + timedelta(minutes=5):
        try:
            last = sb.select("alert_log", "ts", kind="eq.test", order="ts.desc", limit="1")
        except SupabaseError:
            last = []
        lt = parse_ts(last[0]["ts"]) if last else None
        if lt is None or req > lt:
            n = rules_on(cfg)
            text = f"F27 próba-értesítés: a riasztás működik ({n} szabály bekapcsolva). Ez csak próba, nincs teendő."
            ch = "nincs beállított csatorna"
            if channels:
                ok = dispatch(compose([{"text": text, "kind": "test", "title": "", "short": ""}], snap, now, test=True),
                              channels, environ, senders, errs)
                res["sent"] += 1 if ok else 0
                ch = ",".join(ok) if ok else "hiba"
            res["test"] = True
            logs.append({"rule_key": "test", "kind": "test", "text": text, "channels": ch, "ts": now.isoformat()})

    try:
        if changed:
            rows = [{"rule_key": k, "active": bool(r.get("active")), "since": r.get("since"),
                     "last_sent": r.get("last_sent"), "last_text": (r.get("last_text") or None) and r["last_text"][:500]}
                    for k, r in changed.items()]
            sb.upsert("alert_state", rows, on_conflict="rule_key")
        sb.insert("alert_log", logs)
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            return _missing(res)
        res["note"], res["error"] = f"Riasztások: HIBA ({e}).", True
        return res

    final = dict(state)
    final.update(changed)
    res["active"] = sum(1 for r in final.values() if r.get("active"))
    res["errors"] = len(errs)
    note = f"Riasztások: {res['active']} aktív, {res['sent']} értesítés elküldve, {res['errors']} hiba."
    if not channels:
        note += " Nincs beállított push csatorna (NTFY_TOPIC)."
    if errs:
        note += " Csatornahiba: " + ", ".join(sorted(set(errs))) + "."
    if res["test"]:
        note += " Próba-értesítés feldolgozva."
    res["note"] = note
    res["error"] = res["errors"] > 0
    return res
