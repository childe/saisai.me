import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioBank } from '../audio.js';

/** 够用的 Web Audio 替身。state 模拟 iOS 的 suspended 行为。 */
function fakeEnv({ startSuspended = true } = {}) {
  const log = [];
  const ctx = {
    state: startSuspended ? 'suspended' : 'running',
    sampleRate: 16000,
    destination: { __name: 'destination' },
    resume() { log.push('resume'); this.state = 'running'; return Promise.resolve(); },
    createBuffer: (ch, len) => ({ length: len, copyToChannel() {} }),
    createBufferSource: () => {
      const src = {
        buffer: null, onended: null, connect() {}, stop() {},
        // 真实的 BufferSource 播完会回调 onended，play() 等的就是它
        start() { log.push('start'); setTimeout(() => src.onended?.(), 0); },
      };
      return src;
    },
    decodeAudioData: async () => ({ duration: 0.4, getChannelData: () => new Float32Array(10) }),
  };
  globalThis.window = { AudioContext: function () { log.push('new AudioContext'); return ctx; } };
  setNavigator({});
  globalThis.fetch = async () => {
    log.push('fetch');
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  return { ctx, log };
}

/** node 里 globalThis.navigator 是只读 getter，得用 defineProperty。 */
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

const ITEM = { id: 'a1', key: 'ym/a1.mp3' };

test('play 在第一个 await 之前就把 AudioContext 建起来', async () => {
  // iOS 只认用户手势同步执行的那一小段。fetch 之后再建，上下文会一直
  // suspended，resume() 也不生效 —— 表现就是"电脑有声，iPhone 没声"。
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  const pending = bank.play(ITEM);
  assert.ok(env.log.includes('new AudioContext'),
    'fetch 之前没有建 AudioContext，实际顺序: ' + env.log.join(' → '));
  assert.ok(env.log.indexOf('new AudioContext') < env.log.indexOf('fetch'),
    '顺序错了: ' + env.log.join(' → '));
  await pending;
});

test('unlock 会 resume 并播一个静音片段', () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  bank.unlock();
  assert.ok(env.log.includes('resume'), 'iOS 上必须在手势里 resume');
  assert.ok(env.log.includes('start'), '要播一个静音片段把输出解锁');
  assert.equal(env.ctx.state, 'running');
});

test('unlock 可以重复调用而不出错', () => {
  fakeEnv();
  const bank = new AudioBank('https://cdn/');
  bank.unlock(); bank.unlock(); bank.unlock();
  assert.equal(bank.ctx.state, 'running');
});

test('unlock 把音频会话设为 playback，绕开静音键', () => {
  // iOS 上 Web Audio 默认被侧边静音键静掉；audioSession 设成 playback 才不受影响
  const env = fakeEnv();
  const session = {};
  setNavigator({ audioSession: session });
  new AudioBank('https://cdn/').unlock();
  assert.equal(session.type, 'playback');
});

test('没有 audioSession 的浏览器不报错', () => {
  fakeEnv();
  setNavigator({});
  new AudioBank('https://cdn/').unlock();
});

test('playSamples 也先确保上下文就绪', () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  bank.playSamples(new Float32Array(100), 16000);
  assert.equal(env.ctx.state, 'running');
});
