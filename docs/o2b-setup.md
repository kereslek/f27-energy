# O2B: az első élő dashboard beállítása

Kb. 15 perc. A végén az O2B-nek saját, az F27-től független adatbázisa lesz, és az adatgyűjtő
10 percenként írja bele a Smart Life második (O2B) otthonának eszközeinek állapotát.
**Kulcsot, jelszót soha ne másolj a chatbe**, csak a GitHubba.

## 1. Új Supabase-projekt

1. supabase.com > **New project**.
2. Név: `O2B-energy`, régió: **Central EU (Frankfurt)**, csomag: Free.
   (Ingyenesen két aktív projekt lehet egy fiókban: az F27 és az O2B.)
3. Az adatbázis-jelszót tedd jelszókezelőbe, nekünk nem kell.

## 2. A teljes séma egyben

1. **SQL Editor > New query**.
2. Másold be a repóból a [`supabase/setup_all.sql`](../supabase/setup_all.sql) **teljes** tartalmát
   (ez a `schema.sql` és mind a 7 migráció egyben).
3. **Run**. Ha "destructive operation" figyelmeztetést ad, az a `drop policy if exists` sorok
   miatt van: **Run this query**.

## 3. A saját felhasználód (owner)

Ugyanúgy, mint az F27-nél ([supabase-setup.md](supabase-setup.md), 4. lépés):
**Authentication > Users > Add user > Create new user** (Auto Confirm User), utána az SQL
Editorban az `insert into public.app_users ... 'owner'` parancs a saját e-mail címeddel.
Utána **Authentication > Sign In / Providers**: kapcsold ki az **Allow new users to sign up**-ot.

## 4. Kulcsok a GitHubba

Supabase: **Project Settings > API Keys** és a projekt URL (**Connect** gomb).
GitHub: a repó **Settings > Secrets and variables > Actions**.

| Hová | Név | Érték |
|---|---|---|
| Variables | `O2B_SUPABASE_URL` | a projekt URL-je (`https://....supabase.co`) |
| Variables | `O2B_SUPABASE_PUBLISHABLE_KEY` | a **publishable** kulcs (`sb_publishable_...`) |
| Secrets | `O2B_SUPABASE_SECRET_KEY` | a **secret** kulcs (`sb_secret_...`) |

Más nem kell: a Tuya-kulcsok, a push és az e-mail ugyanazok, mint az F27-nél.

## 5. Szólj

Utána a Claude-munkamenet elindítja az O2B felderítést és az adatgyűjtőt, és élesíti a
térképet a `https://kereslek.github.io/f27-energy/o2b/` címen.
