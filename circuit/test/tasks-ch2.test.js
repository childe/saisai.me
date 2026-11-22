import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));

const lamps3 = { L1: ['lamp'], L2: ['lamp'], L3: ['lamp'] };

// 第 6 关：两个 2 节电池、四盏灯。左边 B1 带 L1、L2，右边 B2 带 L3、L4。
const two6 = wires => build({ parts: { B1: ['battery', { cells: 2 }], B2: ['battery', { cells: 2 }], ...lamps3, L4: ['lamp'] }, wires });
const seriesLeft = [['B1.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B1.n']];
const seriesRight = [['B2.p', 'L3.a'], ['L3.b', 'L4.a'], ['L4.b', 'B2.n']];
const parallelRight = [['B2.p', 'L3.a'], ['B2.p', 'L4.a'], ['L3.b', 'B2.n'], ['L4.b', 'B2.n']];

test('task 6 lists two batteries and four lamps with a how line', () => {
  assert.deepEqual(T(6).palette, { battery: 2, lamp: 4 });
  assert.deepEqual(T(6).defaults, { battery: { cells: 2 } });
  assert.deepEqual(T(6).locked, { battery: ['cells'] });
  assert.equal(T(6).goal, '搭两个电路，比一比亮度');
  assert.equal(T(6).how, '左边：一个电池接两盏灯串联。右边：一个电池接两盏灯并联。两边一起亮，看看哪边亮。');
});

test('task 6 passes with a series pair beside a parallel pair, in either position', () => {
  assert.equal(run(6, two6([...seriesLeft, ...parallelRight])).passed, true);
  const swapped = two6([['B1.p', 'L1.a'], ['B1.p', 'L2.a'], ['L1.b', 'B1.n'], ['L2.b', 'B1.n'], ...seriesRight]);
  assert.equal(run(6, swapped).passed, true);
});

test('task 6 hints when both sides are wired the same way', () => {
  const r = run(6, two6([...seriesLeft, ...seriesRight]));
  assert.equal(r.passed, false);
  assert.equal(r.hint, '两边一样亮？看看两边的接法是不是不一样');
  const both = two6([['B1.p', 'L1.a'], ['B1.p', 'L2.a'], ['L1.b', 'B1.n'], ['L2.b', 'B1.n'], ...parallelRight]);
  assert.equal(run(6, both).hint, '两边一样亮？看看两边的接法是不是不一样');
});

test('task 6 does not pass with one circuit only, and gives no hint until four lamps are lit', () => {
  const r = run(6, two6(seriesLeft));
  assert.equal(r.passed, false);
  assert.equal(r.hint, null);
  // 一个电池带四盏灯（两盏串在一条支路上）：有亮有暗，但不是两个电路
  const mixed = two6([['B1.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B1.n'], ['B1.p', 'L3.a'], ['L3.b', 'B1.n'], ['B1.p', 'L4.a'], ['L4.b', 'B1.n']]);
  const m = run(6, mixed);
  assert.equal(m.passed, false);
  assert.equal(m.hint, '每个电池各搭一个电路');
});

// 第 49 关：两个 1 节电池、一盏灯，先串后并（或先并后串）。
const bat49 = { B1: ['battery', { cells: 1 }], B2: ['battery', { cells: 1 }], L: ['lamp'] };
const series49 = () => build({ parts: bat49, wires: [['B1.p', 'L.a'], ['L.b', 'B2.n'], ['B2.p', 'B1.n']] });
const parallel49 = () => build({ parts: bat49, wires: [['B1.p', 'L.a'], ['B2.p', 'L.a'], ['L.b', 'B1.n'], ['L.b', 'B2.n']] });
const single49 = () => build({ parts: bat49, wires: [['B1.p', 'L.a'], ['L.b', 'B1.n']] });

test('task 49 sits after task 6 in chapter 2 with two single-cell batteries and one lamp', () => {
  const t = T(49);
  assert.equal(t.chapter, 2);
  assert.equal(TASKS.indexOf(t), TASKS.indexOf(T(6)) + 1);
  assert.equal(t.name, '电池的串联和并联');
  assert.deepEqual(t.palette, { battery: 2, lamp: 1 });
  assert.deepEqual(t.defaults, { battery: { cells: 1 } });
  assert.deepEqual(t.locked, { battery: ['cells'] });
  assert.equal(t.goal, '两个电池先串起来、再并起来点亮灯，比一比亮度');
  assert.equal(t.how, '串联：一个电池的正极接另一个的负极，剩下的两头接灯。并联：正极接正极，负极接负极，再接灯。两种都试，哪种更亮？');
});

test('task 49 passes after the lamp has been lit by batteries in series and in parallel, either order', () => {
  const r1 = run(49, series49());
  assert.equal(r1.passed, false);
  assert.equal(r1.hint, '再把两个电池并起来试试');
  assert.equal(run(49, parallel49(), r1.progress).passed, true);
  const r2 = run(49, parallel49());
  assert.equal(r2.passed, false);
  assert.equal(r2.hint, '再把两个电池串起来试试');
  assert.equal(run(49, series49(), r2.progress).passed, true);
});

test('task 49 does not count one battery alone as parallel', () => {
  const r = run(49, single49());
  assert.equal(r.passed, false);
  assert.equal(r.hint, null);
  assert.equal(run(49, series49(), r.progress).hint, '再把两个电池并起来试试');
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
