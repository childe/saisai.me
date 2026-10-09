import test from 'node:test';
import assert from 'node:assert/strict';
import { dtw, euclidean, MAX_FRAMES } from '../lib/dtw.js';

const seq = (...nums) => nums.map((n) => [n]);

test('自己和自己距离为 0', () => {
  assert.equal(dtw(seq(1, 2, 3, 4), seq(1, 2, 3, 4)), 0);
});

test('时间伸缩不产生距离', () => {
  assert.equal(dtw(seq(1, 2, 3), seq(1, 1, 2, 2, 3, 3)), 0);
});

test('幅度差产生距离', () => {
  // DTW 的弯曲会吸收掉一部分恒定平移：[1,2,3] 对 [2,3,4] 可以靠错位
  // 对齐把代价压到 0.5，拿不到满额的 1.0。所以只断言"明显大于 0"。
  const d = dtw(seq(1, 2, 3), seq(2, 3, 4));
  assert.ok(d > 0.4, '实际 ' + d);
  assert.equal(dtw(seq(1, 2, 3), seq(1, 2, 3)), 0);
});

test('距离随差异单调增大', () => {
  const near = dtw(seq(1, 2, 3), seq(1.1, 2.1, 3.1));
  const far = dtw(seq(1, 2, 3), seq(5, 6, 7));
  assert.ok(far > near);
});

test('对称', () => {
  const a = seq(1, 5, 2, 8);
  const b = seq(2, 4, 3);
  assert.ok(Math.abs(dtw(a, b) - dtw(b, a)) < 1e-9);
});

test('多维帧用欧氏距离', () => {
  assert.equal(euclidean([3, 4], [0, 0]), 5);
  assert.equal(dtw([[0, 0]], [[3, 4]]), 5);
});

test('归一化后长短序列的距离可比', () => {
  const short = dtw(seq(1, 2), seq(2, 3));
  const long = dtw(seq(1, 1, 1, 2, 2, 2), seq(2, 2, 2, 3, 3, 3));
  assert.ok(Math.abs(short - long) < 0.3, '归一化前长序列会被累加放大');
});

test('空序列返回 Infinity 而不是抛异常', () => {
  assert.equal(dtw([], seq(1, 2)), Infinity);
  assert.equal(dtw(seq(1, 2), []), Infinity);
});

test('长度悬殊也能算出有限值', () => {
  // Review Focus #5：极短对极长录音
  const b = Array.from({ length: 300 }, (_, i) => [i % 3]);
  assert.ok(Number.isFinite(dtw(seq(1), b)));
});

test('超长序列被抽样降到上限内，耗时可控', () => {
  const big = Array.from({ length: 5000 }, (_, i) => [Math.sin(i / 50)]);
  const t0 = Date.now();
  assert.ok(Number.isFinite(dtw(big, big)));
  assert.ok(Date.now() - t0 < 1000, '降采样后不该跑满 5000x5000');
  assert.ok(MAX_FRAMES <= 400);
});
