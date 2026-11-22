"""Robot-térkép (f27/robot_map.py) offline: szintetikus Dreame-térkép kibontása és rajzolása, a felhőt nem hívjuk."""
import base64
import json
import struct
import zlib

import pytest

from f27 import robot_map

pytest.importorskip("vacuum_map_parser_dreame")


def fake_dreame(w=40, h=30):
    """Fejléc (27 bájt) + képpontok (1 bájt/pont: a szoba száma) + JSON (szobanevek base64-ben)."""
    hdr = struct.pack("<hhB", 1, 0, 73)                 # térképszám, keret, 'I' keret
    hdr += struct.pack("<hhh", 500, 400, 0) + struct.pack("<hhh", 100, 100, 0)   # robot, dokk (mm)
    hdr += struct.pack("<hhhhh", 50, w, h, 0, 0)        # képpont mérete (mm), szélesség, magasság, bal, felső
    px = bytearray()
    for y in range(h):
        for x in range(w):
            px.append((1 if x < w // 2 else 2) << 2)   # a szoba száma a felső 6 biten
    extra = {"seg_inf": {"1": {"name": base64.b64encode("Nappali".encode()).decode()},
                         "2": {"name": base64.b64encode("Étkező".encode()).decode()}},
             "tr": "S100,100L100,100L50,50"}
    raw = bytes(hdr) + bytes(px) + json.dumps(extra).encode()
    return base64.b64encode(zlib.compress(raw)).replace(b"/", b"_").replace(b"+", b"-")


def test_dreame_synthetic_map_to_row():
    parser = robot_map.dreame_parser("dreame.vacuum.p2028")
    md = parser.parse(parser.unpack_map(fake_dreame()))
    row = robot_map.from_map_data(md, src="xiaomi")
    assert row["w"] > 0 and row["h"] > 0 and len(row["png"]) > 100
    names = sorted(r["name"] for r in row["rooms"])
    assert names == ["Nappali", "Étkező"]
    assert all(r["c"] and 0 <= r["c"][0] <= row["w"] for r in row["rooms"])
    assert row["robot"] is not None and row["charger"] is not None


def test_obj_name_with_key(monkeypatch):
    from f27 import xiaomi_cloud
    monkeypatch.setattr(xiaomi_cloud, "get_props", lambda a, c, p: [{"code": 0, "value": '["ab/cd/map1", "k3y"]'}])
    assert robot_map._obj_name({"user_id": "1"}, "de", "9") == ("ab/cd/map1", "k3y")


def test_obj_name_from_history(monkeypatch):
    from f27 import xiaomi_cloud
    monkeypatch.setattr(xiaomi_cloud, "get_props", lambda a, c, p: [{"code": -704, "value": None}])
    monkeypatch.setattr(xiaomi_cloud, "request", lambda a, c, path, d: {"result": [{"value": "plain/obj"}]})
    assert robot_map._obj_name({"user_id": "1"}, "de", "9") == ("plain/obj", None)


def test_collect_skips_fresh_and_reports_missing_table():
    from f27.supa import SupabaseError

    class Sb:
        def select(self, *a, **k):
            raise SupabaseError(404, "PGRST205")
    assert "016" in robot_map.collect_maps(Sb())["*"]


# ---- élő követés (018_robot_live.sql) --------------------------------------------------------------------
def test_dreame_path_and_bbox_in_row():
    parser = robot_map.dreame_parser("dreame.vacuum.p2028")
    md = parser.parse(parser.unpack_map(fake_dreame()))
    row = robot_map.from_map_data(md, src="xiaomi")
    assert len(row["path"]) >= 2 and all(len(p) == 2 for p in row["path"])
    assert row["bbox"] and len(row["bbox"]) == 4 and 0 <= row["bbox"][0] < row["bbox"][2] <= row["w"]


def test_roborock_style_path_extraction_synthetic():
    """python-roborock: MapData.path.path = pontlisták listája; a pontok a térkép-koordinátákból képpontba kerülnek."""
    from PIL import Image
    from vacuum_map_parser_base.map_data import Point
    parser = robot_map.dreame_parser("dreame.vacuum.p2028")
    md = parser.parse(parser.unpack_map(fake_dreame()))
    md.path.path = [[Point(100 + i, 100 + i) for i in range(1000)], [Point(500, 400)]]
    row = robot_map.from_map_data(md, src="roborock")
    assert len(row["path"]) == robot_map.MAX_PATH
    assert row["path"][0] == robot_map._pt(md, Point(100, 100), 1.0) and row["path"][-1] == robot_map._pt(md, Point(500, 400), 1.0)


def test_downsample_keeps_ends_and_limit():
    pts = [[i, i] for i in range(2500)]
    d = robot_map.downsample(pts)
    assert len(d) == robot_map.MAX_PATH and d[0] == [0, 0] and d[-1] == [2499, 2499]
    assert robot_map.downsample(pts[:10]) == pts[:10]


def test_bbox_transparent_and_opaque_background():
    from PIL import Image
    a = Image.new("RGBA", (100, 80), (0, 0, 0, 0))
    a.paste((10, 200, 10, 255), (20, 10, 70, 60))
    assert robot_map._bbox(a) == [20, 10, 70, 60]
    b = Image.new("RGB", (100, 80), (240, 240, 240))
    b.paste((10, 10, 10), (30, 20, 90, 70))
    assert robot_map._bbox(b) == [30, 20, 90, 70]


def test_live_patch_skips_png_when_size_same():
    row = {"png": "AAAA", "w": 10, "h": 8, "robot": [1, 2], "charger": [3, 4], "path": [[1, 2]], "bbox": [0, 0, 9, 7], "rooms": []}
    patch, full = robot_map.live_patch(row, {"w": 10, "h": 8})
    assert not full and "png" not in patch and patch["robot"] == [1, 2] and patch["pos_at"]
    patch, full = robot_map.live_patch(row, {"w": 11, "h": 8})
    assert full and patch["png"] == "AAAA"
    patch, full = robot_map.live_patch(row, None)
    assert full


class _Clock:
    t = 1000.0

    def __call__(self):
        return self.t


class _LiveSb:
    def __init__(self, state="cleaning", stored=True):
        self.state, self.stored, self.updates, self.upserts = state, stored, [], []

    def select(self, table, columns="*", **f):
        if table == "device_status":
            return [{"pink": "R2", "status": {"state": self.state}, "ts": robot_map._now_iso()},
                    {"pink": "R1", "status": {"state": "charged"}, "ts": robot_map._now_iso()}]
        if table == "robot_map":
            return [{"pink": "R2", "w": 10, "h": 8}] if self.stored else []
        if table == "robot_auth":
            return [{"data": {"service_token": "t", "user_id": "1"}}]
        return []

    def update(self, table, patch, **f):
        self.updates.append((table, patch, f))
        return [patch]

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows))


def test_live_tracker_60s_cadence_and_only_cleaning(monkeypatch, capsys):
    calls = []
    row = {"png": "AAAA", "w": 10, "h": 8, "robot": [5, 5], "charger": [1, 1], "path": [[1, 1], [5, 5]], "bbox": [0, 0, 9, 7], "rooms": []}
    clock = _Clock()
    sb = _LiveSb()
    tr = robot_map.LiveTracker(fetch=lambda p, a: calls.append(p) or dict(row), clock=clock)
    assert tr.tick(sb) == {"R2": "OK"}                       # csak a takarító robot (R1 töltődik)
    clock.t += 20
    assert tr.tick(sb) == {}                                 # 60 mp-nél hamarabb nem
    clock.t += 45
    assert tr.tick(sb) == {"R2": "OK"}
    assert calls == ["R2", "R2"] and len(sb.updates) == 2 and not sb.upserts
    assert sb.updates[0][1]["path"] == [[1, 1], [5, 5]] and "png" not in sb.updates[0][1]
    sb.state = "charged"                                     # véget ért: egy összegző sor, darabszámmal
    clock.t += 40
    assert tr.tick(sb) == {}
    out = capsys.readouterr().out
    assert "vége, 2 frissítés, 0 hiba" in out and "[" not in out


def test_live_tracker_errors_are_nonfatal_and_counted(capsys):
    def boom(p, a):
        raise ValueError("x")
    clock = _Clock()
    tr = robot_map.LiveTracker(fetch=boom, clock=clock)
    sb = _LiveSb()
    assert tr.tick(sb)["R2"].startswith("HIBA")
    sb.state = "idle"
    clock.t += 40
    tr.tick(sb)
    assert "0 frissítés, 1 hiba" in capsys.readouterr().out


def test_missing_live_columns_do_not_break_hourly_map(monkeypatch):
    from f27.supa import SupabaseError
    monkeypatch.setattr(robot_map, "_live_cols_ok", True)
    seen = []

    class Sb:
        def upsert(self, table, rows, on_conflict):
            seen.append(sorted(rows[0]))
            if "path" in rows[0]:
                raise SupabaseError(400, "PGRST204")
    robot_map._put_map(Sb(), {"pink": "R2", "png": "A", "path": [], "pos_at": "x", "bbox": None})
    assert seen[1] == ["png", "pink"] or seen[1] == ["pink", "png"]
    monkeypatch.setattr(robot_map, "_live_cols_ok", True)
