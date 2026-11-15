"""011_access.sql biztonsági őrei (offline, szöveges ellenőrzés; a viselkedést a helyi Postgres-próba nézi).

A bemutató link (anon + x-share-token) csak olvashat, csak az engedélyezett táblákból és oszlopokból,
és minden anon-szabály a share_ok()-ra épül. A kapcsoló függvény csak tulajt és családtagot enged.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "supabase/migrations/011_access.sql").read_text(encoding="utf-8")
ALLOWED_ANON_TABLES = {"devices", "device_status", "device_latest", "weather_hourly", "battery_status",
                       "energy_daily", "bookings", "layouts"}


class AccessSqlTest(unittest.TestCase):
    def test_anon_policies_need_valid_link(self):
        pols = re.findall(r"create policy (\w+) on public\.(\w+) for (\w+) to anon\s+using \(([^;]+)\);", SQL)
        self.assertGreaterEqual(len(pols), 7)
        for name, table, cmd, using in pols:
            self.assertEqual(cmd, "select", name)
            self.assertIn("(select public.share_ok())", using, name)
            self.assertIn(table, ALLOWED_ANON_TABLES, name)

    def test_anon_grants_are_select_only_and_narrow(self):
        grants = re.findall(r"grant ([^;]+?) on (?:function )?public\.([\w(), ]+?) to anon;", SQL)
        for what, obj in grants:
            if obj.startswith("share_"):
                self.assertEqual(what.strip(), "execute", obj)
                self.assertIn(obj.split("(")[0], {"share_ok", "share_open"}, obj)
                continue
            self.assertTrue(what.startswith("select"), (what, obj))
            self.assertIn(obj, ALLOWED_ANON_TABLES, obj)
        # a Tuya-azonosító, a skála és a foglalás forrás-azonosítója nem
        dev = re.search(r"grant select \(([^)]*)\) on public\.devices to anon", SQL).group(1)
        self.assertNotIn("tuya_device_id", dev)
        self.assertNotIn("meta", dev)
        bk = re.search(r"grant select \(([^)]*)\) on public\.bookings to anon", SQL).group(1)
        self.assertNotIn("id", [c.strip() for c in bk.split(",")])
        for t in ("site_info", "app_users", "share_links", "control_rules", "control_timers", "alert_settings"):
            self.assertNotRegex(SQL, rf"grant [^;]* on public\.{t} to anon", t)

    def test_tokens_only_hashed_and_owner_only_admin(self):
        self.assertIn("revoke all on public.share_links from public, anon, authenticated", SQL)
        self.assertIn("token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$')", SQL)
        self.assertIn("gen_random_bytes(32)", SQL)
        for fn in ("share_create", "share_list", "share_revoke"):
            body = SQL[SQL.index(f"function public.{fn}("):]
            body = body[:body.index("$$;") if "$$;" in body else len(body)]
            self.assertIn("'owner'", body, fn)
            self.assertRegex(SQL, rf"revoke all on function public\.{fn}\([^)]*\) from public, anon;")
        self.assertIn("interval '59 minutes 59 seconds'", SQL)
        self.assertIn("now() + interval '24 hours'", SQL)

    def test_security_definer_functions_pin_search_path(self):
        for m in re.finditer(r"create or replace function public\.(\w+)\([^)]*\)[^$]*?\$\$", SQL, re.S):
            head = m.group(0)
            if "security definer" in head:
                self.assertIn("set search_path = ''", head, m.group(1))

    def test_control_function_allows_only_owner_and_member(self):
        ts = (ROOT / "supabase/functions/control/index.ts").read_text(encoding="utf-8")
        self.assertIn('["owner", "member"].includes(role)', ts)
        self.assertNotIn('"viewer"].includes(role)', ts)

    def test_users_function_owner_only(self):
        ts = (ROOT / "supabase/functions/users/index.ts").read_text(encoding="utf-8")
        self.assertIn('if (me.role !== "owner") return fail(', ts)
        self.assertIn('const ROLES = ["member", "viewer", "cleaner"];', ts)   # tulajt nem lehet létrehozni


if __name__ == "__main__":
    unittest.main()
