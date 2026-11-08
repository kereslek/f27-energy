/*
 * F27 Energy Quest, élő térkép: a G3 jelenet + Supabase (bejelentkezés, mentett
 * elrendezések, élő eszközállapot), visszavonás/újra, értesítések.
 *
 * Supabase nélkül (nincs config.js vagy nincs bejelentkezve) a térkép demó módban fut:
 * minden működik, csak a mentés nem.
 */
(function () {
  'use strict';

  var PIN_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'P', 'k5', 'k7', 'k8', 'k9', 'G'];
  var PIN_TO_DB = { k5: 'X5', k7: 'X7', k8: 'X8', k9: 'X9' };   // devices.pink a Supabase-ben
  var CONTACTS = ['5', '6', '7', '8', '9', '10'];
  var ROLE = {
    owner: { label: 'TULAJ', color: '#2f6fe4' },
    cleaner: { label: 'TAKARÍTÓ', color: '#3fae6a' },
    viewer: { label: 'MEGTEKINTŐ', color: '#7a6fb0' }
  };
  var HISTORY_MAX = 60;
  var LIVE_REFRESH_MS = 60000;

  // ---- élő napszak: a nap állása Budapest felett ------------------------------------
  // Egyszerűsített NOAA / csillagászati almanach képlet (néhány tized fok pontosság),
  // a helyi idő kiírása az Intl-lel, így a nyári időszámítás is helyes.

  var BUD_LAT = 47.4979, BUD_LON = 19.0402, RAD = Math.PI / 180;

  function sunElevation(ms) {
    var n = ms / 86400000 + 2440587.5 - 2451545.0;
    var L = (280.460 + 0.9856474 * n) % 360;
    var g = ((357.528 + 0.9856003 * n) % 360) * RAD;
    var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    var eps = (23.439 - 0.0000004 * n) * RAD;
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    var gmst = (18.697374558 + 24.06570982441908 * n) % 24;
    var ha = ((gmst + BUD_LON / 15) * 15 - ra) * RAD;
    var lat = BUD_LAT * RAD;
    var el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / RAD;
    var hn = Math.atan2(Math.sin(ha), Math.cos(ha));        // óraszög -pi..pi: negatív = délelőtt
    return { el: el, morning: hn < 0 };
  }

  var BUD_FMT = null;
  function budTime(ms) {
    try {
      if (!BUD_FMT) BUD_FMT = new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hour12: false });
      return BUD_FMT.format(new Date(ms)).replace(/\s/g, '');
    } catch (e) { return hhmm(new Date(ms).toISOString()); }
  }

  // Napkelte és napnyugta (felső perem a látóhatáron, -0,833 fok) a megadott időpont napján.
  function sunTimes(ms) {
    var day = Math.floor(ms / 86400000) * 86400000, rise = null, set = null, prev = sunElevation(day).el;
    for (var t = day + 300000; t <= day + 86400000; t += 300000) {
      var e = sunElevation(t).el;
      if (prev < -0.833 && e >= -0.833 && rise == null) rise = t;
      if (prev >= -0.833 && e < -0.833 && set == null) set = t;
      prev = e;
    }
    return { rise: rise, set: set };
  }

  function hex2rgb(h) { var v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function mixHex(a, b, t) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return '#' + x.map(function (c, i) { var v = Math.round(c + (y[i] - c) * t); return ('0' + v.toString(16)).slice(-2); }).join('');
  }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  var SKY_COLORS = ['sky0', 'sky1', 'sky2', 'sunC', 'city', 'cityWin', 'glass', 'tree1', 'tree2'];
  var SKY_NUMS = ['starOp', 'cloudOp', 'glow', 'lampOp'];
  function mixLook(a, b, t) {
    var o = {};
    SKY_COLORS.forEach(function (k) { o[k] = mixHex(a[k], b[k], t); });
    SKY_NUMS.forEach(function (k) { o[k] = a[k] + (b[k] - a[k]) * t; });
    return o;
  }

  // A nappali, az alkonyati és az éjszakai kép a meglévő szintekből jön (1-1 Ősz, 1-3 Téli este,
  // 1-4 éjszaka). Napmagasság szerint: >= 8 fok nappal, -3 fok körül alkony, -18 fok alatt éjszaka.
  function liveSky(LV, ms) {
    var s = sunElevation(ms), el = s.el;
    var day = LV[0], dusk = LV[2], night = LV[3], look;
    if (el >= -3) look = mixLook(dusk, day, smooth((el + 3) / 11));
    else look = mixLook(dusk, night, smooth((-3 - el) / 15));
    // a korong: napként lemegy a látóhatárra és elhalványul, holdként fent jelenik meg
    if (el >= -4) {
      look.sunY = Math.round(150 + 180 * (1 - clamp01((el + 1) / 30)));
      look.sunOp = Math.round(clamp01((el + 4) / 3) * 100) / 100;
    } else {
      look.sunY = 150;
      look.sunC = night.sunC;
      look.sunOp = Math.round(clamp01((-4 - el) / 6) * 100) / 100;
    }
    var phase = el >= 6 ? 'nappal' : el < -18 ? 'éjszaka' : s.morning ? 'hajnal' : 'alkonyat';
    return { look: look, phase: phase, el: el };
  }

  // ---- segédfüggvények -------------------------------------------------------------

  function r1(n) { return Math.round(n * 10) / 10; }
  function dbPink(pin) { return PIN_TO_DB[pin] || pin; }

  // ---- "Emlékezz rám": a Supabase munkamenet tárolója ---------------------------------------
  // Bekapcsolva a munkamenet a localStorage-ba kerül (a böngésző bezárása után is megmarad),
  // kikapcsolva a sessionStorage-ba (a lap bezárásával elvész). Csak a beállítás (igen/nem)
  // kerül a localStorage-ba. Ha a tároló nem elérhető (privát mód), memóriában tartjuk.
  var REMEMBER_KEY = 'f27-remember';
  function probeStore(name) {
    try { var s = window[name], k = '__f27_probe'; s.setItem(k, '1'); s.removeItem(k); return s; } catch (e) { return null; }
  }
  var LOCAL = probeStore('localStorage'), SESSION = probeStore('sessionStorage'), MEM = {};
  function sGet(st, k) { try { return st ? st.getItem(k) : null; } catch (e) { return null; } }
  function sSet(st, k, v) { try { if (st) { st.setItem(k, v); return true; } } catch (e) { /* tele vagy tiltott */ } return false; }
  function sDel(st, k) { try { if (st) st.removeItem(k); } catch (e) { /* tiltott */ } }
  var authStore = {
    remember: sGet(LOCAL, REMEMBER_KEY) !== '0',
    setRemember: function (on) { this.remember = !!on; sSet(LOCAL, REMEMBER_KEY, on ? '1' : '0'); },
    primary: function () { return this.remember ? LOCAL : SESSION; },
    other: function () { return this.remember ? SESSION : LOCAL; },
    getItem: function (k) {
      var v = sGet(this.primary(), k);
      if (v == null) v = sGet(this.other(), k);
      return v == null ? (Object.prototype.hasOwnProperty.call(MEM, k) ? MEM[k] : null) : v;
    },
    setItem: function (k, v) {
      if (sSet(this.primary(), k, v)) delete MEM[k]; else MEM[k] = v;
      sDel(this.other(), k);
    },
    removeItem: function (k) { sDel(LOCAL, k); sDel(SESSION, k); delete MEM[k]; },
    // kilépéskor: minden Supabase munkamenet-kulcs törlése mindkét tárolóból
    clearAuth: function () {
      [LOCAL, SESSION].forEach(function (st) {
        if (!st) return;
        try { for (var i = st.length - 1; i >= 0; i--) { var k = st.key(i); if (k && /^sb-.*-auth-token/.test(k)) st.removeItem(k); } } catch (e) { /* tiltott */ }
      });
      MEM = {};
    }
  };
  function hhmm(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return '';
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function dateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2) + ' ' + hhmm(iso);
  }

  // A pozíciók kanonikus szöveges alakja (rendezett kulcsok, 0,1 pontosság): ezzel
  // vetjük össze a mentett és a jelenlegi állapotot, és ezt tárolja a visszavonás.
  function posKey(pos) {
    var keys = Object.keys(pos || {}).sort(), out = {};
    keys.forEach(function (k) {
      var v = pos[k];
      if (!v || (Math.abs(v[0]) < 0.05 && Math.abs(v[1]) < 0.05)) return;
      out[k] = [r1(v[0]), r1(v[1])];
    });
    return JSON.stringify(out);
  }

  function layoutFromPos(pos) {
    var data = { version: 1, pieces: {}, pins: {} }, p = JSON.parse(posKey(pos));
    Object.keys(p).forEach(function (k) {
      if (k.charAt(0) === 'd' && PIN_IDS.indexOf(k.slice(1)) >= 0) data.pins[k.slice(1)] = p[k];
      else data.pieces[k] = p[k];
    });
    return data;
  }

  function posFromLayout(data, pieceIds) {
    var pos = {};
    function ok(v) { return Array.isArray(v) && v.length === 2 && isFinite(v[0]) && isFinite(v[1]); }
    function clamp(v, m) { return Math.max(-m, Math.min(m, Number(v))); }
    if (!data || typeof data !== 'object') return pos;
    Object.keys(data.pieces || {}).forEach(function (k) {
      if (pieceIds[k] && ok(data.pieces[k])) pos[k] = [clamp(data.pieces[k][0], 700), clamp(data.pieces[k][1], 700)];
    });
    Object.keys(data.pins || {}).forEach(function (k) {
      if (PIN_IDS.indexOf(k) >= 0 && ok(data.pins[k])) pos['d' + k] = [clamp(data.pins[k][0], 560), clamp(data.pins[k][1], 500)];
    });
    return pos;
  }

  // ---- élő értékek a Tuya státuszból (public.device_latest) ------------------------------

  // A Tuya specifikáció skálája (public.devices.meta, csak a tulaj látja): érték / 10^scale.
  function metaScale(meta, code) {
    var m = meta && meta[code];
    return m && typeof m.scale === 'number' && isFinite(m.scale) ? m.scale : null;
  }
  function liveTemp(st, meta) {
    var codes = ['va_temperature', 'temp_current', 'temperature'];
    for (var i = 0; i < codes.length; i++) {
      var v = st[codes[i]];
      if (typeof v !== 'number') continue;
      var sc = metaScale(meta, codes[i]);
      if (sc != null) return v / Math.pow(10, sc);
      return Number.isInteger(v) && Math.abs(v) > 60 ? v / 10 : v;
    }
    return null;
  }
  function liveOpen(st) {
    var v = st.doorcontact_state != null ? st.doorcontact_state : st.contact_state;
    return v == null ? null : !!v;
  }
  // Okos kismegszakító teljesítménye wattban. A skála a specifikációból jön (devices.meta);
  // ha az nem elérhető, a szokásos dlq skála: cur_power 0,1 W egységben (scale 1).
  // Ha csak phase_a van, a base64 csomag 6-8. bájtja a teljesítmény (W).
  function livePower(st, meta) {
    if (typeof st.cur_power === 'number') {
      var sc = metaScale(meta, 'cur_power');
      return st.cur_power / Math.pow(10, sc != null ? sc : 1);
    }
    if (typeof st.phase_a === 'string') {
      try {
        var b = atob(st.phase_a);
        if (b.length >= 8) return (b.charCodeAt(5) << 16) | (b.charCodeAt(6) << 8) | b.charCodeAt(7);
      } catch (e) { /* hibás csomag: nincs érték */ }
    }
    return null;
  }
  function liveStage(st) {
    var n = 0, any = false;
    ['switch_1', 'switch_2', 'switch_3'].forEach(function (c) { if (c in st) { any = true; if (st[c] === true) n++; } });
    return any ? n : null;
  }
  function fmtTemp(t) { return t.toFixed(1).replace('.', ',') + '°'; }

  // ---- Eszközök panel: katalógus, kódnevek, figyelmeztetési szabályok -----------------------

  // kind: thermo (alvó Wi-Fi hőmérő), contact (Zigbee nyitásérzékelő), breaker, switch3, gateway, ir
  var DEVINFO = {
    '1': { name: 'Hőmérő, kis szoba', room: 'Kis szoba', kind: 'thermo', cat: 'temp' },
    '2': { name: 'Hőmérő, nagy szoba', room: 'Nagy szoba', kind: 'thermo', cat: 'temp' },
    '3': { name: 'Hőmérő, kályha mögött', room: 'Nagy szoba', kind: 'thermo', cat: 'temp' },
    '4': { name: 'Hőmérő, fürdő', room: 'Fürdő', kind: 'thermo', cat: 'temp' },
    '5': { name: 'Bejárati ajtó', room: 'Előszoba', kind: 'contact', cat: 'door' },
    '6': { name: 'Tároló ajtó (privát)', room: 'Előszoba', kind: 'contact', cat: 'door' },
    '7': { name: 'Konyha ablak', room: 'Konyha', kind: 'contact', cat: 'door' },
    '8': { name: 'Kis szoba ablak', room: 'Kis szoba', kind: 'contact', cat: 'door' },
    '9': { name: 'Nagy szoba bal ablak', room: 'Nagy szoba', kind: 'contact', cat: 'door' },
    '10': { name: 'Nagy szoba jobb ablak', room: 'Nagy szoba', kind: 'contact', cat: 'door' },
    '11': { name: 'Klíma (Gree, IR)', room: 'Kis szoba', kind: 'ir', cat: 'other' },
    'P': { name: 'Kályhakapcsoló (LUXION)', room: 'Nagy szoba', kind: 'switch3', cat: 'power' },
    'k5': { name: 'Kör 5: cserépkályha', room: 'Elosztó', kind: 'breaker', cat: 'power' },
    'k7': { name: 'Kör 7: bojler', room: 'Elosztó', kind: 'breaker', cat: 'power' },
    'k8': { name: 'Kör 8: főzőlap és sütő', room: 'Elosztó', kind: 'breaker', cat: 'power' },
    'k9': { name: 'Kör 9: klíma', room: 'Elosztó', kind: 'breaker', cat: 'power' },
    'G': { name: 'Zigbee + IR gateway', room: 'Kis szoba', kind: 'gateway', cat: 'other' }
  };
  // Logikai kapcsolat: melyik okos kismegszakító mit táplál. A kismegszakító a pillanatnyi
  // teljesítményt méri (és a Smart Life appban visszamenőleg is látszik), így a mögötte lévő
  // fogyasztó állapota ebből számolható. Lekapcsolt kismegszakító = a fogyasztó nem kap áramot.
  // A klíma (11) IR vezérelt, maga nem küld állapotot: csak a 9-es körből tudjuk, mit csinál.
  var LOADS = {
    k5: { num: '5-ös', tag: 'kályha', who: 'a cserépkályha', what: 'Cserépkályha (W)', on: 300, onT: 'fűt', offT: 'áll', idle: 'nem fűt' },
    k7: { num: '7-es', tag: 'bojler', who: 'a bojler', what: 'Bojler (Hajdu ZV120)', on: 500, onT: 'fűt', offT: 'felfűtve', idle: 'nem fűt: a víz felfűtve, a termosztátja lekapcsolt' },
    k8: { num: '8-as', tag: 'konyha', who: 'a főzőlap és a sütő', what: 'Főzőlap és sütő', on: 100, onT: 'főz', offT: 'áll', idle: 'nincs használatban' },
    k9: { num: '9-es', tag: 'klíma', who: 'a klíma', what: 'Klíma (11)', on: 100, onT: 'fut', offT: 'áll', idle: 'áll' }
  };
  function cap1(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function circuitState(src, k) {
    var L = LOADS[k], d = src && src[dbPink(k)], br = 'a ' + L.num + ' (' + L.tag + ') kismegszakító';
    if (!d) return { kind: 'unknown', w: null, tag: '?', short: 'nincs adat', text: 'Nincs adat ' + br.replace(/^a /, 'a ') + 'ról.' };
    if (d.online === false) return { kind: 'unknown', w: null, tag: '?', short: 'ismeretlen', text: cap1(br) + ' nem elérhető, ' + L.who + ' állapota ismeretlen.' };
    var s = d.status || {};
    if (s.switch === false) return { kind: 'off', w: 0, tag: 'LE', short: 'nincs áram', text: 'Nincs áram: ' + br + ' le van kapcsolva, ' + L.who + ' nem kap áramot.' };
    var w = livePower(s, d.meta);
    if (w == null) return { kind: 'idle', w: null, tag: 'BE', short: 'áram van', text: cap1(br) + ' be van kapcsolva, a teljesítmény nem ismert.' };
    if (w > L.on) return { kind: 'run', w: w, tag: L.onT, short: L.onT + ', ' + fmtW(w), text: cap1(L.who) + ' ' + L.onT + ': ' + fmtW(w) + ' a ' + L.num + ' körön.' };
    return { kind: 'idle', w: w, tag: L.offT, short: L.offT, text: cap1(L.who) + ' ' + L.idle + ' (' + fmtW(w) + '; a kismegszakító be van kapcsolva, áram van).' };
  }
  function acPower(src) { return circuitState(src, 'k9'); }
  // "Régóta hallgat" küszöb (perc), csak az elemes érzékelőkre. A hálózati eszközök (kismegszakítók,
  // a LUXION kapcsoló, a gateway, az IR klíma) a Tuyának csak változáskor jelentenek: egy álló bojler,
  // egy nem használt főzőlap vagy egy érintetlen kályhakapcsoló napokig hallgathat, és ez nem hiba.
  // Az ő egészségük kizárólag a Tuya online jelzője (online === false: "Nem elérhető").
  var STALE_MIN = { thermo: 6 * 60, contact: 24 * 60 };

  // ---- Fogyasztás panel: a mért körök és a kályha fokozata ---------------------------------
  // Árak a briefből (bruttó, 2026): B kör keret felett 60,9 Ft/kWh (a kályha szinte mindig ott jár),
  // A1 kereten belül 36,2, felett 70,1 Ft/kWh.
  var CONS = [
    { id: 'k5', db: 'X5', name: 'Cserépkályha kör', short: 'Kályha', meter: 'B', max: 3000, color: '#ff7043', icon: 'M8 21V9a4 4 0 0 1 8 0v12M6 21h12M10 13h4M10 17h4' },
    { id: 'k7', db: 'X7', name: 'Bojler', short: 'Bojler', meter: 'B', max: 2000, color: '#4fc3f7', icon: 'M12 3s5 6 5 10a5 5 0 0 1-10 0c0-4 5-10 5-10z' },
    { id: 'k8', db: 'X8', name: 'Főzőlap és sütő', short: 'Konyha', meter: 'A1', max: 7000, color: '#ffb74d', icon: 'M4 9h16v11H4zM4 13h16M8 5v2M12 4v3M16 5v2' },
    { id: 'k9', db: 'X9', name: 'Klíma', short: 'Klíma', meter: 'A1', max: 1500, color: '#66bb6a', icon: 'M4 6h16v6H4zM7 9h10M8 15l-1 3M12 15v4M16 15l1 3' }
  ];
  var PRICE_B = 60.9, PRICE_A1_IN = 36.2, PRICE_A1_OUT = 70.1;
  var HIST_MS = 6 * 3600000;
  function consVariantFromUrl() {
    try { var m = /[?&]fogyasztas=([123])\b/.exec(window.location.search); return m ? Number(m[1]) : 1; } catch (e) { return 1; }
  }
  function fmtW(w) { return w == null ? '--' : w >= 1000 ? fmtNum(w / 1000, w >= 9950 ? 0 : 1) + ' kW' : fmtNum(w, 0) + ' W'; }
  function stageSuffix(n) { return n === 3 ? '3-as' : n + '-es'; }
  // a device_status sorokból körönként lépcsős idősor (W) az utolsó 6 órára
  function seriesFrom(rows, pink, meta, now, kind) {
    var pts = [];
    rows.forEach(function (r) {
      if (r.pink !== pink) return;
      var ms = Date.parse(r.ts); if (!isFinite(ms)) return;
      var st = r.status || {}, v = kind === 'stage' ? liveStage(st) : (r.online === false ? null : st.switch === false ? 0 : livePower(st, meta));
      if (v != null) pts.push([ms, v]);
    });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    return pts;
  }
  function sparkPath(pts, now, max, cur) {
    var t0 = now - HIST_MS, W = 120, H = 26;
    var all = pts.filter(function (p) { return p[0] >= t0; });
    var before = pts.filter(function (p) { return p[0] < t0; }).pop();
    if (before) all.unshift([t0, before[1]]);
    if (cur != null) all.push([now, cur]);
    if (!all.length) return null;
    var X = function (ms) { return Math.round(Math.max(0, (ms - t0) / HIST_MS) * W * 10) / 10; };
    var Y = function (v) { return Math.round((H - 2 - Math.min(1, v / max) * (H - 4)) * 10) / 10; };
    var d = 'M' + X(all[0][0]) + ',' + Y(all[0][1]);
    for (var i = 1; i < all.length; i++) d += ' H' + X(all[i][0]) + ' V' + Y(all[i][1]);
    d += ' H' + W;
    return d;
  }
  // demó előzmény: a jelenlegi értékekből kitalált, de valószerű lépcsők
  function demoHistory(src, now) {
    var rows = [], at = function (h) { return new Date(now - h * 3600000).toISOString(); };
    var add = function (pink, h, st) { rows.push({ pink: pink, ts: at(h), online: true, status: st }); };
    var cp = function (pink) { var d = src[pink]; return d && d.status && typeof d.status.cur_power === 'number' ? d.status.cur_power : 0; };
    var k5 = cp('X5'), k9 = cp('X9');
    add('X5', 6.5, { switch: true, cur_power: 0 }); add('X5', 4.2, { switch: true, cur_power: 9950 }); add('X5', 2.5, { switch: true, cur_power: 19900 }); add('X5', 1.2, { switch: true, cur_power: k5 });
    add('X7', 6.5, { switch: true, cur_power: 0 }); add('X7', 5.5, { switch: true, cur_power: 18000 }); add('X7', 4.6, { switch: true, cur_power: 0 }); add('X7', 1.8, { switch: true, cur_power: 18000 }); add('X7', 1.1, { switch: true, cur_power: cp('X7') });
    add('X8', 6.5, { switch: true, cur_power: 0 }); add('X8', 3.0, { switch: true, cur_power: 21000 }); add('X8', 2.4, { switch: true, cur_power: 0 }); add('X8', 0.4, { switch: true, cur_power: cp('X8') });
    add('X9', 6.5, { switch: true, cur_power: 5200 }); add('X9', 3.5, { switch: true, cur_power: 7300 }); add('X9', 0.8, { switch: true, cur_power: k9 });
    return rows;
  }

  // ---- Élő áttekintés (jobb oszlop) ------------------------------------------------------------
  var OV_DOORS = [
    { id: '5', name: 'Bejárati ajtó', short: 'Bejárat' }, { id: '6', name: 'Tároló (privát)', short: 'Tároló' },
    { id: '7', name: 'Konyha ablak', short: 'Konyha' }, { id: '8', name: 'Kis szoba ablak', short: 'Kis szoba' },
    { id: '9', name: 'Nagy szoba bal ablak', short: 'Nagy sz. bal' }, { id: '10', name: 'Nagy szoba jobb ablak', short: 'Nagy sz. jobb' }
  ];
  var OV_TEMPS = [{ id: '1', name: 'Kis szoba' }, { id: '2', name: 'Nagy szoba' }, { id: '3', name: 'Kályha mögött' }, { id: '4', name: 'Fürdő' }];
  // piktogramok: ajtó / ablak, nyitva / zárva (24x24, körvonal)
  var ICON_DOOR_OPEN = 'M4 21h16M7 21V3h11v18M7 3l6 2.2V21M10.6 12.5h.01';
  var ICON_DOOR_SHUT = 'M4 21h16M6 21V3h12v18M14.5 12h.01';
  var ICON_WIN_OPEN = 'M4 3h8v18H4zM4 12h8M12 3l7 3v12l-7 3';
  var ICON_WIN_SHUT = 'M4 3h16v18H4zM12 3v18M4 12h16';
  var OV_WINDOWS = { '7': 1, '8': 1, '9': 1, '10': 1 };
  var MOVE_WINDOW_MS = 48 * 3600000;
  var DOOR_WINDOW_MS = 30 * 86400000;   // a nyílászárók utolsó váltásához 30 nap előzmény
  function ovVariantFromUrl() {
    try { var m = /[?&]attekintes=([123])\b/.exec(window.location.search); return m ? Number(m[1]) : 1; } catch (e) { return 1; }
  }
  // időtartam alapalakban ("25 perc", "3 óra", "2 nap") a "legalább ... óta" mondathoz
  function spanText(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + ' perc';
    var h = Math.floor(m / 60);
    return h < 48 ? h + ' óra' : Math.floor(h / 24) + ' nap';
  }
  // Mikor mozdult utoljára a nyitásérzékelő: a device_status előzményben az utolsó állapotváltás.
  // Ha az ablakban nincs váltás, csak alsó becslés adható ("legalább ... óta").
  function lastMove(rows, pink, curOpen, fallbackMs) {
    var pts = (rows || []).filter(function (r) { return r.pink === pink; }).map(function (r) {
      return { ms: Date.parse(r.ts), o: liveOpen(r.status || {}) };
    }).filter(function (q) { return isFinite(q.ms) && q.o != null; }).sort(function (a, b) { return a.ms - b.ms; });
    if (curOpen == null) return null;
    if (!pts.length) return fallbackMs != null ? { ms: fallbackMs, atLeast: true } : null;
    var last = pts[pts.length - 1];
    if (last.o !== curOpen) return fallbackMs != null ? { ms: Math.max(fallbackMs, last.ms), atLeast: false } : null;
    for (var i = pts.length - 1; i > 0; i--) if (pts[i - 1].o !== curOpen) return { ms: pts[i].ms, atLeast: false };
    return { ms: pts[0].ms, atLeast: true };
  }
  // pontos időtartam és időpont a nyílászárókhoz: "3 ó 12 p", "ma 09:41", "tegnap 21:10", "nov. 6. cs 08:02"
  function durHM(ms) {
    var m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return d + ' nap ' + (h % 24) + ' ó';
    if (h >= 1) return h + ' ó ' + (m % 60) + ' p';
    return m + ' p';
  }
  var DAY_ABBR = ['v', 'h', 'k', 'sze', 'cs', 'p', 'szo'];
  function budDayKey(ms) { return budKey(ms).slice(0, 10); }
  function dayTime(ms, now) {
    var k = budDayKey(ms), t = budTime(ms);
    if (k === budDayKey(now)) return 'ma ' + t;
    if (k === budDayKey(now - 86400000)) return 'tegnap ' + t;
    var dt = new Date(k + 'T12:00:00Z');
    return ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'][dt.getUTCMonth()] + ' ' + dt.getUTCDate() + '. ' + DAY_ABBR[dt.getUTCDay()] + ' ' + t;
  }
  function demoContactHistory(src, now) {
    var rows = [];
    OV_DOORS.forEach(function (d) {
      var x = src[d.id]; if (!x) return;
      var open = !!(x.status && x.status.doorcontact_state), upd = (x.status && x.status._upd) * 1000;
      if (d.id === '10') { rows.push({ pink: d.id, ts: new Date(now - 40 * 3600000).toISOString(), status: { doorcontact_state: open } }); return; }
      rows.push({ pink: d.id, ts: new Date(upd - 3600000).toISOString(), status: { doorcontact_state: !open } });
      rows.push({ pink: d.id, ts: new Date(upd).toISOString(), status: { doorcontact_state: open } });
    });
    return rows;
  }

  // ---- Időjárás: Open-Meteo (kulcs nélkül, a böngészőből; csak memóriában) ----------------------
  var WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=47.48&longitude=19.07' +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day,cloud_cover' +
    '&hourly=temperature_2m,weather_code,cloud_cover,shortwave_radiation,is_day&forecast_hours=24&timezone=Europe%2FBudapest';
  var WX_REFRESH_MS = 15 * 60000;
  var WX_SRC = 'Időjárás: Open-Meteo';
  // budapesti helyi idő 'ÉÉÉÉ-HH-NNTÓÓ:PP' alakban (ugyanaz, mint az API timezone=Europe/Budapest ideje)
  var BUD_KEY = null;
  function budKey(ms) {
    try {
      BUD_KEY = BUD_KEY || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      return BUD_KEY.format(new Date(ms)).replace(' ', 'T');
    } catch (e) { return new Date(ms).toISOString().slice(0, 16); }
  }
  function wxNum(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function parseWeather(j) {
    if (!j || typeof j !== 'object') return null;
    var c = j.current || {}, h = j.hourly || {};
    var t = wxNum(c.temperature_2m);
    if (t == null) return null;
    var at = function (k, i) { return Array.isArray(h[k]) ? wxNum(h[k][i]) : null; };
    var hourly = [];
    (Array.isArray(h.time) ? h.time : []).forEach(function (tm, i) {
      var ht = at('temperature_2m', i);
      if (typeof tm !== 'string' || tm.length < 16 || ht == null) return;
      hourly.push({ key: tm.slice(0, 16), hh: tm.slice(11, 16), t: ht, code: at('weather_code', i), cloud: at('cloud_cover', i), sw: at('shortwave_radiation', i), day: at('is_day', i) });
    });
    return { t: t, app: wxNum(c.apparent_temperature), code: wxNum(c.weather_code), day: wxNum(c.is_day), cloud: wxNum(c.cloud_cover), hourly: hourly };
  }
  // A Supabase weather_hourly soraiból (az adatgyűjtő óránként tölti) ugyanaz a szerkezet,
  // mint a parseWeather eredménye. null, ha nincs friss sor az aktuális órára.
  var WX_DB_STALE_MS = 3 * 3600000;
  function weatherFromRows(rows, now) {
    if (!Array.isArray(rows) || !rows.length) return null;
    var hourly = [], cur = null, newest = 0;
    rows.forEach(function (r) {
      var ms = Date.parse(r.ts), t = wxNum(r.temp == null ? null : Number(r.temp));
      if (!isFinite(ms) || t == null) return;
      var f = Date.parse(r.fetched_at); if (isFinite(f) && f > newest) newest = f;
      var key = budKey(ms);
      var h = { key: key, hh: key.slice(11, 16), t: t, code: wxNum(r.weather_code), cloud: wxNum(r.cloud),
        sw: wxNum(r.radiation == null ? null : Number(r.radiation)), day: r.is_day == null ? null : r.is_day ? 1 : 0,
        app: wxNum(r.apparent == null ? null : Number(r.apparent)), ms: ms };
      hourly.push(h);
      if (ms <= now && (!cur || ms > cur.ms)) cur = h;
    });
    if (!cur || now - cur.ms > 2 * 3600000 || (newest && now - newest > WX_DB_STALE_MS)) return null;
    hourly.sort(function (a, b) { return a.ms - b.ms; });
    return { t: cur.t, app: cur.app, code: cur.code, day: cur.day, cloud: cur.cloud, src: 'db',
      hourly: hourly.map(function (h) { return { key: h.key, hh: h.hh, t: h.t, code: h.code, cloud: h.cloud, sw: h.sw, day: h.day }; }) };
  }
  // WMO időjáráskód + nappal/éjszaka: ikon és rövid magyar leírás
  function wxKind(code, day) {
    var d = day !== 0;
    if (code == null) return ['#wx-cloud', 'ismeretlen égbolt'];
    if (code === 0) return d ? ['#wx-sun', 'derült'] : ['#wx-moon', 'tiszta égbolt'];
    if (code === 1) return d ? ['#wx-sun', 'többnyire derült'] : ['#wx-moon', 'többnyire tiszta'];
    if (code === 2) return d ? ['#wx-partly', 'részben felhős'] : ['#wx-partlynight', 'részben felhős'];
    if (code === 3) return ['#wx-cloud', 'borult'];
    if (code === 45 || code === 48) return ['#wx-fog', 'köd'];
    if (code >= 51 && code <= 57) return ['#wx-rain', 'szitálás'];
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['#wx-rain', 'eső'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['#wx-snow', 'havazás'];
    if (code >= 95) return ['#wx-storm', 'zivatar'];
    return ['#wx-cloud', 'felhős'];
  }
  function wxRound(t) { var r = Math.round(t); return String(r === 0 ? 0 : r); }
  function wxWhen(h) {
    var hr = parseInt(h.hh, 10);
    return hr >= 12 && hr < 18 ? 'délután' : hr >= 6 && hr < 12 ? 'délelőtt' : h.hh + '-kor';
  }
  // Előrejelzés kb. 3 órára és fűtési tipp a következő órák alapján. Csak javaslat.
  function wxForecast(w, now) {
    if (!w || !w.hourly.length) return null;
    var nowH = budKey(now).slice(0, 13), fut = w.hourly.filter(function (h) { return h.key.slice(0, 13) >= nowH; });
    if (fut.length < 2) return null;
    var tgt = budKey(now + 3 * 3600000).slice(0, 13);
    var f3 = fut.filter(function (h) { return h.key.slice(0, 13) >= tgt; })[0] || fut[fut.length - 1];
    var d = f3.t - w.t, arrow = d >= 0.5 ? '↑' : d <= -0.5 ? '↓' : '→';
    var next6 = fut.slice(0, 7), next12 = fut.slice(0, 13);
    var max6 = next6.reduce(function (a, h) { return h.t > a.t ? h : a; });
    var min12 = next12.reduce(function (a, h) { return h.t < a.t ? h : a; });
    var sunny = next6.filter(function (h) { return h.day === 1; });
    var avg = function (xs, k) { var v = xs.map(function (h) { return h[k]; }).filter(function (x) { return x != null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; };
    var sw = avg(sunny, 'sw'), cl = avg(sunny, 'cloud');
    var warm = max6.t - w.t >= 2 && sunny.length >= 2 && ((sw != null && sw >= 200) || (cl != null && cl <= 35));
    var night = next12.some(function (h) { return h.day === 0; });
    var cold = night && (w.t - min12.t >= 3 || min12.t < 3);
    var hint;
    if (warm) hint = { kind: 'warm', short: 'Jön a napocska: a kályhát le lehet venni', text: 'Jön a napocska: a kályhát most le lehet venni, ' + wxWhen(max6) + ' ' + wxRound(max6.t) + ' °C.' };
    else if (cold) hint = { kind: 'cold', short: 'Hidegebb éjszaka jön (' + wxRound(min12.t) + ' °C ' + min12.hh + '-kor)', text: 'Hidegebb éjszaka jön (' + wxRound(min12.t) + ' °C ' + min12.hh + '-kor): a kályhát most érdemes tölteni, vagy érkezés előtt temperálj.' };
    else hint = { kind: 'steady', short: 'Egyenletes idő', text: 'Egyenletes idő: kb. ' + wxRound(w.t) + ' °C körül marad, nincs teendő.' };
    return { at: f3, arrow: arrow, label: f3.hh + ' → ' + fmtNum(f3.t, 1) + ' °C ' + arrow, hint: hint };
  }

  // ---- Energiaőr: tanácsadó a térkép bal alsó sarkában --------------------------------------
  // Szabályalapú, élő (vagy demó) adatból; az árak a briefből: a kályha keret feletti ára
  // 60,9 Ft/kWh (1 kW kb. 61 Ft óránként), minden 1 °C kb. 6 % fűtési energia.
  var ADV_MUTE_KEY = 'f27-advisor-mute';
  var ADV_ROTATE_MS = 12000;
  var STOVE_FT_KWH = 60.9;
  var DRAFT_NAME = { '5': 'A bejárati ajtó', '7': 'A konyhaablak', '8': 'A kis szoba ablaka', '9': 'A nagy szoba bal ablaka', '10': 'A nagy szoba jobb ablaka' };
  // a huzat-szellem helye az érzékelő horgonyához képest (a tűtől elfelé, hogy ne takarják egymást)
  var GHOST_OFF = { '5': [24, -30], '7': [22, -34], '8': [42, -16], '9': [-36, 20], '10': [-36, 20] };
  var ROOM_NAME = { '1': 'A kis szoba', '2': 'A nagy szoba', '4': 'A fürdő' };
  function advVariantFromUrl() {
    try { var m = /[?&]energiaor=([123])\b/.exec(window.location.search); return m ? Number(m[1]) : 3; } catch (e) { return 3; }
  }
  // fűtési szezon: október 15. és április 15. között (a gázkonvektor ilyenkor be van kapcsolva)
  function heatingSeason(now) {
    var d = new Date(now), m = d.getMonth() + 1, day = d.getDate();
    return m >= 11 || m <= 3 || (m === 10 && day >= 15) || (m === 4 && day < 15);
  }
  function durText(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + ' perce';
    var h = Math.floor(m / 60);
    return h < 48 ? h + ' órája' : Math.floor(h / 24) + ' napja';
  }
  function advTips(all, now, fc) {
    var by = {}; all.forEach(function (c) { by[c.id] = c; });
    var tips = [];
    function add(pri, tone, dev, short, long) { tips.push({ pri: pri, tone: tone, dev: dev, short: short, long: long }); }
    var P = by.P, stage = P && P.online !== false ? P.stage || 0 : 0;
    var ac = by.k9 && by.k9.watt != null && by.k9.watt > 100;
    var season = heatingSeason(now);
    var heating = stage > 0 || ac || season;
    var heatWhy = stage > 0 ? 'a kályha megy' : ac ? 'a klíma fűt' : 'fűtési szezon van, a gáz is megy';
    // nyitott ablak, ajtó fűtés közben
    Object.keys(DRAFT_NAME).forEach(function (id) {
      var c = by[id];
      if (!c || !c.open || c.online === false || c.age == null || c.age < 10 * 60000) return;
      var who = DRAFT_NAME[id];
      if (c.stale) add(62, 'orange', id, who + ' NYITVA jelez, de ' + durText(c.age) + ' hallgat', who + ' NYITVA jelzést mutat, de az érzékelő ' + durText(c.age) + ' nem jelentett' + (c.battPct != null && c.battPct < 20 ? ', és merül az eleme (' + c.battPct + ' %)' : '') + '. Nézd meg a helyszínen, vagy kérd meg a takarítót.');
      else if (heating) add(92, 'red', id, who + ' ' + durText(c.age) + ' nyitva, és fűtünk!', who + ' ' + durText(c.age) + ' nyitva, közben ' + heatWhy + '. A huzat viszi a meleget: csukd be, vagy szólj a vendégnek. Szellőztetni 5-10 perc bőven elég.');
      else add(25, 'blue', id, who + ' ' + durText(c.age) + ' nyitva', who + ' ' + durText(c.age) + ' nyitva. Fűtés most nincs, így ez nem drága.');
    });
    // kályha: keret feletti ár
    if (stage > 0) {
      var ft = Math.round(stage * STOVE_FT_KWH);
      add(stage >= 2 ? 80 : 68, stage >= 2 ? 'red' : 'orange', 'P', 'Kályha ' + stage + '/3 fokozaton: kb. ' + ft + ' Ft óránként',
        'A cserépkályha ' + stage + ' kW-on megy. Keret felett 60,9 Ft/kWh, vagyis kb. ' + ft + ' Ft óránként (egy éjszaka 10 órája kb. ' + fmtNum(ft * 10, 0) + ' Ft). Ugyanez a hő gázból vagy klímából negyed-fél áron jön.');
    }
    // szobahőmérséklet
    ['1', '2'].forEach(function (id) {
      var c = by[id];
      if (!c || c.temp == null || c.online === false) return;
      var t = c.temp, room = ROOM_NAME[id];
      if (t > 23) {
        var pct = Math.round((t - 22) * 6);
        add(Math.min(88, 55 + Math.round((t - 23) * 8)), 'orange', id, room + ' ' + fmtNum(t, 1) + ' °C: túlfűtve', room + ' ' + fmtNum(t, 1) + ' °C. Minden 1 °C kb. 6 % fűtési energia: 22 °C-on kb. ' + pct + ' %-kal kevesebb fogyna, a komfort még bőven megvan.');
      } else if (t < 19) {
        add(78, 'blue', id, room + ' csak ' + fmtNum(t, 1) + ' °C: a vendég fázhat', room + ' csak ' + fmtNum(t, 1) + ' °C. A komfort az első: kapcsold a klímát fűtésre (a legolcsóbb hő), vagy nyisd ki a két szoba közti ajtót.');
      }
    });
    // fürdő és bojler
    var bath = by['4'];
    if (bath && bath.temp != null && bath.online !== false && bath.temp > 24) add(40, 'orange', '4', 'A fürdő ' + fmtNum(bath.temp, 1) + ' °C: megy a fali panel?', 'A fürdő ' + fmtNum(bath.temp, 1) + ' °C. Ha nincs vendég, a magasan lévő fali fűtőpanel lekapcsolható.');
    var boiler = by.k7;
    if (boiler && boiler.watt != null && boiler.watt > 500) add(35, 'blue', 'k7', 'A bojler most fűt (' + fmtNum(boiler.watt, 0) + ' W)', 'A bojler (7-es kör) most fűt, ' + fmtNum(boiler.watt, 0) + ' W. Üres lakásban a 7-es okos kismegszakítóval távolról lekapcsolható, érkezés előtt 2-3 órával vissza.');
    // eszközhibák a panel szabályaiból
    all.forEach(function (c) {
      if (!c.warn) return;
      if (c.open && c.stale && DRAFT_NAME[c.id]) return;   // a nyitott ablaknál már szóltunk
      var b = c.badgeList.filter(function (x) { return x.c === 'red' || x.c === 'orange'; });
      var detail = b.map(function (x) {
        if (x.t === 'Elem merül' || x.t === 'Elem lemerült') return x.t.toLowerCase() + ' (' + c.battPct + ' %)';
        if (x.t === 'Régóta hallgat') return durText(c.age) + ' nem jelentett';
        return x.t.toLowerCase();
      }).join(', ');
      add(c.red ? 70 : 48, c.red ? 'red' : 'orange', c.id, c.name + ': ' + detail, c.name + ': ' + detail + '. ' + (c.red && c.online === false ? 'Nézd meg az áramot vagy a Wi-Fit.' : /elem/.test(detail) ? 'Elemcsere a következő takarításkor.' : 'Lehet, hogy csak alszik; ha sokáig így marad, nézd meg.'));
    });
    // a klíma tápja (9-es kismegszakító) lekapcsolva: a legolcsóbb hőforrás ki van zárva
    if (by.k9 && by.k9.swOff) {
      if (season && stage > 0) add(66, 'orange', 'k9', 'A klíma nem kap áramot, közben a kályha megy', 'A 9-es (klíma) kismegszakító le van kapcsolva, így a klíma nem tud menni, közben a kályha ' + stage + ' kW-on fűt. A klíma hőszivattyúval kb. 12-23 Ft egy kWh hő, a kályha keret felett kb. 60 Ft: minden kályháról klímára terelt kWh kb. 37 Ft megtakarítás. Ha szándékos (pl. a vendég ne kapcsolgassa), rendben.');
      else add(season ? 28 : 15, 'blue', 'k9', 'A klíma kismegszakítója le van kapcsolva', 'A 9-es (klíma) kismegszakító le van kapcsolva: a klíma most nem kap áramot. Távolról a Smart Life appban kapcsolható vissza.');
    }
    if (by.k7 && by.k7.swOff) add(26, 'blue', 'k7', 'A bojler kismegszakítója le van kapcsolva', 'A 7-es (bojler) kismegszakító le van kapcsolva: a bojler nem fűt utána, a melegvíz fogy. Üres lakásban ez megtakarítás; vendég érkezése előtt kb. 3 órával kapcsold vissza a Smart Life appban.');
    if (ac && season && stage === 0) add(20, 'green', 'k9', 'A klíma fűt: ez a legolcsóbb meleg', 'A klíma fűt (' + fmtNum(by.k9.watt, 0) + ' W). Hőszivattyúval kb. 12 Ft egy kWh hő, a kályha keret felett kb. 60 Ft.');
    // időjárás (csak az Élő módban, valós előrejelzésből); a kályha kapcsolása kézi, ez csak javaslat
    var safe = ' Csak javaslat: a kályha automatikus kapcsolása még nincs bekötve (előbb kontaktor kell).';
    if (fc && fc.hint.kind === 'warm' && stage > 0) add(74, 'green', 'P', fc.hint.short, fc.hint.text + safe);
    else if (fc && fc.hint.kind === 'cold') add(stage > 0 ? 30 : 52, 'blue', 'P', fc.hint.short, fc.hint.text + safe);
    if (!tips.some(function (t) { return t.pri >= 45; })) add(10, 'green', null, 'Minden rendben: zárt ablakok, kályha pihen', 'Minden rendben: az ablakok zárva, a kályha pihen, a szobák kellemesek. Szép munka!');
    tips.sort(function (a, b) { return b.pri - a.pri; });
    return tips;
  }
  var CAT = {
    temp: { label: 'Hőmérők', tile: '#ffe8a3', icon: 'M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0zM12 9v6' },
    door: { label: 'Nyílászárók', tile: '#d6ebff', icon: 'M6 3h12v18H6zM14 12h.01M6 21h12' },
    power: { label: 'Áram', tile: '#ffdcc7', icon: 'M13 2 4 14h7l-1 8 9-12h-7z' },
    other: { label: 'Egyéb', tile: '#e6defc', icon: 'M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v.01M4 16h16v4H4z' }
  };
  var FRIENDLY = {
    va_temperature: 'Hőmérséklet', temp_current: 'Hőmérséklet', temperature: 'Hőmérséklet',
    va_humidity: 'Páratartalom', humidity_value: 'Páratartalom', humidity: 'Páratartalom',
    battery_percentage: 'Elem', va_battery: 'Elem', battery_value: 'Elem', battery_state: 'Elem állapota',
    doorcontact_state: 'Nyitva', contact_state: 'Nyitva', tamper_alarm: 'Szabotázsriasztás',
    switch: 'Bekapcsolva', switch_1: '1. fokozat (1 kW)', switch_2: '2. fokozat (1 kW)', switch_3: '3. fokozat (1 kW)',
    cur_power: 'Teljesítmény', cur_voltage: 'Feszültség', cur_current: 'Áramerősség',
    total_forward_energy: 'Összes fogyasztás', forward_energy_total: 'Összes fogyasztás', add_ele: 'Fogyasztás-számláló',
    temp_unit_convert: 'Mértékegység', child_lock: 'Gyerekzár', relay_status: 'Áramszünet utáni állapot',
    light_mode: 'Jelzőfény', fault: 'Hibakód', countdown_1: 'Visszaszámláló', _upd: 'Utolsó jelentés'
  };
  // alapértelmezett skála és mértékegység, ha a specifikáció (devices.meta) nem elérhető
  var CODE_DEF = {
    va_temperature: [1, '°C'], temp_current: [1, '°C'], va_humidity: [0, '%'], humidity_value: [0, '%'],
    battery_percentage: [0, '%'], va_battery: [0, '%'], battery_value: [0, '%'],
    cur_power: [1, 'W'], cur_voltage: [1, 'V'], cur_current: [0, 'mA'],
    total_forward_energy: [2, 'kWh'], forward_energy_total: [2, 'kWh'], add_ele: [3, 'kWh']
  };
  var BATT_STATE = { low: [12, 'alacsony'], middle: [55, 'közepes'], high: [90, 'jó'] };

  function fmtNum(v, dec) {
    var s = (dec ? v.toFixed(dec) : String(Math.round(v))).replace('.', ',');
    var p = s.split(','); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return p.join(',');
  }
  function codeValue(code, v, meta) {
    if (code === '_upd') return typeof v === 'number' ? budTime(v * 1000) + ', ' + new Date(v * 1000).toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest', month: 'short', day: 'numeric' }) : String(v);
    if (typeof v === 'boolean') return v ? 'igen' : 'nem';
    if (code === 'battery_state' && BATT_STATE[v]) return BATT_STATE[v][1];
    if (typeof v === 'number') {
      var m = meta && meta[code], def = CODE_DEF[code];
      var sc = m && typeof m.scale === 'number' ? m.scale : def ? def[0] : 0;
      var unit = (m && m.unit) || (def ? def[1] : '');
      var val = v / Math.pow(10, sc);
      return fmtNum(val, sc > 0 ? Math.min(sc, 2) : 0) + (unit ? ' ' + unit : '');
    }
    if (v == null) return '-';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  function batteryOf(st) {
    var codes = ['battery_percentage', 'va_battery', 'battery_value'];
    for (var i = 0; i < codes.length; i++) if (typeof st[codes[i]] === 'number') return { pct: Math.max(0, Math.min(100, Math.round(st[codes[i]]))), label: null };
    if (BATT_STATE[st.battery_state]) return { pct: BATT_STATE[st.battery_state][0], label: BATT_STATE[st.battery_state][1] };
    return null;
  }
  function humidityOf(st, meta) {
    var codes = ['va_humidity', 'humidity_value', 'humidity'];
    for (var i = 0; i < codes.length; i++) {
      var v = st[codes[i]];
      if (typeof v !== 'number') continue;
      var sc = metaScale(meta, codes[i]);
      return sc != null ? v / Math.pow(10, sc) : v;
    }
    return null;
  }
  function ago(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'most';
    if (m < 60) return m + ' perce';
    var h = Math.floor(m / 60);
    if (h < 48) return h + ' órája';
    return Math.floor(h / 24) + ' napja';
  }
  function hoursAgoText(ms) {
    var m = Math.round(ms / 60000);
    return m < 60 ? m + ' perce' : Math.floor(m / 60) + ' órája';
  }

  // Demó eszközállapot (belépés nélkül): valószerű értékek, egy merülő elemmel és egy régóta
  // hallgató, nyitottnak látszó ablakkal, hogy a figyelmeztetések látszódjanak.
  function demoDevices(now, L) {
    L = L || {};
    var s = function (min) { return Math.round((now - min * 60000) / 1000); };
    var row = function (min, online, st) { st._upd = s(min); return { ts: new Date(now - Math.min(min, 60) * 60000).toISOString(), online: online, status: st, meta: null }; };
    // a demó a kiválasztott pálya (L) értékeit követi, hogy a térkép, a panel és az Energiaőr egyezzen
    var t = function (i, def) { var v = parseFloat(String((L.t || [])[i] || '').replace(',', '.')); return Math.round((isFinite(v) ? v : def) * 10); };
    var w = function (k, def) { var v = parseFloat(String(L[k] || '')); return Math.round((isFinite(v) ? v : def) * 10); };
    var n = parseInt(String(L.stage || '2'), 10); if (!isFinite(n)) n = 0;
    var open8 = L.open8 == null ? true : !!L.open8;
    return {
      '1': row(34, true, { va_temperature: t(0, 23.6), va_humidity: 41, battery_percentage: 80 }),
      '2': row(52, true, { va_temperature: t(1, 20.5), va_humidity: 44, battery_percentage: 14 }),
      '3': row(18, true, { va_temperature: t(2, 38.4), va_humidity: 25, battery_percentage: 66 }),
      '4': row(95, true, { va_temperature: t(3, 22.3), va_humidity: 63, battery_percentage: 58 }),
      '5': row(41, true, { doorcontact_state: false, battery_percentage: 100 }),
      '6': row(300, true, { doorcontact_state: false, battery_percentage: 92 }),
      '7': row(130, true, { doorcontact_state: false, battery_percentage: 88 }),
      '8': row(open8 ? 31 * 60 : 200, true, { doorcontact_state: open8, battery_percentage: 9 }),
      '9': row(260, true, { doorcontact_state: false, battery_percentage: 77 }),
      '10': row(260, true, { doorcontact_state: false, battery_percentage: 75 }),
      'P': row(4, true, { switch_1: n >= 1, switch_2: n >= 2, switch_3: n >= 3 }),
      'X5': row(3, true, { switch: true, cur_power: w('k5', 1987), cur_voltage: 2296 }),
      'X7': row(6, true, { switch: true, cur_power: w('k7', 0), cur_voltage: 2301 }),
      'X8': row(2, true, { switch: true, cur_power: w('k8', 0), cur_voltage: 2299 }),
      'X9': row(5, true, { switch: true, cur_power: w('k9', 642), cur_voltage: 2294 }),
      'G': row(1, true, {})
    };
  }


  // ---- az alkalmazás ---------------------------------------------------------------------

  class G3App extends window.G3Scene {
    constructor(props) {
      super(props);
      this.sb = null;
      this.undoStack = [];
      this.redoStack = [];
      this.toastSeq = 0;
      this.liveTimer = 0;
      this.state = {
        pos: {}, sel: null, drag: null,
        drawer: false, saveAs: false, confirmId: null, busy: false, peek: false, remember: authStore.remember,
        weather: null, wxOpen: false, wxAt: null, hist: null, histAt: 0, ovVariant: ovVariantFromUrl(), ovTab: 'power', ovSheet: false,
        advIdx: 0, advHover: false, advOpen: false, advTalk: false, advMute: sGet(LOCAL, ADV_MUTE_KEY) === '1', advVariant: advVariantFromUrl(),
        user: null, role: null, layouts: [], current: null,
        savedKey: '{}', savedAt: null, live: null, toasts: [],
        liveSky: true, now: Date.now(),
        devOpen: false, devFilter: 'all', devOpenId: null
      };
    }

    // Élő napszak: percenként újraszámol (a nap állása Budapest felett).
    startClock() {
      var self = this;
      if (this._clock) return;
      this._clock = setInterval(function () {
        self.setState({ now: Date.now() });
        if (self.state.live && Date.now() - self.state.histAt > 5 * 60000) self.loadHistory();
      }, 60000);
      this._adv = setInterval(function () { self.advNext(); }, ADV_ROTATE_MS);
      this.fetchWeather();
      this._wx = setInterval(function () { self.fetchWeather(); }, WX_REFRESH_MS);
    }

    // -- jelenet-kiegészítések -----------------------------------------------------------

    pieceIds() {
      if (!this._pieceIds) {
        var ids = {};
        this.scene().pieces.forEach(function (p) { if (p.drag) ids[p.id] = true; });
        this._pieceIds = ids;
      }
      return this._pieceIds;
    }

    // A szintek (napszak, időjárás) maradnak; ha van élő adat, a mért értékek felülírják
    // a szint demó értékeit.
    levels() {
      var LV = super.levels(), live = this.state && this.state.live;
      if (!live) return LV;
      return LV.map(function (L0) {
        var L = Object.assign({}, L0), t = L0.t.slice();
        ['1', '2', '3', '4'].forEach(function (p, i) {
          var d = live[p];
          if (!d) return;
          if (d.online === false) { t[i] = 'offline'; return; }
          var v = liveTemp(d.status || {}, d.meta);
          if (v != null) t[i] = fmtTemp(v);
        });
        L.t = t;
        ['k5', 'k7', 'k8', 'k9'].forEach(function (k) {
          var d = live[dbPink(k)];
          if (!d) return;
          var w = d.online === false ? null : livePower(d.status || {}, d.meta);
          L[k] = w == null ? 'offline' : Math.round(w) + ' W';
        });
        if (live.P) {
          var n = live.P.online === false ? null : liveStage(live.P.status || {});
          L.stage = n == null ? 'offline' : n + '/3 kW';
        }
        if (live['8']) {
          var o = liveOpen(live['8'].status || {});
          if (o != null) L.open8 = o;
        }
        return L;
      });
    }

    startDrag(e, id, kind) {
      this._before = posKey(this.state.pos);
      this._beforePos = Object.assign({}, this.state.pos || {});
      super.startDrag(e, id, kind);
    }

    // Megszakított húzás (pl. a második ujj csippentést kezd): a tárgy visszaáll, nincs visszavonási lépés.
    cancelDrag() {
      if (!this._drag) return;
      super.endDrag();
      this.setState({ pos: this._beforePos || {} });
    }

    endDrag() {
      var dragging = !!this._drag;
      super.endDrag();
      if (dragging) this.recordChange(this._before);
    }

    renderVals() {
      var v = super.renderVals(), self = this, st = this.state, live = st.live, demo = !live;
      var valued = { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, '10': 1, 'P': 1, 'k5': 1, 'k7': 1, 'k8': 1, 'k9': 1, 'G': 1 };

      v.pins.forEach(function (m) {
        var d = live && live[dbPink(m.id)];
        if (live && !d && valued[m.id]) demo = true;
        if (!d) return;
        if (CONTACTS.indexOf(m.id) >= 0 && m.id !== '8') {
          var open = d.online === false ? null : liveOpen(d.status || {});
          m.val = d.online === false ? 'offline' : open ? 'NYITVA!' : 'zárva';
          if (open) {
            m.showVal = true;
            m.vcls = 'val bad';
            m.fill = '#ff5a3c';
            if (m.cls.indexOf(' alert') < 0) m.cls += ' alert';
          }
        } else if (m.id === 'G') {
          m.val = d.online === false ? 'offline' : 'online';
        }
        if (d.online === false) { m.showVal = true; m.vcls = 'val'; }
        m.aria = m.id + ': ' + m.name + ', ' + m.val + '. Húzható.';
      });
      if (live && live.__any && v.pins.some(function (m) { return m.id === '11'; })) {
        var acPin = acPower(live);
        v.pins.forEach(function (m) { if (m.id === '11') { m.val = 'Klíma: ' + acPin.short; m.aria = m.id + ': ' + m.name + ', ' + acPin.text + ' Húzható.'; } });
      }
      if (st.sel && st.sel.charAt(0) === 'd') {
        v.pins.forEach(function (m) { if ('d' + m.id === st.sel) v.selText = m.id + ' ' + m.name + ': ' + m.val; });
      }

      v.reset = function () { self.resetLayout(); };
      this.applySky(v);
      v.ui = this.uiVals(demo);
      v.dev = this.devVals(v);
      var dv = v.dev;
      v.ui.devCount = String(dv.total);
      v.ui.devWarn = dv.warnCount > 0;
      v.ui.devWarnCls = 'wdot ' + (dv.red ? 'red' : 'orange');
      v.ui.devAria = 'Eszközök: ' + dv.online + '/' + dv.total + ' online' + (dv.warnCount ? ', ' + dv.warnCount + ' figyelmeztetés' : '');
      v.wx = this.wxVals(v);
      v.cons = this.consVals(v, dv);
      v.ov = this.ovVals(v, dv, v.cons);
      this.sceneVals(v, dv);
      v.adv = this.advVals(v, dv);
      v.info = { srcLabel: st.live ? 'ÉLŐ' : 'DEMÓ', srcCls: 'dp-src ' + (st.live ? 'live' : 'demo'),
        bubbleCls: 'ip-bubble ' + v.adv.curTone + (st.advTalk ? ' talk' : ''), showCur: v.adv.showCur };
      return v;
    }

    // ---- Eszközök panel ------------------------------------------------------------------

    devVals(v) {
      var self = this, st = this.state, now = st.now || Date.now(), live = st.live;
      var demo = !live, src = live || demoDevices(now, v.L);
      var pinXY = {};
      v.pins.forEach(function (m) { pinXY[m.id] = [m.x, m.y]; });
      var gw = src.G;
      var all = PIN_IDS.map(function (id, order) {
        var info = DEVINFO[id], cat = CAT[info.cat];
        var d = src[dbPink(id)], stt = (d && d.status) || {}, meta = d && d.meta;
        var ir = info.kind === 'ir';
        var has = !!d || (ir && !!gw);
        var online = ir ? (gw ? gw.online !== false : null) : d ? d.online !== false : null;
        var upd = ir ? null : typeof stt._upd === 'number' ? stt._upd * 1000 : (d && d.ts ? Date.parse(d.ts) : null);
        var age = upd != null && isFinite(upd) ? now - upd : null;
        var batt = batteryOf(stt);
        var value = 'nincs adat', valCls = 'muted', open = null;
        if (has) {
          if (info.kind === 'thermo') {
            var t = liveTemp(stt, meta), h = humidityOf(stt, meta);
            value = t == null ? '-' : fmtNum(t, 1) + ' °C' + (h == null ? '' : ' \u00b7 ' + fmtNum(h, 0) + ' %');
            valCls = info.cat === 'temp' && id === '3' ? 'hot' : '';
          } else if (info.kind === 'contact') {
            open = liveOpen(stt);
            value = open == null ? '-' : open ? 'NYITVA' : 'Zárva';
            valCls = open ? 'bad' : 'good';
          } else if (info.kind === 'switch3') {
            var n = liveStage(stt);
            value = n == null ? '-' : n + '/3 fokozat';
            valCls = n ? 'warm' : '';
          } else if (info.kind === 'breaker') {
            var w = livePower(stt, meta);
            value = stt.switch === false ? 'Kikapcsolva' : w == null ? '-' : fmtNum(w, 0) + ' W';
            valCls = w != null && w >= 50 ? 'warm' : '';
          } else if (info.kind === 'gateway') {
            value = online === false ? 'Offline' : 'Online'; valCls = online === false ? 'bad' : 'good';
          } else if (ir) {
            var acp = acPower(src);
            value = acp.short.charAt(0).toUpperCase() + acp.short.slice(1);
            valCls = acp.kind === 'run' ? 'warm' : acp.kind === 'off' ? 'bad' : '';
          }
        }
        var badges = [], warn = false, red = false;
        if (!has) badges.push({ t: 'Nincs adat', c: 'grey' });
        if (has && online === false) { badges.push({ t: 'Nem elérhető', c: 'red' }); warn = red = true; }
        if (batt && batt.pct < 10) { badges.push({ t: 'Elem lemerült', c: 'red' }); warn = red = true; }
        else if (batt && batt.pct < 20) { badges.push({ t: 'Elem merül', c: 'orange' }); warn = true; }
        var lim = STALE_MIN[info.kind];
        var stale = has && lim != null && age != null && age > lim * 60000;
        if (stale) { badges.push({ t: 'Régóta hallgat', c: 'orange' }); warn = true; }
        if (!warn && has && !ir && age != null && age < 10 * 60000 && online !== false) badges.push({ t: 'Friss', c: 'green' });
        var note = '';
        if (ir && acPower(src).kind === 'off') note = 'A 9-es (klíma) kismegszakító le van kapcsolva: a klíma nem kap áramot.';
        if (LOADS[id] && has && online !== false && stt.switch === false) note = circuitState(src, id).text;
        if (open && (stale || online === false)) note = 'A NYITVA jelzés lehet régi: ' + hoursAgoText(age) + ' nem jelentett' + (batt && batt.pct < 20 ? ', és merül az eleme.' : '.');
        else if (open && batt && batt.pct < 20) note = 'A NYITVA jelzés lehet hibás: merül az eleme (' + batt.pct + ' %).';
        var details = [];
        if (ir) {
          var acd = acPower(src);
          details = [{ k: 'Táp', v: '9-es okos kismegszakító (k9)', cls: '' }, { k: 'Állapot', v: acd.text, cls: '' },
            { k: 'Vezérlés', v: 'infravörös, a gatewayen át', cls: '' }, { k: 'Visszajelzés', v: 'csak a 9-es kör méréséből', cls: '' }];
        } else {
          var keys = Object.keys(stt).sort(function (a, b) { var fa = FRIENDLY[a] ? 0 : 1, fb = FRIENDLY[b] ? 0 : 1; if (a === '_upd') fa = 2; if (b === '_upd') fb = 2; return fa - fb || a.localeCompare(b); });
          details = keys.map(function (k) { return { k: FRIENDLY[k] || k, v: codeValue(k, stt[k], meta), cls: FRIENDLY[k] ? '' : 'raw' }; });
          if (LOADS[id]) { var cs = circuitState(src, id); details.unshift({ k: 'Táplálja', v: LOADS[id].what + ': ' + cs.short, cls: '' }); }
          if (d && d.ts) details.push({ k: 'Tárolva', v: budTime(Date.parse(d.ts)), cls: '' });
          if (!details.length) details.push({ k: 'Állapot', v: 'nincs részlet', cls: '' });
        }
        var expanded = st.devOpenId === id;
        return {
          id: id, order: order, cat: info.cat, warn: warn, red: red, online: online,
          kind: info.kind, has: has, age: age, stale: stale, open: open, battPct: batt ? batt.pct : null, badgeList: badges,
          temp: has && info.kind === 'thermo' ? liveTemp(stt, meta) : null,
          stage: has && info.kind === 'switch3' ? liveStage(stt) : null,
          watt: has && info.kind === 'breaker' && stt.switch !== false ? livePower(stt, meta) : null,
          swOff: has && info.kind === 'breaker' && online !== false && stt.switch === false,
          pinLabel: id, name: info.name, room: info.room, icon: cat.icon, tile: cat.tile,
          value: value, valCls: 'dc-val ' + valCls,
          hasBatt: !!batt, batt: batt ? (batt.label ? batt.label : batt.pct + ' %') : '', battW: batt ? batt.pct + '%' : '0%',
          battCls: 'hp ' + (!batt ? '' : batt.pct < 10 ? 'red' : batt.pct < 20 ? 'orange' : 'ok'),
          onlineCls: 'dc-dot ' + (online === false ? 'off' : online ? 'on' : 'unk'),
          seen: ir ? 'a gatewayen át' : age != null ? 'utolsó jelzés: ' + ago(age) + (lim == null && age > 90 * 60000 ? ' · csak változáskor jelez' : '') : 'nincs jelzés',
          badges: badges, hasBadges: badges.length > 0, note: note,
          expanded: expanded, expandedAttr: expanded ? 'true' : 'false',
          details: details,
          cls: 'dcard' + (warn ? ' warn' : '') + (red ? ' red' : '') + (expanded ? ' open' : '') + (st.sel === 'd' + id ? ' sel' : ''),
          aria: id + ': ' + info.name + ', ' + value + (badges.length ? ', ' + badges.map(function (b) { return b.t; }).join(', ') : ''),
          pick: function () { self.pickDevice(id, pinXY[id]); }
        };
      });
      var total = all.length, onl = all.filter(function (c) { return c.online === true; }).length;
      var warnCount = all.filter(function (c) { return c.warn; }).length;
      var f = st.devFilter || 'all';
      var cards = all.filter(function (c) { return f === 'all' ? true : f === 'warn' ? c.warn : c.cat === f; })
        .sort(function (a, b) { return (b.warn - a.warn) || (b.red - a.red) || (a.order - b.order); });
      var tabs = [['all', 'Mind', total], ['warn', 'Figyelem', warnCount]].concat(['temp', 'door', 'power', 'other'].map(function (k) {
        return [k, CAT[k].label, all.filter(function (c) { return c.cat === k; }).length];
      })).map(function (t) {
        return { label: t[1], n: String(t[2]), cls: 'dp-tab' + (f === t[0] ? ' on' : '') + (t[0] === 'warn' && t[2] ? ' hot' : ''), sel: f === t[0] ? 'true' : 'false',
          pick: function () { self.setState({ devFilter: t[0] }); } };
      });
      return {
        open: !!st.devOpen, total: total, online: onl, warnCount: warnCount, red: all.some(function (c) { return c.red; }),
        warnText: warnCount ? warnCount + ' figyelmeztetés' : 'minden rendben',
        warnCls: 'dp-warn ' + (warnCount ? (all.some(function (c) { return c.red; }) ? 'red' : 'orange') : 'ok'),
        xpW: Math.round(onl / total * 100) + '%',
        srcLabel: demo ? 'DEMO' : 'ÉLŐ', srcCls: 'dp-src ' + (demo ? 'demo' : 'live'),
        cards: cards, tabs: tabs, empty: cards.length === 0, all: all, demo: demo
      };
    }

    // a jelenet díszei a valós (vagy demó) állapotot követik: huzat-szellem csak nyitott
    // ablaknál/ajtónál, a Túlfűtő láng csak ha a kályha megy
    sceneVals(v, dv) {
      var by = {}; dv.all.forEach(function (c) { by[c.id] = c; });
      v.ghosts = [];
      v.pins.forEach(function (m) {
        var c = by[m.id];
        if (!DRAFT_NAME[m.id] || !c || !c.open || c.online === false) return;
        var o = GHOST_OFF[m.id] || [0, -36];
        v.ghosts.push({ tr: 'translate(' + Math.round(m.ax + o[0]) + ' ' + Math.round(m.ay + o[1]) + ')', id: m.id, label: v.ghosts.length === 0,
          wind: 'M' + (-o[0]) + ',' + (-o[1]) + ' Q' + Math.round(-o[0] / 2 - 6) + ',' + Math.round(-o[1] / 2 - 10) + ' -12,6' });
      });
      var P = by.P;
      v.flameOn = !!(P && P.online !== false && P.stage > 0);
      v.flameLabel = v.flameOn ? 'Kályha fűt · ' + P.stage + ' kW' : '';
    }

    // Belépve (listán szereplő szerepkörrel) a Supabase-ből olvas (az adatgyűjtő óránként tölti);
    // ha ott nincs friss adat, vagy nincs belépés, közvetlenül az Open-Meteótól kér.
    fetchWeather() {
      var self = this;
      var done = function (data) {
        self.setState({ weather: data ? { ok: true, data: data, at: Date.now() } : (self.state.weather && self.state.weather.ok ? self.state.weather : { ok: false }) });
      };
      var direct = function () {
        if (!window.fetch) { done(null); return; }
        fetch(WX_URL, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { var d = parseWeather(j); if (d) d.src = 'api'; done(d); }, function () { done(null); });
      };
      if (this.sb && this.state.role) {
        var now = Date.now();
        this.sb.from('weather_hourly').select('ts,temp,apparent,weather_code,cloud,radiation,is_day,fetched_at')
          .gte('ts', new Date(now - 3 * 3600000).toISOString()).order('ts', { ascending: true }).limit(48)
          .then(function (res) {
            var d = res && !res.error ? weatherFromRows(res.data, Date.now()) : null;
            if (d) done(d); else direct();
          }, direct);
        return;
      }
      direct();
    }

    // a KINT csip: Élő módban valós időjárás + kb. 3 órás előrejelzés, előbeállításnál a pálya értéke
    wxVals(v) {
      var self = this, st = this.state, now = st.now || Date.now(), w = st.weather;
      var o = { open: false, openAttr: 'false', hasIcon: false, hasFc: false, fc: '', icon: '#wx-cloud' };
      o.toggle = function (e) {
        var r = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
        self.setState({ wxOpen: !st.wxOpen, wxAt: r ? [r.left, r.bottom] : null, advOpen: false });
      };
      o.close = function () { self.setState({ wxOpen: false }); };
      if (!st.liveSky) {
        o.now = v.L.outside;
        o.title = 'Pálya-előbeállítás: kitalált kinti érték. Az Élő gombbal a valódi budapesti időjárás látszik.';
        o.hint = o.title; o.hintCls = 'wx-hint steady'; o.desc = 'előbeállítás';
      } else if (!w || !w.ok) {
        o.now = '--';
        o.title = w ? 'Időjárás most nem elérhető. ' + WX_SRC : 'Időjárás betöltése... ' + WX_SRC;
        o.hint = w ? 'Időjárás most nem elérhető.' : 'Időjárás betöltése...'; o.hintCls = 'wx-hint steady'; o.desc = '';
      } else {
        var d = w.data, k = wxKind(d.code, d.day), fc = wxForecast(d, now);
        o.hasIcon = true; o.icon = k[0]; o.desc = k[1];
        o.now = fmtNum(d.t, 1) + ' °C';
        o.app = d.app != null ? 'Hőérzet ' + fmtNum(d.app, 1) + ' °C' : '';
        if (fc) { o.hasFc = true; o.fc = fc.label; o.hint = fc.hint.text; o.hintCls = 'wx-hint ' + fc.hint.kind; }
        else { o.hint = 'Előrejelzés most nincs.'; o.hintCls = 'wx-hint steady'; }
        o.title = 'Kint most ' + o.now + ', ' + k[1] + (o.app ? ' (' + o.app.toLowerCase() + ')' : '') + '.' +
          (fc ? ' Várható ' + fc.at.hh + '-kor ' + fmtNum(fc.at.t, 1) + ' °C. ' + fc.hint.text : '') + ' ' + WX_SRC +
          (d.src === 'db' ? ' (az adatgyűjtő óránkénti adata, Supabase).' : '.');
      }
      o.hasApp = !!o.app;
      o.aria = 'Kint: ' + o.now + (o.hasFc ? ', várható ' + o.fc : '') + '. Részletek';
      o.live = !!st.liveSky;
      if (st.wxOpen) {
        var at = st.wxAt || [16, 80], vw = window.innerWidth;
        o.open = true; o.openAttr = 'true';
        o.cx = Math.round(Math.max(8, Math.min(at[0], vw - 308)));
        o.cy = Math.round(at[1] + 8);
      }
      return o;
    }

    loadHistory() {
      var self = this, st = this.state, now = Date.now();
      if (!this.sb || !st.user || !st.role) return;
      this.setState({ histAt: now });
      this.sb.from('device_status').select('pink,ts,online,status').gte('ts', new Date(now - MOVE_WINDOW_MS).toISOString())
        .in('pink', ['X5', 'X7', 'X8', 'X9', 'P', '5', '6', '7', '8', '9', '10']).order('ts', { ascending: true }).limit(5000)
        .then(function (res) { self.setState({ hist: res.error ? { error: true } : { rows: res.data || [] } }); }, function () { self.setState({ hist: { error: true } }); });
      // nyílászárók: hosszabb előzmény (csak változáskor és óránként van sor, így 30 nap is kevés)
      this.sb.from('device_status').select('pink,ts,status').gte('ts', new Date(now - DOOR_WINDOW_MS).toISOString())
        .in('pink', ['5', '6', '7', '8', '9', '10']).order('ts', { ascending: true }).limit(5000)
        .then(function (res) { if (!res.error) self.setState({ histDoors: res.data || [] }); }, function () {});
    }

    consVals(v, dv) {
      var self = this, st = this.state, now = st.now || Date.now();
      var by = {}; dv.all.forEach(function (c) { by[c.id] = c; });
      var src = st.live || demoDevices(now, v.L);
      var rows = st.live ? (st.hist && st.hist.rows) || null : demoHistory(src, now).concat(demoContactHistory(src, now));
      var histNote = st.live ? (!st.hist ? 'Előzmény betöltése...' : st.hist.error ? 'Az előzmény most nem érhető el.' : '') : '';
      var totalB = 0, totalA = 0, any = false;
      var circ = CONS.map(function (c) {
        var card = by[c.id], d = src[c.db], meta = d && d.meta;
        var off = !d || d.online === false, w = off ? null : card ? card.watt : null;
        if (!off && w == null && d && d.status && d.status.switch === false) w = 0;
        if (w != null) { any = true; if (c.meter === 'B') totalB += w; else totalA += w; }
        var kw = (w || 0) / 1000, ft;
        if (w == null) ft = '';
        else if (w < 1) ft = '0 Ft/óra';
        else if (c.meter === 'B') ft = 'kb. ' + fmtNum(kw * PRICE_B, 0) + ' Ft/óra';
        else ft = fmtNum(kw * PRICE_A1_IN, 0) + '-' + fmtNum(kw * PRICE_A1_OUT, 0) + ' Ft/óra';
        var pct = w == null ? 0 : Math.min(100, Math.round(w / c.max * 100));
        var spark = rows ? sparkPath(seriesFrom(rows, c.db, meta, now), now, c.max, w) : null;
        return {
          id: c.id, name: c.name, short: c.short, color: c.color, icon: c.icon, meter: c.meter === 'B' ? 'B mérő' : 'A1 mérő',
          w: w, wText: off ? 'nem elérhető' : fmtW(w), ft: ft, hasFt: !!ft,
          ftTip: c.meter === 'B' ? 'B mérő, keret felett 60,9 Ft/kWh' : 'A1 mérő: kereten belül 36,2, felett 70,1 Ft/kWh',
          pct: pct + '%', maxText: 'max ' + fmtW(c.max), dash: pct + ' 100', cls: 'cs-row' + (off ? ' off' : '') + (w != null && w >= 50 ? ' on' : ''),
          hasSpark: !!spark, spark: spark || '', share: 0
        };
      });
      var total = totalA + totalB;
      circ.forEach(function (c) { c.share = total > 0 && c.w ? Math.max(0.5, c.w / total * 100) : 0; c.shareW = c.share + '%'; c.hasShare = c.share > 0; });
      var P = src.P, pOff = !P || P.online === false, stage = pOff ? null : liveStage(P.status || {});
      var k5 = circ[0].w;
      var mismatch = '';
      if (stage != null && stage > 0 && k5 != null && k5 < 200) mismatch = 'A kapcsoló ' + stageSuffix(stage) + ' fokozaton, de a kályhakör nem vesz fel áramot (a B kör most nem kap áramot?)';
      else if (stage === 0 && k5 != null && k5 > 500) mismatch = 'A kapcsoló szerint a kályha ki van kapcsolva, de a kályhakör ' + fmtW(k5) + ' teljesítményt vesz fel. Nézd meg a kapcsolót.';
      else if (stage > 0 && k5 != null && Math.abs(k5 - stage * 1000) > Math.max(300, stage * 250)) {
        mismatch = 'Eltérés: a kapcsoló ' + stageSuffix(stage) + ' fokozaton áll (' + stage + ' kW), a kismegszakító mérése ' + fmtW(k5) +
          ' (kb. ' + Math.max(0, Math.round(k5 / 1000)) + ' kW-nyi fokozat). Kiégett egy fűtőszál, vagy késik a kapcsoló állapota?';
      }
      var verdict = stage == null && k5 == null ? 'Nincs adat' : stage == null ? 'A kapcsoló nem elérhető, csak a mérés látszik' :
        k5 == null ? 'A kismegszakító nem elérhető, nem összevethető' : mismatch ? '' : 'Egyezik: a kapcsoló és a mérés is ' + (stage === 0 ? 'KI' : stage + ' kW');
      var stageHist = rows ? sparkPath(seriesFrom(rows, 'P', null, now, 'stage'), now, 3, stage) : null;
      var stoveFt = stage ? Math.round(stage * PRICE_B) : 0;
      var steps = [1, 2, 3].map(function (n) {
        return { n: String(n), label: n + ' kW', cls: 'cs-step' + (stage != null && n <= stage ? ' lit' : '') + (stage === n ? ' cur' : ''),
          flame: stage != null && n <= stage ? '#ff7a1a' : '#e3dccd', flameIn: stage != null && n <= stage ? '#ffd23f' : '#f3efe6' };
      });
      var lo = totalB * PRICE_B / 1000 + totalA * PRICE_A1_IN / 1000, hi = totalB * PRICE_B / 1000 + totalA * PRICE_A1_OUT / 1000;
      return {
        btnText: any ? fmtW(total) : '-- kW',
        btnAria: 'Fogyasztás: ' + (any ? fmtW(total) + ' most a mért körökön' : 'nincs adat') + '. Megnyitás',
        srcLabel: st.live ? 'ÉLŐ' : 'DEMO', srcCls: 'dp-src ' + (st.live ? 'live' : 'demo'),
        total: fmtW(total), totalFt: any ? (Math.round(lo) === Math.round(hi) ? 'kb. ' + fmtNum(lo, 0) : fmtNum(lo, 0) + '-' + fmtNum(hi, 0)) + ' Ft/óra' : '',
        circ: circ,
        stage: stage, stageBig: stage == null ? '?' : stage === 0 ? 'KI' : stage + ' kW',
        stageLine: stage == null ? 'A kapcsoló nem elérhető' : stage === 0 ? 'Kikapcsolva · 0 kW' : stageSuffix(stage) + ' fokozat · ' + stage + ' kW · ~' + stoveFt + ' Ft/óra',
        stageCls: 'cs-stage s' + (stage == null ? 'x' : stage),
        steps: steps, hasMismatch: !!mismatch, mismatch: mismatch, verdict: verdict, verdictOk: !mismatch && stage != null && k5 != null,
        hasStageHist: !!stageHist, stageHist: stageHist || '',
        histNote: histNote, hasHistNote: !!histNote,
        stoveFt: stoveFt, k5: k5, any: any
      };
    }

    // egy tű kijelölése és ráközelítés (az Élő áttekintés sorai)
    pinFocus(id, pins) {
      var m = pins.filter(function (x) { return x.id === id; })[0];
      this.setState({ sel: 'd' + id, ovSheet: false });
      if (m) focusStage(m.x, m.y, false);
    }

    ovVals(v, dv, cons) {
      var self = this, st = this.state, now = st.now || Date.now(), pins = v.pins;
      var by = {}; dv.all.forEach(function (c) { by[c.id] = c; });
      var src = st.live || demoDevices(now, v.L);
      var rows = st.live ? st.histDoors || (st.hist && st.hist.rows) || null : demoContactHistory(src, now);
      var pick = function (id) { return function () { self.pinFocus(id, pins); }; };
      var stage = cons.stage;
      var stove = {
        big: cons.stageBig, bigCls: cons.stageCls.replace('cs-stage', 'ov-stage'),
        line: cons.stageLine, w: cons.k5 == null ? 'kályhakör: --' : 'mért ' + fmtW(cons.k5),
        ft: stage ? '~' + cons.stoveFt + ' Ft/óra' : stage === 0 ? '0 Ft/óra' : '',
        pips: [1, 2, 3].map(function (n) { var on = stage != null && n <= stage; return { cls: 'ov-pip' + (on ? ' on' : ''), flame: on ? '#ff7a1a' : '#e3dccd' }; }),
        hasMismatch: cons.hasMismatch, mismatch: cons.mismatch, pick: pick('P'),
        sw: stage == null ? 'nem elérhető' : stage === 0 ? 'KI' : stageSuffix(stage) + ' fokozat · ' + stage + ' kW',
        br: cons.k5 == null ? 'nem elérhető' : 'mért ' + fmtW(cons.k5),
        hasVerdict: !!cons.verdict, verdict: cons.verdict, verdictCls: 'ov-vd' + (cons.verdictOk ? ' ok' : '')
      };
      var power = { total: cons.btnText === '-- kW' ? '--' : cons.total, totalFt: cons.totalFt,
        rows: cons.circ.map(function (c) {
          var cs = circuitState(src, c.id);
          return { id: c.id, name: c.name, short: c.short, wText: c.w == null ? '--' : fmtW(c.w), pct: c.pct, color: c.color, ft: c.ft || '', pick: pick(c.id),
            tag: cs.tag, tagCls: 'st ' + cs.kind, tip: cs.text };
        }) };
      // elemszint kis jele (nyílászárók, hőmérők)
      var battOf = function (c) {
        if (!c || c.battPct == null) return { has: false, txt: '', w: '0%', cls: 'ov-bat' };
        var p = c.battPct;
        return { has: true, txt: c.batt && !/%/.test(c.batt) ? c.batt : p + '%', w: Math.max(8, p) + '%',
          cls: 'ov-bat' + (p < 10 ? ' red' : p < 20 ? ' orange' : ''), tip: 'Elem: ' + (c.batt || p + ' %') };
      };
      var doorRows = OV_DOORS.map(function (d, i) {
        var c = by[d.id], x = src[d.id], open = c ? c.open : null, off = !c || !c.has || c.online === false;
        var fb = x && x.status && typeof x.status._upd === 'number' ? x.status._upd * 1000 : x && x.ts ? Date.parse(x.ts) : null;
        var mv = off ? null : lastMove(rows, d.id, open, fb);
        // pontosan: mióta (óra, perc) és mikor (nap, időpont) változott; ha az előzményben nincs váltás,
        // akkor "legalább" a legrégebbi ismert sor óta (pl. az adatgyűjtés kezdete)
        var dur = mv ? durHM(now - mv.ms) : '', at = mv ? dayTime(mv.ms, now) : '';
        var stTxt = open ? 'NYITVA' : 'zárva';
        var text, tile, line2 = '';
        if (off) { text = 'nem elérhető'; tile = 'nem elérhető'; }
        else if (!mv) { text = stTxt; tile = stTxt; }
        else {
          text = stTxt + ' · ' + dur;
          line2 = (mv.atLeast ? 'legalább ' : '') + at + ' óta';
          tile = stTxt + ' · ' + (mv.atLeast ? '>' : '') + dur;
        }
        var whenTip = mv ? stTxt + (mv.atLeast ? ' legalább ' : ' ') + at + ' óta (' + dur + ')' + (mv.atLeast ? ', az előzményben nincs korábbi váltás' : '') : '';
        var notes = [];
        if (c && c.battPct != null && c.battPct < 20) notes.push('elem ' + c.battPct + ' %');
        if (c && c.stale) notes.push(durText(c.age) + ' nem jelentett');
        var warn = notes.length > 0 || off;
        return { id: d.id, order: i, open: !!open, name: d.name, short: d.short, text: text, tileText: tile, tip: d.name + ': ' + (whenTip || text), line2: line2, hasLine2: !!line2, bat: battOf(c), mv: off ? null : mv,
          icon: OV_WINDOWS[d.id] ? (open ? ICON_WIN_OPEN : ICON_WIN_SHUT) : (open ? ICON_DOOR_OPEN : ICON_DOOR_SHUT),
          icoCls: 'ov-ico' + (off ? ' off' : open ? ' open' : ' shut'), icoTitle: (OV_WINDOWS[d.id] ? 'Ablak' : 'Ajtó') + ': ' + (off ? 'nem elérhető' : open ? 'nyitva' : 'zárva'), note: notes.join(', '), hasNote: notes.length > 0,
          cls: 'ov-door' + (open ? ' open' : '') + (warn ? ' warn' : ''), tileCls: 'ov-tile door' + (open ? ' open' : warn ? ' warn' : ''), pick: pick(d.id) };
      }).sort(function (a, b) { return (b.open - a.open) || (a.order - b.order); });
      var openCount = doorRows.filter(function (d) { return d.open; }).length;
      // Utolsó mozgás a lakásban: a helyszíni érzékelők (ajtók, ablakok) legutóbbi váltása.
      // A kályhakapcsoló és a kismegszakítók nem számítanak: azok távolról is kapcsolhatók.
      var mvLast = null, mvOldest = null;
      doorRows.forEach(function (d) {
        if (!d.mv) return;
        if (!d.mv.atLeast && (!mvLast || d.mv.ms > mvLast.ms)) mvLast = { ms: d.mv.ms, name: d.name, open: d.open };
        if (d.mv.atLeast && (!mvOldest || d.mv.ms < mvOldest.ms)) mvOldest = { ms: d.mv.ms };
      });
      var motion = mvLast ? {
        big: durHM(now - mvLast.ms), sub: (mvLast.open ? 'nyitás: ' : 'csukás: ') + mvLast.name.toLowerCase() + ', ' + dayTime(mvLast.ms, now),
        tip: 'Utolsó mozgás a lakásban: ' + mvLast.name + ' ' + (mvLast.open ? 'kinyílt' : 'becsukódott') + ' ' + dayTime(mvLast.ms, now) + ' (' + durHM(now - mvLast.ms) + ' ezelőtt). Csak a helyszíni érzékelők (ajtók, ablakok) számítanak.',
        cls: 'chip mvchip' + (now - mvLast.ms < 30 * 60000 ? ' fresh' : ''), pick: pick(doorRows.filter(function (d) { return d.name === mvLast.name; })[0].id)
      } : {
        big: mvOldest ? '>' + durHM(now - mvOldest.ms) : '--', sub: mvOldest ? 'nincs mozgás ' + dayTime(mvOldest.ms, now) + ' óta' : 'nincs adat',
        tip: 'Az ajtók és ablakok előzményében nincs váltás.', cls: 'chip mvchip', pick: function () {}
      };
      var temps = OV_TEMPS.map(function (t) {
        var c = by[t.id], tv = c && c.online !== false ? c.temp : null, d = src[t.id];
        var h = d && d.status ? humidityOf(d.status, d.meta) : null;
        var k = tv == null ? 'off' : t.id === '3' ? (tv > 30 ? 'stove' : 'ok') : tv < 19 ? 'cold' : tv > 23 ? 'warm' : 'ok';
        return { id: t.id, name: t.name, t: tv == null ? '--' : fmtNum(tv, 1) + '°', h: h == null ? '' : fmtNum(h, 0) + ' %', hasH: h != null, bat: battOf(c), cls: 'ov-t ' + k, tileCls: 'ov-tile temp ' + k, pick: pick(t.id) };
      });
      var acp = acPower(src);
      var ac = { text: acp.short, tip: acp.text, cls: 'ov-acv' + (acp.kind === 'run' ? ' on' : acp.kind === 'off' ? ' off' : ''), pick: pick('11') };
      var nBatt = dv.all.filter(function (c) { return c.battPct != null && c.battPct < 20; }).length;
      var nOff = dv.all.filter(function (c) { return c.has && c.online === false; }).length;
      var nStale = dv.all.filter(function (c) { return c.stale; }).length;
      var parts = [];
      if (nBatt) parts.push(nBatt + ' elem merül');
      if (nOff) parts.push(nOff + ' nem elérhető');
      if (nStale) parts.push(nStale + ' régóta hallgat');
      var alerts = { has: parts.length > 0, none: parts.length === 0, text: parts.join(' · '), short: parts.join(', '),
        open: function () { self.setState({ devOpen: true, devFilter: 'warn', drawer: false, advOpen: false, ovSheet: false }); } };
      var variant = st.ovVariant === 2 || st.ovVariant === 3 ? st.ovVariant : 1, tab = st.ovTab || 'power';
      var phone = window.innerWidth <= 700;
      return {
        cls: 'f' + variant, f1: variant === 1, f2: variant === 2, f3: variant === 3,
        srcLabel: st.live ? 'ÉLŐ' : 'DEMO', srcCls: 'dp-src ' + (st.live ? 'live' : 'demo'),
        title: st.live ? 'Élő áttekintés' : 'Áttekintés', isDemo: !st.live, motion: motion,
        srcTip: st.live ? 'A lakás valódi, élő adatai (Supabase).' : 'Kitalált demóadat a kiválasztott pálya szerint. A lakás valódi adatai belépés után látszanak.',
        stove: stove, power: power,
        doors: { rows: doorRows, openCount: String(openCount), anyOpen: openCount > 0, openText: openCount + ' nyitva', heroCls: 'ov-h3o' + (openCount ? ' open' : '') },
        temps: temps, ac: ac, alerts: alerts,
        tabs: [['power', 'Áram'], ['doors', 'Nyílászárók'], ['climate', 'Klíma és hő']].map(function (t) {
          return { label: t[1], cls: 'ov-tab' + (tab === t[0] ? ' on' : ''), sel: tab === t[0] ? 'true' : 'false', pick: function () { self.setState({ ovTab: t[0] }); } };
        }),
        tabPower: tab === 'power', tabDoors: tab === 'doors', tabClimate: tab === 'climate',
        v1Cls: variant === 1 ? 'on' : '', v2Cls: variant === 2 ? 'on' : '', v3Cls: variant === 3 ? 'on' : '',
        v1P: variant === 1 ? 'true' : 'false', v2P: variant === 2 ? 'true' : 'false', v3P: variant === 3 ? 'true' : 'false',
        pickV1: function () { self.setState({ ovVariant: 1 }); }, pickV2: function () { self.setState({ ovVariant: 2 }); }, pickV3: function () { self.setState({ ovVariant: 3 }); },
        inSheet: false, sheetOpen: !!st.ovSheet, sheetAttr: st.ovSheet ? 'true' : 'false',
        closeSheet: function () { self.setState({ ovSheet: false }); },
        btn: function () {
          if (window.innerWidth <= 700) self.setState({ ovSheet: !st.ovSheet, devOpen: false, drawer: false, advOpen: false, wxOpen: false });
          else { var el = document.querySelector('.ovpanel'); if (el) el.focus(); }
        }
      };
    }

    // szöveg vágólapra (az Energiaőr tippjei: továbbküldéshez); régi böngészőn kijelöléses tartalék
    copyText(text, okMsg) {
      var self = this;
      var fallback = function () {
        try {
          var ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand('copy'); document.body.removeChild(ta);
          self.toast(ok ? okMsg : 'A másolás nem sikerült: jelöld ki a szöveget, és Ctrl+C.', ok ? 'ok' : 'err');
        } catch (e) { self.toast('A másolás nem sikerült: jelöld ki a szöveget, és Ctrl+C.', 'err'); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { self.toast(okMsg, 'ok'); }, fallback);
      else fallback();
    }

    advNext() {
      var st = this.state;
      if (st.advHover || st.advOpen || st.advMute) return;
      var self = this;
      this.setState({ advIdx: (st.advIdx || 0) + 1, advTalk: true });
      clearTimeout(this._advTalk);
      this._advTalk = setTimeout(function () { self.setState({ advTalk: false }); }, 1400);
    }

    advVals(v, dv) {
      var self = this, st = this.state, now = st.now || Date.now();
      var tips = advTips(dv.all, now, st.liveSky && st.weather && st.weather.ok ? wxForecast(st.weather.data, now) : null), n = tips.length, idx = (st.advIdx || 0) % n, cur = tips[idx];
      var pinXY = {}; v.pins.forEach(function (m) { pinXY[m.id] = [m.x, m.y]; });
      var show = function (t) { return function () { self.setState({ advOpen: false, sel: t.dev ? 'd' + t.dev : st.sel }); if (t.dev && pinXY[t.dev]) focusStage(pinXY[t.dev][0], pinXY[t.dev][1], false); }; };
      var variant = st.advVariant === 1 || st.advVariant === 2 ? st.advVariant : 3;
      var name = 'Energiaőr';
      return {
        cls: 'adv v' + variant + (st.advTalk ? ' talk' : '') + (st.advMute ? ' muted' : '') + (st.advOpen ? ' open' : ''),
        href: '#adv-v' + variant,
        showBubble: !st.advMute, muted: !!st.advMute,
        text: cur.short, tone: 'adv-bubble ' + cur.tone, count: (idx + 1) + '/' + n, curTone: cur.tone,
        showCur: cur.dev ? show(cur) : function () { self.setState({ advIdx: (st.advIdx || 0) + 1 }); },
        aria: name + ' tanácsa: ' + cur.short + '. Kattints az összes tanácsért.',
        btnAria: name + ': ' + n + ' tanács. Megnyitás',
        open: !!st.advOpen, openAttr: st.advOpen ? 'true' : 'false',
        toggle: function () { self.setState({ advOpen: !st.advOpen, devOpen: false, drawer: false, wxOpen: false, ovSheet: false }); },
        close: function () { self.setState({ advOpen: false }); },
        enter: function () { if (!st.advHover) self.setState({ advHover: true }); },
        leave: function () { if (st.advHover) self.setState({ advHover: false }); },
        list: tips.map(function (t, i) {
          return { cls: 'adv-tip ' + t.tone + (i === idx ? ' cur' : '') + (st.ipOpen === i ? ' open' : ''), text: t.long, short: t.short, hasDev: !!t.dev,
            expanded: st.ipOpen === i ? 'true' : 'false', toggle: function () { self.setState({ ipOpen: st.ipOpen === i ? null : i }); },
            moreLabel: st.ipOpen === i ? 'Kevesebb' : 'Több',
            copy: function () { self.copyText(t.long, 'Tipp másolva: beillesztheted (Ctrl+V) üzenetbe.'); },
            devAria: 'Mutasd a térképen: ' + (t.dev && DEVINFO[t.dev] ? DEVINFO[t.dev].name : ''), show: show(t) };
        }),
        n: String(n),
        mutePressed: st.advMute ? 'true' : 'false',
        muteLabel: st.advMute ? 'Buborék bekapcsolása' : 'Buborék némítása',
        toggleMute: function () { var m = !st.advMute; sSet(LOCAL, ADV_MUTE_KEY, m ? '1' : '0'); self.setState({ advMute: m }); },
        v1Cls: 'adv-var' + (variant === 1 ? ' on' : ''), v2Cls: 'adv-var' + (variant === 2 ? ' on' : ''),
        v3Cls: 'adv-var' + (variant === 3 ? ' on' : ''),
        v1Pressed: variant === 1 ? 'true' : 'false', v2Pressed: variant === 2 ? 'true' : 'false', v3Pressed: variant === 3 ? 'true' : 'false',
        pickV1: function () { self.setState({ advVariant: 1 }); },
        pickV2: function () { self.setState({ advVariant: 2 }); },
        pickV3: function () { self.setState({ advVariant: 3 }); }
      };
    }

    pickDevice(id, xy) {
      if (this.state.devOpenId === id) { this.setState({ devOpenId: null }); return; }
      this.setState({ devOpenId: id, sel: 'd' + id });
      if (xy) focusStage(xy[0], xy[1], true);
    }

    // Élő módban az ég, a nap/hold, az ablakok és a lámpák a valódi budapesti időt követik;
    // a szint-gombok előbeállítások maradnak.
    applySky(v) {
      var self = this, st = this.state, now = st.now || Date.now();
      var LV = super.levels();
      v.L = Object.assign({}, v.L);
      if (st.liveSky) {
        var sky = liveSky(LV, now), look = sky.look;
        Object.keys(look).forEach(function (k) { v.L[k] = look[k]; });
        v.L.sunHalo = Math.round(look.sunOp * 0.8 * 100) / 100;
        v.wins.forEach(function (w) { w.fill = look.glass; });
        var tt = sunTimes(now);
        v.titleLine = 'ÉLŐ: ' + sky.phase + ', ' + budTime(now);
        v.titleTip = 'A napszak a valódi budapesti időt követi.' +
          (tt.rise ? ' Napkelte ' + budTime(tt.rise) + ', napnyugta ' + budTime(tt.set) + '.' : '');
        v.skyPhase = sky.phase;
      } else {
        v.L.sunOp = 1; v.L.sunHalo = 0.8;
        v.titleLine = 'VILÁG ' + v.L.code + ': ' + v.L.name;
        v.titleTip = 'Előbeállított pálya. Az Élő gombbal vissza a valódi napszakhoz.';
        v.skyPhase = '';
      }
      v.levels.forEach(function (l, j) {
        if (st.liveSky) { l.cls = l.cls.replace(/\bon\b\s*/, ''); l.pressed = 'false'; }
        l.pick = function () { self.setState({ lvl: j, liveSky: false }); };
      });
      v.livePill = {
        cls: st.liveSky ? 'on' : '',
        pressed: st.liveSky ? 'true' : 'false',
        label: st.liveSky ? 'ÉLŐ' : 'Vissza: ÉLŐ',
        pick: function () { self.setState({ liveSky: true, lvl: null, now: Date.now() }); }
      };
    }

    // -- felület -----------------------------------------------------------------------------

    uiVals(demo) {
      var self = this, st = this.state, cur = posKey(st.pos);
      var dirty = cur !== st.savedKey;
      var owner = st.role === 'owner';
      var loggedIn = !!st.user;
      var chip, chipCls;
      if (dirty) { chip = 'Nem mentett változás'; chipCls = 'stchip dirty'; }
      else if (st.savedAt) { chip = 'Mentve ' + hhmm(st.savedAt); chipCls = 'stchip saved'; }
      else { chip = 'Alap elrendezés'; chipCls = 'stchip'; }

      var saveHint = '';
      if (!this.sb) saveHint = 'A felhős mentés ezen az oldalon nincs beállítva.';
      else if (!loggedIn) saveHint = 'Mentéshez jelentkezz be';
      else if (!st.role) saveHint = 'A fiókod még nincs jogosultsági listán, ezért csak demó módban látod a térképet.';
      else if (!owner) saveHint = 'Csak olvasás: menteni és törölni a tulaj tud.';

      var layouts = st.layouts.map(function (l) {
        var confirm = st.confirmId === l.id;
        return {
          name: l.name, isDefault: !!l.is_default, time: 'Módosítva: ' + dateTime(l.updated_at),
          cls: 'lrow' + (st.current && st.current.id === l.id ? ' cur' : ''),
          confirm: confirm, actions: !confirm, canEdit: owner, canDefault: owner && !l.is_default,
          delAria: l.name + ' törlése',
          load: function () { self.loadLayout(l); },
          makeDefault: function () { self.makeDefault(l); },
          askDelete: function () { self.setState({ confirmId: l.id }); },
          cancelDelete: function () { self.setState({ confirmId: null }); },
          doDelete: function () { self.deleteLayout(l); }
        };
      });

      var role = ROLE[st.role] || { label: 'NINCS JOG', color: '#8a8f9c' };
      return {
        showDemo: demo,
        acctLabel: loggedIn ? (role.label === 'TULAJ' ? 'Fiók és mentés' : 'Fiók') : 'Belépés',
        drawerOpen: st.drawer,
        drawerOpenAttr: st.drawer ? 'true' : 'false',
        toggleDrawer: function () { self.setState({ drawer: !st.drawer, devOpen: false, saveAs: false, confirmId: null }); },
        toggleDev: function () { self.setState({ devOpen: !st.devOpen, drawer: false, advOpen: false, ovSheet: false, saveAs: false, confirmId: null }); },
        closeDev: function () { self.setState({ devOpen: false }); },
        devOpenAttr: st.devOpen ? 'true' : 'false',
        openDrawer: function () { self.setState({ drawer: true }); },
        closeDrawer: function () { self.setState({ drawer: false, saveAs: false, confirmId: null }); },
        noConfig: !this.sb,
        showLogin: !!this.sb && !loggedIn,
        loggedIn: loggedIn,
        email: st.user ? st.user.email : '',
        roleLabel: role.label, roleColor: role.color,
        busy: st.busy,
        login: function (e) { e.preventDefault(); self.login(); },
        passType: st.peek ? 'text' : 'password',
        peekPressed: st.peek ? 'true' : 'false',
        peekLabel: st.peek ? 'Jelszó elrejtése' : 'Jelszó megjelenítése',
        peekOn: !!st.peek, peekOff: !st.peek,
        peekKeep: function (e) { e.preventDefault(); },
        peek: function () { self.togglePeek(); },
        remember: st.remember ? true : null,
        setRemember: function (e) { authStore.setRemember(e.target.checked); self.setState({ remember: e.target.checked }); },
        logout: function () { self.logout(); },
        currentName: st.current ? st.current.name : 'nincs mentve',
        chip: chip, chipCls: chipCls,
        chipTitle: st.current ? 'Elrendezés: ' + st.current.name : 'Mentett elrendezések megnyitása',
        saveHint: saveHint,
        saveDisabled: !owner || st.busy,
        saveAsDisabled: !owner || st.busy,
        saveAsShown: owner && st.saveAs,
        save: function () { self.saveLayout(); },
        saveAsOpen: function () {
          self.setState({ saveAs: true });
          setTimeout(function () { var i = document.getElementById('f27-newname'); if (i) i.focus(); }, 60);
        },
        saveAsCancel: function () { self.setState({ saveAs: false }); },
        saveAs: function (e) { e.preventDefault(); self.saveAsLayout(); },
        noLayouts: loggedIn && !!st.role && st.layouts.length === 0,
        layouts: layouts,
        undo: function () { self.undo(); },
        redo: function () { self.redo(); },
        undoDisabled: this.undoStack.length === 0,
        redoDisabled: this.redoStack.length === 0,
        toasts: st.toasts.map(function (t) { return { text: t.text, cls: 'toast ' + t.kind }; })
      };
    }

    toast(text, kind) {
      var id = ++this.toastSeq, self = this;
      this.setState({ toasts: this.state.toasts.concat([{ id: id, text: text, kind: kind || 'info' }]).slice(-2) });
      setTimeout(function () { self.setState({ toasts: self.state.toasts.filter(function (t) { return t.id !== id; }) }); }, kind === 'err' ? 6500 : 4000);
    }

    errText(error, fallback) {
      var msg = (error && (error.message || error.error_description)) || '';
      var code = error && error.code;
      if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Nincs jogosultságod ehhez: menteni és törölni csak a tulaj tud.';
      if (code === '23505' || /duplicate key/i.test(msg)) return 'Ilyen nevű elrendezés már van.';
      if (/invalid login credentials/i.test(msg) || code === 'invalid_credentials') return 'Hibás e-mail vagy jelszó.';
      if (/failed to fetch|network|load failed/i.test(msg) || (error && error.name === 'TypeError')) return 'Hálózati hiba, próbáld újra.';
      return fallback + (msg ? ' (' + msg + ')' : '');
    }

    // -- elrendezés-történet -------------------------------------------------------------------

    recordChange(beforeKey) {
      var after = posKey(this.state.pos);
      if (beforeKey === after) return;
      this.undoStack.push(beforeKey);
      if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
      this.redoStack = [];
      this.forceUpdate();
    }

    applyKey(key) { this._drag = null; this.setState({ pos: JSON.parse(key), drag: null }); }

    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(posKey(this.state.pos));
      this.applyKey(this.undoStack.pop());
    }

    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(posKey(this.state.pos));
      this.applyKey(this.redoStack.pop());
    }

    resetLayout() {
      var before = posKey(this.state.pos);
      this._drag = null;
      this.state.pos = {};
      this.recordChange(before);
      this.setState({ pos: {}, sel: null, drag: null });
    }

    // -- Supabase ------------------------------------------------------------------------------

    initSupabase() {
      var cfg = window.F27_CONFIG || {};
      if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase || !window.supabase.createClient) return;
      var self = this;
      try {
        this.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
          auth: { storage: authStore, persistSession: true, autoRefreshToken: true }
        });
      } catch (e) {
        this.sb = null;
        return;
      }
      this.sb.auth.onAuthStateChange(function (event, session) {
        // A Supabase ajánlása szerint a visszahívásból ne indítsunk közvetlenül új kérést.
        setTimeout(function () {
          if (session && session.user) {
            if (!self.state.user || self.state.user.id !== session.user.id) self.afterLogin(session.user);
          } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && self.state.user)) {
            self.afterLogout();
          }
        }, 0);
      });
    }

    login() {
      var email = (document.getElementById('f27-email') || {}).value || '';
      var pass = (document.getElementById('f27-pass') || {}).value || '';
      if (!email.trim() || !pass) { this.toast('Add meg az e-mail címet és a jelszót.', 'err'); return; }
      var self = this;
      this.setState({ busy: true });
      this.sb.auth.signInWithPassword({ email: email.trim(), password: pass }).then(function (res) {
        self.setState({ busy: false });
        if (res.error) { self.toast(self.errText(res.error, 'Sikertelen belépés.'), 'err'); return; }
        var p = document.getElementById('f27-pass');
        if (p) { p.value = ''; p.type = 'password'; }
        self.setState({ peek: false });
      }, function (err) {
        self.setState({ busy: false });
        self.toast(self.errText(err, 'Sikertelen belépés.'), 'err');
      });
    }

    // Jelszó megjelenítése / elrejtése: a fókusz és a kurzor a mezőben marad.
    togglePeek() {
      var inp = document.getElementById('f27-pass'), on = !this.state.peek;
      var focused = inp && document.activeElement === inp;
      var a = inp ? inp.selectionStart : null, b = inp ? inp.selectionEnd : null;
      if (inp) inp.type = on ? 'text' : 'password';
      this.setState({ peek: on });
      // a típusváltás a kurzort a mező elejére tenné: a kirajzolás után visszaállítjuk
      var restore = function () { try { inp.focus(); if (a != null) inp.setSelectionRange(a, b); } catch (e) { /* nem baj */ } };
      if (focused) { restore(); requestAnimationFrame(function () { requestAnimationFrame(restore); }); }
    }

    logout() {
      var self = this;
      this.sb.auth.signOut().then(function () { authStore.clearAuth(); self.afterLogout(); }, function (err) { authStore.clearAuth(); self.toast(self.errText(err, 'Sikertelen kilépés.'), 'err'); });
    }

    afterLogin(user) {
      var self = this;
      this.setState({ user: { id: user.id, email: user.email || '' }, role: null, layouts: [], live: null });
      this.sb.from('app_users').select('role').eq('user_id', user.id).maybeSingle().then(function (res) {
        if (res.error) { self.toast(self.errText(res.error, 'A jogosultság lekérése nem sikerült.'), 'err'); return; }
        var role = res.data ? res.data.role : null;
        self.setState({ role: role });
        if (!role) { self.toast('Belépve, de a fiókod nincs a jogosultsági listán.', 'err'); return; }
        self.toast('Belépve: ' + (ROLE[role] ? ROLE[role].label.toLowerCase() : role) + '.', 'ok');
        self.refreshLayouts(true);
        self.refreshLive();
        self.loadHistory();
        self.fetchWeather();
        clearInterval(self.liveTimer);
        self.liveTimer = setInterval(function () { self.refreshLive(); }, LIVE_REFRESH_MS);
      }, function (err) { self.toast(self.errText(err, 'A jogosultság lekérése nem sikerült.'), 'err'); });
    }

    afterLogout() {
      clearInterval(this.liveTimer);
      this.setState({ user: null, role: null, layouts: [], current: null, live: null, saveAs: false, confirmId: null, savedAt: null, savedKey: '{}' });
      this.toast('Kiléptél. A térkép demó módban fut.', 'info');
    }

    refreshLayouts(autoLoadDefault) {
      var self = this;
      return this.sb.from('layouts').select('id,name,data,is_default,updated_at').order('name', { ascending: true }).then(function (res) {
        if (res.error) { self.toast(self.errText(res.error, 'Az elrendezések betöltése nem sikerült.'), 'err'); return; }
        var rows = res.data || [];
        var cur = self.state.current && rows.filter(function (r) { return r.id === self.state.current.id; })[0];
        self.setState({ layouts: rows, current: cur || null });
        if (autoLoadDefault) {
          var def = rows.filter(function (r) { return r.is_default; })[0];
          if (def) self.loadLayout(def, true);
        }
      }, function (err) { self.toast(self.errText(err, 'Az elrendezések betöltése nem sikerült.'), 'err'); });
    }

    refreshLive() {
      var self = this;
      if (!this.sb || !this.state.user || !this.state.role) return;
      this.sb.from('device_latest').select('pink,ts,online,status').then(function (res) {
        if (res.error) { self.toast(self.errText(res.error, 'Az élő adatok lekérése nem sikerült.'), 'err'); return; }
        var rows = res.data || [];
        if (!rows.length) { self.setState({ live: null }); return; }
        var live = { __any: true };
        rows.forEach(function (r) { live[r.pink] = { ts: r.ts, online: r.online, status: r.status || {}, meta: null }; });
        self.setState({ live: live });
        // A skálák (devices.meta) csak a tulajnak olvashatók; ha nincs meg (pl. nem futott
        // a 002-es migráció), csendben marad a feltételezett skála.
        if (self.state.role !== 'owner') return;
        self.sb.from('devices').select('pink,meta').then(function (r2) {
          if (r2.error || !r2.data || self.state.live !== live) return;
          var next = Object.assign({}, live);
          r2.data.forEach(function (d) { if (next[d.pink] && d.meta) next[d.pink] = Object.assign({}, next[d.pink], { meta: d.meta }); });
          self.setState({ live: next });
        }, function () { /* skála nélkül is működik */ });
      }, function (err) { self.toast(self.errText(err, 'Az élő adatok lekérése nem sikerült.'), 'err'); });
    }

    loadLayout(row, isDefault) {
      var before = posKey(this.state.pos);
      var pos = posFromLayout(row.data, this.pieceIds());
      this._drag = null;
      this.state.pos = pos;
      this.recordChange(before);
      this.setState({ pos: pos, drag: null, sel: null, current: { id: row.id, name: row.name }, savedKey: posKey(pos), savedAt: row.updated_at, confirmId: null });
      this.toast('Betöltve: ' + row.name + (isDefault ? ' (alapértelmezett)' : '') + '.', 'ok');
    }

    saveLayout() {
      if (this.state.role !== 'owner') return;
      if (!this.state.current) { this.setState({ saveAs: true }); return; }
      var self = this, key = posKey(this.state.pos), cur = this.state.current;
      this.setState({ busy: true });
      this.sb.from('layouts').update({ data: layoutFromPos(this.state.pos) }).eq('id', cur.id).select('id,name,data,is_default,updated_at').then(function (res) {
        self.setState({ busy: false });
        if (res.error) { self.toast(self.errText(res.error, 'A mentés nem sikerült.'), 'err'); return; }
        var row = (res.data || [])[0];
        if (!row) { self.toast('A mentés nem sikerült: nincs jogosultságod, vagy az elrendezést közben törölték.', 'err'); return; }
        self.setState({ savedKey: key, savedAt: row.updated_at || new Date().toISOString() });
        self.toast('Mentve: ' + row.name + '.', 'ok');
        self.refreshLayouts(false);
      }, function (err) { self.setState({ busy: false }); self.toast(self.errText(err, 'A mentés nem sikerült.'), 'err'); });
    }

    saveAsLayout() {
      if (this.state.role !== 'owner') return;
      var input = document.getElementById('f27-newname');
      var name = ((input && input.value) || '').trim();
      if (!name) { this.toast('Adj nevet az elrendezésnek.', 'err'); return; }
      if (name.length > 80) { this.toast('A név legfeljebb 80 karakter lehet.', 'err'); return; }
      var dup = this.state.layouts.some(function (l) { return l.name.toLowerCase() === name.toLowerCase(); });
      if (dup) { this.toast('Ilyen nevű elrendezés már van.', 'err'); return; }
      var self = this, key = posKey(this.state.pos);
      this.setState({ busy: true });
      this.sb.from('layouts').insert({ name: name, data: layoutFromPos(this.state.pos) }).select('id,name,data,is_default,updated_at').single().then(function (res) {
        self.setState({ busy: false });
        if (res.error) { self.toast(self.errText(res.error, 'A mentés nem sikerült.'), 'err'); return; }
        var row = res.data;
        self.setState({ saveAs: false, current: { id: row.id, name: row.name }, savedKey: key, savedAt: row.updated_at || new Date().toISOString() });
        self.toast('Elmentve új névvel: ' + row.name + '.', 'ok');
        self.refreshLayouts(false);
      }, function (err) { self.setState({ busy: false }); self.toast(self.errText(err, 'A mentés nem sikerült.'), 'err'); });
    }

    makeDefault(row) {
      if (this.state.role !== 'owner') return;
      var self = this, sb = this.sb;
      this.setState({ busy: true });
      // Előbb a régi alapértelmezettet kapcsoljuk ki (egyedi index: csak egy lehet).
      sb.from('layouts').update({ is_default: false }).eq('is_default', true).select('id').then(function (res) {
        if (res.error) throw res.error;
        return sb.from('layouts').update({ is_default: true }).eq('id', row.id).select('id');
      }).then(function (res) {
        self.setState({ busy: false });
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) { self.toast('Nem sikerült: nincs jogosultságod, vagy az elrendezést közben törölték.', 'err'); return; }
        self.toast(row.name + ' lett az alapértelmezett elrendezés.', 'ok');
        self.refreshLayouts(false);
      }).catch(function (err) {
        self.setState({ busy: false });
        self.toast(self.errText(err, 'Az alapértelmezés beállítása nem sikerült.'), 'err');
        self.refreshLayouts(false);
      });
    }

    deleteLayout(row) {
      if (this.state.role !== 'owner') return;
      var self = this;
      this.setState({ busy: true });
      this.sb.from('layouts').delete().eq('id', row.id).select('id').then(function (res) {
        self.setState({ busy: false, confirmId: null });
        if (res.error) { self.toast(self.errText(res.error, 'A törlés nem sikerült.'), 'err'); return; }
        if (!res.data || !res.data.length) { self.toast('A törlés nem sikerült: nincs jogosultságod.', 'err'); return; }
        if (self.state.current && self.state.current.id === row.id) self.setState({ current: null, savedKey: '{}', savedAt: null });
        self.toast('Törölve: ' + row.name + '.', 'ok');
        self.refreshLayouts(false);
      }, function (err) { self.setState({ busy: false }); self.toast(self.errText(err, 'A törlés nem sikerült.'), 'err'); });
    }
  }

  // ---- indítás ----------------------------------------------------------------------------------

  // ---- nézet: illesztés + nagyítás + mozgatás -----------------------------------------------------
  // A színpad mindig 1440x900; az illesztett lépték fölött z-szeresre nagyítható (1-4x).
  // Nagyítás: Ctrl/Cmd + görgő, touchpad-csippentés, érintőképernyős csippentés, +/- gombok,
  // billentyűk (Ctrl/Cmd + plusz/mínusz/0, vagy csak +, -, 0). Nagyítva: görgő vagy húzás mozgat.
  var ZMIN = 1, ZMAX = 4;
  var view = { z: 1, tx: 0, ty: 0 };
  var stageEl = null, zoomLabel = null, zoomOutBtn = null, zoomInBtn = null;

  // Ha a színpad alatt vagy mellett nincs elég szabad perem a nagyítósávnak, alul helyet hagyunk neki,
  // hogy ne takarja a térkép jobb alsó sarkát (érmek). Ilyenkor a térkép kicsit kisebb.
  var BAR_H = 56, BAR_W = 220;
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / 1440, vh / 900);
    var freeV = vh - 900 * s, freeH = vw - 1440 * s;
    if (freeV >= BAR_H || freeH / 2 >= BAR_W) return { s: s, h: vh };
    return { s: Math.min(vw / 1440, (vh - BAR_H) / 900), h: vh - BAR_H };
  }
  function baseScale() { return layout().s; }

  function clampView() {
    var lay = layout(), s = lay.s * view.z, W = 1440 * s, H = 900 * s, vw = window.innerWidth, vh = lay.h;
    view.tx = W <= vw ? (vw - W) / 2 : Math.min(0, Math.max(vw - W, view.tx));
    // telefonon a nyitott Eszközök lap alá is be lehet húzni a színpadot, hogy a kiválasztott tű a lap felett legyen
    var sheet = vw <= 700 && (document.getElementById('f27-devpanel') || document.getElementById('f27-ovsheet')), padB = sheet ? sheet.offsetHeight : 0;
    view.ty = H + padB <= vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H - padB, view.ty));
  }

  function applyView() {
    clampView();
    var s = baseScale() * view.z;
    stageEl.style.transform = 'translate(' + Math.round(view.tx) + 'px,' + Math.round(view.ty) + 'px) scale(' + s + ')';
    // az Eszközök panel a felső sáv alatt indul (nagyítás nélküli helyzet szerint), hogy a sáv gombjai elérhetők maradjanak
    var lay0 = layout();
    var de = document.documentElement.style;
    de.setProperty('--adv-x', Math.round(view.tx + 302 * s) + 'px');
    de.setProperty('--adv-y', Math.round(window.innerHeight - (view.ty + 636 * s)) + 'px');
    document.documentElement.style.setProperty('--dp-top', Math.max(12, Math.round((lay0.h - 900 * lay0.s) / 2 + 90 * lay0.s)) + 'px');
    document.body.classList.toggle('zoomed', view.z > 1.001);
    if (zoomLabel) zoomLabel.textContent = Math.round(view.z * 100) + '%';
    if (zoomOutBtn) zoomOutBtn.disabled = view.z <= ZMIN + 0.001;
    if (zoomInBtn) zoomInBtn.disabled = view.z >= ZMAX - 0.001;
  }

  // Nagyítás egy képernyőpont körül: a pont alatti tartalom a helyén marad.
  function zoomTo(z, cx, cy) {
    var nz = Math.min(ZMAX, Math.max(ZMIN, z));
    if (cx == null) { cx = window.innerWidth / 2; cy = window.innerHeight / 2; }
    var f = nz / view.z;
    view.tx = cx - (cx - view.tx) * f;
    view.ty = cy - (cy - view.ty) * f;
    view.z = nz;
    applyView();
  }
  function zoomBy(factor, cx, cy) { zoomTo(view.z * factor, cx, cy); }

  // Egy színpadpont (pl. eszköztű) a látható rész közepére, legalább 2,2x nagyítással.
  // Asztalon az Eszközök panel a jobb oldalt takarja, telefonon az alsó részt.
  function focusStage(x, y) {
    if (!stageEl) return;
    var lay = layout(), vw = window.innerWidth, vh = lay.h, phone = vw <= 700;
    // telefonon a színpadnak magasabbnak kell lennie a képernyőnél, különben középre igazodik és a lap takarná
    view.z = Math.min(ZMAX, Math.max(view.z, 2.2));
    var s = lay.s * view.z;
    var cx = phone ? vw / 2 : (vw - Math.min(380, vw * 0.92) - 24) / 2;
    var cy = phone ? vh * 0.2 : vh / 2;
    view.tx = cx - x * s; view.ty = cy - y * s;
    stageEl.style.transition = 'transform .35s ease';
    applyView();
    setTimeout(function () { stageEl.style.transition = ''; }, 400);
  }
  function resetView() { view.z = 1; applyView(); }
  function panBy(dx, dy) { view.tx += dx; view.ty += dy; applyView(); }

  function editableTarget(t) {
    var tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
  }
  // Görgethető elem a célpont felett (pl. a Fiók és mentés panel listája): annak hagyjuk a görgőt.
  function scrollableAncestor(t, dy) {
    for (var el = t; el && el !== stageEl && el.nodeType === 1; el = el.parentElement) {
      var cs = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return el;
      }
    }
    return null;
  }

  function buildZoomBar() {
    var bar = document.createElement('div');
    bar.className = 'zoombar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Nagyítás');
    function mk(label, title, onClick, html) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'zb'; b.title = title; b.setAttribute('aria-label', title);
      if (html) b.innerHTML = html; else b.textContent = label;
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    }
    zoomOutBtn = mk('−', 'Kicsinyítés (Ctrl + görgő vagy -)', function () { zoomBy(1 / 1.25); });
    zoomLabel = document.createElement('span');
    zoomLabel.className = 'zl';
    zoomLabel.setAttribute('aria-live', 'polite');
    bar.appendChild(zoomLabel);
    zoomInBtn = mk('+', 'Nagyítás (Ctrl + görgő vagy +)', function () { zoomBy(1.25); });
    mk('', 'Teljes nézet (0)', resetView,
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>');
    document.body.appendChild(bar);
  }

  function initViewControls(app) {
    stageEl = document.getElementById('stage');
    buildZoomBar();
    applyView();
    window.addEventListener('resize', applyView);

    // Ctrl/Cmd + görgő és touchpad-csippentés (a Chrome ctrlKey-es wheel eseményként küldi).
    window.addEventListener('wheel', function (e) {
      var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      var dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(Math.exp(-dy * 0.0025), e.clientX, e.clientY);
        return;
      }
      if (view.z > 1.001 && !scrollableAncestor(e.target, dy)) {
        e.preventDefault();
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        panBy(-dx, -dy);
      }
    }, { passive: false });

    // Safari touchpad-csippentés.
    var g0 = null;
    window.addEventListener('gesturestart', function (e) { e.preventDefault(); g0 = view.z; }, { passive: false });
    window.addEventListener('gesturechange', function (e) { e.preventDefault(); if (g0 != null) zoomTo(g0 * e.scale, e.clientX, e.clientY); }, { passive: false });
    window.addEventListener('gestureend', function (e) { e.preventDefault(); g0 = null; }, { passive: false });

    // Érintés: két ujj = csippentés (és közben mozgatás), egy ujj vagy egér az üres részen = mozgatás nagyítva.
    var touches = {}, pinch = null, pan = null;
    function tcount() { return Object.keys(touches).length; }
    function pinchGeo() {
      var ids = Object.keys(touches), a = touches[ids[0]], b = touches[ids[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (tcount() === 2) {
        app.cancelDrag();             // a két ujj csippentés, nem bútorhúzás
        pan = null;
        var g = pinchGeo();
        pinch = { d0: g.d, z0: view.z, cx0: g.cx, cy0: g.cy, tx0: view.tx, ty0: view.ty };
      }
    }, true);
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch' && touches[e.pointerId]) {
        touches[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (pinch && tcount() >= 2) {
          var g = pinchGeo();
          var nz = Math.min(ZMAX, Math.max(ZMIN, pinch.z0 * g.d / pinch.d0)), f = nz / pinch.z0;
          view.z = nz;
          view.tx = g.cx - (pinch.cx0 - pinch.tx0) * f;
          view.ty = g.cy - (pinch.cy0 - pinch.ty0) * f;
          applyView();
          return;
        }
      }
      if (pan && e.pointerId === pan.id) {
        view.tx = pan.tx0 + (e.clientX - pan.x0);
        view.ty = pan.ty0 + (e.clientY - pan.y0);
        applyView();
      }
    }, true);
    function lift(e) {
      if (e.pointerType === 'touch') { delete touches[e.pointerId]; if (tcount() < 2) pinch = null; }
      if (pan && e.pointerId === pan.id) { pan = null; document.body.classList.remove('panning'); }
    }
    window.addEventListener('pointerup', lift, true);
    window.addEventListener('pointercancel', lift, true);

    // Mozgatás nagyítva: a bútorok és tűk saját húzása (stopPropagation) és a gombok/mezők kivételével
    // bárhol a színpadon; középső egérgombbal mindenhol.
    stageEl.addEventListener('pointerdown', function (e) {
      if (view.z <= 1.001 || pinch) return;
      var t = e.target;
      var middle = e.button === 1;
      if (!middle) {
        if (e.button > 0) return;
        if (editableTarget(t) || (t.closest && t.closest('button, a, label, select, .drawer'))) return;
      }
      e.preventDefault();
      pan = { id: e.pointerId, x0: e.clientX, y0: e.clientY, tx0: view.tx, ty0: view.ty };
      document.body.classList.add('panning');
    });

    document.addEventListener('keydown', function (e) {
      if (editableTarget(e.target)) return;
      var k = e.key, mod = e.ctrlKey || e.metaKey;
      if (k === '+' || k === '=' || (mod && k === 'Add')) { if (mod || !e.altKey) { e.preventDefault(); zoomBy(1.25); } return; }
      if (k === '-' || k === '_' || (mod && k === 'Subtract')) { if (mod || !e.altKey) { e.preventDefault(); zoomBy(1 / 1.25); } return; }
      if (k === '0' && !e.altKey) { e.preventDefault(); resetView(); return; }
      if (!mod && view.z > 1.001) {
        var step = 60;
        if (k === 'ArrowLeft') { e.preventDefault(); panBy(step, 0); }
        else if (k === 'ArrowRight') { e.preventDefault(); panBy(-step, 0); }
        else if (k === 'ArrowUp') { e.preventDefault(); panBy(0, step); }
        else if (k === 'ArrowDown') { e.preventDefault(); panBy(0, -step); }
      }
    });
  }

  function start() {
    // az Élő áttekintés sablonja két helyre kerül: a színpad jobb oszlopába és a telefonos alsó lapba
    var ovTpl = document.getElementById('ov-template');
    if (ovTpl) {
      ['g3-template', 'dev-template'].forEach(function (id) {
        var t = document.getElementById(id), html = ovTpl.innerHTML;
        if (id === 'dev-template') html = html.replace(/\{\{ov\.inSheet\}\}/g, '{{ true }}');
        t.innerHTML = t.innerHTML.replace('<ov-slot></ov-slot>', html);
      });
    }
    var app = new G3App({ showPath: true, showMarkers: true, snap: true });
    app.initSupabase();
    window.MiniDC.mount(document.getElementById('stage'), document.getElementById('g3-template'), app);
    window.MiniDC.mountExtra(document.getElementById('devlayer'), document.getElementById('dev-template'), app);
    initViewControls(app);
    app.startClock();
    document.addEventListener('pointerdown', function (e) {
      if (app.state.wxOpen && !(e.target.closest && e.target.closest('.wxchip, .wxcard'))) app.setState({ wxOpen: false });
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (e.key === 'Escape' && app.state.drawer) { app.setState({ drawer: false, saveAs: false, confirmId: null }); return; }
      if (e.key === 'Escape' && app.state.wxOpen) { app.setState({ wxOpen: false }); return; }
      if (e.key === 'Escape' && app.state.advOpen) { app.setState({ advOpen: false }); return; }
      if (e.key === 'Escape' && app.state.devOpen) { app.setState({ devOpen: false }); return; }
      if (e.key === 'Escape' && app.state.ovSheet) { app.setState({ ovSheet: false }); return; }
      if (editableTarget(t)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); app.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); app.redo(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
