import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MazeGenerator } from '../maze-3d/maze-core.js';
import { findPath, canMove, DIRS } from '../maze-3d/game-logic.js';
import { THEMES, THEME_IDS } from '../maze-3d/themes.js';
import { starCountFor, placeStars, starHit, STAR_COLORS } from '../maze-3d/gameplay.js';

const here = dirname(fileURLToPath(import.meta.url));

const cheb = (a, b) => Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
const manhattan = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const rgbDist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

// 从 (0,0) BFS；终点格入集合但不出队扩展
function bfsNoEnd(connections) {
  const size = connections.length;
  const seen = new Set([0]);
  const queue = [[0, 0]];
  for (let h = 0; h < queue.length; h++) {
    const [r, c] = queue[h];
    if (r === size - 1 && c === size - 1) continue;
    for (const [dr, dc] of Object.values(DIRS)) {
      const nr = r + dr;
      const nc = c + dc;
      if (!canMove(connections, { row: r, col: c }, { row: nr, col: nc })) continue;
      const k = nr * size + nc;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

// 按相邻格列表打通双向连接
function corridor(size, cells) {
  const conn = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push({ up: false, down: false, left: false, right: false });
    conn.push(row);
  }
  for (let i = 1; i < cells.length; i++) {
    const [r0, c0] = cells[i - 1];
    const [r1, c1] = cells[i];
    const a = conn[r0][c0];
    const b = conn[r1][c1];
    if (r1 === r0 + 1) { a.down = true; b.up = true; }
    else if (r1 === r0 - 1) { a.up = true; b.down = true; }
    else if (c1 === c0 + 1) { a.right = true; b.left = true; }
    else { a.left = true; b.right = true; }
  }
  return conn;
}

test('starCountFor', () => {
  assert.equal(starCountFor(10), 3);
  assert.equal(starCountFor(15), 5);
  assert.equal(starCountFor(20), 7);
});

test('placeStars over seeds 1..200 × sizes', () => {
  let good = 0, total = 0;
  for (const size of [10, 15, 20]) {
    for (let seed = 1; seed <= 200; seed++) {
      const conn = new MazeGenerator(size, size, seed).generate().connections;
      const stars = placeStars(conn, seed, starCountFor(size));
      const end = { row: size - 1, col: size - 1 };
      const start = { row: 0, col: 0 };
      assert.equal(stars.length, starCountFor(size));
      assert.equal(new Set(stars.map((s) => s.row * size + s.col)).size, stars.length);
      const reach = bfsNoEnd(conn);
      const main = new Set(findPath(conn, start, end).map(([r, c]) => r * size + c));
      for (const s of stars) {
        assert.ok(cheb(s, start) >= 2 && cheb(s, end) >= 2, `${size}/${seed}`);
        assert.ok(findPath(conn, start, s).length > 0);
        assert.ok(reach.has(s.row * size + s.col));
        const exits = Object.values(DIRS).filter(([dr, dc]) =>
          canMove(conn, s, { row: s.row + dr, col: s.col + dc })).length;
        if (exits === 1 || !main.has(s.row * size + s.col)) good++;
        total++;
      }
      for (let i = 0; i < stars.length; i++)
        for (let j = i + 1; j < stars.length; j++) assert.ok(manhattan(stars[i], stars[j]) >= 2);
      assert.deepEqual(placeStars(conn, seed, starCountFor(size)), stars);
      assert.deepEqual(new MazeGenerator(size, size, seed).generate().connections, conn);
    }
  }
  assert.ok(good / total >= 0.8, `ratio ${good / total}`);
});

test('placeStars relaxes spacing on a single corridor', () => {
  // 6×6 L 形走廊：(0,0)→(0,5)→(5,5)；候选格 (0,2)(0,3)(0,4)(0,5)(1,5)(2,5)(3,5)
  const cells = [];
  for (let c = 0; c <= 5; c++) cells.push([0, c]);
  for (let r = 1; r <= 5; r++) cells.push([r, 5]);
  const stars = placeStars(corridor(6, cells), 7, 3);
  const cand = new Set(['0,2', '0,3', '0,4', '0,5', '1,5', '2,5', '3,5']);
  assert.equal(stars.length, 3);
  for (const s of stars) assert.ok(cand.has(`${s.row},${s.col}`));
});

test('placeStars returns all candidates when there are too few', () => {
  // 4×4：(0,0)→(0,3)→(3,3)；候选只有 (0,2)(0,3)(1,3)
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3]];
  const stars = placeStars(corridor(4, cells), 1, 5);
  assert.deepEqual(stars.map((s) => `${s.row},${s.col}`).sort(), ['0,2', '0,3', '1,3']);
});

test('starHit', () => {
  assert.equal(starHit(2.5 + 0.39, 3.5, { row: 3, col: 2 }), true);
  assert.equal(starHit(2.5 + 0.41, 3.5, { row: 3, col: 2 }), false);
});

test('star face color is distinguishable from path and floors', () => {
  // 从 main.js 的 COLORS 读道路色（与 maze-3d-themes.test.mjs 同样的正则）
  const src = readFileSync(join(here, '..', 'maze-3d', 'main.js'), 'utf8');
  const path = parseInt(src.match(/const COLORS = \{[\s\S]*?path:\s*0x([0-9a-f]{6})/i)[1], 16);
  const d = rgbDist(STAR_COLORS.face, path);
  console.log(`star vs path ${d.toFixed(1)}`);
  assert.ok(d >= 60);
  for (const id of THEME_IDS) {
    const f = rgbDist(STAR_COLORS.face, THEMES[id].floorBase);
    console.log(`star vs ${id} floorBase ${f.toFixed(1)}`);
    assert.ok(f >= 60, id);
  }
});
