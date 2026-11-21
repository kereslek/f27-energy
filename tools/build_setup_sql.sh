#!/usr/bin/env bash
# A teljes séma egy fájlban (új telephely Supabase-projektjéhez): schema.sql + minden migráció.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- O2B (és bármely új telephely) teljes adatbázis-sémája egy fájlban: supabase/schema.sql + migrations/002-016."
  echo "-- Generálva: tools/build_setup_sql.sh. Újrafuttatható (create if not exists, drop policy if exists)."
  echo "-- Az új Supabase-projekt SQL Editorában egyben futtasd (Run). Adat nem vész el."
  for f in supabase/schema.sql supabase/migrations/0*.sql; do
    echo; echo "-- ===================================================================== $f"; cat "$f"
  done
} > supabase/setup_all.sql
