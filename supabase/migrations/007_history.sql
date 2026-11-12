-- 007: előzmények, háromszintű tárolás (a tulaj kérése, 2026.11.12)
-- Futtatás: Supabase > SQL Editor > New query > ennek a fájlnak a teljes tartalma > Run.
-- Újrafuttatható: ami már létezik, azt nem rontja el, adatot nem töröl.
--
-- Szintek:
--   1. Nyers (90 napig): device_status (10 perces pillanatkép, ajtó/ablak események) és az új
--      tuya_log (a Tuya eszköznapló bejegyzései: fogyasztás-növekmény, teljesítmény, hőmérséklet).
--      A 90 napnál régebbi nyers sorokat az adatgyűjtő törli (az ajtó/ablak eseményeket nem).
--   2. Órás összesítő (örökre): metrics_hourly, körönként és hőmérőnként.
--   3. Napi összesítő (örökre): energy_daily (mostantól a Tuya-naplóból, source = 'log'),
--      weather_daily nézet.
-- Mellette: energy_app_history, a Smart Life app Electricity füléről (képernyőképből) beírt
-- múltbeli értékek. Mérési adat: csak a tulaj látja, és a publikus repóba nem kerül.

-- ---------------------------------------------------------------------------
-- 1. A Smart Life app előzményei (kézzel, a tulaj futtatja az SQL Editorban)
-- ---------------------------------------------------------------------------
create table if not exists public.energy_app_history (
  pink         text not null references public.devices (pink) on delete cascade,
  period       text not null check (period in ('hour', 'day', 'month', 'year', 'lifetime')),
  period_start timestamptz not null,               -- az időszak kezdete (Budapest szerinti nap/hónap/év eleje)
  kwh          numeric(12, 3) not null check (kwh >= 0),
  exact        boolean not null default false,     -- true: az app fejlécében kiírt szám; false: oszlopmagasságból leolvasva
  partial      boolean not null default false,     -- true: az időszak a felvételkor még nem zárult le
  note         text check (char_length(note) <= 200),
  source       text not null default 'smartlife-app',
  recorded_at  timestamptz not null default now(),
  primary key (pink, period, period_start)
);

-- ---------------------------------------------------------------------------
-- 2. A Tuya eszköznapló nyers bejegyzései (az adatgyűjtő írja, 90 napig)
-- ---------------------------------------------------------------------------
create table if not exists public.tuya_log (
  pink  text not null references public.devices (pink) on delete cascade,
  ts    timestamptz not null,                      -- a jelentés ideje (Tuya event_time)
  code  text not null,                             -- pl. add_ele, cur_power, va_temperature
  value numeric,                                   -- nyers érték (a skálát a devices.meta adja)
  primary key (pink, ts, code)
);
create index if not exists tuya_log_ts_idx on public.tuya_log (ts);

-- ---------------------------------------------------------------------------
-- 3. Órás összesítő (örökre)
-- ---------------------------------------------------------------------------
create table if not exists public.metrics_hourly (
  pink     text not null references public.devices (pink) on delete cascade,
  hour     timestamptz not null,                   -- az óra kezdete (UTC)
  kwh      numeric(10, 4),                         -- kismegszakító: az órában felvett energia
  w_max    numeric(8, 1),                          -- kismegszakító: legnagyobb jelentett teljesítmény, W
  temp_avg numeric(5, 2),                          -- hőmérő: átlag, °C
  temp_min numeric(5, 2),
  temp_max numeric(5, 2),
  hum_avg  numeric(5, 2),                          -- hőmérő: átlagos páratartalom, %
  n        integer not null default 0,             -- ennyi naplóbejegyzésből
  primary key (pink, hour)
);
create index if not exists metrics_hourly_hour_idx on public.metrics_hourly (hour);

-- ---------------------------------------------------------------------------
-- 4. energy_daily: honnan jön a sor ('log' = a Tuya-napló add_ele összege)
-- ---------------------------------------------------------------------------
alter table public.energy_daily add column if not exists source text;

-- ---------------------------------------------------------------------------
-- Jogosultság: mérési adat, csak az owner olvassa; írni csak az adatgyűjtő (secret kulcs) és
-- a tulaj az SQL Editorban tud.
-- ---------------------------------------------------------------------------
alter table public.energy_app_history enable row level security;
alter table public.tuya_log           enable row level security;
alter table public.metrics_hourly     enable row level security;

drop policy if exists energy_app_history_select on public.energy_app_history;
create policy energy_app_history_select on public.energy_app_history
  for select to authenticated
  using ((select public.my_role()) = 'owner');

drop policy if exists tuya_log_select on public.tuya_log;
create policy tuya_log_select on public.tuya_log
  for select to authenticated
  using ((select public.my_role()) = 'owner');

drop policy if exists metrics_hourly_select on public.metrics_hourly;
create policy metrics_hourly_select on public.metrics_hourly
  for select to authenticated
  using ((select public.my_role()) = 'owner');

revoke all on public.energy_app_history, public.tuya_log, public.metrics_hourly from anon;
grant select on public.energy_app_history, public.tuya_log, public.metrics_hourly to authenticated;
