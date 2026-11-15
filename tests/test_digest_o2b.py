"""Az O2B esti levele offline (f27/digest_o2b.py): alprocesszben, O2B-konfiggal (F27_SITE_CONFIG)."""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = r'''
import json, sys
sys.path.insert(0, %r)
from tests.o2b_digest_fixture import FakeO2B, NOW
from f27 import digest, digest_o2b
from f27.report_stats import to_html
m = digest_o2b.build(FakeO2B(), {}, NOW, digest._safe, digest.alert_items, archive=lambda a, b: {})
m["html"] = to_html(m["marked"], "https://x/o2b/", rows=m["links"])
print(json.dumps(m))
''' % str(ROOT)


def render():
    env = dict(os.environ, F27_SITE_CONFIG="sites/o2b/site.json")
    out = subprocess.run([sys.executable, "-c", SCRIPT], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


class O2BDigestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = render()
        cls.body = cls.m["email_body"]

    def test_subject(self):
        s = self.m["subject"]
        self.assertTrue(s.startswith("▓▒░ O2B·NRG ░▒▓ 11.15 V"))
        self.assertIn("BENT", s); self.assertIn("kWh", s)
        self.assertLessEqual(len(s), 80)

    def test_boxes_fit_iphone(self):
        for ln in self.body.split("\n"):
            if ln[:1] in "┌│└╔║╠╚":
                self.assertLessEqual(len(ln), 44, ln)

    def test_sections_round1_and_2(self):
        for part in ("TL;DR", "Riasztások ma", "Teendők", "ELEMCSERE", "Holnap (nov. 16.)", "KONNEKTOROK · MA",
                     "HŐMÉRŐK · KOMFORT · MA", "KINT · FŰTÉS", "SZÁMLA-ŐR", "ROBOTOK", "KAPCSOLÁSOK · MA",
                     "JELENLÉT", "PAMUTKA MONDJA", "ÉRZÉKELŐK MOST", "OKOS ESZKÖZÖK", "JELMAGYARÁZAT"):
            self.assertIn(part, self.body, part)

    def test_facts(self):
        b = self.body
        self.assertIn("Túlfűtött (a napszak céljához képest", b)       # óránként a saját célhoz (nappal 22, éjjel 20)
        self.assertIn("Gyerekszoba", b.split("Túlfűtött")[1].split("\n")[0])
        self.assertIn("Nem elérhető: Hőmérő, konyha", b)
        self.assertNotIn("Karácsonyfa", b.split("Teendők")[1].split("ELEMCSERE")[0])   # szezonon kívüli dekor nem teendő
        self.assertIn("dupla lámpa KI (ütemezés)", b)                   # holnapi ütemezés
        self.assertIn("13,6 kWh/nap", b)                                 # valós mérőállásokból
        self.assertIn("ma: 18 m², 22 perc", b)

    def test_no_f27_content_or_private_data(self):
        b = self.body.lower()
        for word in ("kályha", "vendég", "foglal", "f · 2 · 7", "zöld szék", "orlay", "ferenc"):
            self.assertNotIn(word, b, word)

    def test_tldr_is_sane(self):
        """2026.11.15-i levél: "Ára ~2 Ft/nap", "Megtakarít ~20 Ft/hó", levágott teendő, DoD a gázzal kevert
        költség mellett. A pazarlás csak 30 Ft/nap fölött tétel, a teendő rövid változat, DoD nincs a sorban."""
        tl = self.body.split("TL;DR")[1].split("RELEASE NOTES")[0]
        self.assertNotIn("DoD", tl)
        self.assertIn("(gázzal, becsl.)", tl)
        import re
        m = re.search(r"Ára \.+: ~([\d ]+) Ft/nap", tl)
        self.assertTrue(m is None or int(m.group(1).replace(" ", "")) >= 30, tl)
        teendo = [l for l in tl.splitlines() if "Teendő" in l][0]
        self.assertFalse(teendo.rstrip().endswith("."), teendo)           # nem levágott mondat

    def test_html_rows_link_to_device_card(self):
        self.assertIn("?dev=C1", self.m["html"])
        self.assertIn("<details>", self.m["html"])                     # vasárnap: összecsukott jelmagyarázat


if __name__ == "__main__":
    unittest.main()


class ComfortHourlyTargetTest(unittest.TestCase):
    def test_room_on_target_day_and_night_is_not_cold(self):
        from datetime import datetime, timedelta, timezone
        from types import SimpleNamespace
        from f27 import digest_o2b as O
        t0 = datetime(2026, 11, 15, 0, 0, tzinfo=O.TZ).astimezone(timezone.utc)
        hrs = {}
        for h in range(20):
            t = t0 + timedelta(hours=h)
            lh = t.astimezone(O.TZ).hour
            v = 20.0 if (lh >= 22 or lh < 6) else 22.0                  # pontosan a napszak céljain
            hrs[t] = {"temp_avg": v - 0.2, "temp_max": v}
        D = SimpleNamespace(hourly={"T6": hrs}, thermos=[("T6", "Gyerekszoba")], t0=t0)
        r = O.comfort(D)["rows"][0]
        self.assertGreater(r["dev"], O.COLD_DEV)                          # régen: átlag 21,2 < 22-1,5 -> "Hideg"
        self.assertLess(r["dev"], O.HOT_DEV)
