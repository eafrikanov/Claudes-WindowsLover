import { WEAPONS, WEAPON_INDEX } from './weapons.js';
import { moveBody, lineOfSight, PLAYER_RADIUS, STAND_HEIGHT, GRAVITY, JUMP_SPEED } from './physics.js';
import { NavGraph, JUMP } from './nav.js';

export const RESPAWN_DELAY = 2;
const PICKUP_RESPAWN = 20;
const PICKUP_HEAL = 50;
const KILL_HEAL = 70;
// Частота состояний: 30 Гц по WebRTC; публичным MQTT-брокерам оставляем прежние 20 Гц
export const STATE_RATE = 1 / 30;
export const RELAY_STATE_RATE = 1 / 20;

const BOT_NAMES = ['Ворон', 'Гвоздь', 'Шторм', 'Кактус', 'Бизон', 'Феникс', 'Тень', 'Граф', 'Лис', 'Молот'];
const BOT_SKILL = {
  easy: { reaction: 0.9, acc: 0.22, head: 0.08, turn: 3.5, fireMul: 1.8 },
  normal: { reaction: 0.55, acc: 0.38, head: 0.14, turn: 5, fireMul: 1.35 },
  hard: { reaction: 0.3, acc: 0.55, head: 0.22, turn: 7, fireMul: 1.1 },
};
const PREFERRED_RANGE = { pistol: 12, rifle: 16, shotgun: 5, sniper: 30, minigun: 14, laser: 18 };

const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
// Граф строится один раз на карту: при смене качества меняются меши, но не коллизии.
const NAV_CACHE = new Map();
function navFor(map) {
  if (!NAV_CACHE.has(map.id)) NAV_CACHE.set(map.id, new NavGraph(map));
  return NAV_CACHE.get(map.id);
}

const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

export function makeBots(count, teams, startIndex = 0) {
  const bots = [];
  for (let i = 0; i < count; i++) {
    bots.push({
      id: `bot${startIndex + i}`,
      name: `${BOT_NAMES[(startIndex + i) % BOT_NAMES.length]} [бот]`,
      color: '#d3dcef',
      team: teams ? (startIndex + i) % 2 : 0,
      bot: true,
    });
  }
  return bots;
}

// Логика матча на стороне хоста: здоровье, убийства, респаун, аптечки, боты, таймер.
export class HostMatch {
  constructor({ map, settings, roster, localId, emit }) {
    this.map = map;
    this.settings = settings;
    this.localId = localId;
    this.emit = emit;
    this.teams = settings.mode === 'tdm';
    this.skill = BOT_SKILL[settings.botSkill] || BOT_SKILL.normal;
    this.players = new Map();
    this.time = 0;
    this.endAt = settings.timeLimit * 60;
    this.stateAcc = 0;
    this.relayAcc = 0;
    this.clockAcc = 0;
    this.over = false;
    this.pickups = map.pickups.map(() => ({ on: true, at: 0 }));
    for (const p of roster) this.addRecord(p);
  }

  addRecord(p) {
    const rec = {
      ...p,
      hp: 100, alive: false, kills: 0, deaths: 0,
      pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, w: p.bot ? this.botWeapon() : 0, c: 0,
      ts: 0, v: [0, 0, 0], relayTs: 0, respawnAt: 0,
    };
    if (p.bot) {
      rec.vel = { x: 0, y: 0, z: 0 };
      rec.brain = { target: null, seenAt: 0, path: null, k: 1, strafe: 1, strafeT: 0, nextShot: 0, stuck: 0, ammo: WEAPONS[rec.w].mag, reloadUntil: 0, onGround: false };
    }
    this.players.set(p.id, rec);
    return rec;
  }

  botWeapon() {
    const pool = ['rifle', 'rifle', 'shotgun', 'pistol', 'sniper', 'minigun', 'laser'];
    return WEAPON_INDEX[pool[Math.floor(Math.random() * pool.length)]];
  }

  roster() {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, team: p.team, bot: !!p.bot,
      kills: p.kills, deaths: p.deaths, alive: p.alive, hp: p.hp,
    }));
  }

  snapshot() {
    return {
      roster: this.roster(),
      pickups: this.pickups.map((p) => p.on),
      left: Math.max(0, this.endAt - this.time),
    };
  }

  start() {
    for (const p of this.players.values()) this.respawn(p);
    this.emit({ t: 'clock', left: this.endAt });
  }

  join(p) {
    const rec = this.addRecord(p);
    this.emit({ t: 'roster', roster: this.roster() });
    rec.respawnAt = this.time + 1;
    return rec;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    this.emit({ t: 'roster', roster: this.roster() });
  }

  enemies(a, b) {
    return a.id !== b.id && (!this.teams || a.team !== b.team);
  }

  pickSpawn(p) {
    const spawns = this.map.spawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let minD = 999;
      for (const o of this.players.values()) {
        if (!o.alive || !this.enemies(p, o)) continue;
        minD = Math.min(minD, Math.hypot(o.pos.x - s.x, o.pos.z - s.z));
      }
      let score = minD + Math.random() * 6;
      if (this.teams) score += s.team === p.team ? 40 : 0;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  respawn(p) {
    const s = this.pickSpawn(p);
    p.hp = 100;
    p.alive = true;
    p.pos = { x: s.x + (Math.random() - 0.5), y: s.y, z: s.z + (Math.random() - 0.5) };
    p.yaw = s.yaw;
    if (p.bot) {
      p.vel = { x: 0, y: 0, z: 0 };
      p.w = this.botWeapon();
      Object.assign(p.brain, { target: null, path: null, ammo: WEAPONS[p.w].mag, reloadUntil: 0 });
    }
    this.emit({ t: 'spawn', id: p.id, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], yaw: r2(p.yaw), w: p.w });
  }

  // ts — время отправителя (мс по его часам), пересылается как есть: получатель сам сводит часы.
  // Прямым соединениям состояние уходит сразу, без ожидания тика хоста.
  onState(id, s) {
    const p = this.players.get(id);
    if (!p || !p.alive || !vec3(s.p) || !(s.ts > p.ts)) return;
    p.ts = s.ts;
    p.pos.x = s.p[0]; p.pos.y = s.p[1]; p.pos.z = s.p[2];
    p.v = vec3(s.v) ? s.v : [0, 0, 0];
    p.yaw = s.yaw; p.pitch = s.pitch; p.w = s.w; p.c = s.c ? 1 : 0;
    this.emit({ t: 'st', s: [this.stateEntry(p)] }, id, 'p2p');
  }

  stateEntry(p) {
    const v = p.bot ? [r1(p.vel.x), r1(p.vel.y), r1(p.vel.z)] : p.v;
    return [p.id, p.ts, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), v[0], v[1], v[2], r2(p.yaw), r2(p.pitch), p.w, p.c];
  }

  // P2P-получатели людей уже получили из onState, им — только боты; через брокер — всё новое одним пакетом
  sendStates(route) {
    const s = [];
    for (const p of this.players.values()) {
      if (!p.alive || (route === 'p2p' ? !p.bot : p.ts <= p.relayTs)) continue;
      if (route === 'relay') p.relayTs = p.ts;
      s.push(this.stateEntry(p));
    }
    if (s.length) this.emit({ t: 'st', s }, undefined, route);
  }

  onShot(id, msg) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const out = { t: 'shot', id, w: msg.w };
    if (Array.isArray(msg.e)) out.e = msg.e;
    if (typeof msg.pid === 'string' && Array.isArray(msg.o) && Array.isArray(msg.v)) {
      out.pid = msg.pid.slice(0, 80);
      out.o = msg.o;
      out.v = msg.v;
    }
    this.emit(out, id);
  }

  onBoom(id, msg) {
    if (!this.players.has(id) || !Array.isArray(msg.p)) return;
    this.emit({ t: 'boom', id, pid: String(msg.pid).slice(0, 80), w: msg.w, p: msg.p, n: Array.isArray(msg.n) ? msg.n : [0, 1, 0] }, id);
  }

  onHit(id, msg) {
    const a = this.players.get(id);
    const v = this.players.get(msg.v);
    if (!a || !v || !a.alive || !v.alive) return;
    const def = WEAPONS[msg.w];
    if (!def) return;
    const max = def.damage * def.head * def.pellets;
    let kb = null;
    if (Array.isArray(msg.kb) && msg.kb.length === 3 && msg.kb.every(Number.isFinite)) {
      const len = Math.hypot(...msg.kb);
      kb = len > 20 ? msg.kb.map((c) => c * (20 / len)) : msg.kb;
    }
    this.damage(a, v, Math.min(max, Math.max(0, msg.d)), !!msg.h, msg.w, kb);
  }

  damage(a, v, amount, head, w, kb = null) {
    if (!v.alive || !this.enemies(a, v) || this.over) return;
    v.hp = Math.max(0, v.hp - amount);
    const hp = { t: 'hp', id: v.id, hp: Math.round(v.hp), by: a.id, from: [r2(a.pos.x), r2(a.pos.z)], h: head };
    if (kb) {
      hp.kb = kb.map(r2);
      if (v.bot) { v.vel.x += kb[0]; v.vel.y += kb[1]; v.vel.z += kb[2]; }
    }
    this.emit(hp);
    if (v.bot && !v.brain.target) { v.brain.target = a.id; v.brain.seenAt = this.time + this.skill.reaction * 0.5; }
    if (v.hp > 0) return;
    v.alive = false;
    v.deaths++;
    a.kills++;
    v.respawnAt = this.time + RESPAWN_DELAY;
    this.emit({ t: 'kill', k: a.id, v: v.id, w, h: head, kk: a.kills, vd: v.deaths });
    if (a.alive) {
      a.hp = Math.min(100, a.hp + KILL_HEAL);
      this.emit({ t: 'hp', id: a.id, hp: Math.round(a.hp) });
    }
    this.checkEnd();
  }

  onPick(id, i) {
    const p = this.players.get(id);
    const pk = this.pickups[i];
    const at = this.map.pickups[i];
    if (!p || !pk || !pk.on || !p.alive || p.hp >= 100) return;
    if (Math.hypot(p.pos.x - at.x, p.pos.y - at.y, p.pos.z - at.z) > 3) return;
    pk.on = false;
    pk.at = this.time + PICKUP_RESPAWN;
    p.hp = Math.min(100, p.hp + PICKUP_HEAL);
    this.emit({ t: 'pk', i, on: false, id, hp: p.hp });
  }

  teamScores() {
    const s = [0, 0];
    for (const p of this.players.values()) s[p.team] += p.kills;
    return s;
  }

  checkEnd() {
    const limit = this.settings.scoreLimit;
    let done = false;
    if (this.teams) done = this.teamScores().some((v) => v >= limit);
    else for (const p of this.players.values()) if (p.kills >= limit) done = true;
    if (done) this.finish();
  }

  finish() {
    if (this.over) return;
    this.over = true;
    const results = this.roster().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.emit({ t: 'end', results, teams: this.teams ? this.teamScores() : null });
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;
    const now = Math.round(performance.now());
    for (const p of this.players.values()) {
      if (!p.alive && p.respawnAt && this.time >= p.respawnAt) {
        p.respawnAt = 0;
        this.respawn(p);
      }
      if (p.bot && p.alive) {
        this.updateBot(p, dt);
        p.ts = now;
      }
    }
    this.pickups.forEach((pk, i) => {
      if (!pk.on && this.time >= pk.at) {
        pk.on = true;
        this.emit({ t: 'pk', i, on: true });
      }
    });
    this.clockAcc += dt;
    if (this.clockAcc >= 1) {
      this.clockAcc = 0;
      this.emit({ t: 'clock', left: Math.max(0, this.endAt - this.time) });
    }
    if (this.time >= this.endAt) {
      this.finish();
      return;
    }
    this.stateAcc += dt;
    if (this.stateAcc >= STATE_RATE) {
      this.stateAcc = Math.min(this.stateAcc - STATE_RATE, STATE_RATE);
      this.sendStates('p2p');
    }
    this.relayAcc += dt;
    if (this.relayAcc >= RELAY_STATE_RATE) {
      this.relayAcc = Math.min(this.relayAcc - RELAY_STATE_RATE, RELAY_STATE_RATE);
      this.sendStates('relay');
    }
  }

  visibleEnemy(b) {
    const eye = [b.pos.x, b.pos.y + 1.6, b.pos.z];
    let best = null;
    let bestD = Infinity;
    for (const o of this.players.values()) {
      if (!o.alive || !this.enemies(b, o)) continue;
      const d = Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y, o.pos.z - b.pos.z);
      if (d > 70 || d >= bestD) continue;
      if (!lineOfSight(this.map.colliders, eye, [o.pos.x, o.pos.y + 1.3, o.pos.z])) continue;
      best = o;
      bestD = d;
    }
    return best ? { o: best, d: bestD } : null;
  }

  // Граф нужен только ботам, поэтому строится при первом выборе маршрута, а не на старте матча.
  get nav() {
    if (!this.navGraph) {
      const nav = navFor(this.map);
      const home = nav.reach(this.map.spawns.map((sp) => nav.nearest(sp.x, sp.y, sp.z)).filter(Boolean), false, true);
      this.roam = nav.nodes.filter((n) => n.inside && home[n.id] && n.h === STAND_HEIGHT);
      this.navGraph = nav;
    }
    return this.navGraph;
  }

  // Цель: аптечка при малом здоровье, иначе с вероятностью 0.6 — окрестность противника, иначе случайная точка.
  // Маршрут строится по навигационному графу, поэтому боты ходят по лестницам, крышам и мостам.
  chooseWaypoint(b) {
    const br = b.brain;
    const nav = this.nav;
    let goal = null;
    if (b.hp < 55) {
      let bd = 25;
      this.map.pickups.forEach((pk, i) => {
        const d = Math.hypot(pk.x - b.pos.x, pk.y - b.pos.y, pk.z - b.pos.z);
        if (this.pickups[i].on && d < bd) { bd = d; goal = nav.nearest(pk.x, pk.y + 0.1, pk.z); }
      });
    }
    const prey = [...this.players.values()].filter((o) => o.alive && this.enemies(b, o));
    if (!goal && prey.length && Math.random() < 0.6) {
      const o = prey[Math.floor(Math.random() * prey.length)];
      goal = nav.nearest(o.pos.x + (Math.random() - 0.5) * 8, o.pos.y + 0.5, o.pos.z + (Math.random() - 0.5) * 8, 8);
    }
    for (let i = 0; !goal && i < 12; i++) {
      const n = this.roam[Math.floor(Math.random() * this.roam.length)];
      const d = Math.hypot(n.x - b.pos.x, n.z - b.pos.z);
      if (d >= 6 && d <= 30) goal = n;
    }
    goal ||= this.roam[Math.floor(Math.random() * this.roam.length)];
    br.goal = goal;
    br.replans = 0;
    this.planPath(b);
  }

  planPath(b) {
    const br = b.brain;
    const nav = this.nav;
    const path = nav.simplify(nav.path(nav.nearest(b.pos.x, b.pos.y, b.pos.z), br.goal));
    br.path = path && path.length > 1 ? path : null;
    br.k = 1;
    br.kT = 0;
  }

  updateBot(b, dt) {
    const br = b.brain;
    const sk = this.skill;
    const def = WEAPONS[b.w];
    const seen = this.visibleEnemy(b);
    if (seen && br.target !== seen.o.id) {
      br.target = seen.o.id;
      br.seenAt = this.time + sk.reaction * (0.7 + Math.random() * 0.6);
    }
    if (!seen && br.target) br.target = null;

    let moveX = 0;
    let moveZ = 0;
    let wantYaw = b.yaw;
    let speed = 3.68;
    let jump = false;

    if (seen) {
      const o = seen.o;
      const dx = o.pos.x - b.pos.x;
      const dz = o.pos.z - b.pos.z;
      const hd = Math.hypot(dx, dz) || 1;
      wantYaw = Math.atan2(-dx, -dz);
      b.pitch = Math.atan2(o.pos.y + 1.2 - (b.pos.y + 1.6), hd);
      const pref = PREFERRED_RANGE[def.id];
      const fx = dx / hd;
      const fz = dz / hd;
      const forward = seen.d > pref + 3 ? 1 : seen.d < pref - 3 ? -0.6 : 0;
      br.strafeT -= dt;
      if (br.strafeT <= 0) { br.strafe = Math.random() < 0.5 ? -1 : 1; br.strafeT = 0.6 + Math.random(); }
      moveX = fx * forward + -fz * br.strafe * 0.8;
      moveZ = fz * forward + fx * br.strafe * 0.8;
      speed = 3.04;

      let yawErr = wantYaw - b.yaw;
      yawErr = Math.atan2(Math.sin(yawErr), Math.cos(yawErr));
      if (this.time >= br.reloadUntil && br.ammo <= 0) br.ammo = def.mag;
      const canFire = this.time >= br.seenAt && this.time >= br.nextShot && this.time >= br.reloadUntil && Math.abs(yawErr) < 0.2;
      if (canFire) this.botFire(b, o, seen.d, def);
    } else {
      b.pitch *= 0.9;
      // Сорвался ниже маршрута или долго не может дойти до точки — маршрут заново, к той же цели дважды.
      const cur = br.path?.[br.k];
      const fell = cur && br.onGround && b.pos.y < Math.min(cur.node.y, br.path[br.k - 1].node.y) - 0.8;
      const slow = cur && br.kT > 2 + Math.hypot(cur.node.x - b.pos.x, cur.node.z - b.pos.z) / 2;
      if (br.path && (fell || slow || br.stuck > 1.2) && br.replans < 2) {
        br.replans++;
        br.stuck = 0;
        this.planPath(b);
      } else if (!br.path || fell || slow || br.stuck > 1.2) {
        br.stuck = 0;
        this.chooseWaypoint(b);
      }
      br.kT += dt;
      const step = br.path?.[br.k];
      if (step) {
        const n = step.node;
        const dx = n.x - b.pos.x;
        const dz = n.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        // В прыжке точка засчитывается только на её уровне, иначе бот сворачивает раньше времени и падает.
        if (d < 0.4 && (br.onGround ? Math.abs(n.y - b.pos.y) < 0.7 : b.pos.y > n.y - 0.1)) {
          br.k++;
          br.kT = 0;
          if (br.k >= br.path.length) br.path = null;
        } else {
          moveX = dx / (d || 1);
          moveZ = dz / (d || 1);
          wantYaw = Math.atan2(-dx, -dz);
          const from = br.path[br.k - 1].node;
          if (step.kind === JUMP && (Math.hypot(from.x - b.pos.x, from.z - b.pos.z) < 0.35 || (n.y > b.pos.y + 0.5 && d < 1))) jump = true;
        }
      }
    }

    let dy = wantYaw - b.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    b.yaw += Math.sign(dy) * Math.min(Math.abs(dy), sk.turn * dt);

    const len = Math.hypot(moveX, moveZ);
    if (len > 1) { moveX /= len; moveZ /= len; }
    const v = b.vel;
    v.x += (moveX * speed - v.x) * Math.min(1, dt * 10);
    v.z += (moveZ * speed - v.z) * Math.min(1, dt * 10);
    if (jump && br.onGround) v.y = JUMP_SPEED;
    v.y -= GRAVITY * dt;
    const bx = b.pos.x;
    const bz = b.pos.z;
    br.onGround = moveBody(this.map.colliders, b.pos, v, dt, PLAYER_RADIUS, STAND_HEIGHT, br.onGround);
    const moved = Math.hypot(b.pos.x - bx, b.pos.z - bz);
    if (len > 0.3 && moved < speed * dt * 0.3) {
      br.stuck += dt;
      if (br.onGround && br.stuck > 0.4) v.y = JUMP_SPEED;
    } else {
      br.stuck = Math.max(0, br.stuck - dt);
    }

    this.map.pickups.forEach((pk, i) => {
      if (this.pickups[i].on && b.hp < 100 && Math.hypot(pk.x - b.pos.x, pk.y - b.pos.y, pk.z - b.pos.z) < 1.3) this.onPick(b.id, i);
    });
  }

  botFire(b, o, dist, def) {
    const br = b.brain;
    const sk = this.skill;
    br.nextShot = this.time + Math.max(0.1, def.fireRate * sk.fireMul * (def.auto ? 1 : 1.3));
    br.ammo--;
    if (br.ammo <= 0) br.reloadUntil = this.time + def.reload;
    const moving = Math.hypot(o.vel?.x || 0, o.vel?.z || 0) > 1 ? 0.85 : 1;
    const falloff = def.id === 'shotgun' ? Math.max(0, 1 - dist / 22) : def.id === 'sniper' ? 1 : Math.max(0.25, 1 - dist / 70);
    const p = sk.acc * falloff * moving;
    let dmg = 0;
    let head = false;
    for (let i = 0; i < def.pellets; i++) {
      if (Math.random() < p) {
        const h = Math.random() < sk.head;
        head = head || h;
        dmg += def.damage * (h ? def.head : 1);
      }
    }
    const miss = dmg ? 0 : 1;
    const e = [
      r2(o.pos.x + (Math.random() - 0.5) * 1.6 * miss),
      r2(o.pos.y + 1.2 + (Math.random() - 0.3) * 1.2 * miss),
      r2(o.pos.z + (Math.random() - 0.5) * 1.6 * miss),
    ];
    this.emit({ t: 'shot', id: b.id, w: b.w, e });
    if (dmg) this.damage(b, o, dmg, head, b.w);
  }
}
