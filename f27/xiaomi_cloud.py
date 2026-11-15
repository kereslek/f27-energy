"""Minimális Xiaomi (Mi Home) felhőkliens: belépés, eszközlista, miot tulajdonság és művelet.

A nyílt forráskódú `micloud` csomag (Sammy Svensson, MIT licenc) eljárását követi, de csak a
szabványkönyvtárral és a pycryptodome-mal (a python-roborock is erre épül), mert a micloud régi
telepítő-szkriptje a friss környezetekben nem épül meg. Hivatalos nyilvános API nincs: ugyanezt
használja a Xiaomi Home app.

Biztonság: a jelszó csak a belépésnél megy át (MD5 lenyomatként, ahogy az app is küldi), nem tároljuk;
a kapott service token, ssecurity és user_id a hívó dolga (f27/robots.py a Supabase robot_auth táblájába
teszi). Semmit nem írunk logba.
"""
from __future__ import annotations

import base64
import hashlib
import http.cookiejar
import json
import random
import string
import time
import urllib.parse
import urllib.request

UA = "Android-7.1.1-1.0.0-ONEPLUS A3010-136-{} APP/xiaomi.smarthome APPV/62830"


class XiaomiError(RuntimeError):
    pass


def _rand(letters: str, n: int) -> str:
    return "".join(random.choice(letters) for _ in range(n))


def _opener(cookies: http.cookiejar.CookieJar):
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def _cookie(jar: http.cookiejar.CookieJar, name: str, value: str, domain: str) -> None:
    jar.set_cookie(http.cookiejar.Cookie(0, name, str(value), None, False, domain, True, domain.startswith("."), "/", True,
                                         False, None, False, None, None, {}))


def _json(text: str) -> dict:
    return json.loads(text.replace("&&&START&&&", ""))


def login(username: str, password: str) -> dict:
    """Belépés: {user_id, service_token, ssecurity}. Kétlépcsős azonosításnál XiaomiError."""
    jar = http.cookiejar.CookieJar()
    op = _opener(jar)
    ua = UA.format(_rand("ABCDEF", 13))
    _cookie(jar, "sdkVersion", "3.8.6", ".xiaomi.com"); _cookie(jar, "deviceId", _rand(string.ascii_lowercase, 6), ".xiaomi.com")
    _cookie(jar, "userId", username, ".xiaomi.com")

    def get(url):
        return op.open(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=30)

    r1 = _json(get("https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true").read().decode())
    sign = r1.get("_sign", "")
    data = {"sid": "xiaomiio", "hash": hashlib.md5(password.encode()).hexdigest().upper(),
            "callback": "https://sts.api.io.mi.com/sts", "qs": "%3Fsid%3Dxiaomiio%26_json%3Dtrue", "user": username, "_json": "true"}
    if sign:
        data["_sign"] = sign
    req = urllib.request.Request("https://account.xiaomi.com/pass/serviceLoginAuth2", data=urllib.parse.urlencode(data).encode(),
                                 headers={"User-Agent": ua, "Content-Type": "application/x-www-form-urlencoded"})
    r2 = _json(op.open(req, timeout=30).read().decode())
    if r2.get("result") != "ok" or not r2.get("ssecurity"):
        if r2.get("notificationUrl") or r2.get("captchaUrl"):
            raise XiaomiError("a Xiaomi jóváhagyást kér (kétlépcsős azonosítás vagy captcha): lépj be egyszer a Xiaomi Home appba, aztán próbáld újra")
        raise XiaomiError("hibás felhasználónév vagy jelszó")
    location = r2.get("location")
    if not location:
        raise XiaomiError("a Xiaomi nem adott belépési címet (jóváhagyás kell?)")
    get(location).read()
    token = next((c.value for c in jar if c.name == "serviceToken"), None)
    if not token:
        raise XiaomiError("nincs service token (a Xiaomi jóváhagyást kérhet)")
    return {"user_id": str(r2["userId"]), "service_token": token, "ssecurity": r2["ssecurity"]}


# ---- titkosított kérés (RC4), a micloud miutils szerint ----------------------------------------
def _nonce() -> str:
    b = (random.getrandbits(64) - 2 ** 63).to_bytes(8, "big", signed=True)
    part2 = int(time.time() * 1000) // 60000
    return base64.b64encode(b + part2.to_bytes((part2.bit_length() + 7) // 8, "big")).decode()


def _signed_nonce(ssecurity: str, nonce: str) -> str:
    return base64.b64encode(hashlib.sha256(base64.b64decode(ssecurity) + base64.b64decode(nonce)).digest()).decode()


def _enc_signature(url: str, method: str, signed_nonce: str, params: dict) -> str:
    parts = [method.upper(), url.split("com")[1].replace("/app/", "/")] + [f"{k}={v}" for k, v in params.items()] + [signed_nonce]
    return base64.b64encode(hashlib.sha1("&".join(parts).encode()).digest()).decode()


def _rc4(password: str, data: bytes) -> bytes:
    from Crypto.Cipher import ARC4                    # pycryptodome (a python-roborock függősége)
    c = ARC4.new(base64.b64decode(password))
    c.encrypt(bytes(1024))
    return c.encrypt(data)


def request(auth: dict, country: str, path: str, data: dict | str) -> dict:
    url = "https://" + ("" if country == "cn" else country + ".") + "api.io.mi.com/app" + path
    params = {"data": data if isinstance(data, str) else json.dumps(data, separators=(",", ":"))}
    nonce = _nonce()
    sn = _signed_nonce(auth["ssecurity"], nonce)
    params["rc4_hash__"] = _enc_signature(url, "POST", sn, params)
    for k in list(params):
        params[k] = base64.b64encode(_rc4(sn, params[k].encode())).decode()
    params.update({"signature": _enc_signature(url, "POST", sn, params), "ssecurity": auth["ssecurity"], "_nonce": nonce})
    jar = http.cookiejar.CookieJar()
    for name, val in (("userId", auth["user_id"]), ("yetAnotherServiceToken", auth["service_token"]), ("serviceToken", auth["service_token"]),
                      ("locale", "en_US"), ("timezone", "GMT+01:00"), ("is_daylight", "0"), ("dst_offset", "0"), ("channel", "MI_APP_STORE")):
        _cookie(jar, name, val, ".api.io.mi.com")
    req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode(), headers={
        "User-Agent": UA.format(_rand("ABCDEF", 13)), "Accept-Encoding": "identity", "x-xiaomi-protocal-flag-cli": "PROTOCAL-HTTP2",
        "Content-Type": "application/x-www-form-urlencoded", "MIOT-ENCRYPT-ALGORITHM": "ENCRYPT-RC4"})
    try:
        body = _opener(jar).open(req, timeout=30).read().decode()
    except urllib.error.HTTPError as e:
        raise XiaomiError("a belépés lejárt, futtasd újra a „Robotok bejelentkezése” workflow-t (xiaomi)" if e.code in (401, 403)
                          else f"Xiaomi HTTP {e.code}") from None
    try:
        out = json.loads(_rc4(_signed_nonce(auth["ssecurity"], params["_nonce"]), base64.b64decode(body)).decode())
    except Exception:                                   # noqa: BLE001
        raise XiaomiError("olvashatatlan válasz a Xiaomi felhőtől") from None
    if out.get("code") not in (0, None):
        raise XiaomiError(f"Xiaomi hibakód {out.get('code')}")
    return out


def devices(auth: dict, country: str) -> list[dict]:
    r = request(auth, country, "/home/device_list",
                '{"getVirtualModel":true,"getHuamiDevices":1,"get_split_device":false,"support_smart_home":true}')
    return (r.get("result") or {}).get("list") or []


def get_props(auth: dict, country: str, params: list[dict]) -> list[dict]:
    return request(auth, country, "/miotspec/prop/get", {"params": params}).get("result") or []


def action(auth: dict, country: str, did: str, siid: int, aiid: int) -> dict:
    return request(auth, country, "/miotspec/action", {"params": {"did": did, "siid": siid, "aiid": aiid, "in": []}})
