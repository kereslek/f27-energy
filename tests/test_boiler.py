"""Bojler-napló az esti e-mailhez (f27/boiler.py): ugyanazt kell mondania, mint a térkép kártyájának."""
import unittest
from datetime import datetime, timedelta, timezone

from f27 import boiler
from f27.report_stats import box

NOW = datetime(2026, 11, 15, 20, 30, tzinfo=boiler.TZ)


def raw(extra_today=0.0, night=0.0):
    hours = []
    for i in range(8 * 24, -1, -1):
        t = NOW - timedelta(hours=i)
        k = 0.104 + (0.8 if t.hour in (8, 20) else 0) + (extra_today if i < 21 and t.hour == 19 else 0) + (night if i < 21 and t.hour == 3 else 0)
        if i == 0:
            k *= 0.5
        hours.append({"hour": t.replace(minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat(), "kwh": k})
    return {"hours": hours, "days": []}


class BoilerTest(unittest.TestCase):
    def test_idle_from_nights_and_cost(self):
        a = boiler.analyze(raw(), NOW, 60.9)
        self.assertAlmostEqual(a["idle"], 2.5, delta=0.05)
        self.assertAlmostEqual(a["idle_day_ft"], 152, delta=3)
        self.assertLess(abs(a["today"] / a["avg7"] - 1), 0.08)

    def test_bath_day_and_night_use(self):
        a = boiler.analyze(raw(extra_today=2.5), NOW, 60.9)
        self.assertGreater(a["today"] / a["avg7"], 1.4)
        b = boiler.analyze(raw(night=0.6), NOW, 60.9)
        self.assertEqual(b["night_use"], [3])

    def test_email_box_fits_iphone(self):
        a = boiler.analyze(raw(night=0.6), NOW, 60.9)
        rows = box("BOJLER", boiler.lines(a, "ma éjjel üres: bojler LE, ~91 Ft/nap"))
        self.assertTrue(all(len(r) <= 44 for r in rows), max(rows, key=len))
        text = "\n".join(rows)
        for w in ("hőtartás", "használat", "zuhany", "üres nap", "Ft/nap", "éjjel is fűtött"):
            self.assertIn(w, text)

    def test_fallback_quietest_day(self):
        a = boiler.analyze({"hours": [], "days": [{"day": "2026-11-10", "kwh": 2.77}, {"day": "2026-11-11", "kwh": 7.1},
                                                  {"day": "2026-11-12", "kwh": 2.67}]}, NOW, 60.9)
        self.assertAlmostEqual(a["idle"], 2.67)


if __name__ == "__main__":
    unittest.main()
