-- 005: az Energiaőr tippjeinek elrejtése és elhalasztása (Rendben / Később / ennél a vendégnél / soha)
-- Futtatás: Supabase > SQL Editor > New query > ennek a fájlnak a teljes tartalma > Run.
-- Újrafuttatható: ami már létezik, azt nem rontja el, adatot nem töröl.
--
-- Felhasználónként tárolódik: amit a tulaj elrejt, az a tulajnál rejtett minden eszközén,
-- a takarítónál nem (és fordítva). Mindenki csak a saját sorait látja és írja.
--   mode: 'ok'      = Rendben: rejtve, amíg a helyzet fennáll (ha megszűnik, a sor törlődik)
--         'until'   = Később (1 óra, holnap reggel): rejtve until_ts-ig
--         'booking' = ennél a vendégnél ne: rejtve until_ts-ig (a foglalás vége)
--         'never'   = ilyen tippet soha: rejtve, amíg vissza nem kapcsolja

create table if not exists public.tip_dismissals (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tip_key    text not null check (char_length(tip_key) <= 200),
  mode       text not null check (mode in ('ok', 'until', 'booking', 'never')),
  until_ts   timestamptz,
  label      text check (char_length(label) <= 200),
  created_at timestamptz not null default now(),
  primary key (user_id, tip_key)
);

alter table public.tip_dismissals enable row level security;

drop policy if exists tip_dismissals_select on public.tip_dismissals;
create policy tip_dismissals_select on public.tip_dismissals
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.my_role()) is not null);

drop policy if exists tip_dismissals_insert on public.tip_dismissals;
create policy tip_dismissals_insert on public.tip_dismissals
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.my_role()) is not null);

drop policy if exists tip_dismissals_update on public.tip_dismissals;
create policy tip_dismissals_update on public.tip_dismissals
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.my_role()) is not null)
  with check (user_id = (select auth.uid()) and (select public.my_role()) is not null);

drop policy if exists tip_dismissals_delete on public.tip_dismissals;
create policy tip_dismissals_delete on public.tip_dismissals
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.my_role()) is not null);

revoke all on public.tip_dismissals from anon;
grant select, insert, update, delete on public.tip_dismissals to authenticated;
