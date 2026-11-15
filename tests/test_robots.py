"""Robotporszívók (f27/robots.py, f27/xiaomi_cloud.py) offline: a gyártói felhőt nem hívjuk."""
import base64
import io
import os
import unittest
from contextlib import redirect_stdout
from unittest import mock

from f27 import robots, xiaomi_cloud


class FakeSb:
    def __init__(self, auth=None):
        self.auth = auth or {}
        self.upserts, self.inserts = [], []

    def select(self, table, columns="*", **f):
        key = f.get("id", "eq.").split("eq.", 1)[1]
        return [{"data": self.auth[key]}] if key in self.auth else []

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows))

    def insert(self, table, rows):
        self.inserts.append((table, rows))


class CollectTest(unittest.TestCase):
    def test_no_login_writes_nothing(self):
        sb = FakeSb()
        self.assertEqual(robots.collect(sb), 0)
        self.assertEqual(sb.inserts, [])

    def test_both_robots_to_device_status(self):
        sb = FakeSb({"roborock": {"email": "x", "user_data": {}}, "xiaomi": {"user_id": "1", "service_token": "t", "ssecurity": "s"}})
        rr = [{"id": "duid", "name": "Roborock S7", "state": "cleaning", "cleaning": True, "battery": 64, "charging": False,
               "area_m2": 18.2, "minutes": 22, "error": None, "src": "roborock"}]
        mi = [{"id": "did", "name": "Dreame", "state": "charged", "cleaning": False, "battery": 100, "charging": True,
               "area_m2": 0, "minutes": 0, "error": None, "src": "xiaomi", "online": True}]
        with mock.patch.object(robots, "rr_status", new=mock.AsyncMock(return_value=rr)), mock.patch.object(robots, "mi_status", return_value=mi):
            self.assertEqual(robots.collect(sb), 2)
        devs = {r["pink"]: r for r in sb.upserts[0][1]}
        self.assertEqual(devs["R1"]["role"], "robot"); self.assertEqual(devs["R2"]["room"], "eloter")
        rows = {r["pink"]: r for r in sb.inserts[0][1]}
        self.assertEqual(rows["R2"]["status"]["state"], "cleaning")
        self.assertEqual(rows["R1"]["status"]["battery"], 100)
        # azonosító, név nem kerül a status-ba
        for r in rows.values():
            self.assertNotIn("id", r["status"]); self.assertNotIn("name", r["status"])

    def test_one_vendor_failing_keeps_the_other(self):
        sb = FakeSb({"roborock": {"email": "x", "user_data": {}}, "xiaomi": {"user_id": "1", "service_token": "t", "ssecurity": "s"}})
        mi = [{"id": "d", "state": "idle", "cleaning": False, "battery": 80, "src": "xiaomi", "online": True}]
        buf = io.StringIO()
        with mock.patch.object(robots, "rr_status", new=mock.AsyncMock(side_effect=RuntimeError("secret@mail.hu token"))), \
                mock.patch.object(robots, "mi_status", return_value=mi), redirect_stdout(buf):
            self.assertEqual(robots.collect(sb), 1)
        self.assertNotIn("@", buf.getvalue())                     # a publikus logba nem kerül e-mail
        self.assertIn("Roborock: HIBA", buf.getvalue())


class MainTest(unittest.TestCase):
    def test_error_message_masks_email(self):
        buf = io.StringIO()
        with mock.patch.object(robots.SupabaseRest, "from_env", return_value=FakeSb()), \
                mock.patch.object(robots, "mi_login", side_effect=RuntimeError("bad user valaki@pelda.hu")), \
                mock.patch.dict(os.environ, {"XIAOMI_USERNAME": "u", "XIAOMI_PASSWORD": "p"}), redirect_stdout(buf):
            self.assertEqual(robots.main(["xiaomi"]), 1)
        self.assertNotIn("valaki@pelda.hu", buf.getvalue())
        self.assertIn("<e-mail>", buf.getvalue())

    def test_unknown_command_rejected(self):
        with self.assertRaises(ValueError):
            robots.command(FakeSb(), "R9", "start")
        with self.assertRaises(ValueError):
            robots.command(FakeSb(), "R1", "selfdestruct")


class XiaomiCryptoTest(unittest.TestCase):
    def test_rc4_roundtrip_and_signature_stable(self):
        ss = base64.b64encode(b"0123456789abcdef").decode()
        n = xiaomi_cloud._nonce()
        sn = xiaomi_cloud._signed_nonce(ss, n)
        self.assertEqual(xiaomi_cloud._rc4(sn, xiaomi_cloud._rc4(sn, b"hello")), b"hello")
        url = "https://de.api.io.mi.com/app/miotspec/prop/get"
        a = xiaomi_cloud._enc_signature(url, "POST", sn, {"data": "x"})
        self.assertEqual(a, xiaomi_cloud._enc_signature(url, "POST", sn, {"data": "x"}))
        self.assertNotEqual(a, xiaomi_cloud._enc_signature(url, "POST", sn, {"data": "y"}))


if __name__ == "__main__":
    unittest.main()
