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
  var ROLE_COL = { thermo: '#2f6fe4', ac_ir: '#26a5c9', plug: '#ff8a3d', breaker: '#c0399f', pir: '#7a6fb0', ir_hub: '#26a5c9' };
  var ROLE_GLYPH = { thermo: '°', ac_ir: '❄', plug: 'W', breaker: 'K', pir: '◉', ir_hub: '≈' };
  var ROLE_NAME = { thermo: 'hőmérő', ac_ir: 'klíma (IR-ről vezérelt)', plug: 'okos konnektor', breaker: 'okos kismegszakító', pir: 'mozgásérzékelő', ir_hub: 'IR-távirányító' };

  var st = {
    k: 0, offs: {}, edit: false, sel: null, user: null, role: null, live: false, devs: DEFAULT_DEVS, latest: {},
    bat: [], batTable: [], wx: null, daily: null, motion: null, street: null, layouts: [], current: null,
    undo: [], redo: [], vb: null, savedKey: '{}', tipIdx: 0
  };
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
    return { txt: off ? 'offline' : 'online', cls: off ? 'off' : '', big: null };
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
    if (SKY) celestial(sky, SKY.bodies(now, LAT, LON, SKY.viewAzFromNorth(northScreenAngle())), pal);
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
    var hx = 720 + Math.max(-1, Math.min(1, (behind ? (ang > 0 ? 1 : -1) : ang / 90))) * 300, hs = behind ? 0.42 : 0.55;
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
    var lab = el('text', { x: 2, y: -310, 'text-anchor': 'middle', class: 'slab-t', style: 'font-size:26px;stroke-width:5px' }, hg);
    lab.textContent = (behind ? '↓ ' : '') + 'Gellért-hegy';
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
      var nt = el('text', { x: r1(nr.x), y: r1(nr.y - 30), 'text-anchor': 'middle', class: 'slab-t', style: 'font-size:13px' }, ng);
      nt.textContent = 'napkelte ' + nr.label;
    }
    var m = B.moon;
    if (m.up) {
      var mg = el('g', { opacity: s.up ? 0.75 : 1 }, svg);
      if (!s.up) el('circle', { cx: r1(m.x), cy: r1(m.y), r: m.r * 2.4, fill: 'url(#halo)', opacity: 0.25 }, mg);
      el('circle', { cx: r1(m.x), cy: r1(m.y), r: m.r, fill: '#3d4677', opacity: 0.85 }, mg);
      el('path', { d: m.lit, fill: '#fff6dc' }, mg);
      el('circle', { cx: r1(m.x), cy: r1(m.y), r: m.r, fill: 'none', stroke: INK, 'stroke-width': 3 }, mg);
      var lt = el('text', { x: r1(m.x), y: r1(m.y + m.r + 20), 'text-anchor': 'middle', class: 'slab-t', style: 'font-size:13px' }, mg);
      lt.textContent = m.name + ' · ' + Math.round(m.fraction * 100) + '%';
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
      var b = F.bbox;
      el('ellipse', { cx: r1((b.x0 + b.x1) / 2), cy: r1(b.y1 - 30), rx: r1((b.x1 - b.x0) * 0.45), ry: r1((b.x1 - b.x0) * 0.08), fill: INK, opacity: f === 'up' ? 0.12 : 0.2 }, g);
      if (f === 'up') {
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
      if (f === 'lo') drawCompass(g);
      layer[f] = el('g', { class: 'items' }, g);
      drawItems(f);
    });
    layer.labels = el('g', { id: 'labels' }, world);
    layer.pins = el('g', { id: 'pins' }, world);
    layer.cat = el('g', { id: 'cat', class: 'walk', role: 'button', tabindex: 0, 'aria-label': 'Pamutka, a tanácsadó macska' }, world);
    buildCat(layer.cat);
    layer.cat.addEventListener('pointerdown', catDown);
    layer.cat.addEventListener('click', function (e) { e.stopPropagation(); if (catDrag.justDropped) { catDrag.justDropped = false; return; } catClick(); });
    layer.drop = el('ellipse', { id: 'catdrop', rx: 30, ry: 9, fill: '#1e2a44', opacity: 0 }, world);
    world.insertBefore(layer.drop, layer.cat);
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
  function uiK() { var s = scaleNow() || 1; return Math.max(1, Math.min(2.4, 0.72 / s)); }
  // Feliratok és tűk egy menetben, ütközésfigyeléssel (audit, 2026.11.15: több helyen egymásra csúsztak).
  // Sorrend: szintfeliratok, tűk (egymástól széttolva, a vonaluk a helyükre mutat), értékbuborékok
  // (jobbra, balra, fölé, alá), jelölők (Savio, Computherm), végül a szobanevek; ami sehová nem fér,
  // az a szobanév, és azt elrejtjük (a szobák az Eszközök listában is megvannak).
  function drawOverlay() {
    if (!scene || !layer.labels || !layer.pins) return;
    var k = uiK(), gl = layer.labels, gp = layer.pins, obst = [], pad = 2 * k;
    gl.innerHTML = ''; gp.innerHTML = '';
    function hits(b) { for (var i = 0; i < obst.length; i++) { var o = obst[i]; if (b[0] < o[2] + pad && b[2] > o[0] - pad && b[1] < o[3] + pad && b[3] > o[1] - pad) return true; } return false; }
    function take(b) { obst.push(b); return b; }
    function cost(b) { var c = 0; obst.forEach(function (o) { var ox = Math.min(b[2], o[2] + pad) - Math.max(b[0], o[0] - pad), oy = Math.min(b[3], o[3] + pad) - Math.max(b[1], o[1] - pad); if (ox > 0 && oy > 0) c += ox * oy; }); return c; }
    // a jelöltek közül az első ütközésmentes, ha nincs ilyen, a legkisebb átfedésű; mk(c) -> doboz
    function best(cands, mk) { var bi = 0, bc = Infinity; for (var n = 0; n < cands.length; n++) { var c = cost(mk(cands[n])); if (c === 0) return cands[n]; if (c < bc) { bc = c; bi = n; } } return cands[bi]; }
    function tw(t, fs) { return t.length * fs * 0.58; }
    // 1. szintfeliratok
    ['lo', 'up'].forEach(function (f) {
      var b = scene.floors[f].bbox, fs = 24 * k, t = f === 'up' ? 'FENT · tetőtér' : 'LENT', x = b.x0 + 6 * k, y = (b.y0 + b.y1) / 2 + (f === 'up' ? -10 : 40) * k;
      var lv = el('text', { x: r1(x), y: r1(y), class: 'lvlab', style: 'font-size:' + r1(fs) + 'px;stroke-width:' + r1(5 * k) + 'px' }, gl);
      lv.textContent = t; take([x, y - fs, x + tw(t, fs), y + 4 * k]);
    });
    // 2. tűk: széttolás
    var byPink = {}; st.devs.forEach(function (d) { byPink[d.pink] = d; });
    var R = 15 * k, P = [];
    ['lo', 'up'].forEach(function (f) {
      scene.floors[f].pins.forEach(function (pn) {
        var d = byPink[pn.id] || DEFAULT_DEVS.filter(function (x) { return x.pink === pn.id; })[0];
        if (!d || d.role === 'ir_hub' || hideOff(pn.id)) return;
        P.push({ pn: pn, d: d, s: devState(d), x: pn.p[0], y: pn.p[1] });
      });
    });
    for (var it = 0; it < 40; it++) {
      var moved = false;
      for (var i = 0; i < P.length; i++) for (var j = i + 1; j < P.length; j++) {
        var A = P[i], B = P[j], dx = B.x - A.x, dy = B.y - A.y, dd = Math.hypot(dx, dy), need = 2 * R + 4 * k;
        if (dd < need) {
          if (dd < 0.01) { dx = 1; dy = 0; dd = 1; }
          var push = (need - dd) / 2 + 0.1;
          A.x -= dx / dd * push; A.y -= dy / dd * push; B.x += dx / dd * push; B.y += dy / dd * push; moved = true;
        }
      }
      if (!moved) break;
    }
    P.forEach(function (q) { take([q.x - R, q.y - R, q.x + R, q.y + R + 2.5 * k]); });
    // 3. értékbuborékok
    P.forEach(function (q) {
      if (!q.s.big) return;
      var w = (q.s.big.length * 7.4 + 16) * k, h = 20 * k, c = [[q.x + R + 3 * k, q.y - h / 2], [q.x - R - 3 * k - w, q.y - h / 2], [q.x - w / 2, q.y - R - h - 3 * k], [q.x - w / 2, q.y + R + 5 * k],
        [q.x + R + 3 * k, q.y - h - 8 * k], [q.x + R + 3 * k, q.y + 8 * k], [q.x - R - 3 * k - w, q.y - h - 8 * k], [q.x - R - 3 * k - w, q.y + 8 * k]];
      var pick = best(c, function (z) { return [z[0], z[1], z[0] + w, z[1] + h]; });
      q.vb = take([pick[0], pick[1], pick[0] + w, pick[1] + h]);
    });
    // 4. jelölők
    ['lo', 'up'].forEach(function (f) {
      scene.floors[f].marks.forEach(function (m) {
        var fs = 11 * k, w = (m.t.length * 6.2 + 12) * k, h = 16 * k, ax = m.a[0], ay = m.a[1];
        var c = [[m.p[0], m.p[1] - h / 2 - 6 * k]];
        [26, 44, 64, 86].forEach(function (r) { [-90, -45, -135, 0, 180, 45, 135, 90].forEach(function (a) { var t = a * Math.PI / 180; c.push([ax + Math.cos(t) * (r + w / 2) * k / k, ay + Math.sin(t) * r * k]); }); });
        var pick = best(c, function (z) { return [z[0] - w / 2, z[1] - h / 2, z[0] + w / 2, z[1] + h / 2]; });
        take([pick[0] - w / 2, pick[1] - h / 2, pick[0] + w / 2, pick[1] + h / 2]);
        var mg = el('g', {}, gl);
        el('line', { x1: r1(ax), y1: r1(ay), x2: r1(pick[0]), y2: r1(pick[1]), stroke: INK, 'stroke-width': r1(1.6 * k) }, mg);
        el('circle', { cx: r1(ax), cy: r1(ay), r: r1(3 * k), fill: m.c, stroke: INK, 'stroke-width': r1(1.4 * k) }, mg);
        el('rect', { x: r1(pick[0] - w / 2), y: r1(pick[1] - h / 2), width: r1(w), height: r1(h), rx: r1(h / 2), fill: m.c, stroke: INK, 'stroke-width': r1(2 * k) }, mg);
        var t = el('text', { x: r1(pick[0]), y: r1(pick[1] + 4 * k), 'text-anchor': 'middle', class: 'mark', style: 'font-size:' + r1(fs) + 'px' }, mg); t.textContent = m.t;
      });
    });
    // 5. szobanevek
    ['lo', 'up'].forEach(function (f) {
      scene.floors[f].floors.forEach(function (fp) {
        if (!fp.n || fp.id === 'erkely' || fp.id === 'lepcsohaz') return;
        var fs = 14 * k, w = tw(fp.n, fs), h = fs * 1.05, lx = fp.label[0], ly = fp.label[1];
        var c = [[0, 0], [0, -18], [0, 18], [-34, 0], [34, 0], [0, -34], [0, 34], [-30, -22], [30, 22], [30, -22], [-30, 22]], pick = null;
        for (var n = 0; n < c.length; n++) { var x = lx + c[n][0] * k, y = ly + c[n][1] * k, b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]; if (!hits(b)) { pick = [x, y, b]; break; } }
        if (!pick) return;
        take(pick[2]);
        var t = el('text', { x: r1(pick[0]), y: r1(pick[1] + fs * 0.36), 'text-anchor': 'middle', class: 'rlabel', style: 'font-size:' + r1(fs) + 'px;stroke-width:' + r1(3.6 * k) + 'px' }, gl);
        t.textContent = fp.n;
      });
    });
    // 6. tűk kirajzolása (a feliratok fölött)
    P.forEach(function (q) {
      var pn = q.pn, d = q.d, s = q.s, col = s.cls === 'off' ? '#8a8f9c' : ROLE_COL[d.role] || '#26a5c9', alert = s.cls === 'hot' || s.cls === 'cold';
      var pg = el('g', { class: 'pin' + (st.sel === pn.id ? ' sel' : ''), tabindex: 0, role: 'button', 'data-pink': pn.id, 'aria-label': d.label + ': ' + s.txt }, gp);
      el('line', { x1: r1(q.x), y1: r1(q.y), x2: r1(pn.base[0]), y2: r1(pn.base[1]), stroke: col, 'stroke-width': r1(2 * k), 'stroke-dasharray': r1(2 * k) + ' ' + r1(3 * k), opacity: 0.8 }, pg);
      if (alert) el('circle', { class: 'ring', cx: r1(q.x), cy: r1(q.y), r: r1(R), style: 'stroke-width:' + r1(3 * k) + 'px' }, pg);
      el('circle', { class: 'dot', cx: r1(q.x), cy: r1(q.y + 2.5 * k), r: r1(R), fill: INK }, pg);
      el('circle', { class: 'dot', cx: r1(q.x), cy: r1(q.y), r: r1(R), fill: alert ? (s.cls === 'hot' ? '#ff5a3c' : '#2f6fe4') : col, style: 'stroke-width:' + r1(3 * k) + 'px' }, pg);
      var gt = el('text', { x: r1(q.x), y: r1(q.y + 4.5 * k), 'text-anchor': 'middle', 'font-size': r1((pn.id.length > 2 ? 10.5 : 12.5) * k), fill: '#ffffff' }, pg); gt.textContent = pn.id;
      if (q.vb) {
        var b = q.vb, w = b[2] - b[0];
        el('rect', { class: 'vbg', x: r1(b[0]), y: r1(b[1]), width: r1(w), height: r1(b[3] - b[1]), rx: r1(10 * k), fill: s.cls === 'hot' ? '#ffd9cc' : s.cls === 'cold' ? '#d6e6ff' : s.cls === 'off' ? '#e4e6ea' : '#ffffff', style: 'stroke-width:' + r1(2 * k) + 'px' }, pg);
        var vt = el('text', { class: 'vt', x: r1(b[0] + w / 2), y: r1(b[1] + 14.5 * k), 'text-anchor': 'middle', fill: INK, style: 'font-size:' + r1(12.5 * k) + 'px' }, pg); vt.textContent = s.big;
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
    ['lo', 'up'].forEach(function (f) {
      var q = scene.floors[f].bbox;
      b = b ? { x0: Math.min(b.x0, q.x0), x1: Math.max(b.x1, q.x1), y0: Math.min(b.y0, q.y0), y1: Math.max(b.y1, q.y1) } : Object.assign({}, q);
    });
    return b;
  }
  function fit() {
    document.documentElement.style.setProperty('--toph', (($('top').offsetHeight || 60) + 16) + 'px');
    var b = contentBox(), W = world.clientWidth || 1440, H = world.clientHeight || 900, phone = W < 760;
    // hely a felső csempéknek és az alsó Pamutka-kártyának
    var wide = W >= 900, pw = wide ? ($('pam').offsetWidth || 328) + 24 : 0, topH = ($('top').offsetHeight || 60) + 14, top = phone ? topH : (wide ? 100 : 90), bottom = phone ? ($('pam').classList.contains('mini') ? 130 : 230) : (wide ? 64 : ($('pam').classList.contains('mini') ? 140 : 340)), left = phone ? 10 : (wide ? pw : 20), right = wide ? pw : 20;
    var aw = Math.max(200, W - left - right), ah = Math.max(200, H - top - bottom);
    var cw = b.x1 - b.x0 + 60, ch = b.y1 - b.y0 + 60, s = Math.min(aw / cw * (phone ? 1.45 : 1), ah / ch);
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
    st.sel = st.sel === pink ? null : pink;
    drawPins(); list(); overview(); showInfo();
  }
  function selectPiece(id) {
    st.sel = st.sel === 'p:' + id ? null : 'p:' + id;
    drawItems('lo'); drawItems('up'); showInfo();
  }
  function infoOpen(box) {
    box.insertAdjacentHTML('beforeend', '<button class="btn ib sm ix" type="button" aria-label="Bezárás">✕</button>');
    box.querySelector('.ix').addEventListener('click', function () { st.sel = null; box.hidden = true; drawItems('lo'); drawItems('up'); drawOverlay(); list(); });
    box.hidden = false;
  }
  function showInfo() {
    var box = $('info');
    if (!st.sel) { box.hidden = true; return; }
    if (st.sel.indexOf('p:') === 0) {
      var p = S.PIECES.filter(function (x) { return x.id === st.sel.slice(2); })[0];
      if (!p) { box.hidden = true; return; }
      box.innerHTML = '<b>' + esc(p.name) + '</b><br>' + (p.fl === 'up' ? 'Fent, a tetőtérben' : 'Lent') +
        (p.drag ? (st.edit ? '. Húzd a helyére.' : '. Szerkesztés módban húzható.') : '. Beépített, nem mozdítható.');
      infoOpen(box); return;
    }
    var d = st.devs.filter(function (x) { return x.pink === st.sel; })[0]; if (!d) { box.hidden = true; return; }
    var s = devState(d), r = st.latest[d.pink], b = (st.bat || []).filter(function (x) { return x.pink === d.pink; })[0];
    box.innerHTML = '<b>' + esc(d.label) + '</b><br>' + esc(ROOM_NAMES[d.room] || '') + ' · ' + esc(ROLE_NAME[d.role] || d.role) +
      (CTL_PINKS.indexOf(d.pink) >= 0 ? '' : '<br>Most: <b style="font-size:15px">' + esc(s.txt) + '</b>') + (r && r.ts ? '<br><small>Utolsó jelentés: ' + ago(Date.parse(r.ts)) + ' ezelőtt</small>' : '') +
      (b && BAT && BAT.ORDER[b.level] <= 3 ? '<br>Elem: ' + esc(BAT.when(b)) : '') + controlCard(d);
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
      chip('c-sun', t.rise ? '↑' + SUN.hm(t.rise) + ' ↓' + SUN.hm(t.set) : '--', dl && dl.tmin != null ? 'holnap ' + fmt(dl.tmin, 0) + '…' + fmt(dl.tmax, 0) + ' °C' : 'napkelte · napnyugta');
    }
    var due = BAT ? BAT.due(st.bat) : [];
    if (due.length) {
      var r0 = due[0], hot = r0.level !== 'due30';
      chip('c-bat', r0.label || r0.pink, BAT.when(r0) + (due.length > 1 ? ' · +' + (due.length - 1) : ''), hot ? 'hot' : 'warn');
      $('c-bat').querySelector('.ck').textContent = 'ELEMCSERE' + (due.length > 1 ? ' · ' + due.length : '');
      $('c-bat').title = 'Elemcsere: ' + due.map(function (r) { return (r.label || r.pink) + ': ' + BAT.when(r) + (r.basis ? ' [' + r.basis + ']' : ''); }).join('; ') +
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
    });
    var off = st.devs.filter(function (d) { return d.role === 'thermo' && st.latest[d.pink] && st.latest[d.pink].online === false; });
    if (off.length) out.push([off.length + ' hőmérő offline (' + off.map(function (d) { return ROOM_NAMES[d.room]; }).join(', ') + '): valószínűleg elem kell bele.', off[0].room, off[0].pink, 'orange']);
    (st.bat || []).forEach(function (b) {
      if (b.level === 'due14' || b.level === 'dead') {
        var dv = st.devs.filter(function (d) { return d.pink === b.pink; })[0];
        out.push(['Elemcsere: <b>' + esc(b.label || b.pink) + '</b>' + (b.level === 'dead' ? ', most.' : ', két héten belül.'), dv ? (dv.room === 'lepcso_fent' ? 'eloter' : dv.room) : null, b.pink, b.level === 'dead' ? 'red' : 'orange']);
      }
    });
    return out;
  }
  function pamutka() {
    var t = tips();
    var html = t.length ? '<div class="sayhd">Miaú! Ezt láttam (' + t.length + '):</div><ul class="tips">' + t.slice(0, 8).map(function (x) {
        return '<li class="tipc ' + (x[3] || 'orange') + '"><span class="tx">' + x[0] + '</span>' + (x[2] ? '<button class="btn sm tbtn" type="button" data-pink="' + esc(x[2]) + '">Mutasd</button>' : '') + '</li>';
      }).join('') + '</ul>'
      : '<div class="sayhd">Minden rendben, dorombolok. A szobák a cél körül vannak.</div>';
    $('say').innerHTML = html + (st.live ? '' : '<small><i>Demó: belépés után a valódi adatokból szólok.</i></small>');
    Array.prototype.forEach.call($('say').querySelectorAll('.tbtn'), function (bt) { bt.addEventListener('click', function () { select(bt.getAttribute('data-pink')); }); });
    cat.goal = t.length ? t[0][1] : null;
    layer.cat && layer.cat.classList.toggle('has-tip', !!t.length);
  }
  // jobb oldali Áttekintés panel (asztali nézet), a F27 mintájára
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
      return '<div class="cr' + (off ? ' off' : '') + '"><span class="n">' + esc(d.label.replace(/ \(.*\)$/, '')) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="w">' + (off ? 'offline' : on ? (w ? fmt(w, 0) + ' W' : '0 W') : 'KI') + '</span></div>';
    }).join('');
    var due = BAT ? BAT.due(st.bat) : [];
    var bats = due.length ? due.map(function (r) { return '<div class="br ' + r.level + '"><b>' + esc(r.label || r.pink) + '</b><span>' + esc(BAT.when(r)) + '</span></div>'; }).join('')
      : '<div class="br ok">Minden elem rendben.</div>';
    var nOff = offCount();
    box.innerHTML = (nOff && !st.showOff ? '<div class="offnote">' + nOff + ' offline eszköz elrejtve <button class="mini lnk" data-off="1">Mutasd</button></div>' : '') +
      switchesHtml() + '<div class="ovs"><div class="ovh">HŐMÉRSÉKLETEK <small>cél: ' + target() + ' °C</small></div><div class="tiles">' + tiles + '</div></div>' +
      '<div class="ovs"><div class="ovh">FOGYASZTÁS MOST <b>' + fmt(tot, 0) + ' W</b></div>' + rows + '</div>' +
      '<div class="ovs"><div class="ovh">ELEMEK</div>' + bats + '</div>' +
      '<div class="ovs"><div class="ovh">FŰTÉS</div><div class="br ok">Gázkazán (Savio), Computherm termosztát az étkezőben: még nincs bekötve, a hőmérők mutatják a hatását.</div></div>';
    Array.prototype.forEach.call(box.querySelectorAll('.ovt'), function (bt) { bt.addEventListener('click', function () { select(bt.getAttribute('data-pink')); }); });
    $('ovsrc').textContent = st.live ? 'ÉLŐ' : 'DEMÓ'; $('ovsrc').className = 'src ' + (st.live ? 'live' : 'demo');
  }
  function render() {
    $('demo').hidden = st.live; $('livepill').hidden = !st.live;
    chips(); list(); pamutka(); overview(); drawPins(); showInfo(); toolbar(); offBtn();
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
    ['a', 'b'].forEach(function (c, i) { o += '<text class="zz ' + c + '" x="' + (34 + i * 7) + '" y="' + (-46 - i * 6) + '" font-family="Lilita One, sans-serif" font-size="16" fill="#fff7e6" stroke="#1e2a44" stroke-width="3" paint-order="stroke">z</text>'; });
    return o;
  }
  function buildCat(g) {
    g.innerHTML = '<g class="pose p-walk">' + pamWalk() + '</g><g class="pose p-sit">' + pamSit() + '</g><g class="pose p-sleep">' + pamSleep() + '</g>' +
      '<g class="yarn"><g class="yb"><circle cx="0" cy="-9" r="9" fill="#ff7aa8" stroke="#1e2a44" stroke-width="2.4"/><path d="M-7,-13 Q0,-6 7,-14 M-8,-7 Q0,-1 8,-8 M-3,-17 Q2,-9 -2,-1" fill="none" stroke="#c94f7c" stroke-width="1.6"/></g><path class="ythr" d="M-8,-4 Q-24,4 -40,-2" fill="none" stroke="#ff7aa8" stroke-width="2"/></g>' +
      '<g class="bubble"><rect x="-58" y="-188" width="116" height="34" rx="14" fill="#fffdf7" stroke="#1e2a44" stroke-width="3"/><path d="M-6,-155 L0,-144 L8,-155" fill="#fffdf7" stroke="#1e2a44" stroke-width="3" stroke-linejoin="round"/><text class="bt" x="0" y="-165" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="900" font-size="17" fill="#1e2a44">Miaú?</text></g>' +
      '<g class="alert"><g><circle cx="0" cy="-142" r="14" fill="#ffe066" stroke="#1e2a44" stroke-width="3"/><text x="0" y="-135" text-anchor="middle" font-family="Lilita One, sans-serif" font-size="20" fill="#1e2a44">!</text></g></g>' +
      '<g class="dust"><ellipse cx="-34" cy="-4" rx="12" ry="7"/><ellipse cx="34" cy="-4" rx="12" ry="7"/><ellipse cx="-18" cy="2" rx="9" ry="5"/><ellipse cx="20" cy="2" rx="9" ry="5"/></g>' +
      '<text x="0" y="22" text-anchor="middle" class="slab-t" style="font-size:15px">Pamutka</text>';
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
  function showBubble() { cat.talkUntil = Date.now() + 2600; }
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
    if (CTL_CONFIRM[p] && !confirmed) { st.ctl.ask = { p: p, on: on }; ctlRender(); return; }
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
    return '<div class="ask">Biztos? A bojler adja a fenti meleg vizet. <button class="btn sm y" data-ctl="yes">Igen, ' + (a.on ? 'BE' : 'KI') + '</button><button class="btn sm" data-ctl="no">Mégse</button></div>';
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
  // B: Kapcsolók blokk
  function switchesHtml() {
    var ro = !canCtl();
    return '<div class="ovs swb"><div class="ovh">' + (ro ? 'LÁMPÁK ÉS KONNEKTOROK' : 'KAPCSOLÓK <button class="mini lnk" data-ctl="sched">Heti időzítő</button>') + '</div>' +
      (st.ctl.missing && !ro ? '<div class="ctln">A kapcsolás még nincs telepítve (Actions: Kapcsolás telepítése).</div>' : '') +
      (ro ? '' : '<div class="scn">' + SCENES.map(function (sc) { return '<button class="scb' + (st.ctl.busy.scene === sc.id ? ' busy' : '') + '" data-ctl="scene" data-id="' + sc.id + '"><b>' + sc.n + '</b><small>' + sc.d + '</small></button>'; }).join('') + '</div>') +
      CTL_PINKS.filter(function (p) { return !hideOff(p); }).map(function (p) { return '<div class="swr' + (plugOnline(p) || !st.live ? '' : ' off') + '"><span class="dot' + (plugOn(p) ? ' on' : '') + '"></span><button class="nm" data-ctl="open" data-p="' + p + '">' + esc(shortName(p)) + '<small>' + (plugOnline(p) || !st.live ? (function () { var n = st.role === 'share' ? null : nextEvent(p); return n ? 'köv.: ' + whenText(n.at) + ' ' + (n.on ? 'BE' : 'KI') : p; })() : p + ' · offline') + '</small></button>' + swHtml(p) + '</div>' + askHtml(p); }).join('') + (ro ? '<div class="ctln">' + roClause() + '</div>' : '') + '</div>';
  }
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
      st.live = true; batCalc(); render(); streetBox(); loadControl();
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
  on('b-devx', 'click', function () { $('devsheet').hidden = true; $('b-dev').setAttribute('aria-expanded', 'false'); });
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
    if (e.key === 'Escape') { $('schedsheet').hidden = true; $('devsheet').hidden = true; $('logincard').hidden = true; st.sel = null; showInfo(); drawPins(); }
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
  function layoutMode() { document.body.classList.toggle('wide', (window.innerWidth || 1440) >= 900); }
  layoutMode();
  if ((world.clientWidth || 1440) < 900) { $('pam').classList.add('mini'); $('b-pmin').textContent = '+'; }
  demo(); drawSky(); drawWorld(); render(); fetchDaily(); pamHero();
  requestAnimationFrame(catStep);
  setInterval(load, 5 * 60000);
  setInterval(function () { drawSky(); chips(); }, 10 * 60000);
  setInterval(fetchDaily, 3 * 3600000);
  window.__o2b = { st: st, cat: cat, fit: fit, rotate: rotate };
})();
