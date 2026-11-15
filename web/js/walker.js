/* Sétáló tanácsadó a térképen (F27: a zöld szék; minden jövőbeli dashboard is használhatja).
   Saját rétegben fut a színpad (#stage) fölött, és minden képkockában átveszi annak nagyítását és
   eltolását, így a MiniDC újrarajzolása nem zavarja. Útvonal: alaprajzi pontok (a jelenet egységeiben),
   amelyeken oda-vissza sétál; útközben véletlenszerűen megáll, szundít, körülnéz, ugrál vagy táncol.

   Közös viselkedés minden tanácsadónál (a tulaj kérése):
   - megfogható és arrébb tehető (drag and drop), ha útban van: kézben lóg, a padlón árnyék mutatja,
     hová kerül; elengedve leesik, huppan (porfelhő), összeszedi magát, és onnan sétál tovább;
   - alvás közben koppintásra animáltan ébred (felriad, felpattan, megrázza magát), aztán köszön;
   - a szövegbuborék a szöveghez méreteződik, a hosszabb szöveg két sorba tör.

   F27Walker.start({
     stage: HTMLElement,                          // a színpad (a réteg ennek a transzformációját követi)
     project: function (x, y) -> [sx, sy],        // alaprajzi pont -> színpadkoordináta (1440 x 900), affin
     href: function () -> '#symbol',              // a figura SVG-szimbóluma (72 x 88)
     route: [[x, y, 'sleep'|'sit'|null], ...],
     hidden: function () -> bool,                 // pl. nyitott párbeszédablak alatt elrejti
     onClick: function () {}, name: 'Energiaőr', lines: ['…'], lands: ['Hopp!', …], wakes: ['Itt vagyok!', …] } */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function start(o) {
    if (!o || !o.stage || !o.project) return null;
    var layer = document.createElement('div');
    layer.id = 'walkerlayer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:1440px;height:900px;transform-origin:0 0;pointer-events:none;z-index:1';
    o.stage.parentNode.insertBefore(layer, o.stage.nextSibling);
    var css = document.createElement('style');
    css.textContent = '@keyframes wkhop{0%,100%{transform:translateY(0) rotate(-2.5deg)}25%{transform:translateY(-3px) rotate(0)}50%{transform:translateY(0) rotate(2.5deg)}75%{transform:translateY(-3px) rotate(0)}}' +
      '@keyframes wkdance{0%,100%{transform:scaleX(1)}25%{transform:scaleX(-1)}50%{transform:scaleX(1) translateY(-6px)}75%{transform:scaleX(-1)}}' +
      '@keyframes wklook{0%,100%{transform:rotate(0)}30%{transform:rotate(-12deg)}70%{transform:rotate(12deg)}}' +
      '@keyframes wkzz{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(10px,-28px);opacity:0}}' +
      '@keyframes wkpop{0%{transform:scale(.6);opacity:0}15%{transform:scale(1.05);opacity:1}85%{opacity:1}100%{opacity:0}}' +
      '@keyframes wkdangle{0%,100%{transform:rotate(-7deg) translateY(-3px)}50%{transform:rotate(7deg) translateY(-3px)}}' +
      '@keyframes wkthud{0%{transform:scale(1.3,.6)}35%{transform:scale(.88,1.15) translateY(-8px)}60%{transform:scale(1.07,.93)}80%{transform:scale(.98,1.02)}100%{transform:none}}' +
      '@keyframes wkpuff{0%{transform:scale(.3);opacity:.85}100%{transform:scale(1.6) translateY(-6px);opacity:0}}' +
      '@keyframes wkwake{0%,20%{transform:rotate(-14deg) translateY(4px) scale(1.08,.8)}38%{transform:scale(.86,1.22) translateY(-18px)}52%{transform:scale(1.08,.92)}64%{transform:rotate(-8deg)}74%{transform:rotate(8deg)}84%{transform:rotate(-3deg)}100%{transform:none}}' +
      '#walkerlayer .wk{cursor:grab;touch-action:none}#walkerlayer .wk.held{cursor:grabbing}' +
      '#walkerlayer .wb{transform-box:fill-box;transform-origin:50% 100%}' +
      '#walkerlayer .walk .wb{animation:wkhop 1s ease-in-out infinite}' +
      '#walkerlayer .dance .wb{animation:wkdance 1.2s ease-in-out infinite}' +
      '#walkerlayer .look .wb{animation:wklook 2.2s ease-in-out infinite}' +
      '#walkerlayer .sleep .wb{transform:rotate(-14deg) translateY(4px)}' +
      '#walkerlayer .held .wb{animation:wkdangle .5s ease-in-out infinite}' +
      '#walkerlayer .thud .wb{animation:wkthud .65s ease-out}' +
      '#walkerlayer .wake .wb{animation:wkwake 1.4s ease-out}' +
      '#walkerlayer .zz,#walkerlayer .bub,#walkerlayer .dust,#walkerlayer .ex{display:none}' +
      '#walkerlayer .sleep .zz{display:inline;animation:wkzz 2.4s ease-out infinite}' +
      '#walkerlayer .sleep .zz.b{animation-delay:1.2s}' +
      '#walkerlayer .talk .bub,#walkerlayer .held .bub{display:inline;transform-box:fill-box;transform-origin:50% 100%;animation:wkpop 2.8s ease-out}' +
      '#walkerlayer .held .bub{animation:none}' +
      '#walkerlayer .thud .dust{display:inline}' +
      '#walkerlayer .dust ellipse{fill:#fffdf7;stroke:#1e2a44;stroke-width:2;transform-box:fill-box;transform-origin:center;animation:wkpuff .6s ease-out forwards}' +
      '#walkerlayer .wake .ex{display:inline;transform-box:fill-box;transform-origin:50% 100%;animation:wkpop 1.4s ease-out}';
    document.head.appendChild(css);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '1440'); svg.setAttribute('height', '900'); svg.setAttribute('viewBox', '0 0 1440 900');
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
    svg.innerHTML = '<ellipse class="drop" cx="0" cy="0" rx="22" ry="6" fill="#1e2a44" opacity="0"></ellipse>' +
      '<g class="wk" style="pointer-events:auto"><title>' + (o.name || 'Tanácsadó') + ' sétál a lakásban. Kattints rá, vagy fogd meg és tedd arrébb!</title>' +
      '<ellipse class="sh" cx="0" cy="0" rx="22" ry="6" fill="#1e2a44" opacity=".22"></ellipse>' +
      '<g class="dust"><ellipse cx="-26" cy="-2" rx="10" ry="6"></ellipse><ellipse cx="26" cy="-2" rx="10" ry="6"></ellipse><ellipse cx="-14" cy="3" rx="7" ry="4"></ellipse><ellipse cx="15" cy="3" rx="7" ry="4"></ellipse></g>' +
      '<g class="wf"><g class="wb"><use width="58" height="71" x="-29" y="-69"></use></g></g>' +
      '<text class="zz a" x="18" y="-70" font-family="Quest Display,Lilita One, sans-serif" font-size="14" fill="#fff7e6" stroke="#1e2a44" stroke-width="3" paint-order="stroke">z</text>' +
      '<text class="zz b" x="26" y="-78" font-family="Quest Display,Lilita One, sans-serif" font-size="12" fill="#fff7e6" stroke="#1e2a44" stroke-width="3" paint-order="stroke">z</text>' +
      '<g class="ex"><circle cx="20" cy="-82" r="10" fill="#ffe066" stroke="#1e2a44" stroke-width="2.5"></circle><text x="20" y="-77" text-anchor="middle" font-family="Quest Display,Lilita One, sans-serif" font-size="15" fill="#1e2a44">!</text></g>' +
      '<g class="bub"><rect x="-66" y="-112" width="132" height="28" rx="12" fill="#fffdf7" stroke="#1e2a44" stroke-width="2.5"></rect>' +
      '<path d="M-5,-85 L0,-76 L6,-85" fill="#fffdf7" stroke="#1e2a44" stroke-width="2.5" stroke-linejoin="round"></path>' +
      '<text class="bt" x="0" y="-93" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="900" font-size="13" fill="#1e2a44"></text></g></g>';
    layer.appendChild(svg);
    var g = svg.querySelector('.wk'), use = svg.querySelector('use'), wf = svg.querySelector('.wf'), bt = svg.querySelector('.bt'),
      brect = svg.querySelector('.bub rect'), btail = svg.querySelector('.bub path'), drop = svg.querySelector('.drop');
    var R = o.route, n = R.length, w = { i: 0, x: R[0][0], y: R[0][1], mode: 'sleep', wait: 3000, dir: 1, face: 1, last: 0, next: null, hold: null, fall: null };
    var lines = o.lines || ['Hahó!', 'Takarékosan!', 'Minden rendben?', 'Nézzük a kályhát!', 'Csukd be az ablakot!'];
    var lands = o.lands || ['Hopp!', 'Huh, megvagyok!', 'Ez jó hely lesz.', 'Puff! Legközelebb szólj!', 'Szép landolás!'];
    var wakes = o.wakes || ['Itt vagyok! Mi újság?', 'Hm? Ébren vagyok!', 'Csak a szemem pihent!'];
    function pickOf(a) { return a[Math.floor(Math.random() * a.length)]; }

    // ---- buborék: a szöveghez méreteződik, a hosszabb két sorba tör -----------------------------------
    var mctx = null;
    function tw(t) {
      try { mctx = mctx || document.createElement('canvas').getContext('2d'); mctx.font = '900 13px Nunito, sans-serif'; return mctx.measureText(t).width; }
      catch (e) { return t.length * 7.4; }
    }
    function setText(t) {
      var ls = [t];
      if (tw(t) > 190) {
        var best = -1, half = t.length / 2;
        t.replace(/ /g, function (m, i) { if (best < 0 || Math.abs(i - half) < Math.abs(best - half)) best = i; return m; });
        if (best > 0) ls = [t.slice(0, best), t.slice(best + 1)];
      }
      var W = Math.max(70, Math.ceil(Math.max.apply(null, ls.map(tw))) + 26), H = 12 + ls.length * 16, y0 = -84 - H;
      brect.setAttribute('x', -W / 2); brect.setAttribute('width', W); brect.setAttribute('y', y0); brect.setAttribute('height', H);
      bt.textContent = '';
      ls.forEach(function (ln, i) { var s = document.createElementNS(NS, 'tspan'); s.setAttribute('x', 0); s.setAttribute('y', y0 + 18 + i * 16); s.textContent = ln; bt.appendChild(s); });
      btail.setAttribute('d', 'M-5,-85 L0,-76 L6,-85');
    }
    function say(t) { setText(t || pickOf(lines)); w.mode = 'talk'; w.wait = 2800; }

    // ---- vetítés megfordítása (affin: három pontból) --------------------------------------------------
    function unproject(sx, sy) {
      var a = o.project(0, 0), b = o.project(1, 0), c = o.project(0, 1);
      var ex = [b[0] - a[0], b[1] - a[1]], ey = [c[0] - a[0], c[1] - a[1]], det = ex[0] * ey[1] - ex[1] * ey[0];
      if (!det) return null;
      var dx = sx - a[0], dy = sy - a[1];
      return [(dx * ey[1] - dy * ey[0]) / det, (ex[0] * dy - ex[1] * dx) / det];
    }
    var box = R.reduce(function (m, p) { return [Math.min(m[0], p[0]), Math.min(m[1], p[1]), Math.max(m[2], p[0]), Math.max(m[3], p[1])]; }, [1e9, 1e9, -1e9, -1e9]);
    function clampPlan(p) { var pad = 0.6 * Math.max(1, (box[2] - box[0]) / 20); return [Math.max(box[0] - pad, Math.min(box[2] + pad, p[0])), Math.max(box[1] - pad, Math.min(box[3] + pad, p[1]))]; }
    function toSvg(cx, cy) {
      var m = svg.getScreenCTM(); if (!m) return null;
      var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; var q = pt.matrixTransform(m.inverse()); return [q.x, q.y];
    }

    // ---- megfogás, húzás, ledobás --------------------------------------------------------------------
    var HANG = 30, FLOOR = 58, pd = null, justDropped = false;
    function onDown(e) {
      if (e.button != null && e.button > 0) return;
      e.stopPropagation();
      pd = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    }
    function onMove(e) {
      if (!pd || e.pointerId !== pd.id) return;
      if (!pd.on && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) < 7) return;
      e.preventDefault();
      if (!pd.on) { pd.on = true; w.next = null; w.fall = null; setText(pickOf(['Hé! Hová viszel?', 'Hopp, repülök!', 'Tegyél le óvatosan!'])); }
      var p = toSvg(e.clientX, e.clientY); if (p) w.hold = p;
    }
    function onUp(e) {
      if (!pd || e.pointerId !== pd.id) return;
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      var was = pd.on; pd = null;
      if (!was || !w.hold) { w.hold = null; return; }
      justDropped = true; setTimeout(function () { justDropped = false; }, 400);
      var land = unproject(w.hold[0], w.hold[1] + FLOOR);
      land = land ? clampPlan(land) : [w.x, w.y];
      w.x = land[0]; w.y = land[1];
      var to = o.project(w.x, w.y);
      w.fall = { a: [w.hold[0], w.hold[1] + HANG], b: to, t: 0, dur: 260 };
      w.hold = null;
      // a legközelebbi útpont felé megy tovább
      var bi = 0, bd = 1e9;
      R.forEach(function (r, i) { var d = Math.hypot(r[0] - w.x, r[1] - w.y); if (d < bd) { bd = d; bi = i; } });
      w.i = (bi - w.dir + n) % n;
    }
    g.addEventListener('pointerdown', onDown);
    g.addEventListener('click', function (e) {
      e.stopPropagation();
      if (justDropped) return;
      if (w.mode === 'sleep') { w.mode = 'wake'; w.wait = 1400; w.next = function () { say(pickOf(wakes)); }; return; }
      if (o.onClick) o.onClick(); say();
    });

    function pick(tag) {
      var r = Math.random();
      if (tag === 'sleep' && r < 0.6) return ['sleep', 9000 + Math.random() * 12000];
      if (r > 0.4) return null;
      r = Math.random();
      if (r < 0.4) return ['sleep', 7000 + Math.random() * 12000];
      if (r < 0.6) return ['look', 2600];
      if (r < 0.78) return ['dance', 2400];
      return 'talk';
    }
    function step(ts) {
      var dt = Math.min(100, ts - (w.last || ts)); w.last = ts;
      if (o.stage.style.transform !== layer.style.transform) layer.style.transform = o.stage.style.transform;
      var hide = o.hidden && o.hidden();
      layer.style.visibility = hide ? 'hidden' : 'visible';
      var p = null, k = 'wk ';
      if (w.hold) { p = [w.hold[0], w.hold[1] + HANG]; k += 'held'; }
      else if (w.fall) {
        var F = w.fall; F.t = Math.min(1, F.t + dt / F.dur); var e2 = F.t * F.t;
        p = [F.a[0] + (F.b[0] - F.a[0]) * e2, F.a[1] + (F.b[1] - F.a[1]) * e2]; k += 'held';
        if (F.t >= 1) { w.fall = null; w.mode = 'thud'; w.wait = 650; w.next = function () { say(pickOf(lands)); }; }
      } else if (w.wait > 0) {
        w.wait -= dt;
        if (w.wait <= 0) { var nx0 = w.next; w.next = null; if (nx0) nx0(); else w.mode = 'walk'; }
      } else {
        var ni = (w.i + w.dir + n) % n, nx = R[ni], dx = nx[0] - w.x, dy = nx[1] - w.y, d = Math.hypot(dx, dy), sp = 22 * dt / 1000;
        if (d <= sp) {
          w.x = nx[0]; w.y = nx[1]; w.i = ni;
          var a = pick(nx[2]);
          if (a === 'talk') say(); else if (a) { w.mode = a[0]; w.wait = a[1]; } else w.mode = 'walk';
          if (Math.random() < 0.25) w.dir = -w.dir;
        } else {
          var p0 = o.project(w.x, w.y);
          w.x += dx / d * sp; w.y += dy / d * sp; w.mode = 'walk';
          var p1 = o.project(nx[0], nx[1]);
          // irányváltás csak egyértelmű vízszintes mozgásnál (különben szinte függőleges szakaszon villogna)
          var hx = p1[0] - p0[0], hy = p1[1] - p0[1];
          if (Math.abs(hx) > 0.35 * Math.abs(hy) && Math.abs(hx) > 2) w.face = hx > 0 ? 1 : -1;
        }
      }
      if (!p) { p = o.project(w.x, w.y); k += w.mode; }
      g.setAttribute('transform', 'translate(' + p[0].toFixed(2) + ',' + p[1].toFixed(2) + ')');
      if (g.getAttribute('class') !== k) g.setAttribute('class', k);
      // kézben: a padlón árnyék mutatja, hová huppan
      if (w.hold) { drop.setAttribute('cx', Math.round(w.hold[0])); drop.setAttribute('cy', Math.round(w.hold[1] + FLOOR)); drop.setAttribute('opacity', '0.22'); }
      else if (drop.getAttribute('opacity') !== '0') drop.setAttribute('opacity', '0');
      wf.setAttribute('transform', 'scale(' + w.face + ',1)');
      var h = o.href ? o.href() : '#adv-v1';
      if (use.getAttribute('href') !== h) use.setAttribute('href', h);
      tick();
    }
    // A kijelző frissítéséhez igazítva (egyenletes, nem rángat); rejtett lapon a böngésző szünetelteti,
    // a nagy időugrást a dt-korlát fogja meg. Ha nincs requestAnimationFrame, 60 Hz-es időzítő.
    var raf = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
    function tick() { raf(step); }
    tick();
    return { state: w, layer: layer, say: say };
  }
  root.F27Walker = { start: start };
})(typeof window !== 'undefined' ? window : this);
