/** 动态时间规整。返回按路径长度归一化的平均帧距离。纯函数。 */

export const MAX_FRAMES = 400;

export function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** 等间隔抽样到至多 n 帧，挡住 O(len²) 在长录音上失控。 */
function downsample(frames, n) {
  if (frames.length <= n) return frames;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = frames[Math.floor(i * frames.length / n)];
  }
  return out;
}

export function dtw(a, b, dist = euclidean) {
  if (a.length === 0 || b.length === 0) return Infinity;
  const A = downsample(a, MAX_FRAMES);
  const B = downsample(b, MAX_FRAMES);
  const n = A.length;
  const m = B.length;

  // cost 累计距离，steps 累计路径长度，用于归一化
  let cost = new Float64Array(m + 1).fill(Infinity);
  let steps = new Float64Array(m + 1);
  let nextCost = new Float64Array(m + 1);
  let nextSteps = new Float64Array(m + 1);
  cost[0] = 0;

  for (let i = 1; i <= n; i++) {
    nextCost.fill(Infinity);
    nextSteps.fill(0);
    for (let j = 1; j <= m; j++) {
      // 三个前驱里选累计代价最小的
      let bc = cost[j];                 // 上 D(i-1,j)
      let bs = steps[j];
      if (cost[j - 1] < bc) {           // 斜 D(i-1,j-1)
        bc = cost[j - 1];
        bs = steps[j - 1];
      }
      if (nextCost[j - 1] < bc) {       // 左 D(i,j-1)
        bc = nextCost[j - 1];
        bs = nextSteps[j - 1];
      }
      nextCost[j] = bc + dist(A[i - 1], B[j - 1]);
      nextSteps[j] = bs + 1;
    }
    [cost, nextCost] = [nextCost, cost];
    [steps, nextSteps] = [nextSteps, steps];
  }

  return steps[m] > 0 ? cost[m] / steps[m] : Infinity;
}
