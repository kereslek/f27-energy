"""Óránkénti időjárás a Supabase-be (Open-Meteo, Budapest IX. kerület, kulcs nélkül).

Az adatgyűjtő (f27.collect) minden futásakor meghívja, de ténylegesen csak akkor kér le,
ha a legutóbbi lekérés 55 percnél régebbi: így óránként egy Open-Meteo hívás.

Egy lekérés az elmúlt 2 nap és a következő kb. 1 nap óráit hozza; mindet upsert-eli a
public.weather_hourly táblába (kulcs: az óra kezdete, UTC). Az eltelt órák mért (modell-
elemzés) értékként, a még el nem telt órák előrejelzésként (is_forecast) kerülnek be, és a
következő lekérések felülírják őket. Így a múlt pontosodik, a jövő mindig friss.

A publikus logba csak darabszám kerül, mérési érték nem.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from .supa import SupabaseError, SupabaseRest

LAT, LON = 47.48, 19.07            # IX. kerület, kerületi pontossággal (nem a pontos cím)
API = "https://api.open-meteo.com/v1/forecast"
HOURLY = {                          # Open-Meteo változó -> oszlop
    "temperature_2m": "temp",
    "apparent_temperature": "apparent",
    "relative_humidity_2m": "humidity",
    "dew_point_2m": "dew_point",
    "precipitation": "precip",
    "cloud_cover": "cloud",
    "wind_speed_10m": "wind",
    "wind_gusts_10m": "gust",
    "shortwave_radiation": "radiation",
    "weather_code": "weather_code",
    "is_day": "is_day",
}
INT_COLS = {"humidity", "cloud", "weather_code"}
EVERY = timedelta(minutes=55)
MISSING_TABLE = ("PGRST205", "42P01", "PGRST204", "42703")
MIGRATION = "supabase/migrations/003_weather.sql"


def url() -> str:
    q = {"latitude": LAT, "longitude": LON, "hourly": ",".join(HOURLY), "past_days": 2,
         "forecast_days": 2, "timezone": "UTC", "timeformat": "unixtime", "wind_speed_unit": "kmh"}
    return API + "?" + urllib.parse.urlencode(q)


def fetch(timeout: float = 20) -> dict:
    req = urllib.request.Request(url(), headers={"Accept": "application/json", "User-Agent": "f27-energy-collector"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def rows_from(j: dict, now: datetime) -> list[dict]:
    """Az Open-Meteo hourly válaszból weather_hourly sorok. Egy óra előrejelzés, ha még
    nem telt el teljesen (kezdete + 1 óra > most)."""
    h = (j or {}).get("hourly") or {}
    times = h.get("time") or []
    out = []
    stamp = now.astimezone(timezone.utc).isoformat(timespec="seconds")
    for i, t in enumerate(times):
        if not isinstance(t, (int, float)):
            continue
        ts = datetime.fromtimestamp(int(t), timezone.utc)
        row = {"ts": ts.isoformat(timespec="seconds"), "is_forecast": ts + timedelta(hours=1) > now, "fetched_at": stamp}
        for src, col in HOURLY.items():
            arr = h.get(src) or []
            v = _num(arr[i]) if i < len(arr) else None
            if col == "is_day":
                row[col] = None if v is None else bool(v)
            elif col in INT_COLS:
                row[col] = None if v is None else int(round(v))
            else:
                row[col] = None if v is None else round(float(v), 1)
        if row["temp"] is None:
            continue
        out.append(row)
    return out


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def collect_weather(sb: SupabaseRest, now: datetime | None = None, fetcher=None) -> dict:
    """Visszaad: {'written': n, 'past': n, 'forecast': n, 'note': publikus szöveg, 'error': bool}."""
    now = now or datetime.now(timezone.utc)
    res = {"written": 0, "past": 0, "forecast": 0, "note": "", "error": False}
    try:
        last = sb.select("weather_hourly", "fetched_at", order="fetched_at.desc", limit="1")
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            res["note"] = f"Időjárás: kihagyva, hiányzik a weather_hourly tábla (futtasd a {MIGRATION}-t)."
        else:
            res["note"], res["error"] = f"Időjárás: HIBA ({e}).", True
        return res
    if last and last[0].get("fetched_at") and now - parse_ts(last[0]["fetched_at"]) < EVERY:
        res["note"] = "Időjárás: friss (óránként egyszer kérjük le)."
        return res
    try:
        rows = rows_from((fetcher or fetch)(), now)
    except Exception as e:          # hálózat, JSON, HTTP: a következő futás újra próbálja
        res["note"] = f"Időjárás: az Open-Meteo most nem érhető el ({type(e).__name__}), a következő futás újra próbálja."
        return res
    if not rows:
        res["note"] = "Időjárás: az Open-Meteo üres választ adott."
        return res
    try:
        sb.upsert("weather_hourly", rows, on_conflict="ts")
    except SupabaseError as e:
        if e.code in MISSING_TABLE:
            res["note"] = f"Időjárás: kihagyva, hiányzik a weather_hourly tábla (futtasd a {MIGRATION}-t)."
        else:
            res["note"], res["error"] = f"Időjárás: HIBA ({e}).", True
        return res
    res["written"] = len(rows)
    res["forecast"] = sum(1 for r in rows if r["is_forecast"])
    res["past"] = res["written"] - res["forecast"]
    res["note"] = f"Időjárás: {res['written']} órás sor frissítve ({res['past']} eltelt óra, {res['forecast']} előrejelzés)."
    return res
