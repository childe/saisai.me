/** MFCC + CMVN。纯函数。 */

import { magnitudes } from './fft.js';

const FFT_SIZE = 512;
const NUM_FILTERS = 26;
const NUM_COEFFS = 13;
const PRE_EMPHASIS = 0.97;
const LOG_FLOOR = 1e-10;   // 挡住 log(0) 变 -Infinity

const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);

function melFilterbank(sampleRate, fftSize, numFilters) {
  const half = fftSize / 2;
  const lowMel = hzToMel(80);
  const highMel = hzToMel(sampleRate / 2);
  const points = Array.from({ length: numFilters + 2 }, (_, i) =>
    Math.floor(melToHz(lowMel + (highMel - lowMel) * i / (numFilters + 1))
      * fftSize / sampleRate));

  const banks = [];
  for (let f = 1; f <= numFilters; f++) {
    const bank = new Float64Array(half);
    const lo = points[f - 1];
    const mid = points[f];
    const hi = points[f + 1];
    for (let k = lo; k < mid && k < half; k++) {
      if (mid > lo) bank[k] = (k - lo) / (mid - lo);
    }
    for (let k = mid; k < hi && k < half; k++) {
      if (hi > mid) bank[k] = (hi - k) / (hi - mid);
    }
    banks.push(bank);
  }
  return banks;
}

function hamming(size) {
  return Float64Array.from({ length: size },
    (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1)));
}

/** DCT-II，取前 numCoeffs 个。 */
function dct(input, numCoeffs) {
  const n = input.length;
  const out = new Array(numCoeffs);
  for (let k = 0; k < numCoeffs; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += input[i] * Math.cos(Math.PI * k * (i + 0.5) / n);
    }
    out[k] = s;
  }
  return out;
}

export function mfcc(samples, sampleRate, opts = {}) {
  const frameSize = opts.frameSize ?? Math.round(sampleRate * 0.025);
  const hopSize = opts.hopSize ?? Math.round(sampleRate * 0.010);
  if (samples.length < frameSize) return [];

  // 预加重
  const pre = new Float64Array(samples.length);
  pre[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    pre[i] = samples[i] - PRE_EMPHASIS * samples[i - 1];
  }

  const win = hamming(frameSize);
  const banks = melFilterbank(sampleRate, FFT_SIZE, NUM_FILTERS);
  const frames = [];

  for (let off = 0; off + frameSize <= pre.length; off += hopSize) {
    const windowed = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) windowed[i] = pre[off + i] * win[i];

    const mags = magnitudes(windowed, FFT_SIZE);
    const power = Float64Array.from(mags, (m) => m * m / FFT_SIZE);

    const logEnergies = banks.map((bank) => {
      let s = 0;
      for (let k = 0; k < bank.length; k++) s += bank[k] * power[k];
      return Math.log(Math.max(s, LOG_FLOOR));
    });

    frames.push(dct(logEnergies, NUM_COEFFS));
  }
  return frames;
}

/**
 * 倒谱均值方差归一化。抵消说话人与录音通道的差异 ——
 * 小孩的嗓音要和成人标准音比对，这一步是前提。
 */
export function cmvn(frames) {
  if (frames.length === 0) return [];
  const dims = frames[0].length;
  const mean = new Float64Array(dims);
  const std = new Float64Array(dims);

  for (const f of frames) for (let d = 0; d < dims; d++) mean[d] += f[d];
  for (let d = 0; d < dims; d++) mean[d] /= frames.length;

  for (const f of frames) {
    for (let d = 0; d < dims; d++) {
      const dev = f[d] - mean[d];
      std[d] += dev * dev;
    }
  }
  for (let d = 0; d < dims; d++) {
    std[d] = Math.sqrt(std[d] / frames.length) || 1;  // 单帧或常数维，兜住除零
  }

  return frames.map((f) =>
    Array.from({ length: dims }, (_, d) => (f[d] - mean[d]) / std[d]));
}
