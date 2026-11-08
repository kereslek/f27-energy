# Riasztások: push azonnal, e-mail naponta egyszer

A rendszer **csak jelez, semmit nem kapcsol** (a brief 9. fejezete szerint jelenleg semmit nem
vezérlünk). Az adatgyűjtő (GitHub Actions, `f27/alerts.py`) minden 10 perces körben megnézi a
friss eszközállapotot, és ha valami a beállított határon kívül van:

- **azonnal push-értesítést** küld a telefonodra (ntfy app; ha bekapcsolod, WhatsAppra is),
- **e-mail naponta legfeljebb egy** megy: a **napi összefoglaló** (alapból 20:00-kor,
  `f27/digest.py`). Riasztásonként, "megszűnt" üzenetre vagy próbára e-mail nem megy.

## Mit figyel

| Szabály | Mikor szól | Alapból |
|---|---|---|
| Hőmérő 1-4 sávon kívül | a hőmérő a beállított sáv alatt (túl hideg) vagy felett (túl meleg) van legalább 10 percig | Kis szoba 19-24 °C, Nagy szoba 19-22 °C, Kályha mögött 20-38 °C, Fürdő 19-25 °C (a fürdő alapból KI) |
| Nyitott ablak fűtés/hűtés közben | megy a kályha (LUXION fokozat > 0, vagy az 5-ös kör > 300 W) vagy a klíma (9-es kör > 100 W), és nyitva van egy ablak (7, 8, 9, 10) vagy a bejárati ajtó (5) legalább N percig | BE, 10 perc (5/10/15/30) |
| Klíma nagy teljesítményen, nyitott ablakkal | a 9-es kör a határ felett megy, és nyitva van egy ablak | BE, 900 W (600/900/1200) |
| Konyhaablak kivétel | a két ablakos szabály a 7-es (konyha) ablakot nem nézi, pl. főzés közbeni szellőztetéskor; bekapcsolásakor a futó konyhaablak-riasztás csendben lezárul | KI (a konyhaablak is riaszt) |
| Lemerült nyílászárók kihagyása | a nem elérhető, 10 % alatti elemű vagy 24 órája nem jelentő érzékelő NYITVA jelzése nem számít (lehet régi) | BE |

A 6-os (privát tároló) ajtaja nem számít. A hőmérőből csak friss (6 órán belüli), elérhető érték
számít. A klímának saját visszajelzése nincs: a 9-es kör méréséből tudjuk, hogy megy.

**Mikor és hányszor:**

- Egy riasztásról legfeljebb **óránként** egy push megy ("Ha a gond fennáll, újra szól":
  30 percenként / óránként / 2 óránként). Az első push a tartósság (pl. 10 perc) után jön; ha a
  helyzet nem szűnik meg, ennyi időnként "(még fennáll)" emlékeztető jön, amíg meg nem szűnik.
- Ha megszűnik és ment róla értesítés, jön egy **"megszűnt"** push (kikapcsolható).
- **Nincs csendes időszak** (a tulaj kérése): a push éjjel-nappal megy; ha zavar, a telefonon némítható.
- Egy körben több esemény egy pushba kerül.

**Az üzenetek** röviden, név és cím nélkül, a mért értékkel, a határral és a térkép linkjével:

- `F27 riasztás: Kályha mögött 39,2 °C (határ 38 °C).`
- `F27: ablak nyitva fűtés közben: Kis szoba ablak 14 perce, közben a kályha 1 kW-on.`
- `F27: megszűnt: Kályha mögött 36,0 °C (határ 38 °C).`

## A napi e-mail összefoglaló

Naponta egyszer, a beállított időpontban (18:00 / 19:00 / **20:00** / 21:00). Ha a 20:00-s kör
kimaradna, az első későbbi kör pótolja, de csak éjfélig. Tárgy: `F27 napi összefoglaló, nov. 8.
vasárnap`. Részei:

1. **Ma történt:** a nap riasztásai, megszűnései, próbái időponttal (vissza
   tartottakat is jelöli).
2. **Teendők:** még élő riasztások, nyitott ablak/ajtó, merülő elem (20 % alatt), nem elérhető
   vagy régóta hallgató érzékelő, üres lakásban menő kályha, holnapi érkezés előtt lekapcsolt bojler
   (mind csak javaslat).
3. **Holnap:** érkezés és távozás a foglalási naptárból (csak dátum és idő).
4. **Mai fogyasztás:** a négy mért kör kWh-ja becsült forinttal (B kör 60,9 Ft/kWh, A1 36,2-70,1
   Ft/kWh), és a mai átlagos külső hőmérséklet.
5. Az érzékelők mostani értéke és a térkép linkje.

## A térképen

A felső sávban az **UTOLSÓ MOZGÁS** mellett a **RIASZTÁSOK** csempe:

- zöld **minden rendben**: alatta hány szabály van bekapcsolva, és mikor volt az utolsó riasztás;
- piros **RIASZTÁS · MOST**: az aktív riasztás rövid szövege, alatta hány további és mikor ment ki.
- Belépés nélkül (demó), vagy ha még nincs lefuttatva a 006-os migráció, a csempe a böngészőben
  számolt **előnézetet** mutatja, és ezt jelzi is ("demó előnézet", "nincs 006-os migráció").

Kattintásra nyílik a **Riasztások** panel (Esc vagy X zárja; telefonon alsó lap):

- **Hőmérséklet:** hőmérőnként kétfogantyús csúszka (kályha mögött 10-45 °C, a szobák 12-30 °C,
  0,5 °C-os lépés). A zöld sáv a rendben, a két végén riaszt; a fekete vonal a mostani érték;
  jobbra a hőmérő ki-be kapcsolója. Billentyűzettel: Tab a fogantyúra, nyilakkal 0,5 °C.
- **Fűtés / hűtés és nyitott ablak:** a két szabály és a lemerült érzékelők kihagyása.
- **Hova és mikor:** Push (ntfy), Napi e-mail összefoglaló (időponttal), WhatsApp (nem kötelező),
  emlékeztető gyakoriság, "megszűnt" üzenet, konyhaablak kivétel, (kikapcsolt) csendes órák.
- **Most riasztana:** a mostani értékekből számolt előnézet (az adatgyűjtő csak a tartós eltérésre
  szól).
- **Mentés** (csak a tulaj), **Próba-értesítés** (a következő 10 perces körben egy próba-push megy
  ki), **Napló (utolsó 20)** (csak a tulaj látja).

A takarító a panelt csak olvasni tudja. Demóban minden állítható, de nem mentődik.

## Beállítás a tulajnak, lépésről lépésre

### 1. A Supabase táblák (egyszer)

Supabase > **SQL Editor** > **New query** > a
[`supabase/migrations/006_alerts.sql`](../supabase/migrations/006_alerts.sql) teljes tartalma >
**Run** (ha "destructive operation" figyelmeztetést ad, az a `drop policy if exists` sorok miatt
van: **Run this query**). Létrejön az `alert_settings`, `alert_state` és `alert_log` tábla. Amíg ez
nincs lefuttatva, az adatgyűjtő a riasztást kihagyja (a Summary-ban jelzi), a térkép csak előnézetet
mutat.

### 2. Push: ntfy (ajánlott, ingyenes, kulcs nélkül)

1. Telepítsd a telefonodra az **ntfy** appot (Android: Google Play vagy F-Droid; iPhone: App Store).
2. Találj ki egy **hosszú, véletlenszerű csatornanevet** (topic), pl. `f27-` és utána 20-30
   véletlen betű és szám. Ez a név a jelszó: aki tudja, olvashatja az üzeneteket, ezért ne legyen
   kitalálható, és ne írd le sehova nyilvánosan (chatbe se).
3. Az appban: **+** (Subscribe to topic) > írd be ugyanezt a nevet > Subscribe.
4. GitHub: a repó > **Settings** > **Secrets and variables** > **Actions** > **New repository
   secret**: Name `NTFY_TOPIC`, Secret: a csatornanév. **Add secret**.
5. (Nem kötelező) saját ntfy szerver esetén `NTFY_URL` secret a szerver címével; alapból
   `https://ntfy.sh`.
6. Próba: a térképen Riasztások > **Próba-értesítés**; 10 percen belül megjön a push.

### 3. Napi e-mail: Gmail alkalmazásjelszóval

1. Google-fiók > **Biztonság** > kapcsold be a **Kétlépcsős azonosítást** (ha még nincs).
2. Google-fiók > Biztonság > **Alkalmazásjelszavak** (App passwords) > új jelszó, neve pl. `F27`.
   A 16 karakteres jelszót másold ki (csak egyszer látszik).
3. GitHub: Settings > Secrets and variables > Actions > New repository secret, egyenként:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = a Gmail-címed
   - `SMTP_PASS` = a 16 karakteres alkalmazásjelszó
   - `ALERT_EMAIL_TO` = a cím, ahová a levél jöjjön (több cím vesszővel)
   - (nem kötelező) `ALERT_EMAIL_FROM` = feladó, ha nem a `SMTP_USER` legyen
4. Más szolgáltató is jó: 587-es port (STARTTLS) vagy 465-ös (SSL).
5. Az első levél a beállított időpontban (alapból 20:00) jön. A GitHub Actions Summary-ban
   látszik: "Napi összefoglaló: elküldve" / "nem kellett" / "hiba (...)".

### 4. WhatsApp (nem kötelező): CallMeBot

1. A CallMeBot oldalán (callmebot.com, WhatsApp API) leírt számot mentsd el a telefonodban, és
   küldd neki WhatsAppon: `I allow callmebot to send me messages`.
2. Válaszként kapsz egy **apikey**-t.
3. GitHub secretek: `CALLMEBOT_PHONE` (a telefonszámod nemzetközi formában, pl. `+36301234567`)
   és `CALLMEBOT_APIKEY`.
4. A térképen Riasztások > Hova és mikor > kapcsold be a **WhatsApp** kapcsolót, majd Mentés.
   Ez nem hivatalos szolgáltatás, lassabb lehet: a push mellé tartaléknak jó.

## Adatvédelem

- A csatornanév, a címek, a jelszó, a telefonszám és a kulcs **csak GitHub Secretben** él, soha
  nem kerül a repóba, a logba vagy a chatbe.
- A publikus Actions logba és Summary-ba csak darabszám kerül: "Riasztások: 2 aktív, 1 értesítés
  elküldve, 0 hiba", "Napi összefoglaló: elküldve". Mért érték, üzenetszöveg, cím soha. Csatornahibánál
  csak a hiba fajtája (pl. `push (HTTPError)`, `hiba (SMTPAuthenticationError)`).
- Az üzenetekben nincs cím és név, csak a helyiség, az érték és a határ.
- A Supabase-ben a beállítást a tulaj írja, a takarító olvassa; az állapotot és a naplót csak az
  adatgyűjtő írja; a naplót csak a tulaj olvassa (sorszintű jogosultság).

## Hibakeresés

| Tünet | Ok |
|---|---|
| Summary: "Riasztások: kihagyva, hiányzik az alert_settings tábla" | a 006-os migráció nincs lefuttatva |
| Summary: "Nincs beállított push csatorna (NTFY_TOPIC)" | hiányzik a `NTFY_TOPIC` secret, vagy a Push ki van kapcsolva a panelen |
| Summary: "Napi összefoglaló: nincs beállított e-mail" | hiányzik a `SMTP_HOST` vagy az `ALERT_EMAIL_TO` secret |
| "hiba (SMTPAuthenticationError)" | rossz `SMTP_USER` / `SMTP_PASS` (Gmailnél alkalmazásjelszó kell, nem a fiók jelszava) |
| Nem jön push, a Summary szerint elküldve | az appban pontosan ugyanarra a csatornanévre iratkoztál fel? |
| A térkép csempéje "előnézet" | nincs belépés, vagy hiányzik a 006-os migráció |
