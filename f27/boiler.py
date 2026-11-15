"""Bojler-napló az esti e-mailhez (ugyanaz a számolás, mint a térképen: web/js/boiler.js).

Mennyit ment ma a bojler, ebből mennyi a hőtartás (a tartály veszteségének pótlása) és mennyi a
melegvíz-használat, hány zuhanynak felel meg, mennyibe került, és mihez képest (tegnap és a 7 napos
átlag ugyanaddig az óráig). A hőtartás az éjszakai órák (1-5) mediánja × 24: ilyenkor senki nem enged
meleg vizet (2026.11.13-14-én mérve az F27-ben: 40 percenként 2-3 perc 1,86 kW-on, kb. 2,5 kWh/nap).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Budapest")
W_HEAT, SHOWER_KWH, L_PER_KWH, FULL_KWH = 1.86, 1.7, 33, 5.6
NIGHT = (1, 2, 3, 4)
DRAW_KWH = 0.5        # ennél több egy éjszakai órában már vízhasználat, nem hőtartás
MIN_IDLE = 0.8        # kWh/nap: ennél kisebb "hőtartás" fizikailag nem valós (kikapcsolt bojler)


def fetch(sb, pink: str, now: datetime) -> dict:
    h0 = (now - timedelta(days=8)).astimezone(timezone.utc).isoformat()
    d0 = (now.astimezone(TZ) - timedelta(days=15)).date().isoformat()
    return {"hours": sb.select("metrics_hourly", "hour,kwh", pink=f"eq.{pink}", hour=f"gte.{h0}", order="hour.asc", limit="400"),
            "days": sb.select("energy_daily", "day,kwh,source", pink=f"eq.{pink}", day=f"gte.{d0}", order="day.asc", limit="60")}


def analyze(raw: dict, now: datetime, price: float) -> dict:
    loc = now.astimezone(TZ)
    today, cut = loc.date().isoformat(), loc.hour + loc.minute / 60
    by_day: dict[str, list[tuple[int, float]]] = {}
    nights, minutes = [], [0.0] * 24
    for x in raw.get("hours") or []:
        t = datetime.fromisoformat(str(x["hour"]).replace("Z", "+00:00")).astimezone(TZ)
        k = float(x.get("kwh") or 0)
        by_day.setdefault(t.date().isoformat(), []).append((t.hour, k))
        if t.date().isoformat() == today:
            minutes[t.hour] += k / W_HEAT * 60
        elif t.hour in NIGHT:
            nights.append(k)

    def up_to(day: str, hc: float) -> float:
        return sum(k if h < int(hc) else k * (hc % 1) if h == int(hc) else 0 for h, k in by_day.get(day, []))

    day_row = next((d for d in raw.get("days") or [] if d["day"] == today), None)
    today_kwh = max(up_to(today, 25), float(day_row["kwh"]) if day_row else 0.0)
    # Hőtartás: az éjszakai órák ÁTLAGA (a vízhasználatnak látszó órák nélkül) × 24. A medián nem jó:
    # ha a bojler ritkábban fűt utána, mint óránként (O2B), vagy éjjel ki van kapcsolva, a medián 0.
    # Egy tartály naponta legalább kb. 1 kWh-t veszít: ha az éjszakai mérés ennél kevesebbet ad (pl.
    # éjjel kikapcsolt bojler), az nem hőtartás, akkor a legcsendesebb teljes nap számít.
    quiet = [k for k in nights if k <= DRAW_KWH]
    idle = (sum(quiet) / len(quiet) * 24) if len(quiet) >= 6 else None
    src = "éjszakai órákból mérve"
    if idle is None or idle < MIN_IDLE:
        full = [float(d["kwh"]) for d in raw.get("days") or [] if d["day"] < today and float(d.get("kwh") or 0) > 0]
        idle, src = (min(full), "a legcsendesebb nap") if len(full) >= 3 else (2.5, "becslés")
    idle_so_far = idle * min(1.0, cut / 24)
    use = max(0.0, today_kwh - idle_so_far)
    yday = (loc - timedelta(days=1)).date().isoformat()
    y_same = up_to(yday, cut) if yday in by_day else None
    same = [up_to(d, cut) for i in range(1, 8) if len(by_day.get(d := (loc - timedelta(days=i)).date().isoformat(), [])) >= 20]
    avg7 = sum(same) / len(same) if len(same) >= 3 else None
    starts = [h for h in range(24) if minutes[h] >= 8]
    return {"today": today_kwh, "cost": today_kwh * price, "idle": idle, "idle_src": src, "idle_day_ft": idle * price,
            "idle_so_far": idle_so_far, "use": use, "showers": use / SHOWER_KWH, "liters": use * L_PER_KWH,
            "y_same": y_same, "avg7": avg7, "minutes": minutes, "heat_min": sum(minutes), "busy_hours": starts,
            "night_use": [h for h, k in by_day.get(today, []) if h <= 5 and k > max(0.25, idle / 24 * 2.5)], "price": price}


def _n(x: float, d: int = 1) -> str:
    return f"{x:.{d}f}".replace(".", ",")


def _ft(x: float) -> str:
    return f"{round(x):,}".replace(",", " ") + " Ft"


def _pct(a: float, b: float | None) -> str:
    if not b:
        return "--"
    p = round((a / b - 1) * 100)
    return ("▲ +" if p >= 0 else "▼ ") + f"{p}%"


def _showers(n: float) -> str:
    return "nem használták" if n < 0.3 else "kb. fél zuhany" if n < 0.75 else f"kb. {round(n)} zuhany"


def spark(minutes: list[float]) -> str:
    """24 karakteres óránkénti oszlopsor a fűtési percekből."""
    chars = " ░▒▓█"
    top = max(30.0, max(minutes))
    return "".join(chars[min(4, int(m / top * 4 + 0.999))] if m > 0.5 else "·" for m in minutes)


def lines(a: dict, empty_tip: str | None = None) -> list[str]:
    """A doboz sorai (legfeljebb 40 karakter, hogy iPhone-on is kiférjen)."""
    out = [f"ma .......... {_n(a['today'])} kWh · {_ft(a['cost'])}",
           f"fűtés ....... {int(a['heat_min'] // 60)} ó {int(a['heat_min'] % 60)} p",
           f"hőtartás .... {_n(a['idle_so_far'])} kWh · {_ft(a['idle_so_far'] * a['price'])}",
           f"használat ... {_n(a['use'])} kWh · {_ft(a['use'] * a['price'])}",
           f"jelent ...... ≈ {round(a['liters'] / 5) * 5} l víz ≈ {_showers(a['showers'])}",
           f"vs tegnap ... {_pct(a['today'], a['y_same'])}",
           f"vs 7 nap .... {_pct(a['today'], a['avg7'])}",
           f"üres nap .... {_n(a['idle'])} kWh = {_ft(a['idle_day_ft'])}/nap",
           f"0h {spark(a['minutes'])} 24h"]
    if a["night_use"]:
        out.append(f"! éjjel is fűtött ({', '.join(str(h) for h in a['night_use'])} h): csöpög egy csap?")
    if empty_tip:
        out.append("→ " + empty_tip)
    return out
