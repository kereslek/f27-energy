"""Magyar ékezetek: a Lilita One-ból hiányzik az ő ű Ő Ű, ezért minden betűkészletben a Quest Display
(a Lilita One magyarral kiegészített változata, web/fonts/) áll előtte. Ez a teszt őrzi a szabályt."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [p for p in (ROOT / "web").rglob("*") if p.suffix in (".html", ".js", ".css") and "vendor" not in p.parts]


class HungarianFontTest(unittest.TestCase):
    def test_lilita_never_first(self):
        bad = []
        for p in FILES:
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                for m in re.finditer(r"Lilita One", line):
                    before = line[max(0, m.start() - 40):m.start()]
                    if "Quest Display" not in before:
                        bad.append(f"{p.relative_to(ROOT)}:{i}")
        self.assertEqual(bad, [], "a Lilita One elé kell a Quest Display (ő ű Ő Ű)")

    def test_font_file_and_face(self):
        self.assertTrue((ROOT / "web/fonts/QuestDisplay-Regular.woff2").is_file())
        self.assertTrue((ROOT / "web/fonts/OFL-QuestDisplay.txt").is_file())
        for page in ("web/index.html", "web/o2b/index.html"):
            s = (ROOT / page).read_text(encoding="utf-8")
            self.assertRegex(s, r'@font-face\{font-family:"Quest Display";src:url\("(\.\./)?fonts/QuestDisplay-Regular\.woff2"\)')

    def test_font_has_hungarian_glyphs(self):
        try:
            from fontTools.ttLib import TTFont
        except ImportError:
            self.skipTest("fontTools nincs telepítve")
        cmap = TTFont(ROOT / "web/fonts/QuestDisplay-Regular.woff2").getBestCmap()
        for cp in (0x151, 0x171, 0x150, 0x170, 0xF6, 0xFC, 0xF3, 0xFA, 0xE9, 0xE1, 0xED):
            self.assertIn(cp, cmap, hex(cp))


if __name__ == "__main__":
    unittest.main()
