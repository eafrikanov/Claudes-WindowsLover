export const PLAYER_RADIUS = 0.38;
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.25;
export const STEP_HEIGHT = 0.6;
export const GRAVITY = 18;
export const JUMP_SPEED = 8.5;

const EPS = 1e-4;

function overlaps(px, py, pz, r, h, b) {
  return px + r > b.min[0] && px - r < b.max[0] &&
    py + h > b.min[1] && py < b.max[1] &&
    pz + r > b.min[2] && pz - r < b.max[2];
}

export function blocked(colliders, px, py, pz, r, h) {
  for (const b of colliders) if (overlaps(px, py, pz, r, h, b)) return true;
  return false;
}

// Перемещение с разрешением столкновений по осям. Возвращает true, если тело стоит на земле.
export function moveBody(colliders, pos, vel, dt, r, h, canStep) {
  const dist = Math.hypot(vel.x, vel.y, vel.z) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.25));
  const sdt = dt / steps;
  let onGround = false;
  for (let s = 0; s < steps; s++) {
    for (const axis of ['x', 'z']) {
      const d = vel[axis] * sdt;
      if (!d) continue;
      pos[axis] += d;
      const ai = axis === 'x' ? 0 : 2;
      for (const b of colliders) {
        if (!overlaps(pos.x, pos.y, pos.z, r, h, b)) continue;
        const rise = b.max[1] - pos.y;
        if (canStep && rise > 0 && rise <= STEP_HEIGHT && !blocked(colliders, pos.x, b.max[1] + EPS, pos.z, r, h)) {
          pos.y = b.max[1] + EPS;
          continue;
        }
        pos[axis] = d > 0 ? b.min[ai] - r - EPS : b.max[ai] + r + EPS;
        vel[axis] = 0;
      }
    }
    const dy = vel.y * sdt;
    pos.y += dy;
    for (const b of colliders) {
      if (!overlaps(pos.x, pos.y, pos.z, r, h, b)) continue;
      if (dy <= 0) {
        pos.y = b.max[1] + EPS;
        onGround = true;
      } else {
        pos.y = b.min[1] - h - EPS;
      }
      vel.y = 0;
    }
  }
  if (!onGround && vel.y <= 0 && blocked(colliders, pos.x, pos.y - 0.05, pos.z, r, 0.05)) onGround = true;
  return onGround;
}

// Пересечение луча с AABB (метод плит). Возвращает расстояние и нормаль.
export function rayBox(o, d, min, max) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const oi = o[i];
    const di = d[i];
    if (Math.abs(di) < 1e-9) {
      if (oi < min[i] || oi > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - oi) / di;
    let t2 = (max[i] - oi) / di;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = tmin >= 0 ? tmin : 0;
  const normal = [0, 0, 0];
  if (axis >= 0) normal[axis] = sign;
  return { t, normal };
}

export function raycastWorld(colliders, o, d, maxDist) {
  let best = null;
  for (const b of colliders) {
    const hit = rayBox(o, d, b.min, b.max);
    if (hit && hit.t <= maxDist && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

function raySphere(o, d, c, r) {
  const ox = o[0] - c[0];
  const oy = o[1] - c[1];
  const oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

// Хитбоксы: голова (сфера) и туловище с ногами (коробка). pos — точка у ног.
export function rayPlayer(o, d, pos, height) {
  const headY = pos.y + height - 0.2;
  const th = raySphere(o, d, [pos.x, headY, pos.z], 0.24);
  const hb = rayBox(o, d, [pos.x - 0.34, pos.y, pos.z - 0.34], [pos.x + 0.34, headY - 0.2, pos.z + 0.34]);
  if (th !== null && (!hb || th <= hb.t)) return { t: th, head: true };
  if (hb) return { t: hb.t, head: false };
  return null;
}

export function lineOfSight(colliders, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return true;
  d[0] /= len; d[1] /= len; d[2] /= len;
  return !raycastWorld(colliders, a, d, len - 0.05);
}
