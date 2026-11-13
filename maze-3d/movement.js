// 3D 迷宫的连续移动、相机几何与输入换算：纯逻辑，不依赖 three.js 和 DOM，可以直接用 node --test 测试。
//
// 坐标：1 格 = 1 世界单位；格 (row, col) 占 x ∈ [col, col+1]、z ∈ [row, row+1]。
// 角度约定：yaw 单位弧度，水平前方向量 = (sin yaw, −cos yaw)（x, z）。
//   yaw = 0 朝北（−z），yaw = π/2 朝东（+x）；右转时 yaw 增大。右方向量 = (cos yaw, sin yaw)。
//   three.js 中 rotation.y = −yaw。
// pitch 单位弧度，正值 = 往下看（跟随视角就是俯角）。

// ---------- 尺寸常量（渲染与碰撞共用） ----------
export const PLAYER_RADIUS = 0.28;
export const WALL_THICKNESS = 0.1;
export const WALL_LENGTH = 1.1;
export const WALL_HEIGHT = 0.8;

// ---------- 运动参数 ----------
export const MAX_SPEED = 2.2; // 格/秒
export const ACCEL = 2.2 / 0.15; // 0 → 满速 0.15 秒
export const DECEL = 2.2 / 0.1; // 满速 → 停 0.1 秒
export const MAX_SUBSTEP = 0.1;

// 小人模型的球体（未缩放）：身体、两只眼睛、两个瞳孔
export const PLAYER_PARTS = [
  { x: 0, y: 0.3, z: 0, r: 0.3 },
  { x: -0.11, y: 0.4, z: -0.25, r: 0.08 },
  { x: 0.11, y: 0.4, z: -0.25, r: 0.08 },
  { x: -0.11, y: 0.4, z: -0.32, r: 0.04 },
  { x: 0.11, y: 0.4, z: -0.32, r: 0.04 },
];

// 整体缩放系数：让模型的水平最大外伸恰好等于碰撞半径
export function playerModelScale(parts = PLAYER_PARTS, radius = PLAYER_RADIUS) {
  let reach = 0;
  for (const p of parts) reach = Math.max(reach, Math.hypot(p.x, p.z) + p.r);
  return radius / reach;
}

// ---------- 墙矩形 ----------
function segBox(seg) {
  const hl = WALL_LENGTH / 2;
  const ht = WALL_THICKNESS / 2;
  const hx = seg.along === 'x' ? hl : ht;
  const hz = seg.along === 'x' ? ht : hl;
  return { minX: seg.x - hx, maxX: seg.x + hx, minZ: seg.z - hz, maxZ: seg.z + hz };
}

// wallSegments 的墙段转矩形，再补上入口、出口两处外边界开口（碰撞上外边界全封闭）
export function wallBoxes(segments, size) {
  const boxes = segments.map(segBox);
  const gaps = [
    { x: 0.5, z: 0, along: 'x' },
    { x: 0, z: 0.5, along: 'z' },
    { x: size - 0.5, z: size, along: 'x' },
    { x: size, z: size - 0.5, along: 'z' },
  ];
  for (const g of gaps) boxes.push(segBox(g));
  return boxes;
}

export function cellOf(pos) {
  return { row: Math.floor(pos.z), col: Math.floor(pos.x) };
}

// 按格索引矩形：每个矩形外扩 PLAYER_RADIUS 后登记到覆盖的格子；near 取所在格（行列钳到界内）的列表
export function createBoxGrid(boxes, size) {
  const n = Math.max(1, size);
  const clamp = (v) => Math.min(n - 1, Math.max(0, v));
  const cells = Array.from({ length: n * n }, () => []);
  const r = PLAYER_RADIUS;
  for (const b of boxes) {
    const c0 = clamp(Math.floor(b.minX - r));
    const c1 = clamp(Math.floor(b.maxX + r));
    const r0 = clamp(Math.floor(b.minZ - r));
    const r1 = clamp(Math.floor(b.maxZ + r));
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) cells[row * n + col].push(b);
  }
  return {
    boxes,
    size,
    near(x, z) {
      return cells[clamp(Math.floor(z)) * n + clamp(Math.floor(x))];
    },
  };
}

// 把圆推出所有重叠的矩形；最多迭代 8 次
export function collideCircle(pos, radius, boxes) {
  let x = pos.x;
  let z = pos.z;
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const b of boxes) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 0) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        x += (dx / d) * push;
        z += (dz / d) * push;
      } else {
        // 圆心在矩形内：沿最小穿透轴推出
        const left = x - b.minX;
        const right = b.maxX - x;
        const top = z - b.minZ;
        const bottom = b.maxZ - z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x = b.minX - radius;
        else if (m === right) x = b.maxX + radius;
        else if (m === top) z = b.minZ - radius;
        else z = b.maxZ + radius;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

// 一帧移动：加减速 → 子步位移 → 每个子步做碰撞。纯函数。
export function stepPlayer(state, input, yaw, dt, grid) {
  if (!(dt > 0)) return { x: state.x, z: state.z, vx: state.vx, vz: state.vz };
  let f = input.forward || 0;
  let s = input.strafe || 0;
  const m = Math.hypot(f, s);
  if (m > 1) {
    f /= m;
    s /= m;
  }
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const tvx = (f * sin + s * cos) * MAX_SPEED;
  const tvz = (-f * cos + s * sin) * MAX_SPEED;
  const rate = tvx !== 0 || tvz !== 0 ? ACCEL : DECEL;
  const dvx = tvx - state.vx;
  const dvz = tvz - state.vz;
  const dl = Math.hypot(dvx, dvz);
  const maxDv = rate * dt;
  let vx;
  let vz;
  if (dl <= maxDv) {
    vx = tvx;
    vz = tvz;
  } else {
    vx = state.vx + (dvx / dl) * maxDv;
    vz = state.vz + (dvz / dl) * maxDv;
  }
  const mx = vx * dt;
  const mz = vz * dt;
  const n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / MAX_SUBSTEP));
  let pos = { x: state.x, z: state.z };
  if (mx !== 0 || mz !== 0) {
    for (let i = 0; i < n; i++) {
      pos = { x: pos.x + mx / n, z: pos.z + mz / n };
      pos = collideCircle(pos, PLAYER_RADIUS, grid.near(pos.x, pos.z));
    }
  }
  return { x: pos.x, z: pos.z, vx: (pos.x - state.x) / dt, vz: (pos.z - state.z) / dt };
}
