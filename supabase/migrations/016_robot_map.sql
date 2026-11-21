-- 016: a robotporszívók saját térképe (O2B: R1 Dreame lent, R2 Roborock fent). Újrafuttatható.
--
-- Az adatgyűjtő óránként egyszer lekéri a gyártói felhőből a robot térképét, és ide írja:
-- png (base64, a padló, a szobák, a robot útja, a dokk), a kép mérete, a szobák neve és közepe,
-- a robot és a dokk helye képpontban. A térkép a lakás alaprajza, ezért csak a tulaj és a
-- családtag olvassa; a bemutató link, a takarító és a megtekintő nem.
create table if not exists public.robot_map (
  pink       text primary key check (pink in ('R1', 'R2')),
  png        text not null check (char_length(png) <= 1500000),
  w          integer not null,
  h          integer not null,
  rooms      jsonb not null default '[]'::jsonb,
  robot      jsonb,
  charger    jsonb,
  src        text check (char_length(src) <= 40),
  updated_at timestamptz not null default now()
);
alter table public.robot_map enable row level security;
revoke all on public.robot_map from public, anon, authenticated;
grant select on public.robot_map to authenticated;
drop policy if exists robot_map_read on public.robot_map;
create policy robot_map_read on public.robot_map for select to authenticated
  using ((select public.my_role()) in ('owner', 'member'));

notify pgrst, 'reload schema';
