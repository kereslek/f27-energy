-- 004: foglaltság (Airbnb naptárexport, iCal), a térkép vendég-csipje és sávja ehhez
-- Futtatás: Supabase > SQL Editor > New query > ennek a fájlnak a teljes tartalma > Run.
-- Újrafuttatható: ami már létezik, azt nem rontja el, adatot nem töröl.
--
-- Az adatgyűjtő (GitHub Actions) óránként egyszer letölti az AIRBNB_ICAL_URL (és ha van,
-- a BOOKING_ICAL_URL) naptárt, és ide csak a minimumot írja: forrás, fajta, érkezés és
-- távozás napja. Vendégnév, telefonszám, foglalási link vagy a nyers iCal UID soha nem
-- kerül ide; az id a forrás + UID sha256 hash-e (csak azonosításra, visszafejthetetlen).
--   kind = 'reservation': Airbnb foglalás ("Reserved")
--   kind = 'blocked':     lezárt nap ("Airbnb (Not available)"): importált naptár
--                         (valószínűleg Booking-vendég) vagy elérhetőségi szabály

create table if not exists public.bookings (
  id          text primary key,                 -- sha256(forrás + iCal UID), hex
  source      text not null check (source in ('airbnb', 'booking')),
  kind        text not null check (kind in ('reservation', 'blocked')),
  start_date  date not null,                    -- érkezés napja
  end_date    date not null,                    -- távozás napja (az iCal DTEND, kizáró)
  seen_at     timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists bookings_end_idx on public.bookings (end_date);
create index if not exists bookings_seen_idx on public.bookings (seen_at desc);

alter table public.bookings enable row level security;

-- Az owner és a takarító látja (érkezés előtti beállításokhoz), a viewer és idegen nem.
-- Írni csak a titkos kulcs tud (Actions), ahhoz nem kell szabály.
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using ((select public.my_role()) in ('owner', 'cleaner'));

revoke all on public.bookings from anon;
grant select on public.bookings to authenticated;
