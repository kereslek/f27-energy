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
