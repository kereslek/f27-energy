-- 003: óránkénti időjárás (Open-Meteo, Budapest IX. kerület) és napi összesítők
-- Futtatás: Supabase > SQL Editor > New query > ennek a fájlnak a teljes tartalma > Run.
-- Újrafuttatható: ami már létezik, azt nem rontja el, adatot nem töröl.
--
-- Az adatgyűjtő (GitHub Actions) óránként egyszer tölti: az elmúlt 2 nap mért (modell-
-- elemzés) óráit és a következő kb. 1 nap előrejelzését. Egy óra sora addig frissül, amíg
-- a lekérés pillanatában még jövőbeli (is_forecast = true); utána a mért érték marad.

create table if not exists public.weather_hourly (
  ts           timestamptz primary key,          -- az óra kezdete (UTC)
  temp         numeric(4, 1),                    -- léghőmérséklet 2 m-en, °C
  apparent     numeric(4, 1),                    -- hőérzet, °C
  humidity     smallint,                         -- relatív páratartalom, %
  dew_point    numeric(4, 1),                    -- harmatpont, °C
  precip       numeric(5, 1),                    -- csapadék az órában, mm
  cloud        smallint,                         -- felhőzet, %
  wind         numeric(4, 1),                    -- szél 10 m-en, km/h
  gust         numeric(4, 1),                    -- széllökés, km/h
  radiation    numeric(6, 1),                    -- rövidhullámú (nap)sugárzás, W/m² (az órára átlag)
  weather_code smallint,                         -- WMO időjáráskód
  is_day       boolean,
  is_forecast  boolean not null default false,   -- a legutóbbi lekéréskor még nem telt el az óra
  fetched_at   timestamptz not null default now()
);
create index if not exists weather_hourly_fetched_idx on public.weather_hourly (fetched_at desc);

alter table public.weather_hourly enable row level security;

-- Minden listán szereplő felhasználó olvashatja (a térkép KINT csipje innen olvas).
drop policy if exists weather_hourly_select on public.weather_hourly;
create policy weather_hourly_select on public.weather_hourly
  for select to authenticated
  using ((select public.my_role()) is not null);

-- Napi időjárás budapesti napokra, csak a már eltelt (mért) órákból.
-- Hőfokhíd az Eurostat szerint:
--   fűtési (hdd):  ha a napi átlag <= 15 °C, akkor 18 - átlag, egyébként 0;
--   hűtési (cdd):  ha a napi átlag >= 24 °C, akkor átlag - 21, egyébként 0.
-- Napsugárzás: az órás W/m² értékek összege / 1000 = kWh/m² naponta.
create or replace view public.weather_daily
with (security_invoker = true) as
select
  d.day,
  d.hours,
  round(d.t_avg, 1) as t_avg,
  d.t_min,
  d.t_max,
  round(case when d.t_avg <= 15 then 18 - d.t_avg else 0 end, 1) as hdd,
  round(case when d.t_avg >= 24 then d.t_avg - 21 else 0 end, 1) as cdd,
  d.sun_kwh_m2,
  d.precip,
  d.wind_avg
from (
  select
    (ts at time zone 'Europe/Budapest')::date as day,
    count(*)::int as hours,
    avg(temp) as t_avg,
    min(temp) as t_min,
    max(temp) as t_max,
    round(sum(radiation) / 1000, 2) as sun_kwh_m2,
    round(sum(precip), 1) as precip,
    round(avg(wind), 1) as wind_avg
  from public.weather_hourly
  where not is_forecast
  group by 1
) d;

-- Napi energia körönként az időjárás mellett (elemzéshez: kályha kWh a hőfokhíd
-- függvényében, klíma hűtés a melegnapok függvényében stb.). Az energy_daily sorszintű
-- szabálya érvényes: az energia oszlopokat csak az owner látja.
create or replace view public.energy_weather_daily
with (security_invoker = true) as
select
  w.*,
  x5.kwh as stove_kwh,
  x7.kwh as boiler_kwh,
  x8.kwh as kitchen_kwh,
  x9.kwh as ac_kwh
from public.weather_daily w
left join public.energy_daily x5 on x5.day = w.day and x5.pink = 'X5'
left join public.energy_daily x7 on x7.day = w.day and x7.pink = 'X7'
left join public.energy_daily x8 on x8.day = w.day and x8.pink = 'X8'
left join public.energy_daily x9 on x9.day = w.day and x9.pink = 'X9';

revoke all on public.weather_hourly, public.weather_daily, public.energy_weather_daily from anon;
grant select on public.weather_hourly, public.weather_daily, public.energy_weather_daily to authenticated;
