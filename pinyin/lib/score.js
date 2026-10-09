/**
 * 把分析结果汇总成 0–10 星。纯函数。
 *
 * **只有声调参与计分**（9 分），外加 1 分合理性。
 *
 * 声韵母曾经占 3 分，已经拿掉：实测跨说话人的 MFCC+DTW 距离被音高差
 * 主导，不同音色（3.71）反而比同音色（3.97）更"像"，白噪声之间也落在
 * 同一区间（3.81）。那不是测量，换成分数只会白送一个约 2 分的常数，
 * 让吹麦也能拿九星。距离仍然算、仍然进 debug，等真实录音证明它能判别
 * 之后再决定要不要放回计分。
 *
 * 阈值是第一版的合理猜测，必须用真实录音校准（见 spec §6.4）。
 */

import { classifyTone, contourDistance, TONE_TEMPLATES } from './pitch.js';

export const TONE_POINTS = 9;
export const SANITY_POINTS = 1;

const TONE_DIST_GOOD = 1.0;   // 曲线平均偏差小于此视为很准
const TONE_DIST_BAD = 5.0;    // 大于此视为完全不对
const WRONG_TONE_CAP = 0.3;   // 判成别的声调时，声调分的封顶比例
const TONE_WEAK_RATIO = 0.7;  // 低于此比例提示"调子还可以再到位"
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
      segmental: { distance: mfccDistance },
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

  const sanityPoints = durationSec >= DUR_MIN && durationSec <= DUR_MAX
    ? SANITY_POINTS : 0;

  const stars = Math.max(0, Math.min(10, Math.round(tonePoints + sanityPoints)));

  let message;
  if (detected.tone !== targetTone && detected.tone) {
    message = `读成了${TONE_NAMES[detected.tone]}，再听一遍标准音`;
  } else if (tonePoints < TONE_POINTS * TONE_WEAK_RATIO) {
    message = '声调对了，调子还可以再到位一点';
  } else {
    message = '很棒，声调很准！';
  }

  return {
    stars,
    tone: { points: tonePoints, detected: detected.tone },
    segmental: { distance: mfccDistance },  // 只报不计分，见文件头注释
    sanity: { points: sanityPoints },
    message,
    debug,
  };
}
