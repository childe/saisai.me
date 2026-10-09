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
// 偏离中位数这么多个半音就算野点。必须严格小于一个八度（12）：
// 整数倍频/分频正是音高检测最典型的失败，差值恰好是 12。
const OUTLIER_SEMITONES = 9;
// 和局部中位数比的门限。真实的声调起伏（三声的低谷最大，约 6 个半音）
// 是渐变的，局部中位数跟得住；倍频/分频错误和起音毛刺是突变，跟不住。
const LOCAL_WINDOW = 7;
const LOCAL_OUTLIER_SEMITONES = 4;

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

/**
 * 按**真实时间轴**重采样到 n 点，线性插值跨过空洞。
 *
 * points 是 [{ t, v }]，t 是原始帧序号。不能把幸存帧当成均匀分布 ——
 * 不发声/声带紧的帧不是均匀丢的，三声的低谷恰恰是清晰度最容易塌的地方，
 * 按下标重采样会把低谷截掉、把后半段拉长，画出来的曲线不是孩子读的那条。
 */
function resampleByTime(points, n) {
  const out = new Float64Array(n);
  if (points.length === 1) return out.fill(points[0].v);

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + (t1 - t0) * i / (n - 1);
    while (j < points.length - 2 && points[j + 1].t < t) j++;
    const a = points[j];
    const b = points[j + 1];
    out[i] = b.t === a.t ? a.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  }
  return out;
}

// 相邻帧之间跳变超过这么多半音，才考虑是不是差了一个八度。
// 必须大于真实声调相邻帧之间可能的变化（声调曲线是连续的，一帧 10ms
// 之内变不了这么多），又要能接住 12 个半音的倍频跳变。
const OCTAVE_JUMP_SEMITONES = 8;
// 跳变要离 12 的整数倍足够近，才算倍频错误。否则是别的毛病，交给剔点处理。
const OCTAVE_TOLERANCE_SEMITONES = 3;

/**
 * 校正倍频/分频错误。
 *
 * 这是音高检测最典型的失败：基频弱的时候报成二次谐波，**整段**差一个八度。
 * 实测标准音里出现过连续 11 帧被翻倍 —— 这么宽的一段，孤立看每一帧都落在
 * 正常音域内，靠剔点盖不住。
 *
 * 但相邻帧之间的跳变是明确的：声调曲线是连续的，10ms 之内变不了 12 个半音。
 * 所以按跳变解缠绕 —— 遇到接近 ±12 的台阶就把后面整段平移回来，
 * 直到下一个台阶把它移回去。
 */
function correctOctaves(values) {
  if (values.length === 0) return values;
  const out = [values[0]];
  let offset = 0;
  for (let i = 1; i < values.length; i++) {
    const jump = values[i] + offset - out[i - 1];
    const octaves = Math.round(jump / 12);
    if (
      Math.abs(jump) > OCTAVE_JUMP_SEMITONES &&
      octaves !== 0 &&
      Math.abs(jump - 12 * octaves) < OCTAVE_TOLERANCE_SEMITONES
    ) {
      offset -= 12 * octaves;
    }
    out.push(values[i] + offset);
  }
  return out;
}

/**
 * track: [{ f0, clarity }]
 * 返回归一化曲线，或 null（可用帧不足）。
 */
export function normalizeContour(track, n = CONTOUR_POINTS) {
  // 保留原始帧序号，后面要按真实时间轴重采样
  const usable = [];
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (p && p.clarity >= MIN_CLARITY && p.f0 >= F0_MIN && p.f0 <= F0_MAX) {
      usable.push({ t: i, v: 12 * Math.log2(p.f0) });
    }
  }
  if (usable.length < MIN_FRAMES) return null;

  // 先校正倍频/分频错误，再剔点 —— 否则整段差一个八度的数据会被当成野点丢光
  const corrected = correctOctaves(usable.map((p) => p.v));
  for (let i = 0; i < usable.length; i++) usable[i].v = corrected[i];

  const med = median(usable.map((p) => p.v));

  // 两道剔点。全局那道挡住离谱的值；局部那道挡住突变 ——
  // 实测标准音里出现过中段 +8.6 半音的倍频错误和起音处 -8.3 的毛刺，
  // 两者都没越过全局门限，却足以把曲线形状带歪、把声调判错。
  const rough = usable.filter((p) => Math.abs(p.v - med) < OUTLIER_SEMITONES);
  if (rough.length < MIN_FRAMES) return null;

  const half = LOCAL_WINDOW >> 1;
  const kept = rough.filter((p, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(rough.length, i + half + 1);
    const local = median(rough.slice(lo, hi).map((q) => q.v));
    return Math.abs(p.v - local) < LOCAL_OUTLIER_SEMITONES;
  });
  if (kept.length < MIN_FRAMES) return null;

  // 先按时间轴重采样到均匀网格，再取中位数归零。
  // 顺序不能反：幸存帧的分布本身是不均匀的（三声低谷处最容易丢帧），
  // 直接对它们取中位数会把基准拉偏，整条曲线跟着垂直平移。
  const curve = resampleByTime(kept, n);
  const base = median(curve);
  for (let i = 0; i < curve.length; i++) curve[i] -= base;
  return curve;
}

export function contourDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

// 拟合模板时允许的增益范围。调域因人而异（小孩、轻声说话都会偏窄），
// 判声调该看形状，不该看起伏深浅。
const FIT_GAIN_MIN = 0.3;   // 低于这个深度就不算"读出了那个调"
const FIT_GAIN_MAX = 3.0;

function rmsOf(values) {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i] * values[i];
  return Math.sqrt(s / values.length);
}

/**
 * 用一个自由增益最小二乘拟合模板，返回残差 RMS。
 *
 * 直接用绝对距离比模板是不行的：模板的起伏比真实语音大，于是幅度偏小的
 * 二声、三声反而更贴近"全平"的一声模板，调域窄的人会被整体判成一声。
 * 放开增益就只比形状。增益下限挡住"几乎不动的曲线把模板缩到 0 来冒充
 * 任意声调"；不许为负，倒过来读不算读对。
 */
function fitResidual(contour, tpl) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < contour.length; i++) {
    num += contour[i] * tpl[i];
    den += tpl[i] * tpl[i];
  }
  if (den < 1e-9) return rmsOf(contour);  // 一声模板是全零：残差就是起伏本身

  const a = Math.max(FIT_GAIN_MIN, Math.min(FIT_GAIN_MAX, num / den));
  let s = 0;
  for (let i = 0; i < contour.length; i++) {
    const d = contour[i] - a * tpl[i];
    s += d * d;
  }
  return Math.sqrt(s / contour.length);
}

/** 哪个声调的形状能拟合得最好，就判成哪个。 */
export function classifyTone(contour) {
  if (!contour) return { tone: 0, confidence: 0 };
  const scored = Object.entries(TONE_TEMPLATES)
    .map(([tone, tpl]) => ({ tone: Number(tone), d: fitResidual(contour, tpl) }))
    .sort((x, y) => x.d - y.d);

  const [best, second] = scored;
  // 和次优拉开得越远越有把握
  const confidence = second.d > 0
    ? Math.max(0, Math.min(1, (second.d - best.d) / second.d))
    : 0;
  return { tone: best.tone, confidence };
}
