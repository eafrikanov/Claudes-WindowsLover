import { DAY } from './env.js';

// «Стройка»: бетонный каркас в центре (земля, 1-й этаж 2.8 м, крыша 5.6 м) с башенным краном,
// у которого на стреле висит оранжевый контейнер. Три линии: центр (сквозь/вокруг каркаса)
// и два фланга по 7 м с контейнерами. Карта поворотно-симметрична на 180° вокруг центра:
// всё, что строится через пары (P.*), появляется в точке (x, z) и в (−x, −z).

const F1 = 2.8; // верх перекрытия 1-го этажа
const F2 = 5.6; // верх крыши
const SLAB = 0.3;
const PLINTH = 0.15;
const FENCE = 7.6; // штабель контейнеров (5.2 м) стоит в 1.4 м от забора: забор выше на 2.4 м

// Прямоугольник [x0, x1]×[z0, z1] минус дыры: список непересекающихся прямоугольников.
function cutRect(x0, x1, z0, z1, holes) {
  const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h[0], h[1]])])].filter((v) => v >= x0 && v <= x1).sort((a, b) => a - b);
  const zs = [...new Set([z0, z1, ...holes.flatMap((h) => [h[2], h[3]])])].filter((v) => v >= z0 && v <= z1).sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    let run = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      const hole = holes.some((h) => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3]);
      if (!hole && run) run[1] = xs[i + 1];
      else if (!hole) run = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
      if (hole && run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
  }
  return out;
}

export default {
  id: 'construction',
  name: 'Стройка',
  desc: 'Бетонный каркас, кран с контейнером и штабеля контейнеров.',
  size: [24, 48],
  seed: 303,
  env: { ...DAY, azimuth: 135, elevation: 50 },
  build(b) {
    const FLIP = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
    // Пары, повёрнутые на 180°.
    const P = {
      box: (cx, y, cz, w, h, d, mat, o) => { b.box(cx, y, cz, w, h, d, mat, o); b.box(-cx, y, -cz, w, h, d, mat, o); },
      container: (cx, y, cz, alongX, color) => { b.container(cx, y, cz, alongX, color); b.container(-cx, y, -cz, alongX, color); },
      crate: (cx, y, cz, s) => { b.crate(cx, y, cz, s); b.crate(-cx, y, -cz, s); },
      barrel: (cx, y, cz, c) => { b.barrel(cx, y, cz, c); b.barrel(-cx, y, -cz, c); },
      stairs: (x, z, dir, w, h, n, mat, y0) => { b.stairs(x, z, dir, w, h, n, mat, y0); b.stairs(-x, -z, FLIP[dir], w, h, n, mat, y0); },
      pickup: (x, y, z) => { b.pickup(x, y, z); b.pickup(-x, y, -z); },
      spawn: (x, y, z) => { b.spawn(x, y, z, 0, Math.PI); b.spawn(-x, y, -z, 1, 0); },
    };

    // ---------- Периметр: забор из профлиста ----------
    b.arena(24, 48, { ground: 'sand', wall: 'metalSheet', height: FENCE });
    // Стойки забора и жёлто-чёрная полоса по низу.
    for (let z = -20; z <= 20; z += 8) {
      P.box(11.9, 0, z, 0.2, FENCE, 0.2, 'concrete');
    }
    for (const x of [-6, 0, 6]) P.box(x, 0, -23.9, 0.2, FENCE, 0.2, 'concrete');
    for (const s of [-1, 1]) {
      b.box(s * 11.98, 0, 0, 0.04, 0.6, 48, 'hazard', { collide: false });
      b.box(0, 0, s * 23.98, 24, 0.6, 0.04, 'hazard', { collide: false });
    }

    // ---------- Центральный каркас 10×12 ----------
    const BX = 5;
    const BZ = 6;
    b.box(0, 0, 0, BX * 2 + 0.4, PLINTH, BZ * 2 + 0.4, 'concrete', { texScale: 3 });
    // Лестница с земли на 1-й этаж (западный край, к +z) и с 1-го этажа на крышу (северный край, к +x).
    const ST1 = { x0: -5, x1: -3.4, z0: -1.5, z1: 1.2 };
    const ST2 = { x0: -1.6, x1: 1.55, z0: -6, z1: -4.6 };
    P.stairs(-4.2, ST1.z0, '+z', 1.6, F1 - PLINTH, 6, 'diamondPlate', PLINTH);
    P.stairs(ST2.x0, -5.3, '+x', 1.4, F2 - F1, 7, 'diamondPlate', F1);
    const rot = (h) => [-h[1], -h[0], -h[3], -h[2]];
    // Проёмы в перекрытиях шире и длиннее маршей (назад на 0.9 м, вбок на 0.8 м): над каждой ступенью
    // 1.85 м свободно, стоящий игрок не задевает головой кромку плиты.
    const holes1 = [[ST1.x0, ST1.x1 + 0.8, ST1.z0 - 0.9, ST1.z1]];
    const holes2 = [[ST2.x0 - 0.9, ST2.x1, ST2.z0, ST2.z1 + 0.8]];
    holes1.push(rot(holes1[0]));
    holes2.push(rot(holes2[0]));
    const slab = (top, holes) => {
      for (const [x0, x1, z0, z1] of cutRect(-BX, BX, -BZ, BZ, holes)) {
        b.box((x0 + x1) / 2, top - SLAB, (z0 + z1) / 2, x1 - x0, SLAB, z1 - z0, 'concrete', { texScale: 3 });
        // Жёлто-чёрная кромка перекрытия по внешнему краю.
        const t = 0.05;
        if (x0 === -BX) b.box(x0 - t / 2, top - SLAB, (z0 + z1) / 2, t, SLAB, z1 - z0, 'hazard', { collide: false });
        if (x1 === BX) b.box(x1 + t / 2, top - SLAB, (z0 + z1) / 2, t, SLAB, z1 - z0, 'hazard', { collide: false });
        if (z0 === -BZ) b.box((x0 + x1) / 2, top - SLAB, z0 - t / 2, x1 - x0, SLAB, t, 'hazard', { collide: false });
        if (z1 === BZ) b.box((x0 + x1) / 2, top - SLAB, z1 + t / 2, x1 - x0, SLAB, t, 'hazard', { collide: false });
      }
    };
    slab(F1, holes1);
    slab(F2, holes2);
    // Колонны.
    const cols = [[4.75, 5.75], [4.75, 2.6], [2.4, 5.75], [-4.75, 5.75], [-4.75, 2.6], [-2.4, 5.75]];
    for (const [x, z] of cols) {
      P.box(x, PLINTH, z, 0.5, F1 - SLAB - PLINTH, 0.5, 'concrete');
      P.box(x, F1, z, 0.5, F2 - SLAB - F1, 0.5, 'concrete');
    }
    // Выпуски колонн на крыше (недостроенный этаж).
    for (const [x, z] of [[4.75, 5.75], [-4.75, 5.75], [-2.4, 5.75]]) P.box(x, F2, z, 0.5, 1.1, 0.5, 'concrete');

    // Первый этаж (земля): кирпичная перегородка и поддоны.
    P.box(2.15, PLINTH, -3.0, 2.5, F1 - SLAB - PLINTH, 0.3, 'brick');
    P.box(-1.6, PLINTH, -2.6, 1.2, 0.14, 1.0, 'wood');
    P.box(-1.6, PLINTH + 0.14, -2.6, 1.1, 0.8, 0.9, 'brick');
    // Ящики до потолка: укрытие без площадки, на которой можно стоять только пригнувшись.
    P.crate(2.0, PLINTH, 1.4, 1.0);
    P.crate(2.0, PLINTH + 1.0, 1.4, 1.0);

    // Перекрытие 1-го этажа: парапеты-отбойники, недостроенная кладка, мешки на поддоне.
    P.box(3.4, F1, -5.82, 2.8, 1.0, 0.3, 'hazard');
    P.box(-4.82, F1, -4.1, 0.3, 1.0, 2.6, 'hazard');
    // Кирпичная кладка ступенькой.
    P.box(1.6, F1, -2.6, 1.0, 1.6, 0.3, 'brick');
    P.box(2.6, F1, -2.6, 1.0, 1.2, 0.3, 'brick');
    P.box(3.5, F1, -2.6, 0.8, 0.8, 0.3, 'brick');
    P.box(-2.2, F1, 3.4, 1.2, 0.14, 1.0, 'wood');
    P.box(-2.2, F1 + 0.14, 3.4, 1.1, 0.7, 0.9, 'plaster');

    // Крыша: отбойники по краю и деревянный помост с аптечкой.
    P.box(-3.6, F2, -5.82, 2.0, 0.9, 0.3, 'hazard');
    P.box(4.82, F2, -3.4, 0.3, 0.9, 2.6, 'hazard');
    // Помост 2.8×2.4 на 0.4 м выше крыши, с дощатым бортиком и стойками.
    P.box(3.0, F2, -2.4, 2.8, 0.4, 2.4, 'wood');
    P.box(3.0, F2 + 0.4, -3.55, 2.8, 0.9, 0.1, 'wood');
    P.box(1.65, F2 + 0.4, -3.55, 0.1, 1.6, 0.1, 'wood');
    P.box(4.35, F2 + 0.4, -3.55, 0.1, 1.6, 0.1, 'wood');
    P.pickup(3.0, F2 + 0.4, -2.2);

    // Внешние строительные леса на восточной грани (южная половина): помост 2.1 м (под ним проходишь стоя), с него — на 1-й этаж.
    const SCX0 = 5;
    const SCX1 = 6.6;
    const SCZ0 = -6;
    const SCZ1 = -2.2;
    P.box((SCX0 + SCX1) / 2, 2.0, (SCZ0 + SCZ1) / 2, SCX1 - SCX0, 0.1, SCZ1 - SCZ0, 'wood');
    for (const z of [SCZ0 + 0.06, -4.1, SCZ1 - 0.06]) {
      P.box(SCX1 - 0.06, 0, z, 0.12, 4.0, 0.12, 'metalSheet');
    }
    P.box(SCX1 - 0.06, 3.9, (SCZ0 + SCZ1) / 2, 0.12, 0.1, SCZ1 - SCZ0, 'metalSheet');
    P.crate(7.2, 0, -3.0, 1.0);
    P.pickup(5.9, 0, -4.1);

    // ---------- Кран: мачта сквозь каркас, стрела вдоль X, висящий контейнер ----------
    const TOP = 13.2;
    b.box(0, 0, 0, 1.4, TOP, 1.4, 'hazard');
    b.box(1.3, TOP - 1.6, 0, 1.6, 1.6, 1.6, 'plaster'); // кабина
    b.box(1.3 + 0.82, TOP - 1.1, 0, 0.04, 0.7, 1.2, 'container', { variant: 'blue', collide: false }); // окно кабины
    b.box(2.2, TOP, 0, 18.4, 0.8, 1.0, 'hazard'); // стрела x −7..11.4
    b.box(0, TOP + 0.8, 0, 0.8, 2.6, 0.8, 'hazard'); // оголовок
    b.box(-5.8, TOP - 1.4, 0, 2.2, 1.4, 1.4, 'concrete'); // противовес
    // Тележка, трос и контейнер на высоте 9–11.6 м.
    const HX = 8;
    b.box(HX, TOP - 0.4, 0, 0.9, 0.4, 1.0, 'metalSheet');
    b.box(HX, 11.6, 0, 0.1, TOP - 0.4 - 11.6, 0.1, 'metalSheet');
    b.container(HX, 9.0, 0, false, 'orange');
    b.noAccess(-12, -3.3, 12, 3.3, 8.5);

    // Разметка зоны приёма груза под контейнером (плоская, на земле).
    for (const s of [-1, 1]) {
      b.box(HX + s * 1.5, 0, 0, 0.3, 0.02, 6.4, 'hazard', { collide: false });
      b.box(HX, 0, s * 3.05, 3.3, 0.02, 0.3, 'hazard', { collide: false });
    }

    // ---------- Зона спавна (юг, команда 0; север — поворот) ----------
    // Красный контейнер поперёк и бытовка закрывают спавны от дальнего торца.
    P.container(-3.5, 0, -17.5, true, 'red');
    P.crate(-7.25, 0, -17.6, 1.3);
    // Бытовка: штукатурка, крыша из профлиста, дверь и окна.
    P.box(4.7, 0, -19.5, 4.4, 2.6, 2.5, 'plaster');
    P.box(4.7, 2.6, -19.5, 4.7, 0.15, 2.8, 'metalSheet');
    P.box(3.6, 0, -20.78, 0.9, 2.0, 0.06, 'wood', { collide: false });
    P.box(5.6, 1.1, -20.78, 1.2, 0.8, 0.06, 'container', { variant: 'blue', collide: false });
    P.box(4.7, 1.1, -18.22, 2.4, 0.8, 0.06, 'container', { variant: 'blue', collide: false });
    P.crate(7.5, 0, -21.6, 1.2);
    P.spawn(-5.0, 0, -21.2);
    P.spawn(-2.0, 0, -21.2);
    P.spawn(0.6, 0, -22.4);
    P.spawn(4.6, 0, -22.6);

    // ---------- Центральная линия (между спавном и каркасом) ----------
    // Дорожные плиты, уложенные в песок (плоская разметка на земле).
    for (const [x, z] of [[0.3, -15.6], [0.1, -13.9], [0.4, -12.2], [0.0, -10.5], [0.3, -8.8], [0.1, -7.3]]) {
      P.box(x, 0, z, 2.9, 0.03, 1.6, 'concrete', { collide: false, texScale: 1.5 });
    }
    // Бетономешалка.
    P.box(1.4, 0, -14.2, 1.1, 0.5, 1.8, 'metalSheet');
    P.box(1.4, 0.5, -14.3, 1.2, 1.1, 1.4, 'container', { variant: 'orange' });
    P.box(1.4, 0.7, -13.45, 0.6, 0.6, 0.3, 'diamondPlate');
    // Отбойник.
    P.box(-2.3, 0, -12.4, 3.2, 1.0, 0.7, 'hazard');
    // Фундаментные блоки ФБС пирамидой.
    for (const [y, zs] of [[0, [-11.1, -10.5, -9.9]], [0.6, [-10.8, -10.2]], [1.2, [-10.5]]]) {
      for (const z of zs) P.box(3.2, y, z, 2.4, 0.6, 0.58, 'concrete', { texScale: 1.2 });
    }
    // Поддоны с кирпичом.
    for (const x of [-3.4, -2.1]) {
      P.box(x, 0, -8.6, 1.2, 0.14, 1.0, 'wood');
      P.box(x, 0.14, -8.6, 1.1, 0.85, 0.9, 'brick');
    }

    // ---------- Фланги ----------
    // Восток: штабель синий на зелёном (верх 5.2 м), подъём по ящикам.
    P.container(9.4, 0, -12.5, false, 'green');
    P.container(9.4, 2.6, -10.5, false, 'blue');
    P.crate(8.8, 0, -16.25, 1.3);
    P.crate(9.9, 2.6, -14.6, 1.2);
    P.barrel(11.3, 0, -5.0, 'blue');
    P.barrel(11.3, 0, -4.0, 'orange');
    P.barrel(10.4, 0, -4.5, 'gray');
    // Запад: серый контейнер, куча песка ступенями.
    P.container(-9.2, 0, -9.0, false, 'gray');
    P.crate(-7.38, 0, -11.2, 1.2);
    P.box(-9.0, 0, -14.5, 3.2, 0.4, 3.0, 'sand', { texScale: 3 });
    P.box(-9.0, 0.4, -14.5, 2.2, 0.4, 2.0, 'sand', { texScale: 3 });
    P.box(-9.0, 0.8, -14.5, 1.2, 0.4, 1.0, 'sand', { texScale: 3 });
    // Ящики у каркаса на флангах.
    P.crate(-8.4, 0, -1.2, 1.2);
    P.crate(-8.4, 1.2, -1.2, 0.9);
    P.crate(-9.7, 0, -0.6, 1.0);
  },
};
