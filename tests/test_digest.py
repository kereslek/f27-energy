"""Offline tesztek a napi e-mail összefoglalóhoz (f27.digest): naponta legfeljebb egy levél,
20:00 előtt nem, kimaradt kör után pótol, éjfél után már nem, a tartalom részei, kikapcsolás,
hiányzó beállítás vagy tábla, SMTP-hiba, és hogy a publikus megjegyzésbe ne kerüljön érték.

Futtatás a repó gyökeréből:  python -m unittest discover -s tests -v
"""

from __future__ import annotations

import smtplib
import unittest
from datetime import datetime, timedelta, timezone

from f27 import alerts as A
from f27 import digest as DG
from f27.supa import SupabaseRest
from tests.test_alerts import ENV, SECRETS, devices
from tests.test_pipeline import supa_server

# 2026.11.08 vasárnap, téli idő: Budapest = UTC+1
AT = lambda h, m=0, d=8: datetime(2026, 11, d, h - 1, m, tzinfo=timezone.utc) if h >= 1 else datetime(2026, 11, d - 1, 23, m, tzinfo=timezone.utc)


class TestDigest(unittest.TestCase):
    def setUp(self):
        self.sb = supa_server()
        for p in ("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "P", "X5", "X7", "X8", "X9", "G"):
            self.sb.db["devices"][p] = {"pink": p, "meta": None}
        self.mails = []
        self.boom = None

    def tearDown(self):
        self.sb.close()

    def sender(self, msg, environ):
        if self.boom:
            raise self.boom
        self.mails.append(msg)

    def run_at(self, now, environ=None, **o):
        self.sb.db["device_status"] = devices(now, **o)
        n = len(self.mails)
        r = DG.run_digest(SupabaseRest(self.sb.url, self.sb.secret), now=now,
                          environ=ENV if environ is None else environ, sender=self.sender)
        r["new"] = self.mails[n:]
        return r

    def test_once_a_day_at_20(self):
        self.assertEqual(self.run_at(AT(19, 50))["new"], [])
        self.assertEqual(self.run_at(AT(19, 50))["note"], "Napi összefoglaló: nem kellett.")
        r = self.run_at(AT(20, 0))
        self.assertEqual(len(r["new"]), 1)
        self.assertEqual(r["note"], "Napi összefoglaló: elküldve.")
        self.assertEqual(r["new"][0]["subject"], "F27 napi összefoglaló, nov. 8. vasárnap")
        log = self.sb.db["alert_log"][-1]
        self.assertEqual((log["kind"], log["rule_key"], log["channels"]), ("digest", "digest:2026-11-08", "email"))
        for m in (10, 20, 50):
            self.assertEqual(self.run_at(AT(20, m))["new"], [], "naponta legfeljebb egy")
        self.assertEqual(self.run_at(AT(23, 55))["new"], [])

    def test_missed_round_catches_up_but_not_after_midnight(self):
        r = self.run_at(AT(21, 40))                                   # a 20:00-s kör elmaradt
        self.assertEqual(len(r["new"]), 1)
        self.sb.db["alert_log"].clear()
        r = self.run_at(AT(0, 5, d=9))                                # éjfél után: már a 9-e, még nincs 20:00
        self.assertEqual(r["new"], [])
        self.assertEqual(self.run_at(AT(20, 0, d=9))["new"][0]["subject"], "F27 napi összefoglaló, nov. 9. hétfő")

    def test_time_setting_and_off(self):
        self.sb.db["alert_settings"][1] = {"id": 1, "config": {"digest": {"on": True, "time": "18:00"}}}
        self.assertEqual(self.run_at(AT(17, 50))["new"], [])
        self.assertEqual(len(self.run_at(AT(18, 0))["new"]), 1)
        self.sb.db["alert_log"].clear()
        self.sb.db["alert_settings"][1]["config"] = {"digest": {"on": False, "time": "20:00"}}
        r = self.run_at(AT(20, 30))
        self.assertEqual((r["new"], r["note"]), ([], "Napi összefoglaló: kikapcsolva."))

    def test_without_smtp_or_table(self):
        r = self.run_at(AT(20, 0), environ={"NTFY_TOPIC": "x"})
        self.assertEqual(r["new"], [])
        self.assertIn("nincs beállított e-mail", r["note"])
        sb2 = supa_server(no_tables=("alert_settings",))
        try:
            r = DG.run_digest(SupabaseRest(sb2.url, sb2.secret), now=AT(20, 0), environ=ENV, sender=self.sender)
        finally:
            sb2.close()
        self.assertIn("supabase/migrations/006_alerts.sql", r["note"])
        self.assertEqual(self.mails, [])

    def test_smtp_error_is_retried_and_hidden(self):
        self.boom = smtplib.SMTPAuthenticationError(535, b"tulaj@pelda.hu jelszo-1234 rossz")
        r = self.run_at(AT(20, 0))
        self.assertTrue(r["error"])
        self.assertEqual(r["note"], "Napi összefoglaló: hiba (SMTPAuthenticationError).")
        self.assertEqual(self.sb.db["alert_log"], [])
        self.boom = None
        self.assertEqual(len(self.run_at(AT(20, 10))["new"]), 1)     # a következő kör pótolja

    def test_content_sections(self):
        db = self.sb.db
        db["alert_log"] += [
            {"id": 1, "ts": AT(14, 2).isoformat(), "rule_key": "temp_hi:3", "kind": "fired", "text": "F27 riasztás: Kályha mögött 39,2 °C (határ 38 °C).", "channels": "push"},
            {"id": 2, "ts": AT(14, 32).isoformat(), "rule_key": "temp_hi:3", "kind": "resolved", "text": "F27: megszűnt: Kályha mögött 36,0 °C (határ 38 °C).", "channels": "push"},
            {"id": 3, "ts": AT(1, 10).isoformat(), "rule_key": "temp_hi:2", "kind": "fired", "text": "F27 riasztás: Nagy szoba 23,0 °C (határ 22 °C).", "channels": "visszatartva: csendes órák"},
            {"id": 4, "ts": AT(9, 0, d=7).isoformat(), "rule_key": "temp_lo:1", "kind": "fired", "text": "tegnapi", "channels": "push"},
        ]
        db["alert_state"]["open_heat:8"] = {"rule_key": "open_heat:8", "active": True, "last_text": "F27: ablak nyitva fűtés közben: Kis szoba ablak 20 perce, közben a kályha 1 kW-on."}
        db["energy_daily"][("2026-11-08", "X5")] = {"day": "2026-11-08", "pink": "X5", "kwh": 12.3}
        db["energy_daily"][("2026-11-08", "X9")] = {"day": "2026-11-08", "pink": "X9", "kwh": 2.0}
        db["energy_daily"][("2026-11-07", "X7")] = {"day": "2026-11-07", "pink": "X7", "kwh": 5.0}
        db["weather_daily"] = [{"day": "2026-11-08", "t_avg": 6.1}]
        db["bookings"]["a"] = {"id": "a", "source": "airbnb", "kind": "reservation", "start_date": "2026-11-09", "end_date": "2026-11-12", "seen_at": "x"}
        r = self.run_at(AT(20, 0), **{"8": {"doorcontact_state": True}, "7": {"battery_percentage": 15},
                                      "4": {"online": False}, "1": {"age_min": 8 * 60},
                                      "P": {"switch_1": True}, "X5": {"cur_power": 9950}, "X7": {"switch": False}})
        body = r["new"][0]["email_body"]
        order = [body.index(h) for h in ("MA TÖRTÉNT", "TEENDŐK", "HOLNAP (nov. 9. hétfő)", "MAI FOGYASZTÁS", "ÉRZÉKELŐK MOST", "Térkép: " + A.MAP_URL)]
        self.assertEqual(order, sorted(order))
        for line in ("- 14:02 Riasztás: F27 riasztás: Kályha mögött 39,2 °C (határ 38 °C).",
                     "- 14:32 Megszűnt: F27: megszűnt: Kályha mögött 36,0 °C (határ 38 °C).",
                     "- 01:10 Riasztás: F27 riasztás: Nagy szoba 23,0 °C (határ 22 °C). (nem ment ki: csendes órák)",
                     "- Aktív riasztás: F27: ablak nyitva fűtés közben: Kis szoba ablak 20 perce, közben a kályha 1 kW-on.",
                     "- Nyitva: Kis szoba ablak", "- Elem merül (15 %): Konyha ablak", "- Nem elérhető: Hőmérő, fürdő",
                     "- Régóta hallgat (8 órája): Hőmérő, kis szoba",
                     "- Holnap érkezik vendég, de a bojler (7-es kör) le van kapcsolva: legkésőbb holnap 12:00-kor kapcsold vissza.",
                     "- Érkezés 15:00 (Airbnb-foglalás), felfűtés 12:00-tól",
                     "- Kályha (5-ös kör): 12,3 kWh, kb. 749 Ft", "- Bojler (7-es kör): nincs adat",
                     "- Klíma (9-es kör): 2,0 kWh, kb. 72-140 Ft", "- Összesen: kb. 821-889 Ft",
                     "- Kint ma átlagosan 6,1 °C", "- Kályhakapcsoló: 1/3 fokozat"):
            self.assertIn(line, body.splitlines())
        self.assertNotIn("tegnapi", body)
        self.assertNotIn("A kályha megy, pedig", body)               # holnap érkezik vendég
        # ugyanez üres lakással: kályha-javaslat, bojler-javaslat
        db["bookings"].clear()
        db["alert_log"] = [x for x in db["alert_log"] if x["kind"] != "digest"]
        r = self.run_at(AT(20, 10, d=8), **{"P": {"switch_1": True}})
        body = r["new"][0]["email_body"]
        self.assertIn("- A kályha megy, pedig ma éjjel nincs vendég és holnap sem érkezik: lekapcsolható (csak javaslat).", body.splitlines())
        self.assertIn("- Ma éjjel nincs vendég és holnap sem érkezik: a bojler (7-es kör) lekapcsolható (csak javaslat).", body.splitlines())
        self.assertIn("- Se érkezés, se távozás.", body.splitlines())

    def test_quiet_day_and_public_note(self):
        r = self.run_at(AT(20, 0), **{"X7": {"switch": False}})
        body = r["new"][0]["email_body"]
        self.assertIn("- Nem volt riasztás.", body.splitlines())
        self.assertIn("- Nincs teendő.", body.splitlines())
        self.assertIn("- Se érkezés, se távozás.", body.splitlines())
        for s in SECRETS + ["21,4", "Kis szoba", "°C", "kWh"]:
            self.assertNotIn(s, r["note"])

    def test_email_is_built_for_smtp(self):
        """A teljes út: a levél az SMTP-küldőn át (hamis smtplib), a próba és a riasztás nem e-mail."""
        sent = []

        class S:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def ehlo(self):
                pass

            def starttls(self, context=None):
                pass

            def login(self, u, p):
                pass

            def send_message(self, m):
                sent.append(m)
        mod = type("M", (), {"SMTP": S, "SMTP_SSL": S})
        self.sender = lambda msg, environ: A.send_email(msg, environ, smtp=mod)
        self.run_at(AT(20, 0))
        self.assertEqual(sent[0]["Subject"], "F27 napi összefoglaló, nov. 8. vasárnap")
        self.assertIn("TEENDŐK", sent[0].get_content())


if __name__ == "__main__":
    unittest.main()
