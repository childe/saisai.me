// 蜂鸣器：一个 2400Hz 方波振荡器接增益节点。
// click：继电器翻转时的一声短促咔哒（约 20 ms）。
//
// iPad / iPhone 上要守的几条（pinyin 模块踩过的坑）：
//   1. AudioContext 只能在用户手势里建和 resume。pointerdown 对应 touchstart，
//      iOS 不把它算手势，要等 touchend / click。所以三个事件都要接。
//   2. 手势里播一帧静音 buffer，iOS 才真正放开输出。
//   3. audioSession 设成 playback，否则静音模式下 Web Audio 整个被静掉。
//   4. 不写链式 connect：老 WebKit 的 connect() 返回 undefined。
export function createBuzzer() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return { unlock() {}, update() {}, click() {} };
  let ctx = null, gain = null, last = -1;

  function unlock() {
    try {
      if (globalThis.navigator?.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* iOS 16.4 以下不支持 */ }
    try {
      if (!ctx) {
        ctx = new AC();
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 2400;
        gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
      }
      // iOS 切后台回来是 'interrupted'，也要在手势里 resume。
      if (ctx.state !== 'running') ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start();
    } catch (err) { console.warn('[circuit sound]', err); }
  }

  function update(volume, muted) {
    if (!ctx || !gain) return;
    const target = muted ? 0 : Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0)) * 0.2;
    if (Math.abs(target - last) < 1e-4) return;
    last = target;
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.03);
  }

  function click(muted) {
    if (!ctx || muted) return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 900;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.025);
    } catch { /* 无声也能用 */ }
  }

  return { unlock, update, click };
}
