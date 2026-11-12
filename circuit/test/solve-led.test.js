import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { build, loop } from './helpers.js';

const finite = r => [...Object.values(r.nodes), ...Object.values(r.parts).flatMap(x => [x.v, x.i, x.p])].every(Number.isFinite);

test('LED forward with 220 ohm on 2 cells: 3-6 mA', () => {
  const r = solve(loop({ B: ['battery', { cells: 2 }], R: ['resistor', { ohms: 220 }], D: ['led'] }, ['B.p', 'R.a', 'R.b', 'D.a', 'D.k', 'B.n']));
  assert.equal(r.ok, true);
  assert.ok(r.parts.D.i > 3e-3 && r.parts.D.i < 6e-3, String(r.parts.D.i));
});

test('LED reversed does not conduct', () => {
  const r = solve(loop({ B: ['battery', { cells: 2 }], R: ['resistor', { ohms: 220 }], D: ['led'] }, ['B.p', 'R.a', 'R.b', 'D.k', 'D.a', 'B.n']));
  assert.ok(Math.abs(r.parts.D.i) < 1e-6);
});

test('LED direct on one cell stays below 1 mA', () => {
  const r = solve(loop({ B: ['battery'], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']));
  assert.ok(r.parts.D.i < 1e-3);
});

test('LED direct on 4 cells: converges, > 30 mA, finite', () => {
  const r = solve(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']));
  assert.equal(r.ok, true);
  assert.ok(r.parts.D.i > 0.03);
  assert.ok(finite(r));
});

test('LED reversed on 4 cells: ok, no current', () => {
  const r = solve(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.k', 'D.a', 'B.n']));
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.parts.D.i) < 1e-6);
});

test('two LEDs in parallel with different resistors converge', () => {
  const r = solve(build({ parts: { B: ['battery', { cells: 3 }], R1: ['resistor', { ohms: 100 }], R2: ['resistor', { ohms: 1000 }], D1: ['led'], D2: ['led'] },
    wires: [['B.p', 'R1.a'], ['B.p', 'R2.a'], ['R1.b', 'D1.a'], ['R2.b', 'D2.a'], ['D1.k', 'B.n'], ['D2.k', 'B.n']] }));
  assert.equal(r.ok, true);
  assert.ok(r.parts.D1.i > r.parts.D2.i && r.parts.D2.i > 1e-3);
});

test('non-convergence yields ok:false with empty readings', () => {
  const r = solve(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']), new Set(), { maxIter: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual([r.nodes, r.parts, r.wires], [{}, {}, {}]);
});
