"""Kitalált O2B-adatok az esti levél offline teszteléséhez (F27_SITE_CONFIG=sites/o2b/site.json alatt)."""
from datetime import datetime, timedelta, timezone

NOW = datetime(2026, 11, 15, 19, 0, tzinfo=timezone.utc)          # 20:00 Budapest, vasárnap


class FakeO2B:
    def __init__(self):
        h0 = NOW.replace(minute=0) - timedelta(days=9)
        self.mh = []
        t = h0
        while t < NOW:
            lh = (t.hour + 1) % 24
            for p, base in (("T1", 22.8), ("T2", 21.4), ("T3", 21.0), ("T4", 20.5), ("T5", 21.2), ("T6", 23.6), ("T7", 6.0), ("T8", 22.4)):
                v = base + (0.6 if 7 <= lh <= 22 else -0.4)
                self.mh.append({"pink": p, "hour": t.isoformat(), "temp_avg": v, "temp_min": v - 0.3, "temp_max": v + 0.4})
            self.mh.append({"pink": "C1", "hour": t.isoformat(), "kwh": 0.11 if lh in (1, 2, 3, 4) else (0.9 if lh in (7, 21) else 0.1)})
            self.mh.append({"pink": "C2", "hour": t.isoformat(), "kwh": 0.02 if 17 <= lh <= 23 else 0.0})
            self.mh.append({"pink": "C3", "hour": t.isoformat(), "kwh": 0.01 if 18 <= lh <= 23 else 0.0})
            t += timedelta(hours=1)

    def select(self, table, columns="*", **f):
        if table == "devices":
            return [{"pink": p, "role": r, "room": "x", "label": l, "meta": {}} for p, r, l in (
                ("T1", "thermo", "Hőmérő, nappali"), ("T2", "thermo", "Hőmérő, étkező"), ("T4", "thermo", "Hőmérő, konyha"),
                ("C1", "plug", "Emeleti bojler (meleg víz)"), ("C2", "plug", "Dupla lámpa (étkező, a tükörnél)"),
                ("C3", "plug", "TV led"), ("C6", "plug", "Karácsonyfa"), ("M1", "pir", "Mozgásérzékelő"))]
        if table == "device_latest":
            return [{"pink": "T1", "ts": NOW.isoformat(), "online": True, "status": {"va_temperature": 228}},
                    {"pink": "T7", "ts": NOW.isoformat(), "online": True, "status": {"va_temperature": 58}},
                    {"pink": "T4", "ts": NOW.isoformat(), "online": False, "status": {"va_temperature": 205}},
                    {"pink": "C2", "ts": NOW.isoformat(), "online": True, "status": {"switch_1": True}},
                    {"pink": "C6", "ts": NOW.isoformat(), "online": False, "status": {}},
                    {"pink": "R2", "ts": NOW.isoformat(), "online": True, "status": {"state": "charged", "battery": 100}}]
        if table == "metrics_hourly":
            pinks = f.get("pink", "in.()")[4:-1].split(",")
            off = int(f.get("offset", 0))
            rows = [r for r in self.mh if r["pink"] in pinks and r["hour"] >= f["hour"][4:]]
            return rows[off:off + 1000]
        if table == "weather_daily":
            return [{"day": (NOW - timedelta(days=k)).date().isoformat(), "t_avg": 6.0, "hdd": 12.0} for k in range(8)]
        if table == "weather_hourly":
            return [{"ts": (NOW + timedelta(hours=k)).isoformat(), "temp": 3 + k % 8} for k in range(5, 40)]
        if table == "battery_status":
            return [{"pink": "T3", "label": "Hőmérő, hálószoba", "level": "due14", "eta_lo": 0, "eta_hi": 14}]
        if table == "control_rules":
            return [{"pink": "C2", "action": "on", "kind": "sunset", "minute": -15, "days": 127, "enabled": True},
                    {"pink": "C2", "action": "off", "kind": "time", "minute": 1350, "days": 127, "enabled": True}]
        if table == "control_log":
            return [{"ts": (NOW - timedelta(hours=3)).isoformat(), "pink": "C2", "action": "on", "source": "rule", "ok": True}]
        if table == "device_status" and f.get("pink") == "eq.M1":
            return [{"ts": (NOW - timedelta(hours=h)).isoformat(), "status": {"pir": "pir"}} for h in (1, 2, 5, 9)]
        if table == "device_status":
            return [{"ts": (NOW - timedelta(hours=6)).isoformat(), "pink": "R2", "status": {"state": "cleaning", "cleaning": True, "area_m2": 18, "minutes": 22}}]
        if table == "alert_log":
            return []
        return []
