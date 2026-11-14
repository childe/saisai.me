import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));

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

test('task 27: spdt picks a slow or fast gear; no resistor in either gear fails', () => {
  const mk = extra => build({ parts: { B: ['battery', { cells: 2 }], S: ['switch'], D: ['spdt'], R: ['resistor', { ohms: 10 }], M: ['motor'] },
    wires: [['B.p', 'S.a'], ['S.b', 'D.c'], ['D.a', 'M.a'], ['M.b', 'B.n'], ...extra] });
  const ok = mk([['D.b', 'R.a'], ['R.b', 'M.a']]);
  assert.equal(run(27, ok).passed, true);
  // 没有电阻：两档一样快
  const same = mk([['D.b', 'M.a']]);
  assert.equal(run(27, same).passed, false);
});

test('task 28: switch across the buzzer passes; across the battery or in series fails', () => {
  const mk = swWires => build({ parts: { B: ['battery', { cells: 2 }], S: ['switch'], R: ['resistor', { ohms: 100 }], Z: ['buzzer'] },
    wires: [['B.p', 'R.a'], ['R.b', 'Z.p'], ['Z.n', 'B.n'], ...swWires] });
  assert.equal(run(28, mk([['S.a', 'Z.p'], ['S.b', 'Z.n']])).passed, true);
  assert.equal(run(28, mk([['S.a', 'B.p'], ['S.b', 'B.n']])).passed, false);
  const series = build({ parts: { B: ['battery', { cells: 2 }], S: ['switch'], R: ['resistor', { ohms: 100 }], Z: ['buzzer'] },
    wires: [['B.p', 'S.a'], ['S.b', 'R.a'], ['R.b', 'Z.p'], ['Z.n', 'B.n']] });
  assert.equal(run(28, series).passed, false);
});

test('chapter 6 lists tasks 24..29 in order', () => {
  assert.deepEqual(TASKS.filter(t => t.chapter === 6).map(t => t.id), [24, 25, 26, 27, 28, 29]);
});

