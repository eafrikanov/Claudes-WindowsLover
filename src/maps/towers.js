import { DAY } from './env.js';

// «Башни-близнецы»: две трёхэтажные бетонные башни у своих концов карты, длинный дощатый мост
// между их верхними этажами над центром и кирпичные укрытия у спавнов.
// Карта центрально-симметрична (поворот на 180° вокруг центра): половина команды 0 (−Z)
// строится функцией half(b, 1), половина команды 1 — той же функцией с s = −1.

const F1 = 2.5; // верх перекрытия второго этажа
const F2 = 5.0; // верх перекрытия третьего этажа и настил моста
const ROOF = 7.5; // низ крыши башни
const SLAB = 0.3;

// Башня команды 0 в координатах её половины.
const TX0 = -5;
const TX1 = 1;
const TZ0 = -14;
const TZ1 = -8;
const TCX = (TX0 + TX1) / 2;
const TCZ = (TZ0 + TZ1) / 2;

// Бункер спавна: передняя стена z −17..−16.4, двери слева (за башней) и справа.
const BUNKER_Z = -16.4;
const DOORS = [[-9.5, -7.3], [4, 6.2]];
const DOOR_H = 2.5;
const BUNKER_H = 3.3;

const FLIP = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };

function half(b, s) {
  const box = (cx, y, cz, w, h, d, mat, o) => b.box(s * cx, y, s * cz, w, h, d, mat, o);
  const stairs = (x, z, dir, w, h, n, mat, y0) => b.stairs(s * x, s * z, s > 0 ? dir : FLIP[dir], w, h, n, mat, y0);
  const crate = (x, y, z, size) => b.crate(s * x, y, s * z, size);
  const barrel = (x, y, z, color) => b.barrel(s * x, y, s * z, color);
  const container = (x, y, z, alongX, color) => b.container(s * x, y, s * z, alongX, color);
  const noAccess = (x0, z0, x1, z1, y) => b.noAccess(s * x0, s * z0, s * x1, s * z1, y);
  const team = s > 0 ? 0 : 1;
  const yaw = s > 0 ? Math.PI : 0;

  // Стена вдоль оси axis от from до to, толщина — диапазон [t0, t1] по другой оси; проёмы в мировых координатах.
  const wall = (axis, from, to, t0, t1, y, h, mat, holes = [], o) => {
    const cuts = [...new Set([from, to, ...holes.flatMap((p) => [p.a, p.b])])].filter((v) => v >= from && v <= to).sort((p, q) => p - q);
    const place = (a, c, y0, y1) => {
      if (c - a < 0.01 || y1 - y0 < 0.01) return;
      if (axis === 'x') box((a + c) / 2, y + y0, (t0 + t1) / 2, c - a, y1 - y0, t1 - t0, mat, o);
      else box((t0 + t1) / 2, y + y0, (a + c) / 2, t1 - t0, y1 - y0, c - a, mat, o);
    };
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, c] = [cuts[i], cuts[i + 1]];
      let cur = 0;
      for (const p of holes.filter((q) => q.a <= a && q.b >= c).sort((p, q) => p.bottom - q.bottom)) {
        place(a, c, cur, Math.min(p.bottom, h));
        cur = Math.max(cur, p.top);
      }
      place(a, c, cur, h);
    }
  };

  // Ограждение в жёлто-чёрную полосу на стойках; supported(v) — есть ли под стойкой пол.
  const rail = (axis, from, to, t0, t1, y, supported = () => true) => {
    wall(axis, from, to, t0, t1, y + 0.6, 0.45, 'hazard');
    const n = Math.max(1, Math.ceil((to - from) / 2));
    for (let k = 0; k <= n; k++) {
      const v = Math.min(to - 0.05, Math.max(from + 0.05, from + ((to - from) * k) / n));
      if (!supported(v)) continue;
      if (axis === 'x') box(v, y, (t0 + t1) / 2, 0.1, 0.6, t1 - t0, 'metalSheet');
      else box((t0 + t1) / 2, y, v, t1 - t0, 0.6, 0.1, 'metalSheet');
    }
  };

  const barrier = (x, z, alongX) => {
    const [w, d] = alongX ? [2.4, 0.6] : [0.6, 2.4];
    box(x, 0, z, w, 1.1, d, 'concrete');
    box(x, 0.75, z, w + 0.06, 0.2, d + 0.06, 'hazard', { collide: false });
  };

  // ---------- Бункер спавна ----------
  wall('x', -12, 12, -17, BUNKER_Z, 0, BUNKER_H, 'brick', DOORS.map(([a, c]) => ({ a, b: c, bottom: 0, top: DOOR_H })));
  // Крыша из профлиста с рёбрами, кирпичный парапет по фасаду и вентиляционные короба.
  // Всё на крыше ниже 4 м, чтобы даже запрыгнув туда, нельзя было перелезть стену периметра (6.5 м).
  box(0, BUNKER_H, -20.2, 24, 0.3, 7.6, 'metalSheet');
  for (let x = -9.75; x <= 11.5; x += 3) box(x, BUNKER_H + 0.3, -20.35, 0.2, 0.12, 7.1, 'metalSheet');
  box(0, BUNKER_H + 0.3, BUNKER_Z - 0.2, 24, 0.35, 0.4, 'brick');
  box(-5.25, BUNKER_H + 0.3, -21.5, 1.4, 0.35, 1.1, 'metalSheet');
  box(3.75, BUNKER_H + 0.3, -21.5, 1.4, 0.35, 1.1, 'metalSheet');
  box(0, 2.95, BUNKER_Z + 0.03, 24, 0.65, 0.06, 'hazard', { collide: false });
  for (const [a, c] of DOORS) {
    box(a - 0.15, 0, BUNKER_Z + 0.03, 0.3, DOOR_H, 0.06, 'concrete', { collide: false });
    box(c + 0.15, 0, BUNKER_Z + 0.03, 0.3, DOOR_H, 0.06, 'concrete', { collide: false });
    box((a + c) / 2, DOOR_H, BUNKER_Z + 0.03, c - a + 0.6, 0.3, 0.06, 'concrete', { collide: false });
    // Бетонная обвязка проёма изнутри: откосы и низ перемычки.
    box(a + 0.03, 0, -16.7, 0.06, DOOR_H, 0.6, 'concrete', { collide: false });
    box(c - 0.03, 0, -16.7, 0.06, DOOR_H, 0.6, 'concrete', { collide: false });
    box((a + c) / 2, DOOR_H - 0.06, -16.7, c - a, 0.06, 0.6, 'concrete', { collide: false });
  }
  // Крыша бункера — только навес: на неё не залезть, иначе с неё простреливался бы чужой спавн.
  noAccess(-12, -24, 12, BUNKER_Z, BUNKER_H - 0.2);
  crate(-11.2, 0, -23.2, 1.2);
  crate(11.25, 0, -23.25, 1.1);
  barrel(9.9, 0, -23.3, 'blue');

  for (const x of [-8.4, -3.5, 1.5, 5.1]) b.spawn(s * x, 0, s * -21.5, team, yaw);

  // ---------- Башня ----------
  for (const px of [TX0 + 0.25, TX1 - 0.25]) {
    for (const pz of [TZ0 + 0.25, TZ1 - 0.25]) box(px, 0, pz, 0.6, ROOF, 0.6, 'concrete');
  }
  const PI0 = TX0 + 0.55; // внутренние грани угловых колонн
  const PI1 = TX1 - 0.55;
  const PZ0 = TZ0 + 0.55;
  const PZ1 = TZ1 - 0.55;
  const G = F1 - SLAB;
  const win = (a, c) => ({ a, b: c, bottom: 1.0, top: 1.8 });
  const door = (a, c) => ({ a, b: c, bottom: 0, top: 2.0 });
  // Первый этаж: кирпичная коробка с дверями на три стороны и окнами.
  wall('x', PI0, PI1, TZ1 - 0.3, TZ1, 0, G, 'brick', [door(-3.6, -2.0), win(-1.0, 0.0)]);
  wall('x', PI0, PI1, TZ0, TZ0 + 0.3, 0, G, 'brick', [door(-1.6, -0.2), win(-3.8, -2.6)]);
  wall('z', PZ0, PZ1, TX0, TX0 + 0.3, 0, G, 'brick', [door(-11.8, -10.2), win(-9.6, -8.8)]);
  wall('z', PZ0, PZ1, TX1 - 0.3, TX1, 0, G, 'brick', [win(-10.0, -8.8)]);
  box(TCX, G, TCZ, TX1 - TX0, SLAB, TZ1 - TZ0, 'concrete');

  // Наружная лестница на второй этаж и площадка у входа.
  stairs(TX1 + 0.65, TZ0, '+z', 1.2, F1, 6, 'concrete');
  box(TX1 + 0.625, G, -10.75, 1.25, SLAB, 1.1, 'concrete');
  box(TX1 + 1.05, 0, -10.35, 0.3, G, 0.3, 'concrete');
  rail('z', -11.3, -10.2, TX1 + 1.13, TX1 + 1.25, F1);
  rail('x', TX1 + 0.05, TX1 + 1.25, -10.32, -10.2, F1);

  // Второй этаж: ограждения, ящик-укрытие и лестница на третий.
  rail('x', PI0, PI1, TZ1 - 0.12, TZ1, F1);
  rail('x', PI0, PI1, TZ0, TZ0 + 0.12, F1);
  rail('z', PZ0, PZ1, TX0, TX0 + 0.12, F1);
  rail('z', PZ0, -11.3, TX1 - 0.12, TX1, F1);
  rail('z', -10.2, PZ1, TX1 - 0.12, TX1, F1);
  // Внутренняя лестница отодвинута от колонны и наружного ограждения: над каждой ступенью
  // (и на 0.4 м вокруг неё) до высоты роста свободно — проём в перекрытии шире лестницы.
  stairs(TX0 + 1.44, -9.9, '-z', 1.1, F2 - F1, 6, 'concrete', F1);
  crate(-0.6, F1, -8.75, 0.8);

  // Третий этаж: перекрытие с проёмом над лестницей (x −5..−2.45, z −14..−8.9).
  const HOLE_X = -2.45;
  const HOLE_Z = -8.9;
  box(TCX, F2 - SLAB, (HOLE_Z + TZ1) / 2, TX1 - TX0, SLAB, TZ1 - HOLE_Z, 'concrete');
  box((HOLE_X + TX1) / 2, F2 - SLAB, (TZ0 + HOLE_Z) / 2, TX1 - HOLE_X, SLAB, HOLE_Z - TZ0, 'concrete');
  const onSlab2X = (v) => v > HOLE_X;
  const onSlab2Z = (v) => v > HOLE_Z;
  rail('x', PI0, -1.0, TZ1 - 0.12, TZ1, F2);
  rail('x', PI0, PI1, TZ0, TZ0 + 0.12, F2, onSlab2X);
  rail('z', PZ0, PZ1, TX0, TX0 + 0.12, F2, onSlab2Z);
  rail('z', PZ0, PZ1, TX1 - 0.12, TX1, F2);
  rail('x', TX0 + 0.12, HOLE_X - 0.1, HOLE_Z, HOLE_Z + 0.12, F2);
  crate(-3.9, F2, -8.5, 0.7);

  // Крыша из светлого профлиста.
  box(TCX, ROOF, TCZ, TX1 - TX0 + 0.6, 0.3, TZ1 - TZ0 + 0.6, 'metalSheet');
  box(TCX, ROOF + 0.3, TCZ, TX1 - TX0 - 0.8, 0.25, TZ1 - TZ0 - 0.8, 'metalSheet');
  noAccess(TX0 - 0.4, TZ0 - 0.4, TX1 + 0.4, TZ1 + 0.4, ROOF - 0.1);

  // ---------- Мост (половина) ----------
  box(0, F2 - 0.2, -4, 2, 0.2, 8, 'wood');
  box(-0.95, F2, -4, 0.1, 0.4, 8, 'wood');
  box(0.95, F2, -4, 0.1, 0.4, 8, 'wood');
  for (const x of [-0.75, 0.75]) {
    box(x, F2 - 0.4, -4, 0.2, 0.2, 8, 'log');
    box(x, 0, -4, 0.3, F2 - 0.4, 0.3, 'log');
  }
  box(-0.75, 2.6, 0, 0.3, F2 - 0.4 - 2.6, 0.3, 'log');

  // ---------- Наземные укрытия ----------
  crate(-2.2, 0, -1.85, 1.2); // ступенька на красный контейнер в центре
  container(6.5, 0, -6, true, 'blue');
  crate(2.8, 0, -6, 1.2);
  barrier(0, -5.5, true);
  barrier(-8.5, -4.5, true);
  barrier(-9.6, -1.5, false);
  crate(-10.5, 0, -9.5, 1.3);
  crate(-10.6, 1.3, -9.6, 0.8);
  crate(10.4, 0, -12, 1.2);
  crate(10.5, 1.2, -11.9, 0.8);
  crate(4.6, 0, -10.6, 1.0);
  barrel(-11.3, 0, -15.6, 'red');
  barrel(-10.4, 0, -15.75, 'blue');
  barrel(11.3, 0, -3.8, 'orange');
}

export default {
  id: 'towers',
  name: 'Башни-близнецы',
  desc: 'Две бетонные башни на концах, мост между ними и контейнеры в центре.',
  size: [24, 48],
  seed: 101,
  env: { ...DAY, azimuth: 140, elevation: 50 },
  build(b) {
    b.arena(24, 48, { height: 6.5 });
    b.container(0, 0, 0, true, 'red');
    b.pickup(0, F2, 0);
    b.pickup(2.2, 2.6, 0);
    b.pickup(-2.2, 2.6, 0);
    half(b, 1);
    half(b, -1);
  },
};
