// Буфер состояний удалённого игрока. Без зависимостей: используется avatar.js и тестами в Node.
// Снимки приходят с временем отправителя t (секунды по его часам). Смещение часов off — сглаженный
// минимум (приход − t), то есть самый быстрый путь. Показываем момент rt = now − off − delay
// в шкале отправителя; delay подстраивается под измеренный разброс прихода, а часы показа
// догоняют цель плавно (±20% скорости), без скачков времени.

export const DELAY_MIN = 0.07;
export const DELAY_MAX = 0.3;
export const EXTRAP_MAX = 0.2;
export const SNAP_DIST = 3;

const MARGIN = 0.015;
const OFF_DRIFT = 0.004; // с/с: минимум медленно отпускает вверх, если путь стал длиннее
const JIT_DECAY = 0.04; // с/с: пик разброса забывается за несколько секунд
const STEER = 3;
const RATE_DEV = 0.2;
const BLEND = 0.1; // постоянная времени (с) догонки после поправки
const KEEP = 64;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

export class Track {
  constructor({ gravity = 0 } = {}) {
    this.gravity = gravity;
    this.snaps = [];
    this.off = null;
    this.lastRecv = 0;
    this.jit = 0;
    this.iv = 1 / 30;
    this.delay = DELAY_MIN;
    this.rt = null;
    this.now = null;
    this.floor = -Infinity;
    this.hold = false;
    this.err = [0, 0, 0];
    this.yawErr = 0;
    this.out = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, c: 0, extrap: false };
    this.raw = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, c: 0, extrap: false };
  }

  // s: { t, x, y, z, vx, vy, vz, yaw, pitch, c }, recv — локальное время прихода (с)
  push(s, recv) {
    const sn = this.snaps;
    if (s.t < this.floor) return false;
    let i = sn.length;
    while (i > 0 && sn[i - 1].t > s.t) i--;
    if (i > 0 && sn[i - 1].t === s.t) return false;
    const o = recv - s.t;
    if (this.off === null) this.off = o;
    else this.off = Math.min(o, this.off + OFF_DRIFT * Math.max(0, recv - this.lastRecv));
    this.lastRecv = recv;
    this.jit = Math.max(this.jit, Math.min(o - this.off, DELAY_MAX));
    if (i === sn.length && i > 0) this.iv += (Math.min(0.25, s.t - sn[i - 1].t) - this.iv) * 0.1;
    const before = this.rt !== null && sn.length ? this.sample(this.rt, this.raw) : null;
    const bx = before?.x;
    const by = before?.y;
    const bz = before?.z;
    const byaw = before?.yaw;
    sn.splice(i, 0, s);
    if (sn.length > KEEP) sn.shift();
    if (before) {
      const a = this.sample(this.rt, this.raw);
      const e = this.err;
      e[0] += bx - a.x;
      e[1] += by - a.y;
      e[2] += bz - a.z;
      this.yawErr = wrap(this.yawErr + byaw - a.yaw);
      if (Math.hypot(e[0], e[1], e[2]) > SNAP_DIST) this.clearErr();
    }
    return true;
  }

  clearErr() {
    this.err[0] = this.err[1] = this.err[2] = 0;
    this.yawErr = 0;
  }

  // Телепорт или возрождение: старые снимки и пакеты, отправленные до него, больше не нужны
  reset() {
    this.snaps.length = 0;
    this.clearErr();
    this.hold = false;
    if (this.off !== null && this.now !== null) this.floor = this.now - this.off - 0.5;
  }

  // Не экстраполировать дальше последнего снимка (смерть)
  stop() {
    this.hold = true;
  }

  target(now) {
    return now - this.off - this.delay;
  }

  sample(rt, out) {
    const sn = this.snaps;
    const n = sn.length;
    out.extrap = false;
    if (rt <= sn[0].t) return this.put(out, sn[0]);
    const last = sn[n - 1];
    if (rt >= last.t) {
      this.put(out, last);
      if (this.hold) return out;
      const te = Math.min(rt - last.t, EXTRAP_MAX);
      out.x += last.vx * te;
      out.z += last.vz * te;
      if (last.vy) out.y += last.vy * te - 0.5 * this.gravity * te * te;
      out.extrap = te > 0;
      return out;
    }
    let j = n - 1;
    while (sn[j - 1].t > rt) j--;
    const a = sn[j - 1];
    const b = sn[j];
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > SNAP_DIST) return this.put(out, a);
    const k = (rt - a.t) / (b.t - a.t);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
    out.pitch = a.pitch + (b.pitch - a.pitch) * k;
    out.c = k < 0.5 ? a.c : b.c;
    return out;
  }

  put(out, s) {
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.yaw = s.yaw;
    out.pitch = s.pitch;
    out.c = s.c;
    return out;
  }

  // now — локальное время (с). Возвращает позу для показа или null, пока снимков нет.
  update(now) {
    const sn = this.snaps;
    const dt = this.now === null ? 0 : clamp(now - this.now, 0, 1);
    this.now = now;
    if (this.off === null) return null;
    this.jit = Math.max(0, this.jit - JIT_DECAY * dt);
    const want = clamp(this.iv + this.jit + MARGIN, DELAY_MIN, DELAY_MAX);
    this.delay += (want - this.delay) * Math.min(1, dt * (want > this.delay ? 4 : 0.5));
    const target = this.target(now);
    if (this.rt === null || Math.abs(target - this.rt) > 1) this.rt = target;
    else this.rt += dt * (1 + clamp((target - this.rt - dt) * STEER, -RATE_DEV, RATE_DEV));
    if (!sn.length) return null;
    while (sn.length > 2 && sn[1].t < this.rt - 1) sn.shift();
    const raw = this.sample(this.rt, this.raw);
    const e = this.err;
    const f = Math.exp(-dt / BLEND);
    e[0] *= f;
    e[1] *= f;
    e[2] *= f;
    this.yawErr *= f;
    const out = this.out;
    out.x = raw.x + e[0];
    out.y = raw.y + e[1];
    out.z = raw.z + e[2];
    out.yaw = wrap(raw.yaw + this.yawErr);
    out.pitch = raw.pitch;
    out.c = raw.c;
    out.extrap = raw.extrap;
    return out;
  }
}
