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

const noise = (amp, seconds = 1) =>
  Float32Array.from({ length: Math.round(seconds * SR) },
    () => (Math.random() * 2 - 1) * amp);

test('有波形但不是乐音时，拿不到可用曲线', () => {
  // Review Focus #3：吹麦、气声、噪声 —— 端点检测会认为"有声音"，
  // 但 F0 不可用，contour 必须是 null，由上层降级成不给星。
  for (const amp of [0.05, 0.3, 0.8]) {
    const r = analyzeSamples(noise(amp), SR);
    assert.ok(r !== null, 'amp=' + amp + ' 的噪声应当被当作有声音');
    assert.equal(r.contour, null, 'amp=' + amp + ' 的噪声不该给出声调曲线');
  }
});

test('拿不到曲线时上层不给星', () => {
  const r = analyzeSamples(noise(0.3), SR);
  const score = scorePronunciation({
    userContour: r.contour, refContour: null, targetTone: 1,
    mfccDistance: 5, durationSec: r.duration,
  });
  assert.equal(score.stars, null);
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

test('绊线：MFCC+DTW 跨说话人仍然不具判别力', () => {
  // 这条测试是故意立着的绊线，不是在庆祝现状。
  //
  // 实测：同音色跨音高 3.97 / 不同音色跨音高 3.71 / 噪声之间 3.81 ——
  // "不同"比"相同"还近，这个量被音高差主导，跟读对没读对无关。
  // 所以声韵母已经从星数里拿掉了（见 lib/score.js 文件头）。
  //
  // 如果这条红了，说明判别力出现了：那是好消息，回去重新考虑把
  // 声韵母放回计分，并先用真实录音的 fixtures 证明它。
  const harmonics = (amps) => (freqAt) => {
    const pad = Math.round(0.2 * SR);
    const n = Math.round(0.5 * SR);
    const out = new Float32Array(pad * 2 + n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += 2 * Math.PI * freqAt(i / n) / SR;
      let v = 0;
      amps.forEach((a, k) => { v += a * Math.sin((k + 1) * ph); });
      out[pad + i] = 0.5 * v;
    }
    return out;
  };
  const timbreA = harmonics([1, 0.5, 0.25, 0.12, 0.06]);
  const timbreB = harmonics([1, 0.1, 0.6, 0.1, 0.5]);

  const ref = analyzeSamples(timbreA(flat(260)), SR);
  const sameTimbre = analyzeSamples(timbreA(flat(430)), SR);
  const otherTimbre = analyzeSamples(timbreB(flat(430)), SR);

  const dSame = dtw(sameTimbre.frames, ref.frames);
  const dOther = dtw(otherTimbre.frames, ref.frames);
  assert.ok(Number.isFinite(dSame) && Number.isFinite(dOther));
  assert.ok(dOther - dSame < 1.0,
    `判别力出现了（同音色 ${dSame.toFixed(2)} vs 不同音色 ${dOther.toFixed(2)}）—— `
    + '见本测试的注释，该重新考虑把声韵母放回计分了');
});
