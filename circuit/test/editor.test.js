import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, reduce, activeSpace } from '../lib/editor.js';

const play = (s, ...as) => as.reduce(reduce, s);
const parts = s => activeSpace(s).circuit.parts;

test('place / move / connect / setParam / delete are undoable', () => {
  let s = play(createEditor(), { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 12, y: 5 });
  const [b, l] = parts(s).map(p => p.id);
  s = play(s, { type: 'move', id: l, x: 13, y: 6 });
  s = play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { part: l, term: 'a' } });
  s = play(s, { type: 'setParam', id: b, key: 'cells', value: 3 });
  s = play(s, { type: 'undo' });
  assert.equal(parts(s)[0].params.cells, 1);
  s = play(s, { type: 'undo' });
  assert.equal(activeSpace(s).circuit.wires.length, 0);
  s = play(s, { type: 'undo' });
  assert.deepEqual([parts(s)[1].x, parts(s)[1].y], [12, 5]);
});

test('undo deletePart restores wires and rev stays monotonic', () => {
  let s = play(createEditor(), { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 12, y: 5 });
  const [b, l] = parts(s).map(p => p.id);
  s = play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { part: l, term: 'a' } },
    { type: 'connect', from: { part: l, term: 'b' }, to: { part: b, term: 'n' } });
  const rev = activeSpace(s).circuit.rev;
  s = play(s, { type: 'select', target: { kind: 'part', id: l } }, { type: 'deletePart', id: l });
  assert.equal(s.selection, null);
  s = play(s, { type: 'undo' });
  assert.equal(activeSpace(s).circuit.wires.length, 2);
  assert.ok(activeSpace(s).circuit.rev > rev + 1);
  assert.equal(activeSpace(s).result.rev, activeSpace(s).circuit.rev);
  assert.ok(activeSpace(s).result.parts[l].p > 0.1);
});

test('coalesced moves make a single undo step', () => {
  let s = play(createEditor(), { type: 'place', partType: 'lamp', x: 5, y: 5 });
  const id = parts(s)[0].id;
  s = play(s, { type: 'move', id, x: 6, y: 5 }, { type: 'move', id, x: 7, y: 5, coalesce: true }, { type: 'move', id, x: 8, y: 5, coalesce: true });
  s = play(s, { type: 'undo' });
  assert.equal(parts(s)[0].x, 5);
});

test('clear needs confirmation and is undoable', () => {
  let s = play(createEditor(), { type: 'place', partType: 'lamp', x: 5, y: 5 }, { type: 'askClear' });
  assert.equal(s.confirmClear, true);
  s = play(s, { type: 'cancelClear' });
  assert.equal(parts(s).length, 1);
  s = play(s, { type: 'askClear' }, { type: 'confirmClear' });
  assert.equal(parts(s).length, 0);
  assert.equal(s.confirmClear, false);
  assert.equal(parts(play(s, { type: 'undo' })).length, 1);
});

test('palette limit in task mode follows deletes and undo', () => {
  let s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: 0 },
    { type: 'place', partType: 'lamp', x: 5, y: 5 });
  const after = play(s, { type: 'place', partType: 'lamp', x: 9, y: 5 });
  assert.equal(after, s);
  s = play(s, { type: 'undo' }, { type: 'place', partType: 'lamp', x: 9, y: 5 });
  assert.equal(parts(s).length, 1);
});

test('task 6 locks battery cells; task 1 passes when wired', () => {
  let s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: 5 }, { type: 'place', partType: 'battery', x: 5, y: 5 });
  const b = parts(s)[0];
  assert.equal(b.params.cells, 2);
  assert.equal(play(s, { type: 'setParam', id: b.id, key: 'cells', value: 4 }), s);
  s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: 0 },
    { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 12, y: 5 });
  const [bb, l] = parts(s).map(p => p.id);
  s = play(s, { type: 'connect', from: { part: bb, term: 'p' }, to: { part: l, term: 'a' } },
    { type: 'connect', from: { part: l, term: 'b' }, to: { part: bb, term: 'n' } });
  assert.equal(s.task.passed, true);
  s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: 1 },
    { type: 'place', partType: 'switch', x: 5, y: 5 });
  assert.equal(s.task.passed, false); // 第 2 关只放开关不能通过
});

test('free and task spaces are independent; toggle flips switches', () => {
  let s = play(createEditor(), { type: 'place', partType: 'switch', x: 5, y: 5 });
  const id = parts(s)[0].id;
  s = play(s, { type: 'toggle', id });
  assert.equal(parts(s)[0].params.closed, true);
  s = play(s, { type: 'setMode', mode: 'task' });
  assert.equal(s.free.circuit.parts.length, 1);
  assert.notEqual(activeSpace(s), s.free);
});
