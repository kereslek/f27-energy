# F27 Energy

Villany- és gázköltség csökkentése egy budapesti Airbnb lakásban, a vendégkomfort megtartásával.
Tuya / Smart Life eszközök adataiból: adatgyűjtés, interaktív lakástérkép, dashboard,
később automatikus optimalizálás. Projekt kontextus: [CLAUDE.md](CLAUDE.md).

## Adatvédelem

A repó publikus, ezért:

- minden Tuya-adat (device ID, állapot, ajtó/ablak nyitás, fogyasztás) **csak titkosítva**
  kerül a `data/` mappába (`*.enc`, AES-256-GCM, PBKDF2 jelszóból);
- a kulcsok kizárólag GitHub Secrets-ben vannak;
- az Actions log és összefoglaló nem tartalmaz mérési értéket;
- a térkép GitHub Pages-en fut, és a böngészőben jelszóval fejti vissza az adatot.

## Felépítés

| Hely | Mi ez |
|---|---|
| `f27/tuya.py` | Tuya IoT Cloud API kliens (csak standard könyvtár) |
| `f27/crypto.py` | Titkosítás (Python oldal, a böngésző ugyanezt fejti vissza) |
| `f27/discover.py` | Eszközfelderítés, párosítás a pink számokhoz |
| `config/devices.json` | Pink szám > eszköz név-minta, hely a térképen (ID nélkül) |
| `web/` | Lakástérkép (statikus HTML + SVG), demo adattal |
| `.github/workflows/discover.yml` | Kézi felderítés, titkosított commit |
| `.github/workflows/pages.yml` | Térkép publikálása Pages-re |
| `tools/decrypt.py` | Titkosított fájl kibontása helyben |
| `docs/tuya-setup.md` | Tuya fiók + Secrets beállítás lépésről lépésre |

## Kezdés

Lásd: [docs/tuya-setup.md](docs/tuya-setup.md).

Helyben, jelszóval:

```bash
pip install -r requirements.txt
F27_DATA_PASSWORD=... python tools/decrypt.py data/latest.json.enc
```
