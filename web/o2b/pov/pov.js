// Porszívó-szem: a P2 (akciókamera) nézet oldala. A scene.js változtatás nélkül cserélhető
// (exportok: setMode, frame, setQuality). Élő adat: a szülő oldal pov-data üzenete.
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
let rob = qs.get('r') === 'R2' ? 'R2' : 'R1';
let data = null; // a szülőtől: {p, name, state, stateTxt, cleaning, battery, area_m2, minutes}
const fmt = (x, d = 1) => x.toFixed(d).replace('.', ',');
const num = (v) => typeof v === 'number' && isFinite(v);

function close() { try { parent.postMessage({ type: 'pov-close' }, location.origin); } catch (e) {} }
$('x').addEventListener('click', close);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== parent) return;
  const m = e.data; if (!m || m.type !== 'pov-data') return;
  data = m; if (m.p === 'R1' || m.p === 'R2') rob = m.p; chrome();
});

function chrome() {
  const up = rob === 'R2';
  $('rtag').textContent = '· ' + rob + ' · 4K · 60';
  $('l1').textContent = 'O2B · ' + (up ? 'Fent' : 'lent') + ' · ' + (data && data.name ? data.name : rob);
  const b = data && num(data.battery) ? Math.max(0, Math.min(100, data.battery)) : null;
  if (b != null) { $('hp').style.width = b + '%'; $('cap').textContent = 'AKKU ' + Math.round(b) + '%'; }
  else $('cap').textContent = 'AKKU (szimulált)';
}
chrome();

const STATE_LINE = (d) => {
  const s = String(d.state || '').toLowerCase();
  if (/return|dock|going/.test(s)) return 'Hazafelé tartok a dokkba.';
  if (/charg/.test(s) || s === 'docked') return s === 'charged' ? 'Fel vagyok töltve, pihenek.' : 'Töltődöm.';
  if (/pause/.test(s)) return 'Szünetelek.';
  if (/error/.test(s)) return 'Hibát jeleztem, segítség kellene.';
  if (/idle|standby/.test(s)) return 'Készenlétben vagyok.';
  if (/offline/.test(s)) return 'Nem érem el a hálózatot.';
  return d.stateTxt ? String(d.stateTxt).split(' · ')[0] + '.' : 'Itt vagyok.';
};

const say = $('say'); let curSub = '';
function sub(who, txt) {
  const k = who + txt;
  if (k !== curSub) {
    curSub = k; say.textContent = '';
    if (who) { const s = document.createElement('span'); s.className = who === 'R1' ? 'r' : 'c'; s.textContent = (who === 'R1' ? rob : 'Pamutka') + ': '; say.append(s, document.createTextNode(txt)); }
  }
  say.classList.toggle('on', !!who);
}
const LINES_LO = [
  [1.0, 4.4, 'C', 'Nyal, nyal… ne zavarj, épp mosakszom.'],
  [5.6, 8.6, 'R1', 'Takarítás folyamatban. Kérem, ne álljon az útba.'],
  [9.3, 10.9, 'C', 'Mrrr? Te meg ki vagy?'],
  [10.9, 12.5, 'R1', 'Akadály észlelve. Megvárom, amíg elmész.'],
  [13.1, 16.4, 'C', 'Hmpf. Úgyis én vagyok itt a főnök.'],
  [18.2, 20.0, 'C', 'Purrr… napozom, kerülj ki szépen.'],
  [20.0, 22.0, 'R1', 'Napozó macska. Kikerülöm, harminc centivel.'],
  [27.2, 28.8, 'C', 'Megint te? Miaú!'],
  [28.8, 30.4, 'R1', 'Elsőbbség a macskáé. Utána folytatom.'],
  [35.4, 38.8, 'C', 'Nyúúújtóóózom… ez nagyon fontos munka.']
];

// emelet (R2): a feliratok a robot és Pamutka tényleges időzítéséhez igazodnak (floorInfo().ev)
function linesUp(ev) {
  const { S1, L1, S2, L2, NAP0, WAKE, tKag, tGy, tBath, tStair } = ev;
  return [
    [0.4, 2.0, 'R1', 'Elhagyom a dokkot. Takarítás: emelet.'],
    [2.4, Math.max(2.6, S1 - 1.0), 'C', 'Nyal, nyal… várj, a farkam is kell.'],
    [S1 + 0.2, S1 + 2.0, 'C', 'Ez az én emeletem.'],
    [S1 + 2.0, S1 + L1 - 0.1, 'R1', 'Akadály az előtérben. Megvárom, amíg elmész.'],
    [S1 + L1 + 0.8, S1 + L1 + 3.0, 'C', 'Hmpf. Megyek aludni, ne zavarj.'],
    [tKag, tKag + 2.6, 'R1', 'Kagyló szoba: két monitor, sok kábel. Óvatosan.'],
    [tStair, tStair + 2.6, 'R1', 'A lépcsőnél a szakadásérzékelő szól. Oda nem megyek.'],
    [tGy, tGy + 2.4, 'R1', 'Gyerekszoba: szőnyeg, plüssök, tornagyűrű. Szuper.'],
    [NAP0 + 1.0, NAP0 + 3.2, 'C', 'Zzz… ez a zöld szőnyeg az enyém.'],
    [NAP0 + 3.4, NAP0 + 5.6, 'R1', 'Alvó macska. Kikerülöm, harminc centivel.'],
    [tBath, tBath + 2.6, 'R1', 'Fürdő: csúszós csempe. Csak a küszöbig megyek.'],
    [S2 - 0.6, S2 + 1.4, 'C', 'Megint te? Csak átsétálok az előtéren.'],
    [S2 + 1.4, S2 + L2 + 0.4, 'R1', 'Elsőbbség a macskáé. Utána hazamegyek.'],
    [S2 + L2 + 2.2, S2 + L2 + 5.4, 'C', 'Nyúúújtóóózom… az emelet nekem hajnalban a legjobb.']
  ].filter(l => l[1] > l[0]);
}
let LINES = LINES_LO, UPI = null;
const mini = $('mini').getContext('2d'), trail = [];
function hudUpdate(s, T) {
  const t = s.t % s.loop;
  if (UPI) { const p = s.rob.p, R = UPI.rooms.find(r => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1); if (R && $('v1').textContent !== R.n) $('v1').textContent = R.n; }
  const real = data && num(data.area_m2), run = !data || data.cleaning;
  const area = real ? data.area_m2 : s.area;
  $('v2').textContent = fmt(area, 1) + ' m²';
  const mins = data && num(data.minutes) ? Math.round(data.minutes) : null;
  $('l2').textContent = mins != null ? 'TAKARÍTVA · ' + mins + ' PERC' : (real ? 'TAKARÍTVA' : 'TAKARÍTVA · SZIMULÁLT');
  if (!(data && num(data.battery))) $('hp').style.width = '78%';
  $('ar').style.width = Math.max(8, 62 - s.area * 2) + '%';
  const sec = Math.max(0, Math.floor(T)), fr = Math.max(0, Math.floor((T % 1) * 30));
  $('tc').textContent = 'REC ' + String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0') + ':' + String(fr).padStart(2, '0');
  // felirat: takarítás közben a forgatókönyv, egyébként az állapot (a "returning" is állapotsor)
  const returning = data && /return|dock|going/i.test(String(data.state || ''));
  if (data && (!run || returning)) sub('R1', STATE_LINE(data));
  else { const L = LINES.find((l) => t >= l[0] && t < l[1]); if (L) sub(L[2], L[3]); else sub('', ''); }
  // GTA-szerű radar: a robot iránya felfelé, a térkép forog
  const Wm = 440, Hm = 290, sc = 62; mini.save(); mini.fillStyle = '#3d4a3a'; mini.fillRect(0, 0, Wm, Hm);
  mini.translate(Wm / 2, Hm * 0.62); mini.rotate(s.rob.h + Math.PI); mini.translate(-s.rob.p.x * sc, -s.rob.p.z * sc);
  if (UPI) {
    mini.fillStyle = '#8c9a86'; UPI.rooms.forEach(r => { mini.fillStyle = r.c; mini.fillRect(r.x0 * sc, r.z0 * sc, (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc); });
    mini.fillStyle = '#5d6a58'; UPI.furn.forEach(([x, z, w, d]) => mini.fillRect(x * sc, z * sc, w * sc, d * sc));
    mini.strokeStyle = '#1d211c'; mini.lineWidth = 5; UPI.rooms.forEach(r => mini.strokeRect(r.x0 * sc, r.z0 * sc, (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc));
    mini.fillStyle = '#2b2f2a'; mini.fillRect(0.25 * sc, 7.4 * sc, 1.0 * sc, 2.6 * sc);
  } else {
    mini.fillStyle = '#8c9a86'; mini.fillRect(0, 0, 4.4 * sc, 6.2 * sc); mini.fillRect(0, 6.35 * sc, 4.45 * sc, 4.7 * sc);
    mini.fillStyle = '#6d7a68'; [[0.15, 1.9, 0.95, 2.5], [0.15, 4.15, 1.75, 0.95], [4.0, 0.95, 0.4, 4.5], [0.05, 0.3, 0.45, 1.0], [1.74, 7.2, 0.96, 1.9]].forEach(([x, z, w, d]) => mini.fillRect(x * sc, z * sc, w * sc, d * sc));
    mini.strokeStyle = '#1d211c'; mini.lineWidth = 6; mini.strokeRect(0, 0, 4.4 * sc, 6.2 * sc);
  }
  trail.push([s.rob.p.x, s.rob.p.z]); if (trail.length > 1200) trail.shift(); if (t < 0.15) trail.length = 0;
  mini.strokeStyle = 'rgba(150,240,170,.55)'; mini.lineWidth = 0.34 * sc; mini.lineCap = 'round'; mini.beginPath(); trail.forEach(([x, z], i) => i ? mini.lineTo(x * sc, z * sc) : mini.moveTo(x * sc, z * sc)); mini.stroke();
  mini.fillStyle = '#ffb347'; mini.strokeStyle = '#1a1a1a'; mini.lineWidth = 3; mini.beginPath(); mini.arc(s.cat.p.x * sc, s.cat.p.z * sc, 11, 0, 7); mini.fill(); mini.stroke();
  mini.restore();
  mini.fillStyle = '#fff'; mini.strokeStyle = '#111'; mini.lineWidth = 3; mini.beginPath(); const cx = Wm / 2, cy = Hm * 0.62; mini.moveTo(cx, cy - 16); mini.lineTo(cx + 11, cy + 12); mini.lineTo(cx, cy + 6); mini.lineTo(cx - 11, cy + 12); mini.closePath(); mini.stroke(); mini.fill();
  const nA = -(s.rob.h + Math.PI), nx = cx + Math.sin(nA) * 120, ny = cy - Math.cos(nA) * 120;
  mini.font = '900 22px system-ui'; mini.textAlign = 'center'; mini.textBaseline = 'middle'; mini.fillStyle = '#fff'; mini.lineWidth = 4;
  const X = Math.max(14, Math.min(Wm - 14, nx)), Y = Math.max(14, Math.min(Hm - 14, ny)); mini.strokeText('É', X, Y); mini.fillText('É', X, Y);
}

async function main() {
  let sc;
  try { sc = await import('./scene.js'); }
  catch (e) { const m = $('msg'); m.style.display = 'flex'; m.textContent = 'A 3D nézet ezen az eszközön nem indult el (WebGL szükséges).'; try { parent.postMessage({ type: 'pov-error' }, location.origin); } catch (_) {} return; }
  sc.setFloor(rob === 'R2' ? 'up' : 'lo');
  if (rob === 'R2') { UPI = sc.floorInfo(); LINES = linesUp(UPI.ev); $('v1').textContent = 'Előtér'; }
  sc.setMode('p2');
  window.__sc = sc;
  let q = 1;
  const small = Math.min(innerWidth, innerHeight) < 600 || (matchMedia && matchMedia('(pointer:coarse)').matches && innerWidth < 900);
  if (small) { q = 0.6; sc.setQuality(q); }
  const lite = qs.get('lite') === '1';   // teszt: könnyített 3D (negyed felbontás, tükröződés és AO nélkül, kb. 3 kép/mp)
  if (lite) { q = 0.25; sc.setQuality(q); }
  if (qs.get('still') === '1') { // teszt: egy rögzített képkocka a megadott időpontban (?t=másodperc), q = 1
    const T0 = parseFloat(qs.get('t') || '0') || 0; q = parseFloat(qs.get('q') || '1') || 1; sc.setQuality(q);
    const s = sc.frame(T0, 1.0); sc.frame(T0, 0.016); const s2 = sc.frame(T0, 0.016); hudUpdate(s2, T0); window.__pov = { T: T0, q, still: true }; window.__still = true; void s;
    window.__renderAt = (tt) => { sc.frame(tt, 1.0); sc.frame(tt, 0.016); hudUpdate(sc.frame(tt, 0.016), tt); }; return;
  }
  let T = 0, last = performance.now(), fpsN = 0, fpsT = last, t0 = last, checked = small || lite, nextLite = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    if (lite && now < nextLite) return; if (lite) nextLite = now + 330;
    const dt = Math.min(lite ? 0.4 : 0.05, (now - last) / 1000); last = now; T += dt;
    const s = sc.frame(T, dt); hudUpdate(s, T);
    if (!checked) {
      fpsN++;
      if (now - t0 > 3000) { checked = true; if (fpsN * 1000 / (now - t0) < 24) { q = 0.6; sc.setQuality(q); } }
    }
    window.__pov = { T, q, fps: fpsN };
  }
  requestAnimationFrame(loop);
  try { parent.postMessage({ type: 'pov-ready' }, location.origin); } catch (e) {}
}
// a szülő a pov-ready után küldi az adatot; ha még nem jött, a kezdőérték a ?r= szerinti
main();
