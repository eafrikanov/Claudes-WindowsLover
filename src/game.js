import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextureLibrary, setAnisotropy, toon, rng } from './textures.js';
import { buildMap } from './map.js';
import { ViewModel } from './viewmodel.js';
import { Avatar } from './avatar.js';
import { Effects } from './effects.js';
import { WEAPONS, SLOT_WEAPONS, WEAPON_INDEX } from './weapons.js';
import { Projectiles } from './projectiles.js';
import { moveBody, raycastWorld, rayPlayer, blocked, lineOfSight, PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT, GRAVITY, JUMP_SPEED } from './physics.js';
import { Hud, esc } from './hud.js';
import { addOutlines } from './outline.js';
import { RESPAWN_DELAY, STATE_RATE } from './match.js';
import { MC, MC_QUALITY, McPost, mcEnv, mcSky, fitShadow, setupRenderer } from './style-mc.js';
import { mcMedkitBox } from './mc-gear.js';

export const QUALITY = {
  low: { label: 'Низкое', pixel: 0.75, shadows: 0, tex: 256 },
  medium: { label: 'Среднее', pixel: 1, shadows: 2048, tex: 512 },
  high: { label: 'Высокое', pixel: 2, shadows: 4096, tex: 1024 },
};

export const DRAW_DISTANCE = {
  near: { label: 'Ближняя', fog: 1.6, far: 480 },
  mid: { label: 'Средняя', fog: 1, far: 500 },
  far: { label: 'Дальняя', fog: 0.55, far: 900 },
};

export const TEAM_COLORS = ['#3d82e0', '#e0493d'];
const GRENADES = 2;
const GRENADE = WEAPONS[WEAPON_INDEX.grenade];

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

export function medkit() {
  const g = MC ? mcMedkitBox() : medkitBox();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 32),
    new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  const root = new THREE.Group();
  root.add(g, ring);
  addOutlines(g, 0.012);
  root.userData.box = g;
  root.userData.ring = ring;
  return root;
}

function medkitBox() {
  const g = new THREE.Group();
  const white = toon({ color: 0xf7f7f2 });
  const red = toon({ color: 0xff2a2a, emissive: 0x900000, emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.34, 3, 0.05), white);
  body.castShadow = true;
  g.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 8, 16, Math.PI), toon({ color: 0x333333 }));
  handle.position.y = 0.15;
  g.add(handle);
  for (const [w, d] of [[0.26, 0.08], [0.08, 0.26]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.31, d * 0.8), red);
    g.add(c);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, d * 0.9, 0.345), red);
    g.add(s);
  }
  return g;
}

// Небо: градиент от горизонта к зениту, солнце-диск и пухлые облака.
function cartoonSky(env, sunDir) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(env.skyTop) },
      horizon: { value: new THREE.Color(env.skyHorizon) },
      bottom: { value: new THREE.Color(env.skyBottom) },
      sunDir: { value: sunDir.clone() },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.7, h), 0.8)) : mix(horizon, bottom, smoothstep(0.0, -0.2, h));
        float s = dot(normalize(vDir), normalize(sunDir));
        c = mix(c, vec3(1.0, 0.98, 0.9), smoothstep(0.9965, 0.998, s));
        c += vec3(1.0, 0.9, 0.7) * pow(max(s, 0.0), 40.0) * 0.25;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  dome.renderOrder = -1;
  group.add(dome);
  const cloudMat = toon({ color: env.clouds, emissive: env.clouds, emissiveIntensity: 0.35, fog: false });
  const r = rng(7);
  const puff = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(puff, cloudMat);
      const s = 6 + r() * 6;
      p.scale.set(s * 1.3, s * 0.8, s);
      p.position.set((k - n / 2) * 8 + r() * 4, r() * 3, r() * 5);
      cloud.add(p);
    }
    const a = (i / 14) * Math.PI * 2 + r() * 0.3;
    const d = 180 + r() * 90;
    cloud.position.set(Math.cos(a) * d, 55 + r() * 45, Math.sin(a) * d);
    cloud.lookAt(0, cloud.position.y, 0);
    group.add(cloud);
  }
  return group;
}

export class Game {
  constructor(canvas, sound, prefs) {
    this.canvas = canvas;
    this.sound = sound;
    this.prefs = { ...prefs };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    if (MC) setupRenderer(this.renderer);
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
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
    this.crouchToggled = false;
    this.sprintToggled = false;
    this.tabHeld = false;
    this.noLock = new URLSearchParams(location.search).has('nolock');
    this.send = () => {};
    this.stateRate = STATE_RATE;
    this.onPause = () => {};
    this.onTick = null;
    this.avatars = new Map();
    this.roster = new Map();
    this.orbit = 0;
    this.last = performance.now();
    this.fpsN = 0;
    this.fpsT = 0;
    this.hud.showFps(this.prefs.showFps);
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
    const reload = !!this.scene && prefs.quality !== this.loadedQuality;
    this.prefs = { ...prefs };
    this.sound.setVolume(prefs.volume, prefs.fxVolume, prefs.uiVolume);
    this.hud.showFps(prefs.showFps);
    this.applyDrawDistance();
    this.resize();
    return reload;
  }

  applyDrawDistance() {
    const d = DRAW_DISTANCE[this.prefs.drawDist] || DRAW_DISTANCE.mid;
    if (this.scene?.fog) this.scene.fog.density = this.baseFog * d.fog;
    this.camera.far = d.far;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio * this.quality.pixel) * this.prefs.renderScale / 100);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm?.resize(w / h);
    this.post?.setSize(w, h);
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
      if (!e.repeat && (e.code === 'ControlLeft' || e.code === 'KeyC') && this.prefs.crouchMode === 'toggle') this.crouchToggled = !this.crouchToggled;
      if (!e.repeat && e.code === 'ShiftLeft') this.sprintKey();
      if (e.code === 'Tab') this.tabHeld = true;
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'KeyQ') this.selectWeapon(this.prevWeapon ?? 0);
      if (e.code === 'KeyG') this.throwGrenade();
      const idx = SLOT_WEAPONS.findIndex((w) => `Digit${w.key}` === e.code);
      if (idx >= 0) this.selectWeapon(idx);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.tabHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; this.aimHeld = false; this.resetToggles(); });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.running || this.paused) return;
      this.sound.unlock();
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.fireHeld = true; this.triggerFresh = true; }
      if (e.button === 2) this.aimHeld = this.prefs.aimMode === 'toggle' ? !this.aimHeld : true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2 && this.prefs.aimMode !== 'toggle') this.aimHeld = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.running || !this.locked || this.paused) return;
      this.look.dx += e.movementX;
      this.look.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.running || !this.locked || this.paused || !this.me) return;
      const n = SLOT_WEAPONS.length;
      this.selectWeapon((this.me.weapon + (e.deltaY > 0 ? 1 : -1) + n) % n);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (this.running && !this.locked && !this.paused) this.setPaused(true);
    });
  }

  // Присед со щелчка снимается нажатием бега, если над головой есть место.
  sprintKey() {
    const me = this.me;
    if (this.crouchToggled && me && !blocked(this.map.colliders, me.pos.x, me.pos.y + 0.01, me.pos.z, PLAYER_RADIUS, STAND_HEIGHT)) this.crouchToggled = false;
    if (this.prefs.sprintMode === 'toggle') this.sprintToggled = !this.sprintToggled;
  }

  resetToggles() {
    if (this.prefs.aimMode === 'toggle') this.aimHeld = false;
    this.crouchToggled = false;
    this.sprintToggled = false;
  }

  setPaused(v) {
    this.paused = v;
    this.keys.clear();
    this.fireHeld = false;
    this.aimHeld = false;
    this.resetToggles();
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
    const env = MC ? mcEnv(map.env) : map.env;
    scene.add(map.group);

    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - env.elevation), THREE.MathUtils.degToRad(env.azimuth));
    scene.add(MC ? mcSky(env, sunDir) : cartoonSky(env, sunDir));
    scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);
    this.baseFog = env.fogDensity;

    const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiIntensity);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(env.sun, env.sunIntensity);
    sun.position.copy(sunDir).multiplyScalar(70);
    scene.add(sun, sun.target);
    const mq = MC && (MC_QUALITY[this.prefs.quality] || MC_QUALITY.medium);
    const bounds = mq && new THREE.Box3().setFromObject(map.group).expandByVector(new THREE.Vector3(0, 2, 0));
    this.renderer.shadowMap.enabled = (mq || q).shadows > 0;
    if (mq) {
      fitShadow(sun, bounds, mq.shadows, env);
    } else if (q.shadows) {
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
    this.projectiles = new Projectiles(scene, this.effects, this.textures.weaponMaterials());
    this.projectiles.onExplode = (p, point, normal, direct) => this.onExplode(p, point, normal, direct);
    this.vm = new ViewModel(this.textures);
    this.vm.setLights(env);
    this.vm.resize(this.camera.aspect);
    if (MC) {
      this.post = new McPost(this.renderer, scene, this.camera, this.vm, env, this.prefs.quality, bounds);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }

    this.scene = scene;
    this.map = map;
    this.mapId = mapId;
    this.loadedQuality = this.prefs.quality;
    this.applyDrawDistance();
    this.renderer.compile(scene, this.camera);
  }

  disposeScene() {
    if (!this.scene) return;
    this.post?.dispose();
    this.post = null;
    for (const av of this.avatars.values()) av.dispose();
    this.avatars.clear();
    this.scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    });
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
      yaw: 0, pitch: 0, punch: 0, onGround: false, height: STAND_HEIGHT, crouching: false, sprinting: false,
      alive: false, hp: 100, weapon: 1, ammo: WEAPONS.map((w) => w.mag), nextFire: 0, reloadUntil: 0, reloadFor: -1,
      stepT: 0, stateT: 0, deathT: 0, killer: null, lastPick: 0, waiting: true,
      grenades: GRENADES, nextThrow: 0, spin: 0, shake: 0, pidN: 0,
    };
    this.prevWeapon = 0;
    this.resetToggles();
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
    this.hud.grenades(GRENADES);
    this.projectiles.clear();
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
    this.projectiles?.clear();
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
    if (!me || !me.alive || i === me.weapon || i < 0 || i >= SLOT_WEAPONS.length) return;
    me.spin = 0;
    this.prevWeapon = me.weapon;
    me.weapon = i;
    me.reloadUntil = 0;
    me.reloadFor = -1;
    me.nextFire = Math.max(me.nextFire, this.now + 0.3);
    if (this.prefs.aimMode === 'toggle') this.aimHeld = false;
    this.vm.switchTo(i);
    this.hud.weapon(i, me.ammo[i]);
    this.hud.reloadProgress(-1);
    this.sound.click(0.05, 1200, 0.25);
  }

  startReload() {
    const me = this.me;
    if (!me || !me.alive || me.reloadUntil > this.now) return;
    const def = WEAPONS[me.weapon];
    if (!def.mag || me.ammo[me.weapon] >= def.mag) return;
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
        for (const [id, ts, x, y, z, vx, vy, vz, yaw, pitch, w, c] of msg.s) {
          if (id === this.localId) continue;
          const av = this.avatars.get(id);
          if (av && !av.dead) av.pushState({ t: ts / 1000, x, y, z, vx, vy, vz, yaw, pitch, c, w: WEAPONS[w]?.id || 'rifle' }, now);
        }
        break;
      case 'shot': {
        if (msg.id === this.localId) break;
        const av = this.avatars.get(msg.id);
        const def = WEAPONS[msg.w];
        if (!av || !def) break;
        const from = av.muzzleWorld(new THREE.Vector3());
        if (msg.pid && msg.o && msg.v) {
          this.projectiles.spawn({ pid: msg.pid, kind: def.type === 'rocket' ? 'rocket' : 'grenade', owner: msg.id, def, pos: new THREE.Vector3(...msg.o), vel: new THREE.Vector3(...msg.v), local: false });
          if (def.type === 'rocket') this.sound.launch(from.x, from.z);
          else this.sound.throwSound(from.x, from.z);
          break;
        }
        if (!msg.e) break;
        const to = new THREE.Vector3(...msg.e);
        if (def.type === 'melee') {
          this.sound.swish(from.x, from.z);
          break;
        }
        if (def.type === 'beam') this.effects.beam(from, to);
        else this.effects.tracer(from, to);
        if (def.type === 'beam') this.sound.zap(from.x, from.z);
        else this.sound.shot(def, from.x, from.z);
        const nearPlayer = this.me?.alive && to.distanceTo(V1.copy(this.me.pos).setY(this.me.pos.y + 1)) < 1.2;
        if (!nearPlayer && def.type !== 'beam') this.effects.particles(to, V1.set(0, 1, 0), 4, new THREE.Color(1, 0.6, 0.2), 3, 1.5, 10, 0.2, 1.2);
        break;
      }
      case 'boom': {
        if (msg.id === this.localId) break;
        const def = WEAPONS[msg.w];
        if (!def) break;
        this.projectiles.removeByPid(msg.pid);
        this.boomFx(new THREE.Vector3(...msg.p), msg.n || [0, 1, 0], def);
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
          if (msg.kb && me.alive) {
            me.vel.x += msg.kb[0];
            me.vel.y = Math.max(me.vel.y, 0) + msg.kb[1];
            me.vel.z += msg.kb[2];
            me.onGround = false;
          }
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
          me.sprinting = false;
          this.resetToggles();
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
          this.resetToggles();
          me.ammo = WEAPONS.map((w) => w.mag);
          me.grenades = GRENADES;
          me.spin = 0;
          this.hud.grenades(GRENADES);
          for (const g of this.vm.guns) if (g.model.rocket) g.model.rocket.visible = true;
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
    const aiming = this.aimHeld && me.alive && me.reloadUntil <= now && !def.noAds;
    const zoom = aiming ? def.adsFov / this.prefs.fov : 1;
    const sens = this.prefs.sensitivity * 0.0029 * (aiming ? Math.max(0.25, zoom) * this.prefs.adsSens : 1);
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
    const wantCrouch = this.prefs.crouchMode === 'toggle' ? this.crouchToggled : input.has('ControlLeft') || input.has('KeyC');
    const cols = this.map.colliders;
    const targetH = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
    if (targetH > me.height && blocked(cols, me.pos.x, me.pos.y + 0.01, me.pos.z, PLAYER_RADIUS, targetH)) {
      me.crouching = true;
    } else {
      me.height += (targetH - me.height) * Math.min(1, dt * 12);
      me.crouching = wantCrouch;
    }
    const noSprint = !(fx || fz) || aiming || me.crouching || this.fireHeld;
    if (noSprint) this.sprintToggled = false;
    me.sprinting = !noSprint && (this.prefs.sprintMode === 'toggle' ? this.sprintToggled : input.has('ShiftLeft'));
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    const sin = Math.sin(me.yaw);
    const cos = Math.cos(me.yaw);
    const wx = -sin * fz + cos * fx;
    const wz = -cos * fz - sin * fx;
    let speed = me.crouching ? 1.76 : me.sprinting ? 6.08 : 4;
    if (aiming) speed *= 0.75;
    if (def.moveMul) speed *= def.spinup ? (me.spin > 0 ? def.moveMul : 1) : def.moveMul;
    const accel = me.onGround ? 25 : 12;
    me.vel.x += (wx * speed - me.vel.x) * Math.min(1, dt * accel);
    me.vel.z += (wz * speed - me.vel.z) * Math.min(1, dt * accel);
    if (input.has('Space') && me.onGround) {
      me.vel.y = JUMP_SPEED;
      me.onGround = false;
    }
    me.vel.y -= GRAVITY * dt;
    me.onGround = moveBody(cols, me.pos, me.vel, dt, PLAYER_RADIUS, me.height, me.onGround);
    if (me.pos.y < -30) me.pos.set(0, 5, 0);

    const hs = Math.hypot(me.vel.x, me.vel.z);
    if (me.onGround && hs > 1.5 && !me.crouching) {
      me.stepT -= dt * hs;
      if (me.stepT <= 0) { me.stepT = 2; this.sound.step(me.sprinting ? 0.16 : 0.1); }
    }

    me.punch += (0 - me.punch) * Math.min(1, dt * 10);
    cam.position.set(me.pos.x, me.pos.y + me.height - 0.16, me.pos.z);
    cam.rotation.set(me.pitch + me.punch, me.yaw, 0);
    if (me.shake > 0) {
      const k = this.prefs.screenShake ? me.shake * me.shake : 0;
      cam.rotation.x += (Math.random() - 0.5) * k * 0.09;
      cam.rotation.y += (Math.random() - 0.5) * k * 0.09;
      cam.rotation.z = (Math.random() - 0.5) * k * 0.06;
      cam.position.y += (Math.random() - 0.5) * k * 0.08;
      me.shake = Math.max(0, me.shake - dt * 1.6);
    }

    if (me.reloadFor >= 0 && now >= me.reloadUntil) {
      me.ammo[me.reloadFor] = WEAPONS[me.reloadFor].mag;
      me.reloadFor = -1;
      this.hud.weapon(me.weapon, me.ammo[me.weapon]);
    }
    this.hud.reloadProgress(me.reloadFor >= 0 ? (now - me.reloadStart) / def.reload : -1);

    if (def.spinup) {
      const want = this.fireHeld && !this.paused && me.reloadFor < 0;
      me.spin = want ? Math.min(1, me.spin + dt / def.spinup) : Math.max(0, me.spin - dt / 0.8);
    }
    this.vm.spin = def.spinup ? me.spin : 0;
    if (this.fireHeld && !this.paused && (def.auto || this.triggerFresh) && (!def.spinup || me.spin >= 1)) {
      this.triggerFresh = false;
      if (now >= me.nextFire && me.reloadFor < 0 && this.vm.switchT === 0) {
        if (!def.mag || me.ammo[me.weapon] > 0) this.shoot(def);
        else { this.sound.empty(); me.nextFire = now + 0.25; this.startReload(); }
      }
    }

    const spread = this.currentSpread(def, aiming);
    this.hud.crosshair(spread, !(aiming && this.vm.aim > 0.5));

    me.stateT += dt;
    if (me.stateT >= this.stateRate) {
      me.stateT = Math.min(me.stateT - this.stateRate, this.stateRate);
      const r2 = (v) => Math.round(v * 100) / 100;
      const r1 = (v) => Math.round(v * 10) / 10;
      this.send({
        t: 'st', ts: Math.round(now * 1000), p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], v: [r1(me.vel.x), r1(me.vel.y), r1(me.vel.z)],
        yaw: r2(me.yaw), pitch: r2(me.pitch), w: me.weapon, c: me.crouching ? 1 : 0,
      });
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

  currentSpread(def, aiming) {
    const k = this.me?.crouching ? 0.7 : 1;
    if (aiming) return (def.adsSpread !== undefined && this.vm.aim > 0.9 ? def.adsSpread : def.spread * 0.4) * k;
    return def.spread * k;
  }

  aimTarget(origin, aimDir, range = 300) {
    const wh = raycastWorld(this.map.colliders, [origin.x, origin.y, origin.z], [aimDir.x, aimDir.y, aimDir.z], range);
    return origin.clone().addScaledVector(aimDir, wh ? wh.t : range);
  }

  newPid() {
    return `${this.localId}:${++this.me.pidN}`;
  }

  shoot(def) {
    const me = this.me;
    const now = this.now;
    if (def.mag) me.ammo[me.weapon]--;
    me.nextFire = now + def.fireRate;
    if (def.type === 'rocket') return this.fireRocket(def);
    if (def.type === 'melee') return this.melee(def);
    const aiming = this.aimHeld;
    const spread = this.currentSpread(def, aiming);
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
      if (def.type === 'beam') this.effects.beam(muzzle, end);
      else if (i < 3) this.effects.tracer(muzzle, end);
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
    if (def.type === 'beam') this.sound.zap();
    else this.sound.shot(def);
    if (def.id === 'shotgun') this.sound.pump(0.35);
    const right = V1.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = V2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (def.id !== 'shotgun' && def.type !== 'beam') this.effects.shell(muzzle.clone().addScaledVector(right, 0.05).addScaledVector(up, 0.02), right.clone(), up.clone());

    const rk = def.recoil * (aiming ? 0.6 : 1) * (me.crouching ? 0.8 : 1);
    me.punch += rk * 0.6;
    this.hud.weapon(me.weapon, me.ammo[me.weapon]);
    if (me.ammo[me.weapon] === 0) setTimeout(() => { if (this.me === me && me.ammo[me.weapon] === 0) this.startReload(); }, 250);
  }

  fireRocket(def) {
    const me = this.me;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const aimDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(me.pitch, me.yaw, 0, 'YXZ'));
    const muzzle = cam.localToWorld(this.vm.muzzleInCamera(new THREE.Vector3()));
    const target = this.aimTarget(origin, aimDir);
    const dir = target.sub(muzzle).normalize();
    if (dir.dot(aimDir) < 0.8) dir.copy(aimDir);
    const vel = dir.multiplyScalar(def.speed);
    const pid = this.newPid();
    this.projectiles.spawn({ pid, kind: 'rocket', owner: this.localId, def, pos: muzzle, vel, local: true });
    const r2 = (v) => Math.round(v * 100) / 100;
    this.send({ t: 'shot', w: me.weapon, pid, o: muzzle.toArray().map(r2), v: vel.toArray().map(r2) });
    this.vm.fire();
    this.sound.launch();
    for (let i = 0; i < 4; i++) this.effects.puff(muzzle.clone().addScaledVector(aimDir, -0.9 - i * 0.2), { size: 0.2, grow: 3, life: 0.8, vel: aimDir.clone().multiplyScalar(-2) });
    me.punch += def.recoil;
    me.shake = Math.max(me.shake, 0.35);
    this.hud.weapon(me.weapon, me.ammo[me.weapon]);
    if (me.ammo[me.weapon] === 0) setTimeout(() => { if (this.me === me && me.ammo[me.weapon] === 0) this.startReload(); }, 300);
  }

  melee(def) {
    const me = this.me;
    const cam = this.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const o = [origin.x, origin.y, origin.z];
    let best = null;
    for (const off of [0, -0.18, 0.18]) {
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(me.pitch, me.yaw + off, 0, 'YXZ'));
      const d = [dir.x, dir.y, dir.z];
      const wall = raycastWorld(this.map.colliders, o, d, def.range);
      for (const [id, av] of this.avatars) {
        if (av.dead || !av.group.visible) continue;
        const p = this.roster.get(id);
        if (p && this.isFriend(p)) continue;
        const r = rayPlayer(o, d, av.group.position, av.crouch > 0.5 ? CROUCH_HEIGHT : STAND_HEIGHT);
        if (r && r.t <= def.range && (!wall || r.t < wall.t) && (!best || r.t < best.t)) best = { id, t: r.t, head: r.head, dir };
      }
    }
    this.vm.fire();
    this.sound.swish();
    const r2 = (v) => Math.round(v * 100) / 100;
    if (best) {
      const end = origin.clone().addScaledVector(best.dir, best.t);
      this.effects.blood(end, best.dir);
      const kb = best.dir.clone().setY(0.4).normalize().multiplyScalar(5);
      this.send({ t: 'hit', v: best.id, d: def.damage * (best.head ? def.head : 1), h: best.head, w: me.weapon, kb: kb.toArray().map(r2) });
      this.hud.hitmarker(best.head, false);
      this.sound.hit(best.head);
    }
    this.send({ t: 'shot', w: me.weapon, e: origin.toArray().map(r2) });
  }

  throwGrenade() {
    const me = this.me;
    const now = this.now;
    if (!this.running || this.paused || !me?.alive || me.grenades <= 0 || now < me.nextThrow) return;
    me.grenades--;
    me.nextThrow = now + GRENADE.fireRate;
    this.hud.grenades(me.grenades);
    const cam = this.camera;
    const aimDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(me.pitch, me.yaw, 0, 'YXZ'));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const pos = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(aimDir, 0.4).addScaledVector(right, 0.15);
    const vel = aimDir.clone().multiplyScalar(GRENADE.speed).add(new THREE.Vector3(0, 3, 0)).addScaledVector(me.vel, 0.5);
    if (blocked(this.map.colliders, pos.x - 0.05, pos.y - 0.05, pos.z - 0.05, 0.05, 0.1)) pos.copy(cam.position);
    const pid = this.newPid();
    this.projectiles.spawn({ pid, kind: 'grenade', owner: this.localId, def: GRENADE, pos, vel, local: true });
    const r2 = (v) => Math.round(v * 100) / 100;
    this.send({ t: 'shot', w: WEAPON_INDEX.grenade, pid, o: pos.toArray().map(r2), v: vel.toArray().map(r2) });
    this.vm.throwGrenade();
    this.sound.throwSound();
  }

  boomFx(point, normal, def) {
    this.effects.explosion(point, normal, def.radius / 5);
    this.sound.boom(point.x, point.z);
    if (this.me?.alive) {
      const d = point.distanceTo(this.me.pos);
      this.me.shake = Math.max(this.me.shake, Math.max(0, 1 - d / 28) * 1.1);
    }
  }

  // Урон по площади считает владелец снаряда и отправляет хосту, как обычные попадания.
  onExplode(p, point, normal, direct) {
    const def = p.def;
    this.boomFx(point, normal, def);
    if (!p.local || !this.me) return;
    const r2 = (v) => Math.round(v * 100) / 100;
    const from = [point.x + normal[0] * 0.3, point.y + normal[1] * 0.3, point.z + normal[2] * 0.3];
    let anyHit = false;
    for (const [id, av] of this.avatars) {
      if (av.dead || !av.group.visible) continue;
      const pl = this.roster.get(id);
      if (pl && this.isFriend(pl)) continue;
      const c = av.group.position.clone().setY(av.group.position.y + 1);
      const dist = c.distanceTo(point);
      if (dist > def.radius && id !== direct) continue;
      if (id !== direct && !lineOfSight(this.map.colliders, from, [c.x, c.y, c.z])) continue;
      const k = id === direct ? 1 : Math.pow(Math.max(0, 1 - dist / def.radius), 0.6);
      const dmg = Math.round(def.damage * k);
      if (dmg <= 0) continue;
      const kb = c.clone().sub(point).setY(0).normalize().setY(0.7).multiplyScalar(def.knockback * Math.max(0.4, k));
      this.send({ t: 'hit', v: id, d: dmg, h: false, w: WEAPON_INDEX[def.id], kb: kb.toArray().map(r2) });
      anyHit = true;
    }
    if (anyHit) {
      this.hud.hitmarker(false, false);
      this.sound.hit(false);
    }
    const me = this.me;
    if (me.alive) {
      const c = me.pos.clone().setY(me.pos.y + 0.9);
      const dist = c.distanceTo(point);
      if (dist < def.radius) {
        const k = 1 - dist / def.radius;
        const push = c.sub(point).normalize();
        me.vel.addScaledVector(push, def.knockback * 0.5 * k);
        me.vel.y = Math.max(me.vel.y, 0) + def.knockback * 0.3 * k;
        me.onGround = false;
      }
    }
    this.send({ t: 'boom', pid: p.pid, w: WEAPON_INDEX[def.id], p: point.toArray().map(r2), n: normal });
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
    const raw = (ts - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = ts;
    if (!this.scene) return;
    if (this.running && this.prefs.showFps) {
      this.fpsN++;
      this.fpsT += raw;
      if (this.fpsT >= 0.5) {
        this.hud.fps(Math.round(this.fpsN / this.fpsT));
        this.fpsN = 0;
        this.fpsT = 0;
      }
    }
    if (this.running) {
      if (this.onTick) this.onTick(dt);
      this.updateLocal(dt);
      this.projectiles.update(dt, this.map.colliders, this.avatars);
      const now = this.now;
      for (const av of this.avatars.values()) av.update(dt, now);
      this.updatePickups(dt);
      const me = this.me;
      this.sound.listener = { x: me.pos.x, z: me.pos.z, yaw: me.yaw };
      this.vm.update(dt, {
        aiming: this.aimHeld && me.alive && me.reloadFor < 0 && !SLOT_WEAPONS[me.weapon].noAds,
        sprinting: me.sprinting,
        bob: this.prefs.viewBob,
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
    this.renderFrame(this.running && this.me?.alive);
  }

  renderFrame(withVm) {
    if (this.post) return this.post.render(withVm);
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (withVm) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }
}
