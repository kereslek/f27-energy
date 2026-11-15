-- 012: robotporszívók (O2B: R1 Dreame lent, R2 Roborock fent). Újrafuttatható.
-- A gyártói felhők belépési tokenjei (f27/robots.py, "Robotok bejelentkezése" workflow).
-- Csak a titkos kulcs (GitHub Actions) éri el: a böngésző, a családtag, a bemutató link soha.
-- Jelszót nem tárolunk, csak a gyártó által kiadott tokent.
create table if not exists public.robot_auth (
  id         text primary key check (id in ('roborock', 'xiaomi')),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.robot_auth enable row level security;
revoke all on public.robot_auth from public, anon, authenticated;

notify pgrst, 'reload schema';
