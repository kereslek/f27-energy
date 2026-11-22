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
LIVE_EVERY_S = 60                  # takarítás közben ilyen gyakran frissül a robot helye és útvonala (018_robot_live.sql)
LIVE_CHECK_S = 30                  # ilyen gyakran nézzük meg az állapotból, takarít-e valamelyik robot
MAX_PATH = 400                     # az útvonal legfeljebb ennyi pont
LIVE_COLS = ("path", "pos_at", "bbox")
MAX_SIDE = 900                     # a PNG hosszabb oldala legfeljebb ennyi képpont (méret és adatforgalom miatt)


class MapError(Exception):
    """Lépésenkénti hiba (a log publikus: csak a lépés neve és a hiba fajtája)."""


# ---- közös: MapData -> a térkép JSON-ja ---------------------------------------------------------------
def _bbox(img) -> list[int] | None:
    """A kép nem üres részének befoglalója [x0, y0, x1, y1] képpontban: az átlátszatlan képpontok, ha a háttér
    átlátszó; ha a kép végig átlátszatlan, a sarok színétől eltérők."""
    try:
        from PIL import Image, ImageChops
        rgba = img.convert("RGBA")
        b = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        if b is None or b == (0, 0, rgba.size[0], rgba.size[1]):
            rgb = rgba.convert("RGB")
            d = ImageChops.difference(rgb, Image.new("RGB", rgb.size, rgb.getpixel((0, 0)))).convert("L")
            b = d.point(lambda v: 255 if v > 12 else 0).getbbox() or b
        return [int(v) for v in b] if b else None
    except Exception:                                   # noqa: BLE001
        return None


def downsample(pts: list, n: int = MAX_PATH) -> list:
    """Egyenletesen ritkít legfeljebb n pontra; az első és az utolsó pont megmarad."""
    if len(pts) <= n:
        return pts
    step = (len(pts) - 1) / (n - 1)
    return [pts[round(i * step)] for i in range(n)]


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


def _path(md, k: float) -> list[list[float]]:
    """A takarítás útvonala (python-roborock: MapData.path.path, Dreame-elemző: MapData.path) képpontban."""
    pa = getattr(md, "path", None) if md is not None else None
    subs = getattr(pa, "path", None) or []
    out: list[list[float]] = []
    for sub in subs:
        for p in sub:
            q = _pt(md, p, k)
            if q is not None and (not out or out[-1] != q):
                out.append(q)
    return downsample(out)


def from_map_data(md, img=None, png_bytes: bytes | None = None, src: str = "") -> dict:
    """A gyártói MapData-ból a robot_map sor. img: PIL kép; png_bytes: kész PNG (Roborock)."""
    if img is None and png_bytes:
        from PIL import Image
        img = Image.open(io.BytesIO(png_bytes))
    if img is None and md is not None and md.image is not None:
        img = md.image.data
    if img is None:
        raise MapError("nincs kép a térképben")
    img = img.convert("RGBA") if img.mode not in ("RGB", "RGBA") else img
    b64, w, h, k = _png(img)
    bb = _bbox(img)
    if bb and k < 1.0:
        bb = [round(v * k) for v in bb]
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
            "charger": _pt(md, getattr(md, "charger", None), k) if md is not None else None, "src": src,
            "path": _path(md, k) if md is not None else [], "bbox": bb}


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


_live_cols_ok = True        # a 018_robot_live.sql lefutott-e (az első PGRST204 után kikapcsol, a térkép így sem sérül)


def _put_map(sb, row: dict) -> None:
    """Teljes sor írása; ha a 018 oszlopai még hiányoznak, nélkülük (a óránkénti térkép nem állhat le miatta)."""
    global _live_cols_ok
    from .supa import SupabaseError
    if _live_cols_ok:
        try:
            sb.upsert("robot_map", [row], on_conflict="pink")
            return
        except SupabaseError as e:
            if e.code not in ("PGRST204", "42703"):
                raise
            _live_cols_ok = False
    sb.upsert("robot_map", [{k: v for k, v in row.items() if k not in LIVE_COLS}], on_conflict="pink")


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
            now = _now_iso()
            row.update({"pink": pink, "updated_at": now, "pos_at": now})
            _put_map(sb, row)
            out[pink] = f"OK, {len(row['rooms'])} szoba, {row['w']}x{row['h']} px, útvonal: {len(row.get('path') or [])} pont"
        except MapError as e:
            out[pink] = f"HIBA: {e}"
        except Exception as e:                          # noqa: BLE001 (a log publikus: csak a hiba fajtája)
            out[pink] = f"HIBA ({type(e).__name__})"
    return out


# ---- élő követés takarítás közben (a `watch` hívja) ------------------------------------------------------
LIVE_STATES = {"cleaning", "mopping", "returning", "building_map", "remote"}      # mint robots.CLEANING
_FETCH = {"R2": ("roborock", lambda a: asyncio.run(rr_map(a))), "R1": ("xiaomi", mi_map)}


def live_patch(row: dict, stored: dict | None) -> tuple[dict, bool]:
    """Az élő sorból az írandó rész: ha a kép mérete a tároltéval egyezik, csak a hely és az útvonal (a PNG nem megy
    újra, percenként nagy volna), különben a teljes sor. Visszaad: (sor, teljes-e)."""
    now = _now_iso()
    if stored and stored.get("w") == row.get("w") and stored.get("h") == row.get("h"):
        return {"robot": row.get("robot"), "charger": row.get("charger"), "path": row.get("path") or [],
                "bbox": row.get("bbox"), "pos_at": now}, False
    return dict(row, updated_at=now, pos_at=now), True


class LiveTracker:
    """Takarítás közben a robot térképét percenként frissíti (nem óránként). Minden hiba nem végzetes; a log
    csak darabszám: robotonként egy sor, amikor a követés véget ér."""

    def __init__(self, fetch=None, clock=time.monotonic):
        self.fetch, self.clock = fetch or _fetch_live, clock
        self.last: dict[str, float] = {}
        self.chk = -1e9
        self.active: set[str] = set()
        self.n: dict[str, list[int]] = {}               # pink -> [sikeres, hibás]

    def cleaning(self, sb) -> set[str]:
        """Az utolsó ismert állapot szerint melyik robot takarít (30 mp-ig gyorsítótárból)."""
        now = self.clock()
        if now - self.chk < LIVE_CHECK_S:
            return self.active
        self.chk = now
        rows = sb.select("device_status", "pink,status,ts", pink="in.(R1,R2)", order="ts.desc", limit="6")
        seen, act = set(), set()
        for r in rows:
            if r["pink"] in seen:
                continue
            seen.add(r["pink"])
            if (r.get("status") or {}).get("state") in LIVE_STATES and _age_s(r.get("ts")) < 3 * 3600:
                act.add(r["pink"])
        for p in self.active - act:                       # véget ért: egyetlen összegző sor
            ok, bad = self.n.pop(p, [0, 0])
            print(f"Élő követés {p}: vége, {ok} frissítés, {bad} hiba")
        self.active = act
        return act

    def invalidate(self) -> None:
        self.chk = -1e9

    def tick(self, sb) -> dict[str, str]:
        """Egy kör: a takarító robotok közül azok térképe, amelyiknek lejárt a 60 mp-e."""
        from .robots import auth_get
        out: dict[str, str] = {}
        for pink in sorted(self.cleaning(sb)):
            now = self.clock()
            if now - self.last.get(pink, -1e9) < LIVE_EVERY_S:
                continue
            self.last[pink] = now
            cnt = self.n.setdefault(pink, [0, 0])
            try:
                out[pink] = "OK" if self._one(sb, pink, auth_get) else "nincs belépés"
                if out[pink] == "OK":
                    cnt[0] += 1
            except Exception as e:                        # noqa: BLE001 (a log publikus: csak a hiba fajtája)
                cnt[1] += 1
                out[pink] = f"HIBA ({type(e).__name__})"
        return out

    def _one(self, sb, pink: str, auth_get) -> bool:
        global _live_cols_ok
        from .supa import SupabaseError
        src, _ = _FETCH[pink]
        auth = auth_get(sb, src)
        if not auth or (src == "xiaomi" and not auth.get("service_token")):
            return False
        row = self.fetch(pink, auth)
        row["pink"] = pink
        stored = (sb.select("robot_map", "pink,w,h", pink=f"eq.{pink}") or [None])[0]
        patch, full = live_patch(row, stored)
        if full:
            _put_map(sb, patch)
            return True
        if not _live_cols_ok:
            return True                                   # a 018 nincs telepítve: nincs hová írni
        try:
            sb.update("robot_map", patch, pink=f"eq.{pink}")
        except SupabaseError as e:
            if e.code not in ("PGRST204", "42703"):
                raise
            _live_cols_ok = False
        return True


def _fetch_live(pink: str, auth: dict) -> dict:
    return _FETCH[pink][1](auth)
