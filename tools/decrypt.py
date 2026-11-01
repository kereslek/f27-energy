"""Titkosított adatfájl kibontása helyben.

  F27_DATA_PASSWORD=... python tools/decrypt.py data/latest.json.enc

A jelszót környezeti változóból olvassa; ne írd parancssorba, ha a shell
history-t mások is látják. A kimenet a konzolra megy, fájlba nem ír.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from f27.crypto import password_from_env, read_encrypted_json  # noqa: E402

if len(sys.argv) != 2:
    sys.exit("Használat: python tools/decrypt.py <fájl.enc>")
print(json.dumps(read_encrypted_json(Path(sys.argv[1]), password_from_env()), ensure_ascii=False, indent=2))
