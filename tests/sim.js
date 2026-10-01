import { Track } from '../src/interp.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPEED = 7.6;
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

// Траектории: pos(t), vel(t), yaw(t) и «прогресс» — монотонная координата вдоль пути (с)
export const PATHS = {
  line: {
    pos: (t) => [SPEED * t, 0, 0],
    vel: () => [SPEED, 0, 0],
    yaw: () => -Math.PI / 2,
    speed: () => SPEED,
    progress: (p) => p[0] / SPEED,
  },
  circle: {
    r: 6,
    pos(t) { const a = (SPEED / this.r) * t; return [this.r * Math.cos(a), 0, this.r * Math.sin(a)]; },
    vel(t) { const a = (SPEED / this.r) * t; return [-SPEED * Math.sin(a), 0, SPEED * Math.cos(a)]; },
    yaw(t) { const v = this.vel(t); return Math.atan2(-v[0], -v[2]); },
    speed: () => SPEED,
    progress(p, prev) {
      const a = Math.atan2(p[2], p[0]);
      const base = prev * (SPEED / this.r);
      return (base + wrap(a - base)) / (SPEED / this.r);
    },
  },
  strafe: {
    pos: (t) => [3 * t, 0, 1.5 * Math.sin((t * Math.PI * 2) / 1.2)],
    vel: (t) => [3, 0, 1.5 * ((Math.PI * 2) / 1.2) * Math.cos((t * Math.PI * 2) / 1.2)],
    yaw: () => -Math.PI / 2,
    speed(t) { return Math.hypot(...this.vel(t)); },
    progress: (p) => p[0] / 3,
  },
};

// Сетевые профили: задержка пакета (с) или null — потерян; dup — копия пакета
export const PROFILES = {
  clean: { rate: 1 / 30, minLat: 0.035, make: (r) => () => [0.04 + (r() - 0.5) * 0.01] },
  relay: {
    rate: 1 / 20,
    minLat: 0.04,
    make(r) {
      let stallAt = 2 + r() * 4;
      return (sent) => {
        if (r() < 0.05) return [];
        let arrive = sent + 0.12 + (r() - 0.5) * 0.16;
        while (sent > stallAt + 0.3) stallAt += 2 + r() * 5;
        if (arrive >= stallAt && arrive < stallAt + 0.3) arrive = stallAt + 0.3 + r() * 0.004;
        return [arrive - sent];
      };
    },
  },
  dupes: {
    rate: 1 / 30,
    minLat: 0.03,
    make: (r) => () => {
      let d = 0.05 + (r() - 0.5) * 0.04;
      if (r() < 0.15) d += 0.04 + r() * 0.04;
      return r() < 0.1 ? [d, d + r() * 0.06] : [d];
    },
  },
};

// Старый алгоритм (avatar.js до правки): метка = время прихода, фиксированная задержка 100 мс
export class OldTrack {
  constructor() {
    this.snaps = [];
    this.out = { x: 0, y: 0, z: 0, yaw: 0 };
  }

  push(s, recv) {
    this.snaps.push({ t: recv, x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  update(now) {
    const sn = this.snaps;
    if (!sn.length) return null;
    const renderTime = now - 0.1;
    let a = sn[0];
    let b = sn[sn.length - 1];
    for (let i = sn.length - 1; i > 0; i--) {
      if (sn[i - 1].t <= renderTime) { a = sn[i - 1]; b = sn[i]; break; }
    }
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;
    const o = this.out;
    o.x = a.x + (b.x - a.x) * k;
    o.y = a.y + (b.y - a.y) * k;
    o.z = a.z + (b.z - a.z) * k;
    o.yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
    return o;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

// Отправитель шлёт состояние из своего кадрового цикла (60 Гц) с шагом rate, как game.js.
// Часы отправителя и получателя сдвинуты на skewS/skewR относительно истинного времени.
export function simulate({ path, profile, fps, algo, seed = 1, duration = 30, warmup = 2 }) {
  const P = PATHS[path];
  const prof = PROFILES[profile];
  const r = rng(seed);
  const net = prof.make(r);
  const skewS = 1000 + r() * 500;
  const skewR = 50 + r() * 500;
  const packets = [];
  let acc = 0;
  for (let t = 0; t < duration + 1; t += 1 / 60) {
    acc += 1 / 60;
    if (acc < prof.rate) continue;
    acc = Math.min(acc - prof.rate, prof.rate);
    const p = P.pos(t);
    const v = P.vel(t);
    const msg = JSON.stringify([Math.round((t + skewS) * 1000), r2(p[0]), r2(p[1]), r2(p[2]), r1(v[0]), r1(v[1]), r1(v[2]), r2(wrap(P.yaw(t))), 0, 1, 0]);
    for (const d of net(t)) packets.push({ at: t + d, msg });
  }
  packets.sort((a, b) => a.at - b.at);

  const track = algo === 'old' ? new OldTrack() : new Track();
  const frames = [];
  let k = 0;
  for (let t = 0; t < duration; t += 1 / fps) {
    while (k < packets.length && packets[k].at <= t) {
      const [ts, x, y, z, vx, vy, vz, yaw, pitch, w, c] = JSON.parse(packets[k].msg);
      track.push({ t: ts / 1000, x, y, z, vx, vy, vz, yaw, pitch, w, c }, packets[k].at + skewR);
      k++;
    }
    const o = track.update(t + skewR);
    if (o) frames.push({ t, x: o.x, y: o.y, z: o.z, yaw: o.yaw, rt: track.rt === undefined ? null : track.rt - skewS, delay: track.delay });
  }
  return metrics(P, prof, frames.filter((f) => f.t >= warmup));
}

function metrics(P, prof, frames) {
  let maxErr = 0;
  let maxYawErr = 0;
  let backward = 0;
  let frozen = 0;
  let maxSpeed = 0;
  let minSpeed = Infinity;
  let maxJerk = 0;
  let maxAdded = 0;
  let maxDelay = 0;
  let speedSq = 0;
  const lat = [];
  let prev = null;
  for (const f of frames) {
    const pos = [f.x, f.y, f.z];
    const prog = P.progress(pos, prev ? prev.prog : f.t - 0.1);
    const latency = f.t - prog;
    lat.push(latency);
    maxAdded = Math.max(maxAdded, latency - prof.minLat);
    if (f.rt !== null) {
      const tp = P.pos(f.rt);
      maxErr = Math.max(maxErr, Math.hypot(tp[0] - f.x, tp[1] - f.y, tp[2] - f.z));
      maxYawErr = Math.max(maxYawErr, Math.abs(wrap(P.yaw(f.rt) - f.yaw)));
      maxDelay = Math.max(maxDelay, f.delay);
    }
    const cur = { prog, pos, t: f.t, speed: 0 };
    if (prev) {
      const dt = f.t - prev.t;
      const truth = P.speed(prog);
      cur.speed = Math.hypot(pos[0] - prev.pos[0], pos[1] - prev.pos[1], pos[2] - prev.pos[2]) / dt / truth;
      if (prog < prev.prog - 1e-5) backward++;
      if (cur.speed < 0.25) frozen++;
      speedSq += (cur.speed - 1) ** 2;
      maxSpeed = Math.max(maxSpeed, cur.speed);
      minSpeed = Math.min(minSpeed, cur.speed);
      if (prev.speed) maxJerk = Math.max(maxJerk, Math.abs(cur.speed - prev.speed));
    }
    prev = cur;
  }
  const mean = lat.reduce((a, b) => a + b, 0) / lat.length;
  const std = Math.sqrt(lat.reduce((a, b) => a + (b - mean) ** 2, 0) / lat.length);
  return {
    frames: frames.length,
    meanAdded: mean - prof.minLat,
    maxAdded,
    latStd: std,
    maxErr,
    maxYawErr,
    backward,
    frozen: frozen / Math.max(1, frames.length - 1),
    maxSpeed,
    minSpeed,
    speedRms: Math.sqrt(speedSq / Math.max(1, frames.length - 1)),
    maxJerk,
    maxDelay,
  };
}
