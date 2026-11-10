"""Offline tesztek a Tuya-napló próbához (f27.tuyalog): lapozás, nyitások és fokozatváltások
számolása, napi kWh a számlálóból (Budapest napja szerint), napi összevetés, és hogy a publikus
összefoglalóba ne kerüljön device ID, időpont vagy mérési érték.

Futtatás a repó gyökeréből:  python -m unittest discover -s tests -v
"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from f27 import tuyalog as TL
from f27.tuya import TuyaError

MS = lambda y, mo, d, h, mi=0: int(datetime(y, mo, d, h, mi, tzinfo=timezone.utc).timestamp() * 1000)


class FakeTuya:
    def __init__(self, logs: dict, stats: dict | None = None, page=100, fail=None):
        self.logs, self.stats, self.page, self.fail = logs, stats or {}, page, fail or set()
        self.calls = []

    def get(self, path, params=None):
        self.calls.append(path)
        dev = path.split("/")[3]
        if path.endswith("/logs"):
            if "logs" in self.fail:
                raise TuyaError(path, 1106, "permission deny")
            all_ = self.logs.get(dev, [])
            i = int(params.get("start_row_key") or 0)
            chunk = all_[i:i + self.page]
            nxt = i + self.page
            return {"logs": chunk, "has_next": nxt < len(all_), "next_row_key": str(nxt) if nxt < len(all_) else None}
        if path.endswith("/all-statistic-type"):
            if "stats" in self.fail:
                raise TuyaError(path, 1106, "permission deny")
            return [{"code": "add_ele", "stat_type": "sum"}]
        if path.endswith("/statistics/days"):
            return {"days": self.stats.get(dev, {})}
        raise AssertionError(path)


class FakeSb:
    def __init__(self, devices, rows, energy):
        self.devices, self.rows, self.energy = devices, rows, energy

    def select(self, table, columns="*", **f):
        if table == "devices":
            return self.devices
        if table == "device_latest":
            return [{"pink": "X5", "status": {"total_forward_energy": 123, "add_ele": 5}}]
        src = self.rows if table == "device_status" else self.energy
        off, lim = int(f.get("offset", 0)), int(f.get("limit", 10 ** 9))
        return src[off:off + lim]


def ev(code, value, ms):
    return {"code": code, "value": value, "event_time": ms}


class TestPieces(unittest.TestCase):
    def test_paging_and_truncation(self):
        logs = [ev("doorcontact_state", i % 2 == 0, MS(2026, 11, 9, 10, i % 60)) for i in range(250)]
        tc = FakeTuya({"d5": logs})
        r = TL.fetch_logs(tc, "d5", 0, 1, max_pages=10)
        self.assertEqual((len(r["logs"]), r["pages"], r["truncated"], r["error"]), (250, 3, False, None))
        r = TL.fetch_logs(tc, "d5", 0, 1, max_pages=2)
        self.assertEqual((len(r["logs"]), r["truncated"]), (200, True))

    def test_logs_error_is_only_the_code(self):
        r = TL.fetch_logs(FakeTuya({}, fail={"logs"}), "titkos-device-id", 0, 1, 5)
        self.assertEqual(r["error"], "1106 (permission deny)")
        e = TuyaError("/x", 28841101, "No permission for bf0123456789abcdef01")
        self.assertEqual(TL.err_text(e), "28841101 (No permission for ...)")

    def test_opens_counted_from_log_and_rows(self):
        logs = [ev("doorcontact_state", True, MS(2026, 11, 9, 10)), ev("doorcontact_state", False, MS(2026, 11, 9, 10, 1)),
                ev("doorcontact_state", "true", MS(2026, 11, 9, 12)), ev("doorcontact_state", "false", MS(2026, 11, 9, 12, 2)),
                ev("battery_percentage", 90, MS(2026, 11, 9, 13))]
        self.assertEqual(TL.count_opens_log(logs), 2)
        rows = [{"status": {"doorcontact_state": False}}, {"status": {"doorcontact_state": True}},
                {"status": {"doorcontact_state": True}}, {"status": {"doorcontact_state": False}}]
        self.assertEqual(TL.count_opens_rows(rows), 1)

    def test_stage_changes(self):
        logs = [ev("switch_1", True, 1), ev("switch_1", False, 2), ev("switch_2", True, 3), ev("switch_1", True, 4)]
        self.assertEqual(TL.count_stage_changes_log(logs), 2)    # switch_1: BE->KI, KI->BE (az első jelentés csak alap)
        rows = [{"status": {"switch_1": True, "switch_2": False, "switch_3": False}},
                {"status": {"switch_1": True, "switch_2": False, "switch_3": False}},
                {"status": {"switch_1": False, "switch_2": False, "switch_3": False}}]
        self.assertEqual(TL.count_stage_changes_rows(rows), 1)

    def test_daily_kwh_from_counter_budapest_days(self):
        # 22:30 UTC = 23:30 Budapest (nov. 9.), 23:30 UTC = 00:30 Budapest (nov. 10.)
        logs = [ev("total_forward_energy", 100000, MS(2026, 11, 9, 20)), ev("total_forward_energy", 100150, MS(2026, 11, 9, 22, 30)),
                ev("total_forward_energy", 100200, MS(2026, 11, 9, 23, 30)), ev("total_forward_energy", 100190, MS(2026, 11, 10, 1)),
                ev("cur_power", 9950, MS(2026, 11, 9, 21))]
        self.assertEqual(TL.daily_kwh_from_counter_log(logs, 2), {"2026-11-09": 1.5, "2026-11-10": 0.5})

    def test_add_ele_is_summed_as_increments(self):
        logs = [ev("add_ele", 120, MS(2026, 11, 9, 10)), ev("add_ele", 80, MS(2026, 11, 9, 22, 30)),
                ev("add_ele", 50, MS(2026, 11, 9, 23, 30)), ev("add_ele", 0, MS(2026, 11, 10, 1))]
        self.assertEqual(TL.daily_kwh_from_increments(logs, 3), {"2026-11-09": 0.2, "2026-11-10": 0.05})

    def test_compare_days(self):
        c = TL.compare_days({"2026-11-08": 10.0, "2026-11-09": 5.0, "2026-11-10": 1.0}, {"2026-11-09": 5.6, "2026-11-10": 1.02, "2026-11-11": 3})
        self.assertEqual((c["common"], c["same"], c["diff"], c["only_a"], c["only_b"]), (2, 1, 1, 1, 1))


class TestRun(unittest.TestCase):
    def test_run_and_public_summary(self):
        now = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)
        devices = [{"pink": "5", "role": "door", "tuya_device_id": "dev-ajto-SECRET", "meta": None},
                   {"pink": "X5", "role": "stove_breaker", "tuya_device_id": "dev-x5-SECRET",
                    "meta": {"add_ele": {"scale": 3}}},
                   {"pink": "P", "role": "stove_switch", "tuya_device_id": "dev-p-SECRET", "meta": None}]
        logs = {"dev-ajto-SECRET": [ev("doorcontact_state", True, MS(2026, 11, 7, 8)), ev("doorcontact_state", False, MS(2026, 11, 7, 8, 1)),
                                    ev("doorcontact_state", True, MS(2026, 11, 9, 8)), ev("doorcontact_state", False, MS(2026, 11, 9, 8, 1)),
                                    ev("doorcontact_state", True, MS(2026, 11, 9, 18)), ev("doorcontact_state", False, MS(2026, 11, 9, 18, 3))],
                # nov. 9.: 12 345 Wh = 12,345 kWh növekményekben; nov. 10. ugyanígy 10,000 kWh
                "dev-x5-SECRET": [ev("add_ele", 12000, MS(2026, 11, 9, 10)), ev("add_ele", 345, MS(2026, 11, 9, 20)),
                                  ev("add_ele", 10000, MS(2026, 11, 10, 10))],
                "dev-p-SECRET": []}
        rows = [{"pink": "5", "ts": "2026-11-08T07:00:00+00:00", "status": {"doorcontact_state": False}},
                {"pink": "5", "ts": "2026-11-09T18:01:00+00:00", "status": {"doorcontact_state": True}},
                {"pink": "P", "ts": "2026-11-08T07:00:00+00:00", "status": {"switch_1": True}}]
        # az első nap (nov. 8.) és a mai (nov. 11.) nem teljes nap: kimarad
        energy = [{"day": "2026-11-08", "pink": "X5", "kwh": 3.0}, {"day": "2026-11-09", "pink": "X5", "kwh": 12.3},
                  {"day": "2026-11-10", "pink": "X5", "kwh": 13.0}, {"day": "2026-11-11", "pink": "X5", "kwh": 1.0}]
        tc = FakeTuya(logs)
        res = TL.run(tc, FakeSb(devices, rows, energy), now, 7, 60, 10)
        d5, x5, p = res["devices"]["5"], res["devices"]["X5"], res["devices"]["P"]
        self.assertEqual((d5["opens_log"], d5["opens_log_all"], d5["opens_db"]), (2, 3, 1))
        self.assertEqual(x5["kwh_add_ele"], {"2026-11-09": 12.345, "2026-11-10": 10.0})
        self.assertEqual(x5["full_days"], ["2026-11-09", "2026-11-10"])
        self.assertEqual((x5["cmp_inc_db"]["same"], x5["cmp_inc_db"]["common"]), (1, 2))
        self.assertEqual(x5["collector_codes"], ["total_forward_energy", "add_ele"])
        self.assertIn("all_types", p)                            # nincs adatpont-jelentés: minden típus
        text = "\n".join(TL.summary_lines(res))
        self.assertIn("naplóban 2, nálunk 1 (7 nap alatt a naplóban: 3)", text)
        self.assertIn("1/2 nap egyezik", text)
        self.assertIn("adatgyűjtő számlálója: total_forward_energy, add_ele", text)
        for secret in ("SECRET", "12.3", "12,3", "12345", "2026-11-09", "18:0"):
            self.assertNotIn(secret, text)

    def test_stats_unavailable_is_reported_by_code(self):
        now = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
        devices = [{"pink": "X7", "role": "boiler", "tuya_device_id": "dev-x7", "meta": None}]
        res = TL.run(FakeTuya({}, fail={"stats"}), FakeSb(devices, [], []), now, 7, 60, 10)
        text = "\n".join(TL.summary_lines(res))
        self.assertIn("all-statistic-type=1106 (permission deny)", text)


if __name__ == "__main__":
    unittest.main()
