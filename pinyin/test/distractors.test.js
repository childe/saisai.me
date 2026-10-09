import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDistractors, buildQuestion } from '../lib/distractors.js';

/** 确定性 rng：永远返回 0，等于"总是取候选里的第一个"。 */
const rng0 = () => 0;

/** 简易 LCG，用来验证打乱确实在发生。 */
function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function yunmu(base, tone, display) {
  return { id: base + tone, base, tone, display, group: 'danyun' };
}

const POOL = [];
for (const [base, marks] of [
  ['a', 'āáǎà'], ['o', 'ōóǒò'], ['e', 'ēéěè'],
  ['ai', 'āi/ái/ǎi/ài'], ['ao', 'āo/áo/ǎo/ào'],
  ['an', 'ān/án/ǎn/àn'], ['ang', 'āng/áng/ǎng/àng'],
  ['en', 'ēn/én/ěn/èn'], ['eng', 'ēng/éng/ěng/èng'],
]) {
  const ds = marks.includes('/') ? marks.split('/') : [...marks];
  ds.forEach((d, i) => POOL.push(yunmu(base, i + 1, d)));
}

const CONF = {
  a: ['ai', 'ao', 'o', 'e'],
  o: ['a', 'e'],
  e: ['a', 'o'],
  ai: ['a', 'ao'],
  ao: ['a', 'ai'],
  an: ['ang', 'en', 'ai'],
  ang: ['an', 'eng'],
  en: ['eng', 'an'],
  eng: ['en', 'ang'],
};

const byId = (id) => POOL.find((p) => p.id === id);

test('同基础韵母的其他三声优先入选', () => {
  const got = pickDistractors(byId('a1'), POOL, CONF, 3, rng0);
  assert.deepEqual(got.map((g) => g.id).sort(), ['a2', 'a3', 'a4']);
});

test('不含正确答案本身', () => {
  const got = pickDistractors(byId('a1'), POOL, CONF, 9, rng0);
  assert.ok(!got.some((g) => g.id === 'a1'));
});

test('选项互不重复', () => {
  const got = pickDistractors(byId('an2'), POOL, CONF, 9, rng0);
  assert.equal(new Set(got.map((g) => g.id)).size, got.length);
});

test('显示字形也不得与正确答案重复', () => {
  const dup = { id: 'x1', base: 'x', tone: 1, display: 'ā', group: 'danyun' };
  const got = pickDistractors(byId('a1'), [...POOL, dup], CONF, 9, rng0);
  assert.ok(!got.some((g) => g.display === 'ā'));
});

test('同族填满后从 confusions 继续补', () => {
  const got = pickDistractors(byId('a1'), POOL, CONF, 7, rng0);
  assert.equal(got.length, 7);
  assert.ok(new Set(got.map((g) => g.base)).size > 1, '应该越出 a 这个基础韵母');
});

test('候选不足时返回能给的数量，不报错也不重复', () => {
  // Review Focus #1：只四声辨别模式，池子里只有同一基础韵母的 4 条
  const tiny = POOL.filter((p) => p.base === 'a');
  const got = pickDistractors(byId('a1'), tiny, {}, 9, rng0);
  assert.equal(got.length, 3);
  assert.equal(new Set(got.map((g) => g.id)).size, 3);
});

test('er 这类只有三声的基础韵母也不报错', () => {
  const er = [
    yunmu('er', 2, 'ér'), yunmu('er', 3, 'ěr'), yunmu('er', 4, 'èr'),
  ];
  const got = pickDistractors(er[0], er, {}, 9, rng0);
  assert.equal(got.length, 2);
});

test('buildQuestion 的选项含正确答案且数量正确', () => {
  const q = buildQuestion(byId('an2'), POOL, CONF, 6, rng0);
  assert.equal(q.options.length, 6);
  assert.ok(q.options.some((o) => o.id === 'an2'));
  assert.equal(new Set(q.options.map((o) => o.display)).size, 6);
});

test('buildQuestion 在候选不足时缩减选项数而不是塞重复', () => {
  const tiny = POOL.filter((p) => p.base === 'a');
  const q = buildQuestion(byId('a1'), tiny, {}, 10, rng0);
  assert.equal(q.options.length, 4);
  assert.equal(new Set(q.options.map((o) => o.id)).size, 4);
});

test('正确答案的位置会被打乱', () => {
  const rng = lcg(42);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const q = buildQuestion(byId('an2'), POOL, CONF, 4, rng);
    seen.add(q.options.findIndex((o) => o.id === 'an2'));
  }
  assert.ok(seen.size > 1, '正确答案不能总在同一个位置');
});
