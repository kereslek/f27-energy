-- 010: lámpák és konnektorok távkapcsolása és időzítése (O2B; a F27-ben nincs használatban). Újrafuttatható.
--
-- A kapcsolást a "control" Supabase-függvény végzi (supabase/functions/control), a Tuya-kulcs csak ott él.
-- Itt csak az adatok vannak: heti szabályok, egyszeri időzítők, napló, és a kapcsolási zár.
-- Kapcsolási szabály (CLAUDE.md 9. fejezet): egyszerre egy parancs, két kapcsolás között legalább 3 mp:
-- ezt a control_slot() függvény érvényesíti adatbázis-szinten (sorzár), akárhány kérés jön egyszerre.
-- Olvasni és szabályt írni minden tag tud (owner, cleaner, viewer: akinek a tulaj hozzáférést ad).

create table if not exists public.control_rules (
  id          uuid primary key default gen_random_uuid(),
  pink        text not null check (char_length(pink) <= 20),
  action      text not null check (action in ('on', 'off')),
  kind        text not null check (kind in ('time', 'sunset', 'sunrise')),
  minute      integer not null default 0 check (minute between -720 and 1439),  -- time: a nap perce; sunset/sunrise: eltolás percben
  days        integer not null default 127 check (days between 1 and 127),     -- bitmaszk: H=1, K=2, Sze=4, Cs=8, P=16, Szo=32, V=64
  enabled     boolean not null default true,
  last_fired  date,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.control_timers (
  id          uuid primary key default gen_random_uuid(),
  pink        text not null check (char_length(pink) <= 20),
  action      text not null check (action in ('on', 'off')),
  due_at      timestamptz not null,
  label       text check (char_length(label) <= 80),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists control_timers_due on public.control_timers (due_at);

create table if not exists public.control_log (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  pink        text not null,
  action      text not null,
  source      text not null check (source in ('user', 'rule', 'timer', 'scene')),
  user_id     uuid,
  ok          boolean not null,
  note        text check (char_length(note) <= 200)
);
create index if not exists control_log_ts on public.control_log (ts desc);

-- a kapcsolási zár: egyetlen sor, a legutóbbi kapcsolás ideje
create table if not exists public.control_lock (
  id       integer primary key check (id = 1),
  last_at  timestamptz not null default 'epoch'
);
insert into public.control_lock (id) values (1) on conflict (id) do nothing;

-- Vár, amíg az előző kapcsolás óta eltelik 3 mp, és lefoglalja a következő helyet. A sorzár miatt
-- az egyidejű hívások sorba állnak. Csak a függvény (titkos kulcs) hívhatja.
create or replace function public.control_slot() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz; w double precision;
begin
  select last_at into t from public.control_lock where id = 1 for update;
  w := extract(epoch from (t + interval '3 seconds' - clock_timestamp()));
  if w > 0 then perform pg_sleep(least(w, 3.5)); end if;
  update public.control_lock set last_at = clock_timestamp() where id = 1;
  return clock_timestamp();
end $$;
revoke all on function public.control_slot() from public, anon, authenticated;

alter table public.control_rules  enable row level security;
alter table public.control_timers enable row level security;
alter table public.control_log    enable row level security;
alter table public.control_lock   enable row level security;

drop policy if exists control_rules_rw on public.control_rules;
create policy control_rules_rw on public.control_rules for all to authenticated
  using ((select public.my_role()) in ('owner', 'cleaner', 'viewer'))
  with check ((select public.my_role()) in ('owner', 'cleaner', 'viewer'));
drop policy if exists control_timers_rw on public.control_timers;
create policy control_timers_rw on public.control_timers for all to authenticated
  using ((select public.my_role()) in ('owner', 'cleaner', 'viewer'))
  with check ((select public.my_role()) in ('owner', 'cleaner', 'viewer'));
drop policy if exists control_log_select on public.control_log;
create policy control_log_select on public.control_log for select to authenticated
  using ((select public.my_role()) in ('owner', 'cleaner', 'viewer'));

revoke all on public.control_rules, public.control_timers, public.control_log, public.control_lock from anon;
grant select, insert, update, delete on public.control_rules, public.control_timers to authenticated;
grant select on public.control_log to authenticated;

notify pgrst, 'reload schema';
