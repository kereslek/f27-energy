// O2B porszívó-szem: a nappali (R1, lent) és az emelet (R2, fent) 3D-ben a fotók szerint, sétáló Pamutkával.
// A szintet a setFloor('lo'|'up') választja, az első képkocka előtt. Koordináták: x = kelet, z = dél, y = fel. Méter.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildUp, UPCFG } from './scene-up.js';

const W = 1280, H = 720;
const RH = 3.1;                        // belmagasság
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.56;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1a1f');
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.environment = envTex;

// ---------- segédek ----------
let seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, rep, srgb = true) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (rep) t.repeat.set(rep[0], rep[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function std(o) { const e = o.env ?? 0.35; delete o.env; const m = new THREE.MeshStandardMaterial(o); m.envMapIntensity = e; return m; }
function phys(o) { const e = o.env ?? 0.35; delete o.env; const m = new THREE.MeshPhysicalMaterial(o); m.envMapIntensity = e; return m; }
function mesh(g, m, p, cast = true, recv = true) {
  const o = new THREE.Mesh(g, m); if (p) o.position.set(p[0], p[1], p[2]);
  o.castShadow = cast; o.receiveShadow = recv; return o;
}
// doboz a padló-koordinátákból: x0, z0, szél, mély, y0, mag
function bx(x, z, w, d, y, h, m, cast = true) { return mesh(new THREE.BoxGeometry(w, h, d), m, [x + w / 2, y + h / 2, z + d / 2], cast); }
function rbox(w, h, d, r, seg = 3) { // lekerekített doboz (kárpit, párna)
  const g = new THREE.BoxGeometry(w, h, d, 6, 4, 6), p = g.attributes.position, v = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
    const n = v.clone().sub(c); if (n.lengthSq() > 0) n.normalize().multiplyScalar(r);
    v.copy(c.add(n)); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}
const room = new THREE.Group(); scene.add(room);
function add(o) { room.add(o); return o; }

// ---------- textúrák ----------
// halszálka tölgy parketta: rácsvektorok a=(w,w), b=(L,-L), csempe 2L × 2L
function parquetTex() {
  const S = 1024, Lm = 0.42, wm = 0.07, px = S / (2 * Lm), L = Lm * px, w = wm * px;
  const [c, g] = cv(S, S), [cb, gb] = cv(S, S), [cr, gr2] = cv(S, S);
  gb.fillStyle = '#000'; gb.fillRect(0, 0, S, S); gr2.fillStyle = '#9a9a9a'; gr2.fillRect(0, 0, S, S);
  const tones = ['#b08560', '#bd9166', '#a37a55', '#c59b72', '#ab8260', '#b98e66', '#9d7551', '#c19670'];
  function plank(x, y, pw, ph, horiz) {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const X = x + ox, Y = y + oy; if (X > S || Y > S || X + pw < 0 || Y + ph < 0) continue;
      const base = tones[Math.floor(rnd() * tones.length)];
      g.fillStyle = base; g.fillRect(X, Y, pw, ph);
      // erezet
      g.save(); g.beginPath(); g.rect(X, Y, pw, ph); g.clip();
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(${90 + rnd() * 40},${55 + rnd() * 25},${25},${0.08 + rnd() * 0.14})`; g.lineWidth = 0.6 + rnd() * 1.4;
        g.beginPath();
        const off = rnd() * (horiz ? ph : pw), amp = 1 + rnd() * 3, fr = 0.01 + rnd() * 0.03;
        for (let t = 0; t <= 1.001; t += 0.02) {
          const a = (horiz ? pw : ph) * t, b = off + Math.sin(a * fr + k) * amp;
          if (horiz) g.lineTo(X + a, Y + b); else g.lineTo(X + b, Y + a);
        }
        g.stroke();
      }
      const gr = horiz ? g.createLinearGradient(X, Y, X + pw, Y) : g.createLinearGradient(X, Y, X, Y + ph);
      gr.addColorStop(0, 'rgba(255,240,210,0.06)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(60,30,10,0.08)');
      g.fillStyle = gr; g.fillRect(X, Y, pw, ph);
      g.restore();
      g.strokeStyle = 'rgba(70,40,15,0.55)'; g.lineWidth = 1.2; g.strokeRect(X + 0.5, Y + 0.5, pw - 1, ph - 1);
      gb.fillStyle = '#d8d8d8'; gb.fillRect(X + 1, Y + 1, pw - 2, ph - 2);
      // laponkénti fényesség-különbség (kopott, matt és frissen olajozott lapok) és csiszolási karcok
      const rv = 120 + Math.floor(rnd() * 135); gr2.fillStyle = `rgb(${rv},${rv},${rv})`; gr2.fillRect(X + 1, Y + 1, pw - 2, ph - 2);
      gr2.save(); gr2.beginPath(); gr2.rect(X, Y, pw, ph); gr2.clip();
      for (let k = 0; k < 7; k++) { const q = 70 + Math.floor(rnd() * 160); gr2.strokeStyle = `rgba(${q},${q},${q},0.5)`; gr2.lineWidth = 0.6 + rnd() * 1.2; gr2.beginPath(); const o = rnd() * (horiz ? ph : pw); if (horiz) { gr2.moveTo(X, Y + o); gr2.lineTo(X + pw, Y + o + (rnd() - 0.5) * 3); } else { gr2.moveTo(X + o, Y); gr2.lineTo(X + o + (rnd() - 0.5) * 3, Y + ph); } gr2.stroke(); }
      gr2.restore();
    }
  }
  for (let i = -8; i < 16; i++) for (let j = -4; j < 6; j++) {
    const x = i * w + j * L, y = i * w - j * L;
    plank(x, y, L, w, true);           // vízszintes
    plank(x + L, y + w - L, w, L, false); // függőleges
  }
  return [tex(c), tex(cb, null, false), tex(cr, null, false)];
}
function fibreTex() { // sűrű, rövid szálak: szőnyegpihe (szürkeárnyalat, csempézhető)
  const [c, g] = cv(256, 256); g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) { const x = rnd() * 256, y = rnd() * 256, a = rnd() * 6.283, l = 2 + rnd() * 4, v = 60 + Math.floor(rnd() * 170); g.strokeStyle = `rgba(${v},${v},${v},0.75)`; g.lineWidth = 0.9 + rnd() * 0.8;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); } }
  return tex(c, null, false);
}
function noiseFill(g, w, h, base, amt, n = 9000, sz = 2) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const v = rnd(); g.fillStyle = v > 0.5 ? `rgba(255,255,255,${amt * rnd()})` : `rgba(0,0,0,${amt * rnd()})`; g.fillRect(rnd() * w, rnd() * h, sz, sz); }
}
function rugTex(kind) {
  const S = 1024, [c, g] = cv(S, S);
  if (kind === 'cream') {
    noiseFill(g, S, S, '#e6dccb', 0.10, 60000, 2);
    g.strokeStyle = 'rgba(150,135,110,0.35)'; g.lineWidth = 10; g.strokeRect(40, 40, S - 80, S - 80);
    g.lineWidth = 3; g.strokeRect(70, 70, S - 140, S - 140);
    for (let k = 0; k < 120; k++) { // kopott, halvány minta
      g.fillStyle = `rgba(${140 + rnd() * 40},${125 + rnd() * 30},${100 + rnd() * 30},${0.05 + rnd() * 0.1})`;
      const x = 120 + rnd() * (S - 240), y = 120 + rnd() * (S - 240), r = 10 + rnd() * 60;
      g.beginPath(); g.ellipse(x, y, r, r * (0.3 + rnd()), rnd() * 3, 0, 7); g.fill();
    }
    for (let k = 0; k < 700; k++) { const x = rnd() * S, y = rnd() * S, l = 30 + rnd() * 120, a = (rnd() - 0.5) * 0.5 + (k % 3 === 0 ? 1.57 : 0); g.strokeStyle = rnd() > 0.5 ? `rgba(255,250,240,${0.05 + rnd() * 0.09})` : `rgba(90,75,55,${0.05 + rnd() * 0.08})`; g.lineWidth = 2 + rnd() * 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    g.strokeStyle = 'rgba(150,130,105,0.28)'; g.lineWidth = 6; g.beginPath(); g.ellipse(S / 2, S / 2, 260, 180, 0, 0, 7); g.stroke();
    g.beginPath(); g.ellipse(S / 2, S / 2, 120, 80, 0, 0, 7); g.stroke();
  } else { // kék-bézs, kopott (étkező)
    noiseFill(g, S, S, '#9fb0bf', 0.14, 60000, 2);
    g.fillStyle = 'rgba(230,220,200,0.55)'; g.fillRect(90, 90, S - 180, S - 180);
    for (let k = 0; k < 200; k++) { g.fillStyle = `rgba(${50 + rnd() * 60},${80 + rnd() * 50},${120 + rnd() * 50},${0.1 + rnd() * 0.25})`; const x = 90 + rnd() * (S - 180), y = 90 + rnd() * (S - 180); g.fillRect(x, y, 4 + rnd() * 40, 3 + rnd() * 14); }
    g.strokeStyle = 'rgba(40,60,95,0.6)'; g.lineWidth = 14; g.strokeRect(50, 50, S - 100, S - 100);
  }
  return tex(c);
}
function cordTex() {
  const [c, g] = cv(256, 256), [b, gb] = cv(256, 256);
  noiseFill(g, 256, 256, '#e4ddd0', 0.05, 3000, 1);
  gb.fillStyle = '#000'; gb.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 8) { const gr = gb.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#000'); gr.addColorStop(0.5, '#fff'); gr.addColorStop(1, '#000'); gb.fillStyle = gr; gb.fillRect(x, 0, 8, 256); g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, 0, 1.5, 256); }
  return [tex(c, [6, 6]), tex(b, [6, 6], false)];
}
function oakTex(rep) {
  const [c, g] = cv(512, 512); g.fillStyle = '#c9a274'; g.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 160; k++) { g.strokeStyle = `rgba(110,70,35,${0.05 + rnd() * 0.15})`; g.lineWidth = 0.5 + rnd() * 2; g.beginPath(); const y0 = rnd() * 512; for (let x = 0; x <= 512; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.02 + k) * 4); g.stroke(); }
  return tex(c, rep);
}
function chevronTex() {
  const [c, g] = cv(512, 256); g.fillStyle = '#c69e70'; g.fillRect(0, 0, 512, 256);
  for (let i = -4; i < 20; i++) for (const s of [-1, 1]) {
    g.save(); g.translate(256 + (s > 0 ? 0 : -1), i * 32); g.rotate(s * Math.PI / 4);
    g.fillStyle = ['#c49a6a', '#cfa877', '#b98e60', '#d3ad7d'][(i + s + 8) % 4]; g.fillRect(s > 0 ? 0 : -400, 0, 400, 30);
    g.strokeStyle = 'rgba(80,50,20,0.35)'; g.strokeRect(s > 0 ? 0 : -400, 0, 400, 30); g.restore();
  }
  return tex(c, [1, 1]);
}
function skyTex() {
  const [c, g] = cv(1024, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#6f95c8'); gr.addColorStop(0.45, '#f3c9a0'); gr.addColorStop(0.7, '#ffd9a6'); gr.addColorStop(1, '#ffe8c8');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < 9; k++) { // szemközti bérházak ablakokkal
    const x = k * 120 - 20 + rnd() * 30, w = 110 + rnd() * 40, h = 190 + rnd() * 150;
    g.fillStyle = ['#c9a88a', '#b89c84', '#d6bfa0', '#a98f7c'][k % 4]; g.fillRect(x, 512 - h, w, h);
    g.fillStyle = 'rgba(90,60,40,0.5)'; g.fillRect(x, 512 - h, w, 8);
    for (let wy = 512 - h + 24; wy < 470; wy += 38) for (let wx = x + 10; wx < x + w - 20; wx += 28) { g.fillStyle = rnd() > 0.8 ? '#ffd890' : '#4d5866'; g.fillRect(wx, wy, 14, 22); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(wx - 2, wy + 22, 18, 2); }
  }
  for (let k = 0; k < 900; k++) { const x = rnd() * 1024, y = 230 + rnd() * 300, r = 10 + rnd() * 34; g.fillStyle = `rgba(${40 + rnd() * 40},${80 + rnd() * 50},${35 + rnd() * 25},${0.35 + rnd() * 0.4})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  return tex(c);
}
function artTex() {
  const [c, g] = cv(256, 384); g.fillStyle = '#6e2a35'; g.fillRect(0, 0, 256, 384);
  for (let k = 0; k < 140; k++) { g.fillStyle = ['#d9c7a3', '#3e6b5c', '#c98a5a', '#2c3f63', '#e7d9c0'][k % 5]; g.globalAlpha = 0.5 + rnd() * 0.5; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 384, 3 + rnd() * 14, 2 + rnd() * 6, rnd() * 3, 0, 7); g.fill(); }
  g.globalAlpha = 1; return tex(c);
}
function blobTex() { // puha kontakt-árnyék
  const [c, g] = cv(128, 128); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c, null, false);
}
const BLOB = blobTex();
function aoBlob(x, z, w, d, op = 0.55) {
  const m = new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, opacity: op, depthWrite: false });
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); o.rotation.x = -Math.PI / 2; o.position.set(x, 0.004, z); o.renderOrder = 1; return add(o);
}
// cirmos bunda: ezüst alap, sötét foltok a háton (mau-szerű), csíkok, világos has
function furTex() {
  const Wd = 1024, Ht = 512, [c, g] = cv(Wd, Ht);
  const gr = g.createLinearGradient(0, 0, 0, Ht);
  gr.addColorStop(0, '#8d8f93'); gr.addColorStop(0.3, '#b3b5b8'); gr.addColorStop(0.62, '#d3d4d5'); gr.addColorStop(0.85, '#e9e8e5'); gr.addColorStop(1, '#f2f1ee');
  g.fillStyle = gr; g.fillRect(0, 0, Wd, Ht);
  for (let i = 0; i < 30000; i++) { // szőrszálak
    const x = rnd() * Wd, y = rnd() * Ht, l = 3 + rnd() * 7, v = rnd();
    g.strokeStyle = v > 0.55 ? `rgba(252,252,252,${0.28 * rnd()})` : `rgba(40,40,45,${0.24 * rnd()})`; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y + l); g.stroke();
  }
  // ezüst cirmos: oldalt hosszú, megtört függőleges csíkok a gerinctől lefelé, a hason fokozatosan eltűnnek
  g.lineCap = 'round';
  for (let k = 0; k < 46; k++) {
    const x0 = (k + (rnd() - 0.5) * 0.5) * Wd / 46; let x = x0, y = 4 + rnd() * 12; const len = 150 + rnd() * 150;
    g.strokeStyle = `rgba(36,36,42,${0.5 + rnd() * 0.3})`; g.lineWidth = 3 + rnd() * 3.5;
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 8; j++) { y += len / 8; x += (rnd() - 0.5) * 7; g.lineWidth = Math.max(1.2, g.lineWidth * 0.93); g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 520; i++) { // apró foltok a hát felé és a combon
    const y = rnd() * Ht * 0.62, x = rnd() * Wd, r = 2.5 + rnd() * 6;
    g.fillStyle = `rgba(48,48,54,${0.22 + rnd() * 0.3})`; g.beginPath(); g.ellipse(x, y, r * 1.5, r * 0.7, (rnd() - 0.5) * 0.6, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(30,30,35,0.8)'; // gerinccsík
  for (let x = 0; x < Wd; x += 2) g.fillRect(x, 0, 2, 12 + Math.sin(x * 0.05) * 4);
  return tex(c);
}
function stripeTex(dark = 0.8) { // farok és láb gyűrűi
  const [c, g] = cv(64, 256); g.fillStyle = '#b4b5b8'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 40) { g.fillStyle = `rgba(45,45,50,${dark * 0.5})`; g.fillRect(0, y, 64, 7); }
  for (let i = 0; i < 1500; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)'; g.fillRect(rnd() * 64, rnd() * 256, 1, 4); }
  return tex(c);
}
function eyeTex() { // 2:1 vászon, hogy a szivárványhártya kör legyen a gömbön
  const [c, g] = cv(256, 128); g.fillStyle = '#3a342c'; g.fillRect(0, 0, 256, 128);
  const gr = g.createRadialGradient(128, 64, 3, 128, 64, 42);
  gr.addColorStop(0, '#f0dc5a'); gr.addColorStop(0.35, '#d7c744'); gr.addColorStop(0.75, '#8fb23c'); gr.addColorStop(1, '#3f6a24');
  g.fillStyle = gr; g.beginPath(); g.ellipse(128, 64, 42, 42, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(20,30,10,0.85)'; g.lineWidth = 3.5; g.beginPath(); g.ellipse(128, 64, 41, 41, 0, 0, 7); g.stroke();
  for (let k = 0; k < 40; k++) { const a = rnd() * 6.283; g.strokeStyle = `rgba(${rnd() > 0.5 ? '255,240,120' : '60,90,20'},${0.25 + rnd() * 0.3})`; g.lineWidth = 1; g.beginPath(); g.moveTo(128 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); g.lineTo(128 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.stroke(); }
  g.fillStyle = '#050505'; g.beginPath(); g.ellipse(128, 64, 11, 30, 0, 0, 7); g.fill();
  return tex(c);
}
// fej: homlok-M, szemvonal, pofacsíkok a textúrába sütve (512x256 = 1,42 px/fok, 0,5 u = előre)
function headTex() {
  const [c, g] = cv(512, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#a2a4a8'); gr.addColorStop(0.45, '#c3c4c6'); gr.addColorStop(1, '#dcdcda');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 16000; i++) { const x = rnd() * 512, y = rnd() * 256; g.strokeStyle = rnd() > 0.55 ? `rgba(250,250,250,${0.25 * rnd()})` : `rgba(40,40,45,${0.22 * rnd()})`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y + 3 + rnd() * 5); g.stroke(); }
  g.lineCap = 'round'; g.strokeStyle = 'rgba(34,34,40,0.8)';
  for (const sd of [-1, 1]) {
    const X = (d) => 256 + sd * d;
    g.lineWidth = 3.2; g.beginPath(); g.moveTo(X(36), 108); g.quadraticCurveTo(X(55), 100, X(78), 106); g.stroke();       // szemvonal hátrafelé
    g.lineWidth = 2.6; g.beginPath(); g.moveTo(X(30), 124); g.quadraticCurveTo(X(52), 130, X(72), 140); g.stroke();       // pofacsík
    g.lineWidth = 2.2; g.beginPath(); g.moveTo(X(34), 136); g.quadraticCurveTo(X(52), 148, X(66), 160); g.stroke();
    g.lineWidth = 3; for (const k of [0, 1, 2]) { g.beginPath(); g.moveTo(X(10 + k * 9), 40); g.quadraticCurveTo(X(12 + k * 9), 58, X(8 + k * 9), 76 - k * 3); g.stroke(); }  // homlokcsíkok
    g.lineWidth = 2; g.beginPath(); g.moveTo(X(30), 96); g.lineTo(X(24), 104); g.stroke();
  }
  g.lineWidth = 3.4; g.beginPath(); g.moveTo(256, 26); g.lineTo(256, 70); g.stroke();   // középső csík
  g.fillStyle = 'rgba(244,243,238,0.5)'; g.beginPath(); g.ellipse(256, 130, 20, 12, 0, 0, 7); g.fill();  // orrnyereg világosabb
  return tex(c);
}

function plasterTex() { const [c, g] = cv(512, 512); g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 26000; i++) { const v = 100 + rnd() * 60; g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.beginPath(); g.arc(rnd() * 512, rnd() * 512, 0.6 + rnd() * 2.6, 0, 7); g.fill(); } return tex(c, [3, 3], false); }
function leafTex(kind) { // banánlevél és kis levél, áttetsző szélekkel
  const [c, g] = cv(256, 512); g.clearRect(0, 0, 256, 512);
  const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, kind ? '#3f7a34' : '#2f6129'); gr.addColorStop(0.5, kind ? '#5c9a45' : '#467f36'); gr.addColorStop(1, kind ? '#3f7a34' : '#2f6129');
  g.fillStyle = gr; g.beginPath(); g.moveTo(128, 6); g.bezierCurveTo(250, 120, 250, 380, 128, 506); g.bezierCurveTo(6, 380, 6, 120, 128, 6); g.fill();
  g.strokeStyle = 'rgba(215,235,170,0.7)'; g.lineWidth = 4; g.beginPath(); g.moveTo(128, 10); g.lineTo(128, 500); g.stroke();
  g.strokeStyle = 'rgba(20,50,15,0.35)'; g.lineWidth = 1.2; for (let y = 30; y < 490; y += 9) { g.beginPath(); g.moveTo(128, y); g.lineTo(20, y + 26); g.moveTo(128, y); g.lineTo(236, y + 26); g.stroke(); }
  if (kind) { g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 6; k++) { const y = 80 + rnd() * 360, sd = rnd() > 0.5 ? 1 : -1; g.beginPath(); g.moveTo(128 + sd * 30, y); g.lineTo(128 + sd * 130, y + 14); g.lineTo(128 + sd * 130, y + 20); g.closePath(); g.lineWidth = 3; g.stroke(); } g.globalCompositeOperation = 'source-over'; }
  return tex(c);
}
function tvTex() { const [c, g] = cv(512, 288); const gr = g.createLinearGradient(0, 0, 0, 288); gr.addColorStop(0, '#0d2a4a'); gr.addColorStop(0.55, '#2f6d7f'); gr.addColorStop(1, '#0b1a14'); g.fillStyle = gr; g.fillRect(0, 0, 512, 288);
  for (let i = 0; i < 5; i++) { g.strokeStyle = `rgba(120,255,190,${0.18 + rnd() * 0.2})`; g.lineWidth = 18 + rnd() * 20; g.beginPath(); for (let x = 0; x <= 512; x += 16) g.lineTo(x, 70 + i * 14 + Math.sin(x * 0.012 + i) * 30); g.stroke(); }
  g.fillStyle = '#06110c'; g.beginPath(); g.moveTo(0, 288); for (let x = 0; x <= 512; x += 8) g.lineTo(x, 220 - Math.abs(Math.sin(x * 0.07)) * 50 - rnd() * 10); g.lineTo(512, 288); g.fill();
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.8})`; g.fillRect(rnd() * 512, rnd() * 120, 1.4, 1.4); }
  return tex(c); }
// ---------- anyagok ----------
const MAT = {
  wall: std({ color: '#cfccc7', roughness: 0.92, env: 0.2, bumpMap: plasterTex(), bumpScale: 0.6 }),
  ceil: std({ color: '#f4f2ee', roughness: 0.95, env: 0.2 }),
  white: std({ color: '#f3f2ef', roughness: 0.45, env: 0.5 }),
  skirt: std({ color: '#f7f6f2', roughness: 0.4 }),
  black: std({ color: '#141416', roughness: 0.35, metalness: 0.2, env: 0.6 }),
  felt: std({ color: '#1b1b1d', roughness: 1 }),
  oak: std({ map: oakTex([1, 1]), roughness: 0.55, env: 0.4 }),
  chevron: std({ map: chevronTex(), roughness: 0.5, env: 0.4 }),
  walnut: std({ color: '#4a2f1f', roughness: 0.45, env: 0.5 }),
  glass: phys({ color: '#d9e6ee', roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.18, env: 1.2 }),
  velvet: phys({ color: '#24402f', roughness: 0.85, sheen: 1, sheenColor: new THREE.Color('#5f8a6c'), sheenRoughness: 0.4 }),
  sheer: std({ color: '#fbf8f2', roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, emissive: '#fff3dd', emissiveIntensity: 0.08 }),
  grey: phys({ color: '#8d8f93', roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color('#c9ccd1') }),
  boucle: phys({ color: '#ece6da', roughness: 1, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.6 }),
  sage: phys({ color: '#7d8f73', roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color('#b8c9ae') }),
  knit: phys({ color: '#1e2421', roughness: 1, sheen: 0.4 }),
  steel: std({ color: '#b9bcc0', roughness: 0.3, metalness: 0.9, env: 1 }),
  tv: std({ color: '#050506', roughness: 0.12, metalness: 0.1, env: 1.2 }),
  leaf: std({ color: '#3e6b35', roughness: 0.6, side: THREE.DoubleSide, env: 0.3 }),
  leaf2: std({ color: '#5b8a3e', roughness: 0.6, side: THREE.DoubleSide, env: 0.3 }),
  pot: std({ color: '#f1efe9', roughness: 0.35 }),
  soil: std({ color: '#3a2a1e', roughness: 1 })
};

// ---------- közös: padlótükör, szintváltás ----------
export const QUAL = { refl: true, ao: true };
const rMat = { value: new THREE.Matrix4() }, rStr = { value: 0.0 };
const reflHide = [];
let refl = null, rrt = null;
// fényes padló: síktükör a padló síkjában, elmosva és fresnellel keverve (a bumpMap fugakép is kell az anyagon)
function installReflector(mats, floors, cx, cz, w, d) {
  refl = new Reflector(new THREE.PlaneGeometry(w, d), { textureWidth: 1024, textureHeight: 576, clipBias: 0.002, multisample: 0 });
  refl.rotation.x = -Math.PI / 2; refl.position.set(cx, -0.001, cz); refl.material.colorWrite = false; refl.material.depthWrite = false; scene.add(refl);
  rrt = refl.getRenderTarget(); rrt.texture.generateMipmaps = true; rrt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const obr = refl.onBeforeRender;
  refl.onBeforeRender = function (r, sc, c) {
    if (!QUAL.refl || sc !== scene || c.isOrthographicCamera || sc.overrideMaterial) return;
    floors.forEach(f => f.visible = false); reflHide.forEach(o => o.visible = false);
    obr.call(this, r, sc, c);
    floors.forEach(f => f.visible = true); reflHide.forEach(o => o.visible = true);
    rMat.value.copy(this.material.uniforms.textureMatrix.value).multiply(new THREE.Matrix4().copy(this.matrixWorld).invert());
  };
  mats.forEach(m => { m.onBeforeCompile = (sh) => {
    sh.uniforms.tRefl = { value: rrt.texture }; sh.uniforms.rMat = rMat; sh.uniforms.rStr = rStr;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 rMat; varying vec4 vRefl;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvRefl = rMat * modelMatrix * vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tRefl; uniform float rStr; varying vec4 vRefl;')
      .replace('#include <opaque_fragment>', `{
        vec2 ruv = vRefl.xy / vRefl.w + normal.xy * 0.012;
        float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        float fr = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
        float gap = smoothstep(0.35, 0.8, texture2D(bumpMap, vBumpMapUv).r);
        vec3 rc = textureLod(tRefl, ruv, 0.8 + (1.0 - fr) * 1.6 + roughnessFactor * 2.6).rgb;
        outgoingLight += rc * rStr * (0.16 + 0.84 * fr) * gap * (1.25 - roughnessFactor);
      }
      #include <opaque_fragment>`);
  }; });
}
function rectLight(color, inten, w, h, pos, look) { const l = new THREE.RectAreaLight(color, inten, w, h); l.position.set(...pos); l.lookAt(...look); scene.add(l); return l; }
// szintenként épülő elemek (a setFloor tölti)
let floor, sun, SUND, beams, dust, dustM, sky;
const crumbs = [];
let BUILT = null;

function buildLo() {
const [parqC, parqB, parqR] = parquetTex();
const [cordC, cordB] = cordTex();
MAT.cord = phys({ map: cordC, bumpMap: cordB, bumpScale: 1.5, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#fffaf0'), sheenRoughness: 0.5, env: 0.25 });
MAT.rug = phys({ map: rugTex('cream'), roughness: 1, sheen: 0.8, sheenColor: new THREE.Color('#fff8ea'), env: 0.15 });
MAT.rugB = phys({ map: rugTex('blue'), roughness: 1, sheen: 0.6, env: 0.15 });
// szőnyegpihe: bump + a szín finom szálas modulálása (közelről, a padló magasságából ez a kép fele)
function detailize(m, rx, ry, amt, bs) {
  const det = fibreTex(); det.repeat.set(rx, ry); m.bumpMap = det; m.bumpScale = bs;
  m.onBeforeCompile = (sh) => { sh.uniforms.tDet = { value: det };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tDet;')
      .replace('#include <map_fragment>', `#include <map_fragment>\n{ vec2 du = vMapUv * vec2(${rx.toFixed(1)}, ${ry.toFixed(1)}); float dd = texture2D(tDet, du).r * 0.5 + texture2D(tDet, du * 0.19 + 0.37).r * 0.5; diffuseColor.rgb *= mix(1.0, 0.25 + dd * 1.5, ${amt.toFixed(2)}); }`); };
}
detailize(MAT.rug, 26, 35, 0.65, 3.0); detailize(MAT.rugB, 30, 33, 0.55, 2.5);
MAT.floor = phys({ map: parqC, bumpMap: parqB, bumpScale: 0.8, roughnessMap: parqR, roughness: 0.52, clearcoat: 0.3, clearcoatRoughness: 0.3, env: 0.6 });

// ---------- szoba: padló, falak, mennyezet ----------
const RX = 4.4, RZ = 6.2;
const floorG = new THREE.PlaneGeometry(RX + 0.4, 11.6);
const uv = floorG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (RX + 0.4) / 0.84, uv.getY(i) * 11.6 / 0.84);
parqC.rotation = parqB.rotation = parqR.rotation = Math.PI / 4;
floor = mesh(floorG, MAT.floor, [RX / 2, 0, 5.6], false, true); floor.rotation.x = -Math.PI / 2; add(floor);
installReflector([MAT.floor], [floor], RX / 2, 5.6, RX + 0.4, 11.6);

function wallPiece(x0, z0, x1, z1, y0, y1, m = MAT.wall, t = 0.12) {
  const len = Math.hypot(x1 - x0, z1 - z0), o = mesh(new THREE.BoxGeometry(len, y1 - y0, t), m, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  o.rotation.y = -Math.atan2(z1 - z0, x1 - x0); return add(o);
}
// északi fal nyílásokkal: ablak 1.15-1.95 (0.9-2.6), erkélyajtó 2.0-2.9 (0-2.6), ablak 2.95-3.8
const NZ = -0.06;
wallPiece(-0.1, NZ, 1.15, NZ, 0, RH); wallPiece(1.95, NZ, 2.0, NZ, 0, RH); wallPiece(2.9, NZ, 2.95, NZ, 0, RH); wallPiece(3.8, NZ, RX + 0.1, NZ, 0, RH);
wallPiece(1.15, NZ, 1.95, NZ, 0, 0.9); wallPiece(2.95, NZ, 3.8, NZ, 0, 0.9);
wallPiece(1.15, NZ, 3.8, NZ, 2.6, RH);
wallPiece(-0.06, -0.1, -0.06, 11.2, 0, RH);                 // nyugati fal
wallPiece(RX + 0.06, -0.1, RX + 0.06, 6.3, 0, RH);           // keleti fal (TV)
// déli fal a kétszárnyú üvegajtóval (1.45-3.1)
wallPiece(-0.1, RZ + 0.07, 1.45, RZ + 0.07, 0, RH, MAT.wall, 0.15); wallPiece(3.1, RZ + 0.07, RX + 0.1, RZ + 0.07, 0, RH, MAT.wall, 0.15); wallPiece(1.45, RZ + 0.07, 3.1, RZ + 0.07, 2.35, RH, MAT.wall, 0.15);
// étkező (a nyitott üvegajtón át látszik)
wallPiece(4.5, 6.2, 4.5, 11.2, 0, RH, MAT.wall); wallPiece(-0.1, 11.15, 4.6, 11.15, 0, RH);
const ceil = mesh(new THREE.PlaneGeometry(RX + 0.4, 11.6), MAT.ceil, [RX / 2, RH, 5.6], false, false); ceil.rotation.x = Math.PI / 2; add(ceil);
// lábazat
[[0, 0.005, 0, RZ], [RX - 0.005, 0, RX, RZ]].forEach(([x0, z0, x1, z1]) => add(bx(Math.min(x0, x1) - 0.01, z0, 0.02, z1 - z0, 0, 0.1, MAT.skirt, false)));
add(bx(0, 0, 1.15, 0.02, 0, 0.1, MAT.skirt, false)); add(bx(3.8, 0, 0.6, 0.02, 0, 0.1, MAT.skirt, false));
// süllyesztett mennyezet: körbefutó gipszkarton sáv + rejtett LED
const cove = 0.42, coveY = RH - 0.22;
const coveMat = std({ color: '#f1efea', roughness: 0.9 });
add(bx(0, 0, RX, cove, coveY, 0.22, coveMat, false)); add(bx(0, RZ - cove, RX, cove, coveY, 0.22, coveMat, false));
add(bx(0, 0, cove, RZ, coveY, 0.22, coveMat, false)); add(bx(RX - cove, 0, cove, RZ, coveY, 0.22, coveMat, false));
const ledMat = new THREE.MeshBasicMaterial({ color: '#ffd59a' });
ledMat.color.multiplyScalar(2.2);
[[cove, cove, RX - 2 * cove, 0.02], [cove, RZ - cove - 0.02, RX - 2 * cove, 0.02], [cove, cove, 0.02, RZ - 2 * cove], [RX - cove - 0.02, cove, 0.02, RZ - 2 * cove]]
  .forEach(([x, z, w, d]) => add(bx(x, z, w, d, coveY - 0.02, 0.02, ledMat, false)));
rectLight('#ffcf8f', 2.2, RX - 1, 0.25, [RX / 2, RH - 0.05, cove + 0.1], [RX / 2, 0, cove + 0.6]);
rectLight('#ffcf8f', 2.2, RX - 1, 0.25, [RX / 2, RH - 0.05, RZ - cove - 0.1], [RX / 2, 0, RZ - cove - 0.6]);

// ---------- ablakok, erkélyajtó, kint ----------
sky = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: skyTex(), toneMapped: true }));
sky.material.color.setScalar(2.4); sky.position.set(2.4, 1.6, -3.2); scene.add(sky);
// erkély korlát (díszes, fehér) és a padló kint
add(bx(0.75, -1.65, 3.4, 1.55, -0.05, 0.05, std({ color: '#8a5634', roughness: 0.6 }), false));
for (let i = 0; i < 16; i++) { const o = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 8), MAT.white, [0.85 + i * 0.21, 0.47, -1.6]); add(o); }
add(bx(0.75, -1.66, 3.4, 0.06, 0.95, 0.06, MAT.white));
function winFrame(x0, x1, y0, y1, bars = 2) { // fehér ablakkeret + üveg + osztók
  const t = 0.06, z = -0.06;
  add(bx(x0, z - 0.04, x1 - x0, 0.08, y0, t, MAT.white)); add(bx(x0, z - 0.04, x1 - x0, 0.08, y1 - t, t, MAT.white));
  add(bx(x0, z - 0.04, t, 0.08, y0, y1 - y0, MAT.white)); add(bx(x1 - t, z - 0.04, t, 0.08, y0, y1 - y0, MAT.white));
  add(bx((x0 + x1) / 2 - 0.03, z - 0.04, 0.06, 0.08, y0, y1 - y0, MAT.white));
  for (let k = 1; k <= bars; k++) add(bx(x0, z - 0.03, x1 - x0, 0.06, y0 + (y1 - y0) * k / (bars + 1), 0.035, MAT.white));
  const gl = mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), MAT.glass, [(x0 + x1) / 2, (y0 + y1) / 2, z], false, false); add(gl);
}
winFrame(1.15, 1.95, 0.9, 2.6); winFrame(2.95, 3.8, 0.9, 2.6);
// erkélyajtó: két szárny befelé nyitva (a nap besüt)
function doorLeaf(px, pz, ang, w) {
  const g = new THREE.Group(); g.position.set(px, 0, pz); g.rotation.y = ang;
  const p = (o) => { g.add(o); return o; };
  p(bx(0, -0.03, w, 0.05, 0, 0.07, MAT.white)); p(bx(0, -0.03, w, 0.05, 2.53, 0.07, MAT.white));
  p(bx(0, -0.03, 0.06, 0.05, 0, 2.6, MAT.white)); p(bx(w - 0.06, -0.03, 0.06, 0.05, 0, 2.6, MAT.white));
  p(bx(0, -0.03, w, 0.05, 0.75, 0.06, MAT.white)); p(bx(0, -0.03, w, 0.05, 1.7, 0.06, MAT.white));
  p(mesh(new THREE.PlaneGeometry(w - 0.1, 2.5), MAT.glass, [w / 2, 1.3, 0], false, false));
  p(bx(w - 0.14, 0.02, 0.03, 0.04, 1.05, 0.14, MAT.steel, false));
  room.add(g); return g;
}
doorLeaf(2.0, 0.0, -1.25, 0.45); doorLeaf(2.9, 0.0, Math.PI + 1.25, 0.45);
// függönyök: hullámos tüll az ablakokon, zöld bársony szélein
function curtain(x0, x1, m, depth = 0.05, folds = 9, cast = false, h = RH - 0.12) {
  const w = x1 - x0, g = new THREE.PlaneGeometry(w, h, 60, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin((x / w) * folds * Math.PI * 2) * depth); }
  g.computeVertexNormals();
  const o = mesh(g, m, [(x0 + x1) / 2, h / 2 + 0.02, 0.1], cast, true); return add(o);
}
curtain(1.05, 1.95, MAT.sheer, 0.03, 7); curtain(2.95, 3.9, MAT.sheer, 0.03, 7);
const velC = [curtain(0.75, 1.2, MAT.velvet, 0.06, 4, true), curtain(3.75, 4.2, MAT.velvet, 0.06, 4, true)];
velC.forEach(v => v.position.z = 0.16);
add(bx(0.7, 0.1, 3.6, 0.03, RH - 0.1, 0.03, MAT.black, false));
// radiátor az ablak alatt
for (let i = 0; i < 14; i++) add(bx(3.0 + i * 0.055, 0.06, 0.04, 0.08, 0.14, 0.58, MAT.white));

// ---------- fények ----------
const hemi = new THREE.HemisphereLight('#cfe0ff', '#5a4a3c', 0.42); scene.add(hemi);
sun = new THREE.DirectionalLight('#ffc98f', 6.0);
sun.position.set(0.4, 2.3, -4.2); sun.target.position.set(2.9, 0, 2.2); scene.add(sun, sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 12 }); sun.shadow.radius = 3;
SUND = new THREE.Vector3().subVectors(sun.target.position, sun.position).normalize();
// ablakfény: puha területfény a nyílásokban
rectLight('#dbe8ff', 2.6, 2.7, 1.8, [2.45, 1.6, 0.05], [2.45, 1.0, 3]);
// mennyezeti dupla gyűrű
const ring = new THREE.Group(); ring.position.set(2.2, RH - 0.65, 3.1); scene.add(ring);
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1d6').multiplyScalar(3) });
const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.018, 12, 80), ringMat); r1.rotation.x = Math.PI / 2 - 0.12; ring.add(r1);
const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.018, 12, 80), ringMat); r2.rotation.x = Math.PI / 2 + 0.25; r2.position.x = 0.12; ring.add(r2);
{ const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.6), MAT.steel); rod.position.y = 0.32; ring.add(rod); }
const ringL = new THREE.PointLight('#ffe2b8', 3.2, 0, 2); ringL.position.set(2.2, RH - 0.75, 3.1); scene.add(ringL);

// ---------- bútorok (fotók szerint) ----------
// L-alakú kordbársony kanapé a nyugati falnál, a heverő rész a déli végén nyúlik a szobába
function sofa() {
  const g = new THREE.Group(), c = MAT.cord;
  const P = (geo, x, y, z) => { const o = mesh(geo, c, [x, y, z]); g.add(o); return o; };
  P(rbox(0.95, 0.24, 2.45, 0.05), 0.62, 0.12, 3.2);           // alap
  P(rbox(0.82, 0.2, 2.35, 0.08), 0.66, 0.34, 3.2);            // ülőpárnák
  P(rbox(0.26, 0.58, 2.45, 0.08), 0.22, 0.42, 3.2);           // háttámla
  P(rbox(1.75, 0.24, 0.95, 0.05), 1.0, 0.12, 4.62);          // heverő alap
  P(rbox(1.6, 0.2, 0.86, 0.08), 1.02, 0.34, 4.62);           // heverő párna
  P(rbox(1.75, 0.5, 0.24, 0.08), 1.0, 0.43, 5.12);           // heverő vége (támla)
  P(rbox(0.28, 0.5, 0.95, 0.08), 0.22, 0.43, 1.98).position.z = 1.92; // kartámla északon
  // párnák: zsálya, fehér bolyhos, szürke gömbök, fekete kötött gömb, henger
  const pil = (m, w, h, d, x, y, z, rz = 0, ry = 0) => { const o = mesh(rbox(w, h, d, Math.min(w, h, d) * 0.45), m, [x, y, z]); o.rotation.set(0, ry, rz); g.add(o); };
  pil(MAT.sage, 0.14, 0.42, 0.5, 0.42, 0.62, 3.9, 0.25);
  pil(MAT.boucle, 0.14, 0.4, 0.46, 0.42, 0.62, 3.3, 0.22, 0.2);
  pil(MAT.grey, 0.14, 0.38, 0.44, 0.42, 0.6, 2.4, 0.25);
  const ball = (m, r, x, y, z) => g.add(mesh(new THREE.SphereGeometry(r, 32, 24), m, [x, y, z]));
  ball(MAT.knit, 0.15, 0.6, 0.6, 2.8); ball(MAT.grey, 0.13, 0.75, 0.57, 3.55); ball(MAT.grey, 0.12, 0.9, 0.56, 4.4);
  const bol = mesh(new THREE.CapsuleGeometry(0.1, 0.38, 8, 24), MAT.grey, [1.4, 0.55, 4.75]); bol.rotation.z = Math.PI / 2; g.add(bol);
  // pléd
  const pl = mesh(rbox(0.6, 0.03, 0.75, 0.012), phys({ color: '#b9b2a4', roughness: 1, sheen: 0.8 }), [0.7, 0.45, 2.45]); pl.rotation.z = -0.08; g.add(pl);
  room.add(g); aoBlob(0.62, 3.2, 1.4, 3.0, 0.7); aoBlob(1.05, 4.62, 2.2, 1.4, 0.7);
}
sofa();
// nagy krém szőnyeg a kanapé előtt
const rug = mesh(new THREE.BoxGeometry(2.3, 0.012, 3.1), [std({ color: '#d9cfbd' }), std({ color: '#d9cfbd' }), MAT.rug, MAT.rug, std({ color: '#d9cfbd' }), std({ color: '#d9cfbd' })], [2.35, 0.006, 3.45], false, true); add(rug);
// bolyhos kerek puff
add(mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.4, 48, 1), MAT.boucle, [2.15, 0.2, 1.75])); aoBlob(2.15, 1.75, 0.8, 0.8);
add(mesh(new THREE.TorusGeometry(0.25, 0.04, 16, 48), MAT.boucle, [2.15, 0.39, 1.75])).rotation.x = Math.PI / 2;
// kerek tölgy asztal az ablaknál, talpas, 3 szürke kagylószék
add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.035, 64), MAT.oak, [2.45, 0.74, 0.95]));
add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.72, 24), MAT.oak, [2.45, 0.37, 0.95]));
add(mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.03, 48), MAT.oak, [2.45, 0.015, 0.95]));
aoBlob(2.45, 0.95, 1.3, 1.3, 0.5);
function shellChair(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const seat = mesh(rbox(0.46, 0.09, 0.44, 0.04), MAT.grey, [0, 0.46, 0]); g.add(seat);
  const sh = new THREE.SphereGeometry(0.27, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2.4);
  const back = mesh(sh, MAT.grey, [0, 0.5, 0.02]); back.scale.set(1, 0.95, 0.9); back.rotation.x = -Math.PI / 2 + 0.1; back.position.z = 0.12; g.add(back);
  back.material = MAT.grey; back.material.side = THREE.DoubleSide;
  for (const [lx, lz] of [[-0.17, -0.15], [0.17, -0.15], [-0.17, 0.15], [0.17, 0.15]]) {
    const l = mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.46, 10), MAT.black, [lx, 0.23, lz]); l.rotation.set(lz * 0.5, 0, -lx * 0.5); g.add(l);
  }
  room.add(g); aoBlob(x, z, 0.65, 0.65, 0.45);
}
shellChair(1.85, 0.95, -Math.PI / 2); shellChair(2.45, 1.55, Math.PI); shellChair(3.05, 0.9, Math.PI / 2);
// keleti fal: lécfal, TV, lebegő TV-pult tölgy halszálka fronttal és LED-del
for (let i = 0; i < 22; i++) add(bx(RX - 0.06, 3.55 + i * 0.034, 0.045, 0.022, 0.0, RH - 0.25, MAT.oak));
add(bx(RX - 0.015, 3.53, 0.01, 0.78, 0, RH - 0.25, MAT.felt, false));
add(bx(RX - 0.06, 1.85, 0.04, 1.5, 1.05, 0.86, MAT.tv));
const scr = mesh(new THREE.PlaneGeometry(1.44, 0.8), std({ color: '#0a0c10', roughness: 0.08, metalness: 0.2, env: 1.4, emissive: '#ffffff', emissiveMap: tvTex(), emissiveIntensity: 0.9 }), [RX - 0.061, 1.48, 2.6], false, false); scr.rotation.y = -Math.PI / 2; add(scr);
add(bx(RX - 0.4, 0.95, 0.38, 4.5, 0.3, 0.4, MAT.white));
const front = mesh(new THREE.PlaneGeometry(4.5, 0.34), MAT.chevron, [RX - 0.401, 0.5, 3.2], false, true); front.rotation.y = -Math.PI / 2; add(front);
const led2 = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc77a').multiplyScalar(2.6) });
add(bx(RX - 0.38, 0.97, 0.02, 4.46, 0.29, 0.01, led2, false));
rectLight('#ffbf70', 2.4, 4.4, 0.1, [RX - 0.3, 0.28, 3.2], [RX - 0.3, 0, 3.2]);
rectLight('#ffbf70', 0.8, 4.4, 0.12, [RX - 0.4, 0.29, 3.2], [RX - 1.4, 0, 3.2]);
// dekor a pulton: kis lámpa, váza, könyv
add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 24), std({ color: '#ece6da', roughness: 0.4 }), [RX - 0.2, 0.81, 1.2]));
add(mesh(new THREE.SphereGeometry(0.08, 24, 16), std({ color: '#e7e2d9', roughness: 0.3 }), [RX - 0.22, 0.78, 4.8]));
// keskeny fehér-tölgy szekrény a DK sarokban (alatta a robot dokkja)
add(bx(RX - 0.62, RZ - 0.6, 0.58, 0.55, 0.12, 1.1, MAT.white)); add(bx(RX - 0.63, RZ - 0.58, 0.01, 0.5, 0.18, 1.0, MAT.chevron, false));
add(bx(RX - 0.46, RZ - 0.42, 0.34, 0.3, 0, 0.11, MAT.black));
// antik vitrin és nagy növény a nyugati falnál az ablak mellett
add(bx(0.05, 0.3, 0.45, 1.0, 0, 1.95, MAT.walnut)); add(bx(0.49, 0.38, 0.02, 0.84, 0.55, 1.15, MAT.glass, false));
for (let i = 0; i < 3; i++) add(bx(0.1, 0.4, 0.36, 0.8, 0.8 + i * 0.36, 0.02, MAT.walnut, false));
aoBlob(0.3, 0.8, 0.8, 1.3);
const LEAFA = std({ map: leafTex(1), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, env: 0.4 }), LEAFB = std({ map: leafTex(0), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, env: 0.4 });
function plant(x, z, s = 1, banana = true) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 32), MAT.pot, [0, 0.21, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 32), MAT.soil, [0, 0.41, 0]));
  const n = banana ? 9 : 16;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rnd(), h = banana ? 0.9 + rnd() * 0.9 : 0.4 + rnd() * 0.8;
    const st = mesh(new THREE.CylinderGeometry(0.012, 0.018, h, 6), MAT.leaf2, [Math.cos(a) * 0.05, 0.42 + h / 2, Math.sin(a) * 0.05]);
    st.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); g.add(st);
    const lg = new THREE.PlaneGeometry(banana ? 0.36 : 0.13, banana ? 1.0 : 0.24, 4, 12), lp = lg.attributes.position;
    for (let k = 0; k < lp.count; k++) { const y = lp.getY(k), x = lp.getX(k); lp.setZ(k, Math.abs(x) * 0.5 - (y * y) * 0.3); lp.setX(k, x * Math.cos(y * 1.6 + 0.2)); }
    lg.computeVertexNormals();
    const lf = mesh(lg, i % 2 ? LEAFA : LEAFB, [Math.cos(a) * (0.05 + h * 0.25), 0.42 + h + (banana ? 0.35 : 0.08), Math.sin(a) * (0.05 + h * 0.25)]);
    lf.rotation.set(-0.5 + rnd() * 0.4, -a + Math.PI / 2, (rnd() - 0.5) * 0.6); g.add(lf);
  }
  room.add(g); aoBlob(x, z, 0.7 * s, 0.7 * s);
}
plant(0.42, 1.55, 1.0, true); plant(RX - 0.35, 0.45, 0.8, false);
// teddy fotel az ablak és a TV között
const arm = new THREE.Group(); arm.position.set(3.55, 0, 0.75); arm.rotation.y = -2.4;
arm.add(mesh(rbox(0.7, 0.3, 0.7, 0.12), MAT.boucle, [0, 0.25, 0])); arm.add(mesh(rbox(0.7, 0.55, 0.2, 0.09), MAT.boucle, [0, 0.55, -0.27]));
arm.add(mesh(rbox(0.16, 0.36, 0.66, 0.07), MAT.boucle, [-0.31, 0.45, 0])); arm.add(mesh(rbox(0.16, 0.36, 0.66, 0.07), MAT.boucle, [0.31, 0.45, 0]));
for (const [lx, lz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) arm.add(mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.12, 10), MAT.oak, [lx, 0.06, lz]));
room.add(arm); aoBlob(3.55, 0.75, 0.9, 0.9);
// állólámpa csipkés ernyővel a kanapé végén
add(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.03, 32), MAT.walnut, [0.35, 0.015, 5.55]));
add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 10), MAT.walnut, [0.35, 0.76, 5.55]));
const shade = mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.32, 32, 1, true), std({ color: '#f6eedb', roughness: 0.9, side: THREE.DoubleSide, emissive: '#ffd9a0', emissiveIntensity: 1.2 }), [0.35, 1.58, 5.55], false); add(shade);
const lampL = new THREE.PointLight('#ffcf90', 1.6, 0, 2); lampL.position.set(0.35, 1.5, 5.55); scene.add(lampL);
// kép a kanapé fölött, klíma
const art = mesh(new THREE.PlaneGeometry(0.62, 0.95), std({ map: artTex(), roughness: 0.7 }), [0.0, 1.55, 3.4], false); art.rotation.y = Math.PI / 2; add(art);
add(bx(-0.01, 3.08, 0.03, 0.68, 1.2, 0.99, std({ color: '#b48a5a', roughness: 0.5 }), false));
add(bx(0.0, 2.7, 0.24, 0.95, 2.3, 0.3, MAT.white));
// kétszárnyú üvegajtó a dél felé (nyitva), mögötte az étkező
doorLeaf(1.45, RZ, 1.3, 0.8); doorLeaf(3.1, RZ, Math.PI - 1.3, 0.8);
const rugB = mesh(new THREE.BoxGeometry(2.6, 0.012, 2.8), MAT.rugB, [2.25, 0.006, 8.1], false, true); add(rugB);
add(bx(1.74, 7.2, 0.96, 1.9, 0.72, 0.05, MAT.oak)); add(bx(1.82, 7.3, 0.8, 0.05, 0, 0.72, MAT.black)); add(bx(1.82, 8.95, 0.8, 0.05, 0, 0.72, MAT.black));
shellChair(1.4, 7.75, -Math.PI / 2); shellChair(1.4, 8.55, -Math.PI / 2); shellChair(3.05, 7.75, Math.PI / 2); shellChair(3.05, 8.55, Math.PI / 2); shellChair(2.22, 6.95, 0);
add(bx(0.05, 7.05, 0.45, 1.6, 0, 0.82, MAT.black));
for (const z of [7.25, 8.45]) { add(mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.24, 24), std({ color: '#f5f0e6', emissive: '#ffdca8', emissiveIntensity: 1.5 }), [0.25, 1.06, z], false)); }
const dl = new THREE.PointLight('#ffd49c', 2.2, 0, 2); dl.position.set(0.4, 1.3, 7.8); scene.add(dl);
add(bx(0.02, 7.1, 0.05, 1.5, 1.3, 0.8, MAT.black)); add(bx(0.06, 7.17, 0.01, 1.36, 1.37, 0.66, std({ color: '#9aa4ad', roughness: 0.02, metalness: 1, env: 1.5 }), false));
// fehér lépcső fehér korláttal
for (let i = 0; i < 12; i++) add(bx(0.1 + (11 - i) * 0.225, 9.62, 0.225, 1.3, i * 0.25, 0.25, MAT.white));
for (let i = 0; i < 12; i++) add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 8), MAT.white, [0.2 + (11 - i) * 0.225, i * 0.25 + 0.7, 9.6]));
const dl2 = new THREE.PointLight('#ffe4c0', 1.2, 0, 2); dl2.position.set(2.2, 2.4, 8.2); scene.add(dl2);
// apró részletek robot-magasságban
const sock = std({ color: '#f4f3ef', roughness: 0.35 });
add(bx(-0.005, 1.7, 0.012, 0.08, 0.3, 0.08, sock, false)); add(bx(RX - 0.008, 5.0, 0.012, 0.08, 0.3, 0.08, sock, false)); add(bx(2.6, RZ - 0.008, 0.08, 0.012, 0.3, 0.08, sock, false));
add(bx(0, RZ - 0.012, RX, 0.02, 0, 0.1, MAT.skirt, false));
const bookC = ['#7a2f2f', '#2f4a6a', '#d8c8a0', '#3c5b3e', '#c47a3a'];
for (let i = 0; i < 5; i++) add(bx(RX - 0.33, 4.0 + 0.0, 0.24, 0.17, 0.7 + i * 0.035, 0.032, std({ color: bookC[i], roughness: 0.7 })));
add(bx(RX - 0.3, 1.9, 0.05, 0.17, 0.7, 0.02, MAT.black)); add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 24), std({ color: '#efe7da', roughness: 0.5, emissive: '#ffb860', emissiveIntensity: 0.3 }), [RX - 0.2, 0.745, 3.6]));
// Pamutka pamutgombolyaga: tekert fonal, rózsaszín, bumppal
const yarnCv = (() => { const [c, g] = cv(256, 128); g.fillStyle = '#e24f7c'; g.fillRect(0, 0, 256, 128); for (let i = 0; i < 260; i++) { const v = 150 + Math.floor(rnd() * 90); g.strokeStyle = `rgba(${v},${40 + rnd() * 50},${90 + rnd() * 40},0.55)`; g.lineWidth = 1.6; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 128, 30 + rnd() * 90, 8 + rnd() * 40, rnd() * 3, 0, 7); g.stroke(); } return c; })();
const yarnC = new THREE.CanvasTexture(yarnCv); yarnC.colorSpace = THREE.SRGBColorSpace; yarnC.wrapS = yarnC.wrapT = THREE.RepeatWrapping;
const yarnB = new THREE.CanvasTexture(yarnCv); yarnB.wrapS = yarnB.wrapT = THREE.RepeatWrapping;
const yarn = add(mesh(new THREE.SphereGeometry(0.062, 40, 28), phys({ map: yarnC, bumpMap: yarnB, bumpScale: 2.5, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#ffc2d4'), env: 0.3 }), [2.75, 0.062, 2.2]));
const threadM = std({ color: '#e24f7c', roughness: 0.95 });
const thread = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[2.72, 0.045, 2.255], [2.82, 0.008, 2.36], [2.7, 0.004, 2.55], [2.9, 0.004, 2.72], [2.78, 0.004, 2.95], [3.05, 0.004, 3.05], [3.3, 0.004, 2.9]].map(p => new THREE.Vector3(...p))), 90, 0.0032, 6), threadM); thread.castShadow = true; add(thread);
// laza hurok a gombolyag mellett
{ const lp = add(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0032, 6, 28), threadM)); lp.position.set(2.62, 0.0035, 2.26); lp.rotation.x = -Math.PI / 2; lp.scale.set(1, 0.6, 1); }
// töltőkábel a lábazat mentén (keleti fal, a konnektortól a padlóig, aztán a fal mentén), a végén dugasz
{
  const cm = std({ color: '#ecebe6', roughness: 0.45 });
  const cab = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[4.386, 0.345, 5.04], [4.38, 0.3, 5.045], [4.372, 0.16, 5.06], [4.362, 0.03, 5.02], [4.34, 0.005, 4.88], [4.3, 0.005, 4.62], [4.34, 0.005, 4.34], [4.29, 0.005, 4.05], [4.25, 0.005, 3.9]].map(p => new THREE.Vector3(...p))), 120, 0.0035, 8), cm); cab.castShadow = true; add(cab);
  add(bx(4.18, 3.76, 0.05, 0.035, 0.0, 0.02, cm)); add(bx(4.2, 3.8, 0.012, 0.03, 0.0, 0.005, std({ color: '#b9bcc0', roughness: 0.3, metalness: 0.8 }), false));
  add(bx(4.378, 5.03, 0.016, 0.034, 0.325, 0.05, cm, false));
}
// porcicák: lapos szálas folt + két keresztbe álló kis lap (3D hatás), egy draw call darabonként
function bunnyTex() { const [c, g] = cv(128, 128); g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) { const a = rnd() * 6.283, r = rnd() * 38; const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; g.strokeStyle = `rgba(${150 + rnd() * 60},${145 + rnd() * 55},${138 + rnd() * 55},${0.5 + rnd() * 0.5})`; g.lineWidth = 0.9 + rnd() * 1.1;
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 40, x + (rnd() - 0.5) * 50, y + (rnd() - 0.5) * 50, x + (rnd() - 0.5) * 36, y + (rnd() - 0.5) * 36); g.stroke(); }
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 16); gr.addColorStop(0, 'rgba(165,158,150,0.85)'); gr.addColorStop(1, 'rgba(165,158,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const BUN = bunnyTex(), bunnies = [];
const bunMat = new THREE.MeshStandardMaterial({ map: BUN, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 1, color: '#cfcac2' });
const bunGeo = (() => { const gs = []; const f = new THREE.PlaneGeometry(1, 1); f.rotateX(-Math.PI / 2); gs.push(f);
  for (const ry of [0, Math.PI / 2]) { const v = new THREE.PlaneGeometry(1, 0.28); v.translate(0, 0.14, 0); v.rotateY(ry + 0.3); gs.push(v); } return mergeGeometries(gs); })();
[[3.78, 3.0, 0.1], [3.72, 4.45, 0.075], [3.62, 5.12, 0.09], [1.06, 2.75, 0.085], [1.12, 4.2, 0.07], [4.1, 2.2, 0.08]].forEach(([x, z, sz]) => {
  const o = new THREE.Mesh(bunGeo, bunMat); o.position.set(x, 0.002, z); o.scale.set(sz, sz, sz); o.rotation.y = rnd() * 6; o.receiveShadow = true; add(o); bunnies.push(o); });
// szőnyegrojt
{ const fg = new THREE.CylinderGeometry(0.004, 0.004, 0.07, 4); fg.rotateX(Math.PI / 2); const fm = std({ color: '#e4dac6', roughness: 1 }); const im = new THREE.InstancedMesh(fg, fm, 2 * 110); const m4 = new THREE.Matrix4(); let k = 0;
  for (const zz of [1.9 - 0.035, 5.0 + 0.035]) for (let i = 0; i < 110; i++) { m4.makeRotationY((rnd() - 0.5) * 0.4); m4.setPosition(1.21 + i * 2.28 / 110, 0.005, zz); im.setMatrixAt(k++, m4); }
  im.receiveShadow = true; add(im); }
// robot dokk + lábazati konnektor
add(bx(3.83, 5.95, 0.36, 0.22, 0, 0.1, MAT.black));

// ---------- napsugár: fénykéve + porszemek ----------
beams = new THREE.Group(); scene.add(beams);
function beam(x0, x1, y0, y1) {
  const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => new THREE.Vector3(x, y, 0.0));
  const f = c.map(v => { const t = v.y / -SUND.y; return v.clone().addScaledVector(SUND, Math.min(t, 6)); });
  const pos = [], al = [];
  const quad = (a, b, cc, d, aa, ab) => { pos.push(...a.toArray(), ...b.toArray(), ...cc.toArray(), ...a.toArray(), ...cc.toArray(), ...d.toArray()); al.push(aa, aa, ab, aa, ab, ab); };
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(c[i], c[j], f[j], f[i], 1, 0.1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('a', new THREE.Float32BufferAttribute(al, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { op: { value: 0.018 } },
    vertexShader: 'attribute float a; varying float va; void main(){ va=a; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float op; varying float va; void main(){ gl_FragColor=vec4(1.0,0.82,0.55,1.0)*op*va; }'
  });
  beams.add(new THREE.Mesh(g, m));
}
beam(2.02, 2.88, 0.05, 2.55); beam(1.2, 1.9, 0.95, 2.55); beam(3.0, 3.75, 0.95, 2.55);
const DUSTN = 700, dustG = new THREE.BufferGeometry(), dustP = new Float32Array(DUSTN * 3), dustS = new Float32Array(DUSTN);
for (let i = 0; i < DUSTN; i++) {
  const v = new THREE.Vector3(1.2 + rnd() * 2.6, 0.02 + rnd() * 2.5, 0.05); v.addScaledVector(SUND, rnd() * (v.y / -SUND.y));
  dustP.set([v.x, v.y, v.z], i * 3); dustS[i] = rnd();
}
dustG.setAttribute('position', new THREE.BufferAttribute(dustP, 3)); dustG.setAttribute('s', new THREE.BufferAttribute(dustS, 1));
dustM = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { t: { value: 0 } },
  vertexShader: 'attribute float s; uniform float t; varying float vs; void main(){ vec3 p=position; p.x+=sin(t*0.3+s*20.)*0.05; p.y+=sin(t*0.2+s*13.)*0.04; vs=0.5+0.5*sin(t*1.5+s*30.); vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=clamp(9.0/-mv.z,1.0,14.0)*(0.6+s); gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'varying float vs; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(1.0,0.86,0.62,1.)*smoothstep(0.5,0.0,d)*0.55*vs; }'
});
dust = new THREE.Points(dustG, dustM); scene.add(dust); reflHide.push(beams, dust);
// por a padlón (amit a robot felszív)
for (let i = 0; i < 160; i++) { const o = mesh(new THREE.SphereGeometry(0.0015 + rnd() * 0.0025, 5, 4), std({ color: rnd() > 0.4 ? '#e6dfd2' : '#9a8f80', roughness: 1 }), [0.9 + rnd() * 3.2, 0.003, 0.6 + rnd() * 5.2], false, false); add(o); crumbs.push(o); }
bunnies.forEach(o => crumbs.push(o));
}


// ================= PAMUTKA =================
const FUR = furTex(), STR = stripeTex();
const furM = phys({ map: FUR, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.55, env: 0.3 });
const furL = phys({ map: STR, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.55, env: 0.3 });
const belly = phys({ color: '#e4e3e0', roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#ffffff') });
const pinkM = std({ color: '#e7a2a6', roughness: 0.5 });
const noseM = std({ color: '#d9878f', roughness: 0.35 });
const eyeM = phys({ map: eyeTex(), roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.6 });
const darkM = std({ color: '#2a2a2e', roughness: 0.8 });
const cat = new THREE.Group(); scene.add(cat);
const torso = new THREE.Group(); cat.add(torso);          // forgáspont a csípőnél
const sph = (r, m, pos, sc, ws = 40, hs = 28) => { const o = mesh(new THREE.SphereGeometry(r, ws, hs), m, pos); if (sc) o.scale.set(...sc); return o; };
const body = new THREE.Group(); torso.add(body);
body.add(sph(1, furM, [0.13, 0.01, 0], [0.2, 0.095, 0.083]));       // törzs
body.add(sph(1, furM, [0.27, 0.02, 0], [0.1, 0.1, 0.082]));         // mellkas
body.add(sph(1, belly, [0.26, -0.03, 0], [0.085, 0.075, 0.07]));    // világos mell
body.add(sph(1, furM, [0.0, 0.0, 0], [0.1, 0.1, 0.09]));            // far
const neck = sph(1, furM, [0.34, 0.07, 0], [0.065, 0.07, 0.06]); body.add(neck);
const head = new THREE.Group(); head.position.set(0.37, 0.12, 0); head.scale.setScalar(1.12); body.add(head);
const HEADT = headTex();
const headM = phys({ map: HEADT, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.55, env: 0.3 });
const muzzleM = phys({ color: '#e6e5e2', roughness: 0.8, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.6, env: 0.3 });
const skull = sph(1, headM, [0, 0, 0], [0.068, 0.062, 0.07]); skull.userData.shellMap = HEADT; head.add(skull);
head.add(sph(1, furM, [0.022, -0.02, 0.031], [0.04, 0.034, 0.04])); head.add(sph(1, furM, [0.022, -0.02, -0.031], [0.04, 0.034, 0.04]));  // pofazacskók
const muz = sph(1, muzzleM, [0.054, -0.027, 0], [0.026, 0.022, 0.034], 40, 28); muz.userData.noShell = true; head.add(muz);       // pofa (rövid szőr, nincs héj)
const chin = sph(1, muzzleM, [0.044, -0.045, 0], [0.02, 0.012, 0.022], 24, 16); chin.userData.noShell = true; head.add(chin);
const nose = sph(1, noseM, [0.0795, -0.0105, 0], [0.0085, 0.0062, 0.0105], 20, 14); head.add(nose);
// száj: orrtükör alatti barázda (philtrum) és két ív, finom sötétrózsaszín vonal a pofa felszínén
{
  const mm = new THREE.MeshBasicMaterial({ color: '#5e3a40' });
  const surf = (y, z) => { const dy = (y + 0.027) / 0.022, dz = z / 0.034, q = Math.max(0, 1 - dy * dy - dz * dz); return new THREE.Vector3(0.054 + 0.026 * Math.sqrt(q) + 0.0004, y, z); };
  const line = (pts, r = 0.00075) => head.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([y, z]) => surf(y, z))), 14, r, 5), mm));
  line([[-0.0165, 0], [-0.0235, 0], [-0.0295, 0]]);
  for (const s of [-1, 1]) line([[-0.0295, 0], [-0.0335, s * 0.0045], [-0.0345, s * 0.0105], [-0.0325, s * 0.0165]]);
}
const eyes = [], lids = [];
const catchM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(2.5) });
const linerM = std({ color: '#1c1a1c', roughness: 0.6 });
for (const s of [-1, 1]) {
  const ER = 0.0172;
  const e = sph(ER, eyeM, [0.0515, 0.012, s * 0.0285], null, 28, 20); e.rotation.set(0, -s * 0.3, 0); head.add(e); eyes.push(e);
  // csillanás (fix a szem előtt) és kis másodlagos fény
  const cl = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 10, 8), catchM); cl.position.set(0.88, 0.40, -0.26).normalize().multiplyScalar(ER * 0.99); e.add(cl);
  const cl2 = new THREE.Mesh(new THREE.SphereGeometry(0.0015, 8, 6), catchM); cl2.position.set(0.92, -0.30, 0.25).normalize().multiplyScalar(ER * 0.99); e.add(cl2);
  // szemszél (mandula alakú sötét keret)
  const li = new THREE.Mesh(new THREE.TorusGeometry(ER * 0.93, 0.0021, 8, 28), linerM); li.rotation.y = Math.PI / 2; li.position.x = 0.0045; li.scale.set(1, 0.72, 1); e.add(li);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(ER * 1.07, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), headM); e.add(lid); lids.push(lid);
  // fül
  const ear = new THREE.Group(); ear.position.set(-0.005, 0.05, s * 0.04); ear.rotation.set(s * 0.35, 0, -0.12); head.add(ear);
  const eo = mesh(new THREE.ConeGeometry(0.03, 0.06, 4, 1), furM, [0, 0.025, 0]); eo.scale.set(0.45, 1, 1); ear.add(eo);
  const ei = mesh(new THREE.ConeGeometry(0.022, 0.045, 4, 1), pinkM, [0.008, 0.02, 0]); ei.scale.set(0.25, 1, 0.85); ear.add(ei);
  ear.userData.s = s; head.userData['ear' + s] = ear;
  // bajusz
  const wg = new THREE.BufferGeometry(), wp = [];
  for (let k = 0; k < 4; k++) { wp.push(0.07, -0.026, s * 0.02, 0.06 + 0.03, -0.02 + (k - 1.5) * 0.008, s * (0.12 + k * 0.006)); }
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#f4f4f0', transparent: true, opacity: 0.85 })));
}
// homlok "M" rajzolat a textúrában van (headTex)
// lábak: csípő → comb → térd → lábszár → boka → mancs (kúpos, folyamatos végtagok)
function limbTex(kind) { // 0 comb, 1 lábszár és mancs; v=0 alul
  const [c, g] = cv(128, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  if (kind === 0) { gr.addColorStop(0, '#9fa1a5'); gr.addColorStop(0.55, '#b7b8bb'); gr.addColorStop(1, '#cfd0d1'); }
  else { gr.addColorStop(0, '#a9aaae'); gr.addColorStop(0.72, '#c3c4c6'); gr.addColorStop(0.88, '#e6e5e2'); gr.addColorStop(1, '#f1f0ec'); }
  g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 4000; i++) { const x = rnd() * 128, y = rnd() * 256; g.strokeStyle = rnd() > 0.5 ? `rgba(250,250,250,${0.22 * rnd()})` : `rgba(40,40,46,${0.2 * rnd()})`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y + 3 + rnd() * 5); g.stroke(); }
  if (kind === 0) { for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(46,46,52,${0.25 + rnd() * 0.3})`; g.beginPath(); g.ellipse(rnd() * 128, 20 + rnd() * 170, 3 + rnd() * 5, 2 + rnd() * 3, 0, 0, 7); g.fill(); } }
  else { for (let y = 20; y < 170; y += 34) { for (let x = 0; x < 128; x += 6) { g.fillStyle = `rgba(60,60,66,${0.08 + rnd() * 0.12})`; g.beginPath(); g.ellipse(x, y + Math.sin(x * 0.1) * 4 + rnd() * 3, 5, 2.5 + rnd() * 2, 0, 0, 7); g.fill(); } } }
  return tex(c);
}
const LEGU = limbTex(0), LEGL = limbTex(1);
const limbU = phys({ map: LEGU, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.55, env: 0.3 });
const limbL = phys({ map: LEGL, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.55, env: 0.3 });
function limbGeo(ybot, ytop, ctrl, seg = 20) { // ctrl: [t, sugár], t=0 alul, 1 felül; Lathe: v alulról felfelé
  const sp = new THREE.SplineCurve(ctrl.map(([t, r]) => new THREE.Vector2(t, r)));
  const pts = []; for (let i = 0; i <= 18; i++) { const p = sp.getPoint(i / 18); pts.push(new THREE.Vector2(Math.max(0.0015, p.y), ybot + (ytop - ybot) * p.x)); }
  return new THREE.LatheGeometry(pts, seg);
}
function pawTex() {
  const [c, g] = cv(128, 128); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#d8d8d6'); gr.addColorStop(1, '#f4f2ee'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { g.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(80,70,70,0.14)'; g.lineWidth = 0.8; const x = rnd() * 128, y = rnd() * 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 1, y + 4); g.stroke(); }
  g.strokeStyle = 'rgba(90,70,72,0.55)'; g.lineWidth = 1.6; for (const dx of [-9, 0, 9]) { g.beginPath(); g.moveTo(64 + dx, 50); g.lineTo(64 + dx * 1.15, 80); g.stroke(); }
  return tex(c);
}
const PAWT = pawTex();
const pawM = phys({ map: PAWT, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#ffffff'), env: 0.3 });
const legs = [];
function leg(x, z, front) {
  const hip = new THREE.Group(); hip.position.set(x, -0.03, z); body.add(hip);
  // comb: vastag felül (belesimul a törzsbe), kúposan fogy a térdig
  const thigh = front
    ? limbGeo(-0.135, 0.03, [[0, 0.004], [0.04, 0.016], [0.25, 0.021], [0.5, 0.027], [0.75, 0.034], [0.92, 0.032], [1, 0.004]])
    : limbGeo(-0.135, 0.035, [[0, 0.004], [0.04, 0.018], [0.25, 0.023], [0.5, 0.034], [0.75, 0.047], [0.92, 0.046], [1, 0.004]]);
  const up = mesh(thigh, limbU, [0, 0, 0]); up.userData.limb = LEGU; hip.add(up);
  const mass = sph(1, furM, front ? [0.0, -0.01, 0] : [-0.006, -0.02, 0], front ? [0.044, 0.058, 0.032] : [0.068, 0.08, 0.04]); hip.add(mass);
  const knee = new THREE.Group(); knee.position.set(0, -0.12, 0); hip.add(knee);
  const ll = front ? 0.118 : 0.134;
  const lg = front
    ? limbGeo(-ll, 0.012, [[0, 0.013], [0.05, 0.021], [0.35, 0.0205], [0.62, 0.0235], [0.86, 0.029], [1, 0.006]])
    : limbGeo(-ll, 0.012, [[0, 0.011], [0.05, 0.0175], [0.3, 0.0155], [0.55, 0.0165], [0.8, 0.023], [1, 0.006]]);
  const lo = mesh(lg, limbL, [0, 0, 0]); lo.userData.limb = LEGL; knee.add(lo);
  const ankle = new THREE.Group(); ankle.position.set(0, -ll + 0.006, 0); knee.add(ankle);
  const paw = sph(1, pawM, [0.012, -0.004, 0], [0.031, 0.0175, 0.0245], 24, 16); paw.userData.shellMap = PAWT; paw.userData.shells = 5; ankle.add(paw);
  legs.push({ hip, knee, ankle, front, z, paw }); return hip;
}
leg(0.28, 0.032, true); leg(0.28, -0.032, true); leg(-0.01, 0.045, false); leg(-0.01, -0.045, false);
// farok: gömblánc
const tail = []; const TN = 16;
for (let i = 0; i < TN; i++) { const r = 0.026 - i * 0.0009; const o = sph(r, (i % 4 === 3) ? darkM : furM, [0, 0, 0], null, 16, 12); body.add(o); tail.push(o); }
// szőr: 6 egymásra húzott, ritkuló héj (shell fur), hogy a körvonal bolyhos legyen
function noiseTex() { const [c, g] = cv(256, 256); g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 22000; i++) { const v = Math.floor(80 + rnd() * 175); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * 256, rnd() * 256, 1.3, 1.3); } return tex(c, [22, 12], false); }
const NOISE = noiseTex();
const shellMats = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => { const m = new THREE.MeshStandardMaterial({ map: FUR, alphaMap: NOISE, alphaTest: 0.22 + i * 0.065, roughness: 1, color: new THREE.Color(1, 1, 1).multiplyScalar(0.78 + i * 0.03) }); m.envMapIntensity = 0.25; return m; });
// héjak: a normál mentén tolódnak (közös shader, uniform rétegenként), így a szőr vastagsága egyenletes, a megnyúlt gömböknél sem dagad
const shellCache = {};
function shellMat(map, color, i, off) {
  const k = (map ? map.uuid : 'c' + color) + '_' + i + '_' + off; if (shellCache[k]) return shellCache[k];
  const m = new THREE.MeshStandardMaterial({ map: map || null, alphaMap: NOISE, alphaTest: 0.22 + i * 0.065, roughness: 1, color: map ? new THREE.Color(1, 1, 1).multiplyScalar(0.78 + i * 0.03) : new THREE.Color(color).multiplyScalar(0.8 + i * 0.025) }); m.envMapIntensity = 0.25;
  const o = (i + 1) * off;
  m.onBeforeCompile = (sh) => { sh.uniforms.sOff = { value: o }; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float sOff;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(objectNormal) * sOff;'); };
  m.customProgramCacheKey = () => 'nshell'; return shellCache[k] = m;
}
const furry = []; cat.traverse(o => { if (o.isMesh && !o.userData.noShell && (o.material === furM || o.material === belly || o.material === furL || o.material === headM || o.material === pawM) && o.geometry.type === 'SphereGeometry') furry.push(o); });
furry.forEach(o => {
  const g = o.geometry.clone(); g.scale(o.scale.x, o.scale.y, o.scale.z); o.geometry = g; o.scale.set(1, 1, 1);
  const n = o.userData.shells || 10, map = o.userData.shellMap || (o.material === belly ? null : o.material === furL ? STR : FUR);
  for (let i = 0; i < n; i++) o.add(new THREE.Mesh(g, shellMat(map, '#e9e8e4', i, o.userData.off || 0.0015)));
});
cat.traverse(o => { if (o.isMesh && o.userData.limb) for (let i = 0; i < 10; i++) o.add(new THREE.Mesh(o.geometry, shellMat(o.userData.limb, null, i, 0.0016))); });
cat.traverse(o => { if (o.isMesh) { o.castShadow = !o.material.alphaMap; o.receiveShadow = true; } });
const catShadow = mesh(new THREE.PlaneGeometry(0.6, 0.35), new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, opacity: 0.6, depthWrite: false }), [0, 0.005, 0], false, false);
catShadow.rotation.x = -Math.PI / 2; cat.add(catShadow);

// ================= forgatókönyv: robot útja és Pamutka (szintenként) =================
const SPEED = 0.26, RAMP = 0.7, DT_TAB = 0.01;
let ROB_PTS, robCurve, ROB_LEN, STOPS, LOOP, TAB, TOT, CAT_KEYS, FL = null;
function vel(t) { let s = 1; for (const [a, len] of STOPS) { let k = 1; if (t >= a && t <= a + len) k = 0; else if (t > a - RAMP && t < a) k = (a - t) / RAMP; else if (t > a + len && t < a + len + RAMP) k = (t - a - len) / RAMP; k = k * k * (3 - 2 * k); s = Math.min(s, k); } return s; }
function setPath(pts, stops) {
  ROB_PTS = pts; STOPS = stops;
  robCurve = new THREE.CatmullRomCurve3(ROB_PTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5);
  ROB_LEN = robCurve.getLength();
  LOOP = ROB_LEN / SPEED + STOPS.reduce((a, s) => a + s[1] + RAMP, 0);
  TAB = [0];
  for (let t = DT_TAB; t <= LOOP + 1e-6; t += DT_TAB) TAB.push(TAB[TAB.length - 1] + vel(t) * DT_TAB);
  TOT = TAB[TAB.length - 1];
}
function robAt(t) {
  t = ((t % LOOP) + LOOP) % LOOP; const i = Math.min(TAB.length - 2, Math.floor(t / DT_TAB)), f = t / DT_TAB - i;
  const u = ((TAB[i] + (TAB[i + 1] - TAB[i]) * f) / TOT) % 1;
  const p = robCurve.getPointAt(u), tg = robCurve.getTangentAt(u);
  return { p, h: Math.atan2(tg.x, tg.z), stop: vel(t) < 0.05, v: vel(t) * SPEED };
}
// Pamutka kulcskockái: idő, helyzet, póz. A célpontokat a robot helyzetéből számoljuk.
function ahead(t, dist, side = 0) { const r = robAt(t), f = new THREE.Vector3(Math.sin(r.h), 0, Math.cos(r.h)), s = new THREE.Vector3(f.z, 0, -f.x); return r.p.clone().addScaledVector(f, dist).addScaledVector(s, side); }
const V3 = (x, z) => new THREE.Vector3(x, 0, z);
const FLOORCFG = {
  lo: {
    pts: [[3.95, 5.55], [3.35, 5.3], [3.45, 4.4], [3.5, 3.2], [3.4, 2.35], [2.7, 2.3], [1.5, 2.4], [1.45, 3.4], [2.1, 3.85], [2.9, 4.3], [3.25, 5.0], [3.6, 5.45]],
    stops: [[9.0, 3.8], [27.0, 3.4]],
    rug: [2.35, 3.45, 1.15, 1.55], wins: [[2.45, 1.75, -0.05]], rays: [2.45, 1.7, -2.5],
    keys() {
      const A1 = ahead(9.0, 1.0), A2 = ahead(27.0, 1.0), LIE = ahead(20.6, 1.25, 0.5), GROOM = V3(2.55, 3.05), STRP = V3(3.0, 3.5);
      return [
        { t: 0, pose: 'groom', p: GROOM, face: 2.4 },
        { t: 4.6, pose: 'groom', p: GROOM, face: 2.4 },
        { t: 5.2, pose: 'walk', p: GROOM },
        { t: 8.7, pose: 'walk', p: A1 },
        { t: 9.2, pose: 'sit', p: A1, face: 'robot' },
        { t: 12.4, pose: 'sit', p: A1, face: 'robot' },
        { t: 13.0, pose: 'walk', p: A1 },
        { t: 17.4, pose: 'walk', p: LIE },
        { t: 18.0, pose: 'lie', p: LIE, face: 'robot' },
        { t: 22.0, pose: 'lie', p: LIE, face: 'robot' },
        { t: 22.6, pose: 'walk', p: LIE },
        { t: 26.6, pose: 'walk', p: A2 },
        { t: 27.1, pose: 'sit', p: A2, face: 'robot' },
        { t: 30.2, pose: 'sit', p: A2, face: 'robot' },
        { t: 30.8, pose: 'walk', p: A2 },
        { t: 34.6, pose: 'walk', p: STRP },
        { t: 35.2, pose: 'stretch', p: STRP, face: 'robot' },
        { t: 39.0, pose: 'stretch', p: STRP, face: 'robot' },
        { t: 39.6, pose: 'walk', p: STRP },
        { t: LOOP, pose: 'walk', p: GROOM }
      ];
    }
  },
  up: { ...UPCFG, keys() { return UPCFG.keys({ V3, ahead, LOOP, at: tAt, pos: (tt) => robAt(tt).p }); } }
};
// mikor jár a robot a (x, z) közelében (a megadott időtől előre keresve)
function tAt(x, z, after = 0) {
  let best = after, bd = 1e9;
  for (let t = after; t < LOOP; t += 0.05) { const p = robAt(t).p, d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = t; } }
  return best;
}
// nominális (megállás nélküli) menetidő egy pontig, a megállások kezdőidejének kiszámításához
function nominalTime(pts, x, z) {
  const c = new THREE.CatmullRomCurve3(pts.map(([a, b]) => new THREE.Vector3(a, 0, b)), true, 'centripetal', 0.5), L = c.getLength();
  let best = 0, bd = 1e9; for (let i = 0; i <= 4000; i++) { const p = c.getPointAt(i / 4000), d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = i / 4000; } }
  return best * L / SPEED;
}
// szint kiválasztása: az első képkocka előtt kell hívni (a pov.js a ?r= szerint)
export function setFloor(f) {
  if (BUILT) return BUILT;
  BUILT = f === 'up' ? 'up' : 'lo'; FL = FLOORCFG[BUILT];
  if (BUILT === 'up') {
    const r = buildUp({ scene, room, add, mesh, bx, rbox, std, phys, tex, cv, rnd, aoBlob, rectLight, installReflector, reflHide, makeShafts,
      T: { plasterTex, skyTex } });
    ({ sun, SUND, beams, dust, dustM, sky } = r); crumbs.push(...r.crumbs); FL.obst = r.obst;
    const stops = FL.stopsFor(FL.stopWps.map(([x, z]) => nominalTime(FL.pts, x, z)));
    setPath(FL.pts, stops.map(a => a.slice()));
  } else { buildLo(); setPath(FL.pts, FL.stops); }
  CAT_KEYS = FL.keys();
  if (PENDQ != null) setQuality(PENDQ);
  renderer.shadowMap.needsUpdate = true;
  return BUILT;
}
function ensure() { if (!BUILT) setFloor('lo'); }
export function floorInfo() { ensure(); return { floor: BUILT, rooms: FL.rooms || null, plan: FL.plan || null, furn: FL.furn || null, obst: FL.obst || null, ev: (BUILT === 'up' ? UPCFG.ev : null) }; }
// napsugár-kévék és porszemek (az emelet használja; a nappali a saját, eredeti kódját)
function makeShafts(SD, group) {
  return {
    beam(x0, x1, y0, y1) {
      const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => new THREE.Vector3(x, y, 0.0));
      const f = c.map(v => { const t = v.y / -SD.y; return v.clone().addScaledVector(SD, Math.min(t, 6)); });
      const pos = [], al = [];
      const quad = (a, b, cc, d, aa, ab) => { pos.push(...a.toArray(), ...b.toArray(), ...cc.toArray(), ...a.toArray(), ...cc.toArray(), ...d.toArray()); al.push(aa, aa, ab, aa, ab, ab); };
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(c[i], c[j], f[j], f[i], 1, 0.1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('a', new THREE.Float32BufferAttribute(al, 1));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { op: { value: 0.018 } },
        vertexShader: 'attribute float a; varying float va; void main(){ va=a; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'uniform float op; varying float va; void main(){ gl_FragColor=vec4(1.0,0.82,0.55,1.0)*op*va; }' });
      group.add(new THREE.Mesh(g, m));
    },
    dust(x0, x1, z0, z1, ymax) {
      const N = 700, g = new THREE.BufferGeometry(), P = new Float32Array(N * 3), Sx = new Float32Array(N);
      for (let i = 0; i < N; i++) { const v = new THREE.Vector3(x0 + rnd() * (x1 - x0), 0.02 + rnd() * ymax, 0.05); v.addScaledVector(SD, rnd() * (v.y / -SD.y)); v.z = Math.min(v.z, z1); P.set([v.x, v.y, v.z], i * 3); Sx[i] = rnd(); }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('s', new THREE.BufferAttribute(Sx, 1));
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { t: { value: 0 } },
        vertexShader: 'attribute float s; uniform float t; varying float vs; void main(){ vec3 p=position; p.x+=sin(t*0.3+s*20.)*0.05; p.y+=sin(t*0.2+s*13.)*0.04; vs=0.5+0.5*sin(t*1.5+s*30.); vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=clamp(9.0/-mv.z,1.0,14.0)*(0.6+s); gl_Position=projectionMatrix*mv; }',
        fragmentShader: 'varying float vs; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(1.0,0.86,0.62,1.)*smoothstep(0.5,0.0,d)*0.55*vs; }' });
      const points = new THREE.Points(g, mat); scene.add(points); return { points, mat };
    }
  };
}

let gait = 0, catHead = 0, lastT = 0;
const catState = { p: new THREE.Vector3(), h: 0, sit: 0, lie: 0, stretch: 0, groom: 0, moving: 0 };
function lerpA(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; }
function catAt(t, robotPos) {
  t = ((t % LOOP) + LOOP) % LOOP;
  let i = 0; while (i < CAT_KEYS.length - 2 && CAT_KEYS[i + 1].t <= t) i++;
  const a = CAT_KEYS[i], b = CAT_KEYS[i + 1], k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  const walking = a.pose === 'walk';
  const ke = walking ? (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2) : k;
  const p = a.p.clone().lerp(b.p, walking ? ke : 0);
  // ív a séta közben (ne egyenes vonalon menjen)
  if (walking) { const dir = b.p.clone().sub(a.p), n = new THREE.Vector3(dir.z, 0, -dir.x).normalize(); p.addScaledVector(n, Math.sin(ke * Math.PI) * Math.min(0.35, dir.length() * 0.18)); }
  let h;
  if (walking) { const p2 = a.p.clone().lerp(b.p, Math.min(1, ke + 0.02)); const dir = b.p.clone().sub(a.p), n = new THREE.Vector3(dir.z, 0, -dir.x).normalize(); p2.addScaledVector(n, Math.sin(Math.min(1, ke + 0.02) * Math.PI) * Math.min(0.35, dir.length() * 0.18)); h = Math.atan2(p2.x - p.x, p2.z - p.z) - Math.PI / 2; }
  else if (a.face === 'robot') h = Math.atan2(robotPos.x - p.x, robotPos.z - p.z) - Math.PI / 2;
  else h = a.face;
  const speed = walking ? b.p.distanceTo(a.p) / (b.t - a.t) * (ke < 0.5 ? 4 * k : 4 * (1 - k)) * 0.5 : 0;
  return { p, h, pose: walking ? 'walk' : a.pose, speed, nextPose: b.pose, k };
}
function poseCat(t, dt, robotPos, camPos) {
  const c = catAt(t, robotPos), S = catState, blend = 1 - Math.exp(-dt * 5);
  S.p.copy(c.p); S.h = lerpA(S.h, c.h, dt > 0.5 ? 1 : 1 - Math.exp(-dt * 6));
  const tgt = { sit: c.pose === 'sit' ? 1 : 0, lie: c.pose === 'lie' ? 1 : 0, stretch: c.pose === 'stretch' ? 1 : 0, groom: c.pose === 'groom' ? 1 : 0 };
  for (const k in tgt) S[k] = dt > 0.5 ? tgt[k] : S[k] + (tgt[k] - S[k]) * blend;
  S.moving = dt > 0.5 ? Math.min(1, c.speed * 4) : S.moving + (Math.min(1, c.speed * 4) - S.moving) * blend;
  gait += c.speed * dt / 0.34 * Math.PI * 2;
  cat.position.copy(S.p); cat.rotation.y = S.h; body.scale.set(1, 1 + Math.sin(t * 4.2) * 0.018 * (1 - S.moving), 1 + Math.sin(t * 4.2) * 0.012 * (1 - S.moving));
  const g = gait, mv = S.moving, sit = S.sit, lie = S.lie, str = S.stretch, gr = S.groom;
  // törzs: magasság és dőlés
  const standY = 0.252 + Math.sin(g * 2) * 0.006 * mv, seat = Math.max(sit, gr);
  torso.position.set(0, standY * (1 - lie * 0.56) - seat * 0.15 + str * 0.02, 0);
  torso.rotation.set(0, 0, seat * 0.65 - str * 0.32 + Math.sin(g * 2) * 0.02 * mv);
  // lábak
  legs.forEach((L, i) => {
    const ph = g + (L.front ? 0 : Math.PI) + (L.z > 0 ? 0 : Math.PI) + (L.front ? 0 : 0.6);
    let hipA = Math.sin(ph) * 0.5 * mv, kneeA = (L.front ? -1 : 1) * Math.max(0, Math.sin(ph + (L.front ? 1.2 : -0.8))) * 0.7 * mv;
    if (L.front) {
      hipA += -seat * 0.65 + lie * 1.35 + str * 1.25; kneeA += lie * -0.25 - str * 0.15;
      if (gr > 0.01 && L.z > 0) { hipA += gr * 1.5; kneeA += -gr * 1.9; }      // mosakodik: a mancsát nyalja
    } else { hipA += seat * 0.95 + lie * -1.15 - str * 0.45; kneeA += seat * -2.35 + lie * 2.45 + str * 0.15; }
    L.hip.rotation.z = hipA; L.knee.rotation.z = kneeA; L.ankle.rotation.z = -(hipA + kneeA) * 0.6 + (L.front ? 0 : 0.25 * Math.max(0, Math.sin(ph)) * mv);
  });
  // fej: a robot/kamera felé néz, ha ül vagy fekszik; mosakodásnál lehajol
  const hw = new THREE.Vector3(); head.getWorldPosition(hw);
  const look = camPos.clone().sub(hw); const ly = Math.atan2(look.x, look.z) - S.h - Math.PI / 2;
  let yaw = lerpA(0, ly, 1); yaw = THREE.MathUtils.clamp(yaw, -1.1, 1.1);
  const attn = Math.max(sit, lie, str * 0.3) * (1 - gr);
  head.rotation.order = 'YZX';
  head.rotation.set(0, yaw * attn + Math.sin(t * 0.7) * 0.15 * (1 - attn) + gr * 0.5, -(seat * 0.65) + (-0.1 + Math.sin(t * 1.3) * 0.04) * attn - gr * (0.55 + Math.sin(t * 6) * 0.12) + lie * 0.2 - str * 0.3 + Math.sin(g * 2) * 0.04 * mv);
  head.rotation.order = 'YZX';
  // pislogás és fülrezgés
  const bl = (t % 3.7) < 0.14 ? 1 : 0; const shut = Math.min(1, 0.12 + bl + gr * 0.45 + lie * 0.25);
  lids.forEach(l => { l.rotation.set(0, 0, Math.PI / 2 * 0.85 - shut * Math.PI * 0.93); });
  for (const s of [-1, 1]) { const e = head.userData['ear' + s]; e.rotation.x = s * 0.35 + ((t * 0.9 + (s > 0 ? 0 : 1.7)) % 4.3 < 0.18 ? s * 0.4 : 0); }
  // farok: séta közben felálló kérdőjel, üléskor a lábak köré tekerve
  const base = new THREE.Vector3(-0.09, 0.02, 0);
  for (let i = 0; i < TN; i++) {
    const u = i / (TN - 1);
    const walkP = new THREE.Vector3(-0.1 - u * 0.12 + Math.pow(u, 3) * 0.06, 0.02 + u * 0.26 - Math.pow(u, 4) * 0.05, Math.sin(t * 2.2 + u * 3) * 0.05 * u);
    const sitP = new THREE.Vector3(-0.12 + Math.sin(u * 2.6) * 0.18 + u * 0.1, -0.13 + u * 0.03, -u * 0.25 + Math.pow(u, 2) * 0.05 + Math.sin(t * 1.4 + u * 2) * 0.02 * u);
    const lieP = new THREE.Vector3(-0.1 - u * 0.26, -0.09 - u * 0.02, Math.sin(u * 2 + t * 1.1) * 0.08 * u);
    const pose = Math.max(sit, gr), w = 1 - Math.min(1, pose + lie + str * 0.6);
    const p = walkP.multiplyScalar(w).add(sitP.multiplyScalar(pose)).add(lieP.multiplyScalar(lie + str * 0.6));
    tail[i].position.copy(p.add(base.clone().multiplyScalar(0)));
  }
  catShadow.scale.set(1 + lie * 0.4, 1, 1);
  return c;
}

// ================= kamera, módok, utófeldolgozás =================
const camera = new THREE.PerspectiveCamera(72, W / H, 0.02, 40);
const robotRig = new THREE.Group(); camera.add(robotRig); scene.add(camera);
// a robot orra a kép alján: fekete lökhárító-ív és a forgó oldalkefe
const bump = mesh(new THREE.TorusGeometry(0.34, 0.025, 12, 80, Math.PI * 0.62), std({ color: '#111214', roughness: 0.2, metalness: 0.3, env: 1.2 }), [0, -0.075, -0.36], false, false);
bump.visible = false; robotRig.add(bump);
const brush = new THREE.Group(); brush.position.set(0.13, -0.125, -0.2); robotRig.add(brush);
const brM = std({ color: '#1d1d20', roughness: 0.7 });
for (let i = 0; i < 3; i++) { const piv = new THREE.Group(); piv.rotation.y = i * 2.094; brush.add(piv); const arm = mesh(new THREE.CylinderGeometry(0.0012, 0.0022, 0.07, 5), brM, [0.035, 0, 0], false, false); arm.rotation.z = Math.PI / 2 + 0.25; piv.add(arm); }
brush.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 16), std({ color: '#3a3a3e', roughness: 0.4 }), [0, 0.003, 0], false, false));

const composer = new EffectComposer(renderer);
const rp = new RenderPass(scene, camera); composer.addPass(rp);
const gtao = new GTAOPass(scene, camera, W, H); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 1.0;
gtao.updateGtaoMaterial({ radius: 0.3, distanceExponent: 1.5, thickness: 1.2, scale: 1.25, samples: 16, distanceFallOff: 1.0 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
composer.addPass(gtao);
{ const ov = gtao.overrideVisibility.bind(gtao); gtao.overrideVisibility = function () { ov(); beams.visible = false; }; }
const RAYS = { uniforms: { tDiffuse: { value: null }, lp: { value: new THREE.Vector2(0.5, 0.5) }, amt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 lp; uniform float amt; varying vec2 vUv;
    void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; if(amt<0.001){ gl_FragColor=vec4(c,1.); return; }
      vec2 d=(vUv-lp)*(0.92/40.0); vec2 uv=vUv; float w=1.0; vec3 acc=vec3(0.);
      for(int i=0;i<40;i++){ uv-=d; vec3 s=texture2D(tDiffuse,uv).rgb; acc+=max(s-vec3(1.1),0.)*w; w*=0.955; }
      gl_FragColor=vec4(c+acc*amt/40.0*vec3(1.0,0.82,0.58),1.); }` };
const rays = new ShaderPass(RAYS); composer.addPass(rays);
const bokeh = new BokehPass(scene, camera, { focus: 1.0, aperture: 0.0009, maxblur: 0.005 }); composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.5, 1.0); composer.addPass(bloom);
// objektív-szennyeződés: puha foltok és ujjnyomos kenet (csak erős fényben gyúl ki)
function dirtTex() {
  const [c, g] = cv(512, 512); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) { const x = rnd() * 512, y = rnd() * 512, r = 6 + rnd() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); const a = 0.04 + rnd() * 0.22; gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 16; g.lineCap = 'round'; for (let k = 0; k < 5; k++) { g.beginPath(); const x = 80 + rnd() * 350, y = 80 + rnd() * 350; g.moveTo(x, y); g.quadraticCurveTo(x + 40 + rnd() * 60, y - 30 + rnd() * 60, x + 80 + rnd() * 90, y + rnd() * 60 - 30); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
const GRADE = {
  uniforms: { tDiffuse: { value: null }, tDirt: { value: dirtTex() }, t: { value: 0 }, mode: { value: 1 }, ca: { value: 0 }, barrel: { value: 0 }, vig: { value: 0.35 }, grain: { value: 0.03 },
    mb: { value: 0 }, flare: { value: 0 }, lp: { value: new THREE.Vector2(0.5, 0.5) }, dirtA: { value: 0 }, aspect: { value: W / H }, contrast: { value: 1.2 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse, tDirt; uniform float t,ca,barrel,vig,grain,mb,flare,dirtA,aspect,contrast; uniform vec2 lp; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    float lum(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
    void main(){
      vec2 uv=vUv-0.5; float r2=dot(uv,uv); uv*=1.0+barrel*r2; vec2 q=uv+0.5;
      vec2 off=uv*ca;
      vec3 c=vec3(texture2D(tDiffuse,q+off).r, texture2D(tDiffuse,q).g, texture2D(tDiffuse,q-off).b);
      // mozgás-elmosódás: sugárirányú, csak amíg a robot megy
      if(mb>0.0005){ vec3 acc=c; vec2 dir=(q-vec2(0.5,0.42))*mb; for(int i=1;i<=5;i++){ acc+=texture2D(tDiffuse,q-dir*float(i)/5.0).rgb; } c=acc/6.0; }
      if(q.x<0.||q.y<0.||q.x>1.||q.y>1.) c=vec3(0.);
      // lencsevisszaverődés és szennyeződés: a fényes ablak képpontjából
      if(flare>0.001 || dirtA>0.001){
        vec3 br=vec3(0.); for(int i=0;i<4;i++){ vec2 o=vec2(i<2?0.045:-0.045, (i==0||i==3)?0.045:-0.045); br+=max(texture2D(tDiffuse,q+o).rgb-vec3(1.3),0.); }
        float dirt=texture2D(tDirt,vUv).r; c+=br*0.22*dirt*dirtA*vec3(1.0,0.9,0.78);
        if(flare>0.001){
          vec2 lq=clamp(lp,0.03,0.97); float vis=smoothstep(0.7,1.7,(lum(texture2D(tDiffuse,lq).rgb)+lum(texture2D(tDiffuse,lq+vec2(0.02,0.0)).rgb)+lum(texture2D(tDiffuse,lq-vec2(0.02,0.0)).rgb))/3.0); vis*=1.0-smoothstep(0.0,0.3,max(abs(lp.x-0.5),abs(lp.y-0.5))-0.5);
          vec2 L=0.5+(lp-0.5)/(1.0+barrel*dot(lp-0.5,lp-0.5)); vec2 sc=vec2(vUv.x*aspect,vUv.y), Lp=vec2(L.x*aspect,L.y), C=vec2(0.5*aspect,0.5), v=C-Lp; vec3 fl=vec3(0.); v=normalize(v+vec2(0.0001))*max(length(v),0.16);
          for(int i=0;i<4;i++){ float fi=float(i); float k=0.55+fi*0.55+(i==3?0.1:0.0); float rr=(i==2)?0.09:0.04+fi*0.01; vec2 gp=Lp+v*k; float d=length(sc-gp);
            vec3 col=(i==0)?vec3(1.0,0.62,0.34):(i==1)?vec3(0.36,0.82,0.62):(i==2)?vec3(0.4,0.52,1.0):vec3(1.0,0.5,0.72);
            float ring=smoothstep(rr,rr*0.8,d)*smoothstep(rr*0.5,rr*0.9,d)*0.85+smoothstep(rr,0.0,d)*0.22; fl+=col*ring*(0.9-fi*0.14); }
          float sd=abs(vUv.y-L.y), sx=abs(vUv.x-L.x);
          fl+=vec3(0.42,0.6,1.0)*exp(-sd*sd*11000.)*exp(-sx*2.6)*0.55;
          fl+=vec3(1.0,0.74,0.5)*exp(-length(sc-Lp)*6.5)*0.22;
          c+=fl*flare*vis*(0.65+0.7*dirt);
        }
      }
      c*=1.0-vig*smoothstep(0.15,0.75,r2*2.2);
      float l=lum(c); c=mix(vec3(l),c,1.12);
      c=mix(c*vec3(0.88,0.98,1.1), c*vec3(1.07,1.0,0.9), smoothstep(0.02,0.55,l));   // hideg árnyék, meleg fény
      c=pow(max(c/0.2,0.),vec3(contrast))*0.2*1.18;
      c+=(h(vUv*vec2(960.,540.)+t)-0.5)*grain;
      gl_FragColor=vec4(c,1.);
    }`
};
const grade = new ShaderPass(GRADE); composer.addPass(grade);
const after = new AfterimagePass(0.0); composer.addPass(after);
composer.addPass(new OutputPass());

// LiDAR (P3): pontfelhő a sugár-szögek szerint, távolság szerint színezve
const lidarMat = new THREE.ShaderMaterial({
  uniforms: { origin: { value: new THREE.Vector3() }, t: { value: 0 }, heading: { value: 0 }, cat: { value: 0 } },
  vertexShader: 'varying vec3 wp; void main(){ vec4 w=modelMatrix*vec4(position,1.); wp=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
  fragmentShader: `uniform vec3 origin; uniform float t,heading,cat; varying vec3 wp;
    vec3 turbo(float x){ x=clamp(x,0.,1.); return clamp(vec3(0.13572138+x*(4.61539260+x*(-42.66032258+x*(132.13108234+x*(-152.94239396+x*59.28637943)))),
      0.09140261+x*(2.19418839+x*(4.84296658+x*(-14.18503333+x*(4.27729857+x*2.82956604)))),
      0.10667330+x*(12.64194608+x*(-60.58204836+x*(110.36276771+x*(-89.90310912+x*27.34824973))))),0.,1.); }
    void main(){
      vec3 d=wp-origin; float dist=length(d);
      float az=atan(d.x,d.z), el=atan(d.y,length(d.xz));
      float sa=0.0105, se=0.021;
      vec2 g=vec2(az/sa, el/se); vec2 f=abs(fract(g)-0.5);
      float px=max(fwidth(g.x),fwidth(g.y));
      float dotm=1.0-smoothstep(0.16,0.16+px*1.2,length(f));
      float lds=1.0-smoothstep(0.0,0.012,abs(wp.y-0.095));
      float sweep=fract((az-t*2.6)/6.2831853); float sw=0.35+0.65*pow(1.0-sweep,3.0);
      vec3 col = cat>0.5 ? vec3(1.0,0.55,0.18)*1.3 : turbo(1.0-clamp(dist/5.0,0.,1.)*0.85);
      float a = dotm*(cat>0.5?1.0:0.85)*sw + lds*1.3*(0.5+0.5*sw);
      vec2 grid=abs(fract(wp.xz*4.0)-0.5); float gl=(wp.y<0.02)? (1.0-smoothstep(0.0,0.03,min(grid.x,grid.y)))*0.12 : 0.0;
      gl_FragColor=vec4(col*a + vec3(0.1,0.6,0.5)*gl + (lds>0.0? vec3(0.6,1.0,0.95)*lds:vec3(0.)), 1.0);
    }`,
  extensions: { derivatives: true }
});
const lidarCat = lidarMat.clone(); lidarCat.uniforms.cat.value = 1;
const catScene = new THREE.Scene();

// ---------- HUD és buborék ----------
const hud = window.HUD || {};
let MODE = 'p1';
const CFG = {
  p1: { refl: 0.95, rays: 0.9, after: 0.0, fov: 72, y: 0.095, pitch: 0.12, ca: 0.0015, barrel: 0.0, vig: 0.38, grain: 0.025, bloom: 0.3, bokeh: true, shake: 0, mb: 0.012, flare: 0.0, dirt: 0.5, contrast: 1.16 },
  p2: { refl: 1.0, rays: 1.1, after: 0.3, fov: 108, y: 0.055, pitch: 0.15, ca: 0.008, barrel: 0.35, vig: 0.55, grain: 0.05, bloom: 0.45, bokeh: false, shake: 1, mb: 0.018, flare: 0.75, dirt: 1.0, contrast: 1.2 },
  p3: { fov: 90, y: 0.095, pitch: 0.04 }
};
export function setMode(m) { MODE = m; const c = CFG[m]; camera.fov = c.fov; camera.updateProjectionMatrix(); robotRig.visible = false; }

const tmpV = new THREE.Vector3();
let area = 0, prevP = null;
export function frame(t, dt) {
  ensure();
  const r = robAt(t), c = CFG[MODE];
  // kamera a robot orrán: rezgés a padló szerint (parketta: durvább, szőnyeg: puha)
  const dx = FL.rug[2] - Math.abs(r.p.x - FL.rug[0]), dz = FL.rug[3] - Math.abs(r.p.z - FL.rug[1]), rk = THREE.MathUtils.smoothstep(Math.min(dx, dz), 0, 0.1);
  const go = r.stop ? 0.12 : r.v / SPEED, amp = (1 - rk * 0.78) * go * c.shake;
  const shY = (Math.sin(t * 53) * 0.0012 + Math.sin(t * 83 + 1) * 0.0007 + Math.sin(t * 27) * 0.0009) * amp + Math.sin(t * 3.1) * 0.0003 * c.shake;
  const shP = (Math.sin(t * 61) * 0.0026 + Math.sin(t * 37 + 2) * 0.002) * amp, shR = Math.sin(t * 2.1) * 0.015 * c.shake + Math.sin(t * 47) * 0.0025 * amp;
  camera.position.set(r.p.x + Math.sin(r.h) * 0.16, c.y + shY, r.p.z + Math.cos(r.h) * 0.16);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(c.pitch + shP, r.h + Math.PI, shR); camera.updateMatrixWorld(true);
  brush.rotation.y = -t * 14;
  // porszemek a padlón: amit a robot elér, eltűnik
  crumbs.forEach(o => { if (o.visible && Math.hypot(o.position.x - r.p.x, o.position.z - r.p.z) < 0.17) o.visible = false; });
  if (t < 0.2) crumbs.forEach(o => o.visible = true);
  const cs = poseCat(t, dt, r.p, camera.position);
  dustM.uniforms.t.value = t;
  // akadály: a macska a robot előtt
  const toCat = cat.position.clone().sub(r.p);
  const fwd = new THREE.Vector3(Math.sin(r.h), 0, Math.cos(r.h)); const inFront = toCat.clone().normalize().dot(fwd) > 0.55;
  if (prevP) area += prevP.distanceTo(r.p) * 0.3; prevP = r.p.clone(); if (t < 0.1) area = 0;
  // képernyő-téglalap a macskáról (P3 keret)
  const box = new THREE.Box3().setFromObject(cat), pts = []; const dist = box.distanceToPoint(camera.position);
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) { tmpV.set(x, y, z).project(camera); if (tmpV.z < 1) pts.push(tmpV.clone()); }
  let rect = null;
  if (pts.length === 8) { const xs = pts.map(p => p.x), ys = pts.map(p => p.y); rect = { x0: (Math.min(...xs) + 1) / 2, x1: (Math.max(...xs) + 1) / 2, y0: (1 - Math.max(...ys)) / 2, y1: (1 - Math.min(...ys)) / 2 }; }
  if (MODE === 'p3') {
    renderer.setRenderTarget(null); renderer.autoClear = true; scene.background = new THREE.Color('#03070a');
    lidarMat.uniforms.origin.value.copy(camera.position); lidarMat.uniforms.t.value = t; lidarCat.uniforms.origin.value.copy(camera.position); lidarCat.uniforms.t.value = t;
    const hidden = [sky, beams, dust, catShadow]; hidden.forEach(o => o.visible = false); robotRig.visible = false;
    renderer.shadowMap.needsUpdate = false; scene.remove(cat); scene.overrideMaterial = lidarMat; renderer.render(scene, camera);
    catScene.add(cat); catScene.overrideMaterial = lidarCat; renderer.autoClear = false; renderer.clearDepth();
    renderer.render(catScene, camera); renderer.autoClear = true;
    catScene.remove(cat); scene.add(cat); scene.overrideMaterial = null; hidden.forEach(o => o.visible = true); scene.background = new THREE.Color('#1a1a1f');
  } else {
    // a fókusz a macskán, ha látszik, különben 1,5 m
    const fd = rect && dist < 3 ? camera.position.distanceTo(cat.position) : 1.5;
    bokeh.enabled = c.bokeh; bokeh.uniforms.focus.value = fd;
    bloom.strength = c.bloom; Object.assign(grade.uniforms, {}); grade.uniforms.t.value = t % 10; grade.uniforms.ca.value = c.ca; grade.uniforms.barrel.value = c.barrel; grade.uniforms.vig.value = c.vig; grade.uniforms.grain.value = c.grain;
    grade.uniforms.mb.value = c.mb * (r.stop ? 0 : r.v / SPEED); grade.uniforms.dirtA.value = c.dirt; grade.uniforms.contrast.value = c.contrast;
    rStr.value = QUAL.refl ? c.refl : 0; gtao.enabled = QUAL.ao; after.uniforms.damp.value = c.after; after.enabled = c.after > 0;
    tmpV.set(FL.rays[0], FL.rays[1], FL.rays[2]).project(camera); const onS = tmpV.z < 1 && Math.abs(tmpV.x) < 1.6 && Math.abs(tmpV.y) < 1.6;
    { const WN = FL.wins.reduce((a, b) => Math.hypot(b[0] - camera.position.x, b[2] - camera.position.z) < Math.hypot(a[0] - camera.position.x, a[2] - camera.position.z) ? b : a); const w = tmpV.clone().set(WN[0], WN[1], WN[2]).project(camera); grade.uniforms.lp.value.set((w.x + 1) / 2, (w.y + 1) / 2); grade.uniforms.flare.value = c.flare * (FL.flareGain ?? 1) * (w.z < 1 && Math.abs(w.x) < 1.35 && Math.abs(w.y) < 1.35 ? 1 : 0); }
    rays.uniforms.lp.value.set((tmpV.x + 1) / 2, (tmpV.y + 1) / 2); rays.uniforms.amt.value = onS ? (FL.raysGain ?? 1) * c.rays * (1 - Math.min(1, Math.hypot(tmpV.x, tmpV.y) / 1.6)) : 0;
    renderer.shadowMap.needsUpdate = true;
    composer.render(dt);
  }
  return { t, rob: r, cat: cs, dist, inFront, rect, area, loop: LOOP, robPts: ROB_PTS };
}
export function info() { ensure(); return { LOOP, ROB_PTS, floor: BUILT }; }
setMode('p1');
export function setQuality(k) { if (!sun) { PENDQ = k; } QUAL.refl = k >= 1; QUAL.ao = k >= 1; renderer.setSize(Math.round(W * k), Math.round(H * k), false); composer.setSize(Math.round(W * k), Math.round(H * k)); if (sun) { sun.shadow.mapSize.set(k < 1 ? 1024 : 2048, k < 1 ? 1024 : 2048); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
let PENDQ = null;

window.__dbg = (t, az, d, h, look = 0.15) => {
  ensure(); const r = robAt(t); poseCat(t, 1, r.p, r.p.clone().setY(0.1));
  const c = cat.position.clone(); const a = cat.rotation.y + az, ctr = Math.atan2(-(3.1 - c.z), 2.2 - c.x);
  const aa = az > 5 ? ctr + (az - 6) : a; camera.position.set(c.x + Math.cos(aa) * d, h, c.z - Math.sin(aa) * d); camera.lookAt(c.x, look, c.z);
  bokeh.enabled = false; robotRig.visible = false; renderer.shadowMap.needsUpdate = true; rStr.value = 0.55; composer.render(0.016); robotRig.visible = true;
};
