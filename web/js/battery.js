/* Elemcsere-előrejelzés a böngészőben (minden térkép: F27, O2B, a későbbiek is).

   Ugyanaz a modell, mint az adatgyűjtőé (f27/battery.py), de a dashboard maga számolja ki a
   device_status előzményből és a device_latest-ből, így akkor is működik, ha a battery_status tábla
   (008_battery.sql) még nincs meg, vagy az adatgyűjtő még nem írt bele.
   Ha a tábla van, eszközönként a sürgősebb becslés nyer (azonos szintnél a tábláé, mert az a korábbi
   cserékből tanult élettartamot is ismeri).

   Elemtípus a szerepkörből: Wi-Fi hőmérő (thermo) 2 × AAA alkáli, százalékot nem ad, csak
   high / middle / low szintet; Zigbee nyitásérzékelő (contact) és mozgásérzékelő (pir) CR2032, százalékkal.
   A merülés nem lineáris: a "térd" alatt gyorsabb, ezért a becslés mindig dátumtartomány.

   F27Battery.build(devs, latest, history, nowMs) -> [{ pink, label, level, eta_lo, eta_hi, value, basis, src }]
     devs:    [{ pink, role, label }], latest: { pink: { online, status } }, history: [{ pink, ts, status }]
   F27Battery.merge(tableRows, browserRows) -> eszközönként a sürgősebb
   F27Battery.fetchHistory(sb, pinks, days) -> Promise<[{ pink, ts, status }]>
   level: dead (lemerült) | offline (nem jelentkezik, valószínűleg elem kell) | due14 | due30 | ok | unknown */
(function (root) {
  'use strict';
  var CHEM = {
    AAA: { life: 150, dead: 10, knee: 40, kf: 1.6 },
    CR2032: { life: 365, dead: 10, knee: 30, kf: 2.5 }
  };
  var CHEM_BY_ROLE = { thermo: 'AAA', contact: 'CR2032', pir: 'CR2032' };
  var RANK = { low: 0, middle: 1, high: 2 };
  var JUMP = 25, DAY = 864e5;
  var ORDER = { dead: 0, offline: 1, due14: 2, due30: 3, ok: 4, unknown: 5 };

  function reading(st) {
    st = st || {};
    var codes = ['battery_percentage', 'va_battery', 'battery_value'];
    for (var i = 0; i < codes.length; i++) {
      var v = st[codes[i]];
      if (typeof v === 'number' && isFinite(v)) return { kind: 'pct', v: Math.max(0, Math.min(100, Math.round(v))) };
    }
    if (RANK[st.battery_state] != null) return { kind: 'state', v: st.battery_state };
    return null;
  }
  function dnum(iso) { return Math.round(Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') / DAY); }
  var FMT = null;
  function dayIso(ms) {                                   // budapesti naptári nap
    try {
      FMT = FMT || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' });
      return FMT.format(new Date(ms));
    } catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }

  // napi minta beírása csereészleléssel (f27/battery.py update)
  function update(row, kind, v, iso) {
    var s = row.samples, prev = s.length ? s[s.length - 1][1] : null, replaced = false;
    if (prev != null && kind === 'pct' && typeof prev === 'number') replaced = v >= prev + JUMP && v >= 60;
    else if (prev != null && kind === 'state' && RANK[prev] != null) replaced = RANK[v] > RANK[prev] && v === 'high';
    if (replaced) { row.changed = iso; row.samples = s = []; }
    if (s.length && s[s.length - 1][0] === iso) s[s.length - 1][1] = kind === 'pct' ? Math.min(s[s.length - 1][1], v) : v;
    else s.push([iso, v]);
    row.kind = kind;
  }

  function theilSen(pts) {
    var sl = [];
    for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
      var dx = pts[j][0] - pts[i][0];
      if (dx > 0) sl.push((pts[j][1] - pts[i][1]) / dx);
    }
    if (!sl.length) return null;
    sl.sort(function (a, b) { return a - b; });
    var n = sl.length;
    return n % 2 ? sl[n >> 1] : (sl[n / 2 - 1] + sl[n / 2]) / 2;
  }

  // (f27/battery.py forecast) + a böngészőben: offline elemes eszköz, ha nincs merülést mutató jel
  function forecast(row, chem, online, todayIso) {
    var p = CHEM[chem] || CHEM.AAA, s = row.samples, today = dnum(todayIso);
    if (!s.length) {
      if (online === false) return { level: 'offline', eta_lo: 0, eta_hi: 0, basis: 'nem jelentkezik, elemjelzés nincs', value: null };
      return { level: 'unknown', eta_lo: null, eta_hi: null, basis: 'nincs adat', value: null };
    }
    var value = s[s.length - 1][1], life = p.life, age = row.changed ? today - dnum(row.changed) : null, lo, hi, basis;
    if (row.kind === 'pct') {
      var pc = value;
      if (pc <= p.dead || (online === false && pc <= 20)) return { level: 'dead', eta_lo: 0, eta_hi: 0, basis: pc + '%', value: pc };
      var win = pc > p.knee ? 30 : 14;
      var pts = s.filter(function (x) { return today - dnum(x[0]) <= win; }).map(function (x) { return [dnum(x[0]) - today, x[1]]; });
      var slope = pts.length >= 2 && pts[pts.length - 1][0] - pts[0][0] >= 3 ? theilSen(pts) : null, rate, spread;
      if (slope != null && slope < 0) { rate = -slope; basis = 'mért merülés'; spread = 0.3; }
      else { rate = 90 / life; basis = 'elemprofil'; spread = 0.5; }
      var days = pc > p.knee ? (pc - p.knee) / rate + (p.knee - p.dead) / (rate * p.kf)
        : (pc - p.dead) / (rate * (basis === 'mért merülés' ? 1 : p.kf));
      lo = days * (1 - spread); hi = days * (1 + spread);
    } else if (value === 'low') {
      if (online === false) return { level: 'dead', eta_lo: 0, eta_hi: 0, basis: 'alacsony, offline', value: value };
      lo = 0; hi = 14; basis = 'alacsony szint';
    } else {
      if (online === false) return { level: 'offline', eta_lo: 0, eta_hi: 0, basis: 'nem jelentkezik (utoljára: ' + (value === 'middle' ? 'közepes' : 'magas') + ')', value: value };
      if (value === 'middle') {
        if (age != null) { lo = Math.max(0, 0.85 * life - age); hi = Math.max(lo + 7, 1.05 * life - age); }
        else { lo = 0.15 * life; hi = 0.35 * life; }
        basis = 'közepes szint';
      } else {
        if (age == null) return { level: 'ok', eta_lo: null, eta_hi: null, basis: 'magas szint, csere ideje ismeretlen', value: value };
        lo = Math.max(0, 0.85 * life - age); hi = Math.max(7, 1.2 * life - age); basis = 'elemprofil';
      }
    }
    lo = Math.round(lo); hi = Math.round(hi);
    return { level: lo <= 14 ? 'due14' : lo <= 30 ? 'due30' : 'ok', eta_lo: lo, eta_hi: hi, basis: basis, value: value };
  }

  function build(devs, latest, history, nowMs) {
    var now = nowMs || Date.now(), today = dayIso(now), by = {};
    (history || []).slice().sort(function (a, b) { return Date.parse(a.ts) - Date.parse(b.ts); }).forEach(function (h) {
      var r = reading(h.status); if (!r) return;
      var row = by[h.pink] = by[h.pink] || { samples: [], changed: null, kind: null };
      update(row, r.kind, r.v, dayIso(Date.parse(h.ts)));
    });
    var out = [];
    (devs || []).forEach(function (d) {
      var chem = CHEM_BY_ROLE[d.role]; if (!chem) return;
      var lt = (latest || {})[d.pink], row = by[d.pink] || { samples: [], changed: null, kind: null };
      var r = lt && reading(lt.status);
      if (r) update(row, r.kind, r.v, today);
      var fc = forecast(row, chem, lt ? lt.online : null, today);
      if (!lt && fc.level === 'unknown') return;           // még sosem jelentkezett: nincs mit mondani
      out.push({ pink: d.pink, label: d.label || d.pink, level: fc.level, eta_lo: fc.eta_lo, eta_hi: fc.eta_hi,
        value: fc.value, basis: fc.basis, chem: chem, src: 'browser' });
    });
    return out;
  }

  function merge(table, browser) {
    var m = {};
    (browser || []).forEach(function (r) { m[r.pink] = r; });
    (table || []).forEach(function (r) {
      var b = m[r.pink];
      if (!b || (ORDER[r.level] != null ? ORDER[r.level] : 9) <= (ORDER[b.level] != null ? ORDER[b.level] : 9)) m[r.pink] = Object.assign({}, b || {}, r, { src: 'table' });
    });
    return Object.keys(m).map(function (k) { return m[k]; });
  }

  // eszközönként egy kérés (óránként legfeljebb egy sor: 30 nap alatt 720 < 1000, a Supabase lapmérete)
  function fetchHistory(sb, pinks, days) {
    var since = new Date(Date.now() - (days || 30) * DAY).toISOString();
    return Promise.all((pinks || []).map(function (pk) {
      return sb.from('device_status').select('pink,ts,status').eq('pink', pk).gte('ts', since)
        .order('ts', { ascending: false }).limit(1000)
        .then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; });
    })).then(function (all) { return [].concat.apply([], all); });
  }

  // rövid szöveg a csempére és a listába
  function when(r, nowMs) {
    var day = function (n) { var d = new Date((nowMs || Date.now()) + n * DAY); return ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2) + '.'; };
    if (r.level === 'dead') return 'lemerült, cseréld most';
    if (r.level === 'offline') return 'nem jelentkezik, valószínűleg elem kell';
    if (r.eta_lo == null) return 'hamarosan';
    return r.eta_lo <= 0 ? 'bármikor, legkésőbb ' + day(r.eta_hi) : 'kb. ' + r.eta_lo + '-' + r.eta_hi + ' nap (' + day(r.eta_lo) + '-' + day(r.eta_hi) + ')';
  }
  // az elem szintje szövegben: százalék, ha az eszköz ad (Zigbee, mozgásérzékelő); a Wi-Fi hőmérők csak
  // magas / közepes / alacsony szintet jelentenek, ott a szint és „% nincs” (nem találunk ki százalékot) (2026.11.21)
  var LV = { high: 'magas', middle: 'közepes', low: 'alacsony' };
  function charge(r) {
    if (!r) return 'nincs elemadat';
    if (typeof r.value === 'number') return r.value + '%';
    if (LV[r.value]) return LV[r.value] + ' szint (% nincs)';
    return r.level === 'offline' ? 'nem jelentkezik' : 'nincs elemadat';
  }
  // teljes sor: szint + becsült hátralévő napok, pl. „45% · kb. 20-30 nap” vagy „közepes szint (% nincs) · kb. 40-60 nap”
  function full(r, nowMs) {
    if (!r) return 'nincs elemadat';
    var c = charge(r);
    if (r.level === 'dead') return (typeof r.value === 'number' ? r.value + '%, ' : '') + 'lemerült, cseréld most';
    if (r.level === 'offline') return 'nem jelentkezik' + (LV[r.value] ? ' (utoljára ' + LV[r.value] + ' szint)' : '') + ', valószínűleg elem kell';
    if (r.eta_lo == null) return c + ' · becslés még nincs (kevés adat)';
    var n = r.eta_lo <= 0 ? 'bármikor, legfeljebb ' + Math.max(1, r.eta_hi) + ' nap' : 'kb. ' + r.eta_lo + '-' + r.eta_hi + ' nap';
    return c + ' · ' + n;
  }
  function due(rows) {
    return (rows || []).filter(function (r) { return ORDER[r.level] != null && ORDER[r.level] <= 3; })
      .sort(function (a, b) { return ORDER[a.level] - ORDER[b.level] || (a.eta_lo || 0) - (b.eta_lo || 0); });
  }

  root.F27Battery = { build: build, merge: merge, fetchHistory: fetchHistory, forecast: forecast, reading: reading,
    when: when, due: due, charge: charge, full: full, ORDER: ORDER, CHEM_BY_ROLE: CHEM_BY_ROLE };
})(typeof window !== 'undefined' ? window : this);
