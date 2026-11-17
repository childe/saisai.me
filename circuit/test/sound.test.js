import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuzzer, SOUNDS, engineSamples } from '../sound.js';
import { PARTS } from '../lib/parts.js';

// 假 AudioContext：connect() 像老 WebKit 一样返回 undefined。
function fakeAudio() {
  const log = [];
  const param = name => ({ name, value: 0, setTargetAtTime: v => log.push(`${name} ${v}`), setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = name => ({
    name, type: '', frequency: param('freq'), Q: param('Q'), playbackRate: param('rate'), buffer: null, loop: false,
    gain: param('gain'),
    connect(to) { log.push(`${name}->${to.name}`); },
    start() { log.push(`start ${name}`); }, stop() {},
  });
  class AC {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 44100; this.destination = { name: 'dest' }; log.push('new'); }
    createOscillator() { return node('osc'); }
    createGain() { return node('gain'); }
    createBiquadFilter() { return node('filter'); }
    createBufferSource() { return node('src'); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    resume() { log.push('resume'); this.state = 'running'; return Promise.resolve(); }
  }
  return { AC, log };
}

test('unlock works when connect() returns undefined (old WebKit)', () => {
  const { AC, log } = fakeAudio();
  globalThis.AudioContext = AC;
  globalThis.navigator ??= {};
  const b = createBuzzer();
  b.unlock();
  b.update({ beep: { volume: 1 } }, false);
  assert.ok(log.includes('osc->gain') && log.includes('gain->dest'));
  assert.ok(log.includes('resume'));
  assert.ok(log.includes('start src'), 'should play a silent buffer to unlock iOS output');
  assert.ok(log.some(l => l.startsWith('gain 0.2')));
  delete globalThis.AudioContext;
});

test('unlock sets iOS audio session to playback so the mute switch does not silence it', () => {
  const { AC } = fakeAudio();
  globalThis.AudioContext = AC;
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { audioSession: { type: 'auto' } }, configurable: true });
  createBuzzer().unlock();
  assert.equal(navigator.audioSession.type, 'playback');
  if (prev) Object.defineProperty(globalThis, 'navigator', prev);
  delete globalThis.AudioContext;
});

test('unlock resumes an interrupted context on later gestures', () => {
  const { AC, log } = fakeAudio();
  globalThis.AudioContext = AC;
  const b = createBuzzer();
  b.unlock();
  log.length = 0;
  // 模拟切后台回来
  b.update({}, false);
  b.unlock();
  assert.ok(!log.includes('new'), 'must not create a second context');
  delete globalThis.AudioContext;
});

test('every buzzer sound option has a voice', () => {
  assert.deepEqual(PARTS.buzzer.params.sound.options, SOUNDS);
});

test('each sound gets its own gain; silent sounds are not built', () => {
  const { AC, log } = fakeAudio();
  globalThis.AudioContext = AC;
  const b = createBuzzer();
  b.unlock();
  log.length = 0;
  b.update({ beep: { volume: 0 }, moto: { volume: 1, drive: 0.5 } }, false);
  assert.ok(log.includes('src->filter'), 'engine voice should be built');
  assert.equal(log.filter(l => l === 'gain->dest').length, 1, 'only one voice output');
  assert.ok(log.includes('rate 2.5'), 'engine revs with drive: 1 + 3 * 0.5');
  log.length = 0;
  b.update({ moto: { volume: 1, drive: 0.5 } }, true);
  assert.ok(log.includes('gain 0'), 'muted silences the voice');
  delete globalThis.AudioContext;
});

test('engine recording is normalized and loops without a click at the seam', () => {
  const d = engineSamples(44100);
  const peak = d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  assert.ok(Math.abs(peak - 1) < 1e-6);
  assert.ok(Math.abs(d[d.length - 1] - d[0]) < 0.3, 'seam jump should be small');
});

test('engine revs up when current grows past the volume cap (1 -> 4 cells)', () => {
  const { AC, log } = fakeAudio();
  globalThis.AudioContext = AC;
  const b = createBuzzer();
  b.unlock();
  b.update({ moto: { volume: 1, drive: 0.25 } }, false);
  log.length = 0;
  b.update({ moto: { volume: 1, drive: 1 } }, false);
  assert.ok(log.includes('rate 4'), 'same volume, more drive -> faster engine');
  delete globalThis.AudioContext;
});
