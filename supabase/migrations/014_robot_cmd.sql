-- 014: robotporszívó-parancsok sora (O2B: R1 Dreame lent, R2 Roborock fent). Újrafuttatható.
--
-- A böngésző nem éri el a gyártói felhőt (a tokenek a robot_auth-ban, csak a titkos kulccsal), ezért
-- a parancs ide kerül, és az adatgyűjtő (GitHub Actions, f27/robots.py watch) 10 másodpercenként
-- felveszi és végrehajtja. Beküldeni csak a tulaj és a családtag tud, és csak a robot_cmd_enqueue()
-- függvényen át: robotonként egyszerre egy függő parancs, óránként legfeljebb 30, a 3 percnél régebbi
-- függő parancs lejár. Olvasni (állapot) a tulaj és a családtag tud.

create table if not exists public.robot_cmd (
  id          bigserial primary key,
  pink        text not null check (pink in ('R1', 'R2')),
  cmd         text not null check (cmd in ('start', 'pause', 'dock', 'find')),
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'error', 'expired')),
  note        text check (char_length(note) <= 200),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists robot_cmd_created on public.robot_cmd (created_at desc);
create unique index if not exists robot_cmd_one_pending on public.robot_cmd (pink) where status in ('queued', 'running');

alter table public.robot_cmd enable row level security;
revoke all on public.robot_cmd from public, anon, authenticated;
grant select on public.robot_cmd to authenticated;
drop policy if exists robot_cmd_read on public.robot_cmd;
create policy robot_cmd_read on public.robot_cmd for select to authenticated
  using ((select public.my_role()) in ('owner', 'member'));

create or replace function public.robot_cmd_enqueue(p_pink text, p_cmd text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r text; new_id bigint;
begin
  select public.my_role() into r;
  if r is null or r not in ('owner', 'member') then
    raise exception 'csak a tulaj és a családtag vezérelheti a robotot' using errcode = '42501';
  end if;
  if p_pink not in ('R1', 'R2') or p_cmd not in ('start', 'pause', 'dock', 'find') then
    raise exception 'ismeretlen robot vagy parancs' using errcode = '22023';
  end if;
  -- a régóta függő parancs lejár (pl. ha az adatgyűjtő épp nem fut)
  update public.robot_cmd set status = 'expired', done_at = now(), note = 'nem vette fel a gyűjtő 3 percen belül'
   where pink = p_pink and status = 'queued' and created_at < now() - interval '3 minutes';
  update public.robot_cmd set status = 'error', done_at = now(), note = 'megszakadt végrehajtás'
   where pink = p_pink and status = 'running' and created_at < now() - interval '5 minutes';
  if (select count(*) from public.robot_cmd where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'túl sok robot-parancs az elmúlt órában' using errcode = '54000';
  end if;
  begin
    insert into public.robot_cmd (pink, cmd, created_by) values (p_pink, p_cmd, auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'ennek a robotnak már van függő parancsa' using errcode = '55000';
  end;
  return new_id;
end $$;
revoke all on function public.robot_cmd_enqueue(text, text) from public, anon;
grant execute on function public.robot_cmd_enqueue(text, text) to authenticated;

notify pgrst, 'reload schema';
