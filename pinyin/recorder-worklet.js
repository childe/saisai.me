/** 把麦克风的 PCM 原样丢回主线程。不做任何处理。 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => { this.recording = e.data === 'start'; };
  }

  process(inputs) {
    if (this.recording && inputs[0] && inputs[0][0]) {
      this.port.postMessage(inputs[0][0].slice());
    }
    return true;
  }
}

registerProcessor('recorder', RecorderProcessor);
