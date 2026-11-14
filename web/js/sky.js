/* Égbolt minden térképhez (F27, O2B és a későbbiek): a nap és a hold helye az égen, a hold fázisa,
   és a nap mai útja keléstől nyugvásig. Hálózat nélkül, a böngészőben számol.

   A hold helye és fázisa a SunCalc (Vladimir Agafonkin, BSD) egyszerűsített képleteivel, kb. 1 fokos
   pontossággal; a naphoz a web/js/sun.js (F27Sun) NOAA-közelítése.

   F27Sky.bodies(ms, lat, lon, viewAz, box?) -> {
     sun:  { x, y, alt, az, up },                      // a 1440 x 900-as égbolt képernyő-koordinátái
     moon: { x, y, r, alt, az, up, phase, fraction, waxing, name, dark, lit },
     track: SVG útvonal a nap mai útjáról (kelet felől nyugat felé) }
   viewAz: az az égtáj (fok, É=0, K=90), amerre a néző néz (a képernyő "befelé", azaz felfelé mutató iránya).
   F27Sky.moonPath(cx, cy, r, phase) -> a megvilágított rész SVG útvonala.                                 */
(function (root) {
  'use strict';
  var RAD = Math.PI / 180, DAY = 864e5, J2000 = 2451545, E = RAD * 23.4397;
  var W = 1440, CX = 720, HORIZON = 470, ALT_K = 5.4, SPAN = 640;

  function toDays(ms) { return ms / DAY - 0.5 + 2440588 - J2000; }
  function ra(l, b) { return Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l)); }
  function dec(l, b) { return Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l)); }
  function sidereal(d, lw) { return RAD * (280.16 + 360.9856235 * d) - lw; }
  function sunCoords(d) {
    var M = RAD * (357.5291 + 0.98560028 * d);
    var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + RAD * 102.9372 + Math.PI;
    return { dec: dec(L, 0), ra: ra(L, 0) };
  }
  function moonCoords(d) {
    var L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.229350 * d);
    var l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
    return { ra: ra(l, b), dec: dec(l, b), dist: dt };
  }
  function moonPos(ms, lat, lon) {
    var lw = RAD * -lon, phi = RAD * lat, d = toDays(ms), c = moonCoords(d), H = sidereal(d, lw) - c.ra;
    var h = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
    h += RAD * 0.017 / Math.tan(h + RAD * 10.26 / (h + RAD * 5.10));   // fénytörés
    return { alt: h / RAD, az: (az / RAD + 180 + 360) % 360 };
  }
  function moonIllum(ms) {
    var d = toDays(ms), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    var phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    var angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
  }
  function phaseName(p) {
    if (p < 0.03 || p > 0.97) return 'újhold';
    if (p < 0.22) return 'növekvő sarló';
    if (p < 0.28) return 'első negyed';
    if (p < 0.47) return 'növekvő hold';
    if (p < 0.53) return 'telihold';
    if (p < 0.72) return 'fogyó hold';
    if (p < 0.78) return 'utolsó negyed';
    return 'fogyó sarló';
  }
  // a megvilágított rész: külső félkör a fényes oldalon + a terminátor (ellipszis-ív)
  function moonPath(cx, cy, r, p) {
    var waxing = p < 0.5, k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * r;
    var outer = waxing ? 1 : 0, term = k > 0 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
    function f(n) { return Math.round(n * 10) / 10; }
    return 'M' + f(cx) + ',' + f(cy - r) + ' A' + f(r) + ',' + f(r) + ' 0 0 ' + outer + ' ' + f(cx) + ',' + f(cy + r) +
      ' A' + f(Math.max(rx, 0.01)) + ',' + f(r) + ' 0 0 ' + term + ' ' + f(cx) + ',' + f(cy - r) + ' Z';
  }
  // égtáj + magasság -> a 1440 x 900-as égbolt pontja (a néző iránya középen)
  function project(az, alt, viewAz, box) {
    var rel = ((az - viewAz) % 360 + 540) % 360 - 180;           // -180..180, + jobbra
    var cx = box ? (box.x0 + box.x1) / 2 : CX, span = box ? (box.x1 - box.x0) / 2 : SPAN;
    var x = cx + Math.max(-1, Math.min(1, rel / 180)) * span;
    var hz = box && box.horizon != null ? box.horizon : HORIZON, k = box && box.altK != null ? box.altK : ALT_K;
    return { x: x, y: hz - Math.max(-6, alt) * k, rel: rel };
  }
  // box: { x0, x1, horizon?, altK? } a szabad égbolt sávja (pl. a F27-ben a két oldalsó panel között, a ház fölött)
  function bodies(ms, lat, lon, viewAz, box) {
    var SUN = root.F27Sun, sp = SUN ? SUN.pos(ms, lat, lon) : { az: 180, alt: 30 }, out = {};
    var s = project(sp.az, sp.alt, viewAz, box);
    out.sun = { x: s.x, y: s.y, alt: sp.alt, az: sp.az, up: sp.alt > -1 };
    var mp = moonPos(ms, lat, lon), mi = moonIllum(ms), m = project(mp.az, mp.alt, viewAz, box), r = 24;
    out.moon = { x: m.x, y: m.y, r: r, alt: mp.alt, az: mp.az, up: mp.alt > -1, phase: mi.phase, fraction: mi.fraction,
      waxing: mi.phase < 0.5, name: phaseName(mi.phase), lit: moonPath(m.x, m.y, r, mi.phase) };
    // a nap mai útja (20 percenként keléstől nyugvásig), a látóhatár fölött
    var t = SUN ? SUN.times(ms, lat, lon) : null, d = '';
    if (t && t.rise && t.set) {
      for (var tm = t.rise; tm <= t.set + 1; tm += 20 * 60000) {
        var q = SUN.pos(Math.min(tm, t.set), lat, lon), pp = project(q.az, Math.max(0, q.alt), viewAz, box);
        d += (d ? 'L' : 'M') + Math.round(pp.x) + ',' + Math.round(pp.y);
      }
      out.rise = t.rise; out.set = t.set;
    }
    out.track = d;
    return out;
  }
  // a képernyő "fel" iránya melyik égtáj: northAng = az észak iránya a képernyő tetejétől, óramutató szerint
  function viewAzFromNorth(northAng) { return ((-northAng) % 360 + 360) % 360; }

  root.F27Sky = { bodies: bodies, moonPath: moonPath, moonPos: moonPos, moonIllum: moonIllum, phaseName: phaseName,
    project: project, viewAzFromNorth: viewAzFromNorth, W: W, HORIZON: HORIZON };
})(typeof window !== 'undefined' ? window : this);
