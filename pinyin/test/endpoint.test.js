import test from 'node:test';
import assert from 'node:assert/strict';
import { rms, trimSilence, durationOf } from '../lib/endpoint.js';

const SR = 16000;

function tone(seconds, amp = 0.5) {
  const n = Math.round(seconds * SR);
  return Float32Array.from({ length: n },
    (_, i) => Math.sin(2 * Math.PI * 220 * i / SR) * amp);
}
const silence = (seconds) => new Float32Array(Math.round(seconds * SR));

function concat(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('rms 算对', () => {
  assert.ok(Math.abs(rms(tone(0.1, 1)) - Math.SQRT1_2) < 0.01);
  assert.equal(rms(silence(0.1)), 0);
});

test('掐掉前后静音', () => {
  const seg = trimSilence(concat(silence(0.3), tone(0.4), silence(0.3)), SR);
  assert.ok(seg);
  assert.ok(Math.abs(durationOf(seg, SR) - 0.4) < 0.08);
});

test('全静音返回 null', () => {
  // Review Focus #2：没出声时下游不能拿空数组去跑 FFT
  assert.equal(trimSilence(silence(1.5), SR), null);
});

test('极低电平的底噪也算静音', () => {
  const noise = Float32Array.from({ length: SR }, () => (Math.random() - 0.5) * 0.002);
  assert.equal(trimSilence(noise, SR), null);
});

test('纯发声不被削掉', () => {
  assert.ok(Math.abs(durationOf(trimSilence(tone(0.5), SR), SR) - 0.5) < 0.05);
});

test('留了余量，不会切掉起音', () => {
  const seg = trimSilence(concat(silence(0.3), tone(0.4), silence(0.3)), SR);
  assert.ok(seg.start < Math.round(0.3 * SR), '起点应早于发声点，留出余量');
});

test('空输入返回 null 而不是抛异常', () => {
  assert.equal(trimSilence(new Float32Array(0), SR), null);
});

test('返回的 samples 与 start/end 一致', () => {
  const sig = concat(silence(0.2), tone(0.3), silence(0.2));
  const seg = trimSilence(sig, SR);
  assert.equal(seg.samples.length, seg.end - seg.start);
  assert.equal(seg.samples[0], sig[seg.start]);
});
