import test from 'node:test';
import assert from 'node:assert/strict';
import { partVisual, wireFlow, formatReading, resistorBands } from '../lib/viewmodel.js';
import { createDamage } from '../lib/damage.js';

const lamp = { id: 'L', type: 'lamp', params: {} };
const d = createDamage();

test('lamp glow proportional to power ratio, capped at 2', () => {
  assert.equal(partVisual(lamp, { v: 1, i: 0.1, p: 0.45 }, d, true).glow, 0.5);
  assert.equal(partVisual(lamp, { v: 9, i: 1, p: 9 }, d, true).glow, 2);
  assert.equal(partVisual(lamp, { v: 1, i: 0.1, p: 0.45 }, { ...d, broken: { L: true } }, true).glow, 0);
});

test('lamp below LAMP_LIT_P is dark (glow 0), at threshold starts glowing', () => {
  assert.equal(partVisual(lamp, { v: 1.5e-6, i: 1.5e-7, p: 2.25e-13 }, d, true).glow, 0);
  assert.equal(partVisual(lamp, { v: 0.6, i: 0.06, p: 0.044 }, d, true).glow, 0);
  assert.ok(partVisual(lamp, { v: 0.67, i: 0.067, p: 0.045 }, d, true).glow > 0);
});

test('invalid result: meters show --, nothing animates, never NaN', () => {
  const am = { id: 'A', type: 'ammeter', params: {} };
  const v = partVisual(am, undefined, d, false);
  assert.equal(v.text, '--');
  assert.equal(v.stale, true);
  assert.equal(formatReading(NaN, 'V'), '--');
  assert.equal(formatReading(-0.001, 'A'), '0.00 A');
  assert.equal(formatReading(1.4849, 'V'), '1.48 V');
  assert.equal(wireFlow({ i: 2 }, false), null);
});

test('motor spin signed, buzzer only forward', () => {
  assert.equal(partVisual({ id: 'M', type: 'motor', params: {} }, { v: -1.4, i: -0.28, p: 0.39 }, d, true).spin, -1.4);
  assert.equal(partVisual({ id: 'Z', type: 'buzzer', params: {} }, { v: -1.5, i: -0.03, p: 0.045 }, d, true).volume, 0);
  assert.equal(partVisual({ id: 'Z', type: 'buzzer', params: {} }, { v: 1.5, i: 0.03, p: 0.045 }, d, true).volume, 1);
  // 音量 30mA 封顶，油门到 120mA（4 节电池）才封顶。
  assert.equal(partVisual({ id: 'Z', type: 'buzzer', params: {} }, { v: 1.5, i: 0.03, p: 0.045 }, d, true).drive, 0.25);
  assert.equal(partVisual({ id: 'Z', type: 'buzzer', params: {} }, { v: 6, i: 0.12, p: 0.72 }, d, true).drive, 1);
});

test('wire flow speed and direction', () => {
  assert.equal(wireFlow({ i: 0.0005 }, true), null);
  assert.deepEqual(wireFlow({ i: -0.15 }, true), { speed: 30, dir: -1 });
  assert.deepEqual(wireFlow({ i: 14 }, true), { speed: 400, dir: 1 });
});

test('resistor color bands', () => {
  assert.deepEqual([10, 47, 100, 220, 470, 1000].map(resistorBands), [
    ['brown', 'black', 'black'], ['yellow', 'violet', 'black'], ['brown', 'black', 'brown'],
    ['red', 'red', 'brown'], ['yellow', 'violet', 'brown'], ['brown', 'black', 'red']]);
});

test('display text: 0–15 as number, - when invalid', () => {
  const disp = { id: 'D', type: 'display', params: {} };
  const r = value => ({ v: 0, i: 0, p: 0, value });
  assert.equal(partVisual(disp, r(5), d, true).text, '5');
  assert.equal(partVisual(disp, r(0), d, true).text, '0');
  assert.equal(partVisual(disp, r(9), d, true).text, '9');
  assert.equal(partVisual(disp, r(12), d, true).text, '12');
  assert.equal(partVisual(disp, r(15), d, true).text, '15');
  assert.equal(partVisual(disp, undefined, d, false).text, '-');
});

test('relay vis.on follows relays state', () => {
  const relay = { id: 'K', type: 'relay', params: {} };
  const r = { v: 0, i: 0, p: 0 };
  assert.equal(partVisual(relay, r, d, true, { on: { K: true }, hold: {}, flips: 1 }).on, true);
  assert.equal(partVisual(relay, r, d, true, { on: {}, hold: {}, flips: 0 }).on, false);
  assert.equal(partVisual(relay, r, d, true).on, false);
  // 求解失败时铁片照旧停在当前位置。
  assert.equal(partVisual(relay, undefined, d, false, { on: { K: true } }).on, true);
});

test('capacitor charge follows voltage', () => {
  const cap = { id: 'C', type: 'capacitor', params: { farads: 0.5 } };
  assert.equal(partVisual(cap, { v: 1.5, i: 0, p: 0 }, d, true).charge, 0.5);
  assert.equal(partVisual(cap, { v: -6, i: 0, p: 0 }, d, true).charge, 1);
  assert.equal(partVisual(cap, { v: 1.5, i: 0, p: 0 }, d, false).charge, 0);
  assert.equal(partVisual(lamp, { v: 1, i: 0.1, p: 0.45 }, d, true).charge, 0);
});

// 电容充放电时电流每帧变一点：速度要落在固定几档上，导线 html 才不会每帧重建、小点才不会停住。
test('wire flow speed stays put when current drifts slightly', () => {
  assert.equal(wireFlow({ i: 0.15 }, true).speed, wireFlow({ i: 0.151 }, true).speed);
  assert.equal(wireFlow({ i: 0.9 }, true).speed, wireFlow({ i: 0.905 }, true).speed);
  const speeds = new Set();
  for (let i = 0.001; i < 3; i *= 1.01) speeds.add(wireFlow({ i }, true).speed);
  assert.ok(speeds.size <= 8, `${speeds.size} 档`);
  assert.ok(wireFlow({ i: 1 }, true).speed > wireFlow({ i: 0.2 }, true).speed);
});

test('buzzer drive keeps rising from 1 to 4 cells while volume is capped', async () => {
  const { solve } = await import('../lib/solve.js');
  const { loop } = await import('./helpers.js');
  const drives = [1, 2, 3, 4].map(cells => {
    const r = solve(loop({ B: ['battery', { cells }], Z: ['buzzer', { sound: 'moto' }] }, ['B.p', 'Z.p', 'Z.n', 'B.n']));
    const vis = partVisual({ id: 'Z', type: 'buzzer', params: { sound: 'moto' } }, r.parts.Z, { broken: {} }, r.ok);
    assert.ok(vis.volume > 0.95);
    return vis.drive;
  });
  for (let k = 1; k < drives.length; k++) assert.ok(drives[k] > drives[k - 1] + 0.15, `drives ${drives}`);
});
