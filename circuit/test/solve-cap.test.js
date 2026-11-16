import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { PART_TYPES, defaultParams } from '../lib/parts.js';
import { build, loop } from './helpers.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} 不接近 ${b}`);

// 电池 → 电阻 → 电容 → 电池
const rc = (ohms, farads) => loop(
  { B: ['battery'], R: ['resistor', { ohms }], C: ['capacitor', { farads }] },
  ['B.p', 'R.a', 'R.b', 'C.a', 'C.b', 'B.n'],
);

test('capacitor part is registered', () => {
  assert.ok(PART_TYPES.includes('capacitor'));
  assert.deepEqual(defaultParams('capacitor'), { farads: 0.5 });
});

test('uncharged capacitor acts like a short at the first instant', () => {
  const r = solve(rc(10, 1), new Set(), { caps: {}, h: 1e-3 });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.parts.C.v) < 0.01);
  near(r.parts.R.i, 1.5 / 10.1, 0.01);
});

test('charged capacitor sources current into a lamp without battery', () => {
  const c = loop({ L: ['lamp'], C: ['capacitor', { farads: 1 }] }, ['C.a', 'L.a', 'L.b', 'C.b']);
  const r = solve(c, new Set(), { caps: { C: 1.5 }, h: 1e-3 });
  assert.equal(r.ok, true);
  near(Math.abs(r.parts.L.i), 0.15, 0.01);
  near(r.parts.C.v, 1.5, 0.01);
});

test('voltmeter reads a charged capacitor without battery', () => {
  const c = build({ parts: { V: ['voltmeter'], C: ['capacitor'] }, wires: [['V.p', 'C.a'], ['V.n', 'C.b']] });
  const r = solve(c, new Set(), { caps: { C: 1.2 } });
  assert.equal(r.ok, true);
  near(Math.abs(r.parts.V.v), 1.2, 0.01);
});

test('backward Euler step matches RC charging', () => {
  const c = rc(10, 1);
  let v = 0;
  for (let k = 0; k < 40; k++) v = solve(c, new Set(), { caps: { C: v }, h: 0.05 }).parts.C.v;
  const want = 1.5 * (1 - Math.exp(-2 / 10.1));
  assert.ok(Math.abs(v - want) <= 0.02 * want, `${v} vs ${want}`);
});

test('circuit without capacitor is unchanged', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  assert.deepEqual(solve(c, new Set(), { caps: { X: 1 }, h: 0.05 }), solve(c, new Set()));
});
