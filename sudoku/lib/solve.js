// 回溯求解（MRV：每次选候选最少的空格）。
import { candidates, bits } from './grid.js';

// 共用搜索：找到解就调用 onSolution(vals)，累计到 limit 个后停止；返回解的个数
function search(values, spec, limit, onSolution) {
  const vals = values.slice();
  let count = 0;
  function rec() {
    const cand = candidates(vals, spec);
    let best = -1, bestN = 99;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i]) continue;
      const n = bits(cand[i]).length;
      if (n < bestN) { best = i; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; onSolution(vals); return; }
    for (const d of bits(cand[best])) {
      vals[best] = d;
      rec();
      if (count >= limit) return;
    }
    vals[best] = 0;
  }
  if (limit > 0) rec();
  return count;
}

export function countSolutions(values, spec, limit = 2) {
  return search(values, spec, limit, () => {});
}

export function solveUnique(values, spec) {
  let first = null;
  const n = search(values, spec, 2, vals => { if (!first) first = vals.slice(); });
  return n === 1 ? first : null;
}
