/**
 * 麦克风采集。直接取 AudioWorklet 给的 Float32 PCM，
 * 不走 MediaRecorder —— iOS 上它吐 AAC/mp4，还要多解一道码。
 */

const TAIL_MS = 60;  // 停止后再收一会儿，接住在途的 block

export class Recorder {
  constructor(ctx) {
    this.ctx = ctx;
    this.node = null;
    this.sink = null;
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
      // 去向为空的 AudioWorkletNode 不保证会被渲染图拉动（Safari 尤其），
      // process() 可能根本不跑。接一条到 destination 的路，但增益设 0 ——
      // 既让图把节点拉起来，又不会自己听见自己（啸叫）。
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      this.node.connect(this.sink).connect(this.ctx.destination);
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
    this.node?.port.postMessage('stop');
    // 先等再关闸门：'stop' 跨线程要时间，这段里到达的 block 是音节的尾巴
    // （四声的下落段、三声的回升段），正是声调分的立身之本，不能丢。
    await new Promise((r) => setTimeout(r, TAIL_MS));
    this.recording = false;
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    this.chunks = [];
    return out;
  }

  release() {
    this.recording = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    this.sink?.disconnect?.();
    this.node = null;
    this.sink = null;
    this.stream = null;
  }
}
