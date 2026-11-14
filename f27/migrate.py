"""Adatbázis-séma futtatása a Supabase Management API-n át (a tulaj helyett, SQL Editor nélkül).

Actions > "Supabase séma futtatása": a supabase/ alatti SQL-fájlt (alapból a teljes, újrafuttatható
supabase/setup_all.sql-t) lefuttatja a kiválasztott telephely(ek) projektjében, utána ellenőriz.

Titok: SUPABASE_ACCESS_TOKEN (GitHub Secrets; a tulaj személyes hozzáférési kulcsa a Supabase
fiókjából, Account > Access Tokens). Ez a fiók minden projektjéhez hozzáfér, ezért csak itt él,
soha nem a kódban, a chatben vagy a böngészőben.

A log publikus: csak a projekt rövid jele, OK / HIBA, táblaszám és tulajdonos-darabszám kerül bele;
hibánál a Postgres-üzenet első sora, a DETAIL rész (amelyben adat lehetne) nélkül.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.supabase.com/v1/projects/{ref}/database/query"

CHECK_SQL = """
select
  (select count(*) from pg_tables where schemaname = 'public') as tables,
  (select count(*) from public.app_users where role = 'owner') as owners
"""


def project_ref(url: str) -> str:
    m = re.match(r"^https://([a-z0-9]{20})\.supabase\.co/?$", (url or "").strip())
    if not m:
        raise ValueError("a Supabase URL nem https://<ref>.supabase.co alakú")
    return m.group(1)


def clean_error(text: str) -> str:
    """A Postgres-hiba első sora, a DETAIL / Failing row rész nélkül (abban sorérték lehet)."""
    try:
        text = json.loads(text).get("message") or text
    except (ValueError, AttributeError):
        pass
    text = re.split(r"DETAIL|Failing row|\n", str(text))[0]
    return text.strip()[:200]


def run_sql(ref: str, token: str, sql: str, opener=urllib.request.urlopen) -> list:
    req = urllib.request.Request(API.format(ref=ref), method="POST",
                                 data=json.dumps({"query": sql}).encode("utf-8"),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "f27-energy-migrate"})
    try:
        with opener(req, timeout=120) as r:
            body = r.read().decode("utf-8") or "[]"
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {clean_error(e.read().decode('utf-8', 'replace'))}") from None
    data = json.loads(body)
    return data if isinstance(data, list) else []


def sql_file(name: str) -> Path:
    p = (ROOT / name).resolve()
    if p.suffix != ".sql" or (ROOT / "supabase") not in p.parents or not p.is_file():
        raise ValueError("csak a supabase/ alatti .sql fájl futtatható")
    return p


def targets(choice: str, environ) -> list[tuple[str, str]]:
    sites = {"f27": environ.get("SUPABASE_URL", ""), "o2b": environ.get("O2B_SUPABASE_URL", "")}
    keys = list(sites) if choice in ("mindketto", "all", "") else [choice]
    return [(k.upper(), sites.get(k, "")) for k in keys]


def main(environ=None, opener=urllib.request.urlopen) -> int:
    environ = os.environ if environ is None else environ
    token = environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        print("| Projekt | Eredmény | Megjegyzés |\n|---|---|---|\n| - | HIBA | nincs SUPABASE_ACCESS_TOKEN secret (docs/supabase-setup.md) |")
        return 1
    try:
        path = sql_file(environ.get("SQL_FILE") or "supabase/setup_all.sql")
    except ValueError as e:
        print(f"HIBA: {e}")
        return 1
    sql = path.read_text(encoding="utf-8")
    bad = 0
    print(f"Fájl: {path.relative_to(ROOT)}\n")
    print("| Projekt | Eredmény | Megjegyzés |\n|---|---|---|")
    for tag, url in targets(environ.get("TARGET", "mindketto"), environ):
        if not url:
            print(f"| {tag} | kihagyva | nincs beállítva a projekt URL-je |")
            continue
        try:
            ref = project_ref(url)
            run_sql(ref, token, sql, opener)
            row = (run_sql(ref, token, CHECK_SQL, opener) or [{}])[0]
            owners = int(row.get("owners") or 0)
            note = f"lefutott; {row.get('tables')} tábla, tulajdonos: {owners}"
            print(f"| {tag} | {'OK' if owners else 'HIBA'} | {note}{'' if owners else ' (nincs owner felhasználó)'} |")
            bad += 0 if owners else 1
        except Exception as e:                                # hálózat, jogosultság, SQL-hiba
            print(f"| {tag} | HIBA | {e} |")
            bad += 1
    print("\nMinden rendben." if not bad else "\nVan javítandó, lásd a HIBA sorokat.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
