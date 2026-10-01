import { PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT, STEP_HEIGHT, GRAVITY, JUMP_SPEED } from './physics.js';

// Навигационный граф по реальным поверхностям карты: узлы — точки, где помещается игрок,
// рёбра — шаг, спрыгивание, запрыгивание и прыжок через щель. Нужен ботам и тестам карт.
export const CELL = 0.25;
const BUCKET = 2;
const JUMP_APEX = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
export const JUMP_UP = JUMP_APEX - 0.25;
const GAP_JUMP = 2.2;
const EPS = 0.02;
// Узел требует опоры хотя бы на SUPPORT м под квадратом игрока: стоять на сантиметре края
// физика позволяет, но попасть туда ни бот, ни человек надёжно не сможет.
const SUPPORT = 0.2;

export const WALK = 0;
export const DROP = 1;
export const JUMP = 2;

// Сетка корзин по XZ: проверки столкновений смотрят только ближайшие коллайдеры.
class ColliderIndex {
  constructor(colliders) {
    this.buckets = new Map();
    for (const c of colliders) {
      for (let i = Math.floor(c.min[0] / BUCKET); i <= Math.floor(c.max[0] / BUCKET); i++) {
        for (let j = Math.floor(c.min[2] / BUCKET); j <= Math.floor(c.max[2] / BUCKET); j++) {
          const k = `${i},${j}`;
          if (!this.buckets.has(k)) this.buckets.set(k, []);
          this.buckets.get(k).push(c);
        }
      }
    }
  }

  near(x0, z0, x1, z1) {
    const out = new Set();
    for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++) {
      for (let j = Math.floor(z0 / BUCKET); j <= Math.floor(z1 / BUCKET); j++) {
        for (const c of this.buckets.get(`${i},${j}`) || []) out.add(c);
      }
    }
    return out;
  }

  blocked(x, y, z, r, h) {
    for (const b of this.near(x - r, z - r, x + r, z + r)) {
      if (x + r > b.min[0] && x - r < b.max[0] && y + h > b.min[1] && y < b.max[1] && z + r > b.min[2] && z - r < b.max[2]) return true;
    }
    return false;
  }

  // Высоты опор под квадратом игрока: как и в физике, стоять можно и на краю коробки.
  tops(x, z, r) {
    const ys = [];
    for (const b of this.near(x - r, z - r, x + r, z + r)) {
      if (x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2]) ys.push(b.max[1]);
    }
    return ys;
  }
}

export class NavGraph {
  // map: { colliders, bounds: { hx, hz } }; margin — запас сетки за границей, чтобы ловить выход за карту.
  constructor(map, margin = 2) {
    this.index = new ColliderIndex(map.colliders);
    this.bounds = map.bounds;
    this.x0 = -map.bounds.hx - margin;
    this.z0 = -map.bounds.hz - margin;
    this.nx = Math.round((map.bounds.hx * 2 + margin * 2) / CELL);
    this.nz = Math.round((map.bounds.hz * 2 + margin * 2) / CELL);
    this.nodes = [];
    this.columns = new Map();
    this.buildNodes();
    this.edges = this.nodes.map(() => []);
    this.buildEdges();
  }

  colKey(i, j) {
    return i * 100000 + j;
  }

  cellX(i) {
    return this.x0 + (i + 0.5) * CELL;
  }

  cellZ(j) {
    return this.z0 + (j + 0.5) * CELL;
  }

  buildNodes() {
    const idx = this.index;
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.nz; j++) {
        const x = this.cellX(i);
        const z = this.cellZ(j);
        const ys = [...new Set(idx.tops(x, z, PLAYER_RADIUS - SUPPORT).map((y) => Math.round(y * 1000) / 1000))].sort((a, b) => a - b);
        const list = [];
        for (const y of ys) {
          let h = 0;
          if (!idx.blocked(x, y + EPS, z, PLAYER_RADIUS, STAND_HEIGHT)) h = STAND_HEIGHT;
          else if (!idx.blocked(x, y + EPS, z, PLAYER_RADIUS, CROUCH_HEIGHT)) h = CROUCH_HEIGHT;
          if (!h) continue;
          const n = { id: this.nodes.length, i, j, x, y, z, h, inside: Math.abs(x) < this.bounds.hx && Math.abs(z) < this.bounds.hz };
          this.nodes.push(n);
          list.push(n);
        }
        if (list.length) this.columns.set(this.colKey(i, j), list);
      }
    }
  }

  column(i, j) {
    return this.columns.get(this.colKey(i, j)) || [];
  }

  // Свободен ли столб игрока радиуса r от высоты y на h (по пути между клетками).
  clear(x, y, z, h) {
    return !this.index.blocked(x, y + EPS, z, PLAYER_RADIUS, h);
  }

  buildEdges() {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const a of this.nodes) {
      for (const [di, dj] of dirs) {
        // Между полом у стены и краем ящика есть полоса без опоры шириной до 0.2 м, поэтому соседями
        // считаются узлы в трёх ближайших столбцах; проход тела проверяется по пути.
        const near = [];
        for (let k = 1; k <= 3; k++) for (const b of this.column(a.i + di * k, a.j + dj * k)) near.push([b, k]);
        const pass = (b, k, y, h) => {
          for (let t = 1; t <= k; t++) {
            const f = (t - 0.5) / k;
            if (!this.clear(a.x + (b.x - a.x) * f, y, a.z + (b.z - a.z) * f, h)) return false;
          }
          return true;
        };
        let walkable = false;
        for (const [b, k] of near) {
          const dy = b.y - a.y;
          if (dy > JUMP_UP) continue;
          const step = Math.hypot(di, dj) * CELL * k;
          const h = Math.min(a.h, b.h);
          // Ребро «пригнувшись»: стоя голова упирается (низкий проход, лестница под перекрытием).
          const low = h < STAND_HEIGHT;
          if (Math.abs(dy) <= STEP_HEIGHT - EPS) {
            if (pass(b, k, Math.max(a.y, b.y), h)) {
              this.link(a, b, step, WALK, low || !pass(b, k, Math.max(a.y, b.y), STAND_HEIGHT));
              walkable = true;
            }
          } else if (dy < 0) {
            if (this.clear(b.x, b.y, b.z, a.y - b.y + h) && pass(b, k, a.y, h)) this.link(a, b, step, DROP, low);
          } else if (a.h === STAND_HEIGHT) {
            if (this.clear(a.x, a.y, a.z, dy + STAND_HEIGHT + 0.05) && pass(b, k, b.y, b.h)) this.link(a, b, step + 0.4, JUMP, low);
          }
        }
        if (!walkable && a.h === STAND_HEIGHT) this.gapJumps(a, di, dj);
      }
    }
  }

  // Прыжок через щель или провал на площадку того же уровня (или ниже) на расстоянии до GAP_JUMP.
  gapJumps(a, di, dj) {
    const len = Math.hypot(di, dj) * CELL;
    const maxK = Math.floor(GAP_JUMP / len);
    for (let k = 2; k <= maxK; k++) {
      const ok = (() => {
        for (let t = 1; t < k; t++) {
          const x = a.x + di * CELL * t;
          const z = a.z + dj * CELL * t;
          if (!this.clear(x, a.y + 0.3, z, STAND_HEIGHT)) return false;
        }
        return true;
      })();
      if (!ok) return;
      for (const b of this.column(a.i + di * k, a.j + dj * k)) {
        if (b.y > a.y + 0.3 || b.y < a.y - 3) continue;
        if (this.clear(b.x, b.y, b.z, a.y - b.y + 0.3 + b.h)) {
          this.link(a, b, len * k + 0.6, JUMP, b.h < STAND_HEIGHT);
          return;
        }
      }
    }
  }

  link(a, b, cost, kind, crouch) {
    this.edges[a.id].push({ to: b.id, cost, kind, crouch });
  }

  // Ближайший узел под точкой (x, y, z): в своём столбце или соседних, не выше y + 0.7.
  nearest(x, y, z, radius = 3) {
    const ci = Math.floor((x - this.x0) / CELL);
    const cj = Math.floor((z - this.z0) / CELL);
    let best = null;
    let bd = Infinity;
    for (let r = 0; r <= radius; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          for (const n of this.column(i, j)) {
            if (n.y > y + 0.7) continue;
            const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 2;
            if (d < bd) { bd = d; best = n; }
          }
        }
      }
      if (best) return best;
    }
    return best;
  }

  // Достижимость из множества узлов; reverse — откуда можно дойти до них; stand — не пригибаясь.
  reach(starts, reverse = false, stand = false) {
    const adj = reverse ? this.reverseEdges() : this.edges;
    const seen = new Uint8Array(this.nodes.length);
    const stack = [];
    for (const s of starts) {
      if (!seen[s.id]) { seen[s.id] = 1; stack.push(s.id); }
    }
    while (stack.length) {
      const u = stack.pop();
      for (const e of adj[u]) {
        if (!seen[e.to] && !(stand && e.crouch)) { seen[e.to] = 1; stack.push(e.to); }
      }
    }
    return seen;
  }

  reverseEdges() {
    if (!this.rev) {
      this.rev = this.nodes.map(() => []);
      this.edges.forEach((list, u) => list.forEach((e) => this.rev[e.to].push({ to: u, cost: e.cost, kind: e.kind, crouch: e.crouch })));
    }
    return this.rev;
  }

  // Дейкстра от набора узлов: массив расстояний по пути стоя (метры с надбавкой за прыжки).
  distances(starts) {
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const heap = new Heap();
    for (const s of starts) { dist[s.id] = 0; heap.push(0, s.id); }
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      for (const e of this.edges[u]) {
        if (e.crouch) continue;
        const nd = d + e.cost;
        if (nd < dist[e.to]) { dist[e.to] = nd; heap.push(nd, e.to); }
      }
    }
    return dist;
  }

  // A* по рёбрам без приседа (боты не пригибаются): узлы от a до b и тип ребра, которым в узел пришли.
  path(a, b) {
    if (!a || !b) return null;
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const how = new Uint8Array(n);
    const heap = new Heap();
    const hfn = (u) => Math.hypot(this.nodes[u].x - b.x, this.nodes[u].z - b.z);
    g[a.id] = 0;
    heap.push(hfn(a.id), a.id);
    while (heap.size) {
      const [, u] = heap.pop();
      if (u === b.id) break;
      for (const e of this.edges[u]) {
        if (e.crouch) continue;
        const nd = g[u] + e.cost;
        if (nd < g[e.to]) {
          g[e.to] = nd;
          from[e.to] = u;
          how[e.to] = e.kind;
          heap.push(nd + hfn(e.to), e.to);
        }
      }
    }
    if (g[b.id] === Infinity) return null;
    const out = [];
    for (let u = b.id; u !== -1; u = from[u]) out.push({ node: this.nodes[u], kind: how[u] });
    return out.reverse();
  }

  // Путь без лишних точек: оставляем смены высоты и прыжки, прямые участки сокращаем.
  simplify(path) {
    if (!path || path.length < 3) return path;
    const out = [path[0]];
    let anchor = path[0];
    for (let k = 1; k < path.length - 1; k++) {
      const next = path[k + 1];
      const keep = next.kind !== WALK || path[k].kind !== WALK || Math.abs(next.node.y - anchor.node.y) > 0.05 || !this.straight(anchor.node, next.node);
      if (keep) {
        out.push(path[k]);
        anchor = path[k];
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  straight(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / CELL);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const col = this.column(Math.floor((x - this.x0) / CELL), Math.floor((z - this.z0) / CELL));
      if (!col.some((c) => Math.abs(c.y - a.y) <= 0.05 && c.h === STAND_HEIGHT)) return false;
    }
    return true;
  }
}

class Heap {
  constructor() {
    this.a = [];
  }

  get size() {
    return this.a.length;
  }

  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
