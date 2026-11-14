"""Elemcsere-előrejelzés (f27/battery.py): merülési görbék, csereészlelés, egyszeri push."""

import unittest
from datetime import date, datetime, timedelta, timezone

from f27 import battery as B

D0 = date(2026, 11, 1)


def feed(points, kind="pct", row=None):
    """points: [(nap, érték)] -> a battery_status sor a napi frissítések után."""
    row = row or {"pink": "x"}
    for day, v in points:
        row = B.update(row, kind, v, D0 + timedelta(days=day))
    return row


class ReadingTest(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(B.reading({"battery_percentage": 83}), ("pct", 83))
        self.assertEqual(B.reading({"battery_state": "low"}), ("state", "low"))
        self.assertIsNone(B.reading({"va_temperature": 215}))
        self.assertEqual(B.reading({"battery_percentage": 140}), ("pct", 100))


class PercentTest(unittest.TestCase):
    def test_linear_drain_above_knee(self):
        # 1 %/nap 90-ről: a térdig (30) 60 nap, alatta 2,5-szer gyorsabb: (30-10)/2.5 = 8 -> kb. 58 nap mostantól
        row = feed([(d, 90 - d) for d in range(0, 11)])
        fc = B.forecast(row, "CR2032", True, D0 + timedelta(days=10))
        self.assertEqual(fc["basis"], "mért merülés")
        self.assertEqual(fc["level"], "ok")
        self.assertTrue(40 <= fc["eta_lo"] <= 60 <= fc["eta_hi"], fc)

    def test_below_knee_uses_recent_rate(self):
        row = feed([(0, 40), (5, 38), (10, 30), (13, 22)])
        fc = B.forecast(row, "AAA", True, D0 + timedelta(days=13))
        self.assertIn(fc["level"], ("due14", "due30"))
        self.assertLessEqual(fc["eta_lo"], 14)

    def test_dead_and_offline(self):
        self.assertEqual(B.forecast(feed([(0, 1)]), "CR2032", True, D0)["level"], "dead")
        self.assertEqual(B.forecast(feed([(0, 18)]), "CR2032", False, D0)["level"], "dead")

    def test_no_decline_falls_back_to_profile(self):
        row = feed([(0, 100), (5, 100)])
        fc = B.forecast(row, "CR2032", True, D0 + timedelta(days=5))
        self.assertEqual(fc["basis"], "elemprofil")
        self.assertEqual(fc["level"], "ok")

    def test_outlier_does_not_trigger(self):
        # egy kiugró 55-ös jelentés 80-as sorban (Theil-Sen: a medián meredekség számít)
        row = feed([(0, 82), (3, 81), (6, 55), (9, 80), (12, 79)])
        fc = B.forecast(row, "CR2032", True, D0 + timedelta(days=12))
        self.assertEqual(fc["level"], "ok")


class ReplacementTest(unittest.TestCase):
    def test_pct_jump_resets_and_learns(self):
        row = feed([(0, 100), (100, 40), (200, 9), (210, 100)])
        self.assertEqual(row["changed_at"], (D0 + timedelta(days=210)).isoformat())
        self.assertEqual(row["lifetimes"], [210])
        self.assertEqual(len(row["samples"]), 1)

    def test_state_low_to_high_is_replacement(self):
        row = feed([(0, "high"), (90, "middle"), (130, "low"), (140, "high")], kind="state")
        self.assertEqual(row["changed_at"], (D0 + timedelta(days=140)).isoformat())
        self.assertEqual(row["lifetimes"], [140])

    def test_one_sample_per_day(self):
        row = feed([(0, 90), (0, 88), (0, 89)])
        self.assertEqual(row["samples"], [[D0.isoformat(), 88]])


class StateTest(unittest.TestCase):
    def test_levels(self):
        today = D0 + timedelta(days=100)
        low = feed([(100, "low")], kind="state")
        self.assertEqual(B.forecast(low, "AAA", True, today)["level"], "due14")
        self.assertEqual(B.forecast(low, "AAA", False, today)["level"], "dead")
        high_unknown = feed([(100, "high")], kind="state")
        self.assertEqual(B.forecast(high_unknown, "AAA", True, today)["level"], "ok")

    def test_learned_life_from_change(self):
        # 150 napos tanult élettartam, a csere 120 napja volt: 0,85*150-120 = 7,5 -> 14 napon belül
        row = feed([(0, "high")], kind="state")
        row["changed_at"] = D0.isoformat()
        row["lifetimes"] = [150]
        row = B.update(row, "state", "high", D0 + timedelta(days=120))
        fc = B.forecast(row, "AAA", True, D0 + timedelta(days=120))
        self.assertEqual((fc["level"], fc["basis"]), ("due14", "tanult élettartam"))


class PlanTest(unittest.TestCase):
    DEVS = {"8": {"label": "Kis szoba ablak", "chem": "CR2032", "count": 1},
            "T3": {"label": "Hőmérő, hálószoba", "chem": "AAA", "count": 2}}

    def test_push_once_per_level(self):
        latest = {"8": {"online": True, "status": {"battery_percentage": 1}},
                  "T3": {"online": True, "status": {"battery_state": "low"}}}
        ups, pushes = B.plan(self.DEVS, latest, {}, D0)
        self.assertEqual(sorted((p["pink"], p["level"]) for p in pushes), [("8", "dead"), ("T3", "due14")])
        rows = {r["pink"]: r for r in ups}
        ups2, pushes2 = B.plan(self.DEVS, latest, rows, D0)
        self.assertEqual(pushes2, [])                  # ugyanazon a napon nem push-ol újra
        ups3, pushes3 = B.plan(self.DEVS, latest, {r["pink"]: r for r in ups2}, D0 + timedelta(days=1))
        self.assertEqual([(p["pink"], p["level"]) for p in pushes3], [("8", "dead")])   # a 14 napos nem ismétlődik
        title, text = B.push_text(pushes[0])
        self.assertIn("Kis szoba ablak", text if pushes[0]["pink"] == "8" else B.push_text(pushes[1])[1])

    def test_dead_push_schedule(self):
        """Lemerült elem: 10 napig naponta (max 10), utána hetente, az első után 40 napig; aztán csend."""
        latest = {"8": {"online": True, "status": {"battery_percentage": 1}}}
        rows, days = {}, []
        for d in range(0, 60):
            ups, pushes = B.plan({"8": self.DEVS["8"]}, latest, rows, D0 + timedelta(days=d))
            rows = {r["pink"]: r for r in ups}
            if pushes:
                days.append(d)
        self.assertEqual(days[:10], list(range(10)))
        self.assertEqual(days[10:], [16, 23, 30, 37])
        self.assertEqual(len(days), 14)

    def test_dead_counter_resets_on_replacement(self):
        latest = {"8": {"online": True, "status": {"battery_percentage": 1}}}
        rows = {}
        for d in range(0, 45):
            ups, _ = B.plan({"8": self.DEVS["8"]}, latest, rows, D0 + timedelta(days=d))
            rows = {r["pink"]: r for r in ups}
        new = {"8": {"online": True, "status": {"battery_percentage": 100}}}
        ups, pushes = B.plan({"8": self.DEVS["8"]}, new, rows, D0 + timedelta(days=46))
        self.assertEqual(pushes, [])
        self.assertEqual(ups[0]["notified"], {})       # csere: tiszta lap
        dead = {"8": {"online": True, "status": {"battery_percentage": 2}}}
        ups, pushes = B.plan({"8": self.DEVS["8"]}, dead, {"8": ups[0]}, D0 + timedelta(days=300))
        self.assertEqual([p["level"] for p in pushes], ["dead"])

    def test_digest_only_due_within_30(self):
        rows = [{"pink": "1", "label": "A", "level": "ok", "eta_lo": 90, "eta_hi": 120},
                {"pink": "2", "label": "B", "level": "due30", "eta_lo": 20, "eta_hi": 35},
                {"pink": "3", "label": "C", "level": "dead", "eta_lo": 0, "eta_hi": 0}]
        lines = B.digest_lines(rows, D0)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("!! C"))
        self.assertIn("kb. 20-35 nap", lines[1])


class RunTest(unittest.TestCase):
    class FakeSB:
        def __init__(self, latest, rows=None, settings=None):
            self.latest, self.rows, self.settings, self.upserted = latest, rows or [], settings, []

        def select(self, table, cols, **kw):
            return {"battery_status": self.rows, "device_latest": self.latest,
                    "alert_settings": self.settings or []}[table]

        def upsert(self, table, rows, on_conflict=None):
            self.upserted += rows

    def test_run_pushes_with_channel(self):
        sent = []
        sb = self.FakeSB([{"pink": "8", "online": True, "status": {"battery_percentage": 1}}])
        cfg = {"battery": {"contact": {"type": "CR2032"}},
               "devices": [{"pink": "8", "role": "contact", "label": "Kis szoba ablak"}]}
        env = {"NTFY_TOPIC": "teszt"}
        res = B.run_battery(sb, now=datetime(2026, 11, 14, 18, tzinfo=timezone.utc), environ=env,
                            senders={"push": lambda m, e: sent.append(m)}, cfg=cfg)
        self.assertEqual((res["dead"], res["pushed"]), (1, 1))
        self.assertEqual(sb.upserted[0]["notified"].get("dead"), "2026-11-14")
        self.assertIn("Kis szoba ablak", sent[0]["body"])

    def test_missing_table_is_quiet(self):
        from f27.supa import SupabaseError

        class SB(self.FakeSB):
            def select(self, table, cols, **kw):
                raise SupabaseError(404, "PGRST205", "nincs")
        cfg = {"battery": {"contact": {"type": "CR2032"}}, "devices": [{"pink": "8", "role": "contact"}]}
        res = B.run_battery(SB([]), environ={}, cfg=cfg)
        self.assertFalse(res["error"])
        self.assertIn("008_battery.sql", res["note"])


class BatteryEmailTest(unittest.TestCase):
    class SB:
        def __init__(self, rows):
            self.rows, self.log = rows, []

        def select(self, table, cols, **kw):
            if table == "alert_log":
                return [x for x in self.log if x["rule_key"] == kw.get("rule_key", "")[3:]]
            return self.rows

        def insert(self, table, rows):
            self.log += rows

    ENV = {"SMTP_HOST": "smtp.pelda.hu", "ALERT_EMAIL_TO": "a@pelda.hu"}

    def test_once_a_day_after_20(self):
        sb, sent = self.SB([{"pink": "T3", "label": "Hőmérő, hálószoba", "level": "dead", "eta_lo": 0, "eta_hi": 0}]), []
        snd = lambda m, e: sent.append(m)
        B.battery_email(sb, datetime(2026, 11, 14, 18, 0, tzinfo=timezone.utc), self.ENV, snd)    # 19:00 Budapest
        self.assertEqual(sent, [])
        B.battery_email(sb, datetime(2026, 11, 14, 19, 5, tzinfo=timezone.utc), self.ENV, snd)    # 20:05
        B.battery_email(sb, datetime(2026, 11, 14, 21, 0, tzinfo=timezone.utc), self.ENV, snd)    # ugyanaznap
        self.assertEqual(len(sent), 1)
        self.assertIn("ELEMCSERE", sent[0]["subject"])
        self.assertIn("lemerült", sent[0]["email_body"])
        B.battery_email(sb, datetime(2026, 11, 15, 19, 5, tzinfo=timezone.utc), self.ENV, snd)    # másnap is
        self.assertEqual(len(sent), 2)

    def test_no_mail_when_nothing_due(self):
        sb, sent = self.SB([{"pink": "T1", "label": "x", "level": "ok", "eta_lo": 90, "eta_hi": 120}]), []
        B.battery_email(sb, datetime(2026, 11, 14, 19, 5, tzinfo=timezone.utc), self.ENV, lambda m, e: sent.append(m))
        self.assertEqual(sent, [])


if __name__ == "__main__":
    unittest.main()
