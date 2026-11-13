"""Offline tesztek: párosítás, Supabase eszközlista, adatgyűjtő, napi energia.

Futtatás a repó gyökeréből:  python -m unittest discover -s tests -v

Valódi Tuya és Supabase helyett helyi álszervereket használ (http.server).
A szintetikus eszközlista két otthont tartalmaz (F27 és egy másik ingatlan).
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from f27 import bookings as BK
from f27 import collect as C
from f27 import discover as D
from f27 import weather as WX
from f27.supa import SupabaseRest
from f27.tuya import TuyaClient

os.environ["no_proxy"] = os.environ["NO_PROXY"] = "127.0.0.1,localhost"
CFG = json.loads((Path(__file__).resolve().parent.parent / "config" / "devices.json").read_text(encoding="utf-8"))
F27, OTHER = "home-f27-aaaa", "home-masik-bbbb"

# ----------------------------------------------------------------------------- szintetikus eszközök

def dev(i, name, cat, home, status=None, online=True):
    return {"id": f"devid{i:03d}secret", "name": name, "category": cat, "owner_id": home, "online": online,
            "local_key": "LOCALKEY-SECRET", "ip": "10.0.0.1", "uid": "UID-SECRET",
            "status": [{"code": k, "value": v} for k, v in (status or {}).items()]}


def fleet():
    f = [
        dev(1, "F27 - Hőmérő - Kis szoba", "wsdcg", F27, {"va_temperature": 236, "va_humidity": 41}),
        dev(2, "F27 - Hőmérő - Nagyszoba", "wsdcg", F27, {"va_temperature": 205}),
        dev(3, "F27 - Hőmérő - Cserépkályha mögött", "wsdcg", F27, {"va_temperature": 384}),
        dev(4, "F27 - Hőmérő - Fürdőszoba", "wsdcg", F27, {"va_temperature": 223}),
        dev(5, "F27 - bejárati ajtó", "mcs", F27, {"doorcontact_state": False}),
        dev(6, "F27 - tároló helyiség", "mcs", F27, {"doorcontact_state": False}),
        dev(7, "F27 - Konyha ablak", "mcs", F27, {"doorcontact_state": False}),
        dev(8, "F27 - Kis szoba - ablak", "mcs", F27, {"doorcontact_state": True}),
        dev(9, "F27 - Nagy szoba - bal ablak", "mcs", F27, {"doorcontact_state": False}),
        dev(10, "F27 - Nagy szoba - jobb ablak", "mcs", F27, {"doorcontact_state": False}),
        dev(11, "Klíma a Smart IR-en belül", "infrared_ac", F27, {}),
        dev(12, "Cserépkályha kapcsoló (új)", "kg", F27, {"switch_1": True, "switch_2": True, "switch_3": False}),
        dev(13, "Cserépkályha kismegszakító (5.)", "dlq", F27, {"switch": True, "cur_power": 19870, "total_forward_energy": 123456}),
        dev(14, "Fürdőszoba bojler (melegvíz) (7.)", "dlq", F27, {"switch": True, "cur_power": 0, "total_forward_energy": 50000}),
        dev(15, "Konyhai főzőlap és sütő (8.)", "dlq", F27, {"switch": True, "cur_power": 0, "total_forward_energy": 7000}),
        dev(16, "Klíma kismegszakító (9.)", "dlq", F27, {"switch": True, "cur_power": 6420, "total_forward_energy": 9000}),
        dev(17, "Zigbee Gateway", "wg2", F27, {}),
        # az F27 otthon párosítatlan eszköze és egy második "klíma" nevű IR-gomb
        dev(18, "TV konnektor", "cz", F27, {"switch_1": True}),
        dev(19, "Klíma régi távirányító", "qt", F27, {}),
        # másik ingatlan: ütköző nevek
        dev(31, "Klíma nappali", "infrared_ac", OTHER, {}),
        dev(32, "Klíma háló", "infrared_ac", OTHER, {}),
        dev(33, "Klíma kismegszakító", "dlq", OTHER, {"cur_power": 0}),
        dev(34, "Bojler", "dlq", OTHER, {"cur_power": 15000}),
        dev(35, "Gateway", "wg2", OTHER, {}),
        dev(36, "Hőmérő - Nagyszoba", "wsdcg", OTHER, {"va_temperature": 199}),
    ]
    return f


SPEC = {"dlq": [{"code": "cur_power", "type": "Integer", "values": json.dumps({"unit": "W", "scale": 1})},
                {"code": "total_forward_energy", "type": "Integer", "values": json.dumps({"unit": "kW·h", "scale": 2})}],
        "wsdcg": [{"code": "va_temperature", "type": "Integer", "values": json.dumps({"unit": "℃", "scale": 1})}]}

# ----------------------------------------------------------------------------- álszerverek

class _Server:
    def __init__(self, handler):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def tuya_server(devices):
    state = {"devices": devices, "calls": 0, "unsigned": 0, "logs": {}, "log_calls": 0, "log_fail": None}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, result, ok=True):
            body = json.dumps({"success": ok, "result": result} if ok else {"success": False, "code": 1004, "msg": "sign invalid"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            state["calls"] += 1
            if not (self.headers.get("sign") and self.headers.get("client_id") and self.headers.get("t")):
                state["unsigned"] += 1
            u = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(u.query)
            if u.path == "/v1.0/token":
                return self._send({"access_token": "tok", "expire_time": 7200})
            if u.path == "/v1.0/iot-01/associated-users/devices":
                if state.get("fail_list"):
                    return self._send(None, ok=False)
                return self._send({"devices": state["devices"], "has_more": False})
            if u.path.startswith("/v1.0/iot-03/devices/") and u.path.endswith("/specification"):
                did = u.path.split("/")[4]
                cat = next(d["category"] for d in state["devices"] if d["id"] == did)
                return self._send({"category": cat, "status": SPEC.get(cat, []), "functions": []})
            if u.path.startswith("/v1.0/devices/") and u.path.endswith("/logs"):
                state["log_calls"] += 1
                if state.get("log_fail"):
                    body = json.dumps({"success": False, "code": state["log_fail"][0], "msg": state["log_fail"][1]}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    return self.wfile.write(body)
                did = u.path.split("/")[3]
                a, b = int(q["start_time"][0]), int(q["end_time"][0])
                evs = sorted((e for e in state["logs"].get(did, []) if a <= e["event_time"] <= b),
                             key=lambda e: -e["event_time"])                 # a Tuya csökkenő sorrendben ad
                i = int(q.get("start_row_key", ["0"])[0])
                chunk, nxt = evs[i:i + 100], i + 100
                return self._send({"logs": chunk, "has_next": nxt < len(evs), "next_row_key": str(nxt) if nxt < len(evs) else None})
            if u.path == "/v1.0/iot-03/devices/status":
                ids = q["device_ids"][0].split(",")
                return self._send([{"id": d["id"], "status": d["status"]} for d in state["devices"] if d["id"] in ids])
            self.send_response(404)
            self.end_headers()

    s = _Server(H)
    s.state = state
    return s


def _filt(rows, q, cols):
    """Egyszerű PostgREST-szűrés a fake-hez: eq., gte., lt., in.(), is.null, order, offset, limit."""
    for c in cols:
        v = q.get(c, "")
        if v.startswith("eq."):
            rows = [r for r in rows if str(r.get(c)) == v[3:]]
        elif v.startswith("gte."):
            rows = [r for r in rows if str(r.get(c)) >= v[4:]]
        elif v.startswith("lt."):
            rows = [r for r in rows if str(r.get(c)) < v[3:]]
        elif v.startswith("in.("):
            rows = [r for r in rows if str(r.get(c)) in v[4:-1].split(",")]
    o = q.get("order", "")
    if o:
        col, _, d = o.partition(".")
        rows = sorted(rows, key=lambda r: str(r.get(col)), reverse=d == "desc")
    off = int(q.get("offset", 0))
    rows = rows[off:]
    if "limit" in q:
        rows = rows[: int(q["limit"])]
    return rows


def supa_server(secret="sb_secret_TEST", missing=(), no_tables=(), history=False):
    """Memóriában tartott PostgREST-utánzat. missing: hiányzó oszlopok (pl. 'meta'),
    no_tables: hiányzó táblák (pl. 'weather_hourly')."""
    db = {"devices": {}, "device_status": [], "energy_daily": {}, "weather_hourly": {}, "bookings": {},
          "alert_settings": {}, "alert_state": {}, "alert_log": []}
    if history:                                  # a 007-es migráció táblái
        db.update(tuya_log={}, metrics_hourly={}, energy_app_history=[])
    log = {"bad_auth": 0, "requests": []}

    def latest():
        out = {}
        for r in db["device_status"]:
            if r["pink"] not in out or r["ts"] >= out[r["pink"]]["ts"]:
                out[r["pink"]] = r
        return list(out.values())

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def _auth(self):
            ok = self.headers.get("apikey") == secret and self.headers.get("Authorization") == f"Bearer {secret}"
            if not ok:
                log["bad_auth"] += 1
                self._json(401, {"message": "Invalid API key"})
            return ok

        def _missing_col(self, cols):
            for c in cols:
                if c in missing:
                    self._json(400, {"code": "PGRST204", "message": f"Could not find the '{c}' column", "details": "secret detail"})
                    return True
            return False

        def do_GET(self):
            if not self._auth():
                return
            u = urllib.parse.urlparse(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            table = u.path.split("/")[-1]
            cols = [c for c in q.get("select", "*").split(",") if c != "*"]
            if self._missing_col(cols):
                return
            if table in no_tables:
                return self._json(404, {"code": "PGRST205"})
            if table == "devices":
                rows = list(db["devices"].values())
            elif table == "weather_hourly":
                rows = list(db["weather_hourly"].values())
                if q.get("order") == "fetched_at.desc":
                    rows.sort(key=lambda r: r["fetched_at"], reverse=True)
                if "limit" in q:
                    rows = rows[: int(q["limit"])]
            elif table == "bookings":
                rows = list(db["bookings"].values())
                if q.get("source", "").startswith("eq."):
                    rows = [r for r in rows if r["source"] == q["source"][3:]]
                if q.get("end_date", "").startswith("gte."):
                    rows = [r for r in rows if r["end_date"] >= q["end_date"][4:]]
                if q.get("order") == "seen_at.desc":
                    rows.sort(key=lambda r: r["seen_at"], reverse=True)
                if q.get("order") == "start_date.asc":
                    rows.sort(key=lambda r: r["start_date"])
                if "limit" in q:
                    rows = rows[: int(q["limit"])]
            elif table == "device_latest":
                rows = latest()
            elif table == "device_status":
                rows = list(db["device_status"])
                if q.get("status->>_src", "").startswith("eq."):
                    rows = [r for r in rows if (r.get("status") or {}).get("_src") == q["status->>_src"][3:]]
                if q.get("pink", "").startswith("eq."):
                    rows = [r for r in rows if r["pink"] == q["pink"][3:]]
                if q.get("ts", "").startswith("gte."):
                    rows = [r for r in rows if r["ts"] >= q["ts"][4:]]
                if q.get("order") == "ts.desc":
                    rows.sort(key=lambda r: r["ts"], reverse=True)
                if "limit" in q:
                    rows = rows[: int(q["limit"])]
            elif table == "alert_settings":
                rows = list(db["alert_settings"].values())
                if q.get("id", "").startswith("eq."):
                    rows = [r for r in rows if str(r["id"]) == q["id"][3:]]
            elif table == "alert_state":
                rows = list(db["alert_state"].values())
            elif table == "alert_log":
                rows = list(db["alert_log"])
                if q.get("kind", "").startswith("eq."):
                    rows = [r for r in rows if r["kind"] == q["kind"][3:]]
                if q.get("rule_key", "").startswith("eq."):
                    rows = [r for r in rows if r.get("rule_key") == q["rule_key"][3:]]
                if q.get("ts", "").startswith("gte."):
                    rows = [r for r in rows if r["ts"] >= q["ts"][4:]]
                if q.get("order") == "ts.desc":
                    rows.sort(key=lambda r: r["ts"], reverse=True)
                if q.get("order") == "ts.asc":
                    rows.sort(key=lambda r: r["ts"])
                if "limit" in q:
                    rows = rows[: int(q["limit"])]
            elif table == "weather_daily" and "weather_daily" in db:
                rows = _filt(list(db["weather_daily"]), q, ("day",))
            elif table in ("tuya_log", "metrics_hourly", "energy_app_history") and table in db:
                src = db[table].values() if isinstance(db[table], dict) else db[table]
                rows = _filt(list(src), q, ("pink", "ts", "hour", "period", "period_start"))
            elif table == "energy_daily" and ("gte." in q.get("day", "") or "offset" in q):
                rows = _filt(list(db["energy_daily"].values()), q, ("day", "pink"))
            elif table == "energy_daily":
                rows = list(db["energy_daily"].values())
                if q.get("day", "").startswith("eq."):
                    rows = [r for r in rows if r["day"] == q["day"][3:]]
                if q.get("pink", "").startswith("in.("):
                    allowed = q["pink"][4:-1].split(",")
                    rows = [r for r in rows if r["pink"] in allowed]
                if q.get("order") == "day.desc":
                    rows.sort(key=lambda r: r["day"], reverse=True)
                if "limit" in q:
                    rows = rows[: int(q["limit"])]
            else:
                return self._json(404, {"code": "PGRST205"})
            if cols:
                rows = [{c: r.get(c) for c in cols} for r in rows]
            self._json(200, rows)

        def do_POST(self):
            if not self._auth():
                return
            u = urllib.parse.urlparse(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            table = u.path.split("/")[-1]
            rows = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            log["requests"].append((table, len(rows)))
            if self._missing_col({k for r in rows for k in r}):
                return
            if table in no_tables:
                return self._json(404, {"code": "PGRST205"})
            if table == "weather_hourly":
                assert q.get("on_conflict") == "ts"
                for r in rows:
                    db["weather_hourly"][r["ts"]] = r
            elif table == "bookings":
                assert q.get("on_conflict") == "id"
                for r in rows:
                    db["bookings"][r["id"]] = r
            elif table == "devices":
                for r in rows:
                    db["devices"][r["pink"]] = {**db["devices"].get(r["pink"], {}), **r}
            elif table == "alert_state":
                assert q.get("on_conflict") == "rule_key"
                for r in rows:
                    db["alert_state"][r["rule_key"]] = r
            elif table == "alert_settings":
                for r in rows:
                    db["alert_settings"][r.get("id", 1)] = {**db["alert_settings"].get(r.get("id", 1), {}), **r}
            elif table == "alert_log":
                for r in rows:
                    db["alert_log"].append({"id": len(db["alert_log"]) + 1, **r})
            elif table == "device_status":
                db["device_status"].extend(rows)
            elif table == "energy_daily":
                assert q.get("on_conflict") == "day,pink"
                for r in rows:
                    db["energy_daily"][(r["day"], r["pink"])] = dict(db["energy_daily"].get((r["day"], r["pink"]), {}), **r)
            elif table == "tuya_log" and "tuya_log" in db:
                assert q.get("on_conflict") == "pink,ts,code"
                for r in rows:
                    db["tuya_log"][(r["pink"], r["ts"], r["code"])] = r
            elif table == "metrics_hourly" and "metrics_hourly" in db:
                assert q.get("on_conflict") == "pink,hour"
                for r in rows:
                    db["metrics_hourly"][(r["pink"], r["hour"])] = dict(r)
            self.send_response(201)
            self.end_headers()

        def do_DELETE(self):
            if not self._auth():
                return
            u = urllib.parse.urlparse(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
            table = u.path.split("/")[-1]
            log["requests"].append((table, "DELETE"))
            if table in no_tables:
                return self._json(404, {"code": "PGRST205"})
            if table == "tuya_log" and "tuya_log" in db:
                assert q.get("ts", "").startswith("lt.")
                for k, r in list(db["tuya_log"].items()):
                    if r["ts"] < q["ts"][3:]:
                        del db["tuya_log"][k]
                self.send_response(204)
                return self.end_headers()
            if table == "device_status":
                assert q.get("ts", "").startswith("lt.") and q.get("status->>_src") == "is.null"
                db["device_status"] = [r for r in db["device_status"]
                                       if not (r["ts"] < q["ts"][3:] and not (r.get("status") or {}).get("_src"))]
                self.send_response(204)
                return self.end_headers()
            assert table == "bookings" and q, "csak szűrős törlés"
            for rid, r in list(db["bookings"].items()):
                ok = True
                if q.get("source", "").startswith("eq."):
                    ok &= r["source"] == q["source"][3:]
                if q.get("id", "").startswith("in.("):
                    ok &= rid in q["id"][4:-1].split(",")
                if ok:
                    del db["bookings"][rid]
            self.send_response(204)
            self.end_headers()

    s = _Server(H)
    s.db, s.log, s.secret = db, log, secret
    return s


@contextlib.contextmanager
def env(**kw):
    old = {k: os.environ.get(k) for k in kw}
    for k, v in kw.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        yield
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def run_main(fn):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = fn()
    return rc, buf.getvalue()


# Smart Life nevek, azonosítók és mérési értékek (a config saját címkéi, pl. "Kis szoba ablak", publikusak).
SECRET_BITS = ["devid", "secret", "LOCALKEY", "UID-SECRET", F27, OTHER, "F27 - ", "Klíma a Smart",
               "Fürdőszoba bojler", "TV konnektor", "Klíma nappali", "Bojler", "19870", "123456", "1987"]


def assert_public(t: unittest.TestCase, out: str):
    for bit in SECRET_BITS:
        t.assertNotIn(bit, out, f"a publikus kimenetben nem lehet: {bit!r}")

# ----------------------------------------------------------------------------- párosítás

class TestMatch(unittest.TestCase):
    def test_multi_home_resolves_conflicts(self):
        res = D.match_devices(fleet(), CFG["devices"], CFG["role_categories"])
        self.assertTrue(res.home_filter)
        self.assertEqual(res.conflicts, {})
        self.assertEqual(len(res.mapping), 17)
        self.assertEqual(res.mapping["11"]["id"], "devid011secret")
        self.assertEqual(res.mapping["X7"]["id"], "devid014secret")
        self.assertEqual(res.mapping["X9"]["id"], "devid016secret")
        self.assertEqual(res.mapping["2"]["id"], "devid002secret")
        self.assertEqual(res.other_home_count, 6)
        self.assertEqual([d["name"] for d in res.unmatched], ["TV konnektor"])

    def test_without_home_ids_category_and_exact_still_resolve(self):
        f = fleet()
        for d in f:
            d.pop("owner_id")
        res = D.match_devices(f, CFG["devices"], CFG["role_categories"])
        self.assertFalse(res.home_filter)
        self.assertEqual(res.mapping["11"]["id"], "devid011secret")   # pontos név nyer
        self.assertEqual(res.mapping["X7"]["id"], "devid014secret")
        self.assertIn("G", res.conflicts)                              # két gateway, egyik sem pontos név

    def test_soft_category_keeps_single_candidate(self):
        f = [d for d in fleet() if d["owner_id"] == F27]
        next(d for d in f if d["id"] == "devid012secret")["category"] = "tdq_ismeretlen"
        res = D.match_devices(f, CFG["devices"], CFG["role_categories"])
        self.assertIn("P", res.mapping)
        self.assertEqual(res.category_mismatch, {"P": "tdq_ismeretlen"})

    def test_only_in_other_home(self):
        f = [d for d in fleet() if d["id"] != "devid014secret"]
        res = D.match_devices(f, CFG["devices"], CFG["role_categories"])
        self.assertNotIn("X7", res.mapping)
        self.assertEqual(res.only_other_home.get("X7"), 1)
        lines = "\n".join(D.summary_lines(CFG["devices"], res, len(f)))
        self.assertIn("nincs (csak más otthonban: 1)", lines)

    def test_conflict_summary_shows_only_categories(self):
        f = fleet()
        for d in f:
            d.pop("owner_id")
        res = D.match_devices(f, CFG["devices"], CFG["role_categories"])
        out = "\n".join(D.summary_lines(CFG["devices"], res, len(f)))
        self.assertIn("ÜTKÖZÉS (2): kategóriák: wg2, wg2", out)
        assert_public(self, out)

# ----------------------------------------------------------------------------- felderítés vége-vége

class TestDiscover(unittest.TestCase):
    def setUp(self):
        self.tuya = tuya_server(fleet())
        self.tmp = tempfile.TemporaryDirectory()
        self._data = D.DATA
        D.DATA = Path(self.tmp.name)

    def tearDown(self):
        D.DATA = self._data
        self.tuya.close()
        self.tmp.cleanup()

    def _env(self, sb=None):
        return env(TUYA_ACCESS_ID="id", TUYA_ACCESS_SECRET="sec", TUYA_ENDPOINT=self.tuya.url, TUYA_UID=None,
                   F27_DATA_PASSWORD="teszt-jelszo-1234", GITHUB_STEP_SUMMARY=None,
                   SUPABASE_URL=sb.url if sb else None, SUPABASE_SECRET_KEY=sb.secret if sb else None)

    def test_upserts_devices_with_meta(self):
        sb = supa_server()
        try:
            with self._env(sb):
                rc, out = run_main(D.main)
            self.assertEqual(rc, 0)
            self.assertEqual(len(sb.db["devices"]), 17)
            x5 = sb.db["devices"]["X5"]
            self.assertEqual(x5["tuya_device_id"], "devid013secret")
            self.assertEqual(x5["role"], "breaker")
            self.assertEqual(x5["meta"]["cur_power"]["scale"], 1)
            self.assertEqual(x5["meta"]["total_forward_energy"]["scale"], 2)
            self.assertEqual(sb.log["bad_auth"], 0)
            self.assertEqual(self.tuya.state["unsigned"], 0)
            self.assertIn("Párosítva: 17/17", out)
            self.assertIn("17 eszköz frissítve (skálákkal)", out)
            self.assertTrue((D.DATA / "latest.json.enc").exists())
            assert_public(self, out)
            # specifikáció csak a párosított eszközökhöz: token + lista + 17
            self.assertEqual(self.tuya.state["calls"], 19)
        finally:
            sb.close()

    def test_missing_meta_column_falls_back(self):
        sb = supa_server(missing=("meta",))
        try:
            with self._env(sb):
                rc, out = run_main(D.main)
            self.assertEqual(rc, 0)
            self.assertEqual(len(sb.db["devices"]), 17)
            self.assertNotIn("meta", sb.db["devices"]["X5"])
            self.assertIn("002_device_meta.sql", out)
            assert_public(self, out)
        finally:
            sb.close()

    def test_tuya_error_hides_path_and_ids(self):
        self.tuya.state["fail_list"] = True
        with self._env(None), env(TUYA_UID="UID-SECRET-123"):
            rc, out = run_main(D.main)
        self.assertEqual(rc, 1)
        self.assertIn("Tuya eszközlista hiba: code=", out)   # UID mellett a /users/{uid}/devices ág fut
        self.assertNotIn("/v1.0", out)
        self.assertNotIn("UID-SECRET-123", out)

    def test_without_supabase_secret_skips(self):
        with self._env(None):
            rc, out = run_main(D.main)
        self.assertEqual(rc, 0)
        self.assertIn("Supabase: kihagyva", out)
        assert_public(self, out)

# ----------------------------------------------------------------------------- adatgyűjtő

T0 = datetime(2026, 11, 8, 10, 0, tzinfo=timezone.utc)


class TestCollect(unittest.TestCase):
    def setUp(self):
        self.f = fleet()
        self.tuya = tuya_server(self.f)
        self.sb = supa_server()
        res = D.match_devices(self.f, CFG["devices"], CFG["role_categories"])
        specs = {d["id"]: {"status": SPEC.get(d["category"], [])} for d in res.mapping.values()}
        D.push_devices(SupabaseRest(self.sb.url, self.sb.secret), CFG["devices"], res, specs)

    def tearDown(self):
        self.tuya.close()
        self.sb.close()

    def run_at(self, when):
        client = TuyaClient("id", "sec", self.tuya.url)
        return C.collect(client, SupabaseRest(self.sb.url, self.sb.secret), now=when)

    def setv(self, did, code, value):
        d = next(x for x in self.f if x["id"] == did)
        for s in d["status"]:
            if s["code"] == code:
                s["value"] = value
                return
        d["status"].append({"code": code, "value": value})

    def test_first_run_writes_all_then_nothing(self):
        s1 = self.run_at(T0)
        self.assertEqual(s1["devices"], 17)
        self.assertEqual(s1["written"], 17)
        self.assertEqual(s1["tuya_calls"], 2)          # token + eszközlista
        s2 = self.run_at(T0 + timedelta(minutes=10))
        self.assertEqual(s2["written"], 0)
        self.assertEqual(s2["unchanged"], 17)

    def test_change_and_noise(self):
        self.run_at(T0)
        self.setv("devid008secret", "doorcontact_state", False)      # ablak becsukva: írni kell
        self.setv("devid013secret", "cur_power", 19900)              # +3 W: zaj, nem kell
        self.setv("devid013secret", "cur_voltage", 2301)             # feszültség: nem számít
        self.setv("devid014secret", "total_forward_energy", 50010)   # számláló: nem számít
        s = self.run_at(T0 + timedelta(minutes=10))
        self.assertEqual(s["written"], 1)
        self.assertEqual(self.sb.db["device_status"][-1]["pink"], "8")
        self.setv("devid013secret", "cur_power", 0)                  # kályha kikapcsolt: írni kell
        s = self.run_at(T0 + timedelta(minutes=20))
        self.assertEqual(s["written"], 1)

    def test_slow_power_drift_is_written_once(self):
        self.run_at(T0)
        writes = []
        for i, raw in enumerate((19950, 20030, 20100, 20150), start=1):   # +8, +16, +23, +28 W a tárolthoz képest
            self.setv("devid013secret", "cur_power", raw)
            writes.append(self.run_at(T0 + timedelta(minutes=10 * i))["written"])
        self.assertEqual(writes, [0, 0, 0, 1])

    def test_online_change_writes(self):
        self.run_at(T0)
        next(x for x in self.f if x["id"] == "devid004secret")["online"] = False
        s = self.run_at(T0 + timedelta(minutes=10))
        self.assertEqual(s["written"], 1)

    def test_update_time_is_stored_but_not_a_change(self):
        d = next(x for x in self.f if x["id"] == "devid001secret")
        d["update_time"] = 1793990000
        self.run_at(T0)
        row = next(r for r in self.sb.db["device_status"] if r["pink"] == "1")
        self.assertEqual(row["status"]["_upd"], 1793990000)
        d["update_time"] = 1793990600                                   # csak a jelentés-idő változott
        self.assertEqual(self.run_at(T0 + timedelta(minutes=10))["written"], 0)
        d.pop("update_time"); d["active_time"] = 1793991200000           # ms-ban is jöhet
        self.assertEqual(C.device_update_time(d), 1793991200)
        self.assertIsNone(C.device_update_time({"update_time": 0}))
        self.assertEqual(C.signature({"a": 1, "_upd": 5, "cur_power": 3}), {"a": 1})

    def test_hourly_heartbeat(self):
        self.run_at(T0)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=59))["written"], 0)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=60))["written"], 17)

    def test_energy_daily_and_midnight_budapest(self):
        # 2026.11.08 23:55 budapesti idő = 22:55 UTC (téli idő, UTC+1)
        t1 = datetime(2026, 11, 8, 22, 55, tzinfo=timezone.utc)
        self.run_at(t1)
        e = self.sb.db["energy_daily"]
        self.assertEqual(e[("2026-11-08", "X5")]["kwh"], 0.0)          # első megfigyelés
        self.assertEqual(e[("2026-11-08", "X5")]["last_counter"], 1234.56)
        self.setv("devid013secret", "total_forward_energy", 123456 + 50)   # +0,5 kWh
        self.run_at(t1 + timedelta(minutes=4))                          # 23:59 helyi
        self.assertEqual(e[("2026-11-08", "X5")]["kwh"], 0.5)
        self.setv("devid013secret", "total_forward_energy", 123456 + 80)   # +0,3 kWh
        self.run_at(t1 + timedelta(minutes=10))                         # 00:05 helyi, másnap
        self.assertEqual(e[("2026-11-08", "X5")]["kwh"], 0.5)
        self.assertEqual(e[("2026-11-09", "X5")]["kwh"], 0.3)
        self.setv("devid013secret", "total_forward_energy", 20)         # számláló nullázódott
        self.run_at(t1 + timedelta(minutes=20))
        self.assertEqual(e[("2026-11-09", "X5")]["kwh"], 0.5)
        self.setv("devid013secret", "total_forward_energy", 20 + 50000)  # +500 kWh: irreális
        s = self.run_at(t1 + timedelta(minutes=30))
        self.assertEqual(s["anomalies"], 1)
        self.assertEqual(e[("2026-11-09", "X5")]["kwh"], 0.5)
        self.assertEqual(s["energy"], 4)

    def test_missing_last_counter_skips_energy(self):
        sb2 = supa_server(missing=("last_counter",))
        try:
            res = D.match_devices(self.f, CFG["devices"], CFG["role_categories"])
            D.push_devices(SupabaseRest(sb2.url, sb2.secret), CFG["devices"], res, {})
            s = C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(sb2.url, sb2.secret), now=T0)
            self.assertEqual(s["written"], 17)
            self.assertEqual(s["energy"], 0)
            self.assertTrue(any("last_counter" in n for n in s["notes"]))
        finally:
            sb2.close()

    def test_main_output_is_public_safe(self):
        self.addCleanup(setattr, WX, "fetch", WX.fetch)
        WX.fetch = lambda timeout=20: meteo(datetime.now(timezone.utc))
        self.addCleanup(setattr, BK, "fetch", BK.fetch)
        BK.fetch = lambda url, timeout=20: ical(datetime.now(timezone.utc).date())
        with env(TUYA_ACCESS_ID="id", TUYA_ACCESS_SECRET="sec", TUYA_ENDPOINT=self.tuya.url, TUYA_UID=None,
                 SUPABASE_URL=self.sb.url, SUPABASE_SECRET_KEY=self.sb.secret, GITHUB_STEP_SUMMARY=None,
                 AIRBNB_ICAL_URL=ICAL_URL, BOOKING_ICAL_URL=None):
            rc, out = run_main(C.main)
        self.assertEqual(rc, 0)
        self.assertIn("| Új állapotsor (változás vagy óránkénti életjel) | 17 |", out)
        self.assertIn("Időjárás: 95 órás sor frissítve", out)
        self.assertIn("Foglalások: 2 foglalás, 2 lezárt időszak frissítve", out)
        assert_public(self, out)
        assert_booking_public(self, out)
        self.assertNotIn("7.5", out)                      # időjárási érték sem kerül a logba

    def test_main_bookings_without_tuya_still_run(self):
        self.addCleanup(setattr, WX, "fetch", WX.fetch)
        WX.fetch = lambda timeout=20: meteo(datetime.now(timezone.utc))
        self.addCleanup(setattr, BK, "fetch", BK.fetch)
        BK.fetch = lambda url, timeout=20: ical(datetime.now(timezone.utc).date())
        self.tuya.state["fail_list"] = True               # a Tuya hibát ad
        with env(TUYA_ACCESS_ID="id", TUYA_ACCESS_SECRET="sec", TUYA_ENDPOINT=self.tuya.url, TUYA_UID=None,
                 SUPABASE_URL=self.sb.url, SUPABASE_SECRET_KEY=self.sb.secret, GITHUB_STEP_SUMMARY=None,
                 AIRBNB_ICAL_URL=ICAL_URL, BOOKING_ICAL_URL=None):
            rc, out = run_main(C.main)
        self.assertEqual(rc, 1)
        self.assertIn("Tuya hiba", out)
        self.assertIn("Foglalások: 2 foglalás", out)
        self.assertEqual(len(self.sb.db["bookings"]), 4)

    def test_main_without_supabase(self):
        with env(SUPABASE_URL=None, SUPABASE_SECRET_KEY=None):
            rc, out = run_main(C.main)
        self.assertEqual(rc, 1)
        self.assertIn("SUPABASE_SECRET_KEY", out)

    def test_supabase_error_hides_details(self):
        bad = SupabaseRest(self.sb.url, "rossz-kulcs")
        with self.assertRaises(Exception) as cm:
            C.collect(TuyaClient("id", "sec", self.tuya.url), bad, now=T0)
        self.assertIn("HTTP 401", str(cm.exception))
        self.assertNotIn("Invalid API key", str(cm.exception))



def meteo(now, hours=96, start_back=48):
    """Open-Meteo hourly válasz utánzata: óránként 7,5 °C, a 3. órában hiányzó adat."""
    t0 = int((now - timedelta(hours=start_back)).replace(minute=0, second=0, microsecond=0).timestamp())
    times = [t0 + 3600 * i for i in range(hours)]
    temp = [7.5] * hours
    temp[3] = None
    return {"hourly": {"time": times, "temperature_2m": temp, "apparent_temperature": [5.0] * hours,
                       "relative_humidity_2m": [80.4] * hours, "dew_point_2m": [4.2] * hours,
                       "precipitation": [0.0] * hours, "cloud_cover": [55] * hours, "wind_speed_10m": [12.34] * hours,
                       "wind_gusts_10m": [30.0] * hours, "shortwave_radiation": [210.0] * hours,
                       "weather_code": [3] * hours, "is_day": [1, 0] * (hours // 2)}}


class TestContactLogs(unittest.TestCase):
    """Ajtók, ablakok: a pontos nyitások és csukások a Tuya-naplóból (a 10 perces pillanatkép
    a rövid be- és kilépést nem látja)."""
    DOOR = "devid005secret"
    tearDown = TestCollect.tearDown

    def setUp(self):
        TestCollect.setUp(self)
        for i in range(5, 11):                                   # a 6 nyitásérzékelő jelentésideje
            self.set_upd(f"devid{i:03d}secret", T0 - timedelta(hours=3))

    def ms(self, when):
        return int(when.timestamp() * 1000)

    def ev(self, when, value):
        return {"code": "doorcontact_state", "value": "true" if value else "false", "event_time": self.ms(when)}

    def set_upd(self, did, when):
        next(x for x in self.f if x["id"] == did)["update_time"] = int(when.timestamp())

    def log_rows(self, pink="5"):
        return sorted((r for r in self.sb.db["device_status"] if r["pink"] == pink and r["status"].get("_src") == "log"),
                      key=lambda r: r["ts"])

    def test_backfill_exact_times_then_only_new_events(self):
        # két rövid be- és kilépés; a pillanatképek (10 percenként) mindkettőt zárva látják
        self.tuya.state["logs"][self.DOOR] = [
            self.ev(T0 - timedelta(hours=26), True), self.ev(T0 - timedelta(hours=26) + timedelta(seconds=40), False),
            self.ev(T0 - timedelta(minutes=30), True), self.ev(T0 - timedelta(minutes=29), False),
            {"code": "battery_percentage", "value": 90, "event_time": self.ms(T0 - timedelta(minutes=20))},
            self.ev(T0 - timedelta(days=9), True),                          # a visszatöltési ablakon kívül
        ]
        self.set_upd(self.DOOR, T0 - timedelta(minutes=20))
        cache = {}
        s = C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(self.sb.url, self.sb.secret), now=T0, cache=cache)
        rows = self.log_rows()
        self.assertEqual([(r["ts"], r["status"]["doorcontact_state"]) for r in rows], [
            ((T0 - timedelta(hours=26)).isoformat(), True),
            ((T0 - timedelta(hours=26) + timedelta(seconds=40)).isoformat(), False),
            ((T0 - timedelta(minutes=30)).isoformat(), True),
            ((T0 - timedelta(minutes=29)).isoformat(), False)])
        self.assertEqual(rows[2]["status"]["_upd"], int((T0 - timedelta(minutes=30)).timestamp()))
        self.assertEqual(s["log_events"], 4)
        self.assertEqual(s["tuya_calls"], 2)                                # a pillanatkép költsége változatlan
        self.assertEqual(self.tuya.state["log_calls"], 6)                   # a futás első köre: mind a 6 érzékelő
        # a legfrissebb állapot a pillanatkép marad (most zárva), a naplósorok régebbiek
        latest = [r for r in self.sb.db["device_status"] if r["pink"] == "5"]
        self.assertFalse(max(latest, key=lambda r: r["ts"])["status"]["doorcontact_state"])
        # következő kör, nincs új jelentés (_upd nem nőtt): nincs napló-lekérés
        s = C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(self.sb.url, self.sb.secret),
                      now=T0 + timedelta(minutes=10), cache=cache)
        self.assertEqual((s["log_calls"], s["log_events"]), (0, 0))
        # új be- és kilépés 3 perc alatt: csak ez a kettő kerül be
        self.tuya.state["logs"][self.DOOR] += [self.ev(T0 + timedelta(minutes=12), True), self.ev(T0 + timedelta(minutes=15), False)]
        self.set_upd(self.DOOR, T0 + timedelta(minutes=15))
        s = C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(self.sb.url, self.sb.secret),
                      now=T0 + timedelta(minutes=20), cache=cache)
        self.assertEqual((s["log_calls"], s["log_events"]), (1, 2))
        self.assertEqual(len(self.log_rows()), 6)
        # új GitHub-futás (üres gyorsítótár): mind a 6-ot megkérdezi, de semmi nem duplázódik
        s = C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(self.sb.url, self.sb.secret),
                      now=T0 + timedelta(minutes=30), cache={})
        self.assertEqual((s["log_calls"], s["log_events"]), (6, 0))
        self.assertEqual(len(self.log_rows()), 6)

    def test_rate_limit_stops_log_fetch_but_not_the_round(self):
        self.tuya.state["log_fail"] = (40000309, "The log query is too frequent, please try again later!")
        s = C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(self.sb.url, self.sb.secret), now=T0, cache={})
        self.assertEqual(s["written"], 17)                                  # a pillanatképek beírva
        self.assertEqual((s["log_errors"], s["log_events"]), (1, 0))
        self.assertEqual(self.tuya.state["log_calls"], 1)                   # az első hiba után abbahagyja

    def test_public_report_has_only_counts(self):
        self.tuya.state["logs"][self.DOOR] = [self.ev(T0 - timedelta(minutes=30), True), self.ev(T0 - timedelta(minutes=29), False)]
        s = C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(self.sb.url, self.sb.secret), now=T0, cache={})
        text = C.report(s)
        self.assertIn("| Ajtó/ablak esemény a Tuya-naplóból | 2 |", text)
        for secret in ("devid005", "09:30", "09:31", (T0 - timedelta(minutes=30)).isoformat()[:16]):
            self.assertNotIn(secret, text)


class TestHistory(unittest.TestCase):
    """Kismegszakítók és hőmérők a Tuya-naplóból: nyers sorok (tuya_log), órás összesítő
    (metrics_hourly), napi energia (energy_daily, source = 'log'), 90 napos megőrzés."""
    X5, T1 = "devid013secret", "devid001secret"

    def setUp(self):
        self.f = fleet()
        self.tuya = tuya_server(self.f)
        self.sb = supa_server(history=True)
        res = D.match_devices(self.f, CFG["devices"], CFG["role_categories"])
        specs = {d["id"]: {"status": SPEC.get(d["category"], [])} for d in res.mapping.values()}
        D.push_devices(SupabaseRest(self.sb.url, self.sb.secret), CFG["devices"], res, specs)
        self.budget, C.HIST_PAGE_BUDGET = C.HIST_PAGE_BUDGET, 500
        self.pause, C.LOG_PAUSE = C.LOG_PAUSE, 0

    def tearDown(self):
        C.HIST_PAGE_BUDGET, C.LOG_PAUSE = self.budget, self.pause
        self.tuya.close()
        self.sb.close()

    def ev(self, code, value, when):
        return {"code": code, "value": str(value), "event_time": int(when.timestamp() * 1000)}

    def run_at(self, when, cache=None):
        return C.collect(TuyaClient("id", "sec", self.tuya.url), SupabaseRest(self.sb.url, self.sb.secret),
                         now=when, cache={} if cache is None else cache)

    def test_hourly_and_daily_from_log(self):
        h = datetime(2026, 11, 7, 10, 0, tzinfo=timezone.utc)            # 11:00 Budapest, nov. 7.
        self.tuya.state["logs"][self.X5] = [
            self.ev("add_ele", 500, h + timedelta(minutes=15)), self.ev("add_ele", 550, h + timedelta(minutes=45)),
            self.ev("cur_power", 9950, h + timedelta(minutes=20)), self.ev("cur_voltage", 2301, h + timedelta(minutes=20)),
            self.ev("add_ele", 300, datetime(2026, 11, 8, 8, 30, tzinfo=timezone.utc)),
            self.ev("add_ele", 999, datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)),   # a 7 napos ablakon kívül
        ]
        self.tuya.state["logs"][self.T1] = [
            self.ev("va_temperature", 214, h + timedelta(minutes=5)), self.ev("va_temperature", 220, h + timedelta(minutes=35)),
            self.ev("va_humidity", 41, h + timedelta(minutes=35))]
        s = self.run_at(T0)
        db = self.sb.db
        self.assertEqual({k[2] for k in db["tuya_log"] if k[0] == "X5"}, {"add_ele", "cur_power"})   # feszültség nem kell
        m = db["metrics_hourly"][("X5", h.isoformat())]
        self.assertEqual((m["kwh"], m["w_max"], m["n"]), (1.05, 995.0, 3))
        t = db["metrics_hourly"][("1", h.isoformat())]
        self.assertEqual((t["temp_avg"], t["temp_min"], t["temp_max"], t["hum_avg"]), (21.7, 21.4, 22.0, 41.0))
        self.assertEqual(db["energy_daily"][("2026-11-07", "X5")]["kwh"], 1.05)
        self.assertEqual(db["energy_daily"][("2026-11-07", "X5")]["source"], "log")
        self.assertEqual(db["energy_daily"][("2026-11-08", "X5")]["kwh"], 0.3)       # a számlálós ág nem írta felül
        self.assertNotIn(("2026-10-25", "X5"), db["energy_daily"])
        self.assertEqual((s["hist_rows"], s["hist_errors"]), (7, 0))
        # új futás: csak az utolsó naplósor utániakat kéri, nincs duplikálás
        n = len(db["tuya_log"])
        self.tuya.state["logs"][self.X5].append(self.ev("add_ele", 200, T0 + timedelta(minutes=5)))
        s = self.run_at(T0 + timedelta(minutes=10))
        self.assertEqual((s["hist_rows"], len(db["tuya_log"])), (1, n + 1))
        self.assertEqual(db["energy_daily"][("2026-11-08", "X5")]["kwh"], 0.5)

    def test_dense_window_is_split(self):
        base = datetime(2026, 11, 7, 0, 0, tzinfo=timezone.utc)
        self.tuya.state["logs"][self.X5] = [self.ev("cur_power", 9950 + i % 3, base + timedelta(minutes=i)) for i in range(1500)]
        s = self.run_at(T0)
        self.assertEqual(sum(1 for k in self.sb.db["tuya_log"] if k[0] == "X5"), 1500)   # felezve, rés nélkül
        self.assertEqual(s["hist_errors"], 0)

    def test_prune_keeps_door_events(self):
        old = (T0 - timedelta(days=100)).isoformat()
        self.sb.db["tuya_log"][("X5", old, "add_ele")] = {"pink": "X5", "ts": old, "code": "add_ele", "value": 1}
        self.sb.db["device_status"] += [{"pink": "X5", "ts": old, "online": True, "status": {"switch": True}},
                                        {"pink": "5", "ts": old, "online": True, "status": {"doorcontact_state": True, "_src": "log"}}]
        s = self.run_at(T0)
        self.assertNotIn(("X5", old, "add_ele"), self.sb.db["tuya_log"])
        olds = [r for r in self.sb.db["device_status"] if r["ts"] == old]
        self.assertEqual([r["pink"] for r in olds], ["5"])                            # az ajtóesemény marad

    def test_missing_migration_is_a_note(self):
        self.sb.db.pop("tuya_log")
        s = self.run_at(T0)
        self.assertIn("007_history.sql", "\n".join(s["notes"]))
        self.assertEqual(s["written"], 17)

    def test_report_counts_only(self):
        self.tuya.state["logs"][self.X5] = [self.ev("add_ele", 1234, T0 - timedelta(hours=2))]
        text = C.report(self.run_at(T0))
        self.assertIn("| Előzmény: új naplósor / óra / nap (kismegszakító, hőmérő) | 1 / 1 / 1 |", text)
        for secret in ("1234", "1,234", "devid013", "08:00"):
            self.assertNotIn(secret, text)


class TestStalePower(unittest.TestCase):
    """A felhőben ragadt kismegszakító-teljesítmény javítása a számlálóból."""

    def test_stuck_value_fixed_when_counter_flat(self):
        cache, t = {}, T0
        st = {"cur_power": 18000, "total_forward_energy": 398929}
        self.assertFalse(C.counter_check(st, None, "X7", t, cache))           # első kör: nincs mihez mérni
        st = {"cur_power": 18000, "total_forward_energy": 398929}
        self.assertTrue(C.counter_check(st, None, "X7", t + timedelta(minutes=10), cache))
        self.assertEqual((st["cur_power"], st["_cur_power_raw"], st["_power_from"], st["_avgw"]), (0, 18000, "counter", 0))

    def test_real_heating_kept(self):
        cache = {}
        C.counter_check({"cur_power": 18000, "total_forward_energy": 100000}, None, "X7", T0, cache)
        st = {"cur_power": 18000, "total_forward_energy": 100030}             # +0,30 kWh 10 perc alatt = 1,8 kW
        self.assertFalse(C.counter_check(st, None, "X7", T0 + timedelta(minutes=10), cache))
        self.assertEqual((st["cur_power"], st["_avgw"]), (18000, 1800))

    def test_changed_raw_value_is_trusted(self):
        cache = {}
        C.counter_check({"cur_power": 0, "total_forward_energy": 100000}, None, "X7", T0, cache)
        st = {"cur_power": 18000, "total_forward_energy": 100000}             # épp most kapcsolt be
        self.assertFalse(C.counter_check(st, None, "X7", T0 + timedelta(minutes=10), cache))
        self.assertEqual(st["cur_power"], 18000)

    def test_gap_too_long_or_counter_reset_ignored(self):
        cache = {}
        C.counter_check({"cur_power": 18000, "total_forward_energy": 100000}, None, "X7", T0, cache)
        st = {"cur_power": 18000, "total_forward_energy": 100000}
        self.assertFalse(C.counter_check(st, None, "X7", T0 + timedelta(minutes=45), cache))
        C.counter_check({"cur_power": 18000, "total_forward_energy": 100000}, None, "X5", T0, cache)
        st = {"cur_power": 18000, "total_forward_energy": 5}
        self.assertFalse(C.counter_check(st, None, "X5", T0 + timedelta(minutes=10), cache))


class TestWeather(unittest.TestCase):
    def setUp(self):
        self.sb = supa_server()
        self.api = SupabaseRest(self.sb.url, self.sb.secret)
        self.calls = 0

    def tearDown(self):
        self.sb.close()

    def fetcher(self, now):
        def f():
            self.calls += 1
            return meteo(now)
        return f

    def test_hourly_rows_once_per_hour(self):
        r1 = WX.collect_weather(self.api, now=T0, fetcher=self.fetcher(T0))
        self.assertEqual(self.calls, 1)
        self.assertEqual(r1["written"], 95)                     # 96 óra, egy hiányzó hőmérséklet
        self.assertEqual(r1["past"] + r1["forecast"], 95)
        rows = self.sb.db["weather_hourly"]
        self.assertEqual(len(rows), 95)
        past = [r for r in rows.values() if not r["is_forecast"]]
        fut = [r for r in rows.values() if r["is_forecast"]]
        self.assertTrue(all(WX.parse_ts(r["ts"]) + timedelta(hours=1) <= T0 for r in past))
        self.assertTrue(all(WX.parse_ts(r["ts"]) + timedelta(hours=1) > T0 for r in fut))
        one = past[0]
        self.assertEqual((one["temp"], one["humidity"], one["cloud"], one["wind"], one["weather_code"]), (7.5, 80, 55, 12.3, 3))
        self.assertIn(one["is_day"], (True, False))
        r2 = WX.collect_weather(self.api, now=T0 + timedelta(minutes=10), fetcher=self.fetcher(T0))
        self.assertEqual((self.calls, r2["written"]), (1, 0))  # 10 perc múlva nem kér le újra
        r3 = WX.collect_weather(self.api, now=T0 + timedelta(minutes=60), fetcher=self.fetcher(T0 + timedelta(minutes=60)))
        self.assertEqual(self.calls, 2)
        self.assertGreater(r3["written"], 0)

    def test_forecast_hour_becomes_measured(self):
        WX.collect_weather(self.api, now=T0, fetcher=self.fetcher(T0))
        later = T0 + timedelta(hours=3)
        WX.collect_weather(self.api, now=later, fetcher=lambda: meteo(T0))
        rows = self.sb.db["weather_hourly"]
        hour = (T0 + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
        self.assertFalse(rows[hour]["is_forecast"])

    def test_api_down_is_not_fatal(self):
        def boom():
            raise OSError("down")
        r = WX.collect_weather(self.api, now=T0, fetcher=boom)
        self.assertEqual(r["written"], 0)
        self.assertFalse(r["error"])
        self.assertIn("nem érhető el", r["note"])

    def test_missing_table_hint(self):
        sb2 = supa_server(no_tables=("weather_hourly",))
        try:
            r = WX.collect_weather(SupabaseRest(sb2.url, sb2.secret), now=T0, fetcher=self.fetcher(T0))
        finally:
            sb2.close()
        self.assertEqual(self.calls, 0)
        self.assertFalse(r["error"])
        self.assertIn("003_weather.sql", r["note"])

    def test_url_is_district_level(self):
        u = WX.url()
        self.assertIn("latitude=47.48", u)
        self.assertIn("longitude=19.07", u)
        self.assertIn("past_days=2", u)


# ----------------------------------------------------------------------------- foglaltság

ICAL_URL = "https://www.airbnb.com/calendar/ical/999.ics?s=TOKEN-SECRET-abc"
PRIVATE_BITS = ["TOKEN-SECRET", "airbnb.com", "HMSECRET1", "HMSECRET2", "Phone Number", "4821",
                "reservations/details", "2026-11-1", "2026-12-", "20261"]


def assert_booking_public(t: unittest.TestCase, out: str):
    for bit in PRIVATE_BITS:
        t.assertNotIn(bit, out, f"a publikus kimenetben nem lehet: {bit!r}")


def ical(today, extra="", folded=True):
    """Airbnb host naptárexport utánzata a megadott naphoz képest: 2 foglalás (egy DATE és
    egy DATE-TIME formájú), 2 lezárt időszak, 1 a 30 napos ablakon kívül (régi)."""
    d = lambda n: (today + timedelta(days=n)).strftime("%Y%m%d")
    desc = ("DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMSECRET1\\nPho\r\n"
            " ne Number (Last 4 Digits): 4821") if folded else "DESCRIPTION:Reservation URL: x\\nPhone Number (Last 4 Digits): 4821"
    return "\r\n".join([
        "BEGIN:VCALENDAR", "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN",
        "CALSCALE:GREGORIAN", "VERSION:2.0",
        "BEGIN:VEVENT", f"DTEND;VALUE=DATE:{d(3)}", f"DTSTART;VALUE=DATE:{d(1)}",
        "UID:1418fb94e984-0f3e5ab4c3a5ba1ad9e1d3c3d3a8c1d7@airbnb.c", "\tom" if folded else "", desc,
        "SUMMARY:Reserved", "END:VEVENT",
        "BEGIN:VEVENT", f"DTSTART:{d(6)}T140000Z", f"DTEND:{d(9)}T100000Z",
        "UID:secondUID-HMSECRET2@airbnb.com", "SUMMARY:Reserved", "END:VEVENT",
        "BEGIN:VEVENT", f"DTEND;VALUE=DATE:{d(12)}", f"DTSTART;VALUE=DATE:{d(10)}",
        "UID:blockedUID-1@airbnb.com", "SUMMARY:Airbnb (Not available)", "END:VEVENT",
        "BEGIN:VEVENT", f"DTSTART;TZID=Europe/Budapest:{d(20)}T150000", f"DTEND;TZID=Europe/Budapest:{d(22)}T110000",
        "UID:blockedUID-2@airbnb.com", "SUMMARY:Airbnb (Not available)", "END:VEVENT",
        "BEGIN:VEVENT", f"DTEND;VALUE=DATE:{d(-40)}", f"DTSTART;VALUE=DATE:{d(-45)}",
        "UID:oldUID@airbnb.com", "SUMMARY:Reserved", "END:VEVENT",
        extra, "END:VCALENDAR", ""]).replace("\r\n\r\n", "\r\n")


class TestBookings(unittest.TestCase):
    def setUp(self):
        self.sb = supa_server()
        self.api = SupabaseRest(self.sb.url, self.sb.secret)
        self.calls = 0
        self.today = T0.astimezone(BK.BUDAPEST).date()
        self.text = ical(self.today)
        self.env = {"AIRBNB_ICAL_URL": ICAL_URL}

    def tearDown(self):
        self.sb.close()

    def fetcher(self, url):
        self.calls += 1
        self.assertEqual(url, ICAL_URL)
        return self.text

    def run_at(self, when, **kw):
        return BK.collect_bookings(self.api, now=when, fetcher=kw.pop("fetcher", self.fetcher),
                                   environ=kw.pop("environ", self.env))

    def test_parse_folding_and_date_forms(self):
        evs = BK.parse_events(self.text)
        self.assertEqual(len(evs), 5)
        first = evs[0]
        self.assertEqual(first["uid"], "1418fb94e984-0f3e5ab4c3a5ba1ad9e1d3c3d3a8c1d7@airbnb.com")   # összefűzött sor
        self.assertEqual((first["start"], first["end"]), (self.today + timedelta(days=1), self.today + timedelta(days=3)))
        self.assertEqual((evs[1]["start"], evs[1]["end"]), (self.today + timedelta(days=6), self.today + timedelta(days=9)))
        self.assertEqual((evs[3]["start"], evs[3]["end"]), (self.today + timedelta(days=20), self.today + timedelta(days=22)))
        self.assertNotIn("description", {k.lower() for e in evs for k in e})

    def test_utc_late_evening_is_next_budapest_day(self):
        txt = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20261231T233000Z\nDTEND:20270102T100000Z\nSUMMARY:Reserved\nEND:VEVENT\nEND:VCALENDAR\n"
        ev = BK.parse_events(txt)[0]
        self.assertEqual(ev["start"].isoformat(), "2027-01-01")
        self.assertEqual(ev["end"].isoformat(), "2027-01-02")

    def test_kinds(self):
        self.assertEqual(BK.kind_of("airbnb", "Reserved"), "reservation")
        self.assertEqual(BK.kind_of("airbnb", "Airbnb (Not available)"), "blocked")
        self.assertEqual(BK.kind_of("airbnb", "valami más"), "blocked")
        self.assertEqual(BK.kind_of("booking", "CLOSED - Not available"), "reservation")

    def test_rows_reserved_vs_blocked_and_window(self):
        r = self.run_at(T0)
        self.assertEqual((r["reservations"], r["blocked"], r["deleted"], r["error"]), (2, 2, 0, False))
        rows = sorted(self.sb.db["bookings"].values(), key=lambda x: x["start_date"])
        self.assertEqual([x["kind"] for x in rows], ["reservation", "reservation", "blocked", "blocked"])
        self.assertTrue(all(x["source"] == "airbnb" for x in rows))
        self.assertEqual(set(rows[0]), {"id", "source", "kind", "start_date", "end_date", "seen_at"})

    def test_privacy_nothing_raw_is_stored(self):
        r = self.run_at(T0)
        stored = json.dumps(self.sb.db["bookings"])
        for bit in ["@airbnb", "UID", "HMSECRET", "4821", "Phone", "Reserved", "Not available", "TOKEN", "http"]:
            self.assertNotIn(bit, stored)
        for rid in self.sb.db["bookings"]:
            self.assertRegex(rid, r"^[0-9a-f]{64}$")
        assert_booking_public(self, r["note"])

    def test_once_per_55_minutes(self):
        self.run_at(T0)
        r2 = self.run_at(T0 + timedelta(minutes=30))
        self.assertEqual(self.calls, 1)
        self.assertIn("friss", r2["note"])
        self.run_at(T0 + timedelta(minutes=56))
        self.assertEqual(self.calls, 2)
        self.assertEqual(len(self.sb.db["bookings"]), 4)       # ugyanaz az id: felülírás, nem duplikálás

    def test_cancellation_deletes_only_future_of_that_source(self):
        self.run_at(T0)
        past = {"id": "p" * 64, "source": "airbnb", "kind": "reservation", "start_date": "2026-10-20",
                "end_date": "2026-10-25", "seen_at": "2026-10-20T10:00:00+00:00"}
        other = {"id": "b" * 64, "source": "booking", "kind": "reservation", "start_date": "2026-11-30",
                 "end_date": "2026-12-02", "seen_at": "2026-10-20T10:00:00+00:00"}
        self.sb.db["bookings"][past["id"]] = past
        self.sb.db["bookings"][other["id"]] = other
        self.text = self.text.replace("SUMMARY:Reserved\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:", "SUMMARY:Reserved\r\nEND:VEVENT\r\nBEGIN:VEVENTX\r\nDTSTART:", 1)
        self.text = self.text.replace("UID:secondUID-HMSECRET2@airbnb.com", "UID:gone").replace("BEGIN:VEVENTX", "BEGIN:VTODO")
        r = self.run_at(T0 + timedelta(hours=2))
        self.assertEqual((r["reservations"], r["deleted"]), (1, 1))
        ids = set(self.sb.db["bookings"])
        self.assertIn(past["id"], ids)                       # múltbeli sor marad
        self.assertIn(other["id"], ids)                      # másik forrás sora marad
        self.assertEqual(len(ids), 5)

    def test_fetch_error_keeps_rows_and_is_not_fatal(self):
        self.run_at(T0)
        def boom(url):
            raise OSError("https://www.airbnb.com/calendar/ical/999.ics?s=TOKEN-SECRET-abc")
        r = self.run_at(T0 + timedelta(hours=2), fetcher=boom)
        self.assertFalse(r["error"])
        self.assertIn("nem olvasható (OSError)", r["note"])
        assert_booking_public(self, r["note"])
        self.assertEqual(len(self.sb.db["bookings"]), 4)     # hibánál semmit nem törlünk
        html = self.run_at(T0 + timedelta(hours=3), fetcher=lambda u: "<html>login</html>")
        self.assertIn("nem olvasható (ValueError)", html["note"])
        self.assertEqual(len(self.sb.db["bookings"]), 4)

    def test_missing_table_hint(self):
        sb2 = supa_server(no_tables=("bookings",))
        try:
            r = BK.collect_bookings(SupabaseRest(sb2.url, sb2.secret), now=T0, fetcher=self.fetcher, environ=self.env)
        finally:
            sb2.close()
        self.assertEqual(self.calls, 0)
        self.assertFalse(r["error"])
        self.assertIn("004_bookings.sql", r["note"])

    def test_missing_env_skips_silently(self):
        r = self.run_at(T0, environ={"AIRBNB_ICAL_URL": "  "})
        self.assertEqual(self.calls, 0)
        self.assertFalse(r["error"])
        self.assertEqual(r["note"], "Foglalások: nincs beállítva AIRBNB_ICAL_URL.")
        self.assertEqual(self.sb.log["requests"], [])

    def test_booking_source_optional(self):
        env2 = {"AIRBNB_ICAL_URL": ICAL_URL, "BOOKING_ICAL_URL": "https://admin.booking.com/x.ics?t=TOKEN-SECRET-2"}
        btxt = ("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:bk1\nDTSTART;VALUE=DATE:" + (self.today + timedelta(days=10)).strftime("%Y%m%d")
                + "\nDTEND;VALUE=DATE:" + (self.today + timedelta(days=12)).strftime("%Y%m%d")
                + "\nSUMMARY:CLOSED - Not available\nEND:VEVENT\nEND:VCALENDAR\n")
        r = self.run_at(T0, environ=env2, fetcher=lambda u: btxt if "booking" in u else self.text)
        self.assertEqual((r["reservations"], r["blocked"], r["sources"]), (3, 2, 2))
        srcs = sorted(x["source"] for x in self.sb.db["bookings"].values())
        self.assertEqual(srcs.count("booking"), 1)
        assert_booking_public(self, r["note"])

    def test_delete_requires_filter(self):
        with self.assertRaises(ValueError):
            self.api.delete("bookings")


if __name__ == "__main__":
    unittest.main()
