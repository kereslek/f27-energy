// O2B porszívó-szem: az emelet (R2, Roborock S7) 3D-ben, a tulaj fotói és az alaprajz (o2b-scene.js, FLOORS.up) szerint.
// Koordináták az alaprajzzal egyeznek: x = kelet, z = dél (az alaprajz y-ja), y = fel. Méter.
// Tetőtér: sötétbarna (wenge) fagerendák, fehér falak, világos szürkés tölgy laminált padló, a kagyló szoba fala sötétkék,
// a gyerekszobáé zsályazöld, a fürdő fényes, aranyeres márványmintás csempe.
import * as THREE from 'three';

const H = 3.0;                       // szobák belmagassága
const RIDGE = 4.2, EAVE = 2.7;      // az előtér nyeregteteje (gerinc / ereszmagasság)

// ---- a robot útja: dokk, előtér, kagyló szoba, vissza, gyerekszoba, vissza, a fürdő küszöbe, haza ----
// (a lépcső nyílása x 0,25-1,25, z 7,4-10: a robot a z = 6,5 vonalon belül marad, mint a szakadásérzékelős igazi)
const PTS = [
  [3.0, 6.42], [2.55, 6.28], [2.0, 6.1], [1.6, 5.65], [1.72, 5.1], [1.78, 4.72], [1.55, 4.28], [1.1, 3.95], [0.9, 3.4], [0.9, 2.6], [1.0, 1.8], [1.02, 1.05],
  [0.85, 0.62], [0.62, 0.95], [0.62, 1.8], [0.85, 2.5], [0.92, 3.15], [0.95, 3.7], [1.25, 4.1], [1.58, 4.38], [1.78, 4.85], [1.85, 5.3], [2.4, 5.5],
  [2.85, 5.05], [3.3, 4.62], [3.35, 4.0], [3.35, 3.0], [3.35, 2.1], [3.3, 1.62], [3.15, 1.55], [3.08, 2.0], [3.1, 2.8], [3.12, 3.7], [3.2, 4.3],
  [3.3, 4.9], [3.5, 5.6], [3.75, 6.3], [4.3, 6.38], [4.75, 6.38], [5.05, 6.38], [4.7, 6.36], [4.3, 6.32], [3.9, 6.26], [3.5, 6.28]
];
// megállások: [kezdet, hossz]; a kezdőidőket a scene.js a robot nominális menetidejéből számolja (stopsFor)
const STOP_LEN = [3.8, 3.2, 4.2];
const STOPS_REF = [[0, STOP_LEN[0]], [0, STOP_LEN[1]], [0, STOP_LEN[2]]];

// Pamutka: a kulcskockák a robot idejéhez igazodnak
function keys(ctx) {
  const { V3, ahead, LOOP, at, pos } = ctx;
  const S1 = STOPS_REF[0][0], S2 = STOPS_REF[1][0], L1 = STOPS_REF[0][1], L2 = STOPS_REF[1][1];
  const A1 = ahead(S1, 0.95), rp2 = pos(S2);
  const START = V3(4.05, 5.25), DOOR = V3(3.45, 4.15), RUG = V3(2.76, 2.3), GRM = V3(2.7, 4.0), GDOOR = V3(3.3, 4.55);
  const Cc = V3(rp2.x - 1.0, rp2.z - 0.02), Cn = V3(rp2.x - 1.0, 5.4);
  const tKag = at(1.0, 1.8), tGy = at(3.35, 3.0, tKag), tIn = at(3.3, 1.62, tGy), tOutG = at(3.3, 4.9, tIn);
  const NAP0 = S1 + L1 + 9.5, WAKE = tOutG;
  const K = [
    { t: 0, pose: 'groom', p: START, face: 3.6 },
    { t: 1.6, pose: 'groom', p: START, face: 3.6 },
    { t: 2.2, pose: 'walk', p: START },
    { t: S1 - 0.4, pose: 'walk', p: A1 },
    { t: S1, pose: 'sit', p: A1, face: 'robot' },
    { t: S1 + L1 - 0.2, pose: 'sit', p: A1, face: 'robot' },
    { t: S1 + L1 + 0.5, pose: 'walk', p: A1 },
    { t: S1 + L1 + 4.8, pose: 'walk', p: DOOR },
    { t: NAP0 - 0.6, pose: 'walk', p: RUG },
    { t: NAP0, pose: 'lie', p: RUG, face: -Math.PI / 2 },
    { t: WAKE, pose: 'lie', p: RUG, face: -Math.PI / 2 },
    { t: WAKE + 0.8, pose: 'walk', p: RUG },
    { t: WAKE + 4.0, pose: 'walk', p: GRM },
    { t: WAKE + 4.6, pose: 'groom', p: GRM, face: 0.9 },
    { t: S2 - 5.2, pose: 'groom', p: GRM, face: 0.9 },
    { t: S2 - 4.6, pose: 'walk', p: GRM },
    { t: S2 - 3.6, pose: 'walk', p: GDOOR },
    { t: S2 - 1.6, pose: 'walk', p: Cn },
    { t: S2 - 0.2, pose: 'walk', p: Cc },
    { t: S2 + 0.3, pose: 'stretch', p: Cc, face: 'robot' },
    { t: S2 + L2 - 0.3, pose: 'stretch', p: Cc, face: 'robot' },
    { t: S2 + L2 + 0.4, pose: 'walk', p: Cc },
    { t: LOOP - 0.5, pose: 'walk', p: START },
    { t: LOOP, pose: 'walk', p: START }
  ];
  UPCFG.ev = { S1, L1, S2, L2, NAP0, WAKE, tKag, tGy, tBath: at(4.75, 6.38), tStair: S1 + L1 + 2.7 };
  for (let i = 1; i < K.length; i++) if (K[i].t <= K[i - 1].t) K[i].t = K[i - 1].t + 0.05;
  return K;
}
// megállások: [kezdet, hossz]; a kezdőidőket a scene.js a robot nominális menetidejéből számolja (stopsFor)
export const UPCFG = {
  pts: PTS,
  stopWps: [[2.2, 6.18], [3.5, 6.28], [3.1, 6.4]],       // közel ezekhez a pontokhoz áll meg a robot (a második a gyerekszoba utáni átkelés)
  stopsFor(arcTimes) {
    let acc = 0.35;
    STOPS_REF.forEach((st, i) => { st[0] = arcTimes[i] + acc; acc += STOP_LEN[i] + 0.7; });
    return STOPS_REF;
  },
  raysGain: 0.35, flareGain: 0.6, rug: [3.1, 1.9, 0.4, 0.6], wins: [[1.45, 1.55, -0.05], [3.48, 1.55, -0.05]], rays: [2.45, 1.7, -2.5],
  keys,
  rooms: [
    { id: 'kagylo', n: 'Kagyló szoba', x0: 0, z0: 0, x1: 2.45, z1: 4.62, c: '#7f93b0' },
    { id: 'gyerek', n: 'Gyerekszoba', x0: 2.45, z0: 0, x1: 4.55, z1: 4.62, c: '#8ca58f' },
    { id: 'furdo', n: 'Fürdő', x0: 4.55, z0: 5.65, x1: 6.5, z1: 7.05, c: '#a7b0b3' },
    { id: 'eloter', n: 'Előtér', x0: 0, z0: 4.62, x1: 4.55, z1: 7.4, c: '#aeb29f' },
    { id: 'lepcso', n: 'Lépcső', x0: 0, z0: 7.4, x1: 2.25, z1: 10.5, c: '#9a9e95' }
  ],
  plan: { w: 6.5, d: 10.5 },
  // radar-bútorok [x, z, w, d]
  furn: [
    [0.0, 0.4, 0.35, 3.1], [1.4, 0.3, 0.95, 2.16], [1.6, 2.65, 0.73, 1.35], [1.15, 3.17, 0.5, 0.5], [2.55, 0.1, 1.9, 0.55], [3.6, 1.6, 0.9, 2.05],
    [3.3, 6.6, 1.2, 0.45], [2.15, 4.7, 0.4, 0.3], [4.62, 6.62, 0.6, 0.4], [5.9, 5.7, 0.6, 1.3], [4.6, 5.7, 0.4, 0.42], [0.25, 7.4, 1.0, 2.6]
  ]
};

export function buildUp(C) {
  const { scene, room, add, mesh, bx, rbox, std, phys, tex, cv, rnd, aoBlob, rectLight, installReflector, reflHide, T } = C;

  // ---------- textúrák ----------
  function lamTex() { // világos szürkés tölgy laminált padló: 4 deszkasor, véletlen hosszak
    const Wd = 512, Ht = 1536, [c, g] = cv(Wd, Ht), [cb, gb] = cv(Wd, Ht), [cr, gr] = cv(Wd, Ht);
    g.fillStyle = '#b4aca0'; g.fillRect(0, 0, Wd, Ht); gb.fillStyle = '#000'; gb.fillRect(0, 0, Wd, Ht); gr.fillStyle = '#c0c0c0'; gr.fillRect(0, 0, Wd, Ht);
    const cw = Wd / 4, tones = ['#bdb5a8', '#b3ab9e', '#c3bbae', '#aea697', '#b8b0a2', '#c0b8aa'];
    for (let col = 0; col < 4; col++) {
      let y = -rnd() * 600;
      while (y < Ht) {
        const len = 480 + rnd() * 460, x = col * cw;
        g.fillStyle = tones[Math.floor(rnd() * tones.length)]; g.fillRect(x, y, cw, len);
        g.save(); g.beginPath(); g.rect(x, y, cw, len); g.clip();
        for (let k = 0; k < 44; k++) {
          g.strokeStyle = `rgba(${100 + rnd() * 25},${92 + rnd() * 22},${80 + rnd() * 20},${0.06 + rnd() * 0.16})`; g.lineWidth = 0.6 + rnd() * 1.6;
          g.beginPath(); const xo = x + rnd() * cw, a = rnd() * 4;
          for (let t = 0; t <= len; t += 24) g.lineTo(xo + Math.sin(t * 0.012 + a) * (2 + rnd() * 2), y + t); g.stroke();
        }
        for (let k = 0; k < 3; k++) { g.strokeStyle = 'rgba(95,82,62,0.12)'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(x + cw * (0.3 + rnd() * 0.4), y + len * (0.15 + rnd() * 0.7), 8 + rnd() * 10, 60 + rnd() * 90, 0, 0, 7); g.stroke(); }
        g.restore();
        g.strokeStyle = 'rgba(70,58,42,0.6)'; g.lineWidth = 1.6; g.strokeRect(x + 0.8, y + 0.8, cw - 1.6, len - 1.6);
        gb.fillStyle = '#e2e2e2'; gb.fillRect(x + 2, y + 2, cw - 4, len - 4);
        const rv = 130 + Math.floor(rnd() * 70); gr.fillStyle = `rgb(${rv},${rv},${rv})`; gr.fillRect(x + 2, y + 2, cw - 4, len - 4);
        y += len;
      }
    }
    return [tex(c), tex(cb, null, false), tex(cr, null, false)];
  }
  function marbleTex() { // fényes márványmintás csempe, arany és szürke erekkel, két csempe egy képen
    const S = 1024, [c, g] = cv(S, S), [cb, gb] = cv(S, S);
    g.fillStyle = '#ecebe8'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 90; k++) { const gr = g.createRadialGradient(rnd() * S, rnd() * S, 4, rnd() * S, rnd() * S, 80 + rnd() * 160); gr.addColorStop(0, `rgba(${200 + rnd() * 30},${200 + rnd() * 25},${196 + rnd() * 25},0.18)`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    g.lineCap = 'round';
    for (let k = 0; k < 18; k++) {
      const gold = rnd() > 0.45; g.strokeStyle = gold ? `rgba(190,150,84,${0.5 + rnd() * 0.45})` : `rgba(100,100,108,${0.3 + rnd() * 0.35})`; g.lineWidth = 2.5 + rnd() * 8;
      g.beginPath(); let x = rnd() * S, y = rnd() * S * 0.2, a = 1.2 + rnd() * 0.6; g.moveTo(x, y);
      for (let t = 0; t < 14; t++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * 80; y += Math.sin(a) * 80; g.lineTo(x, y); } g.stroke();
      if (gold) { g.lineWidth *= 0.35; g.strokeStyle = 'rgba(255,240,210,0.5)'; g.stroke(); }
    }
    gb.fillStyle = '#fff'; gb.fillRect(0, 0, S, S); gb.fillStyle = '#000'; gb.fillRect(S / 2 - 2, 0, 4, S); gb.fillRect(0, 0, 4, S); gb.fillRect(S - 4, 0, 4, S); gb.fillRect(0, 0, S, 4); gb.fillRect(0, S - 4, S, 4);
    g.fillStyle = 'rgba(120,110,100,0.5)'; g.fillRect(S / 2 - 1, 0, 2, S); g.fillRect(0, 0, 2, S);
    return [tex(c), tex(cb, null, false)];
  }
  function plaidTex() {
    const [c, g] = cv(256, 256); g.fillStyle = '#f2e6d4'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(205,140,86,0.55)'; for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 8, 0, 36, 256);
    g.fillStyle = 'rgba(205,140,86,0.45)'; for (let i = 0; i < 4; i++) g.fillRect(0, i * 64 + 8, 256, 36);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(120,90,60,${rnd() * 0.08})`; g.fillRect(rnd() * 256, rnd() * 256, 1, 2); }
    return tex(c, [1.6, 3.2]);
  }
  function grilleTex() { // áttört radiátorburkolat
    const [c, g] = cv(256, 128); g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#b8b6b0'; for (let y = 10; y < 118; y += 11) for (let x = (y / 11) % 2 ? 6 : 0; x < 256; x += 12) { g.beginPath(); g.moveTo(x + 6, y); g.lineTo(x + 12, y + 5.5); g.lineTo(x + 6, y + 11); g.lineTo(x, y + 5.5); g.closePath(); g.fill(); }
    return tex(c);
  }
  function spineTex(rows) {
    const [c, g] = cv(512, 512); g.fillStyle = '#2b1d14'; g.fillRect(0, 0, 512, 512);
    const rh = 512 / rows;
    for (let r = 0; r < rows; r++) { let x = 6; const y0 = r * rh + 8; while (x < 500) { const w = 8 + rnd() * 22, hh = rh * (0.62 + rnd() * 0.3); g.fillStyle = ['#7a2f2f', '#2f4a6a', '#d8c8a0', '#3c5b3e', '#c47a3a', '#e9e3d6', '#5b4a78', '#26323f'][Math.floor(rnd() * 8)]; g.fillRect(x, y0 + rh - 10 - hh, w, hh); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 2, y0 + rh - 10 - hh + 6, w - 4, 2); x += w + 1; } g.fillStyle = '#4a3322'; g.fillRect(0, (r + 1) * rh - 8, 512, 8); }
    return tex(c);
  }
  function bearTex() { // sötétzöld takaró apró mackó-arcokkal
    const [c, g] = cv(256, 256); g.fillStyle = '#16372c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) { const x = rnd() * 256, y = rnd() * 256; g.fillStyle = 'rgba(214,170,120,0.9)'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.beginPath(); g.arc(x - 5, y - 5, 2.6, 0, 7); g.arc(x + 5, y - 5, 2.6, 0, 7); g.fill(); g.fillStyle = '#2a1a10'; g.fillRect(x - 3, y - 1, 1.6, 2); g.fillRect(x + 2, y - 1, 1.6, 2); }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(80,150,90,0.5)'; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 7, 3, rnd() * 3, 0, 7); g.fill(); }
    return tex(c, [3, 6]);
  }
  function rugGreenTex() {
    const S = 512, [c, g] = cv(S, S); g.fillStyle = '#4c6b3c'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40000; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(180,210,150,0.12)' : 'rgba(20,40,15,0.16)'; g.fillRect(rnd() * S, rnd() * S, 2, 2); }
    g.strokeStyle = 'rgba(224,230,210,0.85)'; g.lineWidth = 8; g.strokeRect(14, 14, S - 28, S - 28);
    return tex(c);
  }
  const [lamC, lamB, lamR] = lamTex();
  const [marC, marB] = marbleTex();
  const SPN = spineTex(8), SPW = spineTex(8); SPW.repeat.set(7, 1);
  const M = {
    wall: std({ color: '#efede8', roughness: 0.93, env: 0.2, emissive: '#fff4e4', emissiveIntensity: 0.13, bumpMap: T.plasterTex(), bumpScale: 0.5 }),
    navy: std({ color: '#1c2f4f', roughness: 0.9, env: 0.15 }),
    ceil: std({ color: '#f3f1ed', roughness: 0.95, env: 0.2, side: THREE.DoubleSide, emissive: '#fff4e4', emissiveIntensity: 0.22 }),
    wenge: std({ color: '#3a271d', roughness: 0.6, env: 0.3 }),
    lam: phys({ map: lamC, bumpMap: lamB, bumpScale: 1.0, roughnessMap: lamR, roughness: 0.72, clearcoat: 0, env: 0.35 }),
    tile: phys({ map: marC, bumpMap: marB, bumpScale: 0.6, color: '#e2e0dc', roughness: 0.2, clearcoat: 0.25, clearcoatRoughness: 0.12, env: 0.5, side: THREE.DoubleSide }),
    door: std({ color: '#f7f6f2', roughness: 0.42, env: 0.4 }),
    black: std({ color: '#141416', roughness: 0.35, metalness: 0.3, env: 0.7 }),
    chrome: std({ color: '#cfd2d6', roughness: 0.18, metalness: 1, env: 1.4 }),
    navyF: std({ color: '#1b2a45', roughness: 0.55, env: 0.4 }),
    cognac: phys({ color: '#8a4d26', roughness: 0.8, sheen: 0.7, sheenColor: new THREE.Color('#c98a54'), sheenRoughness: 0.45, env: 0.3 }),
    plaid: std({ map: plaidTex(), roughness: 0.95, side: THREE.DoubleSide, env: 0.15 }),
    grille: std({ map: grilleTex(), roughness: 0.5 }),
    spines: std({ map: SPN, roughness: 0.7 }),
    spinesW: std({ map: SPW, roughness: 0.7 }),
    bear: phys({ map: bearTex(), roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color('#9ac7a8'), env: 0.2 }),
    grey: phys({ color: '#8a8d92', roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color('#c9ccd1') }),
    shaker: std({ color: '#8c9096', roughness: 0.5, env: 0.5 }),
    wood: std({ color: '#5a3a26', roughness: 0.55, env: 0.4 }),
    glass: phys({ color: '#d9e6ee', roughness: 0.05, transparent: true, opacity: 0.16, env: 1.2 }),
    rugG: phys({ map: rugGreenTex(), roughness: 1, sheen: 0.8, sheenColor: new THREE.Color('#d6e4c4'), env: 0.15 }),
    shag: phys({ color: '#6a6663', roughness: 1, sheen: 1, sheenColor: new THREE.Color('#bdb6ae'), env: 0.1 }),
    red: std({ color: '#b3262b', roughness: 0.95 }),
    orange: std({ color: '#ff6a1f', roughness: 0.7 }),
    leaf: std({ color: '#3e6b35', roughness: 0.6, side: THREE.DoubleSide, env: 0.3 }),
    bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(3) }),
    skyP: new THREE.MeshBasicMaterial({ map: T.skyTex(), toneMapped: true })
  };
  M.skyP.color.setScalar(2.4);
  M.sageW = std({ color: '#6b8574', roughness: 0.9, env: 0.15 });

  // ---------- geometria-segédek ----------
  const obst = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function quad(a, b, d, m, su = 1, sv = 1, cast = false) { // a-b az u irány, a-d a v irány; a negyedik csúcs b + d - a
    const A = V(...a), B = V(...b), D = V(...d), Cc = B.clone().add(D).sub(A);
    const lu = A.distanceTo(B), lv = A.distanceTo(D), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...A.toArray(), ...B.toArray(), ...Cc.toArray(), ...A.toArray(), ...Cc.toArray(), ...D.toArray()], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, lu / su, 0, lu / su, lv / sv, 0, 0, lu / su, lv / sv, 0, lv / sv], 2));
    g.computeVertexNormals(); return add(mesh(g, m, null, cast, true));
  }
  const floorQ = (x0, z0, x1, z1, m, su, sv) => quad([x0, 0, z1], [x1, 0, z1], [x0, 0, z0], m, su, sv);
  const lamPieces = [];
  const fl = (x0, z0, x1, z1) => lamPieces.push(floorQ(x0, z0, x1, z1, M.lam, 0.76, 2.28));
  const B = (x, z, w, d, y, h, m, cast = true) => add(bx(x, z, w, d, y, h, m, cast));
  const cyl = (x, y, z, r0, r1, h, m, seg = 24) => add(mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m, [x, y, z]));
  function beam(a, b, w, h, m = M.wenge) { // két végpont közé négyszög-keresztmetszetű gerenda
    const A = V(...a), Bv = V(...b), len = A.distanceTo(Bv), o = mesh(new THREE.BoxGeometry(w, h, len), m, null, true, true);
    o.position.copy(A).add(Bv).multiplyScalar(0.5); o.lookAt(Bv); return add(o);
  }

  // ---------- padló ----------
  fl(0, 0, 4.55, 7.05);
  fl(0, 7.05, 2.25, 7.4); fl(0, 7.4, 0.25, 10.5); fl(1.25, 7.4, 2.25, 10.5); fl(0.25, 10.0, 1.25, 10.5);
  const tileFloor = floorQ(4.55, 5.65, 6.5, 7.05, M.tile, 0.6, 1.2);
  installReflector([M.lam, M.tile], [...lamPieces, tileFloor], 3.2, 5.2, 7.4, 11.4);
  [[1.35, 4.6, 0.7], [2.95, 4.6, 0.7]].forEach(([x, z, w]) => B(x, z, w, 0.12, 0, 0.008, std({ color: '#cfc8b8', roughness: 0.4, metalness: 0.4 }), false));   // küszöbsín
  B(4.55, 5.95, 0.12, 0.8, 0, 0.008, std({ color: '#cfc8b8', roughness: 0.4, metalness: 0.4 }), false);

  // ---------- falak ----------
  const WT = 0.2, TOP = 4.5;
  B(-WT, -WT, WT, 10.9, 0, TOP, M.wall);                                                   // nyugat
  B(4.55, -WT, WT, 5.85, 0, TOP, M.wall);                                                  // kelet
  B(4.55, 5.65, 0.12, 0.3, 0, TOP, M.wall); B(4.55, 6.75, 0.12, 0.3, 0, TOP, M.wall); B(4.55, 5.95, 0.12, 0.8, 2.05, TOP - 2.05, M.wall);   // fürdő fala, ajtónyílás
  B(4.55, 5.45, 1.95 + WT, WT, 0, TOP, M.wall);                                            // fürdő északi fala
  B(6.5, 5.45, WT, 1.8 + WT, 0, TOP, M.wall);                                              // fürdő keleti fala
  B(2.25, 7.05, 4.25 + WT, WT, 0, TOP, M.wall);                                            // déli fal
  B(2.25, 7.05, WT, 3.45 + WT, 0, TOP, M.wall);                                            // lépcsőház keleti fala
  B(-WT, 10.5, 2.25 + WT * 2, WT, 0, TOP, M.wall);                                         // lépcsőház déli fala
  // szobák déli fala: ajtónyílások x 1,35-2,05 és 2,95-3,65, 2,05 magasak
  [[0, 1.35], [2.05, 2.95], [3.65, 4.55]].forEach(([a, b]) => B(a, 4.55, b - a, 0.15, 0, TOP, M.wall));
  [[1.35, 2.05], [2.95, 3.65]].forEach(([a, b]) => B(a, 4.55, b - a, 0.15, 2.05, TOP - 2.05, M.wall));
  // válaszfal: nyugat felől sötétkék, kelet felől zsályazöld ([+x, -x, +y, -y, +z, -z])
  { const part = new THREE.Mesh(new THREE.BoxGeometry(0.12, TOP, 4.62), [M.sageW, M.navy, M.wall, M.wall, M.wall, M.wall]); part.position.set(2.39, TOP / 2, 2.31); part.receiveShadow = true; part.castShadow = true; room.add(part); }
  // északi fal ablakokkal: ablak x 1,0-1,9 és 3,05-3,9, 0,95-2,1; a fal 2,3-ig, fölötte a ferde mennyezet
  [[0, 1.0], [1.9, 3.05], [3.9, 4.55]].forEach(([a, b]) => B(a, -0.12, b - a, 0.12, 0, 2.3, M.wall));
  [[1.0, 1.9], [3.05, 3.9]].forEach(([a, b]) => { B(a, -0.12, b - a, 0.12, 0, 0.95, M.wall); B(a, -0.12, b - a, 0.12, 2.1, 0.2, M.wall); });
  function winFrame(x0, x1) {
    const y0 = 0.95, y1 = 2.1, t = 0.06;
    B(x0, -0.1, x1 - x0, 0.12, y0, t, M.wenge, false); B(x0, -0.1, x1 - x0, 0.12, y1 - t, t, M.wenge, false);
    B(x0, -0.1, t, 0.12, y0, y1 - y0, M.wenge, false); B(x1 - t, -0.1, t, 0.12, y0, y1 - y0, M.wenge, false);
    B((x0 + x1) / 2 - 0.02, -0.08, 0.04, 0.1, y0, y1 - y0, M.wenge, false);
    add(mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), M.glass, [(x0 + x1) / 2, (y0 + y1) / 2, -0.04], false, false));
    B(x0 - 0.04, -0.02, x1 - x0 + 0.08, 0.14, y0 - 0.03, 0.03, M.door, false);
  }
  winFrame(1.0, 1.9); winFrame(3.05, 3.9);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), M.skyP); sky.position.set(2.4, 1.6, -3.2); scene.add(sky);

  // ---------- mennyezetek ----------
  const ceilQ = (a, b, d) => quad(a, b, d, M.ceil, 1, 1, true);
  ceilQ([0, H, 4.55], [4.55, H, 4.55], [0, H, 1.0]);
  ceilQ([0, 2.3, 0], [4.55, 2.3, 0], [0, H, 1.0]);                                // északon ferde
  ceilQ([0, EAVE, 4.7], [2.275, RIDGE, 4.7], [0, EAVE, 10.5]);                    // előtér + lépcsőház: nyugati tetősík
  ceilQ([4.55, EAVE, 4.7], [2.275, RIDGE, 4.7], [4.55, EAVE, 7.05]);              // keleti tetősík
  quad([4.55, 2.55, 7.05], [6.5, 2.55, 7.05], [4.55, 2.55, 5.65], M.ceil, 1, 1, true);        // fürdő

  // ---------- gerendák ----------
  beam([0.0, 2.72, 1.25], [2.33, 2.72, 1.25], 0.14, 0.2);
  beam([0.0, 2.5, 2.9], [2.33, 2.5, 2.9], 0.12, 0.18);
  beam([0.55, 0.0, 2.9], [0.55, 2.62, 2.9], 0.2, 0.2);                            // a nagy oszlop
  beam([0.0, 2.9, 3.6], [1.0, 2.45, 3.0], 0.1, 0.14); beam([0.0, 2.4, 3.4], [1.1, 2.95, 4.3], 0.1, 0.14);
  beam([0.0, 2.15, 3.8], [0.55, 2.45, 2.9], 0.1, 0.12);
  B(0.43, 2.8, 0.24, 0.24, 1.18, 0.1, M.orange, false); B(0.53, 2.68, 0.045, 0.045, 0.55, 0.68, M.orange, false);     // narancs öv
  beam([2.45, 2.6, 2.2], [4.55, 2.6, 2.2], 0.16, 0.2);
  beam([2.45, 2.7, 0.9], [4.55, 2.7, 0.9], 0.12, 0.16);
  beam([4.42, 0.0, 1.35], [4.42, 2.6, 1.35], 0.14, 0.14);
  beam([4.42, 1.35, 1.4], [4.42, 2.55, 2.2], 0.1, 0.12);
  beam([2.45, 1.95, 2.0], [3.0, 2.55, 2.2], 0.1, 0.12);
  // előtér: A-fachwerk a szobák déli falán, a térdfal fölött
  beam([0.0, EAVE - 0.1, 4.62], [2.275, RIDGE - 0.1, 4.62], 0.16, 0.2); beam([4.55, EAVE - 0.1, 4.62], [2.275, RIDGE - 0.1, 4.62], 0.16, 0.2);
  beam([2.275, 2.5, 4.62], [2.275, RIDGE - 0.05, 4.62], 0.14, 0.14);
  beam([0.55, 3.3, 4.62], [4.0, 3.3, 4.62], 0.1, 0.16);
  B(0, 4.7, 4.55, 0.18, 2.5, 0.05, std({ color: '#8f8c84', roughness: 0.8 }), false);   // szürke párkány a térdfal tetején
  // tetőablak az előtér keleti tetősíkján (világos fa béléssel)
  {
    const f = (x) => EAVE + (4.55 - x) * (RIDGE - EAVE) / 2.275;
    const x0 = 3.0, x1 = 3.9, y0 = f(x0), y1 = f(x1);
    quad([x0, y0 - 0.01, 6.3], [x1, y1 - 0.01, 6.3], [x0, y0 - 0.01, 5.3], new THREE.MeshBasicMaterial({ color: new THREE.Color('#bcd4ee').multiplyScalar(2.1) }));
    const wl = std({ color: '#c9a064', roughness: 0.6 });
    beam([x0, y0 - 0.04, 5.3], [x1, y1 - 0.04, 5.3], 0.1, 0.07, wl); beam([x0, y0 - 0.04, 6.3], [x1, y1 - 0.04, 6.3], 0.1, 0.07, wl);
    beam([x0, y0 - 0.04, 5.3], [x0, y0 - 0.04, 6.3], 0.1, 0.07, wl); beam([x1, y1 - 0.04, 5.3], [x1, y1 - 0.04, 6.3], 0.1, 0.07, wl);
    rectLight('#cfe0ff', 0.7, 0.9, 1.0, [3.45, f(3.45) - 0.05, 5.8], [3.2, 0, 5.4]);
  }

  // ---------- lábazat, ajtókeretek, ajtólapok ----------
  const skirt = (x, z, w, d) => B(x, z, w, d, 0, 0.1, M.door, false);
  skirt(0, 0, 1.0, 0.02); skirt(1.9, 0, 1.15, 0.02); skirt(3.9, 0, 0.65, 0.02);
  skirt(0, 0, 0.02, 4.55); skirt(2.31, 0, 0.02, 4.55); skirt(2.45, 0, 0.02, 4.55); skirt(4.53, 0, 0.02, 4.55);
  [[0, 1.35], [2.05, 2.95], [3.65, 4.55]].forEach(([a, b]) => { skirt(a, 4.53, b - a, 0.02); skirt(a, 4.7, b - a, 0.02); });
  skirt(0, 4.7, 0.02, 5.8); skirt(4.53, 4.7, 0.02, 1.0);
  const casing = (x0, x1, z) => { B(x0 - 0.06, z, 0.06, 0.2, 0, 2.11, M.door, false); B(x1, z, 0.06, 0.2, 0, 2.11, M.door, false); B(x0 - 0.06, z, x1 - x0 + 0.12, 0.2, 2.05, 0.06, M.door, false); };
  casing(1.35, 2.05, 4.5); casing(2.95, 3.65, 4.5);
  B(4.5, 5.89, 0.2, 0.06, 0, 2.11, M.door, false); B(4.5, 6.75, 0.2, 0.06, 0, 2.11, M.door, false); B(4.5, 5.89, 0.2, 0.92, 2.05, 0.06, M.door, false);
  function doorLeaf(hx, hz, ang, w) { // négytáblás fehér ajtólap, a zsanér a (hx, hz); a lap +x-e a zsanértól indul
    const g = new THREE.Group(); g.position.set(hx, 0, hz); g.rotation.y = ang;
    g.add(mesh(new THREE.BoxGeometry(w, 2.04, 0.045), M.door, [w / 2, 1.02, 0]));
    for (const s of [-1, 1]) for (const [yy, hh] of [[0.45, 0.42], [0.95, 0.4], [1.4, 0.4], [1.78, 0.42]]) g.add(mesh(new THREE.BoxGeometry(w - 0.24, hh, 0.012), M.door, [w / 2, yy, s * 0.027]));
    for (const s of [-1, 1]) { g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), M.black, [w - 0.07, 1.0, s * 0.045])); g.add(mesh(new THREE.BoxGeometry(0.11, 0.015, 0.015), M.black, [w - 0.12, 1.0, s * 0.07])); }
    room.add(g); return g;
  }
  doorLeaf(1.35, 4.7, -1.45, 0.7);                 // kagyló: nyugati zsanér, 83 fokra nyitva az előtér felé
  doorLeaf(3.65, 4.7, Math.PI + 1.45, 0.7);        // gyerek: keleti zsanér
  doorLeaf(4.55, 5.95, Math.PI + 0.1, 0.8);        // fürdő: északi zsanér, majdnem derékszögben nyitva

  // ---------- világítás ----------
  const spots = [];
  function twinSpot(x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.03, 0.025), M.black, [0, 0, 0]));
    for (const dx of [-0.1, 0.1]) { const can = mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 18), M.black, [dx, -0.04, 0.07]); can.rotation.x = 0.9; g.add(can); const b = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), M.bulb); b.position.set(dx, -0.065, 0.105); g.add(b); }
    room.add(g); spots.push(g);
  }
  twinSpot(1.0, 2.2, 4.72); twinSpot(3.3, 2.2, 4.72);
  { const g = new THREE.Group(); g.position.set(2.3, 2.0, 4.72); g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 14), M.black, [0, 0, 0.05])); const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), M.bulb); b.position.set(0, -0.02, 0.09); g.add(b); room.add(g); }
  const pl = (c, i, x, y, z, d = 0) => { const l = new THREE.PointLight(c, i, d, 2); l.position.set(x, y, z); scene.add(l); return l; };
  pl('#ffd9a8', 1.5, 2.0, 2.3, 5.5); pl('#ffe0b8', 0.9, 3.6, 2.3, 6.3); pl('#ffe1bc', 0.9, 1.0, 2.0, 2.4); pl('#ffe0b0', 0.9, 3.4, 2.1, 2.4); pl('#fff0e0', 0.8, 5.4, 2.3, 6.35); pl('#ffe8c8', 0.6, 1.0, 2.2, 8.4);
  scene.add(new THREE.HemisphereLight('#ffffff', '#cdbfa8', 0.38));
  const sun = new THREE.DirectionalLight('#ffc98f', 3.6);
  sun.position.set(2.4, 3.0, -4.4); sun.target.position.set(2.5, 0, 3.4); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 14 }); sun.shadow.radius = 3;
  const SUND = new THREE.Vector3().subVectors(sun.target.position, sun.position).normalize();
  rectLight('#dbe8ff', 2.2, 0.9, 1.15, [1.45, 1.5, 0.08], [1.45, 0.9, 2.5]); rectLight('#dbe8ff', 2.2, 0.85, 1.15, [3.48, 1.5, 0.08], [3.48, 0.9, 2.5]);

  // ================== KAGYLÓ SZOBA ==================
  // radiátor áttört fehér burkolattal az ablak alatt, rajta apró figurák
  B(1.05, 0.12, 0.8, 0.2, 0, 0.7, M.grille, false); B(1.03, 0.1, 0.84, 0.24, 0.7, 0.03, M.door, false);
  { const cols = ['#d94a3a', '#e7b94a', '#3d7fc4', '#4c9a5b', '#f2f2f0', '#b0603a', '#2c2c30'];
    for (let i = 0; i < 16; i++) add(mesh(new THREE.BoxGeometry(0.025, 0.07 + rnd() * 0.03, 0.02), std({ color: cols[i % cols.length], roughness: 0.6 }), [1.08 + i * 0.045, 0.78, 0.2])); }
  // bézs-barna kockás függöny az ablak jobb oldalán
  { const w = 0.5, h = 1.9, g = new THREE.PlaneGeometry(w, h, 18, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) / w * Math.PI * 5) * 0.035); g.computeVertexNormals();
    add(mesh(g, M.plaid, [1.82, 1.3, 0.2], true, true)); beam([1.0, 2.3, 0.2], [2.3, 2.3, 0.2], 0.03, 0.03, M.black); }
  // magas könyvespolc a nyugati falon, könyvgerincekkel
  B(0.0, 0.4, 0.32, 3.1, 0.0, 2.0, M.wood, true);
  { const p = add(mesh(new THREE.PlaneGeometry(3.0, 1.9), M.spinesW, [0.325, 1.0, 1.95], false, false)); p.rotation.y = Math.PI / 2; }
  obst.push([0.0, 0.4, 0.35, 3.5], [0.45, 2.8, 0.65, 3.0]);
  // konyakbarna kinyitható kanapé a keleti (kék) falnál a szoba végében
  { const g = new THREE.Group(); const Pp = (geo, x, y, z, m = M.cognac) => { const o = mesh(geo, m, [x, y, z]); g.add(o); return o; };
    Pp(rbox(0.66, 0.24, 2.1, 0.05), 1.75, 0.2, 1.4); Pp(rbox(0.56, 0.2, 2.0, 0.07), 1.72, 0.42, 1.4); Pp(rbox(0.22, 0.52, 2.1, 0.07), 2.2, 0.55, 1.4);
    Pp(rbox(0.66, 0.34, 0.18, 0.06), 1.75, 0.45, 0.43); Pp(rbox(0.66, 0.34, 0.18, 0.06), 1.75, 0.45, 2.37);
    for (const [px, pz] of [[1.5, 0.5], [1.5, 2.3]]) Pp(new THREE.BoxGeometry(0.06, 0.04, 0.06), px, 0.02, pz, M.black);
    const pil = (m, w, h, d, x, y, z, rz, ry) => { const o = mesh(rbox(w, h, d, 0.06), m, [x, y, z]); o.rotation.set(0, ry || 0, rz || 0); g.add(o); };
    pil(M.navyF, 0.14, 0.42, 0.42, 2.0, 0.78, 0.9, 0.25, 0.1); pil(M.grey, 0.14, 0.34, 0.5, 1.95, 0.72, 1.5, 0.2, -0.1);
    room.add(g); aoBlob(1.75, 1.4, 1.1, 2.4, 0.7); }
  obst.push([1.4, 0.3, 2.35, 2.46]);
  // klíma a kék falon, magasan
  add(mesh(rbox(0.26, 0.3, 0.9, 0.08), M.door, [2.2, 2.25, 2.85])); add(mesh(new THREE.BoxGeometry(0.01, 0.03, 0.8), M.black, [2.07, 2.15, 2.85], false, false));
  // sötétkék ívelt íróasztal két monitorral, hordozható géppel, fehér irodai szék
  { const g = new THREE.Group();
    g.add(mesh(rbox(0.72, 0.04, 1.35, 0.018), M.navyF, [1.95, 0.72, 3.32])); g.add(mesh(rbox(0.55, 0.04, 0.55, 0.018), M.navyF, [1.7, 0.72, 2.9]));
    for (const [lx, lz] of [[1.65, 2.75], [1.65, 3.95], [2.25, 2.75], [2.25, 3.95]]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), M.black, [lx, 0.35, lz]));
    const mon = (w, h, x, y, z, ry) => { const m = new THREE.Group(); m.position.set(x, y, z); m.rotation.y = ry; m.add(mesh(new THREE.BoxGeometry(w, h, 0.03), M.black, [0, 0, 0])); m.add(mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfe8f4').multiplyScalar(1.25) }), [0, 0, 0.0165])); g.add(m); };
    mon(0.34, 0.6, 2.15, 1.05, 3.05, -Math.PI / 2); mon(0.8, 0.34, 2.2, 0.98, 3.6, -Math.PI / 2 - 0.15);
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.012, 0.2), std({ color: '#c8cbd0', roughness: 0.3, metalness: 0.8 }), [1.8, 0.75, 3.75]));
    room.add(g); aoBlob(1.95, 3.3, 0.9, 1.5, 0.6);
    const ch = new THREE.Group(); ch.position.set(1.4, 0, 3.42);
    ch.add(mesh(rbox(0.46, 0.08, 0.46, 0.04), M.door, [0, 0.46, 0])); ch.add(mesh(rbox(0.06, 0.5, 0.44, 0.03), M.door, [-0.2, 0.78, 0])); ch.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 12), M.chrome, [0, 0.24, 0]));
    for (let i = 0; i < 5; i++) { const a = i * 1.2566; const leg = mesh(new THREE.BoxGeometry(0.28, 0.025, 0.04), M.door, [Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14]); leg.rotation.y = -a; ch.add(leg); ch.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), M.black, [Math.cos(a) * 0.27, 0.025, Math.sin(a) * 0.27])); }
    room.add(ch); aoBlob(1.4, 3.42, 0.7, 0.7, 0.5); }
  obst.push([1.15, 3.17, 1.65, 3.67], [1.6, 2.65, 2.33, 4.0]);
  // felállított jógamatrac az ajtónál a nyugati fal mellett, mellette habhenger
  cyl(0.28, 0.32, 4.3, 0.06, 0.06, 0.64, std({ color: '#2f62b8', roughness: 0.6 }));
  { const r = cyl(0.36, 0.075, 3.95, 0.075, 0.075, 0.45, std({ color: '#47563a', roughness: 0.9 })); r.rotation.z = Math.PI / 2; r.rotation.y = 0.3; }
  add(mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5), M.bulb, [1.2, H - 0.02, 2.4], false, false));

  // ================== GYEREKSZOBA ==================
  B(2.55, 0.1, 0.3, 0.45, 0.0, 2.0, M.wood); B(2.55, 0.1, 1.9, 0.55, 0.72, 0.045, M.wood); B(3.98, 0.1, 0.47, 0.55, 0, 0.72, M.wood); B(2.85, 0.45, 1.13, 0.1, 0.0, 0.7, M.wood, false);
  add(mesh(new THREE.PlaneGeometry(0.28, 1.9), M.spines, [2.7, 1.0, 0.555], false, false));
  obst.push([2.55, 0.1, 4.45, 0.65]);
  add(mesh(new THREE.SphereGeometry(0.11, 24, 16), std({ color: '#2d6db0', roughness: 0.4 }), [4.1, 0.9, 0.4])); cyl(4.1, 0.77, 0.4, 0.03, 0.05, 0.06, M.black);
  // kis fa karosszék zöld párnával és bézs kabáttal
  { const g = new THREE.Group(); g.position.set(2.8, 0, 0.95); g.rotation.y = 0.6;
    g.add(mesh(rbox(0.5, 0.06, 0.5, 0.02), M.wood, [0, 0.4, 0])); g.add(mesh(rbox(0.46, 0.08, 0.44, 0.03), std({ color: '#5f8a5b', roughness: 0.95 }), [0, 0.46, 0])); g.add(mesh(rbox(0.5, 0.55, 0.06, 0.02), M.wood, [0, 0.7, -0.24]));
    g.add(mesh(rbox(0.4, 0.4, 0.07, 0.03), std({ color: '#d9c8a6', roughness: 1 }), [0, 0.74, -0.2]));
    for (const [lx, lz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) g.add(mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.4, 8), M.wood, [lx, 0.2, lz]));
    room.add(g); aoBlob(2.8, 0.95, 0.8, 0.8, 0.5); }
  obst.push([2.5, 0.65, 3.1, 1.25]);
  add(mesh(new THREE.BoxGeometry(0.8, 0.015, 1.2), M.rugG, [3.1, 0.008, 1.9], false, true));
  // egyszemélyes ágy: szürke kárpitozott fejvég délen, mackós sötétzöld takaró, plüssök északon
  { const g = new THREE.Group();
    g.add(mesh(rbox(0.9, 0.3, 2.0, 0.05), M.grey, [4.05, 0.2, 2.6])); g.add(mesh(rbox(0.84, 0.2, 1.9, 0.07), M.bear, [4.05, 0.45, 2.55]));
    g.add(mesh(rbox(0.92, 0.5, 0.1, 0.04), M.grey, [4.05, 0.5, 3.64])); g.add(mesh(rbox(0.7, 0.1, 0.3, 0.05), std({ color: '#d9dcd2', roughness: 1 }), [4.05, 0.6, 1.8]));
    const bears = std({ color: '#7b4a2a', roughness: 1 }), tan = std({ color: '#c79a63', roughness: 1 });
    for (const [bx0, bz0, c] of [[3.88, 1.74, bears], [4.2, 1.7, tan], [4.05, 1.92, bears]]) { g.add(mesh(new THREE.SphereGeometry(0.08, 14, 10), c, [bx0, 0.66, bz0])); g.add(mesh(new THREE.SphereGeometry(0.055, 12, 8), c, [bx0, 0.76, bz0])); }
    room.add(g); aoBlob(4.05, 2.6, 1.2, 2.5, 0.7); }
  obst.push([3.6, 1.6, 4.5, 3.68]);
  // rácsos fali polc plüssökkel a keleti falon
  { const g = mesh(new THREE.PlaneGeometry(0.7, 0.8), std({ color: '#f2f2f0', roughness: 0.6 }), [4.54, 1.5, 1.4]); g.rotation.y = -Math.PI / 2; add(g);
    [['#c4423a', 1.2], ['#e7d56a', 1.42], ['#4a8f6a', 1.64]].forEach(([c, yy]) => B(4.34, 1.1, 0.2, 0.6, yy, 0.12, std({ color: c, roughness: 0.7 }), false));
    for (const [pz, c] of [[1.2, '#7b4a2a'], [1.4, '#c79a63'], [1.6, '#4a3a2a']]) add(mesh(new THREE.SphereGeometry(0.075, 12, 8), std({ color: c, roughness: 1 }), [4.4, 1.84, pz])); }
  B(4.2, 0.65, 0.34, 1.0, 0.0, 0.55, M.wood, true); B(4.28, 0.68, 0.26, 0.9, 0.55, 0.22, M.spines, false);
  obst.push([4.2, 0.65, 4.55, 1.65]);
  // tornagyűrűk kötélen a gerendáról
  { const rope = std({ color: '#b5a07a', roughness: 1 }), ringM = std({ color: '#e0c18b', roughness: 0.5 });
    for (const rx of [3.0, 3.4]) { cyl(rx, 2.0, 2.2, 0.012, 0.012, 1.1, rope, 8); const r = add(mesh(new THREE.TorusGeometry(0.09, 0.016, 10, 30), ringM, [rx, 1.42, 2.2])); r.rotation.x = Math.PI / 2 - 0.1; add(mesh(new THREE.SphereGeometry(0.018, 8, 6), M.chrome, [rx, 2.56, 2.2])); } }
  add(mesh(rbox(0.26, 0.3, 0.9, 0.08), M.door, [2.58, 2.25, 3.95]));      // klíma a zöld falon
  add(mesh(new THREE.BoxGeometry(0.03, 0.5, 0.38), M.door, [2.47, 1.5, 1.6]));   // keretes kép

  // ================== ELŐTÉR ==================
  { B(3.3, 6.6, 1.2, 0.45, 0.04, 0.82, M.door); B(3.24, 6.55, 1.32, 0.52, 0.86, 0.035, M.door, false);
    for (const [fx, fy] of [[3.3, 0.1], [3.3, 0.38], [3.3, 0.66], [3.9, 0.1], [3.9, 0.38], [3.9, 0.66]]) { B(fx + 0.03, 6.585, 0.54, 0.012, fy, 0.25, M.door, false); add(mesh(new THREE.SphereGeometry(0.022, 10, 8), std({ color: '#c79a63', roughness: 0.5 }), [fx + 0.3, fy + 0.12, 6.57])); }
    for (const x of [3.32, 4.4]) B(x, 6.62, 0.05, 0.05, 0, 0.05, M.door, false);
    const bc = ['#c43a3a', '#2f6db0', '#e7c53a', '#3d9a5b', '#e8e6e0', '#7a3a8a'];
    for (let i = 0; i < 9; i++) { const o = mesh(new THREE.BoxGeometry(0.14 + rnd() * 0.12, 0.05 + rnd() * 0.12, 0.1 + rnd() * 0.1), std({ color: bc[i % 6], roughness: 0.6 }), [3.4 + i * 0.1, 0.93 + (i % 3) * 0.1, 6.78 + rnd() * 0.1]); o.rotation.y = rnd(); add(o); }
    cyl(4.15, 0.9, 6.8, 0.07, 0.06, 0.1, std({ color: '#2f5f9c', roughness: 0.6 }));
    const cac = add(mesh(new THREE.SphereGeometry(0.1, 20, 14), std({ color: '#3f7a3a', roughness: 0.7 }), [4.15, 1.0, 6.8])); cac.scale.y = 1.2;
    cyl(3.55, 0.97, 6.85, 0.1, 0.08, 0.2, std({ color: '#b7683a', roughness: 0.7 }));
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28, l = mesh(new THREE.PlaneGeometry(0.2, 0.28, 2, 3), M.leaf, [3.55 + Math.cos(a) * 0.12, 1.3 + rnd() * 0.4, 6.85 + Math.sin(a) * 0.12]); l.rotation.set(-0.7 + rnd() * 0.4, -a, rnd() * 0.6); add(l); }
    aoBlob(3.9, 6.82, 1.5, 0.8, 0.6); }
  obst.push([3.3, 6.6, 4.5, 7.05]);
  // kis fehér polc a két ajtó között
  { for (let i = 0; i < 4; i++) B(2.15, 4.7, 0.4, 0.3, 0.05 + i * 0.32, 0.025, M.door, false);
    B(2.15, 4.7, 0.025, 0.3, 0.05, 1.0, M.door, false); B(2.525, 4.7, 0.025, 0.3, 0.05, 1.0, M.door, false);
    const bc = ['#b53a3a', '#2f6db0', '#e7c53a', '#3d9a5b']; for (let i = 0; i < 4; i++) B(2.19, 4.74, 0.04 + i * 0.015, 0.2, 0.1 + i * 0.04, 0.2, std({ color: bc[i], roughness: 0.7 }), false);
    B(2.18, 4.74, 0.34, 0.2, 0.37, 0.18, std({ color: '#4a6a8a', roughness: 0.7 }), false);
    cyl(2.36, 1.12, 4.82, 0.07, 0.065, 0.14, std({ color: '#7c7c7c', roughness: 0.4 })); B(2.14, 4.72, 0.04, 0.25, 1.1, 0.3, std({ color: '#c9a77c', roughness: 0.6 }), false); }
  obst.push([2.15, 4.7, 2.55, 5.0]);
  // robotdokk a déli falnál
  B(2.84, 6.9, 0.32, 0.12, 0, 0.12, M.door); B(2.84, 6.9, 0.32, 0.12, 0.12, 0.012, M.black, false);
  // lépcsőnyílás: fehér korlát, lent a lépcső és a meleg fény
  { const rail = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 0.11); beam([x0, 0.95, z0], [x1, 0.95, z1], 0.06, 0.05, M.door);
      for (let i = 0; i <= n; i++) { const t = i / n; cyl(x0 + (x1 - x0) * t, 0.46, z0 + (z1 - z0) * t, 0.012, 0.012, 0.92, M.door, 6); } beam([x0, 0.12, z0], [x1, 0.12, z1], 0.04, 0.04, M.door); };
    rail(0.25, 7.4, 1.25, 7.4); rail(1.25, 7.4, 1.25, 9.0);
    for (const [px, pz] of [[0.25, 7.4], [1.25, 7.4], [1.25, 9.0]]) B(px - 0.04, pz - 0.04, 0.08, 0.08, 0, 1.0, M.door);
    for (let i = 0; i < 12; i++) B(0.25, 7.4 + i * 0.215, 1.0, 0.215, -(i + 1) * 0.22 - 0.05, 0.22, M.door, false);
    const shaft = std({ color: '#d8d6d0', roughness: 0.9, side: THREE.DoubleSide });
    quad([0.25, -3.1, 10.0], [0.25, -3.1, 7.4], [0.25, 0, 10.0], shaft); quad([1.25, -3.1, 10.0], [1.25, -3.1, 7.4], [1.25, 0, 10.0], shaft);
    quad([0.25, -3.1, 10.0], [1.25, -3.1, 10.0], [0.25, 0, 10.0], shaft); quad([0.25, -3.1, 7.4], [1.25, -3.1, 7.4], [0.25, 0, 7.4], shaft);
    quad([0.25, -3.1, 7.4], [1.25, -3.1, 7.4], [0.25, -3.1, 10.0], std({ color: '#b8a98c', roughness: 0.9 }));
    pl('#ffd29a', 3.2, 0.75, -1.2, 8.7, 6);
    const ch = new THREE.Group(); ch.position.set(0.75, 2.7, 8.7); ch.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.0, 5), M.black, [0, 0.5, 0])); ch.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), M.black, [0, 0, 0]));
    for (let i = 0; i < 8; i++) { const a = i * 0.785, e = 0.28 + (i % 2) * 0.1, ar = mesh(new THREE.CylinderGeometry(0.004, 0.004, e, 5), M.black, [Math.cos(a) * e / 2, (i % 3 - 1) * 0.07, Math.sin(a) * e / 2]); ar.rotation.z = Math.PI / 2; ar.rotation.y = -a; ch.add(ar); const b = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), M.bulb); b.position.set(Math.cos(a) * e, (i % 3 - 1) * 0.07, Math.sin(a) * e); ch.add(b); }
    room.add(ch); }
  for (const [py, pz, c] of [[1.6, 8.0, '#c74b6a'], [1.5, 8.8, '#4a7ab0'], [1.65, 9.4, '#e0b04a']]) add(mesh(new THREE.BoxGeometry(0.03, 0.4, 0.3), std({ color: c, roughness: 0.7 }), [2.22, py, pz]));
  obst.push([0.0, 7.2, 0.3, 10.5], [0.2, 7.3, 1.3, 10.5]);

  // ================== FÜRDŐ ==================
  const wallT = (a, b, d) => quad(a, b, d, M.tile, 0.6, 1.2);
  wallT([4.55, 0, 5.655], [6.5, 0, 5.655], [4.55, 2.45, 5.655]);
  wallT([6.495, 0, 5.65], [6.495, 0, 7.05], [6.495, 2.45, 5.65]);
  wallT([4.55, 0, 7.045], [6.5, 0, 7.045], [4.55, 2.45, 7.045]);
  wallT([4.675, 0, 5.65], [4.675, 0, 5.95], [4.675, 2.45, 5.65]); wallT([4.675, 0, 6.75], [4.675, 0, 7.05], [4.675, 2.45, 6.75]);
  B(4.68, 6.62, 0.6, 0.4, 0.0, 0.85, M.shaker, true); B(4.66, 6.6, 0.64, 0.44, 0.85, 0.04, M.door, false);
  { const sink = add(mesh(new THREE.SphereGeometry(0.19, 24, 12, 0, 6.283, 0, 1.2), M.door, [4.98, 0.9, 6.83])); sink.scale.set(1, 0.3, 0.75); cyl(4.98, 0.95, 6.98, 0.012, 0.012, 0.14, M.chrome, 8); }
  B(4.76, 7.0, 0.5, 0.03, 1.1, 0.7, M.door, false); B(4.78, 6.99, 0.46, 0.012, 1.12, 0.66, std({ color: '#cfd8dc', roughness: 0.03, metalness: 1, env: 1.4 }), false);
  B(5.4, 6.78, 0.34, 0.27, 0.0, 1.05, M.tile, false);
  { add(mesh(rbox(0.36, 0.3, 0.52, 0.12), M.door, [5.57, 0.4, 6.68])); B(5.43, 6.9, 0.3, 0.05, 0.4, 0.04, M.door, false); }
  B(5.95, 5.7, 0.55, 1.3, 0.0, 0.55, M.tile, true); B(5.99, 5.78, 0.47, 1.14, 0.54, 0.05, M.door, false); cyl(6.45, 0.95, 6.35, 0.02, 0.02, 0.16, M.chrome, 8);
  B(4.68, 5.7, 0.38, 0.4, 0.0, 1.3, M.shaker); B(4.68, 5.7, 0.38, 0.4, 1.3, 0.2, M.door, false); B(4.68, 5.7, 0.38, 0.4, 1.5, 0.7, M.shaker);
  for (let i = 0; i < 4; i++) B(5.055, 5.78, 0.012, 0.25, 0.1 + i * 0.3, 0.02, M.chrome, false);
  { for (let i = 0; i < 9; i++) B(5.15, 5.7, 0.42, 0.018, 0.4 + i * 0.1, 0.018, M.chrome, false); B(5.15, 5.68, 0.018, 0.06, 0.38, 0.95, M.chrome, false); B(5.55, 5.68, 0.018, 0.06, 0.38, 0.95, M.chrome, false); B(5.22, 5.67, 0.28, 0.05, 0.85, 0.5, M.red, false); }
  add(mesh(rbox(0.6, 0.03, 0.4, 0.015), M.shag, [5.45, 0.02, 6.3]));
  for (const [sx, sz] of [[5.0, 6.0], [5.5, 6.35], [6.0, 6.7]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 12), M.bulb); b.position.set(sx, 2.54, sz); scene.add(b); }
  obst.push([4.6, 5.7, 5.08, 6.12], [4.62, 6.62, 5.3, 7.02], [5.4, 6.5, 5.95, 7.05], [5.9, 5.7, 6.5, 7.0]);

  // ---------- napsugár, por ----------
  const beams = new THREE.Group(); scene.add(beams);
  const S = C.makeShafts(SUND, beams);
  S.beam(1.05, 1.85, 0.95, 2.1); S.beam(3.1, 3.85, 0.95, 2.1);
  const dust = S.dust(0.9, 4.0, 0.8, 5.5, 2.3); reflHide.push(beams, dust.points);
  const crumbs = [];
  for (let i = 0; i < 150; i++) {
    const z = 0.7 + rnd() * 5.8, x = z > 4.7 ? 0.7 + rnd() * 3.5 : (rnd() > 0.5 ? 0.7 + rnd() * 1.3 : 2.7 + rnd() * 1.1);
    const o = mesh(new THREE.SphereGeometry(0.0015 + rnd() * 0.0025, 5, 4), std({ color: rnd() > 0.4 ? '#e6dfd2' : '#9a8f80', roughness: 1 }), [x, 0.003, z], false, false); add(o); crumbs.push(o);
  }
  return { sun, SUND, beams, dust: dust.points, dustM: dust.mat, sky, crumbs, obst };
}
