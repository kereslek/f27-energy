# Távkapcsolás és időzítés (O2B)

A dashboardon a konnektoros lámpák (és megerősítéssel az emeleti bojler) kapcsolhatók és időzíthetők.

- **Az eszköz kártyáján** (tűre koppintva): kapcsoló, gyors időzítők (BE 1 órára, KI 23:00-kor, BE napnyugtakor),
  heti szabályok (időpont, napnyugta, napkelte; minden nap, hétköznap, hétvégén), törlés és szüneteltetés.
- **Kapcsolók blokk** (Áttekintés panel; telefonon az Eszközök lap tetején): minden lámpa egy sorban, jelenetek
  (Esti hangulat, Filmezés, Ünnep, Minden le).
- **Heti időzítő** lap: a szabályok heti idővonalon, és új szabály bármelyik eszközhöz.

Ki kapcsolhat: a tulaj és a családtag (owner, member). A megtekintő (viewer) és az ideiglenes bemutató link csak látja az állapotot. Felhasználót a térképen, a Fiók > Hozzáférések panelen lehet felvenni (`docs/terkep.md`).

## Működés

- A kapcsolást a `control` Supabase-függvény végzi (`supabase/functions/control/index.ts`). A Tuya-kulcs csak a
  függvény titkai között van, a böngészőbe soha nem kerül.
- Egyszerre egy parancs, két kapcsolás között legalább 3 mp (`control_slot()` az adatbázisban), ahogy a projekt
  kapcsolási szabálya előírja. A jelenetek ezért eszközönként kb. 3 mp-et vesznek igénybe.
- Időzítés: a Supabase percenként hívja a függvényt (pg_cron), az végrehajtja az esedékes egyszeri időzítőket és a
  heti szabályokat (napnyugta, napkelte naponta számolva; 15 perces türelmi ablak).
- Napló: `control_log` (ki, mikor, mit, sikerült-e).
- Csak a `sites/o2b/site.json` `control.pinks` listáján lévő eszköz kapcsolható; a `control.confirm` listán lévő
  (bojler) csak megerősítéssel.

## Telepítés

Actions > **Kapcsolás telepítése (O2B)** > Run workflow. Egy futás: adatbázis (010), titkok a GitHub Secretsből,
a függvény telepítése, percenkénti időzítő. Kell hozzá a `SUPABASE_ACCESS_TOKEN` secret (megvan), és hogy a token
az Edge Functions és a titkok kezelésére is jogot adjon.
