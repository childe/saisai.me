import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { presetCircuit, presetReading } from '../lib/task-kit.js';
import { build } from './helpers.js';

const T = id => TASKS.find(t => t.id === id);
const run = (id, c, progress = T(id).initProgress()) => evaluateTask(T(id), progress, settle(c, createDamage()));

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

test('task 3: switch rings buzzer; reversed buzzer or no switch fails', () => {
  const mk = (p, n) => build({ parts: { B: ['battery', { cells: 2 }], S: ['switch'], Z: ['buzzer'] },
    wires: [['B.p', 'S.a'], ['S.b', p], [n, 'B.n']] });
  assert.equal(run(3, mk('Z.p', 'Z.n')).passed, true);
  assert.equal(run(3, mk('Z.n', 'Z.p')).passed, false);
  const always = build({ parts: { B: ['battery', { cells: 2 }], Z: ['buzzer'] }, wires: [['B.p', 'Z.p'], ['Z.n', 'B.n']] });
  assert.equal(run(3, always).passed, false);
});

test('task 4: preset runs forward and fails; reversed passes', () => {
  assert.equal(run(4, T(4).preset()).passed, false);
  const rev = build({ parts: { B: ['battery'], M: ['motor'] }, wires: [['B.p', 'M.b'], ['M.a', 'B.n']] });
  assert.equal(run(4, rev).passed, true);
});

test('task 5: LED with resistor passes, LED alone on 2 cells burns and fails', () => {
  const ok = build({ parts: { B1: ['battery'], B2: ['battery'], R: ['resistor', { ohms: 220 }], D: ['led'] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'R.a'], ['R.b', 'D.a'], ['D.k', 'B1.n']] });
  assert.equal(run(5, ok).passed, true);
  const burn = build({ parts: { B1: ['battery'], B2: ['battery'], D: ['led'] }, wires: [['B1.p', 'B2.n'], ['B2.p', 'D.a'], ['D.k', 'B1.n']] });
  assert.equal(run(5, burn).passed, false);
});

test('task 4 preset: battery (9,12), motor (9,5)', () => {
  const c = T(4).preset();
  const at = type => c.parts.find(p => p.type === type);
  assert.deepEqual([at('battery').x, at('battery').y], [9, 12]);
  assert.deepEqual([at('motor').x, at('motor').y], [9, 5]);
});

test('presetCircuit marks parts and wires preset and carries extra', () => {
  const c = presetCircuit([['B', 'battery', 9, 12], ['L', 'lamp', 9, 5, {}, { fault: 'open' }]],
    [['B.p', 'L.a', { fault: 'open' }], ['L.b', 'B.n']]);
  assert.ok(c.parts.every(p => p.preset === true));
  assert.ok(c.wires.every(w => w.preset === true));
  assert.equal(c.parts.find(p => p.type === 'lamp').fault, 'open');
  assert.equal(c.wires[0].fault, 'open');
  assert.equal(c.wires[1].fault, undefined);
});

test('presetCircuit applies params and node parts', () => {
  const c = presetCircuit([['B', 'battery', 2, 2, { cells: 3 }], ['N', 'node', 5, 5]], [['B.p', 'N.o']]);
  assert.equal(c.parts[0].params.cells, 3);
  assert.equal(c.wires.length, 1);
});

test('presetReading solves with the given switches closed', () => {
  const c = presetCircuit([['B', 'battery', 9, 12], ['S', 'switch', 5, 5], ['L', 'lamp', 9, 5]],
    [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']]);
  const [, s, l] = c.parts;
  assert.equal(presetReading(c, [], l.id, 'i'), 0);
  assert.ok(presetReading(c, [s.id], l.id, 'i') > 0.05);
});
