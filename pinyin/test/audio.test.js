import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioBank } from '../audio.js';

/** 够用的 Web Audio 替身。state 模拟 iOS 的 suspended 行为。 */
function fakeEnv({ startSuspended = true, legacyConnect = false } = {}) {
  // 老的 WebKit（iOS Safari）connect() 什么都不返回，链式写法会当场 TypeError
  const ret = (dest) => (legacyConnect ? undefined : dest);
  const log = [];
  const chain = [];
  const node = (name) => ({
    __name: name,
    gain: { value: 1 },
    threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 },
    attack: { value: 0 }, release: { value: 0 },
    connect(dest) { chain.push(name + '→' + dest.__name); return ret(dest); },
    disconnect() {},
  });
  const ctx = {
    state: startSuspended ? 'suspended' : 'running',
    sampleRate: 16000,
    destination: { __name: 'destination' },
    resume() { log.push('resume'); this.state = 'running'; return Promise.resolve(); },
    createBuffer: (ch, len) => ({ length: len, copyToChannel() {} }),
    createGain: () => node('gain'),
    createOscillator: () => {
      const o = node('oscillator');
      o.frequency = { value: 0 };
      o.start = () => log.push('osc start');
      o.stop = () => {};
      return o;
    },
    createDynamicsCompressor: () => node('compressor'),
    createBufferSource: () => {
      const src = {
        buffer: null, onended: null, stop() {},
        connect(dest) { chain.push('source→' + dest.__name); return ret(dest); },
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
  return { ctx, log, chain };
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

test('播放链路里有增益级，而且比 1 大', () => {
  // iPhone 上 Web Audio 的输出比预期轻，而音节又短，听着就更小了
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  bank.unlock();
  assert.ok(bank.gain > 1, '增益是 ' + bank.gain + '，起不到提升作用');
  assert.ok(bank.gain <= 6, '增益 ' + bank.gain + ' 太大，会削顶失真');
});

test('增益级接在压缩器前，压缩器再接 destination', () => {
  // 直接加增益会削顶，必须有压缩器兜住峰值
  const env = fakeEnv();
  new AudioBank('https://cdn/').unlock();
  assert.ok(env.chain.includes('gain→compressor'), '实际接线: ' + JSON.stringify(env.chain));
  assert.ok(env.chain.includes('compressor→destination'), '实际接线: ' + JSON.stringify(env.chain));
  assert.ok(!env.chain.includes('source→destination'),
    '音源不该直连 destination，会绕过增益和压缩器: ' + JSON.stringify(env.chain));
});

test('播放的音源接到增益级，不是直接接 destination', async () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  await bank.play(ITEM);
  assert.ok(env.chain.includes('source→gain'), '实际: ' + JSON.stringify(env.chain));
});

test('自己的录音回放也走同一条链路', () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  bank.playSamples(new Float32Array(100), 16000);
  assert.ok(env.chain.includes('source→gain'));
});

// —— 老 WebKit：connect() 不返回目标节点 ——
// 链式 `gain.connect(comp).connect(destination)` 在这种浏览器上是
// `undefined.connect(...)`，当场 TypeError。异常抛在 `_out` 赋值之前，
// 缓存永远为空，每次用到都重抛一次 —— 整条输出链路建不起来，一个音都出不去。
// 这正是"电脑有声、iPhone 全哑"的样子。

test('connect 不返回目标节点时，输出链路照样建得起来', () => {
  const env = fakeEnv({ legacyConnect: true });
  const bank = new AudioBank('https://cdn/');
  assert.doesNotThrow(() => bank.out, '老 WebKit 上 out 不该抛');
  assert.ok(env.chain.includes('gain→compressor'), '实际链路: ' + env.chain.join(', '));
  assert.ok(env.chain.includes('compressor→destination'), '实际链路: ' + env.chain.join(', '));
});

test('connect 不返回目标节点时，声音仍然送得到 destination', async () => {
  const env = fakeEnv({ legacyConnect: true });
  const bank = new AudioBank('https://cdn/');
  await bank.play(ITEM);
  assert.ok(env.chain.some((c) => c.endsWith('→destination')),
    '没有任何节点接到 destination，实际链路: ' + env.chain.join(', '));
});

test('增益链建不起来就退回直连 destination，宁可声音小也不能没声', () => {
  const env = fakeEnv();
  env.ctx.createDynamicsCompressor = () => { throw new Error('压缩器不可用'); };
  const bank = new AudioBank('https://cdn/');
  assert.equal(bank.out, env.ctx.destination, '应该退回直连喇叭');
  assert.match(bank.diagnose().error, /压缩器不可用/);
  assert.equal(bank.diagnose().degraded, true);
});

test('unlock 里的错误不再被静默吞掉，而是记下来', () => {
  const env = fakeEnv();
  env.ctx.createBufferSource = () => { throw new Error('解锁失败'); };
  const bank = new AudioBank('https://cdn/');
  assert.doesNotThrow(() => bank.unlock(), 'unlock 不该拖垮调用方');
  assert.match(bank.diagnose().error, /解锁失败/);
});

test('diagnose 报告上下文状态，供页面上的诊断条显示', () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  assert.equal(bank.diagnose().state, '未创建');
  bank.unlock();
  assert.equal(bank.diagnose().state, 'running');
  assert.equal(bank.diagnose().degraded, false);
  assert.equal(bank.diagnose().error, null);
});

// —— 换音色不该新建 AudioContext ——
// iOS 对同时存在的 AudioContext 有数量上限，旧的又从不自动回收。
// 以前每换一次音色就 new 一个 AudioBank，切几次之后新建的上下文就是死的。

test('换音色复用同一个 AudioContext，不新建', () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/aitong/');
  bank.unlock();
  bank.setBaseUrl('https://cdn/xiaoyun/');
  const created = env.log.filter((l) => l === 'new AudioContext').length;
  assert.equal(created, 1, '实际建了 ' + created + ' 个上下文');
});

test('换音色会清掉上一套音色的解码缓存', async () => {
  fakeEnv();
  const bank = new AudioBank('https://cdn/aitong/');
  await bank.play(ITEM);
  assert.equal(bank.buffers.size, 1);
  bank.setBaseUrl('https://cdn/xiaoyun/');
  assert.equal(bank.buffers.size, 0, '换了音色还留着旧音色的解码结果');
  assert.equal(bank.url(ITEM), 'https://cdn/xiaoyun/ym/a1.mp3');
});

// —— 自检：把"图的问题"和"解码的问题"分开 ——
// 上下文 running、增益链也建起来了、没有异常，却还是没声音。这时候
// 需要知道的是：声音到底卡在哪一段。

test('beep 走增益链，不需要 fetch 也不需要解码', () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  bank.beep();
  assert.ok(env.chain.includes('oscillator→gain'), '实际链路: ' + env.chain.join(', '));
  assert.ok(env.log.includes('osc start'));
});

test('beep 可以绕开增益链直连喇叭，用来判断是不是压缩器的锅', () => {
  const env = fakeEnv();
  const bank = new AudioBank('https://cdn/');
  bank.beep({ direct: true });
  assert.ok(env.chain.includes('oscillator→destination'), '实际链路: ' + env.chain.join(', '));
  assert.ok(!env.chain.includes('oscillator→gain'), '直连时不该经过增益链');
});

test('probe 报告 fetch 失败，带状态码', async () => {
  fakeEnv();
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  const bank = new AudioBank('https://cdn/');
  const r = await bank.probe(ITEM);
  assert.equal(r.ok, false);
  assert.equal(r.step, 'fetch');
  assert.match(r.detail, /403/);
});

test('probe 报告解码失败，带原始错误', async () => {
  const env = fakeEnv();
  env.ctx.decodeAudioData = async () => { throw new Error('无法解码'); };
  const bank = new AudioBank('https://cdn/');
  const r = await bank.probe(ITEM);
  assert.equal(r.ok, false);
  assert.equal(r.step, 'decode');
  assert.match(r.detail, /无法解码/);
});

test('probe 成功时报告解码出来的时长', async () => {
  fakeEnv();
  const bank = new AudioBank('https://cdn/');
  const r = await bank.probe(ITEM);
  assert.equal(r.ok, true);
  assert.equal(r.duration, 0.4);
});

test('播放路径上的错误也要记进 lastError，而不是只往上抛', async () => {
  fakeEnv();
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const bank = new AudioBank('https://cdn/');
  await assert.rejects(() => bank.play(ITEM), '错误仍然要抛给调用方');
  assert.match(bank.diagnose().error, /404/, '但同时必须留痕给诊断条');
});

// —— 用过麦克风之后，播放要把扬声器抢回来 ——
// iOS 上 getUserMedia 会把音频会话切成 play-and-record，输出改走听筒。
// 跟读用完麦克风回到拼音表，就会"状态全对、一点声音都没有"。

test('每次播放前都把音频会话设回 playback', async () => {
  const env = fakeEnv();
  const session = { type: 'play-and-record' };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { audioSession: session },
  });
  const bank = new AudioBank('https://cdn/');
  await bank.play(ITEM);
  assert.equal(session.type, 'playback', '播放前没把会话抢回来');
  assert.ok(env.log.includes('start'));
});

test('回放自己的录音前也要抢回扬声器', () => {
  fakeEnv();
  const session = { type: 'play-and-record' };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { audioSession: session },
  });
  const bank = new AudioBank('https://cdn/');
  bank.playSamples(new Float32Array(10), 16000);
  assert.equal(session.type, 'playback');
});

test('取音频失败会重试一次，瞬时网络抖动不该变成没声音', async () => {
  fakeEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('Load failed');
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const bank = new AudioBank('https://cdn/');
  const buf = await bank.buffer(ITEM);
  assert.equal(calls, 2, '只试了一次');
  assert.ok(buf);
});

test('重试也失败时，错误里要带上取不到的地址', async () => {
  fakeEnv();
  globalThis.fetch = async () => { throw new TypeError('Load failed'); };
  const bank = new AudioBank('https://cdn/');
  await assert.rejects(() => bank.buffer(ITEM));
  assert.match(bank.diagnose().error, /Load failed/);
  assert.match(bank.diagnose().error, /ym\/a1\.mp3/, '看不出是哪个地址取不到');
});

// —— <audio> 元素旁路 ——
// 耳机插着能听见、拔了还能听见、刷新后就不行 —— 说明声音在播，只是
// 没走扬声器（或被静音键吃掉）。这都是 Web Audio 的音频会话问题。
// <audio> 元素完全不碰 Web Audio，用它一试就知道是不是这条路的锅。

function fakeAudioElement() {
  const made = [];
  globalThis.document = {
    createElement(tag) {
      const el = { tag, src: '', preload: '', played: false, play() { this.played = true; return Promise.resolve(); } };
      made.push(el);
      return el;
    },
  };
  return made;
}

test('playElement 用 <audio> 播，完全不碰 AudioContext', async () => {
  const env = fakeEnv();
  const made = fakeAudioElement();
  const bank = new AudioBank('https://cdn/');
  await bank.playElement(ITEM);
  assert.equal(made.length, 1);
  assert.equal(made[0].tag, 'audio');
  assert.equal(made[0].src, 'https://cdn/ym/a1.mp3');
  assert.equal(made[0].played, true);
  assert.ok(!env.log.includes('new AudioContext'), '不该建 AudioContext');
});

test('playElement 失败也记进 lastError', async () => {
  fakeEnv();
  globalThis.document = {
    createElement: () => ({ src: '', play: () => Promise.reject(new Error('播不了')) }),
  };
  const bank = new AudioBank('https://cdn/');
  await bank.playElement(ITEM);
  assert.match(bank.diagnose().error, /播不了/);
});
