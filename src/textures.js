import * as THREE from 'three';
import { MC, PIXEL_TILES, pixelMaterial, mcMaterial } from './style-mc.js';
import { mcWeaponMaterials } from './mc-gear.js';

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

const INK = '#2a2230';

let maxAniso = 4;
export function setAnisotropy(v) { maxAniso = v; }

// Три ступени освещения вместо плавного затенения дают мультяшный вид.
let gradient = null;
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(params) {
  if (MC) return mcMaterial(params);
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
}

function canvas(size, draw, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size, rng(seed));
  return c;
}

function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Рисует фигуру и её копии со сдвигом на размер тайла, чтобы текстура была бесшовной.
function wrapped(s, x, y, fn) {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) fn(x + dx, y + dy);
}

function speckles(ctx, s, r, count, colors, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const x = r() * s;
    const y = r() * s;
    const rad = rMin + r() * (rMax - rMin);
    wrapped(s, x, y, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, rad, rad * (0.6 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function crack(ctx, s, r, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let x = s * (0.15 + r() * 0.7);
  let y = s * (0.15 + r() * 0.7);
  let ang = r() * Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < 5; i++) {
    ang += (r() - 0.5) * 1.4;
    x += Math.cos(ang) * s * 0.05;
    y += Math.sin(ang) * s * 0.05;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

const generators = {
  concrete: (ctx, s, r) => {
    ctx.fillStyle = '#d6cfc2';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.25;
    speckles(ctx, s, r, 14, ['#e6e0d4', '#c4bcae'], s * 0.06, s * 0.14);
    ctx.globalAlpha = 1;
    speckles(ctx, s, r, 60, ['#bdb5a6'], s * 0.004, s * 0.009);
    ctx.fillStyle = '#9e9586';
    ctx.fillRect(0, 0, s, s * 0.012);
    ctx.fillRect(0, 0, s * 0.012, s);
    ctx.fillRect(0, s * 0.5, s, s * 0.008);
    ctx.fillStyle = '#e8e2d7';
    ctx.fillRect(0, s * 0.012, s, s * 0.006);
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      ctx.fillStyle = '#8f8676';
      ctx.beginPath();
      ctx.arc(x * s, y * s, s * 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
    crack(ctx, s, r, '#8a8172', s * 0.006);
  },

  asphalt: (ctx, s, r) => {
    ctx.fillStyle = '#5d6475';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.3;
    speckles(ctx, s, r, 10, ['#666e80', '#535a6a'], s * 0.08, s * 0.16);
    ctx.globalAlpha = 1;
    speckles(ctx, s, r, 160, ['#727a8c', '#4c5262', '#80889a'], s * 0.003, s * 0.007);
    crack(ctx, s, r, '#454b59', s * 0.005);
  },

  brick: (ctx, s, r) => {
    const rows = 8;
    const cols = 4;
    const bh = s / rows;
    const bw = s / cols;
    const m = s * 0.018;
    const palette = ['#e0703f', '#d5613a', '#e8834f', '#cb5a37', '#dd6a44'];
    ctx.fillStyle = '#f2e3c6';
    ctx.fillRect(0, 0, s, s);
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < cols; col++) {
        const x = col * bw + off + m / 2;
        const y = row * bh + m / 2;
        const w = bw - m;
        const h = bh - m;
        const base = palette[Math.floor(r() * palette.length)];
        ctx.fillStyle = base;
        roundRect(ctx, x, y, w, h, s * 0.012);
        ctx.fill();
        ctx.fillStyle = shade(base, 1.18);
        roundRect(ctx, x + w * 0.06, y + h * 0.12, w * 0.88, h * 0.22, s * 0.006);
        ctx.fill();
        ctx.fillStyle = shade(base, 0.78);
        ctx.fillRect(x + s * 0.004, y + h * 0.78, w - s * 0.008, h * 0.18);
        ctx.strokeStyle = '#7a3322';
        ctx.lineWidth = s * 0.005;
        roundRect(ctx, x, y, w, h, s * 0.012);
        ctx.stroke();
        if (r() < 0.12) {
          ctx.fillStyle = shade(base, 0.7);
          ctx.beginPath();
          ctx.arc(x + w * (0.2 + r() * 0.6), y + h * 0.5, s * 0.01, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },

  container: (ctx, s, r, [cr, cg, cb]) => {
    const base = new THREE.Color(cr, cg, cb).offsetHSL(0, 0.15, 0.12);
    const hex = `#${base.getHexString()}`;
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, s, s);
    const ribs = 10;
    const w = s / ribs;
    for (let i = 0; i < ribs; i++) {
      ctx.fillStyle = shade(hex, 0.8);
      ctx.fillRect(i * w + w * 0.62, 0, w * 0.26, s);
      ctx.fillStyle = shade(hex, 1.15);
      ctx.fillRect(i * w + w * 0.08, 0, w * 0.1, s);
    }
    ctx.fillStyle = shade(hex, 0.55);
    ctx.fillRect(0, 0, s, s * 0.03);
    ctx.fillRect(0, s * 0.97, s, s * 0.03);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(ctx, s * 0.12, s * 0.16, s * 0.2, s * 0.07, s * 0.01);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(ctx, s * 0.12, s * 0.26, s * 0.12, s * 0.035, s * 0.008);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    speckles(ctx, s, r, 6, [shade(hex, 0.75)], s * 0.02, s * 0.05);
    ctx.globalAlpha = 1;
  },

  crate: (ctx, s) => {
    ctx.fillStyle = '#e39b4a';
    ctx.fillRect(0, 0, s, s);
    const planks = 4;
    for (let i = 1; i < planks; i++) {
      ctx.fillStyle = '#b86f2c';
      ctx.fillRect(0, (i / planks) * s - s * 0.006, s, s * 0.012);
    }
    ctx.strokeStyle = '#cf8438';
    ctx.lineWidth = s * 0.006;
    for (let i = 0; i < 10; i++) {
      const y = ((i + 0.5) / 10) * s;
      ctx.beginPath();
      ctx.moveTo(s * 0.15, y);
      ctx.bezierCurveTo(s * 0.4, y - s * 0.015, s * 0.6, y + s * 0.015, s * 0.85, y);
      ctx.stroke();
    }
    const f = s * 0.13;
    ctx.fillStyle = '#b36a2a';
    ctx.fillRect(0, 0, s, f);
    ctx.fillRect(0, s - f, s, f);
    ctx.fillRect(0, 0, f, s);
    ctx.fillRect(s - f, 0, f, s);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-s * 0.68, -f * 0.45, s * 1.36, f * 0.9);
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.012;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
    ctx.lineWidth = s * 0.007;
    ctx.strokeRect(f, f, s - 2 * f, s - 2 * f);
    ctx.fillStyle = '#5b3a1e';
    for (const [x, y] of [[0.065, 0.065], [0.935, 0.065], [0.065, 0.935], [0.935, 0.935]]) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, s * 0.015, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  diamondPlate: (ctx, s) => {
    ctx.fillStyle = '#b8c3cf';
    ctx.fillRect(0, 0, s, s);
    const n = 8;
    const c = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.save();
        ctx.translate((x + 0.5) * c, (y + 0.5) * c);
        ctx.rotate((x + y) % 2 ? Math.PI / 4 : -Math.PI / 4);
        ctx.fillStyle = '#dde5ee';
        roundRect(ctx, -c * 0.32, -c * 0.07, c * 0.64, c * 0.14, c * 0.07);
        ctx.fill();
        ctx.fillStyle = '#8e9aa8';
        ctx.fillRect(-c * 0.28, c * 0.04, c * 0.56, c * 0.04);
        ctx.restore();
      }
    }
  },

  dirt: (ctx, s, r) => {
    ctx.fillStyle = '#dcb872';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.35;
    speckles(ctx, s, r, 12, ['#e6c688', '#cfa862'], s * 0.06, s * 0.13);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      const x = r() * s;
      const y = r() * s;
      const rad = s * (0.05 + r() * 0.07);
      wrapped(s, x, y, (px, py) => {
        ctx.fillStyle = '#4f9a35';
        ctx.beginPath();
        ctx.ellipse(px, py + rad * 0.12, rad * 1.05, rad * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#76c24f';
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * 0.68, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    speckles(ctx, s, r, 40, ['#b39157', '#c9c2b5', '#a8a092'], s * 0.005, s * 0.012);
  },

  plaster: (ctx, s, r) => {
    ctx.fillStyle = '#f3dfb2';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.3;
    speckles(ctx, s, r, 10, ['#f8e8c4', '#e4cc9a'], s * 0.06, s * 0.12);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const x = s * (0.2 + r() * 0.6);
      const y = s * (0.2 + r() * 0.6);
      const w = s * (0.14 + r() * 0.1);
      const h = s * (0.09 + r() * 0.06);
      ctx.fillStyle = '#d9713f';
      roundRect(ctx, x - w / 2, y - h / 2, w, h, s * 0.03);
      ctx.fill();
      ctx.strokeStyle = '#f2e3c6';
      ctx.lineWidth = s * 0.008;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y);
      ctx.lineTo(x + w / 2, y);
      ctx.moveTo(x - w * 0.1, y - h / 2);
      ctx.lineTo(x - w * 0.1, y);
      ctx.moveTo(x + w * 0.2, y);
      ctx.lineTo(x + w * 0.2, y + h / 2);
      ctx.stroke();
      ctx.strokeStyle = '#a5794a';
      ctx.lineWidth = s * 0.008;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, s * 0.03);
      ctx.stroke();
    }
  },

  metalSheet: (ctx, s) => {
    ctx.fillStyle = '#aeb9c6';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = '#c9d3de';
      ctx.fillRect((i / 6) * s, 0, s * 0.04, s);
      ctx.fillStyle = '#8d98a6';
      ctx.fillRect((i / 6) * s + s * 0.1, 0, s * 0.03, s);
    }
  },

  hazard: (ctx, s) => {
    ctx.fillStyle = '#ffc933';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#2b2733';
    for (let i = -4; i < 8; i += 2) {
      ctx.beginPath();
      ctx.moveTo((i / 4) * s, 0);
      ctx.lineTo(((i + 1) / 4) * s, 0);
      ctx.lineTo(((i + 1) / 4) * s + s, s);
      ctx.lineTo((i / 4) * s + s, s);
      ctx.fill();
    }
  },

  sand: (ctx, s, r) => {
    ctx.fillStyle = '#e2c27f';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.35;
    speckles(ctx, s, r, 14, ['#ebcf93', '#d3b06c'], s * 0.05, s * 0.12);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const rad = s * (0.03 + r() * 0.04);
      wrapped(s, r() * s, r() * s, (px, py) => {
        ctx.fillStyle = '#6aae45';
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    speckles(ctx, s, r, 50, ['#b8955a', '#cfc6b4'], s * 0.004, s * 0.01);
  },

  stone: (ctx, s, r) => {
    ctx.fillStyle = '#b9b2a4';
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? s / 4 : 0;
      for (let i = -1; i < 2; i++) {
        const x = i * s / 2 + off;
        const y = j * s / rows;
        ctx.fillStyle = shade('#cfc8ba', 0.92 + r() * 0.12);
        roundRect(ctx, x + s * 0.012, y + s * 0.012, s / 2 - s * 0.024, s / rows - s * 0.024, s * 0.02);
        ctx.fill();
      }
    }
    speckles(ctx, s, r, 40, ['#a39c8e', '#ddd7cb'], s * 0.004, s * 0.012);
  },

  log: (ctx, s, r) => {
    ctx.fillStyle = '#7a5532';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#5a3c22';
    ctx.lineWidth = s * 0.03;
    for (let i = 0; i < 6; i++) {
      const x = (i / 6) * s + r() * s * 0.06;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= s; y += s / 8) ctx.lineTo(x + Math.sin(y / s * Math.PI * 2 + i) * s * 0.02, y);
      ctx.stroke();
    }
  },

  leaves: (ctx, s, r) => {
    ctx.fillStyle = '#4f9a35';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 18; i++) {
      const rad = s * (0.05 + r() * 0.08);
      wrapped(s, r() * s, r() * s, (px, py) => {
        ctx.fillStyle = r() > 0.5 ? '#63b545' : '#3f8429';
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  },

  wood: (ctx, s, r) => {
    ctx.fillStyle = '#c47e3e';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#9c5d28';
    ctx.lineWidth = s * 0.012;
    for (let i = 0; i < 8; i++) {
      const y = (i / 8) * s + r() * s * 0.05;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += s / 8) ctx.lineTo(x, y + Math.sin(x / s * Math.PI * 2 + i) * s * 0.02);
      ctx.stroke();
    }
  },
};

export class TextureLibrary {
  constructor(size) {
    this.size = Math.min(size, 512);
    this.cache = new Map();
  }

  get(name, variant = null) {
    const key = variant ? `${name}:${variant.join(',')}` : name;
    if (!this.cache.has(key) && MC) this.cache.set(key, pixelMaterial(name, variant, maxAniso));
    if (!this.cache.has(key)) {
      const seed = [...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
      const c = canvas(this.size, (ctx, s, r) => generators[name](ctx, s, r, variant), seed);
      this.cache.set(key, toon({ map: tex(c) }));
    }
    return this.cache.get(key);
  }

  get pixel() {
    return MC;
  }

  // Размер повтора текстуры в метрах для UV в мировых координатах (0 — разметка задаётся картой).
  tile(name) {
    return MC ? PIXEL_TILES[name] || 0 : 0;
  }

  weaponMaterials() {
    if (this.weaponCache) return this.weaponCache;
    if (MC) return (this.weaponCache = mcWeaponMaterials(1));
    const wood = this.get('wood');
    this.weaponCache = {
      steel: toon({ color: 0x7b8ea6 }),
      darkSteel: toon({ color: 0x4b5566 }),
      bright: toon({ color: 0xd3dbe5 }),
      polymer: toon({ color: 0x566072 }),
      tan: toon({ color: 0xe0b777 }),
      olive: toon({ color: 0x7c9a48 }),
      accent: toon({ color: 0xff8a1f }),
      brass: toon({ color: 0xf5c451 }),
      wood: toon({ map: wood.map }),
      glass: toon({ color: 0x5fb8ff, emissive: 0x123a66 }),
      clearGlass: new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.15, depthWrite: false }),
      redDot: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
      glowGreen: new THREE.MeshBasicMaterial({ color: 0x40ff60 }),
      rubber: toon({ color: 0x25232b }),
    };
    return this.weaponCache;
  }
}
