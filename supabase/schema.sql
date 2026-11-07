-- F27 Energy: Supabase adatbázis-séma
-- Futtatás: Supabase > SQL Editor > New query > ennek a fájlnak a teljes tartalma > Run.
-- Újrafuttatható (idempotens): ami már létezik, azt nem rontja el.
--
-- Jogosultság röviden:
--   * Névtelen látogató (anon) semmit nem lát és nem ír.
--   * Bejelentkezett felhasználó csak akkor lát bármit, ha szerepel az app_users táblában.
--   * owner: mindent lát, elrendezést ment és töröl.
--   * cleaner / viewer: elrendezéseket és az aktuális állapotot látja, írni nem tud.
--   * A mérési adatokat csak a GitHub Actions adatgyűjtő írja, a titkos (secret / service_role)
--     kulccsal, ami a sorszintű szabályokat megkerüli. Ez a kulcs csak GitHub Secrets-ben él.

-- ---------------------------------------------------------------------------
-- Felhasználók és szerepkörök
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'cleaner', 'viewer')),
  created_at timestamptz not null default now()
);

-- A bejelentkezett felhasználó szerepköre (null, ha nincs a listán).
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.app_users where user_id = auth.uid()
$$;

revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Mentett lakás-elrendezések (húzható bútorok és eszközök pozíciói)
-- ---------------------------------------------------------------------------
create table if not exists public.layouts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  data        jsonb not null,               -- { "bed": [dx, dy], "pin:8": [dx, dy], ... }
  note        text,
  is_default  boolean not null default false,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists layouts_name_key on public.layouts (lower(name));
create unique index if not exists layouts_one_default on public.layouts (is_default) where is_default;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists layouts_touch on public.layouts;
create trigger layouts_touch before update on public.layouts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Eszközök (pink szám -> Tuya eszköz). A Tuya device ID csak az ownernek látszik.
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  pink           text primary key,          -- '1'..'11', 'P', 'X5', 'X7', 'X8', 'X9', 'G'
  role           text not null,             -- thermo, contact, breaker, switch3, ac_ir, gateway
  room           text,
  label          text not null,
  tuya_device_id text unique,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Eszközállapotok idősora. Az adatgyűjtő csak változáskor (vagy óránként) ír,
-- így a sorok száma kezelhető marad az ingyenes 500 MB-os kereten belül.
-- ---------------------------------------------------------------------------
create table if not exists public.device_status (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  pink    text not null references public.devices (pink) on delete cascade,
  online  boolean,
  status  jsonb not null                    -- nyers Tuya status: { "va_temperature": 236, ... }
);

create index if not exists device_status_pink_ts on public.device_status (pink, ts desc);

-- Legfrissebb állapot eszközönként (a térkép ezt olvassa).
create or replace view public.device_latest
with (security_invoker = true) as
select distinct on (pink) pink, ts, online, status
from public.device_status
order by pink, ts desc;

-- ---------------------------------------------------------------------------
-- Napi energia körönként (okos kismegszakítók: X5 kályha, X7 bojler, X8 főzőlap, X9 klíma)
-- ---------------------------------------------------------------------------
create table if not exists public.energy_daily (
  day   date not null,
  pink  text not null references public.devices (pink) on delete cascade,
  kwh   numeric(10, 3) not null check (kwh >= 0),
  primary key (day, pink)
);

-- ---------------------------------------------------------------------------
-- Sorszintű jogosultság (RLS)
-- ---------------------------------------------------------------------------
alter table public.app_users     enable row level security;
alter table public.layouts       enable row level security;
alter table public.devices       enable row level security;
alter table public.device_status enable row level security;
alter table public.energy_daily  enable row level security;

-- app_users: mindenki a saját sorát látja, az owner mindet.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.my_role()) = 'owner');

-- layouts: minden tag olvas, csak az owner ír.
drop policy if exists layouts_select on public.layouts;
create policy layouts_select on public.layouts
  for select to authenticated
  using ((select public.my_role()) is not null);

drop policy if exists layouts_insert on public.layouts;
create policy layouts_insert on public.layouts
  for insert to authenticated
  with check ((select public.my_role()) = 'owner');

drop policy if exists layouts_update on public.layouts;
create policy layouts_update on public.layouts
  for update to authenticated
  using ((select public.my_role()) = 'owner')
  with check ((select public.my_role()) = 'owner');

drop policy if exists layouts_delete on public.layouts;
create policy layouts_delete on public.layouts
  for delete to authenticated
  using ((select public.my_role()) = 'owner');

-- devices: csak az owner (benne van a Tuya device ID).
drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices
  for select to authenticated
  using ((select public.my_role()) = 'owner');

-- device_status: minden tag olvas (a takarító is lássa a hőmérsékleteket).
drop policy if exists device_status_select on public.device_status;
create policy device_status_select on public.device_status
  for select to authenticated
  using ((select public.my_role()) is not null);

-- energy_daily: csak az owner.
drop policy if exists energy_daily_select on public.energy_daily;
create policy energy_daily_select on public.energy_daily
  for select to authenticated
  using ((select public.my_role()) = 'owner');

-- Az anon szerepkör semmihez ne férjen hozzá (az RLS ezt amúgy is biztosítja).
revoke all on public.app_users, public.layouts, public.devices, public.device_status,
  public.energy_daily, public.device_latest from anon;
