import test from 'node:test';
import assert from 'node:assert/strict';
import { magnitudes } from '../lib/fft.js';
import { mfcc, cmvn } from '../lib/mfcc.js';

const SR = 16000;

function tone(freq, seconds, amp = 0.5) {
  const n = Math.round(seconds * SR);
  return Float32Array.from({ length: n },
    (_, i) => Math.sin(2 * Math.PI * freq * i / SR) * amp);
}

test('FFT 把正弦波的能量放在对的频点上', () => {
  const mags = magnitudes(tone(1000, 512 / SR), 512);
  let peak = 0;
  for (let i = 1; i < mags.length; i++) if (mags[i] > mags[peak]) peak = i;
  const freq = peak * SR / 512;
  assert.ok(Math.abs(freq - 1000) < 60, '峰值在 ' + freq + 'Hz');
});

test('mfcc 每帧 13 维', () => {
  const frames = mfcc(tone(300, 0.3), SR);
  assert.ok(frames.length > 5);
  assert.ok(frames.every((f) => f.length === 13));
});

test('mfcc 输出全是有限数', () => {
  assert.ok(mfcc(tone(300, 0.3), SR).every((f) => f.every(Number.isFinite)));
});

test('静音不产生 NaN 或 -Infinity', () => {
  const frames = mfcc(new Float32Array(SR * 0.3), SR);
  assert.ok(frames.every((f) => f.every(Number.isFinite)), '对数要加下限');
});

test('不同频率的音色特征不同', () => {
  const a = mfcc(tone(300, 0.3), SR);
  const b = mfcc(tone(1500, 0.3), SR);
  const diff = a[3].reduce((s, v, i) => s + Math.abs(v - b[3][i]), 0);
  assert.ok(diff > 1, '差异只有 ' + diff);
});

test('同一个音不同音量，CMVN 后特征接近', () => {
  const quiet = cmvn(mfcc(tone(300, 0.3, 0.05), SR));
  const loud = cmvn(mfcc(tone(300, 0.3, 0.8), SR));
  const diff = quiet[3].reduce((s, v, i) => s + Math.abs(v - loud[3][i]), 0);
  assert.ok(diff < 2, 'CMVN 没能抵消音量差，diff=' + diff);
});

test('CMVN 后每一维均值约 0', () => {
  const frames = cmvn(mfcc(tone(440, 0.5), SR));
  for (let d = 0; d < 13; d++) {
    const col = frames.map((f) => f[d]);
    const mean = col.reduce((s, v) => s + v, 0) / col.length;
    assert.ok(Math.abs(mean) < 1e-6, '维 ' + d + ' 均值 ' + mean);
  }
});

test('CMVN 对单帧输入不产生 NaN', () => {
  assert.ok(cmvn([[1, 2, 3]])[0].every(Number.isFinite), '方差为 0 时要兜住');
});

test('CMVN 对空输入返回空', () => {
  assert.deepEqual(cmvn([]), []);
});

test('太短的输入返回空帧数组而不是抛异常', () => {
  assert.deepEqual(mfcc(new Float32Array(10), SR), []);
});
