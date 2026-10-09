import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples } from '../lib/analyze.js';
import { scorePronunciation } from '../lib/score.js';
import { dtw } from '../lib/dtw.js';

const SR = 16000;

/** 带谐波的合成人声，freqAt(t) 给每一刻的基频。前后各留 0.2s 静音。 */
function utterance(freqAt, seconds = 0.5, amp = 0.5) {
  const pad = Math.round(0.2 * SR);
  const n = Math.round(seconds * SR);
  const out = new Float32Array(pad * 2 + n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += 2 * Math.PI * freqAt(i / n) / SR;
    out[pad + i] = amp * (Math.sin(phase) + 0.4 * Math.sin(2 * phase)
      + 0.2 * Math.sin(3 * phase));
  }
  return out;
}

const flat = (f) => () => f;
const fall = (f) => (t) => f * 2 ** (-10 * t / 12);
const rise = (f) => (t) => f * 2 ** (8 * t / 12);

test('全静音返回 null', () => {
  // Review Focus #2：没出声时，下游不能拿空数组去跑 FFT
  assert.equal(analyzeSamples(new Float32Array(SR), SR), null);
});

test('空输入返回 null', () => {
  assert.equal(analyzeSamples(new Float32Array(0), SR), null);
});

test('正常发音给出曲线、MFCC 帧和时长', () => {
  const r = analyzeSamples(utterance(flat(220)), SR);
  assert.ok(r.contour, '没拿到声调曲线');
  assert.ok(r.frames.length > 10, 'MFCC 帧太少');
  assert.ok(Math.abs(r.duration - 0.5) < 0.15, '时长 ' + r.duration);
});

test('前后静音被掐掉，时长只算发声段', () => {
  const r = analyzeSamples(utterance(flat(220), 0.4), SR);
  assert.ok(r.duration < 0.6, '静音没掐干净：' + r.duration);
});

test('极低电平的气声拿不到可用曲线但不崩', () => {
  // Review Focus #3：有波形但 F0 不可用时要能降级
  const noise = Float32Array.from({ length: SR }, () => (Math.random() - 0.5) * 0.3);
  const r = analyzeSamples(noise, SR);
  assert.ok(r === null || r.contour === null || r.contour.length > 0);
});

test('端到端：读对四声拿高分', () => {
  const ref = analyzeSamples(utterance(fall(260)), SR);
  const me = analyzeSamples(utterance(fall(430)), SR);   // 小孩嗓门高一截
  const score = scorePronunciation({
    userContour: me.contour,
    refContour: ref.contour,
    targetTone: 4,
    mfccDistance: dtw(me.frames, ref.frames),
    durationSec: me.duration,
  });
  assert.equal(score.tone.detected, 4);
  assert.ok(score.stars >= 6, '只得了 ' + score.stars + ' 星 ' + JSON.stringify(score.debug));
});

test('端到端：把四声读成二声，分低且评语点破', () => {
  const ref = analyzeSamples(utterance(fall(260)), SR);
  const me = analyzeSamples(utterance(rise(430)), SR);
  const score = scorePronunciation({
    userContour: me.contour,
    refContour: ref.contour,
    targetTone: 4,
    mfccDistance: dtw(me.frames, ref.frames),
    durationSec: me.duration,
  });
  assert.equal(score.tone.detected, 2);
  assert.match(score.message, /二声/);
  assert.ok(score.stars <= 5, '得了 ' + score.stars + ' 星');
});

test('端到端：没出声时不给星', () => {
  const me = analyzeSamples(new Float32Array(SR), SR);
  assert.equal(me, null);
});

test('CMVN 让小孩与成人同调录音的 MFCC 距离不至于离谱', () => {
  const ref = analyzeSamples(utterance(flat(260)), SR);
  const me = analyzeSamples(utterance(flat(430)), SR);
  const d = dtw(me.frames, ref.frames);
  assert.ok(Number.isFinite(d) && d > 0, '距离 ' + d);
});
