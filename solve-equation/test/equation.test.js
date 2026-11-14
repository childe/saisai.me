import test from 'node:test';
import assert from 'node:assert/strict';
import { frac, parseAnswer, eq as fracEq } from '../lib/frac.js';
import {
  side, applyOp, choicesFor, eqTokens, interTokens, solutionOf, solvePath, toText, validOps, verifyLines,
} from '../lib/equation.js';
import { generate, LEVELS } from '../lib/generate.js';
import { tokensHtml } from '../lib/render.js';

// 固定种子的随机数，出题结果可复现
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const text = e => toText(eqTokens(e));
const isIntSide = s => [s.k, s.x, s.c, s.m].every(Number.isInteger);

test('formatting uses real minus signs and hides coefficient 1', () => {
  assert.equal(text({ left: side(3, 5), right: side(2, 11) }), '3x + 5 = 2x + 11');
  assert.equal(text({ left: side(-1, -4), right: side(0, 7) }), '−x − 4 = 7');
  assert.equal(text({ left: side(3, -1, { k: -2 }), right: side(1, -19) }), '−2(3x − 1) = x − 19');
  assert.equal(text({ left: side(1, 1, { m: 2 }), right: side(0, 3) }), '(x + 1)/2 = 3');
});

test('fraction answers render as a stacked fraction', () => {
  const e = applyOp({ left: side(4, 0), right: side(0, 15) }, { type: 'div', by: 4 });
  assert.equal(text(e), 'x = 15/4');
  assert.match(tokensHtml(eqTokens(e)), /class="frac"><span class="fn"><span class="n">15<\/span><\/span><span class="fd"><span class="n">4<\/span>/);
});

test('intermediate lines show every operation the old version skipped', () => {
  const div = { left: side(3, 0), right: side(0, 18) };
  assert.equal(toText(interTokens(div, validOps(div)[0])), '3x ÷ 3 = 18 ÷ 3');
  const paren = { left: side(3, -1, { k: -2 }), right: side(1, -19) };
  assert.equal(toText(interTokens(paren, validOps(paren)[0])), '(−2) × 3x + (−2) × (−1) = x − 19');
  const move = { left: side(3, 5), right: side(2, 11) };
  assert.equal(toText(interTokens(move, validOps(move)[0])), '3x + 5 − 2x = 2x + 11 − 2x');
});

test('x only on the right is swapped first so the x coefficient stays positive', () => {
  const e = { left: side(0, 24), right: side(2, 6) };
  const steps = solvePath(e);
  assert.equal(steps[0].op.type, 'swap');
  assert.deepEqual(steps.map(s => text(s.after)), ['2x + 6 = 24', '2x = 18', 'x = 9']);
});

test('two denominators multiply by their least common multiple', () => {
  const e = { left: side(5, -7, { m: 4 }), right: side(2, 7, { m: 3 }) };
  const [first] = validOps(e);
  assert.deepEqual(first, { type: 'mul', by: 12, ms: [4, 3] });
  assert.equal(text(applyOp(e, first)), '3(5x − 7) = 4(2x + 7)');
});

for (const level of LEVELS) {
  test(`level ${level.id}: 300 problems solve, verify, and offer sane choices`, () => {
    const rand = seeded(level.id * 7919);
    for (let i = 0; i < 300; i++) {
      const e = generate(level.id, rand);
      const sol = solutionOf(e);
      assert.ok(sol && sol.n !== 0, `${text(e)} has a non-zero solution`);
      if (level.id <= 2) assert.ok(sol.d === 1 && sol.n > 0, `${text(e)} → positive integer`);
      if (level.id === 3) assert.equal(sol.d, 1, `${text(e)} → integer`);
      assert.ok(sol.d <= 4, `${text(e)} → small denominator`);

      const steps = solvePath(e);
      const last = steps.at(-1).after;
      assert.ok(fracEq(last.ans, sol), `${text(e)} path reaches the solution`);
      assert.ok(verifyLines(e, sol).ok, `${text(e)} verifies`);
      if (level.id === 1) assert.equal(steps.length, 1, `${text(e)} is one step`);

      for (const s of steps) {
        assert.ok(isIntSide(s.after.left) && isIntSide(s.after.right), `${text(s.after)} keeps integer coefficients`);
        const choices = choicesFor(s.before, rand);
        assert.ok(choices.some(c => c.ok), `${text(s.before)} has a correct choice`);
        assert.ok(choices.some(c => !c.ok), `${text(s.before)} has a wrong choice`);
        assert.equal(new Set(choices.map(c => c.label)).size, choices.length, 'labels are unique');
        for (const c of choices) {
          if (c.ok) assert.ok(fracEq(solutionOf(applyOp(s.before, c.op)), sol), `${c.label} keeps the solution`);
          else assert.ok(c.hint, `${c.label} explains why it is wrong`);
        }
      }
    }
  });
}

test('every valid op keeps the solution and practice can always finish', () => {
  const rand = seeded(42);
  for (let i = 0; i < 300; i++) {
    const e = generate(1 + (i % 5), rand);
    const sol = solutionOf(e);
    let cur = e;
    for (let guard = 0; !cur.ans; guard++) {
      assert.ok(guard < 12, `${text(e)} finishes`);
      const ops = validOps(cur);
      const o = ops[Math.floor(rand() * ops.length)];
      cur = applyOp(cur, o);
      assert.ok(fracEq(solutionOf(cur), sol));
    }
  }
});

test('parseAnswer accepts the ways a child writes numbers', () => {
  const cases = [['6', frac(6)], [' −3 ', frac(-3)], ['-3', frac(-3)], ['7/2', frac(7, 2)], ['-14/4', frac(-7, 2)],
    ['3.5', frac(7, 2)], ['x=6', frac(6)], ['X = -2', frac(-2)]];
  for (const [raw, want] of cases) assert.deepEqual(parseAnswer(raw), want, raw);
  for (const raw of ['', 'abc', '1/0', '--3', '3/']) assert.equal(parseAnswer(raw), null, raw);
});

test('verification substitutes with × and brackets negatives', () => {
  const e = { left: side(3, -1, { k: -2 }), right: side(1, -19) };
  const v = verifyLines(e, frac(3));
  assert.equal(toText(v.subst), '(−2) × (3 × 3 − 1) = 3 − 19');
  assert.equal(toText(v.values), '−16 = −16');
  const neg = verifyLines({ left: side(4, -12), right: side(1, -1, { k: 5 }) }, frac(-7));
  assert.equal(toText(neg.subst), '4 × (−7) − 12 = 5 × ((−7) − 1)');
});
