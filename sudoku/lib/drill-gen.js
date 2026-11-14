// 技巧小题生成：开局第一步必须用本章技巧（更简单的技巧都用不上），且只用本章及之前的技巧能解完。
import { getSpec, format } from './grid.js';
import { countSolutions } from './solve.js';
import { TECHNIQUES, findStep, findSteps, applyStep, logicalSolve } from './techniques.js';
import { randomSolution, digPuzzle } from './generate.js';

export const DEFAULT_MAX_EMPTY = { 6: 10, 9: 20 };

const allowedFor = technique => TECHNIQUES.slice(0, TECHNIQUES.indexOf(technique) + 1);
const simplerThan = technique => TECHNIQUES.slice(0, TECHNIQUES.indexOf(technique));

// 便宜的检查放前面：回填时大多数格子是因为「更简单的技巧又能用了」被拒
export function drillOk(values, spec, technique) {
  const simpler = simplerThan(technique);
  if (simpler.length && findStep(values, spec, new Set(), simpler)) return false;
  if (!findSteps(values, spec, new Set(), technique, 1).length) return false;
  if (!logicalSolve(values, spec, allowedFor(technique)).solved) return false;
  return countSolutions(values, spec) === 1;
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 在快照上随机挑空格填入正解，填后仍是合格小题才保留；空格降到 maxEmpty 返回盘面，否则 null
function fill(snapshot, solution, spec, technique, maxEmpty, random) {
  const puzzle = snapshot.slice();
  let empty = puzzle.filter(v => !v).length;
  let progress = true;
  while (empty > maxEmpty && progress) {
    progress = false;
    const holes = shuffle([...puzzle.keys()].filter(c => !puzzle[c]), random);
    for (const cell of holes) {
      if (empty <= maxEmpty) break;
      puzzle[cell] = solution[cell];
      if (drillOk(puzzle, spec, technique)) { empty--; progress = true; }
      else puzzle[cell] = 0;
    }
  }
  return empty <= maxEmpty ? puzzle : null;
}

// 一次尝试：挖空 → 取第一次用本章技巧之前的局面 → 随机回填正解直到空格够少。失败返回 null。
export function makeDrill(size, technique, random, { maxEmpty = DEFAULT_MAX_EMPTY[size], fillTries = 1 } = {}) {
  const spec = getSpec(size);
  const allowed = allowedFor(technique);
  const solution = randomSolution(size, random);
  const dug = digPuzzle(solution, spec, allowed, random);

  // 找第一个本章技巧的步；之前不能有删候选的步，这样快照可以用空的 eliminated 重现
  let cur = { values: dug, eliminated: new Set() };
  let snapshot = null;
  for (;;) {
    if (cur.values.every(v => v)) break;
    const step = findStep(cur.values, spec, cur.eliminated, allowed);
    if (!step) break;
    if (step.technique === technique) { snapshot = cur.values; break; }
    if (step.technique === 'locked' || step.technique === 'pair') break;
    cur = applyStep(cur.values, cur.eliminated, step);
  }
  if (!snapshot || !drillOk(snapshot, spec, technique)) return null;

  // 回填顺序随机，同一个快照多试几种顺序
  let puzzle = null;
  for (let t = 0; t < fillTries && !puzzle; t++) puzzle = fill(snapshot, solution, spec, technique, maxEmpty, random);
  if (!puzzle) return null;
  const uses = logicalSolve(puzzle, spec, allowed).steps.filter(s => s.technique === technique).length;
  return { puzzle: format(puzzle), solution: format(solution), uses };
}
