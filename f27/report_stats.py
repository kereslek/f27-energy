"""Az esti e-mail statisztikai része: warez/NFO-stílusú fejléc, keskeny ASCII-dobozok, összevetések.

Telefonra tervezve: minden doboz legfeljebb W = 44 karakter széles (iPhone-on a Gmail fix
szélességű betűvel kb. ennyit mutat tördelés nélkül), a szöveges sorok a HTML-ben tördelődnek.

Forrás: metrics_hourly (órás összesítő a Tuya-naplóból), device_status (ajtóesemények),
weather_daily és weather_hourly (előrejelzés), bookings, energy_app_history (a Smart Life app
előzménye). Ami hiányzik, az "nincs adat"; a levél ettől még kimegy.

Összevetési elv: a mai nap még nem ért véget, ezért a tegnapot és az átlagot UGYANADDIG az óráig
számoljuk (pl. 20:00-ig), így a "DoD" (nap a naphoz) és a "vs átl." nem csal.
"""

from __future__ import annotations

import html
import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BUDAPEST = ZoneInfo("Europe/Budapest")
W = 44                                        # a dobozok külső szélessége (karakter)
# kör, név, Ft/kWh alsó és felső (B keret felett 60,9; A1 36,2-70,1), mérő
CIRCUITS = (("X5", "KÁLYHA", 60.9, 60.9, "B"), ("X7", "BOJLER", 60.9, 60.9, "B"),
            ("X8", "KONYHA", 36.2, 70.1, "A1"), ("X9", "KLÍMA", 36.2, 70.1, "A1"))
THERMOS = (("1", "Kis szoba"), ("2", "Nagy szoba"), ("3", "Kályha mögött"), ("4", "Fürdő"))
LEVELS = " .:-=+*#%@"                         # órás oszlopsor, 10 fokozat
B_QUOTA_DAY = 2523 / 365                      # kedvezményes keret mérőnként (kWh/nap, a számlák szerint)
COP = 3.0                                     # klíma hőszivattyú, fűtés (becslés)
DAYS = ("H", "K", "Sze", "Cs", "P", "Szo", "V")
METERS = Path(__file__).resolve().parent.parent / "config" / "meter_readings.json"

LOGO = [
    "  ░▒▓███████▓  ▄███████▄  ▓█████████▓▒░",
    "  ░▒▓██▀▀▀▀▀▀  ▀▀▀▀▀▀▀██  ▀▀▀▀▀▀▄██▀",
    "  ░▒▓██████▓     ▄▄▄██▀▀        ▄██▀",
    "  ░▒▓██▀▀▀▀▀▀  ▄██▀▀▀         ▄██▀",
    "  ░▒▓██        █████████▓    ███",
    "     ▀▀        ▀▀▀▀▀▀▀▀▀▀    ▀▀▀",
]
GREETZ = ["zöld szék", "gramofon", "LUXiON", "Gree", "Lampart", "Hajdu", "Beko", "haozee", "Aubess", "TONGOU"]


def _f(v: float | None, dec: int = 1) -> str:
    return "--" if v is None else f"{v:.{dec}f}".replace(".", ",")


def _ft(v: float | None) -> str:
    return "--" if v is None else f"{int(round(v)):,}".replace(",", " ")


def _pct(a: float | None, b: float | None) -> str:
    if a is None or b is None or b < 0.05:
        return "--"
    p = (a - b) / b * 100
    return ("+" if p >= 0 else "") + f"{p:.0f} %"


def kv(label: str, value: str, w: int = 11) -> str:
    """NFO-stílusú pontozott sor: "ma eddig ..: 14,7 kWh"."""
    return (label + " ").ljust(w, ".") + ": " + value


def center(text: str, w: int = W) -> str:
    return text.center(w).rstrip()


def stripe(title: str) -> list[str]:
    """TAPDAT-szerű szekciófejléc: keretezett cím, mellette ░▒▓█ csík (W széles)."""
    inner = len(title) + 2
    bar = " ▒ ▒▒ ▓▓ ▓▓▓▓ "
    bar = (bar + "█" * W)[:W - inner - 3]
    return ["┌" + "─" * inner + "┐", "│ " + title + " │" + bar, "└" + "─" * inner + "┘"]


def notes(title: str) -> list[str]:
    """Razor-szerű alcím ~~~ aláhúzással."""
    return [title, "~" * len(title)]


def box(title: str, lines: list[str]) -> list[str]:
    """Keskeny keret: ┌─[ CÍM ]──░▒▓┐ ... └───┘, a sorok W-4 karakterre vágva/kitöltve."""
    inner = W - 4
    top = "┌─[ " + title + " ]"
    fill = W - 1 - len(top)
    top += ("─" * max(0, fill - 3) + "░▒▓")[-fill:] if fill >= 3 else "─" * max(0, fill)
    top += "┐"
    out = [top]
    for ln in lines:
        while len(ln) > inner:                     # túl hosszú: tördelés szóhatáron
            cut = ln.rfind(" ", 0, inner + 1)
            cut = cut if cut > 8 else inner
            out.append("│ " + ln[:cut].ljust(inner) + " │")
            ln = "  " + ln[cut:].lstrip()
        out.append("│ " + ln.ljust(inner) + " │")
    out.append("└" + "─" * (W - 2) + "┘")
    return out


def banner(now: datetime, kwh: float | None, ft: float | None, guest: str, kwh_y: float | None = None) -> list[str]:
    """Warez/NFO-fejléc (a tulaj referenciái: TAPDAT, Razor 1911, DARCK): nagy logó, "presents"
    sáv, dobozolt "proudly presents" fejléc kétoszlopos pontozott infóblokkal."""
    loc = now.astimezone(BUDAPEST)
    days = ("H", "K", "Sze", "Cs", "P", "Szo", "V")
    dod = "--"
    if kwh and kwh_y and kwh_y >= 0.05:
        p = (kwh - kwh_y) / kwh_y * 100
        dod = ("▲" if p >= 0 else "▼") + f"{abs(p):.0f}%"
    half = (W - 3) // 2                                     # két oszlop, köztük │
    lak = "bent" if "bent" in guest else "üres" if guest.startswith("üres") else "--"
    left = [" " + kv("Dátum", f"{loc:%m.%d} {days[loc.weekday()]}", 7), " " + kv("Idő", f"{loc:%H:%M}", 7),
            " " + kv("Vendég", lak, 7)]
    right = [" " + kv("Energia", f"{_f(kwh)} kWh", 8), " " + kv("Költség", f"~{_ft(ft)} Ft", 8), " " + kv("DoD", dod, 8)]
    lines = [
        " ▄" + "▄" * (W - 3),
        *LOGO,
        " " + "▀" * (W - 2),
        " ▓▒░ F · 2 · 7 · E · N · E · R · G · Y ░▒▓",
        center("p r e s e n t s"),
        "",
        "╔" + "═" * (W - 2) + "╗",
        "║" + "F27 ENERGY CREW proudly presents:".center(W - 2) + "║",
        "║" + f'"Napi jelentés" {loc:%Y.%m.%d}'.center(W - 2) + "║",
        "║" + "(p) 2026, csak olvas, semmit nem kapcsol".center(W - 2)[:W - 2] + "║",
        "╠" + "═" * half + "╤" + "═" * (W - 3 - half) + "╣",
    ]
    for a, b in zip(left, right):
        lines.append("║" + a[:half].ljust(half) + "│" + b[:W - 3 - half].ljust(W - 3 - half) + "║")
    lines.append("╚" + "═" * half + "╧" + "═" * (W - 3 - half) + "╝")
    return lines


def footer() -> list[str]:
    """Záró rész: greetz középre zárva (DARCK), kis háromszög-logó (Razor), ovális logó (TAPDAT)."""
    g, row, rows = GREETZ, "", []
    for name in g:
        if len(row) + len(name) + 3 > W - 4:
            rows.append(row); row = ""
        row = (row + " · " if row else "") + name
    rows.append(row)
    t = ["   /\\", "  /__\\", " /\\  /\\", "/__\\/__\\"]
    side = ["", "F27 ENERGY", "Since 2024", ""]
    blk = [a.ljust(9) + "  " + b for a, b in zip(t, side)]
    pad = " " * ((W - max(len(x) for x in blk)) // 2)
    tri = [(pad + x).rstrip() for x in blk]
    out = ["", center("<-- F27 ENERGY CREW greetz -->"), ""] + [center(r) for r in rows] + [
        "",
        *tri,
        "",
        "  ▄▄▄" + "▀" * (W - 10) + "▄▄▄",
        " █" + "▒ F · 2 · 7 ▒".center(W - 4) + "█",
        "  ▀▀▀" + "▄" * (W - 10) + "▀▀▀",
        center("estd. 2024"),
        "",
        center("SUPPORT THE GREEN CHAIR. SPEND LESS kWh!"),
    ]
    return out


def spark(values: list[float | None], top: float | None = None) -> str:
    """24 karakteres órás oszlopsor (0-23 óra); hiányzó óra: szóköz."""
    vals = [v for v in values if v is not None]
    top = top or (max(vals) if vals else 0)
    out = []
    for v in values:
        if v is None or top <= 0:
            out.append(" ")
        else:
            out.append(LEVELS[min(len(LEVELS) - 1, max(1 if v > 0 else 0, round(v / top * (len(LEVELS) - 1))))])
    return "".join(out)


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


def _guest(sb, today: date, safe) -> str:
    bk = safe(lambda: sb.select("bookings", "kind,start_date,end_date", end_date=f"gte.{today.isoformat()}",
                                order="start_date.asc", limit="20"), None)
    if bk is None:
        return "nincs foglalási adat"
    k = today.isoformat()
    if any(b["start_date"] <= k < b["end_date"] for b in bk):
        return "vendég bent"
    nxt = [b for b in bk if b["start_date"] > k]
    return "üres" + (f", érkezés {nxt[0]['start_date'][5:].replace('-', '.')}." if nxt else "")


def build_stats(sb, now: datetime, safe, archive=None) -> tuple[list[str], dict]:
    """Visszaad: (a statisztikai rész sorai, a fejléchez: {'kwh', 'ft', 'guest'})."""
    loc = now.astimezone(BUDAPEST)
    today = loc.date()
    t0 = _day_start(today)
    cut = now - t0                                      # ennyi telt el ma
    month0 = _day_start(today.replace(day=1))
    guest = _guest(sb, today, safe)
    head = {"kwh": None, "ft": None, "guest": guest}
    pinks = [c[0] for c in CIRCUITS] + [t[0] for t in THERMOS]
    hourly = safe(lambda: _hourly(sb, _day_start(today - timedelta(days=31)), pinks), None)
    if hourly is None:
        return box("STATISZTIKA", ["nincs adat (metrics_hourly: futtasd a supabase/migrations/007_history.sql-t)"]), head

    def same(s, k):                                     # k napja, ugyaneddig az óráig
        a = _day_start(today - timedelta(days=k))
        return _sum_kwh(s, a, a + cut)

    out: list[str] = []
    tot_kwh = tot_ft = mtd_ft = 0.0
    tot_y, any_y = 0.0, False
    mtd = {}
    for pink, name, lo, hi, meter in CIRCUITS:
        s = hourly.get(pink, {})
        price = (lo + hi) / 2
        td = _sum_kwh(s, t0, now)
        yd = same(s, 1)
        s7 = [v for v in (same(s, k) for k in range(1, 8)) if v is not None]
        s30 = [v for v in (same(s, k) for k in range(1, 31)) if v is not None]
        a7 = sum(s7) / len(s7) if s7 else None
        a30 = sum(s30) / len(s30) if s30 else None
        yfull = _sum_kwh(s, _day_start(today - timedelta(days=1)), t0)
        m = _sum_kwh(s, month0, now)
        mtd[pink] = m
        if td is not None:
            tot_kwh += td
            tot_ft += td * price
        if yd is not None:
            tot_y += yd
            any_y = True
        if m is not None:
            mtd_ft += m * price
        hours = [(_sum_kwh(s, t0 + timedelta(hours=i), t0 + timedelta(hours=i + 1)) if t0 + timedelta(hours=i) < now else None)
                 for i in range(24)]
        run_h = sum(1 for v in hours if v is not None and v >= 0.3)
        peak = max([r.get("w_max") or 0 for h, r in s.items() if h >= t0] or [0])
        lines = [
            kv("ma eddig", f"{_f(td).rjust(5)} kWh  ~{_ft(None if td is None else td * price)} Ft", 10),
            kv("tegnap*", f"{_f(yd).rjust(5)} kWh  DoD {_pct(td, yd)}", 10),
            kv("7n átl*", f"{_f(a7).rjust(5)} kWh  vs {_pct(td, a7)}", 10),
            kv("30n átl*", f"{_f(a30).rjust(5)} kWh  ({len(s30)} nap)", 10),
            kv("tegnap", f"{_f(yfull).rjust(5)} kWh  egész nap", 10),
            kv("hónap", f"{_f(m).rjust(5)} kWh  ~{_ft(None if m is None else m * price)} Ft", 10),
            f"0h|{spark(hours)}|23h",
            f"   {run_h} óra >0,3 kWh · csúcs {_f(float(peak) / 1000 if peak else None, 2)} kW",
        ]
        out += box(f"{name} · {meter}", lines)
    head.update(kwh=round(tot_kwh, 2), ft=tot_ft, kwh_y=round(tot_y, 2) if any_y else None)

    # Összesítő és havi előrejelzés
    days_in_month = ((today.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day
    full7 = []
    for k in range(1, 8):
        a = _day_start(today - timedelta(days=k))
        vals = [(_sum_kwh(hourly.get(p, {}), a, a + timedelta(days=1)), (lo + hi) / 2) for p, _n, lo, hi, _m in CIRCUITS]
        if any(v is not None for v, _p in vals):
            full7.append(sum((v or 0) * p for v, p in vals))
    summ = [f"ma eddig  {_f(tot_kwh).rjust(6)} kWh   ~{_ft(tot_ft)} Ft",
            f"hónap     ~{_ft(mtd_ft)} Ft eddig"]
    if full7:
        per_day = sum(full7) / len(full7)
        left = days_in_month - today.day + (1 - cut.total_seconds() / 86400)
        summ += [f"7n átlag  ~{_ft(per_day)} Ft/nap",
                 f"hó vége   ~{_ft(mtd_ft + per_day * left)} Ft (várható)"]
    # B kör kedvezményes kerete (kályha + bojler egy mérőn)
    b_mtd = (mtd.get("X5") or 0) + (mtd.get("X7") or 0)
    quota = B_QUOTA_DAY * days_in_month
    summ.append(f"B-keret   {_f(b_mtd, 0)} / {_f(quota, 0)} kWh ({_pct(b_mtd, quota) if b_mtd else '--'})")
    if b_mtd > quota:
        summ.append("          elfogyott: a többi 60,9 Ft/kWh")
    out += box("ÖSSZESEN · 4 MÉRT KÖR", summ)

    # Ötlet: a kályha hője klímából (ha ma a kályha fűtött)
    st_td = _sum_kwh(hourly.get("X5", {}), t0, now)
    if st_td and st_td >= 3:
        ac_lo, ac_hi = st_td / COP * 36.2, st_td / COP * 70.1
        out += box("TiPP · KLÍMA vs KÁLYHA", [
            f"kályha ma  {_f(st_td)} kWh = ~{_ft(st_td * 60.9)} Ft",
            f"klímából   {_ft(ac_lo)}-{_ft(ac_hi)} Ft (COP~3)",
            f"=> ~{_ft(st_td * 60.9 - ac_hi)}-{_ft(st_td * 60.9 - ac_lo)} Ft/nap megtakarítás",
            "a nagy szobába a két szoba közti",
            "ajtón át jut a meleg. Csak javaslat."])

    # Hőmérők
    tl = ["szoba          min| átl| max  vs tg"]
    for pink, name in THERMOS:
        s = hourly.get(pink, {})
        td = [r for h, r in s.items() if h >= t0 and r.get("temp_avg") is not None]
        yd = [r for h, r in s.items() if t0 - timedelta(days=1) <= h < t0 and r.get("temp_avg") is not None]
        avg = lambda xs: sum(float(r["temp_avg"]) for r in xs) / len(xs) if xs else None
        tmin = min((float(r["temp_min"]) for r in td if r.get("temp_min") is not None), default=None)
        tmax = max((float(r["temp_max"]) for r in td if r.get("temp_max") is not None), default=None)
        a, b = avg(td), avg(yd)
        diff = "--" if a is None or b is None else ("+" if a - b >= 0 else "") + _f(a - b)
        tl.append(f"{name[:13].ljust(13)} {_f(tmin).rjust(4)}|{_f(a).rjust(4)}|{_f(tmax).rjust(4)}  {diff.rjust(4)}")
    out += box("HŐMÉRŐK °C · MA", tl)

    # Kint, hőfokhíd, kályha-hatékonyság, holnapi várható
    wl = []
    wx = safe(lambda: sb.select("weather_daily", "day,t_avg,hdd",
                                day=f"gte.{(today - timedelta(days=7)).isoformat()}", order="day.asc"), None)
    effs = []
    if wx:
        wd = {str(r["day"])[:10]: r for r in wx}
        w_t, w_y = wd.get(today.isoformat()), wd.get((today - timedelta(days=1)).isoformat())
        if w_t and w_t.get("t_avg") is not None:
            wl.append(f"kint ma   {_f(float(w_t['t_avg']))} °C  (tegnap {_f(float(w_y['t_avg'])) if w_y and w_y.get('t_avg') is not None else '--'})")
            wl.append(f"hőfokhíd  {_f(float(w_t.get('hdd') or 0))} °C-nap")
        for k in range(1, 8):
            d = today - timedelta(days=k)
            r = wd.get(d.isoformat())
            v = _sum_kwh(hourly.get("X5", {}), _day_start(d), _day_start(d) + timedelta(days=1))
            if r and v is not None and float(r.get("hdd") or 0) >= 1:
                effs.append(v / float(r["hdd"]))
        if effs:
            wl.append(f"kályha    {_f(sum(effs) / len(effs), 2)} kWh/fok ({len(effs)} nap)")
    fc = safe(lambda: sb.select("weather_hourly", "ts,temp",
                                ts=f"gte.{_day_start(today + timedelta(days=1)).isoformat()}", order="ts.asc", limit="48"), None)
    if fc:
        tom = [float(r["temp"]) for r in fc if r.get("temp") is not None
               and datetime.fromisoformat(str(r["ts"]).replace("Z", "+00:00")) < _day_start(today + timedelta(days=2))]
        if len(tom) >= 12:
            t_avg = sum(tom) / len(tom)
            hdd = 18 - t_avg if t_avg <= 15 else 0.0
            line = f"holnap    ~{_f(t_avg)} °C ({len(tom)} óra előrejelzés)"
            wl.append(line)
            if effs and hdd > 0:
                k = sum(effs) / len(effs) * hdd
                wl.append(f"          kályha várhatóan ~{_f(k, 0)} kWh, ~{_ft(k * 60.9)} Ft")
    if wl:
        out += box("KiNT · iDŐJÁRÁS", wl)

    # Bejárati ajtó, adatfrissesség
    ol = []
    opens = safe(lambda: _door_opens(sb, _day_start(today - timedelta(days=7))), None)
    if opens is not None:
        past = [opens.get(today - timedelta(days=k), 0) for k in range(1, 8)]
        ol.append(f"bejárati ajtó: ma {opens.get(today, 0)}, tegnap {past[0]}, átl {_f(sum(past) / 7)}")
    last = safe(lambda: sb.select("device_status", "ts", order="ts.desc", limit="1"), None)
    if last:
        lt = datetime.fromisoformat(str(last[0]["ts"]).replace("Z", "+00:00"))
        age = int((now - lt).total_seconds() // 60)
        ol.append(f"utolsó adat: {lt.astimezone(BUDAPEST):%H:%M} ({age} perce)" + ("  !! régi" if age > 90 else ""))
    if ol:
        out += box("MOZGÁS · ADAT", ol)

    # A Smart Life app előzménye: előző hónap napi átlaga a mostanihoz képest
    app = safe(lambda: sb.select("energy_app_history", "pink,period,period_start,kwh,exact",
                                 period="eq.month", order="period_start.asc"), None)
    if app:
        prev_m = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        al = []
        for pink, name, _lo, _hi, _m in CIRCUITS:
            pm = [r for r in app if r["pink"] == pink and str(r["period_start"])[:7] == prev_m.isoformat()[:7]]
            m = mtd.get(pink)
            if pm and m is not None:
                ndays = (today.replace(day=1) - prev_m).days
                elapsed = (now - month0).total_seconds() / 86400
                cur_avg, prev_avg = m / max(elapsed, 0.04), float(pm[0]["kwh"]) / ndays
                al.append(f"{name.capitalize().ljust(6)} {_f(cur_avg).rjust(5)} vs {_f(prev_avg).rjust(5)}  {_pct(cur_avg, prev_avg)}")
        if al:
            out += box("MOST vs ELŐZŐ HÓ · kWh/nap", al)

    # Év az évhez: tavaly ugyanekkor (B mérő a mérőállásokból, kint az Open-Meteo archívumból)
    if archive is None:
        from .weather import archive_daily as archive
    wnow = safe(lambda: {str(r["day"])[:10]: float(r["t_avg"]) for r in sb.select(
        "weather_daily", "day,t_avg", day=f"gte.{today.replace(day=1).isoformat()}") if r.get("t_avg") is not None}, {})
    try:                                                # az archívum kiesése (hálózat) ne akassza meg a levelet
        yoy = yoy_lines(hourly, today, archive, wnow)
    except Exception:
        yoy = None
    if yoy:
        out += box("YoY · TAVALY UGYANEKKOR", yoy)

    # Állandó emlékeztető (a tulaj kérése, CLAUDE.md 16.): vasárnaponként a további okos eszközökről
    if loc.weekday() == 6:
        out += box("OKOS ESZKÖZÖK · EMLÉKEZTETŐ", GADGETS)

    out += box("JELMAGYARÁZAT", LEGEND)
    return out, head


GADGETS = [
    "van még bekötendő kütyü? (heti memó)",
    "- 6 párosítatlan eszköz az F27 otthon-",
    "ban (Tuya, 11.08): mi ez? nézzük át!",
    "- robotporszívó: takarítás, távozás",
    "- konnektor: hűtő, mosógép, TV",
    "- mérőbilincs az A1 és B mérőre",
    "- gázmérő-leolvasó (a gáz nincs mérve)",
    "- CO- és füstérzékelő (gázkonvektor!)",
    "- vízszivárgás: mosógép, bojler",
    "- jelenlét, okos kulcsszéf, fürdőpanel",
    "bekötés: Smart Life, Ferenc krt. otthon",
    "utána Actions > Eszközfelderítés",
]


def hdd(t: float) -> float:
    """Fűtési hőfokhíd (Eurostat, mint a weather_daily nézetben): 18 - Tközép, ha Tközép <= 15 °C."""
    return 18 - t if t <= 15 else 0.0


def load_meters(path: Path = METERS) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["readings"]


def meter_rate(readings: list[dict], key: str, d0: date, d1: date):
    """A [d0, d1] napokat lefedő legszűkebb két valós mérőállás közti napi átlag: (kWh/nap, kezdet, vég)."""
    rs = sorted((date.fromisoformat(r["date"]), r[key]) for r in readings if r.get(key) is not None)
    best = None
    for i, (a, va) in enumerate(rs):
        if a > d0:
            break
        for b, vb in rs[i + 1:]:
            if b >= d1:
                if best is None or (b - a) < (best[2] - best[1]):
                    best = ((vb - va) / (b - a).days, a, b)
                break
    return best


def yoy_lines(hourly: dict, today: date, archive, wnow: dict, meters: list[dict] | None = None) -> list[str] | None:
    """Tavaly ugyanezekben a napokban vs idén. Idén: a hónap teljes, mért napjai (kályha + bojler = a
    B mérő); tavaly: a B mérő valós állásai közti napi átlag. A kinti hőmérséklet mindkét évre az
    Open-Meteo archívumból (tavaly) és a weather_daily nézetből (idén), így látszik, mennyi a
    különbségből az időjárás. archive(start, end) -> {'YYYY-MM-DD': °C}."""
    meters = meters if meters is not None else load_meters()
    days = []
    d = today.replace(day=1)
    while d < today:                                      # csak lezárt napok
        a = _day_start(d)
        b5 = hourly.get("X5", {})
        n = sum(1 for h in b5 if a <= h < a + timedelta(days=1))
        if n >= 20:
            v5 = _sum_kwh(b5, a, a + timedelta(days=1)) or 0
            v7 = _sum_kwh(hourly.get("X7", {}), a, a + timedelta(days=1)) or 0
            days.append((d, v5 + v7))
        d += timedelta(days=1)
    if not days:
        return None
    ly = [x.replace(year=x.year - 1) for x, _v in days]
    rate = meter_rate(meters, "B", ly[0], ly[-1])
    if not rate:
        return None
    b_ly, m0, m1 = rate
    temps = archive(min(m0, ly[0]).isoformat(), max(m1 - timedelta(days=1), ly[-1]).isoformat())
    b_now = sum(v for _d, v in days) / len(days)
    span = f"{days[0][0]:%m.%d}-{days[-1][0]:%m.%d}"
    lines = [f"napok     {span} ({len(days)} nap)",
             f"B idén    {_f(b_now).rjust(5)} kWh/nap (mért)",
             f"B tavaly  {_f(b_ly).rjust(5)} kWh/nap*",
             f"YoY       {_pct(b_now, b_ly)}  (kályha + bojler)"]
    t_now = [wnow[x.isoformat()] for x, _v in days if x.isoformat() in wnow]
    t_ly = [temps[x.isoformat()] for x in ly if x.isoformat() in temps]
    if t_now and t_ly:
        an, al = sum(t_now) / len(t_now), sum(t_ly) / len(t_ly)
        lines.append(f"kint      {_f(an)} vs {_f(al)} °C (idén/tavaly)")
        hn = sum(hdd(t) for t in t_now) / len(t_now)
        # tavaly: a mérőállás-időszak átlagos hőfokhídja (a B átlag is arra az időszakra szól)
        per = [temps[(m0 + timedelta(days=k)).isoformat()] for k in range((m1 - m0).days)
               if (m0 + timedelta(days=k)).isoformat() in temps]
        hl = sum(hdd(t) for t in per) / len(per) if per else None
        if hn >= 1 and hl and hl >= 1:
            kn, kl = b_now / hn, b_ly / hl
            lines.append(f"kWh/fok   {_f(kn, 2)} vs {_f(kl, 2)}  {_pct(kn, kl)}")
            lines.append("          (időjárással kiigazítva)")
    lines.append(f"* mérőállás {m0:%Y.%m.%d}-{m1:%m.%d} átlag")
    return lines


def subject_line(now: datetime, head: dict, alerts: int = 0) -> str:
    """Rövid, warez-hangulatú tárgysor (iPhone-on kb. 60 karakter fér ki):
    ▓▒░ F27·NRG ░▒▓ 11.13 P » 26,4 kWh » ~1 620 Ft » ▼8% DoD"""
    loc = now.astimezone(BUDAPEST)
    parts = [f"▓▒░ F27·NRG ░▒▓ {loc:%m.%d} {DAYS[loc.weekday()]}"]
    kwh, ky = head.get("kwh"), head.get("kwh_y")
    if kwh:
        parts.append(f"{_f(kwh)} kWh")
        if head.get("ft"):
            parts.append(f"~{_ft(head['ft'])} Ft")
        if ky and ky >= 0.05:
            p = (kwh - ky) / ky * 100
            parts.append(("▲" if p >= 0 else "▼") + f"{abs(p):.0f}% DoD")
    else:
        parts.append("napi jelentés")
    # aktív riasztás: már a postafiókban látsszon (a tulaj kérése, 2026.11.14)
    return ("⚠ " + (f"{alerts} riasztás · " if alerts > 1 else "RIASZTÁS · ") if alerts else "") + " » ".join(parts)


LEGEND = [
    "*    ugyanaddig az óráig, mint most",
    "DoD  nap a naphoz: ma vs tegnap*",
    "vs   ma vs 7 napos átlag*",
    "0h|..|23h  órás sor ' .:-=+*#%@'",
    "     a nap csúcsáig; üres = még hátra",
    "B,A1 mérő; B-keret: havi kedv. kWh",
    "Ft   B 60,9; A1 36,2-70,1 közepe",
    "kWh/fok  kályha kWh fűtési fokonként",
    "YoY  év az évhez: tavaly ugyanezek a",
    "     napok; tavaly = B mérőállás-átlag",
]


def to_html(text: str, url: str) -> str:
    """A szöveges levél "terminál" HTML-ben: fix szélességű betű, zöld a feketén; a hosszú
    szöveges sorok tördelődnek (pre-wrap), a dobozok W karakteresek, így telefonon sem esnek szét.
    Felül és alul kattintható gomb a dashboardra."""
    btn = ('<a href="' + html.escape(url) + '" style="display:inline-block;margin:6px 0;padding:10px 16px;'
           'border:2px solid #39ff14;border-radius:6px;color:#0b0f0b;background:#39ff14;text-decoration:none;'
           'font-family:Menlo,Consolas,\'Courier New\',monospace;font-weight:bold;font-size:14px">'
           '&gt;&gt; DASHBOARD MEGNYITÁSA &lt;&lt;</a>')
    return ('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
            '<body style="margin:0;background:#0b0f0b;-webkit-text-size-adjust:100%;text-size-adjust:100%"><div style="background:#0b0f0b;padding:10px 8px">'
            + btn +
            '<pre style="margin:6px 0;font-family:Menlo,Consolas,\'Courier New\',monospace;font-size:13px;'
            'line-height:1.3;color:#39ff14;background:#0b0f0b;white-space:pre-wrap;word-break:break-word">'
            + html.escape(text) + "</pre>" + btn + "</div></body></html>")
