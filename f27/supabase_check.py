"""Supabase beállítás ellenőrzése, csak a NYILVÁNOS (publishable / anon) kulccsal.

Ellenőrzi:
  1. a projekt elérhető-e, és a kulcs érvényes-e;
  2. ki van-e kapcsolva az idegen regisztráció (Allow new users to sign up = OFF);
  3. lefutott-e a séma (léteznek-e a táblák);
  4. a névtelen (anon) hozzáférés minden táblán TILTVA van-e.

A publikus Actions logba csak OK / HIBA kerül, adat nem.

Futtatás:  SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... python -m f27.supabase_check
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

TABLES = ["app_users", "layouts", "devices", "device_status", "device_latest", "energy_daily"]


def call(url: str, key: str) -> tuple[int, dict]:
    req = urllib.request.Request(url, headers={"apikey": key, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode() or "{}"
            return r.status, (json.loads(body) if body.strip().startswith(("{", "[")) else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace") or "{}"
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {}


def main() -> int:
    base = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not base or not key:
        print("::error::Hiányzik a SUPABASE_URL vagy a SUPABASE_PUBLISHABLE_KEY (GitHub Variables).")
        return 1

    rows: list[tuple[str, bool, str]] = []

    code, body = call(f"{base}/auth/v1/settings", key)
    body = body if isinstance(body, dict) else {}
    rows.append(("Projekt elérhető, kulcs érvényes", code == 200, f"HTTP {code}"))
    if code == 200:
        rows.append(("Idegen regisztráció kikapcsolva", body.get("disable_signup") is True,
                     "OK" if body.get("disable_signup") else "Authentication > Sign In / Providers: Allow new users to sign up = OFF"))

    for t in TABLES:
        code, body = call(f"{base}/rest/v1/{t}?select=*&limit=1", key)
        pg = str(body.get("code", "")) if isinstance(body, dict) else ""
        missing = code == 404 or pg in ("42P01", "PGRST205")
        denied = code in (401, 403) and pg == "42501"
        if missing:
            rows.append((f"Tábla: {t}", False, "nem létezik: futtasd a supabase/schema.sql-t"))
        elif denied:
            rows.append((f"Tábla: {t}", True, "létezik, névtelenül tiltva"))
        elif code == 200:
            rows.append((f"Tábla: {t}", False, "névtelenül OLVASHATÓ: a séma jogosultsági része nem futott le"))
        else:
            rows.append((f"Tábla: {t}", False, f"váratlan válasz: HTTP {code} {pg}"))

    ok = all(r[1] for r in rows)
    lines = ["| Ellenőrzés | Eredmény | Megjegyzés |", "|---|---|---|"]
    lines += [f"| {name} | {'OK' if good else 'HIBA'} | {note} |" for name, good, note in rows]
    lines += ["", "Minden rendben." if ok else "Van javítandó, lásd a HIBA sorokat."]
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Supabase ellenőrzés\n\n" + report + "\n")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
