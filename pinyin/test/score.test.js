import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePronunciation, TONE_POINTS, SANITY_POINTS } from '../lib/score.js';
import { TONE_TEMPLATES } from '../lib/pitch.js';

const good = (overrides = {}) => scorePronunciation({
  userContour: TONE_TEMPLATES[4],
  refContour: TONE_TEMPLATES[4],
  targetTone: 4,
  mfccDistance: 0.4,
  durationSec: 0.6,
  ...overrides,
});

test('分数构成是声调 9 + 合理性 1', () => {
  assert.equal(TONE_POINTS + SANITY_POINTS, 10);
  assert.equal(TONE_POINTS, 9);
});

test('声韵母距离不参与星数', () => {
  // 跨说话人的 MFCC+DTW 距离被音高差主导，不同音色反而比同音色更"像"。
  // 它不是测量，不能换成分数 —— 否则就是白送一个常数加分。
  const stars = [0, 2, 4, 6, 20, 1e6, Infinity]
    .map((d) => good({ mfccDistance: d }).stars);
  assert.equal(new Set(stars).size, 1,
    '星数随 mfccDistance 变了：' + stars.join(','));
});

test('声韵母距离仍然留在 debug 里供校准', () => {
  assert.equal(good({ mfccDistance: 3.7 }).debug.mfccDistance, 3.7);
});

test('读得对时不会因为参考音缺失而被扣分', () => {
  assert.equal(good({ mfccDistance: Infinity }).stars, good().stars);
});

test('读得好给高分', () => {
  assert.ok(good().stars >= 9);
});

test('星数始终在 0..10 的整数范围', () => {
  for (const d of [0, 0.5, 2, 10, 1e6]) {
    const r = good({ mfccDistance: d });
    assert.ok(Number.isInteger(r.stars));
    assert.ok(r.stars >= 0 && r.stars <= 10);
  }
});

test('声调读错扣掉大头', () => {
  const r = good({ userContour: TONE_TEMPLATES[2], targetTone: 4 });
  assert.ok(r.stars <= 5, '得了 ' + r.stars + ' 星');
  assert.equal(r.tone.detected, 2);
});

test('声调错时评语点出读成了几声', () => {
  assert.match(good({ userContour: TONE_TEMPLATES[2], targetTone: 4 }).message, /二声/);
});

test('声调对但调子不到位时，评语说调子而不是说音', () => {
  // 把四声读得过陡：最近的仍是四声，但离标准音有距离
  const overshoot = Float64Array.from(TONE_TEMPLATES[4], (v) => v * 1.8);
  const r = good({ userContour: overshoot, targetTone: 4 });
  assert.equal(r.tone.detected, 4, '过陡的下降仍该判成四声');
  assert.match(r.message, /调子/);
  assert.doesNotMatch(r.message, /读成/);
  assert.ok(r.stars < 10 && r.stars > 0, '得了 ' + r.stars + ' 星');
});

test('真读平了就如实判成一声，不含糊成"差不多对"', () => {
  const flattened = Float64Array.from(TONE_TEMPLATES[4], (v) => v * 0.05);
  const r = good({ userContour: flattened, targetTone: 4 });
  assert.equal(r.tone.detected, 1);
  assert.match(r.message, /读成了一声/);
});

test('浅一点的四声仍算四声，只是调子不到位', () => {
  // 调域窄不等于读错调。0.3 倍深度的下降仍是下降。
  const shallow = Float64Array.from(TONE_TEMPLATES[4], (v) => v * 0.3);
  const r = good({ userContour: shallow, targetTone: 4 });
  assert.equal(r.tone.detected, 4);
  assert.doesNotMatch(r.message, /读成/);
});

test('全对时评语是正面的', () => {
  assert.match(good().message, /棒|准/);
});

test('录音太短拿不到合理性分', () => {
  assert.equal(good({ durationSec: 0.1 }).sanity.points, 0);
});

test('录音太长拿不到合理性分', () => {
  // Review Focus #5
  assert.equal(good({ durationSec: 3.5 }).sanity.points, 0);
});

test('正常时长拿到合理性分', () => {
  assert.equal(good({ durationSec: 0.6 }).sanity.points, 1);
});

test('没有可用曲线时不给星', () => {
  // Review Focus #3：有声音但 F0 全无效
  const r = scorePronunciation({
    userContour: null,
    refContour: TONE_TEMPLATES[1],
    targetTone: 1,
    mfccDistance: 1,
    durationSec: 0.5,
  });
  assert.equal(r.stars, null);
  assert.match(r.message, /没.*分析|听听/);
});

test('参考曲线缺失时退化为只用模板判调，仍给分', () => {
  const r = good({ refContour: null });
  assert.ok(Number.isInteger(r.stars));
  assert.ok(r.stars > 0);
});

test('debug 里带着各项原始数值供校准', () => {
  const r = good();
  for (const k of ['contourDistance', 'mfccDistance', 'durationSec', 'toneConfidence']) {
    assert.ok(k in r.debug, '缺 ' + k);
  }
});

test('声调读得越偏，星数越低', () => {
  const at = (k) => good({ userContour: TONE_TEMPLATES[4].map((v) => v * k) }).stars;
  const [good_, mid, bad] = [at(1), at(0.5), at(0.1)];
  assert.ok(good_ >= mid && mid >= bad, [good_, mid, bad].join(','));
  assert.ok(good_ > bad, '完全读平和读准不该同分');
});
