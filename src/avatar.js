import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildWeaponModel } from './weapons.js';

const UP = new THREE.Vector3(0, 1, 0);
const HAND_POINTS = {
  pistol: { right: [0.02, 1.33, -0.42], left: [0.0, 1.31, -0.4], gun: [0.02, 1.36, -0.44] },
  rifle: { right: [0.14, 1.3, -0.2], left: [0.12, 1.33, -0.52], gun: [0.14, 1.34, -0.25] },
  shotgun: { right: [0.14, 1.3, -0.18], left: [0.14, 1.33, -0.47], gun: [0.14, 1.34, -0.26] },
  sniper: { right: [0.14, 1.3, -0.2], left: [0.14, 1.32, -0.52], gun: [0.14, 1.34, -0.26] },
};

function limb(from, to, r1, r2, mat) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 12), mat);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  return m;
}

function rbox(w, h, d, r, mat) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat);
  m.castShadow = true;
  return m;
}

function nameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '600 52px system-ui, sans-serif';
  const w = Math.min(500, ctx.measureText(name).width + 48);
  ctx.fillStyle = 'rgba(10,14,20,0.6)';
  ctx.beginPath();
  ctx.roundRect((512 - w) / 2, 10, w, 76, 20);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(1.3, 0.24, 1);
  s.renderOrder = 10;
  return s;
}

export class Avatar {
  constructor(weaponMats, name, color, friendly) {
    this.weaponMats = weaponMats;
    this.group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9946f, roughness: 0.7 });
    this.mats = {
      skin,
      uniform: new THREE.MeshStandardMaterial({ color: 0x4a4f3c, roughness: 0.95, normalMap: weaponMats.polymer.normalMap }),
      vest: new THREE.MeshStandardMaterial({ color, roughness: 0.8, normalMap: weaponMats.polymer.normalMap }),
      gear: new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.75 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x2b241d, roughness: 0.85 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x101820, metalness: 0.6, roughness: 0.15 }),
    };
    const m = this.mats;

    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.11, 0.92, 0);
      const thigh = limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.44, 0), 0.09, 0.075, m.uniform);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      knee.add(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.4, 0), 0.07, 0.06, m.uniform));
      const pad = rbox(0.13, 0.12, 0.06, 0.02, m.gear);
      pad.position.set(0, -0.02, -0.07);
      knee.add(pad);
      const boot = rbox(0.13, 0.12, 0.28, 0.035, m.boot);
      boot.position.set(0, -0.44, -0.05);
      knee.add(boot);
      hip.add(knee);
      this.group.add(hip);
      this.legs.push({ hip, knee });
    }

    this.upper = new THREE.Group();
    this.upper.position.y = 0.92;
    this.group.add(this.upper);
    const u = new THREE.Group();
    u.position.y = -0.92;
    this.upper.add(u);
    this.upperInner = u;

    const pelvis = rbox(0.36, 0.2, 0.22, 0.06, m.uniform);
    pelvis.position.y = 0.97;
    u.add(pelvis);
    const torso = rbox(0.42, 0.5, 0.24, 0.08, m.uniform);
    torso.position.y = 1.3;
    u.add(torso);
    const vest = rbox(0.46, 0.4, 0.3, 0.06, m.vest);
    vest.position.y = 1.3;
    u.add(vest);
    for (let i = 0; i < 3; i++) {
      const pouch = rbox(0.11, 0.13, 0.06, 0.02, m.gear);
      pouch.position.set(-0.13 + i * 0.13, 1.2, -0.17);
      u.add(pouch);
    }
    const belt = rbox(0.4, 0.06, 0.26, 0.02, m.gear);
    belt.position.y = 1.06;
    u.add(belt);
    const pack = rbox(0.32, 0.36, 0.14, 0.05, m.gear);
    pack.position.set(0, 1.32, 0.2);
    u.add(pack);

    this.head = new THREE.Group();
    this.head.position.y = 1.58;
    u.add(this.head);
    const neck = limb(new THREE.Vector3(0, -0.06, 0), new THREE.Vector3(0, 0.04, 0), 0.06, 0.06, m.skin);
    this.head.add(neck);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 16), m.skin);
    face.scale.set(0.92, 1.05, 1);
    face.position.y = 0.1;
    face.castShadow = true;
    this.head.add(face);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m.vest);
    helmet.position.y = 0.13;
    helmet.castShadow = true;
    this.head.add(helmet);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 24), m.gear);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.12;
    this.head.add(rim);
    const goggles = rbox(0.2, 0.055, 0.06, 0.02, m.visor);
    goggles.position.set(0, 0.12, -0.1);
    this.head.add(goggles);

    this.armGroup = new THREE.Group();
    u.add(this.armGroup);
    this.gunMount = new THREE.Group();
    u.add(this.gunMount);

    this.tag = nameSprite(name, friendly ? '#7fd6ff' : '#ffffff');
    this.tag.position.y = 2.1;
    this.tag.material.depthTest = !friendly;
    this.group.add(this.tag);

    this.weaponId = null;
    this.snaps = [];
    this.phase = 0;
    this.dead = false;
    this.deathT = 0;
    this.hitT = 0;
    this.crouch = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.velocity = new THREE.Vector3();
    this.muzzleLocal = new THREE.Vector3();
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.gunMount.clear();
    this.armGroup.clear();
    const model = buildWeaponModel(id, this.weaponMats);
    const p = HAND_POINTS[id];
    model.group.position.set(...p.gun);
    model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.gunMount.add(model.group);
    this.muzzleLocal.copy(model.muzzle).add(model.group.position);
    const m = this.mats;
    for (const [side, hand] of [[1, p.right], [-1, p.left]]) {
      const shoulder = new THREE.Vector3(side * 0.24, 1.47, 0);
      const h = new THREE.Vector3(...hand);
      const elbow = shoulder.clone().lerp(h, 0.5).add(new THREE.Vector3(side * 0.12, -0.14, 0.05));
      this.armGroup.add(limb(shoulder, elbow, 0.065, 0.055, m.uniform));
      this.armGroup.add(limb(elbow, h, 0.055, 0.045, m.uniform));
      const glove = rbox(0.07, 0.08, 0.1, 0.025, m.gear);
      glove.position.copy(h);
      this.armGroup.add(glove);
      const pad = rbox(0.12, 0.1, 0.12, 0.04, m.vest);
      pad.position.copy(shoulder).add(new THREE.Vector3(side * 0.02, 0.02, 0));
      this.armGroup.add(pad);
    }
  }

  muzzleWorld(out) {
    return this.upperInner.localToWorld(out.copy(this.muzzleLocal));
  }

  pushState(s, t) {
    this.snaps.push({ t, x: s.p[0], y: s.p[1], z: s.p[2], yaw: s.yaw, pitch: s.pitch, crouch: s.c ? 1 : 0 });
    if (this.snaps.length > 30) this.snaps.shift();
    this.setWeapon(s.w);
  }

  teleport(x, y, z) {
    this.snaps.length = 0;
    this.group.position.set(x, y, z);
  }

  flashHit() {
    this.hitT = 0.12;
  }

  die() {
    this.dead = true;
    this.deathT = 0;
  }

  revive() {
    this.dead = false;
    this.group.rotation.set(0, this.group.rotation.y, 0);
    this.group.visible = true;
  }

  update(dt, renderTime) {
    const prev = this.group.position.clone();
    const sn = this.snaps;
    if (sn.length) {
      let a = sn[0];
      let b = sn[sn.length - 1];
      for (let i = sn.length - 1; i > 0; i--) {
        if (sn[i - 1].t <= renderTime) { a = sn[i - 1]; b = sn[i]; break; }
      }
      const span = b.t - a.t;
      const k = span > 0 ? THREE.MathUtils.clamp((renderTime - a.t) / span, 0, 1) : 1;
      this.group.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      let dyaw = b.yaw - a.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      this.yaw = a.yaw + dyaw * k;
      this.pitch = a.pitch + (b.pitch - a.pitch) * k;
      this.crouch += ((b.crouch) - this.crouch) * Math.min(1, dt * 12);
    }
    if (dt > 0) this.velocity.subVectors(this.group.position, prev).divideScalar(dt);
    this.animate(dt);
  }

  animate(dt) {
    const g = this.group;
    if (this.dead) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.45);
      g.rotation.x = -t * t * Math.PI / 2 * 0.95;
      this.tag.visible = false;
      if (this.deathT > 2.5) g.visible = false;
      return;
    }
    this.tag.visible = true;
    g.rotation.set(0, this.yaw, 0);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const amt = Math.min(1, speed / 5);
    this.phase += dt * (4 + speed * 1.4);
    const cr = this.crouch;
    for (let i = 0; i < 2; i++) {
      const s = Math.sin(this.phase + i * Math.PI);
      const leg = this.legs[i];
      leg.hip.rotation.x = s * 0.6 * amt - cr * 0.9;
      leg.knee.rotation.x = Math.max(0, -Math.cos(this.phase + i * Math.PI)) * 0.9 * amt + cr * 1.5;
      leg.hip.position.y = 0.92 - cr * 0.3;
    }
    this.upper.position.y = 0.92 - cr * 0.33 + Math.abs(Math.sin(this.phase)) * 0.03 * amt;
    this.upper.rotation.x = this.pitch * 0.55 + cr * 0.15;
    this.head.rotation.x = this.pitch * 0.4;
    this.tag.position.y = 2.1 - cr * 0.4;

    const hit = this.hitT > 0 ? 1 : 0;
    if (this.hitT > 0) this.hitT -= dt;
    for (const k of ['uniform', 'vest', 'skin']) this.mats[k].emissive.setRGB(hit * 0.7, 0, 0);
  }

  dispose() {
    this.tag.material.map.dispose();
    this.tag.material.dispose();
    for (const mat of Object.values(this.mats)) mat.dispose();
  }
}
