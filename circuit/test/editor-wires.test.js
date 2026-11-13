import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, reduce, activeSpace } from '../lib/editor.js';
import { remainingPalette, TASKS } from '../lib/tasks.js';

const play = (s, ...as) => as.reduce(reduce, s);
const circ = s => activeSpace(s).circuit;
// B(5,5) p=(3,5) n=(7,5)；L(15,10) a=(13,10)；w: B.p→L.a 路线 (3,5)→(13,5)→(13,10)
function setup() {
  let s = play(createEditor(), { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 15, y: 10 });
  const [b, l] = circ(s).parts.map(p => p.id);
  s = play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { part: l, term: 'a' }, via: [[13, 5]] });
  return { s, b, l, w: circ(s).wires[0].id };
}

test('connect stores via', () => {
  const { s } = setup();
  assert.deepEqual(circ(s).wires[0].via, [[13, 5]]);
});

test('tap-split selects the node and undoes in one step', () => {
  const { s, w } = setup();
  const s1 = play(s, { type: 'splitWire', id: w, at: [8.3, 5.2] });
  const node = circ(s1).parts.find(p => p.type === 'node');
  assert.deepEqual([node.x, node.y], [8, 5]);
  assert.deepEqual(s1.selection, { kind: 'part', id: node.id });
  assert.equal(play(s, { type: 'splitWire', id: w, at: [3, 5] }), s);
  const s2 = play(s1, { type: 'undo' });
  assert.deepEqual(circ(s2).wires.map(x => x.id), [w]);
  assert.equal(circ(s2).parts.length, 2);
});

test('connect from a terminal onto a wire, and wire to wire, are single undo steps', () => {
  let { s, b, l, w } = setup();
  s = play(s, { type: 'place', partType: 'lamp', x: 20, y: 15 });
  const l2 = circ(s).parts.at(-1).id;
  const s1 = play(s, { type: 'connect', from: { part: l2, term: 'a' }, to: { wire: w, at: [8, 5] }, via: [[18, 5]] });
  assert.equal(circ(s1).wires.length, 3);
  assert.equal(circ(s1).parts.filter(p => p.type === 'node').length, 1);
  assert.equal(circ(play(s1, { type: 'undo' })).wires.length, 1);
  s = play(s, { type: 'connect', from: { part: l, term: 'b' }, to: { part: b, term: 'n' }, via: [[17, 12], [7, 12]] });
  const w2 = circ(s).wires[1].id;
  const s2 = play(s, { type: 'connect', from: { wire: w, at: [10, 5] }, to: { wire: w2, at: [10, 12] }, via: [] });
  assert.equal(circ(s2).parts.filter(p => p.type === 'node').length, 2);
  assert.equal(circ(s2).wires.length, 5);
  assert.equal(circ(play(s2, { type: 'undo' })).wires.length, 2);
  assert.equal(play(s, { type: 'connect', from: { wire: w, at: [8, 5] }, to: { wire: w, at: [13, 8] }, via: [] }), s);
});

test('connect that fails after split leaves circuit untouched', () => {
  const { s, b, w } = setup();
  // 先在 (8,5) 分割出 N，分出的半段已是 B.p—N.o，再连 N.o—B.p 是重复连线 → addWire 失败，分割也作废
  assert.equal(play(s, { type: 'connect', from: { wire: w, at: [8, 5] }, to: { part: b, term: 'p' }, via: [] }), s);
  // at 落在导线起点 → 解析为 B.p 本身，与起点相同 → addWire 失败
  assert.equal(play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { wire: w, at: [3, 5] }, via: [] }), s);
});

test('segment drag is one undo step', () => {
  const { s, w } = setup();
  const s1 = play(s,
    { type: 'setWireVia', id: w, via: [[3, 6], [13, 6]] },
    { type: 'setWireVia', id: w, via: [[3, 7], [13, 7]], coalesce: true },
    { type: 'setWireVia', id: w, via: [[3, 8], [13, 8]], coalesce: true });
  assert.deepEqual(circ(s1).wires[0].via, [[3, 8], [13, 8]]);
  assert.deepEqual(circ(play(s1, { type: 'undo' })).wires[0].via, [[13, 5]]);
});

test('deleting a selected node merges, undo restores it', () => {
  const { s, w } = setup();
  const s1 = play(s, { type: 'splitWire', id: w, at: [8, 5] });
  const s2 = play(s1, { type: 'deletePart', id: s1.selection.id });
  assert.equal(s2.selection, null);
  assert.equal(circ(s2).wires.length, 1);
  assert.equal(circ(s2).parts.some(p => p.type === 'node'), false);
  assert.equal(circ(play(s2, { type: 'undo' })).parts.filter(p => p.type === 'node').length, 1);
});

test('task mode: splitting a preset wire keeps palette and pass state', () => {
  const idx = TASKS.findIndex(t => t.preset().wires.length > 0);
  let s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: idx });
  const before = { palette: remainingPalette(TASKS[idx], circ(s)), passed: s.task.passed, ok: s.task.result.ok };
  s = play(s, { type: 'splitWire', id: circ(s).wires[0].id, at: [10, 8] });
  assert.equal(circ(s).parts.some(p => p.type === 'node'), true);
  assert.deepEqual(remainingPalette(TASKS[idx], circ(s)), before.palette);
  assert.equal(s.task.result.ok, before.ok);
  assert.ok(s.task.passed || !before.passed);
});
