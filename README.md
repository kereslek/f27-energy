# F27 Energy

Villany- és gázköltség csökkentése egy budapesti Airbnb lakásban, a vendégkomfort megtartásával.
Tuya / Smart Life eszközök adataiból: adatgyűjtés, interaktív lakástérkép, dashboard,
később automatikus optimalizálás. Projekt kontextus: [CLAUDE.md](CLAUDE.md).

## Adatvédelem

A repó publikus, ezért:

- minden Tuya-adat (device ID, állapot, ajtó/ablak nyitás, fogyasztás) **csak titkosítva**
  kerül a `data/` mappába (`*.enc`, AES-256-GCM, PBKDF2 jelszóból);
- a kulcsok kizárólag GitHub Secrets-ben vannak;
- az Actions log és összefoglaló nem tartalmaz mérési értéket;
- az élő térkép (`web/index.html`) a Supabase-ből olvas, bejelentkezéssel és sorszintű
  jogosultsággal; az egyszerű alaprajz (`web/alaprajz.html`) a böngészőben jelszóval fejti
  vissza a repó titkosított adatát.

## Felépítés

| Hely | Mi ez |
|---|---|
| `f27/tuya.py` | Tuya IoT Cloud API kliens (csak standard könyvtár) |
| `f27/crypto.py` | Titkosítás (Python oldal, a böngésző ugyanezt fejti vissza) |
| `f27/discover.py` | Eszközfelderítés: párosítás a pink számokhoz (otthonszűrő, kategória, pontos név), eszközlista Supabase-be |
| `f27/collect.py` | Adatgyűjtő: Tuya állapotok és napi energia a Supabase-be (10 percenként) |
| `f27/bookings.py` | Foglaltság az Airbnb naptárexportból (óránként; csak dátumok, név és kód nélkül) |
| `f27/supa.py` | Minimális Supabase (PostgREST) kliens a titkos kulccsal, adatmentes hibaüzenetekkel |
| `config/devices.json` | Pink szám > eszköz név-minta, hely a térképen (ID nélkül) |
| `web/index.html` | Élő játékos térkép (F27 Energy Quest, G3): húzható bútorok és eszközök, Supabase bejelentkezés, mentett elrendezések, visszavonás, élő eszközállapot |
| `web/js/` | `minidc.js` saját sablon-értelmező, `g3-scene.js` a G3 jelenet, `app.js` Supabase, elrendezések, visszavonás |
| `web/vendor/` | `@supabase/supabase-js` 2.118.0 (MIT) |
| `web/alaprajz.html` | Egyszerű sematikus alaprajz, titkosított repó-adattal, demóval |
| `supabase/schema.sql` | Supabase séma: szerepkörök, elrendezések, eszközállapot, energia, RLS |
| `supabase/migrations/` | Meglévő telepítés frissítései (pl. `002_device_meta.sql`) |
| `tests/` | Offline tesztek álszerverekkel: `python -m unittest discover -s tests` |
| `f27/supabase_check.py` | Supabase beállítás ellenőrzése (Actions: Supabase ellenőrzés) |
| `.github/workflows/discover.yml` | Felderítés (kézzel és havonta): titkosított commit + Supabase eszközlista |
| `.github/workflows/collect.yml` | Adatgyűjtés 10 percenként (Tuya > Supabase) |
| `.github/workflows/pages.yml` | Térkép publikálása Pages-re (a `config.js`-t a GitHub Variables-ból generálja) |
| `.github/workflows/supabase-check.yml` | Kézi Supabase ellenőrzés (OK / HIBA táblázat) |
| `tools/decrypt.py` | Titkosított fájl kibontása helyben |
| `docs/tuya-setup.md` | Tuya fiók + Secrets beállítás lépésről lépésre |
| `docs/supabase-setup.md` | Supabase beállítás lépésről lépésre |
| `docs/terkep.md` | Az élő térkép használata (belépés, elrendezések, visszavonás, szerepkörök) |
| `docs/adatgyujto.md` | Adatgyűjtő: ütemezés, Tuya-kvóta, ellenőrzés, szüneteltetés |

## Kezdés

Lásd: [docs/tuya-setup.md](docs/tuya-setup.md).

Helyben, jelszóval:

```bash
pip install -r requirements.txt
F27_DATA_PASSWORD=... python tools/decrypt.py data/latest.json.enc
```
