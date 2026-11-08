"""Minimális Supabase (PostgREST) kliens, csak standard könyvtárral, a titkos kulccsal.

Csak GitHub Actionsből fut (SUPABASE_URL: Variables, SUPABASE_SECRET_KEY: Secrets).
A titkos kulcs a sorszintű jogosultságot megkerüli, ezért soha nem kerül a böngészőbe.

Hibánál a kivétel szövege csak a HTTP kódot és a PostgREST hibakódot tartalmazza,
a részleteket (amelyekben adat, pl. eszközazonosító lehetne) szándékosan nem.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request


class SupabaseError(RuntimeError):
    def __init__(self, status: int, code: str, hint: str = ""):
        super().__init__(f"Supabase hiba: HTTP {status} {code}".strip() + (f" ({hint})" if hint else ""))
        self.status = status
        self.code = code


# PostgREST / Postgres hibakódok, amelyekhez biztonságosan adhatunk magyar tippet.
_HINTS = {
    "PGRST204": "hiányzó oszlop: futtasd a supabase/migrations mappa SQL-jeit",
    "PGRST205": "hiányzó tábla: futtasd a supabase/schema.sql-t",
    "42P01": "hiányzó tábla: futtasd a supabase/schema.sql-t",
    "42703": "hiányzó oszlop: futtasd a supabase/migrations mappa SQL-jeit",
    "23505": "ütköző egyedi érték",
    "23503": "hiányzó hivatkozott sor (pl. ismeretlen pink szám)",
    "42501": "jogosultság megtagadva: biztosan a secret kulcs van beállítva?",
}


class SupabaseRest:
    def __init__(self, url: str, key: str):
        if not url or not key:
            raise ValueError("Hiányzó SUPABASE_URL vagy SUPABASE_SECRET_KEY")
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = key

    @classmethod
    def from_env(cls) -> "SupabaseRest | None":
        url = os.environ.get("SUPABASE_URL", "").strip()
        key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        if not url or not key:
            return None
        return cls(url, key)

    def _req(self, method: str, path: str, params: dict | None = None, body=None, prefer: str = ""):
        url = f"{self.base}/{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode() or ""
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                code = str(json.loads(raw).get("code", ""))
            except (json.JSONDecodeError, AttributeError):
                code = ""
            raise SupabaseError(e.code, code, _HINTS.get(code, "")) from None
        except urllib.error.URLError as e:
            raise SupabaseError(0, "NETWORK", type(e.reason).__name__) from None

    def select(self, table: str, columns: str = "*", **filters) -> list[dict]:
        params = {"select": columns}
        params.update(filters)
        return self._req("GET", table, params) or []

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if rows:
            self._req("POST", table, {"on_conflict": on_conflict}, rows,
                      prefer="resolution=merge-duplicates,return=minimal")

    def insert(self, table: str, rows: list[dict]) -> None:
        if rows:
            self._req("POST", table, None, rows, prefer="return=minimal")
