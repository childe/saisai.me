import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MazeGenerator, SeededRandom } from '../maze-3d/maze-core.js';
import { wallSegments, findPath } from '../maze-3d/game-logic.js';
import {
  PLAYER_RADIUS,
  MAX_SPEED,
  wallBoxes,
  createBoxGrid,
  cellOf,
  stepPlayer,
  playerModelScale,
  PLAYER_PARTS,
} from '../maze-3d/movement.js';

// ---------- Task 1: 碰撞与 stepPlayer ----------
const open = createBoxGrid([], 100);
const start = { x: 50, z: 50, vx: 0, vz: 0 };

function run(state, input, yaw, seconds, grid, dt = 1 / 60) {
  const out = [];
  let s = state;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    s = stepPlayer(s, input, yaw, dt, grid);
    out.push(s);
  }
  return out;
}

function closestDist(p, b) {
  const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
  return Math.hypot(p.x - cx, p.z - cz);
}
const overlaps = (p, b) => closestDist(p, b) < PLAYER_RADIUS - 1e-6;

const mazeOf = (seed, size) => new MazeGenerator(size, size, seed).generate().connections;

test('accelerates to max speed and stops within 0.15s', () => {
  const s = run(start, { forward: 1, strafe: 0 }, 0, 1, open);
  const d = 50 - s.at(-1).z;
  assert.ok(d > 1.95 && d < 2.1, `d=${d}`);
  const stop = run(s.at(-1), { forward: 0, strafe: 0 }, 0, 0.15, open);
  assert.equal(Math.hypot(stop.at(-1).vx, stop.at(-1).vz), 0);
});

test('diagonal input never exceeds MAX_SPEED', () => {
  const s = run(start, { forward: 1, strafe: 1 }, 0.3, 1, open);
  for (const f of s) assert.ok(Math.hypot(f.vx, f.vz) <= MAX_SPEED + 1e-9);
});

test('yaw convention: yaw=PI/2 forward moves +x', () => {
  const s = run(start, { forward: 1, strafe: 0 }, Math.PI / 2, 0.5, open);
  assert.ok(s.at(-1).x > 50.5);
  assert.ok(Math.abs(s.at(-1).z - 50) < 1e-9);
});

const flatWall = [{ minX: -5, maxX: 5, minZ: -0.05, maxZ: 0.05 }];
const flatGrid = createBoxGrid(flatWall, 100);

test('head-on wall: stops in front', () => {
  const s = run({ x: 0, z: 1, vx: 0, vz: 0 }, { forward: 1, strafe: 0 }, 0, 2, flatGrid);
  const z = s.at(-1).z;
  assert.ok(z - 0.05 >= PLAYER_RADIUS - 1e-6, `z=${z}`);
  assert.ok(z < 0.05 + PLAYER_RADIUS + 0.01, `z=${z}`);
});

test('oblique wall: slides along it', () => {
  const s = run({ x: 0, z: 1, vx: 0, vz: 0 }, { forward: 1, strafe: 0 }, Math.PI / 4, 2, flatGrid);
  const p = s.at(-1);
  assert.ok(p.x > 1.0, `x=${p.x}`);
  assert.ok(p.z - 0.05 >= PLAYER_RADIUS - 1e-6 && p.z < 0.05 + PLAYER_RADIUS + 0.01, `z=${p.z}`);
});

test('dt=0.5 hitch does not tunnel', () => {
  const p = stepPlayer({ x: 0, z: 0.5, vx: 0, vz: 0 }, { forward: 1, strafe: 0 }, 0, 0.5, flatGrid);
  assert.ok(p.z >= 0.05 + PLAYER_RADIUS - 1e-6, `z=${p.z}`);
});

test('cannot leave through entrance or exit', () => {
  const c = mazeOf(1, 10);
  const grid = createBoxGrid(wallBoxes(wallSegments(c), 10), 10);
  const at = (x, z) => ({ x, z, vx: 0, vz: 0 });
  const go = (p, yaw) => run(p, { forward: 1, strafe: 0 }, yaw, 2, grid).at(-1);
  assert.ok(go(at(0.5, 0.5), 0).z >= PLAYER_RADIUS - 1e-6);
  assert.ok(go(at(0.5, 0.5), (3 * Math.PI) / 2).x >= PLAYER_RADIUS - 1e-6);
  assert.ok(go(at(9.5, 9.5), Math.PI).z <= 10 - PLAYER_RADIUS + 1e-6);
  assert.ok(go(at(9.5, 9.5), Math.PI / 2).x <= 10 - PLAYER_RADIUS + 1e-6);
});

test('random input fuzz never overlaps walls or leaves maze', () => {
  for (const seed of [1, 42, 12345])
    for (const size of [10, 20]) {
      const boxes = wallBoxes(wallSegments(mazeOf(seed, size)), size);
      const grid = createBoxGrid(boxes, size);
      const rnd = new SeededRandom(seed);
      let s = { x: 0.5, z: 0.5, vx: 0, vz: 0 };
      let input = { forward: 0, strafe: 0 };
      let yaw = 0;
      for (let i = 0; i < 2000; i++) {
        if (i % 30 === 0) {
          input = { forward: rnd.next() * 2 - 1, strafe: rnd.next() * 2 - 1 };
          yaw = rnd.next() * 2 * Math.PI;
        }
        const dt = i % 200 === 199 ? 0.5 : 0.008 + rnd.next() * 0.042;
        s = stepPlayer(s, input, yaw, dt, grid);
        const msg = `seed=${seed} size=${size} frame=${i} (${s.x},${s.z})`;
        assert.ok(s.x >= PLAYER_RADIUS - 1e-6 && s.x <= size - PLAYER_RADIUS + 1e-6, msg);
        assert.ok(s.z >= PLAYER_RADIUS - 1e-6 && s.z <= size - PLAYER_RADIUS + 1e-6, msg);
        for (const b of boxes) assert.ok(!overlaps(s, b), `${msg} box ${JSON.stringify(b)}`);
      }
    }
});

test('0.9 corridor and L corner are passable', () => {
  const corridor = [
    { minX: -0.05, maxX: 0.05, minZ: -10, maxZ: 10 },
    { minX: 0.95, maxX: 1.05, minZ: -10, maxZ: 10 },
  ];
  const s = run({ x: 0.5, z: 5, vx: 0, vz: 0 }, { forward: 1, strafe: 0 }, 0, 3, createBoxGrid(corridor, 100));
  assert.ok(s.at(-1).z < 0, `z=${s.at(-1).z}`);

  const f = () => ({ up: false, down: false, left: false, right: false });
  const c = [
    [f(), f()],
    [f(), f()],
  ];
  c[0][0].right = true;
  c[0][1].left = true;
  c[0][1].down = true;
  c[1][1].up = true;
  const grid = createBoxGrid(wallBoxes(wallSegments(c), 2), 2);
  let p = run({ x: 0.5, z: 0.5, vx: 0, vz: 0 }, { forward: 1, strafe: 0 }, Math.PI / 2, 1, grid).at(-1);
  p = run(p, { forward: 1, strafe: 0 }, Math.PI, 1, grid).at(-1);
  assert.deepEqual(cellOf(p), { row: 1, col: 1 });
});

test('path-follow reaches the exit', () => {
  for (const seed of [1, 42, 12345])
    for (const size of [10, 20]) {
      const c = mazeOf(seed, size);
      const boxes = wallBoxes(wallSegments(c), size);
      const grid = createBoxGrid(boxes, size);
      const end = { row: size - 1, col: size - 1 };
      const limit = findPath(c, { row: 0, col: 0 }, end).length * 1.5;
      let s = { x: 0.5, z: 0.5, vx: 0, vz: 0 };
      let reached = false;
      for (let t = 0; t < limit; t += 1 / 60) {
        const cell = cellOf(s);
        if (cell.row === end.row && cell.col === end.col) {
          reached = true;
          break;
        }
        const path = findPath(c, cell, end);
        const [r, col] = path[1];
        const tx = col + 0.5;
        const tz = r + 0.5;
        const yaw = Math.atan2(tx - s.x, -(tz - s.z));
        s = stepPlayer(s, { forward: 1, strafe: 0 }, yaw, 1 / 60, grid);
      }
      const msg = `seed=${seed} size=${size} at (${s.x},${s.z})`;
      assert.ok(reached, msg);
      for (const b of boxes) assert.ok(!overlaps(s, b), msg);
    }
});

test('playerModelScale keeps every part inside PLAYER_RADIUS', () => {
  const s = playerModelScale();
  for (const p of PLAYER_PARTS) assert.ok((Math.hypot(p.x, p.z) + p.r) * s <= PLAYER_RADIUS + 1e-9);
  assert.ok(s > 0.7, `s=${s}`);
});

test('cellOf floors', () => {
  assert.deepEqual(cellOf({ x: 3.99, z: 0.01 }), { row: 0, col: 3 });
});

const contains = (b, x, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

test('wallBoxes closes all four border gaps', () => {
  const segs = wallSegments(mazeOf(42, 10));
  const boxes = wallBoxes(segs, 10);
  assert.equal(boxes.length, segs.length + 4);
  for (const [x, z] of [
    [0.5, 0],
    [0, 0.5],
    [9.5, 10],
    [10, 9.5],
  ])
    assert.ok(
      boxes.some((b) => contains(b, x, z)),
      `${x},${z}`,
    );
});

test('createBoxGrid.near covers every box touching a circle there', () => {
  const boxes = wallBoxes(wallSegments(mazeOf(12345, 10)), 10);
  const grid = createBoxGrid(boxes, 10);
  const rnd = new SeededRandom(7);
  for (let i = 0; i < 500; i++) {
    const p = { x: rnd.next() * 10, z: rnd.next() * 10 };
    const near = new Set(grid.near(p.x, p.z));
    for (const b of boxes) if (closestDist(p, b) < PLAYER_RADIUS) assert.ok(near.has(b), `${p.x},${p.z}`);
  }
});

// ---------- Task 2: 相机几何 ----------
import {
  TARGET_HEIGHT,
  CAMERA_MARGIN,
  FOLLOW_PITCH,
  FIRST_PITCH,
  ZOOM_MIN,
  ZOOM_MAX,
  wallBoxes3d,
  followCameraPos,
  cameraPullIn,
  smoothCameraDistance,
} from '../maze-3d/movement.js';

const wall3 = wallBoxes3d([{ minX: -5, maxX: 5, minZ: 0.95, maxZ: 1.05 }]); // 位于 target 南面 1 处
const T = { x: 0, y: TARGET_HEIGHT, z: 0 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const deg = (d) => (d * Math.PI) / 180;

test('camera constants', () => {
  assert.equal(TARGET_HEIGHT, 0.4);
  assert.equal(CAMERA_MARGIN, 0.12);
  assert.ok(near(FOLLOW_PITCH.min, deg(15)) && near(FOLLOW_PITCH.max, deg(75)) && near(FOLLOW_PITCH.def, deg(40)));
  assert.ok(near(FIRST_PITCH.min, deg(-30)) && near(FIRST_PITCH.max, deg(30)) && FIRST_PITCH.def === 0);
  assert.equal(ZOOM_MIN, 0.7);
  assert.equal(ZOOM_MAX, 1.5);
});

test('cameraPullIn: low segment through wall is pulled to the wall', () => {
  const cam = followCameraPos(T, 0, FOLLOW_PITCH.min, 5);
  const d = cameraPullIn(T, cam, wall3);
  const zHit = 0.95 - CAMERA_MARGIN;
  assert.ok(d < 5 && Math.abs(d * Math.cos(FOLLOW_PITCH.min) - zHit) < 1e-6, `d=${d}`);
});

test('cameraPullIn: no walls returns full length', () => {
  const cam = followCameraPos(T, 0, FOLLOW_PITCH.min, 5);
  assert.ok(near(cameraPullIn(T, cam, []), 5));
});

test('cameraPullIn: segment above wall top is not pulled', () => {
  const pitch = deg(75);
  assert.ok(0.4 + Math.tan(pitch) * 0.83 > 0.8 + CAMERA_MARGIN);
  const cam = followCameraPos(T, 0, pitch, 5);
  assert.ok(near(cameraPullIn(T, cam, wall3), 5));
});

test('cameraPullIn ignores a box containing the target', () => {
  const around = { minX: -0.3, maxX: 0.3, minY: 0, maxY: 1, minZ: -0.3, maxZ: 0.3 };
  const cam = followCameraPos(T, 0, FOLLOW_PITCH.min, 5);
  const want = (0.95 - CAMERA_MARGIN) / Math.cos(FOLLOW_PITCH.min);
  assert.ok(near(cameraPullIn(T, cam, [around, ...wall3]), want));
  assert.ok(near(cameraPullIn(T, cam, [around]), 5));
});

test('cameraPullIn never NaN', () => {
  assert.equal(cameraPullIn(T, { ...T }, wall3), 0);
  const inside = { x: 0, y: 0.4, z: 1 };
  for (const [a, b] of [
    [T, inside],
    [inside, T],
    [inside, { x: 0, y: 0.4, z: 1.0000001 }],
    [T, { x: 0, y: 0.4, z: 1e-12 }],
  ]) {
    const d = cameraPullIn(a, b, wall3);
    assert.ok(Number.isFinite(d) && d >= 0, `d=${d}`);
  }
});

test('wallBoxes3d expands by margin', () => {
  const [b] = wallBoxes3d([{ minX: 1, maxX: 2, minZ: 3, maxZ: 4 }]);
  assert.ok(near(b.minY, -0.12) && near(b.maxY, 0.92));
  assert.ok(near(b.minX, 0.88) && near(b.maxX, 2.12) && near(b.minZ, 2.88) && near(b.maxZ, 4.12));
});

test('followCameraPos: yaw 0 puts camera south and above', () => {
  const t = { x: 2, y: 0.4, z: 3 };
  const c = followCameraPos(t, 0, deg(40), 4);
  assert.ok(c.z > t.z && c.y > t.y && near(c.x, t.x));
  assert.ok(near(Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z), 4));
});

test('smoothCameraDistance: always <= dSafe, snaps in, eases out', () => {
  const safes = [8, 8, 3, 3, 3, 8, 8, 8, 8, 8];
  let d = 8;
  const seq = [];
  for (const s of safes) {
    d = smoothCameraDistance(d, 8, s, 0.2);
    seq.push(d);
  }
  seq.forEach((v, i) => assert.ok(v <= safes[i] + 1e-12));
  assert.equal(seq[2], 3);
  assert.ok(seq[5] > 3 && seq[5] < 8);
  for (let i = 6; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1]);
});
