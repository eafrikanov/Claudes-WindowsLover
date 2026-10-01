import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';
import { toon } from './textures.js';
import { addOutlines } from './outline.js';
import { makeSkin, partGeometry, outlineGeometry, HATS, PARTS, hashName } from './skins.js';

// Кубический персонаж в стиле Pixel Gun: голова-куб, коробка-торс, руки и ноги из двух коробок.
// Рост 1.8: ноги 0–0.75, торс 0.75–1.35, голова 1.36–1.78. Модель смотрит в −Z.

const OUTLINE = 0.013;
const HIP_Y = 0.75;
const CROUCH_DROP = 0.44; // в приседе таз на 0.31: голова ≈1.12, близко к хитбоксу CROUCH_HEIGHT
const HIP_X = 0.125;
const KNEE = 0.375;
const SHOULDER = new THREE.Vector3(0.34, 0.52, -0.02); // относительно таза
const AIM_Y = 0.52; // ось прицеливания (грудь, 1.27 м над ногами)
const AIM_PIVOT = new THREE.Vector3(0, HIP_Y + AIM_Y, 0);
const L1 = 0.29; // плечо → локоть
const L2 = 0.31; // локоть → центр кулака
const PACK_BACK = PARTS.torso[2] / 2 + PARTS.pack[2];
const GRIP = new THREE.Vector3(0, -0.045, 0.015); // центр кулака относительно начала модели оружия

// Точки хвата в координатах стоящей модели (ноги в 0, −Z вперёд): gun — начало модели оружия
// (рукоять под правую руку), left — центр левого кулака (null — левая рука свободна),
// twist — разворот торса (левое плечо вперёд у длинноствольного оружия), scale — масштаб
// оружия под «пухлые» кубические руки. Все точки в пределах досягаемости руки (L1 + L2).
export const HAND_POINTS = {
  pistol: { gun: [0.05, 1.31, -0.5], left: [-0.075, 1.255, -0.47], twist: 0, scale: 1.45 },
  rifle: { gun: [0.07, 1.22, -0.42], left: [0.07, 1.19, -0.58], twist: -0.4, scale: 1.2 },
  shotgun: { gun: [0.07, 1.22, -0.42], left: [0.07, 1.2, -0.585], twist: -0.4, scale: 1.2 },
  sniper: { gun: [0.07, 1.21, -0.42], left: [0.07, 1.17, -0.58], twist: -0.4, scale: 1.15 },
  rpg: { gun: [0.3, 1.34, -0.2], left: [0.22, 1.29, -0.44], twist: -0.42, scale: 1.1 },
  minigun: { gun: [0.12, 1.0, -0.26], left: [0.05, 1.08, -0.5], twist: -0.3, scale: 1.1 },
  laser: { gun: [0.07, 1.23, -0.42], left: [0.07, 1.19, -0.58], twist: -0.38, scale: 1.2 },
  knife: { gun: [0.31, 0.97, -0.3], left: null, twist: 0.12, scale: 1.3 },
};
const DEFAULT_HOLD = { gun: [0.07, 1.22, -0.42], left: [0.07, 1.19, -0.58], twist: -0.4, scale: 1.2 };

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

function part(name, mat, parent, x, y, z) {
  const m = new THREE.Mesh(partGeometry(name), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _eu = new THREE.Euler();

// Двухзвенная IK: плечо S тянет кулак к точке T (обе в системе руки), локоть уходит вниз-наружу.
function solveArm(arm, S, T, side) {
  arm.root.position.copy(S);
  _d.subVectors(T, S);
  const raw = _d.length();
  _d.divideScalar(raw || 1);
  const dist = clamp(raw, Math.abs(L1 - L2) + 0.03, L1 + L2 - 0.002);
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  _p.set(side * 0.3, -1, 0.25);
  _p.addScaledVector(_d, -_p.dot(_d)).normalize();
  _e.copy(_d).multiplyScalar(Math.cos(a)).addScaledVector(_p, Math.sin(a));
  _f.copy(_d).multiplyScalar(dist).addScaledVector(_e, -L1).normalize();
  _y.copy(_e).negate();
  _z.copy(_f).addScaledVector(_e, -_f.dot(_e));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z).normalize();
  else _z.normalize().negate();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  arm.root.quaternion.setFromRotationMatrix(_m);
  arm.elbow.rotation.x = Math.acos(clamp(_e.dot(_f), -1, 1));
}

export class Avatar {
  constructor(weaponMats, name, color, friendly) {
    this.weaponMats = weaponMats;
    this.group = new THREE.Group();
    const skin = makeSkin(name, color);
    this.look = skin.look;
    this.textures = [skin.headMap, skin.bodyMap];
    this.mats = { head: toon({ map: skin.headMap }), body: toon({ map: skin.bodyMap }) };
    const { head: hm, body: bm } = this.mats;

    // body — шарнир падения у задней кромки рюкзака, rig — сама модель.
    this.body = new THREE.Group();
    this.body.position.z = PACK_BACK;
    this.group.add(this.body);
    this.rig = new THREE.Group();
    this.rig.position.z = -PACK_BACK;
    this.body.add(this.rig);

    this.hips = new THREE.Group();
    this.hips.position.y = HIP_Y;
    this.rig.add(this.hips);

    this.legs = [];
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(side * HIP_X, 0, 0);
      part('thigh', bm, hip, 0, -0.19, 0);
      const knee = new THREE.Group();
      knee.position.y = -KNEE;
      part('shin', bm, knee, 0, -0.18, 0);
      hip.add(knee);
      this.hips.add(hip);
      this.legs.push({ hip, knee });
    }

    this.upper = new THREE.Group();
    this.hips.add(this.upper);
    this.twistG = new THREE.Group();
    this.upper.add(this.twistG);
    part('torso', bm, this.twistG, 0, 0.3, 0);
    part('pack', bm, this.twistG, 0, 0.33, PARTS.torso[2] / 2 + PARTS.pack[2] / 2);

    this.head = new THREE.Group();
    this.head.position.y = 0.6;
    this.head.rotation.order = 'YXZ';
    this.twistG.add(this.head);
    part('head', hm, this.head, 0, 0.22, 0);
    const hat = HATS[this.look.hat];
    const hatBottom = 0.43 + hat.lift - hat.size[1];
    part(`hat:${this.look.hat}`, hm, this.head, 0, hatBottom + hat.size[1] / 2, 0);
    if (hat.visor) part('visor', hm, this.head, 0, hatBottom + hat.visor[1] / 2 + 0.005, -(hat.size[2] / 2 + hat.visor[2] / 2 - 0.03));

    // Руки и оружие живут в системе прицела: она наклоняется ровно на угол взгляда.
    this.aim = new THREE.Group();
    this.aim.position.y = AIM_Y;
    this.upper.add(this.aim);
    this.gunMount = new THREE.Group();
    this.aim.add(this.gunMount);
    this.arms = [];
    for (const side of [1, -1]) {
      const root = new THREE.Group();
      part('upperArm', bm, root, 0, -0.115, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -L1;
      part('foreArm', bm, elbow, 0, -0.175, 0);
      root.add(elbow);
      this.aim.add(root);
      this.arms.push({ root, elbow, side, shoulder: new THREE.Vector3(), target: new THREE.Vector3() });
    }

    // Контуры: для коробок подменяем оболочку на «угловую», чтобы рёбра не рвались.
    addOutlines(this.rig, OUTLINE * Math.sqrt(3));
    this.rig.traverse((o) => {
      if (o.userData.isOutline) o.geometry = outlineGeometry(o.parent.geometry);
    });

    this.tag = nameSprite(name, friendly ? '#7fd6ff' : '#ffffff');
    this.tag.position.y = 2.1;
    this.tag.material.depthTest = !friendly;
    this.group.add(this.tag);

    this.weaponId = null;
    this.hold = DEFAULT_HOLD;
    this.gunPos = new THREE.Vector3();
    this.rightHand = new THREE.Vector3();
    this.leftHand = new THREE.Vector3();
    this.snaps = [];
    this.phase = 0;
    this.dead = false;
    this.deathT = 0;
    this.deathSide = (hashName(name) & 1) ? 1 : -1;
    this.hitT = 0;
    this.crouch = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.twist = 0;
    this.air = 0;
    this.walkAmt = 0;
    this.velocity = new THREE.Vector3();
    this.muzzleLocal = new THREE.Vector3();
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.gunMount.clear();
    let model;
    try {
      model = buildWeaponModel(id, this.weaponMats);
    } catch {
      model = null;
    }
    if (!model?.group) model = buildWeaponModel('rifle', this.weaponMats);
    const hold = HAND_POINTS[id] || DEFAULT_HOLD;
    this.hold = hold;
    this.gunPos.fromArray(hold.gun).sub(AIM_PIVOT);
    model.group.position.copy(this.gunPos);
    const scale = hold.scale || 1.2;
    model.group.scale.setScalar(scale);
    model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.gunMount.add(model.group);
    this.muzzleLocal.copy(model.muzzle).multiplyScalar(scale).add(this.gunPos);
    this.rightHand.copy(GRIP).multiplyScalar(scale).add(this.gunPos);
    if (hold.left) this.leftHand.fromArray(hold.left).sub(AIM_PIVOT);
    addOutlines(this.gunMount, 0.006);
  }

  muzzleWorld(out) {
    this.gunMount.updateWorldMatrix(true, false);
    return this.gunMount.localToWorld(out.copy(this.muzzleLocal));
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

  setEmissive(r) {
    for (const m of Object.values(this.mats)) m.emissive.setRGB(r, 0, 0);
  }

  die() {
    this.dead = true;
    this.deathT = 0;
    this.hitT = 0;
    this.setEmissive(0);
  }

  revive() {
    this.dead = false;
    this.deathT = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0;
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
    g.rotation.set(0, this.yaw, 0);
    let pitch = clamp(this.pitch, -1.3, 1.3);
    let cr = this.crouch;
    let amt;
    const k = Math.min(1, dt * 10);
    if (this.dead) {
      // Падение на спину: ускоряющийся завал, затем небольшой отскок; руки вскинуты.
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.5);
      const bounce = this.deathT > 0.5 ? Math.max(0, Math.sin((this.deathT - 0.5) * 14)) * Math.exp(-(this.deathT - 0.5) * 8) : 0;
      this.body.rotation.set(t * t * Math.PI * 0.49 - bounce * 0.12, 0, this.deathSide * 0.22 * t);
      this.body.position.y = bounce * 0.05;
      this.tag.visible = false;
      if (this.deathT > 2.5) g.visible = false;
      this.deathPose = Math.min(1, (this.deathPose || 0) + dt * 4);
      pitch = THREE.MathUtils.lerp(pitch, 0.9, this.deathPose);
      cr *= 1 - this.deathPose;
      amt = 0;
      this.walkAmt = 0;
    } else {
      this.deathPose = 0;
      this.tag.visible = true;
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      this.walkAmt += (Math.min(1, speed / 5) - this.walkAmt) * k;
      amt = this.walkAmt;
      const fwd = -this.velocity.x * Math.sin(this.yaw) - this.velocity.z * Math.cos(this.yaw);
      this.phase += dt * (3 + speed * 1.5) * (fwd < -0.3 ? -1 : 1);
      const airborne = Math.abs(this.velocity.y) > 1.2 && cr < 0.5 ? 1 : 0;
      this.air += (airborne - this.air) * k;
    }

    // Ноги: маятник от бедра, колено сгибается на заносе; в приседе — глубокий присед.
    const air = this.air * (1 - cr);
    for (let i = 0; i < 2; i++) {
      const ph = this.phase + i * Math.PI;
      const s = Math.sin(ph);
      let hip = s * 0.7 * amt;
      let knee = -Math.max(0, -Math.cos(ph)) * 1.0 * amt;
      hip = THREE.MathUtils.lerp(hip, i ? -0.3 : 0.55, air);
      knee = THREE.MathUtils.lerp(knee, i ? -0.5 : -1.0, air);
      if (this.dead) { hip = i ? 0.25 : 0.05; knee = i ? -0.5 : -0.1; }
      const leg = this.legs[i];
      leg.hip.rotation.x = THREE.MathUtils.lerp(hip, 1.35 + s * 0.2 * amt, cr);
      leg.knee.rotation.x = THREE.MathUtils.lerp(knee, -2.28 - Math.max(0, s) * 0.2 * amt, cr);
      leg.hip.rotation.z = (i ? -1 : 1) * 0.04 * cr;
    }
    const bob = Math.abs(Math.cos(this.phase)) * 0.035 * amt * (1 - cr * 0.6);
    this.hips.position.y = HIP_Y - cr * CROUCH_DROP + bob;

    // Корпус: наклон вперёд в приседе и на бегу, часть наклона взгляда; разворот под хват.
    const hold = this.hold;
    this.twist += (hold.twist - this.twist) * k;
    const tilt = pitch * 0.25 - cr * 0.2 - amt * 0.08;
    this.upper.rotation.x = tilt;
    this.twistG.rotation.y = this.twist + Math.sin(this.phase) * 0.06 * amt;
    this.head.rotation.set(clamp(pitch * 0.8 - tilt, -0.8, 0.8), -this.twistG.rotation.y * 0.85, 0);

    const sway = Math.sin(this.phase) * amt;
    this.aim.position.set(sway * 0.012, AIM_Y + Math.abs(Math.cos(this.phase)) * 0.012 * amt, 0);
    this.aim.rotation.set(pitch - tilt, 0, 0);
    this.gunMount.position.set(0, 0, 0);
    _qi.copy(this.aim.quaternion).invert();

    for (const arm of this.arms) {
      const side = arm.side;
      // Плечо: позиция на развёрнутом торсе, переведённая в систему прицела.
      _v.set(side * SHOULDER.x, SHOULDER.y, SHOULDER.z).applyAxisAngle(UP, this.twistG.rotation.y);
      _v.sub(this.aim.position).applyQuaternion(_qi);
      arm.shoulder.copy(_v);
      const target = side > 0 ? this.rightHand : hold.left ? this.leftHand : null;
      if (target) {
        _t.copy(target).add(this.gunMount.position);
        solveArm(arm, arm.shoulder, _t, side);
      } else {
        // Свободная рука качается в такт шагам.
        arm.root.position.copy(arm.shoulder);
        const swing = this.dead ? -2.6 : -Math.sin(this.phase) * 0.75 * amt + cr * 0.3;
        _eu.set(swing, this.twistG.rotation.y, side * (0.08 + 0.05 * amt), 'YXZ');
        _q.setFromEuler(_eu);
        arm.root.quaternion.copy(_qi).multiply(_q);
        arm.elbow.rotation.x = 0.2 + 0.35 * amt + Math.max(0, Math.sin(this.phase)) * 0.3 * amt;
      }
    }

    this.tag.position.y = 2.1 - cr * 0.5;

    if (!this.dead) {
      const hit = this.hitT > 0 ? 1 : 0;
      if (this.hitT > 0) this.hitT -= dt;
      this.setEmissive(hit * 0.7);
    }
  }

  dispose() {
    this.tag.material.map.dispose();
    this.tag.material.dispose();
    for (const t of this.textures) t.dispose();
    for (const mat of Object.values(this.mats)) mat.dispose();
  }
}
