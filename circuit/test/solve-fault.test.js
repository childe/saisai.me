import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamage } from '../lib/damage.js';
import { settle } from '../lib/engine.js';
import { solve } from '../lib/solve.js';
import { PHYS } from '../lib/parts.js';
import { build } from './helpers.js';

test('faulty lamp in series blacks out the loop', () => {
  const c = build({
    parts: { B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp', {}, { fault: 'open' }], V: ['voltmeter'] },
    wires: [['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n'], ['V.p', 'L2.a'], ['V.n', 'L2.b']],
  });
  const r = solve(c);
  assert.ok(Math.abs(r.parts.L1.i) < 1e-6);
  assert.ok(Math.abs(r.parts.V.v - 3) < 0.1);
});

test('open wire behaves like a missing wire', () => {
  const c = build({ parts: { B: ['battery', { cells: 1 }], L: ['lamp'] }, wires: [['B.p', 'L.a'], ['L.b', 'B.n']] });
  c.wires[0].fault = 'open';
  const r = solve(c);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.parts.L.i) < 1e-6);
});

test('spdt fault only kills its throw', () => {
  const mk = to => build({
    parts: { B: ['battery'], S: ['spdt', { to }, { fault: 'open-a' }], L: ['lamp'] },
    wires: [['B.p', 'S.c'], ['S.a', 'L.a'], ['S.b', 'L.a'], ['L.b', 'B.n']],
  });
  assert.ok(solve(mk('a')).parts.L.p < PHYS.LAMP_LIT_P);
  assert.ok(solve(mk('b')).parts.L.p >= PHYS.LAMP_LIT_P);
});

test('fault is not damage', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp', {}, { fault: 'open' }] }, wires: [['B.p', 'L.a'], ['L.b', 'B.n']] });
  const ws = settle(c, createDamage());
  assert.ok(!ws.damage.broken.L);
});
