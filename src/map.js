import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';

export const MAPS = {
  port: {
    name: 'Порт',
    desc: 'Контейнерный терминал со складом и мостками. Много укрытий, средние дистанции.',
    size: 64,
  },
  ruins: {
    name: 'Руины',
    desc: 'Разрушенный квартал на закате. Окна, этажи, дальние прострелы.',
    size: 60,
  },
};

const CONTAINER_COLORS = {
  red: [0.55, 0.12, 0.08],
  blue: [0.1, 0.24, 0.45],
  green: [0.16, 0.36, 0.2],
  orange: [0.8, 0.4, 0.08],
  gray: [0.45, 0.47, 0.48],
};

// Коробка с UV в мировых единицах: текстура не растягивается на больших стенах.
function boxGeometry(w, h, d, texScale, offset) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (texScale) {
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [su, sv] = dims[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * su / texScale + offset, uv.getY(i) * sv / texScale + offset * 0.37);
      }
    }
  }
  return g;
}

// UV по мировым координатам грани (порядок граней BoxGeometry: +X −X +Y −Y +Z −Z): тексели
// одного размера на всех коробках, а куски стены вокруг проёмов стыкуются без швов.
const WORLD_UV = [[[2, -1], [1, 1]], [[2, 1], [1, 1]], [[0, 1], [2, -1]], [[0, 1], [2, 1]], [[0, 1], [1, 1]], [[0, -1], [1, 1]]];
function worldUV(g, tile) {
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const [[ua, us], [va, vs]] = WORLD_UV[Math.floor(i / 4)];
    uv.setXY(i, p.getComponent(i, ua) * us / tile, p.getComponent(i, va) * vs / tile);
  }
}

// Грани коробок, снаружи целиком закрытые соседними коробками, не нужны: их торцы сходятся
// с видимыми гранями соседей в одной плоскости и проступают линиями на стыках.
function cullHidden(solids) {
  const inside = (p, self) => solids.some((s) => s !== self
    && p[0] > s.min[0] && p[0] < s.max[0] && p[1] > s.min[1] && p[1] < s.max[1] && p[2] > s.min[2] && p[2] < s.max[2]);
  for (const box of solids) {
    const index = box.g.index.array;
    const keep = [];
    for (let f = 0; f < 6; f++) {
      const axis = f >> 1;
      const [ua, va] = [0, 1, 2].filter((a) => a !== axis);
      const p = [0, 0, 0];
      p[axis] = f & 1 ? box.min[axis] - 0.01 : box.max[axis] + 0.01;
      const nu = Math.min(8, Math.max(2, Math.ceil((box.max[ua] - box.min[ua]) / 0.4)));
      const nv = Math.min(8, Math.max(2, Math.ceil((box.max[va] - box.min[va]) / 0.4)));
      let hidden = true;
      for (let i = 0; i < nu && hidden; i++) {
        for (let j = 0; j < nv && hidden; j++) {
          p[ua] = box.min[ua] + 0.02 + (box.max[ua] - box.min[ua] - 0.04) * (i + 0.5) / nu;
          p[va] = box.min[va] + 0.02 + (box.max[va] - box.min[va] - 0.04) * (j + 0.5) / nv;
          hidden = inside(p, box);
        }
      }
      if (!hidden) keep.push(...index.slice(f * 6, f * 6 + 6));
    }
    box.g.setIndex(keep);
    box.g.clearGroups();
  }
}

class MapBuilder {
  constructor(textures, seed) {
    this.textures = textures;
    this.parts = new Map();
    this.colliders = [];
    this.spawns = [];
    this.pickups = [];
    this.extra = new THREE.Group();
    this.edges = [];
    this.solids = [];
    this.rand = rng(seed);
  }

  material(name, variant) {
    const key = variant ? `${name}:${variant}` : name;
    if (!this.parts.has(key)) {
      const mat = this.textures.get(name, name === 'container' ? CONTAINER_COLORS[variant] : variant ? [variant] : null);
      this.parts.set(key, { mat, geos: [] });
    }
    return this.parts.get(key);
  }

  // cx, cz — центр; y — низ.
  box(cx, y, cz, w, h, d, mat, { variant, texScale = 2, collide = true, uvBox = false } = {}) {
    const offset = uvBox ? 0 : Math.floor(this.rand() * 8) / 8;
    const tile = uvBox ? 0 : this.textures.tile(mat);
    // С мировыми UV соседние куски стен слегка перекрываются: стык без щелей, наложение невидимо.
    const e = tile ? 0.002 : 0;
    const g = boxGeometry(w + e, h + e, d + e, uvBox || tile ? 0 : texScale, offset);
    g.translate(cx, y + h / 2, cz);
    if (tile) worldUV(g, tile);
    this.material(mat, variant).geos.push(g);
    if (this.textures.pixel) this.solids.push({ g, min: [cx - w / 2, y, cz - d / 2], max: [cx + w / 2, y + h, cz + d / 2] });
    else this.edges.push(new THREE.EdgesGeometry(g));
    if (collide) this.colliders.push({ min: [cx - w / 2, y, cz - d / 2], max: [cx + w / 2, y + h, cz + d / 2] });
  }

  container(cx, y, cz, alongX, color) {
    const L = 6.06;
    const H = 2.6;
    const W = 2.44;
    const [w, d] = alongX ? [L, W] : [W, L];
    this.box(cx, y, cz, w, H, d, 'container', { variant: color, texScale: 2.6 });
    const f = 0.12;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.box(cx + sx * (w / 2 - f / 2 + 0.02), y, cz + sz * (d / 2 - f / 2 + 0.02), f + 0.04, H, f + 0.04, 'metalSheet', { collide: false, texScale: 1 });
      }
    }
    for (const top of [0, H - f]) {
      this.box(cx, y + top, cz + d / 2 - 0.02, w + 0.04, f, 0.1, 'metalSheet', { collide: false });
      this.box(cx, y + top, cz - d / 2 + 0.02, w + 0.04, f, 0.1, 'metalSheet', { collide: false });
    }
  }

  crate(cx, y, cz, s) {
    this.box(cx, y, cz, s, s, s, 'crate', { uvBox: true, variant: this.textures.pixel ? Math.round(s * 16) : undefined });
  }

  barrel(cx, y, cz, color) {
    const mat = this.material('container', color).mat;
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.2, 20);
    const tile = this.textures.tile('container');
    if (tile) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.64 / tile, uv.getY(i) * 1.2 / tile);
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, y + 0.6, cz);
    m.rotation.y = this.rand() * Math.PI;
    m.castShadow = m.receiveShadow = true;
    if (!this.textures.pixel) this.edges.push(new THREE.EdgesGeometry(m.geometry, 30).translate(cx, y + 0.6, cz));
    this.extra.add(m);
    const rimMat = this.material('metalSheet').mat;
    for (const ry of [0.25, 0.95]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.425, 0.025, 6, 24), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(cx, y + ry, cz);
      this.extra.add(rim);
    }
    this.colliders.push({ min: [cx - 0.42, y, cz - 0.42], max: [cx + 0.42, y + 1.2, cz + 0.42] });
  }

  // Стена вдоль X (axis='x') или Z с проёмами {a, b, bottom, top} в локальных координатах длины.
  wall(axis, from, to, at, y, height, thick, mat, openings = [], opts = {}) {
    const len = to - from;
    const place = (a, b, y0, y1) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const c = from + (a + b) / 2;
      if (axis === 'x') this.box(c, y + y0, at, b - a, y1 - y0, thick, mat, opts);
      else this.box(at, y + y0, c, thick, y1 - y0, b - a, mat, opts);
    };
    const ops = [...openings].sort((p, q) => p.a - q.a);
    let cur = 0;
    for (const o of ops) {
      place(cur, o.a, 0, height);
      place(o.a, o.b, 0, o.bottom);
      place(o.a, o.b, o.top, height);
      cur = o.b;
    }
    place(cur, len, 0, height);
  }

  stairs(x, z, dir, width, height, steps, mat = 'diamondPlate') {
    const run = 0.45;
    const rise = height / steps;
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const off = run * i + run / 2;
      const [dx, dz] = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[dir];
      const cx = x + dx * off;
      const cz = z + dz * off;
      if (dx) this.box(cx, 0, cz, run, h, width, mat, { texScale: 1.5 });
      else this.box(cx, 0, cz, width, h, run, mat, { texScale: 1.5 });
    }
  }

  pickup(x, y, z) {
    this.pickups.push({ x, y, z });
  }

  spawn(x, y, z, team, yaw = 0) {
    this.spawns.push({ x, y, z, team, yaw });
  }

  build() {
    cullHidden(this.solids);
    const group = new THREE.Group();
    for (const { mat, geos } of this.parts.values()) {
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    group.add(this.extra);
    if (this.edges.length) {
      group.add(new THREE.LineSegments(mergeGeometries(this.edges), new THREE.LineBasicMaterial({ color: 0x2a2230 })));
      this.edges.forEach((g) => g.dispose());
    }
    return group;
  }
}

function buildPort(b) {
  const S = 32;
  b.box(0, -1, 0, S * 2, 1, S * 2, 'asphalt', { texScale: 4 });
  b.wall('x', -S, S, -S, 0, 5, 1, 'concrete');
  b.wall('x', -S, S, S, 0, 5, 1, 'concrete');
  b.wall('z', -S, S, -S, 0, 5, 1, 'concrete');
  b.wall('z', -S, S, S, 0, 5, 1, 'concrete');

  // Склад в центре с проходами и мостками по периметру.
  const W = 10;
  const door = (a) => ({ a, b: a + 3, bottom: 0, top: 3.2 });
  const win = (a) => ({ a, b: a + 2, bottom: 1.3, top: 2.4 });
  b.wall('x', -W, W, -W, 0, 7, 0.5, 'concrete', [door(8.5), win(2), win(15.5)]);
  b.wall('x', -W, W, W, 0, 7, 0.5, 'concrete', [door(8.5), win(2), win(15.5)]);
  b.wall('z', -W + 0.25, W - 0.25, -W, 0, 7, 0.5, 'concrete', [door(3), win(12)]);
  b.wall('z', -W + 0.25, W - 0.25, W, 0, 7, 0.5, 'concrete', [door(13.5), win(4)]);
  b.box(0, -0.01, 0, W * 2 - 0.6, 0.02, W * 2 - 0.6, 'diamondPlate', { collide: false, texScale: 2 });
  // Мостик вдоль северной стены и лестница к нему.
  b.box(0, 3, -W + 1.45, W * 2 - 1, 0.25, 2.4, 'diamondPlate', { texScale: 1.5 });
  b.box(-8.3, 3.25, -W + 2.6, 2.4, 1, 0.1, 'hazard', { texScale: 1 });
  b.box(2.3, 3.25, -W + 2.6, 14.4, 1, 0.1, 'hazard', { texScale: 1 });
  b.stairs(-6, -W + 2.65 + 8 * 0.45, '-z', 2, 3.25, 8);
  b.crate(4, 0, 3, 1.4);
  b.crate(5.3, 0, 3.4, 1.1);
  b.crate(4.4, 1.4, 3.1, 1.1);
  b.crate(-5, 0, 5, 1.4);
  b.box(0, 0, 6, 5, 1.1, 0.8, 'hazard', { texScale: 1 });
  b.barrel(6.5, 0, -2, 'blue');
  b.barrel(7.3, 0, -2.6, 'blue');
  b.pickup(0, 0, 0);

  // Ряды контейнеров.
  const colors = ['red', 'blue', 'green', 'orange', 'gray'];
  const c = (i) => colors[i % colors.length];
  let k = 0;
  for (const x of [-22, -16]) {
    b.container(x, 0, -20, false, c(k++));
    b.container(x, 0, 20, false, c(k++));
  }
  b.container(-22, 2.6, -20, false, c(k++));
  b.container(22, 0, 16, false, c(k++));
  b.container(22, 2.6, 16, false, c(k++));
  b.container(16, 0, 16, false, c(k++));
  b.container(22, 0, -18, false, c(k++));
  b.container(16, 0, -22, false, c(k++));
  b.container(-18, 0, 0, true, c(k++));
  b.container(-18, 0, 5, true, c(k++));
  b.container(-18, 2.6, 2.5, true, 'gray');
  b.container(18, 0, 0, true, c(k++));
  b.container(18, 0, -5, true, c(k++));
  b.container(0, 0, 22, true, 'red');
  b.container(0, 0, -22, true, 'blue');
  b.container(-8, 0, -26, true, 'green');
  b.container(8, 0, 27, true, 'orange');
  // Ступени-ящики на верх контейнеров.
  b.crate(-13.8, 0, 2.5, 1.3);
  b.crate(-13.8, 0, 3.8, 1.3);
  b.crate(-12.5, 0, 3.8, 0.9);
  b.crate(18.2, 0, 13.5, 1.2);
  b.crate(18.2, 1.2, 13.5, 1);

  // Бетонные блоки и ящики как укрытия.
  const covers = [[-8, 14], [9, -14], [-23, -12], [23, 12], [-4, -15], [5, 15], [-27, 26], [27, -27]];
  for (const [x, z] of covers) b.box(x, 0, z, 2.4, 1.1, 0.8, 'concrete', { texScale: 1.5 });
  const crates = [[-11, 12], [12, -11], [-26, 14], [26, -12], [-12, -27], [12, 26], [-28, -28], [28, 28], [-28, 28], [28, -20]];
  for (const [x, z] of crates) {
    b.crate(x, 0, z, 1.3);
    if (b.rand() > 0.4) b.crate(x + 0.9, 0, z + 1.1, 1);
  }
  for (const [x, z] of [[-10, -12], [10, 12], [-25, 0], [25, 0]]) b.barrel(x, 0, z, b.rand() > 0.5 ? 'red' : 'orange');

  b.pickup(-25, 0, 20);
  b.pickup(25, 0, -20);
  b.pickup(-18, 2.6, 5);
  b.pickup(16, 2.6, 16);

  for (let i = 0; i < 4; i++) {
    b.spawn(-28, 0, -24 + i * 16, 0, -Math.PI / 2);
    b.spawn(28, 0, -24 + i * 16, 1, Math.PI / 2);
  }
  b.spawn(-6, 0, -28, 0, Math.PI);
  b.spawn(6, 0, 28, 1, 0);
}

function buildRuins(b) {
  const S = 30;
  b.box(0, -1, 0, S * 2, 1, S * 2, 'dirt', { texScale: 5 });
  b.wall('x', -S, S, -S, 0, 4.5, 1, 'brick');
  b.wall('x', -S, S, S, 0, 4.5, 1, 'brick');
  b.wall('z', -S, S, -S, 0, 4.5, 1, 'brick');
  b.wall('z', -S, S, S, 0, 4.5, 1, 'brick');

  const win = (a, w = 1.4) => ({ a, b: a + w, bottom: 1.1, top: 2.3 });
  const door = (a) => ({ a, b: a + 1.6, bottom: 0, top: 2.4 });

  // Двухэтажный дом в центре.
  const H = 3.2;
  b.wall('x', -7, 7, -5, 0, H * 2, 0.4, 'plaster', [door(6.2), win(2), win(10.5), { a: 2, b: 3.4, bottom: H + 1, top: H + 2.2 }, { a: 10.5, b: 11.9, bottom: H + 1, top: H + 2.2 }]);
  b.wall('x', -7, 7, 5, 0, H * 2 - 1.5, 0.4, 'plaster', [door(3), win(9), { a: 6, b: 7.5, bottom: H + 1, top: H + 2.2 }]);
  b.wall('z', -4.8, 4.8, -7, 0, H * 2, 0.4, 'brick', [win(3.4), { a: 3.4, b: 4.8, bottom: H + 1, top: H + 2.2 }]);
  b.wall('z', -4.8, 4.8, 7, 0, H + 1.2, 0.4, 'brick', [door(4)]);
  b.box(-2.5, H, 0, 9, 0.3, 9.6, 'concrete', { texScale: 2 });
  b.stairs(2 + 8 * 0.45, -3.5, '-x', 1.6, H, 8, 'concrete');
  b.pickup(-3, H + 0.3, 0);
  b.crate(-5, 0, 2.5, 1.2);
  b.crate(4.5, 0, 3, 1.1);

  // Разрушенные коробки зданий по углам.
  const ruin = (cx, cz, w, d, h, mat, seedOff) => {
    const r = rng(seedOff);
    const hs = () => h * (0.45 + r() * 0.55);
    b.wall('x', cx - w / 2, cx + w / 2, cz - d / 2, 0, hs(), 0.4, mat, [win(w * 0.2), door(w * 0.55)]);
    b.wall('x', cx - w / 2, cx + w / 2, cz + d / 2, 0, hs(), 0.4, mat, [win(w * 0.6)]);
    b.wall('z', cz - d / 2 + 0.2, cz + d / 2 - 0.2, cx - w / 2, 0, hs(), 0.4, mat, [door(d * 0.35)]);
    b.wall('z', cz - d / 2 + 0.2, cz + d / 2 - 0.2, cx + w / 2, 0, hs(), 0.4, mat, [win(d * 0.25)]);
  };
  ruin(-19, -19, 10, 8, 4.5, 'brick', 11);
  ruin(19, 19, 10, 8, 4.5, 'brick', 12);
  ruin(19, -19, 8, 10, 4, 'plaster', 13);
  ruin(-19, 19, 8, 10, 4, 'plaster', 14);

  // Обломки, низкие стены, ящики.
  const rubble = [[-12, 0], [12, 0], [0, -14], [0, 14], [-24, 0], [24, 0], [-10, -24], [10, 24], [-8, 20], [8, -20]];
  for (const [x, z] of rubble) {
    const along = b.rand() > 0.5;
    b.box(x, 0, z, along ? 3.5 : 0.6, 0.9 + b.rand() * 0.6, along ? 0.6 : 3.5, 'brick', { texScale: 2 });
  }
  const crates = [[-13, 8], [13, -8], [-4, -20], [4, 20], [-26, -12], [26, 12], [-15, 25], [15, -25]];
  for (const [x, z] of crates) {
    b.crate(x, 0, z, 1.25);
    if (b.rand() > 0.5) b.crate(x, 1.25, z, 0.9);
  }
  for (const [x, z] of [[-9, 11], [9, -11], [-22, 8], [22, -8]]) b.barrel(x, 0, z, 'green');

  b.pickup(-19, 0, -19);
  b.pickup(19, 0, 19);
  b.pickup(-19, 0, 19);
  b.pickup(19, 0, -19);

  for (let i = 0; i < 4; i++) {
    b.spawn(-26, 0, -18 + i * 12, 0, -Math.PI / 2);
    b.spawn(26, 0, -18 + i * 12, 1, Math.PI / 2);
  }
  b.spawn(0, 0, -26, 0, Math.PI);
  b.spawn(0, 0, 26, 1, 0);
}

const ENV = {
  port: {
    elevation: 45, azimuth: 150,
    skyTop: 0x2f86ea, skyHorizon: 0xcdeeff, skyBottom: 0xe8f6ff, clouds: 0xffffff,
    sun: 0xfff6e6, sunIntensity: 2.1, hemiSky: 0xd6ecff, hemiGround: 0xa89878, hemiIntensity: 1.3,
    fog: 0xcdeeff, fogDensity: 0.0045,
  },
  ruins: {
    elevation: 20, azimuth: 250,
    skyTop: 0x4a63c9, skyHorizon: 0xffc796, skyBottom: 0xffe2c4, clouds: 0xffe4d0,
    sun: 0xffd2a0, sunIntensity: 2.2, hemiSky: 0xffe0c0, hemiGround: 0x9a7456, hemiIntensity: 1.2,
    fog: 0xf5caa0, fogDensity: 0.006,
  },
};

export function buildMap(id, textures) {
  const b = new MapBuilder(textures, id === 'port' ? 1234 : 5678);
  (id === 'ruins' ? buildRuins : buildPort)(b);
  return {
    id,
    group: b.build(),
    colliders: b.colliders,
    spawns: b.spawns,
    pickups: b.pickups,
    env: ENV[id],
    half: MAPS[id].size / 2,
  };
}
