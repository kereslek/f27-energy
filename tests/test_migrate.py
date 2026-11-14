"""Séma futtatása a Management API-n át (f27/migrate.py): célpontok, fájlkorlát, publikus log."""

import io
import json
import unittest
import urllib.error
from contextlib import redirect_stdout

from f27 import migrate as M

URL = "https://abcdefghijklmnopqrst.supabase.co"


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class MigrateTest(unittest.TestCase):
    def run_main(self, env, opener):
        out = io.StringIO()
        with redirect_stdout(out):
            code = M.main(env, opener)
        return code, out.getvalue()

    def test_ref_and_file_guard(self):
        self.assertEqual(M.project_ref(URL), "abcdefghijklmnopqrst")
        with self.assertRaises(ValueError):
            M.project_ref("https://pelda.hu")
        with self.assertRaises(ValueError):
            M.sql_file("f27/collect.py")
        with self.assertRaises(ValueError):
            M.sql_file("../../etc/passwd.sql")
        self.assertTrue(M.sql_file("supabase/setup_all.sql").is_file())

    def test_runs_both_and_checks_owner(self):
        calls = []

        def opener(req, timeout=0):
            q = json.loads(req.data)["query"]
            calls.append((req.full_url, q[:20]))
            self.assertEqual(req.get_header("Authorization"), "Bearer titok")
            return Resp(json.dumps([{"tables": 18, "owners": 1}] if "pg_tables" in q else []).encode())

        env = {"SUPABASE_ACCESS_TOKEN": "titok", "SUPABASE_URL": URL, "O2B_SUPABASE_URL": URL.replace("abc", "xyz")}
        code, out = self.run_main(env, opener)
        self.assertEqual(code, 0, out)
        self.assertEqual(len(calls), 4)
        self.assertIn("| F27 | OK | lefutott; 18 tábla, tulajdonos: 1 |", out)
        self.assertNotIn("titok", out)

    def test_sql_error_is_trimmed(self):
        def opener(req, timeout=0):
            body = json.dumps({"message": "ERROR: 23514: new row violates check\nDETAIL: Failing row contains (titkos)"})
            raise urllib.error.HTTPError(req.full_url, 400, "x", {}, io.BytesIO(body.encode()))

        code, out = self.run_main({"SUPABASE_ACCESS_TOKEN": "t", "SUPABASE_URL": URL, "TARGET": "f27"}, opener)
        self.assertEqual(code, 1)
        self.assertIn("HTTP 400: ERROR: 23514: new row violates check", out)
        self.assertNotIn("titkos", out)

    def test_missing_token(self):
        code, out = self.run_main({"SUPABASE_URL": URL}, None)
        self.assertEqual(code, 1)
        self.assertIn("SUPABASE_ACCESS_TOKEN", out)

    def test_o2b_missing_is_skipped(self):
        opener = lambda req, timeout=0: Resp(b'[{"tables": 18, "owners": 1}]')
        code, out = self.run_main({"SUPABASE_ACCESS_TOKEN": "t", "SUPABASE_URL": URL}, opener)
        self.assertEqual(code, 0)
        self.assertIn("| O2B | kihagyva |", out)


if __name__ == "__main__":
    unittest.main()
