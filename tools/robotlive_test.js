/* A robotlive.js kalibrációjának egységtesztje: `node tools/robotlive_test.js`.
   Szintetikus robot-térkép: az alaprajzot elforgatjuk / tükrözzük, léptékezzük, eltoljuk, megzajosítjuk; a kalibrációnak
   vissza kell találnia a forgatást, a tükrözést és a hely hibája kicsi legyen. */
'use strict';
var RL = require('../web/js/robotlive.js'), S = require('../web/o2b/o2b-scene.js').O2BScene;
var fails = 0, n = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('HIBA: ' + m); } }

var FL = (S && S.FLOORS) || null;
var planUp = { fl: 'up', rooms: FL ? FL.up.rooms.filter(function (r) { return r.id !== 'lepcsohaz'; }) : [], dock: [3.0, 6.66] };
var planLo = { fl: 'lo', rooms: FL ? FL.lo.rooms.filter(function (r) { return !r.open; }) : [], dock: [4.0, 5.8] };

// a valódi (plan) -> képpont: a hamis robot térképe forgatva / tükrözve (inverz orient), léptékkel és eltolással
function inverse(u, v, r, m) {            // orient inverze
  for (var i = 0; i < r; i++) { var t = u; u = v; v = 1 - t; }   // egy lépés inverze: (a, b) -> (b, 1 - a)
  if (m) u = 1 - u;
  return [u, v];
}
function mkMap(plan, r, m, scale, ox, oy) {
  var pb = RL.planBox(plan.rooms), PW = pb[2] - pb[0], PH = pb[3] - pb[1];
  function toPx(x, y) {
    var u = (x - pb[0]) / PW, v = (y - pb[1]) / PH, q = inverse(u, v, r, m);
    var w = (r % 2 ? PH : PW) * scale, h = (r % 2 ? PW : PH) * scale;
    return [ox + q[0] * w, oy + q[1] * h];
  }
  var w = (r % 2 ? PH : PW) * scale, h = (r % 2 ? PW : PH) * scale;
  var map = { w: Math.round(ox * 2 + w), h: Math.round(oy * 2 + h), bbox: [ox, oy, ox + w, oy + h],
    charger: toPx(plan.dock[0], plan.dock[1]), rooms: plan.rooms.map(function (q) { var c = toPx(q.x + q.w / 2, q.y + q.d / 2); return { c: c, name: q.id }; }) };
  return { map: map, toPx: toPx };
}
// az inverse ellenőrzése: orient(inverse(x)) == x
for (var r = 0; r < 4; r++) for (var m = 0; m < 2; m++) {
  var q = inverse(0.3, 0.8, r, m), b = RL.orient(q[0], q[1], r, m);
  ok(Math.abs(b[0] - 0.3) < 1e-9 && Math.abs(b[1] - 0.8) < 1e-9, 'orient inverz r' + r + ' m' + m);
}
[['up', planUp], ['lo', planLo]].forEach(function (pp) {
  var plan = pp[1];
  for (var r = 0; r < 4; r++) for (var m = 0; m < 2; m++) {
    var g = mkMap(plan, r, m, 40, 25, 18), cal = RL.calibrate(g.map, plan);
    var name = pp[0] + ' r' + r + ' m' + m;
    ok(!!cal, name + ': nincs kalibráció');
    if (!cal) continue;
    // a hely hibája: néhány szoba-középpont és egy "útvonal" pont
    var worst = 0;
    plan.rooms.forEach(function (q) {
      var px = g.toPx(q.x + q.w / 2, q.y + q.d / 2), p = cal.toPlan(px[0], px[1]);
      worst = Math.max(worst, Math.hypot(p[0] - (q.x + q.w / 2), p[1] - (q.y + q.d / 2)));
    });
    ok(worst < 0.05, name + ': a hely hibája ' + worst.toFixed(3) + ' m (forgatás ' + cal.rot + ', tükör ' + cal.mirror + ')');
    var d = cal.toPlan(g.map.charger[0], g.map.charger[1]);
    ok(Math.hypot(d[0] - plan.dock[0], d[1] - plan.dock[1]) < 0.02, name + ': a dokk nem a helyén');
  }
});
// csak szobaközepek (bbox nélkül), kis zajjal: a forgatás akkor is meglegyen (a hely hibája lazább)
(function () {
  var g = mkMap(planUp, 1, 0, 40, 25, 18); delete g.map.bbox;
  g.map.rooms.forEach(function (q) { q.c = [q.c[0] + 3, q.c[1] - 2]; });
  var cal = RL.calibrate(g.map, planUp);
  ok(cal && cal.rot === 1 && cal.mirror === 0, 'szobaközepekből: forgatás 1, tükör nélkül');
})();
// kézi felülírás: a megadott forgatás érvényes (rossz forgatással is számol), a dx eltolja
(function () {
  var g = mkMap(planUp, 0, 0, 40, 25, 18);
  var a = RL.calibrate(g.map, planUp), b = RL.calibrate(g.map, planUp, { rot: a.rot, mirror: a.mirror, dx: 0.5, anchor: false });
  var c = RL.calibrate(g.map, planUp, { rot: a.rot, mirror: a.mirror, anchor: false });
  var p1 = c.toPlan(100, 100), p2 = b.toPlan(100, 100);
  ok(Math.abs(p2[0] - p1[0] - 0.5) < 1e-9, 'a dx eltolás nem érvényesül');
  var f = RL.calibrate(g.map, planUp, { rot: 2 });
  ok(f.rot === 2 && f.auto === false, 'a kézi forgatás nem érvényesül');
})();
// snap: a rés / fal helyett a legközelebbi szobába kerül
(function () {
  var p = RL.snap(planUp.rooms, 2.39, 2.0);     // a két szoba közti 0,12 m-es rés
  ok(RL.inRooms(planUp.rooms, p[0], p[1], 1e-9), 'snap a szobán belülre');
  var inside = RL.snap(planUp.rooms, 1.0, 1.0); ok(inside[0] === 1.0 && inside[1] === 1.0, 'a belső pont marad');
})();
// szimuláció: körbejár, a hossz pozitív
(function () {
  var s = RL.sim([[0, 0], [2, 0], [2, 2]], 0.5);
  ok(s.len > 0 && Math.abs(s.at(0)[0]) < 1e-9 && Math.abs(s.at(4)[0] - 2) < 1e-9, 'sim indulás és első szakasz');
})();
console.log(fails ? fails + ' HIBA / ' + n : 'robotlive kalibráció: ' + n + ' ellenőrzés OK');
process.exit(fails ? 1 : 0);
