import { DAY } from './env.js';

// «Форт»: кирпичная крепость 24×48 с поворотной симметрией на 180° вокруг центра.
// У каждой команды — двор со спавнами за куртиной (толстой стеной с ходом по верху),
// воротами с деревянной створкой и калиткой; по углам куртины — каменные башни.
// По флангам вдоль внешней стены идут боевые ходы с зубцами и отростками-контрфорсами,
// в центре — кирпичный донжон с двумя наружными лестницами на вершину.

const WALK = 2.5; // высота боевых ходов
const TOWER = 4.0; // верх башен
const KEEP = 5.2; // верх донжона
const CREN = 0.9; // высота зубцов
const ARCH = 2.1; // высота арок ворот и калитки
// Внешняя стена выше любой площадки рядом с ней на 2.3 м и больше: у башен и торцов 7.3 м,
// в середине длинных сторон (рядом только ходы 2.5 м с зубцами) — 6 м.
const OUTER = 6;
const OUTER_HIGH = 7.3;
const HIGH_FROM = 9; // |z|, с которого внешняя стена высокая

// Поворот на 180°: (x, z) → (−x, −z).
const FLIP = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };

function mirrored(b, s) {
  const box = (cx, y, cz, w, h, d, mat, opts) => b.box(s * cx, y, s * cz, w, h, d, mat, opts);
  return {
    box,
    crate: (x, y, z, size) => b.crate(s * x, y, s * z, size),
    barrel: (x, y, z, color) => b.barrel(s * x, y, s * z, color),
    stairs: (x, z, dir, width, height, steps, mat, y0) => b.stairs(s * x, s * z, s > 0 ? dir : FLIP[dir], width, height, steps, mat, y0),
    spawn: (x, y, z, team, yaw) => b.spawn(s * x, y, s * z, team, yaw),
    pickup: (x, y, z) => b.pickup(s * x, y, s * z),
    // Стена от from до to вдоль оси; проёмы в локальных координатах длины.
    wall(axis, from, to, at, y, height, thick, mat, openings = []) {
      if (s > 0) return b.wall(axis, from, to, at, y, height, thick, mat, openings);
      const len = to - from;
      return b.wall(axis, -to, -from, -at, y, height, thick, mat, openings.map((o) => ({ ...o, a: len - o.b, b: len - o.a })));
    },
    // Ряд зубцов вдоль оси: промежутки не шире 0.6 м — в них не встать и не протиснуться.
    merlons(axis, from, to, at, y, { thick = 0.4, h = CREN, len = 0.9, gap = 0.6, mat = 'brick' } = {}) {
      const L = to - from;
      if (L <= len) {
        const c = (from + to) / 2;
        if (axis === 'x') box(c, y, at, L, h, thick, mat);
        else box(at, y, c, thick, h, L, mat);
        return;
      }
      const n = Math.ceil((L + gap) / (len + gap));
      const g = (L - n * len) / (n - 1);
      for (let i = 0; i < n; i++) {
        const c = from + len / 2 + i * (len + g);
        if (axis === 'x') box(c, y, at, len, h, thick, mat);
        else box(at, y, c, thick, h, len, mat);
      }
    },
  };
}

function woodpile(m, x, z, alongX) {
  const [w, d] = alongX ? [2.4, 0.5] : [0.5, 2.4];
  const off = (k) => (alongX ? [x, z + k] : [x + k, z]);
  for (const k of [-0.27, 0.27]) {
    const [px, pz] = off(k);
    m.box(px, 0, pz, w, 0.5, d, 'log');
  }
  m.box(x, 0.5, z, w, 0.5, d, 'log');
}

function well(m, x, z) {
  // Каменное кольцо со «водой» внутри (в колодец можно шагнуть и выйти).
  m.box(x, 0, z - 0.75, 1.9, 0.95, 0.4, 'stone');
  m.box(x, 0, z + 0.75, 1.9, 0.95, 0.4, 'stone');
  m.box(x - 0.75, 0, z, 0.4, 0.95, 1.1, 'stone');
  m.box(x + 0.75, 0, z, 0.4, 0.95, 1.1, 'stone');
  m.box(x, 0, z, 1.1, 0.6, 1.1, 'stone');
  m.box(x, 0.6, z, 1.1, 0.04, 1.1, 'container', { variant: 'blue', collide: false });
  // Ворот колодца поднят выше роста: на кольцо можно встать, не задевая перекладину головой.
  for (const sx of [-0.8, 0.8]) m.box(x + sx, 0.95, z, 0.2, 1.95, 0.2, 'log');
  m.box(x, 2.9, z, 1.8, 0.2, 0.2, 'log');
}

// Пятно травы вровень с землёй (декор без коллизии, лежит на полу).
function grass(m, x, z, r = 1) {
  m.box(x, 0, z, 1.7 * r, 0.03, 1.1 * r, 'leaves', { collide: false });
  m.box(x + 0.35 * r, 0, z + 0.25 * r, 1.0 * r, 0.05, 1.6 * r, 'leaves', { collide: false });
}

function half(b, s) {
  const m = mirrored(b, s);

  // --- Куртина: стена через всю ширину с ходом по верху, воротами и калиткой.
  const cwZ0 = -18.5;
  const cwZ1 = -16;
  const cwZ = (cwZ0 + cwZ1) / 2;
  // Ворота x −2.5..2.5, калитка x −8.5..−6.5 (проёмы отсчитываются от x −8.5, торцы — башни).
  m.wall('x', -8.5, 8.5, cwZ, 0, WALK, cwZ1 - cwZ0, 'brick', [
    { a: 0, b: 2, bottom: 0, top: ARCH },
    { a: 6, b: 11, bottom: 0, top: ARCH },
  ]);
  m.merlons('x', -8.5, 8.5, cwZ1 - 0.2, WALK);
  // Деревянная створка посреди арки ворот: проход по бокам, прямой прострел закрыт.
  m.box(0, 0, cwZ, 2.4, ARCH, 0.3, 'wood');
  for (const yb of [0.45, 1.6]) {
    m.box(0, yb, cwZ, 2.44, 0.18, 0.4, 'metalSheet', { collide: false });
  }

  // Лестница со двора на куртину (левая сторона команды, +x).
  m.stairs(3.6, -19.9 + 0.7, '+x', 1.4, WALK, 6, 'brick');

  // --- Угловые каменные башни на стыке куртины и флангового хода.
  for (const side of [-1, 1]) {
    const tx0 = side < 0 ? -12 : 8.5;
    const tx1 = side < 0 ? -8.5 : 12;
    const tcx = (tx0 + tx1) / 2;
    const tz0 = -19.5;
    const tz1 = -15;
    m.box(tcx, 0, (tz0 + tz1) / 2, tx1 - tx0, TOWER, tz1 - tz0, 'stone');
    // Выступающий венец под зубцами (к внешней стене не выступает).
    const cx0 = side < 0 ? -12 : tx0 - 0.12;
    const cx1 = side < 0 ? tx1 + 0.12 : 12;
    m.box((cx0 + cx1) / 2, TOWER - 0.45, (tz0 + tz1) / 2, cx1 - cx0, 0.45, tz1 - tz0 + 0.24, 'stone');
    const inner = side < 0 ? tx1 : tx0; // грань башни к центру карты
    const dIn = side < 0 ? -0.2 : 0.2;
    // Ступени с куртины на башню.
    m.stairs(inner - side * 1.35, cwZ, side < 0 ? '-x' : '+x', 1.2, TOWER - WALK, 3, 'stone', WALK);
    // Ступени с флангового хода на башню.
    m.stairs(side * 11.2, tz1 + 1.35, '-z', 1.6, TOWER - WALK, 3, 'stone', WALK);
    // Зубцы: к своему двору, к центру (с проходом для ступеней), к полю (с проходом).
    m.merlons('x', tx0, tx1, tz0 + 0.2, TOWER, { mat: 'stone' });
    m.merlons('z', tz0, -18.0, inner + dIn, TOWER, { mat: 'stone' });
    m.merlons('z', -16.5, tz1, inner + dIn, TOWER, { mat: 'stone' });
    const fx0 = side < 0 ? -10.2 : tx0;
    const fx1 = side < 0 ? tx1 : 10.2;
    m.merlons('x', fx0, fx1, tz1 - 0.2, TOWER, { mat: 'stone' });
  }
  m.pickup(-10.25, TOWER, -17.25);

  // --- Фланговые боевые ходы вдоль внешней стены (своя половина), с отростками.
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -12 : 10;
    const x1 = side < 0 ? -10 : 12;
    m.box((x0 + x1) / 2, 0, -7.5, 2, WALK, 15, 'brick');
    const edge = side < 0 ? x1 - 0.2 : x0 + 0.2;
    // Отросток поперёк коридора на z −9: над коридором, зубцы к центру карты.
    const sx0 = side < 0 ? -10 : 6.5;
    const sx1 = side < 0 ? -6.5 : 10;
    m.box((sx0 + sx1) / 2, 0, -9, sx1 - sx0, WALK, 1.6, 'brick');
    m.merlons('x', sx0, sx1, -8.4, WALK);
    m.merlons('z', -15, -9.8, edge, WALK);
    m.merlons('z', -8.2, 0, edge, WALK);
    // Ящики у конца отростка: забраться наверх из коридора.
    m.crate(side * 5.9, 0, -9.2, 1.1);
  }

  // --- Двор спавна. За калиткой — барбакан: выход из неё уходит вбок, прострела во двор нет.
  m.box(-6.65, 0, -20.3, 3.7, 2.4, 0.6, 'brick');
  m.merlons('x', -8.5, -4.8, -20.3, 2.4, { thick: 0.6, h: 0.5, len: 0.7, gap: 0.5 });
  m.crate(10.6, 0, -23, 1.2);
  m.crate(10.7, 1.2, -23.1, 0.85);
  m.barrel(11.1, 0, -21.4, 'red');
  m.barrel(-10.9, 0, -23.2, 'blue');
  m.crate(-11.1, 0, -21.7, 1.0);
  const team = s > 0 ? 0 : 1;
  const yaw = s > 0 ? Math.PI : 0;
  // Спавны в стороне от оси ворот; один смотрит в арку мимо створки.
  for (const [x, z] of [[-7.5, -22.5], [5.4, -22.6], [8.6, -22.3]]) m.spawn(x, 0, z, team, yaw);
  m.spawn(-3.2, 0, -22.8, team, Math.atan2(-(-1.85 + 3.2), -(-17.25 + 22.8)) + (s > 0 ? 0 : Math.PI));

  // --- Двор крепости перед воротами.
  well(m, 4, -12);
  m.crate(-3.8, 0, -13.2, 1.2);
  m.crate(-2.7, 0, -13.4, 0.9);
  m.crate(-1.6, 0, -5.6, 1.2);
  m.crate(2.4, 0, -6.2, 1.0);
  woodpile(m, -7.6, -5, false);
  woodpile(m, 7.8, -13, false);
  m.barrel(-8.3, 0, -13.6, 'red');
  m.barrel(8.4, 0, -4.4, 'green');
  m.crate(-7.9, 0, -1.6, 1.2);
  for (const [x, z, r] of [[-6.3, -11.6, 1.2], [1.8, -9.2, 1], [6.6, -2.2, 0.9], [-0.6, -14.6, 0.8], [-9, -3.6, 0.8], [0.6, -23, 1.1]]) grass(m, x, z, r);

  // Знамёна команды на торцевой стене над двором.
  const cloth = s > 0 ? 'blue' : 'red';
  for (const x of [-5.5, 0, 5.5]) {
    m.box(x, 3.0, -23.97, 1.4, 2.6, 0.06, 'container', { variant: cloth, collide: false });
    m.box(x, 5.6, -23.96, 1.8, 0.12, 0.08, 'log', { collide: false });
  }
}

export default {
  id: 'fort',
  name: 'Форт',
  desc: 'Кирпичные стены с зубцами, угловые башни и донжон в центре.',
  size: [24, 48],
  seed: 404,
  env: { ...DAY, azimuth: 135, elevation: 50 },
  build(b) {
    b.arena(24, 48, { height: OUTER, ground: 'sand' });
    // Надставки внешней стены у торцов и зубцы по верху (снаружи карты, недостижимы).
    const top = mirrored(b, 1);
    const rise = OUTER_HIGH - OUTER;
    for (const s of [1, -1]) {
      b.box(0, OUTER, s * 24.5, 26, rise, 1, 'brick');
      top.merlons('x', -13, 13, s * 24.5, OUTER_HIGH, { thick: 1, h: 0.8 });
      for (const x of [-12.5, 12.5]) {
        b.box(x, OUTER, s * (HIGH_FROM + 24) / 2, 1, rise, 24 - HIGH_FROM, 'brick');
        top.merlons('z', s > 0 ? HIGH_FROM : -24, s > 0 ? 24 : -HIGH_FROM, x, OUTER_HIGH, { thick: 1, h: 0.8 });
      }
    }
    for (const x of [-12.5, 12.5]) top.merlons('z', -HIGH_FROM + 0.3, HIGH_FROM - 0.3, x, OUTER, { thick: 1, h: 0.8 });

    half(b, 1);
    half(b, -1);

    // --- Донжон в центре: две наружные лестницы на вершину, аптечка наверху.
    b.box(0, 0, 0, 6, KEEP, 6, 'brick');
    for (const s of [1, -1]) {
      const m = mirrored(b, s);
      m.stairs(-3.7, -3, '+z', 1.4, KEEP, 11, 'stone');
      m.merlons('z', -2.6, 0.4, -2.8, KEEP);
      m.merlons('x', -3, 3, 2.8, KEEP);
      // Деревянная дверь (декор вровень со стеной).
      m.box(0, 0, -3.03, 1.4, 2.2, 0.06, 'wood', { collide: false });
    }
    b.pickup(0, KEEP, 0);
  },
};
