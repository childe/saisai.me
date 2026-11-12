// 3D 迷宫的纯逻辑：不碰 DOM，也不依赖 three.js，可以直接用 node --test 测试。
// 位置对象统一为 { row, col }；方向名为 'up' | 'down' | 'left' | 'right'（北 / 南 / 西 / 东）。

export const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const LEFT_OF = { up: 'left', left: 'down', down: 'right', right: 'up' };
const RIGHT_OF = { up: 'right', right: 'down', down: 'left', left: 'up' };

// 相邻、在界内、两侧都连通才能走
export function canMove(connections, from, to) {
  const size = connections.length;
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
  if (from.row < 0 || from.row >= size || from.col < 0 || from.col >= size) return false;
  if (to.row < 0 || to.row >= size || to.col < 0 || to.col >= size) return false;
  const a = connections[from.row][from.col];
  const b = connections[to.row][to.col];
  if (dr === -1) return Boolean(a.up && b.down);
  if (dr === 1) return Boolean(a.down && b.up);
  if (dc === -1) return Boolean(a.left && b.right);
  return Boolean(a.right && b.left);
}

export function isIntersection(connections, pos) {
  const size = connections.length;
  const { row, col } = pos;
  if ((row === 0 && col === 0) || (row === size - 1 && col === size - 1)) return true;
  let available = 0;
  for (const [dr, dc] of Object.values(DIRS)) {
    if (canMove(connections, pos, { row: row + dr, col: col + dc })) available++;
  }
  return available !== 2;
}

// 沿 dir 一直走到路口（或走不动），位置不变返回 null
export function findNextIntersection(connections, pos, dir) {
  if (!DIRS[dir]) return null;
  const [dr, dc] = DIRS[dir];
  let cur = { row: pos.row, col: pos.col };
  if (!canMove(connections, cur, { row: cur.row + dr, col: cur.col + dc })) return null;
  while (true) {
    const next = { row: cur.row + dr, col: cur.col + dc };
    if (!canMove(connections, cur, next)) break;
    cur = next;
    if (isIntersection(connections, cur)) break;
  }
  if (cur.row === pos.row && cur.col === pos.col) return null;
  return cur;
}

// BFS；返回 Array<[row, col]>，首格 = start，末格 = end；不可达返回 []
export function findPath(connections, start, end) {
  const size = connections.length;
  const key = (r, c) => r * size + c;
  const prev = new Map();
  const startKey = key(start.row, start.col);
  prev.set(startKey, -1);
  const queue = [[start.row, start.col]];
  let found = start.row === end.row && start.col === end.col;
  for (let head = 0; head < queue.length && !found; head++) {
    const [r, c] = queue[head];
    for (const [dr, dc] of Object.values(DIRS)) {
      const nr = r + dr;
      const nc = c + dc;
      if (!canMove(connections, { row: r, col: c }, { row: nr, col: nc })) continue;
      const k = key(nr, nc);
      if (prev.has(k)) continue;
      prev.set(k, key(r, c));
      queue.push([nr, nc]);
      if (nr === end.row && nc === end.col) {
        found = true;
        break;
      }
    }
  }
  if (!found) return [];
  const path = [];
  for (let k = key(end.row, end.col); k !== -1; k = prev.get(k)) {
    path.push([Math.floor(k / size), k % size]);
  }
  return path.reverse();
}

// 与 2D getSeed() 相同：数字直接用，否则取字符串哈希。
// 生成器只对正的有限数可复现（负数会越界取下标，0 会被换成 Date.now()，Infinity 变 NaN），
// 这类值返回 null，由调用方当作没有 seed 处理。
export function parseSeed(str) {
  if (str === null || str === undefined || str === '') return null;
  const numeric = parseInt(str, 10);
  const seed = isNaN(numeric) ? hashSeed(str) : numeric;
  return Number.isFinite(seed) && seed > 0 ? seed : null;
}

function hashSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function parseSize(str) {
  const n = Number(str);
  return n === 10 || n === 15 || n === 20 ? n : 10;
}

export function turn(facing, how) {
  if (how === 'left') return LEFT_OF[facing];
  if (how === 'right') return RIGHT_OF[facing];
  return OPPOSITE[facing];
}

export function resolveInput(view, facing, key) {
  if (view !== 'first') return { type: 'move', dir: key };
  if (key === 'up') return { type: 'move', dir: facing };
  if (key === 'down') return { type: 'turn', facing: turn(facing, 'back') };
  return { type: 'turn', facing: turn(facing, key) };
}

// 绕 y 轴弧度；模型与相机默认朝 −z（北）
export function facingYaw(facing) {
  switch (facing) {
    case 'left':
      return Math.PI / 2;
    case 'down':
      return Math.PI;
    case 'right':
      return -Math.PI / 2;
    default:
      return 0;
  }
}

export function isInFogView(center, cell, radius) {
  return Math.max(Math.abs(center.row - cell.row), Math.abs(center.col - cell.col)) <= radius;
}

export function clampRadius(value) {
  if (value === null || value === undefined) return 5;
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(25, Math.max(1, Math.round(n)));
}

export function followOffset(radius) {
  const r = Math.min(radius, 10);
  return { h: 3 + 0.8 * r, d: 2 + 0.6 * r };
}

// 墙段：along 'x' 沿 x 延伸（分隔南北），'z' 沿 z 延伸（分隔东西）；cells 是紧邻的迷宫内格子
export function wallSegments(connections) {
  const size = connections.length;
  const segs = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (r + 1 < size && !canMove(connections, { row: r, col: c }, { row: r + 1, col: c })) {
        segs.push({ x: c + 0.5, z: r + 1, along: 'x', cells: [[r, c], [r + 1, c]] });
      }
      if (c + 1 < size && !canMove(connections, { row: r, col: c }, { row: r, col: c + 1 })) {
        segs.push({ x: c + 1, z: r + 0.5, along: 'z', cells: [[r, c], [r, c + 1]] });
      }
    }
  }
  for (let c = 0; c < size; c++) {
    if (c !== 0) segs.push({ x: c + 0.5, z: 0, along: 'x', cells: [[0, c]] });
    if (c !== size - 1) segs.push({ x: c + 0.5, z: size, along: 'x', cells: [[size - 1, c]] });
  }
  for (let r = 0; r < size; r++) {
    if (r !== 0) segs.push({ x: 0, z: r + 0.5, along: 'z', cells: [[r, 0]] });
    if (r !== size - 1) segs.push({ x: size, z: r + 0.5, along: 'z', cells: [[r, size - 1]] });
  }
  return segs;
}

export function wallInView(seg, center, radius) {
  return seg.cells.some(([row, col]) => isInFogView(center, { row, col }, radius));
}

export function floorKind(cell, size, { inView, onPath }) {
  if (onPath) return 'path';
  if (!inView) return 'fog';
  if (cell.row === 0 && cell.col === 0) return 'start';
  if (cell.row === size - 1 && cell.col === size - 1) return 'end';
  return 'floor';
}

// ---------- 帧统计 ----------
export function summarizeFrames(deltas) {
  const n = deltas.length;
  if (n === 0) return { count: 0, avg: 0, p95: 0 };
  const sum = deltas.reduce((a, b) => a + b, 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  return { count: n, avg: sum / n, p95: sorted[Math.ceil(0.95 * n) - 1] };
}

const MAX_DELTAS = 600;
const WINDOW_MS = 2000;

// tick(t) 记录与上一次的间隔；reset() 之后的第一次 tick 不产生间隔（切回前台的长间隔不计入）
export function createFrameMeter() {
  let last = null;
  let all = [];
  let win = [];
  let winSum = 0;
  return {
    tick(t) {
      if (last !== null) {
        const d = t - last;
        all.push(d);
        if (all.length > MAX_DELTAS) all = all.slice(all.length - MAX_DELTAS);
        win.push(d);
        winSum += d;
        while (win.length > 1 && winSum - win[0] >= WINDOW_MS) {
          winSum -= win.shift();
        }
      }
      last = t;
    },
    reset() {
      last = null;
    },
    deltas() {
      return [...all];
    },
    window() {
      return [...win];
    },
  };
}

// 最近约 2 秒的平均帧时间超过 33ms 时降画质
export function shouldDowngrade(windowDeltas) {
  const n = windowDeltas.length;
  if (n === 0) return false;
  const sum = windowDeltas.reduce((a, b) => a + b, 0);
  return sum >= WINDOW_MS && sum / n > 33;
}
