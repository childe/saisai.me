// 回溯求解（MRV：每次选候选最少的空格）。
import { candidates, bits } from './grid.js';

export function countSolutions(values, spec, limit = 2) {
  const vals = values.slice();
  let count = 0;
  function rec() {
    if (count >= limit) return;
    const cand = candidates(vals, spec);
    let best = -1, bestN = 99;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i]) continue;
      const n = bits(cand[i]).length;
      if (n < bestN) { best = i; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; return; }
    for (const d of bits(cand[best])) {
      vals[best] = d;
      rec();
      if (count >= limit) break;
    }
    vals[best] = 0;
  }
  rec();
  return count;
}

export function solveUnique(values, spec) {
  const vals = values.slice();
  const sols = [];
  function rec() {
    if (sols.length >= 2) return;
    const cand = candidates(vals, spec);
    let best = -1, bestN = 99;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i]) continue;
      const n = bits(cand[i]).length;
      if (n < bestN) { best = i; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { sols.push(vals.slice()); return; }
    for (const d of bits(cand[best])) {
      vals[best] = d;
      rec();
      if (sols.length >= 2) break;
    }
    vals[best] = 0;
  }
  rec();
  return sols.length === 1 ? sols[0] : null;
}
