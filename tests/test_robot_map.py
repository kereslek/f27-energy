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
             "tr": "M100,100L200,200L300,250"}
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
