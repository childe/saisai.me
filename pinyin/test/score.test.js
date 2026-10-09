import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePronunciation, TONE_POINTS, SEGMENTAL_POINTS } from '../lib/score.js';
import { TONE_TEMPLATES } from '../lib/pitch.js';

const good = (overrides = {}) => scorePronunciation({
  userContour: TONE_TEMPLATES[4],
  refContour: TONE_TEMPLATES[4],
  targetTone: 4,
  mfccDistance: 0.4,
  durationSec: 0.6,
  ...overrides,
});

test('分数构成是 6 + 3 + 1', () => {
  assert.equal(TONE_POINTS + SEGMENTAL_POINTS + 1, 10);
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

test('声调对但音不像，评语只提音不提调', () => {
  const r = good({ mfccDistance: 8 });
  assert.match(r.message, /声调/);
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

test('mfccDistance 越大声韵母分越低且单调', () => {
  const a = good({ mfccDistance: 0.2 }).segmental.points;
  const b = good({ mfccDistance: 3 }).segmental.points;
  const c = good({ mfccDistance: 20 }).segmental.points;
  assert.ok(a >= b && b >= c);
  assert.equal(c, 0);
});
