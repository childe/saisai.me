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
