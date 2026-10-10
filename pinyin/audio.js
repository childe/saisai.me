// 播放增益。iPhone 上 Web Audio 的输出本来就比 <audio> 轻，而拼音音节又短
// （响度感知随时长累积），叠起来就显得"声音很小"。后面接压缩器兜住峰值，
// 所以这里可以放心提。
const PLAYBACK_GAIN = 3;

/** 标准音的播放与解码缓存。解码后的 AudioBuffer 跟读打分要复用。 */
export class AudioBank {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.buffers = new Map();
    this._ctx = null;
    this._out = null;
    this.gain = PLAYBACK_GAIN;
    this.current = null;
    this.degraded = false;   // 增益链没建起来，退回直连喇叭
    this.lastError = null;   // 最近一次被捕获的错误，给页面诊断条看
  }

  /**
   * 所有音源都接这里，而不是直接接 destination。
   * 增益 → 压缩器 → destination：提音量，同时不削顶。
   *
   * 两条规矩，都是 iPhone 上整个哑掉之后补的：
   *   1. **不写链式 connect。** connect() 返回目标节点是标准后来才补的，
   *      老 WebKit 返回 undefined，`a.connect(b).connect(c)` 当场 TypeError。
   *   2. **建不起来就退回直连 destination。** 宁可没有增益、声音小一点，
   *      也不能一个音都出不去。
   */
  get out() {
    if (!this._out) {
      const ctx = this.ctx;
      try {
        const gain = ctx.createGain();
        gain.gain.value = this.gain;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.12;
        gain.connect(comp);              // 不吃返回值
        comp.connect(ctx.destination);
        this._out = gain;
      } catch (err) {
        this.fail(err);
        this.degraded = true;
        this._out = ctx.destination;     // 降级：直连喇叭
      }
    }
    return this._out;
  }

  /** 记下错误。以前这些 catch 是空的，结果 iPhone 全哑还一行报错都没有。 */
  fail(err) {
    this.lastError = (err && err.message) ? err.message : String(err);
    if (typeof console !== 'undefined') console.warn('[pinyin audio]', err);
  }

  /** 给页面诊断条用：上下文状态、是否降级、最近一次错误。 */
  diagnose() {
    return {
      state: this._ctx ? this._ctx.state : '未创建',
      degraded: this.degraded,
      error: this.lastError,
    };
  }

  /**
   * AudioContext。**必须在用户手势同步执行的那一小段里首次访问。**
   *
   * iOS 上在手势之外创建的上下文会一直是 suspended，之后再调 resume()
   * 也不生效 —— 表现就是"电脑有声、iPhone 没声"。所以每个入口都要在
   * 第一个 await 之前先碰一下它。
   */
  get ctx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  /**
   * 在用户手势里解锁音频输出。第一次触碰页面时调一次即可。
   *
   * 做两件 iOS 特有的事：
   *   1. 建上下文并 resume —— 必须在手势里，否则后面怎么调都没用
   *   2. 播一个一帧的静音片段 —— iOS 认这个动作才真正放开输出
   * 另外把 audioSession 设成 playback：否则 Web Audio 会被侧边静音键
   * 静掉，手机调成静音就什么都听不见（iOS 16.4+ 支持）。
   */
  unlock() {
    const ctx = this.ctx;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (err) { this.fail(err); }
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(this.out);
      src.start();
    } catch (err) { this.fail(err); }   // 不拖垮调用方，但必须留痕
    return ctx;
  }

  /**
   * 换音色。只换地址前缀并清掉解码缓存，**上下文和输出链路原样留着**。
   *
   * 以前换音色是整个 new 一个 AudioBank，于是每换一次就多一个
   * AudioContext。iOS 对同时存在的上下文有数量上限，旧的又从不回收，
   * 切几次之后新建的那个就是死的 —— 又是一种"突然没声了"。
   */
  setBaseUrl(baseUrl) {
    this.stop();
    this.baseUrl = baseUrl;
    this.buffers.clear();
  }

  url(item) { return this.baseUrl + item.key; }

  async buffer(item) {
    if (this.buffers.has(item.id)) return this.buffers.get(item.id);
    // 先碰一下 ctx：这一行还在用户手势的同步窗口里，fetch 之后就不是了
    const ctx = this.ctx;
    try {
      const res = await fetch(this.url(item));
      if (!res.ok) throw new Error('音频 ' + res.status);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(item.id, buf);
      return buf;
    } catch (err) {
      this.fail(err);   // 照样往上抛，但必须留痕 —— iPhone 上看不了控制台
      throw err;
    }
  }

  /**
   * 自检用：响一声。不碰网络也不碰解码，只测输出链路通不通。
   *
   * `direct` 绕开增益链直连喇叭 —— 两个都试一下就知道是整条路不通，
   * 还是只有压缩器那一段把声音吃掉了。
   */
  beep({ direct = false, hz = 440, seconds = 0.4 } = {}) {
    const ctx = this.ctx;
    try {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz;
      osc.connect(direct ? ctx.destination : this.out);
      osc.start();
      if (osc.stop) setTimeout(() => { try { osc.stop(); } catch (_) {} }, seconds * 1000);
    } catch (err) {
      this.fail(err);
    }
  }

  /**
   * 自检用：把一条音频走一遍 fetch + 解码，报告卡在哪一步。
   * 不播放 —— 只回答"音频取得到吗、解得开吗、解出来多长"。
   */
  async probe(item) {
    const ctx = this.ctx;
    let res;
    try {
      res = await fetch(this.url(item));
    } catch (err) {
      return { ok: false, step: 'fetch', detail: String(err && err.message || err) };
    }
    if (!res.ok) return { ok: false, step: 'fetch', detail: 'HTTP ' + res.status };
    try {
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      return { ok: true, step: 'decode', duration: buf.duration };
    } catch (err) {
      return { ok: false, step: 'decode', detail: String(err && err.message || err) };
    }
  }

  /** 播一条，返回播完的 Promise。重复点击会掐掉上一条。 */
  async play(item) {
    this.out;                       // 同上：必须在手势窗口内建上下文和输出链路
    const buf = await this.buffer(item);
    this.stop();
    return new Promise((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.out);
      src.onended = () => { if (this.current === src) this.current = null; resolve(); };
      this.current = src;
      src.start();
    });
  }

  /** 播一段自己录的 PCM。 */
  playSamples(samples, sampleRate) {
    const ctx = this.ctx;           // 同样要在手势窗口内
    const buf = ctx.createBuffer(1, samples.length, sampleRate);
    buf.copyToChannel(Float32Array.from(samples), 0);
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    this.current = src;
    src.start();
  }

  stop() {
    if (this.current) {
      try { this.current.stop(); } catch (_) { /* 已经停了 */ }
      this.current = null;
    }
  }
}
