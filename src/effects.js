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

  update(dt) {
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
  }
}
