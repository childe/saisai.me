/**
 * 把分析结果汇总成 0–10 星。纯函数。
 *
 * 配比是刻意的：声调 6 分有物理依据、可信；声韵母 3 分是跨说话人的
 * "像不像"，判别力有限；合理性 1 分基本是鼓励分。让可信的部分占大头。
 *
 * 下面所有阈值都是第一版的合理猜测，必须用真实录音校准（见 spec §6.4）。
 */

import { classifyTone, contourDistance, TONE_TEMPLATES } from './pitch.js';

export const TONE_POINTS = 6;
export const SEGMENTAL_POINTS = 3;

const TONE_DIST_GOOD = 1.0;   // 曲线平均偏差小于此视为很准
const TONE_DIST_BAD = 5.0;    // 大于此视为完全不对
const MFCC_DIST_GOOD = 1.0;
const MFCC_DIST_BAD = 12.0;
const WRONG_TONE_CAP = 0.3;   // 判成别的声调时，声调分的封顶比例
const SEG_WEAK_RATIO = 0.5;   // 低于此比例就提示"音还要再像一点"
const DUR_MIN = 0.2;
const DUR_MAX = 2.0;

const TONE_NAMES = { 1: '一声', 2: '二声', 3: '三声', 4: '四声' };

/** 把 value 从 [good, bad] 线性映射到 [full, 0]，并夹在区间内。 */
function ramp(value, good, bad, full) {
  if (!Number.isFinite(value)) return 0;
  if (value <= good) return full;
  if (value >= bad) return 0;
  return full * (bad - value) / (bad - good);
}

export function scorePronunciation({
  userContour, refContour, targetTone, mfccDistance, durationSec,
}) {
  const debug = {
    contourDistance: null,
    mfccDistance,
    durationSec,
    toneConfidence: 0,
  };

  if (!userContour) {
    return {
      stars: null,
      tone: { points: 0, detected: 0 },
      segmental: { points: 0 },
      sanity: { points: 0 },
      message: '这次没分析出来，听听自己读的吧',
      debug,
    };
  }

  const detected = classifyTone(userContour);
  debug.toneConfidence = detected.confidence;

  // 有参考曲线就和标准音比；没有（比如标准音没取到）就和目标声调的模板比
  const reference = refContour || TONE_TEMPLATES[targetTone];
  const dist = contourDistance(userContour, reference);
  debug.contourDistance = dist;

  let tonePoints = ramp(dist, TONE_DIST_GOOD, TONE_DIST_BAD, TONE_POINTS);
  // 判成了别的声调，声调分封顶 —— 曲线再像也先纠调
  if (detected.tone !== targetTone) {
    tonePoints = Math.min(tonePoints, TONE_POINTS * WRONG_TONE_CAP);
  }

  const segPoints = ramp(mfccDistance, MFCC_DIST_GOOD, MFCC_DIST_BAD, SEGMENTAL_POINTS);
  const sanityPoints = durationSec >= DUR_MIN && durationSec <= DUR_MAX ? 1 : 0;

  const stars = Math.max(0, Math.min(10,
    Math.round(tonePoints + segPoints + sanityPoints)));

  let message;
  if (detected.tone !== targetTone && detected.tone) {
    message = `读成了${TONE_NAMES[detected.tone]}，再听一遍标准音`;
  } else if (segPoints < SEGMENTAL_POINTS * SEG_WEAK_RATIO) {
    message = '声调对了！音还要再像一点';
  } else {
    message = '很棒，声调很准！';
  }

  return {
    stars,
    tone: { points: tonePoints, detected: detected.tone },
    segmental: { points: segPoints },
    sanity: { points: sanityPoints },
    message,
    debug,
  };
}
