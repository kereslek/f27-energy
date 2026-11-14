"""Privát fájlok (pl. számla-PDF-ek) titkosított átadása a laptopról a felhős munkamenetnek.

A repó publikus, ezért a fájlok csak titkosítva kerülhetnek bele (AES-256-GCM, F27_DATA_PASSWORD,
ugyanaz, mint a data/*.enc fájloknál). A jelszót a program a környezeti változóból veszi,
vagy ha az nincs, rejtetten bekéri a terminálban; a chatbe soha ne írd be.

Csomagolás (laptopon):
    python tools/pack_private.py pack "C:\\Users\\csaba\\OneDrive\\Downloads\\mvm-villany" data/inbox/mvm.enc
Kicsomagolás (felhős munkamenet, a scratchpadbe, nem a repóba):
    python tools/pack_private.py unpack data/inbox/mvm.enc /tmp/.../scratchpad/inbox

Csak a megadott mappa fájljait (almappákkal együtt) veszi fel; rejtett fájlt és 25 MB fölötti
fájlt kihagy. A titkosított fájl a fájlneveket is elrejti.
"""

from __future__ import annotations

import base64
import getpass
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from f27.crypto import MIN_PASSWORD_LEN, decrypt_bytes, encrypt_bytes  # noqa: E402

MAX_FILE = 25 * 1024 * 1024


def _password() -> str:
    pw = os.environ.get("F27_DATA_PASSWORD", "").strip("\r\n")
    if pw:
        print(f"Jelszó a környezeti változóból: {len(pw)} karakter.")
    else:
        pw = getpass.getpass("F27_DATA_PASSWORD (nem jelenik meg): ").strip("\r\n")
        print(f"Beolvasva: {len(pw)} karakter.")
    if len(pw) < MIN_PASSWORD_LEN:
        sys.exit(f"A jelszó túl rövid (min. {MIN_PASSWORD_LEN} karakter).")
    return pw


REF = Path(__file__).resolve().parent.parent / "data" / "latest.json.enc"


def _check(pw: str) -> None:
    """A jelszó ellenőrzése a repó egy meglévő titkosított fájlján, hogy elírt jelszóval ne
    készüljön használhatatlan csomag (a rejtett bekérésnél könnyű elütni)."""
    if not REF.exists():
        return
    try:
        decrypt_bytes(json.loads(REF.read_text(encoding="utf-8")), pw)
    except Exception:
        sys.exit(f"A jelszó ({len(pw)} karakter) nem egyezik a repó jelszavával (data/latest.json.enc nem nyílik "
                 "vele). Ha a hossz sem stimmel, a beillesztés nem sikerült; próbáld a vágólapról "
                 "($env:F27_DATA_PASSWORD = (Get-Clipboard -Raw).Trim()).")


def pack(src: Path, out: Path) -> None:
    files = {}
    for p in sorted(src.rglob("*")):
        rel = p.relative_to(src).as_posix()
        if not p.is_file() or any(part.startswith(".") for part in p.relative_to(src).parts):
            continue
        if p.stat().st_size > MAX_FILE:
            print(f"kihagyva (túl nagy): {rel}")
            continue
        files[rel] = base64.b64encode(p.read_bytes()).decode()
    if not files:
        sys.exit("Nincs becsomagolható fájl.")
    pw = _password()
    _check(pw)
    blob = json.dumps({"files": files}).encode()
    env = encrypt_bytes(blob, pw)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(env), encoding="utf-8")
    print(f"Kész: {len(files)} fájl titkosítva -> {out} ({out.stat().st_size // 1024} KB)")


def unpack(src: Path, dest: Path) -> None:
    env = json.loads(src.read_text(encoding="utf-8"))
    files = json.loads(decrypt_bytes(env, _password()))["files"]
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    for rel, b64 in files.items():
        target = (dest / rel).resolve()
        if root not in target.parents:
            print(f"kihagyva (gyanús útvonal): {rel}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(b64))
    print(f"Kész: {len(files)} fájl kicsomagolva -> {dest}")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("pack", "unpack"):
        sys.exit(__doc__)
    (pack if sys.argv[1] == "pack" else unpack)(Path(sys.argv[2]), Path(sys.argv[3]))
