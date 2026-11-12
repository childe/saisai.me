import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamage, advance, repair, brokenKey } from '../lib/damage.js';
import { settle, tick } from '../lib/engine.js';
import { solve } from '../lib/solve.js';
import { setParam, removeWire } from '../lib/circuit.js';
import { build, loop } from './helpers.js';

test('advance ignores invalid or stale results', () => {
  const c = loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']);
  const d = createDamage();
  const r = solve(c);
  assert.equal(advance(d, { ...r, ok: false }, 0, c), d);
  assert.equal(advance(d, r, 0, { ...c, rev: c.rev + 1 }), d);
  assert.equal(advance(d, { ...r, brokenKey: 'X' }, 0, c), d);
  assert.equal(advance(d, r, 0, c).broken.D, true);
});

test('settle: LED on 4 cells burns instantly and then carries no current', () => {
  const ws = settle(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']), createDamage());
  assert.equal(ws.damage.broken.D, true);
  assert.equal(ws.result.ok, true);
  assert.ok(Math.abs(ws.result.parts.D.i) < 1e-6);
  assert.ok(ws.trail[0].parts.D.i > 0.03);
});

test('settle: fuse in short loop blows; trail keeps pre-blow result', () => {
  const c = build({ parts: { B: ['battery'], F: ['fuse', { rating: 2 }], L: ['lamp'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'F.a'], ['F.b', 'B.n']] });
  const ws = settle(c, createDamage());
  assert.equal(ws.damage.broken.F, true);
  assert.ok(Math.abs(ws.trail[0].parts.F.i) > 3);
  assert.ok(Math.abs(ws.result.parts.B.i) < 3);
  assert.ok(ws.result.parts.L.p > 0.1);
});

test('lamp overload burns only after 0.6s held', () => {
  let ws = settle(loop({ B: ['battery', { cells: 4 }], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']), createDamage());
  ws = tick(ws, 0.3);
  assert.equal(ws.damage.broken.L, undefined);
  ws = tick(ws, 0.31);
  assert.equal(ws.damage.broken.L, true);
  assert.ok(Math.abs(ws.result.parts.L.i) < 1e-6);
  assert.equal(brokenKey(repair(ws.damage, 'L')), '');
});

test('sweeping rheostat through high power does not burn the lamp', () => {
  const mk = pos => loop({ B: ['battery', { cells: 4 }], R: ['rheostat', { pos }], L: ['lamp'] }, ['B.p', 'R.a', 'R.w', 'L.a', 'L.b', 'B.n']);
  let ws = settle(mk(0), createDamage());
  ws = tick(ws, 0.3);
  ws = settle(setParam(ws.circuit, 'R', 'pos', 1), ws.damage);
  ws = tick(ws, 0.1);
  ws = settle(setParam(ws.circuit, 'R', 'pos', 0), ws.damage);
  ws = tick(ws, 0.3);
  assert.equal(ws.damage.broken.L, undefined);
});

test('battery short alarm after 0.6s, clears when short removed', () => {
  let ws = settle(build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] }), createDamage());
  ws = tick(ws, 0.3);
  assert.equal(ws.damage.alarm.B, undefined);
  ws = tick(ws, 0.31);
  assert.equal(ws.damage.alarm.B, true);
  ws = settle(removeWire(ws.circuit, 'w1'), ws.damage);
  ws = tick(ws, 0.05);
  assert.equal(ws.damage.alarm.B, undefined);
});

test('tick pauses on invalid result', () => {
  const ws = { circuit: build({ parts: {}, wires: [] }), damage: createDamage(), result: { ok: false }, trail: [] };
  assert.equal(tick(ws, 1), ws);
});
