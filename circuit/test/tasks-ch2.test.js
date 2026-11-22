import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam } from '../lib/circuit.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));

const lamps3 = { L1: ['lamp'], L2: ['lamp'], L3: ['lamp'] };
const series3 = (cells = 2) => build({ parts: { B: ['battery', { cells }], ...lamps3 },
  wires: [['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'L3.a'], ['L3.b', 'B.n']] });
const parallel3 = (cells = 2) => build({ parts: { B: ['battery', { cells }], ...lamps3 },
  wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['B.p', 'L3.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n'], ['L3.b', 'B.n']] });

test('task 6: three lamps series then parallel passes; changing cells only does not; two lamps do not count', () => {
  assert.deepEqual(T(6).palette, { battery: 1, lamp: 3 });
  const s = series3();
  const r1 = run(6, s);
  assert.equal(r1.passed, false);
  assert.equal(r1.hint, '试试另一种接法，亮度有什么不同？');
  const sameTopo = setParam(s, 'B', 'cells', 4);
  assert.equal(run(6, sameTopo, r1.progress).passed, false);
  const par = parallel3();
  par.topoRev = s.topoRev + 3;
  assert.equal(run(6, par, r1.progress).passed, true);
  const two = build({ parts: { B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n']] });
  assert.equal(run(6, two).progress.first, null);
});

test('task 7: each switch controls one lamp and the third stays on; shared main-line switches or an idle switch fail', () => {
  assert.deepEqual(T(7).palette, { battery: 1, lamp: 3, switch: 2 });
  assert.equal(T(7).goal, '每个开关只管一盏灯，第三盏一直亮');
  const mk = wires => build({ parts: { B: ['battery'], S1: ['switch'], S2: ['switch'], ...lamps3 }, wires });
  const ok = mk([['B.p', 'L1.a'], ['L1.b', 'B.n'], ['B.p', 'S1.a'], ['S1.b', 'L2.a'], ['L2.b', 'B.n'], ['B.p', 'S2.a'], ['S2.b', 'L3.a'], ['L3.b', 'B.n']]);
  assert.equal(run(7, ok).passed, true);
  // 两个开关串在干路上：随便哪个都管全部
  const main = mk([['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'L1.a'], ['S2.b', 'L2.a'], ['S2.b', 'L3.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n'], ['L3.b', 'B.n']]);
  assert.equal(run(7, main).passed, false);
  // 只有一个开关管一盏灯，另一个开关没接
  const idle = mk([['B.p', 'L1.a'], ['L1.b', 'B.n'], ['B.p', 'S1.a'], ['S1.b', 'L2.a'], ['L2.b', 'B.n'], ['B.p', 'L3.a'], ['L3.b', 'B.n']]);
  assert.equal(run(7, idle).passed, false);
  // 两个开关管同一盏灯
  const same = mk([['B.p', 'L1.a'], ['L1.b', 'B.n'], ['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'L2.a'], ['L2.b', 'B.n'], ['B.p', 'L3.a'], ['L3.b', 'B.n']]);
  assert.equal(run(7, same).passed, false);
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

test('task 10: three parallel lamps on one switch pass; three in series do not light and get a hint; two lamps do not count', () => {
  assert.deepEqual(T(10).palette, { battery: 1, lamp: 3, switch: 1 });
  const mk = wires => build({ parts: { B: ['battery'], S: ['switch'], ...lamps3 }, wires });
  const par = mk([['B.p', 'S.a'], ['S.b', 'L1.a'], ['S.b', 'L2.a'], ['S.b', 'L3.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n'], ['L3.b', 'B.n']]);
  assert.equal(run(10, par).passed, true);
  const ser = mk([['B.p', 'S.a'], ['S.b', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'L3.a'], ['L3.b', 'B.n']]);
  const r = run(10, ser);
  assert.equal(r.passed, false);
  assert.equal(r.hint, '灯不亮或者太暗，换个接法让它们都亮亮的');
  const two = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L1.a'], ['S.b', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  assert.equal(run(10, two).passed, false);
  assert.deepEqual(T(10).locked, { battery: ['cells'] });
});
