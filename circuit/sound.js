// 蜂鸣器：一个 2400Hz 方波振荡器接增益节点。iOS 要求在手势里启动 AudioContext。
export function createBuzzer() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return { unlock() {}, update() {} };
  let ctx = null, gain = null, last = -1;

  function unlock() {
    try {
      if (!ctx) {
        ctx = new AC();
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 2400;
        gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch { /* 无声也能用 */ }
  }

  function update(volume, muted) {
    if (!ctx || !gain) return;
    const target = muted ? 0 : Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0)) * 0.2;
    if (Math.abs(target - last) < 1e-4) return;
    last = target;
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.03);
  }

  return { unlock, update };
}
