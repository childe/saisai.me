import test from 'node:test';
import assert from 'node:assert/strict';
import { stableSolve, relayMatters, displayValue, lampLit } from '../lib/task-kit.js';
import { build } from './helpers.js';

const none = new Set();

// 开关→线圈，触点 com→no 点灯
const relayLamp = closed => build({
  parts: { B1: ['battery'], S: ['switch', { closed }], K: ['relay'], B2: ['battery'], L: ['lamp'] },
  wires: [['B1.p', 'S.a'], ['S.b', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'K.com'], ['K.no', 'L.a'], ['L.b', 'B2.n']],
});

test('stableSolve settles a relay driven by a closed switch', () => {
  const s = stableSolve(relayLamp(true), none);
  assert.equal(s.stable, true);
  assert.ok(s.on.has('K'));
  assert.equal(lampLit(s.result, none, 'L'), true);
  const off = stableSolve(relayLamp(false), none);
  assert.equal(off.stable, true);
  assert.equal(off.on.size, 0);
  assert.equal(lampLit(off.result, none, 'L'), false);
});

test('stableSolve reports a self-interrupting relay as unstable', () => {
  // 线圈经自己的常闭触点供电：吸合就断电，释放又通电，来回振荡
  const c = build({
    parts: { B: ['battery'], K: ['relay'] },
    wires: [['B.p', 'K.com'], ['K.nc', 'K.x'], ['K.y', 'B.n']],
  });
  assert.equal(stableSolve(c, none).stable, false);
});

test('stableSolve force pins every relay', () => {
  const on = stableSolve(relayLamp(false), none, 'on');
  assert.equal(on.stable, true);
  assert.equal(lampLit(on.result, none, 'L'), true);
  assert.equal(lampLit(stableSolve(relayLamp(true), none, 'off').result, none, 'L'), false);
});

test('relayMatters is false when the lamp ignores the relay', () => {
  const mk = closed => build({
    parts: { B: ['battery'], S: ['switch', { closed }], L: ['lamp'], K: ['relay'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']],
  });
  const out = r => String(lampLit(r, none, 'L'));
  assert.equal(relayMatters([mk(true), mk(false)], none, out), false);
});

test('relayMatters is true for a relay-driven lamp', () => {
  const out = r => String(lampLit(r, none, 'L'));
  assert.equal(relayMatters([relayLamp(true), relayLamp(false)], none, out), true);
});

test('displayValue reads the display or null', () => {
  assert.equal(displayValue({ parts: { D: { value: 5 } } }, none, 'D'), 5);
  assert.equal(displayValue({ parts: {} }, none, 'D'), null);
});
