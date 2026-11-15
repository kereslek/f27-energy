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


class XiaomiTwoStepTest(unittest.TestCase):
    """Kétlépcsős Xiaomi-belépés: kódküldés, függő állapot, kóddal befejezés (hálózat nélkül)."""

    NOTIF = "https://account.xiaomi.com/identity/authStart?sid=xiaomiio&context=CTX123&_locale=en_US"

    def fake(self, routes, calls):
        def j(sess, url, data=None, params=None):
            calls.append((url, dict(params or {}), dict(data or {})))
            for key, val in routes.items():
                if url.endswith(key):
                    return val(sess, params, data) if callable(val) else val
            return {}

        def op(sess, url, data=None, params=None):
            calls.append((url, dict(params or {}), dict(data or {})))
            if "sts" in url:
                xiaomi_cloud._cookie(sess.jar, "serviceToken", "TOK", ".api.io.mi.com")
            if "result/check" in url:
                xiaomi_cloud._cookie(sess.jar, "passToken", "PT", "account.xiaomi.com")
            return ""
        return mock.patch.multiple(xiaomi_cloud._Sess, j=j, open=op)

    def test_login_needing_2fa_sends_email_code(self):
        calls = []
        routes = {"/pass/serviceLogin": {"_sign": "S"},
                  "/pass/serviceLoginAuth2": {"code": 0, "notificationUrl": self.NOTIF},
                  "/identity/list": {"options": [4, 8]},
                  "/identity/auth/sendEmailTicket": {"code": 0}}
        with self.fake(routes, calls), self.assertRaises(xiaomi_cloud.NeedVerify) as cm:
            xiaomi_cloud.login("8297", "pw")
        self.assertEqual(cm.exception.channel, "e-mail")
        self.assertEqual(cm.exception.pending["context"], "CTX123")
        self.assertEqual(cm.exception.pending["flag"], 8)
        self.assertNotIn("pw", str(calls))                               # a jelszó csak MD5-ként megy át

    def test_sms_when_only_phone(self):
        calls = []
        routes = {"/pass/serviceLoginAuth2": {"notificationUrl": self.NOTIF}, "/identity/list": {"flag": 4},
                  "/identity/auth/sendPhoneTicket": {"code": 0}}
        with self.fake(routes, calls), self.assertRaises(xiaomi_cloud.NeedVerify) as cm:
            xiaomi_cloud.login("8297", "pw")
        self.assertEqual(cm.exception.channel, "SMS")

    def test_verify_with_code_then_login(self):
        calls = []
        def service_login(sess, params, data):
            return ({"code": 0, "ssecurity": "SS", "location": "https://sts.api.io.mi.com/sts?x", "userId": 42}
                    if sess.cookie("passToken") else {"_sign": "S"})
        routes = {"/identity/auth/verifyEmail": {"code": 0, "location": "https://account.xiaomi.com/identity/result/check?x"},
                  "/pass/serviceLogin": service_login}
        with self.fake(routes, calls):
            auth, sess = xiaomi_cloud.verify("8297", "pw", {"cookies": [], "context": "CTX123", "flag": 8}, " 123456 ")
        self.assertEqual(auth, {"user_id": "42", "service_token": "TOK", "ssecurity": "SS"})
        self.assertIn("passToken", [c[0] for c in sess["cookies"]])     # legközelebb kód nélkül
        ticket = [d for u, p, d in calls if u.endswith("verifyEmail") and d.get("ticket")]
        self.assertEqual(ticket[0]["ticket"], "123456"); self.assertEqual(ticket[0]["trust"], "true")

    def test_bad_code(self):
        with self.fake({"/identity/auth/verifyEmail": {"code": 70014}}, []), self.assertRaises(xiaomi_cloud.XiaomiError) as cm:
            xiaomi_cloud.verify("8297", "pw", {"cookies": [], "context": "C", "flag": 8}, "1")
        self.assertIn("hibás", str(cm.exception))

    def test_stable_device_id(self):
        a, b = xiaomi_cloud._Sess("8297"), xiaomi_cloud._Sess("8297")
        self.assertEqual(a.cookie("deviceId"), b.cookie("deviceId")); self.assertEqual(a.ua, b.ua)

    def test_main_stores_pending_and_collect_skips_it(self):
        sb = FakeSb()
        buf = io.StringIO()
        nv = xiaomi_cloud.NeedVerify({"cookies": [], "context": "C", "flag": 8}, "e-mail")
        with mock.patch.object(robots.SupabaseRest, "from_env", return_value=sb), mock.patch.object(robots, "mi_login", side_effect=nv), \
                mock.patch.dict(os.environ, {"XIAOMI_USERNAME": "u", "XIAOMI_PASSWORD": "p"}), redirect_stdout(buf):
            self.assertEqual(robots.main(["xiaomi"]), 0)
        self.assertIn("xiaomi-kod", buf.getvalue())
        table, rows = sb.upserts[0]
        self.assertEqual(rows[0]["id"], "xiaomi"); self.assertIn("pending", rows[0]["data"])
        sb2 = FakeSb({"xiaomi": rows[0]["data"]})
        with mock.patch.object(robots, "mi_status", side_effect=AssertionError("nem hívható")):
            self.assertEqual(robots.collect(sb2), 0)

    def test_main_code_step(self):
        sb = FakeSb({"xiaomi": {"pending": {"cookies": [], "context": "C", "flag": 8}}})
        buf = io.StringIO()
        with mock.patch.object(robots.SupabaseRest, "from_env", return_value=sb), \
                mock.patch.object(robots, "mi_verify", return_value=({"user_id": "1", "service_token": "t", "ssecurity": "s"}, {"cookies": []})) as mv, \
                mock.patch.object(robots, "mi_status", return_value=[{}]), \
                mock.patch.dict(os.environ, {"XIAOMI_USERNAME": "u", "XIAOMI_PASSWORD": "p", "ROBOT_CODE": "654321"}), redirect_stdout(buf):
            self.assertEqual(robots.main(["xiaomi-kod"]), 0)
        self.assertEqual(mv.call_args.args[3], "654321")
        data = sb.upserts[0][1][0]["data"]
        self.assertNotIn("pending", data); self.assertIn("session", data)
        self.assertIn("Xiaomi: OK, 1", buf.getvalue())
