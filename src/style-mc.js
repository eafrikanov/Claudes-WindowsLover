import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Стиль «Minecraft с шейдерами»: пиксельные текстуры 16 текселей на метр, приглушённая палитра,
// физическое освещение с мягкими тенями, дымкой, AO и тонмаппингом. Выбирается в настройках;
// ?style=cartoon или ?style=mc&preset=noon|golden|overcast перекрывает настройку (для tools/render.mjs).

export const STYLES = { cartoon: 'Мультяшный', noon: 'Полдень', golden: 'Золотой час', overcast: 'Пасмурно' };
export const DEFAULT_STYLE = 'noon';
export const TEXELS = 16;

export const PRESETS = {
  noon: {
    name: 'Полдень', elevation: 60,
    skyTop: 0x2f5f9e, skyHorizon: 0xb4c9dc, skyBottom: 0x9fb0bf, sunGlow: 0xfff2dc, clouds: 0xffffff, cloudCover: 0.42, cloudDetail: 0.25,
    sun: 0xfff3e2, sunIntensity: 3.8, hemiSky: 0x8fb4ec, hemiGround: 0x8a7a64, hemiIntensity: 1.7,
    fog: 0xb4c9dc, fogDensity: 0.0032, exposure: 1.0, saturation: 0.88, tint: [1, 1, 1],
    soft: 0.06, shadowIntensity: 1, ao: 0.9, bloom: 0.12, bloomThreshold: 3,
  },
  golden: {
    name: 'Золотой час', elevation: 17,
    skyTop: 0x3462a8, skyHorizon: 0xf3b27a, skyBottom: 0xc7a586, sunGlow: 0xffb468, clouds: 0xffcfa4, cloudCover: 0.36, cloudDetail: 0.25,
    sun: 0xffb266, sunIntensity: 4.2, hemiSky: 0x7fa3e0, hemiGround: 0x7a6650, hemiIntensity: 1.8,
    fog: 0xdcb48e, fogDensity: 0.004, exposure: 1.05, saturation: 0.95, tint: [1.02, 1, 0.96],
    soft: 0.09, shadowIntensity: 1, ao: 0.9, bloom: 0.22, bloomThreshold: 2.4,
  },
  overcast: {
    name: 'Пасмурно', elevation: 52,
    skyTop: 0x7b8794, skyHorizon: 0xadb5bd, skyBottom: 0x9ba3aa, sunGlow: 0xdfe4ea, clouds: 0xc3c8cd, cloudCover: 0.8, cloudDetail: 0.08,
    sun: 0xe4e8ee, sunIntensity: 0.7, hemiSky: 0xc6ced8, hemiGround: 0x77746c, hemiIntensity: 2.4,
    fog: 0xa6aeb6, fogDensity: 0.0052, exposure: 1.0, saturation: 0.72, tint: [0.97, 1, 1.03],
    soft: 0.3, shadowIntensity: 0.55, ao: 1.15, bloom: 0, bloomThreshold: 3,
  },
};

function pickStyle() {
  const params = new URLSearchParams(location.search);
  if (params.get('style') === 'cartoon') return 'cartoon';
  if (params.get('style') === 'mc') return PRESETS[params.get('preset')] ? params.get('preset') : 'golden';
  let saved;
  try { saved = JSON.parse(localStorage.getItem('gunarena-prefs') || '{}').style; } catch { /* приватный режим */ }
  return STYLES[saved] ? saved : DEFAULT_STYLE;
}

export const STYLE = pickStyle();
export const MC = STYLE !== 'cartoon';
export const PRESET = MC ? STYLE : 'golden';

// Цена эффектов по уровню качества: post — композитор (HDR, MSAA, грейдинг), ao — доля разрешения GTAO
// относительно CSS-пикселей (0 — без AO), bloom — свечение.
export const MC_QUALITY = {
  low: { shadows: 1024, post: false, ao: 0, bloom: false, msaa: 0 },
  medium: { shadows: 2048, post: true, ao: 0.5, bloom: false, msaa: 4 },
  high: { shadows: 4096, post: true, ao: 1, bloom: true, msaa: 4 },
};

export function mcEnv(env) {
  return { ...env, ...PRESETS[PRESET] };
}

export function setupRenderer(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = PRESETS[PRESET].exposure;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

// ---------- пиксельные текстуры ----------

function hash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Бесшовный value noise: решётка с шагом cell пикселей, период size.
function vnoise(x, y, cell, size, s) {
  const n = Math.max(1, Math.round(size / cell));
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
  const sy = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
  const g = (i, j) => hash(((i % n) + n) % n, ((j % n) + n) % n, s);
  const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * sx;
  const b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

const rgb = (c) => {
  const s = typeof c === 'string' ? c : `#${new THREE.Color(c).getHexString()}`;
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const mul = (c, k) => c.map((v) => v * k);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const ramp = (list) => list.map(rgb);
const pick = (r, t) => r[Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)))];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function paint(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Значение 0..1 с крупными пятнами и попиксельным зерном — основа «майнкрафтовых» оттенков.
function tone(x, y, S, seed, grain = 0.45, blot = 0.45, cell = 4) {
  return clamp01(0.5 + grain * (hash(x, y, seed) - 0.5) + blot * (vnoise(x, y, cell, S, seed + 1) - 0.5) * 1.6);
}

function woodPixel(x, y, S, seed, r) {
  const t = 0.5 + 0.4 * (hash(Math.floor(x / 3), y, seed) - 0.5) + 0.35 * (hash(x, y, seed + 1) - 0.5);
  return pick(r, clamp01(t));
}

const BRICKS = ramp(['#7a4537', '#844b3c', '#8e5443', '#74463a', '#80503f']);
const MORTAR = ramp(['#8d877d', '#958f85', '#9d978c']);

function brickPixel(x, y, S, seed) {
  const row = Math.floor(y / 4);
  const off = row % 2 ? 4 : 0;
  const bx = Math.floor((x + off) / 8);
  if (y % 4 === 3 || (x + off) % 8 === 0) return pick(MORTAR, hash(x, y, seed));
  const base = BRICKS[Math.floor(hash(bx, row, seed + 2) * BRICKS.length)];
  let k = 0.92 + 0.14 * hash(x, y, seed + 3);
  if (y % 4 === 0) k *= 1.08;
  if (y % 4 === 2) k *= 0.9;
  if (hash(x, y, seed + 4) > 0.95) k *= 0.8;
  return mul(base, k);
}

const GENERATORS = {
  // Плиты покрытия 2×2 м: у каждой свой оттенок, швы на стыках — читается масштаб «блоков».
  asphalt(S, seed) {
    const r = ramp(['#4a4b4c', '#4e4f50', '#525354', '#565758']);
    return paint(S, S, (x, y) => {
      const slab = 0.94 + 0.12 * hash(Math.floor(x / 32), Math.floor(y / 32), seed + 3);
      let c = mul(pick(r, tone(x, y, S, seed, 0.5, 0.5, 2)), slab);
      const h = hash(x, y, seed + 7);
      if (h > 0.95) c = rgb('#626260');
      else if (h < 0.04) c = rgb('#3f4042');
      if (vnoise(x, y, 16, S, seed + 9) < 0.3) c = mul(c, 0.94);
      if (x % 32 === 0 || y % 32 === 0) c = mul(c, 0.7);
      else if (x % 32 === 1 || y % 32 === 1) c = mul(c, 1.05);
      return c;
    });
  },

  concrete(S, seed) {
    const r = ramp(['#8a877f', '#928f87', '#9a978f', '#a29f97', '#aaa79e']);
    return paint(S, S, (x, y) => {
      let c = pick(r, tone(x, y, S, seed, 0.4, 0.4, 4));
      const streak = hash(x, 0, seed + 5) > 0.75 && (y % 16) < 4 + hash(x, 1, seed + 5) * 10;
      if (streak) c = mul(c, 0.93);
      if (y % 16 === 0 || x % 32 === 0) c = mul(c, 0.78);
      else if (y % 16 === 1) c = mul(c, 1.06);
      if ((x % 16 === 8) && (y % 16 === 8)) c = mul(c, 0.6);
      if (hash(x, y, seed + 6) > 0.985) c = mul(c, 0.82);
      return c;
    });
  },

  brick(S, seed) {
    return paint(S, S, (x, y) => brickPixel(x, y, S, seed));
  },

  plaster(S, seed) {
    const r = ramp(['#a39478', '#ab9d81', '#b3a58a', '#bbae93', '#c2b69b']);
    return paint(S, S, (x, y) => {
      const n = vnoise(x, y, 16, S, seed + 3) * 0.8 + vnoise(x, y, 4, S, seed + 5) * 0.2 + 0.12 * (hash(x, y, seed + 4) - 0.5);
      if (n > 0.74) return brickPixel(x, y, S, seed + 11);
      let c = pick(r, tone(x, y, S, seed, 0.4, 0.35, 4));
      if (n > 0.69) c = mul(c, 0.78);
      if (vnoise(x, y, 32, S, seed + 6) < 0.3) c = mul(c, 0.93);
      return c;
    });
  },

  // Трава с проплешинами утоптанной земли и щебня; редкие цветы как в Minecraft.
  dirt(S, seed) {
    const grass = ramp(['#4e6a31', '#577536', '#5f7e3b', '#678640', '#6f8d45']);
    const soil = ramp(['#5e5040', '#665746', '#6f5f4c', '#786752']);
    const mask = (x, y) => vnoise(x, y, 32, S, seed + 2) * 0.7 + vnoise(x, y, 8, S, seed + 3) * 0.3 + 0.12 * (hash(x, y, seed + 4) - 0.5);
    return paint(S, S, (x, y) => {
      const m = mask(x, y);
      if (m > 0.36) {
        let c = pick(grass, tone(x, y, S, seed, 0.75, 0.35, 2));
        const h = hash(x, y, seed + 5);
        if (h > 0.996) c = rgb('#d6c25a');
        else if (h > 0.993) c = rgb('#d9d6c8');
        else if (h > 0.94) c = rgb('#7f944c');
        if (m < 0.39) c = mul(c, 0.84);
        return c;
      }
      let c = pick(soil, tone(x, y, S, seed + 7, 0.7, 0.3, 2));
      if (hash(x, y, seed + 8) > 0.93) c = rgb(hash(x, y, seed + 9) > 0.5 ? '#8a857a' : '#6a655c');
      return c;
    });
  },

  crate(S, seed) {
    const plank = ramp(['#86663f', '#8f6e45', '#98774b', '#a07e51']);
    const frame = ramp(['#5b4630', '#644e35', '#6d563a']);
    const b = Math.max(2, Math.round(S / 8));
    return paint(S, S, (x, y) => {
      const edge = x < b || y < b || x >= S - b || y >= S - b;
      const d = x - (S - 1 - y);
      if (edge) {
        let c = woodPixel(x, y, S, seed, frame);
        if (x === 0 || y === 0) c = mul(c, 1.12);
        if (x === S - 1 || y === S - 1) c = mul(c, 0.7);
        if ((x === Math.floor(b / 2) || x === S - 1 - Math.floor(b / 2)) && (y === Math.floor(b / 2) || y === S - 1 - Math.floor(b / 2))) c = rgb('#8c8a84');
        return c;
      }
      if (Math.abs(d) <= b * 0.6) {
        let c = woodPixel(x + y, y, S, seed + 4, frame);
        if (Math.abs(d) > b * 0.6 - 1) c = mul(c, d > 0 ? 0.72 : 1.1);
        return c;
      }
      let c = woodPixel(x, y, S, seed + 2, plank);
      if (y % 4 === 3) c = mul(c, 0.68);
      return c;
    });
  },

  container(S, seed, [cr, cg, cb]) {
    const hsl = new THREE.Color(cr, cg, cb).getHSL({});
    const base = rgb(new THREE.Color().setHSL(hsl.h, hsl.s * 0.7, Math.min(0.31, hsl.l * 0.85 + 0.03)));
    const rust = rgb('#7d5537');
    return paint(S, S, (x, y) => {
      let c = mul(base, 0.92 + 0.12 * hash(x, y, seed));
      const rib = x % 4;
      if (rib === 0) c = mul(c, 1.14);
      if (rib === 3) c = mul(c, 0.74);
      const n = vnoise(x, y, 8, S, seed + 3) + 0.3 * (hash(x, y, seed + 4) - 0.5);
      if (n > 0.8) c = mix(c, rust, 0.45);
      if (hash(x, y, seed + 5) > 0.99) c = mix(c, rust, 0.6);
      return c;
    });
  },

  metalSheet(S, seed) {
    const r = ramp(['#6c7175', '#74797d', '#7c8185', '#84898d']);
    return paint(S, S, (x, y) => {
      let c = pick(r, clamp01(0.5 + 0.5 * (hash(x, Math.floor(y / 4), seed) - 0.5) + 0.3 * (hash(x, y, seed + 1) - 0.5)));
      if (x % 8 === 0) c = mul(c, 1.1);
      return c;
    });
  },

  diamondPlate(S, seed) {
    const r = ramp(['#6b6f73', '#73777b', '#7b7f83']);
    return paint(S, S, (x, y) => {
      let c = pick(r, hash(x, y, seed));
      const cx = x % 8;
      const cy = y % 8;
      const flip = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      const u = flip ? cx : 7 - cx;
      if (Math.abs(u - cy) === 0 && cx > 1 && cx < 6) c = rgb('#979ba0');
      else if (u - cy === -1 && cx > 1 && cx < 6) c = rgb('#55595d');
      return c;
    });
  },

  hazard(S, seed) {
    const yellow = ramp(['#b08c2e', '#ba9633', '#c39f39']);
    const dark = ramp(['#2b2926', '#33302c']);
    return paint(S, S, (x, y) => {
      const stripe = ((x + y) % 16) < 8;
      let c = pick(stripe ? yellow : dark, hash(x, y, seed));
      if (hash(x, y, seed + 1) > 0.92) c = rgb('#6a6457');
      return c;
    });
  },

  wood(S, seed) {
    const r = ramp(['#76552f', '#805d34', '#8a6539', '#946d3e']);
    return paint(S, S, (x, y) => {
      let c = woodPixel(x, y, S, seed, r);
      if (y % 4 === 3) c = mul(c, 0.7);
      return c;
    });
  },
};

// Метры на один повтор текстуры (16 текселей на метр). Ящики размечаются по граням отдельно.
export const PIXEL_TILES = { asphalt: 4, concrete: 2, brick: 2, plaster: 4, dirt: 16, container: 4, metalSheet: 1, diamondPlate: 1, hazard: 1, wood: 1 };
const ROUGH = { metalSheet: 0.55, diamondPlate: 0.5, container: 0.65, hazard: 0.75 };

export function pixelTexture(c, aniso = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function pixelMaterial(name, variant, aniso) {
  const size = name === 'crate' ? (variant?.[0] || TEXELS) : PIXEL_TILES[name] * TEXELS;
  const seed = [...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const map = pixelTexture(GENERATORS[name](size, seed & 0xffff, variant), aniso);
  // Наклонное смещение глубины прячет внутренние торцы соседних кусков стен, которые иначе
  // проступают тонкими линиями на стыках (раньше их закрывал чёрный контур).
  return new THREE.MeshStandardMaterial({ map, roughness: ROUGH[name] ?? 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}

// Зерно 16×16 для однотонных деталей (оружие, руки, аптечки): пиксельная фактура без отдельной текстуры.
let grain = null;
function grainTexture() {
  if (!grain) {
    grain = pixelTexture(paint(16, 16, (x, y) => {
      const v = 226 + 29 * hash(x, y, 77) - (hash(x, y, 78) > 0.9 ? 22 : 0);
      return [v, v, v];
    }));
    grain.colorSpace = THREE.NoColorSpace;
  }
  return grain;
}

function mute(c) {
  const col = new THREE.Color(c);
  const hsl = col.getHSL({});
  return col.setHSL(hsl.h, hsl.s * 0.6, hsl.l);
}

export function mcMaterial(p = {}) {
  const q = { ...p };
  if (q.color !== undefined) q.color = mute(q.color);
  if (!q.map) q.map = grainTexture();
  return new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...q });
}

// Скины персонажей: атлас уменьшается в factor раз и читается без фильтрации — крупные пиксели.
export function pixelSkin(src, factor = 8) {
  const s = src.width / factor;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'saturate(0.72)';
  ctx.drawImage(src, 0, 0, s, s);
  const t = pixelTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// ---------- небо ----------

// Градиент неба с ореолом солнца: общий для купола и для облаков, которые растворяются в нём вдали.
const SKY_GLSL = `
  uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 glow; uniform vec3 sunDir;
  vec3 sky(vec3 d) {
    float h = d.y;
    vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(horizon, bottom, smoothstep(0.0, -0.3, h));
    float s = max(dot(d, sunDir), 0.0);
    float lowSun = 1.0 - clamp(sunDir.y * 1.6, 0.0, 1.0);
    c += glow * (pow(s, 6.0) * (0.25 + 0.5 * lowSun) + pow(s, 60.0) * 0.8) * (1.0 - 0.5 * clamp(h, 0.0, 1.0));
    return c * 1.5;
  }`;

function skyUniforms(env, sunDir) {
  return {
    top: { value: new THREE.Color(env.skyTop) },
    horizon: { value: new THREE.Color(env.skyHorizon) },
    bottom: { value: new THREE.Color(env.skyBottom) },
    glow: { value: new THREE.Color(env.sunGlow) },
    sunDir: { value: sunDir.clone().normalize() },
  };
}

function cloudLayer(env, sunDir) {
  const cell = 12;
  const n = 64;
  const y0 = 72;
  const h = 4;
  const seed = 4242;
  const filled = (i, j) => {
    const x = ((i % n) + n) % n;
    const z = ((j % n) + n) % n;
    return vnoise(x, z, 8, n, seed) * (1 - env.cloudDetail) + vnoise(x, z, 2, n, seed + 1) * env.cloudDetail > 1 - env.cloudCover;
  };
  const pos = [];
  const col = [];
  const quad = (a, b, c, d, shade) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) col.push(shade, shade, shade);
  };
  const R = 30;
  for (let i = -R; i < R; i++) {
    for (let j = -R; j < R; j++) {
      if (!filled(i, j) || Math.hypot(i + 0.5, j + 0.5) > R) continue;
      const x0 = i * cell;
      const x1 = x0 + cell;
      const z0 = j * cell;
      const z1 = z0 + cell;
      const y1 = y0 + h;
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 1);
      quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.7);
      if (!filled(i - 1, j)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.84);
      if (!filled(i + 1, j)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.84);
      if (!filled(i, j - 1)) quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.9);
      if (!filled(i, j + 1)) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.78);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Непрозрачные: полупрозрачные слои верх/низ дают решётку из-за порядка отрисовки.
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
    uniforms: { ...skyUniforms(env, sunDir), tint: { value: new THREE.Color(env.clouds) } },
    vertexShader: `
      varying vec3 vShade; varying vec3 vRel;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vRel = wp.xyz - cameraPosition;
        vShade = color;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      ${SKY_GLSL}
      uniform vec3 tint;
      varying vec3 vShade; varying vec3 vRel;
      void main() {
        float f = smoothstep(360.0, 120.0, length(vRel.xz));
        gl_FragColor = vec4(mix(sky(normalize(vRel)), tint * vShade * 1.6, 0.85 * f), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.userData.noAO = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function mcSky(env, sunDir) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms(env, sunDir),
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = sky(d) + glow * smoothstep(0.99955, 0.9998, dot(d, sunDir)) * 45.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), mat);
  dome.renderOrder = -1;
  dome.userData.noAO = true;
  group.add(dome, cloudLayer(env, sunDir));
  return group;
}

// ---------- тени ----------

// Ортокамера тени подгоняется под габарит карты в пространстве света: при низком солнце
// это заметно повышает плотность теневой карты.
export function fitShadow(sun, box, size, env) {
  const center = box.getCenter(new THREE.Vector3());
  const dir = sun.position.clone().normalize();
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(dir, 120);
  const inv = new THREE.Matrix4().lookAt(sun.position, center, new THREE.Vector3(0, 1, 0)).setPosition(sun.position).invert();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    lo.min(p);
    hi.max(p);
  }
  const cam = sun.shadow.camera;
  Object.assign(cam, { left: lo.x - 1, right: hi.x + 1, bottom: lo.y - 1, top: hi.y + 1, near: Math.max(0.5, -hi.z - 2), far: -lo.z + 2 });
  cam.updateProjectionMatrix();
  sun.castShadow = true;
  sun.shadow.mapSize.set(size, size);
  const texel = Math.max(hi.x - lo.x, hi.y - lo.y) / size;
  sun.shadow.radius = Math.max(1, env.soft / texel);
  sun.shadow.intensity = env.shadowIntensity;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = Math.max(0.02, texel * 1.5);
}

// ---------- постобработка ----------

// Второй проход: модель оружия от первого лица рисуется поверх кадра после AO, но до bloom и тонмаппинга.
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0.35 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation; uniform vec3 tint; uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation) * tint;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot(d, d) * 1.6;
      gl_FragColor = c;
    }`,
};

export class McPost {
  constructor(renderer, scene, camera, vm, env, level, box) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.vm = vm;
    const q = MC_QUALITY[level] || MC_QUALITY.medium;
    this.q = q;
    if (!q.post) return;
    // При pixelRatio ≥ 1.5 кадр уже суперсэмплирован — MSAA только тратил бы память.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.getPixelRatio() >= 1.5 ? 0 : q.msaa });
    const composer = new EffectComposer(renderer, rt);
    this.composer = composer;
    composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const ao = new GTAOPass(scene, camera, 1, 1);
      ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 3, scale: 2.2, samples: 12, distanceFallOff: 1 });
      ao.updatePdMaterial({ radius: 6, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
      ao.blendIntensity = env.ao;
      ao.setSceneClipBox(box.clone().expandByScalar(4));
      // Небо, облака, прозрачные эффекты и таблички с именами в AO не участвуют.
      const hide = ao._overrideVisibility;
      ao._overrideVisibility = function () {
        hide.call(this);
        scene.traverse((o) => {
          if (o.visible && (o.isSprite || o.userData.noAO || (o.isMesh && o.material.transparent))) {
            o.visible = false;
            this._visibilityCache.push(o);
          }
        });
      };
      ao.setSize = (w, h) => {
        const k = q.ao / renderer.getPixelRatio();
        GTAOPass.prototype.setSize.call(ao, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
      };
      composer.addPass(ao);
      this.ao = ao;
    }
    this.overlay = new OverlayPass(vm.scene, vm.camera);
    composer.addPass(this.overlay);
    if (q.bloom && env.bloom > 0) composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), env.bloom, 0.5, env.bloomThreshold));
    const grade = new ShaderPass(GradeShader);
    grade.uniforms.saturation.value = env.saturation;
    grade.uniforms.tint.value.fromArray(env.tint);
    composer.addPass(grade);
    composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(withVm) {
    const r = this.renderer;
    if (!this.composer) {
      r.setRenderTarget(null);
      r.clear();
      r.render(this.scene, this.camera);
      if (withVm) {
        r.clearDepth();
        r.render(this.vm.scene, this.vm.camera);
      }
      return;
    }
    this.overlay.enabled = withVm;
    this.composer.render();
  }

  dispose() {
    if (!this.composer) return;
    for (const p of this.composer.passes) p.dispose?.();
    this.composer.dispose();
  }
}
