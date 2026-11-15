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
import urllib.error
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


ACC = "https://account.xiaomi.com"
FLAGS = {8: "Email", 4: "Phone"}                    # a Xiaomi azonosítási csatornái: 8 e-mail, 4 SMS


class NeedVerify(XiaomiError):
    """A Xiaomi kétlépcsős azonosítást kér: kódot küldtünk, a `pending` állapottal folytatható."""

    def __init__(self, pending: dict, channel: str):
        super().__init__("a Xiaomi kódot küldött")
        self.pending, self.channel = pending, channel


class _Sess:
    """Sütik + stabil eszközazonosító és UA (a felhasználónévből): a Xiaomi a jóváhagyást ehhez köti."""

    def __init__(self, username: str, state: dict | None = None):
        h = hashlib.sha256(("f27-o2b-mi:" + username.strip()).encode()).hexdigest()
        self.username, self.ua = username, UA.format(h[:13].upper())
        self.jar = http.cookiejar.CookieJar()
        self.op = _opener(self.jar)
        for name, value, domain in (state or {}).get("cookies") or []:
            _cookie(self.jar, name, value, domain)
        _cookie(self.jar, "sdkVersion", "3.8.6", ".xiaomi.com")
        _cookie(self.jar, "deviceId", "an_" + h[13:29], ".xiaomi.com")
        _cookie(self.jar, "userId", username, ".xiaomi.com")

    def cookie(self, name: str) -> str | None:
        return next((c.value for c in self.jar if c.name == name), None)

    def dump(self) -> list:
        keep = {"sdkVersion", "deviceId"}
        return [[c.name, c.value, c.domain] for c in self.jar if c.name not in keep and "xiaomi.com" in c.domain]

    def open(self, url: str, data: dict | None = None, params: dict | None = None) -> str:
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        headers = {"User-Agent": self.ua}
        body = None
        if data is not None:
            body = urllib.parse.urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        try:
            return self.op.open(urllib.request.Request(url, data=body, headers=headers), timeout=30).read().decode(errors="replace")
        except urllib.error.HTTPError as e:
            raise XiaomiError(f"Xiaomi HTTP {e.code}") from None

    def j(self, url: str, data: dict | None = None, params: dict | None = None) -> dict:
        txt = self.open(url, data, params)
        try:
            return _json(txt)
        except ValueError:
            return {"_unparsed": True}


def _finish(s: _Sess, r: dict) -> dict:
    """A sikeres belépési válaszból (ssecurity + location) service token."""
    s.open(r["location"])
    token = s.cookie("serviceToken")
    if not token:
        raise XiaomiError("nincs service token (a Xiaomi jóváhagyást kérhet)")
    return {"user_id": str(r.get("userId") or s.cookie("userId") or s.username), "service_token": token, "ssecurity": r["ssecurity"]}


def _ok(r: dict) -> bool:
    return bool(r.get("ssecurity")) and bool(r.get("location"))


def _start_verify(s: _Sess, notification_url: str) -> None:
    """Kódküldés a jóváhagyáshoz (e-mail, ha van, különben SMS); NeedVerify-t dob a folytatáshoz."""
    q = urllib.parse.parse_qs(urllib.parse.urlparse(notification_url).query)
    context = (q.get("context") or [""])[0]
    if not context:
        raise XiaomiError("a Xiaomi jóváhagyást kér, de nem adott azonosítási környezetet (captcha?)")
    s.open(notification_url)
    lst = s.j(ACC + "/identity/list", params={"sid": "xiaomiio", "context": context, "_locale": "en_US"})
    opts = [int(o) for o in (lst.get("options") or []) if str(o).isdigit()] or ([int(lst["flag"])] if str(lst.get("flag", "")).isdigit() else [])
    order = [f for f in (8, 4) if f in opts] or [8, 4]
    common = {"sid": "xiaomiio", "context": context, "mask": "0", "_locale": "en_US"}
    last = None
    for flag in order:
        kind = FLAGS[flag]
        s.j(ACC + f"/identity/auth/verify{kind}", params={"_flag": flag, "_json": "true", **common})
        r = s.j(ACC + f"/identity/auth/send{kind}Ticket", params={"_dc": int(time.time() * 1000), **common},
                data={"retry": "0", "icode": "", "_json": "true", "ick": s.cookie("ick") or ""})
        if r.get("code") == 0:
            raise NeedVerify({"cookies": s.dump(), "context": context, "flag": flag}, "e-mail" if flag == 8 else "SMS")
        last = r.get("code")
    raise XiaomiError(f"a Xiaomi nem küldött kódot (hibakód {last}; ha captcha kell, várj egy órát és próbáld újra)")


def login(username: str, password: str, state: dict | None = None) -> tuple[dict, dict]:
    """Belépés: ({user_id, service_token, ssecurity}, session). Kétlépcsős azonosításnál NeedVerify.

    `state` a korábbi sikeres belépés munkamenete (passToken sütik): ha még él, nem kell jelszó és kód sem.
    """
    s = _Sess(username, state)
    r1 = s.j(ACC + "/pass/serviceLogin", params={"sid": "xiaomiio", "_json": "true"})
    if _ok(r1):                                         # a mentett munkamenet még érvényes
        return _finish(s, r1), {"cookies": s.dump()}
    data = {"sid": "xiaomiio", "hash": hashlib.md5(password.encode()).hexdigest().upper(),
            "callback": "https://sts.api.io.mi.com/sts", "qs": "%3Fsid%3Dxiaomiio%26_json%3Dtrue", "user": username, "_json": "true"}
    if r1.get("_sign"):
        data["_sign"] = r1["_sign"]
    r2 = s.j(ACC + "/pass/serviceLoginAuth2", data=data)
    if _ok(r2):
        return _finish(s, r2), {"cookies": s.dump()}
    if r2.get("notificationUrl"):
        _start_verify(s, r2["notificationUrl"])
    if r2.get("captchaUrl"):
        raise XiaomiError("a Xiaomi captchát kér: lépj be egyszer a Xiaomi Home appba ugyanezzel a fiókkal, várj egy órát, és próbáld újra")
    if r2.get("_unparsed"):
        raise XiaomiError("olvashatatlan válasz a Xiaomi belépésre (nem JSON)")
    code = r2.get("code")
    if code == 70016:
        raise XiaomiError("a Xiaomi szerint hibás a felhasználónév vagy a jelszó (70016)")
    raise XiaomiError(f"a Xiaomi elutasította a belépést (kód {code}, result {r2.get('result')})")


def verify(username: str, password: str, pending: dict, code: str) -> tuple[dict, dict]:
    """A kapott kóddal befejezi a jóváhagyást (megbízható eszköz), és belép."""
    s = _Sess(username, pending)
    flag, context = int(pending["flag"]), pending["context"]
    kind = FLAGS[flag]
    r = s.j(ACC + f"/identity/auth/verify{kind}",
            params={"_flag": flag, "_json": "true", "sid": "xiaomiio", "context": context, "mask": "0", "_locale": "en_US"},
            data={"_flag": flag, "ticket": code.strip(), "trust": "true", "_json": "true", "ick": s.cookie("ick") or ""})
    if r.get("code") != 0:
        raise XiaomiError("hibás vagy lejárt Xiaomi-kód" if r.get("code") in (70014, 70016, 87001) or r.get("code") is None
                          else f"a Xiaomi nem fogadta el a kódot (hibakód {r.get('code')})")
    if r.get("location"):
        s.open(r["location"])                          # a jóváhagyás vége: passToken sütik
    try:
        return login(username, password, {"cookies": s.dump()})
    except NeedVerify:
        raise XiaomiError("a kód elfogadva, de a Xiaomi újra jóváhagyást kér; futtasd újra a xiaomi lépést") from None


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
