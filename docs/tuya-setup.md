# Tuya IoT fiók és GitHub Secrets: lépésről lépésre

Kb. 20 perc. A végén a GitHub Actions eléri a Smart Life eszközeidet, és az első
felderítés lefut. Kulcsot, jelszót **soha ne másolj a chatbe**, csak a GitHub
Secrets mezőibe.

## 1. Tuya Developer fiók

1. Nyisd meg: <https://platform.tuya.com> (a régi iot.tuya.com is ide visz).
2. Regisztrálj (e-mail elég). Ez **külön fiók**, nem a Smart Life belépésed,
   de használhatod ugyanazt az e-mailt.
3. Ha cég/magánszemély kérdést kap: magánszemély (Individual) is jó.

## 2. Cloud projekt

1. Bal menü: **Cloud > Development > Create Cloud Project**.
2. Kitöltés:
   - Project Name: `F27 Energy`
   - Industry: `Smart Home`
   - Development Method: `Smart Home`
   - Data Center: **`Central Europe Data Center`** (a magyar Smart Life fiók itt van)
3. Create. Felajánl egy API-csomag listát. Ezek legyenek bent (a többi alapból is jó):
   - IoT Core
   - Authorization Token Management
   - Smart Home Basic Service
   - **IR Control Hub Open Service** (a klíma IR vezérléséhez)
   - Device Status Notification
4. Authorize.

> Az IoT Core "Trial Edition" ingyenes, de időnként (1 vagy 6 havonta) meg kell
> hosszabbítani: Cloud > Cloud Services > IoT Core > Extend Trial Period. Ha egyszer
> csak hibát dob a gyűjtő ("No permissions" / "trial expired"), szinte biztosan ez a gond.

## 3. A Smart Life fiók összekötése

1. A projektben: **Devices** fül > **Link App Account** (vagy "Link Tuya App Account") > **Add App Account**.
2. Megjelenik egy QR-kód.
3. Telefonon Smart Life app > **Én / Me** fül > jobb felső sarokban a szkenner ikon > olvasd be.
4. Engedélyezés: **Automatic Link**, jogosultság: **Read, Write and Manage**.
5. Pár másodperc múlva a Devices listában megjelenik a "Ferenc krt." otthon minden eszköze
   (kb. 17 db: 4 hőmérő, 6 nyitásérzékelő, gateway, klíma IR, LUXION, 4 kismegszakító).
   Ha nem jelenik meg mind, írd meg, hány darabot látsz.

## 4. A kulcsok helye

A projekt **Overview** fülén:

- **Access ID / Client ID**
- **Access Secret / Client Secret** (szem ikonnal látszik)

Ezeket most ne írd le sehova, csak a következő lépésben a GitHubba.

## 5. GitHub Secrets

Repó: `kereslek/f27-energy` > **Settings > Secrets and variables > Actions > New repository secret**.
Egyenként vedd fel:

| Név | Érték |
|---|---|
| `TUYA_ACCESS_ID` | Access ID / Client ID |
| `TUYA_ACCESS_SECRET` | Access Secret / Client Secret |
| `TUYA_ENDPOINT` | `https://openapi.tuyaeu.com` |
| `F27_DATA_PASSWORD` | Hosszú jelmondat (min. 12 karakter, inkább 4-5 szó). Ezzel nyílik a térkép, és ezzel titkosítunk minden mérési adatot. Tedd jelszókezelőbe. |
| `TUYA_UID` | *Nem kell.* Csak ha a felderítés "permission" hibát ad: a Devices > Link App Account listában az UID oszlop értéke. |

> Miért titkosítunk? A repó publikus. Az ajtó- és ablakérzékelők adataiból kiolvasható,
> mikor üres a lakás, ezért minden Tuya-adat csak AES-256 titkosítva kerül a repóba,
> és az Actions log sem tartalmaz mérési értéket.

## 6. GitHub Pages (a térképhez)

**Settings > Pages > Build and deployment > Source: `GitHub Actions`**. Más nem kell.

## 7. Első futtatás

1. **Actions** fül > bal oldalt **Eszközfelderítés** > **Run workflow**.
2. Kb. 1 perc. A futás összefoglalójában egy táblázat mutatja, melyik pink számot sikerült
   párosítani (érték nélkül).
3. Utána a **Térkép (Pages)** workflow magától lefut, és a térkép elérhető lesz itt:
   `https://kereslek.github.io/f27-energy/` (jelszó: az `F27_DATA_PASSWORD`).

Ha valami piros lesz, elég annyit írnod, melyik lépésnél és mi a hibaüzenet első sora.
