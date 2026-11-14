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


if __name__ == "__main__":
    unittest.main()
