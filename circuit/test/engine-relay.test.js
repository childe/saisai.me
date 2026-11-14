import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamage } from '../lib/damage.js';
import { createRelays, relayOnSet, wantOn, advanceRelays } from '../lib/relay.js';
import { settle, tick } from '../lib/engine.js';
import { solve } from '../lib/solve.js';
import { setParam, removePart } from '../lib/circuit.js';
import { build } from './helpers.js';

// 开关→线圈（可串电阻），触点 com→no 点灯
const switchedRelay = (closed, ohms) => build({
  parts: {
    B1: ['battery'], S: ['switch', { closed }], K: ['relay'], B2: ['battery'], L: ['lamp'],
    ...(ohms ? { R: ['resistor', { ohms }] } : {}),
  },
  wires: [
    ['B1.p', 'S.a'], ...(ohms ? [['S.b', 'R.a'], ['R.b', 'K.x']] : [['S.b', 'K.x']]), ['K.y', 'B1.n'],
    ['B2.p', 'K.com'], ['K.no', 'L.a'], ['L.b', 'B2.n'],
  ],
});

const lit = ws => ws.result.parts.L.p > 0.2;

test('relay pulls in only after RELAY_DELAY', () => {
  let ws = settle(switchedRelay(true), createDamage());
  assert.equal(lit(ws), false);
  ws = tick(ws, 0.03);
  assert.equal(lit(ws), false);
  assert.equal(ws.relays.on.K, undefined);
  ws = tick(ws, 0.03);
  assert.equal(lit(ws), true);
  assert.equal(ws.relays.on.K, true);
  assert.equal(ws.relays.flips, 1);
});

test('relay releases after delay when coil current drops', () => {
  let ws = settle(switchedRelay(true), createDamage());
  ws = tick(ws, 0.06);
  assert.equal(ws.relays.on.K, true);
  ws = settle(setParam(ws.circuit, 'S', 'closed', false), ws.damage, ws.relays);
  assert.equal(ws.relays.on.K, true);
  assert.equal(lit(ws), true);
  ws = tick(ws, 0.03);
  assert.equal(lit(ws), true);
  ws = tick(ws, 0.03);
  assert.equal(ws.relays.on.K, undefined);
  assert.equal(lit(ws), false);
});

test('hysteresis: 15 mA keeps a pulled relay but does not pull a released one', () => {
  const c = switchedRelay(true, 47);
  const i = Math.abs(solve(c).parts.K.i);
  assert.ok(i > 0.01 && i < 0.02, `coil ${i}`);
  // 释放的：电流不够吸合
  let ws = settle(c, createDamage());
  for (let n = 0; n < 5; n++) ws = tick(ws, 0.05);
  assert.equal(ws.relays.on.K, undefined);
  // 吸合的：电流够保持
  ws = settle(c, createDamage(), { on: { K: true }, hold: {}, flips: 0 });
  for (let n = 0; n < 5; n++) ws = tick(ws, 0.05);
  assert.equal(ws.relays.on.K, true);
  assert.equal(lit(ws), true);
  // wantOn 直接看回差
  const r = solve(c);
  assert.deepEqual(wantOn(c, r, new Set()), new Set());
  assert.deepEqual(wantOn(c, r, new Set(['K'])), new Set(['K']));
});

test('self-interrupting relay keeps flipping and never greys the board', () => {
  const c = build({ parts: { B: ['battery'], K: ['relay'] }, wires: [['B.p', 'K.x'], ['K.y', 'K.nc'], ['K.com', 'B.n']] });
  let ws = settle(c, createDamage());
  for (let n = 0; n < 20; n++) {
    ws = tick(ws, 0.05);
    assert.equal(ws.result.ok, true);
  }
  assert.ok(ws.relays.flips >= 8, `flips ${ws.relays.flips}`);
});

test('relay flip does not bump circuit.rev', () => {
  let ws = settle(switchedRelay(true), createDamage());
  const rev = ws.circuit.rev;
  ws = tick(ws, 0.06);
  assert.equal(ws.relays.on.K, true);
  assert.equal(ws.circuit.rev, rev);
  assert.equal(ws.result.rev, rev);
});

test('relay state of removed parts is dropped', () => {
  let ws = settle(switchedRelay(true), createDamage());
  ws = tick(ws, 0.06);
  assert.equal(ws.relays.on.K, true);
  ws = settle(removePart(ws.circuit, 'K'), ws.damage, ws.relays);
  assert.equal(Object.hasOwn(ws.relays.on, 'K'), false);
  assert.equal(relayOnSet(ws.relays).size, 0);
});

test('advanceRelays ignores stale results and returns same object when idle', () => {
  const c = switchedRelay(true);
  const r0 = createRelays();
  const res = solve(c);
  assert.equal(advanceRelays(r0, { ...res, ok: false }, 0.06, c), r0);
  assert.equal(advanceRelays(r0, res, 0.06, { ...c, rev: c.rev + 1 }), r0);
  assert.equal(advanceRelays(r0, { ...res, relayKey: 'K' }, 0.06, c), r0);
  const off = switchedRelay(false);
  assert.equal(advanceRelays(r0, solve(off), 0.06, off), r0);
  // 条件消失清 hold
  const r1 = advanceRelays(r0, res, 0.03, c);
  assert.ok(r1.hold.K > 0);
  assert.deepEqual(advanceRelays(r1, solve(off), 0.03, off).hold, {});
});

test('settle without relays still works (editor two-arg call)', () => {
  const ws = settle(switchedRelay(true), createDamage());
  assert.deepEqual(ws.relays, createRelays());
});
