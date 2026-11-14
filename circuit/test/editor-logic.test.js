import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, reduce, activeSpace } from '../lib/editor.js';
import { createDamage } from '../lib/damage.js';
import { settle } from '../lib/engine.js';
import { build } from './helpers.js';

const play = (s, ...as) => as.reduce(reduce, s);
const free = s => activeSpace(s);
const partOf = (s, id) => free(s).circuit.parts.find(p => p.id === id);

// 把一个现成电路装进自由模式空间（历史为空）
const withCircuit = c => {
  const s = createEditor();
  return { ...s, free: { ...s.free, ...settle(c, createDamage()), history: [] } };
};

const buttonCircuit = () => build({ parts: { BT: ['button'], D: ['dpdt'] }, wires: [] });

// 电池→开关→线圈，触点点灯
const relayCircuit = () => build({
  parts: { B1: ['battery'], S: ['switch', { closed: true }], K: ['relay'], B2: ['battery'], L: ['lamp'] },
  wires: [['B1.p', 'S.a'], ['S.b', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'K.com'], ['K.no', 'L.a'], ['L.b', 'B2.n']],
});

test('press and release do not touch history', () => {
  let s = play(withCircuit(buttonCircuit()), { type: 'place', partType: 'lamp', x: 30, y: 20 });
  const n = free(s).history.length;
  s = play(s, { type: 'press', id: 'BT' });
  assert.equal(partOf(s, 'BT').params.pressed, true);
  assert.equal(free(s).history.length, n);
  s = play(s, { type: 'release', id: 'BT' });
  assert.equal(partOf(s, 'BT').params.pressed, false);
  assert.equal(free(s).history.length, n);
});

test('undo restores a released button', () => {
  let s = play(withCircuit(buttonCircuit()), { type: 'place', partType: 'lamp', x: 30, y: 20 });
  s = play(s, { type: 'press', id: 'BT' }, { type: 'place', partType: 'lamp', x: 30, y: 24 });
  assert.equal(partOf(s, 'BT').params.pressed, true);
  s = play(s, { type: 'undo' });
  assert.equal(partOf(s, 'BT').params.pressed, false);
});

test('toggle flips dpdt', () => {
  let s = play(withCircuit(buttonCircuit()), { type: 'toggle', id: 'D' });
  assert.equal(partOf(s, 'D').params.to, 'b');
  s = play(s, { type: 'toggle', id: 'D' });
  assert.equal(partOf(s, 'D').params.to, 'a');
});

test('press on a non-button is ignored', () => {
  const s = withCircuit(buttonCircuit());
  assert.equal(play(s, { type: 'press', id: 'D' }), s);
  assert.equal(play(s, { type: 'release', id: 'D' }), s);
  assert.equal(play(s, { type: 'press', id: 'nope' }), s);
});

test('relays survive commits but reset on clear', () => {
  let s = withCircuit(relayCircuit());
  s = play(s, { type: 'tick', dt: 0.06 });
  assert.equal(free(s).relays.on.K, true);
  s = play(s, { type: 'place', partType: 'lamp', x: 40, y: 30 });
  assert.equal(free(s).relays.on.K, true);
  s = play(s, { type: 'askClear' }, { type: 'confirmClear' });
  assert.deepEqual(free(s).relays.on, {});
});

test('relays reset on task restart', () => {
  let s = play(createEditor(), { type: 'setMode', mode: 'task' });
  const sp = s.task;
  s = { ...s, task: { ...sp, relays: { on: { K: true }, hold: {}, flips: 1 } } };
  s = play(s, { type: 'askClear' }, { type: 'confirmClear' });
  assert.deepEqual(s.task.relays.on, {});
});

test('切换模式时松开离开那边按住的按钮，且不进历史', () => {
  let s = play(withCircuit(buttonCircuit()), { type: 'press', id: 'BT' });
  const n = free(s).history.length;
  s = play(s, { type: 'setMode', mode: 'task' }, { type: 'release', id: 'BT' }, { type: 'setMode', mode: 'free' });
  assert.equal(partOf(s, 'BT').params.pressed, false);
  assert.equal(free(s).history.length, n);
});

test('任务模式按住的按钮，切回自由模式时也被松开', () => {
  const s0 = createEditor();
  const bt = build({ parts: { BT: ['button'] }, wires: [] });
  let s = { ...s0, mode: 'task', task: { ...s0.task, ...settle(bt, createDamage()), history: [] } };
  s = play(s, { type: 'press', id: 'BT' });
  assert.equal(s.task.circuit.parts[0].params.pressed, true);
  s = play(s, { type: 'setMode', mode: 'free' });
  assert.equal(s.task.circuit.parts[0].params.pressed, false);
});
