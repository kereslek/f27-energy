# Robotporszívók (O2B)

| Jel | Robot | Hol | Felhő |
|---|---|---|---|
| R1 | DreameBot Z10 Pro | lent, a nappali sarkában | Xiaomi Home (Mi felhő) |
| R2 | Roborock S7 | fent, az emeleti előtérben | Roborock |

A térképen a dokkjukban állnak, a tűjük és a kártyájuk mutatja az állapotot (takarít, hazamegy,
töltődik, dokkban, hiba), az akkumulátort, takarítás közben a felületet és az időt. Az adatgyűjtő
10 percenként kérdezi le őket.

Egyik gyártónak sincs hivatalos nyilvános API-ja: ugyanazt a felhőt hívjuk, amit az appjaik
(`f27/robots.py`, Roborock: python-roborock, Xiaomi: `f27/xiaomi_cloud.py`). Ha a gyártó változtat,
ezt kell igazítani.

## Bekötés (egyszer)

1. GitHub > Settings > Secrets and variables > Actions > **New repository secret**:
   - `ROBOROCK_EMAIL`: a Roborock app fiókjának e-mail címe
   - `ROBOROCK_PASSWORD`: csak ha a Roborock fióknak van jelszava (ha kóddal lépsz be, hagyd ki)
   - `XIAOMI_USERNAME`: a Xiaomi fiók azonosítója (a Xiaomi Home Profil lapján látszó szám) vagy e-mail / telefonszám
   - `XIAOMI_PASSWORD`: a Xiaomi fiók jelszava
2. Actions > **Robotok bejelentkezése (O2B)** > Run workflow:
   - Roborock jelszó nélkül: először `roborock-kod` (e-mailt kapsz egy kóddal), utána `roborock`
     a kóddal a „kod” mezőben (a kód néhány percig érvényes).
   - Roborock jelszóval: rögtön `roborock`.
   - Xiaomi: `xiaomi`. Ha a Xiaomi kétlépcsős jóváhagyást kér, a lépés kódot küld (e-mailben, ha a
     fiókhoz van e-mail, különben SMS-ben), a log ezt írja: „jóváhagyás kell, a kódot elküldtük”.
     Utána `xiaomi-kod` a kóddal a „kod” mezőben. A jóváhagyott munkamenetet eltesszük (stabil
     eszközazonosítóval), így a következő `xiaomi` lépéshez már nem kell kód.
3. A log csak annyit ír: „OK, 1 robot”. Utána a következő adatgyűjtő körben megjelennek az élő adatok.

A belépési tokenek a Supabase `robot_auth` táblájában vannak (`supabase/migrations/012_robots.sql`),
ahhoz csak a titkos kulcs fér hozzá: a böngésző, a családtag és a bemutató link nem. Jelszót nem
tárolunk (a Xiaomi jóváhagyott munkamenete, a passToken, ugyanitt van). Ha egy belépés lejár, a kártya „nincs adat”-ot mutat: futtasd újra a 2. lépést.

## Vezérlés (következő lépés)

Indítás, szünet, haza a dokkba gombok a kártyán, időzítéssel. A parancs a GitHub Actionsön fut
(kb. 20-40 mp késéssel), ehhez egy finomhangolt GitHub-token kell, csak erre a repóra és csak az
Actions indítására. A kapcsolási szabály itt is él: egyszerre egy parancs, utána 3 mp szünet.

## Vezérlés a térképről

Belépve a robot kártyáján (tűre koppintás): **Indítás** (megerősítéssel), **Szünet** (takarítás
közben), **Haza a dokkba**, **Hol vagy?** (a robot hangjelzést ad). Csak a tulaj és a családtag
küldhet parancsot; a megtekintő és a bemutató link nem.

Hogyan jut el a robothoz: a böngésző nem éri el a gyártói felhőt (a tokenek a `robot_auth`-ban, csak
a titkos kulccsal), ezért a parancs a `robot_cmd` sorba kerül (`supabase/migrations/014_robot_cmd.sql`,
`robot_cmd_enqueue()`), és az adatgyűjtő a 10 perces körök között 10 másodpercenként felveszi
(`python -m f27.robots watch`). Így általában 10-20 mp alatt indul a robot. Szabályok: robotonként
egyszerre egy függő parancs, óránként legfeljebb 30, a 3 percnél régebbi függő parancs lejár,
két parancs között legalább 3 mp (CLAUDE.md 9. fejezet). A kártya mutatja az állapotot (elküldve,
végrehajtja, kész, hiba), utána friss robotállapotot tölt.

## Szobánkénti takarítás (zónák)

- **R2 (Roborock S7): kész.** A robot a saját térképéről adja a szobáit (szegmens-azonosító + a Roborock
  appban adott név). Az adatgyűjtő minden körben lekéri (`GET_ROOM_MAPPING`), és a robot állapotába teszi
  (`device_status.status.rooms`, csak a Supabase-ben, RLS mögött; a publikus logba név nem kerül).
- A térképen a robot kártyáján (telefonon: Robotok fül) a **Szobák** sorban kijelölsz egy vagy több
  szobát, **Kijelöltek takarítása**, megerősítés („Takarítsa ezeket: …?”), és a parancs a szokásos
  robot-sorba megy (`rooms`, a szegmensek listájával; `APP_SEGMENT_CLEAN`, egyszeri ismétléssel).
- Telepítés: `supabase/migrations/015_robot_rooms.sql` (Actions > „Supabase séma futtatása”, O2B).
- A szobák neve és határa a Roborock appban állítható (Térkép szerkesztése > Szobák). Ha ott átnevezed,
  a térképen a következő gyűjtési körben frissül.
- **R1 (Dreame Z10 Pro): még nem.** A Dreame is tud szobát (MIoT szegmens-takarítás), de a szobalista a
  titkosított térképadatban van, és ehhez először a Xiaomi-belépésnek kell működnie (most 70016-tal elutasítja).

## Térkép, takarítási napló, időzítés (2026.11.21)

- **Térkép:** az adatgyűjtő óránként lekéri mindkét robot saját térképét (R2: python-roborock, R1: Xiaomi felhő +
  vacuum-map-parser-dreame) a `robot_map` táblába (`016_robot_map.sql`, csak tulaj és családtag olvassa).
  A robot kártyáján a **Térkép** fül mutatja (szobanevek, robot, dokk). Azonnali lekérés: Actions >
  „Robotok bejelentkezése (O2B)” > `terkep`.
- **Napló:** a kártya **Napló** fülén az elmúlt 30 nap takarításai (kb. kezdet és vég, perc, m²), 14 napos sáv,
  heti összesítő; a 10 perces állapotmintákból, mindkét robotra.
- **Késleltetett és időzített indítás:** a kártyán „+30 perc / +1 / +2 / +4 óra” vagy pontos időpont (ha már
  elmúlt, holnap), egész lakás vagy a kijelölt szobák, mindig megerősítéssel. Robotonként legfeljebb 3 függő
  időzítő, 1 perc és 7 nap között, ✕-szel törölhető. Az adatgyűjtő 10 mp-en belül indítja; ha épp nem fut,
  15 percig vár, utána lejár (`017_robot_timer.sql`).

## Elakadás és hiba (2026.11.23)

- A gyűjtő minden körben (10 percenként, takarítás közben a parancsfigyelő is) megnézi a robot hibakódját, és magyarra fordítja: mi a baj és mit tegyél.
- **Push** (ntfy, ugyanaz a csatorna, mint a riasztásoké): egyszer, amikor a hiba megjelenik („R1 (lent) elakadt…”, teendővel), és egyszer, amikor megszűnik.
- A térképen a robot kártyáján piros doboz: Hol vagy? (hangjelzés), Haza a dokkba, Folytatás (megerősítéssel). A robotot kézzel kell kiszabadítani, távolról csak hangjelzést, hazaküldést és újraindítást lehet adni.

## Szobák és időzítés mindkét robotnál

- Kártya > Szobák: jelöld ki a szobákat, „Kijelöltek takarítása”, megerősítés. Az R1-nél (Dreame) is működik.
- Kártya > Időzített indítás: +30 perc, +1, +2, +4 óra vagy időpont; ha előtte szobákat jelöltél ki, csak azokat takarítja.
