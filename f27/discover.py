"""Eszközfelderítés: Tuya eszközlista + állapot + specifikáció, párosítás a pink számokhoz.

Kimenet (mindkettő TITKOSÍTVA, a publikus repóba commitolható):
  data/devices.json.enc  teljes nyers lista (local_key és helyadat nélkül)
  data/latest.json.enc   térkép-kész pillanatkép pink szám szerint

A konzolra (publikus Actions log!) csak darabszám és párosítási eredmény megy,
mérési érték, device ID vagy nyitásállapot soha.

Futtatás:  python -m f27.discover
"""

from __future__ import annotations

import json
import os
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from .crypto import password_from_env, write_encrypted_json
from .tuya import TuyaClient, TuyaError

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "devices.json"
DATA = ROOT / "data"

DROP_FIELDS = {"local_key", "ip", "lat", "lon", "uid", "owner_id", "uuid", "asset_id"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s or "").lower()
    return " ".join(s.replace("\u2013", "-").replace("\u2014", "-").split())


def match_devices(devices: list[dict], config: list[dict]) -> tuple[dict, list[dict], dict]:
    """Visszaad: {pink: device}, párosítatlan eszközök, {pink: [ütköző nevek]}."""
    by_pink: dict[str, list[dict]] = {c["pink"]: [] for c in config}
    unmatched = []
    for d in devices:
        name = norm(d.get("name", ""))
        hit = None
        for c in config:
            if any(norm(m) in name for m in c["match"]) and not any(norm(x) in name for x in c.get("exclude", [])):
                hit = c["pink"]
                break
        if hit:
            by_pink[hit].append(d)
        else:
            unmatched.append(d)
    mapping = {p: lst[0] for p, lst in by_pink.items() if len(lst) == 1}
    conflicts = {p: [x.get("name") for x in lst] for p, lst in by_pink.items() if len(lst) > 1}
    return mapping, unmatched, conflicts


def scales_from_spec(spec: dict) -> dict[str, dict]:
    """status kód -> {scale, unit} a specifikációból."""
    out = {}
    for item in (spec or {}).get("status", []) + (spec or {}).get("functions", []):
        try:
            values = json.loads(item.get("values") or "{}")
        except (TypeError, json.JSONDecodeError):
            values = {}
        if isinstance(values, dict):
            out[item["code"]] = {"scale": values.get("scale", 0), "unit": values.get("unit", ""),
                                 "type": item.get("type", "")}
    return out


def clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if k not in DROP_FIELDS}


def main() -> int:
    password = password_from_env()
    client = TuyaClient.from_env()
    uid = os.environ.get("TUYA_UID", "").strip() or None

    try:
        devices = client.list_devices(uid)
    except TuyaError as e:
        print(f"::error::{e}")
        print("Tipp: ellenőrizd az adatközpontot (TUYA_ENDPOINT), az API szolgáltatások "
              "engedélyezését és a Smart Life fiók összekötését (docs/tuya-setup.md).")
        return 1

    print(f"Eszközök száma a felhőben: {len(devices)}")

    specs: dict[str, dict] = {}
    spec_errors = 0
    for d in devices:
        try:
            specs[d["id"]] = client.specification(d["id"])
        except TuyaError:
            spec_errors += 1
    if spec_errors:
        print(f"Specifikáció nem érhető el {spec_errors} eszköznél (IR eszközöknél ez normális).")

    config = json.loads(CONFIG.read_text(encoding="utf-8"))["devices"]
    mapping, unmatched, conflicts = match_devices(devices, config)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    full = {
        "generated_at": now,
        "devices": [dict(clean(d), specification=specs.get(d["id"])) for d in devices],
        "mapping": {p: d["id"] for p, d in mapping.items()},
        "unmatched": [{"id": d["id"], "name": d.get("name"), "category": d.get("category")} for d in unmatched],
        "conflicts": conflicts,
    }
    latest = {"generated_at": now, "source": "discover", "devices": {}}
    for p, d in mapping.items():
        latest["devices"][p] = {
            "name": d.get("name"),
            "category": d.get("category"),
            "online": d.get("online"),
            "status": {s["code"]: s.get("value") for s in d.get("status", []) if "code" in s},
            "meta": scales_from_spec(specs.get(d["id"], {})),
            "update_time": d.get("update_time"),
        }

    write_encrypted_json(DATA / "devices.json.enc", full, password)
    write_encrypted_json(DATA / "latest.json.enc", latest, password)

    # Publikus log: csak párosítási eredmény, érték nélkül.
    lines = ["| Pink | Elvárt | Eredmény |", "|---|---|---|"]
    for c in config:
        p = c["pink"]
        if p in mapping:
            res = "OK"
        elif p in conflicts:
            res = f"ÜTKÖZÉS ({len(conflicts[p])} találat)"
        else:
            res = "nincs találat"
        lines.append(f"| {p} | {c['label']} | {res} |")
    lines.append("")
    lines.append(f"Párosítva: {len(mapping)}/{len(config)}, párosítatlan felhős eszköz: {len(unmatched)}")
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Eszközfelderítés\n\n" + report + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
