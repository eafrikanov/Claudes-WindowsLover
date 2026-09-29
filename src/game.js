import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextureLibrary, setAnisotropy } from './textures.js';
import { buildMap } from './map.js';
import { ViewModel } from './viewmodel.js';
import { Avatar } from './avatar.js';
import { Effects } from './effects.js';
import { WEAPONS } from './weapons.js';
import { moveBody, raycastWorld, rayPlayer, blocked, PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT, GRAVITY } from './physics.js';
import { Hud, esc } from './hud.js';
import { RESPAWN_DELAY } from './match.js';

export const QUALITY = {
  low: { label: 'Низкое', pixel: 0.75, shadows: 0, tex: 256 },
  medium: { label: 'Среднее', pixel: 1, shadows: 2048, tex: 512 },
  high: { label: 'Высокое', pixel: 2, shadows: 4096, tex: 1024 },
};

export const TEAM_COLORS = ['#3d82e0', '#e0493d'];
const JUMP_SPEED = 8;
const STATE_RATE = 1 / 20;
const INTERP_DELAY = 0.1;

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();

function randomCone(dir, spread, out) {
  const u = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * spread;
  const up = Math.abs(dir.y) > 0.99 ? V2.set(1, 0, 0) : V2.set(0, 1, 0);
  const a = new THREE.Vector3().crossVectors(dir, up).normalize();
  const b = new THREE.Vector3().crossVectors(dir, a).normalize();
  return out.copy(dir).addScaledVector(a, Math.cos(u) * r).addScaledVector(b, Math.sin(u) * r).normalize();
}

function medkit() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.45 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd01818, emissive: 0x900000, emissiveIntensity: 0.8, roughness: 0.4 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.34, 3, 0.05), white);
  body.castShadow = true;
  g.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  handle.position.y = 0.15;
  g.add(handle);
  for (const [w, d] of [[0.26, 0.08], [0.08, 0.26]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.31, d * 0.8), red);
    g.add(c);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, d * 0.9, 0.345), red);
    g.add(s);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 32),
    new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  const root = new THREE.Group();
  root.add(g, ring);
  root.userData.box = g;
  root.userData.ring = ring;
  return root;
}

export class Game {
  constructor(canvas, sound, prefs) {
    this.canvas = canvas;
    this.sound = sound;
    this.prefs = { ...prefs };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.camera = new THREE.PerspectiveCamera(prefs.fov, 1, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    this.hud = new Hud();
    this.scene = null;
    this.running = false;
    this.paused = false;
    this.keys = new Set();
    this.look = { dx: 0, dy: 0, lastDX: 0, lastDY: 0 };
    this.fireHeld = false;
    this.aimHeld = false;
    this.tabHeld = false;
    this.noLock = new URLSearchParams(location.search).has('nolock');
    this.send = () => {};
    this.onPause = () => {};
    this.onTick = null;
    this.avatars = new Map();
    this.roster = new Map();
    this.orbit = 0;
    this.last = performance.now();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  get quality() {
    return QUALITY[this.prefs.quality] || QUALITY.medium;
  }

  applyPrefs(prefs) {
    const reload = prefs.quality !== this.prefs.quality;
    this.prefs = { ...prefs };
    this.sound.setVolume(prefs.volume);
    this.resize();
    return reload;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio * this.quality.pixel));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm?.resize(w / h);
  }

  get locked() {
    return document.pointerLockElement === this.canvas || this.noLock;
  }

  requestLock() {
    if (this.noLock) return;
    const r = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (r?.catch) r.catch(() => this.canvas.requestPointerLock());
  }

  bindInput() {
    const block = ['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft'];
    window.addEventListener('keydown', (e) => {
      if (!this.running || this.paused || e.target.tagName === 'INPUT') return;
      if (block.includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Tab') this.tabHeld = true;
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'KeyQ') this.selectWeapon(this.prevWeapon ?? 0);
      const idx = WEAPONS.findIndex((w) => `Digit${w.key}` === e.code);
      if (idx >= 0) this.selectWeapon(idx);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.tabHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; this.aimHeld = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.running || this.paused) return;
      this.sound.unlock();
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.fireHeld = true; this.triggerFresh = true; }
      if (e.button === 2) this.aimHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aimHeld = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.running || !this.locked || this.paused) return;
      this.look.dx += e.movementX;
      this.look.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.running || !this.locked || this.paused || !this.me) return;
      const n = WEAPONS.length;
      this.selectWeapon((this.me.weapon + (e.deltaY > 0 ? 1 : -1) + n) % n);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (this.running && !this.locked && !this.paused) this.setPaused(true);
    });
  }

  setPaused(v) {
    this.paused = v;
    this.keys.clear();
    this.fireHeld = false;
    this.aimHeld = false;
    if (!v) this.requestLock();
    else if (document.pointerLockElement) document.exitPointerLock();
    this.onPause(v);
  }

  async load(mapId) {
    if (this.mapId === mapId && this.loadedQuality === this.prefs.quality && this.scene) return;
    this.disposeScene();
    const q = this.quality;
    if (!this.textures || this.textures.size !== q.tex) this.textures = new TextureLibrary(q.tex);
    const scene = new THREE.Scene();
    const map = buildMap(mapId, this.textures);
    const env = map.env;
    scene.add(map.group);

    const sky = new Sky();
    sky.scale.setScalar(450);
    const u = sky.material.uniforms;
    u.turbidity.value = env.turbidity;
    u.rayleigh.value = env.rayleigh;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - env.elevation), THREE.MathUtils.degToRad(env.azimuth));
    u.sunPosition.value.copy(sunDir);
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    this.renderer.toneMappingExposure = env.exposure;
    this.envTarget = this.pmrem.fromScene(skyScene, 0.02);
    skyScene.remove(sky);
    scene.add(sky);
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = 0.55;
    scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);

    const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiIntensity);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(env.sun, env.sunIntensity);
    sun.position.copy(sunDir).multiplyScalar(70);
    scene.add(sun, sun.target);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    if (q.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(q.shadows, q.shadows);
      const s = map.half + 6;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 160 });
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.04;
    }

    this.pickupMeshes = map.pickups.map((p) => {
      const m = medkit();
      m.position.set(p.x, p.y + 0.02, p.z);
      scene.add(m);
      return m;
    });
    this.pickupOn = map.pickups.map(() => true);

    this.effects = new Effects(scene);
    this.vm = new ViewModel(this.textures);
    this.vm.setLights(env);
    this.vm.scene.environment = this.envTarget.texture;
    this.vm.scene.environmentIntensity = 0.7;
    this.vm.resize(this.camera.aspect);

    this.scene = scene;
    this.map = map;
    this.mapId = mapId;
    this.loadedQuality = this.prefs.quality;
    this.renderer.compile(scene, this.camera);
  }

  disposeScene() {
    if (!this.scene) return;
    for (const av of this.avatars.values()) av.dispose();
    this.avatars.clear();
    this.scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    });
    this.envTarget?.dispose();
    this.scene = null;
  }

  displayColor(p) {
    return this.settings?.mode === 'tdm' ? TEAM_COLORS[p.team] : p.color;
  }

  isFriend(p) {
    return this.settings?.mode === 'tdm' && this.me && p.team === this.me.team;
  }

  async startMatch({ mapId, localId, roster, settings, snapshot }) {
    this.settings = settings;
    await this.load(mapId);
    this.effects.clearDecals();
    this.localId = localId;
    const self = roster.find((p) => p.id === localId);
    this.me = {
      id: localId, team: self?.team ?? 0, pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0, punch: 0, onGround: false, height: STAND_HEIGHT, crouching: false,
      alive: false, hp: 100, weapon: 1, ammo: WEAPONS.map((w) => w.mag), nextFire: 0, reloadUntil: 0, reloadFor: -1,
      bloom: 0, stepT: 0, stateT: 0, deathT: 0, killer: null, lastPick: 0, waiting: true,
    };
    this.prevWeapon = 0;
    this.roster.clear();
    this.syncRoster(snapshot?.roster || roster.map((p) => ({ ...p, kills: 0, deaths: 0, alive: false, hp: 100 })));
    if (snapshot) {
      snapshot.pickups.forEach((on, i) => this.setPickup(i, on));
      this.hud.clock(snapshot.left);
    } else {
      this.hud.clock(settings.timeLimit * 60);
    }
    this.vm.switchTo(this.me.weapon);
    this.vm.current = this.me.weapon;
    this.vm.guns.forEach((g, i) => { g.holder.visible = i === this.me.weapon; });
    this.hud.weapon(this.me.weapon, this.me.ammo[this.me.weapon]);
    this.hud.health(100);
    this.running = true;
    this.paused = false;
    this.hud.show(true);
    this.updateTopScore();
    this.requestLock();
  }

  stopMatch() {
    this.running = false;
    this.paused = false;
    this.hud.show(false);
    this.hud.scope(false);
    this.hud.scoreboard(false);
    this.hud.death(false);
    for (const av of this.avatars.values()) {
      this.scene?.remove(av.group);
      av.dispose();
    }
    this.avatars.clear();
    this.me = null;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  syncRoster(list) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, av] of this.avatars) {
      if (!ids.has(id)) {
        this.scene.remove(av.group);
        av.dispose();
        this.avatars.delete(id);
      }
    }
    for (const id of [...this.roster.keys()]) if (!ids.has(id)) this.roster.delete(id);
    for (const p of list) {
      const prev = this.roster.get(p.id);
      this.roster.set(p.id, { ...prev, ...p });
      if (p.id === this.localId) {
        if (this.me) this.me.team = p.team;
        continue;
      }
      if (!this.avatars.has(p.id)) {
        const av = new Avatar(this.textures.weaponMaterials(), p.name, this.displayColor(p), this.isFriend(p));
        av.setWeapon('rifle');
        av.group.visible = !!p.alive;
        if (!p.alive) av.dead = true;
        this.avatars.set(p.id, av);
        this.scene.add(av.group);
      }
    }
    this.updateTopScore();
  }

  teamScores() {
    const s = [0, 0];
    for (const p of this.roster.values()) s[p.team] += p.kills;
    return s;
  }

  updateTopScore() {
    if (!this.settings) return;
    const limit = this.settings.scoreLimit;
    if (this.settings.mode === 'tdm') {
      const [a, b] = this.teamScores();
      this.hud.topScore(`<span class="tb">${a}</span><span class="lim">до ${limit}</span><span class="tr">${b}</span>`);
    } else {
      const list = [...this.roster.values()].sort((x, y) => y.kills - x.kills);
      const lead = list[0];
      const mine = this.roster.get(this.localId);
      this.hud.topScore(lead ? `<span class="lead">${esc(lead.name)} · ${lead.kills}</span><span class="lim">до ${limit}</span><span class="mine">Вы · ${mine?.kills ?? 0}</span>` : '');
    }
  }

  setPickup(i, on) {
    this.pickupOn[i] = on;
    if (this.pickupMeshes[i]) this.pickupMeshes[i].visible = on;
  }

  selectWeapon(i) {
    const me = this.me;
    if (!me || !me.alive || i === me.weapon || i < 0 || i >= WEAPONS.length) return;
    this.prevWeapon = me.weapon;
    me.weapon = i;
    me.reloadUntil = 0;
    me.reloadFor = -1;
    me.nextFire = Math.max(me.nextFire, this.now + 0.3);
    this.vm.switchTo(i);
    this.hud.weapon(i, me.ammo[i]);
    this.hud.reloadProgress(-1);
    this.sound.click(0.05, 1200, 0.25);
  }

  startReload() {
    const me = this.me;
    if (!me || !me.alive || me.reloadUntil > this.now) return;
    const def = WEAPONS[me.weapon];
    if (me.ammo[me.weapon] >= def.mag) return;
    me.reloadUntil = this.now + def.reload;
    me.reloadFor = me.weapon;
    me.reloadStart = this.now;
    this.vm.reload(def.reload);
    this.sound.reload(def.reload, def.id === 'shotgun');
  }

  get now() {
    return performance.now() / 1000;
  }

  // ——— сетевые события ———
  handle(msg) {
    if (!this.running) return;
    const now = this.now;
    switch (msg.t) {
      case 'st':
        for (const [id, x, y, z, yaw, pitch, w, c] of msg.s) {
          if (id === this.localId) continue;
          const av = this.avatars.get(id);
          if (av && !av.dead) av.pushState({ p: [x, y, z], yaw, pitch, w: WEAPONS[w]?.id || 'rifle', c }, now);
        }
        break;
      case 'shot': {
        if (msg.id === this.localId) break;
        const av = this.avatars.get(msg.id);
        const def = WEAPONS[msg.w];
        if (!av || !def) break;
        const from = av.muzzleWorld(new THREE.Vector3());
        const to = new THREE.Vector3(...msg.e);
        this.effects.tracer(from, to);
        this.sound.shot(def, from.x, from.z);
        const nearPlayer = this.me?.alive && to.distanceTo(V1.copy(this.me.pos).setY(this.me.pos.y + 1)) < 1.2;
        if (!nearPlayer) this.effects.particles(to, V1.set(0, 1, 0), 4, new THREE.Color(1, 0.6, 0.2), 3, 1.5, 10, 0.2, 1.2);
        break;
      }
      case 'hp': {
        const r = this.roster.get(msg.id);
        if (r) r.hp = msg.hp;
        if (msg.id === this.localId) {
          const me = this.me;
          if (msg.hp < me.hp) {
            this.sound.hurt();
            this.hud.flashDamage();
            if (msg.from) {
              const ang = Math.atan2(-(msg.from[0] - me.pos.x), -(msg.from[1] - me.pos.z));
              this.hud.damageFrom(-(ang - me.yaw));
            }
          }
          me.hp = msg.hp;
          this.hud.health(me.hp);
        } else {
          this.avatars.get(msg.id)?.flashHit();
        }
        break;
      }
      case 'kill': {
        const k = this.roster.get(msg.k);
        const v = this.roster.get(msg.v);
        if (k) k.kills = msg.kk;
        if (v) { v.deaths = msg.vd; v.alive = false; v.hp = 0; }
        if (k && v) {
          this.hud.kill({ name: k.name, color: this.displayColor(k) }, { name: v.name, color: this.displayColor(v) }, msg.w, msg.h, msg.k === this.localId || msg.v === this.localId);
        }
        if (msg.v === this.localId) {
          const me = this.me;
          me.alive = false;
          me.hp = 0;
          me.deathT = 0;
          me.killer = msg.k;
          this.hud.health(0);
          this.hud.death(true, `Вас убил <b style="color:${k ? this.displayColor(k) : '#fff'}">${esc(k?.name || '???')}</b> · ${esc(WEAPONS[msg.w]?.name || '')}${msg.h ? ' · в голову' : ''}`, RESPAWN_DELAY);
          this.hud.scope(false);
        } else {
          this.avatars.get(msg.v)?.die();
        }
        if (msg.k === this.localId && msg.v !== this.localId) {
          this.sound.kill();
          this.hud.hitmarker(msg.h, true);
          this.hud.toast(`${msg.h ? 'В голову! ' : ''}Убит ${v?.name || ''}`);
        }
        this.updateTopScore();
        break;
      }
      case 'spawn': {
        const r = this.roster.get(msg.id);
        if (r) { r.alive = true; r.hp = 100; }
        if (msg.id === this.localId) {
          const me = this.me;
          me.pos.set(...msg.p);
          me.vel.set(0, 0, 0);
          me.yaw = msg.yaw;
          me.pitch = 0;
          me.alive = true;
          me.waiting = false;
          me.hp = 100;
          me.ammo = WEAPONS.map((w) => w.mag);
          me.reloadUntil = 0;
          me.reloadFor = -1;
          this.camera.rotation.z = 0;
          this.hud.health(100);
          this.hud.death(false);
          this.hud.weapon(me.weapon, me.ammo[me.weapon]);
        } else {
          const av = this.avatars.get(msg.id);
          if (av) {
            av.teleport(...msg.p);
            av.yaw = msg.yaw;
            av.revive();
            av.setWeapon(WEAPONS[msg.w]?.id || 'rifle');
          }
        }
        break;
      }
      case 'clock':
        this.hud.clock(msg.left);
        break;
      case 'pk':
        this.setPickup(msg.i, msg.on);
        if (!msg.on && msg.id === this.localId) {
          this.me.hp = msg.hp;
          this.hud.health(msg.hp);
          this.sound.pickup();
          this.hud.toast('+50 здоровья');
        }
        break;
      case 'roster':
        this.syncRoster(msg.roster);
        break;
      default:
    }
  }

  // ——— локальный игрок ———
  updateLocal(dt) {
    const me = this.me;
    const now = this.now;
    const def = WEAPONS[me.weapon];
    const aiming = this.aimHeld && me.alive && me.reloadUntil <= now;
    const zoom = aiming ? def.adsFov / this.prefs.fov : 1;
    const sens = this.prefs.sensitivity * 0.0022 * (aiming ? Math.max(0.25, zoom) : 1);
    me.yaw -= this.look.dx * sens;
    me.pitch -= this.look.dy * sens * (this.prefs.invertY ? -1 : 1);
    me.pitch = THREE.MathUtils.clamp(me.pitch, -1.5, 1.5);
    this.look.lastDX = this.look.dx;
    this.look.lastDY = this.look.dy;
    this.look.dx = this.look.dy = 0;

    const cam = this.camera;
    const targetFov = aiming ? THREE.MathUtils.lerp(this.prefs.fov, def.adsFov, Math.min(1, this.vm.aim * 1.1)) : this.prefs.fov;
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 16);
    cam.updateProjectionMatrix();
    this.hud.scope(!!def.scope && this.vm.aim > 0.9 && me.alive);

    if (!me.alive) {
      this.hud.crosshair(0, false);
      if (me.waiting) return;
      me.deathT += dt;
      const k = Math.min(1, me.deathT / 0.6);
      cam.position.set(me.pos.x, me.pos.y + 1.6 - k * 1.2, me.pos.z);
      cam.rotation.set(me.pitch * (1 - k) - k * 0.3, me.yaw, k * 0.5);
      const killer = this.avatars.get(me.killer);
      if (killer && !killer.dead && k >= 1) {
        const t = killer.group.position;
        const want = Math.atan2(-(t.x - me.pos.x), -(t.z - me.pos.z));
        let d = want - me.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        me.yaw += d * Math.min(1, dt * 3);
      }
      this.hud.death(true, undefined, RESPAWN_DELAY - me.deathT);
      this.hud.crosshair(0, false);
      this.hud.reloadProgress(-1);
      return;
    }

    const input = this.paused ? new Set() : this.keys;
    let fx = 0;
    let fz = 0;
    if (input.has('KeyW')) fz += 1;
    if (input.has('KeyS')) fz -= 1;
    if (input.has('KeyD')) fx += 1;
    if (input.has('KeyA')) fx -= 1;
    const wantCrouch = input.has('ControlLeft') || input.has('KeyC');
    const sprint = input.has('ShiftLeft') && fz > 0 && !aiming && !wantCrouch && !this.fireHeld;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    const sin = Math.sin(me.yaw);
    const cos = Math.cos(me.yaw);
    const wx = -sin * fz + cos * fx;
    const wz = -cos * fz - sin * fx;
    let speed = wantCrouch ? 2.6 : sprint ? 7.2 : 5;
    if (aiming) speed *= def.scope ? 0.5 : 0.7;
    const accel = me.onGround ? 12 : 2.5;
    me.vel.x += (wx * speed - me.vel.x) * Math.min(1, dt * accel);
    me.vel.z += (wz * speed - me.vel.z) * Math.min(1, dt * accel);
    if (input.has('Space') && me.onGround) {
      me.vel.y = JUMP_SPEED;
      me.onGround = false;
    }
    me.vel.y -= GRAVITY * dt;

    const cols = this.map.colliders;
    const targetH = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
    if (targetH > me.height && blocked(cols, me.pos.x, me.pos.y + 0.01, me.pos.z, PLAYER_RADIUS, targetH)) {
      me.crouching = true;
    } else {
      me.height += (targetH - me.height) * Math.min(1, dt * 12);
      me.crouching = wantCrouch;
    }
    me.onGround = moveBody(cols, me.pos, me.vel, dt, PLAYER_RADIUS, me.height, me.onGround);
    if (me.pos.y < -30) me.pos.set(0, 5, 0);

    const hs = Math.hypot(me.vel.x, me.vel.z);
    if (me.onGround && hs > 1.5 && !me.crouching) {
      me.stepT -= dt * hs;
      if (me.stepT <= 0) { me.stepT = 2.3; this.sound.step(sprint ? 0.16 : 0.1); }
    }

    me.punch += (0 - me.punch) * Math.min(1, dt * 10);
    cam.position.set(me.pos.x, me.pos.y + me.height - 0.16, me.pos.z);
    cam.rotation.set(me.pitch + me.punch, me.yaw, 0);

    if (me.reloadFor >= 0 && now >= me.reloadUntil) {
      me.ammo[me.reloadFor] = WEAPONS[me.reloadFor].mag;
      me.reloadFor = -1;
      this.hud.weapon(me.weapon, me.ammo[me.weapon]);
    }
    this.hud.reloadProgress(me.reloadFor >= 0 ? (now - me.reloadStart) / def.reload : -1);

    if (this.fireHeld && !this.paused && (def.auto || this.triggerFresh)) {
      this.triggerFresh = false;
      if (now >= me.nextFire && me.reloadFor < 0 && this.vm.switchT === 0) {
        if (me.ammo[me.weapon] > 0) this.shoot(def);
        else { this.sound.empty(); me.nextFire = now + 0.25; this.startReload(); }
      }
    }
    me.bloom = Math.max(0, me.bloom - dt * 0.06);

    const spread = this.currentSpread(def, aiming, hs);
    this.hud.crosshair(spread, !(aiming && this.vm.aim > 0.5));

    me.stateT += dt;
    if (me.stateT >= STATE_RATE) {
      me.stateT = 0;
      const r2 = (v) => Math.round(v * 100) / 100;
      this.send({ t: 'st', p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], yaw: r2(me.yaw), pitch: r2(me.pitch), w: me.weapon, c: me.crouching ? 1 : 0 });
    }

    let near = false;
    this.map.pickups.forEach((p, i) => {
      if (!this.pickupOn[i]) return;
      const d = Math.hypot(p.x - me.pos.x, p.y - me.pos.y, p.z - me.pos.z);
      if (d < 1.3) {
        near = true;
        if (me.hp < 100 && now - me.lastPick > 0.5) {
          me.lastPick = now;
          this.send({ t: 'pick', i });
        }
      }
    });
    this.hud.pickupHint(near && me.hp >= 100);
  }

  currentSpread(def, aiming, speed) {
    const me = this.me;
    let s = def.spread + def.moveSpread * Math.min(1, speed / 5) + me.bloom;
    if (!me.onGround) s += def.moveSpread * 1.5;
    if (me.crouching) s *= 0.75;
    if (aiming) s = def.adsSpread !== undefined && this.vm.aim > 0.9 ? def.adsSpread + me.bloom * 0.2 : s * 0.4;
    return s;
  }

  shoot(def) {
    const me = this.me;
    const now = this.now;
    me.ammo[me.weapon]--;
    me.nextFire = now + def.fireRate;
    const aiming = this.aimHeld;
    const spread = this.currentSpread(def, aiming, Math.hypot(me.vel.x, me.vel.z));
    const cam = this.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const aimDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(me.pitch, me.yaw, 0, 'YXZ'));
    const o = [origin.x, origin.y, origin.z];
    const muzzle = this.vm.muzzleInCamera(new THREE.Vector3());
    cam.updateMatrixWorld();
    cam.localToWorld(muzzle);

    const hits = new Map();
    let firstEnd = null;
    const dir = new THREE.Vector3();
    for (let i = 0; i < def.pellets; i++) {
      randomCone(aimDir, spread, dir);
      const d = [dir.x, dir.y, dir.z];
      const wh = raycastWorld(this.map.colliders, o, d, def.range);
      let t = wh ? wh.t : def.range;
      let target = null;
      let head = false;
      for (const [id, av] of this.avatars) {
        if (av.dead || !av.group.visible) continue;
        const p = this.roster.get(id);
        if (p && this.isFriend(p)) continue;
        const h = av.crouch > 0.5 ? CROUCH_HEIGHT : STAND_HEIGHT;
        const r = rayPlayer(o, d, av.group.position, h);
        if (r && r.t < t) { t = r.t; target = id; head = r.head; }
      }
      const end = new THREE.Vector3().copy(origin).addScaledVector(dir, t);
      if (!firstEnd) firstEnd = end;
      if (target) {
        let dmg = def.damage * (head ? def.head : 1);
        if (def.id === 'shotgun') dmg *= THREE.MathUtils.clamp(1 - (t - 8) / 30, 0.3, 1);
        const acc = hits.get(target) || { d: 0, h: false };
        acc.d += dmg;
        acc.h = acc.h || head;
        hits.set(target, acc);
        this.effects.blood(end, dir);
      } else if (wh) {
        this.effects.impact(end, wh.normal);
      }
      if (i < 3) this.effects.tracer(muzzle, end);
    }
    for (const [v, h] of hits) this.send({ t: 'hit', v, d: Math.round(h.d * 10) / 10, h: h.h, w: me.weapon });
    if (hits.size) {
      const anyHead = [...hits.values()].some((h) => h.h);
      this.hud.hitmarker(anyHead, false);
      this.sound.hit(anyHead);
    }
    const r2 = (v) => Math.round(v * 100) / 100;
    this.send({ t: 'shot', w: me.weapon, e: [r2(firstEnd.x), r2(firstEnd.y), r2(firstEnd.z)] });

    this.vm.fire();
    this.sound.shot(def);
    if (def.id === 'shotgun') this.sound.pump(0.35);
    const right = V1.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = V2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (def.id !== 'shotgun') this.effects.shell(muzzle.clone().addScaledVector(right, 0.05).addScaledVector(up, 0.02), right.clone(), up.clone());

    const rk = def.recoil * (aiming ? 0.6 : 1) * (me.crouching ? 0.8 : 1);
    me.pitch += rk * (0.55 + Math.random() * 0.3);
    me.yaw += (Math.random() - 0.5) * rk * 0.5;
    me.punch += rk * 0.6;
    me.bloom = Math.min(0.06, me.bloom + (def.auto ? 0.004 : 0.012));
    this.hud.weapon(me.weapon, me.ammo[me.weapon]);
    if (me.ammo[me.weapon] === 0) setTimeout(() => { if (this.me === me && me.ammo[me.weapon] === 0) this.startReload(); }, 250);
  }

  updatePickups(dt) {
    const t = this.now;
    this.pickupMeshes.forEach((m, i) => {
      if (!m.visible) return;
      const box = m.userData.box;
      box.position.y = 0.5 + Math.sin(t * 2 + i) * 0.08;
      box.rotation.y = t * 1.2 + i;
      m.userData.ring.material.opacity = 0.25 + Math.sin(t * 3 + i) * 0.1;
    });
  }

  loop(ts) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    if (!this.scene) return;
    if (this.running) {
      if (this.onTick) this.onTick(dt);
      this.updateLocal(dt);
      const rt = this.now - INTERP_DELAY;
      for (const av of this.avatars.values()) av.update(dt, rt);
      this.updatePickups(dt);
      const me = this.me;
      this.sound.listener = { x: me.pos.x, z: me.pos.z, yaw: me.yaw };
      this.vm.update(dt, {
        aiming: this.aimHeld && me.alive && me.reloadFor < 0,
        sprinting: this.keys.has('ShiftLeft') && this.keys.has('KeyW') && !this.fireHeld,
        speed: Math.hypot(me.vel.x, me.vel.z),
        onGround: me.onGround,
        lookDX: this.look.lastDX,
        lookDY: this.look.lastDY,
      });
      this.hud.update(dt);
      this.hud.clickHint(!this.locked && !this.paused);
      this.hud.scoreboard(this.tabHeld, [...this.roster.values()].map((p) => ({ ...p, color: this.displayColor(p) })), this.localId, this.settings.mode === 'tdm', this.teamScores());
    } else {
      this.orbit += dt * 0.05;
      const r = this.map.half * 0.9;
      this.camera.position.set(Math.cos(this.orbit) * r, 14, Math.sin(this.orbit) * r);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(0, 1, 0);
      this.updatePickups(dt);
    }
    this.effects.update(dt);
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.running && this.me?.alive) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }
}
