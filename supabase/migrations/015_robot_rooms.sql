-- 015: szobánkénti robottakarítás (O2B: R2 Roborock). Újrafuttatható.
--
-- A Roborock a saját térképéről adja a szobákat (szegmens-azonosító + az appban adott név); az adatgyűjtő
-- ezt a robot állapotába teszi (device_status.status.rooms). A térképen a tulaj vagy a családtag kijelöl
-- egy vagy több szobát, megerősíti, és a parancs ('rooms', args = a szegmensek listája) ugyanabba a sorba
-- kerül, mint a többi robot-parancs (014_robot_cmd.sql): robotonként egy függő parancs, óránként 30.

alter table public.robot_cmd add column if not exists args jsonb;
alter table public.robot_cmd drop constraint if exists robot_cmd_cmd_check;
alter table public.robot_cmd add constraint robot_cmd_cmd_check check (cmd in ('start', 'pause', 'dock', 'find', 'rooms'));
alter table public.robot_cmd drop constraint if exists robot_cmd_args_check;
alter table public.robot_cmd add constraint robot_cmd_args_check check (
  (cmd = 'rooms' and jsonb_typeof(args) = 'array' and jsonb_array_length(args) between 1 and 16)
  or (cmd <> 'rooms' and args is null));

drop function if exists public.robot_cmd_enqueue(text, text);
create or replace function public.robot_cmd_enqueue(p_pink text, p_cmd text, p_args jsonb default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r text; new_id bigint; bad int;
begin
  select public.my_role() into r;
  if r is null or r not in ('owner', 'member') then
    raise exception 'csak a tulaj és a családtag vezérelheti a robotot' using errcode = '42501';
  end if;
  if p_pink not in ('R1', 'R2') or p_cmd not in ('start', 'pause', 'dock', 'find', 'rooms') then
    raise exception 'ismeretlen robot vagy parancs' using errcode = '22023';
  end if;
  if p_cmd = 'rooms' then
    if p_args is null or jsonb_typeof(p_args) <> 'array' or jsonb_array_length(p_args) not between 1 and 16 then
      raise exception 'jelölj ki 1-16 szobát' using errcode = '22023';
    end if;
    select count(*) into bad from jsonb_array_elements(p_args) e
     where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[0-9]{1,4}$';
    if bad > 0 then
      raise exception 'hibás szoba-azonosító' using errcode = '22023';
    end if;
  elsif p_args is not null then
    raise exception 'ehhez a parancshoz nem kell paraméter' using errcode = '22023';
  end if;
  update public.robot_cmd set status = 'expired', done_at = now(), note = 'nem vette fel a gyűjtő 3 percen belül'
   where pink = p_pink and status = 'queued' and created_at < now() - interval '3 minutes';
  update public.robot_cmd set status = 'error', done_at = now(), note = 'megszakadt végrehajtás'
   where pink = p_pink and status = 'running' and created_at < now() - interval '5 minutes';
  if (select count(*) from public.robot_cmd where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'túl sok robot-parancs az elmúlt órában' using errcode = '54000';
  end if;
  begin
    insert into public.robot_cmd (pink, cmd, args, created_by) values (p_pink, p_cmd, p_args, auth.uid()) returning id into new_id;
  exception when unique_violation then
    raise exception 'ennek a robotnak már van függő parancsa' using errcode = '55000';
  end;
  return new_id;
end $$;
revoke all on function public.robot_cmd_enqueue(text, text, jsonb) from public, anon;
grant execute on function public.robot_cmd_enqueue(text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
