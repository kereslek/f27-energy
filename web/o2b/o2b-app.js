/* O2B Energy Quest: az élő babaház. A F27 térképének mintájára: égbolt a napszak szerint, csempék a
   felső sávban, tanácsadó (itt Pamutka, a sétáló macska), húzható bútorok Szerkesztés módban,
   mentett elrendezések a Supabase-ben, visszavonás és újra, forgatás 90 fokonként, nagyítás.

   Adat: az O2B saját Supabase-projektje (config.js, csak publishable kulcs). Belépés nélkül demó.
   Az utcanév csak belépve látszik (site_info tábla, a publikus repóban nincs benne).            */
(function () {
  'use strict';
  var S = window.O2BScene, SUN = window.F27Sun, SKY = window.F27Sky, BAT = window.F27Battery;
  var NS = 'http://www.w3.org/2000/svg', INK = '#1e2a44';
  var LAT = 47.48, LON = 19.04, PLAN_NORTH = S.PLAN_NORTH, TARGET_DAY = 22, TARGET_NIGHT = 20;
  var DAILY_URL = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
    '&current=temperature_2m,weather_code&daily=temperature_2m_min,temperature_2m_max&forecast_days=2&timezone=Europe%2FBudapest';

  var DEFAULT_DEVS = [
    ['T1', 'thermo', 'nappali', 'Hőmérő, nappali'], ['T2', 'thermo', 'etkezo', 'Hőmérő, étkező'], ['T3', 'thermo', 'halo', 'Hőmérő, hálószoba'],
    ['T4', 'thermo', 'konyha', 'Hőmérő, konyha'], ['T5', 'thermo', 'kagylo', 'Hőmérő, kagyló szoba'], ['T6', 'thermo', 'gyerek', 'Hőmérő, gyerekszoba'],
    ['T7', 'thermo', 'erkely', 'Hőmérő, erkély (kint)'], ['T8', 'thermo', 'nappali', 'Hőmérő, nappali (2.)'],
    ['R1', 'robot', 'nappali', 'Robotporszívó lent (Dreame Z10 Pro)'], ['R2', 'robot', 'eloter', 'Robotporszívó fent (Roborock S7)'],
    ['K1', 'ac_ir', 'nappali', 'Klíma, nappali'], ['K2', 'ac_ir', 'halo', 'Klíma, hálószoba'], ['K3', 'ac_ir', 'kagylo', 'Klíma, kagyló szoba'], ['K4', 'ac_ir', 'gyerek', 'Klíma, gyerekszoba'],
    ['C1', 'plug', 'furdo_fent', 'Emeleti bojler (meleg víz)'], ['C2', 'plug', 'etkezo', 'Dupla lámpa (étkező, a tükörnél)'], ['C3', 'plug', 'nappali', 'TV led'],
    ['C4', 'plug', 'etkezo', 'Lépcső, fények'], ['C5', 'plug', 'etkezo', 'Tükör, étkező'], ['C6', 'plug', 'etkezo', 'Karácsonyfa'],
    ['C7', 'plug', 'nappali', 'Szarvas'], ['C8', 'plug', 'erkely', 'Karácsonyi fények (erkély)'],
    ['X1', 'breaker', 'furdo_fent', 'Emeleti fürdő köre'], ['M1', 'pir', 'lepcso_fent', 'Mozgásérzékelő (lépcső teteje)'],
    ['IR1', 'ir_hub', 'nappali', 'IR-távirányító, nappali'], ['IR2', 'ir_hub', 'halo', 'IR-távirányító, hálószoba'],
    ['IR3', 'ir_hub', 'kagylo', 'IR-távirányító, kagyló szoba'], ['IR4', 'ir_hub', 'gyerek', 'IR-távirányító, gyerekszoba']
  ].map(function (r) { return { pink: r[0], role: r[1], room: r[2], label: r[3] }; });
  var ROOM_NAMES = { erkely: 'Erkély', nappali: 'Nappali', etkezo: 'Étkező', halo: 'Hálószoba', furdo_lent: 'Fürdő (lent)', eloszoba: 'Előszoba',
    kamra: 'Kamra', konyha: 'Konyha', kagylo: 'Kagyló szoba', gyerek: 'Gyerekszoba', eloter: 'Előtér (fent)', furdo_fent: 'Fürdő (fent)', lepcso_fent: 'Lépcső teteje' };
  var ROLE_COL = { thermo: '#2f6fe4', ac_ir: '#26a5c9', plug: '#ff8a3d', breaker: '#c0399f', pir: '#7a6fb0', ir_hub: '#26a5c9', robot: '#14a38b' };
  var ROLE_GLYPH = { thermo: '°', ac_ir: '❄', plug: 'W', breaker: 'K', pir: '◉', ir_hub: '≈', robot: '◍' };
  var ROLE_NAME = { thermo: 'hőmérő', ac_ir: 'klíma (IR-ről vezérelt)', plug: 'okos konnektor', breaker: 'okos kismegszakító', pir: 'mozgásérzékelő', ir_hub: 'IR-távirányító', robot: 'robotporszívó' };

  var st = {
    k: 0, offs: {}, edit: false, sel: null, user: null, role: null, live: false, devs: DEFAULT_DEVS, latest: {},
    bat: [], batTable: [], wx: null, daily: null, motion: null, street: null, layouts: [], current: null,
    undo: [], redo: [], vb: null, savedKey: '{}', tipIdx: 0,
    floor: 'lo', layers: { heat: true, dev: true, rob: true, lbl: false }
  };
  // nézet: egyszerre egy szint nagyban (Lent / Fent), vagy a babaház (Ház); rétegek; böngészőnként megmarad
  try {
    var fv = localStorage.getItem('o2b-floor'); if (fv === 'lo' || fv === 'up' || fv === 'both') st.floor = fv;
    var lv = JSON.parse(localStorage.getItem('o2b-layers') || 'null'); if (lv) ['heat', 'dev', 'rob'].forEach(function (k) { if (typeof lv[k] === 'boolean') st.layers[k] = lv[k]; });
  } catch (e) { /* privát mód: alapértékek */ }
  var scene = null, sb = null, cfg = window.F27_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var world = $('world'), sky = $('sky');

  // ---- segédek ---------------------------------------------------------------------------------
  function el(t, at, par) { var e = document.createElementNS(NS, t); for (var k in at) if (at[k] != null) e.setAttribute(k, at[k]); if (par) par.appendChild(e); return e; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function fmt(x, d) { return x == null ? '--' : x.toFixed(d == null ? 1 : d).replace('.', ','); }
  function temp(s) { var v = s && (s.va_temperature != null ? s.va_temperature : s.temp_current); return typeof v === 'number' ? v / 10 : null; }
  function watts(s) { var v = s && s.cur_power; return typeof v === 'number' ? v / 10 : null; }
  function isOn(s) { return !!(s && (s.switch_1 === true || s.switch === true)); }
  function target() { var h = new Date().getHours(); return h >= 22 || h < 6 ? TARGET_NIGHT : TARGET_DAY; }
  function ago(ms) { var m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'most' : m < 60 ? m + ' p' : m < 1440 ? Math.floor(m / 60) + ' ó ' + (m % 60) + ' p' : Math.floor(m / 1440) + ' nap'; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function canEdit() { return !st.user || st.role === 'owner'; }
  // Offline eszközök: alapból nem látszanak a lakásban (tű, dekor, listák); a kapcsolóval (Offline gomb)
  // megjeleníthetők. A beállítás ebben a böngészőben marad. Az Eszközök lap mindig mindet mutatja.
  var OFF_KEY = 'o2b-show-offline', PIECE_PINK = { dn_tree: 'C6', lv_deer: 'C7' };
  st.showOff = false; try { st.showOff = localStorage.getItem(OFF_KEY) === '1'; } catch (e) { /* tiltott tároló */ }
  function isOff(p) { var r = st.latest[p]; return !!(r && r.online === false); }
  function hideOff(p) { return !st.showOff && isOff(p); }
  function offCount() { return st.devs.filter(function (d) { return d.role !== 'ir_hub' && isOff(d.pink); }).length; }
  function offBtn() {
    var b = $('b-off'); if (!b) return;
    var n = offCount();
    b.setAttribute('aria-pressed', st.showOff ? 'true' : 'false'); b.classList.toggle('on', st.showOff);
    $('offlbl').textContent = st.showOff ? 'Offline: látszik' : 'Offline: rejtve';
    $('offn').textContent = n; $('offn').hidden = !n;
    b.title = (st.showOff ? 'Az offline eszközök látszanak. Kattints az elrejtésükhöz.' : n + ' offline eszköz elrejtve (pl. karácsonyfa). Kattints a megjelenítésükhöz.');
  }
  function setShowOff(v) {
    st.showOff = !!v; try { localStorage.setItem(OFF_KEY, st.showOff ? '1' : '0'); } catch (e) { /* nem baj */ }
    drawItems('lo'); drawItems('up'); render();
  }
  // kapcsolni a tulaj és a családtag tud (belépés nélkül demóban bárki próbálgathatja); a megtekintő és a bemutató link csak néz
  function canCtl() { return !st.user || st.role === 'owner' || st.role === 'member'; }
  function roClause() { return st.role === 'share' ? 'Bemutató: itt csak nézelődni lehet, kapcsolni nem.' : 'Kapcsolni a tulaj és a családtag tud; neked megtekintő hozzáférésed van.'; }
  function offsKey(o) { var ks = Object.keys(o || {}).filter(function (k) { var v = o[k]; return v && (Math.abs(v[0]) > 1e-6 || Math.abs(v[1]) > 1e-6); }).sort(); return JSON.stringify(ks.map(function (k) { return [k, o[k]]; })); }
  var toastT = 0;
  function toast(t, kind) { var e = $('toast'); e.textContent = t; e.className = kind || ''; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { e.hidden = true; }, 3200); }

  function devState(d) {
    var r = st.latest[d.pink];
    if (!r) return { txt: 'nincs adat', cls: 'off', big: null };
    var s = r.status || {}, off = r.online === false;
    if (d.role === 'thermo') {
      var t = temp(s); if (t == null) return { txt: off ? 'offline' : '--', cls: 'off', big: off ? 'offline' : null };
      var tg = target(), cls = d.room === 'erkely' ? '' : t > tg + 1 ? 'hot' : t < tg - 1.5 ? 'cold' : '';
      return { txt: fmt(t) + ' °C' + (off ? ' (régi)' : ''), cls: off ? 'off' : cls, big: off ? 'offline' : fmt(t) + '°' };
    }
    if (d.role === 'plug' || d.role === 'breaker') {
      if (off) return { txt: 'offline', cls: 'off', big: null };
      var w = watts(s), on = isOn(s);
      return { txt: on ? (w ? fmt(w, 0) + ' W' : 'BE · 0 W') : 'KI', cls: on && w ? 'on' : '', big: on && w ? fmt(w, 0) + ' W' : null };
    }
    if (d.role === 'pir') return { txt: s.pir === 'pir' ? 'mozgás most' : 'nyugalom', cls: s.pir === 'pir' ? 'on' : '', big: s.pir === 'pir' ? 'mozgás!' : null };
    if (d.role === 'ac_ir') return { txt: 'IR-ről vezérelt, állapotot nem küld', cls: '', big: null };
    if (d.role === 'robot') {
      if (off) return { txt: 'offline', cls: 'off', big: null };
      var RS = { cleaning: 'takarít', returning: 'hazamegy', charging: 'töltődik', charged: 'dokkban, feltöltve', docked: 'dokkban', paused: 'szünetel',
        idle: 'áll', error: 'HIBA', mopping: 'mos', drying: 'szárít', washing: 'mopot mos', dust_collecting: 'port ürít', upgrading: 'frissít' };
      var rt = RS[s.state] || s.state || '--', bat = typeof s.battery === 'number' ? s.battery + '%' : '';
      var extra = s.cleaning && s.area_m2 != null ? ' · ' + fmt(+s.area_m2, 0) + ' m², ' + (s.minutes || 0) + ' perc' : '';
      return { txt: rt + (bat ? ' · ' + bat : '') + extra + (s.error ? ' · ' + s.error : ''), cls: s.state === 'error' ? 'hot' : s.cleaning ? 'on' : '',
        big: s.state === 'error' ? 'HIBA' : s.cleaning ? rt + (bat ? ' ' + bat : '') : null };
    }
    return { txt: off ? 'offline' : 'online', cls: off ? 'off' : '', big: null };
  }

  // ---- szintek, hőtérkép, tűk kinézete -------------------------------------------------------------
  function visF() { return st.floor === 'both' ? ['lo', 'up'] : [st.floor]; }
  function pinFloor(p) { var r = null; ['lo', 'up'].forEach(function (f) { if (scene && scene.floors[f].pins.some(function (q) { return q.id === p; })) r = f; }); return r; }
  function pinLayerOn(d) {
    if (d.role === 'robot') return st.layers.rob;
    if (d.role === 'thermo') return !st.layers.heat;      // a hőfok a szoba-címkén látszik
    return st.layers.dev;
  }
  var HEAT_COL = { hot: '#ff7a45', ok: '#2fa56b', cold: '#4f86e8', out: '#58627a', na: '#9aa3b5' };
  var HEAT_FILL = { hot: '#ff8a5b', ok: '#5fc48e', cold: '#6f9cf0' };
  // a szoba hőfoka: az online hőmérők átlaga; c = hot / ok / cold a napszak céljához (erkély: kint)
  function roomTemp(room) {
    // az élő eszközlista mellett a beépített lista hőmérői is (ha egy hőmérő még nincs felderítve, a címke akkor is látszik)
    var seen = {}, ts = st.devs.concat(DEFAULT_DEVS).filter(function (d) { if (d.role !== 'thermo' || d.room !== room || seen[d.pink]) return false; seen[d.pink] = 1; return true; });
    if (!ts.length) return null;
    var v = ts.map(function (d) { var r = st.latest[d.pink]; return r && r.online !== false ? temp(r.status) : null; }).filter(function (x) { return x != null; });
    var t = v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null, tg = target();
    return { t: t, n: v.length, c: room === 'erkely' ? 'out' : t == null ? 'na' : t > tg + 1 ? 'hot' : t < tg - 1.5 ? 'cold' : 'ok' };
  }
  var PIN_ICON = { C1: 'boiler', C2: 'lamp', C3: 'tv', C4: 'bulb', C5: 'lamp', C6: 'star', C7: 'star', C8: 'bulb', X1: 'bolt' };
  function pinIcon(d) { return PIN_ICON[d.pink] || { thermo: 'thermo', ac_ir: 'snow', robot: 'robot', pir: 'motion', breaker: 'bolt' }[d.role] || 'plug'; }
  function pinColors(d, s) {
    var r = st.latest[d.pink], off = !r || r.online === false || s.cls === 'off';
    var lit = (d.role === 'plug' || d.role === 'breaker') && r && r.online !== false && isOn(r.status);
    if (off) return { fill: '#d6d9e0', ic: '#7d8494' };
    if (d.role === 'robot' && s.cls === 'on') return { fill: '#14a38b', ic: '#ffffff', on: true, glow: 'rgba(20,163,139,.35)' };
    if (d.role === 'pir' && s.cls === 'on') return { fill: '#7a6fb0', ic: '#ffffff', on: true, glow: 'rgba(122,111,176,.35)' };
    if (s.cls === 'hot' || s.cls === 'cold') return { fill: s.cls === 'hot' ? '#ff5a3c' : '#2f6fe4', ic: '#ffffff', alert: true };
    if (lit) return { fill: '#ffd23f', ic: INK, on: true, glow: 'rgba(255,210,63,.45)' };
    return { fill: '#fffdf7', ic: ROLE_COL[d.role] || INK };
  }
  function pinLabel(q) {
    var d = q.d, s = q.s;
    if (d.role === 'ac_ir' || d.role === 'ir_hub') return null;
    if (d.role === 'thermo') return s.big;
    var nm = d.role === 'robot' ? robName(d.pink) : d.role === 'pir' ? 'Mozgás' : shortName(d.pink);
    if (nm.length > 20) nm = nm.slice(0, 19) + '…';
    return s.big ? nm + ' · ' + s.big : nm;
  }
  function saveView() { try { localStorage.setItem('o2b-floor', st.floor); localStorage.setItem('o2b-layers', JSON.stringify(st.layers)); } catch (e) { /* nem baj */ } }
  function setFloor(f) {
    if (f === st.floor) return;
    st.floor = f; saveView(); st.vb = null; drawWorld(); floorBar(); render();
  }
  function setLayer(k) { st.layers[k] = !st.layers[k]; saveView(); updateHeat(); floorBar(); drawOverlay(); }
  function floorBar() {
    var fb = $('floorbar'); if (!fb) return;
    Array.prototype.forEach.call(fb.querySelectorAll('[data-floor]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-floor') === st.floor); });
    Array.prototype.forEach.call(fb.querySelectorAll('[data-layer]'), function (b) { b.setAttribute('aria-pressed', !!st.layers[b.getAttribute('data-layer')]); });
    var on = ['heat', 'dev', 'rob', 'lbl'].filter(function (k) { return st.layers[k]; }).length, ll = $('laylbl');
    if (ll) ll.textContent = (innerWidth <= 760 ? '' : 'Rétegek · ') + on;
  }
  // a szobák padlója a célhőfokhoz képest színezve (narancs: melegebb, zöld: a célon, kék: hidegebb)
  function updateHeat() {
    ['lo', 'up'].forEach(function (f) {
      var hg = layer['heat-' + f]; if (!hg) return;
      Array.prototype.forEach.call(hg.querySelectorAll('polygon'), function (pg) {
        var rt = roomTemp(pg.getAttribute('data-room')), c = rt && HEAT_FILL[rt.c];
        pg.setAttribute('fill', c || 'none'); pg.setAttribute('opacity', st.layers.heat && c ? 0.55 : 0);
      });
    });
  }

  // ---- demó adat (belépés nélkül) ----------------------------------------------------------------
  function demo() {
    var L = {}, now = Date.now();
    var t = { T1: 228, T2: 236, T3: 215, T4: 205, T5: 211, T6: 227, T7: 62, T8: 224 };
    Object.keys(t).forEach(function (p) { L[p] = { online: p !== 'T4', status: { va_temperature: t[p], va_humidity: 40, battery_state: p === 'T3' ? 'low' : 'high' } }; });
    [['C1', 0, true], ['C2', 250, true], ['C3', 440, true], ['C4', 0, true], ['C5', 0, false], ['C6', 0, true], ['C7', 0, false], ['C8', 0, false]].forEach(function (r) {
      L[r[0]] = { online: ['C5', 'C6', 'C7', 'C8'].indexOf(r[0]) < 0, status: { cur_power: r[1], switch_1: r[2] } };
    });
    L.X1 = { online: true, status: { cur_power: 0, switch: true } };
    L.M1 = { online: true, status: { pir: 'none', battery_percentage: 100 } };
    L.R1 = { online: true, status: { state: 'charged', cleaning: false, battery: 100, src: 'xiaomi' } };
    L.R2 = { online: true, status: { state: 'cleaning', cleaning: true, battery: 64, area_m2: 18, minutes: 22, src: 'roborock' } };
    st.latest = L; st.wx = st.wx || { temp: 6.1 }; st.motion = now - 12 * 60000;
    st.bat = [{ pink: 'T3', label: 'Hőmérő, hálószoba', level: 'due14', eta_lo: 0, eta_hi: 14 }];
    if (st.ctl) { st.ctl.timers = []; st.ctl.rules = [{ id: 'd1', pink: 'C3', action: 'on', kind: 'sunset', minute: -15, days: 127, enabled: true }, { id: 'd2', pink: 'C3', action: 'off', kind: 'time', minute: 1410, days: 31, enabled: true }, { id: 'd3', pink: 'C3', action: 'off', kind: 'time', minute: 1439, days: 96, enabled: true }, { id: 'd4', pink: 'C2', action: 'on', kind: 'time', minute: 1050, days: 127, enabled: true }, { id: 'd5', pink: 'C2', action: 'off', kind: 'time', minute: 1350, days: 127, enabled: true }]; }
  }

  // ---- égbolt: napszak, felhők, a budai hegyek és a Gellért-hegy ------------------------------------
  function northScreenAngle() {
    // a terv "fel" iránya (az erkély felé) és az észak közti szög: PLAN_NORTH (óramutató szerint)
    var a = PLAN_NORTH * Math.PI / 180, u = Math.sin(a), v = -Math.cos(a), t;
    for (var i = 0; i < st.k; i++) { t = u; u = -v; v = t; }
    var sx = u - v, sy = (u + v) / 2;
    return Math.atan2(sx, -sy) * 180 / Math.PI;        // 0 = a képernyő teteje felé, + jobbra
  }
  function skyPalette(elv) {
    if (elv > 8) return { s0: '#3f8ff0', s1: '#8fd0ff', s2: '#fff1c4', stars: 0, sunC: '#ffe066', hill: '#7cc98a', hill2: '#5fae72', far: '#9bbbe3', glow: 0.15, night: false };
    if (elv > 0) return { s0: '#4a72b8', s1: '#9db6e0', s2: '#ffd9a8', stars: 0, sunC: '#ffd27a', hill: '#6db57d', hill2: '#539a66', far: '#7e93bf', glow: 0.4, night: false };
    if (elv > -7) return { s0: '#27367a', s1: '#7a63ad', s2: '#ffae7a', stars: 0.55, sunC: '#ff9a5a', hill: '#3f7a63', hill2: '#2f6552', far: '#4b4a85', glow: 0.75, night: true };
    return { s0: '#14173f', s1: '#2b2a5e', s2: '#3d3f7a', stars: 1, sunC: '#fff2cc', hill: '#244b45', hill2: '#1b3a37', far: '#2c2a5a', glow: 0.95, night: true };
  }
  function skyVisible() {
    var W = sky.clientWidth || window.innerWidth || 1440, H = sky.clientHeight || window.innerHeight || 900, k = Math.max(W / 1440, H / 900);
    var vw = W / k, vh = H / k, x0 = 720 - vw / 2, y0 = 450 - vh / 2, wide = W >= 900;
    var pl = wide ? (($('pam').offsetWidth || 328) + 24) / k : 0, pr = wide ? (($('ov').offsetWidth || 328) + 24) / k : 0;
    var top = y0 + (($('top').offsetHeight || 60) + 20) / k;
    return { x0: x0 + pl, x1: x0 + vw - pr, top: top, w: W };
  }
  function drawSky() {
    var now = Date.now(), sp = SUN ? SUN.pos(now, LAT, LON) : { alt: 30, az: 180 }, pal = skyPalette(sp.alt);
    sky.innerHTML = '';
    var defs = el('defs', {}, sky), g = el('linearGradient', { id: 'skg', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': pal.s0 }, g); el('stop', { offset: 0.55, 'stop-color': pal.s1 }, g); el('stop', { offset: 1, 'stop-color': pal.s2 }, g);
    var halo = el('radialGradient', { id: 'halo' }, defs);
    el('stop', { offset: 0, 'stop-color': '#fff3c4', 'stop-opacity': 0.9 }, halo); el('stop', { offset: 0.4, 'stop-color': '#ffd27a', 'stop-opacity': 0.35 }, halo); el('stop', { offset: 1, 'stop-color': '#ffb04f', 'stop-opacity': 0 }, halo);
    el('rect', { x: -200, y: -200, width: 1840, height: 1300, fill: 'url(#skg)' }, sky);
    var seed = 7; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var stars = el('g', { opacity: pal.stars }, sky);
    for (var i = 0; i < 60; i++) el('circle', { class: 'tw', cx: r1(rnd() * 1440), cy: r1(20 + rnd() * 380), r: r1(0.8 + rnd() * 1.6), fill: '#fff6dc', style: 'animation-delay:' + r1(rnd() * 3) + 's' }, stars);
    // a nap és a hold a valódi helyén: vízszintesen az égtáj a nézet irányához képest, függőlegesen a magasság
    // a látható égsáv a háttérkép (1440 x 900, „slice”) koordinátáiban: a csempék alatt, az oldalpanelek
    // között, a láthatár fölött; a nap és a hold ide kerül, így telefonon és laptopon is a képernyőn marad
    var vis = skyVisible();
    if (SKY) celestial(sky, SKY.bodies(now, LAT, LON, SKY.viewAzFromNorth(northScreenAngle()),
      { x0: vis.x0 + 40, x1: vis.x1 - 40, horizon: 560, altK: Math.max(1.2, (560 - vis.top - 50) / 70) }), pal);
    [[380, 140, 0.8, 'cloud'], [700, 110, 0.65, 'cloud2'], [1050, 170, 0.75, 'cloud']].forEach(function (c) {
      var cg = el('g', { class: c[3] }, sky), gg = el('g', { transform: 'translate(' + c[0] + ' ' + c[1] + ') scale(' + c[2] + ')', opacity: pal.night ? 0.55 : 1 }, cg);
      [[0, 0, 46, 20], [-22, -12, 24, 18], [18, -16, 26, 20]].forEach(function (e) { el('ellipse', { cx: e[0], cy: e[1], rx: e[2], ry: e[3], fill: '#ffffff', stroke: INK, 'stroke-width': 3 }, gg); });
      el('rect', { x: -44, y: -4, width: 88, height: 20, fill: '#ffffff' }, gg);
    });
    // távoli budai dombok
    var far = 'M-200,640 ', x;
    for (x = -200; x <= 1640; x += 80) far += 'Q' + (x + 40) + ',' + (585 + 25 * Math.sin(x / 130)) + ' ' + (x + 80) + ',' + (610 + 18 * Math.cos(x / 170)) + ' ';
    far += 'L1640,1100 L-200,1100 Z';
    el('path', { d: far, fill: pal.far, stroke: INK, 'stroke-width': 2.5, opacity: 0.75 }, sky);
    // Gellért-hegy (Citadella, Szabadság-szobor) az észak felé eső láthatáron
    var ang = northScreenAngle(), behind = Math.abs(ang) > 110;
    var hs = (behind ? 0.42 : 0.55) * (vis.w < 700 ? 0.62 : 1), hm = 270 * hs + 10;
    var hx = (vis.x0 + vis.x1) / 2 + Math.max(-1, Math.min(1, (behind ? (ang > 0 ? 1 : -1) : ang / 90))) * Math.max(0, (vis.x1 - vis.x0) / 2 - hm);
    var hg = el('g', { transform: 'translate(' + r1(hx) + ' 612) scale(' + hs + ')' }, sky);
    el('path', { d: 'M-260,10 C-200,-40 -150,-120 -60,-150 C-20,-162 30,-160 70,-140 C150,-100 210,-40 270,10 Z', fill: pal.hill, stroke: INK, 'stroke-width': 3.5, 'stroke-linejoin': 'round' }, hg);
    el('path', { d: 'M-150,-60 C-110,-80 -80,-100 -50,-112 M60,-120 C110,-96 150,-70 190,-40', fill: 'none', stroke: pal.hill2, 'stroke-width': 6, 'stroke-linecap': 'round' }, hg);
    el('path', { d: 'M-70,-150 L-70,-168 L-50,-168 L-50,-160 L20,-160 L20,-168 L50,-168 L50,-146', fill: '#d9d2c3', stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round' }, hg);
    el('rect', { x: -4, y: -228, width: 12, height: 64, fill: '#d9d2c3', stroke: INK, 'stroke-width': 3 }, hg);
    el('path', { d: 'M2,-228 L-2,-262 M2,-252 C-8,-280 -2,-292 10,-300 C8,-288 12,-276 6,-262 Z', fill: '#2f8a6a', stroke: INK, 'stroke-width': 2.6, 'stroke-linejoin': 'round' }, hg);
    el('circle', { cx: 2, cy: -236, r: 5, fill: '#2f8a6a', stroke: INK, 'stroke-width': 2 }, hg);
    [[-200, -10], [-170, -30], [-120, -70], [120, -80], [170, -45], [215, -15]].forEach(function (q) {
      el('circle', { cx: q[0], cy: q[1], r: 13, fill: pal.hill2, stroke: INK, 'stroke-width': 2.5 }, hg);
    });
    // felirat nélkül (a ház jelölőire lógott, 2026.11.20); a neve a hegyre mutatva látszik
    var lab = el('title', {}, hg); lab.textContent = 'Gellért-hegy (Citadella, Szabadság-szobor)' + (behind ? ', mögöttünk' : '');
    // közeli fű
    el('path', { d: 'M-200,720 Q360,690 720,712 T1640,700 L1640,1100 L-200,1100 Z', fill: pal.hill2, opacity: 0.9 }, sky);
  }

  // a nap útja (szaggatott ív), a nap korongja, és a hold a fázisával (közös: web/js/sky.js)
  function celestial(svg, B, pal) {
    if (B.track) el('path', { d: B.track, fill: 'none', stroke: '#fff3c4', 'stroke-width': 3, 'stroke-dasharray': '2 9', 'stroke-linecap': 'round', opacity: pal.night ? 0.35 : 0.7 }, svg);
    var s = B.sun;
    if (s.up) {
      el('circle', { cx: r1(s.x), cy: r1(s.y), r: 80, fill: 'url(#halo)', opacity: 0.85 }, svg);
      el('circle', { cx: r1(s.x), cy: r1(s.y), r: 30, fill: pal.sunC, stroke: INK, 'stroke-width': 3 }, svg);
    }
    if (B.nextRise) {
      var nr = B.nextRise, ng = el('g', { opacity: 0.9 }, svg);
      el('path', { d: 'M' + r1(nr.x - 22) + ',' + r1(nr.y) + ' A22,22 0 0 1 ' + r1(nr.x + 22) + ',' + r1(nr.y) + ' Z', fill: '#ffd27a', stroke: INK, 'stroke-width': 3 }, ng);
      el('title', {}, ng).textContent = 'Holnapi napkelte: ' + nr.label;
    }
    var m = B.moon;
    if (m.up) {
      var mg = el('g', { opacity: s.up ? 0.75 : 1 }, svg);
      if (!s.up) el('circle', { cx: r1(m.x), cy: r1(m.y), r: m.r * 2.4, fill: 'url(#halo)', opacity: 0.25 }, mg);
      el('circle', { cx: r1(m.x), cy: r1(m.y), r: m.r, fill: '#3d4677', opacity: 0.85 }, mg);
      el('path', { d: m.lit, fill: '#fff6dc' }, mg);
      el('circle', { cx: r1(m.x), cy: r1(m.y), r: m.r, fill: 'none', stroke: INK, 'stroke-width': 3 }, mg);
      el('title', {}, mg).textContent = 'Hold: ' + m.name + ', ' + Math.round(m.fraction * 100) + '% megvilágított';
    }
  }

  // ---- a világ (babaház) ------------------------------------------------------------------------
  var layer = {};
  function drawWorld() {
    scene = S.build(st.k, st.offs);
    world.innerHTML = '';
    var defs = el('defs', {}, world), ember = el('radialGradient', { id: 'warm' }, defs);
    el('stop', { offset: 0, 'stop-color': '#ffd58a', 'stop-opacity': 0.9 }, ember); el('stop', { offset: 0.5, 'stop-color': '#ffb35c', 'stop-opacity': 0.3 }, ember); el('stop', { offset: 1, 'stop-color': '#ff9a3c', 'stop-opacity': 0 }, ember);
    ['lo', 'up'].forEach(function (f) {
      var F = scene.floors[f], g = el('g', { id: 'fl-' + f }, world);
      if (visF().indexOf(f) < 0) g.setAttribute('display', 'none');
      var b = F.bbox;
      el('ellipse', { cx: r1((b.x0 + b.x1) / 2), cy: r1(b.y1 - 30), rx: r1((b.x1 - b.x0) * 0.45), ry: r1((b.x1 - b.x0) * 0.08), fill: INK, opacity: f === 'up' ? 0.12 : 0.2 }, g);
      if (f === 'up' && st.floor === 'both') {
        var gd = el('g', { 'stroke-dasharray': '6 7', stroke: '#fff7e6', 'stroke-width': 2.4, opacity: 0.8 }, g);
        F.guides.forEach(function (d) { el('path', { d: d }, gd); });
        el('path', { d: F.guides.stair, stroke: '#ffe066', 'stroke-width': 3.4, 'stroke-dasharray': '3 6', opacity: 1 }, gd);
        var tm = el('text', { x: r1(F.guides.mid[0] + 10), y: r1(F.guides.mid[1]), class: 'slab-t' }, g); tm.textContent = 'lépcső ↕';
      }
      if (F.street) drawStreet(F.street, g);
      F.slab.forEach(function (bx) { drawBox(bx, g); });
      F.floors.forEach(function (fp) {
        var pg = el('g', {}, g);
        el('polygon', { points: fp.p, fill: fp.fill, stroke: INK, 'stroke-width': 1.6 }, pg);
        el('path', { d: fp.lines, stroke: fp.lc, 'stroke-width': 1, fill: 'none' }, pg);
      });
      var hg = layer['heat-' + f] = el('g', { class: 'heat', 'pointer-events': 'none' }, g);
      F.floors.forEach(function (fp) { el('polygon', { points: fp.p, 'data-room': fp.id, fill: 'none', opacity: 0, style: 'mix-blend-mode:multiply' }, hg); });
      if (f === 'lo' && visF().indexOf('lo') >= 0) drawCompass(g);
      layer[f] = el('g', { class: 'items' }, g);
      drawItems(f);
    });
    // a macska a feliratok és a tűk alatt: soha nem takar szobanevet vagy tűt (a tulaj, 2026.11.20)
    layer.cat = el('g', { id: 'cat', class: 'walk', role: 'button', tabindex: 0, 'aria-label': 'Pamutka, a tanácsadó macska' }, world);
    layer.labels = el('g', { id: 'labels' }, world);
    layer.pins = el('g', { id: 'pins' }, world);
    buildCat(layer.cat);
    layer.cat.addEventListener('pointerdown', catDown);
    layer.cat.addEventListener('click', function (e) { e.stopPropagation(); if (catDrag.justDropped) { catDrag.justDropped = false; return; } catClick(); });
    layer.drop = el('ellipse', { id: 'catdrop', rx: 30, ry: 9, fill: '#1e2a44', opacity: 0 }, world);
    world.insertBefore(layer.drop, layer.cat);
    updateHeat();
    if (!st.vb) fit(); else applyVB();
  }
  function drawBox(bx, g) {
    if (bx.cyl) {
      el('path', { d: bx.cyl.side, fill: bx.c[1], stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
      el('ellipse', { cx: bx.cyl.tx, cy: bx.cyl.ty, rx: bx.cyl.rx, ry: bx.cyl.ry, fill: bx.c[0], stroke: INK, 'stroke-width': 1.8 }, g);
      return;
    }
    if (bx.alpha) g = el('g', { opacity: bx.alpha }, g);
    if (bx.left) el('polygon', { points: bx.left, fill: bx.c[1], stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
    if (bx.right) el('polygon', { points: bx.right, fill: bx.c[2], stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
    el('polygon', { points: bx.top, fill: bx.c[0], stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
  }
  function drawItems(f) {
    var g = layer[f]; if (!g) return;
    g.innerHTML = '';
    scene.floors[f].items.forEach(function (it) {
      if (it.kind === 'piece' && PIECE_PINK[it.id] && hideOff(PIECE_PINK[it.id])) return;   // offline dekor (karácsonyfa, szarvas)
      var ig = el('g', it.kind === 'piece' ? { class: 'pc' + (it.drag ? ' mv' : '') + (st.sel === 'p:' + it.id ? ' sel' : '') + (drag && drag.id === it.id ? ' drag' : ''), 'data-piece': it.id } : { class: 'wall' }, g);
      it.boxes.forEach(function (bx) { drawBox(bx, ig); });
      if (it.kind === 'piece') {
        var ti = el('title', {}, ig); ti.textContent = it.name + (it.drag && st.edit ? ' (húzható)' : '');
      }
    });
  }
  function drawStreet(s, g) {
    var sg = el('g', { class: 'street' }, g);
    el('polygon', { points: s.road, fill: '#5b6478', stroke: INK, 'stroke-width': 2 }, sg);
    el('path', { d: s.line, stroke: '#ffe8a8', 'stroke-width': 2.5, 'stroke-dasharray': '10 9', fill: 'none' }, sg);
    el('polygon', { points: s.walk, fill: '#c9c2b4', stroke: INK, 'stroke-width': 2 }, sg);
    s.lamps.forEach(function (p) {
      var lg = el('g', { transform: 'translate(' + r1(p[0]) + ',' + r1(p[1]) + ')' }, sg);
      el('line', { x1: 0, y1: 0, x2: 0, y2: -92, stroke: INK, 'stroke-width': 4 }, lg);
      el('path', { d: 'M0,-92 q0,-10 12,-10', stroke: INK, 'stroke-width': 4, fill: 'none' }, lg);
      el('circle', { class: 'breathe', cx: 12, cy: -98, r: 34, fill: 'url(#warm)', opacity: skyPalette(SUN ? SUN.pos(Date.now(), LAT, LON).alt : 30).glow }, lg);
      el('circle', { cx: 12, cy: -98, r: 5, fill: '#fff0c4', stroke: INK, 'stroke-width': 2 }, lg);
    });
    s.trees.forEach(function (p) {
      var tg = el('g', { transform: 'translate(' + r1(p[0]) + ',' + r1(p[1]) + ')' }, sg);
      el('line', { x1: 0, y1: 0, x2: 0, y2: -46, stroke: INK, 'stroke-width': 7, 'stroke-linecap': 'round' }, tg);
      el('line', { x1: 0, y1: 0, x2: 0, y2: -46, stroke: '#8a5a3a', 'stroke-width': 3.5, 'stroke-linecap': 'round' }, tg);
      el('circle', { cx: -18, cy: -58, r: 22, fill: '#5cc06f', stroke: INK, 'stroke-width': 3 }, tg);
      el('circle', { cx: 19, cy: -61, r: 24, fill: '#5cc06f', stroke: INK, 'stroke-width': 3 }, tg);
      el('circle', { cx: 0, cy: -84, r: 28, fill: '#7ad685', stroke: INK, 'stroke-width': 3 }, tg);
      el('circle', { cx: -8, cy: -92, r: 8, fill: '#ffffff', opacity: 0.25 }, tg);
    });
    // az utca neve csak belépve (a privát site_info táblából); kijelentkezve és demóban csak "utca"
    var name = st.user ? (st.street || 'utca') : 'utca', lx = r1(s.label[0]), ly = r1(s.label[1] + 5);
    var t = el('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'slab-t', 'data-street': '1', style: 'font-size:16px', transform: 'rotate(' + r1(s.ang) + ' ' + lx + ' ' + ly + ')' }, sg);
    t.textContent = name;
  }

  // iránytű a talajon (a F27 mintájára), a nap mai útjával, napkeltével, napnyugtával, holnapi min/max-szal
  function drawCompass(g) {
    var P = scene.floors.lo.proj.P, cx = S.COMPASS[0], cy = S.COMPASS[1], R = 1.45;
    var dir = function (az) { var a = (az + PLAN_NORTH - 90) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };
    var at = function (az, r) { var v = dir(az); return P(cx + v[0] * r, cy + v[1] * r, 0); };
    var cg = el('g', { class: 'compass' }, g), ring = [], i;
    for (i = 0; i <= 36; i++) ring.push(at(i * 10, R));
    var pp = function (a) { return a.map(function (q) { return r1(q[0]) + ',' + r1(q[1]); }).join(' '); };
    el('polygon', { points: pp(ring), fill: '#fff7e6', 'fill-opacity': 0.92, stroke: INK, 'stroke-width': 2.5 }, cg);
    var n0 = at(0, R * 0.8), s0 = at(180, R * 0.8), e0 = at(90, R * 0.18), w0 = at(270, R * 0.18);
    el('polygon', { points: pp([e0, n0, w0]), fill: '#e8432f', stroke: INK, 'stroke-width': 1.4 }, cg);
    el('polygon', { points: pp([e0, s0, w0]), fill: '#ffffff', stroke: INK, 'stroke-width': 1.4 }, cg);
    [[0, 'É', '#ff6b52'], [90, 'K', '#fff'], [180, 'D', '#fff'], [270, 'NY', '#fff']].forEach(function (q) {
      var p = at(q[0], R * 1.3), t = el('text', { x: r1(p[0]), y: r1(p[1] + 5), 'text-anchor': 'middle', class: 'slab-t', fill: q[2], style: 'fill:' + q[2] }, cg); t.textContent = q[1];
    });
    if (!SUN) return;
    var now = Date.now(), t = SUN.times(now, LAT, LON), sp = SUN.pos(now, LAT, LON), tip = '';
    if (t.rise) {
      var arc = []; for (i = 0; i <= 16; i++) arc.push(at(t.riseAz + (t.setAz - t.riseAz) * i / 16, R * 0.95));
      el('polyline', { points: pp(arc), fill: 'none', stroke: '#ffd23f', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.95 }, cg);
      var a0 = at(t.riseAz, R * 0.95), a1 = at(t.setAz, R * 0.95);
      el('circle', { cx: r1(a0[0]), cy: r1(a0[1]), r: 4, fill: '#ff9f1c', stroke: INK, 'stroke-width': 1.4 }, cg);
      el('circle', { cx: r1(a1[0]), cy: r1(a1[1]), r: 4, fill: '#c8321f', stroke: INK, 'stroke-width': 1.4 }, cg);
      if (sp.alt > 0) { var q = at(sp.az, R * 0.95); el('circle', { cx: r1(q[0]), cy: r1(q[1]), r: 7, fill: '#ffd23f', stroke: INK, 'stroke-width': 2 }, cg); }
      tip = 'Napkelte ' + SUN.hm(t.rise) + ', napnyugta ' + SUN.hm(t.set) + '. ';
    }
    // a feliratok mindig a kör (és az égtájbetűk) alá, képernyő-irányban, hogy forgatva se csússzanak rá
    var cen = P(cx, cy, 0), lowY = -1e9; for (var li = 0; li <= 36; li++) { var lq = at(li * 10, R * 1.3); if (lq[1] > lowY) lowY = lq[1]; }
    var base = [cen[0], lowY - 12];
    var t1 = el('text', { x: r1(base[0]), y: r1(base[1] + 34), 'text-anchor': 'middle', class: 'slab-t', style: 'fill:#ffd23f' }, cg);
    t1.textContent = t.rise ? '↑' + SUN.hm(t.rise) + ' · ↓' + SUN.hm(t.set) : '';
    var dl = st.daily, t2 = el('text', { x: r1(base[0]), y: r1(base[1] + 51), 'text-anchor': 'middle', class: 'slab-t' }, cg);
    t2.textContent = dl && dl.tmin != null ? 'holnap ' + fmt(dl.tmin, 0) + '…' + fmt(dl.tmax, 0) + ' °C' : 'holnap: --';
    var ti = el('title', {}, cg);
    ti.textContent = tip + 'A sárga ív a nap mai útja; az erkélyes homlokzat (ÉNy) délután és este kapja a napot.';
  }

  // ---- feliratok és tűk állandó képernyőméretben (mint a F27 HTML-tűi): nagyítva sem nőnek, kicsinyítve sem tűnnek el
  // a tűk és feliratok a házzal együtt nőnek, de kicsinyítéskor egy olvasható méret alá nem mennek
  // a feliratok képernyőn közel állandó méretűek: nagyításnál sem nőnek túl nagyra (egyszintes nézet, 2026.11.20)
  function uiK() { var s = scaleNow() || 1; return Math.max(0.5, Math.min(2.4, 1.05 / s)); }
  // Feliratok és tűk egy menetben, ütközésfigyeléssel (audit, 2026.11.15 és 2026.11.20).
  // Sorrend: szintfeliratok (csak a Ház nézetben), tűk (egymástól széttolva, a vonaluk a helyükre mutat),
  // szoba-címkék a hőfokkal (Hőtérkép réteg), a tűk név- és értékcímkéi, jelölők (Savio, Computherm),
  // végül a sima szobanevek; ami sehová nem fér, az a sima szobanév, és azt elrejtjük.
  function drawOverlay() {
    if (!scene || !layer.labels || !layer.pins) return;
    var k = uiK(), gl = layer.labels, gp = layer.pins, obst = st.obst = [], pad = 2 * k, FL = visF();
    gl.innerHTML = ''; gp.innerHTML = '';
    function hits(b) { for (var i = 0; i < obst.length; i++) { var o = obst[i]; if (b[0] < o[2] + pad && b[2] > o[0] - pad && b[1] < o[3] + pad && b[3] > o[1] - pad) return true; } return false; }
    function take(b) { obst.push(b); return b; }
    function cost(b) { var c = 0; obst.forEach(function (o) { var ox = Math.min(b[2], o[2] + pad) - Math.max(b[0], o[0] - pad), oy = Math.min(b[3], o[3] + pad) - Math.max(b[1], o[1] - pad); if (ox > 0 && oy > 0) c += ox * oy; }); return c; }
    function best(cands, mk) { var bi = 0, bc = Infinity; for (var n = 0; n < cands.length; n++) { var c = cost(mk(cands[n])); if (c === 0) return cands[n]; if (c < bc) { bc = c; bi = n; } } return cands[bi]; }
    function tw(t, fs) { return t.length * fs * 0.58; }
    // 0. a panelek (Pamutka, Áttekintés, csempék, nézetváltó, eszközsor) és a képernyő széle akadály: oda nem kerül felirat
    (function () {
      var sc = scaleNow() || 1, vb = st.vb, W = world.clientWidth || 1440, H = world.clientHeight || 900, R0 = world.getBoundingClientRect(), big = 1e5;
      var toW = function (r) { return [vb[0] + (r.left - R0.left) / sc, vb[1] + (r.top - R0.top) / sc, vb[0] + (r.right - R0.left) / sc, vb[1] + (r.bottom - R0.top) / sc]; };
      ['pam', 'ov', 'top', 'floorbar', 'tools', 'pstrip', 'tabbar'].forEach(function (id) { var e = $(id); if (!e || e.hidden || e.offsetParent === null || getComputedStyle(e).display === 'none') return; var r = e.getBoundingClientRect(); if (r.width && r.height) obst.push(toW(r)); });
      // a Ház nézet „lépcső ↕” felirata is akadály
      Array.prototype.forEach.call(world.querySelectorAll('#fl-up > text.slab-t'), function (t) { if (st.floor === 'both') { var r = t.getBoundingClientRect(); if (r.width) obst.push(toW(r)); } });
      var x0 = vb[0], y0 = vb[1], x1 = vb[0] + W / sc, y1 = vb[1] + H / sc;
      obst.push([x0 - big, y0 - big, x0 + 4 / sc, y1 + big], [x1 - 4 / sc, y0 - big, x1 + big, y1 + big], [x0 - big, y0 - big, x1 + big, y0 + 4 / sc], [x0 - big, y1 - 4 / sc, x1 + big, y1 + big]);
    })();
    // 1. szintfeliratok (csak ha mindkét szint látszik)
    if (st.floor === 'both') ['lo', 'up'].forEach(function (f) {
      var b = scene.floors[f].bbox, fs = 24 * k, t = f === 'up' ? 'FENT · tetőtér' : 'LENT', x = Math.max(b.x0 + 6 * k, st.vb[0] + 10 * k), y = (b.y0 + b.y1) / 2 + (f === 'up' ? -10 : 40) * k;
      var lv = el('text', { x: r1(x), y: r1(y), class: 'lvlab', style: 'font-size:' + r1(fs) + 'px;stroke-width:' + r1(5 * k) + 'px' }, gl);
      lv.textContent = t; take([x, y - fs, x + tw(t, fs), y + 4 * k]);
    });
    // 2. a látszó tűk listája (réteg, szint, offline)
    var byPink = {}; st.devs.forEach(function (d) { byPink[d.pink] = d; });
    var R = 14 * k, P = [];
    FL.forEach(function (f) {
      scene.floors[f].pins.forEach(function (pn) {
        var d = byPink[pn.id] || DEFAULT_DEVS.filter(function (x) { return x.pink === pn.id; })[0];
        if (!d || d.role === 'ir_hub' || hideOff(pn.id) || !pinLayerOn(d)) return;
        P.push({ pn: pn, d: d, s: devState(d), x: pn.p[0], y: pn.p[1] });
      });
    });
    // 3. szoba-címkék a hőfokkal (Hőtérkép réteg) ELŐSZÖR: a tűk majd kitérnek előlük
    var tagged = {}, fixed = obst.slice(), tagBoxes = [];
    var pinSoft = P.map(function (q) { return [q.x - R, q.y - R, q.x + R, q.y + R]; });
    if (st.layers.heat) FL.forEach(function (f) {
      scene.floors[f].floors.forEach(function (fp) {
        var rt = roomTemp(fp.id); if (!rt) return;
        tagged[fp.id] = true;
        var fs = 13 * k, nm = fp.id === 'erkely' ? 'Erkély (kint)' : fp.n, tv = rt.t == null ? '--' : fmt(rt.t) + '°', pw = (tw(tv, fs) + 14 * k), w = pw + tw(nm, fs) + 16 * k, h = 22 * k;
        var offs = [[0, 0], [0, -20], [0, 20], [-36, 0], [36, 0], [0, -38], [0, 38], [-34, -24], [34, 24], [34, -24], [-34, 24], [0, -56], [0, 56], [-60, 0], [60, 0]];
        [70, 95, 125].forEach(function (rr) { for (var a = 0; a < 360; a += 30) offs.push([Math.cos(a * Math.PI / 180) * rr * 1.4, Math.sin(a * Math.PI / 180) * rr * 0.7]); });
        var c = offs.map(function (q) { return [fp.label[0] + q[0] * k, fp.label[1] + q[1] * k]; });
        // a tűk eredeti helye "puha" akadály: lehetőleg ne oda kerüljön
        obst.push.apply(obst, pinSoft);
        var mk = function (z) { return [z[0] - w / 2, z[1] - h / 2, z[0] + w / 2, z[1] + h / 2]; }, pick = best(c, mk);
        if (cost(mk(pick)) > 0) { var w0 = w, p0 = pick; w = pw + 6 * k; pick = best(c, mk); if (cost(mk(pick)) > 0) { w = w0; pick = p0; } else nm = ''; }   // szűk helyen csak a hőfok
        obst.length -= pinSoft.length;
        var bx = take([pick[0] - w / 2, pick[1] - h / 2, pick[0] + w / 2, pick[1] + h / 2]); tagBoxes.push(bx);
        var tg = el('g', { class: 'rtag' }, gl);
        el('rect', { x: r1(bx[0]), y: r1(bx[1]), width: r1(w), height: r1(h), rx: r1(h / 2), fill: '#fffdf7', stroke: INK, 'stroke-width': r1(2 * k) }, tg);
        el('rect', { x: r1(bx[0] + 3 * k), y: r1(bx[1] + 3 * k), width: r1(pw), height: r1(h - 6 * k), rx: r1((h - 6 * k) / 2), fill: HEAT_COL[rt.c] }, tg);
        var t1 = el('text', { x: r1(bx[0] + 3 * k + pw / 2), y: r1(bx[1] + h / 2 + fs * 0.36), 'text-anchor': 'middle', class: 'rtt', style: 'font-size:' + r1(fs) + 'px' }, tg); t1.textContent = tv;
        if (nm) { var t2 = el('text', { x: r1(bx[0] + pw + 9 * k), y: r1(bx[1] + h / 2 + fs * 0.36), class: 'rtn', style: 'font-size:' + r1(fs) + 'px' }, tg); t2.textContent = nm; }
        var ti = el('title', {}, tg); ti.textContent = (fp.id === 'erkely' ? 'Erkély (kint)' : fp.n) + ': ' + (rt.t == null ? 'nincs friss mérés' : fmt(rt.t) + ' °C') + (fp.id === 'erkely' ? '' : ', cél ' + target() + ' °C') + (rt.n > 1 ? ' (' + rt.n + ' hőmérő átlaga)' : '');
      });
    });
    // 4. tűk széttolása: egymástól és a címkéktől (a szaggatott vonal a valódi helyükre mutat)
    var rep = tagBoxes.concat(fixed.filter(function (b) { return b[2] - b[0] < 5000 && b[3] - b[1] < 5000; }));
    for (var it = 0; it < 60; it++) {
      var moved = false;
      for (var i = 0; i < P.length; i++) for (var j = i + 1; j < P.length; j++) {
        var A = P[i], B = P[j], dx = B.x - A.x, dy = B.y - A.y, dd = Math.hypot(dx, dy), need = 2 * R + 4 * k;
        if (dd < need) {
          if (dd < 0.01) { dx = 1; dy = 0; dd = 1; }
          var push = (need - dd) / 2 + 0.1;
          A.x -= dx / dd * push; A.y -= dy / dd * push; B.x += dx / dd * push; B.y += dy / dd * push; moved = true;
        }
      }
      P.forEach(function (q) {
        rep.forEach(function (b) {
          var cx = Math.max(b[0], Math.min(q.x, b[2])), cy = Math.max(b[1], Math.min(q.y, b[3])), ddx = q.x - cx, ddy = q.y - cy, dist = Math.hypot(ddx, ddy), need = R + 3 * k;
          if (dist >= need) return;
          if (dist < 0.01) {           // a középpont a dobozon belül: a legközelebbi szél felé
            var dl = q.x - b[0], dr = b[2] - q.x, du = q.y - b[1], dn = b[3] - q.y, m = Math.min(dl, dr, du, dn);
            if (m === du) q.y = b[1] - need; else if (m === dn) q.y = b[3] + need; else if (m === dl) q.x = b[0] - need; else q.x = b[2] + need;
          } else { q.x += ddx / dist * (need - dist); q.y += ddy / dist * (need - dist); }
          moved = true;
        });
      });
      if (!moved) break;
    }
    // ha egy téli üresjáratú klíma-tű így sem fér el, inkább elmarad (az Eszközök listában megvan)
    P = P.filter(function (q) { return q.d.role !== 'ac_ir' || !tagBoxes.some(function (b) { return q.x + R > b[0] && q.x - R < b[2] && q.y + R > b[1] && q.y - R < b[3]; }); });
    // utolsó menet fontossági sorrendben: a fontosabb tű foglal előbb helyet; ha egy kevésbé fontos tű sehol nem fér
    // el ütközés nélkül, elmarad (az Eszközök listában és a Vezérlés lapon megvan) (2026.11.20)
    var prio = function (q) { var d = q.d, p = d.pink; if (d.role === 'robot') return 0; if (p === 'C1') return 1; if (/^C[678]$/.test(p)) return 5; if (d.role === 'plug') return plugOn(p) ? 2 : 3; if (d.role === 'thermo') return 2; if (d.role === 'breaker') return 4; if (d.role === 'pir') return 5; return 6; };
    var placedP = [], keep = [];
    P.slice().sort(function (a, b) { return prio(a) - prio(b); }).forEach(function (q) {
      var free = function (x, y) { var b = [x - R, y - R, x + R, y + R + 2.5 * k]; return !hits(b) && !placedP.some(function (o) { return b[0] < o[2] + pad && b[2] > o[0] - pad && b[1] < o[3] + pad && b[3] > o[1] - pad; }); };
      if (!free(q.x, q.y)) {
        var found = false;
        outer: for (var rr = 1; rr <= 8; rr++) for (var a = 0; a < 360; a += 20) { var nx = q.x + Math.cos(a * Math.PI / 180) * R * 1.1 * rr, ny = q.y + Math.sin(a * Math.PI / 180) * R * 1.1 * rr; if (free(nx, ny)) { q.x = nx; q.y = ny; found = true; break outer; } }
        if (!found && prio(q) >= 3) return;
      }
      var bb = [q.x - R, q.y - R, q.x + R, q.y + R + 2.5 * k]; placedP.push(bb); take(bb); keep.push(q);
    });
    P = P.filter(function (q) { return keep.indexOf(q) >= 0; });
    // 5. a tűk címkéi: név és érték (pl. „Dupla lámpa · 25 W”). Soha nem fedhet mást (a tulaj, 2026.11.20):
    //    előbb közvetlenül a tű mellett, aztán távolabbi gyűrűkön összekötő vonallal; ha a teljes név sehol nem fér,
    //    csak az érték; ha az sem, a címke elmarad (az érték a Vezérlés lapon és a tű adatlapján megvan).
    P.forEach(function (q) {
      var full = pinLabel(q); if (!full) return;
      var opts = [full]; if (q.s.big && full !== q.s.big) opts.push(q.s.big);
      if (!st.layers.lbl && st.sel !== q.d.pink) {            // P1 csendes térkép (alap): név csak koppintásra vagy a Minden felirat réteggel
        var act = q.d.role === 'robot' ? robOn(q.d.pink) : q.d.role === 'plug' ? plugOn(q.d.pink) : false;
        if (!act || !q.s.big || q.d.role === 'thermo') return;
        opts = [q.s.big];
      }
      for (var oi = 0; oi < opts.length; oi++) {
        var lb = opts[oi], w = (tw(lb, 12.5 * k) + 16 * k), h = 20 * k, c = [];
        c.push([q.x + R + 3 * k, q.y - h / 2, 0], [q.x - R - 3 * k - w, q.y - h / 2, 0], [q.x - w / 2, q.y - R - h - 3 * k, 0], [q.x - w / 2, q.y + R + 5 * k, 0],
          [q.x + R + 3 * k, q.y - h - 8 * k, 0], [q.x + R + 3 * k, q.y + 8 * k, 0], [q.x - R - 3 * k - w, q.y - h - 8 * k, 0], [q.x - R - 3 * k - w, q.y + 8 * k, 0]);
        [2.2, 3.4, 4.8].forEach(function (m) {
          [-90, -45, -135, 0, 180, 45, 135, 90, -65, -115, 25, 155].forEach(function (a) {
            var t = a * Math.PI / 180, cx = q.x + Math.cos(t) * (R * m + w / 2), cy = q.y + Math.sin(t) * R * m;
            c.push([cx - w / 2, cy - h / 2, 1]);
          });
        });
        for (var ci = 0; ci < c.length; ci++) {
          var bb = [c[ci][0], c[ci][1], c[ci][0] + w, c[ci][1] + h];
          if (!hits(bb)) { q.lbl = lb; q.vb = take(bb); q.lead = c[ci][2]; return; }
        }
      }
    });
    // téli üresjáratú klíma-tű, amelyre egy másik tű címkéje került: elmarad (az Eszközök listában megvan)
    P = P.filter(function (q) { return q.d.role !== 'ac_ir' || !P.some(function (o) { return o.vb && q.x + R > o.vb[0] && q.x - R < o.vb[2] && q.y + R > o.vb[1] && q.y - R < o.vb[3]; }); });
    // 6. jelölők
    if (st.layers.lbl) FL.forEach(function (f) {
      scene.floors[f].marks.forEach(function (m) {
        var fs = 11 * k, w = (m.t.length * 6.2 + 12) * k, h = 16 * k, ax = m.a[0], ay = m.a[1];
        var c = [[m.p[0], m.p[1] - h / 2 - 6 * k]];
        [26, 44, 64, 86].forEach(function (r) { [-90, -45, -135, 0, 180, 45, 135, 90].forEach(function (a) { var t = a * Math.PI / 180; c.push([ax + Math.cos(t) * (r + w / 2), ay + Math.sin(t) * r * k]); }); });
        var pick = best(c, function (z) { return [z[0] - w / 2, z[1] - h / 2, z[0] + w / 2, z[1] + h / 2]; });
        if (cost([pick[0] - w / 2, pick[1] - h / 2, pick[0] + w / 2, pick[1] + h / 2]) > 0) return;     // ha mindenhol takarna, inkább nincs
        take([pick[0] - w / 2, pick[1] - h / 2, pick[0] + w / 2, pick[1] + h / 2]);
        var mg = el('g', {}, gl);
        el('line', { x1: r1(ax), y1: r1(ay), x2: r1(pick[0]), y2: r1(pick[1]), stroke: INK, 'stroke-width': r1(1.6 * k) }, mg);
        el('circle', { cx: r1(ax), cy: r1(ay), r: r1(3 * k), fill: m.c, stroke: INK, 'stroke-width': r1(1.4 * k) }, mg);
        el('rect', { x: r1(pick[0] - w / 2), y: r1(pick[1] - h / 2), width: r1(w), height: r1(h), rx: r1(h / 2), fill: m.c, stroke: INK, 'stroke-width': r1(2 * k) }, mg);
        var t = el('text', { x: r1(pick[0]), y: r1(pick[1] + 4 * k), 'text-anchor': 'middle', class: 'mark', style: 'font-size:' + r1(fs) + 'px' }, mg); t.textContent = m.t;
      });
    });
    // 7. sima szobanevek (ahol nincs hőfok-címke)
    FL.forEach(function (f) {
      scene.floors[f].floors.forEach(function (fp) {
        if (!fp.n || tagged[fp.id] || fp.id === 'erkely' || fp.id === 'lepcsohaz') return;
        var fs = 14 * k, w = tw(fp.n, fs), h = fs * 1.05, lx = fp.label[0], ly = fp.label[1];
        var c = [[0, 0], [0, -18], [0, 18], [-34, 0], [34, 0], [0, -34], [0, 34], [-30, -22], [30, 22], [30, -22], [-30, 22]], pick = null;
        for (var n = 0; n < c.length; n++) { var x = lx + c[n][0] * k, y = ly + c[n][1] * k, b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]; if (!hits(b)) { pick = [x, y, b]; break; } }
        if (!pick) return;
        take(pick[2]);
        var t = el('text', { x: r1(pick[0]), y: r1(pick[1] + fs * 0.36), 'text-anchor': 'middle', class: 'rlabel', style: 'font-size:' + r1(fs) + 'px;stroke-width:' + r1(3.6 * k) + 'px' }, gl);
        t.textContent = fp.n;
      });
    });
    // 8. tűk kirajzolása (a feliratok fölött): ikon a szerepkör szerint, sárga = ég, türkiz = a robot dolgozik
    P.forEach(function (q) {
      var pn = q.pn, d = q.d, s = q.s, pc = pinColors(d, s);
      var pg = el('g', { class: 'pin' + (st.sel === pn.id ? ' sel' : '') + (pc.on ? ' lit' : ''), tabindex: 0, role: 'button', 'data-pink': pn.id, 'aria-label': d.label + ': ' + s.txt }, gp);
      el('line', { x1: r1(q.x), y1: r1(q.y), x2: r1(pn.base[0]), y2: r1(pn.base[1]), stroke: INK, 'stroke-width': r1(1.8 * k), 'stroke-dasharray': r1(2 * k) + ' ' + r1(3 * k), opacity: 0.55 }, pg);
      if (q.vb && q.lead) {
        var lx = Math.max(q.vb[0], Math.min(q.x, q.vb[2])), ly = Math.max(q.vb[1], Math.min(q.y, q.vb[3]));
        el('line', { x1: r1(q.x), y1: r1(q.y), x2: r1(lx), y2: r1(ly), stroke: INK, 'stroke-width': r1(1.6 * k), opacity: 0.7 }, pg);
      }
      if (pc.on) el('circle', { class: 'glow', cx: r1(q.x), cy: r1(q.y), r: r1(R + 7 * k), fill: pc.glow }, pg);
      if (pc.alert) el('circle', { class: 'ring', cx: r1(q.x), cy: r1(q.y), r: r1(R), style: 'stroke-width:' + r1(3 * k) + 'px' }, pg);
      el('circle', { class: 'dot', cx: r1(q.x), cy: r1(q.y + 2.5 * k), r: r1(R), fill: INK }, pg);
      el('circle', { class: 'dot', cx: r1(q.x), cy: r1(q.y), r: r1(R), fill: pc.fill, style: 'stroke-width:' + r1(2.6 * k) + 'px' }, pg);
      var is = 17 * k;
      el('use', { href: '#pi-' + pinIcon(d), x: r1(q.x - is / 2), y: r1(q.y - is / 2), width: r1(is), height: r1(is), style: 'color:' + pc.ic + ';stroke-width:' + r1(2.3) }, pg);
      if (q.vb) {
        var b = q.vb, w = b[2] - b[0];
        el('rect', { class: 'vbg', x: r1(b[0]), y: r1(b[1]), width: r1(w), height: r1(b[3] - b[1]), rx: r1(10 * k), fill: s.cls === 'hot' ? '#ffd9cc' : s.cls === 'cold' ? '#d6e6ff' : pc.on ? '#fff3c4' : '#ffffff', style: 'stroke-width:' + r1(2 * k) + 'px' }, pg);
        var vt = el('text', { class: 'vt', x: r1(b[0] + w / 2), y: r1(b[1] + 14.5 * k), 'text-anchor': 'middle', fill: INK, style: 'font-size:' + r1(12.5 * k) + 'px' }, pg); vt.textContent = q.lbl;
      }
      // a bojler fűt (C1 konnektor, kb. 1,8 kW): villám és felszálló hőhullám a tű fölött
      if (pn.id === 'C1') {
        var br = st.latest.C1, bw = br && br.online !== false && isOn(br.status) ? watts(br.status) : null;
        if (bw != null && bw >= 500) {
          var bm = el('g', { class: 'boilmark', transform: 'translate(' + r1(q.x) + ',' + r1(q.y - R - 12 * k) + ') scale(' + r1(k * 85) / 100 + ')' }, pg);
          bm.innerHTML = '<g class="boil-waves"><path d="M-12,-10 q-4,-6 0,-12 q4,-6 0,-12"/><path d="M0,-12 q-4,-6 0,-12 q4,-6 0,-12"/><path d="M12,-10 q-4,-6 0,-12 q4,-6 0,-12"/></g>' +
            '<g class="boil-zap"><circle cx="0" cy="0" r="11" fill="#ffd23f" stroke="#1e2a44" stroke-width="2.4"/><path d="M2,-9 L-5,1 L0,1 L-2.5,9 L6,-3 L1,-3 Z" fill="#1e2a44"/></g>';
          s = Object.assign({}, s, { txt: s.txt + ' · fűt, ' + fmt(bw / 1000, 1) + ' kW' });
        }
      }
      var ti = el('title', {}, pg); ti.textContent = d.label + ': ' + s.txt;
      pg.addEventListener('click', function (e) { e.stopPropagation(); select(pn.id); });
      pg.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(pn.id); } });
    });
  }
  function drawPins() { drawOverlay(); }

  // ---- nézet: illesztés, nagyítás, mozgatás -------------------------------------------------------------
  function contentBox() {
    var b = null;
    visF().forEach(function (f) {
      var q = scene.floors[f].bbox;
      b = b ? { x0: Math.min(b.x0, q.x0), x1: Math.max(b.x1, q.x1), y0: Math.min(b.y0, q.y0), y1: Math.max(b.y1, q.y1) } : Object.assign({}, q);
    });
    return b;
  }
  // A nézet a lakásra illeszt (a szobák sarkai a padlón és a falak tetején), nem a díszekre:
  // az iránytű és a dekor ne tolja el a középpontot (2026.11.15: ettől csúszott le telefonon a lakás).
  function houseBox() {
    var b = null;
    visF().forEach(function (f) {
      var F = S.FLOORS[f], P = scene.floors[f].proj.P;
      F.rooms.forEach(function (r) {
        [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.d], [r.x + r.w, r.y + r.d]].forEach(function (c) {
          [0, F.H].forEach(function (z) {
            var q = P(c[0], c[1], z);
            b = b ? { x0: Math.min(b.x0, q[0]), x1: Math.max(b.x1, q[0]), y0: Math.min(b.y0, q[1]), y1: Math.max(b.y1, q[1]) } : { x0: q[0], x1: q[0], y0: q[1], y1: q[1] };
          });
        });
      });
    });
    return b || contentBox();
  }
  function fit() {
    document.documentElement.style.setProperty('--toph', (($('top').offsetHeight || 60) + 16) + 'px');
    var b = houseBox(), W = world.clientWidth || 1440, H = world.clientHeight || 900, phone = W < 760;
    // hely a felső csempéknek és az alsó Pamutka-kártyának
    var wide = W >= 900, pw = wide ? ($('pam').offsetWidth || 328) + 24 : 0, topH = ($('top').offsetHeight || 60) + 14, top = phone ? topH + 46 : (wide ? 146 : 136), bottom = phone ? 136 : (wide ? 64 : ($('pam').classList.contains('mini') ? 140 : 340)), left = phone ? 10 : (wide ? pw : 20), right = wide ? pw : 20;
    var aw = Math.max(200, W - left - right), ah = Math.max(200, H - top - bottom);
    var cw = b.x1 - b.x0 + 40, ch = b.y1 - b.y0 + 50, s = Math.min(aw / cw * (phone ? 1.08 : 1), ah / ch);
    var vw = W / s, vh = H / s, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    // a tartalom közepe a szabad terület közepére
    var ox = (left + aw / 2) / s, oy = (top + ah / 2) / s;
    st.vb = [cx - ox, cy - oy, vw, vh];
    applyVB();
  }
  var ovRaf = 0;
  function applyVB() {
    world.setAttribute('viewBox', st.vb.map(r1).join(' ')); world.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    if (!ovRaf) ovRaf = requestAnimationFrame(function () { ovRaf = 0; drawOverlay(); });
  }
  function zoom(f, px, py) {
    var W = world.clientWidth || 1440, H = world.clientHeight || 900, vb = st.vb;
    if (px == null) { px = W / 2; py = H / 2; }
    var nw = Math.max(240, Math.min(6000, vb[2] / f)), k = nw / vb[2];
    var wx = vb[0] + px / W * vb[2], wy = vb[1] + py / H * vb[3];
    st.vb = [wx - (wx - vb[0]) * k, wy - (wy - vb[1]) * k, nw, vb[3] * k];
    applyVB();
  }
  function scaleNow() { var W = world.clientWidth || 1440; return W / st.vb[2]; }

  // ---- húzás: bútor (Szerkesztés módban) vagy a nézet ---------------------------------------------------
  var drag = null, pan = null, pointers = {}, pinch = null, raf = 0;
  world.addEventListener('pointerdown', function (e) {
    if (e.button != null && e.button > 0) return;
    pointers[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), vb: st.vb.slice() }; drag = null; pan = null; return;
    }
    var pc = e.target.closest ? e.target.closest('[data-piece]') : null;
    if (pc && st.edit && canEdit()) {
      var id = pc.getAttribute('data-piece'), piece = S.PIECES.filter(function (p) { return p.id === id; })[0];
      if (piece && piece.drag) {
        drag = { id: id, fl: piece.fl, sx: e.clientX, sy: e.clientY, o: (st.offs[id] || [0, 0]).slice(), before: JSON.parse(JSON.stringify(st.offs)), moved: false };
        try { world.setPointerCapture(e.pointerId); } catch (x) { /* nem minden böngésző */ }
        st.sel = 'p:' + id;
        e.preventDefault();
        return;
      }
    }
    pan = { sx: e.clientX, sy: e.clientY, vb: st.vb.slice(), moved: false, target: e.target };
    try { world.setPointerCapture(e.pointerId); } catch (x) { /* nem minden böngésző */ }
  });
  world.addEventListener('pointermove', function (e) {
    if (pointers[e.pointerId]) pointers[e.pointerId] = [e.clientX, e.clientY];
    if (pinch) {
      var ids = Object.keys(pointers); if (ids.length < 2) return;
      var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      st.vb = pinch.vb.slice(); zoom(d / pinch.d, (a[0] + b[0]) / 2 - world.getBoundingClientRect().left, (a[1] + b[1]) / 2 - world.getBoundingClientRect().top);
      return;
    }
    if (drag) {
      var s = scaleNow(), dx = (e.clientX - drag.sx) / s, dy = (e.clientY - drag.sy) / s;
      var m = scene.floors[drag.fl].proj.unproject(dx, dy);
      var nx = Math.round((drag.o[0] + m[0]) * 20) / 20, ny = Math.round((drag.o[1] + m[1]) * 20) / 20;
      nx = Math.max(-5, Math.min(5, nx)); ny = Math.max(-6, Math.min(6, ny));
      st.offs[drag.id] = [nx, ny]; drag.moved = true;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; scene = S.build(st.k, st.offs); drawItems(drag ? drag.fl : 'lo'); });
      return;
    }
    if (pan) {
      var sc = scaleNow(), mx = e.clientX - pan.sx, my = e.clientY - pan.sy;
      if (Math.abs(mx) + Math.abs(my) > 4) { pan.moved = true; world.classList.add('panning'); }
      st.vb = [pan.vb[0] - mx / sc, pan.vb[1] - my / sc, pan.vb[2], pan.vb[3]]; applyVB();
    }
  });
  function endPointer(e) {
    delete pointers[e.pointerId];
    if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; return; }
    if (drag) {
      var d = drag; drag = null;
      if (d.moved) { pushUndo(d.before); scene = S.build(st.k, st.offs); drawItems(d.fl); markDirty(); }
      else selectPiece(d.id);
      return;
    }
    if (pan) {
      var p = pan; pan = null; world.classList.remove('panning');
      if (!p.moved) {
        var pc = p.target && p.target.closest ? p.target.closest('[data-piece]') : null;
        if (pc) selectPiece(pc.getAttribute('data-piece')); else if (!(p.target && p.target.closest && (p.target.closest('.pin') || p.target.closest('#cat')))) { st.sel = null; showInfo(); drawItems('lo'); drawItems('up'); drawPins(); }
      }
    }
  }
  world.addEventListener('pointerup', endPointer);
  world.addEventListener('pointercancel', endPointer);
  world.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = world.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // ---- kijelölés, info ----------------------------------------------------------------------------
  function select(pink) {
    if (st.tab && st.tab !== 'home' && typeof setTab === 'function' && (window.innerWidth || 1440) <= 760) setTab('home');
    var pf = pinFloor(pink);
    if (pf && st.floor !== 'both' && pf !== st.floor) { st.floor = pf; saveView(); st.vb = null; drawWorld(); floorBar(); }
    if (st.sel !== pink) st.dtab = 'ov';
    st.sel = st.sel === pink ? null : pink;
    drawPins(); list(); overview(); showInfo();
  }
  function selectPiece(id) {
    st.sel = st.sel === 'p:' + id ? null : 'p:' + id;
    drawItems('lo'); drawItems('up'); showInfo();
  }
  // ---- C: négyfüles eszköz-adatlap (2026.11.20): Áttekintés, Időzítés, Beállítások, Napló ------------------------
  // Csak valós adat: órás összesítő (metrics_hourly), kapcsolási napló (control_log), ütemezések és időzítők;
  // a beállítások közül csak az, ami tényleg működik. Demóban a görbe és a napló a demóállapotból készül.
  st.dd = {}; st.dtab = 'ov';
  var A1_PRICE = 70.1;
  function ddTabs(d) {
    var ctl = CTL_PINKS.indexOf(d.pink) >= 0;
    if (ctl) return [['ov', 'Áttekintés', 'home'], ['sch', 'Időzítés', 'clock'], ['set', 'Beállítások', 'gear'], ['log', 'Napló', 'list']];
    if (d.role === 'robot') return [['ov', 'Áttekintés', 'home'], ['map', 'Térkép', 'grid'], ['log', 'Napló', 'list'], ['set', 'Beállítások', 'gear']];
    if (d.role === 'thermo' || d.role === 'breaker') return [['ov', 'Áttekintés', 'home'], ['set', 'Beállítások', 'gear'], ['log', 'Napló', 'list']];
    if (d.role === 'pir' && window.O2BMotion && st.role !== 'share') return [['ov', 'Áttekintés', 'home'], ['wk', 'Hetek', 'grid'], ['set', 'Beállítások', 'gear']];
    return [['ov', 'Áttekintés', 'home'], ['set', 'Beállítások', 'gear']];
  }
  function ddLoad(p) {
    var c = st.dd[p] = st.dd[p] || { mh: null, log: null, at: 0 };
    if (Date.now() - c.at < 5 * 60000) return;
    c.at = Date.now();
    if (!sb || !st.user || st.role === 'share') { c.mh = ddDemo(p); c.log = ddDemoLog(p); return; }
    var h0 = new Date(Date.now() - 26 * 3600e3).toISOString();
    Promise.all([
      ['owner', 'member'].indexOf(st.role) >= 0 ? sb.from('metrics_hourly').select('hour,kwh,w_max,temp_avg,temp_min,temp_max,hum_avg').eq('pink', p).gte('hour', h0).order('hour', { ascending: true }).limit(40) : Promise.resolve({ data: [] }),
      sb.from('control_log').select('ts,action,source,ok,note').eq('pink', p).order('ts', { ascending: false }).limit(15)
    ]).then(function (r) {
      c.mh = r[0].error ? [] : (r[0].data || []); c.log = r[1].error ? [] : (r[1].data || []);
      if (st.sel === p) showInfo();
    }, function () { c.mh = []; c.log = []; });
  }
  // demó: az elmúlt 24 óra a demóállapotból (ugyanúgy demó, mint az oldal többi része)
  function ddDemo(p) {
    var d = devOf(p), out = [], now = Date.now(), r = st.latest[p], w = r ? watts(r.status) || 0 : 0, t0 = r ? temp(r.status) : null;
    for (var i = 24; i >= 1; i--) {
      var hr = new Date(now - i * 3600e3), h = hr.getHours(), x = { hour: hr.toISOString() };
      if (d.role === 'thermo') { var tb = (t0 == null ? 21 : t0) - 0.6 + 0.6 * Math.sin((h - 9) / 24 * 2 * Math.PI) + (h >= 17 && h <= 22 ? 0.4 : 0); x.temp_avg = tb; x.temp_min = tb - 0.2; x.temp_max = tb + 0.2; x.hum_avg = 45; }
      else if (p === 'C1') { var on = (h >= 5 && h < 7) || (h >= 19 && h < 20) || h % 2 === 0; x.kwh = on ? (h >= 5 && h < 7 ? 1.2 : 0.09) : 0.005; x.w_max = on ? 1800 : 5; }
      else { var lit = h >= 17 || (h >= 6 && h < 8); x.kwh = lit ? Math.max(w, 8) / 1000 : 0; x.w_max = lit ? Math.max(w, 8) : 0; }
      out.push(x);
    }
    return out;
  }
  function ddDemoLog(p) {
    var t = new Date(); t.setMinutes(0, 0, 0);
    var at = function (h, m) { var x = new Date(t); x.setHours(h, m); if (x > new Date()) x.setDate(x.getDate() - 1); return x.toISOString(); };
    if (p === 'C1') return [{ ts: at(19, 2), action: 'on', source: 'rule', ok: true }, { ts: at(7, 30), action: 'off', source: 'rule', ok: true }, { ts: at(5, 30), action: 'on', source: 'rule', ok: true }];
    return [{ ts: at(17, 30), action: 'on', source: 'scene', ok: true, note: 'Esti hangulat' }, { ts: at(8, 5), action: 'off', source: 'rule', ok: true }, { ts: at(6, 40), action: 'on', source: 'user', ok: true }];
  }
  function ddToday(mh, f) {
    var t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return (mh || []).filter(function (x) { return Date.parse(x.hour) >= t0.getTime(); }).map(f).filter(function (v) { return v != null; });
  }
  function ddChart(d, mh) {
    if (!mh || !mh.length) return '<div class="ddc none">' + (mh ? 'Az elmúlt 24 órából még nincs órás adat.' : 'Betöltés…') + '</div>';
    var th = d.role === 'thermo', vals = mh.map(function (x) { return th ? (x.temp_avg != null ? +x.temp_avg : null) : (x.w_max != null ? +x.w_max : x.kwh != null ? +x.kwh * 1000 : null); });
    var ok = vals.filter(function (v) { return v != null; }); if (!ok.length) return '<div class="ddc none">Az elmúlt 24 órából még nincs órás adat.</div>';
    var mx = Math.max.apply(null, ok), mn = th ? Math.min.apply(null, ok) - 0.3 : 0, W = 300, H = 70, n = mh.length, bw = W / n;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + (th ? 'Hőmérséklet' : 'Teljesítmény') + ' az elmúlt 24 órában">';
    [0.25, 0.5, 0.75].forEach(function (g) { svg += '<line x1="0" x2="' + W + '" y1="' + (H * g).toFixed(1) + '" y2="' + (H * g).toFixed(1) + '" stroke="#e6dcc6" stroke-width="1" vector-effect="non-scaling-stroke"/>'; });
    if (th) {
      var tg = target(), ty = H - 4 - (tg - mn) / ((mx - mn) || 1) * (H - 10);
      if (ty > 0 && ty < H) svg += '<line x1="0" x2="' + W + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '" stroke="#2fa56b" stroke-dasharray="4 4" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
      var pts = vals.map(function (v, i) { return v == null ? null : [(i + 0.5) * bw, H - 4 - (v - mn) / ((mx - mn) || 1) * (H - 10)]; }).filter(Boolean);
      svg += '<path d="' + pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join('') + '" fill="none" stroke="#ff7a45" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';
    } else vals.forEach(function (v, i) { if (!v) return; var h = Math.max(2, v / (mx || 1) * (H - 6)); svg += '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + (v > 500 ? '#ff7a45' : '#f2b51c') + '"/>'; });
    var h0 = new Date(mh[0].hour), hm2 = function (x) { return ('0' + x.getHours()).slice(-2) + ':00'; };
    return '<div class="ddc"><div class="ddct"><span>' + (th ? 'Hőmérséklet, 24 óra' + ' <i class="tgk">cél ' + target() + ' °C</i>' : 'Teljesítmény óránként (csúcs), 24 óra') + '</span><span>' + (th ? fmt(mn + 0.3) + '…' + fmt(mx) + ' °C' : 'max ' + fmt(mx, 0) + ' W') + '</span></div>' + svg + '</svg><div class="ddax"><span>' + hm2(h0) + '</span><span>' + hm2(new Date(h0.getTime() + n / 2 * 3600e3)) + '</span><span>most</span></div></div>';
  }
  function ddKpis(d, mh) {
    var r = st.latest[d.pink], s = (r && r.status) || {}, q;
    if (d.role === 'thermo') {
      var mins = ddToday(mh, function (x) { return x.temp_min != null ? +x.temp_min : null; }), maxs = ddToday(mh, function (x) { return x.temp_max != null ? +x.temp_max : null; });
      q = [['Most', devState(d).big || '--'], ['Ma min', mins.length ? fmt(Math.min.apply(null, mins)) + '°' : '--'], ['Ma max', maxs.length ? fmt(Math.max.apply(null, maxs)) + '°' : '--']];
    } else if (d.role === 'robot') q = [['Akku', typeof s.battery === 'number' ? s.battery + '%' : '--'], ['Állapot', devState(d).txt.split(' · ')[0]], ['Terület', s.area_m2 != null ? fmt(+s.area_m2, 0) + ' m²' : '--']];
    else {
      var kw = ddToday(mh, function (x) { return x.kwh != null ? +x.kwh : null; }), sum = kw.reduce(function (a, b) { return a + b; }, 0), w = r && r.online !== false ? watts(s) : null;
      q = [['Most', w != null ? fmt(w, 0) + ' W' : '--'], ['Ma', kw.length ? fmt(sum, 2) + ' kWh' : '--'], ['Ma, Ft', kw.length ? '~' + fmt(sum * A1_PRICE, 0) + ' Ft' : '--']];
    }
    return '<div class="ddk">' + q.map(function (x) { return '<div><small>' + x[0] + '</small><span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>';
  }
  // heti idővonal a saját ütemezéseiből: óránként ég-e (a nap utolsó állapota a következő napra átvisz)
  function ddWeek(p) {
    var rules = st.ctl.rules.filter(function (r) { return r.pink === p && r.enabled; });
    if (!rules.length) return '';
    var ev = [0, 1, 2, 3, 4, 5, 6].map(function (di) { return rules.filter(function (r) { return r.days & (1 << di); }).map(function (r) { return [ruleMinute(r), r.action === 'on']; }).sort(function (a, b) { return a[0] - b[0]; }); });
    var state = false; for (var w = 0; w < 2; w++) ev.forEach(function (e) { if (e.length) state = e[e.length - 1][1]; });   // a hét végi állapot hétfőre
    var h = '<div class="ddwk" role="img" aria-label="Heti idővonal: mikor van bekapcsolva"><span></span>';
    for (var x = 0; x < 24; x++) h += '<span class="hh">' + (x % 6 === 0 ? x : '') + '</span>';
    ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'].forEach(function (dn, di) {
      h += '<span class="dn">' + dn + '</span>';
      var e = ev[di], k = 0;
      for (var hr = 0; hr < 24; hr++) {
        var on = 0, m0 = hr * 60;
        for (var m = m0; m < m0 + 60; m += 10) { while (k < e.length && e[k][0] <= m) { state = e[k][1]; k++; } if (state) on++; }
        h += '<span class="c' + (on >= 3 ? ' on' : '') + '"></span>';
      }
      while (k < e.length) { state = e[k][1]; k++; }
    });
    return h + '</div>';
  }
  function ddLogHtml(d, log) {
    var SRC = { user: 'kézzel', rule: 'ütemezés', timer: 'egyszeri időzítő', scene: 'jelenet' };
    if (!log) return '<div class="ddc none">Betöltés…</div>';
    if (!log.length) return '<div class="ddc none">Még nincs bejegyzés a kapcsolási naplóban.</div>';
    return '<ul class="ddlog">' + log.map(function (x) {
      return '<li><time>' + esc(whenText(new Date(x.ts))) + '</time><i class="' + (x.ok ? (x.action === 'on' ? 'on' : 'off') : 'err') + '"></i><span>' + (x.action === 'on' ? 'Bekapcsolva' : x.action === 'off' ? 'Kikapcsolva' : esc(x.action)) + (x.ok ? '' : ', nem sikerült') +
        '<small>' + esc(SRC[x.source] || x.source) + (x.note ? ' · ' + esc(x.note) : '') + '</small></span></li>';
    }).join('') + '</ul>';
  }
  function ddMeasLog(d, mh) {
    if (!mh) return '<div class="ddc none">Betöltés…</div>';
    var rows = mh.slice(-12).reverse();
    if (!rows.length) return '<div class="ddc none">Az elmúlt 24 órából még nincs órás adat.</div>';
    return '<ul class="ddlog">' + rows.map(function (x) {
      var t = new Date(x.hour), lab = d.role === 'thermo' ? (x.temp_avg != null ? fmt(+x.temp_avg) + ' °C' : '--') + (x.hum_avg != null ? ', pára ' + fmt(+x.hum_avg, 0) + ' %' : '') : (x.kwh != null ? fmt(+x.kwh, 3) + ' kWh' : '--') + (x.w_max != null ? ', csúcs ' + fmt(+x.w_max, 0) + ' W' : '');
      return '<li><time>' + ('0' + t.getHours()).slice(-2) + ':00</time><i class="m"></i><span>' + esc(lab) + '</span></li>';
    }).join('') + '</ul>';
  }
  function ddSched(p) {
    var timers = st.ctl.timers.filter(function (t) { return t.pink === p && new Date(t.due_at) > new Date(Date.now() - 60000); }).sort(function (a, b) { return new Date(a.due_at) - new Date(b.due_at); });
    var rules = st.ctl.rules.filter(function (r) { return r.pink === p; }), pres = presetsFor(p);
    if (!canCtl()) return nextHtml(p) + (rules.length ? '<div class="sec"><div class="sub">Ütemezés <small>minden héten ismétlődik</small></div><ul class="rl">' + rules.map(function (r) { return '<li class="' + (r.enabled ? '' : 'dis') + '"><span class="t">' + esc(ruleSentence(r)) + '</span></li>'; }).join('') + '</ul></div>' : '') + ddWeek(p) + '<div class="ctln">' + roClause() + '</div>';
    return '<div class="ctl">' + nextHtml(p) +
      '<div class="sec"><div class="sub">Egyszeri <small>csak egyszer fut le</small></div>' +
      '<div class="ctlq"><button class="btn sm" data-ctl="q" data-k="on1h" data-p="' + p + '">BE most, 1 óra múlva KI</button><button class="btn sm" data-ctl="q" data-k="off23" data-p="' + p + '">KI ma 23:00-kor</button>' + (p === 'C1' ? '' : '<button class="btn sm" data-ctl="q" data-k="onsunset" data-p="' + p + '">BE ma napnyugtakor</button>') + '</div>' +
      (timers.length ? '<ul class="rl">' + timers.map(function (t) { return '<li><span class="t">' + whenText(new Date(t.due_at)) + ' ' + (t.action === 'on' ? 'BE' : 'KI') + '<small>egyszeri</small></span><button class="mini" data-ctl="tdel" data-id="' + t.id + '" aria-label="Időzítő törlése">✕</button></li>'; }).join('') + '</ul>' : '') + '</div>' +
      '<div class="sec"><div class="sub">Ütemezés <small>minden héten ismétlődik, magától</small></div>' +
      '<div class="pres">' + pres.map(function (pr) { var ex = findRule(p, pr.r), on = !!(ex && ex.enabled); return '<button class="pre' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" data-ctl="pre" data-p="' + p + '" data-id="' + pr.id + '"><span class="ck">' + (on ? '✓' : '+') + '</span>' + esc(pr.t) + '</button>'; }).join('') + '</div>' +
      rulesHtml(rules.filter(function (r) { return !(r.enabled && pres.some(function (pr) { return sameRule(r, Object.assign({ pink: p }, pr.r)); })); }), false, '') +
      ddWeek(p) + '<details class="own"><summary>Saját ütemezés…</summary>' + addFormHtml(p) + '</details></div></div>';
  }
  function ddSettings(d) {
    var p = d.pink, ctl = CTL_PINKS.indexOf(p) >= 0, b = (st.bat || []).filter(function (x) { return x.pink === p; })[0];
    var lay = d.role === 'robot' ? 'rob' : d.role === 'thermo' ? 'heat' : 'dev', layN = { rob: 'Robotok', heat: 'Hőtérkép', dev: 'Eszközök' }[lay];
    var ROLES = { owner: 'tulaj', member: 'családtag', cleaner: 'takarító', viewer: 'megtekintő', share: 'bemutató' };
    var rows = [];
    if (ctl) rows.push(['Megerősítés minden kapcsolás előtt', 'mindig (a tulaj kérése)', '<span class="lock" aria-label="nem kapcsolható ki">🔒</span>']);
    if (ctl || d.role === 'robot') rows.push(['Ki kapcsolhatja', 'tulaj és családtag' + (st.user ? '; te: ' + (ROLES[st.role] || st.role) : '; demó'), '']);
    rows.push([d.role === 'thermo' ? 'Hőfok a térképen' : 'Látszik a térképen', 'a ' + layN + ' réteggel', '<button class="mini" type="button" role="switch" data-ddlay="' + lay + '" aria-checked="' + !!st.layers[lay] + '">' + (st.layers[lay] ? 'BE' : 'KI') + '</button>']);
    rows.push(['Offline eszközök a térképen', st.showOff ? 'látszanak' : 'rejtve', '<button class="mini" type="button" data-off="1">' + (st.showOff ? 'Elrejt' : 'Mutasd') + '</button>']);
    if (BAT && (d.role === 'thermo' || d.role === 'pir')) rows.push(['Elem', (d.role === 'thermo' ? '2 × AAA alkáli' : 'CR2032') + ' · ' + BAT.full(b), '']);
    if (p === 'C1') rows.push(['Bojler-napló', 'mai kWh, hőtartás, zuhanyok', '<button class="mini" type="button" data-boil="1">Megnyit</button>']);
    rows.push(['Szoba és szint', (ROOM_NAMES[d.room] || d.room || '--') + ', ' + (pinFloor(p) === 'up' ? 'fent' : 'lent'), '']);
    rows.push(['Típus', ROLE_NAME[d.role] || d.role, '']);
    return '<div class="ddset">' + rows.map(function (r) { return '<div><span>' + esc(r[0]) + '<small>' + esc(r[1]) + '</small></span>' + r[2] + '</div>'; }).join('') + '</div>';
  }
  function ddHtml(d) {
    var p = d.pink, s = devState(d), r = st.latest[p], on = d.role === 'robot' ? robOn(p) : plugOn(p), off = !r || r.online === false, c = st.dd[p] || {};
    var tabs = ddTabs(d); if (!tabs.some(function (t) { return t[0] === st.dtab; })) st.dtab = 'ov';
    var icBg = off ? '#d6d9e0' : d.role === 'robot' && on ? '#14a38b' : on ? '#ffd23f' : s.cls === 'hot' ? '#ffd9cc' : s.cls === 'cold' ? '#d6e6ff' : '#eef0f5';
    var h = '<div class="ddh"><span class="ddi" style="background:' + icBg + '"><svg aria-hidden="true" style="color:' + (d.role === 'robot' && on ? '#fff' : INK) + '"><use href="#pi-' + pinIcon(d) + '"/></svg></span><div class="ddn"><b>' + esc(d.role === 'robot' ? robName(p) : shortName(p)) + '</b>' +
      '<small>' + esc((ROOM_NAMES[d.room] || '') + (pinFloor(p) === 'up' ? ', fent' : ', lent')) + ' · <i class="dot ' + (off ? 'off' : 'on') + '"></i>' + (off ? 'offline' : 'online') + (r && r.ts ? ' · jelentett ' + ago(Date.parse(r.ts)) + ' ezelőtt' : '') + '</small></div></div>';
    h += '<div class="ddtabs" role="tablist" aria-label="Adatlap">' + tabs.map(function (t) { return '<button type="button" role="tab" data-dtab="' + t[0] + '" aria-selected="' + (st.dtab === t[0]) + '"><svg aria-hidden="true"><use href="#pi-' + t[2] + '"/></svg>' + t[1] + '</button>'; }).join('') + '</div><div class="ddb" role="tabpanel">';
    if (st.dtab === 'ov') {
      if (CTL_PINKS.indexOf(p) >= 0) {
        h += '<div class="ctl"><div class="ctlrow"><span class="nowst ' + (on ? 'on' : '') + '">' + (st.ctl.busy[p] ? 'Kapcsol…' : on ? 'BEKAPCSOLVA' : 'KIKAPCSOLVA') + '</span>' + swHtml(p, true) + '</div>' + askHtml(p) + (canCtl() ? '' : '<div class="ctln">' + roClause() + '</div>') + '</div>';
      } else if (d.role !== 'robot') h += '<div class="ddbig"><small>MOST</small><span class="' + s.cls + '">' + esc(s.big || s.txt) + '</span>' + (d.role === 'thermo' && d.room !== 'erkely' ? '<em>cél ' + target() + ' °C</em>' : '') + '</div>';
      h += ddKpis(d, c.mh);
      if (d.role === 'robot') h += '<button type="button" class="rvgo pov" data-pov="' + p + '"><svg width="18" height="18" aria-hidden="true"><use href="#pi-robot"/></svg>Porszívó-szem: a robot szemével (szimulált)</button>' + '<button type="button" class="rvgo" data-rvgo="' + p + '"><svg width="18" height="18" aria-hidden="true"><use href="#pi-grid"/></svg>Robot-nézet: térkép és vezérlés</button>' + robotCard(d);
      if (d.role === 'pir' && window.O2BMotion && st.role !== 'share') { moLoad(p); h += O2BMotion.mini(); }
      else if (d.role !== 'ac_ir' && d.role !== 'pir' && d.role !== 'ir_hub') h += ddChart(d, c.mh);
      if (CTL_PINKS.indexOf(p) >= 0) h += nextHtml(p);
      if (p === 'C1' && window.F27Boiler && boilA()) h += '<button type="button" class="bsub big" data-boil="1">' + esc(F27Boiler.sub(boilA())) + ' · Bojler-napló ›</button>';
      if (d.role === 'ac_ir') h += '<div class="ctln">Télen nem fűtünk vele (a gázkazán az alapfűtés). IR-ről vezérelt, ezért az állapotát nem küldi vissza.</div>';
    } else if (st.dtab === 'wk' && window.O2BMotion) { moLoad(p); h += O2BMotion.weeks(); }
    else if (st.dtab === 'sch') h += ddSched(p);
    else if (st.dtab === 'set') h += ddSettings(d);
    else if (st.dtab === 'map' && d.role === 'robot' && window.O2BRobotView) { rvLoad(p, 'map'); h += O2BRobotView.mapHtml(p, ago) + '<button type="button" class="rvgo" data-rvgo="' + p + '">Teljes robot-nézet ›</button>'; }
    else if (st.dtab === 'log' && d.role === 'robot' && window.O2BRobotView) { rvLoad(p, 'log'); h += '<div class="sub">Takarítások</div>' + O2BRobotView.logHtml(p); }
    else if (st.dtab === 'log') h += (CTL_PINKS.indexOf(p) >= 0 ? '<div class="sub">Kapcsolások</div>' + ddLogHtml(d, c.log) : '') + (d.role === 'robot' ? robotCard(d) : '<div class="sub">Mérések óránként</div>' + ddMeasLog(d, c.mh));
    return h + '</div>';
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-dtab],[data-ddlay]'); if (!t) return;
    e.stopPropagation();
    if (t.hasAttribute('data-dtab')) { st.dtab = t.getAttribute('data-dtab'); showInfo(); var b = document.querySelector('#info [data-dtab="' + st.dtab + '"]'); if (b) b.focus(); }
    else { setLayer(t.getAttribute('data-ddlay')); showInfo(); }
  });
  // robot térkép és takarítási napló (robotview.js)
  function rvLoad(p, what) { O2BRobotView.load({ sb: sb, user: st.user, role: st.role, pink: p, done: function () { if (st.sel === p) showInfo(); } }, what); }
  // mozgás-statisztika (motion.js): M3 az Áttekintésen, M1 + M2 a Hetek fülön
  function moLoad(p) { O2BMotion.load({ sb: sb, user: st.user, role: st.role, pink: p, done: function () { if (st.sel === p) showInfo(); } }); }
  document.addEventListener('click', function (e) {
    if (!window.O2BMotion) return;
    if (O2BMotion.onClick(e, showInfo, function (t) { st.dtab = t; showInfo(); var b = document.querySelector('#info [data-dtab="' + t + '"]'); if (b) b.focus(); })) e.stopPropagation();
  });
  // ---- A robot-mód: a babaház hátradől, a helyén a robot saját térképe és a vezérlés (✕ / Esc vissza)
  st.rm = null;
  function rmOpen(p) {
    if (innerWidth <= 760 && typeof setTab === 'function' && st.tab !== 'home') setTab('home');
    st.rm = p; $('app').classList.add('robo'); $('robomode').hidden = false;
    st.sel = null; $('info').hidden = true; rmRender();
    var x = $('b-rmx'); if (x) setTimeout(function () { x.focus(); }, 50);
  }
  function rmClose() {
    if (!st.rm) return; var p = st.rm; st.rm = null;
    $('app').classList.remove('robo'); $('robomode').hidden = true; drawOverlay();
    var b = document.querySelector('[data-rvgo="' + p + '"]'); if (b) b.focus();
  }
  function rmRender() {
    if (!st.rm || $('robomode').hidden) return;
    var p = st.rm, d = devOf(p), s = (st.latest[p] && st.latest[p].status) || {}, ds = devState(d), run = robOn(p);
    $('rmtitle').textContent = robName(p);
    var pb = $('b-rmpov'); if (pb) pb.setAttribute('data-pov', p);
    Array.prototype.forEach.call(document.querySelectorAll('[data-rm]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-rm') === p); });
    if (window.O2BRobotView) { rvLoad(p, 'map'); $('rmmap').innerHTML = O2BRobotView.mapHtml(p, ago); }
    var bat = typeof s.battery === 'number' ? s.battery + '%' : '--', area = s.area_m2 != null ? Math.round(s.area_m2) + ' m²' : '--', mins = s.minutes != null ? Math.round(s.minutes) + ' perc' : '--';
    $('rmhud').innerHTML = '<div class="rmst' + (run ? ' run' : '') + '">' + esc(ds.txt) + '</div>' +
      '<div class="rmstat"><div><small>Akku</small><b>' + bat + '</b></div><div><small>Terület</small><b>' + area + '</b></div><div><small>Idő</small><b>' + mins + '</b></div></div>' + robotCard(d);
  }
  document.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-rvgo]'); if (g) { e.stopPropagation(); rmOpen(g.getAttribute('data-rvgo')); return; }
    var m = e.target.closest && e.target.closest('[data-rm]'); if (m) { e.stopPropagation(); st.rm = m.getAttribute('data-rm'); rmRender(); return; }
    if (e.target.id === 'b-rmx') { e.stopPropagation(); rmClose(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.rm) { e.preventDefault(); rmClose(); } });
  function infoOpen(box) {
    box.insertAdjacentHTML('beforeend', '<button class="btn ib sm ix" type="button" aria-label="Bezárás">✕</button>');
    box.querySelector('.ix').addEventListener('click', function () { st.sel = null; box.hidden = true; drawItems('lo'); drawItems('up'); drawOverlay(); list(); });
    box.hidden = false;
  }
  function showInfo() {
    var box = $('info');
    if ($('rsheet') && !$('rsheet').hidden && typeof robSheet === 'function') robSheet();
    if (st.rm) rmRender();
    if (!st.sel) { box.hidden = true; return; }
    if (st.sel.indexOf('p:') === 0) {
      var p = S.PIECES.filter(function (x) { return x.id === st.sel.slice(2); })[0];
      if (!p) { box.hidden = true; return; }
      box.innerHTML = '<b>' + esc(p.name) + '</b><br>' + (p.fl === 'up' ? 'Fent, a tetőtérben' : 'Lent') +
        (p.drag ? (st.edit ? '. Húzd a helyére.' : '. Szerkesztés módban húzható.') : '. Beépített, nem mozdítható.');
      box.className = '';
      infoOpen(box); return;
    }
    var d = st.devs.filter(function (x) { return x.pink === st.sel; })[0]; if (!d) { box.hidden = true; return; }
    ddLoad(d.pink);
    box.className = 'dd';
    box.innerHTML = ddHtml(d);
    infoOpen(box);
  }

  // ---- visszavonás, elrendezések ---------------------------------------------------------------------
  function pushUndo(before) { st.undo.push(before); if (st.undo.length > 60) st.undo.shift(); st.redo = []; toolbar(); }
  function undo() { if (!st.undo.length) return; st.redo.push(JSON.parse(JSON.stringify(st.offs))); st.offs = st.undo.pop(); drawWorld(); markDirty(); }
  function redo() { if (!st.redo.length) return; st.undo.push(JSON.parse(JSON.stringify(st.offs))); st.offs = st.redo.pop(); drawWorld(); markDirty(); }
  function markDirty() { toolbar(); }
  function rotate(dir) { st.k = (st.k + dir + 4) % 4; st.vb = null; $('rotdeg').textContent = (st.k * 90) + '°'; drawSky(); drawWorld(); toast('Elforgatva: ' + (st.k * 90) + '°', ''); }
  function toolbar() {
    var owner = st.user && st.role === 'owner', dirty = offsKey(st.offs) !== st.savedKey;
    $('b-undo').disabled = !st.undo.length; $('b-redo').disabled = !st.redo.length;
    $('b-edit').hidden = !canEdit();
    $('b-edit').classList.toggle('on', st.edit); $('b-edit').setAttribute('aria-pressed', st.edit ? 'true' : 'false');
    $('b-reset').hidden = !canEdit(); $('b-undo').hidden = !canEdit(); $('b-redo').hidden = !canEdit();
    $('viewonly').hidden = !(st.user && st.role && st.role !== 'owner');
    $('app').classList.toggle('editing', st.edit);
    $('b-save').hidden = !owner; $('b-saveas').hidden = !owner; $('layouts').hidden = !owner || !st.layouts.length; $('b-def').hidden = !owner || !st.current;
    $('savest').textContent = owner ? (dirty ? 'Nem mentett változás' : st.current ? 'Mentve: ' + st.current.name : '') : (st.edit && !st.user ? 'Demó: belépve menthető' : '');
    var sel = $('layouts');
    if (owner) {
      sel.innerHTML = '<option value="">Elrendezések…</option>' + st.layouts.map(function (l) { return '<option value="' + esc(l.id) + '"' + (st.current && st.current.id === l.id ? ' selected' : '') + '>' + esc(l.name) + (l.is_default ? ' ★' : '') + '</option>'; }).join('');
    }
  }
  function layoutData() { var o = {}; Object.keys(st.offs).forEach(function (k) { var v = st.offs[k]; if (v && (v[0] || v[1])) o[k] = v; }); return { v: 1, site: 'o2b', pieces: o }; }
  function applyLayout(row) {
    var d = (row && row.data) || {}, o = {};
    Object.keys(d.pieces || {}).forEach(function (k) { var v = d.pieces[k]; if (Array.isArray(v) && v.length === 2 && isFinite(v[0]) && isFinite(v[1])) o[k] = [Math.max(-5, Math.min(5, +v[0])), Math.max(-6, Math.min(6, +v[1]))]; });
    st.offs = o; st.current = row; st.savedKey = offsKey(o); st.undo = []; st.redo = []; drawWorld(); toolbar();
  }
  function loadLayouts(autoDefault) {
    if (!sb || !st.user) return;
    sb.from('layouts').select('id,name,data,is_default,updated_at').order('name', { ascending: true }).then(function (res) {
      if (res.error) return;
      st.layouts = res.data || [];
      if (autoDefault) { var d = st.layouts.filter(function (l) { return l.is_default; })[0]; if (d) applyLayout(d); }
      toolbar();
    });
  }
  function save() {
    if (!sb || st.role !== 'owner') return;
    if (!st.current) { saveAs(); return; }
    sb.from('layouts').update({ data: layoutData() }).eq('id', st.current.id).select().then(function (res) {
      if (res.error) { toast('A mentés nem sikerült.', 'err'); return; }
      st.savedKey = offsKey(st.offs); toast('Mentve: ' + st.current.name, 'ok'); loadLayouts(false);
    });
  }
  function saveAs() {
    if (!sb || st.role !== 'owner') return;
    var name = (window.prompt('Az elrendezés neve:', 'O2B ' + new Date().toLocaleDateString('hu-HU')) || '').trim();
    if (!name) return;
    sb.from('layouts').insert({ name: name.slice(0, 80), data: layoutData(), is_default: !st.layouts.length }).select().then(function (res) {
      if (res.error) { toast(res.error.code === '23505' ? 'Ilyen nevű elrendezés már van.' : 'A mentés nem sikerült.', 'err'); return; }
      st.current = (res.data || [])[0] || null; st.savedKey = offsKey(st.offs); toast('Mentve: ' + name, 'ok'); loadLayouts(false);
    });
  }
  function makeDefault() {
    if (!sb || st.role !== 'owner' || !st.current) return;
    var id = st.current.id;
    sb.from('layouts').update({ is_default: false }).eq('is_default', true).then(function () {
      return sb.from('layouts').update({ is_default: true }).eq('id', id);
    }).then(function (res) { if (res && res.error) toast('Nem sikerült.', 'err'); else toast('Ez lett az alapértelmezett.', 'ok'); loadLayouts(false); });
  }
  function editStreet() {
    if (!sb || st.role !== 'owner') return;
    var v = ($('streetin').value || '').trim().slice(0, 60);
    sb.from('site_info').upsert({ key: 'street', value: v }).then(function (res) {
      if (res.error) { toast('Nem sikerült menteni (fut már a 009-es séma?).', 'err'); return; }
      st.street = v || null; drawWorld(); streetBox(); toast(v ? 'Az utca felirata: ' + v : 'Az utca felirata törölve.', 'ok');
    });
  }

  // ---- csempék, lista, Pamutka tanácsai ----------------------------------------------------------------
  function chip(id, cv, cs, cls) {
    var c = $(id); c.hidden = false; c.className = 'chip' + (cls ? ' ' + cls : '');
    c.querySelector('.cv').textContent = cv; if (cs != null) c.querySelector('.cs').textContent = cs;
  }
  function chips() {
    chip('c-out', st.wx && st.wx.temp != null ? fmt(st.wx.temp) + ' °C' : '--', 'XI. kerület');
    var ins = st.devs.filter(function (d) { return d.role === 'thermo' && d.room !== 'erkely'; }).map(function (d) { var r = st.latest[d.pink]; return r && r.online !== false ? temp(r.status) : null; }).filter(function (x) { return x != null; });
    var avg = ins.length ? ins.reduce(function (a, b) { return a + b; }, 0) / ins.length : null;
    chip('c-in', avg == null ? '--' : fmt(avg) + ' °C', 'cél: ' + target() + ' °C · ' + ins.length + ' hőmérő', avg != null && avg > target() + 1 ? 'warn' : '');
    var x1 = st.latest.X1 && st.latest.X1.online !== false && watts(st.latest.X1.status) != null;
    var w = st.devs.filter(function (d) { return (d.role === 'plug' || d.role === 'breaker') && !(x1 && d.pink === 'C1'); }).reduce(function (a, d) { var r = st.latest[d.pink]; var x = r && r.online !== false ? watts(r.status) : null; return a + (x || 0); }, 0);
    chip('c-pow', fmt(w, 0) + ' W', x1 ? 'konnektorok + fenti fürdőkör' : 'mért konnektorok');
    chip('c-mot', st.motion ? ago(st.motion) : '--', st.motion ? 'lépcső teteje' : 'még nem volt');
    if (SUN) {
      var t = SUN.times(Date.now(), LAT, LON), dl = st.daily;
      if (SKY) { var mi = SKY.moonIllum(Date.now()); $('c-sun').title = 'Napkelte, napnyugta (a nap útja szaggatott ívként az égen). Hold: ' + SKY.phaseName(mi.phase) + ', ' + Math.round(mi.fraction * 100) + '% megvilágított.'; }
      // a hold fázisa itt (az égen csak a rajza van, felirat nélkül, hogy ne ütközzön a lakás feliratával)
      var moonTxt = SKY ? (function () { var m2 = SKY.moonIllum(Date.now()); return ' · hold ' + Math.round(m2.fraction * 100) + '%'; })() : '';
      chip('c-sun', t.rise ? '↑' + SUN.hm(t.rise) + ' ↓' + SUN.hm(t.set) : '--', (dl && dl.tmin != null ? 'holnap ' + fmt(dl.tmin, 0) + '…' + fmt(dl.tmax, 0) + ' °C' : 'napkelte · napnyugta') + moonTxt);
    }
    var due = BAT ? BAT.due(st.bat) : [];
    if (due.length) {
      var r0 = due[0], hot = r0.level !== 'due30';
      chip('c-bat', r0.label || r0.pink, BAT.full(r0) + (due.length > 1 ? ' · +' + (due.length - 1) : ''), hot ? 'hot' : 'warn');
      $('c-bat').querySelector('.ck').textContent = 'ELEMCSERE' + (due.length > 1 ? ' · ' + due.length : '');
      $('c-bat').title = 'Elemcsere: ' + due.map(function (r) { return (r.label || r.pink) + ': ' + BAT.full(r) + ', ' + BAT.when(r) + (r.basis ? ' [' + r.basis + ']' : ''); }).join('; ') +
        '. A dashboard számolja a merülés üteméből és az elem típusából (hőmérő: 2 × AAA, mozgásérzékelő: CR2032).';
    } else $('c-bat').hidden = true;
    var on = st.devs.filter(function (d) { return st.latest[d.pink] && st.latest[d.pink].online !== false; }).length;
    $('dh').textContent = 'Eszközök · ' + on + ' online';
  }
  function list() {
    var by = {}, box = $('rooms'); box.innerHTML = (typeof switchesHtml === 'function' && (window.innerWidth || 1440) < 900) ? switchesHtml() : '';
    st.devs.filter(function (d) { return d.role !== 'ir_hub'; }).forEach(function (d) { (by[d.room] = by[d.room] || []).push(d); });
    Object.keys(ROOM_NAMES).forEach(function (rid) {
      if (!by[rid]) return;
      var sec = document.createElement('div'); sec.className = 'room';
      sec.innerHTML = '<h3>' + ROOM_NAMES[rid] + '</h3>';
      by[rid].forEach(function (d) {
        var s = devState(d), b = document.createElement('button');
        b.type = 'button'; b.className = 'dv ' + s.cls + (st.sel === d.pink ? ' sel' : '');
        b.innerHTML = '<span class="sw" style="background:' + (ROLE_COL[d.role] || '#ccc') + '"></span><span class="n">' + esc(d.label) + '</span><span class="s">' + esc(s.txt) + '</span>';
        b.addEventListener('click', function () { select(d.pink); });
        sec.appendChild(b);
      });
      box.appendChild(sec);
    });
  }
  // a tanácsok: [szöveg, szoba (ahova Pamutka odasétál)]
  // ---- Bojler-napló (web/js/boiler.js; az emeleti bojler a C1 konnektoron) -----------------------------
  var boilRaw = null, boilAt = 0, PRICE_O2B = 70.1;
  function loadBoil(force) {
    if (!window.F27Boiler || !sb || !st.user || ['owner', 'member'].indexOf(st.role) < 0) { boilRaw = null; return; }
    if (!force && boilAt && Date.now() - boilAt < 10 * 60000) return;
    boilAt = Date.now();
    F27Boiler.load(sb, 'C1').then(function (raw) { boilRaw = raw; render(); });
  }
  function boilA() {
    if (!window.F27Boiler) return null;
    var raw = st.live ? boilRaw : F27Boiler.demo(Date.now(), 'o2b');
    if (!raw || (!raw.hours.length && !raw.days.length)) return null;
    var r = st.latest.C1, w = r && r.online !== false ? (isOn(r.status) ? watts(r.status) : 0) : null;
    return F27Boiler.analyze(raw, { price: PRICE_O2B, liveW: w });
  }
  function openBoil() {
    var a = boilA(); if (!a) { toast('A bojler-napló belépve (tulaj, családtag) látszik.', ''); return; }
    var B = F27Boiler, tips = [{ html: 'Ha napokig senki nincs itthon, a bojler lekapcsolható (Kapcsolók > Emeleti bojler): a hőtartás kb. <b>' + B.ft(a.idleCostDay) + '/nap</b> (' + B.fmt(a.idle) + ' kWh). Hazaérkezés előtt 3 órával kapcsold vissza.' }];
    if (a.nightUse.length) tips.push({ warn: true, html: 'Ma éjjel (' + a.nightUse.join(', ') + ' órakor) a szokásosnál többet fűtött: ha nem fürdött senki, nézd meg a csapokat.' });
    B.open({ a: a, title: 'Emeleti bojler · C1', tips: tips });
  }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-boil]'); if (b) { e.stopPropagation(); openBoil(); } });

  function tips() {
    var out = [], tg = target();
    st.devs.forEach(function (d) {
      var r = st.latest[d.pink]; if (!r) return;
      if (d.role === 'thermo' && d.room !== 'erkely' && r.online !== false) {
        var t = temp(r.status);
        if (t != null && t > tg + 1) out.push(['<b>' + ROOM_NAMES[d.room] + '</b>: ' + fmt(t) + ' °C, a cél ' + tg + '. Egy fokkal lejjebb kb. 6% gázt spórolsz.', d.room, d.pink, 'red']);
        if (t != null && t < tg - 1.5) out.push(['<b>' + ROOM_NAMES[d.room] + '</b>: csak ' + fmt(t) + ' °C. Nem hűl ki? Nézd meg a radiátorszelepet.', d.room, d.pink, 'blue']);
      }
      if (d.role === 'plug' && d.pink === 'C1' && r.online !== false) {
        var w = watts(r.status);
        if (w && w > 500) out.push(['A <b>fenti bojler</b> most fűt (' + fmt(w, 0) + ' W).', 'furdo_fent', 'C1', 'orange']);
      }
      // D: Pamutka szól, ha szokatlan a bojler napja (sokkal több a szokásosnál, vagy éjjel is fűtött)
      if (d.pink === 'C1' && window.F27Boiler) {
        var ba = boilA();
        if (ba && ba.pct7 != null && ba.pct7 > 0.4 && ba.use > 1.5) out.push(['Miaú! Az <b>emeleti bojler</b> ma ' + F27Boiler.fmt(ba.todayKwh) + ' kWh-t evett, a szokásos ' + F27Boiler.fmt(ba.avg7) + ' helyett (' + F27Boiler.pctTxt(ba.pct7) + ', kb. ' + F27Boiler.ft(ba.cost) + '). Ez ' + F27Boiler.showersTxt(ba.showers) + ' vagy egy kád fürdő. Fürdött valaki? 🛁', 'furdo_fent', 'C1', 'orange']);
        if (ba && ba.nightUse.length) out.push(['Miaú! Az emeleti bojler <b>éjjel is fűtött</b> (' + ba.nightUse.join(', ') + ' órakor), a hőtartásnál többet. Csöpög valahol egy csap?', 'furdo_fent', 'C1', 'red']);
      }
    });
    var off = st.devs.filter(function (d) { return d.role === 'thermo' && st.latest[d.pink] && st.latest[d.pink].online === false; });
    var batOf = function (p) { return (st.bat || []).filter(function (x) { return x.pink === p; })[0]; };
    if (off.length) out.push([off.length + ' hőmérő nem jelentkezik, valószínűleg elem kell bele: ' + off.map(function (d) { var b = batOf(d.pink); return '<b>' + ROOM_NAMES[d.room] + '</b>' + (b && b.value != null ? ' (utoljára ' + esc(BAT.charge(b)).replace(' (% nincs)', '') + ')' : ''); }).join(', ') + '.', off[0].room, off[0].pink, 'orange']);
    (st.bat || []).forEach(function (b) {
      if (b.level === 'due14' || b.level === 'dead') {
        var dv = st.devs.filter(function (d) { return d.pink === b.pink; })[0];
        out.push(['Elemcsere: <b>' + esc(b.label || b.pink) + '</b>, ' + esc(BAT.full(b)) + '.', dv ? (dv.room === 'lepcso_fent' ? 'eloter' : dv.room) : null, b.pink, b.level === 'dead' ? 'red' : 'orange']);
      }
    });
    ['R1', 'R2'].forEach(function (p) {                         // robot kopóalkatrész 10% alatt
      var pt = st.user ? robParts(p) : null; if (!pt) return;
      var low = Object.keys(PART_NAMES).filter(function (k) { return typeof pt[k] === 'number' && pt[k] <= 10; });
      if (low.length) out.push(['<b>' + esc(robName(p)) + '</b>: ' + low.map(function (k) { return PART_NAMES[k].toLowerCase() + ' ' + pt[k] + '%'; }).join(', ') + ', ideje cserélni vagy tisztítani.', devOf(p).room, p, 'orange']);
    });
    return out;
  }
  // D: Pamutka (2026.11.20): egy buborék a legfontosabb gondról forintban, a ház állapota (gyűrű + 3 sáv),
  // legfeljebb 3 teendő a havi hatás szerint rangsorolva; a „Beállítom” megerősítés után el is végzi
  // (ütemezést vesz fel), a kézi teendő „Mutasd” / „Kész”; a többi a „Később” alatt.
  // A becslések forrása: gáz a mérőfotók óta mért 2,3 m³/nap (2026.11.15), fűtési rész 91%, 1 °C kb. 6%;
  // bojler a mért hőtartásból (web/js/boiler.js); lámpa a mért wattból.
  var GAS_M3_DAY = 2.3, GAS_FT_M3 = 2.87 * 34.5, HEAT_SHARE = 0.91, PER_DEG = 0.06, A1_FT = 70.1;
  var PAM_DONE_KEY = 'o2b-pam-done';
  st.pam = { ask: null };
  function pamDoneToday() { try { var o = JSON.parse(localStorage.getItem(PAM_DONE_KEY) || '{}'), d = new Date().toDateString(); return o.d === d ? o.ids || [] : []; } catch (e) { return []; } }
  function pamMarkDone(id) { try { var ids = pamDoneToday(); if (ids.indexOf(id) < 0) ids.push(id); localStorage.setItem(PAM_DONE_KEY, JSON.stringify({ d: new Date().toDateString(), ids: ids })); } catch (e) { /* nem baj */ } }
  function ftR(x) { x = Math.round(x / 10) * 10; return '~' + x.toLocaleString('hu-HU') + ' Ft'; }
  function ruleOn(p, r) { var ex = findRule(p, r); return !!(ex && ex.enabled); }
  function pamTodos() {
    var out = [], tg = target(), heatMonth = GAS_M3_DAY * 30.4 * GAS_FT_M3 * HEAT_SHARE;
    // 1. túlfűtött szobák: a kazán a termosztát szobája szerint fűt, a többi szoba túlfűthet
    var rooms = ['nappali', 'etkezo', 'halo', 'kagylo', 'gyerek'].map(function (r) { return [r, roomTemp(r)]; }).filter(function (x) { return x[1] && x[1].t != null; });
    var hot = rooms.filter(function (x) { return x[1].c === 'hot'; }).sort(function (a, b) { return b[1].t - a[1].t; });
    if (hot.length) {
      var exc = rooms.reduce(function (a, x) { return a + Math.max(0, x[1].t - tg); }, 0) / rooms.length, g = exc * PER_DEG * heatMonth, h0 = hot[0];
      var dn = st.devs.filter(function (d) { return d.role === 'thermo' && d.room === h0[0]; })[0];
      out.push({ id: 'hot-' + h0[0], kind: 'manual', gain: g, pink: dn && dn.pink, room: h0[0],
        t: (hot.length > 1 ? hot.length + ' szoba túlfűtött, a legmelegebb: ' : '') + (ROOM_NAMES[h0[0]] || h0[0]) + ' ' + fmt(h0[1].t) + '°',
        s: 'a cél ' + tg + ' °C. Radiátorfej egy fokkal lejjebb' + (h0[0] === 'etkezo' ? ' (itt mér a termosztát: inkább a termosztátot vedd lejjebb)' : '') + '.',
        bub: (ROOM_NAMES[h0[0]] || h0[0]) + ': ' + fmt(h0[1].t) + ' °C, ' + fmt(h0[1].t - tg) + ' fokkal a cél fölött.' + (g >= 20 ? ' Ez ' + ftR(g) + ' havonta.' : '') });
    }
    // 2. bojler éjjel: hőtartás 23:00 és 5:30 között (a mért hőtartásból)
    var ba = boilA(), rOff = { action: 'off', kind: 'time', minute: 1380, days: 127 }, rOn = { action: 'on', kind: 'time', minute: 330, days: 127 };
    if (ba && ba.idleCostDay) out.push({ id: 'boil-night', kind: 'rules', p: 'C1', rules: [rOff, rOn], done: ruleOn('C1', rOff) && ruleOn('C1', rOn), gain: ba.idleCostDay * (6.5 / 24) * 30.4,
      t: 'Bojler éjjel KI, 23:00-tól 5:30-ig', s: 'éjjel is tartja a hőt (kb. ' + F27Boiler.fmt(ba.idle) + ' kWh/nap)', q: 'Felveszek két heti ütemezést az emeleti bojlerre: minden nap 23:00-kor KI, 5:30-kor BE. Bármikor kikapcsolhatod.',
      bub: 'Az emeleti bojler éjjel is fűt. Ha 23:00 és 5:30 között pihen, ' + ftR(ba.idleCostDay * (6.5 / 24) * 30.4) + ' marad havonta.' });
    // 3. sokáig égő lámpák ütemezés nélkül (C4 lépcső, C2 dupla lámpa): napnyugtakor BE, 23:30-kor KI
    ['C4', 'C2', 'C3'].forEach(function (p) {
      var r = st.latest[p], w = r && plugOn(p) ? watts(r.status) : null;
      if (!w || st.ctl.rules.some(function (x) { return x.pink === p && x.enabled; })) return;
      var a = { action: 'on', kind: 'sunset', minute: 0, days: 127 }, b = { action: 'off', kind: 'time', minute: 1410, days: 127 };
      out.push({ id: 'lamp-' + p, kind: 'rules', p: p, rules: [a, b], done: false, gain: w * 14 / 1000 * 30.4 * A1_FT,
        t: shortName(p) + ': napnyugtától 23:30-ig', s: 'most ' + fmt(w, 0) + ' W, ütemezés nélkül', q: 'Felveszek két heti ütemezést: ' + shortName(p) + ' napnyugtakor BE, 23:30-kor KI.' });
    });
    out.sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.gain - a.gain; });
    var dd = pamDoneToday(); out.forEach(function (x) { if (x.kind === 'manual' && dd.indexOf(x.id) >= 0) x.done = true; });
    return out;
  }
  function pamScore() {
    var rooms = ['nappali', 'etkezo', 'halo', 'kagylo', 'gyerek'].map(roomTemp).filter(function (x) { return x && x.t != null; });
    var comf = rooms.length ? rooms.filter(function (x) { return x.c === 'ok'; }).length / rooms.length : 1;
    var devs = st.devs.filter(function (d) { return d.role !== 'ir_hub' && d.role !== 'ac_ir'; }), onl = devs.filter(function (d) { return !isOff(d.pink); }).length / Math.max(1, devs.length);
    var due = BAT ? BAT.due(st.bat).length : 0, dev = Math.max(0, onl - due * 0.05);
    var ba = boilA(), cost = ba && ba.pct7 != null ? Math.max(0, Math.min(1, 1 - ba.pct7)) : 0.7;
    return { score: Math.round(100 * (0.5 * comf + 0.25 * dev + 0.25 * cost)), bars: [
      ['Komfort', comf, '#2fa56b', rooms.filter(function (x) { return x.c === 'ok'; }).length + '/' + rooms.length + ' a célon'],
      ['Költség', cost, '#ff7a45', ba && ba.pct7 != null ? 'bojler ' + F27Boiler.pctTxt(ba.pct7) : 'nincs adat'],
      ['Eszközök', dev, '#4f86e8', Math.round(onl * 100) + '% online' + (due ? ', ' + due + ' elem' : '')]] };
  }
  function pamutka() {
    var td = pamTodos(), top = td.slice(0, 3), rest = tips().filter(function (x) { return !/Egy fokkal lejjebb/.test(x[0]); }), sc = pamScore();
    var lead = top.filter(function (x) { return !x.done && x.bub; })[0];
    // a sürgős jelzés (szokatlan bojler-nap, éjjeli fűtés, lemerült elem) megelőzi a megtakarítási tanácsot
    var urg = rest.filter(function (x) { return x[3] === 'red' || /evett/.test(x[0]); })[0];
    if (urg) rest = rest.filter(function (x) { return x !== urg; });
    var bub = urg ? urg[0].replace(/^Miaú! /, '') : lead ? lead.bub : rest.length ? rest[0][0] : 'Minden rendben, dorombolok. A szobák a cél körül vannak.';
    var saved = td.filter(function (x) { return x.done && x.kind === 'rules'; }).reduce(function (a, x) { return a + x.gain; }, 0);
    var R = 30, C = 2 * Math.PI * R;
    var h = '<div class="pmb">Miaú! ' + bub + '</div>' +
      '<div class="pms"><svg width="78" height="78" viewBox="0 0 78 78" role="img" aria-label="A ház állapota: ' + sc.score + ' a 100-ból"><circle cx="39" cy="39" r="' + R + '" fill="none" stroke="#efe4cc" stroke-width="9"/>' +
      '<circle cx="39" cy="39" r="' + R + '" fill="none" stroke="' + (sc.score >= 75 ? '#2fa56b' : sc.score >= 50 ? '#f2a541' : '#e8432f') + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (C * sc.score / 100).toFixed(1) + ' 999" transform="rotate(-90 39 39)"/>' +
      '<text x="39" y="44" text-anchor="middle" class="pmsn">' + sc.score + '</text></svg><div class="pmbars">' +
      sc.bars.map(function (b) { return '<div class="pmbar"><span>' + b[0] + '</span><span class="tr"><i style="width:' + Math.round(b[1] * 100) + '%;background:' + b[2] + '"></i></span><small>' + esc(b[3]) + '</small></div>'; }).join('') + '</div></div>';
    if (top.length) h += '<div class="pmtd">' + top.map(function (x, i) {
      var btn = x.done ? '<span class="pmok">Kész</span>' : x.kind === 'rules' ? (canCtl() ? '<button type="button" class="btn sm y" data-pam="do" data-id="' + x.id + '">Beállítom</button>' : '') :
        (x.pink ? '<button type="button" class="btn sm" data-pam="show" data-pink="' + x.pink + '">Mutasd</button>' : '') + '<button type="button" class="btn sm" data-pam="done" data-id="' + x.id + '">Kész</button>';
      var s = '<div class="pmt' + (x.done ? ' done' : '') + '"><span class="n">' + (x.done ? '✓' : i + 1) + '</span><p>' + esc(x.t) + '<small>' + esc(x.s) + '</small>' + (x.gain >= 10 ? '<span class="gain">' + ftR(x.gain) + '/hó</span>' : '') + '</p><span class="act">' + btn + '</span>';
      if (st.pam.ask === x.id) s += '<div class="pmask" role="alertdialog" aria-label="Megerősítés"><p>' + esc(x.q) + '</p><div class="row"><button type="button" class="btn sm no" data-pam="no">Mégse</button><button type="button" class="btn sm y" data-pam="yes" data-id="' + x.id + '">Rendben</button></div></div>';
      return s + '</div>';
    }).join('') + '</div>';
    if (saved >= 10) h += '<div class="pmsave"><b>' + ftR(saved) + '/hó</b><small>a beállított teendők becsült hatása</small></div>';
    if (rest.length) h += '<details class="pmlater"><summary>Később (' + rest.length + ')</summary><ul class="tips">' + rest.map(function (x) {
      return '<li class="tipc ' + (x[3] || 'orange') + '"><span class="tx">' + x[0] + '</span>' + (x[2] ? '<button class="btn sm tbtn" type="button" data-pink="' + esc(x[2]) + '">Mutasd</button>' : '') + '</li>'; }).join('') + '</ul></details>';
    $('say').innerHTML = h + (st.live ? '' : '<small><i>Demó: belépés után a valódi adatokból szólok.</i></small>');
    var all = tips();
    cat.goal = urg ? urg[1] : lead && lead.room ? lead.room : all.length ? all[0][1] : null;
    layer.cat && layer.cat.classList.toggle('has-tip', !!(lead || all.length));
    st.pamLead = { text: bub.replace(/<[^>]+>/g, ''), pink: urg ? urg[2] : lead ? lead.pink || lead.p : rest.length ? rest[0][2] : null };
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-pam], #say .tbtn, #pbody .tbtn') : null; if (!b) return;
    e.stopPropagation();
    if (b.classList.contains('tbtn')) { if (typeof setTab === 'function' && st.tab !== 'home') setTab('home'); select(b.getAttribute('data-pink')); return; }
    var k = b.getAttribute('data-pam'), id = b.getAttribute('data-id');
    if (k === 'show') { if (typeof setTab === 'function' && st.tab !== 'home') setTab('home'); select(b.getAttribute('data-pink')); return; }
    if (k === 'done') { pamMarkDone(id); toast('Köszi! Pamutka dorombol.', 'ok'); render(); return; }
    if (k === 'do') { st.pam.ask = st.pam.ask === id ? null : id; render(); return; }
    if (k === 'no') { st.pam.ask = null; render(); return; }
    if (k === 'yes') {
      st.pam.ask = null;
      var x = pamTodos().filter(function (t) { return t.id === id; })[0];
      if (x && x.kind === 'rules') x.rules.forEach(function (r, i) { setTimeout(function () { if (!findRule(x.p, r)) saveRule(x.p, r); else if (!ruleOn(x.p, r)) ruleOp(findRule(x.p, r).id, 'tog'); }, i * 400); });
      setTimeout(render, 900); render();
    }
  });
  // jobb oldali Áttekintés panel (asztali nézet), a F27 mintájára
  try { st.ovtab = localStorage.getItem('o2b-ovtab') || 'ctl'; } catch (e) { st.ovtab = 'ctl'; }
  function overview() {
    var box = $('ovbody'); if (!box) return;
    var th = st.devs.filter(function (d) { return d.role === 'thermo' && !hideOff(d.pink); });
    var tiles = th.map(function (d) {
      var r = st.latest[d.pink], s = devState(d), hum = r && r.status && typeof r.status.va_humidity === 'number' ? r.status.va_humidity : null;
      var b = (st.bat || []).filter(function (x) { return x.pink === d.pink; })[0], bl = b && BAT && BAT.ORDER[b.level] <= 3;
      return '<button type="button" class="ovt ' + s.cls + (st.sel === d.pink ? ' sel' : '') + '" data-pink="' + d.pink + '"><span class="r">' + esc((ROOM_NAMES[d.room] || d.room) + (d.pink === 'T8' ? ' 2.' : '')) + '</span>' +
        '<span class="v">' + esc(s.big && s.big !== 'offline' ? s.big : s.cls === 'off' ? 'offline' : '--') + '</span>' +
        '<span class="m">' + (hum != null ? 'pára ' + hum + ' %' : '&nbsp;') + (bl ? ' · <b class="bw">elem!</b>' : '') + '</span></button>';
    }).join('');
    var plugs = st.devs.filter(function (d) { return (d.role === 'plug' || d.role === 'breaker') && !hideOff(d.pink); });
    var tot = 0, rows = plugs.map(function (d) {
      var r = st.latest[d.pink], off = !r || r.online === false, w = !off ? watts(r.status) : null, on = r && isOn(r.status);
      if (w && !(d.pink === 'C1' && st.latest.X1 && watts(st.latest.X1.status) != null)) tot += w;
      var pct = w ? Math.min(100, Math.round(w / 20)) : 0;
      var bsub = d.pink === 'C1' && window.F27Boiler ? F27Boiler.sub(boilA()) : '';
      return '<div class="cr' + (off ? ' off' : '') + '"><span class="n">' + esc(d.label.replace(/ \(.*\)$/, '')) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="w">' + (off ? 'offline' : on ? (w ? fmt(w, 0) + ' W' : '0 W') : 'KI') + '</span></div>' +
        (bsub ? '<button type="button" class="bsub" data-boil="1" title="Bojler-napló: mennyit ment ma, mit jelent, mihez képest">' + esc(bsub) + ' ›</button>' : '');
    }).join('');
    var due = BAT ? BAT.due(st.bat) : [];
    var bats = due.length ? due.map(function (r) { return '<div class="br ' + r.level + '"><b>' + esc(r.label || r.pink) + '</b><span>' + esc(BAT.full(r)) + '</span></div>'; }).join('')
      : '<div class="br ok">Minden elem rendben.</div>';
    var nOff = offCount();
    // P4 (2026.11.21): fülek egyetlen hosszú görgetés helyett: Vezérlés · Hő · Energia (fogyasztás és elemek)
    var ot = st.ovtab || 'ctl', nb = due.filter(function (r) { return BAT.ORDER[r.level] <= 2; }).length;
    var otabs = [['ctl', 'Vezérlés'], ['heat', 'Hő'], ['en', 'Energia' + (nb ? ' ⚠' : '')]];
    box.innerHTML = (nOff && !st.showOff ? '<div class="offnote">' + nOff + ' offline eszköz elrejtve <button class="mini lnk" data-off="1">Mutasd</button></div>' : '') +
      '<div class="ovtabs" role="tablist" aria-label="Áttekintés">' + otabs.map(function (x) { return '<button type="button" role="tab" data-ovtab="' + x[0] + '" aria-selected="' + (ot === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      (ot === 'ctl' ? switchesHtml() : '') +
      (ot === 'heat' ? '<div class="ovs"><div class="ovh">HŐMÉRSÉKLETEK <small>cél: ' + target() + ' °C</small></div><div class="tiles">' + tiles + '</div></div>' +
        '<div class="ovs"><div class="ovh">FŰTÉS</div><div class="br ok">Gázkazán (Savio), Computherm termosztát az étkezőben: még nincs bekötve, a hőmérők mutatják a hatását.</div></div>' : '') +
      (ot === 'en' ? '<div class="ovs"><div class="ovh">FOGYASZTÁS MOST <b>' + fmt(tot, 0) + ' W</b></div>' + rows + '</div>' +
        '<div class="ovs"><div class="ovh">ELEMEK</div>' + bats + '</div>' : '');
    Array.prototype.forEach.call(box.querySelectorAll('[data-ovtab]'), function (bt) { bt.addEventListener('click', function (e) { e.stopPropagation(); st.ovtab = bt.getAttribute('data-ovtab'); try { localStorage.setItem('o2b-ovtab', st.ovtab); } catch (x) { /* nem baj */ } overview(); }); });
    Array.prototype.forEach.call(box.querySelectorAll('.ovt'), function (bt) { bt.addEventListener('click', function () { select(bt.getAttribute('data-pink')); }); });
    $('ovsrc').textContent = st.live ? 'ÉLŐ' : 'DEMÓ'; $('ovsrc').className = 'src ' + (st.live ? 'live' : 'demo');
  }
  function render() {
    $('demo').hidden = st.live; $('livepill').hidden = !st.live;
    chips(); list(); pamutka(); overview(); updateHeat(); drawPins(); showInfo(); toolbar(); offBtn(); floorBar(); if (typeof tabRender === 'function') tabRender(); povSync();
  }

  // ---- Pamutka: sétál a lakásban, szundít, és odamegy, ahol gond van ----------------------------------------
  var cat = { i: 0, fl: 'lo', x: 2.3, y: -1.0, mode: 'sleep', wait: 4000, goal: null, face: 1, fs: 1, tilt: 0, v: 0, jump: null, sp: null, last: 0, fade: 1, dir: 1, next: null };
  // Pamutka helye a böngészőben megmarad: rövid frissítés után ugyanott folytatja; ha rég nem nézted
  // (15 percnél régebben), egy másik pihenőhelyen találod. Csak ebben a böngészőben, csak kényelmi adat.
  var CAT_KEY = 'o2b-pamutka', CAT_FRESH = 15 * 60000;
  (function restoreCat() {
    var R0 = S.CAT_ROUTE, sv = null;
    try { sv = JSON.parse(localStorage.getItem(CAT_KEY) || 'null'); } catch (e) { sv = null; }
    if (sv && Date.now() - sv.ts < CAT_FRESH && R0[sv.i] && (sv.fl === 'lo' || sv.fl === 'up')) {
      cat.i = sv.i; cat.fl = sv.fl; cat.x = sv.x; cat.y = sv.y; cat.dir = sv.dir === -1 ? -1 : 1;
      cat.mode = sv.mode === 'walk' ? 'walk' : sv.mode; cat.wait = Math.max(0, (sv.wait || 0) - (Date.now() - sv.ts)); cat.face = sv.face || 1; cat.fs = cat.face;
      return;
    }
    var rest = []; R0.forEach(function (r, i) { if (r[3] === 'sleep' || r[3] === 'sit') rest.push(i); });
    var i = rest.length ? rest[Math.floor(Math.random() * rest.length)] : 0;
    cat.i = i; cat.fl = R0[i][0]; cat.x = R0[i][1]; cat.y = R0[i][2]; cat.mode = 'sleep'; cat.wait = 5000 + Math.random() * 10000;
  })();
  function saveCat() {
    var J = cat.jump, sv = J ? { i: J.ni, fl: J.f1, x: J.x1, y: J.y1 } : { i: cat.i, fl: cat.fl, x: cat.x, y: cat.y };
    sv.dir = cat.dir; sv.face = cat.face; sv.mode = ['jump', 'land', 'held', 'thud', 'wake'].indexOf(cat.mode) >= 0 ? 'walk' : cat.mode; sv.wait = cat.wait; sv.ts = Date.now();
    try { localStorage.setItem(CAT_KEY, JSON.stringify(sv)); } catch (e) { /* tiltott tároló: nem baj */ }
  }
  setInterval(saveCat, 1000);
  window.addEventListener('pagehide', saveCat);
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveCat(); });
  // Pamutka, a világ legcukibb macskája: ezüst cirmos, nagy fej, csillogó sárgászöld szem, pirospozsgás
  // pofi, fekete nyakörv aranycsengővel, csíkos farok. Három póz: ül (szemből), sétál (oldalt), alszik.
  var PAM = { fur: '#e3e7ea', fur2: '#c9cfd4', stripe: '#6b7179', belly: '#fbfcfd', pink: '#f6a9bf', eye: '#c3d84a' };
  function pamHead(cx, cy, s, sleepy) {
    var P = PAM, k = s || 1, f = function (n) { return Math.round(n * k * 10) / 10; }, X = function (n) { return Math.round((cx + n * k) * 10) / 10; }, Y = function (n) { return Math.round((cy + n * k) * 10) / 10; };
    var o = '';
    o += '<g class="ear el"><path d="M' + X(-34) + ',' + Y(-10) + ' L' + X(-36) + ',' + Y(-44) + ' Q' + X(-35) + ',' + Y(-48) + ' ' + X(-31) + ',' + Y(-46) + ' L' + X(-12) + ',' + Y(-28) + ' Z" fill="' + P.fur + '" stroke="#1e2a44" stroke-width="' + f(3) + '" stroke-linejoin="round"/>' +
      '<path d="M' + X(-30) + ',' + Y(-16) + ' L' + X(-32) + ',' + Y(-38) + ' L' + X(-17) + ',' + Y(-27) + ' Z" fill="' + P.pink + '"/></g>';
    o += '<g class="ear er"><path d="M' + X(34) + ',' + Y(-10) + ' L' + X(36) + ',' + Y(-44) + ' Q' + X(35) + ',' + Y(-48) + ' ' + X(31) + ',' + Y(-46) + ' L' + X(12) + ',' + Y(-28) + ' Z" fill="' + P.fur + '" stroke="#1e2a44" stroke-width="' + f(3) + '" stroke-linejoin="round"/>' +
      '<path d="M' + X(30) + ',' + Y(-16) + ' L' + X(32) + ',' + Y(-38) + ' L' + X(17) + ',' + Y(-27) + ' Z" fill="' + P.pink + '"/></g>';
    // fej: széles, puha, oldalt pofaszőr
    o += '<path d="M' + X(-40) + ',' + Y(4) + ' Q' + X(-46) + ',' + Y(-6) + ' ' + X(-40) + ',' + Y(-12) + ' Q' + X(-40) + ',' + Y(-36) + ' ' + X(0) + ',' + Y(-37) + ' Q' + X(40) + ',' + Y(-36) + ' ' + X(40) + ',' + Y(-12) + ' Q' + X(46) + ',' + Y(-6) + ' ' + X(40) + ',' + Y(4) + ' Q' + X(36) + ',' + Y(26) + ' ' + X(0) + ',' + Y(27) + ' Q' + X(-36) + ',' + Y(26) + ' ' + X(-40) + ',' + Y(4) + ' Z" fill="' + P.fur + '" stroke="#1e2a44" stroke-width="' + f(3.2) + '" stroke-linejoin="round"/>';
    // M-betűs homlokcsíkok és pofacsíkok
    o += '<path d="M' + X(-8) + ',' + Y(-35) + ' Q' + X(-6) + ',' + Y(-26) + ' ' + X(-2) + ',' + Y(-22) + ' M' + X(8) + ',' + Y(-35) + ' Q' + X(6) + ',' + Y(-26) + ' ' + X(2) + ',' + Y(-22) + ' M' + X(-18) + ',' + Y(-33) + ' Q' + X(-15) + ',' + Y(-26) + ' ' + X(-14) + ',' + Y(-21) + ' M' + X(18) + ',' + Y(-33) + ' Q' + X(15) + ',' + Y(-26) + ' ' + X(14) + ',' + Y(-21) +
      ' M' + X(-40) + ',' + Y(-4) + ' L' + X(-30) + ',' + Y(-2) + ' M' + X(-40) + ',' + Y(4) + ' L' + X(-31) + ',' + Y(4) + ' M' + X(40) + ',' + Y(-4) + ' L' + X(30) + ',' + Y(-2) + ' M' + X(40) + ',' + Y(4) + ' L' + X(31) + ',' + Y(4) + '" fill="none" stroke="' + P.stripe + '" stroke-width="' + f(2.6) + '" stroke-linecap="round"/>';
    // pofi: fehér pofaszőr az orr körül
    o += '<ellipse cx="' + X(0) + '" cy="' + Y(12) + '" rx="' + f(16) + '" ry="' + f(11) + '" fill="' + P.belly + '"/>';
    if (sleepy) {
      o += '<path d="M' + X(-22) + ',' + Y(-3) + ' Q' + X(-15) + ',' + Y(3) + ' ' + X(-8) + ',' + Y(-3) + ' M' + X(8) + ',' + Y(-3) + ' Q' + X(15) + ',' + Y(3) + ' ' + X(22) + ',' + Y(-3) + '" fill="none" stroke="#1e2a44" stroke-width="' + f(2.6) + '" stroke-linecap="round"/>';
    } else {
      o += '<g class="eyes">';
      [-14, 14].forEach(function (ex) {
        o += '<ellipse cx="' + X(ex) + '" cy="' + Y(-2) + '" rx="' + f(5.6) + '" ry="' + f(6.6) + '" fill="#1e2a44"/>' +
          '<circle cx="' + X(ex + 1.9) + '" cy="' + Y(-4.6) + '" r="' + f(1.9) + '" fill="#fff"/>';
      });
      o += '</g>';
    }
    o += '<ellipse cx="' + X(-25) + '" cy="' + Y(9) + '" rx="' + f(6) + '" ry="' + f(3.4) + '" fill="#ff9fb4" opacity=".35"/><ellipse cx="' + X(25) + '" cy="' + Y(9) + '" rx="' + f(6) + '" ry="' + f(3.4) + '" fill="#ff9fb4" opacity=".35"/>';
    o += '<path d="M' + X(-4) + ',' + Y(6) + ' Q' + X(0) + ',' + Y(4) + ' ' + X(4) + ',' + Y(6) + ' Q' + X(2) + ',' + Y(10) + ' ' + X(0) + ',' + Y(10.5) + ' Q' + X(-2) + ',' + Y(10) + ' ' + X(-4) + ',' + Y(6) + ' Z" fill="#f2849f" stroke="#1e2a44" stroke-width="' + f(1.6) + '" stroke-linejoin="round"/>';
    o += '<path d="M' + X(0) + ',' + Y(10.5) + ' Q' + X(-3) + ',' + Y(15) + ' ' + X(-7) + ',' + Y(13) + ' M' + X(0) + ',' + Y(10.5) + ' Q' + X(3) + ',' + Y(15) + ' ' + X(7) + ',' + Y(13) + '" fill="none" stroke="#1e2a44" stroke-width="' + f(1.8) + '" stroke-linecap="round"/>';
    o += '<path d="M' + X(-16) + ',' + Y(9) + ' L' + X(-44) + ',' + Y(5) + ' M' + X(-16) + ',' + Y(12) + ' L' + X(-43) + ',' + Y(14) + ' M' + X(16) + ',' + Y(9) + ' L' + X(44) + ',' + Y(5) + ' M' + X(16) + ',' + Y(12) + ' L' + X(43) + ',' + Y(14) + '" stroke="#1e2a44" stroke-width="' + f(1.1) + '" stroke-linecap="round" opacity=".75"/>';
    return o;
  }
  function pamTail(d, w) {
    return '<g class="tail"><path d="' + d + '" fill="none" stroke="#1e2a44" stroke-width="' + (w + 5) + '" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="' + PAM.fur + '" stroke-width="' + w + '" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="' + PAM.stripe + '" stroke-width="' + w + '" stroke-dasharray="4 6" stroke-linecap="butt" opacity=".85"/></g>';
  }
  // ül, szemből: a panel nagy képe és a térképen az üldögélő póz (origó: a lába közepe)
  function pamSit() {
    var o = pamTail('M22,-6 C52,-4 58,-36 42,-58 C38,-63 32,-60 35,-55', 9);
    o += '<g class="breath"><path d="M-30,-6 Q-34,-40 -18,-54 Q0,-62 18,-54 Q34,-40 30,-6 Q0,2 -30,-6 Z" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="3.2" stroke-linejoin="round"/>' +
      '<path d="M-14,-6 Q-18,-30 0,-40 Q18,-30 14,-6 Z" fill="' + PAM.belly + '"/>' +
      '<path d="M-26,-36 L-18,-34 M-28,-24 L-19,-23 M26,-36 L18,-34 M28,-24 L19,-23" stroke="' + PAM.stripe + '" stroke-width="2.6" stroke-linecap="round"/></g>';
    o += '<ellipse cx="-11" cy="-3" rx="10" ry="7" fill="' + PAM.belly + '" stroke="#1e2a44" stroke-width="2.6"/><ellipse cx="11" cy="-3" rx="10" ry="7" fill="' + PAM.belly + '" stroke="#1e2a44" stroke-width="2.6"/>' +
      '<path d="M-14,-5 L-14,-1 M-9,-5 L-9,-1 M9,-5 L9,-1 M14,-5 L14,-1" stroke="#1e2a44" stroke-width="1.4" stroke-linecap="round"/>';
    o += '<g class="gpaw"><ellipse cx="14" cy="-58" rx="8" ry="6" fill="' + PAM.belly + '" stroke="#1e2a44" stroke-width="2.4"/></g>';
    o += '<g class="head">' + pamHead(0, -84, 1) + '</g>';
    return o;
  }
  // sétál, oldalt (jobbra néz; a tükrözést a menetirány adja)
  function pamWalk() {
    var o = '<g class="stretchw">' + pamTail('M-24,-24 C-42,-30 -46,-54 -34,-64 C-30,-67 -26,-63 -29,-59', 8);
    o += '<g class="body">';
    [['lB', -17], ['lA', -8], ['lA', 9], ['lB', 18]].forEach(function (l) { o += '<rect class="' + l[0] + '" x="' + (l[1] - 4) + '" y="-14" width="8.5" height="15" rx="4" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="2.4"/>'; });
    o += '<path d="M-28,-14 Q-30,-34 -6,-35 L14,-35 Q32,-34 30,-14 Q0,-6 -28,-14 Z" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M-16,-34 Q-14,-26 -16,-17 M-6,-35 Q-4,-26 -6,-15 M4,-35 Q6,-26 4,-15" fill="none" stroke="' + PAM.stripe + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<g class="head">' + pamHead(24, -52, 0.62) + '</g></g></g>';
    return o;
  }
  // alszik: összegömbölyödve, a farka körbeér, Zzz
  function pamSleep() {
    var o = '<g class="snore"><ellipse cx="0" cy="-14" rx="34" ry="17" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="3"/>' +
      '<path d="M-20,-28 Q-18,-20 -20,-12 M-8,-30 Q-6,-20 -8,-8 M4,-30 Q6,-20 4,-9" fill="none" stroke="' + PAM.stripe + '" stroke-width="2.6" stroke-linecap="round"/>' +
      pamTail('M-30,-6 C-20,6 22,6 34,-6', 8) +
      '<g class="head">' + pamHead(16, -26, 0.55, true) + '</g></g>';
    ['a', 'b'].forEach(function (c, i) { o += '<text class="zz ' + c + '" x="' + (34 + i * 7) + '" y="' + (-46 - i * 6) + '" font-family="Quest Display,Lilita One, sans-serif" font-size="16" fill="#fff7e6" stroke="#1e2a44" stroke-width="3" paint-order="stroke">z</text>'; });
    return o;
  }
  function buildCat(g) {
    g.innerHTML = '<g class="pose p-walk">' + pamWalk() + '</g><g class="pose p-sit">' + pamSit() + '</g><g class="pose p-sleep">' + pamSleep() + '</g>' +
      '<g class="yarn"><g class="yb"><circle cx="0" cy="-9" r="9" fill="#ff7aa8" stroke="#1e2a44" stroke-width="2.4"/><path d="M-7,-13 Q0,-6 7,-14 M-8,-7 Q0,-1 8,-8 M-3,-17 Q2,-9 -2,-1" fill="none" stroke="#c94f7c" stroke-width="1.6"/></g><path class="ythr" d="M-8,-4 Q-24,4 -40,-2" fill="none" stroke="#ff7aa8" stroke-width="2"/></g>' +
      '<g class="bubble"><rect x="-58" y="-188" width="116" height="34" rx="14" fill="#fffdf7" stroke="#1e2a44" stroke-width="3"/><path d="M-6,-155 L0,-144 L8,-155" fill="#fffdf7" stroke="#1e2a44" stroke-width="3" stroke-linejoin="round"/><text class="bt" x="0" y="-165" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="900" font-size="17" fill="#1e2a44">Miaú?</text></g>' +
      '<g class="alert"><g><circle cx="0" cy="-142" r="14" fill="#ffe066" stroke="#1e2a44" stroke-width="3"/><text x="0" y="-135" text-anchor="middle" font-family="Quest Display,Lilita One, sans-serif" font-size="20" fill="#1e2a44">!</text></g></g>' +
      '<g class="dust"><ellipse cx="-34" cy="-4" rx="12" ry="7"/><ellipse cx="34" cy="-4" rx="12" ry="7"/><ellipse cx="-18" cy="2" rx="9" ry="5"/><ellipse cx="20" cy="2" rx="9" ry="5"/></g>' +
      '<title>Pamutka, a tanácsadó macska</title>';
  }
  // a panel nagy képe
  function pamHero() {
    var h = $('pamhero'); if (!h || h.getAttribute('data-ok')) return;
    h.setAttribute('data-ok', '1');
    var ic = document.querySelector('.ip-char'); if (ic) ic.innerHTML = '<svg viewBox="-50 -58 100 92">' + pamHead(0, 0, 1) + '</svg>';
    h.addEventListener('click', catClick);
    h.innerHTML = '<svg viewBox="-80 -150 160 160" aria-hidden="true"><ellipse cx="0" cy="2" rx="52" ry="9" fill="#1e2a44" opacity=".15"/><g class="cat-hero">' + pamSit() + '</g></svg>';
  }
  function catRoomAt(fl, x, y) {
    var id = null;
    S.FLOORS[fl].rooms.forEach(function (r) { if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d) id = r.id; });
    return id;
  }
  // Pamutka viselkedése: sétál (az útvonalon előre vagy visszafelé), és útközben véletlenszerűen elalszik
  // (sokat és bárhol), mosakszik, nyújtózkodik, a pamutgombolyagával játszik, vagy nyávog egyet.
  var MEOWS = ['Miaú?', 'Nyaú!', 'Éhes vagyok…', 'Simogass meg!', 'Hol a pamutom?', 'Miaú, miaú!', 'Nem én voltam!', 'Ez az én helyem.', 'Nyííí…'];
  function pickAction(here, tag) {
    if (cat.goal && here === cat.goal) return ['sit', 9000];
    var r = Math.random();
    if (tag === 'sleep' && r < 0.7) return ['sleep', 12000 + Math.random() * 16000];
    if (r > 0.42) return null;                                      // továbbmegy
    r = Math.random();
    if (r < 0.45) return ['sleep', 8000 + Math.random() * 16000];   // sokat alszik, bárhol
    if (r < 0.58) return ['groom', 3600];
    if (r < 0.7) return ['stretch', 2300];
    if (r < 0.84) return ['yarn', 5200];
    return ['meow', 2600];
  }
  function startAction(a, text) {
    cat.mode = a[0]; cat.wait = a[1];
    if (text && layer.cat) { setBubble(text); if (a[0] === 'meow' || a[0] === 'sit') { cat.mode = a[0]; if (a[0] === 'sit') showBubble(); return; } }
    if (a[0] === 'meow' && layer.cat) {
      var tg = target(), cold = st.devs.some(function (d) { var r = st.latest[d.pink]; var t = r && r.online !== false && d.role === 'thermo' && d.room !== 'erkely' ? temp(r.status) : null; return t != null && t < tg - 1.5; });
      var txt = cold && Math.random() < 0.5 ? 'Fázom, fűts be!' : MEOWS[Math.floor(Math.random() * MEOWS.length)];
      setBubble(txt);
    }
    if (Math.random() < 0.3) cat.dir = -cat.dir;                    // néha visszafordul
  }
  // séta: lágy gyorsulás és lassulás, fordulás (a tükrözés átfordul, nem ugrik), a lenti lépcsőn fokról
  // fokra felfelé (a magasság a lépcsőfokokat követi), a tetején ívben felugrik az emeletre; lefelé
  // leugrik a lépcső tetejére, és lesétál a fokokon.
  function catScreen(fl, x, y, z) { var P = scene.floors[fl].proj.P; return P(x, y, z == null ? S.stairZ(fl, x, y) : z); }
  function catStep(ts) {
    if (POV.p) { cat.last = ts; requestAnimationFrame(catStep); return; }   // a Porszívó-szem alatt a babaház áll (GPU/CPU spórolás)
    var dt = Math.min(100, ts - (cat.last || ts)); cat.last = ts;
    var R = S.CAT_ROUTE, n = R.length, k = uiK();
    if (catDrag.on) {                                  // kézben: a mutató alatt lóg, az árnyéka a padlón
      var hp = catDrag.p; cat.sp = [hp[0], hp[1] + 26 * k]; cat.mode = 'held'; cat.tilt = Math.sin(ts / 160) * 8;
    } else if (cat.drop) {                             // elengedve: leesik és huppan
      var D = cat.drop; D.t = Math.min(1, D.t + dt / D.dur); var ee = D.t * D.t;
      cat.sp = [D.a[0] + (D.b[0] - D.a[0]) * ee, D.a[1] + (D.b[1] - D.a[1]) * ee]; cat.mode = 'held'; cat.tilt = 0;
      if (D.t >= 1) { cat.drop = null; cat.sp = null; cat.v = 0; cat.mode = 'thud'; cat.wait = 650; cat.next = [['sit', 2200], LANDS[Math.floor(Math.random() * LANDS.length)]]; saveCat(); }
    } else if (cat.jump) {                                   // ugrás két szint között (képernyő-ív)
      var J = cat.jump; J.t = Math.min(1, J.t + dt / J.dur);
      var a = catScreen(J.f0, J.x0, J.y0), b = catScreen(J.f1, J.x1, J.y1), e = J.t;
      var px = a[0] + (b[0] - a[0]) * e, py = a[1] + (b[1] - a[1]) * e - Math.sin(Math.PI * e) * (60 + Math.abs(b[1] - a[1]) * 0.15) * k;
      cat.face = b[0] >= a[0] ? 1 : -1; cat.tilt = (b[1] < a[1] ? -1 : 1) * 16 * (1 - 2 * Math.abs(e - 0.5)) * (e < 0.5 ? 1 : -0.6);
      cat.sp = [px, py]; cat.mode = 'jump';
      if (J.t >= 1) { cat.jump = null; cat.fl = J.f1; cat.x = J.x1; cat.y = J.y1; cat.i = J.ni; cat.v = 0; cat.mode = 'land'; cat.wait = 260; cat.tilt = 0; cat.sp = null; }
    } else if (cat.wait > 0) {
      cat.wait -= dt;
      if (cat.wait <= 0 && cat.next) { var nx0 = cat.next; cat.next = cat.after || null; cat.after = null; startAction(nx0[0], nx0[1]); }
      else if (cat.wait <= 0 && cat.mode !== 'walk') { cat.mode = 'walk'; cat.v = 0; }
    } else {
      var ni = (cat.i + cat.dir + n) % n, nx = R[ni];
      if (nx[0] !== cat.fl) {                         // szintváltás: ugrás
        cat.jump = { f0: cat.fl, x0: cat.x, y0: cat.y, f1: nx[0], x1: nx[1], y1: nx[2], ni: ni, t: 0, dur: 950 };
      } else {
        var dx = nx[1] - cat.x, dy = nx[2] - cat.y, d = Math.hypot(dx, dy);
        var onStairs = S.stairZ(cat.fl, cat.x, cat.y) > 0, vmax = onStairs ? 0.45 : 0.72;
        cat.v = Math.min(vmax, (cat.v || 0) + dt / 1000 * 1.6);          // gyorsul
        if (d < 0.35) cat.v = Math.max(0.18, Math.min(cat.v, d * 2.2));  // a pont előtt lassul
        var sp = cat.v * dt / 1000;
        if (d <= sp) {
          cat.x = nx[1]; cat.y = nx[2]; cat.i = ni;
          var act = nx[3] === 'stairtop' ? null : pickAction(catRoomAt(cat.fl, cat.x, cat.y), nx[3]);
          if (act) { startAction(act); cat.v = 0; } else cat.mode = 'walk';
        } else {
          cat.x += dx / d * sp; cat.y += dy / d * sp; cat.mode = 'walk';
          var p0 = catScreen(cat.fl, cat.x, cat.y), p1 = catScreen(cat.fl, nx[1], nx[2]);
          if (Math.abs(p1[0] - p0[0]) > 1.5) cat.face = p1[0] > p0[0] ? 1 : -1;
          cat.tilt = onStairs ? (p1[1] < p0[1] ? -10 : 10) * (p1[0] > p0[0] ? 1 : -1) : 0;
        }
      }
    }
    cat.fs = (cat.fs == null ? cat.face : cat.fs) + (cat.face - (cat.fs == null ? cat.face : cat.fs)) * Math.min(1, dt / 110);
    cat.fade = Math.min(1, cat.fade + dt / 600);
    if (layer.cat && scene) {
      var p = cat.sp || catScreen(cat.fl, cat.x, cat.y), g = layer.cat;
      g.setAttribute('transform', 'translate(' + r1(p[0]) + ',' + r1(p[1]) + ') scale(' + r1(0.62 * k * 100) / 100 + ')');
      g.setAttribute('opacity', r1(cat.fade));
      var cv = st.floor === 'both' || cat.fl === st.floor || catDrag.on; if ((g.style.display === 'none') === cv) g.style.display = cv ? '' : 'none';
      var cls = (cat.mode === 'jump' || cat.mode === 'land' ? 'walk ' + cat.mode : cat.mode) + (cat.goal && cat.mode !== 'held' && cat.mode !== 'wake' ? ' has-tip' : '') + (cat.talkUntil > Date.now() ? ' talk' : '');
      if (layer.drop) { var sh = catDrag.on && catDrag.land; layer.drop.setAttribute('opacity', sh ? '0.22' : '0'); if (sh) { layer.drop.setAttribute('cx', r1(catDrag.land.s[0])); layer.drop.setAttribute('cy', r1(catDrag.land.s[1])); layer.drop.setAttribute('rx', r1(26 * k)); layer.drop.setAttribute('ry', r1(8 * k)); } }
      if (g.getAttribute('class') !== cls) g.setAttribute('class', cls);
      var walkPose = g.querySelector('.p-walk');
      var fsx = Math.abs(cat.fs) < 0.08 ? (cat.fs < 0 ? -0.08 : 0.08) : cat.fs;
      if (walkPose) walkPose.setAttribute('transform', 'scale(' + Math.round(fsx * 100) / 100 + ',1) rotate(' + r1(cat.tilt || 0) + ')');
    }
    requestAnimationFrame(catStep);
  }
  // A szövegbuborék a szöveghez méreteződik (hosszabbnál két sorba tör), így semmi nem lóg ki belőle.
  var measCtx = null;
  function textW(t) {
    try { measCtx = measCtx || document.createElement('canvas').getContext('2d'); measCtx.font = '900 17px Nunito, sans-serif'; return measCtx.measureText(t).width; }
    catch (e) { return t.length * 9.6; }
  }
  function setBubble(text) {
    var g = layer.cat && layer.cat.querySelector('.bubble'); if (!g) return;
    var bt = g.querySelector('.bt'), rc = g.querySelector('rect'), lines = [text], w = textW(text);
    if (w > 230) {                                    // két sor, a szóközök mentén a közepéhez legközelebb
      var best = -1, half = text.length / 2;
      text.replace(/ /g, function (m, i) { if (best < 0 || Math.abs(i - half) < Math.abs(best - half)) best = i; return m; });
      if (best > 0) lines = [text.slice(0, best), text.slice(best + 1)];
    }
    w = Math.max.apply(null, lines.map(textW));
    var W = Math.max(84, Math.ceil(w) + 30), H = 16 + lines.length * 20;
    rc.setAttribute('x', -W / 2); rc.setAttribute('width', W); rc.setAttribute('y', -154 - H); rc.setAttribute('height', H);
    bt.textContent = '';
    lines.forEach(function (ln, i) { var ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan'); ts.setAttribute('x', 0); ts.setAttribute('y', -154 - H + 23 + i * 20); ts.textContent = ln; bt.appendChild(ts); });
  }
  function showBubble() { cat.talkUntil = Date.now() + 2600; placeBubble(); }
  // a buborék helye: a macska fölött, vagy mellette jobbra/balra, ahol a legkevesebb feliratot takarja
  function placeBubble() {
    var g = layer.cat && layer.cat.querySelector('.bubble'), rc = g && g.querySelector('rect'); if (!rc) return;
    var m = /translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+)\)/.exec(layer.cat.getAttribute('transform') || ''); if (!m) return;
    var px = +m[1], py = +m[2], sc = +m[3], x = +rc.getAttribute('x'), y = +rc.getAttribute('y'), W = +rc.getAttribute('width'), H = +rc.getAttribute('height');
    var cands = [[0, 0], [0, -30], [W / 2 + 46, 70], [-(W / 2 + 46), 70], [W / 2 + 46, 20], [-(W / 2 + 46), 20], [0, -70]], bi = 0, bc = Infinity;
    cands.forEach(function (c, i) {
      var b = [px + (x + c[0]) * sc, py + (y + c[1]) * sc, px + (x + c[0] + W) * sc, py + (y + c[1] + H) * sc], cost = 0;
      (st.obst || []).forEach(function (o) { var ox = Math.min(b[2], o[2]) - Math.max(b[0], o[0]), oy = Math.min(b[3], o[3]) - Math.max(b[1], o[1]); if (ox > 0 && oy > 0) cost += ox * oy; });
      if (cost < bc - 1) { bc = cost; bi = i; }
    });
    var c = cands[bi];
    g.setAttribute('transform', 'translate(' + c[0] + ',' + c[1] + ')');
    var tail = g.querySelector('path'); if (tail) tail.style.display = c[0] ? 'none' : '';
  }
  var LANDS = ['Hopp!', 'Huh, megvagyok!', 'Ez jó hely lesz.', 'Miaú! Legközelebb szólj!', 'Puff!'];
  // Megfogás: ha útban van (egy eszköz vagy bútor előtt), fogd meg és tedd arrébb. Lóg a kezedben,
  // elengedve leesik, huppan, összeszedi magát, aztán onnan sétál tovább.
  var catDrag = { on: false, p: null, land: null, start: null, id: null, justDropped: false };
  function toWorld(cx, cy) {
    var m = world.getScreenCTM(); if (!m) return null;
    var pt = world.createSVGPoint(); pt.x = cx; pt.y = cy; var q = pt.matrixTransform(m.inverse()); return [q.x, q.y];
  }
  function planAt(fl, sx, sy) { var pr = scene.floors[fl].proj, o = pr.P(0, 0, 0); return pr.unproject(sx - o[0], sy - o[1]); }
  // hová huppanna: előbb a felső szint szobái (ott rajzolódik felül), aztán a lenti; különben a legközelebbi útpont
  function landingAt(sx, sy) {
    var fls = ['up', 'lo'];
    for (var i = 0; i < fls.length; i++) {
      var m = planAt(fls[i], sx, sy);
      if (catRoomAt(fls[i], m[0], m[1])) return { fl: fls[i], x: m[0], y: m[1], s: catScreen(fls[i], m[0], m[1]) };
    }
    var R = S.CAT_ROUTE, best = null;
    R.forEach(function (r) { var q = catScreen(r[0], r[1], r[2]), d = Math.hypot(q[0] - sx, q[1] - sy); if (!best || d < best.d) best = { d: d, fl: r[0], x: r[1], y: r[2], s: q }; });
    return best;
  }
  function catDown(e) {
    if (e.button != null && e.button > 0) return;
    e.stopPropagation();                               // ne a térkép mozduljon
    catDrag.start = [e.clientX, e.clientY]; catDrag.id = e.pointerId; catDrag.on = false;
    window.addEventListener('pointermove', catMove); window.addEventListener('pointerup', catUp); window.addEventListener('pointercancel', catUp);
  }
  function catMove(e) {
    if (e.pointerId !== catDrag.id || !catDrag.start) return;
    if (!catDrag.on && Math.hypot(e.clientX - catDrag.start[0], e.clientY - catDrag.start[1]) < 7) return;
    if (!catDrag.on) { catDrag.on = true; cat.jump = null; cat.drop = null; cat.next = null; cat.after = null; cat.wait = 0; setBubble(['Miaú! Tegyél le!', 'Hé! Hová viszel?', 'Nyaú, magasan vagyok!'][Math.floor(Math.random() * 3)]); world.classList.add('catgrab'); }
    e.preventDefault();
    var p = toWorld(e.clientX, e.clientY); if (!p) return;
    var k = uiK(); catDrag.p = p; catDrag.land = landingAt(p[0], p[1] + 56 * k);
  }
  function catUp(e) {
    if (e.pointerId !== catDrag.id) return;
    window.removeEventListener('pointermove', catMove); window.removeEventListener('pointerup', catUp); window.removeEventListener('pointercancel', catUp);
    var was = catDrag.on; catDrag.on = false; catDrag.start = null; world.classList.remove('catgrab');
    if (!was) return;                                  // sima koppintás: a click esemény intézi (ébresztés)
    catDrag.justDropped = true; setTimeout(function () { catDrag.justDropped = false; }, 400);
    var L = catDrag.land || landingAt(catDrag.p[0], catDrag.p[1] + 56 * uiK()), k = uiK();
    cat.fl = L.fl; cat.x = L.x; cat.y = L.y; cat.v = 0;
    // a legközelebbi útpont felé megy tovább (onnan, ahol letetted)
    var R = S.CAT_ROUTE, n = R.length, bi = 0, bd = 1e9;
    R.forEach(function (r, i) { if (r[0] !== L.fl) return; var d = Math.hypot(r[1] - L.x, r[2] - L.y); if (d < bd) { bd = d; bi = i; } });
    cat.i = (bi - cat.dir + n) % n;
    cat.drop = { a: [catDrag.p[0], catDrag.p[1] + 26 * k], b: catScreen(L.fl, L.x, L.y), t: 0, dur: 260 };
  }
  function catClick() {
    if (cat.mode === 'sleep') {                           // koppintásra felébred: nyújtózik, aztán nyávog egyet
      cat.jump = null; cat.sp = null; cat.v = 0;
      startAction(['wake', 1500]);                      // felriad: kinyitja a szemét, felpattan, megrázza magát
      cat.next = [['stretch', 1700], null];
      cat.after = [['meow', 2600], 'Mrrr… ébren vagyok!'];
      return;
    }
    var t = tips();
    toast(t.length ? 'Pamutka: ' + t[0][0].replace(/<[^>]+>/g, '') : 'Pamutka: miaú, minden rendben, dorombolok.', t.length ? '' : 'ok');
    $('pam').classList.remove('mini');
  }

  // ---- Kapcsolás és időzítés (supabase/functions/control, 010_control.sql) ----------------------------
  // A: az eszköz kártyáján kapcsoló, gyors időzítők, szabályok; B: Kapcsolók blokk jelenetekkel (Áttekintés
  // panel, telefonon az Eszközök lap teteje); C: heti időzítő lap. Belépés nélkül demó: csak a térkép változik.
  var CTL_PINKS = ['C2', 'C3', 'C5', 'C4', 'C6', 'C7', 'C8', 'C1'], CTL_CONFIRM = { C1: true };
  var SCENES = [
    { id: 'esti', n: 'Esti hangulat', d: 'TV led, dupla lámpa, tükör', set: [['C3', true], ['C2', true], ['C5', true]] },
    { id: 'film', n: 'Filmezés', d: 'csak a TV led', set: [['C3', true], ['C2', false], ['C5', false]] },
    { id: 'unnep', n: 'Ünnep', d: 'karácsonyfa, szarvas, erkély', set: [['C6', true], ['C7', true], ['C8', true]] },
    { id: 'le', n: 'Minden le', d: 'minden lámpa KI', set: [['C3', false], ['C2', false], ['C5', false], ['C4', false], ['C6', false], ['C7', false], ['C8', false]] }
  ];
  var DAYS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  st.ctl = { rules: [], timers: [], missing: false, busy: {}, ask: null };
  function devOf(p) { return st.devs.filter(function (d) { return d.pink === p; })[0] || DEFAULT_DEVS.filter(function (d) { return d.pink === p; })[0] || { pink: p, label: p }; }
  function shortName(p) { return devOf(p).label.replace(/ \(.*\)$/, ''); }
  function plugOn(p) { var r = st.latest[p]; return !!(r && r.online !== false && isOn(r.status)); }
  function plugOnline(p) { var r = st.latest[p]; return !!(r && r.online !== false); }
  function hm(min) { min = ((min % 1440) + 1440) % 1440; return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2); }
  function sunMin(kind) { if (!SUN) return kind === 'sunset' ? 16 * 60 : 7 * 60; var t = SUN.times(Date.now(), LAT, LON), d = new Date(kind === 'sunset' ? t.set : t.rise); return d.getHours() * 60 + d.getMinutes(); }
  function ruleWhen(r) {
    if (r.kind === 'time') return hm(r.minute) + '-kor';
    var base = r.kind === 'sunset' ? 'napnyugta' : 'napkelte', m = r.minute;
    return m === 0 ? base + 'kor' : base + (m < 0 ? ' előtt ' + (-m) : ' után ' + m) + ' perccel';
  }
  function ruleDays(d) { if (d === 127) return 'minden nap'; if (d === 31) return 'hétköznap'; if (d === 96) return 'hétvégén'; return DAYS.filter(function (x, i) { return d & (1 << i); }).join(', '); }
  function ruleMinute(r) { return r.kind === 'time' ? r.minute : sunMin(r.kind) + r.minute; }

  function loadControl() {
    if (!sb || !st.user || st.role === 'share') return;
    var miss = function (e) { return e && (e.code === 'PGRST205' || e.code === '42P01'); };
    Promise.all([
      sb.from('control_rules').select('id,pink,action,kind,minute,days,enabled').order('created_at', { ascending: true }),
      sb.from('control_timers').select('id,pink,action,due_at,label').order('due_at', { ascending: true })
    ]).then(function (r) {
      st.ctl.missing = miss(r[0].error) || miss(r[1].error);
      st.ctl.rules = r[0].error ? [] : r[0].data || []; st.ctl.timers = r[1].error ? [] : r[1].data || [];
      ctlRender();
    }, function () {});
  }
  function ctlRender() { showInfo(); overview(); schedRender(); if (!$('devsheet').hidden) list(); }

  function callControl(body) {
    if (!sb || !st.user) return Promise.resolve({ ok: true, demo: true });
    return sb.auth.getSession().then(function (r) {
      var tok = r && r.data && r.data.session && r.data.session.access_token;
      return fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Authorization: 'Bearer ' + tok }, body: JSON.stringify(body)
      }).then(function (x) { return x.json().catch(function () { return { ok: false, error: 'HTTP ' + x.status }; }); });
    }).catch(function () { return { ok: false, error: 'a kapcsolás nem érhető el (hálózat)' }; });
  }
  function setLocal(p, on) {
    var r = st.latest[p] = st.latest[p] || { online: true, status: {} }, s = r.status = Object.assign({}, r.status || {});
    if ('switch' in s && !('switch_1' in s)) s.switch = on; else s.switch_1 = on;
    if (!on) s.cur_power = 0;
  }
  function switchPlug(p, on, confirmed) {
    if (!confirmed) { st.ctl.ask = { p: p, on: on }; ctlRender(); return; }   // minden kapcsolás megerősítéssel (2026.11.20)
    st.ctl.ask = null; st.ctl.busy[p] = true; ctlRender();
    callControl({ action: 'switch', pink: p, on: on, confirm: !!confirmed }).then(function (res) {
      st.ctl.busy[p] = false;
      if (res && res.ok) { setLocal(p, on); toast(shortName(p) + (on ? ' bekapcsolva' : ' kikapcsolva') + (res.demo ? ' (demó: belépve tényleg kapcsol)' : ''), 'ok'); }
      else toast(shortName(p) + ': ' + ((res && res.error) || 'nem sikerült') + (st.ctl.missing ? ' (a kapcsolás még nincs telepítve)' : ''), 'err');
      render(); drawOverlay();
    });
  }
  function runScene(sc) {
    st.ctl.busy.scene = sc.id; overview(); list();
    toast(sc.n + ': ' + sc.set.length + ' eszköz, egyenként 3 mp-es szünettel…', '');
    if (!sb || !st.user) { sc.set.forEach(function (x) { setLocal(x[0], x[1]); }); st.ctl.busy.scene = null; render(); drawOverlay(); toast(sc.n + ' kész (demó)', 'ok'); return; }
    callControl({ action: 'scene', items: sc.set }).then(function (res) {
      st.ctl.busy.scene = null;
      var good = (res && res.results || []).filter(function (x) { return x[1]; });
      good.forEach(function (x) { var w = sc.set.filter(function (y) { return y[0] === x[0]; })[0]; if (w) setLocal(w[0], w[1]); });
      toast(res && res.ok ? sc.n + ': ' + good.length + '/' + sc.set.length + ' kész' : sc.n + ': ' + ((res && res.error) || 'nem sikerült'), res && res.ok && good.length === sc.set.length ? 'ok' : 'err');
      render(); drawOverlay();
    });
  }
  // ---- időpontok: a következő kapcsolás, emberi szöveg ----
  var WDN = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  function whenText(d) {
    var now = new Date(), t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    var dd = Math.round((new Date(d).setHours(0, 0, 0, 0) - t0) / 864e5), h = hm(d.getHours() * 60 + d.getMinutes());
    return (dd === 0 ? 'ma' : dd === 1 ? 'holnap' : WDN[d.getDay()]) + ' ' + h;
  }
  function sunAt(kind, dayMs) { if (!SUN) return null; var t = SUN.times(dayMs, LAT, LON); var x = kind === 'sunset' ? t.set : t.rise; return x ? new Date(x) : null; }
  function ruleNext(r, from) {
    from = from || new Date();
    for (var i = 0; i < 8; i++) {
      var day = new Date(from); day.setHours(12, 0, 0, 0); day.setDate(day.getDate() + i);
      var bit = 1 << ((day.getDay() + 6) % 7);
      if (!(r.days & bit)) continue;
      var at;
      if (r.kind === 'time') { at = new Date(day); at.setHours(0, r.minute, 0, 0); }
      else { var sa = sunAt(r.kind, day.getTime()); if (!sa) continue; at = new Date(sa.getTime() + r.minute * 60000); at.setSeconds(0, 0); }
      if (at > from) return at;
    }
    return null;
  }
  function ruleSentence(r, short) {
    var days = r.days === 127 ? 'Minden nap' : r.days === 31 ? 'Hétköznap' : r.days === 96 ? 'Hétvégén' : ruleDays(r.days);
    return (short ? days.toLowerCase() : days) + ' ' + ruleWhen(r) + ' ' + (r.action === 'on' ? 'bekapcsol' : 'kikapcsol');
  }
  function nextEvent(p) {
    var best = null;
    st.ctl.timers.forEach(function (t) { if (t.pink !== p) return; var at = new Date(t.due_at); if (at > new Date() && (!best || at < best.at)) best = { at: at, on: t.action === 'on', why: 'egyszeri' }; });
    st.ctl.rules.forEach(function (r) { if (r.pink !== p || !r.enabled) return; var at = ruleNext(r); if (at && (!best || at < best.at)) best = { at: at, on: r.action === 'on', why: ruleSentence(r, true) }; });
    return best;
  }
  function presetsFor(p) {
    if (p === 'C1') return [{ id: 'm', t: 'Hétköznap reggel 5:30-kor BE', r: { action: 'on', kind: 'time', minute: 330, days: 31 } },
      { id: 'n', t: 'Hétköznap 8:00-kor KI', r: { action: 'off', kind: 'time', minute: 480, days: 31 } }];
    return [{ id: 'e', t: 'Minden nap napnyugtakor BE', r: { action: 'on', kind: 'sunset', minute: 0, days: 127 } },
      { id: 'n', t: 'Minden nap 23:00-kor KI', r: { action: 'off', kind: 'time', minute: 1380, days: 127 } }];
  }
  function sameRule(a, b) { return a.pink === b.pink && a.action === b.action && a.kind === b.kind && a.minute === b.minute && a.days === b.days; }
  function findRule(p, r) { return st.ctl.rules.filter(function (x) { return sameRule(x, Object.assign({ pink: p }, r)); })[0]; }

  function addTimer(p, action, due, label) {
    var dup = st.ctl.timers.filter(function (t) { return t.pink === p && t.action === action && Math.abs(new Date(t.due_at) - due) < 90000; })[0];
    if (dup) { toast('Ez az egyszeri időzítő már be van állítva: ' + whenText(due) + ' ' + (action === 'on' ? 'BE' : 'KI') + '.', ''); return Promise.resolve(); }
    var msg = shortName(p) + ': egyszer, ' + whenText(due) + '-kor ' + (action === 'on' ? 'bekapcsol' : 'kikapcsol') + '.';
    if (!sb || !st.user) { st.ctl.timers.push({ id: 'demo' + Date.now(), pink: p, action: action, due_at: due.toISOString(), label: label }); ctlRender(); toast(msg + ' (demó)', 'ok'); return Promise.resolve(); }
    return sb.from('control_timers').insert({ pink: p, action: action, due_at: due.toISOString(), label: label }).then(function (r) {
      if (r.error) toast('Az időzítő nem menthető' + (st.ctl.missing ? ' (a kapcsolás még nincs telepítve)' : ''), 'err'); else toast(msg, 'ok');
      loadControl();
    });
  }
  function quick(p, kind) {
    var now = new Date();
    if (kind === 'on1h') { switchPlug(p, true, CTL_CONFIRM[p] ? true : false); addTimer(p, 'off', new Date(now.getTime() + 3600e3), 'KI 1 óra múlva'); }
    else if (kind === 'off23') { var t = new Date(now); t.setHours(23, 0, 0, 0); if (t <= now) t.setDate(t.getDate() + 1); addTimer(p, 'off', t, 'KI 23:00-kor'); }
    else if (kind === 'onsunset') { var s = sunAt('sunset', Date.now()) || new Date(now.getTime() + 3600e3); if (s <= now) s = sunAt('sunset', Date.now() + 864e5); addTimer(p, 'on', s, 'BE napnyugtakor'); }
  }
  function saveRule(p, r) {
    r = Object.assign({ pink: p, enabled: true }, r);
    var ex = findRule(p, r);
    if (ex) { toast('Ez az ütemezés már megvan: ' + ruleSentence(ex) + '.', ''); if (!ex.enabled) ruleOp(ex.id, 'tog'); return; }
    var nx = ruleNext(r), msg = 'Ütemezve: ' + ruleSentence(r) + '.' + (nx ? ' Először: ' + whenText(nx) + '.' : '');
    if (!sb || !st.user) { r.id = 'demo' + Date.now(); st.ctl.rules.push(r); ctlRender(); toast(msg + ' (demó)', 'ok'); return; }
    sb.from('control_rules').insert(r).then(function (x) { if (x.error) toast('Az ütemezés nem menthető' + (st.ctl.missing ? ' (a kapcsolás még nincs telepítve)' : ''), 'err'); else toast(msg, 'ok'); loadControl(); });
  }
  function addRule(p, action, whenKey, days, timeStr) {
    var r = { action: action, kind: 'time', minute: 0, days: days };
    if (whenKey === 'sunset') r.kind = 'sunset'; else if (whenKey === 'sunset-15') { r.kind = 'sunset'; r.minute = -15; } else if (whenKey === 'sunrise') r.kind = 'sunrise';
    else { var m = /^(\d{1,2}):(\d{2})$/.exec(timeStr || ''); if (!m) { toast('Adj meg időpontot (ÓÓ:PP).', 'err'); return; } r.minute = Math.min(1439, +m[1] * 60 + +m[2]); }
    saveRule(p, r);
  }
  function togglePreset(p, id) {
    var pr = presetsFor(p).filter(function (x) { return x.id === id; })[0]; if (!pr) return;
    var ex = findRule(p, pr.r);
    if (ex && ex.enabled) { ruleOp(ex.id, 'del'); toast('Kikapcsolva: ' + ruleSentence(ex) + '.', ''); } else saveRule(p, pr.r);
  }
  function ruleOp(id, op) {
    var r = st.ctl.rules.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    if (!sb || !st.user) { if (op === 'del') st.ctl.rules = st.ctl.rules.filter(function (x) { return x !== r; }); else r.enabled = !r.enabled; ctlRender(); return; }
    var q = op === 'del' ? sb.from('control_rules').delete().eq('id', id) : sb.from('control_rules').update({ enabled: !r.enabled }).eq('id', id);
    q.then(function () { loadControl(); });
  }
  function timerDel(id) {
    if (!sb || !st.user) { st.ctl.timers = st.ctl.timers.filter(function (x) { return x.id !== id; }); ctlRender(); return; }
    sb.from('control_timers').delete().eq('id', id).then(function () { loadControl(); });
  }

  function swHtml(p, big) {
    var on = plugOn(p), busy = st.ctl.busy[p], off = !plugOnline(p) && st.live;
    if (!canCtl()) return '<span class="cro' + (on ? ' on' : '') + '">' + (on ? 'BE' : 'KI') + '</span>';
    return '<button class="csw' + (big ? ' big' : '') + (busy ? ' busy' : '') + '" role="switch" aria-checked="' + on + '" data-ctl="sw" data-p="' + p + '"' + (off ? ' disabled title="Az eszköz offline"' : '') + ' aria-label="' + esc(shortName(p)) + ' kapcsoló"></button>';
  }
  function askHtml(p) {
    var a = st.ctl.ask; if (!a || a.p !== p) return '';
    var q = p === 'C1' ? 'Biztos? A bojler adja a fenti meleg vizet.' : (a.on ? 'Bekapcsolod: ' : 'Kikapcsolod: ') + esc(shortName(p)) + '?';
    return '<div class="ask">' + q + ' <button class="btn sm y" data-ctl="yes">Igen, ' + (a.on ? 'BE' : 'KI') + '</button><button class="btn sm" data-ctl="no">Mégse</button></div>';
  }
  function rulesHtml(rules, withName, empty) {
    if (!rules.length) return empty == null ? '<div class="none">Nincs ismétlődő ütemezés.</div>' : empty;
    return '<ul class="rl">' + rules.map(function (r) {
      var nx = r.enabled ? ruleNext(r) : null;
      return '<li class="' + (r.enabled ? '' : 'dis') + '"><span class="t">' + (withName ? '<b>' + esc(shortName(r.pink)) + ':</b> ' : '') + esc(ruleSentence(r)) +
        '<small>' + (r.enabled ? (nx ? 'következő: ' + whenText(nx) : '') : 'szünetel') + '</small></span>' +
        '<button class="mini" data-ctl="rtog" data-id="' + r.id + '">' + (r.enabled ? 'Szünet' : 'Folytat') + '</button><button class="mini" data-ctl="rdel" data-id="' + r.id + '" aria-label="Ütemezés törlése">✕</button></li>';
    }).join('') + '</ul>';
  }
  function addFormHtml(p, withDev) {
    return '<form class="radd" data-ctl="radd"' + (p ? ' data-p="' + p + '"' : '') + '>' +
      (withDev ? '<select name="p" aria-label="Eszköz">' + CTL_PINKS.map(function (x) { return '<option value="' + x + '">' + esc(shortName(x)) + '</option>'; }).join('') + '</select>' : '') +
      '<select name="d" aria-label="Mely napokon"><option value="127">Minden nap</option><option value="31">Hétköznap</option><option value="96">Hétvégén</option></select>' +
      '<select name="w" aria-label="Mikor"><option value="time">ekkor:</option><option value="sunset-15">15 perccel napnyugta előtt</option><option value="sunset">napnyugtakor</option><option value="sunrise">napkeltekor</option></select>' +
      '<input name="t" type="time" value="22:30" aria-label="Időpont">' +
      '<select name="a" aria-label="Mit tegyen"><option value="on">kapcsoljon BE</option><option value="off">kapcsoljon KI</option></select>' +
      '<button class="btn sm y" type="submit">Ütemezés mentése</button></form>';
  }
  // A: az eszköz kártyáján: most, következő kapcsolás, egyszeri, ismétlődő
  function nextHtml(p) {
    var n = nextEvent(p);
    return '<div class="nxt">' + (n ? 'Következő kapcsolás: <b>' + whenText(n.at) + ' ' + (n.on ? 'BE' : 'KI') + '</b><small>' + esc(n.why) + '</small>' : 'Nincs ütemezett kapcsolás.') + '</div>';
  }
  function controlCard(d) {
    if (CTL_PINKS.indexOf(d.pink) < 0) return '';
    var p = d.pink, timers = st.ctl.timers.filter(function (t) { return t.pink === p && new Date(t.due_at) > new Date(Date.now() - 60000); }).sort(function (a, b) { return new Date(a.due_at) - new Date(b.due_at); });
    var rules = st.ctl.rules.filter(function (r) { return r.pink === p; }), pres = presetsFor(p);
    if (!canCtl()) return '<div class="ctl"><div class="ctlrow"><span class="nowst ' + (plugOn(p) ? 'on' : '') + '">' + (plugOn(p) ? 'BEKAPCSOLVA' : 'KIKAPCSOLVA') + '</span></div>' +
      (st.role === 'share' ? '' : nextHtml(p) + (rules.length ? '<div class="sec"><div class="sub">Ütemezés <small>minden héten ismétlődik</small></div><ul class="rl">' + rules.map(function (r) { return '<li class="' + (r.enabled ? '' : 'dis') + '"><span class="t">' + esc(ruleSentence(r)) + '<small>' + (r.enabled ? '' : 'szünetel') + '</small></span></li>'; }).join('') + '</ul></div>' : '')) +
      '<div class="ctln">' + roClause() + '</div></div>';
    return '<div class="ctl">' + (st.ctl.missing ? '<div class="ctln"><span class="soon">MÉG NINCS TELEPÍTVE</span></div>' : '') +
      '<div class="ctlrow"><span class="nowst ' + (plugOn(p) ? 'on' : '') + '">' + (st.ctl.busy[p] ? 'Kapcsol…' : plugOn(p) ? 'BEKAPCSOLVA' : 'KIKAPCSOLVA') + '</span>' + swHtml(p, true) + '</div>' + askHtml(p) + nextHtml(p) +
      '<div class="sec"><div class="sub">Egyszeri <small>csak egyszer fut le</small></div>' +
      '<div class="ctlq"><button class="btn sm" data-ctl="q" data-k="on1h" data-p="' + p + '">BE most, 1 óra múlva KI</button><button class="btn sm" data-ctl="q" data-k="off23" data-p="' + p + '">KI ma 23:00-kor</button>' + (p === 'C1' ? '' : '<button class="btn sm" data-ctl="q" data-k="onsunset" data-p="' + p + '">BE ma napnyugtakor</button>') + '</div>' +
      (timers.length ? '<ul class="rl">' + timers.map(function (t) { return '<li><span class="t">' + whenText(new Date(t.due_at)) + ' ' + (t.action === 'on' ? 'BE' : 'KI') + '<small>egyszeri</small></span><button class="mini" data-ctl="tdel" data-id="' + t.id + '" aria-label="Időzítő törlése">✕</button></li>'; }).join('') + '</ul>' : '') + '</div>' +
      '<div class="sec"><div class="sub">Ütemezés <small>minden héten ismétlődik, magától</small></div>' +
      '<div class="pres">' + pres.map(function (pr) { var ex = findRule(p, pr.r), on = !!(ex && ex.enabled); return '<button class="pre' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" data-ctl="pre" data-p="' + p + '" data-id="' + pr.id + '"><span class="ck">' + (on ? '✓' : '+') + '</span>' + esc(pr.t) + '</button>'; }).join('') + '</div>' +
      rulesHtml(rules.filter(function (r) { return !(r.enabled && pres.some(function (pr) { return sameRule(r, Object.assign({ pink: p }, pr.r)); })); }), false, '') +
      '<details class="own"><summary>Saját ütemezés…</summary>' + addFormHtml(p) + '</details></div>' +
      (CTL_CONFIRM[p] ? '<div class="ctln">A bojlert kézzel csak megerősítéssel lehet kapcsolni.</div>' : '') + '</div>';
  }
  // B: Vezérlőpult (2026.11.20): szűrő (Mind / Lent / Fent / Most ég), jelenetek, szobánként csempék.
  // Minden kapcsolás előtt megerősítés a csempén (a tulaj kérése); a ⋯ a teljes adatlapot nyitja.
  // a lépcső fényei (C4) a Vezérlőpulton saját „Lépcső” csoportban (a tulaj, 2026.11.21), a térképen az étkezőben
  var VP_GROUP = { C4: 'lepcso_lent' };
  var VP_LO = ['nappali', 'etkezo', 'lepcso_lent', 'halo', 'konyha', 'eloszoba', 'furdo_lent', 'erkely'], VP_UP = ['eloter', 'furdo_fent', 'kagylo', 'gyerek', 'lepcso_fent'];
  var SCN_ICON = { esti: 'lamp', film: 'film', unnep: 'star', le: 'power' };
  st.vp = { f: null, ask: null };
  function vpFilter() { return st.vp.f || (st.floor === 'both' ? 'all' : st.floor); }
  function robOn(p) { var r = st.latest[p]; return !!(r && r.online !== false && r.status && r.status.cleaning); }
  // ---- Porszívó-szem: 3D nézet (szimulált kép) a pov/ oldalon, iframe-ben; csak megnyitáskor jön létre
  var POV = { p: null, opener: null, f: null, DKEY: 'o2b.povNo' };
  function povNoGet() { try { return JSON.parse(sessionStorage.getItem(POV.DKEY) || '{}') || {}; } catch (e) { return {}; } }
  function povNoSet(o) { try { sessionStorage.setItem(POV.DKEY, JSON.stringify(o)); } catch (e) {} }
  function robKnown(p) { var r = st.latest[p]; return !!(r && r.status); }
  function povRunning() { return ['R1', 'R2'].filter(function (p) { return devOf(p) && robOn(p); }); }
  function povData(p) {
    var d = devOf(p), s = (st.latest[p] && st.latest[p].status) || {};
    return { type: 'pov-data', p: p, name: robName(p), state: s.state || '', stateTxt: d ? devState(d).txt : '', cleaning: robOn(p),
      battery: typeof s.battery === 'number' ? s.battery : null, area_m2: s.area_m2 != null && isFinite(+s.area_m2) ? +s.area_m2 : null, minutes: s.minutes != null && isFinite(+s.minutes) ? +s.minutes : null };
  }
  function povSend() {
    if (!POV.p || !POV.f || !POV.f.contentWindow) return;
    try { POV.f.contentWindow.postMessage(povData(POV.p), location.origin); } catch (e) {}
  }
  // ?povlite=1 a dashboard címében: a tesztek könnyített 3D-t kérnek (az éles nézetet nem érinti)
  function povSrc(p) { return 'pov/index.html?r=' + p + (/[?&]povlite=1/.test(location.search) ? '&lite=1' : ''); }
  function povOpen(p, opener) {
    if (!p || POV.p) { if (p && POV.p && p !== POV.p) { POV.p = p; POV.f.src = povSrc(p); } return; }
    POV.p = p; POV.opener = opener || document.activeElement;
    var no = povNoGet(); no[p] = 1; povNoSet(no);
    var box = $('povbox'), f = document.createElement('iframe');
    f.title = 'Porszívó-szem: ' + robName(p) + ' (szimulált 3D kép)'; f.setAttribute('allow', 'fullscreen'); f.setAttribute('referrerpolicy', 'no-referrer');
    f.src = povSrc(p); f.addEventListener('load', povSend);
    box.appendChild(f); POV.f = f; $('povov').hidden = false; document.body.classList.add('povon');
    var x = $('b-povx'); if (x) x.focus();
    povSync();
  }
  function povClose() {
    if (!POV.p) return;
    var f = POV.f, op = POV.opener; POV.p = null; POV.f = null; POV.opener = null;
    if (f) { try { f.src = 'about:blank'; } catch (e) {} f.remove(); }
    $('povov').hidden = true; $('povbox').innerHTML = ''; document.body.classList.remove('povon');
    if (op && op.focus && document.contains(op)) try { op.focus(); } catch (e) {}
  }
  // a futó robotokról szóló kártya és csempe; elutasítás: robotonként, amíg az le nem áll és újra nem indul
  function povSync() {
    var no = povNoGet(), ch = false;
    ['R1', 'R2'].forEach(function (p) { if (no[p] && robKnown(p) && !robOn(p)) { delete no[p]; ch = true; } });
    if (ch) povNoSet(no);
    var run = povRunning(), ask = run.filter(function (p) { return !no[p]; }), box = $('povask');
    if (box) {
      if (!ask.length || POV.p) box.hidden = true;
      else {
        box.hidden = false; box.setAttribute('data-for', ask.join(','));
        $('povtx').textContent = ask.length > 1 ? 'R1 és R2 is takarít most · Megnézed a szemükkel?' : ask[0] + ' takarít most · Megnézed a szemével?';
        var go = $('povgo'); go.innerHTML = ''; go.setAttribute('data-p', ask[0]);
        ask.forEach(function (p) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm y'; b.setAttribute('data-povgo', p); b.textContent = ask.length > 1 ? 'Megnézem: ' + p : 'Megnézem'; go.appendChild(b); });
        var n = document.createElement('button'); n.type = 'button'; n.className = 'btn sm'; n.id = 'b-povno'; n.textContent = 'Most nem'; go.appendChild(n);
      }
    }
    var c = $('c-pov');
    if (c) {
      if (!run.length) c.hidden = true;
      else { c.hidden = false; var p0 = run[0]; c.setAttribute('data-p', p0); c.querySelector('.cv').textContent = run.map(function (p) { return p + ' takarít'; }).join(' · '); }
    }
    povSend();
  }
  function povDismiss() {
    var no = povNoGet(); ($('povask').getAttribute('data-for') || '').split(',').forEach(function (p) { if (p) no[p] = 1; });
    povNoSet(no); $('povask').hidden = true;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-pov],[data-povgo],#b-povno,#b-povx,#b-povaskx,#c-pov'); if (!t) return;
    e.stopPropagation();
    if (t.id === 'b-povx') { povClose(); return; }
    if (t.id === 'b-povno' || t.id === 'b-povaskx') { povDismiss(); return; }
    var p = t.getAttribute('data-pov') || t.getAttribute('data-povgo') || t.getAttribute('data-p');
    povOpen(p, t); if ($('povask')) povSync();
  }, true);
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !POV.f || e.source !== POV.f.contentWindow) return;
    var m = e.data; if (!m) return;
    if (m.type === 'pov-close') povClose(); else if (m.type === 'pov-ready') povSend();
  });
  // Esc: előbb a Porszívó-szem, aztán a kártya (gépelés közben is)
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (POV.p) { e.preventDefault(); e.stopImmediatePropagation(); povClose(); return; }
    if ($('povask') && !$('povask').hidden) { povDismiss(); }
  }, true);
  function vpDevs() {
    return CTL_PINKS.concat(['R1', 'R2']).filter(function (p) { return !hideOff(p) && devOf(p).room; });
  }
  function vpSub(p) {
    var d = devOf(p);
    if (d.role === 'robot') return devState(d).txt;
    if (!plugOnline(p) && st.live) return 'offline';
    var r = st.latest[p], w = r ? watts(r.status) : null, n = st.role === 'share' ? null : nextEvent(p);
    var a = plugOn(p) ? (w ? fmt(w, 0) + ' W' : 'BE') : 'KI';
    if (p === 'C1' && plugOn(p)) a = w && w > 500 ? 'fűt · ' + fmt(w / 1000, 1) + ' kW' : 'felfűtve, tart';
    return a + (n ? ' · köv. ' + whenText(n.at).replace(/^ma /, '') + ' ' + (n.on ? 'BE' : 'KI') : '');
  }
  function vpAskHtml(p) {
    var d = devOf(p), on = d.role === 'robot' ? robOn(p) : plugOn(p), q, sm, yes, r = st.latest[p], w = r ? watts(r.status) : null;
    if (d.role === 'robot') { q = on ? 'Szüneteltessem a takarítást?' : 'Indítsam a takarítást?'; sm = on ? 'Ott áll meg, ahol van.' : 'Végigmegy a szinten, utána hazamegy.'; yes = on ? 'Szünet' : 'Indítás'; }
    else if (p === 'C1') { q = on ? 'Kikapcsolod a bojlert?' : 'Bekapcsolod a bojlert?'; sm = on ? 'A fenti meleg víz lassan lehűl.' : '1,8 kW, kb. 110 Ft/óra a felfűtésig.'; yes = on ? 'Kikapcsolom' : 'Bekapcsolom'; }
    else { q = (on ? 'Kikapcsolod?' : 'Bekapcsolod?'); sm = shortName(p) + (on && w ? ', most ' + fmt(w, 0) + ' W' : ''); yes = on ? 'Kikapcsolom' : 'Bekapcsolom'; }
    return '<div class="vpask" role="alertdialog" aria-label="Megerősítés"><p>' + esc(q) + '<small>' + esc(sm) + '</small></p><div class="row"><button type="button" class="btn sm no" data-vp="no">Mégse</button><button type="button" class="btn sm ' + (p === 'C1' && on ? 'warn' : 'y') + '" data-vp="yes" data-p="' + p + '">' + esc(yes) + '</button></div></div>';
  }
  function vpTile(p, ro) {
    var d = devOf(p), isR = d.role === 'robot', on = isR ? robOn(p) : plugOn(p), off = isR ? !(st.latest[p] && st.latest[p].online !== false) && st.live : !plugOnline(p) && st.live;
    var busy = isR ? !!(st.rob.cmd[p] && /queued|running/.test(st.rob.cmd[p].status)) : st.ctl.busy[p];
    var cls = off ? ' off' : on ? (isR ? ' run' : ' on') : '', stt = off ? 'OFFLINE' : busy ? 'KAPCSOL…' : isR ? (on ? 'TAKARÍT' : 'DOKKBAN') : on ? 'BE' : 'KI';
    var nm = isR ? robName(p) : shortName(p);
    var asking = !!(st.vp.ask && st.vp.ask.k === 'p' && st.vp.ask.p === p);
    return '<div class="vtile' + cls + (asking ? ' asking' : '') + '" role="button" tabindex="0" data-vp="' + (ro || off ? 'more' : 'tile') + '" data-p="' + p + '" aria-label="' + esc(nm + ': ' + stt + (ro ? '' : ', koppints a kapcsoláshoz')) + '">' +
      '<div class="tr"><span class="ic"><svg aria-hidden="true"><use href="#pi-' + pinIcon(d) + '"/></svg></span><span class="stt">' + stt + '</span>' +
      '<button type="button" class="more" data-vp="more" data-p="' + p + '" aria-label="' + esc(nm) + ' adatlapja" title="Adatlap: időzítés, ütemezés, napló"><svg aria-hidden="true"><use href="#pi-dots"/></svg></button></div>' +
      '<div class="nm">' + esc(nm) + '</div><div class="sb">' + esc(vpSub(p)) + '</div>' +
      (st.vp.ask && st.vp.ask.k === 'p' && st.vp.ask.p === p ? vpAskHtml(p) : '') + '</div>';
  }
  function switchesHtml() {
    var ro = !canCtl(), f = vpFilter(), all = vpDevs(), h = '';
    var tabs = [['all', 'Mind'], ['lo', 'Lent'], ['up', 'Fent'], ['on', 'Most ég']];
    h += '<div class="ovs vp"><div class="ovh">VEZÉRLÉS' + (ro ? '' : ' <button class="mini lnk" data-ctl="sched">Heti időzítő</button>') + '</div>' +
      (st.ctl.missing && !ro ? '<div class="ctln">A kapcsolás még nincs telepítve (Actions: Kapcsolás telepítése).</div>' : '') +
      '<div class="vptabs" role="group" aria-label="Szűrő">' + tabs.map(function (t) { return '<button type="button" data-vp="f" data-f="' + t[0] + '" aria-pressed="' + (f === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (!ro) {
      h += '<div class="vpscn">' + SCENES.map(function (sc) { return '<button type="button" class="vsc s-' + sc.id + (st.ctl.busy.scene === sc.id ? ' busy' : '') + '" data-vp="scene" data-id="' + sc.id + '" title="' + esc(sc.d) + '"><span class="ib"><svg aria-hidden="true"><use href="#pi-' + (SCN_ICON[sc.id] || 'star') + '"/></svg></span>' + esc(sc.n) + '</button>'; }).join('') + '</div>';
      var as = st.vp.ask && st.vp.ask.k === 'scene' ? SCENES.filter(function (x) { return x.id === st.vp.ask.id; })[0] : null;
      if (as) h += '<div class="vpask wide" role="alertdialog" aria-label="Megerősítés"><p>' + esc(as.n) + '?<small>' + esc(as.set.map(function (x) { return shortName(x[0]) + ' ' + (x[1] ? 'BE' : 'KI'); }).join(', ')) + '. Egyenként, 3 mp-es szünettel.</small></p><div class="row"><button type="button" class="btn sm no" data-vp="no">Mégse</button><button type="button" class="btn sm y" data-vp="syes" data-id="' + as.id + '">Indítás</button></div></div>';
    }
    var rooms = (f === 'up' ? [] : VP_LO).concat(f === 'lo' ? [] : VP_UP), n = 0;
    rooms.forEach(function (rid) {
      var ps = all.filter(function (p) { return (VP_GROUP[p] || devOf(p).room) === rid && (f !== 'on' || (devOf(p).role === 'robot' ? robOn(p) : plugOn(p))); });
      if (!ps.length) return; n += ps.length;
      var rt = rid === 'lepcso_lent' ? null : roomTemp(rid), up = VP_UP.indexOf(rid) >= 0;
      h += '<div class="vproom"><div class="vrh">' + esc(rid === 'lepcso_lent' ? 'Lépcső' : ROOM_NAMES[rid] || rid) + ' <small>' + (up ? 'fent' : 'lent') + '</small>' + (rt && rt.t != null ? '<span class="t ' + rt.c + '">' + fmt(rt.t) + '°</span>' : '') + '</div><div class="vtiles">' + ps.map(function (p) { return vpTile(p, ro); }).join('') + '</div></div>';
    });
    if (!n) h += '<div class="ctln">' + (f === 'on' ? 'Most semmi nem ég, és a robotok pihennek.' : 'Ezen a szinten nincs kapcsolható eszköz.') + '</div>';
    if (f !== 'on') {
      var acs = st.devs.filter(function (d) { return d.role === 'ac_ir' && (f === 'all' || (f === 'up') === (VP_UP.indexOf(d.room) >= 0)); });
      if (acs.length) h += '<button type="button" class="vpac" data-vp="more" data-p="' + acs[0].pink + '"><span class="ic"><svg aria-hidden="true"><use href="#pi-snow"/></svg></span><span>' + acs.length + ' klíma: télen nem fűtünk vele<small>csak nyári hűtés · ' + esc(acs.map(function (d) { return ROOM_NAMES[d.room]; }).join(', ')) + '</small></span><b aria-hidden="true">›</b></button>';
    }
    if (ro) h += '<div class="ctln">' + roClause() + '</div>';
    return h + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-vp]') : null; if (!b) return;
    var k = b.getAttribute('data-vp'), p = b.getAttribute('data-p');
    e.stopPropagation();
    if (k === 'f') { st.vp.f = b.getAttribute('data-f'); st.vp.ask = null; overview(); list(); return; }
    if (k === 'more') { st.vp.ask = null; select(p); return; }
    if (!canCtl()) { toast(roClause(), ''); return; }
    if (k === 'tile') { st.vp.ask = st.vp.ask && st.vp.ask.p === p ? null : { k: 'p', p: p }; overview(); list(); var t = document.querySelector('.vtile[data-p="' + p + '"] [data-vp="yes"]'); if (t) t.focus(); return; }
    if (k === 'scene') { var id = b.getAttribute('data-id'); st.vp.ask = st.vp.ask && st.vp.ask.id === id ? null : { k: 'scene', id: id }; overview(); list(); return; }
    if (k === 'no') { st.vp.ask = null; overview(); list(); return; }
    if (k === 'syes') { var sc = SCENES.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; st.vp.ask = null; if (sc && !st.ctl.busy.scene) runScene(sc); else { overview(); list(); } return; }
    if (k === 'yes') {
      st.vp.ask = null;
      if (devOf(p).role === 'robot') robSend(p, robOn(p) ? 'pause' : 'start');
      else switchPlug(p, !plugOn(p), true);
      overview(); list();
    }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('vtile')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape' && st.vp.ask) { st.vp.ask = null; overview(); list(); }
  });
  // ---- robotporszívók vezérlése (014_robot_cmd.sql): a parancs a sorba kerül, az adatgyűjtő 10 mp-enként
  // felveszi és továbbítja a gyártói felhőnek (f27/robots.py watch). Csak a tulaj és a családtag küldhet.
  var RCMD = { start: 'Takarítás indul', pause: 'Szünet', dock: 'Haza a dokkba', find: 'Hol vagy? (hangjelzés)', rooms: 'Szobatakarítás' };
  // szobák a robot saját térképéről (015_robot_rooms.sql): [[szegmens, név], ...]; demóban kitalált lista
  var DEMO_ROOMS = { R2: [[16, 'Előtér'], [17, 'Kagyló szoba'], [18, 'Gyerekszoba'], [19, 'Fürdő']] };
  function robRooms(p) {
    var s = (st.latest[p] && st.latest[p].status) || {};
    if (Array.isArray(s.rooms) && s.rooms.length) return s.rooms;
    return !st.user ? (DEMO_ROOMS[p] || []) : [];
  }
  var PART_NAMES = { main_brush: 'Főkefe', side_brush: 'Oldalkefe', filter: 'Szűrő', sensor: 'Szenzorok (tisztítás)' };
  var DEMO_PARTS = { R1: { main_brush: 62, side_brush: 35, filter: 8 }, R2: { main_brush: 71, side_brush: 44, filter: 52, sensor: 12 } };
  function robParts(p) {
    var s = (st.latest[p] && st.latest[p].status) || {};
    return s.parts && typeof s.parts === 'object' ? s.parts : (!st.user ? DEMO_PARTS[p] || null : null);
  }
  function partsHtml(p) {
    var pt = robParts(p); if (!pt) return '';
    var ks = Object.keys(PART_NAMES).filter(function (k) { return typeof pt[k] === 'number'; }); if (!ks.length) return '';
    return '<div class="sub">Kopóalkatrészek <small>(hátralévő élet)</small></div><div class="rparts">' + ks.map(function (k) {
      var v = pt[k], c = v <= 10 ? 'bad' : v <= 25 ? 'warn' : 'ok';
      return '<div class="rpart ' + c + '"><span>' + PART_NAMES[k] + '</span><i><b style="width:' + v + '%"></b></i><em>' + v + '%' + (v <= 10 ? ' · csere' : v <= 25 ? ' · hamarosan' : '') + '</em></div>';
    }).join('') + '</div>';
  }
  // késleltetett és időzített indítás (017_robot_timer.sql; a tulaj kérése 2026.11.21): egész lakás vagy a kijelölt
  // szobák, 1 perc és 7 nap között, robotonként legfeljebb 3; az adatgyűjtő 10 mp-en belül indítja
  function tmLoad(p) {
    if (!sb || !st.user) { st.rob.tm[p] = st.rob.tm[p] || []; return; }
    if (st.rob.tmAt[p] && Date.now() - st.rob.tmAt[p] < 60000) return;
    st.rob.tmAt[p] = Date.now();
    sb.from('robot_cmd').select('id,cmd,args,due_at').eq('pink', p).eq('kind', 'timer').eq('status', 'queued').order('due_at', { ascending: true }).then(function (r) {
      st.rob.tm[p] = r.error ? null : (r.data || []).filter(function (x) { return Date.parse(x.due_at) > Date.now() - 15 * 60000; });
      if (r.error && /kind|due_at|42703/.test(r.error.message || '')) st.rob.tm[p] = 'missing';
      showInfo();
    });
  }
  function tmWhen(t) {
    var d = new Date(t), now = new Date(), tom = new Date(now); tom.setDate(now.getDate() + 1);
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2), mins = Math.round((t - Date.now()) / 60000);
    var day = d.toDateString() === now.toDateString() ? 'ma' : d.toDateString() === tom.toDateString() ? 'holnap' : (d.getMonth() + 1) + '.' + ('0' + d.getDate()).slice(-2) + '.';
    return day + ' ' + hm + (mins > 0 && mins < 24 * 60 ? ' (' + (mins < 60 ? mins + ' perc' : Math.floor(mins / 60) + ' óra' + (mins % 60 ? ' ' + mins % 60 + ' perc' : '')) + ' múlva)' : '');
  }
  function tmWhat(p, x) {
    if (x.cmd !== 'rooms') return 'egész lakás';
    var nm = {}; robRooms(p).forEach(function (r) { nm[r[0]] = r[1]; });
    return (x.args || []).map(function (id) { return nm[id] || ('szoba ' + id); }).join(', ');
  }
  function timerHtml(p, has) {
    tmLoad(p);
    var list = st.rob.tm[p], sel = st.rob.sel[p] || [], ask = st.rob.tmAsk && st.rob.tmAsk.p === p ? st.rob.tmAsk : null;
    var h = '<div class="sub">Időzített indítás</div>';
    if (list === 'missing') return h + '<div class="ctln">Az időzítés még nincs telepítve (017_robot_timer.sql).</div>';
    var dis = !has || (Array.isArray(list) && list.length >= 3) ? ' disabled' : '';
    h += '<div class="rtm"><div class="rtm-what">' + (sel.length ? 'Kijelölt szobák: <b>' + esc(tmWhat(p, { cmd: 'rooms', args: sel })) + '</b>' : 'Egész lakás <small>(fent jelölhetsz ki szobákat)</small>') + '</div>' +
      '<div class="ctlq">' + [[30, '+30 perc'], [60, '+1 óra'], [120, '+2 óra'], [240, '+4 óra']].map(function (x) { return '<button type="button" class="btn sm" data-rob="tmq" data-p="' + p + '" data-min="' + x[0] + '"' + dis + '>' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="rtm-at"><label for="tm-' + p + '">Időpontban</label><input type="time" id="tm-' + p + '" value="' + (st.rob.tmVal && st.rob.tmVal[p] || '') + '"' + dis + '><button type="button" class="btn sm" data-rob="tmat" data-p="' + p + '"' + dis + '>Beállítom</button><small>ha már elmúlt, holnap</small></div></div>';
    if (ask) h += '<div class="ask">Induljon <b>' + esc(tmWhen(ask.t)) + '</b>: ' + esc(ask.args ? tmWhat(p, { cmd: 'rooms', args: ask.args }) : 'egész lakás') + '? <button type="button" class="btn sm y" data-rob="tmyes" data-p="' + p + '">Igen, időzítem</button><button type="button" class="btn sm" data-rob="tmno" data-p="' + p + '">Mégse</button></div>';
    if (Array.isArray(list) && list.length) h += '<div class="rtm-list">' + list.map(function (x) { return '<div class="rtm-row"><span><b>' + esc(tmWhen(Date.parse(x.due_at))) + '</b> · ' + esc(tmWhat(p, x)) + '</span><button type="button" class="btn ib sm" data-rob="tmdel" data-p="' + p + '" data-id="' + x.id + '" aria-label="Időzítő törlése">✕</button></div>'; }).join('') + '</div>';
    else if (Array.isArray(list)) h += '<div class="ctln">Nincs időzített indítás.</div>';
    return h;
  }
  function tmSend(p, t, args) {
    var row = { id: 'd' + Date.now(), cmd: args ? 'rooms' : 'start', args: args || null, due_at: new Date(t).toISOString() };
    if (!sb || !st.user) { st.rob.tm[p] = (st.rob.tm[p] || []).concat([row]).sort(function (a, b) { return Date.parse(a.due_at) - Date.parse(b.due_at); }); showInfo(); toast(robName(p) + ': időzítve ' + tmWhen(t) + ' (demó)', 'ok'); return; }
    var q = { p_pink: p, p_cmd: row.cmd, p_due: row.due_at }; if (args) q.p_args = args;
    sb.rpc('robot_cmd_enqueue', q).then(function (res) {
      if (res.error) { toast(robName(p) + ': ' + robErr(res.error), 'err'); return; }
      st.rob.tmAt[p] = 0; tmLoad(p); toast(robName(p) + ': időzítve ' + tmWhen(t), 'ok');
    });
  }
  function roomsHtml(p, pend, has) {
    var rs = robRooms(p), sel = st.rob.sel[p] || [], dreame = (devOf(p).label || '').indexOf('Dreame') >= 0;
    if (!rs.length) return '<div class="sub">Szobák</div><div class="ctln">' + (dreame ? 'A Dreame szobái a Térképen már látszanak; a szobánkénti indítás nála még nem megy, egész lakásra indul.' :
      'A robot még nem küldte el a szobáit (az adatgyűjtő a következő körben kéri le a térképéről).') + '</div>';
    var names = {}; rs.forEach(function (r) { names[r[0]] = r[1] || ('Szoba ' + r[0]); });
    return '<div class="sub">Szobák <small>(a robot saját térképéről)</small></div><div class="rrooms" role="group" aria-label="Szobák kijelölése">' +
      rs.map(function (r) { var on = sel.indexOf(r[0]) >= 0; return '<button type="button" class="rroom' + (on ? ' on' : '') + '" data-rob="pick" data-p="' + p + '" data-seg="' + r[0] + '" aria-pressed="' + on + '"' + (pend || !has ? ' disabled' : '') + '>' + (on ? '✓ ' : '') + esc(names[r[0]]) + '</button>'; }).join('') + '</div>' +
      (st.rob.ask === p + ':rooms' ? '<div class="ask">Takarítsa ezeket: <b>' + esc(sel.map(function (x) { return names[x]; }).join(', ')) + '</b>? <button type="button" class="btn sm y" data-rob="ryes" data-p="' + p + '">Igen, indulhat</button><button type="button" class="btn sm" data-rob="no" data-p="' + p + '">Mégse</button></div>' :
        '<div class="ctlq"><button type="button" class="btn sm y" data-rob="rooms" data-p="' + p + '"' + (pend || !has || !sel.length ? ' disabled' : '') + '>' + (sel.length ? 'Kijelöltek takarítása (' + sel.length + ')' : 'Jelölj ki szobát') + '</button>' +
        (sel.length ? '<button type="button" class="btn sm" data-rob="clear" data-p="' + p + '">Kijelölés törlése</button>' : '') + '</div>');
  }
  var RST = { queued: 'elküldve, az adatgyűjtő pár másodpercen belül továbbítja…', running: 'a robot megkapta, végrehajtja…', done: 'kész',
    error: 'nem sikerült', expired: 'lejárt (az adatgyűjtő nem vette fel 3 percen belül)' };
  st.rob = { cmd: {}, ask: null, sel: {}, tm: {}, tmAt: {} };
  function robHas(p) { var r = st.latest[p]; return !st.user || !!(r && r.ts); }
  function robotCard(d) {
    if (d.role !== 'robot' || st.role === 'share') return '';
    if (!canCtl()) return '<div class="ctl"><div class="ctln">' + roClause() + '</div></div>';
    var p = d.pink, c = st.rob.cmd[p], s = (st.latest[p] && st.latest[p].status) || {};
    var pend = !!(c && (c.status === 'queued' || c.status === 'running')), has = robHas(p);
    function btn(k, label, y) { return '<button type="button" class="btn sm' + (y ? ' y' : '') + '" data-rob="' + k + '" data-p="' + p + '"' + (pend || !has ? ' disabled' : '') + '>' + label + '</button>'; }
    return '<div class="ctl rob"><div class="sub">Vezérlés</div><div class="ctlq">' +
      (s.cleaning ? btn('pause', 'Szünet', true) : btn('start', 'Indítás', true)) + btn('dock', 'Haza a dokkba') + btn('find', 'Hol vagy?') + '</div>' +
      (st.rob.ask === p ? '<div class="ask">Biztosan elindítod a takarítást? <button type="button" class="btn sm y" data-rob="yes" data-p="' + p + '">Igen, indulhat</button><button type="button" class="btn sm" data-rob="no" data-p="' + p + '">Mégse</button></div>' : '') +
      roomsHtml(p, pend, has) + timerHtml(p, has) + partsHtml(p) +
      (c ? '<div class="rst ' + c.status + '" role="status"><b>' + esc(RCMD[c.cmd]) + ':</b> ' + esc(RST[c.status] || c.status) + (c.note ? '<small>' + esc(c.note) + '</small>' : '') + '</div>' : '') +
      '<div class="ctln">' + (has ? 'A parancsot az adatgyűjtő továbbítja, általában 10-20 mp alatt. Egyszerre egy parancs mehet.' : 'Ehhez a robothoz még nincs belépés (Actions: Robotok bejelentkezése).') + '</div></div>';
  }
  function robLocal(p, k) {
    var r = st.latest[p] = st.latest[p] || { online: true, status: {} }, s = r.status = Object.assign({}, r.status || {});
    if (k === 'start' || k === 'rooms') { s.state = 'cleaning'; s.cleaning = true; } else if (k === 'pause') { s.state = 'paused'; s.cleaning = false; }
    else if (k === 'dock') { s.state = 'returning'; s.cleaning = true; }
  }
  function robErr(e) {
    var m = (e && (e.message || e.code)) || '';
    if (/PGRST202|robot_cmd_enqueue/.test(m) && /not find|could not|schema cache/i.test(m)) return 'a robotvezérlés még nincs telepítve (014_robot_cmd.sql)';
    return m.slice(0, 120) || 'nem sikerült';
  }
  function robName(p) { var d = st.devs.filter(function (x) { return x.pink === p; })[0]; return d ? d.label.replace(/^Robotporszívó /, 'Robot ').replace(/ \(.*\)$/, '') : p; }
  function robSend(p, k, args) {
    st.rob.cmd[p] = { cmd: k, status: 'queued' }; showInfo();
    if (!sb || !st.user) {                                   // demó: csak eljátsszuk
      setTimeout(function () { var c = st.rob.cmd[p]; if (c) { c.status = 'running'; showInfo(); } }, 700);
      setTimeout(function () { var c = st.rob.cmd[p]; if (!c) return; c.status = 'done'; robLocal(p, k); render(); showInfo(); toast(robName(p) + ': ' + RCMD[k] + ' (demó: belépve tényleg vezérel)', 'ok'); }, 1600);
      return;
    }
    sb.rpc('robot_cmd_enqueue', args ? { p_pink: p, p_cmd: k, p_args: args } : { p_pink: p, p_cmd: k }).then(function (res) {
      var c = st.rob.cmd[p]; if (!c) return;
      if (res.error) { c.status = 'error'; c.note = robErr(res.error); showInfo(); toast(robName(p) + ': ' + c.note, 'err'); return; }
      c.id = res.data; robPoll(p, c.id, Date.now());
    });
  }
  function robPoll(p, id, t0) {
    setTimeout(function () {
      var c = st.rob.cmd[p]; if (!c || c.id !== id || !sb || !st.user) return;
      sb.from('robot_cmd').select('status,note').eq('id', id).maybeSingle().then(function (r) {
        if (c !== st.rob.cmd[p]) return;
        if (r.data) { c.status = r.data.status; c.note = r.data.note; }
        if (c.status === 'queued' || c.status === 'running') {
          if (Date.now() - t0 < 200000) robPoll(p, id, t0); else { c.status = 'expired'; }
          showInfo(); return;
        }
        showInfo();
        toast(robName(p) + ': ' + RCMD[c.cmd] + ' · ' + (RST[c.status] || c.status), c.status === 'done' ? 'ok' : 'err');
        if (c.status === 'done') { robLocal(p, c.cmd); render(); setTimeout(load, 8000); }
      });
    }, 3000);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-rob]') : null; if (!b || b.disabled) return;
    e.stopPropagation();
    var k = b.getAttribute('data-rob'), p = b.getAttribute('data-p');
    if (!canCtl()) { toast(roClause(), ''); return; }
    if (k === 'tmq' || k === 'tmat') {
      var t;
      if (k === 'tmq') t = Date.now() + (+b.getAttribute('data-min')) * 60000;
      else {
        var v = ($('tm-' + p) || {}).value || ''; if (!/^\d\d:\d\d$/.test(v)) { toast('Adj meg egy időpontot (óra:perc).', 'err'); return; }
        st.rob.tmVal = st.rob.tmVal || {}; st.rob.tmVal[p] = v;
        var d = new Date(); d.setHours(+v.slice(0, 2), +v.slice(3, 5), 0, 0); if (d.getTime() < Date.now() + 60000) d.setDate(d.getDate() + 1);
        t = d.getTime();
      }
      var sl = (st.rob.sel[p] || []).slice();
      st.rob.tmAsk = { p: p, t: t, args: sl.length ? sl : null }; showInfo(); return;
    }
    if (k === 'tmno') { st.rob.tmAsk = null; showInfo(); return; }
    if (k === 'tmyes') { var a = st.rob.tmAsk; st.rob.tmAsk = null; if (a) { if (a.args) st.rob.sel[p] = []; tmSend(p, a.t, a.args); } showInfo(); return; }
    if (k === 'tmdel') {
      var id = b.getAttribute('data-id');
      if (!sb || !st.user) { st.rob.tm[p] = (st.rob.tm[p] || []).filter(function (x) { return String(x.id) !== id; }); showInfo(); return; }
      sb.rpc('robot_cmd_cancel', { p_id: +id }).then(function (res) { if (res.error) toast(robName(p) + ': ' + robErr(res.error), 'err'); else toast(robName(p) + ': időzítő törölve', 'ok'); st.rob.tmAt[p] = 0; tmLoad(p); });
      return;
    }
    if (k === 'pick') {
      var seg = +b.getAttribute('data-seg'), sl = st.rob.sel[p] = (st.rob.sel[p] || []).slice(), i = sl.indexOf(seg);
      if (i >= 0) sl.splice(i, 1); else if (sl.length < 16) sl.push(seg);
      if (st.rob.ask === p + ':rooms') st.rob.ask = null; showInfo(); return;
    }
    if (k === 'clear') { st.rob.sel[p] = []; st.rob.ask = null; showInfo(); return; }
    if (k === 'rooms') { if ((st.rob.sel[p] || []).length) { st.rob.ask = p + ':rooms'; showInfo(); } return; }
    if (k === 'ryes') { st.rob.ask = null; var args = (st.rob.sel[p] || []).slice(); st.rob.sel[p] = []; if (args.length) robSend(p, 'rooms', args); return; }
    if (k === 'start') { st.rob.ask = p; showInfo(); return; }
    if (k === 'no') { st.rob.ask = null; showInfo(); return; }
    if (k === 'yes') { st.rob.ask = null; k = 'start'; }
    robSend(p, k);
  });

  // C: heti időzítő lap
  function schedRender() {
    var box = $('schedbody'); if (!box || $('schedsheet').hidden) return;
    var pinks = CTL_PINKS.filter(function (p) { return st.ctl.rules.some(function (r) { return r.pink === p && r.enabled; }); });
    var grid = '<div class="wk"><span></span>' + DAYS.map(function (d) { return '<span class="h">' + d + '</span>'; }).join('');
    pinks.forEach(function (p) {
      grid += '<span class="dn">' + esc(shortName(p)) + '</span>';
      DAYS.forEach(function (dn, i) {
        var ev = st.ctl.rules.filter(function (r) { return r.pink === p && r.enabled && (r.days & (1 << i)); }).map(function (r) { return [ruleMinute(r), r.action]; }).sort(function (a, b) { return a[0] - b[0]; });
        var bars = '', onAt = null;
        ev.forEach(function (e) { if (e[1] === 'on' && onAt == null) onAt = e[0]; else if (e[1] === 'off' && onAt != null) { bars += '<i style="left:' + (onAt / 14.4) + '%;width:' + ((e[0] - onAt) / 14.4) + '%"></i>'; onAt = null; } });
        if (onAt != null) bars += '<i style="left:' + (onAt / 14.4) + '%;width:' + ((1440 - onAt) / 14.4) + '%"></i>';
        grid += '<span class="cell" title="' + esc(shortName(p)) + ', ' + dn + '">' + bars + '</span>';
      });
    });
    grid += '</div><div class="ax"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>';
    box.innerHTML = (pinks.length ? grid : '<div class="none">Még nincs aktív szabály. Adj hozzá egyet lent, vagy egy lámpa kártyáján.</div>') +
      '<div class="sub">Minden szabály</div>' + rulesHtml(st.ctl.rules, true) + addFormHtml(null, true) +
      '<div class="ctln">A napnyugtához kötött szabály naponta magától igazodik (ma ' + hm(sunMin('sunset')) + '). A kapcsolások egymás után, 3 mp-es szünettel mennek.</div>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-ctl]') : null; if (!b || b.tagName === 'FORM') return;
    var k = b.getAttribute('data-ctl'), p = b.getAttribute('data-p');
    if (k !== 'open' && !canCtl()) { e.stopPropagation(); toast(roClause(), ''); return; }
    if (k === 'sw') switchPlug(p, b.getAttribute('aria-checked') !== 'true');
    else if (k === 'yes' && st.ctl.ask) switchPlug(st.ctl.ask.p, st.ctl.ask.on, true);
    else if (k === 'no') { st.ctl.ask = null; ctlRender(); }
    else if (k === 'q') quick(p, b.getAttribute('data-k'));
    else if (k === 'pre') togglePreset(p, b.getAttribute('data-id'));
    else if (k === 'rdel' || k === 'rtog') ruleOp(b.getAttribute('data-id'), k === 'rdel' ? 'del' : 'tog');
    else if (k === 'tdel') timerDel(b.getAttribute('data-id'));
    else if (k === 'scene') { var sc = SCENES.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; if (sc && !st.ctl.busy.scene) runScene(sc); }
    else if (k === 'open') select(p);
    else if (k === 'sched') { st.sel = null; showInfo(); drawOverlay(); $('schedsheet').hidden = false; $('devsheet').hidden = true; schedRender(); }
    else return;
    e.stopPropagation();
  });
  document.addEventListener('change', function (e) {
    var f = e.target.form; if (!f || f.getAttribute('data-ctl') !== 'radd' || e.target.name !== 'w') return;
    f.elements.t.hidden = e.target.value !== 'time';
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f.getAttribute || f.getAttribute('data-ctl') !== 'radd') return;
    e.preventDefault();
    addRule(f.getAttribute('data-p') || f.elements.p.value, f.elements.a.value, f.elements.w.value, +f.elements.d.value, f.elements.t.value);
  });

  // ---- Supabase ------------------------------------------------------------------------------------
  function load() {
    if (!sb || !st.user) return;
    Promise.all([
      sb.from('devices').select('pink,role,room,label'),
      sb.from('device_latest').select('pink,ts,online,status'),
      sb.from('battery_status').select('pink,label,level,eta_lo,eta_hi,basis'),
      sb.from('weather_hourly').select('ts,temp,is_forecast').gte('ts', new Date(Date.now() - 6 * 3600e3).toISOString()).order('ts', { ascending: false }).limit(60),
      sb.from('device_status').select('ts,status').eq('pink', 'M1').gte('ts', new Date(Date.now() - 7 * 864e5).toISOString()).order('ts', { ascending: false }).limit(200),
      sb.from('site_info').select('key,value')
    ]).then(function (r) {
      if (r[1].error) { $('say').textContent = 'Az adatbázis most nem érhető el.'; return; }
      if (r[0].data && r[0].data.length) {
        var known = {}; DEFAULT_DEVS.forEach(function (d) { known[d.pink] = d; });
        st.devs = r[0].data.map(function (d) { return Object.assign({}, known[d.pink] || {}, d, { room: d.room || (known[d.pink] || {}).room }); });
        // a robotporszívók nem Tuya-eszközök: az első jelentésükig is látszanak ("nincs adat")
        DEFAULT_DEVS.forEach(function (d) { if (d.role === 'robot' && !st.devs.some(function (x) { return x.pink === d.pink; })) st.devs.push(d); });
      }
      st.latest = {}; (r[1].data || []).forEach(function (x) { st.latest[x.pink] = x; });
      st.batTable = r[2].error ? [] : (r[2].data || []);
      var past = (r[3].data || []).filter(function (x) { return Date.parse(x.ts) <= Date.now(); });
      if (!r[3].error && past.length) st.wx = past[0];
      var mv = (r[4].data || []).filter(function (x) { return x.status && x.status.pir === 'pir'; });
      st.motion = mv.length ? Date.parse(mv[0].ts) : null;
      var street = (r[5].data || []).filter(function (x) { return x.key === 'street'; })[0];
      var hadStreet = st.street;
      st.street = r[5].error ? null : (street && street.value) || null;
      st.live = true; batCalc(); render(); streetBox(); loadControl(); loadBoil();
      if (hadStreet !== st.street) drawWorld();
    });
  }
  var batHist = null, batHistAt = 0;
  function batCalc() {
    if (!BAT) { st.bat = st.batTable || []; return; }
    st.bat = BAT.merge(st.batTable || [], BAT.build(st.devs, st.latest, batHist || [], Date.now()));
    if (sb && st.user && Date.now() - batHistAt > 3 * 3600e3) {
      batHistAt = Date.now();
      var pinks = st.devs.filter(function (d) { return BAT.CHEM_BY_ROLE[d.role]; }).map(function (d) { return d.pink; });
      BAT.fetchHistory(sb, pinks, 30).then(function (h) { batHist = h; if (!st.user) return; st.bat = BAT.merge(st.batTable || [], BAT.build(st.devs, st.latest, h, Date.now())); render(); });
    }
  }
  // Fiók kártya: az utca felirata. Alapból a Smart Life otthon nevéből jön (a felderítés tölti ki);
  // ha van, csak kiírjuk, a mezőt a Módosítás gomb nyitja.
  function streetBox(editing) {
    var box = $('streetbox'); if (!box) return;
    box.hidden = !(st.user && st.role === 'owner');
    if (box.hidden) return;
    var has = !!st.street, ed = editing === true || (!has && st.live);
    $('streetshow').hidden = !has || ed; $('streetval').textContent = st.street || '';
    $('streetedit').hidden = !ed;
    if (document.activeElement !== $('streetin')) $('streetin').value = st.street || '';
  }
  function setUser(u) {
    var was = st.user && st.user.id;
    st.user = u;
    var share = !!(u && u.share);
    $('who').textContent = share ? 'Bemutató link: csak nézelődés, kapcsolni nem lehet.' : u ? 'Belépve: ' + (u.email || '') : 'Nem vagy belépve';
    $('b-login').textContent = share ? 'Bemutató' : u ? 'Fiók' : 'Belépés';
    $('lctitle').textContent = share ? 'Bemutató' : u ? 'Fiók' : 'Belépés';
    $('logincard').hidden = true; $('loginform').hidden = !!u; $('b-logout').hidden = !u;
    $('b-logout').textContent = share ? 'Kilépés a bemutatóból' : 'Kilépés';
    $('b-access').hidden = true;
    if (u) {
      if (was === u.id) { load(); return; }
      if (share) { st.role = 'share'; st.edit = false; toolbar(); drawWorld(); loadLayouts(true); load(); return; }
      st.role = null;
      sb.from('app_users').select('*').eq('user_id', u.id).maybeSingle().then(function (res) {
        st.role = res && res.data ? res.data.role : null;
        var nm = res && res.data && res.data.name, rl = window.F27Access && F27Access.ROLE_TXT[st.role];
        $('who').textContent = 'Belépve: ' + (nm ? nm + ' · ' : '') + (u.email || '') + (rl ? ' (' + rl[0].toLowerCase() + ')' : st.role ? '' : ' · nincs jogosultság');
        $('b-access').hidden = !st.role || !window.F27Access;
        $('b-access').textContent = st.role === 'owner' ? 'Hozzáférések (link, felhasználók)' : 'Jelszavam';
        if (st.role !== 'owner') st.edit = false;
        toolbar(); drawWorld(); loadLayouts(true); streetBox(); ctlRender();
      });
      load();
    } else {
      batHist = null; batHistAt = 0; st.batTable = []; st.live = false; st.devs = DEFAULT_DEVS; st.role = null; st.street = null;
      st.layouts = []; st.current = null; st.savedKey = '{}';
      demo(); render(); drawWorld(); streetBox();
    }
  }
  function fetchDaily() {
    if (!window.fetch) return;
    fetch(DAILY_URL, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var d = j && j.daily; if (!d || !d.time || d.time.length < 2) return;
      st.daily = { tmin: d.temperature_2m_min[1], tmax: d.temperature_2m_max[1] };
      if (!st.live && j.current && typeof j.current.temperature_2m === 'number') st.wx = { temp: j.current.temperature_2m };
      chips(); drawWorld();
    }, function () {});
  }

  // ---- gombok, billentyűk ----------------------------------------------------------------------------
  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
  // P2 (2026.11.21): egyetlen vezérlősáv. A ritkán használt gombok (Szerkesztés, Offline, Forgatás, Teljes nézet,
  // nagyítás) a Több menübe költöznek, a Rétegek menü kapcsolói nyitva hagyják a menüt.
  (function () {
    var mm = $('moremenu'), zr = mm && mm.querySelector('.mzoom');
    if (!mm) return;
    ['b-edit', 'b-off', 'b-rot', 'b-fit'].forEach(function (id) { var b = $(id); if (b) mm.insertBefore(b, zr); });
    var fit = $('b-fit'); if (fit && !fit.querySelector('.lbl')) fit.insertAdjacentHTML('beforeend', '<span class="lbl">Teljes nézet</span>');
    ['b-zout', 'b-zin'].forEach(function (id) { var b = $(id); if (b) zr.appendChild(b); });
  })();
  function menus(open) {
    [['b-lay', 'laymenu'], ['b-more', 'moremenu']].forEach(function (x) {
      var b = $(x[0]), m = $(x[1]); if (!b || !m) return;
      var o = open === x[1]; m.hidden = !o; b.setAttribute('aria-expanded', o);
    });
  }
  $('floorbar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    e.stopPropagation();
    if (b.id === 'b-lay' || b.id === 'b-more') { var m = b.id === 'b-lay' ? 'laymenu' : 'moremenu'; menus($(m).hidden ? m : null); return; }
    if (b.hasAttribute('data-floor')) { menus(null); setFloor(b.getAttribute('data-floor')); }
    else if (b.hasAttribute('data-layer')) setLayer(b.getAttribute('data-layer'));
    else if (b.closest('#moremenu') && !b.closest('.mzoom')) setTimeout(function () { menus(null); }, 0);
  });
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('#floorbar')) menus(null); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (!$('laymenu').hidden || !$('moremenu').hidden)) { menus(null); } });
  on('b-edit', 'click', function () { if (!canEdit()) return; st.edit = !st.edit; if (st.edit) toast(st.user ? 'Szerkesztés: húzd a bútorokat, aztán Mentés.' : 'Demó szerkesztés: húzd a bútorokat (belépve menthető).', ''); toolbar(); drawItems('lo'); drawItems('up'); showInfo(); });
  on('b-undo', 'click', undo); on('b-redo', 'click', redo);
  on('b-reset', 'click', function () { if (!Object.keys(st.offs).length) return; pushUndo(JSON.parse(JSON.stringify(st.offs))); st.offs = {}; drawWorld(); markDirty(); });
  on('b-rot', 'click', function (e) { rotate(e.shiftKey ? -1 : 1); });
  on('b-off', 'click', function () { setShowOff(!st.showOff); toast(st.showOff ? 'Az offline eszközök is látszanak.' : 'Az offline eszközök elrejtve.', ''); });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-off]'); if (b) setShowOff(true); });
  on('b-zin', 'click', function () { zoom(1.25); }); on('b-zout', 'click', function () { zoom(1 / 1.25); }); on('b-fit', 'click', fit);
  on('b-save', 'click', save); on('b-saveas', 'click', saveAs); on('b-def', 'click', makeDefault);
  on('layouts', 'change', function (e) { var row = st.layouts.filter(function (l) { return l.id === e.target.value; })[0]; if (row) applyLayout(row); });
  on('b-pmin', 'click', function () { var p = $('pam'); p.classList.toggle('mini'); $('b-pmin').textContent = p.classList.contains('mini') ? '+' : '−'; if ((world.clientWidth || 1440) < 900) fit(); });
  on('b-dev', 'click', function () { var s = $('devsheet'); s.hidden = !s.hidden; $('b-dev').setAttribute('aria-expanded', s.hidden ? 'false' : 'true'); if (!s.hidden) { $('logincard').hidden = true; list(); } });
  on('b-schedx', 'click', function () { $('schedsheet').hidden = true; });
  on('b-devx', 'click', function () { $('devsheet').hidden = true; $('b-dev').setAttribute('aria-expanded', 'false'); if (st.tab !== 'home') setTab('home'); });
  on('b-login', 'click', function () {
    var c = $('logincard'); c.hidden = !c.hidden;
    if (!c.hidden) { $('devsheet').hidden = true; streetBox(); if (!st.user) $('em').focus(); }
  });
  on('b-loginx', 'click', function () { $('logincard').hidden = true; $('b-login').focus(); });
  // a Fiók kártya a térképre koppintva is bezárul (minden felugró ablak bezárható: ✕, Esc, mellékattintás)
  world.addEventListener('pointerdown', function () { if (!$('logincard').hidden) $('logincard').hidden = true; }, true);
  on('b-logout', 'click', function () { if (shareRun) { shareRun.end('left'); return; } if (sb) sb.auth.signOut(); $('logincard').hidden = true; });
  on('b-access', 'click', function () {
    if (!sb || !st.role || !window.F27Access) return;
    $('logincard').hidden = true;
    F27Access.openPanel({ sb: sb, cfg: cfg, site: 'O2B', role: st.role, userId: st.user && st.user.id, roles: ['member', 'viewer'],
      roleText: { member: 'mindent lát, és kapcsolhatja, időzítheti a lámpákat, a bojlert', viewer: 'csak lát, semmit nem kapcsol' },
      link: location.origin + location.pathname });
  });
  on('streetform', 'submit', function (e) { e.preventDefault(); editStreet(); });
  on('b-stedit', 'click', function () { streetBox(true); $('streetin').focus(); });
  on('loginform', 'submit', function (e) {
    e.preventDefault();
    var err = $('lerr');
    if (!sb) { err.textContent = 'Az O2B adatbázis még nincs bekötve ezen az oldalon.'; return; }
    err.textContent = '';
    sb.auth.signInWithPassword({ email: $('em').value.trim(), password: $('pw').value }).then(function (res) {
      if (res.error) err.textContent = 'Hibás e-mail vagy jelszó.';
    });
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (e.key === 'Escape' && !$('logincard').hidden) { $('logincard').hidden = true; $('b-login').focus(); return; }   // gépelés közben is
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'r' || e.key === 'R') { rotate(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') { $('schedsheet').hidden = true; $('devsheet').hidden = true; $('logincard').hidden = true; if (st.tab !== 'home') setTab('home'); st.sel = null; showInfo(); drawPins(); }
  });
  var rsT = 0;
  window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(function () { layoutMode(); fit(); drawSky(); }, 120); });

  // ---- indulás ---------------------------------------------------------------------------------------
  // Ideiglenes bemutató link (#s=…): munkamenet nélküli, csak olvasó kliens; a jogot és a lejáratot
  // az adatbázis dönti el (011_access.sql), a visszaszámlálót és a lejárt képernyőt a közös modul adja.
  var shareTok = window.F27Access ? F27Access.shareToken('o2b') : null, shareRun = null;
  if (cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient) {
    try {
      sb = shareTok ? F27Access.shareClient(cfg, shareTok, 'o2b')
        : window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'o2b-auth' } });
    } catch (e) { sb = null; }
  }
  if (sb && shareTok) {
    shareRun = F27Access.startShare({ sb: sb, site: 'O2B', key: 'o2b', phoneTop: 16, phoneLeft: 80,
      onReady: function () { setUser({ id: 'share', email: '', share: true }); },
      onExpire: function () { sb = null; shareRun = null; setUser(null); $('b-login').hidden = true; } });
  } else if (sb) sb.auth.onAuthStateChange(function (ev, ses) { setTimeout(function () { setUser(ses && ses.user ? ses.user : null); }, 0); });

  // ---- E: telefonos fülsor (Otthon, Vezérlés, Hő, Robotok, Pamutka) és a lapjai (2026.11.20) ----------------------
  var TAB_SHEET = { ctl: 'devsheet', heat: 'tsheet', rob: 'rsheet', pam: 'psheet' };
  st.tab = 'home';
  function setTab(t) {
    st.tab = t;
    ['devsheet', 'tsheet', 'rsheet', 'psheet', 'schedsheet'].forEach(function (id) { $(id).hidden = true; });
    if (TAB_SHEET[t]) { $(TAB_SHEET[t]).hidden = false; $('logincard').hidden = true; st.sel = null; $('info').hidden = true; }
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar [data-tab]'), function (b) { if (b.getAttribute('data-tab') === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('b-dev').setAttribute('aria-expanded', t === 'ctl' ? 'true' : 'false');
    tabRender();
  }
  function tabRender() {
    if (st.tab === 'ctl' && !$('devsheet').hidden) list();
    if (!$('tsheet').hidden) heatSheet();
    if (!$('rsheet').hidden) robSheet();
    if (!$('psheet').hidden) $('pbody').innerHTML = $('say').innerHTML;
    pStrip();
  }
  function heatSheet() {
    var h = '';
    [['LENT', ['nappali', 'etkezo', 'halo', 'konyha', 'erkely']], ['FENT', ['kagylo', 'gyerek']]].forEach(function (g) {
      h += '<div class="hsec">' + g[0] + ' · cél ' + target() + ' °C</div>';
      g[1].forEach(function (rid) {
        var rt = roomTemp(rid); if (!rt) return;
        var ds = st.devs.filter(function (d) { return d.role === 'thermo' && d.room === rid; }), d0 = ds[0];
        var hum = ds.map(function (d) { var r = st.latest[d.pink]; return r && r.status && typeof r.status.va_humidity === 'number' ? r.status.va_humidity : null; }).filter(function (x) { return x != null; })[0];
        var b = (st.bat || []).filter(function (x) { return ds.some(function (d) { return d.pink === x.pink; }); })[0], bl = b && BAT && BAT.ORDER[b.level] <= 3;
        var why = rid === 'erkely' ? 'kint' : rt.c === 'hot' ? 'melegebb a célnál' : rt.c === 'cold' ? 'hidegebb a célnál' : rt.c === 'na' ? 'nincs friss mérés' : 'a célon';
        h += '<button type="button" class="hrow" data-hpink="' + d0.pink + '"><span>' + esc(ROOM_NAMES[rid] || rid) + '<small>' + why + (hum != null ? ' · pára ' + hum + ' %' : '') + (rt.n > 1 ? ' · ' + rt.n + ' hőmérő' : '') + '</small><small>elem: ' + esc(BAT.full(b)) + (bl ? ' ⚠' : '') + '</small></span><span class="t ' + rt.c + '">' + (rt.t == null ? '--' : fmt(rt.t) + '°') + '</span></button>';
      });
    });
    h += '<div class="ctln">A gázkazánt a Computherm termosztát kapcsolja (az étkezőben mér); ezt még nem látjuk, a hőmérők mutatják a hatását.</div>';
    $('tbody').innerHTML = h;
  }
  function robSheet() {
    $('rbody').innerHTML = ['R1', 'R2'].map(function (p) {
      var d = devOf(p), s = devState(d), run = robOn(p);
      return '<div class="robk' + (run ? ' run' : '') + '"><div class="rh"><span class="ric"><svg aria-hidden="true"><use href="#pi-robot"/></svg></span><span>' + esc(robName(p)) + '<small>' + esc((VP_UP.indexOf(d.room) >= 0 ? 'fent' : 'lent') + ' · ' + s.txt) + '</small></span></div><button type="button" class="rvgo pov" data-pov="' + p + '">Porszívó-szem ›</button><button type="button" class="rvgo" data-rvgo="' + p + '">Robot-nézet ›</button>' + robotCard(d) + '</div>';
    }).join('') || '<div class="ctln">Nincs robot.</div>';
  }
  // Otthon képernyő: Pamutka egy sorban (a legfontosabb tanács), koppintásra a Pamutka lap
  function pStrip() {
    var L = st.pamLead || { text: 'Miaú!', pink: null };
    $('pstx').textContent = L.text;
    $('b-pstrip').hidden = !L.pink;
    $('b-pstrip').setAttribute('data-pink', L.pink || '');
  }
  $('tabbar').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) setTab(b.getAttribute('data-tab')); });
  ['b-tx', 'b-rx', 'b-px'].forEach(function (id) { $(id).addEventListener('click', function () { setTab('home'); }); });
  $('pstrip').addEventListener('click', function (e) {
    var b = e.target.closest('#b-pstrip');
    if (b) { e.stopPropagation(); var pk = b.getAttribute('data-pink'); if (pk) { setTab('home'); select(pk); } return; }
    setTab('pam');
  });
  $('pstrip').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'pstrip') { e.preventDefault(); setTab('pam'); } });
  document.addEventListener('click', function (e) {
    var h = e.target.closest && e.target.closest('[data-hpink]');
    if (h) { e.stopPropagation(); var pk = h.getAttribute('data-hpink'); setTab('home'); if (!st.layers.heat) select(pk); else { var pf = pinFloor(pk); if (pf && st.floor !== 'both' && pf !== st.floor) setFloor(pf); } return; }
  });
  function layoutMode() { document.body.classList.toggle('wide', (window.innerWidth || 1440) >= 900); }
  layoutMode();
  if ((world.clientWidth || 1440) < 900) { $('pam').classList.add('mini'); $('b-pmin').textContent = '+'; }
  demo(); drawSky(); drawWorld(); render(); fetchDaily(); pamHero();
  requestAnimationFrame(catStep);
  setInterval(load, 5 * 60000);
  setInterval(function () { drawSky(); chips(); }, 10 * 60000);
  setInterval(fetchDaily, 3 * 3600000);
  // az esti levél sorai ide visznek: ?dev=C1 -> az eszköz kártyája nyitva
  (function () { var q = null; try { q = new URLSearchParams(location.search).get('dev'); } catch (e) {}
    if (q && /^[A-Z]{1,2}\d{1,2}$/.test(q)) setTimeout(function () { select(q); }, 1200); })();
  window.__o2b = { st: st, cat: cat, fit: fit, rotate: rotate, render: render, setFloor: setFloor, say: function (t) { setBubble(t); showBubble(); } };
})();
