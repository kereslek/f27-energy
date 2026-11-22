/* Robotporszívó élő mozgása az izometrikus alaprajzon (O2B; a F27 térkép is használhatja, ha lesz ott porszívó).
 *
 * Két rész:
 *  1. calibrate(map, plan, override): a robot saját térképe (képpont) -> alaprajz (méter). A robot térképének
 *     befoglalóját (bbox, vagy a szobaközepek befoglalója) az alaprajz szintjének befoglalójára illeszti, a 4 forgatás
 *     x tükrözés közül azt választja, amelyik a legjobb pontszámot adja: oldalarány, a dokk helye (a térkép dokkja
 *     essen az alaprajz ismert dokkja mellé), és hogy a szobaközepek az alaprajz szobáiba essenek. Végül a dokkot
 *     tengelyenként szakaszosan lineáris igazítással pontosan a helyére húzza (a befoglaló sarkai nem mozdulnak).
 *     Kézi finomhangolás: override = { rot, mirror, box: [x0, y0, x1, y1], dx, dy, anchor }.
 *  2. create(): a jelölő (robot-fej nyíllal és „élő” ponttal) simán mozog a frissítések között, halvány nyomvonallal a
 *     szinten; a jelenet vetítését a hívó adja (env.P), így forgatásnál, nagyításnál, szintváltásnál is jó helyen áll.
 *
 * Tiszta JS, DOM nélkül is tesztelhető (calibrate, sim): `node tools/robotlive_test.js`.
 */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  // ---- kalibráció ---------------------------------------------------------------------------------
  function planBox(rooms) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    (rooms || []).forEach(function (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.d); });
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
  }
  // a robot térképének nem üres része [x0, y0, x1, y1] képpontban
  function mapBox(map) {
    var b = map && map.bbox;
    if (b && b.length === 4 && b[2] - b[0] > 2 && b[3] - b[1] > 2) return b.slice();
    var cs = ((map && map.rooms) || []).map(function (r) { return r.c; }).filter(function (c) { return c && isFinite(c[0]) && isFinite(c[1]); });
    if (cs.length >= 2) {
      var x0 = Math.min.apply(0, cs.map(function (c) { return c[0]; })), x1 = Math.max.apply(0, cs.map(function (c) { return c[0]; }));
      var y0 = Math.min.apply(0, cs.map(function (c) { return c[1]; })), y1 = Math.max.apply(0, cs.map(function (c) { return c[1]; }));
      var px = Math.max(10, (x1 - x0) * 0.18), py = Math.max(10, (y1 - y0) * 0.18);
      if (x1 - x0 > 2 && y1 - y0 > 2) return [x0 - px, y0 - py, x1 + px, y1 + py];
    }
    return map && map.w > 2 && map.h > 2 ? [0, 0, map.w, map.h] : null;
  }
  // normalizált (0..1) koordináta forgatása r x 90 fokkal és tükrözése
  function orient(u, v, r, m) {
    if (m) u = 1 - u;
    for (var i = 0; i < r; i++) { var t = u; u = 1 - v; v = t; }
    return [u, v];
  }
  function inRooms(rooms, x, y, tol) {
    tol = tol || 0;
    for (var i = 0; i < rooms.length; i++) { var r = rooms[i]; if (x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.d + tol) return true; }
    return false;
  }
  // a legközelebbi pont a szobák uniójában (a robot nem lehet a falban, a lépcsőnél vagy a résen)
  function snap(rooms, x, y) {
    if (!rooms || !rooms.length || inRooms(rooms, x, y, 0)) return [x, y];
    var best = null, bd = 1e9;
    rooms.forEach(function (r) {
      var qx = Math.max(r.x, Math.min(x, r.x + r.w)), qy = Math.max(r.y, Math.min(y, r.y + r.d)), d = (qx - x) * (qx - x) + (qy - y) * (qy - y);
      if (d < bd) { bd = d; best = [qx, qy]; }
    });
    return best;
  }
  function pw(u, c, d) {                          // szakaszosan lineáris: c -> d, 0 -> 0, 1 -> 1
    if (c == null || d == null || c < 0.03 || c > 0.97 || d <= 0 || d >= 1) return u;
    return u <= c ? u * d / c : d + (u - c) * (1 - d) / (1 - c);
  }
  /* map: { w, h, bbox, rooms: [{c: [x, y]}], charger: [x, y] }; plan: { rooms: [{x, y, w, d}], dock: [x, y] }
     Visszaad: { rot, mirror, score, auto, toPlan(px, py) -> [x, y] méterben } vagy null. */
  function calibrate(map, plan, ov) {
    ov = ov || {};
    var mb = mapBox(map), pb = ov.box || planBox(plan && plan.rooms);
    if (!mb || !pb) return null;
    var mw = mb[2] - mb[0], mh = mb[3] - mb[1], PW = pb[2] - pb[0], PH = pb[3] - pb[1], diag = Math.sqrt(PW * PW + PH * PH);
    var rooms = (plan && plan.rooms) || [], dock = plan && plan.dock;
    function mk(r, m) {
      var cal = {
        rot: r, mirror: m, box: pb,
        raw: function (px, py) { var o = orient((px - mb[0]) / mw, (py - mb[1]) / mh, r, m); return o; },
        toPlan: null
      };
      var uc = null, vc = null, ud = null, vd = null;
      if (ov.anchor !== false && map.charger && dock) {
        var oc = cal.raw(map.charger[0], map.charger[1]);
        var cx = pb[0] + oc[0] * PW, cy = pb[1] + oc[1] * PH;
        if (Math.sqrt(Math.pow(cx - dock[0], 2) + Math.pow(cy - dock[1], 2)) <= 0.3 * diag) { uc = oc[0]; vc = oc[1]; ud = (dock[0] - pb[0]) / PW; vd = (dock[1] - pb[1]) / PH; }
      }
      cal.toPlan = function (px, py) {
        var o = cal.raw(px, py);
        return [pb[0] + pw(o[0], uc, ud) * PW + (ov.dx || 0), pb[1] + pw(o[1], vc, vd) * PH + (ov.dy || 0)];
      };
      return cal;
    }
    var cands = [];
    for (var m = 0; m < 2; m++) for (var r = 0; r < 4; r++) {
      if (ov.rot != null && ov.rot !== r) continue;
      if (ov.mirror != null && (ov.mirror ? 1 : 0) !== m) continue;
      var cal = mk(r, m), a = (r % 2 ? mh / mw : mw / mh), asp = Math.abs(Math.log(a / (PW / PH)));
      var sc = 1.5 * asp;
      if (map.charger && dock) {
        var o = cal.raw(map.charger[0], map.charger[1]), cx = pb[0] + o[0] * PW, cy = pb[1] + o[1] * PH;
        sc += 3 * Math.sqrt(Math.pow(cx - dock[0], 2) + Math.pow(cy - dock[1], 2)) / diag;
      }
      var cs = (map.rooms || []).filter(function (q) { return q.c; });
      if (cs.length && rooms.length) {
        var hit = 0;
        cs.forEach(function (q) { var o2 = cal.raw(q.c[0], q.c[1]); if (inRooms(rooms, pb[0] + o2[0] * PW, pb[1] + o2[1] * PH, 0.1)) hit++; });
        sc += 1.2 * (1 - hit / cs.length);
      }
      cal.score = sc; cal.auto = ov.rot == null && ov.mirror == null; cands.push(cal);
    }
    cands.sort(function (a, b) { return a.score - b.score; });
    return cands[0] || null;
  }

  // ---- szimuláció (demó és bemutató: nincs valódi adat) -----------------------------------------------
  // route: [[x, y], ...] méterben, körbejár; speed: m/s. Visszaad: { at(t) -> [x, y], len }
  function sim(route, speed) {
    var segs = [], len = 0;
    for (var i = 0; i < route.length; i++) {
      var a = route[i], b = route[(i + 1) % route.length], d = Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2));
      segs.push([a, b, d, len]); len += d;
    }
    return {
      len: len,
      at: function (t) {
        var s = ((t * speed) % len + len) % len;
        for (var j = 0; j < segs.length; j++) {
          var g = segs[j];
          if (s <= g[3] + g[2] || j === segs.length - 1) { var f = g[2] ? Math.min(1, (s - g[3]) / g[2]) : 0; return [g[0][0] + (g[1][0] - g[0][0]) * f, g[0][1] + (g[1][1] - g[0][1]) * f]; }
        }
        return route[0];
      }
    };
  }

  // ---- megjelenítés ---------------------------------------------------------------------------------
  function sv(t, at, par) { var e = document.createElementNS(NS, t); for (var k in at) if (at[k] != null) e.setAttribute(k, at[k]); if (par) par.appendChild(e); return e; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  var COL = { R1: '#14a38b', R2: '#14a38b' };

  /* env: { P(fl) -> (x, y, z) -> [sx, sy] | null, show(pink, fl) -> bool, k() -> képernyő-méretezés, now() } */
  function create(env) {
    var R = {}, g = null, raf = 0, calCache = {};
    var reduce = false;
    try { reduce = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* nem baj */ }
    function now() { return env && env.now ? env.now() : Date.now(); }
    function S(p) { return R[p] = R[p] || { path: [], active: false, cur: null, from: null, to: null, t0: 0, dur: 1, lastPush: 0, head: 0, el: null }; }

    // egy új mért (vagy szimulált) hely, méterben; at: mikor mérték (ms)
    function push(pink, pos, path, at, meta) {
      var s = S(pink), rooms = s.rooms, t = now();
      var q = snap(rooms, pos[0], pos[1]);
      if (path) s.path = path.map(function (c) { return snap(rooms, c[0], c[1]); });
      s.at = at || t; s.meta = meta || s.meta || {};
      if (s.to && Math.abs(s.to[0] - q[0]) < 1e-6 && Math.abs(s.to[1] - q[1]) < 1e-6) { draw(pink); return; }
      s.from = s.cur || q; s.to = q;
      s.dur = reduce || !s.cur ? 1 : clamp(t - (s.lastPush || t - 30000), 2000, 45000);
      s.t0 = t; s.lastPush = t;
      if (!s.cur) s.cur = q;
      draw(pink); kick();
    }
    function frameStep(s, t) {
      if (!s.to) return false;
      var f = clamp((t - s.t0) / s.dur, 0, 1), a = s.from || s.to;
      var raw = [a[0] + (s.to[0] - a[0]) * f, a[1] + (s.to[1] - a[1]) * f];
      s.cur = snap(s.rooms, raw[0], raw[1]);
      s.moving = f < 1;
      return s.moving;
    }
    function place(pink) {
      var s = R[pink]; if (!s || !s.el || !s.cur) return;
      var P = env.P(s.fl); if (!P) return;
      var k = env.k ? env.k() : 1, a = P(s.cur[0], s.cur[1], 0.06);
      // irány: a mozgás képernyő-vetülete (állva marad az utolsó)
      var dx = s.to[0] - (s.from ? s.from[0] : s.to[0]), dy = s.to[1] - (s.from ? s.from[1] : s.to[1]);
      if (dx * dx + dy * dy > 0.0004) { var b = P(s.cur[0] + dx * 0.2, s.cur[1] + dy * 0.2, 0.06); s.head = Math.atan2(b[1] - a[1], b[0] - a[0]); }
      s.el.mk.setAttribute('transform', 'translate(' + r1(a[0]) + ',' + r1(a[1]) + ') scale(' + r1(k * 100) / 100 + ')');
      s.el.ar.setAttribute('transform', 'rotate(' + r1(s.head * 180 / Math.PI) + ')');
      s.el.root.setAttribute('data-x', r1(a[0])); s.el.root.setAttribute('data-y', r1(a[1]));
      s.el.root.setAttribute('data-px', s.cur[0].toFixed(3)); s.el.root.setAttribute('data-py', s.cur[1].toFixed(3));
      if (s.tail && s.path.length) {
        var l = P(s.path[s.path.length - 1][0], s.path[s.path.length - 1][1], 0.04);
        s.tail.setAttribute('x1', r1(l[0])); s.tail.setAttribute('y1', r1(l[1])); s.tail.setAttribute('x2', r1(a[0])); s.tail.setAttribute('y2', r1(a[1]));
      }
    }
    function visible(pink) { var s = R[pink]; return !!(s && s.active && s.cur && env.show(pink, s.fl) && env.P(s.fl)); }
    // a DOM egy robotra: nyomvonal + jelölő
    function draw(pink) {
      var s = R[pink]; if (!g || !s) return;
      if (!s.el) {
        var rt = sv('g', { class: 'rlive', 'data-pink': pink, 'data-fl': s.fl, 'pointer-events': 'none' }, g);
        var trail = sv('path', { class: 'rl-trail', fill: 'none', stroke: COL[pink] || '#14a38b', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.38 }, rt);
        var tail = sv('line', { class: 'rl-tail', stroke: COL[pink] || '#14a38b', 'stroke-linecap': 'round', opacity: 0.38 }, rt);
        var mk = sv('g', { class: 'rl-mk' }, rt);
        sv('ellipse', { cx: 0, cy: 3, rx: 11, ry: 6.5, fill: '#1e2a44', opacity: 0.28 }, mk);
        sv('ellipse', { cx: 0, cy: 0, rx: 10, ry: 7, fill: COL[pink] || '#14a38b', stroke: '#fff', 'stroke-width': 2.4 }, mk);
        var ar = sv('g', { class: 'rl-ar' }, mk);
        sv('path', { d: 'M-5 -3.4 L3.6 0 L-5 3.4 L-3 0 Z', fill: '#fff' }, ar);
        var dot = sv('circle', { class: 'rl-dot', cx: 8, cy: -8, r: 3.4, fill: '#ff4d4d', stroke: '#fff', 'stroke-width': 1.4 }, mk);
        var ti = sv('title', {}, dot);
        s.el = { root: rt, trail: trail, tail: tail, mk: mk, ar: ar, dot: dot, ti: ti };
        s.tail = tail;
      }
      var el = s.el, P = env.P(s.fl), k = env.k ? env.k() : 1;
      if (!P || !visible(pink)) { el.root.setAttribute('display', 'none'); return; }
      el.root.removeAttribute('display');
      el.root.setAttribute('data-fl', s.fl);
      var m = s.meta || {}, fresh = m.sim || (s.at && now() - s.at < 150000);
      el.dot.setAttribute('fill', m.sim ? '#ffb020' : fresh ? '#ff4d4d' : '#9aa3b5');
      el.dot.setAttribute('class', 'rl-dot' + (fresh ? ' live' : ''));
      el.ti.textContent = m.sim ? 'élő (szimulált példa)' : fresh ? 'élő' : 'utolsó ismert hely';
      el.root.setAttribute('aria-label', 'Robot: ' + el.ti.textContent);
      var d = '';
      s.path.forEach(function (c, i) { var q = P(c[0], c[1], 0.04); d += (i ? 'L' : 'M') + r1(q[0]) + ' ' + r1(q[1]); });
      el.trail.setAttribute('d', s.path.length > 1 ? d : '');
      el.trail.setAttribute('stroke-width', r1(3.2 * k)); el.trail.setAttribute('stroke-dasharray', r1(7 * k) + ' ' + r1(5 * k));
      el.tail.setAttribute('stroke-width', r1(3.2 * k)); el.tail.setAttribute('stroke-dasharray', r1(7 * k) + ' ' + r1(5 * k));
      place(pink);
    }
    function loop() {
      raf = 0;
      var t = now(), more = false;
      Object.keys(R).forEach(function (p) { var s = R[p]; if (s.active && s.to && frameStep(s, t)) { if (visible(p)) place(p); more = true; } });
      if (more && !(root.document && root.document.hidden)) raf = root.requestAnimationFrame(loop);
    }
    function kick() { if (!raf && root.requestAnimationFrame) raf = root.requestAnimationFrame(loop); }

    return {
      // a SVG csoport, amelybe a jelölők kerülnek (a jelenet újraépítése után újra hívandó)
      mount: function (gEl) {
        g = gEl;
        Object.keys(R).forEach(function (p) { R[p].el = null; R[p].tail = null; });
        this.refresh();
      },
      // sor a robot_map táblából (képpontok), a szint alaprajza és a kézi felülírás
      setMap: function (pink, row, plan, override) {
        var s = S(pink); s.fl = plan.fl; s.rooms = plan.rooms;
        var key = pink + '|' + row.w + 'x' + row.h + '|' + JSON.stringify(row.bbox || null) + '|' + JSON.stringify(row.charger || null) + '|' + (row.rooms || []).length + '|' + JSON.stringify(override || null) + '|' + plan.fl;
        var cal = calCache[key] || (calCache[key] = calibrate(row, plan, override));
        s.cal = cal;
        if (!cal || !row.robot) return false;
        var pos = cal.toPlan(row.robot[0], row.robot[1]), path = (row.path || []).map(function (c) { return cal.toPlan(c[0], c[1]); });
        var at = Date.parse(row.pos_at || row.updated_at || '') || now();
        push(pink, pos, path, at, { sim: false });
        return true;
      },
      // közvetlenül méterben (demó, szimuláció)
      setPlan: function (pink, plan, pos, path, at, meta) { var s = S(pink); s.fl = plan.fl; s.rooms = plan.rooms; push(pink, pos, path, at, meta); },
      setActive: function (pink, on) {
        var s = S(pink); if (s.active === !!on) return;
        s.active = !!on;
        if (!on) { s.cur = s.from = s.to = null; s.path = []; s.lastPush = 0; }
        draw(pink);
      },
      refresh: function () { Object.keys(R).forEach(draw); },
      calOf: function (pink) { return R[pink] && R[pink].cal; },
      pos: function (pink) { return R[pink] && R[pink].cur; },
      state: function (pink) { return R[pink]; }
    };
  }

  var API = { calibrate: calibrate, create: create, sim: sim, snap: snap, planBox: planBox, mapBox: mapBox, orient: orient, inRooms: inRooms };
  root.RobotLive = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : this);
