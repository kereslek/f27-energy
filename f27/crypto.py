"""Jelszavas titkosítás a publikus repóhoz.

Minden Tuya-ból jövő adat (eszköz ID-k, állapotok, ajtó/ablak nyitások)
csak titkosítva kerülhet a repóba. A formátumot a böngésző (WebCrypto)
is vissza tudja fejteni, így a térkép a GitHub Pages-en jelszóval nyílik.

Boríték (JSON):
  {"v":1, "alg":"AES-256-GCM", "kdf":"PBKDF2-SHA256", "iter":N,
   "salt":b64, "iv":b64, "ct":b64}   # ct = titkosított szöveg + 16 bájtos tag

A jelszó: F27_DATA_PASSWORD (GitHub Secret).
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 310_000
MIN_PASSWORD_LEN = 12


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _key(password: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(password.encode("utf-8"))


def password_from_env() -> str:
    pw = os.environ.get("F27_DATA_PASSWORD", "")
    if len(pw) < MIN_PASSWORD_LEN:
        raise SystemExit(
            f"F27_DATA_PASSWORD hiányzik vagy túl rövid (min. {MIN_PASSWORD_LEN} karakter). "
            "Állítsd be GitHub Secretként."
        )
    return pw


def encrypt_bytes(plain: bytes, password: str) -> dict:
    salt = os.urandom(16)
    iv = os.urandom(12)
    ct = AESGCM(_key(password, salt, ITERATIONS)).encrypt(iv, plain, None)
    return {"v": 1, "alg": "AES-256-GCM", "kdf": "PBKDF2-SHA256", "iter": ITERATIONS,
            "salt": _b64(salt), "iv": _b64(iv), "ct": _b64(ct)}


def decrypt_bytes(envelope: dict, password: str) -> bytes:
    if envelope.get("v") != 1:
        raise ValueError("Ismeretlen boríték verzió")
    salt = base64.b64decode(envelope["salt"])
    iv = base64.b64decode(envelope["iv"])
    ct = base64.b64decode(envelope["ct"])
    return AESGCM(_key(password, salt, int(envelope["iter"]))).decrypt(iv, ct, None)


def write_encrypted_json(path: Path, obj, password: str) -> None:
    plain = json.dumps(obj, ensure_ascii=False, indent=1).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(encrypt_bytes(plain, password)) + "\n", encoding="utf-8")


def read_encrypted_json(path: Path, password: str):
    envelope = json.loads(path.read_text(encoding="utf-8"))
    return json.loads(decrypt_bytes(envelope, password).decode("utf-8"))
