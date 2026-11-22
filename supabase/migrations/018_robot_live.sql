-- 018: a robotporszívó élő helye és a takarítás útvonala a robot_map táblában. Újrafuttatható.
--
-- Takarítás közben az adatgyűjtő (f27/robot_map.py, `watch`) percenként frissíti a robot helyzetét:
-- robot (képpont, mint a 016-ban), path (a takarítás eddigi útvonala, legfeljebb 400 pont [x, y] képpontban),
-- pos_at (mikor mérte a gyűjtő), bbox ([x0, y0, x1, y1]: a térkép nem üres részének befoglalója képpontban,
-- a dashboard ebből igazítja a robot térképét az alaprajzhoz). A jogosultság marad, mint a 016-ban
-- (tulaj és családtag olvassa), ide nem kell új szabály.
alter table public.robot_map add column if not exists path   jsonb;
alter table public.robot_map add column if not exists pos_at timestamptz;
alter table public.robot_map add column if not exists bbox   jsonb;

notify pgrst, 'reload schema';
