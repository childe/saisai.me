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
  }

  /**
   * 所有音源都接这里，而不是直接接 destination。
   * 增益 → 压缩器 → destination：提音量，同时不削顶。
   */
  get out() {
    if (!this._out) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = this.gain;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      gain.connect(comp).connect(ctx.destination);
      this._out = gain;
    }
    return this._out;
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
    } catch (_) { /* 不支持就算了 */ }
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(this.out);
      src.start();
    } catch (_) { /* 解锁失败不该拖垮调用方 */ }
    return ctx;
  }

  url(item) { return this.baseUrl + item.key; }

  async buffer(item) {
    if (this.buffers.has(item.id)) return this.buffers.get(item.id);
    // 先碰一下 ctx：这一行还在用户手势的同步窗口里，fetch 之后就不是了
    const ctx = this.ctx;
    const res = await fetch(this.url(item));
    if (!res.ok) throw new Error('音频 ' + res.status);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    this.buffers.set(item.id, buf);
    return buf;
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
