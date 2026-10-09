import test from 'node:test';
import assert from 'node:assert/strict';
import { f0Track } from '../f0.js';
import { normalizeContour, classifyTone } from '../lib/pitch.js';

const SR = 16000;

/** 造一段信号，freqAt(t) 给出每一刻的基频；带几个谐波，更像人声。 */
function voice(freqAt, seconds, amp = 0.5) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = freqAt(i / n);
    phase += 2 * Math.PI * f / SR;
    out[i] = amp * (Math.sin(phase) + 0.4 * Math.sin(2 * phase)
      + 0.2 * Math.sin(3 * phase));
  }
  return out;
}

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

test('稳定音高被测准', () => {
  const t = f0Track(voice(() => 220, 0.5), SR).filter((p) => p.clarity > 0.8);
  assert.ok(t.length > 10, '可用帧太少: ' + t.length);
  assert.ok(Math.abs(median(t.map((p) => p.f0)) - 220) < 5);
});

test('小孩的高音域也测得准', () => {
  const t = f0Track(voice(() => 420, 0.5), SR).filter((p) => p.clarity > 0.8);
  assert.ok(Math.abs(median(t.map((p) => p.f0)) - 420) < 10);
});

test('不发生倍频/分频错误', () => {
  const t = f0Track(voice(() => 220, 0.5), SR).filter((p) => p.clarity > 0.8);
  const bad = t.filter((p) => Math.abs(p.f0 - 110) < 8 || Math.abs(p.f0 - 440) < 15);
  assert.equal(bad.length, 0, '有 ' + bad.length + ' 帧落在八度错误上');
});

test('静音帧的清晰度低', () => {
  const t = f0Track(new Float32Array(SR * 0.5), SR);
  assert.ok(t.every((p) => p.clarity < 0.6), '静音不该被当成有音高');
});

test('太短的输入返回空轨迹', () => {
  assert.deepEqual(f0Track(new Float32Array(100), SR), []);
});

test('下降的音高接到声调管线里判成四声', () => {
  // 整条链路：信号 → f0 → 归一化 → 四声分类
  const sig = voice((t) => 300 * 2 ** (-10 * t / 12), 0.5);
  const tone = classifyTone(normalizeContour(f0Track(sig, SR)));
  assert.equal(tone.tone, 4);
});

test('上升的音高判成二声', () => {
  const sig = voice((t) => 200 * 2 ** (8 * t / 12), 0.5);
  assert.equal(classifyTone(normalizeContour(f0Track(sig, SR))).tone, 2);
});
