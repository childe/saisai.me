import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTOUR_POINTS, normalizeContour, classifyTone, contourDistance, TONE_TEMPLATES,
} from '../lib/pitch.js';

/** 造一条 f0 轨迹：shape 是 0..1 上的半音偏移函数，base 是基频。 */
function track(shape, base = 220, n = 40, clarity = 0.95) {
  return Array.from({ length: n }, (_, i) => ({
    f0: base * 2 ** (shape(i / (n - 1)) / 12),
    clarity,
  }));
}

const FLAT = () => 0;
const RISE = (t) => -4 + 9 * t;
const DIP = (t) => -2 - 6 * Math.sin(Math.PI * t) + 8 * t * t;
const FALL = (t) => 5 - 12 * t;

test('归一化到固定点数', () => {
  assert.equal(normalizeContour(track(RISE)).length, CONTOUR_POINTS);
  assert.equal(normalizeContour(track(RISE, 220, 7)).length, CONTOUR_POINTS);
});

test('中位数被移到 0 附近', () => {
  assert.ok(Math.abs(normalizeContour(track(FLAT))[CONTOUR_POINTS >> 1]) < 0.5);
});

test('小孩的高音域和成人同形状曲线归一化后一致', () => {
  const adult = normalizeContour(track(RISE, 200));
  const child = normalizeContour(track(RISE, 420));
  assert.ok(contourDistance(adult, child) < 0.3, '归一化应抹掉绝对音高差');
});

test('全部低清晰度帧返回 null', () => {
  // Review Focus #3：气声/耳语时拿不到可用 F0
  assert.equal(normalizeContour(track(RISE, 220, 40, 0.1)), null);
});

test('可用帧太少返回 null', () => {
  assert.equal(normalizeContour(track(RISE, 220, 2)), null);
});

test('空轨迹返回 null', () => {
  assert.equal(normalizeContour([]), null);
});

test('离谱的 f0 被当野点剔除', () => {
  const t = track(FLAT);
  t[10] = { f0: 3000, clarity: 0.99 };
  t[11] = { f0: 20, clarity: 0.99 };
  const c = normalizeContour(t);
  assert.ok(c.every((v) => Math.abs(v) < 6), '野点没被剔除：' + c.join(','));
});

test('四声各自被分对', () => {
  assert.equal(classifyTone(normalizeContour(track(FLAT))).tone, 1);
  assert.equal(classifyTone(normalizeContour(track(RISE))).tone, 2);
  assert.equal(classifyTone(normalizeContour(track(DIP))).tone, 3);
  assert.equal(classifyTone(normalizeContour(track(FALL))).tone, 4);
});

test('有四个模板且点数一致', () => {
  assert.equal(Object.keys(TONE_TEMPLATES).length, 4);
  for (const t of Object.values(TONE_TEMPLATES)) {
    assert.equal(t.length, CONTOUR_POINTS);
  }
});

test('置信度在 0..1 且形状明确时更高', () => {
  const clear = classifyTone(normalizeContour(track(FALL)));
  const mushy = classifyTone(normalizeContour(track((t) => -0.5 + t)));
  assert.ok(clear.confidence >= 0 && clear.confidence <= 1);
  assert.ok(clear.confidence > mushy.confidence,
    'clear=' + clear.confidence + ' mushy=' + mushy.confidence);
});

test('contourDistance 对称且自距为 0', () => {
  const a = normalizeContour(track(RISE));
  const b = normalizeContour(track(FALL));
  assert.equal(contourDistance(a, a), 0);
  assert.equal(contourDistance(a, b), contourDistance(b, a));
});
