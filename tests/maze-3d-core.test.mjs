import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { MazeGenerator } from '../maze-3d/maze-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'maze-gen', 'maze.html'), 'utf8');

// 从 marker 所在位置起，按花括号配对截取到匹配的 `}`
export function extractBlock(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${JSON.stringify(marker)}`);
  const open = src.indexOf('{', start + marker.trimEnd().length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced block: ${marker}`);
}

export function load2D() {
  const src =
    extractBlock(html, 'class SeededRandom {') +
    '\n' +
    extractBlock(html, 'class MazeGenerator {') +
    ';({SeededRandom, MazeGenerator})';
  return vm.runInContext(src, vm.createContext({ console: { log() {} } }));
}

const TwoD = load2D();

const SEEDS = [1, 42, 12345, 987654321, 1700000000000];
test('maze-core generator equals 2D generator', () => {
  for (const seed of SEEDS)
    for (const size of [10, 15, 20]) {
      const a = new TwoD.MazeGenerator(size, size, seed).generate();
      const b = new MazeGenerator(size, size, seed).generate();
      assert.deepEqual(
        JSON.parse(JSON.stringify(b)),
        JSON.parse(JSON.stringify(a)),
        `seed=${seed} size=${size}`,
      );
    }
});

test('extractBlock finds both classes', () => {
  assert.match(extractBlock(html, 'class MazeGenerator {'), /generate\(\)/);
  assert.ok(extractBlock(html, 'class MazeGenerator {').trim().endsWith('}'));
  assert.match(extractBlock(html, 'class SeededRandom {'), /shuffle\(/);
});

// ---------- Task 2: 移动与寻路纯函数 ----------
import * as L from '../maze-3d/game-logic.js';

const CAN_MOVE_MARK = '\n        function canMove(fromRow';
const NEXT_MARK = '\n        function findNextIntersection(';
const ISX_MARK = '\n        function isIntersection(';
const GETSEED_MARK = '\n        function getSeed(';

function load2DMove(connections, maze) {
  const src = [CAN_MOVE_MARK, NEXT_MARK, ISX_MARK]
    .map((m) => extractBlock(html, m))
    .join('\n');
  const ctx = vm.createContext({
    currentMaze: maze,
    currentConnections: connections,
    currentSize: connections.length,
  });
  vm.runInContext(src, ctx);
  return ctx;
}

const DIR_NAMES = ['up', 'down', 'left', 'right'];

test('extractBlock picks top-level canMove', () => {
  const block = extractBlock(html, CAN_MOVE_MARK);
  assert.match(block, /currentConnections/);
  assert.doesNotMatch(block, /\bheight\b/);
});

test('findNextIntersection matches 2D', () => {
  for (const seed of [1, 42, 12345])
    for (const size of [10, 15, 20]) {
      const { maze, connections } = new MazeGenerator(size, size, seed).generate();
      const ctx = load2DMove(connections, maze);
      for (let row = 0; row < size; row++)
        for (let col = 0; col < size; col++)
          for (const dir of DIR_NAMES) {
            const a = ctx.findNextIntersection(row, col, dir);
            const b = L.findNextIntersection(connections, { row, col }, dir);
            const msg = `seed=${seed} size=${size} (${row},${col}) ${dir}`;
            if (a === null) assert.equal(b, null, msg);
            else assert.deepEqual(b, { row: a.row, col: a.col }, msg);
          }
    }
});

test('canMove: boundary and exits', () => {
  const { connections: c } = new MazeGenerator(10, 10, 1).generate();
  assert.equal(L.canMove(c, { row: 0, col: 0 }, { row: -1, col: 0 }), false);
  assert.equal(L.canMove(c, { row: 0, col: 0 }, { row: 0, col: -1 }), false);
  assert.equal(L.canMove(c, { row: 9, col: 9 }, { row: 10, col: 9 }), false);
  assert.equal(L.canMove(c, { row: 9, col: 9 }, { row: 9, col: 10 }), false);
  assert.equal(L.canMove(c, { row: 0, col: 0 }, { row: 0, col: 2 }), false);
  assert.equal(L.canMove(c, { row: 0, col: 0 }, { row: 1, col: 1 }), false);
});

test('canMove requires both sides', () => {
  const f = () => ({ up: false, down: false, left: false, right: false });
  const c = [
    [f(), f()],
    [f(), f()],
  ];
  c[0][0].right = true;
  assert.equal(L.canMove(c, { row: 0, col: 0 }, { row: 0, col: 1 }), false);
  c[0][1].left = true;
  assert.equal(L.canMove(c, { row: 0, col: 0 }, { row: 0, col: 1 }), true);
  assert.equal(L.canMove(c, { row: 0, col: 1 }, { row: 0, col: 0 }), true);
});

test('findPath from reachable positions', () => {
  for (const seed of [1, 42, 12345])
    for (const size of [10, 15, 20]) {
      const { connections: c } = new MazeGenerator(size, size, seed).generate();
      const reached = [{ row: 0, col: 0 }];
      const seen = new Set(['0,0']);
      for (let i = 0; i < reached.length && reached.length < 30; i++) {
        for (const dir of DIR_NAMES) {
          const n = L.findNextIntersection(c, reached[i], dir);
          if (n && !seen.has(`${n.row},${n.col}`) && reached.length < 30) {
            seen.add(`${n.row},${n.col}`);
            reached.push(n);
          }
        }
      }
      if (seed === 1 && size === 10) {
        assert.ok(
          reached.some((p) => p.row === 3 && p.col === 6),
          'seed=1 size=10 should reach (3,6)',
        );
      }
      for (const p of reached) {
        const path = L.findPath(c, p, { row: size - 1, col: size - 1 });
        const msg = `seed=${seed} size=${size} from (${p.row},${p.col})`;
        assert.ok(path.length > 0, msg);
        assert.deepEqual(path[0], [p.row, p.col], msg);
        assert.deepEqual(path[path.length - 1], [size - 1, size - 1], msg);
        for (let k = 1; k < path.length; k++) {
          const [r0, c0] = path[k - 1];
          const [r1, c1] = path[k];
          assert.ok(L.canMove(c, { row: r0, col: c0 }, { row: r1, col: c1 }), msg);
        }
      }
    }
});

test('findPath unreachable returns []', () => {
  const c = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => ({ up: false, down: false, left: false, right: false })),
  );
  assert.deepEqual(L.findPath(c, { row: 0, col: 0 }, { row: 2, col: 2 }), []);
});

test('parseSeed matches 2D getSeed', () => {
  const src = extractBlock(html, GETSEED_MARK);
  for (const s of ['123', '0042', 'abc', '迷宫', 'x1y2']) {
    const ctx = vm.createContext({ getURLParameter: () => s });
    vm.runInContext(src, ctx);
    assert.equal(L.parseSeed(s), ctx.getSeed(), s);
  }
  assert.equal(L.parseSeed(null), null);
  assert.equal(L.parseSeed(undefined), null);
  assert.equal(L.parseSeed(''), null);
});

test('parseSize falls back to 10', () => {
  assert.equal(L.parseSize('10'), 10);
  assert.equal(L.parseSize('15'), 15);
  assert.equal(L.parseSize('20'), 20);
  for (const s of ['99', 'abc', null, '12']) assert.equal(L.parseSize(s), 10, String(s));
});

test('turn cycles', () => {
  assert.equal(L.turn('up', 'left'), 'left');
  assert.equal(L.turn('left', 'left'), 'down');
  assert.equal(L.turn('down', 'left'), 'right');
  assert.equal(L.turn('right', 'left'), 'up');
  assert.equal(L.turn('up', 'right'), 'right');
  assert.equal(L.turn('right', 'right'), 'down');
  assert.equal(L.turn('down', 'right'), 'left');
  assert.equal(L.turn('left', 'right'), 'up');
  for (const f of DIR_NAMES) {
    let g = f;
    for (let i = 0; i < 4; i++) g = L.turn(g, 'left');
    assert.equal(g, f);
  }
  assert.equal(L.turn('up', 'back'), 'down');
  assert.equal(L.turn('left', 'back'), 'right');
  assert.equal(L.turn('down', 'back'), 'up');
  assert.equal(L.turn('right', 'back'), 'left');
});

test('resolveInput', () => {
  for (const k of DIR_NAMES)
    assert.deepEqual(L.resolveInput('follow', 'up', k), { type: 'move', dir: k });
  assert.deepEqual(L.resolveInput('first', 'left', 'up'), { type: 'move', dir: 'left' });
  assert.deepEqual(L.resolveInput('first', 'left', 'left'), { type: 'turn', facing: 'down' });
  assert.deepEqual(L.resolveInput('first', 'left', 'right'), { type: 'turn', facing: 'up' });
  assert.deepEqual(L.resolveInput('first', 'left', 'down'), { type: 'turn', facing: 'right' });
});

test('isInFogView edges', () => {
  const c = { row: 5, col: 5 };
  assert.equal(L.isInFogView(c, { row: 8, col: 8 }, 3), true);
  assert.equal(L.isInFogView(c, { row: 9, col: 5 }, 3), false);
  assert.equal(L.isInFogView(c, { row: 2, col: 2 }, 3), true);
  assert.equal(L.isInFogView(c, { row: 5, col: 1 }, 3), false);
});

test('clampRadius', () => {
  const cases = [
    [5, 5],
    ['7', 7],
    [0, 1],
    [-3, 1],
    [26, 25],
    ['99', 25],
    [3.6, 4],
    [null, 5],
    [undefined, 5],
    ['abc', 5],
    [NaN, 5],
    [Infinity, 5],
  ];
  for (const [input, want] of cases) assert.equal(L.clampRadius(input), want, String(input));
});

test('facingYaw', () => {
  assert.equal(L.facingYaw('up'), 0);
  assert.equal(L.facingYaw('left'), Math.PI / 2);
  assert.equal(L.facingYaw('down'), Math.PI);
  assert.equal(L.facingYaw('right'), -Math.PI / 2);
});

test('followOffset', () => {
  const near = (a, b) => {
    assert.ok(Math.abs(a.h - b.h) < 1e-9, `h ${a.h} vs ${b.h}`);
    assert.ok(Math.abs(a.d - b.d) < 1e-9, `d ${a.d} vs ${b.d}`);
  };
  near(L.followOffset(5), { h: 7, d: 5 });
  near(L.followOffset(1), { h: 3.8, d: 2.6 });
  near(L.followOffset(10), { h: 11, d: 8 });
  near(L.followOffset(25), { h: 11, d: 8 });
});

// ---------- Task 3: 墙段、视野与地板着色 ----------
test('wallSegments match canMove', () => {
  for (const seed of [1, 42])
    for (const size of [10, 20]) {
      const { connections: c } = new MazeGenerator(size, size, seed).generate();
      const segs = L.wallSegments(c);
      const keyOf = (s) => `${s.x},${s.z},${s.along}`;
      const byKey = new Map(segs.map((s) => [keyOf(s), s]));
      const msg = `seed=${seed} size=${size}`;
      for (let r = 0; r < size; r++)
        for (let col = 0; col < size; col++) {
          if (r + 1 < size) {
            const blocked = !L.canMove(c, { row: r, col }, { row: r + 1, col });
            const s = byKey.get(`${col + 0.5},${r + 1},x`);
            assert.equal(Boolean(s), blocked, `${msg} south of (${r},${col})`);
            if (s) assert.deepEqual(s.cells, [[r, col], [r + 1, col]]);
          }
          if (col + 1 < size) {
            const blocked = !L.canMove(c, { row: r, col }, { row: r, col: col + 1 });
            const s = byKey.get(`${col + 1},${r + 0.5},z`);
            assert.equal(Boolean(s), blocked, `${msg} east of (${r},${col})`);
            if (s) assert.deepEqual(s.cells, [[r, col], [r, col + 1]]);
          }
        }
      const outer = segs.filter(
        (s) =>
          (s.along === 'x' && (s.z === 0 || s.z === size)) ||
          (s.along === 'z' && (s.x === 0 || s.x === size)),
      );
      assert.equal(outer.length, 4 * size - 4, msg);
      for (const s of outer) assert.equal(s.cells.length, 1, msg);
      for (const s of segs) {
        if (s.along === 'x') {
          assert.ok(Number.isInteger(s.z) && !Number.isInteger(s.x), msg);
        } else {
          assert.equal(s.along, 'z');
          assert.ok(Number.isInteger(s.x) && !Number.isInteger(s.z), msg);
        }
      }
      assert.equal(byKey.has(`0.5,0,x`), false, msg);
      assert.equal(byKey.has(`0,0.5,z`), false, msg);
      assert.equal(byKey.has(`${size - 0.5},${size},x`), false, msg);
      assert.equal(byKey.has(`${size},${size - 0.5},z`), false, msg);
    }
});

test('wallInView uses either neighbor', () => {
  const seg = { cells: [[0, 0], [0, 1]] };
  assert.equal(L.wallInView(seg, { row: 0, col: 4 }, 3), true);
  assert.equal(L.wallInView(seg, { row: 0, col: 4 }, 2), false);
});

test('floorKind priority', () => {
  assert.equal(L.floorKind({ row: 3, col: 3 }, 10, { onPath: true, inView: false }), 'path');
  assert.equal(L.floorKind({ row: 0, col: 0 }, 10, { onPath: false, inView: false }), 'fog');
  assert.equal(L.floorKind({ row: 0, col: 0 }, 10, { onPath: false, inView: true }), 'start');
  assert.equal(L.floorKind({ row: 9, col: 9 }, 10, { onPath: false, inView: true }), 'end');
  assert.equal(L.floorKind({ row: 3, col: 3 }, 10, { onPath: false, inView: true }), 'floor');
});
