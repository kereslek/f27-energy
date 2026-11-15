-- 013: a Bojler-naplót (web/js/boiler.js) a családtag is látja: az órás összesítő olvasása (mindkét projekt).
-- Újrafuttatható. Írni továbbra is csak a titkos kulcs (adatgyűjtő) tud.
do $$ begin
  if to_regclass('public.metrics_hourly') is not null then
    drop policy if exists metrics_hourly_select on public.metrics_hourly;
    create policy metrics_hourly_select on public.metrics_hourly for select to authenticated
      using ((select public.my_role()) in ('owner', 'member'));
  end if;
end $$;
notify pgrst, 'reload schema';
