// 人类可解的四种技巧：hidden 排除法、naked 唯一余数、locked 区块、pair 数对。
import { candidates, bits } from './grid.js';

export const TECHNIQUES = ['hidden', 'naked', 'locked', 'pair'];

const popcount = m => bits(m).length;

// 单元顺序：宫、行、列（hidden 扫描用）
function boxFirst(spec) {
  const order = { box: 0, row: 1, col: 2 };
  return spec.units.map((u, i) => [order[u.kind], i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => spec.units[x[1]]);
}

function findHidden(values, spec, cand, limit) {
  const out = [];
  for (const unit of boxFirst(spec)) {
    for (let d = 1; d <= spec.size; d++) {
      let only = -1, n = 0, placed = false;
      for (const c of unit.cells) {
        if (values[c] === d) { placed = true; break; }
        if (cand[c] & (1 << d)) { n++; only = c; }
      }
      if (!placed && n === 1) {
        out.push({ technique: 'hidden', cell: only, digit: d, unit });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

function findNaked(values, spec, cand, limit) {
  const out = [];
  for (let cell = 0; cell < cand.length; cell++) {
    if (!values[cell] && popcount(cand[cell]) === 1) {
      out.push({ technique: 'naked', cell, digit: bits(cand[cell])[0] });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// 区块：候选数字在 from 里的格全落在另一个单元 to 里（至少 2 格），则 to 里 from 之外的格可删
function findLocked(values, spec, cand, limit) {
  const out = [];
  const { units } = spec;
  const tryUnit = (from, kinds) => {
    for (let d = 1; d <= spec.size; d++) {
      const cells = from.cells.filter(c => cand[c] & (1 << d));
      if (cells.length < 2) continue;
      for (const to of units) {
        if (!kinds.includes(to.kind) || to === from) continue;
        if (!cells.every(c => to.cells.includes(c))) continue;
        const eliminations = to.cells
          .filter(c => !from.cells.includes(c) && cand[c] & (1 << d))
          .map(cell => ({ cell, digit: d }));
        if (!eliminations.length) continue;
        out.push({ technique: 'locked', digit: d, from, to, cells, eliminations });
        if (out.length >= limit) return true;
      }
    }
    return false;
  };
  for (const from of units) if (from.kind === 'box' && tryUnit(from, ['row', 'col'])) return out;
  for (const from of units) if (from.kind !== 'box' && tryUnit(from, ['box'])) return out;
  return out;
}

function findPair(values, spec, cand, limit) {
  const out = [];
  for (const unit of spec.units) {
    const cs = unit.cells;
    for (let i = 0; i < cs.length; i++) {
      if (popcount(cand[cs[i]]) !== 2) continue;
      for (let j = i + 1; j < cs.length; j++) {
        if (cand[cs[j]] !== cand[cs[i]]) continue;
        const digits = bits(cand[cs[i]]);
        const eliminations = [];
        for (const c of cs) {
          if (c === cs[i] || c === cs[j]) continue;
          for (const d of digits) if (cand[c] & (1 << d)) eliminations.push({ cell: c, digit: d });
        }
        if (!eliminations.length) continue;
        out.push({ technique: 'pair', unit, cells: [cs[i], cs[j]], digits, eliminations });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

const FINDERS = { hidden: findHidden, naked: findNaked, locked: findLocked, pair: findPair };

export function findSteps(values, spec, eliminated, technique, limit = Infinity) {
  const cand = candidates(values, spec, eliminated);
  return FINDERS[technique](values, spec, cand, limit);
}

export function findStep(values, spec, eliminated, allowed = TECHNIQUES) {
  const cand = candidates(values, spec, eliminated);
  for (const t of TECHNIQUES) {
    if (!allowed.includes(t)) continue;
    const [step] = FINDERS[t](values, spec, cand, 1);
    if (step) return step;
  }
  return null;
}

export function applyStep(values, eliminated, step) {
  const nextValues = values.slice();
  const nextElim = new Set(eliminated);
  if (step.technique === 'hidden' || step.technique === 'naked') {
    nextValues[step.cell] = step.digit;
  } else {
    for (const e of step.eliminations) nextElim.add(`${e.cell}:${e.digit}`);
  }
  return { values: nextValues, eliminated: nextElim };
}

export function logicalSolve(values, spec, allowed = TECHNIQUES) {
  let cur = { values: values.slice(), eliminated: new Set() };
  const steps = [];
  let hardest = null;
  for (;;) {
    if (cur.values.every(v => v)) break;
    const step = findStep(cur.values, spec, cur.eliminated, allowed);
    if (!step) break;
    steps.push(step);
    if (!hardest || TECHNIQUES.indexOf(step.technique) > TECHNIQUES.indexOf(hardest)) hardest = step.technique;
    cur = applyStep(cur.values, cur.eliminated, step);
  }
  return { solved: cur.values.every(v => v), steps, hardest, values: cur.values };
}
