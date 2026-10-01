import * as THREE from 'three';
import { rocketModel, grenade } from './weapons-extra.js';
import { raycastWorld, rayPlayer, STAND_HEIGHT, CROUCH_HEIGHT } from './physics.js';
import { addOutlines } from './outline.js';

const GRENADE_GRAVITY = 18;
const ROCKET_GRAVITY = 1.5;

// Ракеты и гранаты. Свои снаряды наносят урон (onExplode с local=true),
// чужие только показываются и исчезают по сообщению владельца о взрыве.
export class Projectiles {
  constructor(scene, effects, mats) {
    this.scene = scene;
    this.effects = effects;
    this.mats = mats;
    this.list = [];
    this.onExplode = () => {};
  }

  makeMesh(kind) {
    const m = kind === 'rocket' ? rocketModel(this.mats) : grenade(this.mats);
    addOutlines(m, kind === 'rocket' ? 0.01 : 0.006);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return m;
  }

  spawn({ pid, kind, owner, def, pos, vel, local, fuse }) {
    const mesh = this.makeMesh(kind);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.list.push({ pid, kind, owner, def, pos: pos.clone(), vel: vel.clone(), local, mesh, age: 0, fuse: fuse ?? def.fuse ?? 6, trailT: 0, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0) });
  }

  remove(p) {
    this.scene.remove(p.mesh);
    p.dead = true;
  }

  removeByPid(pid) {
    const p = this.list.find((x) => x.pid === pid);
    if (p) this.remove(p);
    return p;
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list = [];
  }

  update(dt, colliders, avatars) {
    for (const p of this.list) {
      if (p.dead) continue;
      p.age += dt;
      if (p.kind === 'rocket') this.updateRocket(p, dt, colliders, avatars);
      else this.updateGrenade(p, dt, colliders);
    }
    this.list = this.list.filter((p) => !p.dead);
  }

  explode(p, point, normal, direct) {
    this.remove(p);
    this.onExplode(p, point, normal, direct);
  }

  updateRocket(p, dt, colliders, avatars) {
    p.vel.y -= ROCKET_GRAVITY * dt;
    const step = p.vel.length() * dt;
    const dir = p.vel.clone().normalize();
    const o = [p.pos.x, p.pos.y, p.pos.z];
    const d = [dir.x, dir.y, dir.z];
    const wh = raycastWorld(colliders, o, d, step);
    let t = wh ? wh.t : Infinity;
    let direct = null;
    if (p.local) {
      for (const [id, av] of avatars) {
        if (av.dead || !av.group.visible || id === p.owner) continue;
        const r = rayPlayer(o, d, av.group.position, av.crouch > 0.5 ? CROUCH_HEIGHT : STAND_HEIGHT);
        if (r && r.t <= step && r.t < t) { t = r.t; direct = id; }
      }
    }
    if (t <= step) {
      const point = p.pos.clone().addScaledVector(dir, t);
      if (!p.local) {
        this.remove(p);
        return;
      }
      this.explode(p, point, wh && !direct ? wh.normal : [-d[0], -d[1], -d[2]], direct);
      return;
    }
    p.pos.addScaledVector(dir, step);
    p.mesh.position.copy(p.pos);
    p.mesh.lookAt(p.pos.clone().sub(dir));
    p.mesh.rotateZ(p.age * 12);
    p.trailT -= dt;
    if (p.trailT <= 0) {
      p.trailT = 0.02;
      this.effects.trail(p.pos.clone().addScaledVector(dir, 0.3));
    }
    if (p.age > 6) {
      if (p.local) this.explode(p, p.pos.clone(), [0, 1, 0], null);
      else this.remove(p);
    }
  }

  updateGrenade(p, dt, colliders) {
    p.vel.y -= GRENADE_GRAVITY * dt;
    const step = p.vel.length() * dt;
    if (step > 1e-5) {
      const dir = p.vel.clone().normalize();
      const wh = raycastWorld(colliders, [p.pos.x, p.pos.y, p.pos.z], [dir.x, dir.y, dir.z], step + 0.06);
      if (wh) {
        p.pos.addScaledVector(dir, Math.max(0, wh.t - 0.06));
        const n = new THREE.Vector3(...wh.normal);
        p.vel.reflect(n).multiplyScalar(0.45);
        if (n.y > 0.6 && Math.abs(p.vel.y) < 1.2) p.vel.y = 0;
      } else {
        p.pos.addScaledVector(dir, step);
      }
    }
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.x += p.spin.x * dt * Math.min(1, p.vel.length() / 3);
    p.mesh.rotation.y += p.spin.y * dt * Math.min(1, p.vel.length() / 3);
    if (p.age >= p.fuse) {
      if (p.local) this.explode(p, p.pos.clone(), [0, 1, 0], null);
      else if (p.age > p.fuse + 2) this.remove(p);
    }
  }
}
