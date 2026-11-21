"""Az O2B esti levele (a F27-es levél mintájára, a tulaj választása szerint, 2026.11.15).

A küldés, az időzítés és a napló közös (f27.digest.run_digest); itt csak a tartalom készül.
Minden rész külön olvas, ami hiányzik, az "nincs adat", a levél ettől még kimegy.

1. kör: tárgysor, NFO-fejléc, TL;DR (költség, pazarlás, ára, teendő, megtakarítás), mai riasztások,
   teendők, ELEMCSERE, HOLNAP (időjárás, nap, ütemezett kapcsolások), KONNEKTOROK · MA, órás sor,
   HŐMÉRŐK és KOMFORT (a 22/20 °C-os célhoz), KINT, BOJLER, ÉRZÉKELŐK MOST, vasárnap OKOS ESZKÖZÖK
   és JELMAGYARÁZAT.
2. kör: SZÁMLA-ŐR (valós mérőállások), YoY (tavaly ugyanekkor, időjárással kiigazítva), ROBOTOK,
   KAPCSOLÁSOK, JELENLÉT, PAMUTKA MONDJA.

Személyes adat (utcanév, családnév, cím) nem kerül a levélbe; a gáz nincs mérve, ezért a gázköltség
a valós mérőállásokból és a hőfokhídból becsült (ezt a levél ki is mondja).
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from .report_stats import W, _f, _ft, _pct, box, hdd, kv, meter_rate, notes, stripe
from .site import SITE
from . import boiler

TZ = SITE.tz
ROOT = Path(__file__).resolve().parent.parent
METERS = ROOT / "sites" / "o2b" / "meter_readings.json"
DAYS = ("H", "K", "Sze", "Cs", "P", "Szo", "V")
MONTHS = ("jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec.")
GAS_BASE_M3 = 0.26            # nyári alap: meleg víz lent + főzés (m³/nap, a mérőállásokból)
HEAT_PER_C = 0.06             # 1 °C-kal melegebb lakás kb. 6 %-kal több fűtési gáz
NIGHT = (22, 6)               # éjszaka (komfortcél: heat_night_c)
HOT_DEV, COLD_DEV = 1.0, -1.5 # a napszak céljához képesti átlagos eltérés (°C), ami már szóra érdemes
WASTE_MIN_FT = 30             # ennél kisebb napi tétel nem "pazarlás" a TL;DR-ben
BOILER_SAVE = 0.25            # a hőtartásból kb. ennyi spórolható (termosztát 55-60 °C, szigetelő köpeny)

LOGO = [
    "  ░▒▓███████▓  ▄███████▄  ▓████████▄",
    "  ░▒▓██▀▀▀▓██  ▀▀▀▀▀▀▀██  ▓██▀▀▀▀▀██",
    "  ░▒▓██   ▓██     ▄▄▄██▀  ▓████████▀",
    "  ░▒▓██   ▓██  ▄██▀▀▀     ▓██▀▀▀▀▀██",
    "  ░▒▓███████▓  █████████▓ ▓████████▀",
    "     ▀▀▀▀▀▀▀   ▀▀▀▀▀▀▀▀▀▀  ▀▀▀▀▀▀▀▀▀",
]
CAT = [" /\\_/\\ ", "( o.o )", " > ^ < "]
GREETZ = ["Pamutka", "Savio", "Computherm", "Gree", "Roborock", "Dreame", "Gorenje", "haozee", "Gellért-hegy"]
GADGETS = [
    "van még bekötendő kütyü? (heti memó)",
    "- Computherm termosztát: nincs API, a",
    "  kazán be/ki állapota nem látszik",
    "- okos radiátorfejek (Zigbee TRV) +",
    "  Zigbee gateway: szobánkénti fűtés",
    "- gázmérő-leolvasó (impulzus/kamera)",
    "- CO-érzékelő a kazán mellé (fürdő)",
    "- mérő konnektor: mosógép, hűtő, TV",
    "- vízszivárgás: mosógép, bojler",
    "bekötés: a Smart Life-ban a saját otthonba,",
    "utána Actions > Eszközfelderítés (O2B)",
]
LEGEND = [
    "DoD  nap a naphoz: ma vs tegnap ugyan-",
    "     addig az óráig",
    "fokóra  a cél fölötti fokok × órák",
    "cél  nappal 22 °C, éjjel (22-6) 20 °C",
    "gáz  becslés: valós mérőállások +",
    "     hőfokhíd (a gáz nincs mérve)",
    "Ft   villany A1 70,1; gáz ~99 Ft/m³",
    "YoY  tavaly ugyanezek a napok, a",
    "     mérőállások napi átlagából",
]


# ----------------------------------------------------------------------------- segédek
def _day0(d: date) -> datetime:
    return datetime.combine(d, time(0, 0), TZ).astimezone(timezone.utc)


def _ts(s) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)


def _sum(series: dict, a: datetime, b: datetime, key: str = "kwh") -> float | None:
    v = [float(r[key]) for h, r in series.items() if a <= h < b and r.get(key) is not None]
    return round(sum(v), 3) if v else None


def gas_price() -> float:
    g = (json.loads((ROOT / "sites" / "o2b" / "site.json").read_text(encoding="utf-8")).get("tariff") or {}).get("gas") or {}
    return float(g.get("ft_per_mj", 2.87)) * float(g.get("mj_per_m3", 34.5))


def el_price() -> float:
    return SITE.price("A1") or 70.1


def short(label: str) -> str:
    """'Dupla lámpa (étkező, a tükörnél)' -> 'dupla lámpa'; 'Emeleti bojler (meleg víz)' -> 'bojler'."""
    s = label.split(" (")[0].replace("Emeleti ", "").replace(", fények", "").replace(", étkező", "")
    return s.lower()[:11]


def sun_times(d: date, lat: float, lon: float) -> tuple[datetime | None, datetime | None]:
    """Napkelte, napnyugta (NOAA közelítés, percre elég)."""
    n = d.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1)
    eq = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
           + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    la = math.radians(lat)
    c = (math.cos(math.radians(90.833)) / (math.cos(la) * math.cos(dec))) - math.tan(la) * math.tan(dec)
    if abs(c) > 1:
        return None, None
    ha = math.degrees(math.acos(c))
    base = datetime.combine(d, time(0, 0), timezone.utc)
    rise = base + timedelta(minutes=720 - 4 * (lon + ha) - eq)
    sset = base + timedelta(minutes=720 - 4 * (lon - ha) - eq)
    return rise.astimezone(TZ), sset.astimezone(TZ)


def rule_minute(r: dict, d: date) -> int | None:
    if r.get("kind") == "time":
        return int(r.get("minute") or 0)
    rise, sset = sun_times(d, SITE.lat, SITE.lon)
    t = sset if r.get("kind") == "sunset" else rise
    if t is None:
        return None
    return t.hour * 60 + t.minute + int(r.get("minute") or 0)


def load_meters(path: Path = METERS) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def real_points(readings: list[dict], key: str) -> list[tuple[date, float]]:
    """Csak a valós pontok (Leol, Dikt, Ell, Foto, kezdő; az ellentmondásmentes elszámolt is)."""
    ok = ("Leol", "Dikt", "Ell", "Foto", "kezdő", "elszámolt")
    return sorted((date.fromisoformat(r["date"]), float(r[key])) for r in readings if r.get(key) is not None and r.get("mode") in ok)


# ----------------------------------------------------------------------------- adatok
class Data:
    """Minden olvasás egy helyen; a hiányzó tábla vagy hiba üres eredmény (safe)."""

    def __init__(self, sb, now: datetime, safe):
        self.now, self.loc = now, now.astimezone(TZ)
        self.today = self.loc.date()
        self.t0 = _day0(self.today)
        self.cut = now - self.t0
        s = lambda fn, d=None: safe(fn, d)
        self.devs = s(lambda: sb.select("devices", "pink,role,room,label,meta"), None) or s(lambda: sb.select("devices", "pink,role,room,label"), []) or []
        self.latest = {r["pink"]: r for r in s(lambda: sb.select("device_latest", "pink,ts,online,status"), []) or []}
        self.by = {d["pink"]: d for d in self.devs}
        self.plugs = sorted(p for p, d in self.by.items() if d.get("role") == "plug")
        self.thermos = [(t["pink"], t["name"]) for t in SITE.thermometers]
        pinks = self.plugs + [p for p, _n in self.thermos]
        self.hourly = s(lambda: self._hourly(sb, _day0(self.today - timedelta(days=31)), pinks), None)
        self.logs = s(lambda: sb.select("alert_log", "ts,rule_key,kind,text,channels", ts=f"gte.{self.t0.isoformat()}", order="ts.asc", limit="200"), None)
        self.alerts = [r for r in s(lambda: sb.select("alert_state", "rule_key,active,last_text"), []) or [] if r.get("active")]
        self.bat = s(lambda: sb.select("battery_status", "*"), []) or []
        self.wx = {str(r["day"])[:10]: r for r in s(lambda: sb.select("weather_daily", "day,t_avg,hdd", day=f"gte.{(self.today - timedelta(days=8)).isoformat()}"), []) or []}
        self.fc = s(lambda: sb.select("weather_hourly", "ts,temp", ts=f"gte.{_day0(self.today + timedelta(days=1)).isoformat()}",
                                      order="ts.asc", limit="48"), []) or []
        self.rules = s(lambda: sb.select("control_rules", "pink,action,kind,minute,days,enabled"), []) or []
        self.timers = s(lambda: sb.select("control_timers", "pink,action,due_at"), []) or []
        self.ctl_log = s(lambda: sb.select("control_log", "ts,pink,action,source,ok", ts=f"gte.{self.t0.isoformat()}", order="ts.asc", limit="200"), []) or []
        self.motion = s(lambda: sb.select("device_status", "ts,status", pink="eq.M1", ts=f"gte.{self.t0.isoformat()}", order="ts.asc", limit="2000"), []) or []
        self.robots = s(lambda: sb.select("device_status", "ts,pink,status", pink="in.(R1,R2)", ts=f"gte.{self.t0.isoformat()}",
                                          order="ts.asc", limit="1000"), []) or []
        self.boil = s(lambda: boiler.analyze(boiler.fetch(sb, "C1", now), now, el_price()), None)
        self.meters = load_meters()

    @staticmethod
    def _hourly(sb, since: datetime, pinks: list[str]) -> dict:
        out: dict = {}
        for page in range(20):
            rows = sb.select("metrics_hourly", "pink,hour,kwh,w_max,temp_avg,temp_min,temp_max", pink=f"in.({','.join(pinks)})",
                             hour=f"gte.{since.isoformat()}", order="hour.asc", limit="1000", offset=str(page * 1000))
            for r in rows:
                out.setdefault(r["pink"], {})[_ts(r["hour"])] = r
            if len(rows) < 1000:
                break
        return out

    def label(self, pink: str) -> str:
        d = self.by.get(pink) or {}
        return d.get("label") or pink

    def online(self, pink: str) -> bool:
        r = self.latest.get(pink)
        return bool(r) and r.get("online") is not False

    def temp_now(self, pink: str) -> float | None:
        r = self.latest.get(pink)
        if not r or r.get("online") is False:
            return None
        st = r.get("status") or {}
        for code in ("va_temperature", "temp_current"):
            if st.get(code) is not None:
                try:
                    return float(st[code]) / 10
                except (TypeError, ValueError):
                    return None
        return None


# ----------------------------------------------------------------------------- számolások
def target(h: int) -> float:
    c = SITE.comfort or {}
    night = h >= NIGHT[0] or h < NIGHT[1]
    return float(c.get("heat_night_c" if night else "heat_day_c", 20 if night else 22))


def comfort(D: Data) -> dict:
    """Szobánként: mai átlag, a cél fölötti fokóra, a legmelegebb; a lakás átlagos túlfűtése."""
    rows, over_all, n_all = [], 0.0, 0
    if D.hourly is None:
        return {"rows": [], "excess": None}
    for pink, name in D.thermos:
        if "kint" in name.lower() or "erkély" in name.lower():
            continue
        s = D.hourly.get(pink, {})
        hrs = [(h, r) for h, r in s.items() if h >= D.t0 and r.get("temp_avg") is not None]
        if not hrs:
            rows.append({"pink": pink, "name": name, "avg": None, "deg_h": None, "max": None, "dev": None})
            continue
        dh, dev = 0.0, 0.0
        for h, r in hrs:
            ex = float(r["temp_avg"]) - target(h.astimezone(TZ).hour)   # óránként a SAJÁT célhoz (nappal 22, éjjel 20)
            dh += max(0.0, ex)
            dev += ex
            over_all += ex
            n_all += 1
        avg = sum(float(r["temp_avg"]) for _h, r in hrs) / len(hrs)
        mx = max((float(r["temp_max"]) for _h, r in hrs if r.get("temp_max") is not None), default=None)
        rows.append({"pink": pink, "name": name, "avg": avg, "deg_h": dh, "max": mx, "dev": dev / len(hrs)})
    return {"rows": rows, "excess": (over_all / n_all) if n_all else None}


def gas_model(D: Data, archive=None) -> dict:
    """Fűtési gáz m³/hőfokhíd a két utolsó valós mérőállásból (Open-Meteo archív hőmérséklettel);
    ha az archívum nem elérhető, a mérőállások napi átlaga. A gáz nincs mérve: ez becslés."""
    pts = real_points((D.meters.get("gas") or {}).get("readings") or [], "m3")
    out = {"rate": None, "k": None, "span": None}
    if len(pts) < 2:
        return out
    (a, va), (b, vb) = pts[-2], pts[-1]
    out["rate"], out["span"] = (vb - va) / max(1, (b - a).days), (a, b)
    try:
        if archive is None:
            from .weather import archive_daily as archive
        temps = archive(a.isoformat(), (b - timedelta(days=1)).isoformat())
        h = sum(hdd(t) for t in temps.values())
        heat = (vb - va) - GAS_BASE_M3 * (b - a).days
        if h >= 20 and heat > 0:
            out["k"] = heat / h
    except Exception:                                   # noqa: BLE001 (hálózat: marad a napi átlag)
        pass
    return out


def gas_today(D: Data, gm: dict) -> float | None:
    w = D.wx.get(D.today.isoformat())
    if gm.get("k") and w and w.get("hdd") is not None:
        return GAS_BASE_M3 + gm["k"] * float(w["hdd"])
    return gm.get("rate")


def plugs_today(D: Data) -> dict:
    """A mért konnektorok: ma eddig, tegnap ugyanaddig, hónap; összesen és Ft."""
    res = {"rows": [], "kwh": None, "kwh_y": None, "mtd": None, "per_day7": None}
    if D.hourly is None:
        return res
    tk = ty = tm = 0.0
    any_t = any_y = any_m = False
    m0 = _day0(D.today.replace(day=1))
    for p in D.plugs:
        s = D.hourly.get(p, {})
        td, yd = _sum(s, D.t0, D.now), _sum(s, D.t0 - timedelta(days=1), D.t0 - timedelta(days=1) + D.cut)
        m = _sum(s, m0, D.now)
        if td is None and m is None:
            continue
        res["rows"].append((p, short(D.label(p)), td, yd, m))
        if td is not None:
            tk += td; any_t = True
        if yd is not None:
            ty += yd; any_y = True
        if m is not None:
            tm += m; any_m = True
    full = []
    for k in range(1, 8):
        a = _day0(D.today - timedelta(days=k))
        v = [_sum(D.hourly.get(p, {}), a, a + timedelta(days=1)) for p in D.plugs]
        if any(x is not None for x in v):
            full.append(sum(x or 0 for x in v))
    res.update(kwh=tk if any_t else None, kwh_y=ty if any_y else None, mtd=tm if any_m else None,
               per_day7=(sum(full) / len(full)) if full else None)
    return res


def spark_power(D: Data) -> str | None:
    """24 karakteres órás sor a konnektorok összesített kWh-jából (ma)."""
    if D.hourly is None:
        return None
    hours = [0.0] * 24
    seen = False
    for p in D.plugs:
        for h, r in D.hourly.get(p, {}).items():
            if h >= D.t0 and r.get("kwh") is not None:
                hours[h.astimezone(TZ).hour] += float(r["kwh"])
                seen = True
    if not seen:
        return None
    top = max(max(hours), 0.05)
    chars = " ░▒▓█"
    return "".join(chars[min(4, int(v / top * 4 + 0.999))] if v > 0.005 else "·" for v in hours)


def presence(D: Data) -> dict:
    t = sorted(_ts(r["ts"]).astimezone(TZ) for r in D.motion if (r.get("status") or {}).get("pir") == "pir")
    return {"n": len(t), "first": t[0] if t else None, "last": t[-1] if t else None, "hours": len({x.hour for x in t})}


def robots_today(D: Data) -> list[dict]:
    out = []
    for p, name in (("R1", "lent (Dreame)"), ("R2", "fent (Roborock)")):
        rows = [r for r in D.robots if r["pink"] == p]
        last = (D.latest.get(p) or {}).get("status") or (rows[-1]["status"] if rows else None)
        if last is None and not rows:
            out.append({"pink": p, "name": name, "none": True})
            continue
        cleaned = [r["status"] for r in rows if (r.get("status") or {}).get("cleaning")]
        area = max((float(s.get("area_m2") or 0) for s in cleaned), default=0.0)
        mins = max((int(s.get("minutes") or 0) for s in cleaned), default=0)
        out.append({"pink": p, "name": name, "none": False, "cleaned": bool(cleaned), "area": area, "minutes": mins,
                    "battery": (last or {}).get("battery"), "state": (last or {}).get("state"), "error": (last or {}).get("error")})
    return out


ROBOT_STATE = {"cleaning": "takarít", "returning": "hazamegy", "charging": "töltődik", "charged": "dokkban, feltöltve",
               "docked": "dokkban", "paused": "szünetel", "idle": "áll", "error": "HIBA", "offline": "offline"}


def tomorrow_switches(D: Data) -> list[str]:
    d = D.today + timedelta(days=1)
    bit = 1 << d.weekday()
    ev = []
    for r in D.rules:
        if r.get("enabled") is False or not (int(r.get("days") or 0) & bit):
            continue
        m = rule_minute(r, d)
        if m is not None:
            ev.append((m, r["pink"], r["action"], "ütemezés"))
    d0, d1 = _day0(d), _day0(d + timedelta(days=1))
    for t in D.timers:
        at = _ts(t["due_at"])
        if d0 <= at < d1:
            lt = at.astimezone(TZ)
            ev.append((lt.hour * 60 + lt.minute, t["pink"], t["action"], "egyszeri"))
    ev.sort()
    return [f"{m // 60:02d}:{m % 60:02d} {short(D.label(p))} {'BE' if a == 'on' else 'KI'} ({why})" for m, p, a, why in ev]


def meter_box(D: Data) -> list[str] | None:
    """SZÁMLA-ŐR: a valós mérőállások napi átlaga, a várható havi költség, tavaly ugyanekkor."""
    el = real_points((D.meters.get("electricity") or {}).get("readings") or [], "kwh")
    gs = real_points((D.meters.get("gas") or {}).get("readings") or [], "m3")
    if len(el) < 2 and len(gs) < 2:
        return None
    lines = []
    for title, pts, unit, price, key, raw in (("villany", el, "kWh", el_price(), "kwh", (D.meters.get("electricity") or {}).get("readings") or []),
                                             ("gáz", gs, "m³", gas_price(), "m3", (D.meters.get("gas") or {}).get("readings") or [])):
        if len(pts) < 2:
            continue
        (a, va), (b, vb) = pts[-2], pts[-1]
        rate = (vb - va) / max(1, (b - a).days)
        lines.append(f"{title}: utolsó valós {b:%m.%d} ({_f(vb, 0 if unit == 'kWh' else 1)} {unit})")
        lines.append(f"  {a:%m.%d} óta {_f(rate)} {unit}/nap")
        lines.append(f"  hó ~{_f(rate * 30.4, 0)} {unit}, ~{_ft(rate * 30.4 * price)} Ft")
        ly = meter_rate(raw, key, a.replace(year=a.year - 1), b.replace(year=b.year - 1))
        if ly:
            lines.append(f"  tavaly ugyanekkor {_f(ly[0])} {unit}/nap ({_pct(rate, ly[0])})")
        age = (D.today - b).days
        if age > 30:
            lines.append(f"  !! {age} napja nincs valós állás: fotózd le")
    for c in D.meters.get("bill_checks") or []:
        diff = c.get("diff")
        if diff:
            lines.append(f"{c.get('date', '')[5:].replace('-', '.')}. részszámla: {'+' if diff > 0 else ''}{_f(diff, 0)} "
                         f"{c.get('unit', 'kWh')} ({'túl' if diff > 0 else 'alá'}becsült)")
    return lines


def pamutka(D: Data, cf: dict, todo: list[str]) -> list[str]:
    """1-2 sor macskahangon, a legfontosabb tényből."""
    say = []
    hot = [r for r in cf["rows"] if r["dev"] is not None and r["dev"] > HOT_DEV]
    cold = [r for r in cf["rows"] if r["dev"] is not None and r["dev"] < COLD_DEV]
    if hot:
        r = max(hot, key=lambda x: x["dev"])
        say.append(f"Miaú! {r['name']}: átlag {_f(r['avg'])} °C, a napszak céljánál {_f(r['dev'])} fokkal melegebb. Tekerd lejjebb a radiátort, nekem így is jó.")
    if cold:
        r = min(cold, key=lambda x: x["dev"])
        say.append(f"Brr, fázom! {r['name']}: csak {_f(r['avg'])} °C. Nézd meg, nem ragadt-e be a radiátorfej.")
    if D.boil and D.boil.get("night_use"):
        say.append("Éjjel is melegedett a bojler. Csöpög valahol egy csap? Megnézném, de nem érem el.")
    if not say:
        say.append("Purr. Minden rendben, a meleg ott van, ahol kell. Megyek szundítani a napra.")
    return say[:2]


# ----------------------------------------------------------------------------- levél
def banner(D: Data, kwh, ft, bent) -> list[str]:
    half = (W - 3) // 2
    left = [" " + kv("Dátum", f"{D.loc:%m.%d} {DAYS[D.loc.weekday()]}", 7), " " + kv("Idő", f"{D.loc:%H:%M}", 7),
            " " + kv("Bent", f"{_f(bent)} °C" if bent is not None else "--", 7)]
    right = [" " + kv("Villany", f"{_f(kwh)} kWh", 8), " " + kv("Költség", f"~{_ft(ft)} Ft", 8),
             " " + kv("Cél", f"{_f(target(D.loc.hour), 0)} °C", 8)]
    lines = [" ▄" + "▄" * (W - 3), *LOGO, " " + "▀" * (W - 2), " ▓▒░ O · 2 · B · E · N · E · R · G · Y ░▒▓",
             "p r e s e n t s".center(W).rstrip(), "",
             "╔" + "═" * (W - 2) + "╗",
             "║" + f"{SITE.brand} CREW proudly presents:".center(W - 2) + "║",
             "║" + f'"Napi jelentés" {D.loc:%Y.%m.%d}'.center(W - 2) + "║",
             "║" + "(p) 2026, csak olvas, magától nem kapcsol".center(W - 2)[:W - 2] + "║",
             "╠" + "═" * half + "╤" + "═" * (W - 3 - half) + "╣"]
    for a, b in zip(left, right):
        lines.append("║" + a[:half].ljust(half) + "│" + b[:W - 3 - half].ljust(W - 3 - half) + "║")
    lines.append("╚" + "═" * half + "╧" + "═" * (W - 3 - half) + "╝")
    return lines


def footer() -> list[str]:
    rows, row = [], ""
    for name in GREETZ:
        if len(row) + len(name) + 3 > W - 4:
            rows.append(row); row = ""
        row = (row + " · " if row else "") + name
    rows.append(row)
    blk = [a.ljust(9) + "  " + b for a, b in zip(CAT, [SITE.brand, f"Since {SITE.since}", "Pamutka approves"])]
    pad = " " * ((W - max(len(x) for x in blk)) // 2)
    return ["", f"<-- {SITE.brand} CREW greetz -->".center(W).rstrip(), ""] + [r.center(W).rstrip() for r in rows] + [
        "", *[(pad + x).rstrip() for x in blk], "",
        "  ▄▄▄" + "▀" * (W - 10) + "▄▄▄", " █" + "▒ O · 2 · B ▒".center(W - 4) + "█", "  ▀▀▀" + "▄" * (W - 10) + "▀▀▀",
        "", "PURR LESS GAS. SPEND LESS kWh!".center(W).rstrip()]


def subject(D: Data, kwh, ft, bent, alerts: int) -> str:
    parts = [f"▓▒░ O2B·NRG ░▒▓ {D.loc:%m.%d} {DAYS[D.loc.weekday()]}"]
    if kwh:
        parts.append(f"{_f(kwh)} kWh")
    if ft:
        parts.append(f"~{_ft(ft)} Ft")
    if bent is not None:
        parts.append(f"BENT {_f(bent)}° (cél {_f(target(D.loc.hour), 0)})")
    if len(parts) == 1:
        parts.append("napi jelentés")
    return ("⚠ " + (f"{alerts} riasztás · " if alerts > 1 else "RIASZTÁS · ") if alerts else "") + " » ".join(parts)


def build(sb, cfg: dict, now: datetime, safe, alert_items, archive=None) -> dict:
    D = Data(sb, now, safe)
    gp, ep = gas_price(), el_price()
    cf = comfort(D)
    gm = gas_model(D, archive)
    g_today = gas_today(D, gm)
    pl = plugs_today(D)
    temps_now = [t for t in (D.temp_now(p) for p, n in D.thermos if "kint" not in n.lower() and "erkély" not in n.lower()) if t is not None]
    bent = sum(temps_now) / len(temps_now) if temps_now else None
    el_ft = (pl["kwh"] or 0) * ep if pl["kwh"] is not None else None
    gas_ft = g_today * gp * min(1.0, D.cut.total_seconds() / 86400) if g_today else None
    ft = (el_ft or 0) + (gas_ft or 0) if (el_ft is not None or gas_ft is not None) else None

    # ---- teendők
    todo: list[str] = [f"Aktív riasztás: {r.get('last_text') or r.get('rule_key')}" for r in D.alerts]
    # rövid változat a TL;DR-hez (a hosszú mondat oda levágva értelmetlen lenne)
    tl_todo: list[str] = [f"riasztás: {(r.get('last_text') or r.get('rule_key'))}" for r in D.alerts]
    hot = sorted((r for r in cf["rows"] if r["dev"] is not None and r["dev"] > HOT_DEV), key=lambda r: -r["dev"])
    if hot:
        todo.append(f"Túlfűtött (a napszak céljához képest átlag +{_f(hot[0]['dev'])} °C): {', '.join(r['name'] for r in hot[:3])}: "
                    f"tekerd lejjebb a radiátorfejet (cél nappal {_f(target(14), 0)}, éjjel {_f(target(2), 0)} °C).")
        tl_todo.append(f"radiátor lejjebb: {hot[0]['name']}")
    cold = sorted((r for r in cf["rows"] if r["dev"] is not None and r["dev"] < COLD_DEV), key=lambda r: r["dev"])
    if cold:
        todo.append(f"Hideg (a napszak céljához képest átlag {_f(cold[0]['dev'])} °C): {', '.join(r['name'] for r in cold[:3])}: "
                    "nyitva a radiátorfej? Ha igen, beragadhatott (kézzel nyit-zár-nyit).")
        tl_todo.append(f"hideg: {cold[0]['name']} (radiátor?)")
    t2 = next((r for r in cf["rows"] if r["pink"] == "T2"), None)
    others = [r["avg"] for r in cf["rows"] if r["avg"] is not None and r["pink"] != "T2"]
    if t2 and t2["avg"] is not None and others and sum(others) / len(others) > t2["avg"] + 0.8:
        todo.append("Az étkezőben mér a termosztát, de ott a radiátor 0-n áll: a többi szoba melegebb. "
                    "Nyisd meg kicsit az étkező radiátorát, vagy vedd lejjebb a termosztátot.")
    off = [D.label(p) for p in D.by if D.by[p].get("role") in ("thermo", "plug", "pir") and p in D.latest and not D.online(p)
           and p not in ("C6", "C7", "C8")]                   # a karácsonyi dekor szezonon kívül offline, ez nem hír
    if off:
        todo.append("Nem elérhető: " + ", ".join(off[:4]) + (f" (+{len(off) - 4})" if len(off) > 4 else ""))
    if D.boil and D.boil.get("night_use"):
        todo.append("A bojler éjjel is fűtött: csöpög egy csap a felső fürdőben?")
    rob = robots_today(D)
    for r in rob:
        if not r["none"] and r.get("error"):
            todo.append(f"Robot {r['name']}: hiba ({r['error']})")
    el_pts = real_points((D.meters.get("electricity") or {}).get("readings") or [], "kwh")
    if el_pts and (D.today - el_pts[-1][0]).days > 30:
        todo.append("Több mint 30 napja nincs valós villanyóra-állás: fotózd le a mérőket (villany, gáz).")

    # ---- TL;DR
    V = W - 15
    cut = lambda v: v if len(v) <= V else v[:V - 1] + "."
    # a pazarlás csak akkor "tétel", ha legalább WASTE_MIN_FT forint naponta; különben "nincs nagy tétel"
    waste, price, save = "nincs nagy tétel", "--", "--"
    heat_ft_day = (g_today - GAS_BASE_M3) * gp if g_today and g_today > GAS_BASE_M3 else None
    over_day = heat_ft_day * HEAT_PER_C * cf["excess"] if heat_ft_day and cf["excess"] is not None and cf["excess"] > 0.5 else 0
    idle_ft = (D.boil or {}).get("idle_day_ft") or 0
    if over_day >= WASTE_MIN_FT and over_day >= idle_ft * BOILER_SAVE:
        waste = f"túlfűtés, átl. +{_f(cf['excess'])} °C"
        price, save = f"~{_ft(over_day)} Ft/nap", f"~{_ft(over_day * 30)} Ft/hó (a célra)"
    elif idle_ft * BOILER_SAVE >= WASTE_MIN_FT:
        waste = f"bojler hőtartás {_f(D.boil['idle'])} kWh/nap"
        price = f"~{_ft(idle_ft)} Ft/nap"
        save = f"~{_ft(idle_ft * BOILER_SAVE * 30)} Ft/hó (55 °C)"
    cost = (f"~{_ft(ft)} Ft ma" + (" (gázzal, becsl.)" if gas_ft else "")) if ft else "nincs adat"
    tldr = ["TL;DR ▒ ▒▒ ▓▓ ▓▓▓▓ " + "█" * (W - 20),
            " " + kv("Költség", cut(cost), 12),
            " " + kv("Pazarlás", cut(waste), 12), " " + kv("Ára", cut(price), 12),
            " " + kv("Teendő", cut(tl_todo[0] if tl_todo else (todo[0] if todo else "nincs")), 12), " " + kv("Megtakarít", cut(save), 12)]

    out: list[str] = []
    # ---- riasztások, teendők
    out += stripe("RELEASE NOTES") + [""] + notes("Riasztások ma")
    if D.logs is None:
        out.append("- nincs adat (alert_log)")
    else:
        items = alert_items(D.logs, now)
        out += ["- Nem volt riasztás."] if not items else []
        for n, it in enumerate(items, 1):
            out += [f"{n}. {it['span']} {it['what']}", f"   {it['detail']}"]
        out.append(f"Összesen: {len(items)} · aktív most: {len(D.alerts)}")
    out += [""] + notes("Teendők") + ([f"{i}. {t}" for i, t in enumerate(todo, 1)] if todo else ["- Nincs teendő."])
    from .battery import digest_lines as battery_lines
    bl = battery_lines(D.bat, D.today)
    if bl:
        out += [""] + box("ELEMCSERE", bl + ["!! = 2 héten belül vagy lemerült"])

    # ---- holnap
    tom = D.today + timedelta(days=1)
    rise, sset = sun_times(tom, SITE.lat, SITE.lon)
    hl = []
    ft_t = [float(r["temp"]) for r in D.fc if r.get("temp") is not None and _ts(r["ts"]) < _day0(tom + timedelta(days=1))]
    if len(ft_t) >= 12:
        hl.append(f"- Kint: {_f(min(ft_t))} / {_f(max(ft_t))} °C (min/max)")
        if gm.get("k"):
            g = GAS_BASE_M3 + gm["k"] * hdd(sum(ft_t) / len(ft_t))
            hl.append(f"- Gáz várhatóan ~{_f(g)} m³, ~{_ft(g * gp)} Ft (becslés)")
    if rise and sset:
        hl.append(f"- Napkelte {rise:%H:%M}, napnyugta {sset:%H:%M}")
    sw = tomorrow_switches(D)
    hl += [f"- {x}" for x in sw[:8]] if sw else ["- Nincs ütemezett kapcsolás."]
    out += [""] + notes(f"Holnap ({MONTHS[tom.month - 1]} {tom.day}.)") + hl

    # ---- statisztika
    out += [""] + stripe("STATISZTIKA") + ["(a Tuya-naplóból; a gáz becslés)"]
    if D.hourly is None:
        out += box("STATISZTIKA", ["nincs adat (metrics_hourly)"])
    else:
        rows = [f"{'konnektor':<11}{'ma kWh':>6} {'DoD':>6} {'hónap Ft':>9}  "]
        for p, nm, td, yd, m in pl["rows"]:
            rows.append(f"{nm:<11}{_f(td):>6} {_pct(td, yd).replace(' ', ''):>6} {('~' + _ft(m * ep)) if m is not None else '--':>9} ›")
        rows.append(f"{'ÖSSZESEN':<11}{_f(pl['kwh']):>6} {_pct(pl['kwh'], pl['kwh_y']).replace(' ', ''):>6} "
                    f"{('~' + _ft(pl['mtd'] * ep)) if pl['mtd'] is not None else '--':>9}  ")
        sp = spark_power(D)
        if sp:
            rows += ["", f"0h {sp} 24h"]
        out += box("KONNEKTOROK · MA", rows)
        summ = [f"villany ma  {_f(pl['kwh']).rjust(5)} kWh  ~{_ft(el_ft)} Ft (mért)"]
        if g_today:
            summ.append(f"gáz ma     {('~' + _f(g_today * min(1, D.cut.total_seconds() / 86400))).rjust(6)} m³   ~{_ft(gas_ft)} Ft (becsl.)")
        if pl["per_day7"] is not None:
            summ.append(f"7n átlag    {_f(pl['per_day7']).rjust(5)} kWh/nap a konnektorokon")
        summ.append("a teljes villany a SZÁMLA-ŐR dobozban")
        out += box("ÖSSZESEN · MA", summ)

        tl = ["szoba        min| átl| max  fokóra"]
        for r in cf["rows"]:
            s = D.hourly.get(r["pink"], {})
            td = [x for h, x in s.items() if h >= D.t0 and x.get("temp_min") is not None]
            tmin = min((float(x["temp_min"]) for x in td), default=None)
            tl.append(f"{r['name'][:12].ljust(12)} {_f(tmin).rjust(4)}|{_f(r['avg']).rjust(4)}|{_f(r['max']).rjust(4)}  "
                      f"{_f(r['deg_h']).rjust(5)}{' !' if r['dev'] is not None and r['dev'] > HOT_DEV else ' ?' if r['dev'] is not None and r['dev'] < COLD_DEV else ''}")
        tl.append(f"cél: nappal {_f(target(14), 0)}, éjjel {_f(target(2), 0)} °C")
        tl.append("! túlfűtött, ? hideg (óránként a célhoz)")
        out += box("HŐMÉRŐK · KOMFORT · MA", tl)

        kl = []
        t7 = D.temp_now("T7")
        w = D.wx.get(D.today.isoformat())
        if w and w.get("t_avg") is not None:
            kl.append(f"kint ma    {_f(float(w['t_avg']))} °C átlag" + (f", erkély most {_f(t7)} °C" if t7 is not None else ""))
            kl.append(f"hőfokhíd   {_f(float(w.get('hdd') or 0))} °C-nap")
            if bent is not None:
                kl.append(f"bent-kint  {_f(bent - float(w['t_avg']))} °C különbség")
        if gm.get("k"):
            kl.append(f"gáz        {_f(gm['k'], 2)} m³/fok (+{_f(GAS_BASE_M3, 2)} alap)")
        elif gm.get("rate"):
            kl.append(f"gáz        ~{_f(gm['rate'])} m³/nap (mérőállás-átlag)")
        if kl:
            out += box("KINT · FŰTÉS", kl)

    # ---- bojler
    if D.boil and (D.boil["today"] > 0 or D.boil["avg7"]):
        out += [""] + box("BOJLER", boiler.lines(D.boil, None))

    # ---- 2. kör: számla-őr, robotok, kapcsolások, jelenlét, Pamutka
    mb = meter_box(D)
    if mb:
        out += [""] + box("SZÁMLA-ŐR · VALÓS MÉRŐÁLLÁSOK", mb)
    rl = []
    for r in rob:
        if r["none"]:
            rl.append(f"{r['name']}: még nincs adat")
            continue
        st = ROBOT_STATE.get(r.get("state") or "", r.get("state") or "--")
        bat = f" · {r['battery']}%" if isinstance(r.get("battery"), (int, float)) else ""
        rl.append(f"{r['name']}: {st}{bat}")
        rl.append(f"  ma: {_f(r['area'], 0)} m², {r['minutes']} perc" if r["cleaned"] else "  ma nem takarított")
    out += [""] + box("ROBOTOK", rl)
    kk = []
    for x in D.ctl_log:
        lt = _ts(x["ts"]).astimezone(TZ)
        src = {"user": "kézzel", "rule": "ütemezés", "timer": "időzítő", "scene": "jelenet"}.get(x.get("source"), x.get("source") or "")
        kk.append(f"{lt:%H:%M} {short(D.label(x['pink']))} {'BE' if x.get('action') == 'on' else 'KI'} ({src}){'' if x.get('ok') else ' HIBA'}")
    out += [""] + box("KAPCSOLÁSOK · MA", kk[-10:] if kk else ["ma nem volt kapcsolás"])
    pr = presence(D)
    jl = ([f"mozgás ma: {pr['n']}× ({pr['hours']} órában)",
           f"első {pr['first']:%H:%M}, utolsó {pr['last']:%H:%M}"] if pr["n"] else ["ma nem volt mozgás (lépcső teteje)"])
    jl.append("(Pamutka is mozgásnak számít)")
    out += [""] + box("JELENLÉT", jl)
    say = pamutka(D, cf, todo)
    out += [""] + box(f"{SITE.advisor.get('name', 'Pamutka').upper()} MONDJA", CAT + say)

    # ---- érzékelők most
    now_l = []
    for p, n in D.thermos:
        v = D.temp_now(p)
        now_l.append(f"- {n}: {_f(v)} °C" if v is not None else f"- {n}: nincs friss adat")
    on = [short(D.label(p)) for p in D.plugs if D.online(p) and ((D.latest[p].get("status") or {}).get("switch_1") is True
                                                                 or (D.latest[p].get("status") or {}).get("switch") is True)]
    now_l.append("- Bekapcsolva: " + (", ".join(on) if on else "semmi"))
    out += [""] + stripe("ÉRZÉKELŐK MOST") + now_l

    if D.loc.weekday() == 6:
        out += [""] + box("OKOS ESZKÖZÖK · EMLÉKEZTETŐ", GADGETS)
        out += ["<<LEGEND>>"] + box("JELMAGYARÁZAT", LEGEND) + ["<</LEGEND>>"]
    out += footer() + ["", f"Térkép: {SITE.map_url}", "",
                       f"Ezt az {SITE.tag} adatgyűjtő küldte {D.loc:%H:%M}-kor (csak jelez, magától semmit nem kapcsol). "
                       "Naponta legfeljebb egy ilyen levél jön."]
    top = banner(D, pl["kwh"], ft, bent) + ["", f">> DASHBOARD: {SITE.map_url}", ""] + tldr + [""]
    marked = "\n".join(top + out) + "\n"
    text = "\n".join(l for l in top + out if l not in ("<<LEGEND>>", "<</LEGEND>>")) + "\n"
    return {"subject": subject(D, pl["kwh"], ft, bent, len(D.alerts)), "email_body": text, "marked": marked,
            "links": {short(D.label(p)): p for p in D.plugs}}
