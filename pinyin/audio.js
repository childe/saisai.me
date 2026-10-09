/** 标准音的播放与解码缓存。解码后的 AudioBuffer 跟读打分要复用。 */
export class AudioBank {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.buffers = new Map();
    this._ctx = null;
    this.current = null;
  }

  /** AudioContext 必须在用户手势里创建，iOS 才允许出声。 */
  get ctx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  url(item) { return this.baseUrl + item.key; }

  async buffer(item) {
    if (this.buffers.has(item.id)) return this.buffers.get(item.id);
    const res = await fetch(this.url(item));
    if (!res.ok) throw new Error('音频 ' + res.status);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    this.buffers.set(item.id, buf);
    return buf;
  }

  /** 播一条，返回播完的 Promise。重复点击会掐掉上一条。 */
  async play(item) {
    const buf = await this.buffer(item);
    this.stop();
    return new Promise((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.onended = () => { if (this.current === src) this.current = null; resolve(); };
      this.current = src;
      src.start();
    });
  }

  /** 播一段自己录的 PCM。 */
  playSamples(samples, sampleRate) {
    const buf = this.ctx.createBuffer(1, samples.length, sampleRate);
    buf.copyToChannel(Float32Array.from(samples), 0);
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
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
