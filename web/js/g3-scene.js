/*
 * F27 Energy Quest, G3 jelenet: a lakás izometrikus diorámája, a bútorok, az eszköztűk,
 * a szintek, a power-upok és a küldetések adatai. A Claude Design vásznon készült G3
 * mockup logikája, változtatás nélkül (csak az ősosztály a saját MiniDC.Component).
 * Az élő adat, a bejelentkezés és az elrendezések az app.js-ben vannak.
 */
// A világ (lakás) helye és mérete a 1440x900-as színpadon; a sablon <g transform>-jával egyezzen.
var WX0 = 756, WY0 = 134, WS = 0.82;
class G3Scene extends MiniDC.Component {
  // A déli sáv (y >= 452.4: konyha, előszoba, WC, tároló) a jobb láthatóságért nyugat felé
  // 60%-kal nyújtva (a tulaj kérése): x' = 333 - (333 - x) * 1.6, a 333-as faltól keletre változatlan.
  wx(x, y) { return y >= 452.4 && x < 333 ? 333 - (333 - x) * 1.6 : x; }
  P(x, y, z) { var w = this.wx(x, y); return [w - y, (w + y) / 2 - (z || 0)]; }

  scene() {
    if (this._sc) return this._sc;
    var self = this;
    function P(x, y, z) { return self.P(x, y, z); }
    function r1(n) { return Math.round(n * 10) / 10; }
    function pts(a) { return a.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' '); }
    function pth(a) { return 'M' + a.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join('L') + 'Z'; }
    function seg(a, b) { return 'M' + r1(a[0]) + ',' + r1(a[1]) + 'L' + r1(b[0]) + ',' + r1(b[1]); }
    function tr(x, y, z) { var p = P(x, y, z); return 'translate(' + r1(p[0]) + ',' + r1(p[1]) + ')'; }
    function quad(x0, y0, x1, y1, z) { return pts([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)]); }
    function faceY(y, x0, x1, z0, z1) { return pth([P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)]); }
    function faceX(x, y0, y1, z0, z1) { return pth([P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)]); }
    function box(x0, y0, w, d, z, h, c, ex) {
      var x1 = x0 + w, y1 = y0 + d, zt = z + h;
      var o = {
        key: x0 + w / 2 + y0 + d / 2,
        top: pts([P(x0, y0, zt), P(x1, y0, zt), P(x1, y1, zt), P(x0, y1, zt)]),
        left: pts([P(x0, y1, z), P(x1, y1, z), P(x1, y1, zt), P(x0, y1, zt)]),
        right: pts([P(x1, y0, z), P(x1, y1, z), P(x1, y1, zt), P(x1, y0, zt)]),
        ct: c[0], cl: c[1], cr: c[2], lines: '', lc: 'none', f1: '', f1c: 'none', f1cls: '', f1f: '', sw: 1.8
      };
      if (ex) { for (var k in ex) { if (k === 'bias') o.key += ex.bias; else o[k] = ex[k]; } }
      return o;
    }
    function grid(x0, y0, w, d, z, h, nx, ny, nz) {
      var x1 = x0 + w, y1 = y0 + d, s = '', i;
      for (i = 1; i < nx; i++) { var x = x0 + w * i / nx; s += seg(P(x, y1 + 0.2, z), P(x, y1 + 0.2, z + h)); }
      for (i = 1; i < ny; i++) { var y = y0 + d * i / ny; s += seg(P(x1 + 0.2, y, z), P(x1 + 0.2, y, z + h)); }
      for (i = 1; i < nz; i++) { var zz = z + h * i / nz; s += seg(P(x0, y1 + 0.2, zz), P(x1, y1 + 0.2, zz)) + seg(P(x1 + 0.2, y0, zz), P(x1 + 0.2, y1, zz)); }
      return s;
    }

    // Belmagasság: 3,75 m (a tulaj, a fotók szerint magas ablakokkal). A falak eddig 74 egység
    // magasak voltak (kb. 1,8 m), a kályha (106) fölébük nőtt; a bútorok léptékéhez (kb. 30/m) igazítva.
    var WH = 112;
    var stars = [], seed = 7, i;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (i = 0; i < 46; i++) stars.push({ x: r1(rnd() * 1440), y: r1(90 + rnd() * 250), r: r1(0.8 + rnd() * 1.6), d: r1(rnd() * 3) + 's' });

    var city = 'M0,430 ', cityWin = '', x = 0, hs = [62, 88, 54, 104, 70, 120, 58, 92, 76, 66, 110, 60, 84, 72, 98, 64];
    for (i = 0; x < 1440; i++) {
      var h = hs[i % hs.length], w = 70 + (i % 3) * 18;
      if (i === 3) city += 'L' + x + ',' + (430 - h) + ' L' + (x + 14) + ',' + (430 - h) + ' A' + (w / 2 - 14) + ',' + (w / 2 - 14) + ' 0 0 1 ' + (x + w - 14) + ',' + (430 - h) + ' L' + (x + w) + ',' + (430 - h) + ' ';
      else if (i === 6) city += 'L' + x + ',' + (430 - h) + ' L' + (x + w / 2 - 6) + ',' + (430 - h) + ' L' + (x + w / 2) + ',' + (430 - h - 54) + ' L' + (x + w / 2 + 6) + ',' + (430 - h) + ' L' + (x + w) + ',' + (430 - h) + ' ';
      else city += 'L' + x + ',' + (430 - h) + ' L' + (x + w / 2) + ',' + (430 - h - 16) + ' L' + (x + w) + ',' + (430 - h) + ' ';
      for (var wy = 430 - h + 10; wy < 420; wy += 16) for (var wx = x + 10; wx < x + w - 14; wx += 18) if (rnd() > 0.45) cityWin += 'M' + wx + ',' + wy + 'h7v8h-7z';
      x += w;
    }
    city += 'L1440,430 L1440,900 L0,900 Z';

    var road = pts([P(232, -76, 0), P(500, -76, 0), P(500, -4, 0), P(232, -4, 0)]);
    var roadLine = seg(P(236, -40, 0), P(496, -40, 0));
    var walk = pts([P(232, -4, 0), P(500, -4, 0), P(500, 44, 0), P(232, 44, 0)]);
    var trees = [258, 318, 378, 438].map(function (tx) { return { tr: tr(tx, 12, 0) }; });
    var lamps = [288, 408].map(function (lx) { return { tr: tr(lx, 30, 0) }; });

    var SL = ['#e9b072', '#c97f4a', '#a8653a'];
    var slab = [
      box(276, 44, 203, 290, -26, 26, SL, { lines: seg(P(276, 334.2, -9), P(479, 334.2, -9)), lc: '#8a5530' }),
      box(176, 452.5, 79, 143.5, -26, 26, SL, { lines: seg(P(176, 596.2, -9), P(255, 596.2, -9)), lc: '#8a5530' }),
      box(251, 326, 228, 126.3, -26, 26, SL, { lines: seg(P(479.2, 326, -9), P(479.2, 452.3, -9)), lc: '#8a5530' }),
      box(251, 452.5, 228, 143.5, -26, 26, SL, { lines: seg(P(251, 596.2, -9), P(479, 596.2, -9)) + seg(P(479.2, 452.5, -9), P(479.2, 596, -9)), lc: '#8a5530' })
    ];

    function ell(cx, cy, rx, ry, z) { var a = []; for (var k = 0; k < 18; k++) { var t = k / 18 * Math.PI * 2; a.push(P(cx + rx * Math.cos(t), cy + ry * Math.sin(t), z)); } return pth(a); }
    var rooms = [
      [280, 48, 475, 328, '#9a6c46', '#74502f', 'herr'],
      [255, 328, 333, 452.4, '#e3d6c1', '#8d7c69', 'patch'],
      [333, 328, 475, 592, '#9a6c46', '#74502f', 'herr'],
      [255, 452.4, 288, 505, '#e3d6c1', '#8d7c69', 'patch'],
      [288, 452.4, 333, 505, '#a8744a', '#7a5032', 'wood'],
      [255, 505, 333, 592, '#9a6c46', '#74502f', 'herr'],
      [180, 455, 255, 592, '#6e4b39', '#4b3326', 'dtile']
    ];
    var PATCHC = ['#e6dac6', '#b9c5cb', '#a98c74', '#d4c5ad', '#cbd3d6', '#9d806a', '#efe7d8'];
    var floors = [], checks = [];
    rooms.forEach(function (r) {
      var lines = '', yy, xx, s;
      if (r[6] === 'herr') {
        // vékony, százéves halszálka parketta: 45 fokos lécek, oszloponként váltott irány, fél léccel eltolva
        var hw = 5, pitch = 2.6, col = 0;
        for (xx = r[0]; xx < r[2] - 0.1; xx += hw, col++) {
          var xe = Math.min(xx + hw, r[2]), dx = xe - xx, odd = col % 2 === 1;
          lines += seg(P(xe, r[1], 0), P(xe, r[3], 0));
          for (yy = r[1] - hw + (odd ? pitch / 2 : 0); yy < r[3]; yy += pitch) {
            var ya = odd ? yy + dx : yy, yb = odd ? yy : yy + dx;
            var t0 = 0, t1 = 1;
            if (ya < r[1]) t0 = Math.max(t0, (r[1] - ya) / (yb - ya)); if (yb < r[1]) t1 = Math.min(t1, (r[1] - ya) / (yb - ya));
            if (ya > r[3]) t0 = Math.max(t0, (r[3] - ya) / (yb - ya)); if (yb > r[3]) t1 = Math.min(t1, (r[3] - ya) / (yb - ya));
            if (t1 > t0) lines += seg(P(xx + dx * t0, ya + (yb - ya) * t0, 0), P(xx + dx * t1, ya + (yb - ya) * t1, 0));
            if (rnd() < 0.13 && Math.min(ya, yb) > r[1] + 0.5 && Math.max(ya, yb) + pitch < r[3] - 0.5 && dx > 1.5) {
              var ly = function (x) { return ya + (yb - ya) * (x - xx) / dx; };
              var xa = xx + 0.5, xb = xe - 0.5;
              checks.push({ p: pts([P(xa, ly(xa) + 0.35, 0), P(xb, ly(xb) + 0.35, 0), P(xb, ly(xb) + pitch - 0.35, 0), P(xa, ly(xa) + pitch - 0.35, 0)]), f: rnd() < 0.5 ? '#ab7c52' : '#a3744b' });
            }
          }
        }
      } else if (r[6] === 'wood') {
        for (yy = r[1] + 8; yy < r[3]; yy += 8) lines += seg(P(r[0], yy, 0), P(r[2], yy, 0));
      } else if (r[6] === 'dtile') {
        for (yy = r[1] + 12.5; yy < r[3]; yy += 12.5) lines += seg(P(r[0], yy, 0), P(r[2], yy, 0));
        for (xx = r[0] + 12.5; xx < r[2]; xx += 12.5) lines += seg(P(xx, r[1], 0), P(xx, r[3], 0));
      } else {
        s = 9.75;
        for (var a = 0; r[0] + a * s < r[2] - 0.1; a++) for (var b = 0; r[1] + b * s < r[3] - 0.1; b++) {
          checks.push({ p: quad(r[0] + a * s, r[1] + b * s, Math.min(r[0] + (a + 1) * s, r[2]), Math.min(r[1] + (b + 1) * s, r[3]), 0), f: PATCHC[Math.floor(rnd() * PATCHC.length)] });
        }
        for (yy = r[1] + s; yy < r[3]; yy += s) lines += seg(P(r[0], yy, 0), P(r[2], yy, 0));
        for (xx = r[0] + s; xx < r[2]; xx += s) lines += seg(P(xx, r[1], 0), P(xx, r[3], 0));
      }
      floors.push({ p: quad(r[0], r[1], r[2], r[3], 0), fill: r[4], lc: r[5], lines: lines });
    });
    var rugs = [
      // nagy, krémszínű, halvány mintás szőnyeg a nagy szobában: a sarokkanapétól az ágy felé, a dohányzóasztal alatt
      { p: quad(356, 84, 446, 160, 0.4), p2: quad(361, 89, 441, 155, 0.6), fill: '#efe8d6', edge: '#b9ad92' },
      { p: quad(372, 100, 430, 144, 0.5), p2: quad(377, 105, 425, 139, 0.7), fill: '#e6dcc4', edge: '#c9bfa6' },
      { p: quad(264, 522, 290, 576, 0.4), p2: quad(267, 525, 287, 573, 0.6), fill: '#b8c0c7', edge: '#eef1f3' }
    ];

    var WB = ['#6a4c38', '#f6e7c8', '#ead3a6'];
    var subway = '', zz, yb, rw = 0;
    for (zz = 28; zz < WH; zz += 4, rw++) {
      subway += seg(P(257.8, 330, zz), P(257.8, 452, zz));
      for (yb = 330 + (rw % 2) * 4; yb < 452; yb += 8) subway += seg(P(257.8, yb, zz), P(257.8, yb, Math.min(zz + 4, WH)));
    }
    var ktile = '';
    for (zz = 22; zz <= 46; zz += 6) ktile += seg(P(182.8, 457.5, zz), P(182.8, 592, zz));
    for (yb = 462; yb < 592; yb += 12) ktile += seg(P(182.8, yb, 22), P(182.8, yb, 46));
    var damask = '';
    for (var dz = 30, dr = 0; dz < WH - 2; dz += 9, dr++) for (var dy = 156 + (dr % 2) * 7; dy < 278; dy += 14) {
      var c0 = P(282.8, dy, dz), c1 = P(282.8, dy + 3, dz + 3.2), c2 = P(282.8, dy + 6, dz), c3 = P(282.8, dy + 3, dz - 3.2);
      damask += 'M' + r1(c0[0]) + ',' + r1(c0[1]) + 'Q' + r1(c1[0] - 2) + ',' + r1(c1[1] - 1) + ' ' + r1(c2[0]) + ',' + r1(c2[1]) + 'Q' + r1(c3[0] + 2) + ',' + r1(c3[1] + 1) + ' ' + r1(c0[0]) + ',' + r1(c0[1]);
    }
    var back = [
      box(277.5, 45.5, 5, 285, 0, WH, WB, { lines: seg(P(282.8, 46, 24), P(282.8, 330, 24)) + damask, lc: '#d9bd8a' }),
      box(277.5, 45.5, 200, 5, 0, WH, WB, { lines: seg(P(282, 50.8, 24), P(477, 50.8, 24)), lc: '#d9bd8a' }),
      box(252.5, 325.5, 27.5, 5, 0, WH, WB),
      box(252.5, 325.5, 5, 126.8, 0, WH, ['#6a4c38', '#ffffff', '#f2f4f5'], { lines: subway, lc: '#cfd6da' }),
      box(177.5, 452.5, 77.5, 5, 0, WH, WB),
      box(177.5, 452.5, 5, 142, 0, WH, WB, { lines: ktile, lc: '#d9c39a' })
    ];
    var winsBase = [[305, 350], [405, 460]].map(function (w) {
      var m = (w[0] + w[1]) / 2, yf = 50.9;
      // magas, kétszárnyú fa ablak felülvilágítóval: párkány kb. 0,9 m, teteje kb. 3,3 m
      return { glass: faceY(yf, w[0], w[1], 26, 100),
        frame: seg(P(m, yf, 26), P(m, yf, 100)) + seg(P(w[0], yf, 76), P(w[1], yf, 76)) + seg(P(w[0], yf, 73.5), P(w[1], yf, 73.5)),
        shine: seg(P(w[0] + 5, yf, 34), P(w[0] + 14, yf, 66)) + seg(P(w[0] + 5, yf, 82), P(w[0] + 10, yf, 94)) };
    });

    var WI = ['#6a4c38', '#f6e7c8', '#e3cb9c'];
    function walls(axis, line, a, b, gaps) {
      var T = 5, SEG = 22, out = [], r = [[a, b]];
      (gaps || []).forEach(function (g) {
        var n = [];
        r.forEach(function (s) {
          if (g[1] <= s[0] || g[0] >= s[1]) n.push(s);
          else { if (g[0] - s[0] > 0.5) n.push([s[0], g[0]]); if (s[1] - g[1] > 0.5) n.push([g[1], s[1]]); }
        });
        r = n;
      });
      r.forEach(function (s) {
        for (var u = s[0]; u < s[1] - 0.01; u += SEG) {
          var v = Math.min(s[1], u + SEG);
          if (axis === 'x') out.push(box(u, line - T / 2, v - u, T, 0, 20, WI));
          else out.push(box(line - T / 2, u, T, v - u, 0, 20, WI));
        }
      });
      return out;
    }
    var W = [];
    W = W.concat(walls('x', 328, 280, 475, [[288, 318], [362, 412]]));
    W = W.concat(walls('y', 333, 328, 592, [[552, 584]]));
    W = W.concat(walls('x', 455, 255, 333));
    // a fürdő északi fala (a nagy szoba / kályha felé) feltűnően vastag: a fürdő belseje rövidebb
    var THICK = ['#6a4c38', '#ffffff', '#f2f4f5'];
    var thickSub = '';
    for (var tz = 28; tz < WH; tz += 4) thickSub += seg(P(260, 337.7, tz), P(280, 337.7, tz));
    W.push(box(257.5, 330.5, 22.5, 7, 0, WH, THICK, { lines: thickSub, lc: '#cfd6da' }));
    W.push(box(280, 330.5, 8, 7, 0, 20, WI));
    W.push(box(318, 330.5, 15, 7, 0, 20, WI));
    W.push(box(288, 330.5, 30, 7, 0, 0.6, ['#c8b79a', '#a8946f', '#977f5c']));
    W = W.concat(walls('y', 288, 455, 505));
    W = W.concat(walls('x', 505, 255, 333, [[259, 284], [294, 326]]));
    W = W.concat(walls('y', 255, 452.5, 592, [[520, 560]]));

    var WOOD = ['#d99b5e', '#a8703f', '#8c5c33'];
    var WALNUT = ['#7a4f2e', '#5e3c22', '#4d311c'];
    var CREAM = ['#fff7e6', '#e6d8bc', '#d4c4a3'];
    var WHITE = ['#ffffff', '#e4e6ea', '#cfd3d9'];
    var CAB = ['#fbfaf6', '#e8e4da', '#d6d1c4'];
    var DKTOP = ['#5a3d2c', '#432c1f', '#372418'];
    var DKWOOD = ['#4a3324', '#36241a', '#2b1d14'];
    var BENT = ['#5a3a24', '#432a19', '#362114'];
    var CANE = ['#e2bf85', '#c9a066', '#b48c55'];
    var THROW = ['#f4efe4', '#ddd5c4', '#cbc2ae'];
    var LINEN = ['#fbf8f1', '#e3dccb', '#d2c9b4'];
    var GSOFA = ['#e2e5e7', '#c5cbcf', '#b0b7bc'];
    var GSOFA2 = ['#d3d8dc', '#b4bcc2', '#9fa8af'];
    var GCUSH = ['#c7ced3', '#aab3b9', '#97a1a8'];
    var LSOFA = ['#bcc3c9', '#98a1a9', '#838d96'];     // a sarokkanapé: középszürke, hogy jól látsszon
    var LCUSH = ['#a5aeb6', '#869098', '#727c86'];
    var SAGE = ['#a9c1a0', '#8eaa86', '#7c9775'];
    var SAGEC = ['#a3bd9c', '#89a682', '#77936f'];
    var STOVE = ['#8e3e30', '#702b21', '#5c221a'];
    var STOVED = ['#6e2c22', '#56211a', '#471b15'];
    var STOVEL = ['#a8523f', '#8a3f30', '#743326'];
    var IRON = ['#3a3532', '#26221f', '#1c1916'];
    var GCHAIR = ['#4fae4f', '#2f8a3a', '#25702f'];
    var RATTAN = ['#e0b56e', '#c2924c', '#a97c3e'];
    var GLASSG = ['#6cc2a6', '#45a084', '#33846c'];
    var SILVER = ['#eef0f2', '#c3c8ce', '#a9afb6'];
    var GOLD = ['#f0cf6a', '#c9a03a', '#a8822a'];
    var CLOTH = ['#f7f2e3', '#e3d9c0', '#d3c7aa'];
    var MAT = ['#cbc8c2', '#b0aca5', '#9e9a93'];
    var PATCHS = ['#ffffff', '#cbb9a2', '#b5c1c7'];
    var BLUEC = ['#c3dcf0', '#9cc0de', '#86abcb'];
    var IVY = ['#6dbb5a', '#4f9a40', '#3f8233'];
    var LSHADE = ['#efe6d2', '#d8cbb0', '#c4b697'];
    var GSHADE = ['#e4e0d8', '#c9c4b9', '#b5afa3'];
    var STEEL = ['#b8bec8', '#8f96a3', '#7a818e'];
    var BLACK = ['#3a3532', '#26221f', '#1c1916'];
    var LAMP = ['#fff0b3', '#ffd060', '#e8b440'];
    var BOOKS = [['#3f6fb5', '#2f5791', '#26487a'], ['#c94a3c', '#a23a2e', '#8a3126'], ['#3f9a5a', '#2f7a45', '#26663a'], ['#e8c46a', '#c9a24a', '#b08d3e'], ['#6b5aa8', '#544588', '#463a72']];

    var pieces = [], cur = null;
    function piece(id, name, drag) { cur = { id: id, name: name, drag: drag !== false, boxes: [] }; pieces.push(cur); }
    function add(x0, y0, w, d, z, h, c, ex) { cur.boxes.push(box(x0, y0, w, d, z, h, c, ex)); }
    function legs4(x0, y0, w, d, h, c, t) { t = t || 2; add(x0, y0, t, t, 0, h, c); add(x0 + w - t, y0, t, t, 0, h, c); add(x0, y0 + d - t, t, t, 0, h, c); add(x0 + w - t, y0 + d - t, t, t, 0, h, c); }

    // NAGY SZOBA
    piece('curt', 'Zsályazöld lenfüggönyök', false);
    [[305, 350], [405, 460]].forEach(function (w) {
      add(w[0] - 8, 48.2, w[1] - w[0] + 16, 1.6, 104, 1.6, BLACK);
      add(w[0] - 8, 50, 6, 3, 1, 103, SAGEC, { bias: 1, lines: seg(P(w[0] - 5, 53.2, 3), P(w[0] - 5, 53.2, 102)), lc: '#6f8a69' });
      add(w[1] + 2, 50, 6, 3, 1, 103, SAGEC, { bias: 1, lines: seg(P(w[1] + 5, 53.2, 3), P(w[1] + 5, 53.2, 102)), lc: '#6f8a69' });
    });

    // Thonet hintaszék (a fotók szerint): nem a sarokban, hanem a bal (9-es) ablak elé húzva, a szoba
    // felé fordítva. Hajlított fa: ívelt talpak, csigavonalas karfa, hátrahajló támla, nádfonat, krém párna.
    piece('rock', 'Thonet hintaszék, a bal ablak előtt');
    (function () {
      var cx = 318, cy = 76, fa = 1.05, fx = Math.cos(fa), fy = Math.sin(fa), NONE = ['none', 'none', 'none'];
      function W(u, v, z) { return [cx + u * fx - v * fy, cy + u * fy + v * fx, z]; }
      function Pw(u, v, z) { var w = W(u, v, z); return P(w[0], w[1], w[2]); }
      // ívelt fa szalag a (u, z) síkban, t vastagsággal
      function ribbon(pts, v, t) {
        var A = [], B = [];
        pts.forEach(function (q, k) {
          var a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
          var du = b[0] - a[0], dz = b[1] - a[1], l = Math.sqrt(du * du + dz * dz) || 1, nu = -dz / l * t / 2, nz = du / l * t / 2;
          A.push(Pw(q[0] + nu, v, q[1] + nz)); B.unshift(Pw(q[0] - nu, v, q[1] - nz));
        });
        return pth(A.concat(B));
      }
      function part(u, v, d, ex) { var w = W(u, v, 0); add(w[0] - 0.5, w[1] - 0.5, 1, 1, 0, 0.1, NONE, Object.assign({ sw: 0, lc: '#1e2a44' }, ex, { bias: d })); }
      var runner = [], k;
      for (k = 0; k <= 12; k++) { var uu = -14 + k * 27 / 12; runner.push([uu, 0.016 * uu * uu + 1]); }
      var front = [[8.5, 1.6], [8, 7], [7.2, 12.5], [7.5, 17], [5.5, 21.5], [1, 22.5], [-4, 22], [-7.5, 20.5]];
      var back = [[-6, 1.4], [-7, 7], [-8.4, 13], [-9.6, 22], [-10.8, 31], [-11.4, 38], [-10, 41.5], [-8, 40.5]];
      var curl = [[5.5, 21.5], [8, 20.5], [8.4, 18], [6.8, 17.5]];
      [-7.5, 7.5].forEach(function (v, j) {
        var d = (v < 0 ? -1 : 1) * 4;
        var sh = ribbon(runner, v, 2.8) + ribbon(back, v, 3) + ribbon(front, v, 2.5) + ribbon(curl, v, 2);
        part(0, v, d, { f1: sh, f1c: '#5a3a24', lines: sh });
      });
      var bp = pth([Pw(-8.4, -6.3, 14), Pw(-8.4, 6.3, 14), Pw(-11, 6.3, 36), Pw(-11, -6.3, 36)]);
      var cane = '';
      for (k = 1; k < 6; k++) { var vv = -6.3 + k * 12.6 / 6; cane += seg(Pw(-8.4, vv, 14), Pw(-11, vv, 36)); }
      for (k = 1; k < 5; k++) { var tt = k / 5; cane += seg(Pw(-8.4 - 2.6 * tt, -6.3, 14 + 22 * tt), Pw(-8.4 - 2.6 * tt, 6.3, 14 + 22 * tt)); }
      part(-9.5, 0, -2, { f1: bp, f1c: '#e2bf85', lines: bp + cane, lc: '#9a7643' });
      var tr2 = pth([Pw(-11.6, -7.5, 36.5), Pw(-11.6, 7.5, 36.5), Pw(-11.2, 7.5, 39), Pw(-11.2, -7.5, 39)]);
      part(-11, 0, -1, { f1: tr2, f1c: '#5a3a24', lines: tr2 });
      var seat = pth([Pw(-8, -6.5, 12), Pw(7.5, -6.5, 13), Pw(7.5, 6.5, 13), Pw(-8, 6.5, 12)]);
      var sgrid = '';
      for (k = 1; k < 4; k++) { var su = -8 + k * 15.5 / 4; sgrid += seg(Pw(su, -6.5, 12 + k / 4), Pw(su, 6.5, 12 + k / 4)); }
      part(0, 0, 0, { f1: seat, f1c: '#e2bf85', lines: seat + sgrid, lc: '#9a7643' });
      var cush = pth([Pw(-6.5, -5, 13.4), Pw(5, -5, 14.2), Pw(5, 5, 14.2), Pw(-6.5, 5, 13.4)]) + pth([Pw(-8.8, -5, 16), Pw(-8.8, 5, 16), Pw(-10.4, 5, 31), Pw(-10.4, -5, 31)]);
      part(0.2, 0, 1, { f1: cush, f1c: '#f4efe4', lines: cush, lc: '#cbc2ae' });
    })();

    piece('side', 'Fehér drótkosár-asztalka');
    add(283, 84, 10, 10, 0, 12, WHITE, { lines: grid(283, 84, 10, 10, 0, 12, 3, 3, 3), lc: '#aeb4bb' });

    piece('flamp', 'Állólámpa szürke ernyővel, az ÉNy-i sarokban');
    add(284, 53, 3, 3, 0, 52, BLACK);
    add(281, 49.5, 10, 10, 48, 12, GSHADE, { bias: 2 });

    piece('shelves', 'Fali polcok könyvekkel és macramé futóborostyán, a sarok és a bal ablak között');
    add(289, 50.6, 14, 6, 46, 1.6, WHITE);
    add(289, 50.6, 14, 6, 57, 1.6, WHITE, { bias: 1 });
    for (var bk = 0; bk < 4; bk++) add(290 + bk * 3.1, 51.2, 2.6, 4.6, 47.6, 6 + (bk % 3), BOOKS[bk % 5], { bias: 2 });
    add(296, 51.2, 6, 4.6, 58.6, 2.4, BOOKS[1], { bias: 3 });
    add(296, 51.2, 6, 4.6, 61, 2.4, BOOKS[2], { bias: 4 });
    [290, 293].forEach(function (px) { add(px, 52, 2, 2, 58.6, 6, SAGE, { bias: 3 }); });
    [288, 302].forEach(function (px) {
      add(px - 1, 51, 4, 4, 30, 4, ['#e8e8e8', '#cfcfcf', '#bdbdbd'], { bias: 5, lines: seg(P(px + 1, 53, 34), P(px + 1, 53, 46)), lc: '#efe6d2' });
      add(px - 2, 50.5, 6, 6, 21, 9, IVY, { bias: 4 });
    });

    piece('stand', 'Virágállvány békeliliommal és zöld üvegballonnal');
    add(360, 53, 26, 11, 0, 17, WHITE, { lines: grid(360, 53, 26, 11, 0, 17, 4, 1, 2), lc: '#c5cad0' });
    add(363, 55, 8, 8, 17, 7, WHITE, { bias: 1 });
    add(375, 54.5, 9, 9, 17, 11, GLASSG, { bias: 2 });
    add(377.5, 57, 4, 4, 28, 4, GLASSG, { bias: 3 });

    piece('sofa', 'Szürke L-alakú sarokkanapé a jobb oldali (10-es) ablak alatt');
    add(398, 51, 74, 8, 0, 28, LSOFA);
    add(465, 59, 7, 40, 0, 28, LSOFA, { bias: 1 });
    add(398, 59, 67, 22, 0, 13, LSOFA, { bias: 2 });
    add(445, 81, 20, 48, 0, 13, LSOFA, { bias: 3 });
    add(398, 59, 5, 22, 0, 19, LSOFA, { bias: 4 });
    add(445, 129, 27, 4, 0, 19, LSOFA, { bias: 5 });
    [404, 417, 430, 443].forEach(function (cx) { add(cx, 59.5, 11, 5, 13, 11, LCUSH, { bias: 6 }); });
    add(459, 66, 5, 12, 13, 11, LCUSH, { bias: 7 });

    piece('arclamp', 'Fekete ívlámpa lenvászon ernyővel');
    add(389.5, 65.5, 6, 6, 0, 2, BLACK);
    add(391.5, 67.5, 2, 2, 2, 64, BLACK, { bias: 1 });
    add(391.5, 67.5, 26, 2, 64, 2, BLACK, { bias: 2 });
    add(411, 63, 12, 10, 50, 10, LSHADE, { bias: 3 });

    piece('coffee', 'Kerek sötét dohányzóasztal, zöld bordás váza');
    legs4(413, 95, 22, 22, 9, DKWOOD, 2.5);
    add(410, 92, 28, 28, 9, 3, DKWOOD, { bias: 2, f1: ell(424, 106, 11, 11, 12.1), f1c: '#5a3f2c' });
    add(421, 103, 6, 6, 12, 9, GLASSG, { bias: 3, lines: seg(P(423, 109.2, 12), P(423, 109.2, 21)) + seg(P(425, 109.2, 12), P(425, 109.2, 21)), lc: '#2a6b57' });
    add(420, 102, 8, 8, 21, 5, ['#ffe2c8', '#ef9a6a', '#d77a48'], { bias: 4 });

    piece('bed', 'Franciaágy a nyugati falon, a cserépkályhától távolabb, az utcai ablak felé tolva, fölötte ezüst tükör');
    var spind = '';
    for (var sy = 149; sy <= 205; sy += 4) spind += seg(P(287.2, sy, 12), P(287.2, sy, 34));
    add(282, 146, 5, 62, 0, 36, WHITE, { lines: spind, lc: '#b9bec5' });
    add(287, 148, 62, 58, 0, 10, WHITE, { bias: 1 });
    add(288, 149, 62, 57, 10, 6, LINEN, { bias: 2, lines: seg(P(300, 206.2, 10), P(348, 206.2, 10)) + seg(P(350.2, 151, 10), P(350.2, 204, 10)), lc: '#cbbf9f' });
    add(289, 152, 9, 50, 16, 5, WHITE, { bias: 3 });
    add(292, 154, 9, 20, 16, 8, SAGE, { bias: 4, lines: seg(P(301.2, 156, 17), P(301.2, 172, 23)) + seg(P(301.2, 156, 23), P(301.2, 172, 17)), lc: '#f4f1ea' });
    add(292, 180, 9, 20, 16, 8, SAGE, { bias: 4, lines: seg(P(301.2, 182, 17), P(301.2, 198, 23)) + seg(P(301.2, 182, 23), P(301.2, 198, 17)), lc: '#f4f1ea' });
    add(280, 156, 2, 42, 40, 24, SILVER, { bias: 5, f1: faceX(282.1, 160, 194, 43, 61), f1c: '#a9bccd' });

    piece('night', 'Fehér éjjeliszekrények rattan lámpával');
    add(282, 131, 13, 13, 0, 16, WHITE, { lines: seg(P(295.2, 133, 11), P(295.2, 142, 11)), lc: '#aeb4bb' });
    add(285.5, 134.5, 6, 6, 16, 8, RATTAN, { bias: 1 });
    add(282, 210, 13, 13, 0, 16, WHITE, { bias: 2, lines: seg(P(295.2, 212, 11), P(295.2, 221, 11)), lc: '#aeb4bb' });
    add(285.5, 213.5, 6, 6, 16, 8, RATTAN, { bias: 3 });

    piece('dresser', 'Fehér 8 fiókos komód, TV, hangprojektor, acél nyelvdob');
    add(454, 166, 18, 70, 0, 22, WHITE, { lines: grid(454, 166, 18, 70, 0, 22, 1, 4, 3), lc: '#aeb4bb' });
    add(458, 176, 4, 34, 22, 2.5, BLACK, { bias: 1 });
    add(457, 216, 10, 10, 22, 4, ['#2f5a4a', '#22463a', '#1a382e'], { bias: 2 });
    add(467, 177, 3, 48, 32, 24, BLACK, { bias: 3, f1: faceX(470.1, 179.5, 222.5, 34.5, 53.5), f1c: '#34406a' });

    piece('desk', 'Íróasztal monitorral és fehér székkel');
    legs4(454, 260, 18, 32, 17, WHITE);
    add(454, 260, 18, 32, 17, 2, WHITE, { bias: 1 });
    add(466, 268, 2, 16, 19, 12, BLACK, { bias: 2, f1: faceX(468.1, 269.5, 282.5, 21, 30), f1c: '#5b78c9' });
    legs4(441, 270, 10, 10, 10, WHITE, 1.6);
    add(441, 270, 10, 10, 10, 2, WHITE, { bias: 3 });
    add(439, 270, 2, 10, 12, 15, WHITE, { bias: 4, lines: seg(P(441.1, 273, 13), P(441.1, 273, 26)) + seg(P(441.1, 277, 13), P(441.1, 277, 26)), lc: '#b9bec5' });

    piece('stove', 'Cserépkályha (W), a helyén marad', false);
    add(320, 280, 42, 46, 0, 8, STOVED);
    var relief = '';
    for (var rz = 14; rz < 90; rz += 9.3) for (var rx = 325; rx < 358; rx += 7.6) relief += 'M' + r1(P(rx + 2, 324.3, rz)[0]) + ',' + r1(P(rx + 2, 324.3, rz)[1]) + 'm-1.6,0a1.6,2.4 0 1 0 3.2,0a1.6,2.4 0 1 0 -3.2,0';
    add(322, 282, 38, 42, 8, 84, STOVE, { bias: 1, lines: grid(322, 282, 38, 42, 8, 84, 5, 5, 9) + relief, lc: '#4a1a14', f1: faceY(324.3, 334, 348, 10, 22), f1c: '#ff9b42', f1cls: 'flick', f1f: 'url(#glowF2)' });
    [[320.5, 322], [358, 322], [358, 280.5]].forEach(function (c) {
      var rings = '';
      for (var cz = 14; cz < 90; cz += 10) rings += seg(P(c[0], c[1] + 3.6, cz), P(c[0] + 3.5, c[1] + 3.6, cz));
      add(c[0], c[1], 3.5, 3.5, 8, 84, STOVEL, { bias: 2, lines: rings, lc: '#4a1a14' });
    });
    add(319, 279, 44, 48, 92, 5, STOVEL, { bias: 3 });
    add(321, 281, 40, 44, 97, 6, STOVE, { bias: 4, lines: grid(321, 281, 40, 44, 97, 6, 8, 8, 1), lc: '#4a1a14' });
    add(318.5, 278.5, 45, 49, 103, 3, STOVEL, { bias: 5 });

    // KIS SZOBA
    piece('cab', 'Fehér üvegajtós szekrénysor, fekete fali lámpák');
    add(335.5, 334, 14, 58, 0, 62, WHITE, { lines: seg(P(349.6, 353, 2), P(349.6, 353, 60)) + seg(P(349.6, 372, 2), P(349.6, 372, 60)), lc: '#b9bec5',
      f1: faceX(349.7, 337, 351, 24, 58) + faceX(349.7, 355, 370, 24, 58) + faceX(349.7, 374, 390, 24, 58), f1c: '#dcecf3' });
    add(337, 346, 4, 3, 66, 3, BLACK, { bias: 1 });
    add(337, 377, 4, 3, 66, 3, BLACK, { bias: 1 });

    piece('sewing', 'Gramofon a Singer varrógépasztalon');
    add(337, 418, 13, 2.5, 0, 18, IRON, { lines: seg(P(337, 420.6, 2), P(350, 420.6, 16)) + seg(P(337, 420.6, 16), P(350, 420.6, 2)), lc: '#5a524c' });
    add(337, 441, 13, 2.5, 0, 18, IRON, { bias: 1, lines: seg(P(337, 443.6, 2), P(350, 443.6, 16)) + seg(P(337, 443.6, 16), P(350, 443.6, 2)), lc: '#5a524c' });
    add(338, 421, 11, 20, 5, 1.2, IRON, { bias: 2 });
    add(336, 416, 16, 30, 18, 2.5, ['#d89a5e', '#b77a44', '#9c6638'], { bias: 3 });
    add(339, 423, 10, 11, 20.5, 7, WALNUT, { bias: 4, lines: grid(339, 423, 10, 11, 20.5, 7, 2, 2, 1), lc: '#d4a24a' });

    function windsor(x, y) {
      legs4(x, y, 12, 12, 10, GCHAIR);
      add(x, y, 12, 12, 10, 2.5, GCHAIR, { bias: 1 });
      add(x - 1, y, 2.5, 2.5, 10, 18, GCHAIR, { bias: 2 });
      add(x - 1, y + 9.5, 2.5, 2.5, 10, 18, GCHAIR, { bias: 2 });
      var sp = '';
      for (var yy = y + 3; yy < y + 10; yy += 2) sp += seg(P(x + 0.4, yy, 12.5), P(x + 0.4, yy, 26));
      add(x - 1.5, y - 1, 3.5, 14, 26, 2.8, GCHAIR, { bias: 3, lines: sp, lc: '#1d5a26' });
    }
    piece('gchair1', 'Zöld szék, a lakás névadója (CÉL: pálya vége)');
    windsor(337, 400);
    piece('gchair2', 'Második zöld szék');
    windsor(337, 450);

    piece('sofabed', 'Szürke kanapéágy');
    add(446, 336, 22, 82, 0, 13, GSOFA2);
    add(466, 336, 6, 82, 0, 28, GSOFA2, { bias: 1 });
    add(446, 333, 26, 4, 0, 19, GSOFA2, { bias: 2 });
    add(446, 417, 26, 4, 0, 19, GSOFA2, { bias: 3 });
    [341, 362, 383, 400].forEach(function (cy) { add(459, cy, 7, 14, 13, 12, GCUSH, { bias: 4 }); });

    function wchair(x, y, side) {
      legs4(x, y, 10, 10, 10, WHITE, 1.6);
      add(x, y, 10, 10, 10, 2, CLOTH, { bias: 1 });
      if (side === 'w') add(x - 2, y, 2, 10, 12, 15, WHITE, { bias: 2, lines: seg(P(x + 0.1, y + 3, 13), P(x + 0.1, y + 3, 26)) + seg(P(x + 0.1, y + 7, 13), P(x + 0.1, y + 7, 26)), lc: '#b9bec5' });
      else if (side === 'n') add(x, y - 2, 10, 2, 12, 15, WHITE, { bias: 2, lines: seg(P(x + 3, y + 0.1, 13), P(x + 3, y + 0.1, 26)) + seg(P(x + 7, y + 0.1, 13), P(x + 7, y + 0.1, 26)), lc: '#b9bec5' });
      else add(x, y + 10, 10, 2, 12, 15, WHITE, { bias: 2, lines: seg(P(x + 3, y + 12.1, 13), P(x + 3, y + 12.1, 26)) + seg(P(x + 7, y + 12.1, 13), P(x + 7, y + 12.1, 26)), lc: '#b9bec5' });
    }
    piece('dining', 'Étkezőasztal a zöld falhoz tolva, mélyen benyúlik a szobába: 5 szék');
    wchair(388, 486, 'w');
    wchair(414, 456, 'n');
    wchair(442, 456, 'n');
    legs4(406, 472, 64, 38, 15, WHITE, 2.5);
    add(404, 470, 68, 42, 15, 4, CLOTH, { bias: 4, lines: seg(P(412, 512.2, 15), P(412, 512.2, 19)) + seg(P(436, 512.2, 15), P(436, 512.2, 19)) + seg(P(460, 512.2, 15), P(460, 512.2, 19)), lc: '#cbbf9f' });
    [[409, 472], [437, 472], [409, 498], [437, 498], [405.5, 485]].forEach(function (m, j) { add(m[0], m[1], j === 4 ? 10 : 14, 12, 19, 0.6, MAT, { bias: 5 }); });
    [[426, 487], [448, 494], [462, 478], [420, 504], [458, 506]].forEach(function (l) { add(l[0], l[1], 4, 3, 19, 0.6, ['#9ccc4a', '#7fb03a', '#6a9632'], { bias: 5 }); });
    wchair(414, 514, 's');
    wchair(442, 514, 's');

    piece('kdoor', 'Kis szoba ajtaja, befelé nyílik (a bejárattal szemben)', false);
    var swing = [];
    for (var sa = 0; sa <= 12; sa++) { var ang = sa / 12 * Math.PI / 2; swing.push(P(335.5 + 30 * Math.cos(ang), 584 - 30 * Math.sin(ang), 0.6)); }
    var swingD = 'M' + swing.map(function (q) { return r1(q[0]) + ',' + r1(q[1]); }).join('L');
    add(335.5, 582, 30, 2.5, 0, 46, WHITE, { lines: seg(P(338, 584.7, 4), P(363, 584.7, 4)) + seg(P(338, 584.7, 22), P(363, 584.7, 22)) + seg(P(338, 584.7, 42), P(363, 584.7, 42)) + seg(P(338, 584.7, 4), P(338, 584.7, 42)) + seg(P(363, 584.7, 4), P(363, 584.7, 42)) + swingD, lc: '#b9bec5' });
    add(359, 584.6, 3, 1.5, 22, 2, STEEL, { bias: 1 });

    piece('ac', 'Gree klíma beltéri egység (11)');
    add(336, 472, 8, 44, 86, 12, WHITE, { bias: 30, lines: seg(P(344.3, 475, 89), P(344.3, 513, 89)), lc: '#9aa3ab', f1: faceX(344.4, 508, 511, 93, 95), f1c: '#5fd6a0', f1f: 'url(#glowF2)' });

    piece('gas', 'Gázkonvektor (Lampart Gála 50): krém doboz, fekete rács és kémlelőablak');
    add(384, 580, 40, 9, 0, 18, ['#fbf6e8', '#e8dfc8', '#d8ceb4']);
    var grille = '';
    for (var gx = 388; gx < 421; gx += 2.4) grille += seg(P(gx, 581.8, 18.9), P(gx, 587.2, 18.9));
    add(386, 581.5, 36, 6, 18, 0.8, BLACK, { bias: 1, lines: grille, lc: '#6b6560' });
    add(392, 588.6, 14, 0.8, 3, 10, BLACK, { bias: 2, f1: faceY(589.5, 394, 404, 5, 11), f1c: '#ff8a3d', f1cls: 'flick', f1f: 'url(#glowF2)' });
    piece('doorshelf', 'Kis fehér polc az ajtó fölött, rajta asztali lámpa', false);
    add(335.5, 558, 4.5, 24, 50, 1.4, WHITE);
    add(336.5, 566, 3, 3, 51.4, 1, BLACK, { bias: 1 });
    add(337.6, 567.1, 0.8, 0.8, 52.4, 5, BLACK, { bias: 2 });
    add(336, 565.5, 4, 4, 57, 3.5, LSHADE, { bias: 3 });

    piece('vitrine', 'Fehér vitrin, tetején a gateway (G)');
    add(448, 558, 24, 28, 0, 56, WHITE, { lines: seg(P(450, 586.2, 30), P(470, 586.2, 30)) + seg(P(450, 586.2, 40), P(470, 586.2, 40)), lc: '#9fb3bd', f1: faceY(586.2, 451, 459, 20, 50) + faceY(586.2, 461, 469, 20, 50), f1c: '#dcecf3' });
    add(455, 565, 10, 7, 56, 3, WHITE, { bias: 2, f1: faceY(572.2, 458, 461, 57, 58.5), f1c: '#4fc3f7', f1f: 'url(#glowF2)' });

    // FÜRDŐ
    piece('tub', 'Aszimmetrikus sarokkád, patchwork csempével');
    add(258, 424, 44, 28, 0, 17, PATCHS, { lines: grid(258, 424, 44, 28, 0, 17, 9, 5, 3), lc: '#8d7c69', f1: ell(279, 438, 16, 10, 17.2), f1c: '#eaf6fa' });
    piece('wc2', 'Fali WC csempézett előfallal');
    add(318, 430, 12, 22, 0, 22, PATCHS, { lines: grid(318, 430, 12, 22, 0, 22, 2, 4, 4), lc: '#8d7c69' });
    add(306, 436, 12, 11, 7, 8, WHITE, { bias: 1 });
    add(305, 435, 13, 12, 15, 1.5, WHITE, { bias: 2 });
    piece('vanity', 'Lambériás mosdószekrény, fehér keretes tükör, aranykeret');
    var bead = '';
    for (var by = 386; by < 406; by += 2.5) bead += seg(P(270.2, by, 2), P(270.2, by, 19));
    add(258, 384, 12, 22, 0, 20, WHITE, { lines: bead, lc: '#c5cad0' });
    add(257.5, 383, 15, 24, 20, 4, WHITE, { bias: 1, f1: ell(265, 395, 4.5, 7, 24.2), f1c: '#dfe9ee' });
    add(257.6, 412, 1.4, 12, 34, 10, GOLD, { bias: 2, f1: faceX(259.1, 414, 422, 36, 42), f1c: '#f4f6f7' });
    add(257.6, 386, 1.6, 18, 28, 18, WHITE, { bias: 3, f1: faceX(259.3, 388, 402, 30, 44), f1c: '#cfe3ea' });
    piece('tallcab', 'Magas lambériás szekrény, törölközőpolc, fogasok, szennyeszsák');
    var bead2 = '';
    for (var bx = 322; bx < 331; bx += 2.5) bead2 += seg(P(bx, 390.2, 2), P(bx, 390.2, 56));
    add(320, 364, 11, 26, 0, 58, WHITE, { lines: bead2 + seg(P(320, 390.2, 30), P(331, 390.2, 30)), lc: '#c5cad0' });
    add(321, 394, 9, 10, 0, 14, ['#f3ead6', '#ddd0b2', '#c9bb98'], { bias: 1, lines: seg(P(322, 404.2, 6), P(329, 404.2, 6)) + seg(P(322, 404.2, 9), P(329, 404.2, 9)), lc: '#5a524c' });
    add(323, 408, 8, 22, 54, 1.6, WHITE, { bias: 2 });
    [[409, SAGE], [414, ['#f4f1ea', '#dcd6ca', '#cbc4b6']], [419, ['#a9c7d9', '#86abcb', '#7397b8']], [424, SAGE]].forEach(function (t) { add(324, t[0], 6, 4.5, 55.6, 7, t[1], { bias: 3 }); });
    add(330.4, 410, 1.4, 12, 40, 2, BLACK, { bias: 4 });
    add(327, 410, 3.5, 5, 22, 18, ['#a9c7d9', '#86abcb', '#7397b8'], { bias: 5 });
    add(327, 416, 3.5, 5, 24, 16, ['#c7ced3', '#aab3b9', '#97a1a8'], { bias: 5 });
    piece('heater', 'Fürdő fali fűtőtest, magasan');
    add(257.6, 414, 3, 26, 74, 8, WHITE, { bias: 30, lines: seg(P(260.7, 417, 76), P(260.7, 437, 76)), lc: '#9aa3ab' });
    piece('boiler', 'Bojler az álmennyezet fölött (Hajdu ZV120, fekvő henger)');
    // Fekvő henger az x tengely mentén: a palást a két véglap konvex burka, a látható (x1) véglap külön.
    (function () {
      var x0 = 258, x1 = 300, cy = 376, cz = 96, r = 8, N = 28, E0 = [], E1 = [], k;
      for (k = 0; k < N; k++) { var t = k / N * Math.PI * 2, yy = cy + r * Math.cos(t), zz = cz + r * Math.sin(t); E0.push(P(x0, yy, zz)); E1.push(P(x1, yy, zz)); }
      var pts2 = E0.concat(E1).slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
      var lo = [], up = [];
      pts2.forEach(function (p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
      pts2.slice().reverse().forEach(function (p) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); });
      var hull = pth(lo.slice(0, -1).concat(up.slice(0, -1))), cap = pth(E1);
      var NONE = ['none', 'none', 'none'];
      var shine = seg(P(x0 + 2, cy - r * 0.55, cz + r * 0.8), P(x1 - 2, cy - r * 0.55, cz + r * 0.8));
      var straps = [267, 291].map(function (sx) { var a = []; for (var q = 0; q <= 14; q++) { var tt = Math.PI * q / 14; a.push(P(sx, cy + r * Math.cos(tt), cz + r * Math.sin(tt))); } return 'M' + a.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join('L'); }).join('')
        + seg(P(267, cy, cz + r), P(267, cy, cz + r + 4)) + seg(P(291, cy, cz + r), P(291, cy, cz + r + 4));
      add(x0, cy - r, x1 - x0, 2 * r, cz - r, 2 * r, NONE, { bias: 140, sw: 0, f1: hull, f1c: '#e4e8ed', lines: hull + straps, lc: '#1e2a44' });
      add(x0, cy - r, x1 - x0, 2 * r, cz - r, 2 * r, NONE, { bias: 140.5, sw: 0, f1: cap, f1c: '#ffffff', lines: cap + shine, lc: '#1e2a44' });
      add(x1 - 0.5, cy - 1.2, 1, 2.4, cz - 1.2, 2.4, ['#c9ced6', '#aab3bd', '#97a1ab'], { bias: 141 });
    })();

    // WC, TÁROLÓ, ELŐSZOBA
    piece('wc', 'Külön WC a bejárattal szemben (79 x 105 cm): fali WC, kis kézmosó, parafa-kollázs');
    var sub2 = '';
    for (var wz = 4; wz < 52; wz += 4) sub2 += seg(P(258, 461.1, wz), P(286, 461.1, wz));
    add(257.5, 457.5, 29, 3.6, 0, 52, WHITE, { lines: sub2, lc: '#d4dade' });
    add(257.5, 461, 29, 5, 26, 3, PATCHS, { bias: 1, lines: grid(257.5, 461, 29, 5, 26, 3, 6, 1, 1), lc: '#8d7c69' });
    add(267, 461.5, 9, 4.5, 29, 3, WHITE, { bias: 2, f1: ell(271.5, 463.7, 3, 1.6, 32.1), f1c: '#dfe9ee' });
    add(270.8, 461.5, 1.4, 1.4, 32, 4, STEEL, { bias: 3 });
    add(260, 462, 3.5, 3.5, 29, 3, ['#f4f1ea', '#dcd6ca', '#cbc4b6'], { bias: 3 });
    add(259.5, 461.5, 4.5, 4.5, 32, 4, IVY, { bias: 4 });
    add(280, 462, 3.5, 3.5, 29, 3, ['#f4f1ea', '#dcd6ca', '#cbc4b6'], { bias: 3 });
    add(279.5, 461.5, 4.5, 4.5, 32, 4, IVY, { bias: 4 });
    add(265, 461, 13, 0.8, 36, 13, WHITE, { bias: 5, f1: faceY(461.9, 267, 276, 38, 47), f1c: '#b5875a', lines: seg(P(268.5, 461.9, 40), P(274.5, 461.9, 45)) + seg(P(268.5, 461.9, 45), P(274.5, 461.9, 40)), lc: '#7a5530' });
    add(265, 466, 12, 11, 8, 7, WHITE, { bias: 6, f1: ell(271, 471.5, 4.2, 4.2, 15.1), f1c: '#dfe9ee' });
    add(264.5, 465.5, 13, 12, 15, 1.4, WHITE, { bias: 7 });
    add(282, 488, 3.5, 3.5, 0, 7, STEEL, { bias: 8 });
    add(285.5, 470, 1.2, 1.4, 30, 2, BLACK, { bias: 8 });
    add(283.5, 468, 2.5, 6, 14, 16, ['#c7ced3', '#aab3b9', '#97a1a8'], { bias: 9 });
    piece('wcdoor', 'WC ajtó (az előszobából nyílik)', false);
    add(259, 503.5, 25, 3, 0, 20, WHITE, { lines: seg(P(262, 506.7, 3), P(281, 506.7, 3)) + seg(P(262, 506.7, 17), P(281, 506.7, 17)) + seg(P(262, 506.7, 3), P(262, 506.7, 17)) + seg(P(281, 506.7, 3), P(281, 506.7, 17)), lc: '#b9bec5' });
    add(279, 506.5, 2.5, 1.5, 9, 2, STEEL, { bias: 1 });
    piece('stdoor', 'Privát tároló ajtaja, zárva (6-os érzékelő)', false);
    add(294, 503.5, 32, 3, 0, 20, WALNUT, { lines: seg(P(297, 506.7, 3), P(323, 506.7, 3)) + seg(P(297, 506.7, 17), P(323, 506.7, 17)) + seg(P(297, 506.7, 3), P(297, 506.7, 17)) + seg(P(323, 506.7, 3), P(323, 506.7, 17)), lc: '#3a2414' });
    add(320, 506.5, 2.5, 1.5, 9, 2, GOLD, { bias: 1 });
    add(296, 506.5, 4, 1, 15, 3, ['#ffffff', '#f1f3f5', '#e4e6ea'], { bias: 2 });
    piece('shelf', 'Polc (privát tároló)');
    add(292, 459, 38, 11, 0, 34, WALNUT, { lines: seg(P(292, 470.2, 11), P(330, 470.2, 11)) + seg(P(292, 470.2, 22), P(330, 470.2, 22)), lc: '#3a2414' });
    piece('panelbox', 'Mérő- és elosztószekrény (k5, k7, k8, k9): magas fehér beépített szekrény a bejárati ajtó mellett');
    var CABW = ['#fbfbfa', '#e3e5e7', '#d2d5d9'];
    add(321, 582.5, 10, 7, 0, 1.2, CABW);
    add(321, 582.5, 1.2, 7, 1.2, 15, CABW, { bias: 1 });
    add(329.8, 582.5, 1.2, 7, 1.2, 15, CABW, { bias: 1 });
    add(321, 582.5, 10, 7, 8, 1, CABW, { bias: 2 });
    add(323, 584, 3, 0.6, 9, 4, ['#ffffff', '#e8e8e8', '#d8d8d8'], { bias: 3, f1: faceX(326.1, 584.2, 584.5, 9.5, 12.5) + faceY(584.7, 323.4, 325.6, 9.5, 12.5), f1c: '#2f8a3a' });
    add(327, 584.5, 2.5, 2.5, 1.2, 2, ['#f4f1ea', '#dcd6ca', '#cbc4b6'], { bias: 3 });
    add(326.6, 584, 3.4, 3.4, 3.2, 3, IVY, { bias: 4 });
    var cabL = seg(P(331.1, 582.5, 28.5), P(331.1, 589.5, 28.5)) + seg(P(321, 589.6, 16), P(321, 589.6, 41));
    add(321, 582.5, 10, 7, 16, 25, CABW, { bias: 5, lines: cabL, lc: '#b9bec5' });
    add(319.6, 584, 1.4, 1.2, 34, 2.5, GOLD, { bias: 6 });
    add(319.6, 586.2, 1.4, 1.2, 34, 2.5, GOLD, { bias: 6 });
    add(319.6, 588.4, 1.4, 1.1, 34, 2.5, GOLD, { bias: 6 });
    add(319.8, 584.2, 1.2, 2.2, 25, 5, ['#ffffff', '#eceef0', '#dde0e3'], { bias: 6 });
    add(319.6, 587, 1.4, 2.4, 20, 3.2, BLACK, { bias: 6 });
    piece('intercom', 'Kaputelefon a szekrény és az ajtó között', false);
    add(317.4, 588, 2.2, 1.5, 26, 7, ['#ffffff', '#eceef0', '#dde0e3']);
    piece('edoor', 'Bejárati ajtó (5): kétszárnyú, belül fehér üvegezett, kívül barna szecessziós, befelé nyílik', false);
    var DOORB = ['#7a4a2c', '#5e3820', '#4d2d1a'];
    var eswD = '';
    [[288.5, 1], [315.5, -1]].forEach(function (hg) {
      var pa = [];
      for (var ea = 0; ea <= 10; ea++) { var eg = ea / 10 * Math.PI / 2; pa.push(P(hg[0] + hg[1] * 14 * Math.cos(eg), 589.5 - 14 * Math.sin(eg), 0.6)); }
      eswD += 'M' + pa.map(function (q) { return r1(q[0]) + ',' + r1(q[1]); }).join('L');
    });
    add(288, 589.5, 28, 5, 0, 0.8, ['#c8b79a', '#a8946f', '#977f5c'], { lines: eswD, lc: '#e9dcc4' });
    add(286, 589.5, 2, 5, 0, 58, WHITE, { bias: 1 });
    add(316, 589.5, 2, 5, 0, 58, WHITE, { bias: 1 });
    add(288, 590, 28, 4, 49, 9, WHITE, { bias: 2, f1: faceY(594.1, 290, 314, 51, 56), f1c: '#d8e8f0', lines: seg(P(302, 594.1, 51), P(302, 594.1, 56)), lc: '#ffffff' });
    add(299, 589.6, 4, 1.6, 47.2, 1.6, ['#ffffff', '#eceef0', '#dde0e3'], { bias: 3 });
    add(288.5, 575.5, 2.4, 14, 0, 47, WHITE, { bias: 4, lines: seg(P(290.9, 577.5, 3), P(290.9, 587.5, 3)) + seg(P(290.9, 577.5, 44), P(290.9, 587.5, 44)) + seg(P(290.9, 577.5, 3), P(290.9, 577.5, 44)) + seg(P(290.9, 587.5, 3), P(290.9, 587.5, 44)), lc: '#c9ced4',
      f1: faceX(291, 578.5, 586.5, 20, 42), f1c: '#e6eef2' });
    add(291, 576.5, 1.2, 2.6, 22, 1.4, GOLD, { bias: 5 });
    var iron = '';
    for (var iz = 22; iz < 42; iz += 5) iron += 'M' + r1(P(315.6, 578.8, iz)[0]) + ',' + r1(P(315.6, 578.8, iz)[1]) + 'q3,-3 6,0 q3,3 6,0';
    add(313.1, 575.5, 2.4, 14, 0, 47, DOORB, { bias: 4, lines: seg(P(315.6, 577.5, 3), P(315.6, 587.5, 3)) + seg(P(315.6, 577.5, 44), P(315.6, 587.5, 44)) + seg(P(315.6, 577.5, 3), P(315.6, 577.5, 44)) + seg(P(315.6, 587.5, 3), P(315.6, 587.5, 44)) + iron, lc: '#2b1a10',
      f1: faceX(315.55, 578.5, 586.5, 20, 42), f1c: '#9fb2b8' });
    add(312, 576.5, 1.2, 2.6, 22, 1.4, GOLD, { bias: 5 });

    // KONYHA (nyugati fal, az ablaktól észak felé)
    var MARBLE = ['#e3e5e7', '#c4c8cc', '#b1b5ba'];
    var vein = seg(P(186, 540, 22.1), P(196, 562, 22.1)) + seg(P(190, 566, 22.1), P(199, 584, 22.1)) + seg(P(184, 500, 22.1), P(198, 512, 22.1));
    piece('kitchen', 'Fehér konyhapult szürke márványhatású munkalappal, mosogató, kávésarok');
    var kd = '';
    [544, 556, 566, 576].forEach(function (yy) { kd += seg(P(202.3, yy, 2), P(202.3, yy, 18)); });
    add(182, 532, 20, 56, 0, 20, CAB, { lines: kd, lc: '#c9c3b5' });
    add(181, 531, 23, 58, 20, 2, MARBLE, { bias: 1, lines: vein, lc: '#9aa0a6', f1: ell(192, 550, 6, 5, 22.1), f1c: '#c0c6cc' });
    add(184, 549, 2, 2, 22, 8, BLACK, { bias: 2 });
    add(187, 555, 1.6, 1.6, 22, 7, STEEL, { bias: 2 });
    add(186, 568, 6, 6, 22, 7, BLACK, { bias: 3 });
    add(194, 568, 5, 6, 22, 9, WHITE, { bias: 3 });
    add(185, 578, 10, 7, 22, 2.5, RATTAN, { bias: 3 });
    piece('washer', 'Mosógép (fehér, fekete ajtókeret)');
    var wd = [], wd2 = [];
    for (var aa = 0; aa < 14; aa++) { var tt = aa / 14 * Math.PI * 2; wd.push(P(202.3, 521 + 6.5 * Math.cos(tt), 10 + 6.5 * Math.sin(tt))); wd2.push(P(202.4, 521 + 4.6 * Math.cos(tt), 10 + 4.6 * Math.sin(tt))); }
    add(182, 510, 20, 22, 0, 20, WHITE, { f1: pth(wd), f1c: '#26221f' });
    add(181, 509, 23, 24, 20, 2, MARBLE, { bias: 1, f1: pth(wd2), f1c: '#7fd3ea' });
    piece('counter2', 'Alsó szekrények sík, márványhatású munkalappal (a tűzhely és a mosógép között)');
    add(182, 479.5, 20, 29.5, 0, 20, CAB, { lines: seg(P(202.3, 486, 2), P(202.3, 486, 18)) + seg(P(202.3, 497.5, 2), P(202.3, 497.5, 18)), lc: '#c9c3b5' });
    add(181, 479.5, 23, 30, 20, 2, MARBLE, { bias: 1 });
    piece('cooker', 'Candy villanytűzhely kerámialappal, sütővel, a sarokban (fölötte a mikró)');
    add(182, 458, 20, 21, 0, 22, WHITE, { f1: faceX(202.1, 461, 476, 4, 14), f1c: '#2b2b2b' });
    add(183, 459, 18, 19, 22, 0.8, BLACK, { bias: 1 });
    piece('fridge', 'Beko inox hűtő-fagyasztó az északi fal mentén, a tűzhely mellett');
    add(220, 458, 21, 21, 0, 54, STEEL, { lines: seg(P(222, 479.2, 15), P(239, 479.2, 15)) + seg(P(236, 479.2, 20), P(236, 479.2, 34)) + seg(P(236, 479.2, 6), P(236, 479.2, 12)), lc: '#5c636e' });
    piece('urnbox', 'Nyitott wenge doboz: kék-fehér porcelán urnák, befőttesüvegek, növény', false);
    add(218, 458, 27, 30, 56, 2, DKWOOD);
    add(218, 458, 27, 2, 58, 16, DKWOOD, { bias: 1 });
    add(243, 458, 2, 30, 58, 16, DKWOOD, { bias: 2 });
    add(219.5, 460, 23.5, 27, 64, 1.6, WHITE, { bias: 3 });
    var BLUEW = ['#f4f7fb', '#3d6fb6', '#2f5a99'];
    [[221, 466], [229, 474]].forEach(function (u) { add(u[0], u[1], 6, 6, 58, 6, BLUEW, { bias: 4, lines: seg(P(u[0], u[1] + 6.2, 60.5), P(u[0] + 6, u[1] + 6.2, 60.5)), lc: '#2f5a99' }); add(u[0] + 1.5, u[1] + 1.5, 3, 3, 64, 1.4, BLUEW, { bias: 5 }); });
    add(235, 463, 4, 4, 58, 5, ['#e6f2f0', '#bcd8d3', '#a7c7c1'], { bias: 4 });
    add(237, 481, 4, 4, 58, 5, ['#e6f2f0', '#bcd8d3', '#a7c7c1'], { bias: 4 });
    add(221, 480, 5, 5, 58, 4, ['#f4f1ea', '#dcd6ca', '#cbc4b6'], { bias: 4 });
    add(220.5, 479.5, 6, 6, 62, 5, IVY, { bias: 5 });
    piece('uppers', 'Fehér kazettás felső szekrények, mikró, LED-szalag', false);
    add(180.5, 488, 11, 100, 46, 18, CAB, { lines: seg(P(191.6, 512, 46), P(191.6, 512, 64)) + seg(P(191.6, 538, 46), P(191.6, 538, 64)) + seg(P(191.6, 563, 46), P(191.6, 563, 64)), lc: '#c9c3b5' });
    add(180.5, 458, 13, 22, 40, 24, CAB, { lines: seg(P(193.6, 458.5, 52), P(193.6, 479.5, 52)), lc: '#c9c3b5',
      f1: faceX(193.7, 461, 472, 42, 50) , f1c: '#26221f' });
    add(180.5, 458, 13, 22, 64, 2, DKWOOD, { bias: 1 });
    add(180.5, 488, 11, 100, 64, 2, DKWOOD, { bias: 1 });
    add(191.2, 490, 0.8, 96, 45.2, 0.6, ['#fff6c8', '#ffe98a', '#ffe070'], { bias: 2 });
    piece('herbs', 'Fűszernövények a falisínen, fekete eszközsín');
    var rail = seg(P(180.4, 540, 42), P(180.4, 588, 42)) + seg(P(180.4, 540, 33), P(180.4, 588, 33)) + seg(P(180.4, 512, 30), P(180.4, 534, 30));
    add(179, 542, 2, 2, 41, 2, BLACK, { lines: rail, lc: '#1e2a44' });
    [[545, 36], [556, 36], [567, 36], [551, 27], [562, 27], [578, 27]].forEach(function (h) {
      add(179.5, h[0], 4, 4, h[1], 4, WHITE, { bias: 1 });
      add(179.3, h[0] - 0.5, 4.5, 5, h[1] + 4, 4, IVY, { bias: 2 });
    });
    [516, 521, 526, 531].forEach(function (u) { add(180.2, u, 1.2, 1.4, 22.5, 7, BLACK, { bias: 1 }); });
    piece('pendant', 'Fehér függőlámpa', false);
    add(214, 516, 9, 9, 58, 5, WHITE, { lines: seg(P(218.5, 520.5, 63), P(218.5, 520.5, WH)), lc: '#1e2a44' });
    piece('stool', 'Fekete fellépő az ajtó mellett');
    add(238, 562, 10, 10, 0, 14, BLACK, { lines: seg(P(238, 572.2, 7), P(248, 572.2, 7)), lc: '#5a524c' });
    piece('curt7', 'Világoskék függöny és fehér fátyolfüggöny (konyhaablak)', false);
    add(192, 585, 5, 3, 1, 96, BLUEC);
    add(197, 586.5, 4, 1.5, 4, 90, ['#ffffff', '#f2f4f6', '#e6e9ec'], { bias: 1 });

    pieces.forEach(function (p) {
      p.boxes.sort(function (a, b) { return a.key - b.key; });
      p.key = p.boxes[0].key;
    });

    var WF = ['#ffe0b0', '#d99a5e', '#b97c45'];
    var WFG = ['#c9dcc2', '#a8bf9f', '#93ab8a'];
    var front = [box(177.5, 589.5, 110.5, 5, 0, 12, WF), box(316, 589.5, 161.5, 5, 0, 12, WF), box(472.5, 45.5, 5, 549, 0, 12, WFG)];
    // kis szoba keleti (zöld) fala: áttetsző szellemfal, rajta a fekvő tükör és a kerubos polc
    var mirror = {
      frame: faceX(472.2, 346, 458, 33, 59),
      glass: faceX(472.1, 350, 454, 36, 56),
      shine: seg(P(472, 362, 40), P(472, 380, 53)) + seg(P(472, 392, 40), P(472, 404, 48)),
      shelf: [box(468.5, 372, 4, 50, 29, 1.6, WHITE), box(469, 384, 3, 3, 30.6, 4, GOLD), box(469, 396, 3, 3, 30.6, 4, GOLD), box(469, 410, 3, 4, 30.6, 3, ['#f4f1ea', '#dcd6ca', '#cbc4b6'])]
    };
    var ghost = box(472.5, 330, 5, 262, 12, WH - 12, ['#cfe0c8', '#a9c1a0', '#9fbb96']);
    // kis szoba ablaka belülről: fekete reluxa, mintás fehér fátyolfüggöny, zsályazöld sötétítő
    var slats = '';
    for (var sz = 40; sz < 98; sz += 1.6) slats += seg(P(384, 588.6, sz), P(421, 588.6, sz));
    var lace = '';
    for (var lz = 24; lz < 96; lz += 6) for (var lx = 386; lx < 420; lx += 7) lace += 'M' + r1(P(lx, 587.4, lz)[0]) + ',' + r1(P(lx, 587.4, lz)[1]) + 'm-1.6,0a1.6,1.6 0 1 0 3.2,0a1.6,1.6 0 1 0 -3.2,0';
    var blind = {
      slats: slats, lace: lace, sheer: faceY(587.3, 383, 422, 22, 98),
      curt: [box(376, 584, 6, 3.5, 2, 100, SAGEC), box(422, 584, 6, 3.5, 2, 100, SAGEC), box(374, 586, 56, 1.4, 102, 1.4, BLACK)]
    };
    var win7 = quad(198, 589.5, 238, 594.5, 12.4);
    var win8 = pts([P(380, 594, 12), P(425, 594, 12), P(425, 606, 46), P(380, 606, 46)]);
    var win8frame = seg(P(402.5, 594, 12), P(402.5, 606, 46)) + seg(P(380, 600, 29), P(425, 600, 29));
    var gangSlab = pts([P(176, 597, 0), P(482, 597, 0), P(482, 616, 0), P(176, 616, 0)]);
    var railing = seg(P(176, 614, 22), P(482, 614, 22)) + seg(P(176, 614, 6), P(482, 614, 6));
    for (var gx = 180; gx <= 480; gx += 10) railing += seg(P(gx, 614, 0), P(gx, 614, 22));
    for (gx = 185; gx <= 475; gx += 20) railing += 'M' + r1(P(gx, 614, 10)[0]) + ',' + r1(P(gx, 614, 10)[1]) + 'm-3,0a3,3 0 1 0 6,0a3,3 0 1 0 -6,0';

    var sc = {
      stars: stars, city: city, cityWin: cityWin, road: road, roadLine: roadLine, walk: walk,
      streetTr: 'translate(' + r1(P(300, -32, 0)[0]) + ',' + r1(P(300, -32, 0)[1]) + ') rotate(26.57)',
      gangTr: 'translate(' + r1(P(352, 640, 0)[0]) + ',' + r1(P(352, 640, 0)[1]) + ') rotate(26.57)',
      trees: trees, lamps: lamps, slab: slab, floors: floors, checks: checks, rugs: rugs,
      back: back, winsBase: winsBase, walls: W, pieces: pieces, front: front, win7: win7, win8: win8, win8frame: win8frame,
      gangSlab: gangSlab, railing: railing, mirror: mirror, ghost: ghost, blind: blind,
      fx: {
        stoveTop: tr(341, 303, 110), flame: tr(365, 318, 38), boss: tr(341, 303, 154), ch1: tr(377, 190, 96), ch2: tr(404, 470, 96),
        ghosts: tr(414, 552, 34), compass: tr(640, 470, 0), gw: tr(460, 568, 60), start: tr(300, 556, 0), plus: tr(330, 498, 62), priv: tr(308, 506, 3), wcTag: tr(271, 506, 22), pendant: tr(218.5, 520.5, 58)
      }
    };
    this._sc = sc;
    return sc;
  }

  levels() {
    return [
      { code: '1-1', name: 'Ősz', score: '4 210', coins: '1 120 Ft', timer: '05:40', outside: '12 °C', hearts: 5, boss: 0.35, t: ['21,2°', '20,4°', '24,1°', '21,8°'], k5: '0 W', k7: '0 W', k8: '0 W', k9: '310 W', stage: '0/3 kW', open8: false,
        sky0: '#3f8ff0', sky1: '#8fd0ff', sky2: '#fff1c4', sunC: '#ffe066', sunY: 150, starOp: 0, cloudOp: 1, city: '#9bbbe3', cityWin: '#dbe9fb', glass: '#bfe6ff', glow: 0.25, ember: 0.3, lampOp: 0.15, tree1: '#5cc06f', tree2: '#7ad685' },
      { code: '1-2', name: 'Hideg front', score: '8 930', coins: '2 460 Ft', timer: '03:05', outside: '3 °C', hearts: 4, boss: 0.6, t: ['22,0°', '20,1°', '31,5°', '22,3°'], k5: '0 W', k7: '0 W', k8: '1200 W', k9: '520 W', stage: '1/3 kW', open8: true,
        sky0: '#4a72b8', sky1: '#9db6e0', sky2: '#ffd9a8', sunC: '#ffd27a', sunY: 200, starOp: 0, cloudOp: 0.95, city: '#7e93bf', cityWin: '#ffe9b0', glass: '#b6cdec', glow: 0.45, ember: 0.5, lampOp: 0.4, tree1: '#4ea866', tree2: '#69c07a' },
      { code: '1-3', name: 'Téli este', score: '12 450', coins: '3 840 Ft', timer: '02:14', outside: '-2 °C', hearts: 4, boss: 0.8, t: ['23,6°', '20,5°', '38,4°', '22,3°'], k5: '1987 W', k7: '1800 W', k8: '0 W', k9: '642 W', stage: '2/3 kW', open8: true,
        sky0: '#27367a', sky1: '#7a63ad', sky2: '#ffae7a', sunC: '#ff9a5a', sunY: 300, starOp: 0.55, cloudOp: 0.75, city: '#4b4a85', cityWin: '#ffd27a', glass: '#9fb4ee', glow: 0.75, ember: 0.85, lampOp: 0.85, tree1: '#2f7d5a', tree2: '#3f9468' },
      { code: '1-4', name: 'Boss: Kályha', score: '15 980', coins: '5 300 Ft', timer: '00:48', outside: '-6 °C', hearts: 3, boss: 1, t: ['22,4°', '19,6°', '44,0°', '21,9°'], k5: '2960 W', k7: '1800 W', k8: '0 W', k9: '880 W', stage: '3/3 kW', open8: true,
        sky0: '#14173f', sky1: '#3d2a66', sky2: '#ff7a52', sunC: '#fff2cc', sunY: 150, starOp: 1, cloudOp: 0.45, city: '#2c2a5a', cityWin: '#ffc35a', glass: '#6f80c8', glow: 0.95, ember: 1, lampOp: 1, tree1: '#235e4a', tree2: '#2e7258' }
    ];
  }

  tools() {
    return [
      { name: 'Klíma-limiter', stat: 'kb. 12 Ft / kWh hő', rarity: 'LEGENDÁS', rc: '#c4610f', color: '#7fd3f7', target: 'AC', targetLabel: 'klíma (11)',
        effect: 'A legolcsóbb hő. Vendég módban max 23 fok, 2 óra után 21 fokra áll vissza. Hűtésnél legalább 24 fok.',
        icon: 'M12 2v20M3.5 7l17 10M20.5 7l-17 10M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5' },
      { name: 'Gáz-pajzs', stat: 'kb. 15 Ft / kWh hő', rarity: 'EPIKUS', rc: '#6a3fc4', color: '#ffc06b', target: 'GAS', targetLabel: 'gázkonvektor',
        effect: 'Olcsó alaphő a kis szobában. Érkezés előtt a takarító állítja a jelölt fokozatra.',
        icon: 'M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 1 3 3 3 0-2-1-4 0-6z' },
      { name: 'Kályha-ütemező', stat: '~60 Ft / kWh hő', rarity: 'RITKA', rc: '#17716d', color: '#ff8a65', target: 'W', targetLabel: 'cserépkályha',
        effect: 'Foglaltság szerint tölt, éjjel max 2 fokozat. Élesítés csak kontaktor beépítése után!',
        icon: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 7v5l3 3' },
      { name: 'Ablak-riasztó', stat: '6 nyitásérzékelő', rarity: 'RITKA', rc: '#17716d', color: '#c9b6ff', target: '8', targetLabel: 'kis szoba ablak (8)',
        effect: 'Ha ablak nyitva és fűtés megy: 5 perc múlva értesítés, 15 perc múlva a klíma lekapcsol.',
        icon: 'M4 4h16v16H4zM12 4v16M4 12h16' },
      { name: 'Bojler-időzítő', stat: 'B kör, k7', rarity: 'GYAKORI', rc: '#4d5c70', color: '#8fe0a0', target: 'k', targetLabel: 'elosztó (k7)',
        effect: 'A bojler csak az éjszakai ablakban melegít. Foglalás nélkül teljesen pihen.',
        icon: 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11zM9 15a3 3 0 0 0 3 3' }
    ];
  }

  startDrag(e, id, kind) {
    if (e.button != null && e.button > 0) return;
    e.stopPropagation();
    var el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch (x) {}
    var root = el.closest ? el.closest('[data-root]') : null;
    var r = root ? root.getBoundingClientRect() : { width: 1440 };
    var k = r.width / 1440 || 1;
    var pos = (this.state && this.state.pos) || {};
    var c = pos[id] || [0, 0];
    this._drag = { id: id, kind: kind, sx: e.clientX, sy: e.clientY, k: k, ox: c[0], oy: c[1] };
    this.setState({ drag: id, sel: id });
  }

  moveDrag(e) {
    var d = this._drag;
    if (!d) return;
    var nx = d.ox + (e.clientX - d.sx) / d.k;
    var ny = d.oy + (e.clientY - d.sy) / d.k;
    var snap = this.props.snap ?? true;
    if (d.kind === 'piece') {
      var gx = nx / WS, gy = ny / WS;
      var wx = gy + gx / 2, wy = gy - gx / 2;
      if (snap) { wx = Math.round(wx / 4) * 4; wy = Math.round(wy / 4) * 4; }
      wx = Math.max(-240, Math.min(240, wx)); wy = Math.max(-300, Math.min(300, wy));
      nx = (wx - wy) * WS; ny = ((wx + wy) / 2) * WS;
    } else {
      nx = Math.max(-560, Math.min(560, Math.round(nx)));
      ny = Math.max(-500, Math.min(500, Math.round(ny)));
    }
    var pos = Object.assign({}, (this.state && this.state.pos) || {});
    pos[d.id] = [nx, ny];
    this.setState({ pos: pos });
  }

  endDrag() {
    if (!this._drag) return;
    this._drag = null;
    this.setState({ drag: null });
  }

  renderVals() {
    var self = this;
    var sc = this.scene();
    var st = this.state || {};
    var pos = st.pos || {};
    var li = st.lvl == null ? 2 : st.lvl;
    var ti = st.tool == null ? 0 : st.tool;
    var LV = this.levels();
    var L = LV[li];
    var TL = this.tools();
    var focus = st.focus || TL[ti].target;
    function r1(n) { return Math.round(n * 10) / 10; }
    function P(x, y, z) { return self.P(x, y, z); }
    function trp(p) { return 'translate(' + r1(p[0]) + ',' + r1(p[1]) + ')'; }
    function off(id) { var o = pos[id] || [0, 0]; return [o[0] / WS, o[1] / WS]; }
    function trw(x, y, z, id) { var p = P(x, y, z), o = id ? off(id) : [0, 0]; return trp([p[0] + o[0], p[1] + o[1]]); }

    // rétegek: falak + húzható bútorok mélység szerint
    var layers = sc.walls.map(function (b) { return { id: '', key: b.key, tr: '', cls: 'wall', boxes: [b], down: null }; });
    sc.pieces.forEach(function (p) {
      var o = off(p.id);
      var cls = p.drag ? 'pc' : 'wall';
      if (st.sel === p.id) cls += ' sel';
      if (st.drag === p.id) cls += ' drag';
      layers.push({ id: p.id, key: p.key + 2 * o[1] + (st.drag === p.id ? 0.5 : 0), tr: 'translate(' + r1(o[0]) + ',' + r1(o[1]) + ')', cls: cls, boxes: p.boxes,
        down: p.drag ? function (e) { self.startDrag(e, p.id, 'piece'); } : function () { self.setState({ sel: p.id }); } });
    });
    layers.sort(function (a, b) { return a.key - b.key; });

    var targets = { AC: [340, 494, 64, 'ac'], GAS: [404, 585, 20, 'gas'], W: [341, 303, 60, null], '8': [404, 594, 30, null], k: [326, 586, 30, 'panelbox'], '2': [470, 150, 40, null] };
    var colors = { AC: '#4fc3f7', GAS: '#ffb74d', W: '#ff7043', '8': '#b39ddb', k: '#66bb6a', '2': '#ff4fa3' };
    var ft = targets[focus] || targets.AC;

    // ugrási útvonal
    var route = [[300, 548, 0], [445, 492, 19], [457, 378, 13], [424, 106, 12], [318, 215, 16], [343, 406, 13]];
    var scr = route.map(function (p) { return P(p[0], p[1], p[2]); });
    var arcs = [], coins = [], hero = null;
    function qpt(a, c, b, t) { var u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; }
    for (var i = 0; i < scr.length - 1; i++) {
      var a = scr[i], b = scr[i + 1];
      var c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 84];
      arcs.push({ d: 'M' + r1(a[0]) + ',' + r1(a[1]) + ' Q' + r1(c[0]) + ',' + r1(c[1]) + ' ' + r1(b[0]) + ',' + r1(b[1]) });
      [0.3, 0.72].forEach(function (t, j) {
        var p = qpt(a, c, b, t);
        coins.push({ tr: trp([p[0], p[1] - 10]), op: i < 2 ? 0.35 : 1, d: r1((i * 2 + j) * 0.18) + 's' });
      });
      if (i === 2) { var hp = qpt(a, c, b, 0.5); hero = { tr: trp([hp[0], hp[1] - 30]) }; }
    }
    [[282, 378, 84], [296, 378, 90], [310, 378, 84]].forEach(function (p, j) { coins.push({ tr: trp(P(p[0], p[1], p[2])), op: 1, d: r1(j * 0.25) + 's' }); });
    var pads = route.slice(1, 5).map(function (p) { return { tr: trp(P(p[0], p[1], p[2])) }; });

    // eszköz-tűk (HTML), vezetővonallal a horgonyhoz
    var DEV = [
      { id: '1', name: 'Hőmérő, kis szoba', p: [470, 440, 46], o: [0, -36], val: L.t[0], show: true, kind: 't' },
      { id: '2', name: 'Hőmérő, nagy szoba', p: [470, 196, 46], o: [-44, -26], val: L.t[1], show: true, kind: 't' },
      { id: '3', name: 'Hőmérő, kályha mögött', p: [362, 292, 46], o: [28, -24], val: L.t[2], show: true, kind: 'hot' },
      { id: '4', name: 'Hőmérő, fürdő', p: [300, 400, 30], o: [-44, -14], val: L.t[3], show: true, kind: 't', vl: true },
      { id: '5', name: 'Bejárati ajtó: nyitásérzékelő az ajtókeret tetején', p: [301, 590, 49], o: [-34, 46], val: 'zárva' },
      { id: '6', name: 'Privát tároló ajtaja', p: [312, 505, 12], o: [-6, 34], val: 'zárva' },
      { id: '7', name: 'Konyha ablak', p: [218, 594, 30], o: [-30, 26], val: 'zárva' },
      { id: '8', name: 'Kis szoba ablak', p: [404, 594, 48], o: [-6, 40], val: L.open8 ? 'NYITVA!' : 'zárva', show: L.open8, kind: L.open8 ? 'bad' : '', alert: L.open8 },
      { id: '9', name: 'Nagy szoba bal ablak', p: [327, 50, 100], o: [0, -30], val: 'zárva' },
      { id: '10', name: 'Nagy szoba jobb ablak', p: [432, 50, 100], o: [0, -30], val: 'zárva' },
      { id: '11', name: 'Klíma (Gree, IR)', p: [340, 494, 98], o: [52, 4], val: 'fűt 23 °C' },
      { id: 'P', name: 'Kályhakapcsoló (LUXION), a nagy szoba felől a fürdőajtó mellett', p: [319, 324, 54], o: [8, -36], val: L.stage },
      { id: 'k5', name: 'Kör 5: cserépkályha', p: [326, 586, 40], o: [-150, 126], val: L.k5, sm: true },
      { id: 'k7', name: 'Kör 7: bojler', p: [326, 586, 40], o: [-120, 126], val: L.k7, sm: true },
      { id: 'k8', name: 'Kör 8: főzőlap és sütő', p: [326, 586, 40], o: [-90, 126], val: L.k8, sm: true },
      { id: 'k9', name: 'Kör 9: klíma', p: [326, 586, 40], o: [-60, 126], val: L.k9, sm: true },
      { id: 'G', name: 'Zigbee + IR gateway (a vitrin tetején)', p: [460, 568, 60], o: [46, 6], val: 'online' }
    ];
    var pins = DEV.map(function (m) {
      var g = P(m.p[0], m.p[1], m.p[2]);
      var o = pos['d' + m.id] || [0, 0];
      var ax = WX0 + WS * g[0] + o[0], ay = WY0 + WS * g[1] + o[1];
      var cls = 'pin' + (m.sm ? ' sm' : '') + (m.alert ? ' alert' : '') + (st.sel === 'd' + m.id ? ' sel' : '') + (st.drag === 'd' + m.id ? ' drag' : '');
      var fill = m.alert ? '#ff5a3c' : (m.id.charAt(0) === 'k' ? '#3d8f5c' : (m.kind === 't' || m.kind === 'hot' ? '#2f6fe4' : '#ff4fa3'));
      return { id: m.id, name: m.name, val: m.val, cls: cls, fill: fill, showVal: !!m.show,
        vcls: 'val' + (m.vl ? ' l' : '') + (m.kind === 'hot' ? ' hot' : '') + (m.kind === 'bad' ? ' bad' : ''),
        ax: r1(ax), ay: r1(ay), x: r1(ax + m.o[0]), y: r1(ay + m.o[1]),
        aria: m.id + ': ' + m.name + ', ' + m.val + '. Húzható.',
        down: function (e) { self.startDrag(e, 'd' + m.id, 'pin'); } };
    });

    var selText = 'Kattints egy tárgyra';
    if (st.sel) {
      var hit = null;
      sc.pieces.forEach(function (p) { if (p.id === st.sel) hit = p.name; });
      DEV.forEach(function (m) { if ('d' + m.id === st.sel) hit = m.id + ' ' + m.name + ': ' + m.val; });
      if (hit) selText = hit;
    }

    var tools = TL.map(function (t, j) {
      return { name: t.name, stat: t.stat, rarity: t.rarity, rc: t.rc, color: t.color, icon: t.icon,
        cls: j === ti ? 'on' : '', pressed: j === ti ? 'true' : 'false',
        pick: function () { self.setState({ tool: j, focus: t.target }); } };
    });
    var eq = TL[ti];

    var QS = [
      { title: 'Huzatvadász', desc: 'Csukd be a kis szoba ablakát, mielőtt a gáz fűt.', reward: '+250', prog: L.open8 ? '0/1' : '1/1', pw: L.open8 ? '4%' : '100%', done: !L.open8, target: '8' },
      { title: 'Kályhaszelídítő', desc: 'Éjjel max 2 fokozat a kályhán.', reward: '+400', prog: '2/3 éj', pw: '66%', done: false, target: 'W' },
      { title: 'Hűvös fej', desc: 'Klíma 23 °C limit vendég módban.', reward: '+150', prog: 'kész', pw: '100%', done: true, target: 'AC' },
      { title: 'Komfortzóna', desc: 'Nagy szoba 20-22 °C között.', reward: '+300', prog: '78%', pw: '78%', done: false, target: '2' },
      { title: 'Bojlerbarát', desc: 'Bojler csak éjszakai ablakban.', reward: '+200', prog: '4/7 nap', pw: '57%', done: false, target: 'k' }
    ];
    var questDone = 0;
    var quests = QS.map(function (q) {
      if (q.done) questDone++;
      return { title: q.title, desc: q.desc, reward: q.reward, prog: q.prog, pw: q.pw,
        bar: q.done ? '#3fae6a' : '#ff4fa3', boxFill: q.done ? '#3fae6a' : '#fffaf0',
        check: q.done ? 'M7.5 13.5l4 4 7-9' : '', cls: focus === q.target ? 'on' : '',
        aria: q.title + ': mutasd a térképen',
        pick: function () { self.setState({ focus: q.target }); } };
    });

    var levels = LV.map(function (l, j) {
      return { code: l.code, name: l.name, cls: (j === li ? 'on ' : '') + (j === 3 ? 'boss' : ''), pressed: j === li ? 'true' : 'false',
        pick: function () { self.setState({ lvl: j }); } };
    });
    var hearts = [0, 1, 2, 3, 4].map(function (j) { return { f: j < L.hearts ? '#ff4f6d' : '#e8dccb' }; });
    var ranking = [
      { name: 'Klíma, A1 kereten belül', v: '12', n: 12, c: '#4fc3f7', tc: '#1e2a44' },
      { name: 'Gázkonvektor', v: '15', n: 15, c: '#ffb74d', tc: '#1e2a44' },
      { name: 'Klíma, keret felett', v: '23', n: 23, c: '#81d4fa', tc: '#1e2a44' },
      { name: 'Kályha, B kereten belül', v: '23', n: 23, c: '#ffab91', tc: '#1e2a44' },
      { name: 'Kályha, keret felett', v: '60', n: 60, c: '#e8432f', tc: '#b02a17' }
    ].map(function (r) { r.w = Math.round(r.n / 60 * 100) + '%'; return r; });
    var badges = [
      { name: 'Zöld éj', bg: '#c8f2d4', op: 1, icon: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z' },
      { name: 'Ablakőr', bg: '#e6dcff', op: 1, icon: 'M4 4h16v16H4zM12 4v16M4 12h16' },
      { name: '7 nap', bg: '#eeeeee', op: 0.55, icon: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5z' }
    ];
    var wins = sc.winsBase.map(function (w) { return { glass: w.glass, frame: w.frame, shine: w.shine, fill: L.glass }; });

    return {
      sc: sc, L: L, wins: wins, layers: layers, arcs: arcs, coins: coins, pads: pads, hero: hero, pins: pins,
      fx: { horn: trw(344, 428, 28, 'sewing'), plant: trw(367, 59, 25, 'stand'), lamp: trw(298, 52, 56, 'flamp'), lamp2: trw(417, 68, 50, 'arclamp'), lamp3: trw(288.5, 137.5, 26, 'night'), lamp4: trw(288.5, 216.5, 26, 'night'), flag: trw(343, 406, 0, 'gchair1'), seat5: trw(400, 486, 0, 'dining') },
      focusFx: { tr: trw(ft[0], ft[1], ft[2], ft[3]), c: colors[focus] || '#4fc3f7' },
      bossW: Math.round(196 * L.boss),
      tools: tools, eq: { name: eq.name, effect: eq.effect, stat: eq.stat, color: eq.color, targetLabel: eq.targetLabel },
      quests: quests, questDone: questDone, levels: levels, hearts: hearts, ranking: ranking, badges: badges,
      selText: selText,
      onMove: function (e) { self.moveDrag(e); },
      onUp: function () { self.endDrag(); },
      reset: function () { self._drag = null; self.setState({ pos: {}, sel: null, drag: null }); },
      showPath: this.props.showPath ?? true,
      showMarkers: this.props.showMarkers ?? true
    };
  }
}
window.G3Scene = G3Scene;
