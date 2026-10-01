import * as THREE from 'three';

// Скины персонажей для стиля Minecraft: каждая грань коробки получает свой прямоугольник
// в маленьком атласе (64×64…128) с плотностью ≈19 текселей на метр — лицо головы ровно 8×8,
// как у Стива. Пиксели рисуются поштучно и читаются без фильтрации (NearestFilter).

export const SKIN_DENSITY = 8 / 0.42;
const FACES = ['right', 'left', 'top', 'bottom', 'back', 'front']; // порядок групп BoxGeometry
const ATLAS_W = 64;
// Руки уже 4 текселей выглядят «палками»: задаём их размеры явно, как у Minecraft (4×8).
const OVERRIDE = { upperArm: [4, 8, 4], foreArm: [4, 8, 4] };

// ---------- цвет ----------
function hex2rgb(c) {
  if (Array.isArray(c)) return c;
  const s = typeof c === 'string' ? c : `#${new THREE.Color(c).getHexString()}`;
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function sat(c, k) {
  const [r, g, b] = hex2rgb(c);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r, g, b].map((v) => l + (v - l) * k);
}
const sh = (c, k) => c.map((v) => v * k);
const mixc = (a, b, t) => { const x = hex2rgb(a); const y = hex2rgb(b); return x.map((v, i) => v + (y[i] - v) * t); };

function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- раскладка ----------
let LAYOUT = null;

function faceDims([w, h, d], face) {
  return face === 'right' || face === 'left' ? [d, h] : face === 'top' || face === 'bottom' ? [w, d] : [w, h];
}

// Полочная упаковка с полем в 1 тексель вокруг каждого прямоугольника (поле заполняется
// краевыми пикселями, чтобы на стыках граней не было швов).
function packer(y0) {
  let x = 0;
  let y = y0;
  let rowH = 0;
  return {
    add(w, h) {
      if (x + w + 2 > ATLAS_W) { x = 0; y += rowH; rowH = 0; }
      const r = [x + 1, y + 1, w, h];
      x += w + 2;
      rowH = Math.max(rowH, h + 2);
      return r;
    },
    get bottom() { return y + rowH; },
  };
}

// parts: { name: [w, h, d] (м) }, hats: { variant: { size, visor? } }.
export function initSkinLayout(parts, hats) {
  if (LAYOUT) return LAYOUT;
  const dims = {};
  for (const [k, s] of Object.entries(parts)) dims[k] = OVERRIDE[k] || s.map((v) => Math.max(1, Math.round(v * SKIN_DENSITY)));
  dims.head = [8, 8, 8];
  for (const [k, h] of Object.entries(hats)) dims[`hat:${k}`] = h.size.map((v) => Math.max(1, Math.round(v * SKIN_DENSITY)));
  const visor = Object.values(hats).find((h) => h.visor)?.visor || [0.3, 0.03, 0.16];
  dims.visor = visor.map((v) => Math.max(1, Math.round(v * SKIN_DENSITY)));

  const rects = {};
  const p = packer(0);
  const order = ['head', 'torso', 'thigh', 'shin', 'upperArm', 'foreArm', 'pack', 'visor'];
  for (const k of [...order, ...Object.keys(dims).filter((k) => !order.includes(k) && !k.startsWith('hat:'))]) {
    if (!dims[k]) continue;
    // Крупные грани первыми — плотнее упаковка.
    const faces = [...FACES].sort((a, b) => faceDims(dims[k], b)[1] - faceDims(dims[k], a)[1]);
    rects[k] = {};
    for (const f of faces) rects[k][f] = p.add(...faceDims(dims[k], f));
  }
  // Шапки делят одну область: у игрока только одна.
  const hatY = p.bottom;
  let bottom = hatY;
  for (const k of Object.keys(dims).filter((k) => k.startsWith('hat:'))) {
    const hp = packer(hatY);
    rects[k] = {};
    for (const f of ['top', 'bottom', 'front', 'back', 'right', 'left']) rects[k][f] = hp.add(...faceDims(dims[k], f));
    bottom = Math.max(bottom, hp.bottom);
  }
  const H = bottom <= 64 ? 64 : bottom <= 128 ? 128 : 256;
  LAYOUT = { dims, rects, W: ATLAS_W, H };
  return LAYOUT;
}

// ---------- геометрия ----------
const geoCache = new Map();
export function mcPartGeometry(part, size) {
  if (geoCache.has(part)) return geoCache.get(part);
  const { rects, W, H } = LAYOUT;
  const g = new THREE.BoxGeometry(...size);
  const uv = g.attributes.uv;
  const rr = rects[part];
  for (let f = 0; f < 6; f++) {
    const [x, y, w, h] = rr[FACES[f]];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = uv.getX(k);
      const v = uv.getY(k);
      uv.setXY(k, (x + u * w) / W, 1 - (y + (1 - v) * h) / H);
    }
  }
  g.clearGroups();
  geoCache.set(part, g);
  return g;
}

// ---------- пиксельная сетка грани ----------
class Grid {
  constructor(w, h, seed, amp = 0.06) {
    this.w = w;
    this.h = h;
    this.seed = seed;
    this.amp = amp;
    this.c = new Array(w * h).fill(null).map(() => [255, 0, 255]);
    this.a = new Float32Array(w * h).fill(amp);
  }

  set(x, y, c, amp = this.amp) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.c[y * this.w + x] = hex2rgb(c).slice();
    this.a[y * this.w + x] = amp;
  }

  get(x, y) {
    return this.c[Math.min(this.h - 1, Math.max(0, y)) * this.w + Math.min(this.w - 1, Math.max(0, x))];
  }

  rect(x, y, w, h, c, amp) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, typeof c === 'function' ? c(i, j) : c, amp);
  }

  fill(c, amp) { this.rect(0, 0, this.w, this.h, c, amp); }

  // Пиксель «в тон»: множитель к уже нарисованному.
  shade(x, y, k) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.c[i] = sh(this.c[i], k);
  }

  // Попиксельный шум — фактура как у майнкрафтовских скинов.
  finish() {
    for (let i = 0; i < this.c.length; i++) {
      const k = 1 + this.a[i] * (hash(i % this.w, Math.floor(i / this.w), this.seed) - 0.5) * 2;
      this.c[i] = sh(this.c[i], k);
    }
    return this;
  }
}

// ---------- палитра игрока ----------
function palette(L) {
  const vest = sat(L.vest, 0.9);
  return {
    skin: sat(L.skin, 0.82),
    hair: sat(L.hair, 0.8),
    iris: sat(L.iris, 0.85),
    shirt: sat(L.shirt, 0.75),
    pants: sat(L.pants, 0.8),
    boot: sat(L.boot, 0.8),
    glove: sat(L.glove, 0.8),
    hat: sat(L.hatColor, 0.8),
    vest,
    pack: mixc(vest, '#5c5a4a', 0.55),
    belt: hex2rgb('#3e2e25'),
    buckle: hex2rgb('#c9a43e'),
    ink: hex2rgb('#2a2026'),
    strap: hex2rgb('#2f2c33'),
    metal: hex2rgb('#9aa3ad'),
  };
}

// Волосы: две-три тональности прядями.
function hairPx(P, x, y, s) {
  const h = hash(x, Math.floor(y / 2) + x * 7, s);
  return h < 0.25 ? sh(P.hair, 0.8) : h > 0.85 ? sh(P.hair, 1.15) : P.hair;
}

// Ткань жилета с узором игрока.
function vestPx(P, L, x, y, face) {
  let c = P.vest;
  if (L.pattern === 1) {
    const b = hash(Math.floor((x + face) / 2), Math.floor(y / 2), L.seed + 31);
    if (b > 0.72) c = sh(c, 0.82);
    else if (b < 0.18) c = sh(c, 1.12);
  }
  return c;
}

// ---------- голова ----------
function headFront(g, L, P) {
  g.fill(P.skin, 0.03);
  const hp = (x, y) => hairPx(P, x, y, L.seed);
  g.rect(0, 0, 8, 2, hp, 0.05);
  g.set(0, 2, hp(0, 2));
  g.set(7, 2, hp(7, 2));
  if (L.hat === 'hair' || L.hat === 'bandana') {
    // Чёлка неровными прядями.
    for (let x = 1; x < 7; x++) if (hash(x, 2, L.seed + 5) > 0.45) g.set(x, 2, hp(x, 2));
  }
  // Брови.
  const brow = sh(P.hair, 0.7);
  const by = L.eyes === 2 || L.brows === 2 ? 2 : 3;
  if (L.brows === 1) for (const x of [2, 3, 4, 5]) g.set(x, by, sh(brow, 0.85));
  else for (const x of [1, 2, 5, 6]) g.set(x, by, brow);
  // Глаза: белок снаружи, радужка внутри — как у Стива.
  const white = [236, 236, 232];
  if (L.eyes === 1) {
    for (const x of [1, 6]) g.set(x, 4, P.iris, 0.02);
    for (const x of [2, 5]) g.set(x, 4, sh(P.iris, 0.55), 0.02);
  } else {
    for (const x of [1, 6]) g.set(x, 4, white, 0.02);
    for (const x of [2, 5]) g.set(x, 4, P.iris, 0.02);
  }
  if (L.eyes === 2) for (const x of [1, 2, 5, 6]) g.set(x, 3, sh(P.skin, 0.8), 0.02);
  // Нос и румянец.
  g.set(3, 5, sh(P.skin, 0.88), 0.02);
  g.set(4, 5, sh(P.skin, 0.88), 0.02);
  if (L.blush) for (const x of [1, 6]) g.set(x, 5, mixc(P.skin, '#e0707a', 0.35), 0.02);
  // Подбородок чуть темнее.
  for (let x = 0; x < 8; x++) g.set(x, 7, sh(P.skin, 0.93), 0.03);
  const dark = hex2rgb('#4a2a2c');
  const red = hex2rgb('#8a3036');
  switch (L.mouth) {
    case 0: // улыбка
      for (const x of [3, 4]) g.set(x, 6, dark, 0.02);
      g.set(2, 5, sh(P.skin, 0.75), 0.02);
      g.set(5, 5, sh(P.skin, 0.75), 0.02);
      break;
    case 1: // открытая улыбка с зубами
      for (const x of [2, 5]) g.set(x, 6, dark, 0.02);
      for (const x of [3, 4]) g.set(x, 6, [232, 228, 218], 0.02);
      for (const x of [3, 4]) g.set(x, 7, red, 0.02);
      break;
    case 2: // ухмылка
      for (const x of [3, 4]) g.set(x, 6, dark, 0.02);
      g.set(5, 5, dark, 0.02);
      break;
    case 3: // «о»
      g.set(3, 6, red, 0.02);
      g.set(4, 6, red, 0.02);
      break;
    default: // ровная линия
      for (const x of [2, 3, 4, 5]) g.set(x, 6, dark, 0.02);
  }
  switch (L.extra) {
    case 1: // веснушки
      for (const [x, y] of [[1, 6], [2, 5], [6, 6], [5, 5]]) if (hash(x, y, L.seed) > 0.25) g.set(x, y, sh(P.skin, 0.8), 0.02);
      break;
    case 2: // шрам
      g.set(6, 3, [190, 104, 110], 0.02);
      g.set(6, 5, [190, 104, 110], 0.02);
      break;
    case 3: // щетина
      for (let y = 5; y < 8; y++) for (let x = 1; x < 7; x++) if ((x + y) % 2 === 0 && !(y === 6 && x > 1 && x < 6)) g.set(x, y, mixc(P.skin, P.hair, 0.35), 0.03);
      break;
    case 4: // пластырь
      g.set(1, 5, [226, 200, 150], 0.02);
      g.set(2, 5, [214, 188, 140], 0.02);
      break;
    case 5: // усы
      for (const x of [2, 3, 4, 5]) g.set(x, 5, sh(P.hair, 0.9), 0.04);
      break;
    default:
  }
}

// Нарисовано для правой грани: лицо у правого края (x = 7).
function headSide(g, L, P) {
  g.fill(P.skin, 0.03);
  const hp = (x, y) => hairPx(P, x, y, L.seed + 1);
  g.rect(0, 0, 8, 2, hp, 0.05);
  g.rect(0, 2, 5, 4, hp, 0.05);
  g.rect(0, 6, 3, 1, hp, 0.05);
  g.set(5, 2, hp(5, 2));
  g.set(6, 2, sh(P.hair, 0.9));
  // Ухо.
  g.set(5, 4, sh(P.skin, 0.85), 0.02);
  g.set(5, 5, sh(P.skin, 0.78), 0.02);
  g.set(4, 4, sh(P.skin, 0.95), 0.02);
  for (let x = 0; x < 8; x++) g.shade(x, 7, 0.93);
}

function headBack(g, L, P) {
  g.fill(P.skin, 0.03);
  g.rect(0, 0, 8, 6, (x, y) => hairPx(P, x, y, L.seed + 2), 0.05);
  for (let x = 0; x < 8; x++) if (x % 3 !== 2) g.set(x, 6, hairPx(P, x, 6, L.seed + 2));
  for (let x = 0; x < 8; x++) g.set(x, 7, sh(P.skin, 0.88), 0.03);
}

function headTop(g, L, P) {
  g.fill((x, y) => hairPx(P, x, y, L.seed + 3), 0.06);
  g.set(3, 3, sh(P.hair, 1.15));
  g.set(4, 2, sh(P.hair, 1.15));
}

// ---------- шапки ----------
function paintHat(face, g, L, P) {
  const c = P.hat;
  const v = L.hat;
  const { w, h } = g;
  if (face === 'bottom') { g.fill(sh(c, 0.5)); return; }
  if (v === 'helmet') {
    g.fill(c, 0.08);
    if (face === 'top') {
      for (let y = 0; y < h; y++) g.set(Math.floor(w / 2), y, sh(c, 0.85));
      g.rect(2, 2, 2, 2, sh(c, 1.15));
      return;
    }
    for (let x = 0; x < w; x++) {
      g.set(x, 0, sh(c, 1.15));
      g.set(x, h - 1, x % 2 ? sh(c, 0.68) : sh(c, 0.85));
      if (h > 2) g.set(x, h - 2, P.strap, 0.04);
    }
    if (face === 'front' && h > 2) {
      // Очки на ремне.
      const y = h - 2;
      const lens = [111, 176, 210];
      const cx = Math.floor(w / 2);
      for (const x0 of [cx - 3, cx + 1]) {
        g.set(x0, y, lens, 0.02);
        g.set(x0 + 1, y, sh(lens, 0.8), 0.02);
      }
      g.set(cx - 3, y, [210, 238, 250], 0.02);
      g.set(cx + 1, y, [210, 238, 250], 0.02);
      g.set(cx, y, [58, 63, 77]);
    }
    if (face === 'back') g.set(Math.floor(w / 2), 0, sh(c, 1.35));
    return;
  }
  if (v === 'cap') {
    g.fill(c, 0.06);
    if (face === 'top') {
      const m = Math.floor(w / 2);
      for (let i = 0; i < w; i++) { g.shade(m, i, 0.88); g.shade(i, m, 0.88); }
      g.set(m, m, sh(c, 0.7));
      return;
    }
    for (let x = 0; x < w; x++) g.set(x, h - 1, sh(c, 0.78));
    const m = Math.floor(w / 2);
    if (face === 'front') { g.set(m, 0, [236, 232, 220], 0.02); g.set(m - 1, 0, sh(c, 1.15)); g.set(m + 1, 0, sh(c, 1.15)); }
    if (face === 'back') { g.set(m, h - 1, sh(c, 0.45)); g.set(m - 1, h - 1, [210, 205, 190]); }
    return;
  }
  if (v === 'beanie') {
    if (face === 'top') {
      g.fill((x, y) => sh(c, (Math.max(Math.abs(x - (w - 1) / 2), Math.abs(y - (h - 1) / 2)) | 0) % 2 ? 0.86 : 1), 0.05);
      const m = Math.floor(w / 2);
      g.rect(m - 1, m - 1, 3, 3, mixc(c, '#ffffff', 0.5), 0.06);
      return;
    }
    g.fill((x) => sh(c, x % 2 ? 0.86 : 1), 0.05);
    for (let x = 0; x < w; x++) {
      g.set(x, h - 1, sh(c, x % 2 ? 0.62 : 0.72));
      if (h > 2) g.set(x, h - 2, mixc(c, '#ffffff', x % 2 ? 0.32 : 0.42));
    }
    return;
  }
  if (v === 'bandana') {
    if (face === 'top') {
      g.fill((x, y) => hairPx(P, x, y, L.seed + 4), 0.06);
      for (let i = 0; i < Math.max(w, h); i++) { g.set(i, 0, c); g.set(i, h - 1, c); g.set(0, i, c); g.set(w - 1, i, c); }
      return;
    }
    g.fill((x, y) => (hash(x, y, L.seed + 9 + face.length) > 0.72 ? mixc(c, '#ffffff', 0.7) : c), 0.05);
    for (let x = 0; x < w; x++) g.shade(x, h - 1, 0.8);
    if (face === 'back') { g.set(Math.floor(w / 2), h - 1, sh(c, 0.6)); g.set(Math.floor(w / 2) - 1, h - 1, sh(c, 0.7)); }
    return;
  }
  // Причёска-«блок».
  g.fill((x, y) => hairPx(P, x, y, L.seed + 6), 0.06);
  if (face !== 'top') {
    for (let x = 0; x < w; x++) g.set(x, 0, sh(P.hair, 1.12));
    if (face === 'front') for (let x = 0; x < w; x++) if (hash(x, 9, L.seed) > 0.6) g.shade(x, h - 1, 0.82);
  } else {
    g.set(2, 2, sh(P.hair, 1.18));
    g.set(3, 2, sh(P.hair, 1.12));
  }
}

function paintVisor(face, g, L, P) {
  g.fill(sh(P.hat, face === 'bottom' ? 0.55 : 0.78), 0.05);
  if (face === 'top') for (let x = 0; x < g.w; x++) g.set(x, 0, sh(P.hat, 0.9));
}

// ---------- тело ----------
function beltRows(g, P, y, buckle) {
  for (let x = 0; x < g.w; x++) g.set(x, y, x % 3 === 1 ? sh(P.belt, 1.15) : P.belt, 0.05);
  if (buckle) {
    const m = Math.floor(g.w / 2);
    g.set(m - 1, y, P.buckle, 0.04);
    g.set(m, y, sh(P.buckle, 0.8), 0.04);
  }
  for (let yy = y + 1; yy < g.h; yy++) for (let x = 0; x < g.w; x++) g.set(x, yy, sh(P.pants, 0.92));
}

function paintTorso(face, g, L, P) {
  const { w, h } = g;
  const belt = h - 2;
  const fi = FACES.indexOf(face) * 3;
  if (face === 'bottom') { g.fill(P.pants); return; }
  if (face === 'top') {
    // Перед вверху картинки: ворот майки посередине, лямки жилета по бокам.
    g.fill(P.shirt);
    g.rect(0, 0, 3, h, (x, y) => vestPx(P, L, x, y, fi));
    g.rect(w - 3, 0, 3, h, (x, y) => vestPx(P, L, x, y, fi));
    for (let x = 0; x < w; x++) if (x < 3 || x >= w - 3) g.shade(x, 0, 1.08);
    g.rect(3, 1, w - 6, h - 2, sh(P.shirt, 0.6));
    return;
  }
  g.fill((x, y) => vestPx(P, L, x, y, fi));
  if (L.pattern === 2) for (let x = 0; x < w; x++) g.set(x, Math.floor(h * 0.55), mixc(P.vest, '#ffffff', 0.25));
  // Объём: светлая кромка сверху, тёмная у пояса.
  for (let x = 0; x < w; x++) { g.shade(x, 0, 1.1); g.shade(x, belt - 1, 0.86); }
  if (face === 'front') {
    const m = Math.floor(w / 2);
    // Ворот майки V-образно.
    for (let x = m - 2; x <= m + 1; x++) g.set(x, 0, P.shirt);
    g.set(m - 1, 1, P.shirt);
    g.set(m, 1, P.shirt);
    g.set(m - 2, 1, sh(P.vest, 0.7));
    g.set(m + 1, 1, sh(P.vest, 0.7));
    // Молния.
    for (let y = 2; y < belt; y++) g.set(m - 1 + (y % 2), y, sh(P.vest, 0.62));
    g.set(m, 2, P.metal);
    // Нагрудные карманы с клапанами.
    for (const x0 of [1, w - 3]) {
      g.set(x0, 3, sh(P.vest, 0.72));
      g.set(x0 + 1, 3, sh(P.vest, 0.72));
      g.set(x0, 4, sh(P.vest, 0.86));
      g.set(x0 + 1, 4, sh(P.vest, 0.86));
    }
    g.set(w - 2, 1, [236, 232, 220], 0.02); // шеврон
    // Подсумки.
    for (const x0 of [1, w - 3]) {
      for (let x = x0; x < x0 + 2; x++) {
        g.set(x, belt - 3, sh(P.vest, 0.68));
        g.set(x, belt - 2, sh(P.vest, 0.8));
      }
    }
    beltRows(g, P, belt, true);
    return;
  }
  if (face === 'back') {
    const m = Math.floor(w / 2);
    for (let x = m - 2; x <= m + 1; x++) g.set(x, 0, P.shirt);
    for (let x = 1; x < w - 1; x += 2) g.set(x, 1, sh(P.vest, 1.15));
    beltRows(g, P, belt, false);
    return;
  }
  // Бока: пройма майки сверху, регулировочные ремни.
  g.rect(0, 0, w, 2, P.shirt);
  const sy = Math.floor(h * 0.5);
  for (let x = 0; x < w; x++) g.set(x, sy, sh(P.vest, 0.55), 0.04);
  g.set(Math.floor(w / 2), sy, sh(P.metal, 0.85), 0.03);
  beltRows(g, P, belt, false);
}

function paintPack(face, g, L, P) {
  const c = P.pack;
  const { w, h } = g;
  g.fill(c, 0.07);
  if (face === 'front') return;
  if (face === 'bottom') { g.fill(sh(c, 0.7)); return; }
  for (let x = 0; x < w; x++) { g.shade(x, 0, 1.12); g.shade(x, h - 1, 0.78); }
  if (face === 'back') {
    // Клапан, ремень с пряжкой и накладной карман.
    for (let x = 0; x < w; x++) { g.set(x, 1, sh(c, 0.85)); g.set(x, 2, sh(c, 0.68)); }
    const m = Math.floor(w / 2);
    for (let y = 0; y < 4; y++) { g.set(m - 1, y, sh(c, 0.6)); g.set(m, y, sh(c, 0.6)); }
    g.set(m - 1, 3, P.metal);
    g.set(m, 3, sh(P.metal, 0.8));
    for (let x = 1; x < w - 1; x++) { g.set(x, h - 3, sh(c, 1.12)); g.set(x, h - 2, sh(c, 0.88)); }
  } else if (face === 'top') {
    g.set(Math.floor(w / 2) - 1, Math.floor(h / 2), sh(c, 0.55));
    g.set(Math.floor(w / 2), Math.floor(h / 2), sh(c, 0.55));
  }
}

function paintUpperArm(face, g, L, P) {
  const { w, h } = g;
  const sleeve = L.longSleeves ? h : Math.ceil(h / 2);
  if (face === 'top') { g.fill(P.shirt); return; }
  if (face === 'bottom') { g.fill(L.longSleeves ? P.shirt : P.skin, 0.03); return; }
  g.fill(P.skin, 0.03);
  g.rect(0, 0, w, sleeve, P.shirt, 0.06);
  for (let x = 0; x < w; x++) g.shade(x, 0, 1.1);
  if (!L.longSleeves) for (let x = 0; x < w; x++) g.set(x, sleeve - 1, sh(P.shirt, 0.8));
  else for (let x = 0; x < w; x++) if ((x + 1) % 3) g.shade(x, Math.floor(h * 0.65), 0.84);
  if (face === 'right' || face === 'left') {
    // Нашивка цвета игрока на плече.
    g.rect(1, 1, w - 2, 2, P.vest, 0.04);
    g.set(Math.floor(w / 2), 1, mixc(P.vest, '#ffffff', 0.6), 0.02);
  }
}

function paintForeArm(face, g, L, P) {
  const { w, h } = g;
  const glove0 = h - 3;
  if (face === 'top') { g.fill(L.longSleeves ? P.shirt : P.skin); return; }
  if (face === 'bottom') {
    g.fill(P.glove, 0.06);
    g.rect(1, 1, w - 2, h - 2, sh(P.glove, 1.12));
    return;
  }
  g.fill(L.longSleeves ? P.shirt : P.skin, L.longSleeves ? 0.06 : 0.03);
  if (L.longSleeves) {
    // Манжета и полоска запястья.
    for (let x = 0; x < w; x++) { g.set(x, glove0 - 2, sh(P.shirt, 0.8)); g.set(x, glove0 - 1, P.skin, 0.03); }
  }
  g.rect(0, glove0, w, 3, P.glove, 0.06);
  for (let x = 0; x < w; x++) { g.set(x, glove0, sh(P.glove, 1.25)); g.shade(x, h - 1, 0.75); }
  if (face === 'front') for (let x = 0; x < w; x += 2) g.set(x, glove0 + 1, sh(P.glove, 1.2));
  if (face === 'back') g.set(Math.floor(w / 2), glove0 + 1, sh(P.glove, 1.15));
}

function paintThigh(face, g, L, P) {
  const p = P.pants;
  const { w, h } = g;
  g.fill(p, 0.06);
  if (face === 'top' || face === 'bottom') return;
  for (let x = 0; x < w; x++) g.shade(x, 0, 0.8);
  if (face === 'front') {
    for (let y = 1; y < h; y += 1) g.shade(Math.floor(w / 2), y, 1.08);
  } else if (face === 'back') {
    g.rect(1, 1, w - 2, 2, sh(p, 0.85));
    for (let x = 1; x < w - 1; x++) g.set(x, 1, sh(p, 0.72));
  } else {
    // Накладной карман-«карго» с клапаном и пуговицей.
    const y0 = Math.floor(h * 0.38);
    g.rect(1, y0, w - 2, 3, sh(p, 0.9));
    for (let x = 1; x < w - 1; x++) g.set(x, y0, sh(p, 0.72));
    g.set(Math.floor(w / 2), y0 + 1, sh(p, 0.55));
  }
}

function paintShin(face, g, L, P) {
  const p = P.pants;
  const b = P.boot;
  const { w, h } = g;
  const sole = [38, 35, 42];
  if (face === 'bottom') {
    g.fill(sole, 0.06);
    for (let y = 1; y < h; y += 2) for (let x = 1; x < w - 1; x++) g.set(x, y, [56, 52, 61]);
    return;
  }
  g.fill(p, 0.06);
  if (face === 'top') return;
  const b0 = h - 3;
  g.rect(0, b0, w, 3, b, 0.07);
  for (let x = 0; x < w; x++) {
    g.set(x, b0, sh(b, 1.2));
    g.set(x, h - 1, sole, 0.05);
    g.shade(x, b0 - 1, 0.85);
  }
  if (face === 'front') {
    // Наколенник и шнуровка.
    g.rect(1, 0, w - 2, 2, [58, 57, 64], 0.06);
    for (let x = 1; x < w - 1; x++) g.set(x, 0, [84, 83, 92]);
    const m = Math.floor(w / 2);
    g.set(m, b0 + 1, mixc(b, '#d8ccb4', 0.45), 0.03);
    g.set(m - 1, b0 + 1, sh(b, 0.75));
    g.set(m + 1, b0 + 1, sh(b, 0.75));
  } else if (face === 'back') {
    g.set(Math.floor(w / 2), b0 + 1, sh(b, 0.7));
  }
}

const BODY_PAINTERS = { torso: paintTorso, pack: paintPack, upperArm: paintUpperArm, foreArm: paintForeArm, thigh: paintThigh, shin: paintShin };

// ---------- сборка атласа ----------
function blit(img, W, rect, grid, mirror = false) {
  const [x0, y0, w, h] = rect;
  // С полем в 1 тексель: краевые пиксели копируются наружу.
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      let sx = Math.min(w - 1, Math.max(0, x));
      const sy = Math.min(h - 1, Math.max(0, y));
      if (mirror) sx = w - 1 - sx;
      const c = grid.c[sy * w + sx];
      const i = ((y0 + y) * W + (x0 + x)) * 4;
      img.data[i] = Math.max(0, Math.min(255, Math.round(c[0])));
      img.data[i + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
      img.data[i + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
      img.data[i + 3] = 255;
    }
  }
}

export function mcSkinTexture(L) {
  const { rects, W, H } = LAYOUT;
  const P = palette(L);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  let seed = L.seed & 0xffff;
  const face = (rect, fn, mirror, amp) => {
    const g = new Grid(rect[2], rect[3], seed++, amp);
    fn(g);
    blit(img, W, rect, g.finish(), mirror);
  };
  const R = rects.head;
  face(R.front, (g) => headFront(g, L, P));
  face(R.right, (g) => headSide(g, L, P));
  face(R.left, (g) => headSide(g, L, P), true);
  face(R.back, (g) => headBack(g, L, P));
  face(R.top, (g) => headTop(g, L, P));
  face(R.bottom, (g) => g.fill(sh(P.skin, 0.72), 0.03));
  const hat = rects[`hat:${L.hat}`];
  if (hat) for (const f of FACES) face(hat[f], (g) => paintHat(f, g, L, P), f === 'left');
  for (const f of FACES) face(rects.visor[f], (g) => paintVisor(f, g, L, P));
  for (const [part, fn] of Object.entries(BODY_PAINTERS)) {
    if (!rects[part]) continue;
    for (const f of FACES) face(rects[part][f], (g) => fn(f, g, L, P), f === 'left');
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  // Мип-уровни как у карт: поля в 1 тексель хватает, чтобы вдали грани не смешивались заметно.
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  return t;
}
