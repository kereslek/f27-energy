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
Parancs: start | pause | dock | find (egyszerre egy, utána legalább 3 mp szünet, CLAUDE.md 9. fejezet).
A dashboard a robot_cmd sorba ír (014_robot_cmd.sql), az adatgyűjtő minden (legfeljebb 30 percenkénti) futása
elején felveszi (`queue`), végrehajtja, és utána friss állapotot ír. A `watch` ciklust a workflow már nem futtatja
(CLAUDE.md 20. fejezet: a GitHub Actions nem lehet folyamatos szolgáltatás).

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
# kopóalkatrészek a Dreame MIoT-specifikációjából: hátralévő élet %; ha egy modell nem ismeri, kimarad
DREAME_PARTS = {"main_brush": (9, 2), "side_brush": (10, 2), "filter": (11, 1)}
DREAME_ACTIONS = {"start": (2, 1), "pause": (2, 2), "dock": (3, 1), "find": (7, 1)}   # find: "itt vagyok" hang
COMMANDS = ("start", "pause", "dock", "find", "rooms")      # rooms: szobánkénti takarítás (015_robot_rooms.sql)
TIMER_TTL_S = 45 * 60                                 # az időzített indítás ennyit vár a gyűjtőre (019: a gyűjtő 30 percenként fut)
CMD_TTL_S = 45 * 60                                   # a 45 percnél régebbi függő parancs lejár (019_robot_cmd_slow.sql)
# a Dreame állapotkódjai (siid 2, piid 1) -> egységes állapot
DREAME_STATE = {1: "cleaning", 2: "idle", 3: "paused", 4: "error", 5: "returning", 6: "charging",
                7: "mopping", 8: "drying", 9: "washing", 10: "returning", 11: "building_map", 12: "cleaning",
                13: "charged", 14: "upgrading", 15: "dust_collecting", 16: "remote", 17: "smart_charging"}
CLEANING = {"cleaning", "mopping", "returning", "building_map", "remote"}

# ---- hibák: magyar szöveg és teendő (a tulaj kérése, 2026.11.23: elakadásról push) ----------------------
# A Dreame (siid 2, piid 2) számot ad, a Roborock nevet (python-roborock RoborockErrorCode). A szám-tábla
# csak a biztosan ismert kódokat tartalmazza; a többinél kulcsszó alapján (Roborock) vagy általános szöveg.
DREAME_ERRORS = {1: "drop", 2: "cliff", 3: "bumper", 4: "tilted", 5: "bumper", 6: "drop", 7: "sensor", 8: "bin",
                 9: "tank", 10: "tank", 11: "bin_full", 12: "brush", 13: "side_brush", 14: "fan", 15: "wheel",
                 16: "wheel", 17: "stuck", 18: "stuck", 19: "dock", 20: "battery", 21: "dock"}
ERR_KINDS = [  # (kulcs, kulcsszavak a gyártói névben, szöveg, teendő)
    ("stuck", ("stuck", "trapped", "suffocate", "blocked", "jammed_wheel"), "elakadt, nem tud továbbmenni",
     "Nézd meg, hol áll (Hol vagy? = hangjelzés), szabadítsd ki, és tedd vissza a padlóra vagy a dokkba."),
    ("drop", ("drop", "suspend", "lifted"), "a kerekei a levegőben (felemelték vagy beakadt)",
     "Tedd le sík padlóra, utána indítsd újra vagy küldd haza."),
    ("wheel", ("wheel",), "a kereke beakadt",
     "Nézd meg a kerekeket (haj, kábel, zokni), tisztítsd meg, utána indítsd újra."),
    ("side_brush", ("side_brush", "side brush"), "az oldalkefe beakadt",
     "Vedd le az oldalkefét, szedd le róla a hajat, tedd vissza."),
    ("brush", ("main_brush", "brush"), "a főkefe beakadt",
     "Vedd ki a főkefét, tisztítsd meg (haj, macskaszőr), tedd vissza."),
    ("cliff", ("cliff",), "a szakadékérzékelő jelez",
     "Töröld le az alsó érzékelőket, és tedd a robotot távolabb a lépcsőtől."),
    ("bumper", ("bumper",), "az ütköző beragadt",
     "Nyomkodd meg körben az ütközőt, nézd meg, nem szorult-e be valami."),
    ("tilted", ("tilt", "gesture"), "megdőlt, nem áll vízszintesen",
     "Tedd le sík padlóra."),
    ("sensor", ("lidar", "laser", "lds", "optical", "sensor", "camera", "vision", "visual"), "a lézertorony vagy egy érzékelő hibát jelez",
     "Töröld le a lézertornyot és az érzékelőket, nézd meg, nem akadt-e meg a torony."),
    ("bin_full", ("full",), "tele a portartály", "Ürítsd ki a portartályt."),
    ("bin", ("dustbin", "bin", "strainer", "filter"), "a portartály vagy a szűrő nincs a helyén",
     "Tedd vissza rendesen a portartályt és a szűrőt."),
    ("tank", ("tank", "water", "mop"), "víztartály vagy mop gond", "Nézd meg a víztartályt és a mopot."),
    ("fan", ("fan",), "a ventilátor hibát jelez", "Ürítsd a tartályt, tisztítsd a szűrőt; ha marad, az app ír többet."),
    ("battery", ("battery", "low_power"), "lemerült az akkuja", "Tedd a dokkra töltődni."),
    ("dock", ("dock", "charg", "return"), "nem találja a dokkot vagy nem tölt",
     "Nézd meg, áll-e a dokk, van-e áram, és nincs-e előtte akadály; tedd rá kézzel."),
    ("nogo", ("nogo", "no_go", "forbidden", "restricted", "virtual"), "tiltott zónába került",
     "Tedd ki a tiltott zónából, vagy nézd meg a zónákat az appban."),
]


def error_info(src: str, raw) -> dict | None:
    """A gyártói hibakódból: {'key', 'text', 'fix', 'raw'}; nincs hiba: None. Tiszta függvény (tesztelhető)."""
    if raw in (None, "", 0, "0", "none", "None") or raw is False:
        return None
    rid = str(raw)[:60]
    if src == "xiaomi":
        try:
            code = int(raw)
        except (TypeError, ValueError):
            code = None
        if code == 0:
            return None
        key = DREAME_ERRORS.get(code) if code is not None else None
        if key is None:
            return {"key": f"code{rid}", "text": f"hibát jelez (Dreame hibakód {rid})",
                    "fix": "Nézd meg a robotot; a Xiaomi Home app pontosan kiírja, mi a gond.", "raw": rid}
    else:
        n = rid.lower().replace("-", "_")
        if n in ("none", "no_error", "ok"):
            return None
        key = next((k for k, words, _t, _f in ERR_KINDS if any(w in n for w in words)), None)
        if key is None:
            return {"key": "other_" + re.sub(r"[^a-z0-9_]", "", n)[:30], "text": "hibát jelez (" + rid.replace("_", " ") + ")",
                    "fix": "Nézd meg a robotot; a Roborock app pontosan kiírja, mi a gond.", "raw": rid}
    _k, _w, text, fix = next(e for e in ERR_KINDS if e[0] == key)
    return {"key": key, "text": text, "fix": fix, "raw": rid}


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


async def _rr_rooms(d) -> list[list] | None:
    """A robot saját térképének szobái: [[szegmens, név], ...] (a név a Roborock appból). Hiba esetén None.

    A nevek csak a Supabase-be mennek (RLS), a publikus logba soha."""
    try:
        tr = d.v1_properties.rooms
        await tr.refresh()
        return [[int(r.segment_id), (r.name or "")[:40]] for r in (tr.rooms or []) if r.segment_id is not None][:24] or None
    except Exception:                                  # noqa: BLE001 (régi firmware, nincs térkép)
        return None


def room_args(args) -> list[int]:
    """A 'rooms' parancs paramétere: 1-16 szegmens-azonosító (egész, 1-9999), ismétlés nélkül."""
    if not isinstance(args, list) or not 1 <= len(args) <= 16:
        raise ValueError("jelölj ki 1-16 szobát")
    out = []
    for a in args:
        if isinstance(a, bool) or not isinstance(a, int) or not 0 < a < 10000:
            raise ValueError("hibás szoba-azonosító")
        if a not in out:
            out.append(a)
    return out


async def _rr_parts(d) -> dict | None:
    """Kopóalkatrészek hátralévő élete százalékban (főkefe, oldalkefe, szűrő, szenzorok). Hiba esetén None."""
    try:
        from roborock.const import (FILTER_REPLACE_TIME, MAIN_BRUSH_REPLACE_TIME, SENSOR_DIRTY_REPLACE_TIME,
                                    SIDE_BRUSH_REPLACE_TIME)
        tr = d.v1_properties.consumables
        await tr.refresh()
        out = {}
        for key, attr, life in (("main_brush", "main_brush_work_time", MAIN_BRUSH_REPLACE_TIME),
                                ("side_brush", "side_brush_work_time", SIDE_BRUSH_REPLACE_TIME),
                                ("filter", "filter_work_time", FILTER_REPLACE_TIME),
                                ("sensor", "sensor_dirty_time", SENSOR_DIRTY_REPLACE_TIME)):
            v = getattr(tr, attr, None)
            if isinstance(v, (int, float)):
                out[key] = max(0, min(100, round(100 - 100 * v / life)))
        return out or None
    except Exception:                                  # noqa: BLE001
        return None


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
                        "error": st.error_code_name if st.error_code else None, "src": "roborock",
                        "rooms": await _rr_rooms(d), "parts": await _rr_parts(d)})
    finally:
        await dm.close()
    return out


async def rr_command(auth: dict, cmd: str, args=None) -> None:
    from roborock import RoborockCommand
    if cmd == "rooms":
        params = [{"segments": room_args(args), "repeat": 1}]
        dm, devs = await _rr_devices(auth)
        try:
            if not devs:
                raise RuntimeError("nincs Roborock robot a fiókban")
            await devs[0].v1_properties.command.send(RoborockCommand.APP_SEGMENT_CLEAN, params)
        finally:
            await dm.close()
        return
    c = {"start": RoborockCommand.APP_START, "pause": RoborockCommand.APP_PAUSE, "dock": RoborockCommand.APP_CHARGE,
         "find": RoborockCommand.FIND_ME}[cmd]
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
        res = xiaomi_cloud.get_props(auth, XIAOMI_COUNTRY, [{"did": did, "siid": s, "piid": p}
                                                            for s, p in list(DREAME_PROPS.values()) + list(DREAME_PARTS.values())])
        by = {(r.get("siid"), r.get("piid")): r.get("value") for r in res if r.get("code") == 0}
        vals = {k: by.get(sp) for k, sp in DREAME_PROPS.items()}
        parts = {k: by[sp] for k, sp in DREAME_PARTS.items() if isinstance(by.get(sp), (int, float)) and 0 <= by[sp] <= 100}
        online = bool(d.get("isOnline", True))
        state = DREAME_STATE.get(vals.get("state"), "unknown") if online else "offline"
        out.append({"id": did, "name": d.get("name"), "state": state, "cleaning": state in CLEANING,
                    "battery": vals.get("battery"), "charging": vals.get("charging") in (1, 5),
                    "area_m2": vals.get("area_m2"), "minutes": vals.get("minutes"),
                    "error": vals.get("error") or None, "src": "xiaomi", "online": online, "parts": parts or None})
    return out


# szobánkénti takarítás a Dreame-nél: start-custom (siid 4, aiid 1), állapot (piid 1) = 18 (szegmens),
# takarítási paraméterek (piid 10): {"selects": [[szegmens, ismétlés, szívóerő, víz, sorrend], ...]}
DREAME_SEGMENT = (4, 1)


def dreame_segment_in(segments: list[int]) -> list[dict]:
    sel = [[seg, 1, 1, 2, i + 1] for i, seg in enumerate(segments)]      # 1x, normál szívás, közepes víz
    return [{"piid": 1, "value": 18}, {"piid": 10, "value": json.dumps({"selects": sel}, separators=(",", ":"))}]


def mi_command(auth: dict, cmd: str, args=None) -> None:
    from . import xiaomi_cloud
    vs = mi_vacuums(auth)
    if not vs:
        raise RuntimeError("nincs Dreame robot a Xiaomi fiókban")
    if cmd == "rooms":
        s, a = DREAME_SEGMENT
        res = xiaomi_cloud.action(auth, XIAOMI_COUNTRY, vs[0]["did"], s, a, dreame_segment_in(room_args(args)))
    else:
        s, a = DREAME_ACTIONS[cmd]
        res = xiaomi_cloud.action(auth, XIAOMI_COUNTRY, vs[0]["did"], s, a)
    code = ((res or {}).get("result") or {}).get("code") if isinstance((res or {}).get("result"), dict) else None
    if code not in (None, 0):
        raise RuntimeError(f"a Dreame elutasította a parancsot (kód {code})")


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
    maps = map_rooms(sb)
    try:                                             # az előző állapot: ebből derül ki, új-e a hiba (push csak egyszer)
        prev = {r["pink"]: (r.get("status") or {}) for r in sb.select("device_latest", "pink,status", pink="in.(R1,R2)")}
    except Exception:                                # noqa: BLE001
        prev = None
    rows = []
    for p, s in got.items():
        status = {k: s.get(k) for k in ("state", "cleaning", "battery", "charging", "area_m2", "minutes", "error", "src")}
        ei = error_info(s.get("src") or ROBOTS[p]["src"], s.get("error"))
        if not ei and s.get("state") == "error":       # hibaállapot kód nélkül
            ei = {"key": "error", "text": "hibát jelez", "fix": "Nézd meg a robotot; a gyártó appja pontosan kiírja, mi a gond."}
        if ei:
            status.update(error_key=ei["key"], error_text=ei["text"], error_fix=ei["fix"])
        rooms = merge_rooms(s.get("rooms"), maps.get(p))
        if rooms:
            s["rooms"] = rooms
        for k in ("rooms", "parts"):
            if s.get(k):
                status[k] = s[k]
        rows.append({"pink": p, "online": s.get("online", True) and s["state"] != "offline", "status": status})
    sb.insert("device_status", rows)
    rows_by = {r["pink"]: r for r in rows}
    for p, s in got.items():                         # a publikus logba csak darabszám, név soha
        print(f"Robot {p}: {s.get('state')}, hiba: {'igen' if rows_by[p]['status'].get('error_key') else 'nincs'}, "
              f"szobák: {len(s.get('rooms') or [])}, kopóalkatrész-adat: {len(s.get('parts') or {})}")
    try:
        n = notify_errors(sb, prev, rows_by) if prev is not None else 0
        if n:
            print(f"Robot-hiba push: {n}")
    except Exception as e:                           # noqa: BLE001 (a push nem viheti el a gyűjtést)
        print(f"Robot-hiba push: HIBA ({type(e).__name__})")
    return len(rows)


def map_rooms(sb: SupabaseRest) -> dict[str, list]:
    """A robotok saját térképének szobái (robot_map, 016): {pink: [[id, név], ...]}; hiba esetén üres."""
    try:
        rows = sb.select("robot_map", "pink,rooms")
    except Exception:                                # noqa: BLE001 (régi séma, nincs tábla)
        return {}
    out = {}
    for r in rows or []:
        rs = [[int(x["id"]), (x.get("name") or "")[:40]] for x in (r.get("rooms") or [])
              if isinstance(x, dict) and isinstance(x.get("id"), int) and 0 < x["id"] < 10000]
        if rs:
            out[r.get("pink")] = rs
    return out


def merge_rooms(own, from_map) -> list | None:
    """A robot saját szobalistája (név az appból) kiegészítve a térkép szobáival (ami onnan hiányzik).
    A Roborock csak az elnevezett szobákat adja, a Dreame semmit: így mindkettőnél minden szoba választható."""
    out: dict[int, str] = {}
    for lst in (own or [], from_map or []):
        for r in lst:
            if isinstance(r, (list, tuple)) and len(r) >= 2 and isinstance(r[0], int) and not isinstance(r[0], bool):
                if not out.get(r[0]):
                    out[r[0]] = str(r[1] or "")[:40]
    return [[k, v] for k, v in out.items()][:24] or None


# ---- hiba-értesítés (push): egy push, amikor a hiba megjelenik, és egy, amikor megszűnik -------------------
# Az állapot a device_status-ban van (error_key): az előző sorhoz mérünk, így a gyűjtő újraindulása
# sem küld újra pusht, és nem kell külön tábla.
def plan_error_pushes(prev: dict, rows: dict[str, dict]) -> list[dict]:
    """Tiszta függvény: az előző és a mostani robotállapotból a küldendő pushok listája."""
    out = []
    for p, r in rows.items():
        st, old = r.get("status") or {}, (prev or {}).get(p) or {}
        key, was = st.get("error_key"), old.get("error_key")
        if key and key != was:
            out.append({"pink": p, "kind": "error", "text": st.get("error_text") or "hibát jelez",
                        "fix": st.get("error_fix") or "", "battery": st.get("battery")})
        elif was and not key and st.get("state") not in (None, "offline", "unknown"):
            out.append({"pink": p, "kind": "ok", "text": "újra rendben", "fix": "", "battery": st.get("battery")})
    return out


def push_message(p: dict) -> dict:
    from .site import SITE
    name = {"R1": "R1 (lent)", "R2": "R2 (fent)"}.get(p["pink"], p["pink"])
    if p["kind"] == "ok":
        title = f"{SITE.tag}: a robotporszívó {name} újra rendben"
        body = f"{SITE.tag}: a robotporszívó {name} hibája megszűnt."
        return {"title": title, "body": body + "\n\nTérkép: " + SITE.map_url, "plain": title + "\n" + body,
                "priority": "low", "tags": "white_check_mark"}
    title = f"{SITE.tag}: a robotporszívó {name} {p['text']}"
    body = f"{title}.\nTeendő: {p['fix']}" + (f"\nAkku: {p['battery']}%" if isinstance(p.get("battery"), (int, float)) else "")
    body += "\nA térképen a robot kártyáján: Hol vagy? (hangjelzés), Haza a dokkba, Indítás."
    return {"title": title, "body": body + "\n\nTérkép: " + SITE.map_url, "plain": title + "\n" + body,
            "priority": "high", "tags": "warning,robot"}


def notify_errors(sb: SupabaseRest, prev: dict, rows: dict[str, dict], environ=None, senders: dict | None = None) -> int:
    """A robot hibájáról push (ntfy, a riasztások csatornái szerint). Visszaadja az elküldött pushok számát."""
    from .alerts import SENDERS, channels_ready, dispatch, merge_config
    environ = os.environ if environ is None else environ
    pushes = plan_error_pushes(prev, rows)
    if not pushes:
        return 0
    try:
        srow = sb.select("alert_settings", "config", id="eq.1")
        cfg = merge_config(srow[0].get("config") if srow else None)
    except Exception:                                # noqa: BLE001
        cfg = merge_config(None)
    channels = [c for c in channels_ready(cfg, environ) if c in SENDERS]
    sent = 0
    for p in pushes:
        if channels and dispatch(push_message(p), channels, environ, dict(SENDERS, **(senders or {})), []):
            sent += 1
    return sent


def command(sb: SupabaseRest, pink: str, cmd: str, args=None) -> None:
    if pink not in ROBOTS or cmd not in COMMANDS:
        raise ValueError("ismeretlen robot vagy parancs")
    src = ROBOTS[pink]["src"]
    auth = auth_get(sb, src)
    if not auth:
        raise RuntimeError("ehhez a robothoz még nincs belépés")
    if src == "roborock":
        asyncio.run(rr_command(auth, cmd, args))
    else:
        mi_command(auth, cmd, args)
    time.sleep(GAP_S)                               # kapcsolási szabály: utána legalább 3 mp szünet


# ---- parancssor a dashboardról (robot_cmd, 014_robot_cmd.sql) -------------------------------------------
def _mask(text: str) -> str:
    return re.sub(r"[\w.+-]+@[\w.-]+", "<e-mail>", text)


def _age_s(ts: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds()


def run_queue(sb: SupabaseRest) -> int:
    """A függő parancsok végrehajtása sorban (egyszerre egy, utána 3 mp). Visszaadja a végrehajtottak számát."""
    try:                                             # 017: időzített parancs (kind = timer) csak a due_at után
        rows = sb.select("robot_cmd", "id,pink,cmd,args,created_at,kind,due_at", status="eq.queued",
                         due_at=f"lte.{now_iso()}", order="due_at.asc", limit="5")
    except SupabaseError:
        try:                                         # a 017 még nem futott
            rows = sb.select("robot_cmd", "id,pink,cmd,args,created_at", status="eq.queued", order="id.asc", limit="5")
        except SupabaseError:                        # a 015 sem: nincs args oszlop
            rows = sb.select("robot_cmd", "id,pink,cmd,created_at", status="eq.queued", order="id.asc", limit="5")
    done = 0
    for r in rows:
        rid = f"eq.{r['id']}"
        timer = r.get("kind") == "timer"
        if _age_s(r.get("due_at") or r["created_at"]) > (TIMER_TTL_S if timer else CMD_TTL_S):
            sb.update("robot_cmd", {"status": "expired", "done_at": now_iso(),
                                    "note": "az időzítő lejárt, a gyűjtő nem futott" if timer else "nem vette fel a gyűjtő 45 percen belül"},
                      id=rid, status="eq.queued")
            continue
        if not sb.update("robot_cmd", {"status": "running"}, id=rid, status="eq.queued"):
            continue                                # közben más felvette
        try:
            command(sb, r["pink"], r["cmd"], r.get("args"))
            sb.update("robot_cmd", {"status": "done", "done_at": now_iso()}, id=rid)
            print(f"Robot-parancs: {r['pink']} {r['cmd']}{' (időzített)' if timer else ''} OK")
        except Exception as e:                       # noqa: BLE001
            sb.update("robot_cmd", {"status": "error", "done_at": now_iso(),
                                    "note": f"{type(e).__name__}: {_mask(str(e))}"[:200]}, id=rid)
            print(f"Robot-parancs: {r['pink']} {r['cmd']} HIBA ({type(e).__name__})")
        done += 1
    if done:
        time.sleep(5)                               # a robot átvált, utána friss állapot a térképre
        try:
            collect(sb)
        except Exception:                            # noqa: BLE001
            pass
    return done


def watch(sb: SupabaseRest, seconds: float, every: float = 10.0) -> None:
    """A gyűjtő körei között: `seconds` másodpercig 10 mp-enként felveszi a dashboard parancsait.
    Soha nem tér vissza korábban (a hívó ciklus ezzel tartja a 10 perces ütemet)."""
    end, warned = time.monotonic() + seconds, False
    try:
        from .robot_map import LiveTracker
        live = LiveTracker()                         # takarítás közben percenként friss hely és útvonal (018_robot_live.sql)
    except Exception:                                # noqa: BLE001
        live = None
    live_warned = False
    while True:
        try:
            if run_queue(sb) and live:
                live.invalidate()                    # egy parancs után friss állapot van: azonnal újra nézzük
        except SupabaseError as e:
            if not warned:
                print(f"Robot-parancsok: a sor nem olvasható ({e.code or e.status}); lefutott a 014_robot_cmd.sql?")
                warned = True
        except Exception as e:                       # noqa: BLE001
            if not warned:
                print(f"Robot-parancsok: HIBA ({type(e).__name__})")
                warned = True
        if live:
            try:
                live.tick(sb)
            except Exception as e:                   # noqa: BLE001 (nem végzetes; a log publikus: csak a hiba fajtája)
                if not live_warned:
                    print(f"Élő követés: HIBA ({type(e).__name__})")
                    live_warned = True
        left = end - time.monotonic()
        if left <= 0:
            return
        time.sleep(min(every, left))


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
            try:                                     # a robotok saját térképe óránként egyszer (f27/robot_map.py)
                from .robot_map import collect_maps
                for k, v in collect_maps(sb).items():
                    print(f"Térkép {k}: {v}")
            except Exception as e:                   # noqa: BLE001
                print(f"Térkép: HIBA ({type(e).__name__})")
        elif what == "terkep":                     # azonnali térkép-lekérés (Robotok bejelentkezése workflow)
            from .robot_map import collect_maps
            res = collect_maps(sb, force=True)
            for k, v in res.items():
                print(f"Térkép {k}: {v}")
            return 0 if all(v.startswith("OK") for v in res.values()) else 1
        elif what == "cmd":
            command(sb, argv[1], argv[2])
            print("Parancs elküldve.")
        elif what == "queue":
            print(f"Robot-parancsok: {run_queue(sb)} végrehajtva")
        elif what == "teszt":                      # a teljes sor-útvonal próbája: parancs a sorba, a gyűjtő hajtja végre
            pink, cmd = (argv[1] if len(argv) > 1 else "R2"), (argv[2] if len(argv) > 2 else "find")
            if pink not in ROBOTS or cmd not in COMMANDS:
                print("HIBA: ismeretlen robot vagy parancs"); return 2
            sb.insert("robot_cmd", [{"pink": pink, "cmd": cmd}])
            print(f"Teszt: {pink} {cmd} a sorban, a teszt maga hajtja végre (a gyűjtő már nem fut folyamatosan)...")
            t0 = time.time()
            run_queue(sb)
            rows = sb.select("robot_cmd", "status,note,created_at", pink=f"eq.{pink}", order="id.desc", limit="1")
            st = rows[0]["status"] if rows else "?"
            secs = int(time.time() - t0)
            note = (rows[0].get("note") or "").split(":")[0] if rows else ""
            print(f"Teszt: {pink} {cmd} -> {st} ({secs} mp){' · ' + note if note else ''}")
            r = sb.select("device_latest", "status", pink=f"eq.{pink}")
            s0 = (r[0].get("status") or {}) if r else {}
            print(f"Robot most: {s0.get('state', '--')}, akku {s0.get('battery', '--')}%")
            return 0 if st == "done" else 1
        elif what == "watch":
            watch(sb, float(argv[1]) if len(argv) > 1 else 600)
        else:
            print("Használat: roborock-kod | roborock | xiaomi | xiaomi-kod | status | terkep | queue | watch [mp] | cmd R1|R2 start|pause|dock|find")
            return 2
    except KeyError as e:
        print(f"HIBA: hiányzó secret: {e.args[0]}")
        return 1
    except SupabaseError as e:
        print(f"HIBA: adatbázis ({e}). Lefutott a 012_robots.sql?")
        return 1
    except Exception as e:                           # noqa: BLE001
        msg = _mask(str(e))[:120]                   # a log publikus
        print(f"HIBA: {type(e).__name__}: {msg}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
