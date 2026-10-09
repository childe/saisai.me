/** pitchy 的薄封装：出一条 [{ f0, clarity }] 轨迹。 */

import { PitchDetector } from './vendor/pitchy.mjs';

const FRAME_MS = 25;
const HOP_MS = 10;

export function f0Track(samples, sampleRate) {
  const frameSize = 1 << Math.round(Math.log2(sampleRate * FRAME_MS / 1000));
  const hop = Math.round(sampleRate * HOP_MS / 1000);
  if (samples.length < frameSize) return [];

  const detector = PitchDetector.forFloat32Array(frameSize);
  const buf = new Float32Array(frameSize);
  const out = [];

  for (let off = 0; off + frameSize <= samples.length; off += hop) {
    buf.set(samples.subarray(off, off + frameSize));
    const [f0, clarity] = detector.findPitch(buf, sampleRate);
    out.push({ f0, clarity });
  }
  return out;
}
