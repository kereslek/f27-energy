"""Offline tesztek a riasztásokhoz (f27.alerts): szabályok, tartósság, türelmi idő, megszűnt
üzenet, csendes órák a kályha-kivétellel, lemerült nyílászárók, próba-értesítés, hiányzó tábla,
csatornák (ntfy, SMTP, CallMeBot) hálózat nélkül, és hogy a publikus kimenetbe ne kerüljön
érték, cím, topic vagy kulcs.

Futtatás a repó gyökeréből:  python -m unittest discover -s tests -v
"""

from __future__ import annotations

import base64
import json
import threading
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from f27 import alerts as A
from f27 import collect as C
from f27.supa import SupabaseRest
from tests.test_pipeline import env, run_main, supa_server, tuya_server

T0 = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)          # 13:00 Budapest, nem csendes óra
TOPIC = "f27-titkos-topic-x8k2"
ENV = {"NTFY_TOPIC": TOPIC, "SMTP_HOST": "smtp.pelda.hu", "SMTP_PORT": "587", "SMTP_USER": "tulaj@pelda.hu",
       "SMTP_PASS": "jelszo-1234", "ALERT_EMAIL_TO": "tulaj@pelda.hu, masik@pelda.hu",
       "CALLMEBOT_PHONE": "+36301234567", "CALLMEBOT_APIKEY": "998877"}
SECRETS = [TOPIC, "smtp.pelda.hu", "tulaj@pelda.hu", "masik@pelda.hu", "jelszo-1234", "+36301234567", "998877"]


def devices(T, **o):
    """device_status sorok (a device_latest ebből áll össze). o: felülírások pink -> status mezők,
    vagy pink -> {'online': ..., 'age_min': ...}."""
    def row(pink, st, age_min=5, online=True):
        ext = o.get(pink) or {}
        st = dict(st, **{k: v for k, v in ext.items() if k not in ("online", "age_min")})
        age = ext.get("age_min", age_min)
        st["_upd"] = int((T - timedelta(minutes=age)).timestamp())
        return {"pink": pink, "ts": (T - timedelta(minutes=min(age, 60))).isoformat(), "online": ext.get("online", online), "status": st}
    contact = lambda: {"doorcontact_state": False, "battery_percentage": 90}
    return [
        row("1", {"va_temperature": 214}), row("2", {"va_temperature": 210}), row("3", {"va_temperature": 300}),
        row("4", {"va_temperature": 222}),
        row("5", contact()), row("6", contact()), row("7", contact()), row("8", contact()), row("9", contact()), row("10", contact()),
        row("P", {"switch_1": False, "switch_2": False, "switch_3": False}),
        row("X5", {"switch": True, "cur_power": 0}), row("X7", {"switch": True, "cur_power": 0}),
        row("X8", {"switch": True, "cur_power": 0}), row("X9", {"switch": True, "cur_power": 0}),
        row("G", {}),
    ]


class Base(unittest.TestCase):
    def setUp(self):
        self.sb = supa_server()
        for p in ("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "P", "X5", "X7", "X8", "X9", "G"):
            self.sb.db["devices"][p] = {"pink": p, "role": "x", "tuya_device_id": "devid" + p, "meta": None}
        self.sent = []
        self.failing = set()

        def fake(ch):
            def f(msg, environ):
                if ch in self.failing:
                    raise ConnectionError("smtp.pelda.hu elutasította: tulaj@pelda.hu jelszo-1234")
                self.sent.append((ch, msg))
            return f
        self.senders = {"push": fake("push"), "email": fake("email"), "whatsapp": fake("whatsapp")}

    def tearDown(self):
        self.sb.close()

    def set_devices(self, T, **o):
        self.sb.db["device_status"] = devices(T, **o)

    def settings(self, **cfg):
        row = self.sb.db["alert_settings"].setdefault(1, {"id": 1, "config": {}, "test_requested_at": None})
        row["config"] = dict(row["config"], **cfg)

    def run_at(self, T, environ=None, **o):
        self.set_devices(T, **o)
        n = len(self.sent)
        res = A.run_alerts(SupabaseRest(self.sb.url, self.sb.secret), now=T,
                           environ=ENV if environ is None else environ, senders=self.senders)
        res["new"] = self.sent[n:]
        return res

    def texts(self, res, ch="push"):
        return [m["body"] for c, m in res["new"] if c == ch]

    def log(self):
        return self.sb.db["alert_log"]


class TestRules(Base):
    def test_temp_hi_needs_10_minutes_then_fires(self):
        r = self.run_at(T0, **{"3": {"va_temperature": 392}})
        self.assertEqual(r["new"], [])
        self.assertIsNotNone(self.sb.db["alert_state"]["temp_hi:3"]["since"])
        self.assertFalse(self.sb.db["alert_state"]["temp_hi:3"]["active"])
        r = self.run_at(T0 + timedelta(minutes=10), **{"3": {"va_temperature": 392}})
        self.assertEqual([c for c, _ in r["new"]], ["push"])          # e-mail csak a napi összefoglalóban
        push = r["new"][0][1]
        self.assertTrue(push["body"].startswith("F27 riasztás: Kályha mögött 39,2 °C (határ 38 °C)."))
        self.assertIn(A.MAP_URL, push["body"])
        self.assertEqual(push["title"], "F27 riasztás: Kályha mögött 39,2 °C")
        self.assertEqual(push["priority"], "high")
        self.assertEqual(r["active"], 1)
        self.assertEqual(self.log()[-1]["kind"], "fired")
        self.assertEqual(self.log()[-1]["channels"], "push")
        self.assertEqual(self.log()[-1]["rule_key"], "temp_hi:3")

    def test_short_spike_does_not_fire(self):
        self.run_at(T0, **{"2": {"va_temperature": 230}})
        r = self.run_at(T0 + timedelta(minutes=10))                 # visszaesett: nincs riasztás
        self.assertEqual(r["new"], [])
        self.assertIsNone(self.sb.db["alert_state"]["temp_hi:2"]["since"])
        self.assertEqual(self.log(), [])

    def test_temp_lo(self):
        self.run_at(T0, **{"1": {"va_temperature": 175}})
        r = self.run_at(T0 + timedelta(minutes=10), **{"1": {"va_temperature": 175}})
        self.assertEqual(self.texts(r)[0].splitlines()[0], "F27 riasztás: Kis szoba 17,5 °C (alsó határ 19 °C).")

    def test_cooldown_then_reminder(self):
        hot = {"3": {"va_temperature": 392}}
        self.run_at(T0, **hot)
        self.run_at(T0 + timedelta(minutes=10), **hot)                # kiment
        for m in (20, 30, 40, 50, 60):
            self.assertEqual(self.run_at(T0 + timedelta(minutes=m), **hot)["new"], [], f"{m}. perc: türelmi idő")
        r = self.run_at(T0 + timedelta(minutes=70), **hot)
        self.assertTrue(self.texts(r)[0].startswith("F27 riasztás (még fennáll): Kályha mögött 39,2 °C"))
        self.assertEqual(len([x for x in self.log() if x["kind"] == "fired"]), 2)

    def test_cooldown_setting(self):
        self.settings(cooldownMin=30)
        hot = {"3": {"va_temperature": 392}}
        self.run_at(T0, **hot)
        self.run_at(T0 + timedelta(minutes=10), **hot)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=30), **hot)["new"], [])
        self.assertTrue(self.run_at(T0 + timedelta(minutes=40), **hot)["new"])

    def test_resolved_message(self):
        hot = {"3": {"va_temperature": 392}}
        self.run_at(T0, **hot)
        self.run_at(T0 + timedelta(minutes=10), **hot)
        r = self.run_at(T0 + timedelta(minutes=20), **{"3": {"va_temperature": 360}})
        self.assertEqual(self.texts(r)[0].splitlines()[0], "F27: megszűnt: Kályha mögött 36,0 °C (határ 38 °C).")
        push = [m for c, m in r["new"] if c == "push"][0]
        self.assertEqual(push["priority"], "default")
        self.assertEqual(push["title"], "F27: megszűnt: Kályha mögött 36,0 °C")
        self.assertEqual([c for c, _ in r["new"]], ["push"])
        self.assertFalse(self.sb.db["alert_state"]["temp_hi:3"]["active"])
        self.assertEqual(r["active"], 0)
        self.assertEqual(self.log()[-1]["kind"], "resolved")
        # újra fellép a türelmi időn belül: nem megy ki
        self.run_at(T0 + timedelta(minutes=30), **hot)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=40), **hot)["new"], [])

    def test_resolved_message_off(self):
        self.settings(resolvedMsg=False)
        hot = {"3": {"va_temperature": 392}}
        self.run_at(T0, **hot)
        self.run_at(T0 + timedelta(minutes=10), **hot)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=20))["new"], [])

    def test_unsent_alert_has_no_resolved_message(self):
        self.failing = {"email", "push"}                               # a riasztás nem ment ki
        hot = {"2": {"va_temperature": 240}}
        self.run_at(T0, **hot)
        self.run_at(T0 + timedelta(minutes=10), **hot)
        self.failing = set()
        r = self.run_at(T0 + timedelta(minutes=20))
        self.assertFalse([m for c, m in r["new"] if "megszűnt" in str(m)])

    def test_open_heat_window_and_stove(self):
        o = {"8": {"doorcontact_state": True}, "P": {"switch_1": True}, "X5": {"cur_power": 9950}}
        self.run_at(T0, **o)
        r = self.run_at(T0 + timedelta(minutes=14), **o)
        self.assertEqual(self.texts(r)[0].splitlines()[0],
                         "F27: ablak nyitva fűtés közben: Kis szoba ablak 14 perce, közben a kályha fűt (995 W).")
        self.assertEqual([m for c, m in r["new"] if c == "push"][0]["title"], "F27: ablak nyitva fűtés közben")
        r = self.run_at(T0 + timedelta(minutes=24), **dict(o, **{"8": {"doorcontact_state": False}}))
        self.assertEqual(self.texts(r)[0].splitlines()[0], "F27: megszűnt: Kis szoba ablak becsukva.")

    def test_open_heat_stove_decided_by_measurement(self):
        # a kapcsoló BE, de a kályha 0 W-ot vesz fel (feltöltött): nem fűt, nincs riasztás
        o = {"8": {"doorcontact_state": True}, "P": {"switch_1": True, "switch_2": True}, "X5": {"cur_power": 0}}
        self.run_at(T0, **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=20), **o)["new"], [])
        self.assertFalse((self.sb.db["alert_state"].get("open_heat:8") or {}).get("active"))
        # a kapcsoló KI, de a kör mégis 1 kW-ot mér: fűt, riaszt
        o2 = {"8": {"doorcontact_state": True}, "X5": {"cur_power": 10000}}
        self.run_at(T0 + timedelta(minutes=30), **o2)
        r = self.run_at(T0 + timedelta(minutes=45), **o2)
        self.assertIn("közben a kályha fűt (1,0 kW)", self.texts(r)[0])
        # a kör nem elérhető: a kapcsoló dönt, és a szöveg ezt meg is mondja
        o3 = {"9": {"doorcontact_state": True}, "P": {"switch_1": True}, "X5": {"online": False}}
        self.run_at(T0 + timedelta(minutes=60), **o3)
        r = self.run_at(T0 + timedelta(minutes=75), **o3)
        self.assertIn("a kályhakapcsoló 1/3 fokozaton (a kör most nem mér)", self.texts(r)[-1])

    def test_open_heat_door_and_ac_only(self):
        o = {"5": {"doorcontact_state": True}, "X9": {"cur_power": 5000}}
        self.run_at(T0, **o)
        r = self.run_at(T0 + timedelta(minutes=10), **o)
        self.assertEqual(self.texts(r)[0].splitlines()[0],
                         "F27: ajtó nyitva klímázás közben: Bejárati ajtó 10 perce, közben a klíma megy (500 W).")

    def test_open_heat_needs_heating_and_ignores_storage(self):
        self.run_at(T0, **{"8": {"doorcontact_state": True}})
        self.assertEqual(self.run_at(T0 + timedelta(minutes=20), **{"8": {"doorcontact_state": True}})["new"], [])
        o = {"6": {"doorcontact_state": True}, "P": {"switch_1": True, "switch_2": True}}
        self.run_at(T0 + timedelta(minutes=30), **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=50), **o)["new"], [])
        self.assertNotIn("open_heat:6", self.sb.db["alert_state"])

    def test_open_heat_minutes_setting(self):
        self.settings(openHeat={"on": True, "minutes": 30})
        o = {"9": {"doorcontact_state": True}, "X5": {"cur_power": 20000}}
        self.run_at(T0, **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=20), **o)["new"], [])
        r = self.run_at(T0 + timedelta(minutes=30), **o)
        self.assertIn("Nagy szoba bal ablak 30 perce, közben a kályha fűt (2,0 kW)", self.texts(r)[0])

    def test_ac_max_open(self):
        o = {"10": {"doorcontact_state": True}, "X9": {"cur_power": 11000}}
        self.run_at(T0, **o)
        r = self.run_at(T0 + timedelta(minutes=10), **o)
        lines = self.texts(r)[0].splitlines()
        self.assertIn("F27: a klíma nagy teljesítményen megy (1,1 kW, határ 900 W), és nyitva: Nagy szoba jobb ablak.", lines)
        self.assertEqual([m for c, m in r["new"] if c == "push"][0]["title"], "F27 riasztás: 2 esemény")   # + open_heat:10
        self.assertEqual(len([x for x in self.log() if x["kind"] == "fired"]), 2)
        # 1200 W-os határral nem riaszt
        self.sb.db["alert_state"].clear()
        self.settings(acMaxOpen={"on": True, "watts": 1200}, openHeat={"on": False, "minutes": 10})
        self.run_at(T0 + timedelta(minutes=100), **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=110), **o)["new"], [])

    def test_skip_dead_contacts(self):
        o = {"8": {"doorcontact_state": True, "battery_percentage": 9}, "P": {"switch_1": True}, "X5": {"cur_power": 10000}}
        self.run_at(T0, **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=10), **o)["new"], [])
        stale = {"8": {"doorcontact_state": True, "age_min": 25 * 60}, "P": {"switch_1": True}, "X5": {"cur_power": 10000}}
        self.run_at(T0 + timedelta(minutes=20), **stale)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=30), **stale)["new"], [])
        off = {"8": {"doorcontact_state": True, "online": False}, "P": {"switch_1": True}, "X5": {"cur_power": 10000}}
        self.run_at(T0 + timedelta(minutes=40), **off)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=50), **off)["new"], [])
        # kikapcsolva a kihagyás: a merülő érzékelő is számít
        self.settings(skipDeadContacts=False)
        self.run_at(T0 + timedelta(minutes=60), **o)
        r = self.run_at(T0 + timedelta(minutes=70), **o)
        self.assertIn("Kis szoba ablak", self.texts(r)[0])

    def test_kitchen_window_ignored_by_default_and_can_be_watched(self):
        o = {"7": {"doorcontact_state": True}, "P": {"switch_1": True}, "X9": {"cur_power": 11000}}
        # alapból a konyhaablak nem riaszt (a tulaj kérése)
        self.run_at(T0, **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=10), **o)["new"], [])
        self.assertNotIn("open_heat:7", self.sb.db["alert_state"])
        # "A konyhaablakot is figyelje" bekapcsolva: mindkét ablakos szabály nézi
        self.settings(watchKitchen=True)
        self.run_at(T0 + timedelta(minutes=20), **o)
        r = self.run_at(T0 + timedelta(minutes=30), **o)
        txt = self.texts(r)[0]
        self.assertIn("Konyha ablak 10 perce", txt)
        self.assertIn("nyitva: Konyha ablak", txt)
        # vissza kikapcsolva: a nyitott ablak + fűtés riasztás csendben lezárul, a klímásnál
        # a megszűnt üzenet megmondja, miért; utána egyik sem jön újra
        self.settings(watchKitchen=False)
        r = self.run_at(T0 + timedelta(minutes=40), **o)
        self.assertEqual(self.texts(r), ["F27: megszűnt: csak a konyhaablak van nyitva, azt nem figyeljük.\n\nTérkép: " + A.MAP_URL])
        self.assertFalse(self.sb.db["alert_state"]["open_heat:7"]["active"])
        self.assertEqual(self.run_at(T0 + timedelta(minutes=110), **o)["new"], [])
        # a többi ablak ettől még riaszt
        o2 = dict(o, **{"8": {"doorcontact_state": True}})
        self.run_at(T0 + timedelta(minutes=120), **o2)
        r = self.run_at(T0 + timedelta(minutes=130), **o2)
        self.assertIn("Kis szoba ablak", self.texts(r)[0])
        self.assertNotIn("Konyha", self.texts(r)[0])

    def test_old_skip_kitchen_key_is_ignored(self):
        self.assertFalse(A.merge_config({"skipKitchen": False})["watchKitchen"])

    def test_stale_or_offline_thermometer_is_skipped(self):
        o = {"3": {"va_temperature": 450, "age_min": 7 * 60}}
        self.run_at(T0, **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=10), **o)["new"], [])
        self.assertNotIn("temp_hi:3", self.sb.db["alert_state"])
        o = {"3": {"va_temperature": 450, "online": False}}
        self.run_at(T0 + timedelta(minutes=20), **o)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=30), **o)["new"], [])

    def test_meta_scale(self):
        self.sb.db["devices"]["3"]["meta"] = {"va_temperature": {"scale": 2}}
        o = {"3": {"va_temperature": 3920}}
        self.run_at(T0, **o)
        self.assertIn("Kályha mögött 39,2 °C", self.texts(self.run_at(T0 + timedelta(minutes=10), **o))[0])

    def test_disabled_rule_is_closed_silently(self):
        hot = {"4": {"va_temperature": 290}}
        self.settings(temps={"4": {"on": True, "lo": 19, "hi": 25}})
        self.run_at(T0, **hot)
        self.assertTrue(self.run_at(T0 + timedelta(minutes=10), **hot)["new"])
        self.settings(temps={"4": {"on": False, "lo": 19, "hi": 25}})
        r = self.run_at(T0 + timedelta(minutes=20), **hot)
        self.assertEqual(r["new"], [])
        self.assertFalse(self.sb.db["alert_state"]["temp_hi:4"]["active"])
        self.assertEqual(r["active"], 0)

    def test_bathroom_is_off_by_default(self):
        hot = {"4": {"va_temperature": 290}}
        self.run_at(T0, **hot)
        self.assertEqual(self.run_at(T0 + timedelta(minutes=10), **hot)["new"], [])


class TestQuiet(Base):
    NIGHT = datetime(2026, 11, 8, 22, 30, tzinfo=timezone.utc)      # 23:30 Budapest

    def test_stored_quiet_hours_are_ignored(self):
        # a tulaj kérése: nincs csendes időszak; egy régen elmentett "on: true" sem némít el semmit
        self.settings(quiet={"on": True, "from": "23:00", "to": "07:00"})
        hot = {"2": {"va_temperature": 240}}
        self.run_at(self.NIGHT, **hot)
        r = self.run_at(self.NIGHT + timedelta(minutes=10), **hot)
        self.assertTrue(self.texts(r)[0].startswith("F27 riasztás: Nagy szoba 24,0 °C"))
        self.assertFalse(A.in_quiet(A.merge_config({"quiet": {"on": True, "from": "00:00", "to": "23:59"}}), self.NIGHT))



class TestTestAndChannels(Base):
    def test_test_request_once(self):
        self.sb.db["alert_settings"][1] = {"id": 1, "config": {}, "test_requested_at": (T0 - timedelta(minutes=3)).isoformat()}
        r = self.run_at(T0)
        self.assertTrue(r["test"])
        self.assertEqual([c for c, _ in r["new"]], ["push"])          # a próba sem megy e-mailben
        msg = r["new"][0][1]
        self.assertEqual(msg["title"], "F27 próba-értesítés")
        self.assertIn("5 szabály bekapcsolva", msg["body"])
        self.assertEqual(self.log()[-1]["kind"], "test")
        self.assertEqual(self.run_at(T0 + timedelta(minutes=10))["new"], [])           # már kiment
        self.sb.db["alert_settings"][1]["test_requested_at"] = (T0 + timedelta(minutes=15)).isoformat()
        self.assertEqual(len(self.run_at(T0 + timedelta(minutes=20))["new"]), 1)

    def test_test_ignores_quiet_hours(self):
        night = datetime(2026, 11, 8, 23, 0, tzinfo=timezone.utc)
        self.sb.db["alert_settings"][1] = {"id": 1, "config": {}, "test_requested_at": night.isoformat()}
        self.assertTrue(self.run_at(night + timedelta(minutes=5))["new"])

    def test_only_enabled_and_configured_channels(self):
        self.settings(channels={"push": True, "whatsapp": True})
        hot = {"3": {"va_temperature": 392}}
        self.run_at(T0, **hot)
        r = self.run_at(T0 + timedelta(minutes=10), **hot)
        self.assertEqual(sorted(c for c, _ in r["new"]), ["push", "whatsapp"])
        self.assertEqual(A.channels_ready(A.merge_config({}), {"NTFY_TOPIC": "x"}), ["push"])
        self.assertEqual(A.channels_ready(A.merge_config({}), {"SMTP_HOST": "h", "ALERT_EMAIL_TO": "a@b"}), [])
        self.assertEqual(A.channels_ready(A.merge_config({"channels": {"whatsapp": True}}), {"CALLMEBOT_PHONE": "1"}), [])

    def test_no_channels_logs_once(self):
        hot = {"3": {"va_temperature": 392}}
        self.run_at(T0, environ={}, **hot)
        r = self.run_at(T0 + timedelta(minutes=10), environ={}, **hot)
        self.assertEqual(r["new"], [])
        self.assertIn("Nincs beállított push csatorna", r["note"])
        self.assertEqual(self.log()[-1]["channels"], "nincs beállított csatorna")
        self.run_at(T0 + timedelta(minutes=20), environ={}, **hot)
        self.assertEqual(len(self.log()), 1)

    def test_channel_error_is_counted_and_retried(self):
        self.settings(channels={"push": True, "whatsapp": True})
        self.failing = {"whatsapp"}
        hot = {"3": {"va_temperature": 392}}
        self.run_at(T0, **hot)
        r = self.run_at(T0 + timedelta(minutes=10), **hot)
        self.assertEqual(r["errors"], 1)
        self.assertEqual(r["sent"], 1)                                # a push kiment
        self.assertIn("Csatornahiba: whatsapp (ConnectionError)", r["note"])
        for s in SECRETS + ["39,2", "Kályha mögött"]:
            self.assertNotIn(s, r["note"])
        self.failing = {"push", "whatsapp"}
        self.sb.db["alert_state"].clear()
        self.run_at(T0 + timedelta(minutes=100), **hot)
        r = self.run_at(T0 + timedelta(minutes=110), **hot)
        self.assertEqual((r["sent"], r["errors"]), (0, 2))
        self.assertIsNone(self.sb.db["alert_state"]["temp_hi:3"].get("last_sent"))
        self.assertEqual(self.log()[-1]["channels"], "hiba")
        self.failing = set()
        self.assertTrue(self.run_at(T0 + timedelta(minutes=120), **hot)["new"])          # a következő kör pótolja

    def test_missing_table(self):
        sb2 = supa_server(no_tables=("alert_settings", "alert_state", "alert_log"))
        try:
            r = A.run_alerts(SupabaseRest(sb2.url, sb2.secret), now=T0, environ=ENV, senders=self.senders)
        finally:
            sb2.close()
        self.assertIn("supabase/migrations/006_alerts.sql", r["note"])
        self.assertFalse(r["error"])
        self.assertEqual(self.sent, [])

    def test_config_merge_rejects_bad_values(self):
        cfg = A.merge_config({"temps": {"1": {"on": "igen", "lo": 30, "hi": 20}, "2": {"lo": 18.5, "hi": 23}},
                              "cooldownMin": -5, "quiet": {"from": "25:00", "to": "06:00"}, "channels": {"email": 1},
                              "acMaxOpen": {"watts": "sok"}, "skipDeadContacts": False, "ismeretlen": 1})
        self.assertEqual(cfg["temps"]["1"], {"on": True, "lo": 19, "hi": 24})
        self.assertEqual(cfg["temps"]["2"], {"on": True, "lo": 18.5, "hi": 23})
        self.assertEqual(cfg["cooldownMin"], 60)
        self.assertEqual(cfg["quiet"], {"on": False, "from": "23:00", "to": "06:00"})
        self.assertNotIn("email", cfg["channels"])
        self.assertEqual(cfg["digest"], {"on": True, "time": "20:00"})
        self.assertEqual(cfg["acMaxOpen"]["watts"], 900)
        self.assertFalse(cfg["skipDeadContacts"])
        self.assertFalse(cfg["watchKitchen"])
        self.assertNotIn("ismeretlen", cfg)
        self.assertEqual(A.merge_config(None), A.DEFAULT_CONFIG)
        self.assertEqual(A.rules_on(A.DEFAULT_CONFIG), 5)


class TestSenders(unittest.TestCase):
    MSG = {"title": "F27 riasztás: Kályha mögött 39,2 °C", "subject": "F27 riasztás: Kályha mögött 39,2 °C",
           "body": "F27 riasztás: Kályha mögött 39,2 °C (határ 38 °C).\n\nTérkép: " + A.MAP_URL,
           "email_body": "F27 riasztás: Kályha mögött 39,2 °C (határ 38 °C).\n\nÉrzékelők most: ...",
           "plain": "F27 riasztás\nszöveg ő ű", "priority": "high", "tags": "rotating_light"}

    def test_ntfy_post(self):
        got = {}

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                got["path"] = self.path
                got["headers"] = dict(self.headers)
                got["body"] = self.rfile.read(int(self.headers["Content-Length"])).decode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")

        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            A.send_ntfy(self.MSG, {"NTFY_URL": f"http://127.0.0.1:{srv.server_address[1]}/", "NTFY_TOPIC": "f27 titok/x"})
        finally:
            srv.shutdown()
            srv.server_close()
        self.assertEqual(got["path"], "/f27%20titok%2Fx")
        t = got["headers"]["Title"]
        self.assertTrue(t.startswith("=?UTF-8?B?"))
        self.assertEqual(base64.b64decode(t[10:-2]).decode(), self.MSG["title"])
        self.assertEqual(got["headers"]["Priority"], "high")
        self.assertEqual(got["headers"]["Tags"], "rotating_light")
        self.assertEqual(got["headers"]["Click"], A.MAP_URL)
        self.assertEqual(got["body"], self.MSG["body"])

    def test_ntfy_default_server(self):
        seen = {}

        class R:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b""

        def opener(req, timeout):
            seen["url"] = req.full_url
            return R()
        A.send_ntfy(self.MSG, {"NTFY_TOPIC": "abc"}, opener=opener)
        self.assertEqual(seen["url"], "https://ntfy.sh/abc")

    def fake_smtp(self):
        calls = []

        class S:
            def __init__(self, host, port, timeout=None, context=None):
                calls.append(("open", type(self).__name__, host, port))

            def __enter__(self):
                return self

            def __exit__(self, *a):
                calls.append(("quit",))
                return False

            def ehlo(self):
                calls.append(("ehlo",))

            def starttls(self, context=None):
                calls.append(("starttls",))

            def login(self, u, p):
                calls.append(("login", u, p))

            def send_message(self, m):
                calls.append(("send", m))

        class SMTP(S):
            pass

        class SMTP_SSL(S):
            pass
        mod = type("M", (), {"SMTP": SMTP, "SMTP_SSL": SMTP_SSL})
        return mod, calls

    def test_email_starttls_587(self):
        mod, calls = self.fake_smtp()
        A.send_email(self.MSG, dict(ENV), smtp=mod)
        kinds = [c[0] for c in calls]
        self.assertEqual(kinds, ["open", "ehlo", "starttls", "ehlo", "login", "send", "quit"])
        self.assertEqual(calls[0][1:], ("SMTP", "smtp.pelda.hu", 587))
        m = calls[5][1]
        self.assertEqual(m["Subject"], self.MSG["subject"])
        self.assertEqual(m["To"], "tulaj@pelda.hu, masik@pelda.hu")
        self.assertEqual(m["From"], "tulaj@pelda.hu")
        self.assertIn("Érzékelők most", m.get_content())

    def test_email_ssl_465_and_from(self):
        mod, calls = self.fake_smtp()
        A.send_email(self.MSG, dict(ENV, SMTP_PORT="465", ALERT_EMAIL_FROM="f27@pelda.hu"), smtp=mod)
        self.assertEqual(calls[0][1:], ("SMTP_SSL", "smtp.pelda.hu", 465))
        self.assertNotIn(("starttls",), calls)
        self.assertEqual([c for c in calls if c[0] == "send"][0][1]["From"], "f27@pelda.hu")

    def test_whatsapp_get(self):
        seen = {}

        class R:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b"ok"

        def opener(req, timeout):
            seen["url"] = req.full_url
            return R()
        A.send_whatsapp(self.MSG, ENV, opener=opener)
        u = urllib.parse.urlparse(seen["url"])
        q = urllib.parse.parse_qs(u.query)
        self.assertEqual(u.netloc + u.path, "api.callmebot.com/whatsapp.php")
        self.assertEqual(q["phone"], ["+36301234567"])
        self.assertEqual(q["apikey"], ["998877"])
        self.assertEqual(q["text"], [self.MSG["plain"]])


class TestPublicOutput(Base):
    def test_main_prints_only_counts(self):
        hot = {"3": {"va_temperature": 392}, "8": {"doorcontact_state": True}, "P": {"switch_1": True}}
        self.set_devices(datetime.now(timezone.utc) - timedelta(minutes=15), **hot)
        # a hamis Tuya helyett: a gyűjtés hibát ad, a riasztás attól függetlenül lefut
        self.addCleanup(setattr, A, "SENDERS", A.SENDERS)
        A.SENDERS = dict(self.senders)
        tu = tuya_server([])
        tu.state["fail_list"] = True
        self.addCleanup(tu.close)
        envs = dict(ENV, TUYA_ACCESS_ID="id", TUYA_ACCESS_SECRET="sec", TUYA_ENDPOINT=tu.url, TUYA_UID=None,
                    SUPABASE_URL=self.sb.url, SUPABASE_SECRET_KEY=self.sb.secret, GITHUB_STEP_SUMMARY=None,
                    AIRBNB_ICAL_URL=None, BOOKING_ICAL_URL=None)
        from f27 import digest as DG
        self.addCleanup(setattr, DG, "send_email", DG.send_email)
        DG.send_email = lambda msg, environ: self.sent.append(("email", msg))
        self.addCleanup(setattr, C, "collect_weather", C.collect_weather)
        C.collect_weather = lambda sb: {"error": False, "note": "Időjárás: teszt."}
        self.sb.db["alert_state"]["temp_hi:3"] = {"rule_key": "temp_hi:3", "active": False, "last_sent": None, "last_text": None,
                                                  "since": (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()}
        with env(**envs):
            rc, out = run_main(C.main)
        self.assertIn("Riasztások: 1 aktív, 1 értesítés elküldve, 0 hiba.", out)
        self.assertRegex(out, r"Napi összefoglaló: (elküldve|nem kellett)\.")
        self.assertTrue(self.sent)
        for s in SECRETS + ["39,2", "Kályha mögött", "Kis szoba ablak", "F27 riasztás:", A.MAP_URL, "ntfy.sh"]:
            self.assertNotIn(s, out, f"a publikus kimenetben nem lehet: {s!r}")


if __name__ == "__main__":
    unittest.main()
