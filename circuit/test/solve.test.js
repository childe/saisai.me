import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { solveLinear } from '../lib/linalg.js';
import { build, loop } from './helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('solveLinear basic and singular', () => {
  assert.deepEqual(solveLinear([[2, 0], [0, 4]], [2, 8]), [1, 2]);
  assert.equal(solveLinear([[1, 1], [1, 1]], [1, 2]), null);
});

test('one lamp on one cell', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  const r = solve(c);
  assert.equal(r.ok, true);
  near(r.parts.L.i, 0.1485, 1e-3);
  near(r.parts.L.p, 0.2205, 3e-3);
  near(r.parts.B.i, r.parts.L.i, 1e-6);
  assert.deepEqual([r.rev, r.topoRev, r.brokenKey], [c.rev, c.topoRev, '']);
});

test('series vs parallel at 2 cells (spec: ~0.22W vs ~0.83W)', () => {
  const s = solve(loop({ B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    ['B.p', 'L1.a', 'L1.b', 'L2.a', 'L2.b', 'B.n']));
  near(s.parts.L1.p, 0.2205, 5e-3); near(s.parts.L2.p, 0.2205, 5e-3);
  const p = solve(build({ parts: { B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] }));
  near(p.parts.L1.p, 0.832, 1e-2); near(p.parts.L2.p, 0.832, 1e-2);
});

test('open switch: lamp off, voltmeter across switch reads ~battery', () => {
  const c = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n'], ['V.p', 'S.a'], ['V.n', 'S.b']] });
  const r = solve(c);
  assert.ok(Math.abs(r.parts.L.p) < 1e-6);
  near(r.parts.V.v, 1.5, 0.01);
});

test('voltmeter in series: lamp effectively off', () => {
  const r = solve(loop({ B: ['battery'], V: ['voltmeter'], L: ['lamp'] }, ['B.p', 'V.p', 'V.n', 'L.a', 'L.b', 'B.n']));
  assert.ok(r.parts.L.p < 1e-6);
  near(r.parts.V.v, 1.5, 0.01);
});

test('ammeter reads lamp current, reversed reads negative', () => {
  const f = solve(loop({ B: ['battery'], A: ['ammeter'], L: ['lamp'] }, ['B.p', 'A.p', 'A.n', 'L.a', 'L.b', 'B.n']));
  near(f.parts.A.i, f.parts.L.i, 1e-6);
  const r = solve(loop({ B: ['battery'], A: ['ammeter'], L: ['lamp'] }, ['B.p', 'A.n', 'A.p', 'L.a', 'L.b', 'B.n']));
  assert.ok(r.parts.A.i < -0.1);
});

test('rheostat ends give > 30x lamp power ratio', () => {
  const mk = pos => solve(loop({ B: ['battery'], R: ['rheostat', { pos }], L: ['lamp'] }, ['B.p', 'R.a', 'R.w', 'L.a', 'L.b', 'B.n']));
  const hi = mk(0).parts.L.p, lo = mk(1).parts.L.p;
  assert.ok(lo > 1e-4 && hi / lo > 30);
});

test('spdt routes to selected contact', () => {
  const c = to => solve(build({ parts: { B: ['battery'], S: ['spdt', { to }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.c'], ['S.a', 'L1.a'], ['S.b', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] }));
  assert.ok(c('a').parts.L1.p > 0.1 && c('a').parts.L2.p < 1e-6);
  assert.ok(c('b').parts.L2.p > 0.1 && c('b').parts.L1.p < 1e-6);
});

test('wire across one part: battery short ~14.8A, shorted lamp dark', () => {
  const r = solve(build({ parts: { B: ['battery'], L: ['lamp'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']] }));
  near(r.parts.B.i, 14.8, 0.2);
  assert.ok(r.parts.L.p < 1e-3);
  const s = solve(build({ parts: { B: ['battery'], L: ['lamp'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['L.a', 'L.b']] }));
  assert.ok(s.parts.L.p < 1e-3);
});

test('floating parts: unwired parts and dangling wires stay ok, no NaN', () => {
  const r = solve(build({ parts: { B: ['battery'], L: ['lamp'], S: ['switch'], M: ['motor'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['S.a', 'M.a']] }));
  assert.equal(r.ok, true);
  for (const x of Object.values(r.nodes)) assert.ok(Number.isFinite(x));
  assert.equal(r.parts.M.i, 0);
  assert.equal(solve(build({ parts: { S: ['switch'] }, wires: [] })).ok, true);
});

test('no battery component: all zero', () => {
  const r = solve(build({ parts: { L: ['lamp'], M: ['motor'] }, wires: [['L.b', 'M.a'], ['M.b', 'L.a']] }));
  assert.equal(r.ok, true);
  assert.ok(Object.values(r.nodes).every(v => v === 0));
});

test('broken lamp is open; motor reverses; opposing batteries cancel', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  const r = solve(c, new Set(['L']));
  assert.ok(Math.abs(r.parts.L.i) < 1e-6);
  assert.equal(r.brokenKey, 'L');
  assert.ok(solve(loop({ B: ['battery'], M: ['motor'] }, ['B.p', 'M.b', 'M.a', 'B.n'])).parts.M.v < -1);
  const o = solve(loop({ B1: ['battery'], B2: ['battery'], L: ['lamp'] }, ['B1.p', 'B2.p', 'B2.n', 'L.a', 'L.b', 'B1.n']));
  assert.ok(Math.abs(o.parts.L.i) < 1e-6);
});
