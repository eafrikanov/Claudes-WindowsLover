import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.25, 'rgba(20,16,12,0.95)');
  g.addColorStop(0.45, 'rgba(60,50,40,0.5)');
  g.addColorStop(1, 'rgba(60,50,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TMP = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(scene) {
    this.scene = scene;

    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const tg = new THREE.BoxGeometry(0.012, 0.012, 1).translate(0, 0, 0.5);
    this.tracers = Array.from({ length: 32 }, () => {
      const m = new THREE.Mesh(tg, this.tracerMat.clone());
      m.visible = false;
      m.userData.life = 0;
      scene.add(m);
      return m;
    });
    this.tracerIdx = 0;

    const N = 600;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pBase = new Float32Array(N * 3);
    this.pGrav = new Float32Array(N);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.07, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.pIdx = 0;
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -1000;
    scene.add(this.points);

    const holeMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const hg = new THREE.PlaneGeometry(0.11, 0.11);
    this.holes = Array.from({ length: 96 }, () => {
      const m = new THREE.Mesh(hg, holeMat);
      m.visible = false;
      scene.add(m);
      return m;
    });
    this.holeIdx = 0;

    const brass = new THREE.MeshBasicMaterial({ color: 0xf5c451 });
    const sg = new THREE.CylinderGeometry(0.005, 0.005, 0.022, 8);
    this.shells = Array.from({ length: 24 }, () => {
      const m = new THREE.Mesh(sg, brass);
      m.visible = false;
      m.userData = { vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, floor: 0 };
      scene.add(m);
      return m;
    });
    this.shellIdx = 0;

    this.boomLight = new THREE.PointLight(0xffa040, 0, 18, 2);
    scene.add(this.boomLight);
    this.booms = [];
    const scorchMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.85 });
    this.scorches = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), scorchMat);
      m.visible = false;
      scene.add(m);
      return m;
    });
    this.scorchIdx = 0;

    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    this.puffs = Array.from({ length: 90 }, () => {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xd9d4cc, transparent: true, depthWrite: false }));
      m.visible = false;
      m.userData = { life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, base: 0.2 };
      scene.add(m);
      return m;
    });
    this.puffIdx = 0;

    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.beams = Array.from({ length: 10 }, () => {
      const g = new THREE.Group();
      const outer = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.scale.set(0.045, 0.045, 1);
      const inner = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      inner.scale.set(0.015, 0.015, 1);
      g.add(outer, inner);
      g.visible = false;
      g.userData.life = 0;
      scene.add(g);
      return g;
    });
    this.beamIdx = 0;
  }

  tracer(from, to, color = 0xffd890) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const m = this.tracers[this.tracerIdx++ % this.tracers.length];
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, len);
    m.material.color.set(color);
    m.material.opacity = 0.9;
    m.userData.life = 0.07;
    m.visible = true;
  }

  particles(pos, normal, count, color, speed, spread, gravity, life, size = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.pIdx++ % this.pN;
      this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.pVel[i * 3] = (normal.x + (Math.random() - 0.5) * spread) * v;
      this.pVel[i * 3 + 1] = (normal.y + (Math.random() - 0.3) * spread) * v;
      this.pVel[i * 3 + 2] = (normal.z + (Math.random() - 0.5) * spread) * v;
      const c = color.clone ? color : new THREE.Color(color);
      const j = 0.75 + Math.random() * 0.5;
      this.pBase[i * 3] = c.r * j * size; this.pBase[i * 3 + 1] = c.g * j * size; this.pBase[i * 3 + 2] = c.b * j * size;
      this.pLife[i] = this.pMax[i] = life * (0.6 + Math.random() * 0.6);
      this.pGrav[i] = gravity;
    }
  }

  impact(point, normal) {
    const n = TMP.set(normal[0], normal[1], normal[2]);
    this.particles(point, n, 7, new THREE.Color(1, 0.6, 0.2), 5, 1.4, 12, 0.25, 1.4);
    this.particles(point, n, 5, new THREE.Color(0.35, 0.32, 0.28), 1.2, 1.2, 1, 0.6, 0.6);
    const h = this.holes[this.holeIdx++ % this.holes.length];
    h.position.copy(point).addScaledVector(n, 0.005);
    h.quaternion.setFromUnitVectors(Z, n);
    h.rotateZ(Math.random() * Math.PI);
    h.visible = true;
  }

  blood(point, dir) {
    const n = TMP.copy(dir).multiplyScalar(-0.3);
    n.y += 0.3;
    this.particles(point, n, 10, new THREE.Color(0.5, 0.02, 0.02), 3, 1.6, 8, 0.4, 0.8);
  }

  shell(origin, right, up) {
    const s = this.shells[this.shellIdx++ % this.shells.length];
    s.position.copy(origin);
    s.userData.vel.copy(right).multiplyScalar(1.6 + Math.random()).addScaledVector(up, 1.6 + Math.random());
    s.userData.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    s.userData.life = 1.2;
    s.userData.floor = origin.y - 1.4;
    s.visible = true;
  }

  puff(pos, { size = 0.3, grow = 2, life = 1.2, color = 0xd9d4cc, vel = null, opacity = 0.85 } = {}) {
    const m = this.puffs[this.puffIdx++ % this.puffs.length];
    const u = m.userData;
    m.position.copy(pos);
    m.material.color.set(color);
    m.material.opacity = opacity;
    u.opacity = opacity;
    u.life = u.max = life * (0.8 + Math.random() * 0.4);
    u.base = size;
    u.grow = grow;
    u.vel.copy(vel || new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4));
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.scale.setScalar(size);
    m.visible = true;
  }

  trail(pos) {
    this.puff(pos, { size: 0.12, grow: 1.8, life: 0.9, color: 0xeeeae2, vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.3, (Math.random() - 0.5) * 0.3) });
    this.particles(pos, TMP.set(0, 0, 0), 1, new THREE.Color(1, 0.6, 0.15), 0.6, 2, 0, 0.12, 2);
  }

  beam(from, to) {
    const b = this.beams[this.beamIdx++ % this.beams.length];
    b.position.copy(from);
    b.lookAt(to);
    b.scale.set(1, 1, from.distanceTo(to));
    b.userData.life = 0.14;
    b.visible = true;
    this.particles(to, TMP.set(0, 1, 0), 6, new THREE.Color(0.2, 0.9, 1), 3, 1.6, 4, 0.25, 1.6);
  }

  explosion(pos, normal, scale = 1) {
    let e = this.booms.find((b) => !b.visible);
    if (!e) {
      e = new THREE.Group();
      const sphere = new THREE.IcosahedronGeometry(1, 2);
      const fire = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, depthWrite: false }));
      const core = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffef7a, transparent: true, depthWrite: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      e.add(fire, core, ring);
      e.userData = { fire, core, ring, t: 0, scale: 1 };
      this.scene.add(e);
      this.booms.push(e);
    }
    const n = TMP.set(normal[0], normal[1], normal[2]);
    e.position.copy(pos).addScaledVector(n, 0.3 * scale);
    e.userData.ring.quaternion.setFromUnitVectors(Z, n);
    e.userData.t = 0;
    e.userData.scale = scale;
    e.visible = true;
    for (let i = 0; i < 9; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().addScaledVector(n, 0.6);
      this.puff(e.position.clone().addScaledVector(dir, 0.6 * scale), {
        size: (0.5 + Math.random() * 0.5) * scale, grow: 2.2, life: 1.6 + Math.random() * 0.8,
        color: Math.random() < 0.5 ? 0x8a8288 : 0x5e5862, vel: dir.multiplyScalar(2.2 * scale).setY(1.2 + Math.random()), opacity: 0.9,
      });
    }
    this.particles(e.position, n, 40, new THREE.Color(1, 0.65, 0.2), 14 * scale, 2.2, 14, 0.7, 2.2);
    this.particles(e.position, n, 16, new THREE.Color(1, 0.9, 0.5), 7 * scale, 2, 6, 0.4, 2.5);
    const s = this.scorches[this.scorchIdx++ % this.scorches.length];
    s.position.copy(pos).addScaledVector(n, 0.02);
    s.quaternion.setFromUnitVectors(Z, n);
    s.rotateZ(Math.random() * Math.PI);
    s.scale.setScalar(scale);
    s.visible = true;
    this.boomLight.position.copy(e.position);
    this.boomLight.intensity = 80 * scale;
  }

  update(dt) {
    for (const e of this.booms) {
      if (!e.visible) continue;
      const u = e.userData;
      u.t += dt;
      const t = u.t;
      const s = u.scale;
      const grow = 1 - Math.pow(1 - Math.min(1, t / 0.18), 3);
      const fade = Math.max(0, 1 - Math.max(0, t - 0.12) / 0.45);
      u.fire.scale.setScalar((0.4 + grow * 2.1) * s);
      u.fire.material.opacity = fade;
      u.core.scale.setScalar((0.3 + grow * 1.3) * s * Math.max(0.2, fade));
      u.core.material.opacity = Math.min(1, fade * 1.4);
      u.ring.scale.setScalar((0.5 + Math.min(1, t / 0.35) * 5.5) * s);
      u.ring.material.opacity = Math.max(0, 0.9 - t / 0.35);
      if (t > 0.7) e.visible = false;
    }
    if (this.boomLight.intensity > 0) this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 260);
    for (const m of this.puffs) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      const k = Math.max(0, u.life / u.max);
      m.position.addScaledVector(u.vel, dt);
      u.vel.multiplyScalar(1 - dt * 1.5);
      m.scale.setScalar(u.base * (1 + (1 - k) * u.grow));
      m.material.opacity = u.opacity * Math.min(1, k * 1.6);
      if (u.life <= 0) m.visible = false;
    }
    for (const b of this.beams) {
      if (!b.visible) continue;
      b.userData.life -= dt;
      const k = Math.max(0, b.userData.life / 0.14);
      b.children[0].material.opacity = k * 0.9;
      b.children[1].material.opacity = k;
      b.children[0].scale.x = b.children[0].scale.y = 0.045 * (0.5 + k * 0.5);
      if (b.userData.life <= 0) b.visible = false;
    }
    for (const m of this.tracers) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      m.material.opacity = Math.max(0, m.userData.life / 0.07);
      if (m.userData.life <= 0) m.visible = false;
    }
    let any = false;
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      const k = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      this.pCol[i * 3] = this.pBase[i * 3] * k;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * k;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * k;
      if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = -1000;
    }
    if (any || this.hadParticles) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    this.hadParticles = any;
    for (const s of this.shells) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      u.vel.y -= 12 * dt;
      s.position.addScaledVector(u.vel, dt);
      if (s.position.y < u.floor) { s.position.y = u.floor; u.vel.y *= -0.3; u.vel.x *= 0.5; u.vel.z *= 0.5; }
      s.rotation.x += u.spin.x * dt;
      s.rotation.y += u.spin.y * dt;
      if (u.life <= 0) s.visible = false;
    }
  }

  clearDecals() {
    for (const h of this.holes) h.visible = false;
    for (const s of this.scorches) s.visible = false;
  }
}
