"""A robotporszívók saját térképe (O2B: R1 Dreame lent, R2 Roborock fent) a Supabase robot_map táblájába.

- R2 (Roborock): a python-roborock map_content jellemzője (a robot küldi, a könyvtár kirajzolja PNG-be).
- R1 (Dreame): a Xiaomi felhőből. A térkép objektumneve a robot 6.3-as tulajdonsága (ha a pillanatnyi érték
  nem jön, a felhő tulajdonság-előzményéből); az objektum a /v2/home/get_interim_file_url címről tölthető le,
  és a vacuum-map-parser-dreame bontja ki és rajzolja meg (a Xiaomi Cloud Map Extractor módszere).

Kimenet robotonként: PNG (base64), a kép mérete, a szobák neve és közepe képpontban, a robot és a dokk helye.
A térkép a lakás alaprajza: csak a Supabase-be megy (RLS: tulaj és családtag), a publikus logba csak
lépés-eredmény és darabszám. Óránként egyszer fut (a 10 perces körből hívva, MAP_EVERY_S).
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import time
import urllib.request
from datetime import datetime, timezone

MAP_EVERY_S = 55 * 60
MAX_SIDE = 900                     # a PNG hosszabb oldala legfeljebb ennyi képpont (méret és adatforgalom miatt)


class MapError(Exception):
    """Lépésenkénti hiba (a log publikus: csak a lépés neve és a hiba fajtája)."""


# ---- közös: MapData -> a térkép JSON-ja ---------------------------------------------------------------
def _png(img) -> tuple[str, int, int, float]:
    """PIL kép -> (base64 PNG, szélesség, magasság, kicsinyítés aránya)."""
    w, h = img.size
    k = min(1.0, MAX_SIDE / max(w, h)) if max(w, h) else 1.0
    if k < 1.0:
        img = img.resize((max(1, round(w * k)), max(1, round(h * k))))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode(), img.size[0], img.size[1], k


def _pt(md, p, k: float) -> list[float] | None:
    if p is None or md.image is None:
        return None
    q = md.image.dimensions.to_img(p)
    return [round(q.x * k, 1), round(q.y * k, 1)]


def from_map_data(md, img=None, png_bytes: bytes | None = None, src: str = "") -> dict:
    """A gyártói MapData-ból a robot_map sor. img: PIL kép; png_bytes: kész PNG (Roborock)."""
    if img is None and png_bytes:
        from PIL import Image
        img = Image.open(io.BytesIO(png_bytes))
    if img is None and md is not None and md.image is not None:
        img = md.image.data
    if img is None:
        raise MapError("nincs kép a térképben")
    b64, w, h, k = _png(img.convert("RGBA") if img.mode not in ("RGB", "RGBA") else img)
    rooms = []
    for rid, r in sorted(((md.rooms or {}) if md is not None else {}).items()):
        c = None
        try:
            from vacuum_map_parser_base.map_data import Point
            c = _pt(md, Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2), k)
        except Exception:                               # noqa: BLE001
            c = None
        rooms.append({"id": int(rid), "name": (getattr(r, "name", None) or "")[:40], "c": c})
    return {"png": b64, "w": w, "h": h, "rooms": rooms[:40],
            "robot": _pt(md, getattr(md, "vacuum_position", None), k) if md is not None else None,
            "charger": _pt(md, getattr(md, "charger", None), k) if md is not None else None, "src": src}


# ---- R2: Roborock -------------------------------------------------------------------------------------
async def rr_map(auth: dict) -> dict:
    from .robots import _rr_devices
    dm, devs = await _rr_devices(auth)
    try:
        if not devs:
            raise MapError("nincs Roborock robot")
        mc = devs[0].v1_properties.map_content
        await mc.refresh()
        if not mc.image_content:
            raise MapError("a Roborock nem küldött térképet")
        return from_map_data(mc.map_data, png_bytes=mc.image_content, src="roborock")
    finally:
        await dm.close()


# ---- R1: Dreame a Xiaomi felhőből ---------------------------------------------------------------------
def _obj_name(auth: dict, country: str, did: str) -> tuple[str, str | None]:
    """A térkép objektumneve és (újabb modelleknél) a titkosítási kulcs."""
    from . import xiaomi_cloud as xc
    val = None
    try:
        res = xc.get_props(auth, country, [{"did": did, "siid": 6, "piid": 3}])
        if res and res[0].get("code") == 0:
            val = res[0].get("value")
    except Exception:                                   # noqa: BLE001
        val = None
    if not val:
        now = int(time.time())
        r = xc.request(auth, country, "/user/get_user_device_data",
                       {"uid": str(auth["user_id"]), "did": str(did), "time_end": now, "time_start": now - 30 * 86400,
                        "limit": 1, "key": "6.3", "type": "prop"})
        rows = r.get("result") or []
        val = rows[0].get("value") if rows else None
    if not val:
        raise MapError("nincs térkép-objektumnév (6.3)")
    key = None
    if isinstance(val, str) and val.strip().startswith("["):
        arr = json.loads(val)
        val, key = arr[0], (arr[1] if len(arr) > 1 and arr[1] else None)
    elif isinstance(val, list):
        val, key = val[0], (val[1] if len(val) > 1 and val[1] else None)
    return str(val), key


def _download(auth: dict, country: str, obj: str) -> bytes:
    from . import xiaomi_cloud as xc
    url = None
    for name in (obj, f"{auth['user_id']}/{obj}"):
        try:
            r = xc.request(auth, country, "/v2/home/get_interim_file_url", {"obj_name": name})
            url = ((r.get("result") or {}).get("url"))
        except Exception:                               # noqa: BLE001
            url = None
        if url:
            break
    if not url:
        raise MapError("nincs letöltési cím a térképhez")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as f:
        return f.read()


def dreame_parser(model: str):
    from vacuum_map_parser_base.config.color import ColorsPalette
    from vacuum_map_parser_base.config.drawable import Drawable
    from vacuum_map_parser_base.config.image_config import ImageConfig
    from vacuum_map_parser_base.config.size import Sizes
    from vacuum_map_parser_dreame.map_data_parser import DreameMapDataParser
    # az útvonal, a tiltott zónák és a virtuális falak a képre; a robotot és a dokkot a térkép rajzolja (mozgatható)
    return DreameMapDataParser(ColorsPalette(), Sizes(), [Drawable.PATH, Drawable.NO_GO_AREAS, Drawable.VIRTUAL_WALLS],
                               ImageConfig(scale=2), [], model)


def mi_map(auth: dict) -> dict:
    from .robots import XIAOMI_COUNTRY, mi_vacuums
    vs = mi_vacuums(auth)
    if not vs:
        raise MapError("nincs Dreame robot")
    did, model = vs[0]["did"], str(vs[0].get("model") or "")
    obj, key = _obj_name(auth, XIAOMI_COUNTRY, did)
    raw = _download(auth, XIAOMI_COUNTRY, obj)
    parser = dreame_parser(model)
    try:
        unpacked = parser.unpack_map(raw.strip(), enckey=key)
    except Exception as e:                              # noqa: BLE001
        raise MapError(f"a térkép nem bontható ki ({type(e).__name__})") from None
    md = parser.parse(unpacked)
    return from_map_data(md, src="xiaomi")


# ---- futtatás -----------------------------------------------------------------------------------------
def _age_s(ts: str | None) -> float:
    if not ts:
        return 1e9
    return (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds()


def collect_maps(sb, force: bool = False) -> dict:
    """Óránként egyszer mindkét robot térképe. Visszaad: {pink: 'OK, N szoba' | 'HIBA ...' | 'friss'}."""
    from .robots import auth_get
    from .supa import SupabaseError
    out = {}
    try:
        have = {r["pink"]: r.get("updated_at") for r in sb.select("robot_map", "pink,updated_at")}
    except SupabaseError as e:
        return {"*": f"nincs robot_map tábla ({e.code}), futtasd a 016_robot_map.sql-t"}
    jobs = (("R2", "roborock", lambda a: asyncio.run(rr_map(a))), ("R1", "xiaomi", mi_map))
    for pink, src, fn in jobs:
        if not force and _age_s(have.get(pink)) < MAP_EVERY_S:
            out[pink] = "friss"
            continue
        auth = auth_get(sb, src)
        if not auth or (src == "xiaomi" and not auth.get("service_token")):
            out[pink] = "nincs belépés"
            continue
        try:
            row = fn(auth)
            row.update({"pink": pink, "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            sb.upsert("robot_map", [row], on_conflict="pink")
            out[pink] = f"OK, {len(row['rooms'])} szoba, {row['w']}x{row['h']} px"
        except MapError as e:
            out[pink] = f"HIBA: {e}"
        except Exception as e:                          # noqa: BLE001 (a log publikus: csak a hiba fajtája)
            out[pink] = f"HIBA ({type(e).__name__})"
    return out
