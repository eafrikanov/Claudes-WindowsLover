// Дымовой тест настроек и скоростей движения. Нужен статический сервер:
//   npx http-server -p 8123 -s .   и затем   node tools/smoke-settings.mjs
// PORT — порт сервера, SHOTS — папка для скриншотов (по умолчанию не сохраняются).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* ищем глобальную установку */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const { chromium } = loadPlaywright();
const PORT = process.env.PORT || 8123;
const URL = `http://localhost:${PORT}/?nolock&style=cartoon`;
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
let failed = 0;
function check(ok, label, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (!ok) failed++;
}
const near = (v, want, tol = 0.15) => Math.abs(v - want) <= tol;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// Ждём n кадров игры: в swiftshader кадр бывает дольше любых фиксированных пауз.
const frames = (n) => page.evaluate((k) => new Promise((r) => { const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const prefsOf = () => page.evaluate(() => ({ ...window.__arena.game.prefs }));
const visible = (id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
async function setRange(id, v) {
  await page.evaluate(([i, val]) => {
    const el = document.getElementById(i);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, String(v)]);
}
const pickSeg = (id, v) => page.click(`#${id} button[data-v="${v}"]`);
async function setCheck(id, v) {
  if ((await page.isChecked(`#${id}`)) !== v) await page.click(`#${id}`);
}

try {
  await page.goto(URL);
  await page.waitForFunction(() => !document.getElementById('screen-menu').classList.contains('hidden'), null, { timeout: 60000 });

  // Старые сохранённые настройки без новых полей должны дополняться значениями по умолчанию.
  await page.evaluate(() => localStorage.setItem('gunarena-prefs', JSON.stringify({ name: 'Старый', color: '#ff8a1f', sensitivity: 1.5, fov: 80, volume: 0.5, quality: 'medium', invertY: false })));
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('screen-menu').classList.contains('hidden'), null, { timeout: 60000 });
  let p = await prefsOf();
  check(p.sensitivity === 1.5 && p.fov === 80 && p.adsSens === 1 && p.aimMode === 'hold' && p.drawDist === 'mid' && p.renderScale === 100 && p.fxVolume === 1, 'old prefs merged with defaults');

  // ——— экран настроек из главного меню ———
  await page.click('[data-go="settings"]');
  check(await visible('screen-settings'), 'settings screen opens from menu');
  await page.fill('#set-sens-num', '2.37');
  check(await page.inputValue('#set-sens') === '2.37' && (await page.textContent('#sens-val')) === '2.37', 'number input syncs slider and label');
  await setRange('set-sens', 1.25);
  check(await page.inputValue('#set-sens-num') === '1.25', 'slider syncs number input');
  await page.fill('#set-sens-num', '9');
  await page.press('#set-sens-num', 'Enter');
  await page.locator('#set-sens-num').blur();
  check(await page.inputValue('#set-sens-num') === '5' && (await prefsOf()).sensitivity === 5, 'number input clamps to 5');
  await page.fill('#set-sens-num', '1.37');
  await page.locator('#set-sens-num').blur();
  await setRange('set-ads', 1.5);
  await setCheck('set-invert', true);
  await pickSeg('set-aim-mode', 'toggle');
  await pickSeg('set-crouch-mode', 'toggle');
  await pickSeg('set-sprint-mode', 'toggle');
  await setRange('set-fov', 90);
  await setRange('set-scale', 75);
  await pickSeg('set-draw', 'near');
  let g = await page.evaluate(() => {
    const game = window.__arena.game;
    return { density: game.scene.fog.density, base: game.baseFog, far: game.camera.far, ratio: game.renderer.getPixelRatio(), dpr: devicePixelRatio };
  });
  check(near(g.density, g.base * 1.6, 1e-6) && g.far === 480, 'draw distance near applied live', `fog ${g.density.toFixed(5)} far ${g.far}`);
  check(near(g.ratio, Math.min(2, g.dpr) * 0.75, 1e-6), 'render scale 75% applied live', `pixelRatio ${g.ratio}`);
  await pickSeg('set-draw', 'far');
  g = await page.evaluate(() => ({ density: window.__arena.game.scene.fog.density, base: window.__arena.game.baseFog, far: window.__arena.game.camera.far }));
  check(near(g.density, g.base * 0.55, 1e-6) && g.far === 900, 'draw distance far applied live', `fog ${g.density.toFixed(5)} far ${g.far}`);
  await setCheck('set-bob', false);
  await setCheck('set-shake', false);
  await setCheck('set-fps', true);
  await setRange('set-vol', 0.8);
  await setRange('set-fxvol', 0.4);
  await setRange('set-uivol', 0.6);
  const labels = await page.evaluate(() => ['sens-val', 'ads-val', 'fov-val', 'scale-val', 'vol-val', 'fx-val', 'ui-val'].map((i) => document.getElementById(i).textContent).join(' '));
  check(labels === '1.37 ×1.50 90 75% 80% 40% 60%', 'labels show current values', labels);
  const snd = await page.evaluate(() => { const s = window.__arena.game.sound; return [s.volume, s.fxVolume, s.uiVolume, s.fx?.gain.value, s.ui?.gain.value]; });
  check(snd[0] === 0.8 && snd[1] === 0.4 && snd[2] === 0.6 && near(snd[3], 0.4, 1e-6) && near(snd[4], 0.6, 1e-6), 'audio buses follow sliders', JSON.stringify(snd));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'settings.png') });
  await page.click('#settings-done');
  check(await visible('screen-menu'), 'done returns to menu');

  // ——— сохранение после перезагрузки ———
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('screen-menu').classList.contains('hidden'), null, { timeout: 60000 });
  p = await prefsOf();
  const want = { sensitivity: 1.37, adsSens: 1.5, invertY: true, aimMode: 'toggle', crouchMode: 'toggle', sprintMode: 'toggle', fov: 90, renderScale: 75, drawDist: 'far', viewBob: false, screenShake: false, showFps: true, volume: 0.8, fxVolume: 0.4, uiVolume: 0.6 };
  const bad = Object.entries(want).filter(([k, v]) => p[k] !== v);
  check(!bad.length, 'all prefs persist after reload', bad.map(([k]) => `${k}=${p[k]}`).join(', '));
  await page.click('[data-go="settings"]');
  const ui = await page.evaluate(() => ({
    sens: document.getElementById('set-sens-num').value, scale: document.getElementById('set-scale').value,
    fps: document.getElementById('set-fps').checked, draw: document.querySelector('#set-draw .sel')?.dataset.v,
    sprint: document.querySelector('#set-sprint-mode .sel')?.dataset.v,
  }));
  check(ui.sens === '1.37' && ui.scale === '75' && ui.fps && ui.draw === 'far' && ui.sprint === 'toggle', 'settings UI reflects stored prefs', JSON.stringify(ui));
  for (const id of ['set-aim-mode', 'set-crouch-mode', 'set-sprint-mode']) await pickSeg(id, 'hold');
  await setCheck('set-bob', true);
  await page.click('#settings-done');

  // ——— тренировка без ботов ———
  await page.click('#btn-training');
  await setRange('opt-bots', 0);
  await page.click('#create-go');
  await page.waitForFunction(() => window.__arena.game.me?.alive, null, { timeout: 60000 });
  await sleep(600);

  // Ставит игрока на свободную полосу так, чтобы заданная комбинация клавиш вела вдоль неё.
  const place = (offset) => page.evaluate((off) => {
    const game = window.__arena.game;
    const cols = game.map.colliders;
    const hit = (x, z) => cols.some((b) => x + 0.45 > b.min[0] && x - 0.45 < b.max[0] && 1.85 > b.min[1] && 0.05 < b.max[1] && z + 0.45 > b.min[2] && z - 0.45 < b.max[2]);
    let best = null;
    for (const n of window.__arena.state.match.nav) {
      for (let a = 0; a < 16; a++) {
        const yaw = (a / 16) * Math.PI * 2;
        const dx = -Math.sin(yaw);
        const dz = -Math.cos(yaw);
        let len = 0;
        while (len < 14 && !hit(n.x + dx * len, n.z + dz * len)) len += 0.25;
        if (!best || len > best.len) best = { n, yaw, len };
        if (len >= 14) break;
      }
      if (best.len >= 14) break;
    }
    const me = game.me;
    me.pos.set(best.n.x, 0.05, best.n.z);
    me.vel.set(0, 0, 0);
    me.yaw = best.yaw + off;
    me.pitch = 0;
    return best.len;
  }, offset);
  const hspeed = () => page.evaluate(() => Math.hypot(window.__arena.game.me.vel.x, window.__arena.game.me.vel.z));
  async function measure(keys, offset = 0, extra) {
    await place(offset);
    await frames(4);
    for (const k of keys) await page.keyboard.down(k);
    if (extra) await extra.start();
    let max = 0;
    for (let i = 0; i < 10; i++) {
      await sleep(100);
      max = Math.max(max, await hspeed());
    }
    if (extra) await extra.stop();
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
    await frames(4);
    return max;
  }
  await page.mouse.move(640, 400);
  const fire = { start: () => page.mouse.down(), stop: () => page.mouse.up() };
  const aim = { start: () => page.mouse.down({ button: 'right' }), stop: () => page.mouse.up({ button: 'right' }) };
  const weapon = await page.evaluate(() => { const g = window.__arena.game; const d = g.vm.guns[g.me.weapon].def; return `${d.id}, moveMul ${d.moveMul ?? 'none'}`; });
  console.log(`default weapon: ${weapon}`);

  const runs = [
    ['walk W', ['KeyW'], 0, null, 5],
    ['walk S (back)', ['KeyS'], Math.PI, null, 5],
    ['sprint W+Shift', ['ShiftLeft', 'KeyW'], 0, null, 7.6],
    ['sprint A+Shift (strafe)', ['ShiftLeft', 'KeyA'], -Math.PI / 2, null, 7.6],
    ['sprint S+Shift (back)', ['ShiftLeft', 'KeyS'], Math.PI, null, 7.6],
    ['sprint W+D+Shift (diagonal)', ['ShiftLeft', 'KeyW', 'KeyD'], Math.PI / 4, null, 7.6],
    ['crouch C+W', ['KeyC', 'KeyW'], 0, null, 2.2],
    ['crouch Ctrl+W', ['ControlLeft', 'KeyW'], 0, null, 2.2],
    ['crouch+Shift (no sprint)', ['KeyC', 'ShiftLeft', 'KeyW'], 0, null, 2.2],
    ['sprint while firing = walk', ['ShiftLeft', 'KeyW'], 0, fire, 5],
    ['aim W (×0.75)', ['KeyW'], 0, aim, 3.75],
    ['aim+Shift (no sprint)', ['ShiftLeft', 'KeyW'], 0, aim, 3.75],
  ];
  for (const [label, keys, off, extra, wantV] of runs) {
    const v = await measure(keys, off, extra);
    check(near(v, wantV), `speed ${label}`, `${v.toFixed(2)} (want ${wantV})`);
  }
  await page.keyboard.press('Digit8');
  await sleep(500);
  let v = await measure(['KeyW'], 0);
  check(near(v, 5 * 1.12), 'knife walk (moveMul 1.12)', `${v.toFixed(2)} (want 5.6)`);
  v = await measure(['ShiftLeft', 'KeyW'], 0);
  check(near(v, 7.6 * 1.12), 'knife sprint', `${v.toFixed(2)} (want 8.51)`);
  await page.keyboard.press('Digit2');
  await sleep(500);

  // Разброс в приседе и прицел.
  const spread = () => page.evaluate(() => {
    const game = window.__arena.game;
    return { s: game.currentSpread(window.__arena.game.vm.guns[game.me.weapon].def, false), gap: parseFloat(document.getElementById('crosshair').style.getPropertyValue('--gap')), crouching: game.me.crouching };
  });
  await place(0);
  const st = await spread();
  await page.keyboard.down('KeyC');
  await frames(6);
  const cr = await spread();
  check(cr.crouching && near(cr.s, st.s * 0.7, 1e-9) && cr.gap < st.gap, 'crouch spread ×0.7 and smaller crosshair', `spread ${st.s}→${cr.s.toFixed(4)}, gap ${st.gap}→${cr.gap}px`);
  await page.keyboard.down('Space');
  const jump = await page.waitForFunction(() => {
    const me = window.__arena.game.me;
    return me.vel.y > 0 && { vy: me.vel.y, y: me.pos.y, c: me.crouching };
  }, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => ({ c: false }));
  await page.keyboard.up('Space');
  check(jump.c && jump.vy > 0, 'can jump while crouched (stays crouched)', JSON.stringify(jump));
  await page.waitForFunction(() => window.__arena.game.me.onGround && window.__arena.game.me.vel.y <= 0, null, { timeout: 20000 });
  await sleep(200);
  // Низкий потолок: временный блок над головой не даёт встать.
  await page.evaluate(() => {
    const me = window.__arena.game.me;
    window.__ceil = { min: [me.pos.x - 1, me.pos.y + 1.4, me.pos.z - 1], max: [me.pos.x + 1, me.pos.y + 1.6, me.pos.z + 1] };
    window.__arena.game.map.colliders.push(window.__ceil);
  });
  await page.keyboard.up('KeyC');
  await frames(8);
  const under = await page.evaluate(() => ({ c: window.__arena.game.me.crouching, h: window.__arena.game.me.height }));
  check(under.c && under.h < 1.3, 'cannot stand up under low ceiling', JSON.stringify(under));
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await frames(4);
  const underSprint = await page.evaluate(() => window.__arena.game.me.sprinting);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  check(!underSprint, 'no sprint while forced crouch under ceiling');
  await page.evaluate(() => { const c = window.__arena.game.map.colliders; c.splice(c.indexOf(window.__ceil), 1); });
  await frames(10);
  check(!(await page.evaluate(() => window.__arena.game.me.crouching)), 'stands up once ceiling removed');

  // FPS-счётчик и скриншот.
  await place(0);
  await sleep(1200);
  const fps = await page.evaluate(() => ({ text: document.getElementById('fps').textContent, shown: getComputedStyle(document.getElementById('fps')).display !== 'none' }));
  check(fps.shown && /^\d+ FPS$/.test(fps.text), 'FPS counter visible', fps.text);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ingame-fps.png') });

  // Тряска выключена: взрыв не трясёт камеру.
  await page.evaluate(() => { window.__arena.game.me.shake = 1; });
  await frames(3);
  const rz = await page.evaluate(() => window.__arena.game.camera.rotation.z);
  check(rz === 0, 'screen shake off', `rot.z ${rz}`);

  // Покачивание: со включённым ствол качается при ходьбе, без него — нет.
  const bobRange = async () => {
    await place(0);
    await page.keyboard.down('KeyW');
    await frames(4);
    const ys = await page.evaluate(() => new Promise((r) => {
      const g = window.__arena.game;
      const out = [];
      const f = () => { out.push(g.vm.guns[g.vm.current].holder.position.y); if (out.length < 20) requestAnimationFrame(f); else r(out); };
      requestAnimationFrame(f);
    }));
    await page.keyboard.up('KeyW');
    await frames(4);
    return Math.max(...ys) - Math.min(...ys);
  };
  const bobOn = await bobRange();

  // ——— переключение режимов из паузы ———
  await page.evaluate(() => window.__arena.game.setPaused(true));
  check(await visible('screen-pause'), 'pause screen');
  await page.click('#pause-settings');
  for (const id of ['set-aim-mode', 'set-crouch-mode', 'set-sprint-mode']) await pickSeg(id, 'toggle');
  await setCheck('set-bob', false);
  await page.click('#settings-done');
  check(await visible('screen-pause'), 'done returns to pause');
  await page.click('#pause-resume');
  await sleep(300);
  const bobOff = await bobRange();
  check(bobOn > 0.001 && bobOff < 1e-4, 'view bob on/off', `range on ${bobOn.toFixed(4)} off ${bobOff.toExponential(1)}`);

  const speedNow = async () => { let m = 0; for (let i = 0; i < 6; i++) { await frames(2); m = Math.max(m, await hspeed()); } return m; };
  await place(0);
  await frames(4);
  await page.keyboard.down('KeyW');
  await page.keyboard.press('ShiftLeft');
  v = await speedNow();
  check(near(v, 7.6), 'toggle sprint latches after Shift tap', v.toFixed(2));
  await page.keyboard.up('KeyW');
  await frames(4);
  check(!(await page.evaluate(() => window.__arena.game.sprintToggled)), 'toggle sprint clears when movement stops');
  await place(0);
  await frames(4);
  await page.keyboard.down('KeyW');
  v = await speedNow();
  check(near(v, 5), 'walk after sprint cleared', v.toFixed(2));
  await page.keyboard.press('ShiftLeft');
  await frames(4);
  const latched = await page.evaluate(() => window.__arena.game.me.sprinting);
  await page.mouse.down();
  await frames(4);
  await page.mouse.up();
  await frames(2);
  check(latched && !(await page.evaluate(() => window.__arena.game.sprintToggled)), 'toggle sprint cleared by firing');
  await page.keyboard.up('KeyW');
  await sleep(300);

  await place(0);
  await frames(4);
  await page.keyboard.press('KeyC');
  await page.keyboard.down('KeyW');
  v = await speedNow();
  check(near(v, 2.2), 'toggle crouch latches after C tap', v.toFixed(2));
  await page.keyboard.press('ShiftLeft');
  v = await speedNow();
  const cs = await page.evaluate(() => ({ c: window.__arena.game.crouchToggled, s: window.__arena.game.me.sprinting }));
  check(near(v, 7.6) && !cs.c && cs.s, 'Shift while toggle-crouched stands up and sprints', `${v.toFixed(2)} ${JSON.stringify(cs)}`);
  await page.keyboard.up('KeyW');
  await sleep(300);

  await place(0);
  await frames(4);
  await page.mouse.click(640, 400, { button: 'right' });
  await page.keyboard.down('KeyW');
  v = await speedNow();
  check(near(v, 3.75), 'toggle aim latches after right click', v.toFixed(2));
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Digit1');
  await sleep(200);
  check(!(await page.evaluate(() => window.__arena.game.aimHeld)), 'toggle aim resets on weapon switch');
  await page.mouse.click(640, 400, { button: 'right' });
  await page.keyboard.press('KeyC');
  await sleep(100);
  await page.evaluate(() => window.__arena.game.setPaused(true));
  const reset = await page.evaluate(() => ({ a: window.__arena.game.aimHeld, c: window.__arena.game.crouchToggled }));
  check(!reset.a && !reset.c, 'toggles reset on pause', JSON.stringify(reset));
  await page.click('#pause-resume');
  await sleep(200);
} catch (err) {
  failed++;
  console.log(`FAIL exception: ${err.stack || err}`);
}

check(!errors.length, 'no console errors / page errors', errors.slice(0, 5).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
