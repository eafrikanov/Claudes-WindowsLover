import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MAP_IDS } from '../src/map.js';
import { SIZE, ROUTE, checkSolidity, checkSpawns, checkReach, checkSpawnSafety, checkPickups, routeLength, botMatch, botReach } from './maplib.js';

// MAPS=towers,fort npm test — только выбранные карты.
const only = process.env.MAPS?.split(',');
const ids = MAP_IDS.filter((id) => !only || only.includes(id));
const none = (issues) => assert.deepEqual(issues, [], `\n${issues.join('\n')}`);

for (const id of ids) {
  test(`${id}: размер 24×48`, () => assert.deepEqual(MAPS[id].size, SIZE));
  test(`${id}: видимое совпадает с коллизией`, () => none(checkSolidity(id)));
  test(`${id}: спавны`, () => none(checkSpawns(id)));
  test(`${id}: всё достижимо, без ловушек и выхода за карту`, () => none(checkReach(id)));
  test(`${id}: спавн не простреливается`, () => none(checkSpawnSafety(id)));
  test(`${id}: аптечки`, () => none(checkPickups(id)));
  test(`${id}: путь между спавнами`, () => {
    const d = routeLength(id);
    assert.ok(d >= ROUTE[0] && d <= ROUTE[1], `путь ${d.toFixed(1)} м, нужно ${ROUTE[0]}–${ROUTE[1]}`);
  });
  test(`${id}: боты быстро встречаются и дерутся`, () => {
    const runs = [1, 2, 3].map((seed) => botMatch(id, seed));
    const first = runs.map((r) => r.firstShot ?? Infinity);
    const kpm = runs.reduce((a, r) => a + r.killsPerMin, 0) / runs.length;
    console.log(`${id}: первый выстрел ${first.map((t) => t.toFixed(1)).join(' / ')} с, убийств в минуту ${kpm.toFixed(1)}, максимум высоты ботов ${Math.max(...runs.map((r) => r.maxY)).toFixed(1)} м, путь ${routeLength(id).toFixed(1)} м`);
    assert.ok(Math.max(...first) <= 12, `первая встреча позже 12 с: ${first.join(', ')}`);
    assert.ok(kpm >= 4, `мало боёв: ${kpm.toFixed(1)} убийств в минуту`);
    const out = runs.find((r) => r.escaped);
    assert.ok(!out, `бот вышел за карту: ${JSON.stringify(out?.escaped)}`);
  });
  test(`${id}: боты добираются до высоких точек`, () => {
    const { rate, fails } = botReach(id, 11);
    assert.ok(rate >= 0.8, `дошёл до ${Math.round(rate * 100)}% точек, не дошёл: ${fails.join(', ')}`);
  });
}
