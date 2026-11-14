import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, bits, getSpec } from '../lib/grid.js';
import { findStep } from '../lib/techniques.js';
import { CHAPTERS } from '../data/drills.js';
import { SOL6, PUZ6, HOLES6 } from './fixtures.js';
import {
  MAX_MISTAKES, MAX_HINTS, createGame, act, heartsLeft, hintsLeft, stars, highlightDigit, doneDigits, isFull,
} from '../lib/game.js';

const g0 = () => createGame({ size: 6, puzzle: PUZ6, solution: SOL6, instantCheck: true, autoCandidates: false });
const run = (g, ...acts) => acts.reduce(act, g);

test('constants', () => {
  assert.deepEqual([MAX_MISTAKES, MAX_HINTS], [5, 5]);
});
test('cell-first input', () => {
  const g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 });
  assert.equal(g.values[0], 1);
  assert.equal(g.held, null);
});
test('digit-first input fills several cells', () => {
  const g = run(g0(), { type: 'digit', digit: 1 }, { type: 'tapCell', cell: 0 }, { type: 'tapCell', cell: 14 });
  assert.equal(g.held, 1);
  assert.deepEqual([g.values[0], g.values[14]], [1, 1]);
});
test('modes are exclusive', () => {
  let g = run(g0(), { type: 'digit', digit: 3 }, { type: 'tapCell', cell: 1 });
  assert.deepEqual([g.values[1], g.held, g.selected], [2, null, 1]);
  // R9：选中题面格时点数字 → 拿起该数字、清掉选中，题面不变
  g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 }, { type: 'tapCell', cell: 1 });
  g = act(g, { type: 'digit', digit: 4 });
  assert.deepEqual([g.values[1], g.held, g.selected], [2, 4, null]);
});
test('R9: tapping the selected cell deselects it, then digit-first works', () => {
  let g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 }, { type: 'tapCell', cell: 0 });
  assert.deepEqual([g.selected, g.held, g.values[0]], [null, null, 1]);
  g = run(g, { type: 'digit', digit: 4 }, { type: 'tapCell', cell: 21 });
  assert.deepEqual([g.held, g.selected, g.values[21]], [4, null, 4]);
});
test('R9: digit on a selected given cell picks it up; empty/player cells still fill', () => {
  let g = run(g0(), { type: 'tapCell', cell: 1 }, { type: 'digit', digit: 6 });
  assert.deepEqual([g.held, g.selected], [6, null]);
  g = run(g, { type: 'tapCell', cell: 35 }, { type: 'tapCell', cell: 7 });
  assert.deepEqual([g.values[35], g.values[7]], [6, 6]);
  // 玩家填过的格选中后点数字仍是改填
  g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 }, { type: 'digit', digit: 1 });
  assert.deepEqual([g.values[0], g.selected, g.held], [1, 0, null]);
  // 笔记模式下选中空格点数字仍切换笔记
  g = run(g0(), { type: 'toggleNotes' }, { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 3 });
  assert.equal(g.notes[0], 1 << 3);
});
test('wrong digit costs a heart; fifth ends the game', () => {
  let g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 });
  assert.ok(g.wrong.has(0));
  assert.equal(heartsLeft(g), 4);
  for (const d of [3, 4, 5, 6]) g = act(g, { type: 'digit', digit: d });
  assert.equal(g.status, 'failed');
  g = act(g, { type: 'restart' });
  assert.deepEqual([g.status, heartsLeft(g), g.values[0]], ['playing', 5, 0]);
});
test('same wrong digit twice charges once', () => {
  const g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 }, { type: 'digit', digit: 2 });
  assert.equal(g.mistakes, 1);
});
test('instant check off: no hearts, wrong cells marked when full', () => {
  let g = createGame({ size: 6, puzzle: PUZ6, solution: SOL6, instantCheck: false, autoCandidates: false });
  g = run(g, { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 });
  assert.equal(g.mistakes, 0);
  assert.equal(g.wrong.size, 0);
  const sol = parse(SOL6);
  for (const c of HOLES6.slice(1)) g = run(g, { type: 'tapCell', cell: c }, { type: 'digit', digit: sol[c] });
  assert.deepEqual([...g.wrong], [0]);
  g = run(g, { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 });
  assert.equal(g.status, 'won');
});
test('notes and peer cleanup', () => {
  let g = run(g0(), { type: 'toggleNotes' }, { type: 'tapCell', cell: 7 }, { type: 'digit', digit: 1 }, { type: 'digit', digit: 5 });
  assert.deepEqual(bits(g.notes[7]), [1, 5]);
  g = run(g, { type: 'toggleNotes' }, { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 });
  assert.deepEqual(bits(g.notes[7]), [5]);
});
const noteAt7 = (g, ...ds) => run(g, { type: 'toggleNotes' }, { type: 'tapCell', cell: 7 },
  ...ds.map(d => ({ type: 'digit', digit: d })), { type: 'toggleNotes' });
const g0off = () => createGame({ size: 6, puzzle: PUZ6, solution: SOL6, instantCheck: false, autoCandidates: false });
test('wrong digit keeps peer notes when instant check is on', () => {
  const g = run(noteAt7(g0(), 2, 5), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 }); // 0 的正解是 1
  assert.ok(g.wrong.has(0));
  assert.deepEqual(bits(g.notes[7]), [2, 5]);
});
test('erasing or changing a digit restores the peer notes it removed', () => {
  // 关闭马上提示时填错也清笔记（不泄露对错），但擦掉或改填要还原
  let g = run(noteAt7(g0off(), 2, 3, 5), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 });
  assert.deepEqual(bits(g.notes[7]), [3, 5]);
  g = act(g, { type: 'digit', digit: 3 });
  assert.deepEqual(bits(g.notes[7]), [2, 5]);
  g = act(g, { type: 'erase' });
  assert.deepEqual(bits(g.notes[7]), [2, 3, 5]);
  // 正确的数擦掉也还原
  g = run(noteAt7(g0(), 1, 5), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 });
  assert.deepEqual(bits(g.notes[7]), [5]);
  g = act(g, { type: 'erase' });
  assert.deepEqual(bits(g.notes[7]), [1, 5]);
});
test('restore skips digits still blocked by another peer', () => {
  // 左上宫空出 0、1、6、7；7 的同伴 0 和 1 都填 3，擦掉 0 后 3 仍被 1 挡住
  const puzzle = [...SOL6].map((ch, i) => ([0, 1, 6, 7].includes(i) ? '.' : ch)).join('');
  let g = createGame({ size: 6, puzzle, solution: SOL6, instantCheck: false, autoCandidates: false });
  g = run(noteAt7(g, 3, 5), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 3 },
    { type: 'tapCell', cell: 1 }, { type: 'digit', digit: 3 }, { type: 'tapCell', cell: 0 }, { type: 'erase' });
  assert.deepEqual(bits(g.notes[7]), [5]);
});
test('hint layers, cap and stars', () => {
  let g = act(g0(), { type: 'hint' });
  assert.deepEqual([g.hint.layer, hintsLeft(g)], [1, 4]);
  g = run(g, { type: 'hint' }, { type: 'hint' });
  assert.equal(g.hint.layer, 3);
  assert.equal(act(g, { type: 'hint' }), g);
  assert.equal(stars(g), 1);
  g = run(g, { type: 'tapCell', cell: g.hint.step.cell }, { type: 'digit', digit: parse(SOL6)[g.hint.step.cell] });
  assert.equal(g.hint, null);
  g = run(g, { type: 'hint' }, { type: 'hint' });
  assert.equal(hintsLeft(g), 0);
  assert.equal(act(g, { type: 'hint' }), g);
});
test('stars by hints used', () => {
  assert.equal(stars(g0()), 3);
  assert.equal(stars(act(g0(), { type: 'hint' })), 2);
  assert.equal(stars(run(g0(), { type: 'hint' }, { type: 'hint' })), 2);
});
test('hint on wrong board points at wrong cells and is free', () => {
  const g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 }, { type: 'hint' });
  assert.deepEqual(g.hint.view.wrongCells, [0]);
  assert.equal(hintsLeft(g), 5);
});
test('undo does not refund hearts', () => {
  const g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 }, { type: 'undo' });
  assert.deepEqual([g.values[0], g.mistakes], [0, 1]);
});
test('won and failed boards ignore input', () => {
  const sol = parse(SOL6);
  let g = g0();
  for (const c of HOLES6) g = run(g, { type: 'tapCell', cell: c }, { type: 'digit', digit: sol[c] });
  assert.equal(g.status, 'won');
  for (const a of [{ type: 'hint' }, { type: 'undo' }, { type: 'erase' }, { type: 'digit', digit: 1 }]) assert.equal(act(g, a), g);
});
test('doneDigits and highlightDigit', () => {
  const g = run(g0(), { type: 'digit', digit: 4 });
  assert.equal(highlightDigit(g), 4);
  assert.ok(doneDigits(g).has(3));
  assert.equal(highlightDigit(run(g0(), { type: 'tapCell', cell: 1 })), 2);
  assert.equal(highlightDigit(g0()), null);
  assert.equal(isFull(g0()), false);
});
test('doneDigits ignores wrong entries', () => {
  const sol = parse(SOL6);
  const z = HOLES6[0];
  const d = sol[z];
  const y = HOLES6.find(c => sol[c] !== d);
  let g = g0();
  for (const c of HOLES6) if (c !== z && c !== y) g = run(g, { type: 'tapCell', cell: c }, { type: 'digit', digit: sol[c] });
  assert.ok(!doneDigits(g).has(d));
  g = run(g, { type: 'tapCell', cell: y }, { type: 'digit', digit: d });
  assert.ok(g.wrong.has(y));
  assert.equal(g.values.filter(v => v === d).length, g.size);
  assert.ok(!doneDigits(g).has(d));
  g = run(g, { type: 'tapCell', cell: z }, { type: 'digit', digit: d });
  assert.ok(!doneDigits(g).has(d) || g.wrong.has(y));
});
test('autoCandidates fills notes', () => {
  const g = createGame({ size: 6, puzzle: PUZ6, solution: SOL6, instantCheck: true, autoCandidates: true });
  assert.deepEqual(bits(g.notes[0]), [1]);
});
test('no-op actions return the same object; states are not mutated', () => {
  const g = g0();
  for (const a of [{ type: 'erase' }, { type: 'undo' }, { type: 'digit', digit: 9 }, { type: 'tapCell', cell: 99 }]) assert.equal(act(g, a), g);
  const g1 = run(g, { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 2 });
  const g2 = act(g1, { type: 'erase' });
  assert.equal(g2.values[0], 0);
  assert.equal(g1.values[0], 2);
  assert.ok(g1.wrong.has(0));
  assert.ok(!g2.wrong.has(0));
  assert.equal(act(run(g, { type: 'tapCell', cell: 1 }), { type: 'erase' }).values[1], 2);
});
test('erase and undo restore values', () => {
  let g = run(g0(), { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 }, { type: 'erase' });
  assert.equal(g.values[0], 0);
  g = act(g, { type: 'undo' });
  assert.equal(g.values[0], 1);
});
test('locked/pair hint at layer 3 eliminates candidates; undo restores', () => {
  const { puzzle, solution, size } = CHAPTERS[2].slots[0][0];
  let g = createGame({ size, puzzle, solution, instantCheck: true, autoCandidates: true });
  const step = findStep(g.values, getSpec(size), g.eliminated);
  assert.ok(['locked', 'pair'].includes(step.technique));
  const notes0 = g.notes.slice();
  g = run(g, { type: 'hint' }, { type: 'hint' }, { type: 'hint' });
  assert.equal(g.hint.layer, 3);
  for (const e of step.eliminations) {
    assert.ok(g.eliminated.has(`${e.cell}:${e.digit}`));
    assert.equal(g.notes[e.cell] & (1 << e.digit), 0);
  }
  const used = g.hintsUsed;
  const g4 = act(g, { type: 'hint' });
  assert.notEqual(g4, g);
  assert.equal(g4.hint.layer, 1);
  assert.notEqual(g4.hint.step, step);
  assert.equal(g4.hintsUsed, used + 1);
  assert.equal(hintsLeft(g4), hintsLeft(g) - 1);
  g = act(g, { type: 'undo' });
  assert.equal(g.hintsUsed, used);
  assert.equal(g.eliminated.size, 0);
  assert.deepEqual(g.notes, notes0);
  assert.equal(g.hint, null);
});
test('restart keeps settings and re-initialises auto notes', () => {
  let g = createGame({ size: 6, puzzle: PUZ6, solution: SOL6, instantCheck: false, autoCandidates: true });
  const notes0 = g.notes.slice();
  g = run(g, { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 }, { type: 'hint' });
  g = act(g, { type: 'restart' });
  assert.deepEqual([g.instantCheck, g.autoCandidates, g.hintsUsed, g.history.length], [false, true, 0, 0]);
  assert.deepEqual(g.notes, notes0);
});
test('undo does not refund hintsUsed', () => {
  const g = run(g0(), { type: 'hint' }, { type: 'tapCell', cell: 0 }, { type: 'digit', digit: 1 }, { type: 'undo' });
  assert.equal(g.hintsUsed, 1);
});
