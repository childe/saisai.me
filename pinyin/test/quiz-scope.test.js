import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { candidatesFor, poolFor } from '../quiz.js';
import { buildQuestion } from '../lib/distractors.js';
import { LEVELS } from '../lib/difficulty.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../data/pinyin.json'), 'utf8'));
data.items = data.groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));

const SCOPES = ['all', 'shengmu', 'yunmu', 'tones'];

test('真实数据有 118 条', () => {
  assert.equal(data.items.length, 118);
});

for (const scope of SCOPES) {
  test(`${scope}：每个目标在每个难度下都出得了题，选项不重复`, () => {
    for (const target of candidatesFor(data, scope)) {
      for (const n of LEVELS) {
        const q = buildQuestion(target, poolFor(data, scope, target), data.confusions, n);
        const ids = q.options.map((o) => o.id);
        const shown = q.options.map((o) => o.display);
        assert.ok(q.options.length >= 2,
          `${scope}/${target.id}/${n} 只出了 ${q.options.length} 个选项`);
        assert.ok(q.options.length <= n);
        assert.equal(new Set(ids).size, ids.length, `${scope}/${target.id} id 重复`);
        assert.equal(new Set(shown).size, shown.length, `${scope}/${target.id} 字形重复`);
        assert.ok(ids.includes(target.id), `${scope}/${target.id} 选项里没有正确答案`);
      }
    }
  });
}

test('只声母模式的选项全是声母', () => {
  for (const target of candidatesFor(data, 'shengmu')) {
    const q = buildQuestion(target, poolFor(data, 'shengmu', target), data.confusions, 10);
    assert.ok(q.options.every((o) => o.group === 'shengmu'), target.id);
  }
});

test('只韵母模式的选项里没有声母', () => {
  for (const target of candidatesFor(data, 'yunmu')) {
    const q = buildQuestion(target, poolFor(data, 'yunmu', target), data.confusions, 10);
    assert.ok(q.options.every((o) => o.group !== 'shengmu'), target.id);
  }
});

test('四声辨别模式：选项全是同一个基础韵母，且自动缩到可用数量', () => {
  // Review Focus #1：同族只有 4 条（er 只有 3 条），凑不满 10 选 1
  for (const target of candidatesFor(data, 'tones')) {
    const q = buildQuestion(target, poolFor(data, 'tones', target), data.confusions, 10);
    assert.ok(q.options.every((o) => o.base === target.base), target.id);
    assert.equal(q.options.length, target.base === 'er' ? 3 : 4, target.id);
  }
});

test('四声辨别模式下 er 只给 3 个选项而不是报错', () => {
  const er = data.items.find((i) => i.id === 'er2');
  const q = buildQuestion(er, poolFor(data, 'tones', er), data.confusions, 10);
  assert.equal(q.options.length, 3);
});

test('全部模式下 10 选 1 总能凑满', () => {
  for (const target of data.items) {
    const q = buildQuestion(target, poolFor(data, 'all', target), data.confusions, 10);
    assert.equal(q.options.length, 10, target.id + ' 只凑到 ' + q.options.length);
  }
});
