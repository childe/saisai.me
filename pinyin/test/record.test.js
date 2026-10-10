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

test('录音有时长上限，长按不会一直录下去', async () => {
  // 没有上限的话，20 秒的长按要在主线程上同步分析，手机会卡住，
  // 还要留着几 MB 的 Float32Array
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  await r.init();
  assert.ok(r.maxSeconds > 0 && r.maxSeconds <= 10, '上限 ' + r.maxSeconds + ' 秒不合理');

  r.start();
  const sr = env.ctx.sampleRate;
  const block = new Float32Array(sr); // 一秒
  for (let i = 0; i < r.maxSeconds + 5; i++) env.node.port.onmessage({ data: block });
  const pcm = await r.stop();
  assert.ok(pcm.length <= r.maxSeconds * sr * 1.1,
    '录了 ' + (pcm.length / sr).toFixed(1) + ' 秒，上限是 ' + r.maxSeconds);
});

test('到达上限后会自动停止', async () => {
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  await r.init();
  r.start();
  const block = new Float32Array(env.ctx.sampleRate);
  for (let i = 0; i < r.maxSeconds + 3; i++) env.node.port.onmessage({ data: block });
  assert.equal(r.recording, false, '超过上限后应当自己停下');
});

test('init 期间松手，不会在手指已松开后才开始录', async () => {
  // iOS 首次按下会弹权限框打断触摸：press 还在 await，touchcancel 已经到了
  const env = fakeEnv();
  const r = new Recorder(env.ctx);
  const starting = r.init();
  r.cancelPending();          // 模拟 init 还没回来就松手了
  await starting;
  r.start();
  assert.equal(r.recording, false, '已经取消了，start 不该生效');
});

test('接线不用链式 connect', async () => {
  // 老 WebKit 的 connect() 不返回目标节点，链式写法当场 TypeError。
  // 拼音表那条增益链就是栽在这上面，这里是同一个写法。
  const env = fakeEnv();
  env.gain.connect = (dest) => { env.connections.push(['gain', dest.__name]); };
  env.node.connect = (dest) => { env.connections.push(['worklet', dest.__name]); };
  const r = new Recorder(env.ctx);
  assert.equal(await r.init(), true, '老 WebKit 上也要接得起来');
  assert.ok(env.connections.some(([a, b]) => a === 'gain' && b === 'destination'),
    '实际接线: ' + JSON.stringify(env.connections));
});

test('释放麦克风之后要把扬声器抢回来', async () => {
  // iOS 上 getUserMedia 把会话切成 play-and-record，输出改走听筒。
  // 停掉音轨不会自动切回来 —— 跟读完回拼音表就彻底没声了。
  const env = fakeEnv();
  const session = { type: 'auto' };
  const r = new Recorder(env.ctx);
  await r.init();
  navigator.audioSession = session;
  session.type = 'play-and-record';
  r.release();
  assert.equal(env.tracks[0].stopped, true);
  assert.equal(session.type, 'playback', '麦克风放了，但会话还卡在录音模式');
});

test('要麦克风之前先把会话切成 play-and-record', async () => {
  // 播放那条链路现在每次都把会话设成 'playback'，那是在告诉 iOS
  // "本页只放音不录音"。不切回来就拿不到麦克风。
  const env = fakeEnv();
  const session = { type: 'playback' };
  let typeAtRequest = null;
  navigator.audioSession = session;
  const inner = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async (c) => {
    typeAtRequest = session.type;
    return inner(c);
  };
  const r = new Recorder(env.ctx);
  assert.equal(await r.init(), true);
  assert.equal(typeAtRequest, 'play-and-record', '要麦克风时会话还是 ' + typeAtRequest);
});

test('麦克风打不开时要留下真实错误，而不是只说一句 failed', async () => {
  const env = fakeEnv();
  navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error('session not active'), { name: 'InvalidStateError' });
  };
  const r = new Recorder(env.ctx);
  assert.equal(await r.init(), false);
  assert.equal(r.error, 'failed');
  assert.match(r.errorDetail, /InvalidStateError/);
  assert.match(r.errorDetail, /session not active/);
});
