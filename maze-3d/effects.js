// 3D 迷宫的画面效果：开局朝向、遮挡判断、终点方向提示、阴影 / 暗边 / 光柱 / 彩带的数据步进。
// 纯逻辑，不依赖 three.js 和 DOM，可以直接用 node --test 测试。角度与坐标约定见 movement.js。
import {
  slabInterval,
  PLAYER_RADIUS,
  WALL_THICKNESS,
  TARGET_HEIGHT,
  followCameraPos,
  cameraPullIn,
  liftPitch,
} from './movement.js';

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

// 前瞻距离的候选，从大到小；最后的 0 就是不前瞻（观察点 = 小人），此时 cameraPullIn 保证看得见小人
export const LOOK_AHEAD_STEPS = [LOOK_AHEAD, 1, 0.5, 0];
// 判断「看得见小人」时检查的高度：身体中心、观察点高度（接近头顶）
export const PLAYER_SIGHT_HEIGHTS = [0.2, TARGET_HEIGHT];

// 跟随视角在观察点 target2d（{x, z}）上的稳态相机位置，与 main.js placeFollow 同一算法：
// liftPitch 定俯角 → followCameraPos → cameraPullIn 收近
export function followCameraFor(target2d, yaw, pitch, dist, boxes3d) {
  const target = { x: target2d.x, y: TARGET_HEIGHT, z: target2d.z };
  const p = liftPitch(target, yaw, pitch, dist, boxes3d);
  const ideal = followCameraPos(target, yaw, p, dist);
  const len = Math.hypot(ideal.x - target.x, ideal.y - target.y, ideal.z - target.z);
  const k = len > 0 ? cameraPullIn(target, ideal, boxes3d) / len : 0;
  return {
    x: target.x + (ideal.x - target.x) * k,
    y: target.y + (ideal.y - target.y) * k,
    z: target.z + (ideal.z - target.z) * k,
  };
}

// 实际使用的前瞻距离：LOOK_AHEAD_STEPS 中第一个「相机到小人各检查高度的连线都不被 sightBoxes 挡住」的值。
// boxes3d 是相机避障用的外扩盒子，sightBoxes 是看得见的墙（不外扩）
export function followLookAhead(player, yaw, pitch, dist, boxes3d, sightBoxes) {
  for (const ahead of LOOK_AHEAD_STEPS) {
    if (ahead === 0) return 0;
    const cam = followCameraFor(lookAheadTarget(player, yaw, ahead), yaw, pitch, dist, boxes3d);
    const seen = PLAYER_SIGHT_HEIGHTS.every(
      (y) => !segmentBlocked(cam, { x: player.x, y, z: player.z }, sightBoxes),
    );
    if (seen) return ahead;
  }
  return 0;
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

// 点 pt 落在矩形 rect 外扩 pad 的范围内时，沿较短的方向（向下或向左）移出去，否则原样返回。
// 用于让右上角的边框箭头避开小地图：右边框上的箭头向下移、上边框上的向左移，仍留在边框上
export function avoidRect(pt, rect, pad) {
  if (!rect) return { x: pt.x, y: pt.y };
  const inside =
    pt.x > rect.left - pad && pt.x < rect.right + pad && pt.y > rect.top - pad && pt.y < rect.bottom + pad;
  if (!inside) return { x: pt.x, y: pt.y };
  const down = rect.bottom + pad - pt.y;
  const left = pt.x - (rect.left - pad);
  return down <= left ? { x: pt.x, y: rect.bottom + pad } : { x: rect.left - pad, y: pt.y };
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

// ---------- 墙脚暗边 ----------
export const FOOT_STRIP_WIDTH = 0.18;

// 每段墙两侧地板上各一条暗边（外边界墙只朝内一条）。(nx, nz) 是从墙指向该侧地板的单位法向，
// 条带中心 = 墙中心 + n × (墙厚/2 + 条宽/2)，rotY = atan2(nx, nz)；seg 是墙段下标
export function wallFootStrips(segments) {
  const off = WALL_THICKNESS / 2 + FOOT_STRIP_WIDTH / 2;
  const out = [];
  segments.forEach((s, i) => {
    const normals = s.along === 'x' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (const [nx, nz] of normals) {
      if (s.cells.length === 1) {
        const [row, col] = s.cells[0];
        if ((col + 0.5 - s.x) * nx + (row + 0.5 - s.z) * nz <= 0) continue;
      }
      out.push({ seg: i, x: s.x + nx * off, z: s.z + nz * off, nx, nz, rotY: Math.atan2(nx, nz) });
    }
  });
  return out;
}

// ---------- 终点光柱与闪光粒子 ----------
export const BEAM_RADIUS = 0.35;
export const BEAM_HEIGHT = 6;
export const SPARK_COUNT = 20;

// 光柱透明度倍率随时间（秒）正弦脉动，取值 [0.7, 1.0]
export function beamPulse(t) {
  return 0.85 + 0.15 * Math.sin(2 * t);
}

// ---------- 通关彩带 ----------
export const CONFETTI_COUNT = 120;
export const CONFETTI_HOLD = 2.5; // 秒：满不透明度播放时长
export const CONFETTI_FADE = 0.5; // 秒：之后淡出时长
const CONFETTI_COLORS = ['#e53935', '#ffd740', '#4caf50', '#29b6f6', '#ab47bc', '#ff9800'];

// 在画面上方 [−height/2, 0] 生成 n 片彩带，坐标为画布像素；速度、重力都按画面高度缩放
export function createConfetti(n, width, height, rand = Math.random) {
  const pieces = [];
  for (let i = 0; i < n; i++) {
    pieces.push({
      x: rand() * width,
      y: -rand() * height * 0.5,
      vx: (rand() - 0.5) * height * 0.15,
      vy: height * (0.1 + rand() * 0.15),
      rot: rand() * Math.PI * 2,
      vr: (rand() - 0.5) * 12,
      w: height * (0.012 + rand() * 0.01),
      h: height * (0.02 + rand() * 0.015),
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)],
    });
  }
  return { t: 0, pieces };
}

// 前进 dt 秒，返回新状态（不改入参）。alpha：HOLD 内为 1，之后 FADE 内线性降到 0；
// done：alpha 为 0，或所有片都落到画面底部以下
export function confettiStep(state, dt, height) {
  const t = state.t + dt;
  const gravity = height * 0.15;
  const maxVy = height * 0.45;
  const pieces = state.pieces.map((p) => {
    const vy = Math.min(maxVy, p.vy + gravity * dt);
    const rot = p.rot + p.vr * dt;
    return {
      ...p,
      vy,
      rot,
      x: p.x + (p.vx + Math.sin(rot) * height * 0.04) * dt,
      y: p.y + vy * dt,
    };
  });
  const alpha = t <= CONFETTI_HOLD ? 1 : Math.max(0, 1 - (t - CONFETTI_HOLD) / CONFETTI_FADE);
  const done = alpha === 0 || pieces.every((p) => p.y > height + 20);
  return { t, pieces, alpha, done };
}
