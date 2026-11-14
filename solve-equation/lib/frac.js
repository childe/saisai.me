// 最简分数：分母恒为正，0 记作 0/1。方程的系数都是整数，只有解和验算会出现分数。

const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export function frac(n, d = 1) {
  if (d === 0) throw new Error('denominator is zero');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

export const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
export const div = (a, b) => frac(a.n * b.d, a.d * b.n);
export const eq = (a, b) => a.n === b.n && a.d === b.d;
export const isInt = a => a.d === 1;

export function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

export function toText(a) {
  const sign = a.n < 0 ? '−' : '';
  return a.d === 1 ? `${sign}${Math.abs(a.n)}` : `${sign}${Math.abs(a.n)}/${a.d}`;
}

// 孩子输入的答案：6、-3、−3、7/2、-7/2、3.5、x=6；看不懂返回 null
export function parseAnswer(raw) {
  const s = String(raw)
    .replace(/\s+/g, '')
    .replace(/^[xX]=/, '')
    .replace(/[−－—–]/g, '-')
    .replace(/[／÷]/g, '/')
    .replace(/[．。]/g, '.');
  let m = s.match(/^(-?)(\d+)\/(\d+)$/);
  if (m) return Number(m[3]) === 0 ? null : frac((m[1] ? -1 : 1) * Number(m[2]), Number(m[3]));
  m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const dec = m[3] || '';
  const d = 10 ** dec.length;
  return frac((m[1] ? -1 : 1) * Number(m[2] + dec), d);
}
