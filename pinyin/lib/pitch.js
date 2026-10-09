/**
 * 声调曲线的归一化与四声分类。纯函数。
 *
 * 核心是归一化：F0 转半音（对数刻度）后减去本次发音自身的中位数，
 * 时间轴重采样到固定点数。于是只比曲线形状，不比绝对音高 ——
 * 小孩的嗓门比标准音高一整个八度也不影响判断。
 */

export const CONTOUR_POINTS = 20;

const MIN_CLARITY = 0.6;
const MIN_FRAMES = 4;
const F0_MIN = 60;
const F0_MAX = 1000;
const OUTLIER_SEMITONES = 12;  // 偏离中位数一个八度以上算野点

function median(values) {
  const a = Array.from(values).sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 按 0..1 采样一个形状函数，并和用户曲线一样做中位数归零。 */
function template(fn) {
  const raw = Array.from({ length: CONTOUR_POINTS },
    (_, i) => fn(i / (CONTOUR_POINTS - 1)));
  const base = median(raw);
  return Float64Array.from(raw, (v) => v - base);
}

/** 四声的典型形状，单位是相对中位数的半音。 */
export const TONE_TEMPLATES = {
  1: template(() => 0),
  2: template((t) => -4 + 9 * t),
  3: template((t) => -2 - 6 * Math.sin(Math.PI * t) + 8 * t * t),
  4: template((t) => 5 - 12 * t),
};

/** 等间隔重采样到 n 点，线性插值。 */
function resample(values, n) {
  const out = new Float64Array(n);
  if (values.length === 1) return out.fill(values[0]);
  for (let i = 0; i < n; i++) {
    const pos = i * (values.length - 1) / (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    out[i] = values[lo] + (values[hi] - values[lo]) * (pos - lo);
  }
  return out;
}

/**
 * track: [{ f0, clarity }]
 * 返回归一化曲线，或 null（可用帧不足）。
 */
export function normalizeContour(track, n = CONTOUR_POINTS) {
  const usable = track.filter(
    (p) => p && p.clarity >= MIN_CLARITY && p.f0 >= F0_MIN && p.f0 <= F0_MAX);
  if (usable.length < MIN_FRAMES) return null;

  const semis = usable.map((p) => 12 * Math.log2(p.f0));
  const med = median(semis);

  // 剔野点后重新取中位数，避免野点把基准拉偏
  const kept = semis.filter((s) => Math.abs(s - med) <= OUTLIER_SEMITONES);
  if (kept.length < MIN_FRAMES) return null;
  const base = median(kept);

  return resample(kept.map((s) => s - base), n);
}

export function contourDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** 和四个模板比，最近的那个就是判定的声调。 */
export function classifyTone(contour) {
  if (!contour) return { tone: 0, confidence: 0 };
  const scored = Object.entries(TONE_TEMPLATES)
    .map(([tone, tpl]) => ({ tone: Number(tone), d: contourDistance(contour, tpl) }))
    .sort((x, y) => x.d - y.d);

  const [best, second] = scored;
  // 和次优拉开得越远越有把握
  const confidence = second.d > 0
    ? Math.max(0, Math.min(1, (second.d - best.d) / second.d))
    : 0;
  return { tone: best.tone, confidence };
}
