import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder } from '../record.js';

/** 够用的 Web Audio / getUserMedia 替身，用来验证接线与时序。 */
function fakeEnv({ denied = false, unsupported = false } = {}) {
  const connections = [];
  const node = {
    port: { messages: [], onmessage: null, postMessage(m) { this.messages.push(m); } },
    connect(dest) { connections.push(['worklet', dest.__name]); return dest; },
    disconnect() { connections.push(['worklet', 'disconnect']); },
  };
  const destination = { __name: 'destination' };
  const gain = {
    __name: 'gain', gain: { value: 1 },
    connect(dest) { connections.push(['gain', dest.__name]); return dest; },
  };
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const ctx = {
    destination,
    sampleRate: 16000,
    audioWorklet: { addModule: async () => {} },
    createGain: () => gain,
    createMediaStreamSource: () => ({ connect: (d) => { connections.push(['source', 'worklet']); return d; } }),
  };
  globalThis.AudioWorkletNode = function () { return node; };
  // node 里 globalThis.navigator 是只读 getter，得用 defineProperty
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: unsupported ? {} : {
      mediaDevices: {
        getUserMedia: async () => {
          if (denied) throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
          return { getTracks: () => tracks };
        },
      },
    },
  });
  return { ctx, node, gain, connections, tracks };
}

test('初始化成功后 available 为真', async () => {
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  assert.equal(await r.init(), true);
  assert.equal(r.available, true);
  assert.equal(r.error, null);
});

test('worklet 的输出要有一条通往 destination 的路径', async () => {
  // Safari 不保证去向为空的 AudioWorkletNode 会被渲染图拉动，
  // process() 可能根本不跑 —— 录到的就永远是空的。
  const env = fakeEnv();
  await new Recorder(env.ctx).init();
  assert.deepEqual(
    env.connections.filter(([from]) => from !== 'source'),
    [['worklet', 'gain'], ['gain', 'destination']],
    '实际接线: ' + JSON.stringify(env.connections));
});

test('通往 destination 的那条路要静音，免得自己听见自己', async () => {
  const env = fakeEnv();
  await new Recorder(env.ctx).init();
  assert.equal(env.gain.gain.value, 0);
});

test('权限被拒时不抛异常，记进 error', async () => {
  const r = new Recorder(fakeEnv({ denied: true }).ctx);
  assert.equal(await r.init(), false);
  assert.equal(r.error, 'denied');
  assert.equal(r.available, false);
});

test('浏览器不支持时记 unsupported', async () => {
  const r = new Recorder(fakeEnv({ unsupported: true }).ctx);
  assert.equal(await r.init(), false);
  assert.equal(r.error, 'unsupported');
});

test('停止后仍收下在途的 block —— 音节的尾巴就在里面', async () => {
  // 尾巴是四声的下落段、三声的回升段，正是声调分的立身之本
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  await r.init();
  r.start();
  env.node.port.onmessage({ data: Float32Array.from([1, 2, 3]) });

  const stopping = r.stop();
  // 模拟 worklet 在 stop 消息跨线程期间又推了一块
  env.node.port.onmessage({ data: Float32Array.from([4, 5]) });
  const pcm = await stopping;

  assert.deepEqual([...pcm], [1, 2, 3, 4, 5], '在途的 block 被丢掉了');
});

test('start 会清掉上一次的残留', async () => {
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  await r.init();
  r.start();
  env.node.port.onmessage({ data: Float32Array.from([9]) });
  await r.stop();
  r.start();
  env.node.port.onmessage({ data: Float32Array.from([1]) });
  assert.deepEqual([...(await r.stop())], [1]);
});

test('release 关掉麦克风轨道并断开节点', async () => {
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  await r.init();
  r.release();
  assert.equal(env.tracks[0].stopped, true, 'MediaStream 轨道没关，iOS 的麦克风指示灯会一直亮');
  assert.equal(r.available, false);
  assert.ok(env.connections.some(([, to]) => to === 'disconnect'));
});

test('release 之后可以重新 init', async () => {
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  await r.init();
  r.release();
  assert.equal(await r.init(), true);
});
