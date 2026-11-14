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
