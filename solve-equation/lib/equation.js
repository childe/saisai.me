// 一元一次方程：模型、解题步骤、选项和验算。纯函数，不碰 DOM。
//
// 方程 = { left, right }，每一边 side = { k, x, c, m }，表示 k·(x·未知数 + c) / m，都是整数：
//   m > 1 时是分数式 (x·未知数 + c)/m（此时 k = 1）
//   k ≠ 1 时是括号式 k(x·未知数 + c)
//   其余是普通式 x·未知数 + c
// 解出来以后 eq.ans 存答案（可能是分数），左边是 x，右边显示 ans。
import { frac, add, sub, mul, div, lcm, toText as fracText } from './frac.js';

export const side = (x, c, { k = 1, m = 1 } = {}) => ({ k, x, c, m });
export const isPlain = s => s.k === 1 && s.m === 1;

// ---------- 记号 ----------
// token：{t:'n',v} 数字（非负）、{t:'x'}、{t:'sign'} 打头的负号、{t:'op',v} 带空格的运算符、
// {t:'(' } {t:')'}、{t:'frac',num,den}。mark 是动画用的 class：new 新加的项，cancel 要合并/消掉的项。

const n = v => ({ t: 'n', v: String(v) });
const X = { t: 'x' };
const op = v => ({ t: 'op', v });
const markAll = (toks, mark) => (mark ? toks.map(t => ({ ...t, mark: t.mark ? `${t.mark} ${mark}` : mark })) : toks);

// 一项（含符号）：kind 'x' 或 'c'，first 表示是不是这一边的第一项
function term(kind, v, first) {
  const out = [];
  if (v < 0) out.push(first ? { t: 'sign' } : op('−'));
  else if (!first) out.push(op('+'));
  const a = Math.abs(v);
  if (kind === 'x') {
    if (a !== 1) out.push(n(a));
    out.push(X);
  } else out.push(n(a));
  return out;
}

// terms: [{kind, v, mark}]，跳过 0；全是 0 时显示 0
function sum(terms) {
  const out = [];
  for (const tm of terms) {
    if (tm.v === 0) continue;
    out.push(...markAll(term(tm.kind, tm.v, out.length === 0), tm.mark));
  }
  return out.length ? out : [n(0)];
}

const linTerms = (x, c) => [{ kind: 'x', v: x }, { kind: 'c', v: c }];
const termCount = s => (s.x !== 0) + (s.c !== 0);

// 带括号的数：负数加括号，用在 × 和 ÷ 后面
const numInParens = v => (v < 0 ? [{ t: '(' }, { t: 'sign' }, n(-v), { t: ')' }] : [n(v)]);

export function sideTokens(s) {
  const inner = sum(linTerms(s.x, s.c));
  if (s.m > 1) return [{ t: 'frac', num: inner, den: [n(s.m)] }];
  if (s.k === 1) return inner;
  const head = s.k === -1 ? [{ t: 'sign' }] : s.k < 0 ? [{ t: 'sign' }, n(-s.k)] : [n(s.k)];
  return [...head, { t: '(' }, ...inner, { t: ')' }];
}

export function fracTokens(f) {
  const head = f.n < 0 ? [{ t: 'sign' }] : [];
  if (f.d === 1) return [...head, n(Math.abs(f.n))];
  return [...head, { t: 'frac', num: [n(Math.abs(f.n))], den: [n(f.d)] }];
}

export function eqTokens(eq) {
  const right = eq.ans ? fracTokens(eq.ans) : sideTokens(eq.right);
  return [...sideTokens(eq.left), op('='), ...right];
}

export function toText(toks) {
  return toks.map(t => {
    switch (t.t) {
      case 'n': return t.v;
      case 'x': return 'x';
      case 'sign': return '−';
      case 'op': return ` ${t.v} `;
      case '(': return '(';
      case ')': return ')';
      case 'frac': {
        const num = toText(t.num);
        return `${t.num.length > 1 ? `(${num})` : num}/${toText(t.den)}`;
      }
      default: return '';
    }
  }).join('');
}

// ---------- 求解 ----------

// 把一边化成 a·未知数 + b（分数系数）
const coeffs = s => ({ a: frac(s.k * s.x, s.m), b: frac(s.k * s.c, s.m) });

export function solutionOf(eq) {
  if (eq.ans) return eq.ans;
  const l = coeffs(eq.left), r = coeffs(eq.right);
  const a = sub(l.a, r.a);
  if (a.n === 0) return null;
  return div(sub(r.b, l.b), a);
}

export const valueOf = (s, v) => mul(frac(s.k, s.m), add(mul(frac(s.x), v), frac(s.c)));

export const isDone = eq => !!eq.ans;

// 能走的步骤，第一个是讲解模式用的推荐步骤
export function validOps(eq) {
  if (eq.ans) return [];
  const { left: L, right: R } = eq;
  if (L.m > 1 || R.m > 1) {
    const ms = [...new Set([L.m, R.m].filter(m => m > 1))];
    return [{ type: 'mul', by: ms.reduce(lcm, 1), ms }];
  }
  if (L.k !== 1 || R.k !== 1) return [{ type: 'expand' }];
  const ops = [];
  if (R.x > 0 && L.x < R.x) ops.push({ type: 'swap' });
  if (R.x !== 0) ops.push({ type: 'moveX', by: -R.x });
  if (L.c !== 0 && L.x !== 0) ops.push({ type: 'moveC', by: -L.c });
  if (R.x === 0 && L.c === 0 && L.x !== 0) ops.push({ type: 'div', by: L.x });
  return ops;
}

const expandSide = s => (s.m === 1 && s.k !== 1 ? side(s.k * s.x, s.k * s.c) : s);
const mulSide = (s, by) => {
  if (s.m > 1) {
    const k = by / s.m;
    return k === 1 ? side(s.x, s.c) : side(s.x, s.c, { k });
  }
  if (s.k !== 1) return side(s.x, s.c, { k: s.k * by });
  return side(s.x * by, s.c * by);
};

export function applyOp(eq, o) {
  const { left: L, right: R } = eq;
  switch (o.type) {
    case 'mul': return finish({ left: mulSide(L, o.by), right: mulSide(R, o.by) });
    case 'expand': return finish({ left: expandSide(L), right: expandSide(R) });
    case 'swap': return finish({ left: R, right: L });
    case 'moveX': return finish({ left: side(L.x + o.by, L.c), right: side(R.x + o.by, R.c) });
    case 'moveC': return finish({ left: side(L.x, L.c + o.by), right: side(R.x, R.c + o.by) });
    case 'div': return { left: side(1, 0), right: side(0, 0), ans: frac(R.c, o.by) };
    default: throw new Error(`unknown op ${o.type}`);
  }
}

// 化到「x = 数」时直接得出答案
const finish = eq => (isPlain(eq.left) && isPlain(eq.right)
  && eq.left.x === 1 && eq.left.c === 0 && eq.right.x === 0
  ? { ...eq, ans: frac(eq.right.c) } : eq);

// 讲解模式：从原式一路按推荐步骤解到底
export function solvePath(eq) {
  const steps = [];
  let cur = eq;
  while (!cur.ans) {
    const o = validOps(cur)[0];
    if (!o) throw new Error(`stuck at ${toText(eqTokens(cur))}`);
    const next = applyOp(cur, o);
    steps.push({ op: o, before: cur, after: next });
    cur = next;
  }
  return steps;
}

// ---------- 中间行（动画用） ----------

function mulSideTokens(s, by) {
  const head = markAll([n(by), op('×')], 'new');
  const body = sideTokens(s);
  const needParens = s.m === 1 && s.k === 1 && (termCount(s) > 1 || s.x < 0 || s.c < 0);
  return [...head, ...(needParens ? [{ t: '(' }, ...body, { t: ')' }] : body)];
}

function expandSideTokens(s) {
  if (s.m !== 1 || s.k === 1) return sideTokens(s);
  const out = [];
  for (const [kind, v] of [['x', s.x], ['c', s.c]]) {
    if (v === 0) continue;
    if (out.length) out.push(op('+'));
    out.push(...numInParens(s.k), op('×'));
    if (kind === 'x') {
      if (v < 0) out.push({ t: '(' }, { t: 'sign' }, ...(v === -1 ? [] : [n(-v)]), X, { t: ')' });
      else out.push(...(v === 1 ? [] : [n(v)]), X);
    }
    else out.push(...numInParens(v));
  }
  return markAll(out, 'new');
}

// 两项相加为 0 是「消掉」（闪烁后划掉），否则是「合并」（只闪烁）
const pair = (a, b) => (a + b === 0 ? 'cancel' : 'merge');

export function interTokens(eq, o) {
  const { left: L, right: R } = eq;
  const eqSign = op('=');
  switch (o.type) {
    case 'mul': return [...mulSideTokens(L, o.by), eqSign, ...mulSideTokens(R, o.by)];
    case 'expand': return [...expandSideTokens(L), eqSign, ...expandSideTokens(R)];
    case 'swap': return null;
    case 'moveX': return [
      ...sum([{ kind: 'x', v: L.x, mark: pair(L.x, o.by) }, { kind: 'c', v: L.c }, { kind: 'x', v: o.by, mark: `new ${pair(L.x, o.by)}` }]),
      eqSign,
      ...sum([{ kind: 'x', v: R.x, mark: pair(R.x, o.by) }, { kind: 'c', v: R.c }, { kind: 'x', v: o.by, mark: `new ${pair(R.x, o.by)}` }]),
    ];
    case 'moveC': return [
      ...sum([{ kind: 'x', v: L.x }, { kind: 'c', v: L.c, mark: pair(L.c, o.by) }, { kind: 'c', v: o.by, mark: `new ${pair(L.c, o.by)}` }]),
      eqSign,
      ...sum([{ kind: 'x', v: R.x }, { kind: 'c', v: R.c, mark: pair(R.c, o.by) }, { kind: 'c', v: o.by, mark: `new ${pair(R.c, o.by)}` }]),
    ];
    case 'div': return [
      ...sideTokens(L), ...markAll([op('÷'), ...numInParens(o.by)], 'new'),
      eqSign,
      ...sideTokens(R), ...markAll([op('÷'), ...numInParens(o.by)], 'new'),
    ];
    default: return null;
  }
}

// ---------- 文字 ----------

const plusMinus = v => (v < 0 ? '减' : '加');
const xText = a => (a === 1 ? 'x' : `${a}x`);
const signedNum = v => (v < 0 ? `−${-v}` : String(v));

export function opLabel(o) {
  switch (o.type) {
    case 'mul': return `两边乘 ${o.by}`;
    case 'expand': return '去括号';
    case 'swap': return '左右交换';
    case 'moveX': return `两边${plusMinus(o.by)} ${xText(Math.abs(o.by))}`;
    case 'moveC': return `两边${plusMinus(o.by)} ${Math.abs(o.by)}`;
    case 'div': return `两边除以 ${signedNum(o.by)}`;
    default: return '';
  }
}

export function opExplain(eq, o) {
  switch (o.type) {
    case 'mul': return o.ms.length > 1
      ? `两边同时乘 ${o.by}（${o.ms.join(' 和 ')} 的最小公倍数），去掉分母。`
      : `两边同时乘 ${o.by}，去掉分母。`;
    case 'expand': {
      const neg = eq.left.k < 0 || eq.right.k < 0;
      return `去括号：括号前面的数要乘括号里的每一项。${neg ? '负数乘负数得正数，注意符号。' : ''}`;
    }
    case 'swap': return '把等号左右两边交换，方程不变。这样 x 多的一边在左边，移项后 x 前面是正数。';
    case 'moveX': return `两边同时${o.by < 0 ? '减去' : '加上'} ${xText(Math.abs(o.by))}，右边就没有 x 了。`;
    case 'moveC': return `两边同时${o.by < 0 ? '减去' : '加上'} ${Math.abs(o.by)}，左边就只剩含 x 的项。`;
    case 'div': return `两边同时除以 ${signedNum(o.by)}，求出 x。`;
    default: return '';
  }
}

// ---------- 练习模式的选项 ----------
// 返回 [{label, ok, op?, hint?}]：正确步骤带 op，错误选项带 hint

const sideText = s => toText(sideTokens(s));

function wrongChoices(eq) {
  const { left: L, right: R } = eq;
  const out = [];
  if (L.m > 1 || R.m > 1) {
    const [o] = validOps(eq);
    const other = o.ms.find(m => m !== o.by);
    if (other) out.push({
      label: `两边乘 ${other}`,
      hint: `乘 ${other} 以后，分母 ${o.ms.find(m => m !== other)} 还在。要乘 ${o.ms.join(' 和 ')} 的最小公倍数。`,
    });
    out.push({
      label: `只给左边乘 ${o.by}`,
      hint: '等号两边要同时乘同一个数，等号才成立。',
    });
    out.push({
      label: `两边除以 ${o.ms[0]}`,
      hint: '除法会让分母更大。要去掉分母，应该用乘法。',
    });
    return out;
  }
  if (L.k !== 1 || R.k !== 1) {
    // 两种常见的去括号错误：常数项忘了乘；负数乘负数符号弄反
    const forgetC = s => (s.k === 1 ? s : side(s.k * s.x, s.c));
    const forgetX = s => (s.k === 1 ? s : side(s.x, s.k * s.c));
    const flipSign = s => (s.k === 1 ? s : side(s.k * s.x, -s.k * s.c));
    const correct = applyOp(eq, { type: 'expand' });
    const label = e => `去括号：${sideText(e.left)} = ${sideText(e.right)}`;
    const neg = L.k < 0 || R.k < 0;
    const variants = [
      { e: { left: forgetC(L), right: forgetC(R) }, hint: '括号里的每一项都要乘括号前面的数，常数项也要乘。' },
      ...(neg ? [{ e: { left: flipSign(L), right: flipSign(R) }, hint: '负数乘负数得正数，负数乘正数得负数，再看看符号。' }] : []),
      { e: { left: forgetX(L), right: forgetX(R) }, hint: '括号里的每一项都要乘括号前面的数，含 x 的项也要乘。' },
    ];
    const seen = new Set([label(correct)]);
    for (const v of variants) {
      const l = label(v.e);
      if (seen.has(l)) continue;
      seen.add(l);
      out.push({ label: l, hint: v.hint });
    }
    return out;
  }
  if (R.x !== 0) out.push({
    label: opLabel({ type: 'moveX', by: R.x }),
    hint: `右边是 ${toText(term('x', R.x, true))}，要消掉它，两边应该${R.x > 0 ? '减去' : '加上'} ${xText(Math.abs(R.x))}。`,
  });
  if (L.c !== 0 && L.x !== 0) {
    out.push({
      label: opLabel({ type: 'moveC', by: L.c }),
      hint: `左边的常数是 ${signedNum(L.c)}，要消掉它，两边应该${L.c > 0 ? '减去' : '加上'} ${Math.abs(L.c)}。`,
    });
    out.push({
      label: `只给左边${plusMinus(-L.c)} ${Math.abs(L.c)}`,
      hint: '等号两边要同时加减同一个数，等号才成立。',
    });
  }
  if (R.x === 0 && L.c === 0 && L.x !== 0) {
    const a = L.x;
    if (a > 1) {
      out.push({ label: `两边减 ${a}`, hint: `${a}x 表示 ${a} 乘 x，要去掉 ${a}，应该用除法。` });
      out.push({ label: `两边乘 ${a}`, hint: `乘 ${a} 以后变成 ${a * a}x，x 前面的数更大了。应该除以 ${a}。` });
    } else if (a < 0) {
      out.push({ label: `两边除以 ${-a}`, hint: `除以 ${-a} 以后得到 −x，x 前面还有负号。要除以 ${signedNum(a)}。` });
      if (a < -1) out.push({ label: `两边加 ${-a}`, hint: `${signedNum(a)}x 表示 ${signedNum(a)} 乘 x，要去掉 ${signedNum(a)}，应该用除法。` });
    }
  }
  return out;
}

export function choicesFor(eq, rand = Math.random) {
  const valid = validOps(eq);
  const wrong = wrongChoices(eq);
  const picked = valid.slice(0, 2).map(o => ({ label: opLabel(o), ok: true, op: o }));
  if (valid[0]?.type === 'expand') picked[0].label = `去括号：${toText(eqTokens(applyOp(eq, valid[0])))}`;
  const pool = shuffle(wrong, rand);
  const seen = new Set(picked.map(c => c.label));
  while (picked.length < 4 && pool.length) {
    const w = pool.pop();
    if (seen.has(w.label)) continue;
    seen.add(w.label);
    picked.push({ ...w, ok: false });
  }
  return shuffle(picked, rand);
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 验算 ----------

// 把未知数换成数值：3x → 3×6，x → 6，负数和分数加括号
function valueTok(v) {
  if (v.d === 1 && v.n >= 0) return [n(v.n)];
  return [{ t: '(' }, ...fracTokens(v), { t: ')' }];
}

function substTerms(x, c, v) {
  const out = [];
  if (x !== 0) {
    if (x < 0) out.push({ t: 'sign' });
    if (Math.abs(x) !== 1) out.push(n(Math.abs(x)), op('×'));
    out.push(...valueTok(v));
  }
  if (c !== 0) {
    if (out.length) out.push(op(c < 0 ? '−' : '+'), n(Math.abs(c)));
    else out.push(...term('c', c, true));
  }
  return out.length ? out : [n(0)];
}

function substSide(s, v) {
  const inner = substTerms(s.x, s.c, v);
  if (s.m > 1) return [{ t: 'frac', num: inner, den: [n(s.m)] }];
  if (s.k === 1) return inner;
  const head = s.k === -1 ? [{ t: 'sign' }] : [...numInParens(s.k), op('×')];
  return [...head, { t: '(' }, ...inner, { t: ')' }];
}

export function verifyLines(original, v) {
  const lv = valueOf(original.left, v);
  const rv = valueOf(original.right, v);
  return {
    subst: [...substSide(original.left, v), op('='), ...substSide(original.right, v)],
    values: [...fracTokens(lv), op('='), ...fracTokens(rv)],
    ok: lv.n === rv.n && lv.d === rv.d,
  };
}

export { fracText };
