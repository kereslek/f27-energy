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

A pálya-gombok (1-1 ... 1-4) előbeállított forgatókönyvek; kicsiben a Foglaltság panel fejlécében
vannak (a régi Pályaválasztó helyén ma a foglaltsági sáv áll). Ha valamelyiket választod, az élő
mód kikapcsol; mellettük az **ÉLŐ** gomb visszakapcsolja.

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
  (offline), **Régóta hallgat** (csak az elemes érzékelőknél: hőmérő 6 óra óta nem jelentett;
  nyitásérzékelő csak akkor, ha NYITVA jelez és 24 óra óta nem jelentett, mert egy zárt, nem használt
  ablak napokig hallgat, és ez nem hiba), **Friss** (10 percen belül).
- A hálózati eszközök (kismegszakítók, a LUXION kapcsoló, a gateway, az IR klíma) a Tuyának csak
  változáskor jelentenek: egy álló bojler vagy egy érintetlen kályhakapcsoló napokig hallgathat, és
  ez nem hiba. Náluk nincs "Régóta hallgat", csak a Tuya online jelzője számít (**Nem elérhető**).
  Az utolsó jelzés ideje infóként látszik ("csak változáskor jelez"), figyelmeztető szín nélkül.
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
  fejlécben a **Klíma** állapota. A klíma IR vezérelt, maga nem küld állapotot; a tápját adó 9-es
  okos kismegszakítóból számoljuk: *nincs áram* (a kismegszakító le van kapcsolva, piros), *fut*
  (100 W felett), *áll* (áram van, nem megy). Ugyanez látszik a 11-es tűn és az Eszközök panelen,
  és ha a kismegszakító le van kapcsolva, miközben a kályha fűt, az Energiaőr szól (a klíma a
  legolcsóbb hő), és ha kell, egy figyelmeztető sor,
  ami az Eszközök panelt nyitja a Figyelem szűrővel.

Bármelyik sorra kattintva a térkép rá nagyít az eszközre. Telefonon a képernyő tetején lévő
**Élő áttekintés** gomb alsó lapként nyitja meg. Belépés nélkül a panel címe **Demó áttekintés**: kitalált értékek a kiválasztott pálya szerint,
nem a lakás valódi állapota. Megjelenés: az alap (`?attekintes=1`) a
szekciós lista a csempés műszerfal kályha-csempéjével; `?attekintes=2` csempés műszerfal,
`?attekintes=3` fülek; a panel fejlécében is váltható.

## Bútorok mozgatása (Szerkesztés)

Alapból a bútorok és az eszköztűk **nem** mozdulnak el: egy kattintás csak kijelöli őket, a
húzás pedig (nagyítva) a térképet mozgatja. Átrendezéshez kapcsold be a **Szerkesztés** módot:
a ✥ gomb a térkép alatti eszköztáron vagy a jobb alsó nagyítósávban, vagy az **E** billentyű.
Bekapcsolva a bútorok és a tűk húzhatók; ugyanazzal a gombbal (vagy E-vel) kapcsolod ki.

## Utolsó mozgás

A felső sáv **UTOLSÓ MOZGÁS** csempéje azt mutatja, mikor mozdult utoljára valami a lakásban,
amit csak a helyszínen lehet: a bejárati ajtó, a tároló ajtaja és a négy ablak nyitása vagy csukása
(a kályhakapcsoló és a kismegszakítók nem számítanak, azok távolról is kapcsolhatók). Nagyban az
eltelt idő (óra, perc), alatta melyik érzékelő és pontosan mikor. Kattintásra a térkép rámutat.

A nyílászáróknál az Élő áttekintés is pontosan írja, mióta (óra, perc) és mikor (nap, időpont)
változott az állapot. Ha az előzményben (30 nap) nincs váltás, "legalább ... óta" a legrégebbi
ismert sor (pl. az adatgyűjtés kezdete) óta.

A foglaltsági sáv és a naptár fejlécében az ÉLŐ jelzés mellett **frissítés gomb** van: azonnal
újratölti a foglalásokat, az eszközállapotot és az időjárást. A gomb buboréka megmutatja, mikor
olvasta be utoljára az adatgyűjtő a naptárt. A Booking-foglalások (az Airbnb naptárában lezárt
napként érkeznek) világosabb rózsaszínnel, Booking néven látszanak, az Airbnb-foglalások
sötétebb rózsaszínnel.

## Riasztások

Az **UTOLSÓ MOZGÁS** mellett a **RIASZTÁSOK** csempe: zöld "minden rendben" (alatta hány szabály
van bekapcsolva és mikor volt az utolsó riasztás), vagy piros "RIASZTÁS · MOST" az aktív riasztás
rövid szövegével. Kattintásra nyílik a beállító panel: hőmérőnként kétfogantyús csúszka (túl hideg /
túl meleg, a zöld sáv a rendben, a fekete vonal a mostani érték), a nyitott ablak + fűtés/klíma
szabályok, a csatornák (push azonnal, e-mail csak a napi 20:00-s összefoglalóban), türelmi idő és
csendes órák, Mentés (tulaj), Próba-értesítés, Napló. Belépés nélkül, vagy ha még nincs lefuttatva a
006-os migráció, a csempe a böngészőben számolt előnézetet mutatja. Részletek és a beállítás
lépései (ntfy app, Gmail alkalmazásjelszó, GitHub Secrets): [`docs/riasztasok.md`](riasztasok.md).

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

A pálya-előbeállítások (1-1 ... 1-4) a saját, kitalált kinti értéküket mutatják. Ha az időjárás
nem érhető el, a csip `KINT --`. Időjárás: [Open-Meteo](https://open-meteo.com/).

## Energiaőr (tanácsadó)

**Tippek elrejtése.** Minden tipp alatt két gomb:
- **✓ Rendben:** tudomásul vetted; amíg a helyzet fennáll, nem jelzi. Ha megszűnik, majd újra
  előáll (pl. az ablakot becsukják, aztán újra kinyitják), újra szól.
- **Később ▾:** 1 óra múlva; holnap reggel 8:00-ig; ennél a vendégnél ne (a mostani foglalás
  végéig, a naptárból); ilyen tippet ne mutass (végleg, visszakapcsolható). A piros, biztonsági
  tippeknél (pl. nyitott ablak fűtés közben, kályha üres lakásban) a "soha" nem választható.
- Elrejtés után a buborékban **Visszavonás**. A panel alján az **Elrejtett tippek** lista: mi
  meddig van rejtve, és **visszahoz**.
- Felhasználónként mentődik a Supabase-be (`tip_dismissals`, 005-ös migráció): amit a tulaj
  elrejt, az a tulajnál minden eszközén rejtett, a takarítónál nem. Demó módban, vagy amíg a
  tábla nincs létrehozva, csak az adott lapon él.

A bal oszlopban (a régi Küldetésnapló helyén) az **Energiaőr** panel: fent a zöld szék, ami a
buborékban sorra mondja a tippeket (12 másodpercenként vált, ha fölé viszed az egeret, megáll),
alatta az összes tipp és teendő fontossági sorrendben (pl. csukd be az ablakot, cserélj elemet,
a klíma nem kap áramot). Egy tippre kattintva kinyílik a teljes szöveg, a **Mutasd** gomb a
térképen az eszközre nagyít. Telefonon a szék a képernyő alján marad, onnan nyílik a lista. A
felső sávból kikerült az Energiapont és a Megtakarítva.


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
érzékelőnél), a láng csak akkor, ha a kályha megy: a kályha oldalán ül, alatta felirat a LUXION
kapcsoló fokozatával ("Kályha fűt · 2 kW"), hogy ne tűnjön úgy, mintha egy hőmérő égne. Megjelenés: alapból a zöld szék (`?energiaor=3`); minta: `?energiaor=1` robot,
`?energiaor=2` szakértő; a tanácslistában is váltható.

## Foglaltság (Airbnb naptár)

A foglaltság az Airbnb **naptárexportjából** jön (iCal, `.ics` link). Az adatgyűjtő óránként egyszer
letölti, és a Supabase `bookings` táblájába csak ennyit ír: forrás, fajta, érkezés napja, távozás
napja. Vendégnév, telefonszám, foglalási kód vagy link nem kerül sehová. Csak a **tulaj** és a
**takarító** látja; belépés nélkül kitalált, a mai naphoz igazított **DEMÓ** foglalások látszanak.

Az Airbnb exportjában kétféle esemény van:

- **Airbnb foglalás** ("Reserved"): rózsaszín.
- **Foglalt vagy lezárt** ("Airbnb (Not available)"): kék-szürke csíkos. Ez lehet az Airbnb-be
  importált Booking-naptár foglalása (a tulaj szerint a Booking ide szinkronizál), de lehet
  elérhetőségi szabály is (előkészítési idő, előzetes értesítés, kézi lezárás). Az export nem
  különbözteti meg őket, ezért a térkép óvatosan "foglalt vagy lezárt"-nak hívja.

Érkezés **15:00**, távozás **11:00**, felfűtés érkezés napján **12:00**-tól (`web/js/app.js`,
`STAY` állandó, egyetlen helyen). **A tulaj erősítse meg**, hogy a hirdetésben is ez áll; ha nem,
csak ezt a három értéket kell átírni. Vendég bent: a mostani idő az érkezés napja 15:00 és a
távozás napja 11:00 közé esik. Érkezés napján a bejárati ajtó (5) első nyitása 15:00 után meg is
erősíti ("megérkezett 15:42").

**Felső sáv, foglaltsági csempe** (a régi, kitalált "VENDÉG ÉRKEZIK" helyén), állapotok:

| Csempe | Mikor | Alsó sor |
|---|---|---|
| VENDÉG BENT · AIRBNB, "holnap 11:00-ig" | vendég bent | "1 éjszaka maradt a 4-ből"; érkezés napján "megérkezett 15:42" |
| MA ÉRKEZIK · AIRBNB, "15:00 · 3 ó 12 p" | ma jön, még nincs bent | "felfűtés indul 12:00-kor" |
| ÜRES · KÖVETKEZŐ VENDÉG, "péntek 15:00" | most üres | "2 nap 4 óra múlva · takarékmód" |
| FOGLALT VAGY LEZÁRT, "csütörtök 11:00-ig" | csak lezárt nap fut | "valószínűleg Booking-vendég" |
| FOGLALTSÁG, "nincs adat" | nincs adat | az ok: nincs beállítva az `AIRBNB_ICAL_URL`, hiányzik a tábla (004), vagy megtekintő szerepkör |

Ha a naptár 3 óránál régebben frissült, az alsó sor ezt írja ("a naptár 5 órája nem frissült").

**Foglaltsági sáv** (bal alul, a régi Pályaválasztó helyén): a következő 14 nap, a mai kiemelve,
benne egy rózsaszín vonal a mostani időpontnál. A sávok 15:00-tól 11:00-ig tartanak. Zöld
szaggatott doboz: üres nap (bojler LE, kályha KI javasolt); láng és "12:00": érkezés üres napok
után, felfűtés 12:00-tól. Minden napra rávíve a teljes szöveg látszik.

**Foglalási naptár** (felső sáv, "FOGLALÁSI NAPTÁR" csempe, a régi KOMFORT szívek helyén):
havi nézet, hétfővel kezdődik. Lapozás a ‹ › gombokkal vagy a bal/jobb nyíllal (3 hónap vissza,
13 hónap előre; a naptár kb. 30 napot tart meg visszafelé), **Ma** vissza a mostani hónapra. Egy nap
két fél cella: bal fele az előző éjszaka (távozás 11:00-ig), jobb fele a következő (érkezés
15:00-tól); váltásnapon mindkettő látszik, felirattal ("táv. 11:00", "érk. 15:00"). Napra kattintva
részlet (pl. "Airbnb foglalás: nov. 13. 15:00 - nov. 16. 11:00, 3 éjszaka", vagy "üres nap: bojler LE,
kályha KI javasolt"). Alul a havi összesítő: foglalt éjszakák, üres éjszakák, kihasználtság. A
**Másolás** gomb a hónapot szövegként a vágólapra teszi (pl. üzenetbe a takarítónak), a naptár
szövege ki is jelölhető. Esc vagy X bezárja; telefonon alulról nyíló, teljes szélességű lap.

**Energiaőr** a foglaltságból (mind csak javaslat, automatikus kapcsolás nincs; a kályhához előbb
kontaktor kell, CLAUDE.md 9. fejezet):

- Üres a lakás, de megy a kályha: erős tipp. 1 kW egész nap kb. 25 kWh, keret felett (60,9 Ft/kWh)
  kb. 1 500 Ft naponta. Ez a nagy tétel.
- Üres napok előre: "kapcsold le a bojlert holnap 11:00 után, vissza péntek 12:00-kor (érkezés
  előtt kb. 3 órával)". Őszintén: ez kevés pénz. A 120 literes tartály kb. 1,5 kWh-t veszít
  naponta, és a kihűlt vizet újra fel kell fűteni, így a valódi megtakarítás nagyjából 20-50 Ft
  naponta.
- Fűtési szezonban üres napok előtt: a kályha ne menjen 0-24.
- Ma érkezik vendég: felfűtési terv (12:00-tól klíma 22 °C, ajtó nyitva, gáz közepesen, takarító
  14:00-kor ellenőriz); ha a bojler le van kapcsolva, piros tipp: kapcsold vissza legkésőbb 12:00-kor.
- A vendég megérkezett (az ajtó első nyitása 15:00 után), vagy még nem nyílt az ajtó.

### A naptár bekötése (a tulajnak, egyszer)

1. Airbnb (asztali böngészőben): **Naptár** > a lakás kiválasztása > **Elérhetőség** >
   **Naptárak összekapcsolása** > **Naptár exportálása**. Másold ki a megjelenő `.ics` linket.
2. A link titkos tokent tartalmaz, aki ismeri, látja a foglalásaidat. **Soha ne másold chatbe**,
   e-mailbe vagy a repóba.
3. GitHub: a repó > **Settings** > **Secrets and variables** > **Actions** > **New repository
   secret**. Name: `AIRBNB_ICAL_URL`, Secret: a link. **Add secret**.
4. Supabase: futtasd a `supabase/migrations/004_bookings.sql`-t (lásd `docs/supabase-setup.md`).
5. Legfeljebb 10 perc múlva az Adatgyűjtés lefut; a Summary-ban "Foglalások: N foglalás, M lezárt
   időszak frissítve". A térképen belépés után a csempe és a sáv élő lesz.

Nem kötelező: ha a Booking.com naptárát közvetlenül is be akarod kötni (extranet: **Árak és
elérhetőség** > **Naptár szinkronizálása** > exportálás), a linket `BOOKING_ICAL_URL` néven mentsd.
A Booking exportja nem választja szét a foglalást és a kézi lezárást, ezért ott minden esemény
foglalásnak számít.

## Szerepkörök

| Szerepkör | Lát | Szerkeszt (húzás, visszavonás, alaphelyzet) | Ment, töröl, alapértelmezett | Foglalások | Riasztás-beállítás |
|---|---|---|---|---|---|
| tulaj (owner) | igen | igen | igen | igen | állít |
| takarító (cleaner) | igen | **nem** (csak megtekintés) | nem | igen | lát |
| megtekintő (viewer) | igen | **nem** (csak megtekintés) | nem | nem | nem |
| listán kívüli fiók | csak demó | demóban igen (nem mentődik) | nem | nem | nem |

**Csak megtekintés** (2026.11.14): belépve csak a tulaj szerkeszthet. A megtekintőnél és a takarítónál
nincs Szerkesztés gomb (az E billentyű és a Ctrl+Z sem változtat), nincs "Elrendezés visszaállítása",
a húzás a térképet mozgatja, és a sávban lila **CSAK MEGTEKINTÉS** jelzés áll. A szerveroldali védelem
az RLS: írni (elrendezés, riasztás-beállítás) eddig is csak az owner tudott; a megtekintő a
foglalásokat, a mérési előzményt (`energy_daily`, `metrics_hourly`, `tuya_log`) és a riasztásokat sem látja.

### Megtekintő fiók létrehozása (a tulajnak, egyszer)

1. Supabase > **Authentication > Users > Add user > Create new user**: e-mail (pl. a saját
   címed `+f27nezo` toldalékkal, így a levelek hozzád jönnek), jelszó, és pipáld be az
   **Auto Confirm User** opciót.
2. Supabase > **SQL Editor > New query**, az e-mail címet írd át, majd Run:

   ```sql
   insert into public.app_users (user_id, role)
   select id, 'viewer' from auth.users where email = 'IDE-AZ-EMAIL-CIM'
   on conflict (user_id) do update set role = excluded.role;
   ```
3. Próba: a térképen Fiók > Belépés ezzel az e-maillel és jelszóval. A fejlécben "Belépve:
   megtekintő (csak megtekintés)." jelenik meg.

Visszavonás: `delete from public.app_users where user_id = (select id from auth.users where email = '...');`
(vagy a felhasználó törlése az Authentication > Users listában).

## Élő értékek

Belépve a térkép percenként frissíti az eszközök állapotát a Supabase `device_latest`
nézetéből (hőmérséklet, ajtó/ablak nyitva vagy zárva, kismegszakító teljesítmény, kályha
fokozat, gateway online). Ahol nincs mérés, ott a kiválasztott pálya demó értéke látszik.
Az adatokat a Tuya adatgyűjtő tölti majd fel (amíg az nem fut, minden érték demó).

## Egyszerű alaprajz

A fiók panel alján: **Egyszerű alaprajz megnyitása**. Ez a régi, sematikus térkép, ami a
repó titkosított adatát jelszóval fejti vissza a böngészőben.
