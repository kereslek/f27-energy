# Supabase beállítás: lépésről lépésre

Kb. 15 perc. A végén lesz egy felhős adatbázisod, amibe a térkép menti az elrendezéseket,
később pedig az adatgyűjtő a Tuya-méréseket. **A titkos (secret) kulcsot soha ne másold a
chatbe**, csak a GitHub Secretsbe.

## 1. E-mail megerősítés

Nyisd meg a Supabase levelét a Gmailben, és kattints a megerősítő linkre. Enélkül a projekt nem indul.

## 2. Régió ellenőrzése

Bal alul **Project Settings > General**: a régió legyen **Central EU (Frankfurt)** (`eu-central-1`).
Ha más, töröld a projektet és hozd létre újra Frankfurttal (most még üres, semmi nem vész el).
Az adatbázis-jelszót, amit létrehozáskor adtál, tedd jelszókezelőbe; nekünk nem kell.

## 3. Adatbázis-séma

1. Bal oldalt **SQL Editor** > **New query** (+).
2. Másold be a repóból a [`supabase/schema.sql`](../supabase/schema.sql) **teljes** tartalmát.
3. **Run** (vagy Ctrl+Enter). Ha figyelmeztet, hogy „destructive operation”, az a
   `drop policy if exists` sorok miatt van: nyugodtan **Run this query**.
4. Bal oldalt **Table Editor**: meg kell jelennie az `app_users`, `layouts`, `devices`,
   `device_status`, `energy_daily` táblának.

A séma újrafuttatható: ha később frissül, ugyanígy bemásolod és futtatod, adat nem vész el.

## 4. A saját felhasználód

1. **Authentication > Users > Add user > Create new user**.
2. E-mail: a sajátod, jelszó: erős, egyedi (jelszókezelőbe). Pipáld be: **Auto Confirm User**.
3. Ownerré tétel: **SQL Editor > New query**, és futtasd (a saját e-mail címeddel):

   ```sql
   insert into public.app_users (user_id, role)
   select id, 'owner' from auth.users where email = 'IDE_A_SAJAT_EMAIL_CIMED';
   ```

   Eredmény: `INSERT 0 1`. Ha `INSERT 0 0`, elírtad az e-mailt.

## 5. Idegen regisztráció tiltása

**Authentication > Sign In / Providers** (régebbi felületen: Authentication > Settings):
kapcsold **ki** az **Allow new users to sign up** opciót. Új felhasználót (pl. a takarítót)
innentől csak te adhatsz hozzá a 4. lépés szerint, `cleaner` szerepkörrel.

## 6. Kulcsok a GitHubba

Supabase: **Project Settings > API Keys** (és a projekt URL: **Project Settings > Data API**,
vagy fent a **Connect** gomb). Itt három adat kell:

| Supabase | Formátum | Hova | Név |
|---|---|---|---|
| Project URL | `https://xxxx.supabase.co` | GitHub **Variables** | `SUPABASE_URL` |
| Publishable key (régi neve: anon) | `sb_publishable_...` | GitHub **Variables** | `SUPABASE_PUBLISHABLE_KEY` |
| Secret key (régi neve: service_role) | `sb_secret_...` | GitHub **Secrets** | `SUPABASE_SECRET_KEY` |

GitHub: repó > **Settings > Secrets and variables > Actions**. A felső fülekkel válts a
**Secrets** és a **Variables** között.

- A **publishable** kulcs nyilvános használatra készült (a böngészőbe kerül), a sorszintű
  jogosultság védi az adatot. Ezért mehet Variable-be.
- A **secret** kulcs mindent megkerül: csak GitHub Secretsbe, sehova máshova.

## 7. Ellenőrzés

GitHub: **Actions > Supabase ellenőrzés > Run workflow**. Kb. fél perc. Az eredmény egy táblázat
(OK / HIBA soronként, mellette, mit kell javítani):

- a projekt elérhető és a publishable kulcs érvényes;
- az idegen regisztráció ki van kapcsolva;
- mind a 6 tábla létezik, és névtelenül egyik sem olvasható.

Ha minden sor OK, kész vagy.

## 8. Kész

Írd meg a chatben: „Supabase kész” (és hogy az ellenőrzés zöld lett-e). A kulcsokat nem kell elküldened. Ezután:

- bekötöm a térképbe a bejelentkezést és az elrendezés mentését/betöltését;
- az adatgyűjtő a Tuya-adatokat ide írja (változáskor vagy óránként), és a mérések
  többé nem kerülnek a publikus repóba.

## Mit tud a séma (röviden)

| Szerepkör | Elrendezés | Aktuális állapot | Eszközlista (Tuya ID) | Energia |
|---|---|---|---|---|
| owner | olvas, ír, töröl | olvas | olvas | olvas |
| cleaner | olvas | olvas | nem | nem |
| viewer | olvas | olvas | nem | nem |
| listán kívüli / névtelen | nem | nem | nem | nem |

A mérési adatokat csak a GitHub Actions adatgyűjtő írja a secret kulccsal.

Ingyenes keret: 500 MB adatbázis, kb. évi 100-150 MB méréssel számolunk. Az ingyenes projekt
egy hét tétlenség után elalszik; a rendszeresen író adatgyűjtő ébren tartja (amíg az nem fut,
a Supabase felületén egy kattintással felébreszthető).
