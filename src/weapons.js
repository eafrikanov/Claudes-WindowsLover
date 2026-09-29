import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const WEAPONS = [
  {
    id: 'pistol', name: 'Кобра', kind: 'Пистолет', key: '1',
    damage: 28, head: 2, fireRate: 0.17, auto: false, mag: 14, reload: 1.25, pellets: 1,
    spread: 0.008, moveSpread: 0.025, recoil: 0.05, kick: 0.035, range: 120, adsFov: 58,
    sound: { freq: 900, body: 140, decay: 0.12, gain: 0.55 },
    hip: [0.15, -0.16, -0.4], ads: [0, 0, -0.38],
  },
  {
    id: 'rifle', name: 'Вихрь', kind: 'Штурмовая винтовка', key: '2',
    damage: 18, head: 1.8, fireRate: 0.092, auto: true, mag: 30, reload: 2.0, pellets: 1,
    spread: 0.012, moveSpread: 0.035, recoil: 0.028, kick: 0.028, range: 200, adsFov: 50,
    sound: { freq: 1400, body: 90, decay: 0.16, gain: 0.6 },
    hip: [0.14, -0.17, -0.36], ads: [0, 0, -0.3],
  },
  {
    id: 'shotgun', name: 'Гром', kind: 'Дробовик', key: '3',
    damage: 11, head: 1.4, fireRate: 0.85, auto: false, mag: 6, reload: 2.4, pellets: 9,
    spread: 0.065, moveSpread: 0.075, recoil: 0.11, kick: 0.07, range: 45, adsFov: 60,
    sound: { freq: 500, body: 60, decay: 0.35, gain: 0.85 },
    hip: [0.15, -0.18, -0.36], ads: [0, 0, -0.3],
  },
  {
    id: 'sniper', name: 'Сокол', kind: 'Снайперская винтовка', key: '4',
    damage: 95, head: 2.5, fireRate: 1.25, auto: false, mag: 5, reload: 2.7, pellets: 1,
    spread: 0.06, moveSpread: 0.1, adsSpread: 0.0005, recoil: 0.09, kick: 0.08, range: 400, adsFov: 16,
    scope: true,
    sound: { freq: 700, body: 45, decay: 0.5, gain: 0.9 },
    hip: [0.16, -0.2, -0.38], ads: [0, 0, -0.2],
  },
];

export const WEAPON_INDEX = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

function rbox(w, h, d, r, mat) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const g = cached(`rb${w},${h},${d},${rr}`, () => new RoundedBoxGeometry(w, h, d, 2, rr));
  return new THREE.Mesh(g, mat);
}

function box(w, h, d, mat) {
  return new THREE.Mesh(cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
}

// Цилиндр вдоль оси Z.
function cyl(r1, r2, len, mat, seg = 20) {
  const g = cached(`c${r1},${r2},${len},${seg}`, () => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2));
  return new THREE.Mesh(g, mat);
}

function put(parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

function rail(parent, mat, x, y, z, len, count) {
  put(parent, box(0.022, 0.006, len, mat), x, y, z);
  for (let i = 0; i < count; i++) put(parent, box(0.024, 0.004, 0.004, mat), x, y + 0.005, z - len / 2 + (i + 0.5) * (len / count));
}

function pistol(m) {
  const g = new THREE.Group();
  put(g, rbox(0.03, 0.034, 0.19, 0.006, m.steel), 0, 0.058, -0.075);
  for (let i = 0; i < 7; i++) put(g, box(0.031, 0.024, 0.003, m.darkSteel), 0, 0.058, 0.004 - i * 0.007);
  put(g, box(0.012, 0.012, 0.03, m.darkSteel), 0.012, 0.064, -0.06);
  put(g, cyl(0.0075, 0.0075, 0.012, m.bright, 14), 0, 0.064, -0.172);
  put(g, rbox(0.028, 0.028, 0.16, 0.005, m.polymer), 0, 0.03, -0.07);
  rail(g, m.polymer, 0, 0.013, -0.12, 0.05, 3);
  put(g, rbox(0.03, 0.115, 0.052, 0.01, m.polymer), 0, -0.035, 0.012, -0.28);
  for (let i = 0; i < 4; i++) put(g, box(0.032, 0.004, 0.035, m.darkSteel), 0, -0.01 - i * 0.022, 0.018 + i * 0.006, -0.28);
  put(g, rbox(0.032, 0.012, 0.056, 0.004, m.darkSteel), 0, -0.095, 0.03, -0.28);
  const guard = new THREE.Mesh(cached('pguard', () => new THREE.TorusGeometry(0.02, 0.003, 6, 16, Math.PI)), m.polymer);
  put(g, guard, 0, 0.018, -0.042, 0, Math.PI / 2, Math.PI);
  put(g, box(0.005, 0.02, 0.006, m.darkSteel), 0, 0.01, -0.035, 0.2);
  put(g, box(0.006, 0.008, 0.006, m.darkSteel), 0, 0.079, -0.16);
  put(g, box(0.02, 0.008, 0.008, m.darkSteel), 0, 0.079, 0.012);
  put(g, box(0.003, 0.003, 0.002, m.glowGreen), 0, 0.083, -0.1635);
  put(g, box(0.003, 0.003, 0.002, m.glowGreen), -0.006, 0.08, 0.0165);
  put(g, box(0.003, 0.003, 0.002, m.glowGreen), 0.006, 0.08, 0.0165);
  const mag = new THREE.Group();
  put(mag, box(0.022, 0.012, 0.04, m.accent), 0, -0.1, 0.03);
  put(g, mag, 0, 0, 0);
  mag.rotation.x = -0.28;
  return { group: g, muzzle: new THREE.Vector3(0, 0.064, -0.18), sightY: 0.083, mag, eject: new THREE.Vector3(0.02, 0.07, -0.05) };
}

function rifle(m) {
  const g = new THREE.Group();
  const furn = m.tan;
  put(g, rbox(0.036, 0.042, 0.2, 0.004, m.steel), 0, 0.045, -0.02);
  put(g, rbox(0.034, 0.04, 0.17, 0.004, m.steel), 0, 0.005, -0.01);
  put(g, box(0.004, 0.018, 0.05, m.darkSteel), 0.019, 0.05, -0.02);
  put(g, box(0.012, 0.008, 0.03, m.darkSteel), 0, 0.066, 0.09);
  put(g, rbox(0.044, 0.046, 0.26, 0.012, m.polymer), 0, 0.044, -0.25);
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) put(g, rbox(0.004, 0.012, 0.028, 0.002, m.darkSteel), s * 0.021, 0.04, -0.15 - i * 0.038);
  }
  put(g, box(0.004, 0.004, 0.26, m.darkSteel), 0, 0.068, -0.25);
  rail(g, m.darkSteel, 0, 0.07, -0.1, 0.3, 14);
  put(g, cyl(0.009, 0.009, 0.16, m.darkSteel), 0, 0.044, -0.45);
  put(g, cyl(0.014, 0.014, 0.012, m.steel), 0, 0.044, -0.39);
  const brake = put(g, cyl(0.013, 0.013, 0.06, m.darkSteel, 8), 0, 0.044, -0.55);
  for (let i = 0; i < 3; i++) put(g, box(0.03, 0.004, 0.006, m.polymer), 0, 0.044, -0.535 - i * 0.014);
  brake.rotation.z = Math.PI / 8;
  put(g, rbox(0.03, 0.095, 0.042, 0.01, furn), 0, -0.045, 0.06, -0.35);
  put(g, rbox(0.03, 0.075, 0.034, 0.01, furn), 0, -0.008, -0.27);
  const guard = new THREE.Mesh(cached('rguard', () => new THREE.TorusGeometry(0.025, 0.003, 6, 16, Math.PI)), m.steel);
  put(g, guard, 0, -0.015, 0.02, 0, Math.PI / 2, Math.PI);
  put(g, box(0.005, 0.02, 0.006, m.darkSteel), 0, -0.01, 0.018, 0.2);
  put(g, cyl(0.014, 0.014, 0.18, m.darkSteel), 0, 0.035, 0.18);
  put(g, rbox(0.04, 0.095, 0.16, 0.012, furn), 0, 0.005, 0.25);
  put(g, rbox(0.042, 0.1, 0.02, 0.006, m.rubber), 0, 0.005, 0.335);
  put(g, box(0.042, 0.012, 0.03, m.darkSteel), 0, -0.03, 0.22);
  const mag = new THREE.Group();
  for (let i = 0; i < 4; i++) put(mag, rbox(0.026, 0.045, 0.058, 0.004, m.polymer), 0, -0.03 - i * 0.038, -0.07 - i * 0.009, -0.18 - i * 0.07);
  put(mag, box(0.029, 0.01, 0.062, m.darkSteel), 0, -0.175, -0.108, -0.36);
  put(g, mag, 0, 0, 0);
  for (const s of [-1, 1]) put(g, rbox(0.005, 0.03, 0.05, 0.002, m.darkSteel), s * 0.0135, 0.09, -0.07);
  put(g, rbox(0.032, 0.005, 0.05, 0.002, m.darkSteel), 0, 0.106, -0.07);
  put(g, cyl(0.012, 0.012, 0.003, m.clearGlass), 0, 0.094, -0.094);
  put(g, box(0.0018, 0.0018, 0.001, m.redDot), 0, 0.094, -0.094);
  put(g, rbox(0.036, 0.008, 0.06, 0.003, m.darkSteel), 0, 0.074, -0.07);
  return { group: g, muzzle: new THREE.Vector3(0, 0.044, -0.59), sightY: 0.094, mag, eject: new THREE.Vector3(0.022, 0.05, -0.02) };
}

function shotgun(m) {
  const g = new THREE.Group();
  put(g, rbox(0.04, 0.06, 0.2, 0.008, m.darkSteel), 0, 0.03, -0.02);
  put(g, box(0.042, 0.028, 0.06, m.bright), 0.001, 0.04, -0.03);
  put(g, cyl(0.013, 0.013, 0.48, m.steel), 0, 0.048, -0.36);
  put(g, cyl(0.011, 0.011, 0.4, m.darkSteel), 0, 0.016, -0.32);
  put(g, cyl(0.014, 0.014, 0.018, m.steel), 0, 0.016, -0.52);
  put(g, box(0.02, 0.05, 0.01, m.steel), 0, 0.032, -0.5);
  put(g, cyl(0.003, 0.003, 0.004, m.bright), 0, 0.064, -0.59).rotation.x = 0;
  put(g, box(0.006, 0.006, 0.4, m.darkSteel), 0, 0.064, -0.38);
  const pump = new THREE.Group();
  put(pump, rbox(0.046, 0.042, 0.16, 0.012, m.wood), 0, 0.018, 0);
  for (let i = 0; i < 6; i++) put(pump, box(0.048, 0.003, 0.004, m.darkSteel), 0, 0.012, -0.06 + i * 0.024);
  put(g, pump, 0, 0, -0.26);
  put(g, rbox(0.036, 0.1, 0.045, 0.014, m.wood), 0, -0.045, 0.1, -0.5);
  put(g, rbox(0.042, 0.075, 0.24, 0.018, m.wood), 0, -0.02, 0.28, 0.14);
  put(g, rbox(0.046, 0.085, 0.02, 0.008, m.rubber), 0, -0.036, 0.405, 0.14);
  const guard = new THREE.Mesh(cached('sguard', () => new THREE.TorusGeometry(0.024, 0.003, 6, 16, Math.PI)), m.darkSteel);
  put(g, guard, 0, -0.002, 0.045, 0, Math.PI / 2, Math.PI);
  put(g, box(0.005, 0.02, 0.006, m.darkSteel), 0, 0, 0.045, 0.2);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xa81c1c, roughness: 0.6 });
  put(g, rbox(0.006, 0.03, 0.1, 0.002, m.polymer), 0.022, 0.03, -0.01);
  for (let i = 0; i < 4; i++) {
    const sh = put(g, cyl(0.009, 0.009, 0.03, shellMat, 10), 0.03, 0.03, -0.045 + i * 0.022, Math.PI / 2);
    put(sh, cyl(0.0095, 0.0095, 0.008, m.brass, 10), 0, 0, 0.011);
  }
  return { group: g, muzzle: new THREE.Vector3(0, 0.048, -0.61), sightY: 0.069, mag: pump, pump, eject: new THREE.Vector3(0.024, 0.04, -0.03) };
}

function sniper(m) {
  const g = new THREE.Group();
  const body = m.olive;
  put(g, rbox(0.04, 0.05, 0.3, 0.008, body), 0, 0.012, -0.08);
  put(g, rbox(0.034, 0.036, 0.2, 0.006, m.steel), 0, 0.045, -0.04);
  put(g, cyl(0.011, 0.013, 0.6, m.darkSteel), 0, 0.045, -0.48);
  for (let i = 0; i < 6; i++) put(g, box(0.028, 0.002, 0.3, m.steel), 0, 0.045, -0.46, 0, 0, (i * Math.PI) / 6);
  put(g, cyl(0.02, 0.02, 0.1, m.darkSteel, 10), 0, 0.045, -0.82);
  for (let i = 0; i < 4; i++) put(g, box(0.044, 0.006, 0.01, m.polymer), 0, 0.045, -0.79 - i * 0.02);
  const bolt = put(g, cyl(0.004, 0.004, 0.05, m.bright, 8), 0.035, 0.05, 0.03, 0, Math.PI / 2 - 0.3);
  put(g, new THREE.Mesh(cached('knob', () => new THREE.SphereGeometry(0.009, 12, 10)), m.darkSteel), 0.06, 0.05, 0.022);
  bolt.rotation.set(0, Math.PI / 2, -0.4);
  put(g, rbox(0.036, 0.095, 0.045, 0.012, body), 0, -0.05, 0.07, -0.3);
  put(g, rbox(0.044, 0.09, 0.26, 0.012, body), 0, 0.0, 0.26);
  put(g, rbox(0.04, 0.035, 0.12, 0.01, m.polymer), 0, 0.058, 0.23);
  put(g, rbox(0.046, 0.1, 0.02, 0.006, m.rubber), 0, 0, 0.395);
  const guard = new THREE.Mesh(cached('snguard', () => new THREE.TorusGeometry(0.024, 0.003, 6, 16, Math.PI)), m.darkSteel);
  put(g, guard, 0, -0.018, 0.015, 0, Math.PI / 2, Math.PI);
  const mag = new THREE.Group();
  put(mag, rbox(0.03, 0.05, 0.08, 0.004, m.darkSteel), 0, -0.035, -0.07);
  put(g, mag, 0, 0, 0);
  for (const s of [-1, 1]) put(g, cyl(0.004, 0.004, 0.16, m.darkSteel, 8), s * 0.012, -0.018, -0.3);
  const scopeY = 0.115;
  put(g, cyl(0.017, 0.017, 0.22, m.darkSteel), 0, scopeY, -0.04);
  put(g, cyl(0.03, 0.017, 0.06, m.darkSteel), 0, scopeY, -0.18);
  put(g, cyl(0.03, 0.03, 0.03, m.darkSteel), 0, scopeY, -0.225);
  put(g, cyl(0.027, 0.027, 0.004, m.glass), 0, scopeY, -0.241);
  put(g, cyl(0.02, 0.017, 0.05, m.darkSteel), 0, scopeY, 0.09);
  put(g, cyl(0.019, 0.019, 0.004, m.glass), 0, scopeY, 0.116);
  put(g, cyl(0.011, 0.011, 0.025, m.steel, 14), 0, scopeY + 0.022, -0.04, Math.PI / 2);
  put(g, cyl(0.011, 0.011, 0.025, m.steel, 14), 0.022, scopeY, -0.04, 0, Math.PI / 2);
  for (const z of [-0.1, 0.03]) put(g, rbox(0.03, 0.05, 0.022, 0.004, m.steel), 0, 0.085, z);
  return { group: g, muzzle: new THREE.Vector3(0, 0.045, -0.87), sightY: scopeY, mag, bolt, eject: new THREE.Vector3(0.022, 0.05, 0) };
}

const BUILDERS = { pistol, rifle, shotgun, sniper };

export function buildWeaponModel(id, mats) {
  return BUILDERS[id](mats);
}

// Текстура вспышки: лучистая звезда с мягким центром.
let flashTex = null;
export function muzzleFlashTexture() {
  if (flashTex) return flashTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    ctx.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
    const len = s * (0.3 + Math.random() * 0.2);
    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,230,160,0.9)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.04);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, s * 0.04);
    ctx.fill();
  }
  const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.25);
  rg.addColorStop(0, 'rgba(255,255,230,1)');
  rg.addColorStop(0.4, 'rgba(255,190,80,0.7)');
  rg.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

export function makeMuzzleFlash() {
  const mat = new THREE.MeshBasicMaterial({ map: muzzleFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
  g.add(front);
  for (let i = 0; i < 2; i++) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.26), mat);
    side.rotation.set(Math.PI / 2, 0, i * Math.PI / 2);
    side.rotation.order = 'ZXY';
    side.position.z = -0.1;
    g.add(side);
  }
  g.visible = false;
  return g;
}
