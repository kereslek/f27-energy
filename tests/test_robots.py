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


class QueueSb(FakeSb):
    """robot_cmd sor a memóriában (select status=eq.queued, update feltételes kiváltással)."""

    def __init__(self, cmds, auth=None):
        super().__init__(auth)
        self.cmds = cmds

    def select(self, table, columns="*", **f):
        if table == "robot_cmd":
            return [dict(c) for c in self.cmds if c["status"] == "queued"]
        return super().select(table, columns, **f)

    def update(self, table, patch, **f):
        out = []
        for c in self.cmds:
            if f"eq.{c['id']}" == f.get("id") and ("status" not in f or f["status"] == f"eq.{c['status']}"):
                c.update(patch); out.append(dict(c))
        return out


class RobotQueueTest(unittest.TestCase):
    def now(self, ago=0):
        from datetime import datetime, timedelta, timezone
        return (datetime.now(timezone.utc) - timedelta(seconds=ago)).isoformat()

    def test_executes_in_order_and_marks_done(self):
        sb = QueueSb([{"id": 1, "pink": "R2", "cmd": "find", "status": "queued", "created_at": self.now(5)},
                      {"id": 2, "pink": "R1", "cmd": "dock", "status": "queued", "created_at": self.now(2)}])
        seen = []
        with mock.patch.object(robots, "command", side_effect=lambda s, p, c, a=None: seen.append((p, c))), \
                mock.patch.object(robots, "collect", return_value=1), mock.patch.object(robots.time, "sleep"), redirect_stdout(io.StringIO()):
            self.assertEqual(robots.run_queue(sb), 2)
        self.assertEqual(seen, [("R2", "find"), ("R1", "dock")])
        self.assertEqual([c["status"] for c in sb.cmds], ["done", "done"])

    def test_old_command_expires_without_running(self):
        sb = QueueSb([{"id": 1, "pink": "R2", "cmd": "start", "status": "queued", "created_at": self.now(400)}])
        with mock.patch.object(robots, "command", side_effect=AssertionError("nem futhat")):
            self.assertEqual(robots.run_queue(sb), 0)
        self.assertEqual(sb.cmds[0]["status"], "expired")

    def test_error_note_masks_email_and_log_is_safe(self):
        sb = QueueSb([{"id": 7, "pink": "R2", "cmd": "start", "status": "queued", "created_at": self.now(1)}])
        buf = io.StringIO()
        with mock.patch.object(robots, "command", side_effect=RuntimeError("token lejárt valaki@pelda.hu")), \
                mock.patch.object(robots, "collect", return_value=0), mock.patch.object(robots.time, "sleep"), redirect_stdout(buf):
            robots.run_queue(sb)
        self.assertEqual(sb.cmds[0]["status"], "error")
        self.assertNotIn("@", sb.cmds[0]["note"]); self.assertNotIn("@", buf.getvalue())
        self.assertIn("R2 start HIBA (RuntimeError)", buf.getvalue())

    def test_find_is_a_known_command(self):
        self.assertIn("find", robots.COMMANDS); self.assertIn("find", robots.DREAME_ACTIONS)

    def test_watch_keeps_the_rhythm_even_without_table(self):
        sb = FakeSb()
        sb.select = mock.Mock(side_effect=robots.SupabaseError(404, "PGRST205"))
        clock = [0.0]
        with mock.patch.object(robots.time, "monotonic", side_effect=lambda: clock[0]), \
                mock.patch.object(robots.time, "sleep", side_effect=lambda s: clock.__setitem__(0, clock[0] + s)), redirect_stdout(io.StringIO()) as buf:
            robots.watch(sb, 60, every=10)
        self.assertGreaterEqual(clock[0], 60)
        self.assertEqual(buf.getvalue().count("014_robot_cmd"), 1)        # egyszer szól, nem spamel


class RoomCleanTest(unittest.TestCase):
    """Szobánkénti takarítás (015_robot_rooms.sql): szobák az állapotba, 'rooms' parancs a szegmensekkel."""

    def test_room_args_validation(self):
        self.assertEqual(robots.room_args([16, 17, 16]), [16, 17])
        for bad in ([], None, "16", [True], [0], [10000], ["16"], list(range(1, 18))):
            with self.assertRaises(ValueError):
                robots.room_args(bad)

    def test_rooms_command_sends_segment_clean(self):
        import asyncio
        sent = []

        class Cmd:
            async def send(self, c, params=None):
                sent.append((str(c), params))

        class Dev:
            v1_properties = type("P", (), {"command": Cmd()})()

        class Dm:
            async def close(self):
                pass

        async def fake_devices(auth):
            return Dm(), [Dev()]
        with mock.patch.object(robots, "_rr_devices", side_effect=fake_devices):
            asyncio.run(robots.rr_command({}, "rooms", [18, 16]))
        self.assertEqual(len(sent), 1)
        self.assertIn("app_segment_clean", sent[0][0].lower())
        self.assertEqual(sent[0][1], [{"segments": [18, 16], "repeat": 1}])

    def test_dreame_rooms_bad_args_rejected(self):
        sb = FakeSb({"xiaomi": {"service_token": "x"}})
        with mock.patch.object(robots, "mi_vacuums", return_value=[{"did": "d1"}]), \
                mock.patch.object(xiaomi_cloud, "action", side_effect=AssertionError("nem hívható")), \
                self.assertRaises(ValueError):
            robots.command(sb, "R1", "rooms", ["x"])

    def test_collect_stores_rooms_in_status(self):
        sb = FakeSb({"roborock": {"email": "x"}})
        st = {"state": "charging", "cleaning": False, "battery": 90, "charging": True, "area_m2": 0, "minutes": 0,
              "error": None, "src": "roborock", "rooms": [[16, "Előtér"], [17, "Kagyló szoba"]]}

        async def fake_status(auth):
            return [st]
        with mock.patch.object(robots, "rr_status", side_effect=fake_status):
            self.assertEqual(robots.collect(sb), 1)
        row = sb.inserts[0][1][0]
        self.assertEqual(row["status"]["rooms"], [[16, "Előtér"], [17, "Kagyló szoba"]])

    def test_queue_passes_args_and_log_has_no_room_names(self):
        from datetime import datetime, timezone
        sb = QueueSb([{"id": 3, "pink": "R2", "cmd": "rooms", "args": [16, 17], "status": "queued",
                       "created_at": datetime.now(timezone.utc).isoformat()}])
        seen, buf = [], io.StringIO()
        with mock.patch.object(robots, "command", side_effect=lambda s, p, c, a=None: seen.append((p, c, a))), \
                mock.patch.object(robots, "collect", return_value=1), mock.patch.object(robots.time, "sleep"), redirect_stdout(buf):
            robots.run_queue(sb)
        self.assertEqual(seen, [("R2", "rooms", [16, 17])])
        self.assertIn("R2 rooms OK", buf.getvalue())


class RobotTimerTest(unittest.TestCase):
    """Időzített indítás (017_robot_timer.sql): a gyűjtő csak a lejárt időzítőt veszi fel, a késettet 15 perc után lejártatja."""

    def now(self, ago=0):
        from datetime import datetime, timedelta, timezone
        return (datetime.now(timezone.utc) - timedelta(seconds=ago)).isoformat()

    def test_due_filter_and_timer_ttl(self):
        sb = QueueSb([{"id": 1, "pink": "R1", "cmd": "start", "status": "queued", "kind": "timer",
                       "created_at": self.now(7200), "due_at": self.now(120)},
                      {"id": 2, "pink": "R2", "cmd": "rooms", "args": [16], "status": "queued", "kind": "timer",
                       "created_at": self.now(7200), "due_at": self.now(3600)}])
        calls = {}
        orig = sb.select
        def sel(table, columns="*", **f):
            calls.update(f)
            return orig(table, columns, **f)
        sb.select = sel
        seen = []
        with mock.patch.object(robots, "command", side_effect=lambda s, p, c, a=None: seen.append((p, c))), \
                mock.patch.object(robots, "collect", return_value=1), mock.patch.object(robots.time, "sleep"), redirect_stdout(io.StringIO()) as buf:
            robots.run_queue(sb)
        self.assertTrue(calls.get("due_at", "").startswith("lte."))
        self.assertEqual(seen, [("R1", "start")])            # 2 perce lejárt: fut
        self.assertEqual(sb.cmds[1]["status"], "expired")    # 1 órája lejárt, a gyűjtő nem futott: lejár
        self.assertIn("(időzített) OK", buf.getvalue())


class ErrorPushTest(unittest.TestCase):
    """Elakadás és hiba: magyar szöveg, push egyszer a megjelenéskor, egyszer a megszűnéskor (2026.11.23)."""

    def test_error_info(self):
        self.assertIsNone(robots.error_info("xiaomi", 0))
        self.assertIsNone(robots.error_info("roborock", None))
        self.assertEqual(robots.error_info("xiaomi", 17)["key"], "stuck")
        self.assertEqual(robots.error_info("roborock", "robot_trapped")["key"], "stuck")
        self.assertEqual(robots.error_info("roborock", "main_brush_jammed")["key"], "brush")
        self.assertEqual(robots.error_info("roborock", "side_brush_error")["key"], "side_brush")
        self.assertEqual(robots.error_info("roborock", "wheels_suspended")["key"], "drop")
        odd = robots.error_info("xiaomi", 999)
        self.assertIn("999", odd["text"])
        self.assertTrue(odd["fix"])

    def test_plan_pushes(self):
        err = {"R1": {"status": {"state": "error", "error_key": "stuck", "error_text": "elakadt", "error_fix": "x"}}}
        ok = {"R1": {"status": {"state": "idle"}}}
        self.assertEqual([p["kind"] for p in robots.plan_error_pushes({"R1": {}}, err)], ["error"])
        self.assertEqual(robots.plan_error_pushes({"R1": {"error_key": "stuck"}}, err), [])      # már szóltunk
        self.assertEqual([p["kind"] for p in robots.plan_error_pushes({"R1": {"error_key": "stuck"}}, ok)], ["ok"])
        self.assertEqual(robots.plan_error_pushes({"R1": {"error_key": "stuck"}}, {"R1": {"status": {"state": "offline"}}}), [])
        self.assertEqual(robots.plan_error_pushes({}, ok), [])

    def test_push_message_has_fix_and_site(self):
        m = robots.push_message({"pink": "R1", "kind": "error", "text": "elakadt", "fix": "Szabadítsd ki.", "battery": 40})
        self.assertIn("R1", m["title"]); self.assertIn("Szabadítsd ki.", m["body"]); self.assertEqual(m["priority"], "high")
        self.assertNotIn("—", m["body"])

    def test_collect_marks_error_and_pushes_once(self):
        sb = FakeSb({"xiaomi": {"user_id": "1", "service_token": "t", "ssecurity": "s"}})
        mi = [{"id": "did", "name": "Dreame", "state": "idle", "cleaning": False, "battery": 40, "charging": False,
               "area_m2": 3, "minutes": 5, "error": 17, "src": "xiaomi", "online": True}]
        sent = []
        with mock.patch.object(robots, "mi_status", return_value=mi), \
                mock.patch.dict("f27.alerts.SENDERS", {"push": lambda msg, env: sent.append(msg)}), \
                mock.patch.dict(os.environ, {"NTFY_TOPIC": "t"}), redirect_stdout(io.StringIO()) as out:
            robots.collect(sb)
        st = sb.inserts[-1][1][0]["status"]
        self.assertEqual(st["error_key"], "stuck"); self.assertIn("elakadt", st["error_text"])
        self.assertIn("hiba: igen", out.getvalue())
        self.assertEqual(len(sent), 1)

    def test_merge_rooms(self):
        self.assertEqual(robots.merge_rooms([[16, "Előtér"], [17, ""]], [[17, "Kagyló"], [18, ""], [16, "x"]]),
                         [[16, "Előtér"], [17, "Kagyló"], [18, ""]])
        self.assertIsNone(robots.merge_rooms(None, None))

    def test_dreame_segment_params(self):
        p = robots.dreame_segment_in([3, 5])
        self.assertEqual(p[0], {"piid": 1, "value": 18})
        self.assertEqual(p[1]["piid"], 10)
        self.assertIn('"selects":[[3,1,1,2,1],[5,1,1,2,2]]', p[1]["value"])

    def test_dreame_rooms_command(self):
        sb = FakeSb({"xiaomi": {"user_id": "1", "service_token": "t", "ssecurity": "s"}})
        with mock.patch.object(robots, "mi_vacuums", return_value=[{"did": "d1"}]), \
                mock.patch.object(xiaomi_cloud, "action", return_value={"code": 0, "result": {"code": 0}}) as act, \
                mock.patch.object(robots.time, "sleep"):
            robots.command(sb, "R1", "rooms", [3])
        self.assertEqual(act.call_args.args[3:5], (4, 1))
        with mock.patch.object(robots, "mi_vacuums", return_value=[{"did": "d1"}]), \
                mock.patch.object(xiaomi_cloud, "action", return_value={"code": 0, "result": {"code": -4004}}), \
                mock.patch.object(robots.time, "sleep"), self.assertRaises(RuntimeError):
            robots.command(sb, "R1", "rooms", [3])
