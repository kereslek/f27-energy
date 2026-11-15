-- 009: telephely-adatok, amelyek nem kerülhetnek a publikus repóba (pl. az utca neve a térképen).
-- Újrafuttatható. Olvasni csak belépve lehet (tulaj, takarító, megtekintő), írni csak a tulaj.
-- A térkép (web/o2b/) belépve innen veszi az utcanevet; kijelentkezve és demóban csak "utca" áll ott.

create table if not exists public.site_info (
  key         text primary key check (char_length(key) between 1 and 40),
  value       text check (char_length(value) <= 200),
  updated_at  timestamptz not null default now()
);

alter table public.site_info enable row level security;

drop policy if exists site_info_select on public.site_info;
create policy site_info_select on public.site_info
  for select to authenticated
  using ((select public.my_role()) in ('owner', 'member', 'cleaner', 'viewer'));

drop policy if exists site_info_write on public.site_info;
create policy site_info_write on public.site_info
  for all to authenticated
  using ((select public.my_role()) = 'owner')
  with check ((select public.my_role()) = 'owner');

revoke all on public.site_info from anon;
grant select, insert, update, delete on public.site_info to authenticated;

notify pgrst, 'reload schema';
