// 分层提示：把解题步骤变成第 1/2/3 层的显示数据。
// 规则：任何一层都不给出「某格填某数」（flashCell 与 digit 不会同时出现）。
import { candidates, bits } from './grid.js';

export const MAX_LAYER = 3;

function view(fields) {
  return {
    text: '',
    icon: '💡',
    focusCells: [],
    digit: null,
    digitCells: [],
    shadeCells: [],
    outlineCells: [],
    flashCell: null,
    strike: [],
    showCandidates: [],
    wrongCells: [],
    ...fields,
  };
}

const unitName = kind => (kind === 'row' ? '行' : kind === 'col' ? '列' : '宫');

function candList(cells, values, spec, eliminated) {
  const cand = candidates(values, spec, eliminated);
  return [...new Set(cells)].map(cell => ({ cell, digits: bits(cand[cell]) }));
}

function hiddenView(step, layer, values, spec, eliminated) {
  if (layer === 1) {
    return view({ text: `这${unitName(step.unit.kind)}里有个数能确定`, icon: '🔍', focusCells: step.unit.cells.slice() });
  }
  const digitCells = [];
  values.forEach((v, cell) => { if (v === step.digit) digitCells.push(cell); });
  const base = { text: `看看 ${step.digit}`, icon: '👀', digit: step.digit, digitCells };
  if (layer === 2) return view(base);
  const peers = new Set();
  for (const c of digitCells) for (const p of spec.peers[c]) peers.add(p);
  const shadeCells = [];
  values.forEach((v, cell) => { if (!v && peers.has(cell)) shadeCells.push(cell); });
  const shaded = new Set(shadeCells);
  const struck = step.unit.cells.filter(c => !values[c] && !shaded.has(c) && c !== step.cell && eliminated.has(`${c}:${step.digit}`));
  return view({
    ...base, text: `${step.digit} 不能填在灰格里`, shadeCells,
    strike: struck.map(cell => ({ cell, digit: step.digit })),
    showCandidates: candList(struck, values, spec, eliminated),
  });
}

function nakedView(step, layer, values, spec, eliminated) {
  const cell = step.cell;
  if (layer === 1) {
    const set = new Set();
    for (const i of spec.unitsOf[cell]) for (const c of spec.units[i].cells) set.add(c);
    return view({ text: '这里有个格能确定', icon: '🔍', focusCells: [...set].sort((a, b) => a - b) });
  }
  if (layer === 2) return view({ text: '这一格只能填一个数', icon: '👆', flashCell: cell });
  const digitCells = spec.peers[cell].filter(c => values[c]);
  const strike = [];
  for (const key of eliminated) {
    const [c, d] = key.split(':').map(Number);
    if (c === cell) strike.push({ cell: c, digit: d });
  }
  return view({ text: '看看它周围已经有哪些数', icon: '👆', flashCell: cell, digitCells, strike });
}

function lockedView(step, layer, values, spec, eliminated) {
  const outline = step.cells.slice();
  const show = candList(layer === 3 ? [...step.cells, ...step.eliminations.map(e => e.cell)] : step.cells, values, spec, eliminated);
  if (layer === 1) {
    return view({
      text: `这一${unitName(step.from.kind)}里有个数很特别`, icon: '🔍',
      focusCells: step.from.cells.slice(), showCandidates: show,
    });
  }
  const base = { text: `${step.digit} 只能在框里的格`, icon: '🧩', digit: step.digit, outlineCells: outline, showCandidates: show };
  if (layer === 2) return view(base);
  return view({ ...base, text: `${step.digit} 不能填在划掉的格`, strike: step.eliminations.map(e => ({ ...e })) });
}

function pairView(step, layer, values, spec, eliminated) {
  const show = candList(layer === 3 ? [...step.cells, ...step.eliminations.map(e => e.cell)] : step.cells, values, spec, eliminated);
  if (layer === 1) {
    return view({ text: '这里有两个格是一对', icon: '🔍', focusCells: step.unit.cells.slice(), showCandidates: show });
  }
  const base = { text: '这两格只能填这两个数', icon: '🧩', outlineCells: step.cells.slice(), showCandidates: show };
  if (layer === 2) return view(base);
  return view({ ...base, text: '别的格不能填这一对数', strike: step.eliminations.map(e => ({ ...e })) });
}

const BUILDERS = { hidden: hiddenView, naked: nakedView, locked: lockedView, pair: pairView };

export function hintView(step, layer, values, spec, eliminated = new Set()) {
  const l = Math.min(MAX_LAYER, Math.max(1, layer));
  return BUILDERS[step.technique](step, l, values, spec, eliminated);
}

export function wrongView(cells) {
  return view({ text: '有格填错了', icon: '❌', wrongCells: cells.slice() });
}

export function stuckView() {
  return view({ text: '这一步有点难', icon: '🤔' });
}
