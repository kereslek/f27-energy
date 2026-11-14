"""A telephely-réteg (f27.site): az F27 alapértékei változatlanok, és másik site.json is betölthető."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from f27 import report_stats
from f27.site import SITE, load

ROOT = Path(__file__).resolve().parent.parent


class SiteTest(unittest.TestCase):
    def test_f27_defaults_unchanged(self):
        self.assertEqual(SITE.tag, "F27")
        self.assertEqual(SITE.tz.key, "Europe/Budapest")
        self.assertEqual(report_stats.CIRCUITS, (("X5", "KÁLYHA", 60.9, 60.9, "B"), ("X7", "BOJLER", 60.9, 60.9, "B"),
                                                 ("X8", "KONYHA", 36.2, 70.1, "A1"), ("X9", "KLÍMA", 36.2, 70.1, "A1")))
        self.assertAlmostEqual(report_stats.B_QUOTA_DAY, 2523 / 365)
        self.assertEqual(SITE.price("B"), 60.9)
        self.assertEqual(SITE.price("A1", over=False), 36.2)
        self.assertEqual(SITE.circuit("X9")["meter"], "A1")

    def test_other_site_via_env(self):
        cfg = {"id": "demo", "tag": "D1", "brand": "D1 ENERGY", "timezone": "Europe/Vienna",
               "location": {"lat": 48.2, "lon": 16.37}, "map_url": "https://example.org/d1/",
               "tariff": {"quota_kwh_year": 1000, "meters": {"A1": {"in_quota": 30, "over_quota": 60}}},
               "circuits": [{"pink": "S1", "name": "BOJLER", "meter": "A1", "ft_low": 30, "ft_high": 60}]}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "site.json"
            p.write_text(json.dumps(cfg), encoding="utf-8")
            s = load(p)
            self.assertEqual((s.tag, s.tz.key, s.lat, s.price("A1")), ("D1", "Europe/Vienna", 48.2, 60.0))
            code = ("from f27 import alerts, report_stats, weather;"
                    "print(alerts.TAG, alerts.MAP_URL, report_stats.CIRCUITS[0][0], weather.LAT)")
            env = dict(os.environ, F27_SITE_CONFIG=str(p))
            out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, check=True)
            self.assertEqual(out.stdout.split(), ["D1", "https://example.org/d1/", "S1", "48.2"])


class O2BSiteTest(unittest.TestCase):
    """A második telephely (O2B) konfigja: betölthető, és a párosítás nem keveri az F27 eszközeivel."""

    CFG = ROOT / "sites" / "o2b" / "site.json"

    def test_loads(self):
        s = load(self.CFG)
        self.assertEqual((s.tag, s.advisor["name"], s.comfort["heat_day_c"]), ("O2B", "Pamutka", 22))
        self.assertTrue(s.devices_config.exists())
        self.assertEqual(s.data_dir, ROOT / "data" / "o2b")
        self.assertEqual(set(s.meters), {"A1"})

    # A tiltott szavak (családnév, utcanév) csak SHA-256 lenyomatként szerepelnek, hogy maga a teszt
    # se írja ki őket a publikus repóba.
    BAD_HASHES = {
        "aa51f0c852c8c94e4cb318f3436552df13803afc23565232d3c1629344f6507a",
        "e6c5ea9b3d6047223db9c14809a57be18973df3883a6d679b787ef7a5f940b44",
        "68d3ac7030de7beb1933fc5eefdeaac2a6f9a5e61e00bf30a2a1c263e2fc34f7",
        "1631afb3197b7fbae519551bd501ff4169de3d96a4ba7feea71a195a782d6402",
    }

    def test_no_private_names(self):
        import hashlib
        import re
        files = list((ROOT / "sites" / "o2b").glob("*.json")) + list((ROOT / "web" / "o2b").glob("*.*")) \
            + list((ROOT / "docs").glob("*.md")) + [ROOT / "CLAUDE.md"]
        for f in files:
            low = f.read_text(encoding="utf-8", errors="ignore").lower()
            if f.parent.name == "o2b" and f.suffix == ".json":
                self.assertNotIn("2/b", low, f"{f.name}: házszám")
            for tok in set(re.findall(r"[0-9a-záéíóöőúüű]+", low)):
                self.assertNotIn(hashlib.sha256(tok.encode()).hexdigest(), self.BAD_HASHES, f"{f.name}: privát név")

    def test_matching_two_homes(self):
        from f27.discover import match_devices
        cfg = json.loads((ROOT / "sites" / "o2b" / "devices.json").read_text(encoding="utf-8"))
        H1, H2 = "home-f27", "home-o2b"
        devs = [
            {"id": "a", "name": "F27 - Hőmérő - Kis szoba", "category": "wsdcg", "owner_id": H1},
            {"id": "b", "name": "F27 - Klíma kismegszakító (9.)", "category": "dlq", "owner_id": H1},
            {"id": "c", "name": "Hőmérő - nappali", "category": "wsdcg", "owner_id": H2},
            {"id": "d", "name": "Hőmérő - kagyló szoba", "category": "wsdcg", "owner_id": H2},
            {"id": "e", "name": "Klíma - Nappali", "category": "infrared_ac", "owner_id": H2},
            {"id": "f", "name": "Klíma - gyermeki szoba", "category": "infrared_ac", "owner_id": H2},
            {"id": "g", "name": "Emeleti bojler (meleg víz)", "category": "cz", "owner_id": H2},
            {"id": "h", "name": "Multifunctional infrared detector", "category": "pir", "owner_id": H2},
            {"id": "i", "name": "Hőmérő - Koshka télikertje", "category": "wsdcg", "owner_id": H2},
            {"id": "j", "name": "Hőmérő - gyermeki szoba", "category": "wsdcg", "owner_id": H2},
        ]
        res = match_devices(devs, cfg["devices"], cfg["role_categories"])
        got = {p: d["id"] for p, d in res.mapping.items()}
        self.assertEqual(got, {"T1": "c", "T5": "d", "K1": "e", "K4": "f", "C1": "g", "M1": "h", "T7": "i", "T6": "j"})
        self.assertNotIn("a", got.values())
        self.assertEqual(res.conflicts, {})


if __name__ == "__main__":
    unittest.main()
