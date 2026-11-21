/* Robotporszívók: saját térkép és takarítási napló (O2B, a tulaj kérése 2026.11.21).
 *
 * Térkép: a robot_map tábla (016_robot_map.sql), amelyet az adatgyűjtő óránként tölt a gyártói felhőből
 * (f27/robot_map.py): PNG (padló, szobák, útvonal), a szobák neve és közepe, a robot és a dokk helye.
 * Napló: a 10 perces állapotmintákból (device_status) összerakott takarítások: kezdet, vég, perc, m².
 * A minta 10 percenként jön, ezért a kezdet a robot saját perc-számlálójából visszaszámolva, „kb.”.
 */
(function () {
  'use strict';
  var C = {};          // pink -> { map, mapAt, mapLoading, log, logAt, logLoading, err }

  function st(p) { return C[p] = C[p] || {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  var DN = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  function dayLbl(t) {
    var d = new Date(t), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'ma';
    if (d.toDateString() === y.toDateString()) return 'tegnap';
    return (d.getMonth() + 1) + '.' + ('0' + d.getDate()).slice(-2) + '. ' + DN[d.getDay()];
  }

  // ---- demó ---------------------------------------------------------------------------------------
  var DEMO_ROOMS = {
    R1: [['Nappali', 30, 30, 150, 110], ['Étkező', 150, 30, 250, 110], ['Konyha', 250, 30, 320, 90], ['Hálószoba', 30, 110, 140, 190], ['Előszoba', 150, 110, 250, 160]],
    R2: [['Előtér', 110, 40, 210, 120], ['Kagyló szoba', 20, 40, 110, 170], ['Gyerekszoba', 210, 40, 320, 170], ['Fürdő', 110, 120, 210, 170]]
  };
  var DEMO_COL = ['#a8d8ea', '#ffd6a5', '#caffbf', '#ffc6ff', '#bdb2ff'];
  function demoMap(p) {
    var rs = DEMO_ROOMS[p] || DEMO_ROOMS.R2, svg = '<svg xmlns="http://www.w3.org/2000/svg" width="350" height="210" viewBox="0 0 350 210"><rect width="350" height="210" fill="#eef1f6"/>';
    rs.forEach(function (r, i) { svg += '<rect x="' + r[1] + '" y="' + r[2] + '" width="' + (r[3] - r[1]) + '" height="' + (r[4] - r[2]) + '" fill="' + DEMO_COL[i % 5] + '" stroke="#5b6478" stroke-width="3"/>'; });
    var path = 'M60 160 L60 60 L120 60 L120 150 L180 150 L180 60 L230 60 L230 100';
    svg += '<path d="' + path + '" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/></svg>';
    return { png: null, svg: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))), w: 350, h: 210,
      rooms: rs.map(function (r, i) { return { id: 16 + i, name: r[0], c: [(r[1] + r[3]) / 2, (r[2] + r[4]) / 2] }; }),
      robot: [230, 100], charger: p === 'R1' ? [40, 180] : [200, 115], updated_at: new Date(Date.now() - 23 * 60000).toISOString(), demo: true };
  }
  function demoLog(p) {
    var out = [], now = Date.now(), s = p === 'R1' ? 3 : 9;
    var r = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (var d = 0; d < 21; d++) {
      if (r() < 0.35) continue;
      var day = new Date(now - d * 86400000); day.setHours(p === 'R1' ? 10 : 13, Math.floor(r() * 50), 0, 0);
      if (day.getTime() > now) continue;
      var min = Math.round(25 + r() * 35), area = Math.round((p === 'R1' ? 38 : 26) * (0.6 + r() * 0.5));
      out.push({ start: day.getTime(), end: day.getTime() + min * 60000, min: min, area: area, ok: r() > 0.08 });
    }
    return out;
  }

  // ---- adat ---------------------------------------------------------------------------------------
  function load(ctx, what) {
    var c = st(ctx.pink), demo = !ctx.sb || !ctx.user || ['owner', 'member'].indexOf(ctx.role) < 0;
    if (what === 'map') {
      if (c.mapLoading || (c.mapAt && Date.now() - c.mapAt < 10 * 60000)) return;
      if (demo) { c.map = demoMap(ctx.pink); c.mapAt = Date.now(); return; }
      c.mapLoading = true;
      ctx.sb.from('robot_map').select('png,w,h,rooms,robot,charger,src,updated_at').eq('pink', ctx.pink).maybeSingle().then(function (r) {
        c.mapLoading = false; c.mapAt = Date.now();
        c.map = r.error ? { err: /robot_map|PGRST205|schema cache/.test(r.error.message || '') ? 'A térkép-tábla még nincs telepítve (016_robot_map.sql).' : 'Nem sikerült betölteni.' } : (r.data || { none: true });
        ctx.done();
      }, function () { c.mapLoading = false; c.mapAt = Date.now(); c.map = { err: 'Hálózati hiba.' }; ctx.done(); });
    } else {
      if (c.logLoading || (c.logAt && Date.now() - c.logAt < 10 * 60000)) return;
      if (demo) { c.log = demoLog(ctx.pink); c.logAt = Date.now(); c.logDemo = true; return; }
      c.logLoading = true; c.logDemo = false;
      var since = new Date(Date.now() - 30 * 86400000).toISOString(), rows = [];
      (function page(from) {
        ctx.sb.from('device_status').select('ts,status').eq('pink', ctx.pink).gte('ts', since).order('ts', { ascending: true }).range(from, from + 999).then(function (r) {
          if (r.error) { c.logLoading = false; c.logAt = Date.now(); c.log = []; ctx.done(); return; }
          rows = rows.concat(r.data || []);
          if ((r.data || []).length === 1000 && from < 20000) { page(from + 1000); return; }
          c.log = sessions(rows); c.logAt = Date.now(); c.logLoading = false; ctx.done();
        }, function () { c.logLoading = false; c.logAt = Date.now(); c.log = []; ctx.done(); });
      })(0);
    }
  }

  // a 10 perces mintákból takarítások: kezdet (a robot perc-számlálójából visszaszámolva), vég, perc, m²
  function sessions(rows) {
    var out = [], cur = null;
    rows.forEach(function (r) {
      var s = r.status || {}, t = Date.parse(r.ts), on = !!s.cleaning && s.state !== 'returning';
      if (on) {
        if (!cur) cur = { first: t, last: t, min: 0, area: 0, err: false };
        cur.last = t; cur.min = Math.max(cur.min, +s.minutes || 0); cur.area = Math.max(cur.area, +s.area_m2 || 0);
        if (s.error) cur.err = true;
      } else if (cur) {
        cur.min = Math.max(cur.min, +s.minutes || 0); cur.area = Math.max(cur.area, +s.area_m2 || 0);
        var min = cur.min || Math.round((t - cur.first) / 60000);
        out.push({ start: Math.min(cur.first, t - min * 60000), end: t, min: min, area: Math.round(cur.area), ok: !cur.err && s.state !== 'error' });
        cur = null;
      }
    });
    if (cur) out.push({ start: cur.min ? Math.min(cur.first, Date.now() - cur.min * 60000) : cur.first, end: null, min: cur.min, area: Math.round(cur.area), ok: true, running: true });
    return out.reverse();
  }

  // ---- megjelenítés -------------------------------------------------------------------------------
  function mapHtml(p, ago) {
    var c = st(p), m = c.map;
    if (!m || c.mapLoading) return '<div class="rv"><div class="rv-n">Betöltöm a robot térképét…</div></div>';
    if (m.err) return '<div class="rv"><div class="rv-n">' + esc(m.err) + '</div></div>';
    if (m.none) return '<div class="rv"><div class="rv-n">A robot még nem küldött térképet. Az adatgyűjtő óránként kéri le; az első takarítás után biztosan lesz.</div></div>';
    var src = m.png ? 'data:image/png;base64,' + m.png : m.svg;
    var ov = '<svg class="rv-ov" viewBox="0 0 ' + m.w + ' ' + m.h + '" preserveAspectRatio="none" aria-hidden="true">';
    // szobanevek ütközésfigyeléssel: ha egy név fedne egy másikat vagy a robotot / dokkot, kicsit odébb kerül,
    // ha sehol nem fér el, kimarad (a szoba a Szobák sorban akkor is megvan)
    var fs = Math.max(9, m.w / 32), taken = [];
    [m.robot, m.charger].forEach(function (q) { if (q) taken.push([q[0] - 14, q[1] - 14, q[0] + 14, q[1] + 14]); });
    var hit = function (b) { return b[0] < 0 || b[2] > m.w || b[1] < 0 || b[3] > m.h || taken.some(function (o) { return b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]; }); };
    (m.rooms || []).forEach(function (r) {
      if (!r.c) return;
      var w2 = String(r.name).length * fs * 0.56 / 2 + 3, h2 = fs * 0.62;
      var tries = [[0, 0], [0, -fs * 1.2], [0, fs * 1.2], [-w2, 0], [w2, 0], [0, -fs * 2.2], [0, fs * 2.2]];
      for (var i = 0; i < tries.length; i++) {
        var x = r.c[0] + tries[i][0], y = r.c[1] + tries[i][1], b = [x - w2, y - h2, x + w2, y + h2];
        if (!hit(b)) { taken.push(b); ov += '<text x="' + x.toFixed(1) + '" y="' + (y + fs * 0.35).toFixed(1) + '" text-anchor="middle" class="rv-rn" style="font-size:' + fs.toFixed(1) + 'px">' + esc(r.name) + '</text>'; return; }
      }
    });
    var drawn = m.src === 'roborock';                  // a Roborock képén a robot és a dokk már rajta van
    if (m.charger && !drawn) ov += '<g transform="translate(' + m.charger[0] + ',' + m.charger[1] + ')"><rect x="-7" y="-7" width="14" height="14" rx="3" fill="#2fa56b" stroke="#fff" stroke-width="2"/><path d="M-2 -4 L2 -1 L-1 0 L2 4" stroke="#fff" stroke-width="1.6" fill="none"/></g>';
    if (m.robot && !drawn) ov += '<g class="rv-bot" transform="translate(' + m.robot[0] + ',' + m.robot[1] + ')"><circle r="12" fill="#14a38b" opacity=".25" class="rv-pulse"/><circle r="7.5" fill="#14a38b" stroke="#fff" stroke-width="2.5"/></g>';
    ov += '</svg>';
    return '<div class="rv"><div class="rv-map" style="aspect-ratio:' + m.w + '/' + m.h + '"><img src="' + src + '" alt="A robot saját térképe" draggable="false">' + ov + '</div>' +
      '<div class="rv-leg"><span><i class="b"></i>robot</span><span><i class="d"></i>dokk</span>' + (m.updated_at ? '<span class="t">frissítve ' + esc(ago(Date.parse(m.updated_at))) + ' ezelőtt</span>' : '') + '</div>' +
      (m.demo ? '<div class="rv-n">Példatérkép (belépve a robot valódi térképe látszik).</div>' : '') + '</div>';
  }

  function logHtml(p) {
    var c = st(p), L = c.log;
    if (!L || c.logLoading) return '<div class="rv"><div class="rv-n">Betöltöm a takarításokat…</div></div>';
    if (!L.length) return '<div class="rv"><div class="rv-n">Az elmúlt 30 napban nem volt rögzített takarítás.</div></div>';
    var wk = L.filter(function (s) { return s.start > Date.now() - 7 * 86400000; });
    var sum = function (a, k) { return a.reduce(function (x, s) { return x + (s[k] || 0); }, 0); };
    var days = [], now = new Date(); now.setHours(0, 0, 0, 0);
    for (var i = 13; i >= 0; i--) { var d0 = now.getTime() - i * 86400000; days.push([d0, sum(L.filter(function (s) { return s.start >= d0 && s.start < d0 + 86400000; }), 'area')]); }
    var mx = Math.max.apply(null, days.map(function (d) { return d[1]; })) || 1, last = L[0];
    var since = last && !last.running ? Math.floor((Date.now() - last.end) / 86400000) : 0;
    var h = '<div class="rv"><div class="rv-k"><div><small>7 nap</small><b>' + wk.length + '×</b></div><div><small>Felület</small><b>' + sum(wk, 'area') + ' m²</b></div><div><small>Idő</small><b>' + Math.round(sum(wk, 'min') / 6) / 10 + ' ó</b></div></div>' +
      '<div class="rv-days" role="img" aria-label="Takarított terület naponta, az elmúlt 14 nap">' + days.map(function (d) { return '<i title="' + dayLbl(d[0]) + ': ' + d[1] + ' m²" style="height:' + Math.max(d[1] ? 12 : 3, d[1] / mx * 100) + '%"' + (d[1] ? '' : ' class="z"') + '></i>'; }).join('') + '</div>' +
      '<div class="rv-dl"><span>14 napja</span><span>ma</span></div>' +
      (since >= 3 ? '<div class="rv-warn">' + since + ' napja nem takarított.</div>' : '') + '<div class="rv-list">';
    L.slice(0, 12).forEach(function (s) {
      h += '<div class="rv-row' + (s.ok ? '' : ' bad') + '"><span class="d">' + dayLbl(s.start) + '</span><span class="t">kb. ' + hm(s.start) + (s.end ? '-' + hm(s.end) : ', most takarít') + '</span><span class="v">' + (s.min ? s.min + ' perc' : '') + (s.area ? ' · ' + s.area + ' m²' : '') + (s.ok ? '' : ' · hiba') + '</span></div>';
    });
    return h + '</div>' + (c.logDemo ? '<div class="rv-n">Példanapló (belépve a valódi takarítások látszanak).</div>' : '<div class="rv-n">A 10 perces állapotmintákból; a kezdés a robot saját perc-számlálójából, ezért „kb.”.</div>') + '</div>';
  }

  window.O2BRobotView = { load: load, mapHtml: mapHtml, logHtml: logHtml, _sessions: sessions, cache: C };
})();
