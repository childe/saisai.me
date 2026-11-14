// 自由练习生成：随机终盘 → 随机顺序挖空 → 按所需技巧分档。
import { getSpec, candidates, bits, format } from './grid.js';
import { countSolutions } from './solve.js';
import { logicalSolve, findSteps, TECHNIQUES } from './techniques.js';

export const LEVELS = ['intro', 'easy', 'medium', 'hard'];
export const INTRO_GIVENS = { 6: 20, 9: 40 };
// 每档允许使用的技巧
export const ALLOWED = {
  intro: ['hidden'],
  easy: ['hidden', 'naked'],
  medium: ['hidden', 'naked', 'locked'],
  hard: TECHNIQUES,
};
// 页面上开放的档位；6×6 的数字来自实测（见提交信息）
export const FREE_LEVELS = { 6: ['intro', 'easy', 'medium', 'hard'], 9: LEVELS };

// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomSolution(size, random) {
  const spec = getSpec(size);
  for (;;) {
    const vals = Array(spec.cells).fill(0);
    let budget = 20000; // 回溯步数上限，超出就重新开始，避免极端慢分支
    const rec = cell => {
      if (cell === spec.cells) return true;
      if (--budget < 0) return false;
      const cand = bits(candidates(vals, spec)[cell]);
      for (const d of shuffle(cand, random)) {
        vals[cell] = d;
        if (rec(cell + 1)) return true;
      }
      vals[cell] = 0;
      return false;
    };
    if (rec(0)) return vals;
  }
}

export function gradePuzzle(values, spec) {
  if (countSolutions(values, spec) !== 1) return null;
  const r = logicalSolve(values, spec, TECHNIQUES);
  if (!r.solved) return null;
  if (r.hardest === 'pair') return 'hard';
  if (r.hardest === 'locked') return 'medium';
  const givens = values.filter(Boolean).length;
  if (r.hardest === 'hidden' && givens >= INTRO_GIVENS[spec.size]) return 'intro';
  return 'easy';
}

// 只回答「allowed 技巧能不能解完」，不记录步骤。
// 技巧都是只增不减的推理，解得完与否和应用顺序无关，所以单数先成批处理（增量更新候选），
// 卡住后才交给 findSteps 找区块/数对。比 logicalSolve 快一个数量级。
function solvable(values, spec, allowed) {
  const vals = values.slice();
  const elim = new Set();
  const full = ((1 << (spec.size + 1)) - 1) & ~1;
  const useHidden = allowed.includes('hidden'), useNaked = allowed.includes('naked');
  const eliminators = TECHNIQUES.filter(t => (t === 'locked' || t === 'pair') && allowed.includes(t));
  let cand = candidates(vals, spec);
  let empty = vals.filter(v => !v).length;
  const place = (cell, d) => {
    vals[cell] = d;
    cand[cell] = 0;
    empty--;
    for (const p of spec.peers[cell]) cand[p] &= ~(1 << d);
  };
  for (;;) {
    let progress = true;
    while (progress && empty) {
      progress = false;
      if (useNaked) {
        for (let c = 0; c < vals.length; c++) {
          const m = cand[c];
          if (m && (m & (m - 1)) === 0) { place(c, 31 - Math.clz32(m)); progress = true; }
        }
      }
      if (useHidden) {
        for (const unit of spec.units) {
          let once = 0, twice = 0, placed = 0;
          for (const c of unit.cells) {
            if (vals[c]) { placed |= 1 << vals[c]; continue; }
            twice |= once & cand[c];
            once |= cand[c];
          }
          let single = once & ~twice & ~placed & full;
          while (single) {
            const bit = single & -single;
            single ^= bit;
            const d = 31 - Math.clz32(bit);
            for (const c of unit.cells) {
              if (!vals[c] && cand[c] & bit) { place(c, d); progress = true; break; }
            }
          }
        }
      }
    }
    if (!empty) return true;
    let step = null;
    for (const t of eliminators) {
      [step] = findSteps(vals, spec, elim, t, 1);
      if (step) break;
    }
    if (!step) return false;
    for (const e of step.eliminations) {
      elim.add(`${e.cell}:${e.digit}`);
      cand[e.cell] &= ~(1 << e.digit);
    }
  }
}

// 随机顺序挖空：挖后仍唯一解，且只用 allowed 技巧能解完才保留。
// minGivens：给定数不低于该值（入门档用，防止挖得太空）。
// 逻辑解得完必然唯一（技巧都是可靠推理，输入又来自一个合法终盘），所以挖空时不再逐格数解；
// 唯一性由测试和 gradePuzzle 的 countSolutions 兜底。
// grid 可以是终盘，也可以是已经挖过的题（再往下挖）。
export function digPuzzle(grid, spec, allowed, random, minGivens = 0) {
  const puzzle = grid.slice();
  let givens = puzzle.filter(Boolean).length;
  for (const cell of shuffle([...puzzle.keys()], random)) {
    if (givens <= minGivens) break;
    if (!puzzle[cell]) continue;
    const keep = puzzle[cell];
    puzzle[cell] = 0;
    if (solvable(puzzle, spec, allowed)) givens--;
    else puzzle[cell] = keep;
  }
  return puzzle;
}

export function generateFree(size, level, random, { deadline = Date.now() + 3000 } = {}) {
  const spec = getSpec(size);
  const minGivens = level === 'intro' ? INTRO_GIVENS[size] : 0;
  while (Date.now() < deadline) {
    const solution = randomSolution(size, random);
    const puzzle = digPuzzle(solution, spec, ALLOWED[level], random, minGivens);
    if (gradePuzzle(puzzle, spec) === level) {
      return { puzzle: format(puzzle), solution: format(solution) };
    }
  }
  return null;
}
