import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import { MAP_LIST } from './maps/index.js';

// Карты 2 на 2: узкие и вытянутые вдоль Z, команды появляются на коротких торцах.
// Каждая карта — модуль в src/maps/ с полями id, name, desc, size [ширина X, длина Z], seed, env, build(b).
export const MAPS = Object.fromEntries(MAP_LIST.map((m) => [m.id, m]));
export const MAP_IDS = MAP_LIST.map((m) => m.id);

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
// Грань проверяется по точкам через 0.25 м (сравниваются только соседние коробки), чтобы узкий
// просвет между накладками не приняли за закрытую грань.
function cullHidden(solids) {
  const touch = (a, b) => a.min[0] <= b.max[0] + 0.02 && a.max[0] >= b.min[0] - 0.02 && a.min[1] <= b.max[1] + 0.02
    && a.max[1] >= b.min[1] - 0.02 && a.min[2] <= b.max[2] + 0.02 && a.max[2] >= b.min[2] - 0.02;
  for (const box of solids) {
    const near = solids.filter((s) => s !== box && touch(s, box));
    const inside = (p) => near.some((s) => p[0] > s.min[0] && p[0] < s.max[0] && p[1] > s.min[1] && p[1] < s.max[1] && p[2] > s.min[2] && p[2] < s.max[2]);
    const index = box.g.index.array;
    const keep = [];
    for (let f = 0; f < 6; f++) {
      const axis = f >> 1;
      const [ua, va] = [0, 1, 2].filter((a) => a !== axis);
      const p = [0, 0, 0];
      p[axis] = f & 1 ? box.min[axis] - 0.01 : box.max[axis] + 0.01;
      const nu = Math.min(64, Math.max(2, Math.ceil((box.max[ua] - box.min[ua]) / 0.25)));
      const nv = Math.min(64, Math.max(2, Math.ceil((box.max[va] - box.min[va]) / 0.25)));
      let hidden = near.length > 0;
      for (let i = 0; i < nu && hidden; i++) {
        for (let j = 0; j < nv && hidden; j++) {
          p[ua] = box.min[ua] + 0.02 + (box.max[ua] - box.min[ua] - 0.04) * (i + 0.5) / nu;
          p[va] = box.min[va] + 0.02 + (box.max[va] - box.min[va] - 0.04) * (j + 0.5) / nv;
          hidden = inside(p);
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
    this.visuals = [];
    this.unreachable = [];
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
  // collide: false — только для деталей, лежащих на поверхности или внутри другого твёрдого тела
  // (рамы контейнеров, разметка); tests/maps.test.js проверяет, что видимое совпадает с коллизией.
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
    const min = [cx - w / 2, y, cz - d / 2];
    const max = [cx + w / 2, y + h, cz + d / 2];
    this.visuals.push({ min, max, collide, mat });
    if (collide) this.colliders.push({ min, max });
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
    const min = [cx - 0.42, y, cz - 0.42];
    const max = [cx + 0.42, y + 1.2, cz + 0.42];
    this.visuals.push({ min, max, collide: true, mat: 'barrel' });
    this.colliders.push({ min, max });
  }

  // Стена вдоль X (axis='x') или Z с проёмами {a, b, bottom, top} в локальных координатах длины.
  // Проёмы могут перекрываться по длине (окна двух этажей друг над другом).
  wall(axis, from, to, at, y, height, thick, mat, openings = [], opts = {}) {
    const len = to - from;
    const place = (a, b, y0, y1) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const c = from + (a + b) / 2;
      if (axis === 'x') this.box(c, y + y0, at, b - a, y1 - y0, thick, mat, opts);
      else this.box(at, y + y0, c, thick, y1 - y0, b - a, mat, opts);
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

  // Лестница сплошными ступенями от y0 вверх на height; (x, z) — начало, dir — куда подниматься.
  // Ступень не выше STEP_HEIGHT, иначе по ней не пройти шагом.
  stairs(x, z, dir, width, height, steps, mat = 'diamondPlate', y0 = 0) {
    const run = 0.45;
    const rise = height / steps;
    const [dx, dz] = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[dir];
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const off = run * i + run / 2;
      const cx = x + dx * off;
      const cz = z + dz * off;
      if (dx) this.box(cx, y0, cz, run, h, width, mat, { texScale: 1.5 });
      else this.box(cx, y0, cz, width, h, run, mat, { texScale: 1.5 });
    }
  }

  // Блочное дерево: ствол и крона из кубов листвы; крона твёрдая, на неё можно встать.
  tree(x, z, { y = 0, trunk = 4, crown = 3.2, w = 0.9 } = {}) {
    this.box(x, y, z, w, trunk, w, 'log');
    const top = y + trunk;
    this.box(x, top - 1, z, crown, 2, crown, 'leaves');
    this.box(x, top + 1, z, crown * 0.6, 1, crown * 0.6, 'leaves');
  }

  // Область, куда игрок попадать не должен (верх кроны, стрела крана). Тест достижимости её пропускает.
  noAccess(x0, z0, x1, z1, minY = 0) {
    this.unreachable.push({ min: [Math.min(x0, x1), minY, Math.min(z0, z1)], max: [Math.max(x0, x1), Infinity, Math.max(z0, z1)] });
  }

  // Пол и периметр: внутренняя граница стен совпадает с размером карты, стены стоят снаружи.
  arena(w, d, { ground = 'sand', wall = 'brick', height = 5, thick = 1, groundScale = 4 } = {}) {
    const hx = w / 2;
    const hz = d / 2;
    this.box(0, -1, 0, w + thick * 2, 1, d + thick * 2, ground, { texScale: groundScale });
    this.box(0, 0, -hz - thick / 2, w + thick * 2, height, thick, wall);
    this.box(0, 0, hz + thick / 2, w + thick * 2, height, thick, wall);
    this.box(-hx - thick / 2, 0, 0, thick, height, d, wall);
    this.box(hx + thick / 2, 0, 0, thick, height, d, wall);
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

// Разметка без мешей и текстур: для тестов в Node.
const LAYOUT_TEXTURES = { get: () => null, tile: () => 0, pixel: false };

function runBuilder(id, textures) {
  const def = MAPS[id] || MAP_LIST[0];
  const b = new MapBuilder(textures, def.seed);
  def.build(b);
  const [w, d] = def.size;
  return { def, b, bounds: { hx: w / 2, hz: d / 2 } };
}

export function mapLayout(id) {
  const { def, b, bounds } = runBuilder(id, LAYOUT_TEXTURES);
  return { id: def.id, colliders: b.colliders, visuals: b.visuals, spawns: b.spawns, pickups: b.pickups, unreachable: b.unreachable, bounds };
}

export function buildMap(id, textures) {
  const { def, b, bounds } = runBuilder(id, textures);
  return {
    id: def.id,
    group: b.build(),
    colliders: b.colliders,
    spawns: b.spawns,
    pickups: b.pickups,
    env: def.env,
    bounds,
    half: Math.max(bounds.hx, bounds.hz),
  };
}
