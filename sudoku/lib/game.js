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
    stripped: Array(spec.cells).fill(null), // 填数时被清掉笔记的同伴格，擦掉或改填时还原
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
  g.values.forEach((v, cell) => {
    if (v && !g.wrong.has(cell)) count.set(v, (count.get(v) || 0) + 1);
  });
  return new Set([...count].filter(([, n]) => n === g.size).map(([d]) => d));
}

const snapshot = g => ({ values: g.values, notes: g.notes, eliminated: g.eliminated, wrong: g.wrong, stripped: g.stripped });
const push = g => [...g.history, snapshot(g)];

// 把 cell 上原来的数从同伴格笔记里清掉的部分还原（values 里 cell 已改掉）；
// 若另一个玩家填的同伴格也是这个数，它仍挡着，不还原（题面数从不清笔记，不算）
function restoreNotes(g, values, notes, stripped, cell) {
  const d = g.values[cell];
  for (const p of stripped[cell] || []) {
    if (!values[p] && !g.spec.peers[p].some(q => !g.given[q] && values[q] === d)) notes[p] |= 1 << d;
  }
  stripped[cell] = null;
}

function fillValue(g, cell, digit) {
  if (g.given[cell] || g.values[cell] === digit) return g;
  const values = g.values.slice();
  values[cell] = digit;
  const notes = g.notes.slice();
  const stripped = g.stripped.slice();
  restoreNotes(g, values, notes, stripped, cell);
  notes[cell] = 0;
  // 开着马上提示时错数已标红，不清笔记；关着时照常清，免得从笔记变化看出对错
  if (!g.instantCheck || digit === g.solution[cell]) {
    stripped[cell] = g.spec.peers[cell].filter(p => notes[p] & (1 << digit));
    for (const p of stripped[cell]) notes[p] &= ~(1 << digit);
  }
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
  return { ...g, values, notes, stripped, wrong, mistakes, status, hint: null, history: push(g) };
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
  if (g.selected === cell) return { ...g, selected: null }; // 再点选中的格 → 取消选中
  return { ...g, selected: cell, held: null };
}

function digit(g, d) {
  if (!Number.isInteger(d) || d < 1 || d > g.size) return g;
  if (g.selected === null) return { ...g, held: g.held === d ? null : d };
  if (g.given[g.selected]) return { ...g, selected: null, held: d }; // 选中题面格时点数字 → 拿起该数字
  return place(g, g.selected, d);
}

function erase(g) {
  const cell = g.selected;
  if (cell === null || g.given[cell] || !g.values[cell]) return g;
  const values = g.values.slice();
  values[cell] = 0;
  const notes = g.notes.slice();
  const stripped = g.stripped.slice();
  restoreNotes(g, values, notes, stripped, cell);
  const wrong = new Set(g.wrong);
  wrong.delete(cell);
  return { ...g, values, notes, stripped, wrong, hint: null, history: push(g) };
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
    if (cur.layer >= MAX_LAYER) return cur.step.eliminations ? refreshed(g) : g;
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
