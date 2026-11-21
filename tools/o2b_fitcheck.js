// Használat: node tools/o2b_fitcheck.js  (falba lógó, egymásba csúszó bútorok és vékony rések az O2B térképen)
// Bútor-illesztés ellenőrzés (2026.11.21): falba lógás, egymásba csúszó bútorok, vékony rések a fal mellett
const S = require(require('path').join(__dirname, '..', 'web', 'o2b', 'o2b-scene.js')).O2BScene;
const out = { wall: [], overlap: [], gap: [] };
['lo', 'up'].forEach(f => {
  const F = S.FLOORS[f], rooms = F.rooms.concat(f === 'lo' ? [{ id: 'erkely', x: F.balcony.x, y: F.balcony.y, w: F.balcony.w, d: F.balcony.d }] : []);
  const P = S.PIECES.filter(p => p.fl === f);
  const boxes = [];
  P.forEach(p => p.boxes.forEach((q, i) => { if (Array.isArray(q)) boxes.push({ id: p.id, i, x: q[0], y: q[1], w: q[2], d: q[3], z: q[4], h: q[5] }); }));
  const roomOf = b => { const cx = b.x + b.w / 2, cy = b.y + b.d / 2; return rooms.find(r => cx >= r.x - 0.01 && cx <= r.x + r.w + 0.01 && cy >= r.y - 0.01 && cy <= r.y + r.d + 0.01); };
  boxes.forEach(b => {
    const r = roomOf(b); if (!r) { out.wall.push(f + ' ' + b.id + '#' + b.i + ' nincs szobában'); return; }
    const o = [r.x - b.x, (b.x + b.w) - (r.x + r.w), r.y - b.y, (b.y + b.d) - (r.y + r.d)];
    const m = Math.max(...o); if (m > 0.025) out.wall.push(f + ' ' + b.id + '#' + b.i + ' kilóg a(z) ' + r.id + ' szobából ' + (m * 100).toFixed(0) + ' cm-t');
    // vékony rés a fal mellett (1,5-10 cm) magas, falra tolt bútornál
    if (b.h > 0.5) { const gaps = [b.x - r.x, (r.x + r.w) - (b.x + b.w), b.y - r.y, (r.y + r.d) - (b.y + b.d)]; gaps.forEach((gg, k) => { if (gg > 0.015 && gg < 0.10) out.gap.push(f + ' ' + b.id + '#' + b.i + ' rés ' + (gg * 100).toFixed(1) + ' cm (' + r.id + ', ' + ['Ny', 'K', 'É', 'D'][k] + ')'); }); }
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]; if (a.id === b.id) continue; if (a.h <= 0.035 || b.h <= 0.035) continue;
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y), oz = Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z);
    if (ox > 0.02 && oy > 0.02 && oz > 0.02) out.overlap.push(f + ' ' + a.id + '#' + a.i + ' × ' + b.id + '#' + b.i + ' (' + (ox * 100).toFixed(0) + '×' + (oy * 100).toFixed(0) + '×' + (oz * 100).toFixed(0) + ' cm)');
  }
});
console.log('FALBA LÓG (' + out.wall.length + '):\n ' + out.wall.join('\n '));
console.log('EGYMÁSBA CSÚSZIK (' + out.overlap.length + '):\n ' + out.overlap.join('\n '));
console.log('RÉS (' + out.gap.length + '):\n ' + out.gap.join('\n '));
