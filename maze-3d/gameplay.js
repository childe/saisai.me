// 3D 迷宫玩法的纯逻辑：星星摆放、已探索格子、脚印、计时、最佳成绩、脚步与撞墙判定。
// 纯逻辑，不碰 DOM，不依赖 three.js，可以直接用 node --test 测试。
import { DIRS, canMove, findPath } from './game-logic.js';

// ---------- 星星 ----------
export const STAR_COUNTS = { 10: 3, 15: 5, 20: 7 };

export function starCountFor(size) {
  return STAR_COUNTS[size] ?? STAR_COUNTS[10];
}

export function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// seed 的低 32 位与高 32 位混合成 mulberry32 的种子（与迷宫生成器的随机数互不影响）
function mixSeed(seed) {
  const lo = (seed % 2 ** 32) >>> 0;
  const hi = Math.floor(seed / 2 ** 32) >>> 0;
  return (lo ^ Math.imul(hi, 0x9e3779b1) ^ 0x2545f491) >>> 0;
}

// 从起点 BFS，终点格入集合但不向外扩展（经过终点才能到的格子在通关前拿不到）
function reachableNoEnd(connections) {
  const size = connections.length;
  const seen = new Uint8Array(size * size);
  seen[0] = 1;
  const queue = [[0, 0]];
  for (let h = 0; h < queue.length; h++) {
    const [r, c] = queue[h];
    if (r === size - 1 && c === size - 1) continue;
    for (const [dr, dc] of Object.values(DIRS)) {
      const nr = r + dr;
      const nc = c + dc;
      if (!canMove(connections, { row: r, col: c }, { row: nr, col: nc })) continue;
      const k = nr * size + nc;
      if (seen[k]) continue;
      seen[k] = 1;
      queue.push([nr, nc]);
    }
  }
  return seen;
}

export function placeStars(connections, seed, count) {
  const size = connections.length;
  const reach = reachableNoEnd(connections);
  const start = { row: 0, col: 0 };
  const end = { row: size - 1, col: size - 1 };
  const onMain = new Set(findPath(connections, start, end).map(([r, c]) => r * size + c));
  const rng = mulberry32(mixSeed(seed));
  const cands = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reach[r * size + c]) continue;
      if (Math.max(r, c) <= 1) continue;
      if (Math.max(Math.abs(r - end.row), Math.abs(c - end.col)) <= 1) continue;
      const cell = { row: r, col: c };
      let exits = 0;
      for (const [dr, dc] of Object.values(DIRS)) {
        if (canMove(connections, cell, { row: r + dr, col: c + dc })) exits++;
      }
      let weight = 0;
      if (exits === 1) weight += 2;
      if (!onMain.has(r * size + c)) weight += 1;
      cands.push({ row: r, col: c, weight, rand: rng() });
    }
  }
  cands.sort((a, b) => b.weight - a.weight || a.rand - b.rand);
  let picked = [];
  for (let D = Math.max(1, Math.floor(size / 3)); D >= 1; D--) {
    picked = [];
    for (const cand of cands) {
      if (picked.length >= count) break;
      if (picked.every((p) => Math.abs(p.row - cand.row) + Math.abs(p.col - cand.col) >= D)) {
        picked.push(cand);
      }
    }
    if (picked.length >= count) break;
  }
  return picked.map((p) => ({ row: p.row, col: p.col }));
}

export const STAR_PICK_RADIUS = 0.4;

export function starHit(px, pz, star) {
  return Math.hypot(px - star.col - 0.5, pz - star.row - 0.5) < STAR_PICK_RADIUS;
}

export const STAR_COLORS = { face: 0xffb300, emissive: 0x553300, side: 0x8d5a00 };
export const STAR_SHAPE = { outer: 0.16, inner: 0.07, depth: 0.05 };
export const STAR_FLOAT = { base: 0.35, amp: 0.05, period: 2, spin: 2 };

// ---------- 小地图：已探索格子与脚印 ----------
// 迷雾开时标以 center 为中心、半径 radius 的正方形（夹到迷宫内）；迷雾关时全部。返回本次新置 1 的格数
export function markExplored(explored, size, center, radius, fogOn) {
  let added = 0;
  if (!fogOn) {
    for (let i = 0; i < size * size; i++) {
      if (!explored[i]) {
        explored[i] = 1;
        added++;
      }
    }
    return added;
  }
  const r0 = Math.max(0, center.row - radius);
  const r1 = Math.min(size - 1, center.row + radius);
  const c0 = Math.max(0, center.col - radius);
  const c1 = Math.min(size - 1, center.col + radius);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * size + c;
      if (!explored[i]) {
        explored[i] = 1;
        added++;
      }
    }
  }
  return added;
}

// 原地：与末尾相同不变；已存在则移到末尾；否则追加。长度不超过格子数
export function pushFootprint(trail, index) {
  const n = trail.length;
  if (n > 0 && trail[n - 1] === index) return trail;
  const at = trail.indexOf(index);
  if (at >= 0) trail.splice(at, 1);
  trail.push(index);
  return trail;
}

export const FOOTPRINT_ALPHA = [0.35, 0.9];

// 第 i 个（0 = 最旧）脚印的不透明度
export function footprintAlpha(i, n) {
  const [lo, hi] = FOOTPRINT_ALPHA;
  if (n <= 1) return hi;
  return lo + ((hi - lo) * i) / (n - 1);
}

export const MINI_COLORS = {
  floor: '#f2efe6',
  seen: '#d9d3c4',
  fog: '#5b6270',
  end: '#e53935',
  wall: '#7e57c2',
  foot: '#8d6e63',
  star: '#ffb300',
  starEdge: '#8d5a00',
};

// ---------- 计时与最佳成绩 ----------
const MAX_TENTHS = 99 * 600 + 599; // 99:59.9

// 'mm:ss.t'，向下取整到十分之一秒，夹到 99:59.9
export function formatTime(ms) {
  const t = Math.min(MAX_TENTHS, Math.floor(Math.max(0, ms) / 100));
  const mm = Math.floor(t / 600);
  const ss = Math.floor((t % 600) / 10);
  const d = t % 10;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${d}`;
}

// 正整数毫秒字符串才算有记录
export function parseBest(str) {
  if (typeof str !== 'string' || !/^[1-9]\d*$/.test(str)) return null;
  return Number(str);
}

export function updateBest(prevStr, timeMs, eligible) {
  const t = Math.round(timeMs);
  const prev = parseBest(prevStr);
  if (!eligible) return { best: prev, isNew: false, write: null };
  if (prev === null || t < prev) return { best: t, isNew: true, write: String(t) };
  return { best: prev, isNew: false, write: null };
}

export function createGameTimer() {
  let started = false;
  let running = false;
  let elapsedMs = 0;
  return {
    start() {
      if (started) return;
      started = true;
      running = true;
    },
    tick(dt) {
      if (running) elapsedMs += dt * 1000;
    },
    stop() {
      running = false;
    },
    reset() {
      started = false;
      running = false;
      elapsedMs = 0;
    },
    get started() {
      return started;
    },
    get running() {
      return running;
    },
    get elapsedMs() {
      return elapsedMs;
    },
  };
}

// ---------- 脚步与撞墙 ----------
// add(dist) 返回本次触发的脚步数；余量留到下一次
export function createStepCounter(stride = 0.5) {
  let acc = 0;
  return {
    add(dist) {
      acc += dist;
      const n = Math.floor(acc / stride + 1e-9);
      acc -= n * stride;
      return n;
    },
    reset() {
      acc = 0;
    },
  };
}

// 「在推」且「走不动」（实际位移 < ratio × 期望位移）持续 hold 秒触发一次；
// 触发后要松开或走得动才重新武装，两次触发至少隔 cooldown 秒
export function createBumpDetector({ hold = 0.15, cooldown = 0.6, ratio = 0.5 } = {}) {
  let held = 0;
  let armed = true;
  let since = Infinity;
  return {
    update(pushing, moved, wanted, dt) {
      since += dt;
      const free = moved >= ratio * wanted;
      const stuck = pushing && !free;
      if (!armed && (!pushing || free)) {
        armed = true;
        held = 0;
      }
      held = stuck ? held + dt : 0;
      if (armed && held + 1e-9 >= hold && since + 1e-9 >= cooldown) {
        armed = false;
        since = 0;
        held = 0;
        return true;
      }
      return false;
    },
    reset() {
      held = 0;
      armed = true;
      since = Infinity;
    },
  };
}
