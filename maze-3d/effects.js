// 3D 迷宫的画面效果：开局朝向、遮挡判断、终点方向提示、阴影 / 暗边 / 光柱 / 彩带的数据步进。
// 纯逻辑，不依赖 three.js 和 DOM，可以直接用 node --test 测试。角度与坐标约定见 movement.js。
import { slabInterval, PLAYER_RADIUS } from './movement.js';

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

// ---------- 终点方向提示 ----------
export const HINT_INSET = 28; // 箭头所在边框相对 #stage 的内缩，CSS 像素
export const BEAM_SAMPLE_HEIGHTS = [0.4, 1.5, 3, 5]; // 光柱采样点：终点格中心上方的高度

// 终点在相机空间的坐标 cam → 内缩边框上的箭头位置（相对画面左上角的 CSS 像素）与角度。
// 不做透视除法：方向取 (cx, −cy)，相机背后也给出正确的左右上下，跨越相机平面时连续
export function edgeArrow(cam, viewW, viewH, inset) {
  let dx = cam.x;
  let dy = 0 - cam.y; // 不写 -cam.y：cam.y = 0 时得到 −0，atan2 会给出 −π
  const len = Math.hypot(dx, dy);
  if (!(len >= 1e-6)) {
    dx = 0;
    dy = 1;
  } else {
    dx /= len;
    dy /= len;
  }
  const halfW = Math.max(0, viewW / 2 - inset);
  const halfH = Math.max(0, viewH / 2 - inset);
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: viewW / 2 + dx * t, y: viewH / 2 + dy * t, angle: Math.atan2(dy, dx) };
}

// 各采样点 {inView, occluded} → 'hidden'（有点看得见）| 'marker'（画面内的点全被挡）| 'edge'（都不在画面内）
export function endHintMode(samples) {
  if (samples.some((s) => s.inView && !s.occluded)) return 'hidden';
  if (samples.some((s) => s.inView)) return 'marker';
  return 'edge';
}

// ---------- 小人脚下的圆形软阴影 ----------
export const SHADOW_RADIUS = 1.2 * PLAYER_RADIUS;

// 小人离地 lift（世界单位，钳到 [0, 0.1]）时阴影的缩放与材质不透明度倍率：跳得越高越小越淡
export function shadowLook(lift) {
  const l = Math.min(0.1, Math.max(0, lift));
  return { scale: 1 - 3 * l, opacity: 1 - 5 * l };
}
