import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

// Бесшовный value noise: решётка замкнута по периоду, поэтому текстура тайлится без швов.
function noiseLayer(size, freqX, freqY, rand) {
  const lat = new Float32Array(freqX * freqY);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * freqY;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const r0 = (y0 % freqY) * freqX;
    const r1 = ((y0 + 1) % freqY) * freqX;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * freqX;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const c0 = x0 % freqX;
      const c1 = (x0 + 1) % freqX;
      const a = mix(lat[r0 + c0], lat[r0 + c1], tx);
      const b = mix(lat[r1 + c0], lat[r1 + c1], tx);
      out[y * size + x] = mix(a, b, ty);
    }
  }
  return out;
}

export function fbm(size, freq, octaves, seed, { gain = 0.5, stretchY = 1 } = {}) {
  const rand = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    const layer = noiseLayer(size, f, Math.max(1, Math.round(f * stretchY)), rand);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= gain;
    f *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function contrast(arr, lo, hi) {
  for (let i = 0; i < arr.length; i++) arr[i] = clamp01((arr[i] - lo) / (hi - lo));
  return arr;
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function rgbCanvas(size, fn) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const col = [0, 0, 0];
  for (let i = 0, p = 0; i < size * size; i++, p += 4) {
    fn(i, col);
    d[p] = clamp01(col[0]) * 255;
    d[p + 1] = clamp01(col[1]) * 255;
    d[p + 2] = clamp01(col[2]) * 255;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grayCanvas(size, arr) {
  return rgbCanvas(size, (i, c) => { c[0] = c[1] = c[2] = arr[i]; });
}

function normalCanvas(size, height, strength) {
  return rgbCanvas(size, (i, c) => {
    const x = i % size;
    const y = (i / size) | 0;
    const l = height[y * size + ((x - 1 + size) % size)];
    const r = height[y * size + ((x + 1) % size)];
    const u = height[((y - 1 + size) % size) * size + x];
    const d = height[((y + 1) % size) * size + x];
    let nx = (l - r) * strength;
    let ny = (d - u) * strength;
    const len = Math.hypot(nx, ny, 1);
    c[0] = (nx / len) * 0.5 + 0.5;
    c[1] = (ny / len) * 0.5 + 0.5;
    c[2] = 1 / len;
  });
}

let maxAniso = 4;
export function setAnisotropy(v) { maxAniso = v; }

function tex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function material(size, color, height, rough, normalStrength, params = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(color, true),
    normalMap: tex(normalCanvas(size, height, normalStrength), false),
    roughnessMap: tex(grayCanvas(size, rough), false),
    roughness: 1,
    metalness: 0,
    ...params,
  });
}

function scratches(size, arr, count, seed, value, lenMax = 0.12) {
  const r = rng(seed);
  for (let s = 0; s < count; s++) {
    let x = r() * size;
    let y = r() * size;
    const ang = r() * Math.PI * 2;
    const len = r() * size * lenMax;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let t = 0; t < len; t++) {
      const xi = ((Math.round(x + dx * t) % size) + size) % size;
      const yi = ((Math.round(y + dy * t) % size) + size) % size;
      arr[yi * size + xi] = value;
    }
  }
}

function cracks(size, arr, count, seed, depth) {
  const r = rng(seed);
  for (let s = 0; s < count; s++) {
    let x = r() * size;
    let y = r() * size;
    let ang = r() * Math.PI * 2;
    const steps = 40 + r() * size * 0.5;
    for (let t = 0; t < steps; t++) {
      ang += (r() - 0.5) * 0.7;
      x += Math.cos(ang);
      y += Math.sin(ang);
      const xi = ((Math.round(x) % size) + size) % size;
      const yi = ((Math.round(y) % size) + size) % size;
      arr[yi * size + xi] -= depth;
    }
  }
}

const generators = {
  concrete(size, seed) {
    const base = fbm(size, 4, 6, seed);
    const fine = fbm(size, 32, 3, seed + 1);
    const stains = contrast(fbm(size, 3, 4, seed + 2), 0.45, 0.8);
    const pores = fbm(size, 64, 2, seed + 3);
    const height = new Float32Array(size * size);
    for (let i = 0; i < height.length; i++) height[i] = fine[i] * 0.6 + (pores[i] < 0.28 ? -0.5 : 0);
    cracks(size, height, 3, seed + 4, 0.6);
    const color = rgbCanvas(size, (i, c) => {
      const v = 0.52 + (base[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.12 - stains[i] * 0.12 + Math.min(0, height[i]) * 0.25;
      c[0] = v * 0.98; c[1] = v * 0.97; c[2] = v * 0.94;
    });
    const rough = height.map((h, i) => 0.82 + (fine[i] - 0.5) * 0.2 - stains[i] * 0.1);
    return material(size, color, height, rough, 3);
  },

  asphalt(size, seed) {
    const base = fbm(size, 6, 5, seed);
    const grit = fbm(size, 128, 1, seed + 1);
    const patches = contrast(fbm(size, 2, 4, seed + 2), 0.5, 0.75);
    const height = grit.map((g, i) => g * 0.8 + base[i] * 0.2);
    const color = rgbCanvas(size, (i, c) => {
      let v = 0.2 + (base[i] - 0.5) * 0.12 + (grit[i] > 0.82 ? 0.14 : 0) + patches[i] * 0.06;
      c[0] = v; c[1] = v * 1.0; c[2] = v * 1.03;
    });
    const rough = grit.map((g) => 0.88 + (g - 0.5) * 0.15);
    return material(size, color, height, rough, 4);
  },

  brick(size, seed) {
    const rows = 8;
    const cols = 4;
    const r = rng(seed);
    const tint = [];
    for (let i = 0; i < rows * cols; i++) tint.push([0.55 + r() * 0.2, 0.22 + r() * 0.1, 0.16 + r() * 0.06, r()]);
    const fine = fbm(size, 32, 4, seed + 1);
    const chips = fbm(size, 16, 3, seed + 2);
    const height = new Float32Array(size * size);
    const colorArr = new Float32Array(size * size * 3);
    const bh = size / rows;
    const bw = size / cols;
    const mortar = size / 128;
    for (let y = 0; y < size; y++) {
      const row = Math.floor(y / bh);
      const off = row % 2 ? bw / 2 : 0;
      for (let x = 0; x < size; x++) {
        const xx = (x + off) % size;
        const col = Math.floor(xx / bw);
        const lx = xx - col * bw;
        const ly = y - row * bh;
        const edge = Math.min(lx, bw - lx, ly, bh - ly);
        const i = y * size + x;
        const t = tint[row * cols + col];
        if (edge < mortar) {
          height[i] = 0.1 + fine[i] * 0.1;
          const m = 0.55 + fine[i] * 0.15;
          colorArr[i * 3] = m; colorArr[i * 3 + 1] = m * 0.96; colorArr[i * 3 + 2] = m * 0.9;
        } else {
          const bevel = Math.min(1, (edge - mortar) / (mortar * 1.5));
          const chip = chips[i] < 0.3 ? -0.3 : 0;
          height[i] = 0.5 + bevel * 0.4 + fine[i] * 0.15 + chip;
          const shade = 0.85 + fine[i] * 0.3 + chip * 0.4 + (t[3] - 0.5) * 0.15;
          colorArr[i * 3] = t[0] * shade; colorArr[i * 3 + 1] = t[1] * shade; colorArr[i * 3 + 2] = t[2] * shade;
        }
      }
    }
    const color = rgbCanvas(size, (i, c) => { c[0] = colorArr[i * 3]; c[1] = colorArr[i * 3 + 1]; c[2] = colorArr[i * 3 + 2]; });
    const rough = height.map((h, i) => 0.8 + fine[i] * 0.15);
    return material(size, color, height, rough, 5);
  },

  container(size, seed, [pr, pg, pb]) {
    const ribs = 10;
    const dirt = fbm(size, 4, 5, seed);
    const rust = contrast(fbm(size, 6, 5, seed + 1), 0.62, 0.78);
    const streaks = fbm(size, 24, 3, seed + 2, { stretchY: 0.08 });
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = ((x / size) * ribs) % 1;
        const tri = p < 0.2 ? p / 0.2 : p < 0.5 ? 1 : p < 0.7 ? 1 - (p - 0.5) / 0.2 : 0;
        height[y * size + x] = tri;
      }
    }
    const scr = new Float32Array(size * size).fill(0);
    scratches(size, scr, 60, seed + 3, 1, 0.06);
    const color = rgbCanvas(size, (i, c) => {
      const d = 0.75 + dirt[i] * 0.35 - streaks[i] * 0.25 - (1 - height[i]) * 0.05;
      c[0] = pr * d; c[1] = pg * d; c[2] = pb * d;
      if (rust[i] > 0) {
        const k = rust[i];
        c[0] = mix(c[0], 0.38 + dirt[i] * 0.1, k); c[1] = mix(c[1], 0.2, k); c[2] = mix(c[2], 0.1, k);
      }
      if (scr[i]) { c[0] = mix(c[0], 0.6, 0.5); c[1] = mix(c[1], 0.6, 0.5); c[2] = mix(c[2], 0.6, 0.5); }
    });
    const rough = height.map((h, i) => 0.5 + rust[i] * 0.4 + streaks[i] * 0.1 - scr[i] * 0.2);
    return material(size, color, height, rough, 6, { metalness: 0.45 });
  },

  crate(size, seed) {
    const grain = fbm(size, 4, 5, seed, { stretchY: 6 });
    const fine = fbm(size, 64, 2, seed + 1, { stretchY: 4 });
    const planks = 5;
    const frame = size * 0.1;
    const height = new Float32Array(size * size);
    const r = rng(seed + 2);
    const pt = Array.from({ length: planks + 2 }, () => 0.85 + r() * 0.3);
    const color = rgbCanvas(size, (i, c) => {
      const x = i % size;
      const y = (i / size) | 0;
      const inFrame = x < frame || x > size - frame || y < frame || y > size - frame;
      const diag = Math.abs(x - y) < frame * 0.55 && !inFrame;
      const pl = Math.floor((y / size) * planks);
      const gap = !inFrame && !diag && ((y / size) * planks) % 1 < 0.025;
      let k = inFrame || diag ? 0.8 : pt[pl];
      const g = inFrame && (x < frame || x > size - frame) ? fine[(x * size + y) % (size * size)] : grain[i];
      let v = (0.55 + g * 0.45) * k;
      height[i] = gap ? 0 : inFrame || diag ? 1 : 0.6 + g * 0.1;
      if (gap) v *= 0.3;
      const edgeDist = Math.min(x, size - x, y, size - y);
      if (edgeDist < 4) v *= 0.8;
      c[0] = 0.62 * v; c[1] = 0.45 * v; c[2] = 0.27 * v;
    });
    const rough = grain.map((g) => 0.7 + g * 0.2);
    return material(size, color, height, rough, 5);
  },

  diamondPlate(size, seed) {
    const n = fbm(size, 8, 4, seed);
    const scr = new Float32Array(size * size);
    scratches(size, scr, 120, seed + 1, 1, 0.05);
    const cells = 8;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cx = ((x / size) * cells) % 1;
        const cy = ((y / size) * cells) % 1;
        const flip = (Math.floor((x / size) * cells) + Math.floor((y / size) * cells)) % 2;
        const u = cx - 0.5;
        const v = cy - 0.5;
        const a = flip ? (u + v) : (u - v);
        const b = flip ? (u - v) : (u + v);
        const bump = Math.abs(a) < 0.35 && Math.abs(b) < 0.08 ? 1 - Math.abs(b) / 0.08 * 0.5 : 0;
        height[y * size + x] = bump;
      }
    }
    const color = rgbCanvas(size, (i, c) => {
      const v = 0.55 + n[i] * 0.2 + height[i] * 0.08 + scr[i] * 0.1;
      c[0] = v; c[1] = v; c[2] = v * 1.02;
    });
    const rough = n.map((v, i) => 0.35 + v * 0.3 - scr[i] * 0.15 - height[i] * 0.1);
    return material(size, color, height, rough, 4, { metalness: 0.85 });
  },

  dirt(size, seed) {
    const base = fbm(size, 4, 6, seed);
    const pebbles = fbm(size, 48, 2, seed + 1);
    const grass = contrast(fbm(size, 5, 5, seed + 2), 0.58, 0.75);
    const height = pebbles.map((p, i) => (p > 0.7 ? 0.5 + (p - 0.7) * 2 : base[i] * 0.3));
    const color = rgbCanvas(size, (i, c) => {
      const v = 0.75 + (base[i] - 0.5) * 0.5;
      c[0] = 0.46 * v; c[1] = 0.37 * v; c[2] = 0.27 * v;
      if (pebbles[i] > 0.72) { c[0] = 0.55; c[1] = 0.52; c[2] = 0.48; }
      const g = grass[i];
      c[0] = mix(c[0], 0.24, g * 0.8); c[1] = mix(c[1], 0.33, g * 0.8); c[2] = mix(c[2], 0.14, g * 0.8);
    });
    const rough = base.map(() => 0.95);
    return material(size, color, height, rough, 4);
  },

  plaster(size, seed) {
    const base = fbm(size, 5, 6, seed);
    const fine = fbm(size, 48, 3, seed + 1);
    const chipped = contrast(fbm(size, 4, 5, seed + 2), 0.66, 0.7);
    const height = fine.map((f, i) => f * 0.3 + (1 - chipped[i]) * 0.6);
    const color = rgbCanvas(size, (i, c) => {
      const v = 0.82 + (base[i] - 0.5) * 0.25 + (fine[i] - 0.5) * 0.08;
      c[0] = 0.86 * v; c[1] = 0.79 * v; c[2] = 0.66 * v;
      if (chipped[i] > 0.5) { c[0] = 0.5 * v; c[1] = 0.28 * v; c[2] = 0.2 * v; }
    });
    const rough = fine.map((f) => 0.85 + f * 0.1);
    return material(size, color, height, rough, 3);
  },

  metalSheet(size, seed) {
    const n = fbm(size, 4, 5, seed);
    const streak = fbm(size, 32, 3, seed + 1, { stretchY: 0.1 });
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = Math.sin((x / size) * Math.PI * 2 * 6) * 0.5 + 0.5;
    const color = rgbCanvas(size, (i, c) => {
      const v = 0.5 + n[i] * 0.2 - streak[i] * 0.1;
      c[0] = v * 0.95; c[1] = v; c[2] = v * 1.02;
    });
    const rough = n.map((v, i) => 0.35 + v * 0.3 + streak[i] * 0.15);
    return material(size, color, height, rough, 3, { metalness: 0.8 });
  },

  hazard(size, seed) {
    const wear = contrast(fbm(size, 8, 5, seed), 0.55, 0.8);
    const height = new Float32Array(size * size);
    const color = rgbCanvas(size, (i, c) => {
      const x = i % size;
      const y = (i / size) | 0;
      const stripe = Math.floor(((x + y) / size) * 4) % 2;
      if (stripe) { c[0] = 0.9; c[1] = 0.65; c[2] = 0.05; } else { c[0] = c[1] = c[2] = 0.06; }
      const w = wear[i];
      c[0] = mix(c[0], 0.4, w); c[1] = mix(c[1], 0.4, w); c[2] = mix(c[2], 0.42, w);
      height[i] = 1 - w * 0.3;
    });
    return material(size, color, height, wear.map((w) => 0.6 + w * 0.2), 2, { metalness: 0.3 });
  },

  wood(size, seed) {
    const grain = fbm(size, 3, 6, seed, { stretchY: 8 });
    const rings = new Float32Array(size * size);
    for (let i = 0; i < rings.length; i++) rings[i] = (Math.sin(grain[i] * 60) * 0.5 + 0.5);
    const color = rgbCanvas(size, (i, c) => {
      const v = 0.6 + rings[i] * 0.25 + grain[i] * 0.3;
      c[0] = 0.45 * v; c[1] = 0.25 * v; c[2] = 0.12 * v;
    });
    return material(size, color, rings, rings.map((r) => 0.45 + r * 0.2), 1.5);
  },
};

// Микро-детали для оружия: царапины и потёртости в шероховатости и нормалях.
function detailMaps(size, seed, scratchCount, grainFreq) {
  const n = fbm(size, grainFreq, 3, seed);
  const scr = new Float32Array(size * size);
  scratches(size, scr, scratchCount, seed + 1, 1, 0.08);
  const height = n.map((v, i) => v * 0.4 - scr[i] * 0.3);
  const rough = n.map((v, i) => 0.3 + v * 0.35 - scr[i] * 0.2);
  return { normal: tex(normalCanvas(size, height, 2), false), rough: tex(grayCanvas(size, rough), false) };
}

export class TextureLibrary {
  constructor(size) {
    this.size = size;
    this.cache = new Map();
  }

  get(name, variant = null) {
    const key = variant ? `${name}:${variant.join(',')}` : name;
    if (!this.cache.has(key)) {
      const seed = [...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
      this.cache.set(key, generators[name](this.size, seed, variant));
    }
    return this.cache.get(key);
  }

  detail() {
    if (!this.detailCache) this.detailCache = detailMaps(Math.min(this.size, 512), 99, 90, 48);
    return this.detailCache;
  }

  weaponMaterials() {
    if (this.weaponCache) return this.weaponCache;
    const d = this.detail();
    const std = (p) => new THREE.MeshStandardMaterial({ normalMap: d.normal, roughnessMap: d.rough, ...p });
    const wood = this.get('wood');
    this.weaponCache = {
      steel: std({ color: 0x3a3d42, metalness: 0.9, roughness: 0.55 }),
      darkSteel: std({ color: 0x1d1f22, metalness: 0.85, roughness: 0.6 }),
      bright: std({ color: 0x9aa0a8, metalness: 1, roughness: 0.35 }),
      polymer: std({ color: 0x24262a, metalness: 0.05, roughness: 1.2, normalScale: new THREE.Vector2(1.5, 1.5) }),
      tan: std({ color: 0x9c8663, metalness: 0.05, roughness: 1.1 }),
      olive: std({ color: 0x4b5236, metalness: 0.1, roughness: 1 }),
      accent: std({ color: 0xd1661f, metalness: 0.4, roughness: 0.7 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xc9a045, metalness: 1, roughness: 0.3 }),
      wood: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, roughness: 1 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x3060a0, metalness: 0.2, roughness: 0.05, emissive: 0x0a1a33, transparent: true, opacity: 0.85 }),
      redDot: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
      glowGreen: new THREE.MeshBasicMaterial({ color: 0x40ff60 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }),
    };
    return this.weaponCache;
  }
}
