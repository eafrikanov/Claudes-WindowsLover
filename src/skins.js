import * as THREE from 'three';
import { rng } from './textures.js';
import { MC, pixelSkin } from './style-mc.js';
import { initSkinLayout, mcPartGeometry, mcSkinTexture } from './mc-skin.js';

// Кубический персонаж в духе Pixel Gun: каждая деталь — коробка, грани которой ссылаются
// на прямоугольники в двух атласах (голова 512² и тело 512²). Раскладка атласов общая для всех
// игроков, поэтому геометрия кэшируется на уровне модуля, а у каждого игрока своя текстура.

export const ATLAS = 512;
const INK = '#231c2a';
const FACES = ['right', 'left', 'top', 'bottom', 'back', 'front']; // порядок групп BoxGeometry: +X −X +Y −Y +Z −Z

export function hashName(s) {
  let h = 2166136261;
  for (const ch of String(s || 'player')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- цвет (в sRGB, без управления цветом) ----------
function rgb(c) {
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const h = new THREE.Color(c).getHexString();
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}
function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * t));
}
const dark = (c, t) => mix(c, '#1a1028', t);
const light = (c, t) => mix(c, '#ffffff', t);
function lum(c) {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ---------- раскладка атласов ----------
// Размеры коробок (ш × в × г, метры). Модель смотрит в −Z, правая сторона персонажа — +X.
export const PARTS = {
  head: [0.42, 0.42, 0.42],
  torso: [0.5, 0.6, 0.28],
  pack: [0.34, 0.38, 0.12],
  upperArm: [0.18, 0.41, 0.18],
  foreArm: [0.17, 0.43, 0.17],
  thigh: [0.24, 0.4, 0.25],
  shin: [0.24, 0.39, 0.25],
};
export const HATS = {
  helmet: { size: [0.47, 0.17, 0.47], lift: 0.035 },
  cap: { size: [0.45, 0.12, 0.45], lift: 0.025, visor: [0.3, 0.03, 0.16] },
  beanie: { size: [0.45, 0.17, 0.45], lift: 0.03 },
  hair: { size: [0.445, 0.11, 0.445], lift: 0.03 },
  bandana: { size: [0.44, 0.1, 0.44], lift: 0.012 },
};

// Атлас головы — вручную: лицо получает 252² пикселей.
const HEAD_RECTS = {
  head: {
    front: [2, 2, 252, 252], right: [258, 2, 124, 124], left: [386, 2, 124, 124],
    back: [258, 130, 124, 124], top: [386, 130, 124, 124], bottom: [2, 258, 60, 60],
  },
  hat: {
    top: [66, 258, 60, 60], bottom: [130, 258, 60, 60],
    front: [2, 322, 252, 82], back: [258, 322, 252, 82], right: [2, 408, 252, 82], left: [258, 408, 252, 82],
  },
  visor: Object.fromEntries(FACES.map((f) => [f, [194, 258, 60, 60]])),
};

// Атлас тела — полочная упаковка при максимальной плотности, которая влезает в 512².
const HIDDEN = { torso: ['bottom'], pack: ['front'], foreArm: ['top'], thigh: ['top'], shin: ['top'] };
function faceSize(part, face, dens) {
  const [w, h, d] = PARTS[part];
  if (HIDDEN[part]?.includes(face)) return [12, 12];
  const [a, b] = face === 'right' || face === 'left' ? [d, h] : face === 'top' || face === 'bottom' ? [w, d] : [w, h];
  return [Math.round(a * dens), Math.round(b * dens)];
}
function packBody() {
  const parts = ['torso', 'pack', 'upperArm', 'foreArm', 'thigh', 'shin'];
  for (let dens = 360; dens > 120; dens -= 5) {
    const items = [];
    for (const p of parts) for (const f of FACES) items.push({ p, f, s: faceSize(p, f, dens) });
    items.sort((a, b) => b.s[1] - a.s[1] || b.s[0] - a.s[0]);
    const out = {};
    let x = 2;
    let y = 2;
    let rowH = 0;
    let ok = true;
    for (const it of items) {
      const [w, h] = it.s;
      if (x + w > ATLAS - 2) { x = 2; y += rowH + 4; rowH = 0; }
      if (y + h > ATLAS - 2) { ok = false; break; }
      (out[it.p] ||= {})[it.f] = [x, y, w, h];
      x += w + 4;
      rowH = Math.max(rowH, h);
    }
    if (ok) return { rects: out, dens };
  }
  throw new Error('body atlas overflow');
}
const BODY = packBody();
export const BODY_DENSITY = BODY.dens;

// ---------- геометрия ----------
const geoCache = new Map();
function skinnedBox(key, size, rects) {
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.BoxGeometry(...size);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [x, y, w, h] = rects[FACES[f]];
    const x0 = x + 0.5;
    const y0 = y + 0.5;
    const rw = w - 1;
    const rh = h - 1;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = uv.getX(k);
      const v = uv.getY(k);
      uv.setXY(k, (x0 + u * rw) / ATLAS, 1 - (y0 + (1 - v) * rh) / ATLAS);
    }
  }
  g.clearGroups();
  geoCache.set(key, g);
  return g;
}

export function partGeometry(part) {
  if (MC) {
    initSkinLayout(PARTS, HATS);
    const size = part.startsWith('hat:') ? HATS[part.slice(4)].size : part === 'visor' ? HATS.cap.visor : PARTS[part];
    return mcPartGeometry(part, size);
  }
  if (part === 'head') return skinnedBox('head', PARTS.head, HEAD_RECTS.head);
  if (part.startsWith('hat:')) {
    const v = part.slice(4);
    return skinnedBox(part, HATS[v].size, HEAD_RECTS.hat);
  }
  if (part === 'visor') return skinnedBox('visor', HATS.cap.visor, HEAD_RECTS.visor);
  return skinnedBox(part, PARTS[part], BODY.rects[part]);
}

// Оболочка контура для коробки: нормали в каждой вершине смотрят по диагонали угла, поэтому
// шейдер контура раздувает коробку равномерно (на t/√3 по каждой оси) без разрывов на рёбрах.
const outlineCache = new WeakMap();
export function outlineGeometry(geo) {
  if (!outlineCache.has(geo)) {
    const g = new THREE.BufferGeometry();
    g.setIndex(geo.index);
    g.setAttribute('position', geo.attributes.position);
    const p = geo.attributes.position;
    const n = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      n[i * 3] = Math.sign(p.getX(i));
      n[i * 3 + 1] = Math.sign(p.getY(i));
      n[i * 3 + 2] = Math.sign(p.getZ(i));
    }
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.boundingSphere = null;
    outlineCache.set(geo, g);
  }
  return outlineCache.get(geo);
}

// ---------- внешность ----------
const SKIN = ['#ffd9bd', '#f7c49b', '#eab184', '#d39466', '#b0744b', '#8a5636'];
const HAIR = ['#2b2129', '#47301f', '#6e4424', '#b9782f', '#e7c25a', '#b8432f', '#59606e', '#ece6da'];
const IRIS = ['#3f86e0', '#7a4b26', '#33a165', '#4d5c78', '#8a5ad1', '#2e9fb0'];
const SHIRT = ['#ece6d6', '#3b404d', '#76845a', '#d9cfae', '#4d5d78', '#8f3f3f'];
const PANTS = ['#3c4352', '#59613c', '#2c3a57', '#6b5a43', '#4a4e57', '#33333b', '#7a6a50'];
const BOOT = ['#3b2b22', '#27262d', '#5e4330', '#4b4038'];
const GLOVE = ['#2c2a31', '#4b3b2e', '#3f4a3a', '#2f3446'];
const HATS_LIST = ['helmet', 'cap', 'beanie', 'hair', 'bandana', 'helmet', 'hair'];
const HAT_COLORS = ['#6f7d4a', '#c9ad7a', '#59636f', '#3d4a3a', '#a33b2e', '#e1a73b', '#2f8a8a', '#e8e3d8'];

export function makeLook(name, color) {
  const r = rng(hashName(name));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const vest = hex(rgb(color));
  const look = {
    vest,
    skin: pick(SKIN), hair: pick(HAIR), iris: pick(IRIS), shirt: pick(SHIRT), pants: pick(PANTS),
    boot: pick(BOOT), glove: pick(GLOVE), hat: pick(HATS_LIST), hatColor: pick(HAT_COLORS),
    eyes: Math.floor(r() * 3), brows: Math.floor(r() * 3), mouth: Math.floor(r() * 5), extra: Math.floor(r() * 7),
    longSleeves: r() < 0.45, pattern: Math.floor(r() * 3), blush: r() < 0.55, seed: Math.floor(r() * 1e9),
  };
  if (look.hat === 'cap' || look.hat === 'bandana') look.hatColor = r() < 0.5 ? vest : look.hatColor;
  // Майка не должна сливаться с жилетом.
  if (Math.abs(lum(look.shirt) - lum(vest)) < 0.12) look.shirt = lum(vest) > 0.5 ? '#3b404d' : '#ece6d6';
  return look;
}

// ---------- примитивы рисования ----------
function rr(ctx, x, y, w, h, r, fill, stroke, lw = 3) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function ell(ctx, x, y, rx, ry, fill, stroke, lw = 3) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function line(ctx, pts, stroke, lw) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}
function stitches(ctx, x0, y0, x1, y1, color, lw, dash) {
  ctx.save();
  ctx.setLineDash([dash, dash * 0.8]);
  line(ctx, [x0, y0, x1, y1], color, lw);
  ctx.restore();
}
// Мягкие полосы света/тени по краям грани — объём без градиентной «мыльности».
function bevel(ctx, w, h, base, k = 1) {
  const t = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  ctx.fillStyle = light(base, 0.18 * k);
  ctx.fillRect(0, 0, w, t);
  ctx.fillStyle = dark(base, 0.16 * k);
  ctx.fillRect(0, h - t, w, t);
}
function star(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

// ---------- голова ----------
function paintHeadFront(ctx, w, h, L) {
  const s = w / 252;
  ctx.fillStyle = L.skin;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark(L.skin, 0.12);
  ctx.fillRect(0, h * 0.94, w, h * 0.06);
  // Волосы под шапкой и бакенбарды.
  ctx.fillStyle = L.hair;
  ctx.fillRect(0, 0, w, h * 0.3);
  ctx.fillRect(0, 0, w * 0.075, h * 0.5);
  ctx.fillRect(w * 0.925, 0, w * 0.075, h * 0.5);
  if (L.hat === 'hair' || L.hat === 'bandana') {
    // Чёлка зубцами.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      ctx.lineTo(x, h * (0.27 + ((i * 37 + L.seed) % 5) * 0.012));
      if (i < n) ctx.lineTo(x + w / n / 2, h * (0.33 + ((i * 53 + L.seed) % 3) * 0.025));
    }
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = dark(L.hair, 0.35);
    ctx.lineWidth = 3 * s;
    ctx.stroke();
  }
  const ey = h * 0.52;
  const ex = w * 0.29;
  const ew = 54 * s;
  const eh = 62 * s;
  // Румянец.
  if (L.blush) {
    ctx.fillStyle = 'rgba(255,105,110,0.32)';
    ell(ctx, w * 0.17, h * 0.72, 22 * s, 11 * s, 'rgba(255,105,110,0.32)');
    ell(ctx, w * 0.83, h * 0.72, 22 * s, 11 * s, 'rgba(255,105,110,0.32)');
  }
  for (const side of [-1, 1]) eye(ctx, w / 2 + side * (w / 2 - ex), ey, ew, eh, side, L, s);
  // Брови.
  ctx.lineCap = 'round';
  const bc = dark(L.hair, 0.25);
  for (const side of [-1, 1]) {
    const cx = w / 2 + side * (w / 2 - ex);
    const by = ey - eh * 0.72;
    const inner = cx - side * ew * 0.42;
    const outer = cx + side * ew * 0.48;
    const tilt = [0, 9, -6][L.brows] * s;
    ctx.beginPath();
    ctx.moveTo(inner, by + tilt);
    ctx.quadraticCurveTo(cx, by - 6 * s - (L.brows === 2 ? 4 * s : 0), outer, by + (L.brows === 1 ? -3 * s : 2 * s));
    ctx.strokeStyle = bc;
    ctx.lineWidth = 12 * s;
    ctx.stroke();
  }
  // Нос.
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.7, 7 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = dark(L.skin, 0.3);
  ctx.lineWidth = 4 * s;
  ctx.stroke();
  mouth(ctx, w / 2, h * 0.82, s, L);
  extra(ctx, w, h, s, L);
  ctx.lineCap = 'butt';
}

function eye(ctx, cx, cy, ew, eh, side, L, s) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, ew / 2, eh / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  // Радужка смотрит чуть внутрь — взгляд «собран».
  const ix = cx - side * ew * 0.08;
  const iy = cy + eh * 0.06;
  ell(ctx, ix, iy, ew * 0.3, eh * 0.34, L.iris);
  ell(ctx, ix, iy + eh * 0.1, ew * 0.3, eh * 0.2, dark(L.iris, 0.25));
  ell(ctx, ix, iy, ew * 0.15, eh * 0.18, INK);
  ell(ctx, ix - ew * 0.1, iy - eh * 0.13, ew * 0.11, eh * 0.1, '#ffffff');
  ell(ctx, ix + ew * 0.1, iy + eh * 0.12, ew * 0.05, eh * 0.045, '#ffffff');
  // Веки разных характеров.
  if (L.eyes === 1) {
    ctx.beginPath();
    ctx.moveTo(cx - ew, cy - eh);
    ctx.lineTo(cx + ew, cy - eh);
    ctx.lineTo(cx + side * ew * 0.6, cy - eh * 0.42);
    ctx.lineTo(cx - side * ew * 0.6, cy - eh * 0.12);
    ctx.closePath();
    ctx.fillStyle = L.skin;
    ctx.fill();
    line(ctx, [cx - side * ew * 0.6, cy - eh * 0.12, cx + side * ew * 0.6, cy - eh * 0.42], INK, 6 * s);
  } else if (L.eyes === 2) {
    ctx.fillStyle = dark(L.skin, 0.08);
    ctx.fillRect(cx - ew, cy - eh, ew * 2, eh * 0.78);
    line(ctx, [cx - ew, cy - eh * 0.22, cx + ew, cy - eh * 0.22], INK, 6 * s);
  }
  ctx.restore();
  ell(ctx, cx, cy, ew / 2, eh / 2, null, INK, 5 * s);
}

function mouth(ctx, x, y, s, L) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const red = '#8c2a33';
  switch (L.mouth) {
    case 0:
      ctx.beginPath();
      ctx.arc(x, y - 10 * s, 16 * s, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5 * s;
      ctx.stroke();
      break;
    case 1:
      ctx.beginPath();
      ctx.moveTo(x - 19 * s, y - 6 * s);
      ctx.lineTo(x + 19 * s, y - 6 * s);
      ctx.quadraticCurveTo(x + 17 * s, y + 14 * s, x, y + 14 * s);
      ctx.quadraticCurveTo(x - 17 * s, y + 14 * s, x - 19 * s, y - 6 * s);
      ctx.fillStyle = red;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 20 * s, y - 7 * s, 40 * s, 7 * s);
      ell(ctx, x, y + 14 * s, 10 * s, 6 * s, '#e5636b');
      ctx.restore();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4.5 * s;
      ctx.stroke();
      break;
    case 2:
      ctx.beginPath();
      ctx.moveTo(x - 14 * s, y + 1 * s);
      ctx.quadraticCurveTo(x + 4 * s, y + 6 * s, x + 17 * s, y - 6 * s);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5 * s;
      ctx.stroke();
      break;
    case 3:
      ell(ctx, x, y, 8 * s, 9 * s, red, INK, 4.5 * s);
      break;
    default:
      line(ctx, [x - 14 * s, y, x + 14 * s, y - 1 * s], INK, 5 * s);
      line(ctx, [x + 14 * s, y - 1 * s, x + 18 * s, y - 4 * s], INK, 4 * s);
  }
}

function extra(ctx, w, h, s, L) {
  const r = rng(L.seed);
  switch (L.extra) {
    case 1: // веснушки
      for (let i = 0; i < 14; i++) {
        const side = i % 2 ? 1 : -1;
        ell(ctx, w / 2 + side * (w * 0.2 + r() * w * 0.12), h * (0.66 + r() * 0.08), 2.4 * s, 2.4 * s, dark(L.skin, 0.28));
      }
      break;
    case 2: // шрам через бровь
      line(ctx, [w * 0.66, h * 0.33, w * 0.78, h * 0.66], '#c4626a', 5 * s);
      for (let i = 0; i < 3; i++) {
        const t = 0.25 + i * 0.25;
        const px = w * (0.66 + 0.12 * t);
        const py = h * (0.33 + 0.33 * t);
        line(ctx, [px - 6 * s, py + 2 * s, px + 6 * s, py - 2 * s], '#c4626a', 3 * s);
      }
      break;
    case 3: // щетина
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = L.hair === '#ece6da' ? '#59606e' : L.hair;
      ctx.beginPath();
      ctx.roundRect(w * 0.12, h * 0.74, w * 0.76, h * 0.26, 18 * s);
      ctx.fill();
      ctx.restore();
      break;
    case 4: // пластырь
      ctx.save();
      ctx.translate(w * 0.2, h * 0.73);
      ctx.rotate(-0.5);
      rr(ctx, -15 * s, -6 * s, 30 * s, 12 * s, 4 * s, '#f2d3a0', dark('#f2d3a0', 0.4), 2.5 * s);
      line(ctx, [-5 * s, -6 * s, -5 * s, 6 * s], dark('#f2d3a0', 0.25), 2 * s);
      line(ctx, [5 * s, -6 * s, 5 * s, 6 * s], dark('#f2d3a0', 0.25), 2 * s);
      ctx.restore();
      break;
    case 5: // усы
      ctx.fillStyle = dark(L.hair, 0.1);
      ctx.beginPath();
      ctx.ellipse(w / 2 - 11 * s, h * 0.765, 13 * s, 5.5 * s, 0.2, 0, Math.PI * 2);
      ctx.ellipse(w / 2 + 11 * s, h * 0.765, 13 * s, 5.5 * s, -0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
  }
}

function paintHeadSide(ctx, w, h, L) {
  // Нарисовано для правой грани: перед головы у правого края.
  ctx.fillStyle = L.skin;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark(L.skin, 0.12);
  ctx.fillRect(0, h * 0.94, w, h * 0.06);
  ctx.fillStyle = L.hair;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h * 0.42);
  ctx.lineTo(w * 0.86, h * 0.42);
  ctx.lineTo(w * 0.8, h * 0.62);
  ctx.lineTo(w * 0.72, h * 0.42);
  ctx.lineTo(w * 0.42, h * 0.42);
  ctx.lineTo(w * 0.36, h * 0.72);
  ctx.lineTo(0, h * 0.78);
  ctx.closePath();
  ctx.fill();
  // Ухо.
  rr(ctx, w * 0.44, h * 0.48, w * 0.17, h * 0.22, w * 0.06, dark(L.skin, 0.06), dark(L.skin, 0.35), 2.5);
  rr(ctx, w * 0.49, h * 0.53, w * 0.07, h * 0.12, w * 0.03, dark(L.skin, 0.22));
}

function paintHeadBack(ctx, w, h, L) {
  ctx.fillStyle = L.hair;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = L.skin;
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
  ctx.fillStyle = L.hair;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  for (let i = 0; i <= 6; i++) ctx.lineTo((i / 6) * w, h * (i % 2 ? 0.88 : 0.8));
  ctx.lineTo(w, h * 0.78);
  ctx.fill();
  ctx.strokeStyle = dark(L.hair, 0.3);
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 5; i++) line(ctx, [w * (0.15 + i * 0.18), h * 0.15, w * (0.1 + i * 0.18), h * 0.6], dark(L.hair, 0.22), 2.5);
}

function paintHeadTop(ctx, w, h, L) {
  ctx.fillStyle = L.hair;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = light(L.hair, 0.18);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.45, w * 0.3, h * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- шапки ----------
function paintHat(face, ctx, w, h, L) {
  const c = L.hatColor;
  const v = L.hat;
  if (face === 'bottom') {
    ctx.fillStyle = dark(c, 0.55);
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (v === 'helmet') {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, w, h);
    if (face === 'top') {
      ell(ctx, w * 0.42, h * 0.4, w * 0.22, h * 0.14, light(c, 0.25));
      rr(ctx, w * 0.44, 0, w * 0.12, h, 2, dark(c, 0.15));
      return;
    }
    ctx.fillStyle = light(c, 0.2);
    ctx.fillRect(0, 0, w, h * 0.14);
    ctx.fillStyle = dark(c, 0.3);
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    for (let i = 0; i < 5; i++) ell(ctx, w * (0.1 + i * 0.2), h * 0.89, 3.2, 3.2, light(c, 0.35), dark(c, 0.5), 1.5);
    // Ремень очков по кругу и сами очки спереди.
    ctx.fillStyle = '#2a2830';
    ctx.fillRect(0, h * 0.4, w, h * 0.2);
    if (face === 'front') {
      for (const x of [0.3, 0.7]) {
        rr(ctx, w * x - w * 0.15, h * 0.18, w * 0.3, h * 0.56, h * 0.18, '#3a3f4d', INK, 3);
        rr(ctx, w * x - w * 0.12, h * 0.26, w * 0.24, h * 0.4, h * 0.13, '#6fd0ff', null);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(w * x - w * 0.08, h * 0.62);
        ctx.lineTo(w * x - w * 0.02, h * 0.28);
        ctx.lineTo(w * x + w * 0.03, h * 0.28);
        ctx.lineTo(w * x - w * 0.03, h * 0.62);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    if (face === 'back') star(ctx, w * 0.5, h * 0.25, h * 0.15, light(c, 0.45));
    return;
  }
  if (v === 'cap') {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, w, h);
    if (face === 'top') {
      for (let i = 0; i < 3; i++) line(ctx, [w * 0.5, h * 0.5, w * (i * 0.5), 0], dark(c, 0.25), 2);
      ell(ctx, w * 0.5, h * 0.5, 5, 5, dark(c, 0.3));
      return;
    }
    ctx.fillStyle = dark(c, 0.2);
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
    ctx.fillStyle = light(c, 0.2);
    ctx.fillRect(0, 0, w, h * 0.12);
    if (face === 'front') {
      ell(ctx, w * 0.5, h * 0.45, h * 0.3, h * 0.3, '#ffffff', INK, 3);
      star(ctx, w * 0.5, h * 0.46, h * 0.22, lum(c) > 0.6 ? '#2a2830' : c);
    } else if (face === 'back') {
      rr(ctx, w * 0.38, h * 0.4, w * 0.24, h * 0.45, 8, dark(c, 0.55));
      rr(ctx, w * 0.3, h * 0.55, w * 0.4, h * 0.14, 4, '#d8d0bf', INK, 2);
    } else {
      stitches(ctx, w * 0.5, h * 0.12, w * 0.5, h * 0.8, light(c, 0.35), 2, 6);
    }
    return;
  }
  if (v === 'beanie') {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, w, h);
    if (face === 'top') {
      for (let i = 1; i < 6; i++) line(ctx, [0, (h * i) / 6, w, (h * i) / 6], dark(c, 0.12), 2);
      ell(ctx, w / 2, h / 2, w * 0.18, h * 0.18, light(c, 0.55), dark(c, 0.3), 2);
      return;
    }
    const n = Math.round(w / 10);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? dark(c, 0.14) : light(c, 0.06);
      ctx.fillRect((i * w) / n, 0, w / n, h);
    }
    ctx.fillStyle = dark(c, 0.25);
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? dark(c, 0.35) : dark(c, 0.18);
      ctx.fillRect((i * w) / n, h * 0.5, w / n, h * 0.5);
    }
    ctx.fillStyle = light(c, 0.5);
    ctx.fillRect(0, h * 0.64, w, h * 0.1);
    line(ctx, [0, h * 0.5, w, h * 0.5], dark(c, 0.5), 3);
    return;
  }
  if (v === 'bandana') {
    ctx.fillStyle = face === 'top' ? L.hair : c;
    ctx.fillRect(0, 0, w, h);
    if (face === 'top') {
      ctx.fillStyle = c;
      ctx.fillRect(0, h * 0.82, w, h * 0.18);
      ctx.fillRect(0, 0, w, h * 0.18);
      ctx.fillRect(0, 0, w * 0.18, h);
      ctx.fillRect(w * 0.82, 0, w * 0.18, h);
      return;
    }
    const r = rng(L.seed + 7);
    for (let i = 0; i < 26; i++) ell(ctx, r() * w, r() * h, 2.6, 2.6, light(c, 0.7));
    ctx.fillStyle = dark(c, 0.25);
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    if (face === 'back') {
      ell(ctx, w * 0.5, h * 0.5, h * 0.3, h * 0.3, dark(c, 0.12), INK, 2.5);
      ctx.fillStyle = dark(c, 0.12);
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.55);
      ctx.lineTo(w * 0.35, h);
      ctx.lineTo(w * 0.45, h);
      ctx.moveTo(w * 0.5, h * 0.55);
      ctx.lineTo(w * 0.66, h);
      ctx.lineTo(w * 0.56, h);
      ctx.fill();
    }
    return;
  }
  // Причёска-«блок».
  ctx.fillStyle = L.hair;
  ctx.fillRect(0, 0, w, h);
  if (face === 'top') {
    for (let i = 0; i < 6; i++) line(ctx, [w * (0.1 + i * 0.16), h * 0.1, w * (0.2 + i * 0.13), h * 0.9], dark(L.hair, 0.2), 3);
    ell(ctx, w * 0.4, h * 0.35, w * 0.2, h * 0.1, light(L.hair, 0.25));
    return;
  }
  ctx.fillStyle = light(L.hair, 0.2);
  ctx.fillRect(0, 0, w, h * 0.18);
  for (let i = 0; i < 12; i++) {
    const x = (i + 0.5) * (w / 12);
    line(ctx, [x - 4, h * 0.2, x + 3, h * 0.95], dark(L.hair, 0.22), 2.5);
  }
  ctx.fillStyle = light(L.hair, 0.3);
  if (face === 'front') for (let i = 0; i < 3; i++) rr(ctx, w * (0.22 + i * 0.22), h * 0.3, w * 0.08, h * 0.12, 3, light(L.hair, 0.3));
}

// ---------- тело ----------
function belt(ctx, w, h, y0, buckle) {
  const bh = h - y0;
  ctx.fillStyle = '#3a2b24';
  ctx.fillRect(0, y0, w, bh);
  ctx.fillStyle = '#4f3a2f';
  ctx.fillRect(0, y0, w, bh * 0.3);
  if (buckle) rr(ctx, w * 0.5 - bh * 0.6, y0 + bh * 0.12, bh * 1.2, bh * 0.76, 3, '#f0c64f', '#8b6a1d', 2);
}

function vestBase(ctx, w, h, L) {
  ctx.fillStyle = L.vest;
  ctx.fillRect(0, 0, w, h);
  const r = rng(L.seed + 3);
  if (L.pattern === 1) {
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? dark(L.vest, 0.16) : light(L.vest, 0.12);
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, w * (0.07 + r() * 0.08), h * (0.04 + r() * 0.05), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (L.pattern === 2) {
    ctx.fillStyle = light(L.vest, 0.22);
    ctx.fillRect(0, h * 0.5, w, h * 0.08);
  }
}

function paintTorso(face, ctx, w, h, L) {
  const by = h * 0.87;
  if (face === 'top') {
    ctx.fillStyle = L.shirt;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = L.vest;
    ctx.fillRect(w * 0.08, 0, w * 0.24, h);
    ctx.fillRect(w * 0.68, 0, w * 0.24, h);
    ctx.fillStyle = light(L.vest, 0.2);
    ctx.fillRect(w * 0.08, 0, w * 0.24, h * 0.12);
    ctx.fillRect(w * 0.68, 0, w * 0.24, h * 0.12);
    return;
  }
  if (face === 'bottom') {
    ctx.fillStyle = L.pants;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  ctx.fillStyle = L.shirt;
  ctx.fillRect(0, 0, w, h);
  if (face === 'front') {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.32, 0);
    ctx.lineTo(w * 0.5, h * 0.2);
    ctx.lineTo(w * 0.68, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, by);
    ctx.lineTo(0, by);
    ctx.closePath();
    ctx.clip();
    vestBase(ctx, w, h, L);
    bevel(ctx, w, by, L.vest);
    ctx.restore();
    // Воротник майки.
    ctx.beginPath();
    ctx.moveTo(w * 0.32, 0);
    ctx.lineTo(w * 0.5, h * 0.2);
    ctx.lineTo(w * 0.68, 0);
    ctx.strokeStyle = dark(L.vest, 0.45);
    ctx.lineWidth = 4;
    ctx.stroke();
    // Молния.
    line(ctx, [w * 0.5, h * 0.2, w * 0.5, by], dark(L.vest, 0.5), 3);
    for (let y = h * 0.23; y < by - 4; y += 7) line(ctx, [w * 0.47, y, w * 0.53, y], dark(L.vest, 0.35), 2);
    rr(ctx, w * 0.47, h * 0.24, w * 0.06, h * 0.06, 2, '#d9dde5', INK, 1.5);
    // Нагрудные карманы с клапанами.
    for (const x of [0.1, 0.6]) {
      rr(ctx, w * x, h * 0.3, w * 0.3, h * 0.2, 5, dark(L.vest, 0.12), dark(L.vest, 0.5), 2.5);
      rr(ctx, w * x - 2, h * 0.28, w * 0.3 + 4, h * 0.08, 4, dark(L.vest, 0.24), dark(L.vest, 0.5), 2.5);
      ell(ctx, w * (x + 0.15), h * 0.33, 3, 3, dark(L.vest, 0.55));
    }
    // Нижний ряд подсумков.
    for (let i = 0; i < 3; i++) {
      const x = w * (0.08 + i * 0.29);
      rr(ctx, x, h * 0.6, w * 0.26, h * 0.22, 4, dark(L.vest, 0.2), dark(L.vest, 0.55), 2.5);
      ctx.fillStyle = dark(L.vest, 0.32);
      ctx.fillRect(x + 2, h * 0.6 + 2, w * 0.26 - 4, h * 0.06);
    }
    // Шеврон.
    ell(ctx, w * 0.76, h * 0.12, h * 0.055, h * 0.055, '#ffffff', INK, 2);
    star(ctx, w * 0.76, h * 0.12, h * 0.04, L.vest);
    belt(ctx, w, h, by, true);
    return;
  }
  if (face === 'back') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, h * 0.06, w, by - h * 0.06);
    ctx.clip();
    vestBase(ctx, w, h, L);
    bevel(ctx, w, by, L.vest);
    ctx.restore();
    ctx.fillStyle = L.vest;
    ctx.fillRect(0, 0, w * 0.28, h * 0.1);
    ctx.fillRect(w * 0.72, 0, w * 0.28, h * 0.1);
    stitches(ctx, w * 0.06, h * 0.12, w * 0.94, h * 0.12, light(L.vest, 0.35), 2, 6);
    stitches(ctx, w * 0.06, by - 6, w * 0.94, by - 6, light(L.vest, 0.35), 2, 6);
    belt(ctx, w, h, by, false);
    return;
  }
  // Бока: жилет с регулировочными ремешками.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, h * 0.18, w, by - h * 0.18);
  ctx.clip();
  vestBase(ctx, w, h, L);
  bevel(ctx, w, by, L.vest);
  ctx.restore();
  ctx.fillStyle = L.vest;
  ctx.fillRect(0, 0, w, h * 0.1);
  for (const y of [0.42, 0.6]) {
    ctx.fillStyle = '#2f2c33';
    ctx.fillRect(0, h * y, w, h * 0.06);
    rr(ctx, w * 0.35, h * y - 2, w * 0.3, h * 0.06 + 4, 2, '#9aa3ad', INK, 1.5);
  }
  belt(ctx, w, h, by, false);
}

function paintPack(face, ctx, w, h, L) {
  const c = mix(L.vest, '#5c5a4a', 0.55);
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, w, h);
  if (face === 'front') return;
  bevel(ctx, w, h, c, 1.2);
  if (face === 'back') {
    // Клапан с одним ремнём и пряжкой, ниже — накладной карман.
    ctx.beginPath();
    ctx.moveTo(w * 0.04, 0);
    ctx.lineTo(w * 0.96, 0);
    ctx.lineTo(w * 0.96, h * 0.34);
    ctx.quadraticCurveTo(w * 0.5, h * 0.46, w * 0.04, h * 0.34);
    ctx.closePath();
    ctx.fillStyle = dark(c, 0.18);
    ctx.fill();
    ctx.strokeStyle = dark(c, 0.55);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = dark(c, 0.45);
    ctx.fillRect(w * 0.44, h * 0.08, w * 0.12, h * 0.5);
    rr(ctx, w * 0.4, h * 0.4, w * 0.2, h * 0.08, 2, '#c9ced6', INK, 1.5);
    rr(ctx, w * 0.14, h * 0.6, w * 0.72, h * 0.3, 6, dark(c, 0.08), dark(c, 0.5), 2.5);
    stitches(ctx, w * 0.18, h * 0.66, w * 0.82, h * 0.66, light(c, 0.35), 2, 5);
  } else if (face === 'top') {
    rr(ctx, w * 0.3, h * 0.3, w * 0.4, h * 0.4, 4, dark(c, 0.4));
  } else if (face === 'bottom') {
    ctx.fillStyle = dark(c, 0.3);
    ctx.fillRect(0, 0, w, h);
  } else {
    rr(ctx, w * 0.12, h * 0.45, w * 0.76, h * 0.4, 4, dark(c, 0.15), dark(c, 0.5), 2);
  }
}

function paintUpperArm(face, ctx, w, h, L) {
  const sleeve = L.longSleeves ? 1 : 0.52;
  ctx.fillStyle = L.skin;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = L.shirt;
  ctx.fillRect(0, 0, w, h * sleeve);
  if (face === 'top') return;
  if (face === 'bottom') {
    ctx.fillStyle = L.longSleeves ? L.shirt : L.skin;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  ctx.fillStyle = light(L.shirt, 0.18);
  ctx.fillRect(0, 0, w, h * 0.05);
  if (!L.longSleeves) {
    ctx.fillStyle = dark(L.shirt, 0.2);
    ctx.fillRect(0, h * (sleeve - 0.08), w, h * 0.08);
    ctx.fillStyle = dark(L.skin, 0.12);
    ctx.fillRect(0, h * sleeve, w, h * 0.04);
  } else {
    line(ctx, [w * 0.2, h * 0.62, w * 0.55, h * 0.68, w * 0.8, h * 0.64], dark(L.shirt, 0.22), 2.5);
  }
  if (face === 'right' || face === 'left') {
    // Нашивка на плече.
    rr(ctx, w * 0.18, h * 0.12, w * 0.64, h * 0.2, 6, L.vest, INK, 2.5);
    star(ctx, w * 0.5, h * 0.22, h * 0.07, '#ffffff');
  }
}

function paintForeArm(face, ctx, w, h, L) {
  const g0 = 0.66;
  ctx.fillStyle = L.longSleeves ? L.shirt : L.skin;
  ctx.fillRect(0, 0, w, h);
  if (face === 'bottom') {
    ctx.fillStyle = L.glove;
    ctx.fillRect(0, 0, w, h);
    rr(ctx, w * 0.2, h * 0.2, w * 0.6, h * 0.6, 4, light(L.glove, 0.12));
    return;
  }
  if (face === 'top') return;
  if (L.longSleeves) {
    ctx.fillStyle = dark(L.shirt, 0.18);
    ctx.fillRect(0, h * 0.4, w, h * 0.12);
    ctx.fillStyle = light(L.shirt, 0.15);
    ctx.fillRect(0, h * 0.4, w, h * 0.03);
    ctx.fillStyle = L.skin;
    ctx.fillRect(0, h * 0.52, w, h * (g0 - 0.52));
  }
  ctx.fillStyle = L.glove;
  ctx.fillRect(0, h * g0, w, h * (1 - g0));
  ctx.fillStyle = light(L.glove, 0.25);
  ctx.fillRect(0, h * g0, w, h * 0.06);
  ctx.fillStyle = dark(L.glove, 0.3);
  ctx.fillRect(0, h * 0.95, w, h * 0.05);
  if (face === 'front') {
    for (let i = 0; i < 3; i++) rr(ctx, w * (0.1 + i * 0.28), h * 0.84, w * 0.24, h * 0.07, 3, light(L.glove, 0.2));
  } else if (face === 'back') {
    rr(ctx, w * 0.25, h * 0.76, w * 0.5, h * 0.12, 3, light(L.glove, 0.12), dark(L.glove, 0.4), 1.5);
  } else {
    rr(ctx, w * 0.2, h * 0.74, w * 0.25, h * 0.16, 3, light(L.glove, 0.15));
  }
}

function paintThigh(face, ctx, w, h, L) {
  const p = L.pants;
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, w, h);
  if (face === 'top' || face === 'bottom') return;
  ctx.fillStyle = dark(p, 0.18);
  ctx.fillRect(0, 0, w, h * 0.08);
  if (face === 'front') {
    line(ctx, [w * 0.5, h * 0.15, w * 0.5, h], light(p, 0.14), 2);
    rr(ctx, w * 0.1, h * 0.12, w * 0.3, h * 0.04, 2, dark(p, 0.3));
  } else if (face === 'back') {
    rr(ctx, w * 0.2, h * 0.14, w * 0.6, h * 0.24, 5, dark(p, 0.1), dark(p, 0.4), 2);
  } else {
    stitches(ctx, w * 0.5, h * 0.08, w * 0.5, h, light(p, 0.25), 2, 5);
    rr(ctx, w * 0.14, h * 0.38, w * 0.72, h * 0.38, 5, dark(p, 0.08), dark(p, 0.45), 2.5);
    rr(ctx, w * 0.11, h * 0.35, w * 0.78, h * 0.12, 4, dark(p, 0.2), dark(p, 0.45), 2.5);
    ell(ctx, w * 0.5, h * 0.42, 3, 3, dark(p, 0.55));
  }
}

function paintShin(face, ctx, w, h, L) {
  const p = L.pants;
  const b = L.boot;
  const b0 = 0.56;
  if (face === 'bottom') {
    ctx.fillStyle = '#26232a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#38343d';
    for (let i = 0; i < 4; i++) ctx.fillRect(w * 0.1, h * (0.12 + i * 0.22), w * 0.8, h * 0.1);
    return;
  }
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, w, h);
  if (face === 'top') return;
  ctx.fillStyle = b;
  ctx.fillRect(0, h * b0, w, h * (1 - b0));
  ctx.fillStyle = light(b, 0.18);
  ctx.fillRect(0, h * b0, w, h * 0.05);
  ctx.fillStyle = dark(p, 0.2);
  ctx.fillRect(0, h * (b0 - 0.04), w, h * 0.04);
  // Подошва.
  ctx.fillStyle = '#26232a';
  ctx.fillRect(0, h * 0.9, w, h * 0.1);
  ctx.fillStyle = '#4a4550';
  ctx.fillRect(0, h * 0.9, w, h * 0.025);
  if (face === 'front') {
    // Наколенник.
    rr(ctx, w * 0.12, h * 0.04, w * 0.76, h * 0.28, 8, '#3a3940', INK, 2.5);
    rr(ctx, w * 0.2, h * 0.08, w * 0.6, h * 0.08, 4, '#5a5962');
    // Шнуровка и носок.
    rr(ctx, w * 0.2, h * 0.76, w * 0.6, h * 0.14, 5, light(b, 0.12), dark(b, 0.45), 2);
    for (let i = 0; i < 3; i++) {
      const y = h * (b0 + 0.06 + i * 0.05);
      line(ctx, [w * 0.32, y, w * 0.68, y + h * 0.03], '#e8dfcc', 2.5);
      line(ctx, [w * 0.68, y, w * 0.32, y + h * 0.03], '#e8dfcc', 2.5);
    }
  } else if (face === 'back') {
    rr(ctx, w * 0.3, h * (b0 + 0.04), w * 0.4, h * 0.12, 3, dark(b, 0.3));
  } else {
    stitches(ctx, w * 0.5, 0, w * 0.5, h * (b0 - 0.05), light(p, 0.25), 2, 5);
    stitches(ctx, w * 0.08, h * 0.82, w * 0.92, h * 0.82, light(b, 0.3), 2, 4);
  }
}

const BODY_PAINTERS = { torso: paintTorso, pack: paintPack, upperArm: paintUpperArm, foreArm: paintForeArm, thigh: paintThigh, shin: paintShin };

// Каждая грань: заливка с запасом в 2 px (защита от швов на мип-уровнях), затем рисунок с обрезкой.
function paintRect(ctx, rect, base, fn, mirror = false) {
  const [x, y, w, h] = rect;
  ctx.fillStyle = base;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  fn(ctx, w, h);
  ctx.restore();
  // Тонкая тёмная кромка по краю грани подчёркивает «кубичность».
  ctx.strokeStyle = 'rgba(30,20,40,0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function texture(c) {
  if (MC) return pixelSkin(c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round';
  return { c, ctx };
}

// Строит две текстуры (голова/шапка и тело) для игрока. Внешность выбирается по хэшу имени,
// цвет жилета — `color` (в командном режиме это цвет команды).
export function makeSkin(name, color) {
  const L = makeLook(name, color);
  if (MC) {
    // Стиль Minecraft: один маленький пиксельный атлас на голову и тело.
    initSkinLayout(PARTS, HATS);
    const map = mcSkinTexture(L);
    return { look: L, headMap: map, bodyMap: map };
  }
  const head = canvas();
  const R = HEAD_RECTS;
  paintRect(head.ctx, R.head.front, L.skin, (ctx, w, h) => paintHeadFront(ctx, w, h, L));
  paintRect(head.ctx, R.head.right, L.skin, (ctx, w, h) => paintHeadSide(ctx, w, h, L));
  paintRect(head.ctx, R.head.left, L.skin, (ctx, w, h) => paintHeadSide(ctx, w, h, L), true);
  paintRect(head.ctx, R.head.back, L.hair, (ctx, w, h) => paintHeadBack(ctx, w, h, L));
  paintRect(head.ctx, R.head.top, L.hair, (ctx, w, h) => paintHeadTop(ctx, w, h, L));
  paintRect(head.ctx, R.head.bottom, dark(L.skin, 0.2), () => {});
  const hatBase = L.hat === 'hair' ? L.hair : L.hatColor;
  for (const f of FACES) paintRect(head.ctx, R.hat[f], hatBase, (ctx, w, h) => paintHat(f, ctx, w, h, L));
  paintRect(head.ctx, R.visor.front, dark(L.hatColor, 0.25), (ctx, w, h) => {
    ctx.fillStyle = dark(L.hatColor, 0.18);
    ctx.fillRect(0, 0, w, h * 0.5);
  });

  const body = canvas();
  for (const [part, rects] of Object.entries(BODY.rects)) {
    for (const f of FACES) {
      const base = part === 'torso' || part === 'pack' ? L.vest : part === 'thigh' || part === 'shin' ? L.pants : L.shirt;
      paintRect(body.ctx, rects[f], base, (ctx, w, h) => BODY_PAINTERS[part](f, ctx, w, h, L));
    }
  }
  return { look: L, headMap: texture(head.c), bodyMap: texture(body.c) };
}
