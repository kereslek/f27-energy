"""Robotporszívók (O2B): állapot és parancsok a gyártók felhőjén át.

    R1  DreameBot Z10 Pro   lent, a nappali sarkában     Xiaomi Home (Mi felhő, miot)
    R2  Roborock S7         fent, az emeleti előszobában  Roborock felhő

Nem Tuya-eszközök, és egyik gyártónak sincs hivatalos nyilvános API-ja: ugyanazt a felhőt hívjuk,
amit az appjaik, nyílt forráskódú könyvtárral (python-roborock) és saját Xiaomi-klienssel (f27/xiaomi_cloud.py, a micloud alapján). Ha a gyártó változtat,
ezt a modult kell igazítani.

Belépés (egyszer; Actions > "Robotok bejelentkezése"):
    roborock-kod     a Roborock e-mailt küld egy kóddal (ROBOROCK_EMAIL secret)
    roborock         belépés a kóddal (a workflow inputja) vagy jelszóval (ROBOROCK_PASSWORD secret)
    xiaomi           belépés felhasználónévvel és jelszóval (XIAOMI_USERNAME, XIAOMI_PASSWORD secret); ha a Xiaomi
                     kétlépcsős jóváhagyást kér, kódot küld (e-mail vagy SMS), a függő állapot a robot_auth-ba kerül
    xiaomi-kod       a kapott kóddal befejezi a jóváhagyást; a megbízható munkamenetet (passToken) eltesszük,
                     így a következő xiaomi lépéshez már nem kell kód
A kapott tokeneket a Supabase `robot_auth` táblájába írjuk (012_robots.sql): ehhez csak a titkos
kulcs fér hozzá, a böngésző és a bemutató link soha. Jelszót nem tárolunk.

Állapot (az adatgyűjtő minden körében): `devices` és `device_status` sorok R1, R2 jellel:
    status = {state, cleaning, battery, charging, area_m2, minutes, error, src}
Parancs: start | pause | dock (egyszerre egy, utána legalább 3 mp szünet, CLAUDE.md 9. fejezet).

A log publikus: csak darabszám és OK / HIBA kerül bele, név, azonosító, token, e-mail soha.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone

from .supa import SupabaseRest, SupabaseError

logging.getLogger().setLevel(logging.WARNING)          # a könyvtárak debug-logja azonosítókat írna ki

ROBOTS = {
    "R1": {"src": "xiaomi", "label": "Robotporszívó lent (Dreame Z10 Pro)", "room": "nappali"},
    "R2": {"src": "roborock", "label": "Robotporszívó fent (Roborock S7)", "room": "eloter"},
}
XIAOMI_COUNTRY = os.environ.get("XIAOMI_COUNTRY", "de")
GAP_S = 3.0

# Dreame miot (dreame.vacuum.p2028, Z10 Pro): (siid, piid) tulajdonságok, (siid, aiid) műveletek
DREAME_PROPS = {"state": (2, 1), "error": (2, 2), "battery": (3, 1), "charging": (3, 2),
                "status": (4, 1), "minutes": (4, 2), "area_m2": (4, 3)}
DREAME_ACTIONS = {"start": (2, 1), "pause": (2, 2), "dock": (3, 1)}
# a Dreame állapotkódjai (siid 2, piid 1) -> egységes állapot
DREAME_STATE = {1: "cleaning", 2: "idle", 3: "paused", 4: "error", 5: "returning", 6: "charging",
                7: "mopping", 8: "drying", 9: "washing", 10: "returning", 11: "building_map", 12: "cleaning",
                13: "charged", 14: "upgrading", 15: "dust_collecting", 16: "remote", 17: "smart_charging"}
CLEANING = {"cleaning", "mopping", "returning", "building_map", "remote"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- tárolás ---------------------------------------------------------------------------------------
def auth_get(sb: SupabaseRest, key: str) -> dict | None:
    rows = sb.select("robot_auth", "data", id=f"eq.{key}")
    return rows[0]["data"] if rows else None


def auth_put(sb: SupabaseRest, key: str, data: dict) -> None:
    sb.upsert("robot_auth", [{"id": key, "data": data, "updated_at": now_iso()}], on_conflict="id")


# ---- Roborock --------------------------------------------------------------------------------------
def _rr_client(email: str):
    """Stabil eszközazonosítóval: a Roborock a kódot a kérő kliens azonosítójához köti, a könyvtár
    pedig alapból minden indításkor véletlent generál, így a külön futásban beírt kód "érvénytelen" lenne."""
    import hashlib
    from roborock.web_api import RoborockApiClient
    client = RoborockApiClient(email)
    client._device_identifier = hashlib.sha256(("f27-o2b-robot:" + email.strip().lower()).encode()).hexdigest()[:22]
    return client


async def rr_request_code(email: str) -> None:
    await _rr_client(email).request_code_v4()


async def rr_login(email: str, password: str = "", code: str = "") -> dict:
    client = _rr_client(email)
    ud = await (client.pass_login(password) if password else client.code_login_v4(code))
    return {"email": email, "user_data": ud.as_dict()}


async def _rr_devices(auth: dict):
    from roborock.data import UserData
    from roborock.devices.device_manager import UserParams, create_device_manager
    ud = UserData.from_dict(auth["user_data"])
    dm = await create_device_manager(UserParams(username=auth["email"], user_data=ud))
    return dm, [d for d in await dm.get_devices() if d.v1_properties is not None]


def _rr_state(s) -> str:
    name = (getattr(s, "state_name", None) or "").lower()
    for key, val in (("charging", "charging"), ("full", "charged"), ("return", "returning"), ("clean", "cleaning"),
                     ("pause", "paused"), ("idle", "idle"), ("sleep", "idle"), ("error", "error"), ("upgrad", "upgrading"),
                     ("dock", "docked"), ("mop", "cleaning")):
        if key in name:
            return val
    return name or "unknown"


async def rr_status(auth: dict) -> list[dict]:
    dm, devs = await _rr_devices(auth)
    out = []
    try:
        for d in devs:
            st = d.v1_properties.status
            await st.refresh()
            state = _rr_state(st)
            out.append({"id": d.duid, "name": d.name, "state": state, "cleaning": state in CLEANING,
                        "battery": st.battery, "charging": state in ("charging", "charged"),
                        "area_m2": st.square_meter_clean_area, "minutes": round((st.clean_time or 0) / 60),
                        "error": st.error_code_name if st.error_code else None, "src": "roborock"})
    finally:
        await dm.close()
    return out


async def rr_command(auth: dict, cmd: str) -> None:
    from roborock import RoborockCommand
    c = {"start": RoborockCommand.APP_START, "pause": RoborockCommand.APP_PAUSE, "dock": RoborockCommand.APP_CHARGE}[cmd]
    dm, devs = await _rr_devices(auth)
    try:
        if not devs:
            raise RuntimeError("nincs Roborock robot a fiókban")
        await devs[0].v1_properties.command.send(c)
    finally:
        await dm.close()


# ---- Xiaomi (Dreame) ---------------------------------------------------------------------------------
def mi_login(username: str, password: str, state: dict | None = None) -> tuple[dict, dict]:
    from . import xiaomi_cloud
    return xiaomi_cloud.login(username, password, state)


def mi_verify(username: str, password: str, pending: dict, code: str) -> tuple[dict, dict]:
    from . import xiaomi_cloud
    return xiaomi_cloud.verify(username, password, pending, code)


def mi_vacuums(auth: dict) -> list[dict]:
    from . import xiaomi_cloud
    return [d for d in xiaomi_cloud.devices(auth, XIAOMI_COUNTRY) if str(d.get("model", "")).startswith("dreame.vacuum")]


def mi_status(auth: dict) -> list[dict]:
    from . import xiaomi_cloud
    out = []
    for d in mi_vacuums(auth):
        did = d["did"]
        res = xiaomi_cloud.get_props(auth, XIAOMI_COUNTRY, [{"did": did, "siid": s, "piid": p} for s, p in DREAME_PROPS.values()])
        by = {(r.get("siid"), r.get("piid")): r.get("value") for r in res if r.get("code") == 0}
        vals = {k: by.get(sp) for k, sp in DREAME_PROPS.items()}
        online = bool(d.get("isOnline", True))
        state = DREAME_STATE.get(vals.get("state"), "unknown") if online else "offline"
        out.append({"id": did, "name": d.get("name"), "state": state, "cleaning": state in CLEANING,
                    "battery": vals.get("battery"), "charging": vals.get("charging") in (1, 5),
                    "area_m2": vals.get("area_m2"), "minutes": vals.get("minutes"),
                    "error": vals.get("error") or None, "src": "xiaomi", "online": online})
    return out


def mi_command(auth: dict, cmd: str) -> None:
    from . import xiaomi_cloud
    vs = mi_vacuums(auth)
    if not vs:
        raise RuntimeError("nincs Dreame robot a Xiaomi fiókban")
    s, a = DREAME_ACTIONS[cmd]
    xiaomi_cloud.action(auth, XIAOMI_COUNTRY, vs[0]["did"], s, a)


# ---- állapot a Supabase-be ---------------------------------------------------------------------------
def collect(sb: SupabaseRest) -> int:
    """Minden robot állapota -> devices + device_status. Visszaadja, hány robot jelentett."""
    got: dict[str, dict] = {}
    rr, mi = auth_get(sb, "roborock"), auth_get(sb, "xiaomi")
    if rr:
        try:
            st = asyncio.run(rr_status(rr))
            if st:
                got["R2"] = st[0]
        except Exception as e:                       # noqa: BLE001 (a log publikus: csak a hiba fajtája)
            print(f"Roborock: HIBA ({type(e).__name__})")
    if mi and mi.get("service_token"):               # függő jóváhagyásnál még nincs token
        try:
            st = mi_status(mi)
            if st:
                got["R1"] = st[0]
        except Exception as e:                       # noqa: BLE001
            print(f"Xiaomi: HIBA ({type(e).__name__})")
    if not got:
        return 0
    sb.upsert("devices", [{"pink": p, "role": "robot", "room": ROBOTS[p]["room"], "label": ROBOTS[p]["label"]} for p in got],
              on_conflict="pink")
    rows = []
    for p, s in got.items():
        status = {k: s.get(k) for k in ("state", "cleaning", "battery", "charging", "area_m2", "minutes", "error", "src")}
        rows.append({"pink": p, "online": s.get("online", True) and s["state"] != "offline", "status": status})
    sb.insert("device_status", rows)
    return len(rows)


def command(sb: SupabaseRest, pink: str, cmd: str) -> None:
    if pink not in ROBOTS or cmd not in ("start", "pause", "dock"):
        raise ValueError("ismeretlen robot vagy parancs")
    src = ROBOTS[pink]["src"]
    auth = auth_get(sb, src)
    if not auth:
        raise RuntimeError("ehhez a robothoz még nincs belépés")
    if src == "roborock":
        asyncio.run(rr_command(auth, cmd))
    else:
        mi_command(auth, cmd)
    time.sleep(GAP_S)                               # kapcsolási szabály: utána legalább 3 mp szünet


# ---- parancssor (a workflow-k hívják) -----------------------------------------------------------------
def main(argv: list[str]) -> int:
    env = os.environ
    sb = SupabaseRest.from_env()
    if sb is None:
        print("HIBA: nincs SUPABASE_URL / SUPABASE_SECRET_KEY")
        return 1
    what = argv[0] if argv else "status"
    try:
        if what == "roborock-kod":
            asyncio.run(rr_request_code(env["ROBOROCK_EMAIL"]))
            print("Roborock: a kódot elküldtük e-mailben. Írd be a „Robotok bejelentkezése” workflow-ba (roborock, kód).")
        elif what == "roborock":
            pw, code = env.get("ROBOROCK_PASSWORD", ""), (env.get("ROBOT_CODE") or env.get("ROBOROCK_CODE") or "").strip()
            if not pw and not code:
                print("HIBA: kell a ROBOROCK_PASSWORD secret vagy a kód (előbb: roborock-kod)")
                return 1
            auth = asyncio.run(rr_login(env["ROBOROCK_EMAIL"], pw, code))
            n = len(asyncio.run(rr_status(auth)))
            auth_put(sb, "roborock", auth)
            print(f"Roborock: OK, {n} robot")
        elif what == "xiaomi":
            from .xiaomi_cloud import NeedVerify
            stored = auth_get(sb, "xiaomi") or {}
            try:
                auth, sess = mi_login(env["XIAOMI_USERNAME"], env["XIAOMI_PASSWORD"], stored.get("session"))
            except NeedVerify as nv:
                auth_put(sb, "xiaomi", {**{k: v for k, v in stored.items() if k != "pending"}, "pending": nv.pending})
                print(f"Xiaomi: jóváhagyás kell, a kódot elküldtük ({nv.channel}). "
                      "Írd be a „Robotok bejelentkezése” workflow-ba (xiaomi-kod, kód).")
                return 0
            n = len(mi_status(auth))
            auth_put(sb, "xiaomi", {**auth, "session": sess})
            print(f"Xiaomi: OK, {n} Dreame robot")
        elif what == "xiaomi-kod":
            stored = auth_get(sb, "xiaomi") or {}
            code = (env.get("ROBOT_CODE") or env.get("ROBOROCK_CODE") or "").strip()
            if not stored.get("pending") or not code:
                print("HIBA: előbb a xiaomi lépés (az küldi a kódot), utána ide a kapott kód")
                return 1
            auth, sess = mi_verify(env["XIAOMI_USERNAME"], env["XIAOMI_PASSWORD"], stored["pending"], code)
            n = len(mi_status(auth))
            auth_put(sb, "xiaomi", {**auth, "session": sess})
            print(f"Xiaomi: OK, {n} Dreame robot")
        elif what == "status":
            print(f"Robotok: {collect(sb)} jelentett")
        elif what == "cmd":
            command(sb, argv[1], argv[2])
            print("Parancs elküldve.")
        else:
            print("Használat: roborock-kod | roborock | xiaomi | xiaomi-kod | status | cmd R1|R2 start|pause|dock")
            return 2
    except KeyError as e:
        print(f"HIBA: hiányzó secret: {e.args[0]}")
        return 1
    except SupabaseError as e:
        print(f"HIBA: adatbázis ({e}). Lefutott a 012_robots.sql?")
        return 1
    except Exception as e:                           # noqa: BLE001
        msg = re.sub(r"[\w.+-]+@[\w.-]+", "<e-mail>", str(e))[:120]   # a log publikus
        print(f"HIBA: {type(e).__name__}: {msg}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
