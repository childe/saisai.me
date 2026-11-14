// 做题状态机：纯函数，act(game, action) 返回新状态（无效动作返回原对象）。
import { getSpec, parse, candidates } from './grid.js';
import { findStep } from './techniques.js';
import { MAX_LAYER, hintView, wrongView, stuckView } from './hints.js';

export const MAX_MISTAKES = 5;
export const MAX_HINTS = 5;

export function createGame({ size, puzzle, solution, instantCheck, autoCandidates }) {
  const spec = getSpec(size);
  const puz = typeof puzzle === 'string' ? parse(puzzle) : puzzle.slice();
  const sol = typeof solution === 'string' ? parse(solution) : solution.slice();
  const values = puz.slice();
  return {
    size, spec, puzzle: puz, solution: sol,
    values,
    given: puz.map(v => v !== 0),
    notes: autoCandidates ? candidates(values, spec) : Array(spec.cells).fill(0),
    eliminated: new Set(),
    selected: null, held: null, notesMode: false,
    instantCheck: !!instantCheck, autoCandidates: !!autoCandidates,
    mistakes: 0, wrong: new Set(),
    hintsUsed: 0, hint: null,
    status: 'playing', history: [],
  };
}

export const heartsLeft = g => Math.max(0, MAX_MISTAKES - g.mistakes);
export const hintsLeft = g => Math.max(0, MAX_HINTS - g.hintsUsed);
export const stars = g => (g.hintsUsed === 0 ? 3 : g.hintsUsed <= 2 ? 2 : 1);
export const isFull = g => g.values.every(v => v !== 0);

export function highlightDigit(g) {
  if (g.held) return g.held;
  if (g.selected !== null && g.values[g.selected]) return g.values[g.selected];
  return null;
}

export function doneDigits(g) {
  const count = new Map();
  for (const v of g.values) if (v) count.set(v, (count.get(v) || 0) + 1);
  return new Set([...count].filter(([, n]) => n === g.size).map(([d]) => d));
}

const snapshot = g => ({ values: g.values, notes: g.notes, eliminated: g.eliminated, wrong: g.wrong });
const push = g => [...g.history, snapshot(g)];

function fillValue(g, cell, digit) {
  if (g.given[cell] || g.values[cell] === digit) return g;
  const values = g.values.slice();
  values[cell] = digit;
  const notes = g.notes.slice();
  notes[cell] = 0;
  for (const p of g.spec.peers[cell]) notes[p] &= ~(1 << digit);
  const wrong = new Set(g.wrong);
  wrong.delete(cell);
  let mistakes = g.mistakes;
  if (g.instantCheck && digit !== g.solution[cell]) {
    wrong.add(cell);
    mistakes += 1;
  }
  const full = values.every(v => v !== 0);
  if (!g.instantCheck && full) {
    values.forEach((v, c) => { if (v !== g.solution[c]) wrong.add(c); });
  }
  let status = 'playing';
  if (values.every((v, c) => v === g.solution[c])) status = 'won';
  else if (mistakes >= MAX_MISTAKES) status = 'failed';
  return { ...g, values, notes, wrong, mistakes, status, hint: null, history: push(g) };
}

function toggleNote(g, cell, digit) {
  if (g.given[cell] || g.values[cell]) return g;
  const notes = g.notes.slice();
  notes[cell] ^= 1 << digit;
  return { ...g, notes, hint: null, history: push(g) };
}

const place = (g, cell, digit) => (g.notesMode ? toggleNote(g, cell, digit) : fillValue(g, cell, digit));

function tapCell(g, cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= g.spec.cells) return g;
  if (g.held && !g.given[cell]) return place(g, cell, g.held);
  if (g.selected === cell && g.held === null) return g;
  return { ...g, selected: cell, held: null };
}

function digit(g, d) {
  if (!Number.isInteger(d) || d < 1 || d > g.size) return g;
  if (g.selected === null) return { ...g, held: g.held === d ? null : d };
  if (g.given[g.selected]) return g;
  return place(g, g.selected, d);
}

function erase(g) {
  const cell = g.selected;
  if (cell === null || g.given[cell] || !g.values[cell]) return g;
  const values = g.values.slice();
  values[cell] = 0;
  const wrong = new Set(g.wrong);
  wrong.delete(cell);
  return { ...g, values, wrong, hint: null, history: push(g) };
}

function undo(g) {
  if (!g.history.length) return g;
  const last = g.history[g.history.length - 1];
  return { ...g, ...last, hint: null, history: g.history.slice(0, -1) };
}

function applyEliminations(g, step) {
  const eliminated = new Set(g.eliminated);
  const notes = g.notes.slice();
  for (const e of step.eliminations) {
    eliminated.add(`${e.cell}:${e.digit}`);
    notes[e.cell] &= ~(1 << e.digit);
  }
  return { eliminated, notes, history: push(g) };
}

function hint(g) {
  const wrongCells = [];
  g.values.forEach((v, c) => { if (v && v !== g.solution[c]) wrongCells.push(c); });
  if (wrongCells.length) return { ...g, hint: { step: null, layer: 0, view: wrongView(wrongCells) } };
  if (hintsLeft(g) === 0) return g;
  const cur = g.hint;
  if (cur && cur.step) {
    if (cur.layer >= MAX_LAYER) return g;
    const layer = cur.layer + 1;
    const view = hintView(cur.step, layer, g.values, g.spec, g.eliminated);
    const next = { ...g, hintsUsed: g.hintsUsed + 1, hint: { step: cur.step, layer, view } };
    if (layer === MAX_LAYER && cur.step.eliminations) return { ...next, ...applyEliminations(g, cur.step) };
    return next;
  }
  return refreshed(g);
}

function refreshed(g) {
  const step = findStep(g.values, g.spec, g.eliminated);
  if (!step) return g.hint && !g.hint.step ? g : { ...g, hint: { step: null, layer: 0, view: stuckView() } };
  const view = hintView(step, 1, g.values, g.spec, g.eliminated);
  return { ...g, hintsUsed: g.hintsUsed + 1, hint: { step, layer: 1, view } };
}

function restart(g) {
  return createGame({ size: g.size, puzzle: g.puzzle, solution: g.solution, instantCheck: g.instantCheck, autoCandidates: g.autoCandidates });
}

export function act(g, action) {
  if (action.type === 'restart') return restart(g);
  if (g.status !== 'playing') return g;
  switch (action.type) {
    case 'tapCell': return tapCell(g, action.cell);
    case 'digit': return digit(g, action.digit);
    case 'erase': return erase(g);
    case 'toggleNotes': return { ...g, notesMode: !g.notesMode };
    case 'undo': return undo(g);
    case 'hint': return hint(g);
    default: return g;
  }
}
