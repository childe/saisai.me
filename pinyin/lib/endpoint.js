/** 端点检测：找出录音里真正发声的那一段。纯函数。 */

const FRAME_MS = 10;
const ABS_FLOOR = 0.005;   // 低于这个绝对电平一律当静音，挡住底噪
const REL_RATIO = 0.15;    // 相对峰值的门限
const PAD_MS = 40;         // 两端留的余量

export function rms(samples) {
  if (samples.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / samples.length);
}

export function durationOf(seg, sampleRate) {
  return (seg.end - seg.start) / sampleRate;
}

export function trimSilence(samples, sampleRate, opts = {}) {
  const absFloor = opts.absFloor ?? ABS_FLOOR;
  const hop = Math.max(1, Math.round(sampleRate * FRAME_MS / 1000));
  const frames = Math.floor(samples.length / hop);
  if (frames === 0) return null;

  const energy = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    energy[i] = rms(samples.subarray(i * hop, (i + 1) * hop));
  }

  let peak = 0;
  for (let i = 0; i < frames; i++) if (energy[i] > peak) peak = energy[i];
  if (peak < absFloor) return null;

  const thresh = Math.max(absFloor, peak * REL_RATIO);
  let first = -1;
  let last = -1;
  for (let i = 0; i < frames; i++) {
    if (energy[i] >= thresh) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) return null;

  const pad = Math.round(sampleRate * PAD_MS / 1000);
  const start = Math.max(0, first * hop - pad);
  const end = Math.min(samples.length, (last + 1) * hop + pad);
  if (end <= start) return null;

  return { start, end, samples: samples.subarray(start, end) };
}
