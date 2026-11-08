-- 006: riasztások (beállítás, állapot, napló)
-- Futtatás: Supabase > SQL Editor > New query > ennek a fájlnak a teljes tartalma > Run.
-- Újrafuttatható: ami már létezik, azt nem rontja el, adatot nem töröl.
--
-- A térkép "Riasztások" panelje a beállítást az alert_settings egyetlen sorába (id = 1) menti
-- (csak a tulaj írja, a takarító olvassa). Az adatgyűjtő (GitHub Actions, titkos kulcs) 10
-- percenként kiértékeli a szabályokat, az alert_state-ben tartja, mi aktív és mikor ment ki
-- utoljára értesítés, és az alert_log-ba írja az elküldött (vagy csendes órák miatt visszatartott)
-- riasztásokat. Azonnali értesítés csak pushon (ntfy) megy; e-mail naponta legfeljebb egy, a
-- napi összefoglaló (alapból 20:00). Csak jelez, semmit nem kapcsol.
--   alert_settings.config            a szabályok JSON-ban (lásd docs/riasztasok.md)
--   alert_settings.test_requested_at a Próba-értesítés gomb ideje: a következő körben kimegy
--   alert_state.since                mióta áll fenn a feltétel (null: most nem áll fenn)
--   alert_state.active               a feltétel elég régóta fennáll, riasztás él
--   alert_log.kind                   'fired' (riasztás), 'resolved' (megszűnt), 'test' (próba),
--                                    'digest' (a napi 20:00-s e-mail összefoglaló; rule_key: digest:ÉÉÉÉ-HH-NN)

create table if not exists public.alert_settings (
  id                smallint primary key default 1 check (id = 1),
  config            jsonb not null,
  test_requested_at timestamptz,
  updated_at        timestamptz not null default now(),
  updated_by        uuid default auth.uid()
);

create or replace function public.alert_settings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists alert_settings_touch on public.alert_settings;
create trigger alert_settings_touch before insert or update on public.alert_settings
  for each row execute function public.alert_settings_touch();

alter table public.alert_settings enable row level security;

drop policy if exists alert_settings_select on public.alert_settings;
create policy alert_settings_select on public.alert_settings
  for select to authenticated
  using ((select public.my_role()) in ('owner', 'cleaner'));

drop policy if exists alert_settings_insert on public.alert_settings;
create policy alert_settings_insert on public.alert_settings
  for insert to authenticated
  with check ((select public.my_role()) = 'owner');

drop policy if exists alert_settings_update on public.alert_settings;
create policy alert_settings_update on public.alert_settings
  for update to authenticated
  using ((select public.my_role()) = 'owner')
  with check ((select public.my_role()) = 'owner');

revoke all on public.alert_settings from anon;
grant select, insert, update on public.alert_settings to authenticated;

-- Szabályonkénti állapot. Írni csak a titkos kulcs tud (Actions), ahhoz nem kell szabály.
create table if not exists public.alert_state (
  rule_key  text primary key check (char_length(rule_key) <= 100),
  active    boolean not null default false,
  since     timestamptz,
  last_sent timestamptz,
  last_text text check (char_length(last_text) <= 500)
);

alter table public.alert_state enable row level security;

drop policy if exists alert_state_select on public.alert_state;
create policy alert_state_select on public.alert_state
  for select to authenticated
  using ((select public.my_role()) in ('owner', 'cleaner'));

revoke all on public.alert_state from anon;
grant select on public.alert_state to authenticated;

-- Napló: csak a tulaj olvassa, csak a titkos kulcs írja.
create table if not exists public.alert_log (
  id       bigserial primary key,
  ts       timestamptz not null default now(),
  rule_key text check (char_length(rule_key) <= 100),
  kind     text not null,
  text     text check (char_length(text) <= 1000),
  channels text check (char_length(channels) <= 200)
);
create index if not exists alert_log_ts_idx on public.alert_log (ts desc);
-- a fajta-ellenőrzés külön, így egy régebbi változat újrafuttatása is frissíti
alter table public.alert_log drop constraint if exists alert_log_kind_check;
alter table public.alert_log add constraint alert_log_kind_check
  check (kind in ('fired', 'resolved', 'test', 'digest'));

alter table public.alert_log enable row level security;

drop policy if exists alert_log_select on public.alert_log;
create policy alert_log_select on public.alert_log
  for select to authenticated
  using ((select public.my_role()) = 'owner');

revoke all on public.alert_log from anon;
grant select on public.alert_log to authenticated;
