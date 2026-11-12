/**
 * 声韵母"像不像"打分。纯函数。
 *
 * 不做 23 选 1 的判决 —— 那个口径 README 里已经证明判别力不够。这里算的是
 * 一个**相对**分数：把录音到目标参考音的距离，放进"到同声调其它全部韵母的
 * 距离"这个分布里去看，取 z 分数。
 *
 *     z = (对其它候选的平均距离 − 对目标的距离) / 其它候选距离的标准差
 *
 * 为什么要这一步：录音和标准音之间的距离里，绝大部分是说话人、麦克风、
 * 音量的差异，不是发音质量。这些东西对全部候选**同等**地抬高或压低距离，
 * 一减一除就抵消了。剩下的 z 才是"在这次录音里，目标音比别的音近多少"。
 *
 * 实测（两个真人音库互为参考，87 条韵母×声调）：
 *   读对 +1.2 / 近邻错（an↔ang 之类）+0.44 / 远错 −0.11 / 哼鸣 0.00
 * 单调，且跨说话人成立。近邻错拿中间分是特性不是缺陷。
 */

import { dtw, euclidean } from './dtw.js';

/** 特征轨迹统一重采样到的帧数。音节长短不同，比形状不比时长。 */
export const TRAJ_FRAMES = 24;

/** 线性插值重采样到 n 帧。空输入返回空。 */
export function resampleTraj(frames, n = TRAJ_FRAMES) {
  if (frames.length === 0) return [];
  if (frames.length === 1) return Array.from({ length: n }, () => frames[0].slice());
  const dims = frames[0].length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const pos = (i * (frames.length - 1)) / (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(frames.length - 1, lo + 1);
    const t = pos - lo;
    const row = new Array(dims);
    for (let d = 0; d < dims; d++) row[d] = frames[lo][d] * (1 - t) + frames[hi][d] * t;
    out.push(row);
  }
  return out;
}

/**
 * 说话人级的均值方差。传这个说话人**全部**语料的帧。
 *
 * 和 cmvn（每条自归一）的区别是统计量的范围：对 0.4 秒的单音节做自归一，
 * 等于把这个音节自己的音色特征当通道偏差减掉了。说话人级的统计量没这个问题。
 */
export function speakerStats(frameSets) {
  const all = frameSets.flat();
  if (all.length === 0) return null;
  const dims = all[0].length;
  const mean = new Float64Array(dims);
  const std = new Float64Array(dims);
  for (const f of all) for (let d = 0; d < dims; d++) mean[d] += f[d];
  for (let d = 0; d < dims; d++) mean[d] /= all.length;
  for (const f of all) {
    for (let d = 0; d < dims; d++) {
      const dev = f[d] - mean[d];
      std[d] += dev * dev;
    }
  }
  for (let d = 0; d < dims; d++) std[d] = Math.sqrt(std[d] / all.length) || 1;
  return { mean, std };
}

export function applyStats(frames, stats) {
  if (!stats) return frames;
  return frames.map((f) =>
    f.map((v, d) => (v - stats.mean[d]) / stats.std[d]));
}

/**
 * 一个特征上的 z 分数。
 *
 * @param probe 录音的特征轨迹
 * @param refs  Map<候选名, 参考轨迹>，必须是**同声调**的全部候选
 * @returns Map<候选名, z>
 */
export function zScores(probe, refs, dist = euclidean) {
  const names = [...refs.keys()];
  const d = new Map();
  for (const name of names) d.set(name, dtw(probe, refs.get(name), dist));

  const out = new Map();
  for (const target of names) {
    const others = names.filter((n) => n !== target).map((n) => d.get(n));
    if (others.length < 2) { out.set(target, 0); continue; }
    const mean = others.reduce((s, v) => s + v, 0) / others.length;
    const varr = others.reduce((s, v) => s + (v - mean) ** 2, 0) / others.length;
    out.set(target, (mean - d.get(target)) / (Math.sqrt(varr) + 1e-9));
  }
  return out;
}

/**
 * 把多个 z 表平均成一个。
 *
 * 两个用法，都要用上：
 *  - 多特征（梅尔谱按说话人归一 + MFCC 每条自归一）
 *  - 多参考说话人（同一条音的不同录音）
 *
 * 单特征单参考的信度只有 0.39–0.66（换个参考音库分数就变），融合后 0.63，
 * 再配 3 个参考音库能到 0.83。分数抖比分数偏更要命，这一步不是可选的。
 */
export function fuseZ(maps) {
  const live = maps.filter((m) => m && m.size > 0);
  if (live.length === 0) return new Map();
  const out = new Map();
  for (const key of live[0].keys()) {
    let s = 0;
    let n = 0;
    for (const m of live) {
      const v = m.get(key);
      if (Number.isFinite(v)) { s += v; n++; }
    }
    out.set(key, n > 0 ? s / n : 0);
  }
  return out;
}

/**
 * z → 0..max 颗星。
 *
 * 阈值是**未标定**的占位值：实测里成人读对的 z 均值约 +1.2，但孩子的整体
 * 会低一截，必须拿本人的录音重新定 lo/hi。别把成人数据定的阈值发给孩子。
 */
export function stars(z, { lo = 0.1, hi = 1.6, max = 10 } = {}) {
  if (!Number.isFinite(z)) return 0;
  const t = (z - lo) / (hi - lo);
  return Math.round(Math.min(1, Math.max(0, t)) * max);
}
