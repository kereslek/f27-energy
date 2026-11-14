/* Sétáló tanácsadó a térképen (F27: a zöld szék; minden jövőbeli dashboard is használhatja).
   Saját rétegben fut a színpad (#stage) fölött, és minden képkockában átveszi annak nagyítását és
   eltolását, így a MiniDC újrarajzolása nem zavarja. Útvonal: alaprajzi pontok (a jelenet egységeiben),
   amelyeken oda-vissza sétál; útközben véletlenszerűen megáll, szundít, körülnéz, ugrál vagy táncol.

   F27Walker.start({
     stage: HTMLElement,                          // a színpad (a réteg ennek a transzformációját követi)
     project: function (x, y) -> [sx, sy],        // alaprajzi pont -> színpadkoordináta (1440 x 900)
     href: function () -> '#symbol',              // a figura SVG-szimbóluma (72 x 88)
     route: [[x, y, 'sleep'|'sit'|null], ...],
     hidden: function () -> bool,                 // pl. nyitott párbeszédablak alatt elrejti
     onClick: function () {}, name: 'Energiaőr', lines: ['…'] }                                          */
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
    css.textContent = '@keyframes wkhop{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-7px) rotate(4deg)}}' +
      '@keyframes wkdance{0%,100%{transform:scaleX(1)}25%{transform:scaleX(-1)}50%{transform:scaleX(1) translateY(-6px)}75%{transform:scaleX(-1)}}' +
      '@keyframes wklook{0%,100%{transform:rotate(0)}30%{transform:rotate(-12deg)}70%{transform:rotate(12deg)}}' +
      '@keyframes wkzz{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(10px,-28px);opacity:0}}' +
      '@keyframes wkpop{0%{transform:scale(.6);opacity:0}15%{transform:scale(1.05);opacity:1}85%{opacity:1}100%{opacity:0}}' +
      '#walkerlayer .wb{transform-box:fill-box;transform-origin:50% 100%}' +
      '#walkerlayer .walk .wb{animation:wkhop .45s ease-in-out infinite}' +
      '#walkerlayer .dance .wb{animation:wkdance 1.2s ease-in-out infinite}' +
      '#walkerlayer .look .wb{animation:wklook 2.2s ease-in-out infinite}' +
      '#walkerlayer .sleep .wb{transform:rotate(-14deg) translateY(4px)}' +
      '#walkerlayer .zz,#walkerlayer .bub{display:none}' +
      '#walkerlayer .sleep .zz{display:inline;animation:wkzz 2.4s ease-out infinite}' +
      '#walkerlayer .sleep .zz.b{animation-delay:1.2s}' +
      '#walkerlayer .talk .bub{display:inline;transform-box:fill-box;transform-origin:50% 100%;animation:wkpop 2.8s ease-out}';
    document.head.appendChild(css);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '1440'); svg.setAttribute('height', '900'); svg.setAttribute('viewBox', '0 0 1440 900');
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
    svg.innerHTML = '<g class="wk" style="pointer-events:auto;cursor:pointer"><title>' + (o.name || 'Tanácsadó') + ' sétál a lakásban. Kattints rá!</title>' +
      '<ellipse cx="0" cy="0" rx="22" ry="6" fill="#1e2a44" opacity=".22"></ellipse>' +
      '<g class="wf"><g class="wb"><use width="58" height="71" x="-29" y="-69"></use></g></g>' +
      '<text class="zz a" x="18" y="-70" font-family="Lilita One, sans-serif" font-size="14" fill="#fff7e6" stroke="#1e2a44" stroke-width="3" paint-order="stroke">z</text>' +
      '<text class="zz b" x="26" y="-78" font-family="Lilita One, sans-serif" font-size="12" fill="#fff7e6" stroke="#1e2a44" stroke-width="3" paint-order="stroke">z</text>' +
      '<g class="bub"><rect x="-66" y="-112" width="132" height="28" rx="12" fill="#fffdf7" stroke="#1e2a44" stroke-width="2.5"></rect>' +
      '<path d="M-5,-85 L0,-76 L6,-85" fill="#fffdf7" stroke="#1e2a44" stroke-width="2.5" stroke-linejoin="round"></path>' +
      '<text class="bt" x="0" y="-93" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="900" font-size="13" fill="#1e2a44"></text></g></g>';
    layer.appendChild(svg);
    var g = svg.querySelector('.wk'), use = svg.querySelector('use'), wf = svg.querySelector('.wf'), bt = svg.querySelector('.bt');
    g.addEventListener('click', function () { if (o.onClick) o.onClick(); say(); });
    var R = o.route, n = R.length, w = { i: 0, x: R[0][0], y: R[0][1], mode: 'sleep', wait: 3000, dir: 1, face: 1, last: 0 };
    var lines = o.lines || ['Hahó!', 'Takarékosan!', 'Minden rendben?', 'Nézzük a kályhát!', 'Csukd be az ablakot!'];
    function say() { bt.textContent = lines[Math.floor(Math.random() * lines.length)]; w.mode = 'talk'; w.wait = 2800; }
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
      if (w.wait > 0) { w.wait -= dt; if (w.wait <= 0) w.mode = 'walk'; }
      else {
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
          if (Math.abs(p1[0] - p0[0]) > 0.5) w.face = p1[0] > p0[0] ? 1 : -1;
        }
      }
      var p = o.project(w.x, w.y);
      g.setAttribute('transform', 'translate(' + Math.round(p[0] * 10) / 10 + ',' + Math.round(p[1] * 10) / 10 + ')');
      if (g.getAttribute('class') !== 'wk ' + w.mode) g.setAttribute('class', 'wk ' + w.mode);
      wf.setAttribute('transform', 'scale(' + w.face + ',1)');
      var h = o.href ? o.href() : '#adv-v1';
      if (use.getAttribute('href') !== h) use.setAttribute('href', h);
      tick();
    }
    // 20 képkocka/mp elég a sétához, és a nagy időugrásoknál (alvó lap, tesztek) sem halmozódik fel
    function tick() { setTimeout(function () { step(Date.now()); }, 50); }
    tick();
    return { state: w, layer: layer };
  }
  root.F27Walker = { start: start };
})(typeof window !== 'undefined' ? window : this);
