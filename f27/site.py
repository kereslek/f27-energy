"""A telephely (lakás) beállításai: minden, ami lakásonként más (név, rövid jel, időzóna,
kerületi hely az időjáráshoz, térkép URL, tarifák, mért körök, hőmérők).

Alapból a config/site.json (F27). Másik telephelyhez az F27_SITE_CONFIG környezeti változó
mutat a saját site.json-ra; a kód többi része innen olvas, így ugyanaz a motor több lakást
is kiszolgálhat.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = ROOT / "config" / "site.json"


@dataclass(frozen=True)
class Site:
    id: str
    tag: str
    brand: str
    since: int
    name: str
    smartlife_home: str
    tz: ZoneInfo
    lat: float
    lon: float
    map_url: str
    quota_kwh_year: float
    advisor: dict = field(default_factory=dict)
    devices_config: Path = ROOT / "config" / "devices.json"
    data_dir: Path = ROOT / "data"
    comfort: dict = field(default_factory=dict)
    meters: dict = field(default_factory=dict)
    circuits: tuple = ()
    thermometers: tuple = ()

    def price(self, meter: str, over: bool = True) -> float:
        """Bruttó Ft/kWh a mérő tarifájából (alapból a keret feletti, a drágább)."""
        m = self.meters.get(meter) or {}
        return float(m.get("over_quota" if over else "in_quota") or 0)

    def circuit(self, pink: str) -> dict | None:
        return next((c for c in self.circuits if c["pink"] == pink), None)


def load(path: str | os.PathLike | None = None) -> Site:
    p = Path(path or os.environ.get("F27_SITE_CONFIG") or DEFAULT)
    j = json.loads(p.read_text(encoding="utf-8"))
    loc = j.get("location") or {}
    tar = j.get("tariff") or {}
    return Site(
        id=j["id"], tag=j["tag"], brand=j.get("brand") or f"{j['tag']} ENERGY",
        since=int(j.get("since") or 2024), name=j.get("name") or j["tag"],
        smartlife_home=j.get("smartlife_home") or "",
        tz=ZoneInfo(j.get("timezone") or "Europe/Budapest"),
        lat=float(loc.get("lat", 47.5)), lon=float(loc.get("lon", 19.05)),
        map_url=j.get("map_url") or "",
        devices_config=ROOT / (j.get("devices_config") or "config/devices.json"),
        data_dir=ROOT / (j.get("data_dir") or "data"),
        comfort=j.get("comfort") or {},
        advisor={"name": "Energiaőr", "figure": "green_chair", **(j.get("advisor") or {})},
        quota_kwh_year=float(tar.get("quota_kwh_year") or 2523),
        meters=tar.get("meters") or {},
        circuits=tuple(c for c in j.get("circuits") or [] if isinstance(c, dict)),
        thermometers=tuple(t for t in j.get("thermometers") or [] if isinstance(t, dict)),
    )


SITE = load()
