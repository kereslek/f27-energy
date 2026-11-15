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
   - Xiaomi: `xiaomi`. Ha a Xiaomi jóváhagyást kér (SMS vagy e-mail), lépj be egyszer a Xiaomi Home
     appba, hagyd jóvá, és futtasd újra.
3. A log csak annyit ír: „OK, 1 robot”. Utána a következő adatgyűjtő körben megjelennek az élő adatok.

A belépési tokenek a Supabase `robot_auth` táblájában vannak (`supabase/migrations/012_robots.sql`),
ahhoz csak a titkos kulcs fér hozzá: a böngésző, a családtag és a bemutató link nem. Jelszót nem
tárolunk. Ha egy belépés lejár, a kártya „nincs adat”-ot mutat: futtasd újra a 2. lépést.

## Vezérlés (következő lépés)

Indítás, szünet, haza a dokkba gombok a kártyán, időzítéssel. A parancs a GitHub Actionsön fut
(kb. 20-40 mp késéssel), ehhez egy finomhangolt GitHub-token kell, csak erre a repóra és csak az
Actions indítására. A kapcsolási szabály itt is él: egyszerre egy parancs, utána 3 mp szünet.
