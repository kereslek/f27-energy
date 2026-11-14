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
    ['C1', 'plug', 'furdo_fent', 'Emeleti bojler (meleg víz)'], ['C2', 'plug', 'nappali', 'Dupla állólámpa'], ['C3', 'plug', 'nappali', 'TV led'],
    ['C4', 'plug', 'etkezo', 'Lépcső, fények'], ['C5', 'plug', 'etkezo', 'Tükör, étkező (lámpák)'], ['C6', 'plug', 'etkezo', 'Karácsonyfa'],
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
    [['C1', 0, true], ['C2', 1250, true], ['C3', 440, true], ['C4', 0, true], ['C5', 0, false], ['C6', 0, true], ['C7', 0, false], ['C8', 0, false]].forEach(function (r) {
      L[r[0]] = { online: ['C5', 'C6', 'C7', 'C8'].indexOf(r[0]) < 0, status: { cur_power: r[1], switch_1: r[2] } };
    });
    L.X1 = { online: true, status: { cur_power: 0, switch: true } };
    L.M1 = { online: true, status: { pir: 'none', battery_percentage: 100 } };
    st.latest = L; st.wx = st.wx || { temp: 6.1 }; st.motion = now - 12 * 60000;
    st.bat = [{ pink: 'T3', label: 'Hőmérő, hálószoba', level: 'due14', eta_lo: 0, eta_hi: 14 }];
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
    layer.cat.addEventListener('click', function (e) { e.stopPropagation(); catClick(); });
    if (!st.vb) fit(); else applyVB();
  }
  function drawBox(bx, g) {
    if (bx.left) el('polygon', { points: bx.left, fill: bx.c[1], stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
    if (bx.right) el('polygon', { points: bx.right, fill: bx.c[2], stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
    el('polygon', { points: bx.top, fill: bx.c[0], stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g);
  }
  function drawItems(f) {
    var g = layer[f]; if (!g) return;
    g.innerHTML = '';
    scene.floors[f].items.forEach(function (it) {
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
    var P = scene.floors.lo.proj.P, cx = 7.4, cy = 2.4, R = 1.45;
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
    var base = P(cx, cy + R * 1.05, 0);
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
  function drawOverlay() {
    if (!scene || !layer.labels) return;
    var k = uiK(), g = layer.labels;
    g.innerHTML = '';
    ['lo', 'up'].forEach(function (f) {
      var F = scene.floors[f], b = F.bbox;
      F.floors.forEach(function (fp) {
        if (!fp.n || fp.id === 'erkely' || fp.id === 'lepcsohaz') return;
        var t = el('text', { x: r1(fp.label[0]), y: r1(fp.label[1] + 5 * k), 'text-anchor': 'middle', class: 'rlabel', style: 'font-size:' + r1(14 * k) + 'px;stroke-width:' + r1(3.6 * k) + 'px' }, g);
        t.textContent = fp.n;
      });
      var lv = el('text', { x: r1(b.x0 + 6 * k), y: r1((b.y0 + b.y1) / 2 + (f === 'up' ? -10 : 40) * k), class: 'lvlab', style: 'font-size:' + r1(24 * k) + 'px;stroke-width:' + r1(5 * k) + 'px' }, g);
      lv.textContent = f === 'up' ? 'FENT · tetőtér' : 'LENT';
      F.marks.forEach(function (m) {
        var mg = el('g', {}, g), w = (m.t.length * 6.2 + 12) * k, h = 16 * k, mx = m.a[0] + (m.p[0] - m.a[0]) * Math.min(1.6, k), my = m.p[1];
        el('line', { x1: r1(m.a[0]), y1: r1(m.a[1]), x2: r1(mx), y2: r1(my - h), stroke: INK, 'stroke-width': r1(1.6 * k) }, mg);
        el('circle', { cx: r1(m.a[0]), cy: r1(m.a[1]), r: r1(3 * k), fill: m.c, stroke: INK, 'stroke-width': r1(1.4 * k) }, mg);
        el('rect', { x: r1(mx - w / 2), y: r1(my - h - 6 * k), width: r1(w), height: r1(h), rx: r1(h / 2), fill: m.c, stroke: INK, 'stroke-width': r1(2 * k) }, mg);
        var t = el('text', { x: r1(mx), y: r1(my - 6 * k - h / 2 + 4 * k), 'text-anchor': 'middle', class: 'mark', style: 'font-size:' + r1(11 * k) + 'px' }, mg); t.textContent = m.t;
      });
    });
    drawPins();
  }

  // ---- tűk -----------------------------------------------------------------------------------------
  function drawPins() {
    var g = layer.pins; if (!g) return;
    g.innerHTML = '';
    var byPink = {}; st.devs.forEach(function (d) { byPink[d.pink] = d; });
    ['lo', 'up'].forEach(function (f) {
      scene.floors[f].pins.forEach(function (pn) {
        var d = byPink[pn.id] || DEFAULT_DEVS.filter(function (x) { return x.pink === pn.id; })[0];
        if (!d || d.role === 'ir_hub') return;
        var s = devState(d), col = s.cls === 'off' ? '#8a8f9c' : ROLE_COL[d.role] || '#26a5c9', k = uiK();
        var alert = s.cls === 'hot' || s.cls === 'cold';
        var pg = el('g', { class: 'pin' + (st.sel === pn.id ? ' sel' : ''), tabindex: 0, role: 'button', 'data-pink': pn.id, 'aria-label': d.label + ': ' + s.txt }, g);
        el('line', { x1: r1(pn.p[0]), y1: r1(pn.p[1]), x2: r1(pn.base[0]), y2: r1(pn.base[1]), stroke: col, 'stroke-width': r1(2 * k), 'stroke-dasharray': r1(2 * k) + ' ' + r1(3 * k), opacity: 0.8 }, pg);
        if (alert) el('circle', { class: 'ring', cx: r1(pn.p[0]), cy: r1(pn.p[1]), r: r1(15 * k), style: 'stroke-width:' + r1(3 * k) + 'px' }, pg);
        el('circle', { class: 'dot', cx: r1(pn.p[0]), cy: r1(pn.p[1] + 2.5 * k), r: r1(15 * k), fill: INK }, pg);
        el('circle', { class: 'dot', cx: r1(pn.p[0]), cy: r1(pn.p[1]), r: r1(15 * k), fill: alert ? (s.cls === 'hot' ? '#ff5a3c' : '#2f6fe4') : col, style: 'stroke-width:' + r1(3 * k) + 'px' }, pg);
        var gl = el('text', { x: r1(pn.p[0]), y: r1(pn.p[1] + 4.5 * k), 'text-anchor': 'middle', 'font-size': r1((pn.id.length > 2 ? 10.5 : 12.5) * k), fill: '#ffffff' }, pg); gl.textContent = pn.id;
        if (s.big) {
          var w = (s.big.length * 7.4 + 16) * k, x = pn.p[0] + 18 * k, y = pn.p[1] - 10 * k;
          el('rect', { class: 'vbg', x: r1(x), y: r1(y), width: r1(w), height: r1(20 * k), rx: r1(10 * k), fill: s.cls === 'hot' ? '#ffd9cc' : s.cls === 'cold' ? '#d6e6ff' : s.cls === 'off' ? '#e4e6ea' : '#ffffff', style: 'stroke-width:' + r1(2 * k) + 'px' }, pg);
          var vt = el('text', { class: 'vt', x: r1(x + w / 2), y: r1(y + 14.5 * k), 'text-anchor': 'middle', fill: INK, style: 'font-size:' + r1(12.5 * k) + 'px' }, pg); vt.textContent = s.big;
        }
        var ti = el('title', {}, pg); ti.textContent = d.label + ': ' + s.txt;
        pg.addEventListener('click', function (e) { e.stopPropagation(); select(pn.id); });
        pg.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(pn.id); } });
      });
    });
  }

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
    var b = contentBox(), W = world.clientWidth || 1440, H = world.clientHeight || 900, phone = W < 760;
    // hely a felső csempéknek és az alsó Pamutka-kártyának
    var wide = W >= 1100, top = phone ? 70 : (wide ? 100 : 90), bottom = phone ? ($('pam').classList.contains('mini') ? 130 : 230) : (wide ? 64 : ($('pam').classList.contains('mini') ? 140 : 340)), left = phone ? 10 : (wide ? 352 : 20), right = wide ? 352 : 20;
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
  function showInfo() {
    var box = $('info');
    if (!st.sel) { box.hidden = true; return; }
    if (st.sel.indexOf('p:') === 0) {
      var p = S.PIECES.filter(function (x) { return x.id === st.sel.slice(2); })[0];
      if (!p) { box.hidden = true; return; }
      box.innerHTML = '<b>' + esc(p.name) + '</b><br>' + (p.fl === 'up' ? 'Fent, a tetőtérben' : 'Lent') +
        (p.drag ? (st.edit ? '. Húzd a helyére.' : '. Szerkesztés módban húzható.') : '. Beépített, nem mozdítható.');
      box.hidden = false; return;
    }
    var d = st.devs.filter(function (x) { return x.pink === st.sel; })[0]; if (!d) { box.hidden = true; return; }
    var s = devState(d), r = st.latest[d.pink], b = (st.bat || []).filter(function (x) { return x.pink === d.pink; })[0];
    box.innerHTML = '<b>' + esc(d.label) + '</b><br>' + esc(ROOM_NAMES[d.room] || '') + ' · ' + esc(ROLE_NAME[d.role] || d.role) +
      '<br>Most: <b style="font-size:15px">' + esc(s.txt) + '</b>' + (r && r.ts ? '<br><small>Utolsó jelentés: ' + ago(Date.parse(r.ts)) + ' ezelőtt</small>' : '') +
      (b && BAT && BAT.ORDER[b.level] <= 3 ? '<br>Elem: ' + esc(BAT.when(b)) : '');
    box.hidden = false;
  }

  // ---- visszavonás, elrendezések ---------------------------------------------------------------------
  function pushUndo(before) { st.undo.push(before); if (st.undo.length > 60) st.undo.shift(); st.redo = []; toolbar(); }
  function undo() { if (!st.undo.length) return; st.redo.push(JSON.parse(JSON.stringify(st.offs))); st.offs = st.undo.pop(); drawWorld(); markDirty(); }
  function redo() { if (!st.redo.length) return; st.undo.push(JSON.parse(JSON.stringify(st.offs))); st.offs = st.redo.pop(); drawWorld(); markDirty(); }
  function markDirty() { toolbar(); }
  function rotate(dir) { st.k = (st.k + dir + 4) % 4; st.vb = null; drawSky(); drawWorld(); }
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
      st.street = v || null; drawWorld(); toast(v ? 'Az utca felirata: ' + v : 'Az utca felirata törölve.', 'ok');
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
    var by = {}, box = $('rooms'); box.innerHTML = '';
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
    var th = st.devs.filter(function (d) { return d.role === 'thermo'; });
    var tiles = th.map(function (d) {
      var r = st.latest[d.pink], s = devState(d), hum = r && r.status && typeof r.status.va_humidity === 'number' ? r.status.va_humidity : null;
      var b = (st.bat || []).filter(function (x) { return x.pink === d.pink; })[0], bl = b && BAT && BAT.ORDER[b.level] <= 3;
      return '<button type="button" class="ovt ' + s.cls + (st.sel === d.pink ? ' sel' : '') + '" data-pink="' + d.pink + '"><span class="r">' + esc((ROOM_NAMES[d.room] || d.room) + (d.pink === 'T8' ? ' 2.' : '')) + '</span>' +
        '<span class="v">' + esc(s.big && s.big !== 'offline' ? s.big : s.cls === 'off' ? 'offline' : '--') + '</span>' +
        '<span class="m">' + (hum != null ? 'pára ' + hum + ' %' : '&nbsp;') + (bl ? ' · <b class="bw">elem!</b>' : '') + '</span></button>';
    }).join('');
    var plugs = st.devs.filter(function (d) { return d.role === 'plug' || d.role === 'breaker'; });
    var tot = 0, rows = plugs.map(function (d) {
      var r = st.latest[d.pink], off = !r || r.online === false, w = !off ? watts(r.status) : null, on = r && isOn(r.status);
      if (w && !(d.pink === 'C1' && st.latest.X1 && watts(st.latest.X1.status) != null)) tot += w;
      var pct = w ? Math.min(100, Math.round(w / 20)) : 0;
      return '<div class="cr' + (off ? ' off' : '') + '"><span class="n">' + esc(d.label.replace(/ \(.*\)$/, '')) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="w">' + (off ? 'offline' : on ? (w ? fmt(w, 0) + ' W' : '0 W') : 'KI') + '</span></div>';
    }).join('');
    var due = BAT ? BAT.due(st.bat) : [];
    var bats = due.length ? due.map(function (r) { return '<div class="br ' + r.level + '"><b>' + esc(r.label || r.pink) + '</b><span>' + esc(BAT.when(r)) + '</span></div>'; }).join('')
      : '<div class="br ok">Minden elem rendben.</div>';
    box.innerHTML = '<div class="ovs"><div class="ovh">HŐMÉRSÉKLETEK <small>cél: ' + target() + ' °C</small></div><div class="tiles">' + tiles + '</div></div>' +
      '<div class="ovs"><div class="ovh">FOGYASZTÁS MOST <b>' + fmt(tot, 0) + ' W</b></div>' + rows + '</div>' +
      '<div class="ovs"><div class="ovh">ELEMEK</div>' + bats + '</div>' +
      '<div class="ovs"><div class="ovh">FŰTÉS</div><div class="br ok">Gázkazán (Savio), Computherm termosztát az étkezőben: még nincs bekötve, a hőmérők mutatják a hatását.</div></div>';
    Array.prototype.forEach.call(box.querySelectorAll('.ovt'), function (bt) { bt.addEventListener('click', function () { select(bt.getAttribute('data-pink')); }); });
    $('ovsrc').textContent = st.live ? 'ÉLŐ' : 'DEMÓ'; $('ovsrc').className = 'src ' + (st.live ? 'live' : 'demo');
  }
  function render() {
    $('demo').hidden = st.live; $('livepill').hidden = !st.live;
    chips(); list(); pamutka(); overview(); drawPins(); showInfo(); toolbar();
  }

  // ---- Pamutka: sétál a lakásban, szundít, és odamegy, ahol gond van ----------------------------------------
  var cat = { i: 0, fl: 'lo', x: 2.3, y: -1.0, mode: 'sit', wait: 2500, goal: null, face: 1, last: 0, fade: 1 };
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
      [-15, 15].forEach(function (ex) {
        o += '<ellipse cx="' + X(ex) + '" cy="' + Y(-3) + '" rx="' + f(10) + '" ry="' + f(11.5) + '" fill="' + P.eye + '" stroke="#1e2a44" stroke-width="' + f(2.4) + '"/>' +
          '<ellipse cx="' + X(ex) + '" cy="' + Y(-2) + '" rx="' + f(6.8) + '" ry="' + f(9) + '" fill="#1e2a44"/>' +
          '<circle cx="' + X(ex + 3.4) + '" cy="' + Y(-7) + '" r="' + f(3.6) + '" fill="#fff"/>' +
          '<circle cx="' + X(ex - 3) + '" cy="' + Y(2.5) + '" r="' + f(1.7) + '" fill="#fff"/>';
      });
      o += '</g>';
    }
    o += '<ellipse cx="' + X(-27) + '" cy="' + Y(9) + '" rx="' + f(7.5) + '" ry="' + f(4.2) + '" fill="#ff9fb4" opacity=".55"/><ellipse cx="' + X(27) + '" cy="' + Y(9) + '" rx="' + f(7.5) + '" ry="' + f(4.2) + '" fill="#ff9fb4" opacity=".55"/>';
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
  function pamCollar(cx, cy, w) {
    return '<path d="M' + (cx - w) + ',' + cy + ' Q' + cx + ',' + (cy + 9) + ' ' + (cx + w) + ',' + cy + '" fill="none" stroke="#1e2a44" stroke-width="6" stroke-linecap="round"/>' +
      '<circle class="bell" cx="' + cx + '" cy="' + (cy + 8) + '" r="5.2" fill="#ffd23f" stroke="#1e2a44" stroke-width="2"/><circle cx="' + (cx - 1.6) + '" cy="' + (cy + 6.3) + '" r="1.5" fill="#fff6c4"/>';
  }
  // ül, szemből: a panel nagy képe és a térképen az üldögélő póz (origó: a lába közepe)
  function pamSit() {
    var o = pamTail('M22,-6 C52,-4 58,-36 42,-58 C38,-63 32,-60 35,-55', 9);
    o += '<g class="breath"><path d="M-30,-6 Q-34,-40 -18,-54 Q0,-62 18,-54 Q34,-40 30,-6 Q0,2 -30,-6 Z" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="3.2" stroke-linejoin="round"/>' +
      '<path d="M-14,-6 Q-18,-30 0,-40 Q18,-30 14,-6 Z" fill="' + PAM.belly + '"/>' +
      '<path d="M-26,-36 L-18,-34 M-28,-24 L-19,-23 M26,-36 L18,-34 M28,-24 L19,-23" stroke="' + PAM.stripe + '" stroke-width="2.6" stroke-linecap="round"/></g>';
    o += '<ellipse cx="-11" cy="-3" rx="10" ry="7" fill="' + PAM.belly + '" stroke="#1e2a44" stroke-width="2.6"/><ellipse cx="11" cy="-3" rx="10" ry="7" fill="' + PAM.belly + '" stroke="#1e2a44" stroke-width="2.6"/>' +
      '<path d="M-14,-5 L-14,-1 M-9,-5 L-9,-1 M9,-5 L9,-1 M14,-5 L14,-1" stroke="#1e2a44" stroke-width="1.4" stroke-linecap="round"/>';
    o += '<g class="head">' + pamHead(0, -84, 1) + pamCollar(0, -54, 20) + '</g>';
    return o;
  }
  // sétál, oldalt (jobbra néz; a tükrözést a menetirány adja)
  function pamWalk() {
    var o = pamTail('M-24,-24 C-42,-30 -46,-54 -34,-64 C-30,-67 -26,-63 -29,-59', 8);
    o += '<g class="body">';
    [['lB', -17], ['lA', -8], ['lA', 9], ['lB', 18]].forEach(function (l) { o += '<rect class="' + l[0] + '" x="' + (l[1] - 4) + '" y="-14" width="8.5" height="15" rx="4" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="2.4"/>'; });
    o += '<path d="M-28,-14 Q-30,-34 -6,-35 L14,-35 Q32,-34 30,-14 Q0,-6 -28,-14 Z" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M-16,-34 Q-14,-26 -16,-17 M-6,-35 Q-4,-26 -6,-15 M4,-35 Q6,-26 4,-15" fill="none" stroke="' + PAM.stripe + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<g class="head">' + pamHead(24, -52, 0.62) + pamCollar(24, -36, 12) + '</g></g>';
    return o;
  }
  // alszik: összegömbölyödve, a farka körbeér, Zzz
  function pamSleep() {
    var o = '<ellipse cx="0" cy="-14" rx="34" ry="17" fill="' + PAM.fur + '" stroke="#1e2a44" stroke-width="3"/>' +
      '<path d="M-20,-28 Q-18,-20 -20,-12 M-8,-30 Q-6,-20 -8,-8 M4,-30 Q6,-20 4,-9" fill="none" stroke="' + PAM.stripe + '" stroke-width="2.6" stroke-linecap="round"/>' +
      pamTail('M-30,-6 C-20,6 22,6 34,-6', 8) +
      '<g class="head">' + pamHead(16, -26, 0.55, true) + '</g>';
    ['a', 'b'].forEach(function (c, i) { o += '<text class="zz ' + c + '" x="' + (34 + i * 7) + '" y="' + (-46 - i * 6) + '" font-family="Lilita One, sans-serif" font-size="16" fill="#fff7e6" stroke="#1e2a44" stroke-width="3" paint-order="stroke">z</text>'; });
    return o;
  }
  function buildCat(g) {
    g.innerHTML = '<g class="pose p-walk">' + pamWalk() + '</g><g class="pose p-sit">' + pamSit() + '</g><g class="pose p-sleep">' + pamSleep() + '</g>' +
      '<g class="alert"><g><circle cx="0" cy="-142" r="14" fill="#ffe066" stroke="#1e2a44" stroke-width="3"/><text x="0" y="-135" text-anchor="middle" font-family="Lilita One, sans-serif" font-size="20" fill="#1e2a44">!</text></g></g>' +
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
  function catStep(ts) {
    var dt = Math.min(100, ts - (cat.last || ts)); cat.last = ts;
    var R = S.CAT_ROUTE;
    if (cat.wait > 0) {
      cat.wait -= dt;
    } else {
      var nx = R[(cat.i + 1) % R.length];
      if (nx[0] !== cat.fl) {                         // lépcső: átugrik a másik szintre
        cat.i = (cat.i + 1) % R.length; cat.fl = nx[0]; cat.x = nx[1]; cat.y = nx[2]; cat.fade = 0;
      } else {
        var dx = nx[1] - cat.x, dy = nx[2] - cat.y, d = Math.hypot(dx, dy), sp = 0.75 * dt / 1000;
        if (d <= sp) {
          cat.x = nx[1]; cat.y = nx[2]; cat.i = (cat.i + 1) % R.length;
          var here = catRoomAt(cat.fl, cat.x, cat.y);
          if (cat.goal && here === cat.goal) { cat.mode = 'sit'; cat.wait = 9000; }
          else if (nx[3] === 'sleep' && !cat.goal) { cat.mode = 'sleep'; cat.wait = 9000; }
          else if (nx[3] === 'sit') { cat.mode = 'sit'; cat.wait = 3500; }
          else cat.mode = 'walk';
        } else {
          cat.x += dx / d * sp; cat.y += dy / d * sp; cat.mode = 'walk';
          var a = scene.floors[cat.fl].proj.P(cat.x, cat.y, 0), b = scene.floors[cat.fl].proj.P(nx[1], nx[2], 0);
          if (Math.abs(b[0] - a[0]) > 0.5) cat.face = b[0] > a[0] ? 1 : -1;
        }
      }
    }
    cat.fade = Math.min(1, cat.fade + dt / 600);
    if (layer.cat && scene) {
      var p = scene.floors[cat.fl].proj.P(cat.x, cat.y, 0), g = layer.cat;
      g.setAttribute('transform', 'translate(' + r1(p[0]) + ',' + r1(p[1]) + ') scale(' + r1(0.62 * uiK() * 100) / 100 + ')');
      g.setAttribute('opacity', r1(cat.fade));
      var cls = (cat.mode === 'walk' ? 'walk' : cat.mode) + (cat.goal ? ' has-tip' : '');
      if (g.getAttribute('class') !== cls) g.setAttribute('class', cls);
      var walkPose = g.querySelector('.p-walk');
      if (walkPose) walkPose.setAttribute('transform', 'scale(' + cat.face + ',1)');
    }
    requestAnimationFrame(catStep);
  }
  function catClick() {
    var t = tips();
    toast(t.length ? 'Pamutka: ' + t[0][0].replace(/<[^>]+>/g, '') : 'Pamutka: miaú, minden rendben, dorombolok.', t.length ? '' : 'ok');
    $('pam').classList.remove('mini');
  }

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
      st.live = true; batCalc(); render(); streetBox();
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
  function streetBox() {
    var box = $('streetbox'); if (!box) return;
    box.hidden = !(st.user && st.role === 'owner');
    if (!box.hidden && document.activeElement !== $('streetin')) $('streetin').value = st.street || '';
  }
  function setUser(u) {
    var was = st.user && st.user.id;
    st.user = u;
    $('who').textContent = u ? 'Belépve: ' + (u.email || '') : 'Nem vagy belépve';
    $('b-login').textContent = u ? 'Fiók' : 'Belépés';
    $('logincard').hidden = true; $('loginform').hidden = !!u; $('b-logout').hidden = !u;
    if (u) {
      if (was === u.id) { load(); return; }
      st.role = null;
      sb.from('app_users').select('role').eq('user_id', u.id).maybeSingle().then(function (res) {
        st.role = res && res.data ? res.data.role : null;
        if (st.role !== 'owner') st.edit = false;
        toolbar(); drawWorld(); loadLayouts(true); streetBox();
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
  on('b-rotl', 'click', function () { rotate(-1); }); on('b-rotr', 'click', function () { rotate(1); });
  on('b-zin', 'click', function () { zoom(1.25); }); on('b-zout', 'click', function () { zoom(1 / 1.25); }); on('b-fit', 'click', fit);
  on('b-save', 'click', save); on('b-saveas', 'click', saveAs); on('b-def', 'click', makeDefault);
  on('layouts', 'change', function (e) { var row = st.layouts.filter(function (l) { return l.id === e.target.value; })[0]; if (row) applyLayout(row); });
  on('b-pmin', 'click', function () { var p = $('pam'); p.classList.toggle('mini'); $('b-pmin').textContent = p.classList.contains('mini') ? '+' : '−'; if ((world.clientWidth || 1440) < 1100) fit(); });
  on('b-dev', 'click', function () { var s = $('devsheet'); s.hidden = !s.hidden; $('b-dev').setAttribute('aria-expanded', s.hidden ? 'false' : 'true'); if (!s.hidden) { $('logincard').hidden = true; list(); } });
  on('b-devx', 'click', function () { $('devsheet').hidden = true; $('b-dev').setAttribute('aria-expanded', 'false'); });
  on('b-login', 'click', function () {
    var c = $('logincard'); c.hidden = !c.hidden;
    if (!c.hidden) { $('devsheet').hidden = true; streetBox(); if (!st.user) $('em').focus(); }
  });
  on('b-logout', 'click', function () { if (sb) sb.auth.signOut(); $('logincard').hidden = true; });
  on('streetform', 'submit', function (e) { e.preventDefault(); editStreet(); });
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
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'r' || e.key === 'R') { rotate(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') { $('devsheet').hidden = true; $('logincard').hidden = true; st.sel = null; showInfo(); drawPins(); }
  });
  var rsT = 0;
  window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(function () { layoutMode(); fit(); drawSky(); }, 120); });

  // ---- indulás ---------------------------------------------------------------------------------------
  if (cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient) {
    try { sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'o2b-auth' } }); } catch (e) { sb = null; }
  }
  if (sb) sb.auth.onAuthStateChange(function (ev, ses) { setTimeout(function () { setUser(ses && ses.user ? ses.user : null); }, 0); });
  function layoutMode() { document.body.classList.toggle('wide', (window.innerWidth || 1440) >= 1100); }
  layoutMode();
  if ((world.clientWidth || 1440) < 1100) { $('pam').classList.add('mini'); $('b-pmin').textContent = '+'; }
  demo(); drawSky(); drawWorld(); render(); fetchDaily(); pamHero();
  requestAnimationFrame(catStep);
  setInterval(load, 5 * 60000);
  setInterval(function () { drawSky(); chips(); }, 10 * 60000);
  setInterval(fetchDaily, 3 * 3600000);
  window.__o2b = { st: st, cat: cat, fit: fit, rotate: rotate };
})();
