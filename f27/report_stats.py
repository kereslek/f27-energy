"""Az esti e-mail statisztikai része: ASCII-táblázat, órás oszlopsor, összevetések, ASCII-kép.

Forrás: metrics_hourly (órás összesítő a Tuya-naplóból), device_status (ajtóesemények),
weather_daily, energy_app_history (a Smart Life app előzménye). Ha valamelyik hiányzik, az adott
sor "nincs adat"; a levél ettől még kimegy.

Összevetési elv: a mai nap még nem ért véget, ezért a tegnapot és az átlagot UGYANADDIG az óráig
számoljuk (pl. 20:00-ig), így a "DoD" (nap a naphoz) és a "vs átl." nem csal.
"""

from __future__ import annotations

import html
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

BUDAPEST = ZoneInfo("Europe/Budapest")
# kör, rövid név, Ft/kWh alsó és felső (B keret felett 60,9; A1 36,2-70,1), a táblázatban a közép
CIRCUITS = (("X5", "Kályha", 60.9, 60.9), ("X7", "Bojler", 60.9, 60.9),
            ("X8", "Konyha", 36.2, 70.1), ("X9", "Klíma", 36.2, 70.1))
THERMOS = (("1", "Kis szoba"), ("2", "Nagy szoba"), ("3", "Kályha mögött"), ("4", "Fürdő"))
LEVELS = " .:-=+*#%@"                         # órás oszlopsor, 10 fokozat, tisztán ASCII

LEGEND = [
    ["Ma kWh", "ma éjféltől eddig felvett energia (a Tuya-napló add_ele összege)"],
    ["Tegnap*", "tegnap éjféltől ugyanennyi ideig (pl. 20:00-ig)"],
    ["DoD", "nap a naphoz: ma a Tegnap* értékhez képest, %"],
    ["7n átl*", "az elmúlt 7 nap átlaga, mindegyik nap ugyaneddig az óráig"],
    ["vs 7n", "ma a 7 napos átlaghoz képest, %"],
    ["30n átl*", "30 napos átlag ugyaneddig (zárójelben: ennyi napnyi adat van)"],
    ["Tegnap", "tegnap egész nap"],
    ["Hónap", "a hónap eleje óta"],
    ["Ma Ft", "becsült költség: B kör 60,9; A1 a 36,2-70,1 Ft/kWh sáv közepe"],
    ["Órás sor", "' .:-=+*#%@' = 0-tól a nap legnagyobb órájáig, üres = még nem volt"],
]

GLYPHS = {
    "F": ["#####", "#    ", "#### ", "#    ", "#    "],
    "2": [" ### ", "#   #", "   # ", "  #  ", "#####"],
    "7": ["#####", "   # ", "  #  ", " #   ", "#    "],
    "E": ["#####", "#    ", "#### ", "#    ", "#####"],
    "N": ["#   #", "##  #", "# # #", "#  ##", "#   #"],
    "R": ["#### ", "#   #", "#### ", "#  # ", "#   #"],
    "G": [" ####", "#    ", "# ###", "#   #", " ### "],
    "Y": ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
    " ": ["  ", "  ", "  ", "  ", "  "],
}


def _f(v: float | None, dec: int = 1) -> str:
    return "--" if v is None else f"{v:.{dec}f}".replace(".", ",")


def _ft(v: float | None) -> str:
    return "--" if v is None else f"{int(round(v)):,}".replace(",", " ")


def _pct(a: float | None, b: float | None) -> str:
    if a is None or b is None or b < 0.05:
        return "--"
    p = (a - b) / b * 100
    return ("+" if p >= 0 else "") + f"{p:.0f} %"


def banner(now: datetime, extra: str) -> list[str]:
    """Hacker-stílusú fejléc: blokkbetűs F27 ENERGY, alatta "terminál" sorok."""
    word = "F27 ENERGY"
    rows = ["  " + " ".join(GLYPHS[c][i] for c in word) for i in range(5)]
    loc = now.astimezone(BUDAPEST)
    bits = " ".join(format(ord(c), "08b") for c in "F27")
    return rows + [
        "",
        f"  >> F27://energy-node  [ONLINE]  napi jelentes  {loc:%Y.%m.%d %H:%M}",
        f"  >> {bits}  ::  {extra}",
        "  " + "=" * 74,
    ]


def spark(values: list[float | None], top: float | None = None) -> str:
    """24 karakteres órás oszlopsor (0-23 óra) a LEVELS fokozataival; hiányzó óra: szóköz."""
    vals = [v for v in values if v is not None]
    top = top or (max(vals) if vals else 0)
    out = []
    for v in values:
        if v is None or top <= 0:
            out.append(" ")
        else:
            out.append(LEVELS[min(len(LEVELS) - 1, max(1 if v > 0 else 0, round(v / top * (len(LEVELS) - 1))))])
    return "".join(out)


def table(head: list[str], rows: list[list[str]], right: set[int]) -> list[str]:
    """Egyszerű ASCII-táblázat +---+ kerettel."""
    w = [max(len(str(r[i])) for r in [head] + rows) for i in range(len(head))]
    line = "+" + "+".join("-" * (x + 2) for x in w) + "+"

    def fmt(r):
        return "|" + "|".join(" " + (str(c).rjust(w[i]) if i in right else str(c).ljust(w[i])) + " "
                              for i, c in enumerate(r)) + "|"
    return [line, fmt(head), line] + [fmt(r) for r in rows] + [line]


def _hourly(sb, since: datetime, pinks: list[str]) -> dict:
    out: dict[str, dict[datetime, dict]] = {}
    for page in range(20):
        rows = sb.select("metrics_hourly", "pink,hour,kwh,w_max,temp_avg,temp_min,temp_max,hum_avg",
                         pink=f"in.({','.join(pinks)})", hour=f"gte.{since.isoformat()}", order="hour.asc",
                         limit="1000", offset=str(page * 1000))
        for r in rows:
            t = datetime.fromisoformat(str(r["hour"]).replace("Z", "+00:00"))
            out.setdefault(r["pink"], {})[t.astimezone(timezone.utc)] = r
        if len(rows) < 1000:
            break
    return out


def _day_start(d: date) -> datetime:
    return datetime.combine(d, time(0, 0), BUDAPEST).astimezone(timezone.utc)


def _sum_kwh(series: dict, a: datetime, b: datetime) -> float | None:
    hits = [float(r["kwh"]) for h, r in series.items() if a <= h < b and r.get("kwh") is not None]
    return round(sum(hits), 3) if hits else None


def _door_opens(sb, since: datetime) -> dict[date, int]:
    rows = sb.select("device_status", "ts,status", pink="eq.5", ts=f"gte.{since.isoformat()}",
                     order="ts.asc", limit="5000", **{"status->>_src": "eq.log"})
    out: dict[date, int] = {}
    prev = None
    for r in rows:
        o = (r.get("status") or {}).get("doorcontact_state")
        if o is True and prev is not True:
            d = datetime.fromisoformat(str(r["ts"]).replace("Z", "+00:00")).astimezone(BUDAPEST).date()
            out[d] = out.get(d, 0) + 1
        if isinstance(o, bool):
            prev = o
    return out


def build_stats(sb, now: datetime, safe) -> tuple[list[str], str]:
    """Visszaad: (a STATISZTIKA rész sorai, a fejléc "terminál" sorába kerülő rövid szöveg)."""
    loc = now.astimezone(BUDAPEST)
    today = loc.date()
    t0 = _day_start(today)
    cut = now - t0                                      # ennyi telt el ma
    since = _day_start(today - timedelta(days=31))
    pinks = [c[0] for c in CIRCUITS] + [t[0] for t in THERMOS]
    hourly = safe(lambda: _hourly(sb, since, pinks), None)
    out = ["STATISZTIKA (a Tuya-naplóból, a tegnap és az átlag a mai időpontig számolva)"]
    if hourly is None:
        return out + ["- nincs adat (metrics_hourly: futtasd a supabase/migrations/007_history.sql-t)"], "stats: n/a"

    # 1. Körök: ma eddig, tegnap ugyaneddig, DoD, 7 és 30 napos átlag ugyaneddig, tegnap egész nap, hónap eddig
    rows, tot_today, tot_ft, mtd_ft, stove_now = [], 0.0, 0.0, 0.0, None
    month0 = _day_start(today.replace(day=1))
    for pink, name, lo, hi in CIRCUITS:
        s = hourly.get(pink, {})
        price = (lo + hi) / 2
        td = _sum_kwh(s, t0, now)
        y0 = _day_start(today - timedelta(days=1))
        yd_same = _sum_kwh(s, y0, y0 + cut)
        yd_full = _sum_kwh(s, y0, t0)
        same7 = [v for v in (_sum_kwh(s, _day_start(today - timedelta(days=k)), _day_start(today - timedelta(days=k)) + cut)
                             for k in range(1, 8)) if v is not None]
        same30 = [v for v in (_sum_kwh(s, _day_start(today - timedelta(days=k)), _day_start(today - timedelta(days=k)) + cut)
                              for k in range(1, 31)) if v is not None]
        a7 = sum(same7) / len(same7) if same7 else None
        a30 = sum(same30) / len(same30) if same30 else None
        mtd = _sum_kwh(s, month0, now)
        if td is not None:
            tot_today += td
            tot_ft += td * price
        if mtd is not None:
            mtd_ft += mtd * price
        rows.append([name, _f(td), _f(yd_same), _pct(td, yd_same), _f(a7), _pct(td, a7),
                     _f(a30) + (f" ({len(same30)}n)" if same30 and len(same30) < 30 else ""),
                     _f(yd_full), _f(mtd), _ft(None if td is None else td * price)])
        if pink == "X5":
            last = [r for h, r in s.items() if h >= now - timedelta(hours=2) and r.get("kwh") is not None]
            stove_now = last[-1]["kwh"] if last else None
    rows.append(["ÖSSZESEN", _f(tot_today), "", "", "", "", "", "", "", _ft(tot_ft)])
    out += table(["Kör", "Ma kWh", "Tegnap*", "DoD", "7n átl*", "vs 7n", "30n átl*", "Tegnap", "Hónap", "Ma Ft"],
                 rows, right=set(range(1, 10)))
    out += [""] + table(["Jel", "Mit jelent"], LEGEND, right=set())

    # 2. Havi előrejelzés
    days_in_month = ((today.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day
    full7 = []
    for k in range(1, 8):
        a = _day_start(today - timedelta(days=k))
        ft = 0.0
        ok = False
        for pink, _n, lo, hi in CIRCUITS:
            v = _sum_kwh(hourly.get(pink, {}), a, a + timedelta(days=1))
            if v is not None:
                ft += v * (lo + hi) / 2
                ok = True
        if ok:
            full7.append(ft)
    if full7:
        per_day = sum(full7) / len(full7)
        left = days_in_month - today.day + (1 - cut.total_seconds() / 86400)
        out.append(f"- Hónap eddig kb. {_ft(mtd_ft)} Ft; a 7 napos átlaggal ({_ft(per_day)} Ft/nap) a hónap vége "
                   f"kb. {_ft(mtd_ft + per_day * left)} Ft (a négy mért körön).")

    # 3. Órás oszlopsor (0-23 óra)
    out += ["", "ÓRÁNKÉNT MA (0-23 óra; minél sűrűbb a jel, annál több kWh)",
            "             0     6     12    18   23"]
    for pink, name, _lo, _hi in CIRCUITS:
        s = hourly.get(pink, {})
        vals = [(_sum_kwh(s, t0 + timedelta(hours=i), t0 + timedelta(hours=i + 1)) if t0 + timedelta(hours=i) < now else None)
                for i in range(24)]
        peak = max([v for v in vals if v is not None] or [0])
        out.append(f"  {name:<10} |{spark(vals)}|  csúcs {_f(peak, 2)} kWh/óra")

    # 4. Hőmérők: ma (min / átlag / max) és tegnap átlag
    trows = []
    for pink, name in THERMOS:
        s = hourly.get(pink, {})
        td = [r for h, r in s.items() if h >= t0 and r.get("temp_avg") is not None]
        yd = [r for h, r in s.items() if t0 - timedelta(days=1) <= h < t0 and r.get("temp_avg") is not None]
        avg = lambda xs: sum(float(r["temp_avg"]) for r in xs) / len(xs) if xs else None
        tmin = min((float(r["temp_min"]) for r in td if r.get("temp_min") is not None), default=None)
        tmax = max((float(r["temp_max"]) for r in td if r.get("temp_max") is not None), default=None)
        hum = [float(r["hum_avg"]) for r in td if r.get("hum_avg") is not None]
        a, b = avg(td), avg(yd)
        diff = None if a is None or b is None else a - b
        trows.append([name, _f(tmin), _f(a), _f(tmax), _f(b), ("+" if (diff or 0) >= 0 else "") + _f(diff) if diff is not None else "--",
                      _f(sum(hum) / len(hum), 0) + " %" if hum else "--"])
    out += [""] + table(["Hőmérő (°C)", "Ma min", "Ma átl", "Ma max", "Tegnap átl", "Változás", "Pára"],
                        trows, right=set(range(1, 7)))

    # 5. Kint, hőfokhíd, kályha-hatékonyság
    wx = safe(lambda: sb.select("weather_daily", "day,t_avg,hdd",
                                day=f"gte.{(today - timedelta(days=7)).isoformat()}", order="day.asc"), None)
    if wx:
        wd = {str(r["day"])[:10]: r for r in wx}
        w_t, w_y = wd.get(today.isoformat()), wd.get((today - timedelta(days=1)).isoformat())
        if w_t and w_t.get("t_avg") is not None:
            line = f"- Kint ma átlag {_f(float(w_t['t_avg']))} °C"
            if w_y and w_y.get("t_avg") is not None:
                line += f" (tegnap {_f(float(w_y['t_avg']))} °C)"
            out += ["", line + f", fűtési hőfokhíd ma {_f(float(w_t.get('hdd') or 0))} °C-nap."]
        effs = []
        for k in range(1, 8):
            d = today - timedelta(days=k)
            r = wd.get(d.isoformat())
            v = _sum_kwh(hourly.get("X5", {}), _day_start(d), _day_start(d) + timedelta(days=1))
            if r and v is not None and float(r.get("hdd") or 0) >= 1:
                effs.append(v / float(r["hdd"]))
        if effs:
            out.append(f"- Kályha hőigénye az elmúlt napokban: átlag {_f(sum(effs) / len(effs), 2)} kWh fokonként "
                       f"(minél kisebb, annál jobb; {len(effs)} nap).")

    # 6. Bejárati ajtó
    opens = safe(lambda: _door_opens(sb, _day_start(today - timedelta(days=7))), None)
    if opens is not None:
        past = [opens.get(today - timedelta(days=k), 0) for k in range(1, 8)]
        out.append(f"- Bejárati ajtó: ma {opens.get(today, 0)} nyitás, tegnap {past[0]}, 7 napos átlag "
                   f"{_f(sum(past) / 7)} (a Tuya eseménynaplójából).")

    # 7. A Smart Life app előzménye: előző hónap napi átlaga a mostanihoz képest
    app = safe(lambda: sb.select("energy_app_history", "pink,period,period_start,kwh,exact",
                                 period="eq.month", order="period_start.asc"), None)
    if app:
        prev_m = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        lines = []
        for pink, name, _lo, _hi in CIRCUITS:
            pm = [r for r in app if r["pink"] == pink and str(r["period_start"])[:7] == prev_m.isoformat()[:7]]
            mtd = _sum_kwh(hourly.get(pink, {}), month0, now)
            if pm and mtd is not None:
                ndays = (today.replace(day=1) - prev_m).days
                elapsed = (now - month0).total_seconds() / 86400
                cur_avg, prev_avg = mtd / max(elapsed, 0.04), float(pm[0]["kwh"]) / ndays
                lines.append(f"  {name}: most napi {_f(cur_avg)} kWh, előző hónap napi {_f(prev_avg)} kWh ({_pct(cur_avg, prev_avg)})")
        if lines:
            out += ["", "ELŐZŐ HÓNAP (Smart Life app)"] + lines

    extra = f"kwh.today = {_f(tot_today)}  ::  cost.today = ~{_ft(tot_ft)} Ft"
    if stove_now is not None:
        extra += f"  ::  stove.last_h = {_f(float(stove_now), 2)} kWh"
    return out, extra


def to_html(text: str) -> str:
    """A szöveges levél "terminál" HTML-ben: fix szélességű betű, zöld a feketén, hogy az
    ASCII-táblázat és a kép a Gmailben se csússzon szét."""
    return ('<!doctype html><html><body style="margin:0;background:#0b0f0b">'
            '<div style="background:#0b0f0b;padding:16px">'
            '<pre style="margin:0;font-family:Menlo,Consolas,\'Courier New\',monospace;font-size:12px;'
            'line-height:1.35;color:#39ff14;background:#0b0f0b;white-space:pre">'
            + html.escape(text) + "</pre></div></body></html>")
