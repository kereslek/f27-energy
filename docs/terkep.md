# Az élő térkép (F27 Energy Quest)

A lakás izometrikus, játékos térképe: `https://kereslek.github.io/f27-energy/`
Telefonon is működik (a teljes képernyő arányosan kicsinyítve).
A lakás mellett, kint egy iránytű mutatja az égtájakat: É (a Ferenc körút felé), K, D (a gang
és a belső udvar felé), NY.

## Egyszeri beállítás: GitHub Pages bekapcsolása

GitHub: repó > **Settings > Pages > Build and deployment > Source: GitHub Actions**.
Utána minden push után magától frissül a térkép (Actions: „Térkép (Pages)”). A Supabase
címét és a publishable kulcsot a GitHub Variables-ból (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`)
teszi bele az oldalba; a secret kulcs soha nem kerül az oldalba (a build ezt ellenőrzi is).

## Belépés

Jobb felső sarok: **Belépés**. E-mail és jelszó: a Supabase-ben létrehozott felhasználó
(Authentication > Users). Regisztrálni az oldalon nem lehet.

- **Szem ikon** a jelszómező jobb szélén: megmutatja vagy elrejti a beírt jelszót (a kurzor a
  mezőben marad). Az Enter a jelszómezőben belép.
- A mezők jelszókezelő-barátok (`username` és `current-password`): a böngésző felajánlja a
  mentést és később kitölti.
- **Emlékezz rám** (alapból be van jelölve): bejelölve a belépés a böngésző bezárása után is
  megmarad (localStorage); kivéve csak az adott lapon él, a lap vagy a böngésző bezárásával
  kilépsz (sessionStorage). Közös vagy idegen gépen vedd ki a pipát. A böngésző csak a
  választást jegyzi meg (`f27-remember`), a belépés előtt kell beállítani. A **Kilépés**
  mindkét helyről törli a munkamenetet. Privát módban, ha a böngésző tiltja a tárolást, a
  belépés csak az oldal újratöltéséig él.

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

## Eszközök panel

Felső sáv: **Eszközök** gomb, rajta az eszközök száma; piros vagy narancs pötty, ha valami
figyelmet kér. A panel jobb oldalt nyílik (telefonon alulról), az Esc bezárja; a Fiók panellel
felváltva nyílik.

- Fejléc: hány eszköz online, és hány figyelmeztetés van. Szűrők: Mind, Figyelem, Hőmérők,
  Nyílászárók, Áram, Egyéb. A figyelmeztetések elöl.
- Kártyánként: érték, elem (kis életerő-csík), online pötty, utolsó jelzés ideje.
- Jelvények: **Elem merül** (20 % alatt), **Elem lemerült** (10 % alatt), **Nem elérhető**
  (offline), **Régóta hallgat** (hőmérő 6 óra, nyitásérzékelő 24 óra, kapcsoló, kismegszakító,
  gateway 90 perc óta nem jelentett), **Friss** (10 percen belül).
- Ha egy NYITVA jelzésű érzékelő régóta hallgat vagy merül az eleme, a kártya figyelmeztet, hogy a
  jelzés lehet régi.
- Kártyára kattintva a térkép rá nagyít az eszközre, kijelöli, és kinyílnak a részletek: minden
  Tuya-állapotkód magyar névvel (az ismeretlenek nyersen).

Az "utolsó jelzés" a Tuya saját frissítési ideje (az adatgyűjtő `_upd` kulcsként tárolja); ha ez
hiányzik, a tárolás ideje. Belépés nélkül demó adat látszik, benne egy merülő elemmel és egy
régóta hallgató ablakkal.

## Élő áttekintés (jobb oszlop)

A jobb oszlopban mindig látszik, görgetés nélkül (belépés nélkül a kiválasztott pálya demó
adatával):

- **Cserépkályha** (sötét csempe, lángokkal): két független forrás egymás alatt, és hogy
  egyeznek-e.
  - *Kapcsoló (LUXION):* ahány kapcsoló be van kapcsolva, annyi kW (1-es 1 kW, 2-es 2 kW,
    3-as 3 kW).
  - *Kismegszakító (5.):* a kályhakör mért teljesítménye.
  - Ha a kettő fokozatonként 250 W-on belül van (legalább 300 W tűréssel), zöld "Egyezik".
    Egyébként figyelmeztet: pl. a kapcsoló 2-esen áll, de a kör 1,0 kW-ot mér (kiégett
    fűtőszál, vagy késik a kapcsoló állapota), a kapcsoló be van kapcsolva, de a kör nem vesz fel
    áramot (a B kör nem kap áramot), vagy a kapcsoló szerint ki van kapcsolva, de a kör fogyaszt.
  - Mellette az óradíj (60,9 Ft/kWh, B mérő, keret felett).
- **Fogyasztás most:** a 4 mért kör (kályha, bojler, főzőlap és sütő, klíma) és az összesen. A
  világítás, a hűtő, a TV és a konnektorok nincsenek mérve. Az összesen a felső sávban is látszik.
- **Nyílászárók:** mindegyik előtt piktogram: ablak vagy ajtó, nyitva (piros, kitárt szárny) vagy
  zárva (zöld); szürke, ha nem elérhető. A nyitottak elöl ("NYITVA 25 perce"), a többinél, hogy mikor mozdult
  utoljára. Ezt a `device_status` előzményből számolja (az utolsó 48 óra állapotváltásai); ha
  ebben nincs váltás, "legalább ... óta". Merülő elem és régóta hallgató érzékelő jelezve.
- **Hőmérsékletek** (hideg, rendben, meleg; a kályha mögötti a kályha töltöttségét mutatja), a
  fejlécben a **Klíma** állapota (IR vezérelt; a 9-es kör méréséből: fut vagy áll), és ha kell, egy figyelmeztető sor,
  ami az Eszközök panelt nyitja a Figyelem szűrővel.

Bármelyik sorra kattintva a térkép rá nagyít az eszközre. Telefonon a képernyő tetején lévő
**Élő áttekintés** gomb alsó lapként nyitja meg. Megjelenés: az alap (`?attekintes=1`) a
szekciós lista a csempés műszerfal kályha-csempéjével; `?attekintes=2` csempés műszerfal,
`?attekintes=3` fülek; a panel fejlécében is váltható.

## Kint (időjárás)

A felső sáv **KINT** csipje Élő módban a valódi budapesti időjárást mutatja (Open-Meteo, 15
percenként frissül, csak memóriában). Belépve a Supabase `weather_hourly` táblájából olvas (az
adatgyűjtő óránként tölti); ha ott nincs 3 óránál frissebb adat, vagy nincs belépés, közvetlenül az
Open-Meteótól kér (kulcs nélkül, a böngészőből). A csip: ikon, mostani hőmérséklet, és kb.
3 óra múlvai érték trenddel (pl. `15:00 → 9,6 °C ↑`; a nyíl fél foknál nagyobb változásnál
fordul). A hely a IX. kerület (kerületi pontossággal). Rákattintva vagy fölé víve rövid fűtési
tipp: napos, melegedő órák előtt "a kályhát most le lehet venni", hidegedő éjszaka előtt "a
kályhát most érdemes tölteni, vagy érkezés előtt temperálj", egyébként semleges. Ezek csak
javaslatok: a kályha automatikus kapcsolása a kontaktorok beépítéséig nincs bekötve (CLAUDE.md
9. fejezet). A tipp az Energiaőr tanácsai közt is megjelenik.

A pálya-előbeállítások (Pályaválasztó) a saját, kitalált kinti értéküket mutatják. Ha az időjárás
nem érhető el, a csip `KINT --`. Időjárás: [Open-Meteo](https://open-meteo.com/).

## Energiaőr (tanácsadó)

A térkép bal alsó sarkában, a lakáson kívül áll (telefonon a képernyő alján). A buborékban egyszerre
egy rövid, élő tanács látszik, 12 másodpercenként vált (ha fölé viszed az egeret, megáll).
Kattintásra vagy Enterre megnyílik az **Energiaőr tanácsai** lista, a legfontosabbal kezdve; a
**Mutasd** gomb a térképen az érintett eszközre nagyít. A **Buborék némítása** gombot a böngésző
megjegyzi.

Szabályok (élő adatból, belépés nélkül a demó adatból): 10 percnél régebben nyitott ablak vagy
bejárati ajtó fűtés közben; a kályha fokozata és óránkénti ára (keret felett 60,9 Ft/kWh, 1 kW kb.
61 Ft óránként); 23 °C feletti szoba (minden 1 °C kb. 6 % fűtési energia), 19 °C alatti szoba
(komfort); fürdő 24 °C felett; fűtő bojler; merülő elem, régóta hallgató vagy nem elérhető eszköz
(ugyanazok a szabályok, mint az Eszközök panelen); és ha minden rendben, dicséret.

A lakásban a huzat-szellem csak nyitott ablaknál vagy bejárati ajtónál jelenik meg (annál az
érzékelőnél), a láng csak akkor, ha a kályha megy. Megjelenés: alapból a zöld szék (`?energiaor=3`); minta: `?energiaor=1` robot,
`?energiaor=2` szakértő; a tanácslistában is váltható.

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
