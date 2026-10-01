import { DAY } from './env.js';

// «Крыши»: четыре дома с плоскими крышами по флангам, улица посередине и поперечный переулок.
// Карта симметрична поворотом на 180° вокруг центра: половина команды 0 (z < 0) строится
// функцией half(), вторая — тем же кодом через повёрнутый строитель.
//
// Три линии: центральная улица (укрытия каждые 3–4 м, контейнер на перекрёстке) и два фланга,
// на каждом — крыши на высоте 3.6 м и доски между ними; кирпичный дом (A) ещё и проходной
// внутри: со двора спавна через тамбур в переулок или на улицу.

const ROOF = 3.6; // верх крыш
const SLAB = 0.4; // толщина плиты крыши у полого дома
const PAR = 0.8; // парапет
const PT = 0.3;
// Периметр с запасом и для ботов (у них в прыжке срабатывает подъём на ступеньку 0.6 м, итого 2.9 м):
// крыша 3.6 + 2.9 < 6.8. Всё, что выше крыши (парапеты 4.4, кондиционеры 4.6), — не ближе 2.4 м к стене.
const SIDE_WALL = 6.8;
const END_WALL = 5; // торцы за спавнами: рядом только земля и ящики не выше 1.2 м

// Стена с проёмами (как MapBuilder.wall), но через любой строитель — в том числе повёрнутый.
function wall(B, axis, from, to, at, y, height, thick, mat, openings = [], opts) {
  const len = to - from;
  const place = (a, b, y0, y1) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const c = from + (a + b) / 2;
    if (axis === 'x') B.box(c, y + y0, at, b - a, y1 - y0, thick, mat, opts);
    else B.box(at, y + y0, c, thick, y1 - y0, b - a, mat, opts);
  };
  const cuts = [...new Set([0, len, ...openings.flatMap((o) => [o.a, o.b])])].filter((v) => v >= 0 && v <= len).sort((p, q) => p - q);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const holes = openings.filter((o) => o.a <= a && o.b >= b).sort((p, q) => p.bottom - q.bottom);
    let cur = 0;
    for (const o of holes) {
      place(a, b, cur, Math.min(o.bottom, height));
      cur = Math.max(cur, o.top);
    }
    place(a, b, cur, height);
  }
}

// Строитель, повёрнутый на 180° вокруг вертикальной оси через центр карты.
function rotated(b) {
  const flip = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
  return {
    rand: () => b.rand(),
    box: (cx, y, cz, w, h, d, mat, o) => b.box(-cx, y, -cz, w, h, d, mat, o),
    stairs: (x, z, dir, w, h, n, mat, y0) => b.stairs(-x, -z, flip[dir], w, h, n, mat, y0),
    container: (cx, y, cz, alongX, color) => b.container(-cx, y, -cz, alongX, color),
    crate: (cx, y, cz, s) => b.crate(-cx, y, -cz, s),
    barrel: (cx, y, cz, color) => b.barrel(-cx, y, -cz, color),
    pickup: (x, y, z) => b.pickup(-x, y, -z),
    spawn: (x, y, z, team, yaw) => b.spawn(-x, y, -z, team, yaw + Math.PI),
    noAccess: (x0, z0, x1, z1, minY) => b.noAccess(-x0, -z0, -x1, -z1, minY),
  };
}

// Парапет вдоль края крыши с разрывами gaps [[a, b], ...] в мировых координатах вдоль стены.
function parapet(B, axis, from, to, at, gaps = []) {
  wall(B, axis, from, to, at, ROOF, PAR, PT, 'stone', gaps.map(([a, b]) => ({ a: a - from, b: b - from, bottom: 0, top: 9 })));
}

// Кондиционер: корпус, решётка вентилятора сверху и рёбра сбоку (накладки вплотную к корпусу).
function acUnit(B, x, y, z, alongX) {
  const [w, d] = alongX ? [1.6, 1.1] : [1.1, 1.6];
  B.box(x, y, z, w, 1.0, d, 'metalSheet', { texScale: 1 });
  B.box(x, y + 1.0, z, w * 0.55, 0.05, d * 0.55, 'diamondPlate', { collide: false, texScale: 0.8 });
  B.box(x, y + 0.15, z, w + 0.06, 0.12, d + 0.06, 'diamondPlate', { collide: false });
}

// Окно на глухой оштукатуренной стене: тёмное стекло и деревянные ставни заподлицо (≤ 6 см).
function windowTrim(B, axis, at, out, c, y) {
  const o = out * 0.03;
  if (axis === 'x') {
    B.box(c, y, at + o, 0.9, 1.3, 0.06, 'metalSheet', { collide: false });
    for (const s of [-1, 1]) B.box(c + s * 0.7, y - 0.05, at + o * 1.4, 0.45, 1.4, 0.08, 'wood', { collide: false, texScale: 1 });
  } else {
    B.box(at + o, y, c, 0.06, 1.3, 0.9, 'metalSheet', { collide: false });
    for (const s of [-1, 1]) B.box(at + o * 1.4, y - 0.05, c + s * 0.7, 0.08, 1.4, 0.45, 'wood', { collide: false, texScale: 1 });
  }
}

// Пожарная лестница вдоль южной стены дома: от x0 в сторону dir (±1) к периметру и на угол крыши,
// с перилами снаружи; заходят на неё с нижнего торца, со двора.
function fireEscape(B, x0, dir) {
  B.stairs(x0, -16.7, dir > 0 ? '+x' : '-x', 1.3, ROOF, 8, 'diamondPlate');
  const z = -17.32;
  for (let i = 0; i < 8; i++) {
    const cx = x0 + dir * (0.45 * i + 0.225);
    const top = (ROOF / 8) * (i + 1);
    B.box(cx, top + 0.9, z, 0.47, 0.06, 0.06, 'metalSheet');
    if (i % 2 === 1) B.box(cx, top, z, 0.06, 0.9, 0.06, 'metalSheet');
  }
}

// Половина карты команды team (в координатах команды 0: спавн у z = −24, смотрим на +z).
function half(B, team) {
  const WH = ROOF - SLAB;

  // ---------- Дом A (юго-запад): кирпичный, полый первый этаж, вход со двора спавна ----------
  // Восточная стена на улицу: два окна и боковая дверь у переулка.
  wall(B, 'z', -16, -3.5, -4.7, 0, WH, 0.4, 'brick', [
    { a: 4.2, b: 5.4, bottom: 1.0, top: 2.1 },
    { a: 7.2, b: 8.4, bottom: 1.0, top: 2.1 },
    { a: 10.0, b: 11.3, bottom: 0, top: 2.4 },
  ]);
  // Южная стена (двор спавна) с дверью, северная (переулок) с дверью у периметра — двери разнесены.
  wall(B, 'x', -12, -4.9, -15.8, 0, WH, 0.4, 'brick', [{ a: 4.6, b: 5.9, bottom: 0, top: 2.4 }]);
  wall(B, 'x', -12, -4.9, -3.7, 0, WH, 0.4, 'brick', [{ a: 1.1, b: 2.4, bottom: 0, top: 2.4 }]);
  B.box(-8.25, WH, -9.75, 7.5, SLAB, 12.5, 'concrete');
  // Тамбур: перегородка не даёт простреливать через окна до двери во двор.
  B.box(-6.55, 0, -13.8, 3.3, WH, 0.3, 'plaster');
  // Внутри: прилавок, ящики, бочка — укрытия для боя в помещении.
  B.box(-9.6, 0, -9.0, 0.7, 1.0, 3.2, 'wood', { texScale: 1 });
  B.crate(-11.4, 0, -4.5, 1.0);
  B.crate(-11.45, 1.0, -4.55, 0.8);
  B.crate(-11.3, 0, -12.6, 1.2);
  B.barrel(-5.6, 0, -12.9, 'gray');
  B.pickup(-7.2, 0, -8.0);

  // Крыша A.
  parapet(B, 'x', -9.4, -4.5, -15.85);
  parapet(B, 'z', -16, -3.5, -4.65, [[-10.8, -9.2]]);
  parapet(B, 'x', -7.4, -4.5, -3.65);
  acUnit(B, -9.0, ROOF, -12.4, false);
  B.box(-6.0, ROOF, -14.7, 0.8, 1.7, 0.8, 'brick'); // дымоход у угла: укрытие от улицы
  B.box(-6.0, ROOF + 1.7, -14.7, 1.0, 0.15, 1.0, 'concrete');
  B.crate(-6.2, ROOF, -6.2, 1.0);
  B.crate(-8.9, ROOF, -6.0, 1.0);
  B.box(-8.2, ROOF, -9.3, 0.5, 0.9, 0.5, 'metalSheet'); // вытяжка

  // Пожарная лестница со двора на крышу A вдоль южной стены.
  fireEscape(B, -8.3, -1);

  // ---------- Дом B (юго-восток): глухой, оштукатуренный, с плоской крышей ----------
  B.box(8.25, 0, -9.75, 7.5, ROOF - 0.3, 12.5, 'plaster');
  B.box(8.25, ROOF - 0.3, -9.75, 7.5, 0.3, 12.5, 'concrete');
  for (const z of [-13.2, -9.75, -6.3]) windowTrim(B, 'z', 4.5, -1, z, 1.3);
  for (const x of [6.4, 10.0]) windowTrim(B, 'x', -3.5, 1, x, 1.3);
  windowTrim(B, 'x', -16, -1, 6.3, 1.3);
  // Кирпичные «заплатки» на штукатурке, как на концепте.
  for (const [z, y, w, h] of [[-15.2, 0.2, 1.2, 0.9], [-4.6, 2.2, 1.4, 0.8], [-11.4, 2.5, 0.9, 0.6]]) {
    B.box(4.47, y, z, 0.06, h, w, 'brick', { collide: false, texScale: 1 });
  }
  parapet(B, 'x', 4.5, 9.4, -15.85);
  parapet(B, 'z', -16, -3.5, 4.65, [[-10.8, -9.2]]);
  parapet(B, 'x', 4.5, 7.4, -3.65);
  acUnit(B, 8.6, ROOF, -12.6, true);
  acUnit(B, 6.5, ROOF, -13.4, false);
  B.crate(8.8, ROOF, -7.0, 1.0);
  B.crate(6.0, ROOF, -7.4, 1.0);
  B.box(9.0, ROOF, -9.6, 0.5, 0.9, 0.5, 'metalSheet');
  B.pickup(8.2, ROOF, -6.0);
  fireEscape(B, 8.3, 1);

  // ---------- Доски между крышами ----------
  // Через переулок на западном фланге (повёрнутая копия — на восточном) и через улицу у z = −10.
  for (const s of [-1, 1]) B.box(-8.2 + s * 0.31, ROOF, 0, 0.56, 0.12, 8.2, 'wood', { texScale: 1 });
  for (const s of [-1, 1]) B.box(0, ROOF, -10 + s * 0.31, 10.2, 0.12, 0.56, 'wood', { texScale: 1 });

  // ---------- Улица ----------
  // Тротуары вдоль домов.
  B.box(-4.0, 0, -9.75, 1.0, 0.15, 12.5, 'concrete');
  B.box(4.0, 0, -9.75, 1.0, 0.15, 12.5, 'concrete');
  // Укрытия каждые 3–4 м, в шахматном порядке.
  B.box(2.0, 0, -13.6, 2.2, 1.0, 0.6, 'hazard', { texScale: 1 });
  B.barrel(-2.6, 0, -11.0, 'blue');
  B.barrel(-1.8, 0, -10.4, 'green');
  B.crate(2.6, 0, -7.6, 1.2);
  B.crate(2.7, 1.2, -7.7, 0.8);
  B.box(-2.2, 0, -5.4, 2.2, 1.0, 0.6, 'hazard', { texScale: 1 });
  B.crate(2.0, 0, -2.4, 1.0); // ступенька на центральный контейнер
  B.barrel(2.2, 0, -4.0, 'orange');
  // Переулок: бочки у двери дома A и ящики у периметра.
  B.barrel(-6.4, 0, -1.6, 'green');
  B.barrel(-7.1, 0, -2.3, 'gray');
  B.crate(-11.2, 0, 1.4, 1.2);
  B.crate(-11.25, 1.2, 1.35, 0.8);

  // ---------- Двор спавна ----------
  B.box(0, 0, -20, 24, 0.03, 8, 'concrete', { collide: false, texScale: 3 });
  // Контейнер-баррикада закрывает спавн от взгляда вдоль улицы.
  B.container(0, 0, -17.5, true, team ? 'orange' : 'blue');
  B.crate(-1.7, 0, -19.3, 1.0);
  B.crate(6.0, 0, -23.0, 1.2);
  B.crate(4.9, 0, -23.3, 0.8);
  B.barrel(-6.2, 0, -23.2, 'gray');
  B.barrel(-5.3, 0, -23.4, 'blue');
  // Спавны за контейнером и за углами домов; с (−5.8, −21.6) видно улицу до красного контейнера.
  for (const [x, z, yaw] of [[-5.8, -21.6, Math.PI + 0.29], [-1.5, -21.5, Math.PI], [1.5, -21.5, Math.PI], [9.5, -21, Math.PI]]) B.spawn(x, 0, z, team, yaw);
}

export default {
  id: 'roofs',
  name: 'Крыши',
  desc: 'Четыре дома с плоскими крышами, доски между крышами и улицы внизу.',
  size: [24, 48],
  seed: 202,
  env: { ...DAY, azimuth: 140, elevation: 50 },
  build(b) {
    // Арена вручную: боковые стены выше крыш, торцевые ниже — за спавнами нет высоких мест.
    b.box(0, -1, 0, 26, 1, 50, 'asphalt', { texScale: 4 });
    for (const s of [-1, 1]) {
      b.box(s * 12.5, 0, 0, 1, SIDE_WALL, 50, 'brick');
      b.box(0, 0, s * 24.5, 24, END_WALL, 1, 'brick');
    }
    b.container(0, 0, 0, false, 'red');
    half(b, 0);
    half(rotated(b), 1);
  },
};
