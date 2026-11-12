"""Minimális Tuya IoT Cloud API kliens, csak standard könyvtárral.

Aláírás: Tuya "new signature" (HMAC-SHA256), lásd
https://developer.tuya.com/en/docs/iot/new-singnature

A kulcsok környezeti változóból jönnek (GitHub Secrets):
  TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_ENDPOINT (alapból Central Europe)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

DEFAULT_ENDPOINT = "https://openapi.tuyaeu.com"  # Central Europe Data Center
EMPTY_BODY_SHA256 = hashlib.sha256(b"").hexdigest()


class TuyaError(RuntimeError):
    def __init__(self, path: str, code, msg: str):
        super().__init__(f"Tuya API hiba ({path}): code={code} msg={msg}")
        self.path = path
        self.code = code
        self.msg = msg


class TuyaClient:
    def __init__(self, access_id: str, access_secret: str, endpoint: str = DEFAULT_ENDPOINT):
        if not access_id or not access_secret:
            raise ValueError("Hiányzó TUYA_ACCESS_ID vagy TUYA_ACCESS_SECRET")
        self.access_id = access_id
        self.access_secret = access_secret
        self.endpoint = endpoint.rstrip("/")
        self._token: str | None = None
        self.calls = 0  # API-hívások száma (a kvóta követéséhez; a tokenkérés is számít)
        self._token_expires = 0.0

    @classmethod
    def from_env(cls) -> "TuyaClient":
        return cls(
            os.environ.get("TUYA_ACCESS_ID", "").strip(),
            os.environ.get("TUYA_ACCESS_SECRET", "").strip(),
            os.environ.get("TUYA_ENDPOINT", "").strip() or DEFAULT_ENDPOINT,
        )

    # --- aláírás -------------------------------------------------------

    @staticmethod
    def _url(path: str, params: dict | None) -> str:
        if not params:
            return path
        items = sorted((k, str(v)) for k, v in params.items() if v is not None)
        return path + "?" + "&".join(f"{k}={v}" for k, v in items)

    def _sign(self, method: str, url: str, body: bytes, t: str, nonce: str, with_token: bool) -> str:
        body_hash = hashlib.sha256(body).hexdigest() if body else EMPTY_BODY_SHA256
        string_to_sign = "\n".join([method.upper(), body_hash, "", url])
        prefix = self.access_id + (self._token if with_token else "")
        message = prefix + t + nonce + string_to_sign
        return hmac.new(self.access_secret.encode(), message.encode(), hashlib.sha256).hexdigest().upper()

    def _raw(self, method: str, path: str, params: dict | None = None, body: dict | None = None,
             with_token: bool = True) -> dict:
        url = self._url(path, params)
        self.calls += 1
        data = json.dumps(body, separators=(",", ":")).encode() if body is not None else b""
        t = str(int(time.time() * 1000))
        nonce = uuid.uuid4().hex
        headers = {
            "client_id": self.access_id,
            "t": t,
            "nonce": nonce,
            "sign_method": "HMAC-SHA256",
            "sign": self._sign(method, url, data, t, nonce, with_token),
            "Content-Type": "application/json",
        }
        if with_token:
            headers["access_token"] = self._token or ""
        # A query stringet ugyanúgy kódolva küldjük, ahogy aláírtuk.
        full = self.endpoint + urllib.parse.quote(url, safe="/?&=,_-.:")
        req = urllib.request.Request(full, data=data or None, method=method.upper(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            raise TuyaError(path, e.code, e.reason) from None
        if not payload.get("success"):
            raise TuyaError(path, payload.get("code"), payload.get("msg", ""))
        return payload

    # --- token ---------------------------------------------------------

    def _ensure_token(self) -> None:
        if self._token and time.time() < self._token_expires - 60:
            return
        self._token = None
        payload = self._raw("GET", "/v1.0/token", {"grant_type": 1}, with_token=False)
        result = payload["result"]
        self._token = result["access_token"]
        self._token_expires = time.time() + int(result.get("expire_time", 3600))

    def request(self, method: str, path: str, params: dict | None = None, body: dict | None = None):
        self._ensure_token()
        return self._raw(method, path, params, body)["result"]

    def get(self, path: str, params: dict | None = None):
        return self.request("GET", path, params)

    # --- magasabb szintű hívások -----------------------------------------

    def list_devices(self, uid: str | None = None) -> list[dict]:
        """A projekthez kötött Smart Life fiók(ok) összes eszköze."""
        if uid:
            return list(self.get(f"/v1.0/users/{uid}/devices") or [])
        devices: list[dict] = []
        last_row_key = None
        for _ in range(50):  # lapozás, biztonsági korláttal
            params = {"size": 100}
            if last_row_key:
                params["last_row_key"] = last_row_key
            res = self.get("/v1.0/iot-01/associated-users/devices", params)
            devices.extend(res.get("devices", []))
            if not res.get("has_more"):
                break
            last_row_key = res.get("last_row_key")
        return devices

    def specification(self, device_id: str) -> dict:
        return self.get(f"/v1.0/iot-03/devices/{device_id}/specification")

    def status_batch(self, device_ids: list[str]) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for i in range(0, len(device_ids), 20):
            chunk = device_ids[i:i + 20]
            res = self.get("/v1.0/iot-03/devices/status", {"device_ids": ",".join(chunk)})
            for item in res or []:
                out[item["id"]] = item.get("status", [])
        return out


# ----------------------------------------------------------------------------- eszköznapló

LOG_PAGE = 100          # a Tuya napló-végpontja legfeljebb 100 bejegyzést ad egy oldalon
HEXID = re.compile(r"[0-9a-zA-Z]{16,}")


def err_text(e: TuyaError) -> str:
    """Tuya hiba a publikus logba: kód és az üzenet eleje, hosszú azonosítók kitakarva."""
    msg = HEXID.sub("...", str(e.msg or ""))[:70]
    return f"{e.code} ({msg})" if msg else str(e.code)


def fetch_logs(tc, dev_id: str, start_ms: int, end_ms: int, max_pages: int, types="7", codes=None, pause: float = 0.0) -> dict:
    """Az eszköz naplója az időablakban, lapozva (types: eseménytípusok, 7 = adatpont-jelentés;
    codes: csak ezek az adatpontok). Hibánál a Tuya hibakódja és üzenete."""
    logs: list[dict] = []
    key, pages = None, 0
    while pages < max_pages:
        params = {"type": types, "start_time": start_ms, "end_time": end_ms, "size": LOG_PAGE, "query_type": 1}
        if codes:
            params["codes"] = ",".join(codes)
        if key:
            params["start_row_key"] = key
        try:
            res = tc.get(f"/v1.0/devices/{dev_id}/logs", params) or {}
        except TuyaError as e:
            return {"logs": logs, "pages": pages, "error": err_text(e), "truncated": False}
        pages += 1
        logs.extend(res.get("logs") or [])
        if pause:
            time.sleep(pause)                                  # a Tuya: "The log query is too frequent"
        nxt = res.get("next_row_key")
        if not res.get("has_next") or not nxt or nxt == key:
            return {"logs": logs, "pages": pages, "error": None, "truncated": False}
        key = nxt
    return {"logs": logs, "pages": pages, "error": None, "truncated": True}
