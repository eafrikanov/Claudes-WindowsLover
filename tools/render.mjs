// Рендер превью карт: слева изометрия всей карты, справа вид игрока со спавна (оружие и противник).
// Сервер не запускает — ждёт статический сервер на PORT (по умолчанию 8125), например:
//   npx http-server -p 8125 -s .
//   node tools/render.mjs [--maps towers,fort] [--variants current,noon,golden,overcast] [--out renders] [--quality high]
// Файлы: <out>/<map>-<index>-<variant>.png. Использует глобально установленный playwright.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VARIANTS = [
  { id: 'current', label: 'Мультяшный', query: 'style=cartoon' },
  { id: 'noon', label: 'B1 · Полдень', query: 'style=mc&preset=noon' },
  { id: 'golden', label: 'B2 · Золотой час', query: 'style=mc&preset=golden' },
  { id: 'overcast', label: 'B3 · Пасмурно', query: 'style=mc&preset=overcast' },
];
const W = 1600;
const H = 640;
const LEFT = Math.round(W * 0.62);

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

const port = process.env.PORT || 8125;
const maps = arg('maps', 'towers,roofs,construction,fort,treehouses').split(',');
const wanted = arg('variants', VARIANTS.map((v) => v.id).join(',')).split(',');
const out = path.resolve(arg('out', 'renders'));
const quality = arg('quality', 'high');
mkdirSync(out, { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];

async function shoot(page, size, fn, arg) {
  await page.setViewportSize(size);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(fn, arg);
}

for (const v of VARIANTS.filter((x) => wanted.includes(x.id))) {
  const page = await browser.newPage({ viewport: { width: LEFT, height: H } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${v.id}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${v.id}] pageerror: ${e.message}`));
  await page.addInitScript((q) => localStorage.setItem('gunarena-prefs', JSON.stringify({ quality: q, name: 'Render' })), quality);
  await page.goto(`http://localhost:${port}/?nolock${v.query ? `&${v.query}` : ''}`);
  await page.waitForFunction(() => window.__arena?.game?.scene, null, { timeout: 120000 });
  await page.addStyleTag({ content: 'body > *:not(canvas) { display: none !important; }' });

  for (const mapId of maps) {
    // Останавливаем цикл меню и ставим сцену: оружие от первого лица и противник перед спавном.
    await page.evaluate(async (id) => {
      const { game } = window.__arena;
      game.loop = () => {};
      await game.load(id);
      const { Avatar } = await import('/src/avatar.js');
      const { raycastWorld } = await import('/src/physics.js');
      const { TEAM_COLORS } = await import('/src/game.js');
      const spawns = game.map.spawns.filter((s) => s.team === 0);
      let best = null;
      for (const s of spawns) {
        const eye = [s.x, s.y + 1.64, s.z];
        const dir = [-Math.sin(s.yaw), 0, -Math.cos(s.yaw)];
        const hit = raycastWorld(game.map.colliders, eye, dir, 60);
        const free = hit ? hit.t : 60;
        if (!best || free > best.free) best = { s, free };
      }
      const s = best.s;
      const dist = Math.min(8, best.free - 1.5);
      if (game.__enemy) game.scene.remove(game.__enemy.group);
      const av = new Avatar(game.textures.weaponMaterials(), 'Противник', TEAM_COLORS[1], false);
      av.setWeapon('rifle');
      av.group.position.set(s.x - Math.sin(s.yaw) * dist, s.y, s.z - Math.cos(s.yaw) * dist);
      av.yaw = s.yaw + Math.PI;
      av.pitch = -0.05;
      av.animate(0.016);
      game.scene.add(av.group);
      game.__enemy = av;
      game.__spawn = s;
      const vm = game.vm;
      vm.current = 1;
      vm.guns.forEach((g, i) => { g.holder.visible = i === 1; });
      vm.update(0.016, { aiming: false, sprinting: false, speed: 0, onGround: true, lookDX: 0, lookDY: 0 });
    }, mapId);

    const top = await shoot(page, { width: LEFT, height: H }, () => {
      const { game } = window.__arena;
      const cam = game.camera;
      const { hx, hz } = game.map.bounds;
      cam.fov = 40;
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
      // Угол обзора выбирается сбоку от солнца: видны и освещённые грани, и длинные тени.
      // Камера смотрит вдоль длинной стороны, чтобы вытянутая карта заполняла кадр.
      const az = (game.map.env.azimuth * Math.PI) / 180;
      cam.position.set(Math.sign(-Math.cos(az)) * (hx + 25), hz * 1.35, Math.sign(Math.sin(az)) * hz * 1.05);
      cam.lookAt(0, -2, 0);
      game.renderFrame(false);
      return game.canvas.toDataURL('image/png');
    });
    const fp = await shoot(page, { width: W - LEFT, height: H }, () => {
      const { game } = window.__arena;
      const cam = game.camera;
      const s = game.__spawn;
      cam.fov = game.prefs.fov;
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
      cam.position.set(s.x, s.y + 1.64, s.z);
      cam.rotation.set(-0.03, s.yaw, 0);
      game.vm.resize(cam.aspect);
      game.renderFrame(true);
      return game.canvas.toDataURL('image/png');
    });

    const png = await page.evaluate(async ({ top, fp, label, W, H, LEFT }) => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [a, b] = await Promise.all([load(top), load(fp)]);
      await document.fonts.load('600 24px "Russo One"').catch(() => {});
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(a, 0, 0, LEFT, H);
      ctx.drawImage(b, LEFT, 0, W - LEFT, H);
      ctx.fillStyle = '#111317';
      ctx.fillRect(LEFT - 1, 0, 3, H);
      const plate = (x, text) => {
        ctx.font = '24px "Russo One", system-ui, sans-serif';
        const w = ctx.measureText(text).width + 32;
        ctx.fillStyle = 'rgba(14,16,20,0.72)';
        ctx.beginPath();
        ctx.roundRect(x, 16, w, 44, 10);
        ctx.fill();
        ctx.fillStyle = '#f4f1ea';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 16, 39);
      };
      plate(16, label);
      plate(LEFT + 16, 'Вид игрока');
      return c.toDataURL('image/png');
    }, { top, fp, label: v.label, W, H, LEFT });

    const idx = VARIANTS.indexOf(v);
    const file = path.join(out, `${mapId}-${idx}-${v.id}.png`);
    writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    console.log(file);
  }
  await page.close();
}

await browser.close();
if (problems.length) {
  console.log(`\nConsole problems (${problems.length}):`);
  for (const p of [...new Set(problems)]) console.log(p);
}
