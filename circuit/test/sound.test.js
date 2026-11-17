import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuzzer } from '../sound.js';

// 假 AudioContext：connect() 像老 WebKit 一样返回 undefined。
function fakeAudio() {
  const log = [];
  const node = name => ({
    name, type: '', frequency: { value: 0 }, buffer: null,
    gain: { value: 0, setTargetAtTime: v => log.push(`gain ${v}`), setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect(to) { log.push(`${name}->${to.name}`); },
    start() { log.push(`start ${name}`); }, stop() {},
  });
  class AC {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 44100; this.destination = { name: 'dest' }; log.push('new'); }
    createOscillator() { return node('osc'); }
    createGain() { return node('gain'); }
    createBufferSource() { return node('src'); }
    createBuffer() { return {}; }
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
  b.update(1, false);
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
  b.update(0, false);
  b.unlock();
  assert.ok(!log.includes('new'), 'must not create a second context');
  delete globalThis.AudioContext;
});
