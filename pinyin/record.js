/**
 * 麦克风采集。直接取 AudioWorklet 给的 Float32 PCM，
 * 不走 MediaRecorder —— iOS 上它吐 AAC/mp4，还要多解一道码。
 */

import { setPlayback, setPlayAndRecord } from './lib/audio-session.js';

const TAIL_MS = 60;  // 停止后再收一会儿，接住在途的 block
// 录音时长上限。分析是在主线程上同步跑的，20 秒的长按会把界面卡住，
// 还要一直留着几 MB 的 Float32Array。一个音节用不了这么久。
const MAX_SECONDS = 5;

export class Recorder {
  constructor(ctx) {
    this.ctx = ctx;
    this.node = null;
    this.sink = null;
    this.stream = null;
    this.chunks = [];
    this.frames = 0;
    this.recording = false;
    this.maxSeconds = MAX_SECONDS;
    this._cancelled = false;
    this._error = null;
    this._errorDetail = null;
  }

  get available() { return this.node !== null; }
  get error() { return this._error; }
  /** 出错时的原文（名字 + 消息）。'failed' 那一个词在真机上没法查。 */
  get errorDetail() { return this._errorDetail; }

  /**
   * 取消一次尚未真正开始的录音。
   *
   * iOS 首次按下会弹麦克风权限框，触摸被打断成 touchcancel —— 这时
   * init() 还在 await。等它回来再 start()，手指早松开了，录音会在
   * 没人说话的情况下跑起来。松手时调这个，后续的 start() 就不生效。
   */
  cancelPending() {
    this._cancelled = true;
    this.recording = false;
  }

  /** 必须在用户手势里调用，iOS 才会弹权限。失败不抛，记进 error。 */
  async init() {
    if (this.node) return true;
    this._error = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        this._error = 'unsupported';
        return false;
      }
      // 播放那条链路每次都把会话设成 'playback'（绕静音键、抢扬声器），
      // 那是在告诉 iOS"本页只放音不录音"。不切回来就拿不到麦克风。
      setPlayAndRecord();
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
        if (!this.recording) return;
        this.chunks.push(e.data);
        this.frames += e.data.length;
        if (this.frames >= this.maxSeconds * this.ctx.sampleRate) {
          this.recording = false;            // 到上限自己停
          this.node?.port.postMessage('stop');
        }
      };
      this.ctx.createMediaStreamSource(this.stream).connect(this.node);
      // 去向为空的 AudioWorkletNode 不保证会被渲染图拉动（Safari 尤其），
      // process() 可能根本不跑。接一条到 destination 的路，但增益设 0 ——
      // 既让图把节点拉起来，又不会自己听见自己（啸叫）。
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      this.node.connect(this.sink);        // 不写链式：老 WebKit 的
      this.sink.connect(this.ctx.destination);  // connect() 不返回目标节点
      return true;
    } catch (err) {
      this._error = err.name === 'NotAllowedError' ? 'denied' : 'failed';
      // 'failed' 这一个词把所有非权限问题都吞掉了，真机上没法查。留下原文。
      this._errorDetail = (err && err.name ? err.name + ': ' : '')
        + (err && err.message ? err.message : String(err));
      setPlayback();   // 没录成，别把会话丢在录音模式上
      return false;
    }
  }

  start() {
    if (this._cancelled) { this._cancelled = false; return; }
    this.chunks = [];
    this.frames = 0;
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
    this._cancelled = false;
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
    // 停音轨不会把音频会话从 play-and-record 切回来，输出会一直走听筒 ——
    // 跟读完回到拼音表就彻底没声了。必须显式抢回扬声器。
    setPlayback();
    this.node?.disconnect();
    this.sink?.disconnect?.();
    this.node = null;
    this.sink = null;
    this.stream = null;
  }
}
