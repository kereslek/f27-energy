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
A dashboard a robot_cmd sorba ír (014_robot_cmd.sql), az adatgyűjtő a körök között 10 mp-enként
felveszi (`watch`), végrehajtja, és utána friss állapotot ír.

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
DREAME_ACTIONS = {"start": (2, 1), "pause": (2, 2), "dock": (3, 1), "find": (7, 1)}   # find: "itt vagyok" hang
COMMANDS = ("start", "pause", "dock", "find", "rooms")      # rooms: szobánkénti takarítás (015_robot_rooms.sql)
CMD_TTL_S = 180                                       # a 3 percnél régebbi függő parancs lejár (014_robot_cmd.sql)
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
                        "rooms": await _rr_rooms(d)})
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
        if s.get("rooms"):
            status["rooms"] = s["rooms"]
        rows.append({"pink": p, "online": s.get("online", True) and s["state"] != "offline", "status": status})
    sb.insert("device_status", rows)
    return len(rows)


def command(sb: SupabaseRest, pink: str, cmd: str, args=None) -> None:
    if pink not in ROBOTS or cmd not in COMMANDS:
        raise ValueError("ismeretlen robot vagy parancs")
    src = ROBOTS[pink]["src"]
    auth = auth_get(sb, src)
    if not auth:
        raise RuntimeError("ehhez a robothoz még nincs belépés")
    if src == "roborock":
        asyncio.run(rr_command(auth, cmd, args))
    elif cmd == "rooms":
        raise RuntimeError("a szobánkénti takarítás a Dreame-nél még nincs kész")
    else:
        mi_command(auth, cmd)
    time.sleep(GAP_S)                               # kapcsolási szabály: utána legalább 3 mp szünet


# ---- parancssor a dashboardról (robot_cmd, 014_robot_cmd.sql) -------------------------------------------
def _mask(text: str) -> str:
    return re.sub(r"[\w.+-]+@[\w.-]+", "<e-mail>", text)


def _age_s(ts: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds()


def run_queue(sb: SupabaseRest) -> int:
    """A függő parancsok végrehajtása sorban (egyszerre egy, utána 3 mp). Visszaadja a végrehajtottak számát."""
    try:
        rows = sb.select("robot_cmd", "id,pink,cmd,args,created_at", status="eq.queued", order="id.asc", limit="5")
    except SupabaseError:                            # a 015_robot_rooms.sql még nem futott: nincs args oszlop
        rows = sb.select("robot_cmd", "id,pink,cmd,created_at", status="eq.queued", order="id.asc", limit="5")
    done = 0
    for r in rows:
        rid = f"eq.{r['id']}"
        if _age_s(r["created_at"]) > CMD_TTL_S:
            sb.update("robot_cmd", {"status": "expired", "done_at": now_iso(), "note": "nem vette fel a gyűjtő 3 percen belül"},
                      id=rid, status="eq.queued")
            continue
        if not sb.update("robot_cmd", {"status": "running"}, id=rid, status="eq.queued"):
            continue                                # közben más felvette
        try:
            command(sb, r["pink"], r["cmd"], r.get("args"))
            sb.update("robot_cmd", {"status": "done", "done_at": now_iso()}, id=rid)
            print(f"Robot-parancs: {r['pink']} {r['cmd']} OK")
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
    while True:
        try:
            run_queue(sb)
        except SupabaseError as e:
            if not warned:
                print(f"Robot-parancsok: a sor nem olvasható ({e.code or e.status}); lefutott a 014_robot_cmd.sql?")
                warned = True
        except Exception as e:                       # noqa: BLE001
            if not warned:
                print(f"Robot-parancsok: HIBA ({type(e).__name__})")
                warned = True
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
            print(f"Teszt: {pink} {cmd} a sorban, várom az adatgyűjtőt (legfeljebb 3 perc)...")
            t0, st = time.time(), "queued"
            while time.time() - t0 < 180:
                time.sleep(5)
                rows = sb.select("robot_cmd", "status,note,created_at", pink=f"eq.{pink}", order="id.desc", limit="1")
                st = rows[0]["status"] if rows else "?"
                if st not in ("queued", "running"):
                    break
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
            print("Használat: roborock-kod | roborock | xiaomi | xiaomi-kod | status | queue | watch [mp] | cmd R1|R2 start|pause|dock|find")
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
