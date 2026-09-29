import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS, buildWeaponModel, makeMuzzleFlash } from './weapons.js';
import { toon } from './textures.js';
import { addOutlines } from './outline.js';

const GRIPS = {
  pistol: { right: [0, -0.035, 0.02], left: [-0.012, -0.055, 0.0], leftOnPump: false },
  rifle: { right: [0, -0.045, 0.065], left: [0, 0.005, -0.28], leftOnPump: false },
  shotgun: { right: [0, -0.04, 0.1], left: [0, 0.0, 0], leftOnPump: true },
  sniper: { right: [0, -0.045, 0.075], left: [0, -0.01, -0.3], leftOnPump: false },
};

const UP = new THREE.Vector3(0, 1, 0);

function limb(from, to, r1, r2, mat) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 14), mat);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

function buildArm(parent, handPos, elbowOffset, mats, left) {
  const hand = new THREE.Vector3(...handPos);
  const elbow = hand.clone().add(elbowOffset);
  const wrist = hand.clone().lerp(elbow, 0.18);
  const g = new THREE.Group();
  g.add(limb(wrist, elbow, 0.03, 0.045, mats.sleeve));
  const cuff = limb(wrist, hand.clone().lerp(elbow, 0.26), 0.033, 0.034, mats.glove);
  g.add(cuff);
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.06, 0.075, 2, 0.015), mats.glove);
  palm.position.copy(hand);
  palm.lookAt(elbow);
  g.add(palm);
  const knuckles = new THREE.Mesh(new RoundedBoxGeometry(0.056, 0.03, 0.04, 2, 0.012), mats.glove);
  knuckles.position.copy(hand).add(new THREE.Vector3(left ? 0.022 : -0.022, 0.0, -0.01));
  g.add(knuckles);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.015, 0.03, 2, 0.006), mats.pad);
  pad.position.copy(hand).add(new THREE.Vector3(left ? -0.026 : 0.026, 0.012, 0.01));
  g.add(pad);
  parent.add(g);
  return g;
}

const smoothstep = (t) => t * t * (3 - 2 * t);

export class ViewModel {
  constructor(textures) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(0.6, 1.5, 2);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3, 2);
    this.scene.add(this.hemi, this.sun, this.flashLight);
    this.root = new THREE.Group();
    this.camera.add(this.root);

    const m = textures.weaponMaterials();
    const armMats = {
      sleeve: toon({ color: 0x5f8f3e }),
      glove: toon({ color: 0x3a3440 }),
      pad: toon({ color: 0xffb347 }),
    };

    this.guns = WEAPONS.map((def) => {
      const model = buildWeaponModel(def.id, m);
      const holder = new THREE.Group();
      holder.add(model.group);
      const grip = GRIPS[def.id];
      buildArm(holder, grip.right, new THREE.Vector3(0.1, -0.22, 0.4), armMats, false);
      const leftParent = grip.leftOnPump ? model.pump : holder;
      buildArm(leftParent, grip.left, new THREE.Vector3(-0.2, -0.2, 0.32), armMats, true);
      addOutlines(holder, 0.0022);
      const flash = makeMuzzleFlash();
      flash.position.copy(model.muzzle);
      model.group.add(flash);
      holder.visible = false;
      this.root.add(holder);
      holder.traverse((o) => { o.frustumCulled = false; });
      const rear = model.group.children.filter((o) => o.position.z > 0.12);
      return { def, model, holder, flash, rear, magHome: model.mag.position.clone(), pumpHome: model.pump ? model.pump.position.clone() : null };
    });

    this.current = 0;
    this.pending = -1;
    this.switchT = 0;
    this.aim = 0;
    this.bobT = 0;
    this.sway = new THREE.Vector2();
    this.recoil = { z: 0, vz: 0, rx: 0, vrx: 0 };
    this.reloadT = -1;
    this.reloadDur = 1;
    this.flashT = 0;
    this.pumpT = -1;
    this.sprint = 0;
    this.guns[0].holder.visible = true;
  }

  setLights(env) {
    this.hemi.color.set(env.hemiSky);
    this.hemi.groundColor.set(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;
    this.sun.color.set(env.sun);
    this.sun.intensity = env.sunIntensity * 0.9;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  switchTo(i) {
    if (i === this.current && this.pending < 0) return;
    this.pending = i;
    this.switchT = Math.max(this.switchT, 0.001);
    this.reloadT = -1;
  }

  fire() {
    const g = this.guns[this.current];
    const k = g.def.kick * (1 - this.aim * 0.5);
    this.recoil.vz += k * 60;
    this.recoil.vrx += k * 55;
    this.flashT = 0.05;
    g.flash.visible = true;
    g.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    g.flash.scale.set(s, s, s);
    if (g.model.pump || g.model.bolt) this.pumpT = 0;
  }

  reload(duration) {
    this.reloadT = 0;
    this.reloadDur = duration;
  }

  get busy() {
    return this.switchT > 0 || this.reloadT >= 0;
  }

  muzzleInCamera(out) {
    const g = this.guns[this.current];
    g.model.group.updateWorldMatrix(true, false);
    out.copy(g.model.muzzle).applyMatrix4(g.model.group.matrixWorld);
    this.camera.worldToLocal(out);
    return out;
  }

  update(dt, s) {
    if (this.switchT > 0) {
      this.switchT += dt / 0.22;
      if (this.pending >= 0 && this.switchT >= 1) {
        this.guns[this.current].holder.visible = false;
        this.current = this.pending;
        this.pending = -1;
        this.guns[this.current].holder.visible = true;
      }
      if (this.switchT >= 2) this.switchT = 0;
    }
    const g = this.guns[this.current];
    const def = g.def;

    this.aim += ((s.aiming && this.reloadT < 0 ? 1 : 0) - this.aim) * Math.min(1, dt * 14);
    this.sprint += ((s.sprinting && !s.aiming ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);

    const r = this.recoil;
    r.vz += (-r.z * 320 - r.vz * 24) * dt;
    r.z += r.vz * dt;
    r.vrx += (-r.rx * 260 - r.vrx * 20) * dt;
    r.rx += r.vrx * dt;

    const speed = s.onGround ? Math.min(1, s.speed / 6) : 0;
    this.bobT += dt * (6 + speed * 5) * (0.2 + speed);
    const bobAmt = speed * (1 - this.aim * 0.85) * (1 + this.sprint * 0.8);
    const bobX = Math.sin(this.bobT) * 0.012 * bobAmt;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt;
    const breath = Math.sin(performance.now() / 900) * 0.002 * (1 - this.aim);

    this.sway.x += (THREE.MathUtils.clamp(-s.lookDX * 0.0006, -0.04, 0.04) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (THREE.MathUtils.clamp(s.lookDY * 0.0006, -0.04, 0.04) - this.sway.y) * Math.min(1, dt * 10);
    const swayK = 1 - this.aim * 0.8;

    const hip = def.hip;
    const ads = [0, -g.model.sightY, def.ads[2]];
    const h = g.holder;
    h.position.set(
      THREE.MathUtils.lerp(hip[0], ads[0], this.aim) + bobX + this.sway.x * swayK,
      THREE.MathUtils.lerp(hip[1], ads[1], this.aim) + bobY + breath + this.sway.y * swayK,
      THREE.MathUtils.lerp(hip[2], ads[2], this.aim) + r.z,
    );
    h.rotation.set(r.rx + this.sway.y * 2 * swayK, this.sway.x * 2 * swayK, bobX * 2);

    if (this.sprint > 0.01) {
      h.rotation.y += this.sprint * 0.55;
      h.rotation.x -= this.sprint * 0.25;
      h.position.x -= this.sprint * 0.05;
      h.position.y -= this.sprint * 0.04;
    }

    if (this.switchT > 0) {
      const t = this.switchT < 1 ? this.switchT : 2 - this.switchT;
      h.position.y -= smoothstep(Math.min(1, t)) * 0.28;
      h.rotation.x -= smoothstep(Math.min(1, t)) * 0.7;
    }

    g.model.mag.position.copy(g.magHome);
    if (g.pumpHome) g.model.pump.position.copy(g.pumpHome);
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      const t = this.reloadT;
      const tilt = smoothstep(Math.min(1, t / 0.2)) * (1 - smoothstep(Math.max(0, (t - 0.8) / 0.2)));
      h.rotation.z += tilt * 0.55;
      h.rotation.x += tilt * 0.25;
      h.position.y -= tilt * 0.05;
      if (g.model.pump) {
        const cycles = def.mag;
        const p = Math.min(1, Math.max(0, (t - 0.2) / 0.6));
        h.rotation.z += Math.sin(p * Math.PI * cycles) * 0.04 * tilt;
        if (t > 0.8) g.model.pump.position.z = g.pumpHome.z + Math.sin(((t - 0.8) / 0.2) * Math.PI) * 0.07;
      } else {
        let drop = 0;
        if (t > 0.2 && t < 0.45) drop = smoothstep((t - 0.2) / 0.25);
        else if (t >= 0.45 && t < 0.7) drop = 1 - smoothstep((t - 0.45) / 0.25);
        g.model.mag.position.y = g.magHome.y - drop * 0.25;
      }
      if (this.reloadT >= 1) this.reloadT = -1;
    }

    if (this.pumpT >= 0) {
      this.pumpT += dt / Math.min(0.6, def.fireRate * 0.8);
      const t = this.pumpT;
      const k = t > 0.25 && t < 1 ? Math.sin(((t - 0.25) / 0.75) * Math.PI) : 0;
      if (g.model.pump) g.model.pump.position.z = g.pumpHome.z + k * 0.08;
      if (g.model.bolt) h.rotation.z += k * 0.12;
      if (t >= 1) this.pumpT = -1;
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = 2;
      this.flashLight.position.set(h.position.x, h.position.y + 0.05, h.position.z - 0.5);
      if (this.flashT <= 0) {
        g.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }

    this.camera.fov = 60 - this.aim * 12;
    this.camera.updateProjectionMatrix();
    this.root.visible = !(def.scope && this.aim > 0.9);
    for (const o of g.rear) o.visible = this.aim < 0.6;
  }
}
