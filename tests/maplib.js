import { mapLayout } from '../src/map.js';
import { NavGraph, CELL, WALK } from '../src/nav.js';
import { lineOfSight } from '../src/physics.js';
import { HostMatch, makeBots } from '../src/match.js';
import { rng } from '../src/textures.js';

// Проверки карт для 2 на 2. Каждая возвращает список проблем (пустой — всё хорошо) и метрики.

export const TOL = 0.08;
export const SIZE = [24, 48];
export const ROUTE = [36, 62];
export const SPAWN_ZONE = 5;

const inBox = (p, b, t) => p[0] > b.min[0] - t && p[0] < b.max[0] + t && p[1] > b.min[1] - t && p[1] < b.max[1] + t && p[2] > b.min[2] - t && p[2] < b.max[2] + t;

function samples(b, step = 0.25) {
  const out = [];
  const n = [0, 1, 2].map((a) => Math.max(1, Math.ceil((b.max[a] - b.min[a]) / step)));
  for (let i = 0; i <= n[0]; i++) {
    for (let j = 0; j <= n[1]; j++) {
      for (let k = 0; k <= n[2]; k++) {
        const t = [i / n[0], j / n[1], k / n[2]];
        out.push([0, 1, 2].map((a) => b.min[a] + 0.02 + (b.max[a] - b.min[a] - 0.04) * t[a]));
      }
    }
  }
  return out;
}

const fmt = (b) => `[${b.min.map((v) => v.toFixed(2)).join(', ')}]–[${b.max.map((v) => (Number.isFinite(v) ? v.toFixed(2) : '∞')).join(', ')}]`;

const cache = new Map();
export function load(id) {
  if (!cache.has(id)) {
    const layout = mapLayout(id);
    const nav = new NavGraph(layout);
    const starts = (team) => layout.spawns.filter((s) => team === undefined || s.team === team).map((s) => nav.nearest(s.x, s.y + 0.05, s.z, 2)).filter(Boolean);
    const fwd = nav.reach(starts());
    const back = nav.reach(starts(), true);
    const stand = nav.reach(starts(), false, true);
    cache.set(id, { layout, nav, starts, fwd, back, stand });
  }
  return cache.get(id);
}

// Видимое = твёрдое: нет невидимых стен и нет декора, сквозь который проходишь.
export function checkSolidity(id) {
  const { layout } = load(id);
  const issues = [];
  for (const v of layout.visuals) {
    if (v.collide) continue;
    const dims = [0, 1, 2].map((a) => v.max[a] - v.min[a]);
    if (Math.max(...dims) <= 0.2) continue;
    const bad = samples(v).find((p) => !layout.colliders.some((c) => inBox(p, c, TOL)));
    if (bad) issues.push(`декор без коллизии (${v.mat}) ${fmt(v)}`);
  }
  for (const c of layout.colliders) {
    const bad = samples(c, 0.5).find((p) => !layout.visuals.some((v) => inBox(p, v, TOL)));
    if (bad) issues.push(`невидимый коллайдер ${fmt(c)}`);
  }
  return issues;
}

export function checkSpawns(id) {
  const { layout, nav, fwd } = load(id);
  const issues = [];
  for (const team of [0, 1]) {
    const list = layout.spawns.filter((s) => s.team === team);
    if (list.length < 4) issues.push(`команда ${team}: спавнов ${list.length}, нужно не меньше 4`);
    for (const s of list) {
      const n = nav.nearest(s.x, s.y + 0.05, s.z, 2);
      if (!n || Math.abs(n.y - s.y) > 0.3 || n.h < 1.8) issues.push(`спавн (${s.x}, ${s.y}, ${s.z}) не на полу, где можно стоять`);
      else if (!fwd[n.id]) issues.push(`спавн (${s.x}, ${s.y}, ${s.z}) отрезан от карты`);
      const end = team === 0 ? s.z < -SIZE[1] / 4 : s.z > SIZE[1] / 4;
      if (!end) issues.push(`спавн команды ${team} (${s.x}, ${s.z}) не на своём торце`);
      const fz = -Math.cos(s.yaw);
      if (fz * (team === 0 ? 1 : -1) < 0.5) issues.push(`спавн (${s.x}, ${s.z}) смотрит не в сторону карты (yaw ${s.yaw.toFixed(2)})`);
    }
  }
  return issues;
}

// Всё достижимо: каждая площадка от 1×1 м доступна со спавна, не пригибаясь, и с неё можно вернуться;
// за карту не выйти даже в приседе.
export function checkReach(id) {
  const { layout, nav, fwd, back, stand } = load(id);
  const issues = [];
  const blocked = (n) => layout.unreachable.some((u) => inBox([n.x, n.y, n.z], u, 0));
  const escaped = nav.nodes.filter((n) => fwd[n.id] && !n.inside);
  if (escaped.length) issues.push(`можно выйти за карту, например (${escaped[0].x.toFixed(1)}, ${escaped[0].y.toFixed(1)}, ${escaped[0].z.toFixed(1)})`);
  const traps = nav.nodes.filter((n) => fwd[n.id] && n.inside && !back[n.id]);
  if (traps.length) issues.push(`ловушка: из ${traps.length} точек нельзя вернуться, например (${traps[0].x.toFixed(1)}, ${traps[0].y.toFixed(1)}, ${traps[0].z.toFixed(1)})`);

  // Ступени, на которых стоя упираешься головой: подняться можно только пригнувшись.
  const low = [];
  for (const a of nav.nodes) {
    if (!fwd[a.id] || !a.inside) continue;
    for (const e of nav.edges[a.id]) {
      const b = nav.nodes[e.to];
      if (e.crouch && e.kind === WALK && b.y - a.y > 0.05 && a.h >= 1.8) low.push(b);
    }
  }
  if (low.length) issues.push(`низко над ступенями, подъём только пригнувшись: ${low.slice(0, 3).map((n) => `(${n.x.toFixed(1)}, ${n.y.toFixed(1)}, ${n.z.toFixed(1)})`).join(', ')}`);

  // Площадки: связные по шагу группы узлов, центр которых стоит прямо на поверхности.
  const supported = (n) => layout.colliders.some((c) => Math.abs(c.max[1] - n.y) < 0.01 && n.x > c.min[0] && n.x < c.max[0] && n.z > c.min[2] && n.z < c.max[2]);
  const comp = new Int32Array(nav.nodes.length).fill(-1);
  let count = 0;
  for (const s of nav.nodes) {
    if (comp[s.id] >= 0 || !s.inside || blocked(s)) continue;
    const stack = [s.id];
    comp[s.id] = count;
    const members = [];
    while (stack.length) {
      const u = stack.pop();
      members.push(nav.nodes[u]);
      for (const e of nav.edges[u]) {
        const v = nav.nodes[e.to];
        if (e.kind === WALK && comp[e.to] < 0 && v.inside && !blocked(v)) { comp[e.to] = count; stack.push(e.to); }
      }
    }
    count++;
    if (members.some((n) => stand[n.id])) continue;
    const grid = new Set(members.filter(supported).map((n) => `${n.i},${n.j}`));
    const square = [...grid].some((k) => {
      const [i, j] = k.split(',').map(Number);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (!grid.has(`${i + a},${j + b}`)) return false;
      return true;
    });
    if (!square) continue;
    const xs = members.map((n) => n.x);
    const zs = members.map((n) => n.z);
    const how = members.some((n) => fwd[n.id]) ? 'только пригнувшись' : 'недостижима';
    issues.push(`площадка ${how}: y=${members[0].y.toFixed(2)} x ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} z ${Math.min(...zs).toFixed(1)}..${Math.max(...zs).toFixed(1)}`);
  }
  return issues;
}

// Спавн не простреливается: из зоны вражеского спавна не видно своих точек появления.
export function checkSpawnSafety(id) {
  const { layout, nav, fwd } = load(id);
  const issues = [];
  for (const team of [0, 1]) {
    const own = layout.spawns.filter((s) => s.team === team);
    const enemy = layout.spawns.filter((s) => s.team !== team);
    const zone = nav.nodes.filter((n) => fwd[n.id] && enemy.some((s) => Math.hypot(n.x - s.x, n.z - s.z) < SPAWN_ZONE));
    const step = Math.max(1, Math.floor(zone.length / 300));
    for (let k = 0; k < zone.length; k += step) {
      const n = zone[k];
      const eye = [n.x, n.y + 1.6, n.z];
      const hit = own.find((s) => lineOfSight(layout.colliders, eye, [s.x, s.y + 1.0, s.z]) || lineOfSight(layout.colliders, eye, [s.x, s.y + 1.6, s.z]));
      if (hit) {
        issues.push(`из зоны спавна команды ${1 - team} (${n.x.toFixed(1)}, ${n.y.toFixed(1)}, ${n.z.toFixed(1)}) виден спавн (${hit.x}, ${hit.y}, ${hit.z})`);
        break;
      }
    }
  }
  return issues;
}

export function routeLength(id) {
  const { layout, nav, starts } = load(id);
  const dist = nav.distances(starts(0));
  const ends = layout.spawns.filter((s) => s.team === 1).map((s) => nav.nearest(s.x, s.y + 0.05, s.z, 2)).filter(Boolean);
  return Math.min(...ends.map((n) => dist[n.id]));
}

export function checkPickups(id) {
  const { layout, nav, fwd } = load(id);
  const issues = [];
  if (layout.pickups.length < 2) issues.push(`аптечек ${layout.pickups.length}, нужно не меньше 2`);
  for (const p of layout.pickups) {
    const n = nav.nearest(p.x, p.y + 0.05, p.z, 2);
    if (!n || Math.abs(n.y - p.y) > 0.3 || !fwd[n.id]) issues.push(`аптечка (${p.x}, ${p.y}, ${p.z}) недоступна`);
  }
  return issues;
}

// Матч 2 на 2 ботами без графики: как быстро команды встречаются и сколько боёв за минуту.
export function botMatch(id, seed, seconds = 180) {
  const { layout } = load(id);
  const random = Math.random;
  Math.random = rng(seed);
  try {
    let firstShot = null;
    let kills = 0;
    let time = 0;
    const map = { ...layout, id: layout.id };
    const roster = makeBots(4, true);
    const match = new HostMatch({
      map,
      settings: { mode: 'tdm', scoreLimit: 9999, timeLimit: 60, botSkill: 'normal' },
      roster,
      localId: 'nobody',
      emit: (m) => {
        if (m.t === 'shot' && firstShot === null) firstShot = time;
        if (m.t === 'kill') kills++;
      },
    });
    match.start();
    const dt = 1 / 30;
    let maxY = 0;
    let escaped = null;
    const { hx, hz } = layout.bounds;
    const bots = [...match.players.values()];
    for (; time < seconds; time += dt) {
      match.update(dt);
      for (const b of bots) {
        if (!b.alive) continue;
        maxY = Math.max(maxY, b.pos.y);
        if (!escaped && (Math.abs(b.pos.x) > hx || Math.abs(b.pos.z) > hz || b.pos.y < -1)) escaped = { x: b.pos.x, y: b.pos.y, z: b.pos.z, time };
      }
    }
    return { firstShot, killsPerMin: kills / (seconds / 60), maxY, escaped };
  } finally {
    Math.random = random;
  }
}

// Одиночный бот идёт к случайным высоким точкам: проверка, что маршруты графа проходимы в физике игры.
export function botReach(id, seed, count = 20) {
  const { layout, nav, stand } = load(id);
  const random = Math.random;
  Math.random = rng(seed);
  try {
    const high = nav.nodes.filter((n) => stand[n.id] && n.inside && n.y > 1.5 && n.h >= 1.8);
    const fails = [];
    for (let k = 0; k < count; k++) {
      const goal = high[Math.floor(Math.random() * high.length)];
      const m = new HostMatch({ map: { ...layout, id }, settings: { mode: 'tdm', scoreLimit: 9999, timeLimit: 60, botSkill: 'normal' }, roster: makeBots(1, true), localId: 'nobody', emit: () => {} });
      m.start();
      const b = [...m.players.values()][0];
      m.chooseWaypoint = () => {
        b.brain.goal = goal;
        m.planPath(b);
      };
      let done = false;
      for (let t = 0; t < 30 && !done; t += 1 / 30) {
        m.updateBot(b, 1 / 30);
        done = b.brain.onGround && Math.hypot(b.pos.x - goal.x, b.pos.z - goal.z) < 1 && Math.abs(b.pos.y - goal.y) < 0.3;
      }
      if (!done) fails.push(`(${goal.x.toFixed(1)}, ${goal.y.toFixed(1)}, ${goal.z.toFixed(1)})`);
    }
    return { rate: 1 - fails.length / count, fails };
  } finally {
    Math.random = random;
  }
}

export { CELL };
