import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, CHAPTERS, evaluateTask, remainingPalette, goalText, chapterIndex } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { addPart } from '../lib/circuit.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));

test('task 11: correct meters pass, ammeter across lamp fails', () => {
  const ok = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'A.p'], ['A.n', 'L.a'], ['L.b', 'B.n'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(11, ok).passed, true);
  const bad = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['A.p', 'L.a'], ['A.n', 'L.b'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(11, bad).passed, false);
});

test('task 24: staircase wiring passes, single switch fails', () => {
  const st = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'S2.a'], ['S1.b', 'S2.b'], ['S2.c', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(24, st).passed, true);
  const one = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(24, one).passed, false);
});

test('task 25: preset fails; fuse in the short loop passes; fuse elsewhere fails', () => {
  assert.equal(run(25, T(25).preset()).passed, false);
  const inLoop = build({ parts: { B: ['battery'], L: ['lamp'], F: ['fuse'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'F.a'], ['F.b', 'B.n']] });
  assert.equal(run(25, inLoop).passed, true);
  const elsewhere = build({ parts: { B: ['battery'], L: ['lamp'], F: ['fuse'] },
    wires: [['B.p', 'F.a'], ['F.b', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']] });
  assert.equal(run(25, elsewhere).passed, false);
});

test('task 26: spdt alternates two LEDs; one LED only or no resistor fails', () => {
  const mk = extra => build({ parts: { B1: ['battery'], B2: ['battery'], R: ['resistor', { ohms: 220 }], S: ['spdt'], D1: ['led'], D2: ['led', { color: 'green' }] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'R.a'], ['R.b', 'S.c'], ['S.a', 'D1.a'], ['D1.k', 'B1.n'], ...extra] });
  assert.equal(run(26, mk([['S.b', 'D2.a'], ['D2.k', 'B1.n']])).passed, true);
  assert.equal(run(26, mk([])).passed, false);
  const noR = build({ parts: { B1: ['battery'], B2: ['battery'], S: ['spdt'], D1: ['led'], D2: ['led'] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'S.c'], ['S.a', 'D1.a'], ['D1.k', 'B1.n'], ['S.b', 'D2.a'], ['D2.k', 'B1.n']] });
  assert.equal(run(26, noR).passed, false);
});

test('task 29: each switch controls its own branch; shared main switch fails', () => {
  const mk = wires => build({ parts: { B: ['battery', { cells: 2 }], S1: ['switch'], S2: ['switch'], L: ['lamp'], M: ['motor'] }, wires });
  assert.equal(run(29, mk([['B.p', 'S1.a'], ['S1.b', 'L.a'], ['L.b', 'B.n'], ['B.p', 'S2.a'], ['S2.b', 'M.a'], ['M.b', 'B.n']])).passed, true);
  assert.equal(run(29, mk([['B.p', 'S1.a'], ['S1.b', 'S2.a'], ['S2.b', 'L.a'], ['S2.b', 'M.a'], ['L.b', 'B.n'], ['M.b', 'B.n']])).passed, false);
});

test('remainingPalette counts non-preset parts on canvas', () => {
  const t = T(1);
  let c = t.preset();
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 1 });
  c = addPart(c, 'lamp', 5, 5).circuit;
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 0 });
  assert.deepEqual(remainingPalette(T(4), T(4).preset()), {});
});

test('chapters and ids line up', () => {
  assert.equal(CHAPTERS.length, 6);
  assert.ok(TASKS.every(t => t.chapter >= 1 && t.chapter <= 6));
  assert.equal(new Set(TASKS.map(t => t.id)).size, TASKS.length);
  assert.deepEqual(TASKS.map(t => t.id), [...TASKS.map(t => t.id)].sort((a, b) => a - b));
});

test('existing tasks keep curriculum ids and names', () => {
  const names = Object.fromEntries(TASKS.map(t => [t.id, t.name]));
  assert.deepEqual(names, { 1: '点亮一盏灯', 2: '加个开关', 3: '门铃', 4: '让风扇反转', 5: '让 LED 亮起来',
    6: '串联和并联', 7: '一个亮一个灭', 8: '保险箱', 9: '前门后门', 10: '总开关', 11: '量一量', 12: '串联电流', 13: '串联分压', 14: '并联干路', 15: '精确调电流', 16: 'LED 能受多大电流',
    24: '楼梯灯', 25: '保险丝救场', 26: '红绿灯', 29: '风扇和灯' });
});

test('task 25 preset: battery (9,12), lamp (9,5)', () => {
  const c = T(25).preset();
  const at = type => c.parts.find(p => p.type === type);
  assert.deepEqual([at('battery').x, at('battery').y], [9, 12]);
  assert.deepEqual([at('lamp').x, at('lamp').y], [9, 5]);
});

test('goalText takes string or function goals; chapterIndex counts within chapter', () => {
  assert.equal(goalText(T(1), null), '让灯亮起来');
  assert.equal(goalText({ goal: v => `第 ${v} 题` }, 3), '第 3 题');
  assert.equal(chapterIndex(T(1)), 1);
  assert.equal(chapterIndex(T(5)), 5);
  assert.equal(chapterIndex(T(6)), 1);
  assert.equal(chapterIndex(T(24)), 1);
  assert.equal(chapterIndex(T(29)), 4);
});
