-- 008: elemcsere-előrejelzés (f27/battery.py). Újrafuttatható.
--
-- Eszközönként egy sor: napi minták (naponta egy), az utolsó elemcsere napja, a korábbi
-- élettartamok (ebből tanul a becslés), a becslés (szint, nap-tartomány) és hogy ment-e már
-- push 14 napon belüli / lemerült elemről. Írni csak a titkos kulcs tud (Actions),
-- olvasni a tulaj, a takarító és a megtekintő (a dashboard ELEM csempéje).
--
--   level: ok | due30 (30 napon belül) | due14 (14 napon belül) | dead (lemerült)
--          | offline (elemes eszköz, amely nem jelentkezik: valószínűleg elem kell) | unknown

create table if not exists public.battery_status (
  pink        text primary key check (char_length(pink) <= 20),
  label       text check (char_length(label) <= 200),
  chem        text check (char_length(chem) <= 20),
  kind        text check (kind in ('pct', 'state')),
  value       text check (char_length(value) <= 20),
  changed_at  date,
  samples     jsonb not null default '[]'::jsonb,
  lifetimes   jsonb not null default '[]'::jsonb,
  level       text not null default 'unknown' check (level in ('ok', 'due30', 'due14', 'dead', 'unknown')),
  eta_lo      integer,
  eta_hi      integer,
  basis       text check (char_length(basis) <= 100),
  notified    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- a korábbi változatból hiányzott az 'offline' szint: a szabály újra, bővítve (régi táblán is)
alter table public.battery_status drop constraint if exists battery_status_level_check;
alter table public.battery_status add constraint battery_status_level_check
  check (level in ('ok', 'due30', 'due14', 'dead', 'offline', 'unknown'));

alter table public.battery_status enable row level security;

drop policy if exists battery_status_select on public.battery_status;
create policy battery_status_select on public.battery_status
  for select to authenticated
  using ((select public.my_role()) in ('owner', 'cleaner', 'viewer'));

revoke all on public.battery_status from anon;
grant select on public.battery_status to authenticated;

-- A REST-réteg azonnal lássa az új táblát (különben az ellenőrzés "nem létezik"-et mondhat).
notify pgrst, 'reload schema';
