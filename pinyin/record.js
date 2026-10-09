/**
 * 麦克风采集。直接取 AudioWorklet 给的 Float32 PCM，
 * 不走 MediaRecorder —— iOS 上它吐 AAC/mp4，还要多解一道码。
 */

const TAIL_MS = 60;  // 停止后再收一会儿，接住在途的 block

export class Recorder {
  constructor(ctx) {
    this.ctx = ctx;
    this.node = null;
    this.stream = null;
    this.chunks = [];
    this.recording = false;
    this._error = null;
  }

  get available() { return this.node !== null; }
  get error() { return this._error; }

  /** 必须在用户手势里调用，iOS 才会弹权限。失败不抛，记进 error。 */
  async init() {
    if (this.node) return true;
    this._error = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        this._error = 'unsupported';
        return false;
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // 会动频谱，分析前关掉
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      await this.ctx.audioWorklet.addModule('recorder-worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'recorder');
      this.node.port.onmessage = (e) => {
        if (this.recording) this.chunks.push(e.data);
      };
      this.ctx.createMediaStreamSource(this.stream).connect(this.node);
      // 不连 destination，避免自己听到自己（啸叫）
      return true;
    } catch (err) {
      this._error = err.name === 'NotAllowedError' ? 'denied' : 'failed';
      return false;
    }
  }

  start() {
    this.chunks = [];
    this.recording = true;
    this.node?.port.postMessage('start');
  }

  /** 返回这次录到的完整 PCM。 */
  async stop() {
    this.recording = false;
    this.node?.port.postMessage('stop');
    await new Promise((r) => setTimeout(r, TAIL_MS));
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    this.chunks = [];
    return out;
  }

  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    this.node = null;
    this.stream = null;
  }
}
