import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask, remainingPalette } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam, addWire, addPart } from '../lib/circuit.js';
import { build } from './helpers.js';

const T = n => TASKS[n - 1];
const run = (n, c, progress = T(n).initProgress()) => evaluateTask(T(n), progress, settle(c, createDamage()));
const series2 = (cells = 2) => build({ parts: { B: ['battery', { cells }], L1: ['lamp'], L2: ['lamp'] },
  wires: [['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n']] });

test('sixteen tasks in spec order', () => {
  assert.deepEqual(TASKS.map(t => t.name), ['点亮一盏灯', '加个开关', '串联和并联', '一个亮一个灭', '让 LED 亮起来', '调光台灯', '让风扇反转', '楼梯灯', '量一量', '保险丝救场',
    '门铃', '保险箱', '前门后门', '总开关', '风扇和灯', '红绿灯']);
  assert.deepEqual(TASKS.map(t => t.id), TASKS.map((_, i) => i + 1));
});

test('task 1: lit lamp passes, unconnected lamp fails', () => {
  const ok = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(1, ok).passed, true);
  const half = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  assert.equal(run(1, half).passed, false);
});

test('task 2: switch must control lamp', () => {
  const good = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'] }, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(2, good).passed, true);
  const bypass = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'] }, wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['S.a', 'B.p']] });
  assert.equal(run(2, bypass).passed, false);
  const noLamp = build({ parts: { B: ['battery'], S: ['switch'] }, wires: [['B.p', 'S.a'], ['S.b', 'B.n']] });
  assert.equal(run(2, noLamp).passed, false);
  assert.equal(run(2, build({ parts: { S: ['switch'] }, wires: [] })).passed, false);
});

test('task 2 evaluator does not mutate the real circuit', () => {
  const c = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'] }, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] });
  const snapshot = structuredClone(c);
  run(2, c);
  assert.deepEqual(c, snapshot);
});

test('task 3: series then parallel passes; changing cells only does not', () => {
  const s = series2();
  const r1 = run(3, s);
  assert.equal(r1.passed, false);
  assert.equal(r1.hint, '试试另一种接法，亮度有什么不同？');
  const sameTopo = setParam(s, 'B', 'cells', 4);
  assert.equal(run(3, sameTopo, r1.progress).passed, false);
  const par = build({ parts: { B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  par.topoRev = s.topoRev + 3;
  assert.equal(run(3, par, r1.progress).passed, true);
});

test('task 4: switch on one parallel branch passes, switch on main line fails', () => {
  const branch = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['L1.b', 'B.n'], ['B.p', 'S.a'], ['S.b', 'L2.a'], ['L2.b', 'B.n']] });
  assert.equal(run(4, branch).passed, true);
  const main = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L1.a'], ['S.b', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  assert.equal(run(4, main).passed, false);
});

test('task 5: LED with resistor passes, LED alone on 2 cells burns and fails', () => {
  const ok = build({ parts: { B1: ['battery'], B2: ['battery'], R: ['resistor', { ohms: 220 }], D: ['led'] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'R.a'], ['R.b', 'D.a'], ['D.k', 'B1.n']] });
  assert.equal(run(5, ok).passed, true);
  const burn = build({ parts: { B1: ['battery'], B2: ['battery'], D: ['led'] }, wires: [['B1.p', 'B2.n'], ['B2.p', 'D.a'], ['D.k', 'B1.n']] });
  assert.equal(run(5, burn).passed, false);
});

test('task 6: wiper used passes, fixed ends fails', () => {
  const mk = w => build({ parts: { B: ['battery'], R: ['rheostat'], L: ['lamp'] }, wires: [['B.p', 'R.a'], [w, 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(6, mk('R.w')).passed, true);
  assert.equal(run(6, mk('R.b')).passed, false);
});

test('task 7: preset runs forward and fails; reversed passes', () => {
  assert.equal(run(7, T(7).preset()).passed, false);
  const rev = build({ parts: { B: ['battery'], M: ['motor'] }, wires: [['B.p', 'M.b'], ['M.a', 'B.n']] });
  assert.equal(run(7, rev).passed, true);
});

test('task 8: staircase wiring passes, single switch fails', () => {
  const st = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'S2.a'], ['S1.b', 'S2.b'], ['S2.c', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(8, st).passed, true);
  const one = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(8, one).passed, false);
});

test('task 9: correct meters pass, ammeter across lamp fails', () => {
  const ok = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'A.p'], ['A.n', 'L.a'], ['L.b', 'B.n'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(9, ok).passed, true);
  const bad = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['A.p', 'L.a'], ['A.n', 'L.b'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(9, bad).passed, false);
});

test('task 10: preset fails; fuse in the short loop passes; fuse elsewhere fails', () => {
  assert.equal(run(10, T(10).preset()).passed, false);
  const inLoop = build({ parts: { B: ['battery'], L: ['lamp'], F: ['fuse'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'F.a'], ['F.b', 'B.n']] });
  assert.equal(run(10, inLoop).passed, true);
  const elsewhere = build({ parts: { B: ['battery'], L: ['lamp'], F: ['fuse'] },
    wires: [['B.p', 'F.a'], ['F.b', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']] });
  assert.equal(run(10, elsewhere).passed, false);
});

test('task 11: switch rings buzzer; reversed buzzer or no switch fails', () => {
  const mk = (p, n) => build({ parts: { B: ['battery', { cells: 2 }], S: ['switch'], Z: ['buzzer'] },
    wires: [['B.p', 'S.a'], ['S.b', p], [n, 'B.n']] });
  assert.equal(run(11, mk('Z.p', 'Z.n')).passed, true);
  assert.equal(run(11, mk('Z.n', 'Z.p')).passed, false);
  const always = build({ parts: { B: ['battery', { cells: 2 }], Z: ['buzzer'] }, wires: [['B.p', 'Z.p'], ['Z.n', 'B.n']] });
  assert.equal(run(11, always).passed, false);
});

test('task 12: switches in series pass, in parallel fail', () => {
  const mk = wires => build({ parts: { B: ['battery'], S1: ['switch'], S2: ['switch'], L: ['lamp'] }, wires });
  assert.equal(run(12, mk([['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'L.a'], ['L.b', 'B.n']])).passed, true);
  assert.equal(run(12, mk([['B.p', 'S1.a'], ['B.p', 'S2.a'], ['S1.b', 'L.a'], ['S2.b', 'L.a'], ['L.b', 'B.n']])).passed, false);
});

test('task 13: switches in parallel ring buzzer, in series fail', () => {
  const mk = wires => build({ parts: { B: ['battery', { cells: 2 }], S1: ['switch'], S2: ['switch'], Z: ['buzzer'] }, wires });
  assert.equal(run(13, mk([['B.p', 'S1.a'], ['B.p', 'S2.a'], ['S1.b', 'Z.p'], ['S2.b', 'Z.p'], ['Z.n', 'B.n']])).passed, true);
  assert.equal(run(13, mk([['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'Z.p'], ['Z.n', 'B.n']])).passed, false);
});

test('task 14: one switch on main line with parallel lamps passes; series lamps too dim', () => {
  const par = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L1.a'], ['S.b', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  assert.equal(run(14, par).passed, true);
  const ser = build({ parts: { B: ['battery'], S: ['switch'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n']] });
  assert.equal(run(14, ser).passed, false);
  assert.deepEqual(T(14).locked, { battery: ['cells'] });
});

test('task 15: each switch controls its own branch; shared main switch fails', () => {
  const mk = wires => build({ parts: { B: ['battery', { cells: 2 }], S1: ['switch'], S2: ['switch'], L: ['lamp'], M: ['motor'] }, wires });
  assert.equal(run(15, mk([['B.p', 'S1.a'], ['S1.b', 'L.a'], ['L.b', 'B.n'], ['B.p', 'S2.a'], ['S2.b', 'M.a'], ['M.b', 'B.n']])).passed, true);
  assert.equal(run(15, mk([['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'L.a'], ['S2.b', 'M.a'], ['L.b', 'B.n'], ['M.b', 'B.n']])).passed, false);
});

test('task 16: spdt alternates two LEDs; one LED only or no resistor fails', () => {
  const mk = extra => build({ parts: { B1: ['battery'], B2: ['battery'], R: ['resistor', { ohms: 220 }], S: ['spdt'], D1: ['led'], D2: ['led', { color: 'green' }] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'R.a'], ['R.b', 'S.c'], ['S.a', 'D1.a'], ['D1.k', 'B1.n'], ...extra] });
  assert.equal(run(16, mk([['S.b', 'D2.a'], ['D2.k', 'B1.n']])).passed, true);
  assert.equal(run(16, mk([])).passed, false);
  const noR = build({ parts: { B1: ['battery'], B2: ['battery'], S: ['spdt'], D1: ['led'], D2: ['led'] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'S.c'], ['S.a', 'D1.a'], ['D1.k', 'B1.n'], ['S.b', 'D2.a'], ['D2.k', 'B1.n']] });
  assert.equal(run(16, noR).passed, false);
});

test('remainingPalette counts non-preset parts on canvas', () => {
  const t = T(1);
  let c = t.preset();
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 1 });
  c = addPart(c, 'lamp', 5, 5).circuit;
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 0 });
  assert.deepEqual(remainingPalette(T(7), T(7).preset()), {});
});
