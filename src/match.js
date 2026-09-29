import { WEAPONS, WEAPON_INDEX } from './weapons.js';
import { moveBody, blocked, lineOfSight, PLAYER_RADIUS, STAND_HEIGHT, GRAVITY, JUMP_SPEED } from './physics.js';

export const RESPAWN_DELAY = 3.5;
const PICKUP_RESPAWN = 20;
const PICKUP_HEAL = 50;
const STATE_RATE = 1 / 20;

const BOT_NAMES = ['Ворон', 'Гвоздь', 'Шторм', 'Кактус', 'Бизон', 'Феникс', 'Тень', 'Граф', 'Лис', 'Молот'];
const BOT_SKILL = {
  easy: { reaction: 0.9, acc: 0.22, head: 0.08, turn: 3.5, fireMul: 1.8 },
  normal: { reaction: 0.55, acc: 0.38, head: 0.14, turn: 5, fireMul: 1.35 },
  hard: { reaction: 0.3, acc: 0.55, head: 0.22, turn: 7, fireMul: 1.1 },
};
const PREFERRED_RANGE = { pistol: 12, rifle: 16, shotgun: 5, sniper: 30 };

const r2 = (v) => Math.round(v * 100) / 100;

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
    this.clockAcc = 0;
    this.over = false;
    this.pickups = map.pickups.map(() => ({ on: true, at: 0 }));
    this.nav = this.buildNav();
    for (const p of roster) this.addRecord(p);
  }

  addRecord(p) {
    const rec = {
      ...p,
      hp: 100, alive: false, kills: 0, deaths: 0,
      pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, w: p.bot ? this.botWeapon() : 0, c: 0,
      respawnAt: 0,
    };
    if (p.bot) {
      rec.vel = { x: 0, y: 0, z: 0 };
      rec.brain = { target: null, seenAt: 0, wp: null, strafe: 1, strafeT: 0, nextShot: 0, stuck: 0, ammo: WEAPONS[rec.w].mag, reloadUntil: 0, onGround: false };
    }
    this.players.set(p.id, rec);
    return rec;
  }

  botWeapon() {
    const r = Math.random();
    return r < 0.45 ? WEAPON_INDEX.rifle : r < 0.65 ? WEAPON_INDEX.shotgun : r < 0.85 ? WEAPON_INDEX.pistol : WEAPON_INDEX.sniper;
  }

  buildNav() {
    const pts = [];
    const { colliders, half } = this.map;
    for (let x = -half + 3; x <= half - 3; x += 3.5) {
      for (let z = -half + 3; z <= half - 3; z += 3.5) {
        if (!blocked(colliders, x, 0.05, z, PLAYER_RADIUS + 0.3, STAND_HEIGHT)) pts.push({ x, y: 0, z });
      }
    }
    return pts;
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
      Object.assign(p.brain, { target: null, wp: null, ammo: WEAPONS[p.w].mag, reloadUntil: 0 });
    }
    this.emit({ t: 'spawn', id: p.id, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], yaw: r2(p.yaw), w: p.w });
  }

  onState(id, s) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    p.pos.x = s.p[0]; p.pos.y = s.p[1]; p.pos.z = s.p[2];
    p.yaw = s.yaw; p.pitch = s.pitch; p.w = s.w; p.c = s.c ? 1 : 0;
  }

  onShot(id, msg) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    this.emit({ t: 'shot', id, w: msg.w, e: msg.e }, id);
  }

  onHit(id, msg) {
    const a = this.players.get(id);
    const v = this.players.get(msg.v);
    if (!a || !v || !a.alive || !v.alive) return;
    const def = WEAPONS[msg.w];
    if (!def) return;
    const max = def.damage * def.head * def.pellets;
    this.damage(a, v, Math.min(max, Math.max(0, msg.d)), !!msg.h, msg.w);
  }

  damage(a, v, amount, head, w) {
    if (!v.alive || !this.enemies(a, v) || this.over) return;
    v.hp = Math.max(0, v.hp - amount);
    this.emit({ t: 'hp', id: v.id, hp: Math.round(v.hp), by: a.id, from: [r2(a.pos.x), r2(a.pos.z)], h: head });
    if (v.bot && !v.brain.target) { v.brain.target = a.id; v.brain.seenAt = this.time + this.skill.reaction * 0.5; }
    if (v.hp > 0) return;
    v.alive = false;
    v.deaths++;
    a.kills++;
    v.respawnAt = this.time + RESPAWN_DELAY;
    this.emit({ t: 'kill', k: a.id, v: v.id, w, h: head, kk: a.kills, vd: v.deaths });
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
    for (const p of this.players.values()) {
      if (!p.alive && p.respawnAt && this.time >= p.respawnAt) {
        p.respawnAt = 0;
        this.respawn(p);
      }
      if (p.bot && p.alive) this.updateBot(p, dt);
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
      this.stateAcc = 0;
      const s = [];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        s.push([p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.yaw), r2(p.pitch), p.w, p.c]);
      }
      this.emit({ t: 'st', s });
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

  chooseWaypoint(b) {
    const br = b.brain;
    if (b.hp < 55) {
      let best = null;
      let bd = Infinity;
      this.map.pickups.forEach((pk, i) => {
        if (!this.pickups[i].on || pk.y > 0.5) return;
        const d = Math.hypot(pk.x - b.pos.x, pk.z - b.pos.z);
        if (d < bd && lineOfSight(this.map.colliders, [b.pos.x, b.pos.y + 0.9, b.pos.z], [pk.x, 0.9, pk.z])) { bd = d; best = pk; }
      });
      if (best) { br.wp = { x: best.x, z: best.z }; return; }
    }
    const from = [b.pos.x, b.pos.y + 0.9, b.pos.z];
    const options = [];
    for (let i = 0; i < 24; i++) {
      const n = this.nav[Math.floor(Math.random() * this.nav.length)];
      const d = Math.hypot(n.x - b.pos.x, n.z - b.pos.z);
      if (d < 4 || d > 30) continue;
      if (lineOfSight(this.map.colliders, from, [n.x, 0.9, n.z])) options.push(n);
      if (options.length >= 3) break;
    }
    const n = options[0] || this.nav[Math.floor(Math.random() * this.nav.length)];
    br.wp = { x: n.x, z: n.z };
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
    let speed = 4.6;

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
      speed = 3.8;

      let yawErr = wantYaw - b.yaw;
      yawErr = Math.atan2(Math.sin(yawErr), Math.cos(yawErr));
      if (this.time >= br.reloadUntil && br.ammo <= 0) br.ammo = def.mag;
      const canFire = this.time >= br.seenAt && this.time >= br.nextShot && this.time >= br.reloadUntil && Math.abs(yawErr) < 0.2;
      if (canFire) this.botFire(b, o, seen.d, def);
    } else {
      b.pitch *= 0.9;
      if (!br.wp || Math.hypot(br.wp.x - b.pos.x, br.wp.z - b.pos.z) < 1.2 || br.stuck > 1.2) {
        br.stuck = 0;
        this.chooseWaypoint(b);
      }
      const dx = br.wp.x - b.pos.x;
      const dz = br.wp.z - b.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      moveX = dx / d;
      moveZ = dz / d;
      wantYaw = Math.atan2(-dx, -dz);
    }

    let dy = wantYaw - b.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    b.yaw += Math.sign(dy) * Math.min(Math.abs(dy), sk.turn * dt);

    const len = Math.hypot(moveX, moveZ);
    if (len > 1) { moveX /= len; moveZ /= len; }
    const v = b.vel;
    v.x += (moveX * speed - v.x) * Math.min(1, dt * 10);
    v.z += (moveZ * speed - v.z) * Math.min(1, dt * 10);
    v.y -= GRAVITY * dt;
    const bx = b.pos.x;
    const bz = b.pos.z;
    br.onGround = moveBody(this.map.colliders, b.pos, v, dt, PLAYER_RADIUS, STAND_HEIGHT, true);
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
    br.nextShot = this.time + def.fireRate * sk.fireMul * (def.auto ? 1 : 1.3);
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
