import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, DELAY_MAX, EXTRAP_MAX } from '../src/interp.js';
import { simulate } from './sim.js';

const snap = (t, x, extra = {}) => ({ t, x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, c: 0, ...extra });

// Пороги: line/circle — гладкие траектории, экстраполяция на них почти точна; strafe — резкие
// развороты, при срыве буфера на ретрансляторе экстраполяция ошибается, поэтому порог шире.
const LIMITS = {
  clean: { err: { line: 0.03, circle: 0.03, strafe: 0.05 }, yaw: 0.02, speed: [0.85, 1.2] },
  dupes: { err: { line: 0.03, circle: 0.03, strafe: 0.05 }, yaw: 0.02, speed: [0.8, 1.2] },
  relay: { err: { line: 0.03, circle: 0.3, strafe: 1.0 }, yaw: 0.35, speed: [0.5, 2.5] },
};

const rows = [];
const results = {};
for (const profile of ['clean', 'relay', 'dupes']) {
  for (const path of ['line', 'circle', 'strafe']) {
    for (const fps of [60, 144]) {
      const key = `${profile}/${path}/${fps}`;
      results[key] = {};
      for (const algo of ['old', 'new']) {
        const m = simulate({ path, profile, fps, algo, seed: 11 + fps });
        results[key][algo] = m;
        rows.push({
          profile, path, fps, algo,
          'added ms': +(m.meanAdded * 1000).toFixed(0),
          'max added ms': +(m.maxAdded * 1000).toFixed(0),
          'latency σ ms': +(m.latStd * 1000).toFixed(1),
          'max err cm': algo === 'new' ? +(m.maxErr * 100).toFixed(1) : '-',
          'speed min..max': `${m.minSpeed.toFixed(2)}..${m.maxSpeed.toFixed(2)}`,
          'speed rms': +m.speedRms.toFixed(3),
          'max Δspeed': +m.maxJerk.toFixed(2),
          'frozen %': +(m.frozen * 100).toFixed(1),
          backward: m.backward,
        });
      }
    }
  }
}
console.table(rows);

for (const [key, { old, new: m }] of Object.entries(results)) {
  const [profile, path] = key.split('/');
  const lim = LIMITS[profile];
  test(`${key}: smooth and close to the true path`, () => {
    assert.ok(m.frames > 1000);
    assert.ok(m.maxErr <= lim.err[path], `max error ${m.maxErr}`);
    assert.ok(m.maxYawErr <= lim.yaw, `max yaw error ${m.maxYawErr}`);
    assert.equal(m.backward, 0);
    assert.equal(m.frozen, 0);
    assert.ok(m.minSpeed >= lim.speed[0] && m.maxSpeed <= lim.speed[1], `speed ${m.minSpeed}..${m.maxSpeed}`);
    assert.ok(m.maxDelay <= DELAY_MAX + 1e-9);
    if (profile === 'clean') {
      assert.ok(m.maxAdded < 0.11, `added delay ${m.maxAdded}`);
      assert.ok(m.meanAdded < old.meanAdded);
    }
  });
  if (profile !== 'clean') {
    test(`${key}: clearly better than receive-time stamping`, () => {
      assert.ok(old.frozen > 0.01 && old.maxSpeed > 4, 'old algorithm should stutter here');
      assert.ok(m.speedRms < old.speedRms / 4, `speed rms ${m.speedRms} vs ${old.speedRms}`);
      assert.ok(m.maxJerk < old.maxJerk / 4, `Δspeed ${m.maxJerk} vs ${old.maxJerk}`);
      assert.ok(old.backward > 0);
    });
  }
}

test('yaw interpolates through ±π the short way', () => {
  const tr = new Track();
  tr.push(snap(10, 0, { yaw: 3.1 }), 0);
  tr.push(snap(10.1, 0, { yaw: -3.1 }), 0.001);
  const o = tr.sample(10.05, {});
  assert.ok(Math.abs(Math.abs(o.yaw) - Math.PI) < 0.01, `yaw ${o.yaw}`);
});

test('duplicates are dropped and late packets are inserted in order', () => {
  const tr = new Track();
  assert.ok(tr.push(snap(1, 0), 5));
  assert.ok(tr.push(snap(1.1, 1), 5.1));
  assert.equal(tr.push(snap(1.1, 1), 5.12), false);
  assert.ok(tr.push(snap(1.05, 0.5), 5.2));
  assert.deepEqual(tr.snaps.map((s) => s.t), [1, 1.05, 1.1]);
});

test('extrapolates with velocity, then holds; stop() disables it', () => {
  const tr = new Track();
  tr.push(snap(1, 0, { vx: 5 }), 0);
  assert.ok(Math.abs(tr.sample(1.1, {}).x - 0.5) < 1e-9);
  assert.ok(Math.abs(tr.sample(3, {}).x - 5 * EXTRAP_MAX) < 1e-9);
  tr.stop();
  assert.equal(tr.sample(1.1, {}).x, 0);
});

test('large jumps snap instead of sliding across the map', () => {
  const tr = new Track();
  tr.push(snap(1, 0), 0);
  tr.push(snap(1.05, 30), 0.05);
  assert.equal(tr.sample(1.04, {}).x, 0);
  assert.equal(tr.sample(1.06, {}).x, 30);
});

test('new data after an underrun blends in instead of snapping', () => {
  const tr = new Track();
  const s = (i) => snap(i * 0.05, i * 0.38, { vx: 7.6 });
  let next = 0;
  let x = 0;
  let maxStep = 0;
  for (let f = 0; f < 120; f++) {
    const now = f / 60;
    const arrive = (i) => (i > 10 && i < 18 ? 0.9 : i * 0.05 + 0.04);
    for (; arrive(next) <= now; next++) tr.push(s(next), arrive(next));
    const o = tr.update(now);
    if (!o) continue;
    if (f > 1) maxStep = Math.max(maxStep, o.x - x);
    assert.ok(o.x >= x - 1e-9, `moved back at frame ${f}`);
    x = o.x;
  }
  assert.ok(tr.err.every((e) => Math.abs(e) < 0.01));
  assert.ok(maxStep > 7.6 / 60 && maxStep < 0.25, `max step ${maxStep}`);
});

test('reset drops packets sent before a respawn', () => {
  const tr = new Track();
  tr.push(snap(10, 0), 20.05);
  tr.update(20.1);
  tr.update(23);
  tr.reset();
  assert.equal(tr.push(snap(11, 5), 23.01), false);
  assert.ok(tr.push(snap(12.96, 5), 23.01));
});

test('render clock keeps running while the buffer is empty after a respawn', () => {
  const tr = new Track();
  for (let i = 0; i < 20; i++) tr.push(snap(i * 0.033, 0), i * 0.033 + 0.04);
  for (let f = 0; f < 60; f++) tr.update(f / 60);
  const lag = tr.target(1) - tr.rt;
  tr.reset();
  for (let f = 60; f < 90; f++) tr.update(f / 60);
  tr.push(snap(1.45, 5), 1.49);
  tr.update(1.5);
  assert.ok(Math.abs(tr.target(1.5) - tr.rt - lag) < 0.02, `clock lag ${tr.target(1.5) - tr.rt}`);
});
