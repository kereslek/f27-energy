"""Foglaltság a Supabase-be: az Airbnb (és ha van, a Booking) naptárexport (iCal, .ics).

Az adatgyűjtő (f27.collect) minden futásakor meghívja, de ténylegesen csak akkor tölti le
a naptárt, ha a legutóbbi letöltés 55 percnél régebbi: így óránként egy letöltés forrásonként.

A naptár linkje titkos tokent tartalmaz, ezért csak GitHub Secrets-ben él:
  AIRBNB_ICAL_URL   Airbnb > Naptár > Elérhetőség > Naptárak összekapcsolása > Naptár exportálása
  BOOKING_ICAL_URL  (nem kötelező) a Booking.com extranet naptárexportja

Az Airbnb exportjában:
  SUMMARY "Reserved"                -> kind = 'reservation' (Airbnb-vendég)
  SUMMARY "Airbnb (Not available)"  -> kind = 'blocked' (importált naptár, valószínűleg
                                       Booking-vendég, vagy elérhetőségi szabály: előkészítési
                                       idő, előzetes értesítés, kézi lezárás)
A Booking exportjában a foglalás és a kézi lezárás nem különböztethető meg, ott minden
esemény 'reservation'.

Adatvédelem: a DESCRIPTION (foglalási link, telefonszám vége), a vendégnév és a nyers UID
soha nem kerül tárolásra. Az id a forrás + UID sha256 hash-e. A publikus logba csak
darabszám kerül (hány foglalás, hány lezárt időszak, hány törölt), dátum, link vagy név nem.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .supa import SupabaseError, SupabaseRest

BUDAPEST = ZoneInfo("Europe/Budapest")
SOURCES = (("airbnb", "AIRBNB_ICAL_URL"), ("booking", "BOOKING_ICAL_URL"))
EVERY = timedelta(minutes=55)
PAST_DAYS, FUTURE_DAYS = 30, 400
MISSING_TABLE = ("PGRST205", "42P01", "PGRST204", "42703")
MIGRATION = "supabase/migrations/004_bookings.sql"
BLOCKED_WORDS = ("not available", "unavailable", "blocked", "closed")
RESERVED_WORDS = ("reserved", "reservation", "booked")


def fetch(url: str, timeout: float = 20) -> str:
    req = urllib.request.Request(url, headers={"Accept": "text/calendar", "User-Agent": "f27-energy-collector"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def unfold(text: str) -> list[str]:
    """RFC 5545 sortördelés visszaalakítása: a szóközzel vagy tabbal kezdődő sor az előző folytatása."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        elif raw:
            lines.append(raw)
    return lines


def _split(line: str) -> tuple[str, dict, str]:
    """'DTSTART;VALUE=DATE:20261110' -> ('DTSTART', {'VALUE': 'DATE'}, '20261110')."""
    head, _, value = line.partition(":")
    parts = head.split(";")
    params = {}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        params[k.upper()] = v.strip('"')
    return parts[0].upper(), params, value


def parse_day(params: dict, value: str) -> date | None:
    """iCal DATE vagy DATE-TIME -> budapesti naptári nap."""
    v = value.strip()
    try:
        if params.get("VALUE", "").upper() == "DATE" or len(v) == 8:
            return datetime.strptime(v[:8], "%Y%m%d").date()
        dt = datetime.strptime(v[:15], "%Y%m%dT%H%M%S")
    except ValueError:
        return None
    if v.endswith("Z"):
        dt = dt.replace(tzinfo=timezone.utc)
    elif params.get("TZID"):
        try:
            dt = dt.replace(tzinfo=ZoneInfo(params["TZID"]))
        except (ZoneInfoNotFoundError, ValueError):
            dt = dt.replace(tzinfo=BUDAPEST)
    else:
        dt = dt.replace(tzinfo=BUDAPEST)          # "lebegő" idő: helyi időnek vesszük
    return dt.astimezone(BUDAPEST).date()


def parse_events(text: str) -> list[dict]:
    """VEVENT-ek: {'uid', 'summary', 'start', 'end'}. Más mezőt (DESCRIPTION stb.) nem olvasunk ki."""
    if "BEGIN:VCALENDAR" not in text.upper():
        raise ValueError("nem iCal válasz")
    out, cur = [], None
    for line in unfold(text):
        name, params, value = _split(line)
        if name == "BEGIN" and value.strip().upper() == "VEVENT":
            cur = {"uid": "", "summary": "", "start": None, "end": None, "date_only": False}
        elif name == "END" and value.strip().upper() == "VEVENT":
            if cur and cur["start"]:
                if cur["end"] is None or cur["end"] <= cur["start"]:
                    cur["end"] = cur["start"] + timedelta(days=1)
                cur.pop("date_only", None)
                out.append(cur)
            cur = None
        elif cur is None:
            continue
        elif name == "UID":
            cur["uid"] = value.strip()
        elif name == "SUMMARY":
            cur["summary"] = value.strip()
        elif name == "DTSTART":
            cur["start"] = parse_day(params, value)
        elif name == "DTEND":
            cur["end"] = parse_day(params, value)
    return out


def kind_of(source: str, summary: str) -> str:
    s = (summary or "").lower()
    if source == "booking":
        return "reservation"
    if any(w in s for w in BLOCKED_WORDS):
        return "blocked"
    if any(w in s for w in RESERVED_WORDS):
        return "reservation"
    return "blocked"                                  # ismeretlen: "foglalt vagy lezárt"


def row_id(source: str, ev: dict) -> str:
    key = ev["uid"] or f"nouid:{ev['start']}:{ev['end']}:{ev.get('summary', '')}"
    return hashlib.sha256(f"{source}:{key}".encode()).hexdigest()


def rows_from(source: str, text: str, now: datetime) -> list[dict]:
    today = now.astimezone(BUDAPEST).date()
    lo, hi = today - timedelta(days=PAST_DAYS), today + timedelta(days=FUTURE_DAYS)
    stamp = now.astimezone(timezone.utc).isoformat(timespec="seconds")
    rows: dict[str, dict] = {}
    for ev in parse_events(text):
        if ev["end"] < lo or ev["start"] > hi:
            continue
        rid = row_id(source, ev)
        rows[rid] = {"id": rid, "source": source, "kind": kind_of(source, ev["summary"]),
                     "start_date": ev["start"].isoformat(), "end_date": ev["end"].isoformat(), "seen_at": stamp}
    return list(rows.values())


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _missing(res: dict) -> dict:
    res["note"] = f"Foglalások: kihagyva, hiányzik a bookings tábla (futtasd a {MIGRATION}-t)."
    return res


def collect_bookings(sb: SupabaseRest, now: datetime | None = None, fetcher=None, environ=None) -> dict:
    """Visszaad: {'reservations', 'blocked', 'deleted', 'sources', 'note', 'error'}.
    fetcher(url) -> iCal szöveg (tesztekhez cserélhető)."""
    now = now or datetime.now(timezone.utc)
    environ = os.environ if environ is None else environ
    res = {"reservations": 0, "blocked": 0, "deleted": 0, "sources": 0, "note": "", "error": False}
    urls = [(src, (environ.get(var) or "").strip()) for src, var in SOURCES]
    urls = [(src, u) for src, u in urls if u]
    if not urls:
        res["note"] = "Foglalások: nincs beállítva AIRBNB_ICAL_URL."
        return res
    try:
        last = sb.select("bookings", "seen_at", order="seen_at.desc", limit="1")
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            return _missing(res)
        res["note"], res["error"] = f"Foglalások: HIBA ({e}).", True
        return res
    if last and last[0].get("seen_at") and now - parse_ts(last[0]["seen_at"]) < EVERY:
        res["note"] = "Foglalások: friss (óránként egyszer kérjük le)."
        return res

    today = now.astimezone(BUDAPEST).date().isoformat()
    problems = []
    for src, u in urls:
        try:
            rows = rows_from(src, (fetcher or fetch)(u), now)
        except Exception as e:      # hálózat, HTTP, nem iCal válasz: a következő futás újra próbálja
            problems.append(f"a {src} naptár most nem olvasható ({type(e).__name__}), a következő futás újra próbálja")
            continue
        try:
            sb.upsert("bookings", rows, on_conflict="id")
            keep = {r["id"] for r in rows}
            old = sb.select("bookings", "id", source=f"eq.{src}", end_date=f"gte.{today}")
            gone = sorted(r["id"] for r in old if r["id"] not in keep)
            for i in range(0, len(gone), 50):
                sb.delete("bookings", source=f"eq.{src}", id=f"in.({','.join(gone[i:i + 50])})")
        except SupabaseError as e:
            if e.code in MISSING_TABLE:
                return _missing(res)
            res["note"], res["error"] = f"Foglalások: HIBA ({e}).", True
            return res
        res["sources"] += 1
        res["reservations"] += sum(1 for r in rows if r["kind"] == "reservation")
        res["blocked"] += sum(1 for r in rows if r["kind"] == "blocked")
        res["deleted"] += len(gone)
    if res["sources"]:
        res["note"] = (f"Foglalások: {res['reservations']} foglalás, {res['blocked']} lezárt időszak frissítve, "
                       f"{res['deleted']} lemondott vagy megszűnt törölve.")
    if problems:
        res["note"] = (res["note"] + " " if res["note"] else "Foglalások: ") + "; ".join(problems) + "."
    return res
