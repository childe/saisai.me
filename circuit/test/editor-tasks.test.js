import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, reduce, activeSpace, pickVariant } from '../lib/editor.js';

const play = (s, ...as) => as.reduce(reduce, s);
const enter = id => play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: id - 1 });
const T = s => s.task;

test('pickVariant', () => {
  assert.equal(pickVariant(1, 0), 0);
  assert.equal(pickVariant(0, 0), 0);
  assert.equal(pickVariant(3, 0, () => 0), 1);
  for (let i = 0; i < 1000; i++) assert.notEqual(pickVariant(3, 2), 2);
});

test('task space carries variant and variantIndex', () => {
  const s = enter(12);
  assert.equal(T(s).variant, [2, 3, 4][T(s).variantIndex]);
  assert.equal(enter(1).task.variant, null);
});

const switchOf = s => T(s).circuit.parts.find(p => p.type === 'switch');

test('predict flow: answer, then close switch', () => {
  let s = enter(12);
  s = play(s, { type: 'submitAnswer', value: 0.2 });
  assert.equal(T(s).hint, '合上开关看看！');
  assert.equal(T(s).progress.answer, 0.2);
  s = play(s, { type: 'toggle', id: switchOf(s).id });
  assert.equal(T(s).progress.answer, 0.2);
});

test('predict flow: correct answer passes', () => {
  const s0 = enter(12);
  const id = switchOf(s0).id;
  const closed = play(s0, { type: 'toggle', id }).task;
  const a2 = closed.circuit.parts.filter(p => p.type === 'ammeter').at(-1);
  const actual = Math.abs(closed.result.parts[a2.id].i);
  const s = play(s0, { type: 'submitAnswer', value: actual }, { type: 'toggle', id });
  assert.equal(T(s).passed, true);
});

test('predict flow: answering after closing switch is rejected', () => {
  let s = enter(12);
  s = play(s, { type: 'toggle', id: switchOf(s).id });
  const after = play(s, { type: 'submitAnswer', value: 0.2 });
  assert.equal(after, s);
  assert.ok(T(after).progress.answer == null);
});

test('restart picks a new variant and clears progress', () => {
  let s = enter(12);
  s = play(s, { type: 'submitAnswer', value: 0.2 });
  const v = T(s).variantIndex;
  s = play(s, { type: 'askClear' }, { type: 'confirmClear' });
  assert.notEqual(T(s).variantIndex, v);
  assert.ok(T(s).progress.answer == null);
  assert.equal(T(s).passed, false);
  assert.equal(T(s).variant, [2, 3, 4][T(s).variantIndex]);
});

test('measure level always accepts submit', () => {
  const s = play(enter(16), { type: 'submitAnswer', value: 0.03 });
  assert.equal(T(s).progress.answer, 0.03);
});

test('chooseTask on a single-variant task keeps index 0', () => {
  assert.equal(T(play(enter(1), { type: 'askClear' }, { type: 'confirmClear' })).variantIndex, 0);
});

const faultyLamp = s => T(s).circuit.parts.find(p => p.fault);
const goodLamp = s => T(s).circuit.parts.find(p => p.type === 'lamp' && !p.fault);
const placeAcrossBattery = s => {
  s = play(s, { type: 'place', partType: 'voltmeter', x: 12, y: 18 });
  const m = T(s).circuit.parts.find(p => p.type === 'voltmeter');
  const b = T(s).circuit.parts.find(p => p.type === 'battery');
  return play(s,
    { type: 'connect', from: { part: m.id, term: 'p' }, to: { part: b.id, term: 'p' } },
    { type: 'connect', from: { part: m.id, term: 'n' }, to: { part: b.id, term: 'n' } });
};

test('accuse: ignored before measuring and without a target', () => {
  const s = enter(21);
  assert.equal(play(s, { type: 'accuse', target: { kind: 'part', id: faultyLamp(s).id } }), s);
  assert.equal(play(s, { type: 'accuse' }), s);
  assert.equal(play(s, { type: 'accuse', target: null }), s);
});

test('accuse: wrong restarts, right passes', () => {
  let s = placeAcrossBattery(enter(21));
  assert.equal(T(s).progress.measured, true);
  const v = T(s).variantIndex;
  s = play(s, { type: 'accuse', target: { kind: 'part', id: goodLamp(s).id } });
  assert.notEqual(T(s).variantIndex, v);
  assert.equal(T(s).hint, '不对哦，这关重来');
  assert.equal(T(s).passed, false);
  s = placeAcrossBattery(s);
  s = play(s, { type: 'accuse', target: { kind: 'part', id: faultyLamp(s).id } });
  assert.equal(T(s).passed, true);
});

test('lockPreset blocks edits of preset items (level 22)', () => {
  const s = enter(22);
  const c = T(s).circuit;
  const w = c.wires.find(x => x.preset);
  const part = c.parts.find(p => p.preset && p.type === 'lamp');
  const bat = c.parts.find(p => p.type === 'battery');
  assert.equal(play(s, { type: 'deleteWire', id: w.id }), s);
  assert.equal(play(s, { type: 'splitWire', id: w.id, at: [9, 5] }), s);
  assert.equal(play(s, { type: 'deletePart', id: part.id }), s);
  assert.equal(play(s, { type: 'setParam', id: bat.id, key: 'cells', value: 1 }), s);
  const placed = play(s, { type: 'place', partType: 'voltmeter', x: 20, y: 18 });
  const m = T(placed).circuit.parts.find(x => x.type === 'voltmeter');
  assert.equal(play(placed, { type: 'connect', from: { part: m.id, term: 'p' }, to: { wire: w.id, at: [7, 8] } }), placed);
  assert.equal(play(placed, { type: 'connect', from: { wire: w.id, at: [7, 8] }, to: { part: m.id, term: 'p' } }), placed);
  const sw = c.parts.find(x => x.type === 'switch');
  assert.notEqual(play(s, { type: 'toggle', id: sw.id }), s);
});

test('connect to a non-preset wire is still allowed under lockPreset', () => {
  let s = enter(22);
  s = play(s, { type: 'place', partType: 'voltmeter', x: 20, y: 18 }, { type: 'place', partType: 'ammeter', x: 24, y: 18 });
  const a = T(s).circuit.parts.find(p => p.type === 'voltmeter');
  const b = T(s).circuit.parts.find(p => p.type === 'ammeter');
  s = play(s, { type: 'connect', from: { part: a.id, term: 'p' }, to: { part: b.id, term: 'p' } });
  assert.equal(T(s).circuit.wires.filter(w => !w.preset).length, 1);
});

test('undo keeps fault and preset marks (level 21)', () => {
  let s = enter(21);
  s = play(s, { type: 'place', partType: 'voltmeter', x: 12, y: 18 }, { type: 'undo' });
  assert.ok(faultyLamp(s));
  assert.ok(T(s).circuit.parts.every(p => p.preset === true));
});
