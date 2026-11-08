"""Eszközfelderítés: Tuya eszközlista + állapot + specifikáció, párosítás a pink számokhoz.

Kimenet:
  data/devices.json.enc  TITKOSÍTVA: teljes nyers lista (local_key és helyadat nélkül)
  data/latest.json.enc   TITKOSÍTVA: térkép-kész pillanatkép pink szám szerint
  Supabase public.devices  pink -> Tuya eszköz (+ meta: a státuszkódok skálája)

Párosítás (a Smart Life fiókban más ingatlanok eszközei is vannak):
  1. név szerint (config: match / exclude; pontos név egyezésnél az exact nyer);
  2. az F27 otthon: a nevük alapján egyértelműen párosított eszközök leggyakoribb
     otthon-azonosítója (owner_id); minden jelöltet erre az otthonra szűrünk;
  3. ha egy pink számra így is több eszköz jut: Tuya kategória, majd pontos név szerint.
     Ezek "puha" szűrők: ha mindent kiszűrnének, nem érvényesülnek.

A konzolra (publikus Actions log!) csak darabszám, párosítási eredmény és Tuya
kategóriakód megy; név, device ID, otthon-azonosító vagy mérési érték soha.

Futtatás:  python -m f27.discover
"""

from __future__ import annotations

import json
import os
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .crypto import password_from_env, write_encrypted_json
from .supa import SupabaseError, SupabaseRest
from .tuya import TuyaClient, TuyaError

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "devices.json"
DATA = ROOT / "data"

DROP_FIELDS = {"local_key", "ip", "lat", "lon", "uid", "owner_id", "uuid", "asset_id"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s or "").lower()
    return " ".join(s.replace("\u2013", "-").replace("\u2014", "-").split())


def home_of(d: dict):
    """A Tuya eszköz otthon-azonosítója (owner_id; régebbi válaszokban home_id)."""
    return d.get("owner_id") or d.get("home_id") or None


@dataclass
class MatchResult:
    mapping: dict = field(default_factory=dict)            # pink -> device
    conflicts: dict = field(default_factory=dict)          # pink -> [device, ...]
    unmatched: list = field(default_factory=list)          # F27 otthon párosítatlan eszközei
    home_filter: bool = False                              # volt-e otthon-azonosító
    other_home_count: int = 0                              # más otthonok eszközei (darab)
    only_other_home: dict = field(default_factory=dict)    # pink -> csak más otthonban talált (darab)
    category_mismatch: dict = field(default_factory=dict)  # pink -> kapott kategória (párosított, de nem várt)


def _name_hit(d: dict, config: list[dict]) -> str | None:
    name = norm(d.get("name", ""))
    for c in config:                                # pontos név az első
        if c.get("exact") and norm(c["exact"]) == name:
            return c["pink"]
    for c in config:
        if any(norm(m) in name for m in c["match"]) and not any(norm(x) in name for x in c.get("exclude", [])):
            return c["pink"]
    return None


def _soft(cands: list[dict], keep) -> list[dict]:
    kept = [d for d in cands if keep(d)]
    return kept if kept else cands


def match_devices(devices: list[dict], config: list[dict], role_categories: dict | None = None) -> MatchResult:
    role_categories = {k: v for k, v in (role_categories or {}).items() if not k.startswith("_")}
    by_pink: dict[str, list[dict]] = {c["pink"]: [] for c in config}
    unassigned = []
    for d in devices:
        p = _name_hit(d, config)
        (by_pink[p] if p else unassigned).append(d)

    res = MatchResult()

    # Az F27 otthon: a pontos névvel vagy egyértelműen párosított eszközök leggyakoribb otthona.
    votes = Counter()
    for c in config:
        cands = by_pink[c["pink"]]
        exact = [d for d in cands if c.get("exact") and norm(d.get("name", "")) == norm(c["exact"])]
        for d in (exact or (cands if len(cands) == 1 else [])):
            if home_of(d):
                votes[home_of(d)] += 1
    home = votes.most_common(1)[0][0] if votes else None
    res.home_filter = home is not None

    if home is not None:
        res.other_home_count = sum(1 for d in devices if home_of(d) and home_of(d) != home)
        for p, cands in by_pink.items():
            inside = [d for d in cands if not home_of(d) or home_of(d) == home]
            if cands and not inside:
                res.only_other_home[p] = len(cands)
            by_pink[p] = inside
        unassigned = [d for d in unassigned if not home_of(d) or home_of(d) == home]

    for c in config:
        p, cands = c["pink"], by_pink[c["pink"]]
        allowed = set(role_categories.get(c.get("role", ""), []))
        if len(cands) > 1 and allowed:
            cands = _soft(cands, lambda d: d.get("category") in allowed)
        if len(cands) > 1 and c.get("exact"):
            cands = _soft(cands, lambda d: norm(d.get("name", "")) == norm(c["exact"]))
        if len(cands) == 1:
            d = cands[0]
            res.mapping[p] = d
            if allowed and d.get("category") not in allowed:
                res.category_mismatch[p] = d.get("category") or "?"
        elif len(cands) > 1:
            res.conflicts[p] = cands   # az ütköző eszközök nem számítanak párosítatlannak
    res.unmatched = unassigned
    return res


def scales_from_spec(spec: dict) -> dict[str, dict]:
    """status kód -> {scale, unit, type} a specifikációból."""
    out = {}
    for item in (spec or {}).get("status", []) + (spec or {}).get("functions", []):
        try:
            values = json.loads(item.get("values") or "{}")
        except (TypeError, json.JSONDecodeError):
            values = {}
        if isinstance(values, dict) and "code" in item:
            out[item["code"]] = {"scale": values.get("scale", 0), "unit": values.get("unit", ""),
                                 "type": item.get("type", "")}
    return out


def clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if k not in DROP_FIELDS}


def summary_lines(config: list[dict], res: MatchResult, total: int) -> list[str]:
    lines = ["| Pink | Elvárt | Eredmény |", "|---|---|---|"]
    for c in config:
        p = c["pink"]
        if p in res.mapping:
            r = "OK"
            if p in res.category_mismatch:
                r += f" (kategória: {res.category_mismatch[p]})"
        elif p in res.conflicts:
            cats = ", ".join(sorted(d.get("category") or "?" for d in res.conflicts[p]))
            r = f"ÜTKÖZÉS ({len(res.conflicts[p])}): kategóriák: {cats}"
        elif p in res.only_other_home:
            r = f"nincs (csak más otthonban: {res.only_other_home[p]})"
        else:
            r = "nincs"
        lines.append(f"| {p} | {c['label']} | {r} |")
    lines.append("")
    lines.append(f"Párosítva: {len(res.mapping)}/{len(config)}. Eszközök a felhőben: {total}.")
    if res.home_filter:
        lines.append(f"Otthon-szűrő: aktív. Más otthonok eszközei (kihagyva): {res.other_home_count}. "
                     f"Az F27 otthon párosítatlan eszközei: {len(res.unmatched)}.")
    else:
        lines.append(f"Otthon-szűrő: nem elérhető (a Tuya válaszban nincs otthon-azonosító). "
                     f"Párosítatlan eszközök: {len(res.unmatched)}.")
    return lines


def push_devices(sb: SupabaseRest, config: list[dict], res: MatchResult, specs: dict) -> str:
    """public.devices frissítése. Visszaad: rövid, publikusan kiírható eredmény."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    for c in config:
        d = res.mapping.get(c["pink"])
        if not d:
            continue
        rows.append({"pink": c["pink"], "role": c["role"], "room": c.get("room"), "label": c["label"],
                     "tuya_device_id": d["id"], "updated_at": now,
                     "meta": scales_from_spec(specs.get(d["id"], {}))})
    try:
        sb.upsert("devices", rows, on_conflict="pink")
        return f"Supabase eszközlista: {len(rows)} eszköz frissítve (skálákkal)."
    except SupabaseError as e:
        if e.code not in ("PGRST204", "42703"):
            raise
    for r in rows:
        r.pop("meta", None)
    sb.upsert("devices", rows, on_conflict="pink")
    return (f"Supabase eszközlista: {len(rows)} eszköz frissítve, skálák NÉLKÜL "
            "(hiányzik a devices.meta oszlop: futtasd a supabase/migrations/002_device_meta.sql-t).")


def main() -> int:
    password = password_from_env()
    client = TuyaClient.from_env()
    uid = os.environ.get("TUYA_UID", "").strip() or None

    try:
        devices = client.list_devices(uid)
    except TuyaError as e:
        print(f"::error::Tuya eszközlista hiba: code={e.code} msg={e.msg}")
        print("Tipp: ellenőrizd az adatközpontot (TUYA_ENDPOINT), az API szolgáltatások "
              "engedélyezését és a Smart Life fiók összekötését (docs/tuya-setup.md).")
        return 1

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    config = cfg["devices"]
    res = match_devices(devices, config, cfg.get("role_categories"))

    # Specifikáció csak a párosított eszközökhöz (kevesebb API-hívás).
    specs: dict[str, dict] = {}
    spec_errors = 0
    for d in res.mapping.values():
        try:
            specs[d["id"]] = client.specification(d["id"])
        except TuyaError:
            spec_errors += 1

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    full = {
        "generated_at": now,
        "devices": [dict(clean(d), specification=specs.get(d["id"])) for d in devices],
        "mapping": {p: d["id"] for p, d in res.mapping.items()},
        "unmatched": [{"id": d["id"], "name": d.get("name"), "category": d.get("category")} for d in res.unmatched],
        "conflicts": {p: [{"id": d["id"], "name": d.get("name"), "category": d.get("category")} for d in lst]
                      for p, lst in res.conflicts.items()},
    }
    latest = {"generated_at": now, "source": "discover", "devices": {}}
    for p, d in res.mapping.items():
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

    lines = summary_lines(config, res, len(devices))
    if spec_errors:
        lines.append(f"Specifikáció nem érhető el {spec_errors} párosított eszköznél (IR eszközöknél ez normális).")

    sb = SupabaseRest.from_env()
    rc = 0
    if sb is None:
        lines.append("Supabase: kihagyva (nincs SUPABASE_URL vagy SUPABASE_SECRET_KEY beállítva).")
        print("::notice::Supabase kihagyva: hiányzik a SUPABASE_URL (Variables) vagy a SUPABASE_SECRET_KEY (Secrets).")
    else:
        try:
            lines.append(push_devices(sb, config, res, specs))
        except SupabaseError as e:
            lines.append(f"Supabase eszközlista: HIBA ({e}).")
            print(f"::error::{e}")
            rc = 1

    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Eszközfelderítés\n\n" + report + "\n")
    return rc


if __name__ == "__main__":
    sys.exit(main())
