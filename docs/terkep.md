# Az élő térkép (F27 Energy Quest)

A lakás izometrikus, játékos térképe: `https://kereslek.github.io/f27-energy/`
Telefonon is működik (a teljes képernyő arányosan kicsinyítve).

## Egyszeri beállítás: GitHub Pages bekapcsolása

GitHub: repó > **Settings > Pages > Build and deployment > Source: GitHub Actions**.
Utána minden push után magától frissül a térkép (Actions: „Térkép (Pages)”). A Supabase
címét és a publishable kulcsot a GitHub Variables-ból (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`)
teszi bele az oldalba; a secret kulcs soha nem kerül az oldalba (a build ezt ellenőrzi is).

## Belépés

Jobb felső sarok: **Belépés**. E-mail és jelszó: a Supabase-ben létrehozott felhasználó
(Authentication > Users). Regisztrálni az oldalon nem lehet.

Belépés nélkül a térkép **demó módban** fut: minden kipróbálható, csak menteni nem lehet.
A **DEMO ADATOK** jelzés akkor látszik, ha valamelyik eszköz értéke nem élő mérés.

## Elrendezések

A bútorok és az eszköztűk húzhatók. A mentett elrendezés minden gépről és telefonról
ugyanaz (Supabase).

- **Mentés**: felülírja a jelenleg betöltött elrendezést. Ha még nincs ilyen, nevet kér.
- **Mentés másként**: új néven ment (a név egyedi, kis- és nagybetűtől függetlenül).
- **Betöltés**: a listából bármelyik elrendezés.
- **Alapértelmezett**: belépéskor ez töltődik be magától (egyszerre csak egy lehet).
- **Törlés**: megerősítés után.

Az alsó sáv állapotjelzője: **Nem mentett változás** (piros pont) vagy **Mentve ÓÓ:PP**
(zöld pont). Rákattintva megnyílik a mentési panel.

## Visszavonás

- Visszavonás: a nyíl gomb az alsó sávban, vagy **Ctrl+Z** (Macen Cmd+Z).
- Újra: a másik nyíl gomb, vagy **Ctrl+Shift+Z** / **Ctrl+Y**.
- **Elrendezés visszaállítása**: minden alaphelyzetbe; ez is visszavonható.

## Élő napszak

Alapból az ég, a nap és a hold, az ablakok fénye és a lámpák a **valódi budapesti időt** követik
(a nap állása Budapest felett, nyári időszámítással is helyesen; percenként frissül).
A cím ilyenkor például: „ÉLŐ: nappal, 10:42”; fölé állva mutatja a napkeltét és a napnyugtát.
Napszakok: hajnal, nappal (6 fok napmagasság felett), alkonyat, éjszaka (-18 fok alatt).

A Pályaválasztó gombjai (1-1 ... 1-4) előbeállított forgatókönyvek; ha valamelyiket választod,
az élő mód kikapcsol. A panel fejlécében az **ÉLŐ** gomb visszakapcsolja.

## Nagyítás és mozgatás

A jobb alsó sarokban a nagyítósáv: **−**, a nagyítás mértéke, **+**, és a **teljes nézet** gomb. 100% és 400% között.

- **Egér:** Ctrl (Macen Cmd) + görgő a kurzor körül nagyít. Nagyítva a sima görgő fel-le, Shift + görgő oldalra mozgat.
- **Touchpad:** két ujjas csippentés nagyít, két ujjas húzás mozgat.
- **Telefon, tablet:** két ujjas csippentés nagyít, egy ujjal az üres részen húzva mozgat.
- **Billentyűk:** `+` és `-` (Ctrl-lal is), `0` a teljes nézet, nagyítva a nyilak mozgatnak.
- **Húzás nagyítva:** a bútor vagy az eszköz megfogva továbbra is a tárgyat mozgatja; az üres részen (ég, padló, panelek háttere) húzva a nézet mozdul. Középső egérgombbal mindenhol a nézet mozdul.

A böngésző saját nagyítása (Ctrl + görgő) ezen az oldalon a térképet nagyítja, nem az egész oldalt.

## Szerepkörök

| Szerepkör | Lát | Betölt | Ment, töröl, alapértelmezett |
|---|---|---|---|
| tulaj (owner) | igen | igen | igen |
| takarító (cleaner) | igen | igen | nem |
| megtekintő (viewer) | igen | igen | nem |
| listán kívüli fiók | csak demó | nem | nem |

Új felhasználót a `docs/supabase-setup.md` 4. lépése szerint lehet felvenni, a megfelelő
szerepkörrel.

## Élő értékek

Belépve a térkép percenként frissíti az eszközök állapotát a Supabase `device_latest`
nézetéből (hőmérséklet, ajtó/ablak nyitva vagy zárva, kismegszakító teljesítmény, kályha
fokozat, gateway online). Ahol nincs mérés, ott a kiválasztott pálya demó értéke látszik.
Az adatokat a Tuya adatgyűjtő tölti majd fel (amíg az nem fut, minden érték demó).

## Egyszerű alaprajz

A fiók panel alján: **Egyszerű alaprajz megnyitása**. Ez a régi, sematikus térkép, ami a
repó titkosított adatát jelszóval fejti vissza a böngészőben.
