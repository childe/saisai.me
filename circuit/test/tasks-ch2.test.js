import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam } from '../lib/circuit.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));

const series2 = (cells = 2) => build({ parts: { B: ['battery', { cells }], L1: ['lamp'], L2: ['lamp'] },
  wires: [['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n']] });

test('task 6: series then parallel passes; changing cells only does not', () => {
  const s = series2();
  const r1 = run(6, s);
  assert.equal(r1.passed, false);
  assert.equal(r1.hint, '试试另一种接法，亮度有什么不同？');
  const sameTopo = setParam(s, 'B', 'cells', 4);
  assert.equal(run(6, sameTopo, r1.progress).passed, false);
  const par = build({ parts: { B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  par.topoRev = s.topoRev + 3;
  assert.equal(run(6, par, r1.progress).passed, true);
});

test('task 7: switch on one parallel branch passes, switch on main line fails', () => {
  const branch = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['L1.b', 'B.n'], ['B.p', 'S.a'], ['S.b', 'L2.a'], ['L2.b', 'B.n']] });
  assert.equal(run(7, branch).passed, true);
  const main = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L1.a'], ['S.b', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  assert.equal(run(7, main).passed, false);
});

test('task 8: switches in series pass, in parallel fail', () => {
  const mk = wires => build({ parts: { B: ['battery'], S1: ['switch'], S2: ['switch'], L: ['lamp'] }, wires });
  assert.equal(run(8, mk([['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'L.a'], ['L.b', 'B.n']])).passed, true);
  assert.equal(run(8, mk([['B.p', 'S1.a'], ['B.p', 'S2.a'], ['S1.b', 'L.a'], ['S2.b', 'L.a'], ['L.b', 'B.n']])).passed, false);
});

test('task 9: switches in parallel ring buzzer, in series fail', () => {
  const mk = wires => build({ parts: { B: ['battery', { cells: 2 }], S1: ['switch'], S2: ['switch'], Z: ['buzzer'] }, wires });
  assert.equal(run(9, mk([['B.p', 'S1.a'], ['B.p', 'S2.a'], ['S1.b', 'Z.p'], ['S2.b', 'Z.p'], ['Z.n', 'B.n']])).passed, true);
  assert.equal(run(9, mk([['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'Z.p'], ['Z.n', 'B.n']])).passed, false);
});

test('task 10: one switch on main line with parallel lamps passes; series lamps too dim', () => {
  const par = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L1.a'], ['S.b', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  assert.equal(run(10, par).passed, true);
  const ser = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n']] });
  assert.equal(run(10, ser).passed, false);
  assert.deepEqual(T(10).locked, { battery: ['cells'] });
});
