import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpec } from '../lib/grid.js';
import { findSteps } from '../lib/techniques.js';
import { MAX_LAYER, hintView, wrongView, stuckView } from '../lib/hints.js';
import { board9 as board } from './fixtures.js';

const s = getSpec(9);
const none = () => new Set();
const LEAK = v => v.flashCell !== null && v.digit !== null;
const sortNum = a => [...a].sort((x, y) => x - y);

const HV = {
  hidden: board([[1, 4, 5], [2, 7, 5], [3, 0, 5], [5, 1, 5]]),
  naked: board([[0, 1, 1], [0, 2, 2], [0, 3, 3], [0, 4, 4], [1, 0, 5], [2, 0, 6], [3, 0, 7], [4, 0, 8]]),
  pointing: board([[1, 0, 2], [1, 1, 3], [1, 2, 4], [2, 0, 5], [2, 1, 6], [2, 2, 7]]),
  claiming: board([[4, 3, 1], [5, 4, 1], [6, 5, 1], [7, 6, 1], [8, 7, 1], [3, 8, 1]]),
  pair: board([[0, 4, 1], [0, 5, 2], [0, 6, 3], [0, 7, 4], [0, 8, 5], [3, 0, 8], [6, 0, 9], [7, 1, 8], [4, 1, 9]]),
};
const hiddenStep = () => findSteps(HV.hidden, s, none(), 'hidden').find(x => x.cell === 2 && x.unit.kind === 'box');
const nakedStep = () => findSteps(HV.naked, s, none(), 'naked').find(x => x.cell === 0);
const lockedStep = () => findSteps(HV.pointing, s, none(), 'locked').find(x => x.digit === 1 && x.from.kind === 'box');
const pairStep = () => findSteps(HV.pair, s, none(), 'pair').find(x => x.unit.kind === 'row' && x.unit.index === 0);

test('MAX_LAYER', () => assert.equal(MAX_LAYER, 3));

test('hidden layers', () => {
  const v = HV.hidden;
  const step = hiddenStep();
  const l1 = hintView(step, 1, v, s, none());
  assert.deepEqual(l1.focusCells, [0, 1, 2, 9, 10, 11, 18, 19, 20]);
  assert.equal(l1.digit, null);
  const l2 = hintView(step, 2, v, s, none());
  assert.equal(l2.digit, 5);
  assert.deepEqual(sortNum(l2.digitCells), [13, 25, 27, 46]);
  const l3 = hintView(step, 3, v, s, none());
  assert.ok(l3.shadeCells.includes(0) && l3.shadeCells.includes(9));
  assert.ok(!l3.shadeCells.includes(2));
  for (const l of [l1, l2, l3]) {
    assert.equal(l.flashCell, null);
    assert.ok(!LEAK(l));
  }
});

test('naked layers never name the digit', () => {
  const v = HV.naked;
  const step = nakedStep();
  for (const layer of [1, 2, 3]) assert.equal(hintView(step, layer, v, s, none()).digit, null);
  const l1 = hintView(step, 1, v, s, none());
  assert.equal(l1.focusCells.length, 21);
  assert.ok(l1.focusCells.includes(0) && l1.focusCells.includes(4) && l1.focusCells.includes(36));
  assert.equal(hintView(step, 2, v, s, none()).flashCell, 0);
  const l3 = hintView(step, 3, v, s, none());
  assert.equal(l3.flashCell, 0);
  assert.deepEqual(sortNum(l3.digitCells), [1, 2, 3, 4, 9, 18, 27, 36]);
  assert.deepEqual(l3.strike, []);
});

test('naked layer 3 strikes eliminated candidates of the target', () => {
  const v = HV.naked;
  const elim = new Set(['0:9']);
  const l3 = hintView({ technique: 'naked', cell: 0, digit: 9 }, 3, v, s, elim);
  // candidate 9 is eliminated, so with 9 gone only digits 1-8 remain blocked -> strike lists 9
  assert.deepEqual(l3.strike, [{ cell: 0, digit: 9 }]);
});

test('locked layers', () => {
  const v = HV.pointing;
  const step = lockedStep();
  const l1 = hintView(step, 1, v, s, none());
  assert.deepEqual(l1.focusCells, step.from.cells);
  assert.match(l1.text, /宫/);
  const l2 = hintView(step, 2, v, s, none());
  assert.equal(l2.digit, 1);
  assert.deepEqual(l2.outlineCells, [0, 1, 2]);
  assert.deepEqual(l2.strike, []);
  const l3 = hintView(step, 3, v, s, none());
  assert.deepEqual(l3.strike, step.eliminations);
  assert.deepEqual(l3.outlineCells, [0, 1, 2]);
  for (const l of [l1, l2, l3]) {
    assert.ok(l.showCandidates.length > 0);
    const c0 = l.showCandidates.find(x => x.cell === 0);
    assert.ok(c0.digits.includes(1));
  }
});

test('locked from a row says row', () => {
  const step = findSteps(HV.claiming, s, none(), 'locked').find(x => x.digit === 1 && x.from.kind === 'row');
  assert.match(hintView(step, 1, HV.claiming, s, none()).text, /行/);
});

test('pair layers', () => {
  const v = HV.pair;
  const step = pairStep();
  const l1 = hintView(step, 1, v, s, none());
  assert.deepEqual(l1.focusCells, step.unit.cells);
  const l2 = hintView(step, 2, v, s, none());
  assert.deepEqual(l2.outlineCells, [0, 1]);
  assert.deepEqual(l2.showCandidates.find(x => x.cell === 0), { cell: 0, digits: [6, 7] });
  assert.deepEqual(l2.strike, []);
  const l3 = hintView(step, 3, v, s, none());
  assert.deepEqual(l3.strike, step.eliminations);
  assert.deepEqual(l3.showCandidates.find(x => x.cell === 1), { cell: 1, digits: [6, 7] });
});

test('no layer of any technique leaks a placement', () => {
  const cases = [
    [HV.hidden, 'hidden'], [HV.naked, 'naked'], [HV.pointing, 'locked'], [HV.claiming, 'locked'], [HV.pair, 'pair'],
  ];
  let n = 0;
  for (const [v, tech] of cases) {
    for (const step of findSteps(v, s, none(), tech, 20)) {
      for (const layer of [1, 2, 3]) {
        const view = hintView(step, layer, v, s, none());
        assert.ok(!LEAK(view), `${tech} layer ${layer}`);
        if (tech === 'hidden') assert.equal(view.flashCell, null);
        assert.ok(view.text.length > 0 && view.icon.length > 0);
        n++;
      }
    }
  }
  assert.ok(n > 0);
});

test('stuckView', () => {
  const v = stuckView();
  assert.equal(v.text, '这一步有点难');
  assert.deepEqual(v.focusCells, []);
  assert.equal(v.flashCell, null);
  assert.equal(v.digit, null);
});

test('wrongView', () => {
  const v = wrongView([3, 8]);
  assert.deepEqual(v.wrongCells, [3, 8]);
  assert.equal(v.digit, null);
});

test('hidden layer 3 shading leaves only the target open (box, row, column)', () => {
  const fixtures = [
    [HV.hidden, x => x.cell === 2 && x.unit.kind === 'box'],
    [board([[1, 4, 5], [2, 7, 5], [3, 1, 5], [4, 2, 5]]), x => x.unit.kind === 'row' && x.unit.index === 0 && x.cell === 0],
    [board([[4, 1, 5], [7, 2, 5], [1, 3, 5], [2, 4, 5]]), x => x.unit.kind === 'col' && x.unit.index === 0 && x.cell === 0],
  ];
  for (const [v, pick] of fixtures) {
    const step = findSteps(v, s, none(), 'hidden').find(pick);
    assert.ok(step);
    const l3 = hintView(step, 3, v, s, none());
    const open = step.unit.cells.filter(c => !v[c] && !l3.shadeCells.includes(c));
    assert.deepEqual(open, [step.cell]);
  }
});
