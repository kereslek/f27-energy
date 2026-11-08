-- 002: eszköz-meta és napi energia számlálóállás
-- Futtatás: Supabase > SQL Editor > New query > ennek a fájlnak a teljes tartalma > Run.
-- Újrafuttatható: ha az oszlopok már léteznek, nem csinál semmit.

-- A Tuya státuszkódok skálája és mértékegysége (pl. cur_power: scale 1 = 0,1 W).
-- Az Eszközfelderítés tölti ki a Tuya specifikációból; a térkép ezzel skáláz.
alter table public.devices add column if not exists meta jsonb;

-- A kismegszakító fogyasztásszámlálójának utolsó látott állása (kWh).
-- Az adatgyűjtő ebből számolja a napi kWh-t.
alter table public.energy_daily add column if not exists last_counter numeric(14, 4);
