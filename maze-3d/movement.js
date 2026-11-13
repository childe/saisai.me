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

// 实际渲染的墙段 → 矩形（不含开口封口）；相机避障只用这些
export function segmentBoxes(segments) {
  return segments.map(segBox);
}

// wallSegments 的墙段转矩形，再补上入口、出口两处外边界开口（碰撞上外边界全封闭）。
// 封口不渲染，只用于小人碰撞；前 segments.length 个与 segmentBoxes 一一对应
export function wallBoxes(segments, size) {
  const boxes = segmentBoxes(segments);
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

// ---------- 相机几何 ----------
export const TARGET_HEIGHT = 0.4; // 相机 lookAt 的观察点高度
export const CAMERA_MARGIN = 0.12; // 避障包围盒外扩量（大于近裁剪面 + 其半宽）
const DEG = Math.PI / 180;
export const FOLLOW_PITCH = { min: 15 * DEG, max: 75 * DEG, def: 40 * DEG };
export const FIRST_PITCH = { min: -30 * DEG, max: 30 * DEG, def: 0 };
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.5;

// 二维墙矩形 → 外扩后的三维包围盒
export function wallBoxes3d(boxes, height = WALL_HEIGHT, margin = CAMERA_MARGIN) {
  return boxes.map((b) => ({
    minX: b.minX - margin,
    maxX: b.maxX + margin,
    minY: -margin,
    maxY: height + margin,
    minZ: b.minZ - margin,
    maxZ: b.maxZ + margin,
  }));
}

// 跟随视角的理想相机位置：在观察点「后方」（与 yaw 前方相反）、上方
export function followCameraPos(target, yaw, pitch, dist) {
  const h = Math.cos(pitch) * dist;
  return {
    x: target.x - Math.sin(yaw) * h,
    y: target.y + Math.sin(pitch) * dist,
    z: target.z + Math.cos(yaw) * h,
  };
}

// 线段 target → cameraPos 与盒子 slab 求交，返回不被遮挡的距离；target 所在的盒子忽略
export function cameraPullIn(target, cameraPos, boxes3d) {
  const dx = cameraPos.x - target.x;
  const dy = cameraPos.y - target.y;
  const dz = cameraPos.z - target.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return 0;
  const o = [target.x, target.y, target.z];
  const d = [dx, dy, dz];
  let best = 1;
  for (const b of boxes3d) {
    const lo = [b.minX, b.minY, b.minZ];
    const hi = [b.maxX, b.maxY, b.maxZ];
    let tEnter = -Infinity;
    let tExit = Infinity;
    let miss = false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-12) {
        if (o[k] < lo[k] || o[k] > hi[k]) {
          miss = true;
          break;
        }
        continue;
      }
      let t1 = (lo[k] - o[k]) / d[k];
      let t2 = (hi[k] - o[k]) / d[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
    }
    if (miss || tEnter > tExit) continue;
    if (tEnter <= 0) continue; // 观察点在盒子内或盒子在观察点背后
    if (tEnter <= 1 && tEnter < best) best = tEnter;
  }
  return best * len;
}

// 实际距离：比安全距离远就立即收近；否则按 k 插值恢复，且不超过安全距离
export function smoothCameraDistance(dCur, dWant, dSafe, k) {
  if (dCur > dSafe) return dSafe;
  return Math.min(dCur + (dWant - dCur) * k, dSafe);
}

// 相机被墙收得比这还近时，小人会占满画面：改为抬高俯角从墙顶上方看
export const CAMERA_MIN_DIST = 1.5;
const LIFT_STEP = 2.5 * DEG;

// 跟随视角实际使用的俯角：从玩家设定的 pitch 起每次抬高 LIFT_STEP（最多到 FOLLOW_PITCH.max），
// 取第一个安全距离 ≥ min(dist, CAMERA_MIN_DIST) 的俯角；都达不到时取安全距离最大的那个。
// 只决定方向，最终距离仍由 cameraPullIn 在这个方向上求出，所以不会穿墙
export function liftPitch(target, yaw, pitch, dist, boxes3d) {
  const want = Math.min(dist, CAMERA_MIN_DIST) - 1e-9;
  let best = pitch;
  let bestD = -1;
  for (let p = pitch; ; p = Math.min(p + LIFT_STEP, FOLLOW_PITCH.max)) {
    const d = cameraPullIn(target, followCameraPos(target, yaw, p, dist), boxes3d);
    if (d >= want) return p;
    if (d > bestD) {
      bestD = d;
      best = p;
    }
    if (p >= FOLLOW_PITCH.max) return best;
  }
}

// ---------- 输入换算 ----------
export const TURN_SPEED = (2 * Math.PI) / 3; // 弧度/秒（120°/秒）
export const STICK_DEAD_ZONE = 0.1;
export const LOOK_SPEED = 0.005; // 弧度/像素

const KEY_MAP = {
  KeyW: ['forward', 1],
  ArrowUp: ['forward', 1],
  KeyS: ['forward', -1],
  ArrowDown: ['forward', -1],
  KeyD: ['strafe', 1],
  KeyA: ['strafe', -1],
  ArrowRight: ['turn', 1],
  KeyE: ['turn', 1],
  ArrowLeft: ['turn', -1],
  KeyQ: ['turn', -1],
};

// 按键集合（KeyboardEvent.code）→ 输入；相反键抵消，斜向归一化
export function inputFromKeys(keys) {
  const sign = { forward: 0, strafe: 0, turn: 0 };
  const seen = { forward: new Set(), strafe: new Set(), turn: new Set() };
  for (const code of keys) {
    const m = KEY_MAP[code];
    if (m) seen[m[0]].add(m[1]);
  }
  for (const axis of Object.keys(sign)) {
    for (const v of seen[axis]) sign[axis] += v;
  }
  let { forward, strafe } = sign;
  const len = Math.hypot(forward, strafe);
  if (len > 1) {
    forward /= len;
    strafe /= len;
  }
  return { forward, strafe, turn: sign.turn };
}

// 摇杆偏移（屏幕像素，向下为 +dy）→ 输入；屏幕向上 = 前进
export function inputFromStick(dx, dy, radius, deadZone = STICK_DEAD_ZONE) {
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !(radius > 0)) return { forward: 0, strafe: 0 };
  const m = Math.min(len / radius, 1);
  if (m < deadZone) return { forward: 0, strafe: 0 };
  const amp = (m - deadZone) / (1 - deadZone);
  return { forward: (-dy / len) * amp, strafe: (dx / len) * amp };
}

// 原地更新按键集合；返回 code 是否为识别的方向 / 转向键。
// 自动重复的 keydown 不加入集合：按下状态只由首次 keydown 建立，清空后持续按住的键不会被重新激活。
export function applyKeyEvent(keys, e) {
  const known = Object.prototype.hasOwnProperty.call(KEY_MAP, e.code);
  if (e.type === 'keyup') {
    keys.delete(e.code);
  } else if (e.type === 'keydown') {
    if (known && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) keys.add(e.code);
  }
  return known;
}

// ---------- 手势仲裁 ----------
// 每个指针在 down 时分配角色（stick / look / pinch），之后移到另一半边也不改变。
export function createPointerRouter() {
  const pointers = new Map(); // id → { x, y }
  let stickId = null;
  let lookId = null;
  let secondId = null; // 有值时 lookId 与 secondId 处于捏合
  let stick = { active: false, originX: 0, originY: 0, dx: 0, dy: 0 };
  let lookDx = 0;
  let lookDy = 0;
  let zoom = 1;
  let pinchBase = 0;

  const pinchDist = () => {
    const a = pointers.get(lookId);
    const b = pointers.get(secondId);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const clearStick = () => {
    stickId = null;
    stick = { active: false, originX: 0, originY: 0, dx: 0, dy: 0 };
  };

  function down(e) {
    if (pointers.has(e.id)) return false;
    if (e.kind === 'mouse' || e.side !== 'left') {
      if (lookId === null) {
        lookId = e.id;
      } else if (e.kind !== 'mouse' && secondId === null) {
        secondId = e.id;
      } else {
        return false;
      }
      pointers.set(e.id, { x: e.x, y: e.y });
      if (secondId !== null) pinchBase = pinchDist();
      return true;
    }
    if (stickId !== null) return false;
    stickId = e.id;
    pointers.set(e.id, { x: e.x, y: e.y });
    stick = { active: true, originX: e.x, originY: e.y, dx: 0, dy: 0 };
    return true;
  }

  function move(e) {
    const p = pointers.get(e.id);
    if (!p) return;
    const px = p.x;
    const py = p.y;
    p.x = e.x;
    p.y = e.y;
    if (e.id === stickId) {
      stick = { ...stick, dx: e.x - stick.originX, dy: e.y - stick.originY };
    } else if (secondId !== null) {
      const d = pinchDist();
      if (pinchBase > 0 && d > 0) zoom *= pinchBase / d;
      pinchBase = d;
    } else if (e.id === lookId) {
      lookDx += e.x - px;
      lookDy += e.y - py;
    }
  }

  function up(id) {
    if (!pointers.has(id)) return;
    pointers.delete(id);
    if (id === stickId) {
      clearStick();
    } else if (id === lookId) {
      lookId = secondId; // 捏合中抬起一指：剩下那根恢复为视角指针，以当前位置为基准
      secondId = null;
      pinchBase = 0;
    } else if (id === secondId) {
      secondId = null;
      pinchBase = 0;
    }
  }

  function reset() {
    pointers.clear();
    clearStick();
    lookId = null;
    secondId = null;
    lookDx = 0;
    lookDy = 0;
    zoom = 1;
    pinchBase = 0;
  }

  return {
    down,
    move,
    up,
    cancel: up,
    reset,
    consume() {
      const out = { look: { dx: lookDx, dy: lookDy }, zoom };
      lookDx = 0;
      lookDy = 0;
      zoom = 1;
      return out;
    },
    get stick() {
      return { ...stick };
    },
    roles() {
      const out = {};
      for (const id of pointers.keys()) {
        if (id === stickId) out[id] = 'stick';
        else if (secondId !== null && (id === lookId || id === secondId)) out[id] = 'pinch';
        else if (id === lookId) out[id] = 'look';
      }
      return out;
    },
  };
}
