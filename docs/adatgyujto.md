# Adatgyűjtő: mi fut, mikor, és hogyan ellenőrizd

## Mi fut mikor

| Workflow | Mikor | Mit csinál |
|---|---|---|
| **Eszközfelderítés** (`discover.yml`) | kézzel, és minden hónap 1-jén 04:17 UTC | Tuya eszközlista, párosítás a pink számokhoz, titkosított pillanatkép a repóba, a Supabase `devices` tábla frissítése (eszközazonosító + a státuszkódok skálája) |
| **Adatgyűjtés** (`collect.yml`) | 10 percenként (és kézzel) | Tuya állapotok a Supabase-be: `device_status` (állapot-idősor), `energy_daily` (napi kWh körönként) |

A GitHub ütemezése nem pontos: a 10 perces futás néha pár percet késik, terhelt időszakban kimaradhat egy-egy. Ez nem hiba.

## Mit ír az adatgyűjtő

- **`device_status`:** új sor csak akkor, ha az eszköz állapota érdemben változott (pl. nyílt egy ablak, kapcsolt a kályha, 25 W-nál többet változott egy kör teljesítménye, offline lett egy eszköz), vagy ha a legutóbbi sor 60 percnél régebbi (óránkénti életjel). A feszültség, áram és a fogyasztásmérő-számláló apró változása nem ok új sorra. Így az adatbázis évente kb. 100-150 MB-tal nő, bőven az ingyenes 500 MB alatt.
- **`energy_daily`:** a négy okos kismegszakító (X5 kályha, X7 bojler, X8 főzőlap, X9 klíma) napi kWh-ja, budapesti idő szerinti napokra bontva, a kismegszakító saját fogyasztásszámlálójából. Az első megfigyelés napján 0-ról indul.

## Tuya API-kvóta

Egy futás szokásosan **2 Tuya API-hívás** (token + eszközlista, ami az állapotot és az online jelzőt is hozza). Napi 144 futással ez kb. **290 hívás/nap, kb. 8 700/hónap**. Ha egy párosított eszköz hiányzik a listából, +1 hívás jön.

A havi keret a Tuya konzolban látszik: **platform.tuya.com > Cloud > Cloud Services > IoT Core**. Ha a próbaidő lejár, az adatgyűjtő piros lesz („subscription expired” jellegű hibával): ilyenkor ugyanott **Extend Trial Period**.

## Ellenőrzés

**GitHubon:** Actions > **Adatgyűjtés** > a legutóbbi futás > **Summary**. Egy táblázat mutatja: hány eszköz volt, hány új állapotsor íródott, hány napi energiasor frissült, hány Tuya-hívás ment el. Név, azonosító, mérési érték nincs benne (a log publikus).

**Supabase-ben:** bal oldalt **Table Editor**:
- `device_status`: a legújabb sorok alul (vagy rendezd a `ts` oszlop szerint csökkenőre).
- `energy_daily`: soronként egy nap és egy kör kWh-ja.
- `devices`: a 17 párosított eszköz; a `meta` oszlopban a skálák.

**A térképen:** belépés után az értékek élőben jelennek meg, a DEMO jelzés eltűnik.

## Szüneteltetés

Actions > **Adatgyűjtés** > jobb fent **„...”** > **Disable workflow**. Visszakapcsolás ugyanott: **Enable workflow**.

## Életben tartás

- **GitHub:** publikus repóban 60 nap tevékenység nélkül a GitHub leállítja az ütemezett workflow-kat. A havi Eszközfelderítés commitol (titkosított pillanatkép), ez életben tartja a repót.
- **Supabase:** az ingyenes projekt egy hét tétlenség után elalszik; a 10 percenként író adatgyűjtő ezt megakadályozza.

## Feltételezések (az első valós futás igazolja)

- A kismegszakítók (`dlq`) teljesítménykódja `cur_power`, a fogyasztásszámláló `total_forward_energy` (kWh, általában 2 tizedes skála). Ha más kódot küldenek, a Summary „Fogyasztásszámláló nélküli kismegszakító” sora jelzi.
- Az `add_ele` kódot is kumulatív számlálónak vesszük; ha valamelyik kör csak ezt küldi és a napi kWh furcsa, szólj.
- Az IR klímától (11) nem jön állapot; az eszközlistában szerepel, de csak az online jelzője változhat.
