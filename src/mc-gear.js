import * as THREE from 'three';

// Оружие, руки и предметы в стиле Minecraft: блочная геометрия (коробки, призмы с 4–8 гранями)
// и пиксельные текстуры 16×16 на материал. UV считаются в текселях от угла каждой грани
// (128 текселей на метр модели), поэтому плотность одинакова на всех деталях, а шейдер
// подсвечивает верхнюю кромку грани и затемняет нижнюю — как у моделей из Blockbench.
// От третьего лица те же текстуры читаются в 4 раза крупнее (scale 0.25).

export const GEAR_DENSITY = 128;
const T = 16;

function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgb(s) {
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
}

// Фактуры: множитель яркости пикселя (x, y) — u идёт вдоль ствола (ось Z модели).
const KINDS = {
  metal: (x, y, s) => {
    let k = 0.95 + 0.07 * hash(x >> 2, y, s) + 0.04 * hash(x, y, s + 1);
    if (hash(x, y, s + 2) > 0.975) k *= 1.18;
    return k;
  },
  poly: (x, y, s) => {
    let k = 0.95 + 0.08 * hash(x, y, s);
    if (hash(x, y, s + 1) > 0.93) k *= 0.88;
    return k;
  },
  plastic: (x, y, s) => (hash(x, y, s + 1) > 0.95 ? 0.93 : 0.97 + 0.05 * hash(x, y, s)),
  wood: (x, y, s) => {
    let k = 0.88 + 0.14 * hash(Math.floor((x + 7 * y) / 5), y, s) + 0.05 * hash(x, y, s + 1);
    if (y % 4 === 3) k *= 0.82;
    return k;
  },
  rubber: (x, y, s) => (x % 2 === 0 && y % 2 === 0 ? 1.3 : 0.94 + 0.06 * hash(x, y, s)),
  brass: (x, y, s) => (y % 8 === 1 ? 1.22 : 0.94 + 0.08 * hash(x, y, s)),
  glass: (x, y) => ((x - y + 32) % 16 < 2 ? 1.55 : (x - y + 32) % 16 === 3 ? 1.25 : 1),
  fabric: (x, y, s) => ((x + y) % 2 ? 0.95 : 1.03) * (0.95 + 0.08 * hash(x, y, s)) * (y % 6 === 0 ? 0.86 : 1),
  skin: (x, y, s) => (0.97 + 0.05 * hash(x, y, s)) * (y % 4 === 0 ? 0.9 : 1),
  pineapple: (x, y, s) => {
    const a = x % 3;
    const b = y % 3;
    if (a === 0 || b === 0) return 0.55;
    return (a === 1 && b === 1 ? 1.14 : 0.98) * (0.95 + 0.06 * hash(x, y, s));
  },
};

// color — sRGB, edge — сила подсветки кромок, rough — шероховатость.
const SPECS = {
  steel: { color: '#66717d', kind: 'metal', rough: 0.55 },
  darkSteel: { color: '#3d444e', kind: 'metal', rough: 0.6 },
  bright: { color: '#a9b3bd', kind: 'metal', rough: 0.45 },
  polymer: { color: '#464d58', kind: 'poly' },
  tan: { color: '#a68d63', kind: 'poly' },
  olive: { color: '#5d6b3a', kind: 'poly' },
  accent: { color: '#c26f2b', kind: 'poly' },
  brass: { color: '#b98f3a', kind: 'brass', rough: 0.45 },
  wood: { color: '#7d5432', kind: 'wood' },
  rubber: { color: '#2b2a30', kind: 'rubber', rough: 0.95 },
  glass: { color: '#2e6592', kind: 'glass', edge: 0, emissive: 0x0b2238, rough: 0.3 },
  shell: { color: '#9a2f28', kind: 'plastic' },
  white: { color: '#d3d7db', kind: 'plastic' },
  light: { color: '#a2acb8', kind: 'plastic' },
  trim: { color: '#30374a', kind: 'poly' },
  oliveDark: { color: '#4b5a2e', kind: 'poly' },
  warhead: { color: '#5a6e33', kind: 'poly' },
  pineapple: { color: '#56662f', kind: 'pineapple', edge: 0.4 },
  sleeve: { color: '#557f39', kind: 'fabric', edge: 0.6 },
  cuff: { color: '#456a2e', kind: 'fabric', edge: 0.6 },
  hand: { color: '#d9a982', kind: 'skin', edge: 0.5 },
  medWhite: { color: '#e2e0d8', kind: 'plastic' },
  medRed: { color: '#c23a33', kind: 'plastic', emissive: 0x6a0000 },
  handle: { color: '#3a383f', kind: 'rubber' },
};

const tiles = new Map();
function tile(key) {
  if (tiles.has(key)) return tiles.get(key);
  const spec = SPECS[key];
  const base = rgb(spec.color);
  const fn = KINDS[spec.kind];
  const seed = [...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) & 0xffff;
  const c = document.createElement('canvas');
  c.width = c.height = T;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(T, T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const k = fn(x, y, seed);
      const i = (y * T + x) * 4;
      for (let j = 0; j < 3; j++) img.data[i + j] = Math.max(0, Math.min(255, Math.round(base[j] * k)));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  tiles.set(key, t);
  return t;
}

function edgeShader(material, scale, edge) {
  const gearScale = { value: scale };
  const gearEdge = { value: edge };
  material.onBeforeCompile = (sh) => {
    sh.uniforms.gearScale = gearScale;
    sh.uniforms.gearEdge = gearEdge;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fsize;\nuniform float gearScale;\nvarying vec2 vGearTex;\nvarying vec2 vGearSize;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGearTex = uv * gearScale;\nvGearSize = fsize * gearScale;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float gearEdge;\nvarying vec2 vGearTex;\nvarying vec2 vGearSize;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (vGearSize.x >= 2.5 && vGearSize.y >= 2.5) {
          float ge = 1.0;
          if (vGearTex.y > vGearSize.y - 1.0) ge = 1.0 + 0.3 * gearEdge;
          else if (vGearTex.y < 1.0) ge = 1.0 - 0.32 * gearEdge;
          else if (vGearTex.x < 1.0 || vGearTex.x > vGearSize.x - 1.0) ge = 1.0 - 0.16 * gearEdge;
          diffuseColor.rgb *= ge;
        }`);
  };
  material.customProgramCacheKey = () => 'gearpx';
  return material;
}

// Материал с пиксельной текстурой: scale — во сколько раз плотнее/реже базовых 128 текселей на метр.
export function gearMaterial(key, scale = 1) {
  const spec = SPECS[key];
  const base = tile(key);
  const map = scale === 1 ? base : base.clone();
  map.repeat.set(scale / T, scale / T);
  map.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map, roughness: spec.rough ?? 0.82, metalness: 0, emissive: spec.emissive ?? 0 });
  return edgeShader(m, scale, spec.edge ?? 1);
}

// ---------- геометрия ----------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();

// Плоские нормали и UV в текселях от угла каждой плоской грани (треугольники группируются
// по нормали). Атрибут fsize — размер грани в текселях, по нему шейдер находит кромки.
export function gearGeometry(src) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const fs = new Float32Array(n * 2);
  const groups = new Map();
  for (let t = 0; t + 2 < n; t += 3) {
    _a.fromBufferAttribute(pos, t);
    _b.fromBufferAttribute(pos, t + 1);
    _c.fromBufferAttribute(pos, t + 2);
    _n.subVectors(_c, _b).cross(_a.clone().sub(_b));
    if (_n.lengthSq() < 1e-14) continue;
    _n.normalize();
    const key = `${Math.round(_n.x * 40)},${Math.round(_n.y * 40)},${Math.round(_n.z * 40)}`;
    if (!groups.has(key)) groups.set(key, { n: _n.clone(), tris: [] });
    groups.get(key).tris.push(t);
  }
  for (const { n: N, tris } of groups.values()) {
    // u — проекция оси Z (вдоль ствола) на грань, иначе оси X; v смотрит вверх.
    _u.set(0, 0, 1).addScaledVector(N, -N.z);
    if (_u.lengthSq() < 0.09) _u.set(1, 0, 0).addScaledVector(N, -N.x);
    _u.normalize();
    _v.crossVectors(N, _u).normalize();
    if (_v.y < -1e-3 || (Math.abs(_v.y) <= 1e-3 && _v.x + _v.z < 0)) _v.negate();
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        _a.fromBufferAttribute(pos, t + k);
        const pu = _a.dot(_u);
        const pv = _a.dot(_v);
        u0 = Math.min(u0, pu); u1 = Math.max(u1, pu);
        v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
      }
    }
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        _a.fromBufferAttribute(pos, i);
        uv[i * 2] = (_a.dot(_u) - u0) * GEAR_DENSITY;
        uv[i * 2 + 1] = (_a.dot(_v) - v0) * GEAR_DENSITY;
        fs[i * 2] = (u1 - u0) * GEAR_DENSITY;
        fs[i * 2 + 1] = (v1 - v0) * GEAR_DENSITY;
      }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('fsize', new THREE.BufferAttribute(fs, 2));
  g.computeBoundingSphere();
  return g;
}

export function gearBox(w, h, d) {
  return gearGeometry(new THREE.BoxGeometry(w, h, d));
}

// Цилиндр вдоль Z: тонкие — квадратный брусок, толстые — восьмигранник плоскими гранями по осям.
export function gearCylinder(r1, r2, len, seg = 20) {
  let s = seg;
  let k = 1;
  let rot = 0;
  if (seg > 6) {
    s = Math.max(r1, r2) < 0.02 ? 4 : 8;
    k = s === 4 ? 1.25 : 1.04;
    rot = Math.PI / s;
  }
  const g = new THREE.CylinderGeometry(r1 * k, r2 * k, len, s).rotateY(rot).rotateX(Math.PI / 2);
  return gearGeometry(g);
}

// ---------- наборы материалов ----------
const sets = new Map();
let glow = null;
function glowMats() {
  if (!glow) {
    glow = {
      clearGlass: new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.15, depthWrite: false }),
      redDot: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
      glowGreen: new THREE.MeshBasicMaterial({ color: 0x40ff60 }),
      cyan: new THREE.MeshBasicMaterial({ color: 0x45f2ff }),
      cyanCore: new THREE.MeshBasicMaterial({ color: 0xd8feff }),
      exhaust: new THREE.MeshBasicMaterial({ color: 0xffc040 }),
      bore: new THREE.MeshBasicMaterial({ color: 0x14121a }),
    };
  }
  return glow;
}

// Тот же набор ключей, что у TextureLibrary.weaponMaterials(), плюс extra для weapons-extra.js.
export function mcWeaponMaterials(scale = 1) {
  if (sets.has(scale)) return sets.get(scale);
  const g = glowMats();
  const m = (k) => gearMaterial(k, scale);
  const set = {
    steel: m('steel'), darkSteel: m('darkSteel'), bright: m('bright'), polymer: m('polymer'), tan: m('tan'),
    olive: m('olive'), accent: m('accent'), brass: m('brass'), wood: m('wood'), glass: m('glass'), rubber: m('rubber'),
    shell: m('shell'),
    clearGlass: g.clearGlass, redDot: g.redDot, glowGreen: g.glowGreen,
  };
  set.extra = {
    white: m('white'), light: m('light'), trim: m('trim'), oliveDark: m('oliveDark'), warhead: m('warhead'),
    pineapple: m('pineapple'), cyan: g.cyan, cyanCore: g.cyanCore, exhaust: g.exhaust, bore: g.bore,
  };
  sets.set(scale, set);
  return set;
}

let arms = null;
export function mcArmMaterials() {
  if (!arms) arms = { sleeve: gearMaterial('sleeve'), cuff: gearMaterial('cuff'), glove: gearMaterial('hand') };
  return arms;
}

// ---------- аптечка ----------
let med = null;
export function mcMedkitBox() {
  // Текстуры читаются по 32 текселя на метр — крупнее, чем у оружия: аптечку видно издалека.
  if (!med) med = { white: gearMaterial('medWhite', 0.25), red: gearMaterial('medRed', 0.25), handle: gearMaterial('handle', 0.25), steel: gearMaterial('steel', 0.25) };
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  add(gearBox(0.5, 0.3, 0.34), med.white, 0, 0, 0);
  // Шов крышки, защёлки и ручка из трёх брусков.
  add(gearBox(0.504, 0.02, 0.342), med.handle, 0, 0.06, 0);
  for (const x of [-0.16, 0.16]) add(gearBox(0.04, 0.05, 0.35), med.steel, x, 0.06, 0);
  for (const x of [-0.07, 0.07]) add(gearBox(0.03, 0.07, 0.03), med.handle, x, 0.18, 0);
  add(gearBox(0.17, 0.03, 0.04), med.handle, 0, 0.215, 0);
  // Красный крест на крышке и боках.
  for (const [w, d] of [[0.26, 0.08], [0.08, 0.26]]) {
    add(gearBox(w, 0.31, d * 0.8), med.red, 0, 0, 0);
    add(gearBox(w * 0.9, d * 0.9, 0.345), med.red, 0, 0, 0);
  }
  return g;
}
