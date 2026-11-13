// 3D 迷宫的画面效果：开局朝向、遮挡判断、终点方向提示、阴影 / 暗边 / 光柱 / 彩带的数据步进。
// 纯逻辑，不依赖 three.js 和 DOM，可以直接用 node --test 测试。角度与坐标约定见 movement.js。
import { slabInterval } from './movement.js';

// ---------- 开局朝向 ----------
// 从起点格中心 (0.5, 0.5) 指向迷宫中心 (size/2, size/2) 的 yaw
export function startYaw(size) {
  const dx = size / 2 - 0.5;
  const dz = size / 2 - 0.5;
  return Math.atan2(dx, -dz);
}

// ---------- 跟随视角镜头前瞻 ----------
// 观察点 = 小人前方 LOOK_AHEAD 格（格），让画面中心落在小人要去的方向
export const LOOK_AHEAD = 1.5;

// 沿 yaw 前方 (sin yaw, −cos yaw) 偏移 dist，不改入参
export function lookAheadTarget(playerPos, yaw, dist) {
  return { x: playerPos.x + Math.sin(yaw) * dist, z: playerPos.z - Math.cos(yaw) * dist };
}

// ---------- 遮挡判断 ----------
// 线段 a→b（t ∈ [0, 1]）与任一盒子的 [tEnter, tExit] 有重叠即为被挡；a == b 返回 false
export function segmentBlocked(a, b, boxes) {
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  if (Math.hypot(d[0], d[1], d[2]) === 0) return false;
  const o = [a.x, a.y, a.z];
  for (const box of boxes) {
    const hit = slabInterval(o, d, box);
    if (hit && hit[0] <= 1 && hit[1] >= 0) return true;
  }
  return false;
}
