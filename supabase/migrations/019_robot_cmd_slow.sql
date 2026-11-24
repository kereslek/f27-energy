-- 019: a robot-parancsok lejárata a 30 perces adatgyűjtőhöz igazítva (2026.11.24). Újrafuttatható.
-- Az adatgyűjtő már nem fut folyamatosan (GitHub Actions: legfeljebb 30 percenként, rövid futás, CLAUDE.md 20. fejezet),
-- ezért a dashboard parancsa és az időzítő legfeljebb kb. 30 percet várhat a végrehajtásra: a függő parancs és
-- az időzítő 45 perc után jár le (eddig 3, illetve 15 perc), a félbemaradt végrehajtás 60 perc után hiba.
create or replace function public.robot_cmd_enqueue(p_pink text, p_cmd text, p_args jsonb default null,
                                                    p_due timestamptz default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r text; new_id bigint; bad int; k text := case when p_due is null then 'now' else 'timer' end;
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
  if k = 'timer' then
    if p_cmd not in ('start', 'rooms') then
      raise exception 'időzíteni csak indítást lehet' using errcode = '22023';
    end if;
    if p_due < now() + interval '50 seconds' or p_due > now() + interval '7 days' then
      raise exception 'az időpont 1 perc és 7 nap között legyen' using errcode = '22023';
    end if;
  end if;
  -- a régóta függő parancs lejár
  update public.robot_cmd set status = 'expired', done_at = now(), note = 'nem vette fel a gyűjtő 45 percen belül'
   where pink = p_pink and status = 'queued' and kind = 'now' and created_at < now() - interval '45 minutes';
  update public.robot_cmd set status = 'expired', done_at = now(), note = 'az időzítő lejárt, a gyűjtő nem futott'
   where pink = p_pink and status = 'queued' and kind = 'timer' and due_at < now() - interval '45 minutes';
  update public.robot_cmd set status = 'error', done_at = now(), note = 'megszakadt végrehajtás'
   where pink = p_pink and status = 'running' and greatest(created_at, due_at) < now() - interval '60 minutes';
  if (select count(*) from public.robot_cmd where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'túl sok robot-parancs az elmúlt órában' using errcode = '54000';
  end if;
  if k = 'timer' and (select count(*) from public.robot_cmd where pink = p_pink and kind = 'timer' and status = 'queued') >= 3 then
    raise exception 'ennél a robotnál már 3 időzítő vár' using errcode = '54000';
  end if;
  begin
    insert into public.robot_cmd (pink, cmd, args, created_by, kind, due_at)
    values (p_pink, p_cmd, p_args, auth.uid(), k, coalesce(p_due, now())) returning id into new_id;
  exception when unique_violation then
    raise exception 'ennek a robotnak már van függő parancsa' using errcode = '55000';
  end;
  return new_id;
end $$;
revoke all on function public.robot_cmd_enqueue(text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.robot_cmd_enqueue(text, text, jsonb, timestamptz) to authenticated;

