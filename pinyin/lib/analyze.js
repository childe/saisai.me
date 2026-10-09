/**
 * 一段 PCM → 声调曲线 + MFCC 序列 + 发声时长。
 * 标准音和本次录音走同一条管线，两边才可比。
 */

import { f0Track } from '../f0.js';
import { trimSilence, durationOf } from './endpoint.js';
import { normalizeContour } from './pitch.js';
import { mfcc, cmvn } from './mfcc.js';

/** 没有发声段时返回 null；有发声但 F0 不可用时 contour 为 null。 */
export function analyzeSamples(samples, sampleRate) {
  const seg = trimSilence(samples, sampleRate);
  if (!seg) return null;
  return {
    contour: normalizeContour(f0Track(seg.samples, sampleRate)),
    frames: cmvn(mfcc(seg.samples, sampleRate)),
    duration: durationOf(seg, sampleRate),
  };
}
