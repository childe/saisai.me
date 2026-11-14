// 出题：五个难度，每个难度几种题型随机挑。
import { side, solutionOf } from './equation.js';

export const LEVELS = [
  { id: 1, name: '入门', desc: '一步解完：x + 5 = 12、3x = 15' },
  { id: 2, name: '简单', desc: '两步：3x − 4 = 11、20 − 2x = 8' },
  { id: 3, name: '中等', desc: '两边都有 x，答案可能是负数' },
  { id: 4, name: '较难', desc: '带括号，答案可能是分数' },
  { id: 5, name: '挑战', desc: '带分母的方程' },
];

const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const nonZero = (rand, lo, hi) => { let v; do v = int(rand, lo, hi); while (v === 0); return v; };
const eq = (left, right) => ({ left, right });

// 一步：x + b = c、x − b = c、ax = c，答案是正整数
function level1(rand) {
  const form = int(rand, 0, 2);
  if (form === 0) { const v = int(rand, 1, 12), b = int(rand, 1, 9); return eq(side(1, b), side(0, v + b)); }
  if (form === 1) { const b = int(rand, 1, 9), v = int(rand, b + 1, b + 12); return eq(side(1, -b), side(0, v - b)); }
  const a = int(rand, 2, 9), v = int(rand, 2, 10);
  return eq(side(a, 0), side(0, a * v));
}

// 两步：ax ± b = c、c = ax + b、b − ax = c，答案是正整数
function level2(rand) {
  const a = int(rand, 2, 6), v = int(rand, 1, 10);
  const form = int(rand, 0, 3);
  if (form === 0) { const b = int(rand, 1, 12); return eq(side(a, b), side(0, a * v + b)); }
  if (form === 1) { const b = int(rand, 1, a * v - 1 || 1); return eq(side(a, -b), side(0, a * v - b)); }
  if (form === 2) { const b = int(rand, 1, 12); return eq(side(0, a * v + b), side(a, b)); }
  const c = int(rand, 1, 12);
  return eq(side(-a, a * v + c), side(0, c));
}

// 两边都有 x：ax + b = cx + d，常数可正可负，答案是非零整数（可能是负数）
function level3(rand) {
  for (;;) {
    const a = int(rand, 1, 7), c = int(rand, 1, 7);
    if (a === c) continue;
    const v = nonZero(rand, -5, 9), b = nonZero(rand, -15, 15);
    const d = (a - c) * v + b;
    if (d === 0 || Math.abs(d) > 30) continue;
    return eq(side(a, b), side(c, d));
  }
}

// 找一道答案「好看」的题：|答案| ≤ maxAbs，分母 ≤ maxDen，答案不为 0
function search(rand, make, { maxAbs, maxDen, wantFraction }) {
  for (let i = 0; i < 2000; i++) {
    const e = make();
    const s = solutionOf(e);
    if (!s || s.n === 0 || s.d > maxDen || Math.abs(s.n / s.d) > maxAbs) continue;
    if (wantFraction !== (s.d > 1) && i < 1500) continue;
    return e;
  }
  throw new Error('no equation found');
}

// 带括号：k(bx + c) = dx + e、k(bx + c) = m(ex + f)、dx + e = k(bx + c)
function level4(rand) {
  const paren = () => side(int(rand, 1, 3), nonZero(rand, -6, 6), { k: pick(rand, [-3, -2, 2, 3, 4, 5]) });
  const plain = () => side(int(rand, 1, 6), nonZero(rand, -20, 20));
  const form = int(rand, 0, 2);
  const make = () => {
    if (form === 0) return eq(paren(), plain());
    if (form === 1) return eq(paren(), paren());
    return eq(plain(), paren());
  };
  return search(rand, make, { maxAbs: 10, maxDen: 4, wantFraction: rand() < 0.3 });
}

// 带分母：(bx + c)/m = d、(bx + c)/m = ex + f、(bx + c)/m = (ex + f)/n
function level5(rand) {
  const over = m => side(int(rand, 1, 5), nonZero(rand, -9, 9), { m });
  const form = int(rand, 0, 2);
  const make = () => {
    const m = int(rand, 2, 6);
    if (form === 0) return eq(over(m), side(0, nonZero(rand, -8, 8)));
    if (form === 1) return eq(over(m), side(int(rand, 1, 3), nonZero(rand, -6, 6)));
    let n2;
    do n2 = int(rand, 2, 6); while (n2 === m);
    return eq(over(m), over(n2));
  };
  return search(rand, make, { maxAbs: 12, maxDen: 4, wantFraction: rand() < 0.25 });
}

const MAKERS = [level1, level2, level3, level4, level5];

export function generate(level, rand = Math.random) {
  const make = MAKERS[Math.min(Math.max(level, 1), MAKERS.length) - 1];
  return make(rand);
}
