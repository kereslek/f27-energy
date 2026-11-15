-- 011: hozzáférések (mindkét projektben: F27 és O2B). Újrafuttatható.
--
-- 1. Szerepkörök és név:
--      owner   tulaj: mindent lát és állít, elrendezést ment, felhasználót és bemutató linket kezel
--      member  családtag: mindent lát, az O2B-ben kapcsolhat és időzíthet
--      cleaner takarító (F27): lát, a foglalásokat is
--      viewer  megtekintő: csak lát, semmit nem kapcsol
--    A felhasználót a tulaj a térképről veszi fel (Hozzáférések panel, "users" Supabase-függvény).
--
-- 2. Ideiglenes bemutató link (59:59): a tulaj generálja, bárki megnyithatja, aki megkapja.
--    * A link egy 256 bites véletlen token (43 karakter, a címben # után, így a szerver és a
--      Referer nem látja). Az adatbázis csak a SHA-256 lenyomatát tárolja: ha a tábla kiszivárogna,
--      abból sem lehet linket csinálni. A tokent csak a létrehozáskor látja a tulaj.
--    * Az első megnyitástól 59 perc 59 másodpercig él; ha 24 órán belül senki nem nyitja meg, lejár.
--      A tulaj bármikor visszavonhatja. A lejáratot az adatbázis érvényesíti (RLS), nem a böngésző.
--    * A link csak olvas: az anon szerepkör a lenti táblákból, a lenti oszlopokat olvashatja, írni
--      semmit nem tud, a kapcsoló függvény (control) pedig belépett tagot kér, így kapcsolni sem.
--    * Nem látszik: utcanév (site_info), felhasználók, riasztási beállítások, kapcsolási szabályok,
--      napló, Tuya-azonosítók (devices.tuya_device_id), mérési skálák.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Szerepkörök és név
-- ---------------------------------------------------------------------------
alter table public.app_users add column if not exists name text;
alter table public.app_users drop constraint if exists app_users_name_check;
alter table public.app_users add constraint app_users_name_check
  check (name is null or char_length(name) between 1 and 40);
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role in ('owner', 'member', 'cleaner', 'viewer'));

-- a foglalásokat a családtag is látja (F27)
do $$ begin
  if to_regclass('public.bookings') is not null then
    drop policy if exists bookings_select on public.bookings;
    create policy bookings_select on public.bookings for select to authenticated
      using ((select public.my_role()) in ('owner', 'member', 'cleaner'));
  end if;
end $$;

-- a családtag mindent lát, amit a tulaj (módosítani nem tud): a régi, felsorolt szerepkörű szabályok bővítése
do $$ begin
  if to_regclass('public.devices') is not null then
    drop policy if exists devices_select on public.devices;
    create policy devices_select on public.devices for select to authenticated
      using ((select public.my_role()) in ('owner', 'member'));
  end if;
  if to_regclass('public.energy_daily') is not null then
    drop policy if exists energy_daily_select on public.energy_daily;
    create policy energy_daily_select on public.energy_daily for select to authenticated
      using ((select public.my_role()) in ('owner', 'member'));
  end if;
  if to_regclass('public.alert_state') is not null then
    drop policy if exists alert_state_select on public.alert_state;
    create policy alert_state_select on public.alert_state for select to authenticated
      using ((select public.my_role()) in ('owner', 'member', 'cleaner'));
  end if;
  if to_regclass('public.battery_status') is not null then
    drop policy if exists battery_status_select on public.battery_status;
    create policy battery_status_select on public.battery_status for select to authenticated
      using ((select public.my_role()) in ('owner', 'member', 'cleaner', 'viewer'));
  end if;
  if to_regclass('public.site_info') is not null then
    drop policy if exists site_info_select on public.site_info;
    create policy site_info_select on public.site_info for select to authenticated
      using ((select public.my_role()) in ('owner', 'member', 'cleaner', 'viewer'));
  end if;
  if to_regclass('public.control_log') is not null then
    drop policy if exists control_log_select on public.control_log;
    create policy control_log_select on public.control_log for select to authenticated
      using ((select public.my_role()) in ('owner', 'member', 'cleaner', 'viewer'));
  end if;
end $$;

-- kapcsolás (O2B): mindenki látja, de szabályt, időzítőt csak a tulaj és a családtag ír
do $$ begin
  if to_regclass('public.control_rules') is not null then
    drop policy if exists control_rules_rw on public.control_rules;
    drop policy if exists control_rules_read on public.control_rules;
    create policy control_rules_read on public.control_rules for select to authenticated
      using ((select public.my_role()) in ('owner', 'member', 'cleaner', 'viewer'));
    create policy control_rules_rw on public.control_rules for all to authenticated
      using ((select public.my_role()) in ('owner', 'member'))
      with check ((select public.my_role()) in ('owner', 'member'));
  end if;
  if to_regclass('public.control_timers') is not null then
    drop policy if exists control_timers_rw on public.control_timers;
    drop policy if exists control_timers_read on public.control_timers;
    create policy control_timers_read on public.control_timers for select to authenticated
      using ((select public.my_role()) in ('owner', 'member', 'cleaner', 'viewer'));
    create policy control_timers_rw on public.control_timers for all to authenticated
      using ((select public.my_role()) in ('owner', 'member'))
      with check ((select public.my_role()) in ('owner', 'member'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ideiglenes bemutató linkek
-- ---------------------------------------------------------------------------
create table if not exists public.share_links (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  note         text check (note is null or char_length(note) <= 60),
  created_by   uuid references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  open_by      timestamptz not null,           -- eddig kell először megnyitni (létrehozás + 24 óra)
  activated_at timestamptz,                    -- az első megnyitás
  expires_at   timestamptz,                    -- activated_at + 59:59
  revoked_at   timestamptz,
  opens        integer not null default 0,
  last_seen    timestamptz
);
alter table public.share_links enable row level security;
-- közvetlenül senki nem éri el, csak a lenti függvényeken át
revoke all on public.share_links from public, anon, authenticated;

-- A kérés x-share-token fejlécéből a token lenyomata (null, ha nincs vagy rossz alakú).
create or replace function public.share_hash() returns text
language sql stable security definer set search_path = '' as $$
  select case when s.t ~ '^[A-Za-z0-9_-]{43}$' then encode(extensions.digest(s.t, 'sha256'), 'hex') end
  from (select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-share-token', '') as t) s
$$;
revoke all on function public.share_hash() from public, anon, authenticated;

-- Érvényes, már megnyitott, le nem járt és vissza nem vont linkkel jött-e a kérés.
create or replace function public.share_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.share_links l
    where l.token_hash = public.share_hash()
      and l.revoked_at is null and l.expires_at is not null and now() < l.expires_at)
$$;
revoke all on function public.share_ok() from public, authenticated;
grant execute on function public.share_ok() to anon;

-- A link megnyitása: az első alkalommal elindítja az 59:59-et. Választ ad a lejáratról.
-- p_ping: a nyitott oldal kétpercenkénti ellenőrzése (visszavonták-e), nem számít megnyitásnak.
drop function if exists public.share_open();
create or replace function public.share_open(p_ping boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare h text := public.share_hash(); l public.share_links%rowtype;
begin
  if h is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into l from public.share_links where token_hash = h for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if l.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if l.activated_at is null then
    if now() > l.open_by then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
    update public.share_links set activated_at = now(), expires_at = now() + interval '59 minutes 59 seconds'
      where id = l.id returning * into l;
  end if;
  if now() >= l.expires_at then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  update public.share_links set opens = opens + (case when p_ping then 0 else 1 end), last_seen = now() where id = l.id;
  return jsonb_build_object('ok', true, 'started', l.activated_at, 'expires_at', l.expires_at, 'now', now());
end $$;
revoke all on function public.share_open(boolean) from public, authenticated;
grant execute on function public.share_open(boolean) to anon;

-- Új link (csak a tulaj). A tokent csak most adja vissza, a tábla a lenyomatát őrzi.
create or replace function public.share_create(p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare tok text; n integer; r public.share_links%rowtype;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception 'Bemutató linket csak a tulaj készíthet.' using errcode = '42501';
  end if;
  delete from public.share_links where created_at < now() - interval '30 days';
  select count(*) into n from public.share_links
    where revoked_at is null and ((expires_at is null and open_by > now()) or expires_at > now());
  if n >= 20 then raise exception 'Már 20 élő link van: vonj vissza néhányat.' using errcode = 'P0001'; end if;
  tok := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.share_links (token_hash, note, created_by, open_by)
    values (encode(extensions.digest(tok, 'sha256'), 'hex'),
            nullif(left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', '', 'g')), 60), ''),
            auth.uid(), now() + interval '24 hours')
    returning * into r;
  return jsonb_build_object('id', r.id, 'token', tok, 'open_by', r.open_by, 'note', r.note);
end $$;
revoke all on function public.share_create(text) from public, anon;
grant execute on function public.share_create(text) to authenticated;

-- A tulaj listája az elmúlt 7 nap linkjeiről (token nélkül). Másnak üres.
create or replace function public.share_list()
returns table (id uuid, note text, created_at timestamptz, open_by timestamptz, activated_at timestamptz,
               expires_at timestamptz, revoked_at timestamptz, opens integer, last_seen timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.note, l.created_at, l.open_by, l.activated_at, l.expires_at, l.revoked_at, l.opens, l.last_seen
  from public.share_links l
  where public.my_role() = 'owner' and l.created_at > now() - interval '7 days'
  order by l.created_at desc limit 50
$$;
revoke all on function public.share_list() from public, anon;
grant execute on function public.share_list() to authenticated;

-- Visszavonás (csak a tulaj): azonnal hat, a következő lekérdezéstől a link semmit nem lát.
create or replace function public.share_revoke(p_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  update public.share_links set revoked_at = now()
  where id = p_id and revoked_at is null and public.my_role() = 'owner'
  returning true
$$;
revoke all on function public.share_revoke(uuid) from public, anon;
grant execute on function public.share_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mit lát a bemutató link (anon + érvényes x-share-token): csak olvasás, oszlopra szűkítve
-- ---------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.devices') is not null then
    revoke all on public.devices from anon;
    grant select (pink, role, room, label) on public.devices to anon;   -- a Tuya-azonosító és a skála nem
    drop policy if exists devices_share on public.devices;
    create policy devices_share on public.devices for select to anon using ((select public.share_ok()));
  end if;
  if to_regclass('public.device_status') is not null then
    revoke all on public.device_status from anon;
    grant select (ts, pink, online, status) on public.device_status to anon;
    drop policy if exists device_status_share on public.device_status;
    create policy device_status_share on public.device_status for select to anon
      using ((select public.share_ok()) and ts > now() - interval '35 days');
  end if;
  if to_regclass('public.device_latest') is not null then
    revoke all on public.device_latest from anon;
    grant select on public.device_latest to anon;                      -- security_invoker: a fenti szabály szűr
  end if;
  if to_regclass('public.weather_hourly') is not null then
    revoke all on public.weather_hourly from anon;
    grant select on public.weather_hourly to anon;
    drop policy if exists weather_hourly_share on public.weather_hourly;
    create policy weather_hourly_share on public.weather_hourly for select to anon using ((select public.share_ok()));
  end if;
  if to_regclass('public.battery_status') is not null then
    revoke all on public.battery_status from anon;
    grant select on public.battery_status to anon;
    drop policy if exists battery_status_share on public.battery_status;
    create policy battery_status_share on public.battery_status for select to anon using ((select public.share_ok()));
  end if;
  if to_regclass('public.energy_daily') is not null then
    revoke all on public.energy_daily from anon;
    grant select on public.energy_daily to anon;
    drop policy if exists energy_daily_share on public.energy_daily;
    create policy energy_daily_share on public.energy_daily for select to anon
      using ((select public.share_ok()) and day > current_date - 40);
  end if;
  if to_regclass('public.bookings') is not null then
    -- a foglaltság publikus (az Airbnb naptárában is látszik); a forrás azonosítója (id) nem
    revoke all on public.bookings from anon;
    grant select (source, kind, start_date, end_date, seen_at) on public.bookings to anon;
    drop policy if exists bookings_share on public.bookings;
    create policy bookings_share on public.bookings for select to anon
      using ((select public.share_ok()) and end_date >= current_date - 40);
  end if;
  if to_regclass('public.layouts') is not null then
    revoke all on public.layouts from anon;
    grant select (id, name, data, is_default, updated_at) on public.layouts to anon;
    drop policy if exists layouts_share on public.layouts;
    create policy layouts_share on public.layouts for select to anon using ((select public.share_ok()) and is_default);
  end if;
end $$;

notify pgrst, 'reload schema';
