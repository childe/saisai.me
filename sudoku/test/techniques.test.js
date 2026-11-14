import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpec, parse, format } from '../lib/grid.js';
import { TECHNIQUES, findSteps, findStep, applyStep, logicalSolve } from '../lib/techniques.js';
import { SOL6, PUZ6, board9 as board } from './fixtures.js';

const s = getSpec(9);

test('TECHNIQUES order', () => {
  assert.deepEqual(TECHNIQUES, ['hidden', 'naked', 'locked', 'pair']);
});
test('hidden single in box', () => {
  const v = board([[1, 4, 5], [2, 7, 5], [3, 0, 5], [5, 1, 5]]);
  const st = findSteps(v, s, new Set(), 'hidden');
  assert.ok(st.some(x => x.cell === 2 && x.digit === 5 && x.unit.kind === 'box' && x.unit.index === 0));
});
test('naked single', () => {
  const v = board([[0, 1, 1], [0, 2, 2], [0, 3, 3], [0, 4, 4], [1, 0, 5], [2, 0, 6], [3, 0, 7], [4, 0, 8]]);
  assert.ok(findSteps(v, s, new Set(), 'naked').some(x => x.cell === 0 && x.digit === 9));
});
test('locked candidates pointing', () => {
  const v = board([[1, 0, 2], [1, 1, 3], [1, 2, 4], [2, 0, 5], [2, 1, 6], [2, 2, 7]]);
  const st = findSteps(v, s, new Set(), 'locked').find(x => x.digit === 1 && x.from.kind === 'box');
  assert.equal(st.to.kind, 'row');
  assert.deepEqual(st.cells, [0, 1, 2]);
  assert.deepEqual(st.eliminations.map(e => e.cell).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8]);
});
test('locked candidates claiming', () => {
  // 第 0 行的 1 只能在宫 0 内（行里其余格被列上的 1 占掉）
  const v = board([[4, 3, 1], [5, 4, 1], [6, 5, 1], [7, 6, 1], [8, 7, 1], [3, 8, 1]]);
  const st = findSteps(v, s, new Set(), 'locked').find(x => x.digit === 1 && x.from.kind === 'row' && x.from.index === 0);
  assert.ok(st);
  assert.equal(st.to.kind, 'box');
  assert.equal(st.to.index, 0);
  assert.deepEqual(st.cells, [0, 1, 2]);
  assert.deepEqual(st.eliminations.map(e => e.cell).sort((a, b) => a - b), [9, 10, 11, 18, 19, 20]);
});
test('naked pair in row', () => {
  const v = board([[0, 4, 1], [0, 5, 2], [0, 6, 3], [0, 7, 4], [0, 8, 5], [3, 0, 8], [6, 0, 9], [7, 1, 8], [4, 1, 9]]);
  const st = findSteps(v, s, new Set(), 'pair').find(x => x.unit.kind === 'row' && x.unit.index === 0);
  assert.deepEqual(st.cells, [0, 1]);
  assert.deepEqual(st.digits, [6, 7]);
  const keys = st.eliminations.map(e => `${e.cell}:${e.digit}`);
  for (const k of ['2:6', '2:7', '3:6', '3:7']) assert.ok(keys.includes(k));
});
test('eliminated set feeds back into candidates', () => {
  const v = board([[1, 0, 2], [1, 1, 3], [1, 2, 4], [2, 0, 5], [2, 1, 6], [2, 2, 7]]);
  const step = findSteps(v, s, new Set(), 'locked').find(x => x.digit === 1 && x.from.kind === 'box');
  const input = new Set();
  const next = applyStep(v, input, step);
  assert.equal(input.size, 0);
  assert.ok(next.eliminated.has('3:1'));
  assert.ok(!findSteps(next.values, s, next.eliminated, 'locked').some(x => x.digit === 1 && x.from.kind === 'box' && x.from.index === 0));
});
test('applyStep places digit without mutating input', () => {
  const v = parse(PUZ6);
  const step = findStep(v, getSpec(6), new Set());
  const next = applyStep(v, new Set(), step);
  assert.equal(v[step.cell], 0);
  assert.equal(next.values[step.cell], step.digit);
});
test('findStep prefers easier technique', () => {
  assert.equal(findStep(parse(PUZ6), getSpec(6), new Set()).technique, 'hidden');
});
test('findStep respects allowed and is deterministic', () => {
  const a = findStep(parse(PUZ6), getSpec(6), new Set(), ['naked']);
  assert.equal(a.technique, 'naked');
  assert.deepEqual(a, findStep(parse(PUZ6), getSpec(6), new Set(), ['naked']));
  assert.equal(findStep(parse('.'.repeat(36)), getSpec(6), new Set()), null);
});
test('logicalSolve solves fixture and reports hardest', () => {
  const r = logicalSolve(parse(PUZ6), getSpec(6));
  assert.equal(r.solved, true);
  assert.equal(format(r.values), SOL6);
  assert.equal(r.hardest, 'hidden');
  assert.equal(logicalSolve(parse('.'.repeat(36)), getSpec(6)).solved, false);
});
test('logicalSolve with only naked', () => {
  const r = logicalSolve(parse(PUZ6), getSpec(6), ['naked']);
  assert.equal(r.solved, true);
  assert.equal(r.hardest, 'naked');
});
