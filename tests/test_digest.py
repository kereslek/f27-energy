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
from f27 import report_stats as RS
from f27 import weather as WE
from f27.supa import SupabaseRest
from tests.test_alerts import ENV, SECRETS, devices
from tests.test_pipeline import supa_server

# 2026.11.08 vasárnap, téli idő: Budapest = UTC+1
AT = lambda h, m=0, d=8: datetime(2026, 11, d, h - 1, m, tzinfo=timezone.utc) if h >= 1 else datetime(2026, 11, d - 1, 23, m, tzinfo=timezone.utc)


def fake_archive(start, end):
    """Open-Meteo archív helyett: tavaly minden nap 5,0 °C (a tesztek nem mennek ki a hálózatra)."""
    d, out = datetime.fromisoformat(start).date(), {}
    while d <= datetime.fromisoformat(end).date():
        out[d.isoformat()] = 5.0
        d += timedelta(days=1)
    return out


class TestDigest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._arch = WE.archive_daily
        WE.archive_daily = fake_archive

    @classmethod
    def tearDownClass(cls):
        WE.archive_daily = cls._arch

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
        self.assertEqual(r["new"][0]["subject"], "▓▒░ F27·NRG ░▒▓ 11.08 V » napi jelentés")
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
        self.assertEqual(self.run_at(AT(20, 0, d=9))["new"][0]["subject"], "▓▒░ F27·NRG ░▒▓ 11.09 H » napi jelentés")

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
        self.assertNotIn("lekapcsolható (csak javaslat).\n- A kályha", body)
        self.assertNotIn("pedig ma éjjel nincs vendég", body)        # holnap érkezik vendég
        # zárt, régóta hallgató nyílászáró: nem hír (a tulaj kérése); nyitva + régóta hallgat: igen
        db["alert_log"] = [x for x in db["alert_log"] if x["kind"] != "digest"]
        r = self.run_at(AT(20, 5, d=1), **{"5": {"age_min": 57 * 60}, "6": {"age_min": 57 * 60}, "9": {"age_min": 57 * 60},
                                            "10": {"doorcontact_state": True, "age_min": 30 * 60}})
        body = r["new"][0]["email_body"]
        self.assertNotIn("Régóta hallgat", body)
        self.assertIn("- Nyitva jelez, de 30 órája nem jelentett (lehet régi jelzés): Nagy szoba jobb ablak", body.splitlines())
        # ugyanez üres lakással: kályha-javaslat, bojler-javaslat
        db["bookings"].clear()
        db["alert_log"] = [x for x in db["alert_log"] if x["kind"] != "digest"]
        # a mérés dönt: a kapcsoló BE, de 0 W (feltöltött) -> "most nem fűt", mégis lekapcsolható
        r = self.run_at(AT(20, 10, d=8), **{"P": {"switch_1": True}})
        body = r["new"][0]["email_body"]
        self.assertIn("- A kályha most nem fűt (feltöltött), de a kapcsolója BE: ha lehűl, magától újra tölt. "
                      "Ma éjjel nincs vendég és holnap sem érkezik: lekapcsolható (csak javaslat).", body.splitlines())
        self.assertIn("- Kályha most: BE, de nem fűt (feltöltött)", body.splitlines())
        db["alert_log"] = [x for x in db["alert_log"] if x["kind"] != "digest"]
        r = self.run_at(AT(20, 15, d=8), **{"P": {"switch_1": True}, "X5": {"cur_power": 9950}})
        body = r["new"][0]["email_body"]
        self.assertIn("- A kályha most fűt (995 W), pedig ma éjjel nincs vendég és holnap sem érkezik: lekapcsolható (csak javaslat).", body.splitlines())
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
        self.assertEqual(sent[0]["Subject"], "▓▒░ F27·NRG ░▒▓ 11.08 V » napi jelentés")
        self.assertIn("TEENDŐK", sent[0].get_body(("plain",)).get_content())
        html_part = sent[0].get_body(("html",)).get_content()
        self.assertIn("monospace", html_part)                     # fix szélesség: a táblázat nem csúszik szét
        self.assertIn("F27://bp-ix", html_part)


class TestDigestStats(unittest.TestCase):
    """Az esti levél statisztikája: ASCII-táblázat, ugyanaddig az óráig számolt összevetés,
    órás oszlopsor, hőmérők, ajtónyitások, előző hónap az app előzményéből, ASCII-kép, HTML."""

    def setUp(self):
        self.sb = supa_server(history=True)
        for p in ("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "P", "X5", "X7", "X8", "X9", "G"):
            self.sb.db["devices"][p] = {"pink": p, "meta": None}
        self.mails, self.boom = [], None
        mh = self.sb.db["metrics_hourly"]
        # 8 nap kályha: óránként 1,05 kWh, ma 20:00-ig (Budapest), tegnap ugyanígy, de ma 0-5 óra között 0
        for k in range(0, 9):
            day0 = datetime(2026, 11, 8, 0, 0, tzinfo=timezone.utc) - timedelta(days=k, hours=1)   # budapesti éjfél
            for hh in range(24):
                t = day0 + timedelta(hours=hh)
                if t >= AT(20, 0):
                    break
                kwh = 0.0 if (k == 0 and hh < 6) else 1.05
                mh[("X5", t.isoformat())] = {"pink": "X5", "hour": t.isoformat(), "kwh": kwh, "w_max": 1000.0}
                mh[("X7", t.isoformat())] = {"pink": "X7", "hour": t.isoformat(), "kwh": 0.1, "w_max": 1800.0}
                if k <= 1:
                    mh[("2", t.isoformat())] = {"pink": "2", "hour": t.isoformat(), "temp_avg": 21.0 + k, "temp_min": 20.5 + k,
                                                "temp_max": 21.5 + k, "hum_avg": 45}
        self.sb.db["energy_app_history"].append({"pink": "X5", "period": "month", "period_start": "2026-10-01T00:00:00+02:00",
                                                 "kwh": 310.0, "exact": False})
        self.sb.db["weather_daily"] = [{"day": f"2026-11-0{d}", "t_avg": 8.0, "hdd": 10.0} for d in range(1, 9)]
        self.door = [{"pink": "5", "ts": AT(h, 0).isoformat(), "online": True, "status": {"doorcontact_state": o, "_src": "log"}}
                     for h, o in ((9, True), (10, False), (15, True), (16, False))]

    setUpClass = TestDigest.setUpClass
    tearDownClass = TestDigest.tearDownClass
    tearDown = TestDigest.tearDown
    sender = TestDigest.sender

    def run_at(self, now, environ=None, **o):
        self.sb.db["device_status"] = devices(now, **o) + self.door
        n = len(self.mails)
        r = DG.run_digest(SupabaseRest(self.sb.url, self.sb.secret), now=now,
                          environ=ENV if environ is None else environ, sender=self.sender)
        r["new"] = self.mails[n:]
        return r

    def test_stats_boxes_fit_a_phone(self):
        r = self.run_at(AT(20, 0))
        body = r["new"][0]["email_body"]
        lines = body.splitlines()
        self.assertTrue(lines[0].startswith(" ▄▄▄▄"))                                     # warez/NFO fejléc
        self.assertIn("ReLEASE f27.napi.jelentes.2026.11.08", body)
        self.assertIn(">> DASHBOARD: https://kereslek.github.io/f27-energy/", body)
        # telefon: minden doboz- és logósor legfeljebb 44 karakter
        art = [l for l in lines if l[:2].strip()[:1] in set("▄▀░╔║╚┌│└") or l.startswith("  ▄") or l.startswith("  █")]
        self.assertTrue(art and max(len(l) for l in art) <= 44, max(art, key=len))
        # ma 0-20 óra: 6 óra 0 + 14 óra 1,05 = 14,7; tegnap ugyaneddig 20 x 1,05 = 21,0; DoD -30 %
        self.assertIn("│ ma eddig    14,7 kWh   ~895 Ft", body)
        self.assertIn("│ tegnap*     21,0 kWh   DoD -30 %", body)
        self.assertIn("│ 7n átl*     21,0 kWh   vs  -30 %", body)
        self.assertIn("│ tegnap      25,2 kWh   egész nap", body)
        self.assertIn("│ 0h|      @@@@@@@@@@@@@@    |23h", body)                      # 0-5 óra: 0 kWh
        self.assertIn("14 óra >0,3 kWh", body)
        self.assertIn("│ Nagy szoba    20,5|21,0|21,5  -1,0", body)
        self.assertIn("│ Fürdő           --|  --|  --    --", body)                    # hiányzó adatnál sem csúszik el
        self.assertIn("bejárati ajtó: ma 2, tegnap 0", body)
        self.assertIn("│ Kályha  24,4 vs  10,0  +144 %", body)                          # előző hónap (app)
        self.assertIn("TiPP · KLÍMA vs KÁLYHA", body)
        self.assertIn("│ B-keret ", body)
        self.assertIn("JELMAGYARÁZAT", body)
        # YoY: nov. 1-7. mért B (kályha 25,2 + bojler 2,4 = 27,6 kWh/nap) vs tavaly a 2025.09.10-2026.01.13
        # mérőállások átlaga (1815 kWh / 125 nap = 14,5); kint 8,0 vs 5,0 °C (hőfokhíd 10 vs 13)
        self.assertIn("YoY · TAVALY UGYANEKKOR", body)
        self.assertIn("│ napok     11.01-11.07 (7 nap)", body)
        self.assertIn("│ B idén     27,6 kWh/nap (mért)", body)
        self.assertIn("│ B tavaly   14,5 kWh/nap*", body)
        self.assertIn("│ YoY       +90 %  (kályha + bojler)", body)
        self.assertIn("│ kint      8,0 vs 5,0 °C (idén/tavaly)", body)
        self.assertIn("│ kWh/fok   2,76 vs 1,12  +147 %", body)
        self.assertIn("│ * mérőállás 2025.09.10-01.13 átlag", body)
        # tárgysor: ma 0-20 óra kályha 14,7 + bojler 2,0; tegnap ugyaneddig 21,0 + 2,0
        self.assertEqual(r["new"][0]["subject"], "▓▒░ F27·NRG ░▒▓ 11.08 V » 16,7 kWh » ~1 017 Ft » ▼27% DoD")
        boxed = [l for l in lines if l.startswith("│ ")]
        self.assertFalse([l for l in boxed if l.startswith("│   ") and not l.startswith("│    ")], "nincs tördelt sor a dobozokban")
        self.assertNotIn("\u2014", body)
        self.assertNotIn("\u2013", body)
        html_part = r["new"][0]["email_html"]
        self.assertEqual(html_part.count('href="https://kereslek.github.io/f27-energy/"'), 2)   # gomb felül és alul
        self.assertIn("pre-wrap", html_part)
        self.assertIn("#39ff14", html_part)
        with open(__import__("os").environ.get("F27_DIGEST_PREVIEW", "/dev/null"), "w", encoding="utf-8") as f:
            f.write(body)

    def test_weekly_gadget_reminder_on_sunday_only(self):
        body = self.run_at(AT(20, 0))["new"][0]["email_body"]              # nov. 8. vasárnap
        self.assertIn("OKOS ESZKÖZÖK · EMLÉKEZTETŐ", body)
        self.assertIn("robotporszívó", body)
        art = [l for l in body.splitlines() if l[:1] in "┌│└"]
        self.assertLessEqual(max(len(l) for l in art), 44)
        self.sb.db["alert_log"].clear()
        body = self.run_at(AT(20, 0, d=9))["new"][0]["email_body"]         # hétfő
        self.assertNotIn("OKOS ESZKÖZÖK", body)

    def test_archive_outage_does_not_block_the_mail(self):
        def boom(a, b):
            raise OSError("hálózat")
        WE.archive_daily = boom
        try:
            body = self.run_at(AT(20, 0))["new"][0]["email_body"]
        finally:
            WE.archive_daily = fake_archive
        self.assertNotIn("YoY · TAVALY", body)
        self.assertIn("JELMAGYARÁZAT", body)

    def test_meter_rate_picks_tightest_valid_bracket(self):
        m = [{"date": "2025-02-15", "B": 100}, {"date": "2025-09-10", "B": 300}, {"date": "2025-10-01", "A1": 5, "B": None},
             {"date": "2026-01-13", "B": 550}]
        from datetime import date
        r = RS.meter_rate(m, "B", date(2025, 11, 1), date(2025, 11, 7))
        self.assertEqual((round(r[0], 3), r[1].isoformat(), r[2].isoformat()), (2.0, "2025-09-10", "2026-01-13"))
        self.assertIsNone(RS.meter_rate(m, "B", date(2026, 11, 1), date(2026, 11, 7)))

    def test_without_migration_note(self):
        self.sb.db.pop("metrics_hourly")
        body = self.run_at(AT(20, 0))["new"][0]["email_body"]
        self.assertIn("nincs adat (metrics_hourly:", body)
        self.assertIn("007_history.sql", body)


if __name__ == "__main__":
    unittest.main()
