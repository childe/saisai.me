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

// ---------- 相机求解：可见墙包围盒与抬高俯角 ----------
import { segmentBoxes, CAMERA_MIN_DIST, liftPitch } from '../maze-3d/movement.js';

test('segmentBoxes covers only rendered segments, not the border gap closures', () => {
  const segs = wallSegments(mazeOf(7, 10));
  const vis = segmentBoxes(segs);
  const all = wallBoxes(segs, 10);
  assert.equal(vis.length, segs.length);
  assert.deepEqual(vis, all.slice(0, segs.length));
});

test('default start view is not pulled in by the invisible entrance closure', () => {
  for (const seed of [1, 7, 42, 12345]) {
    const segs = wallSegments(mazeOf(seed, 10));
    const target = { x: 0.5, y: TARGET_HEIGHT, z: 0.5 };
    const dist = 8.602;
    const cam = followCameraPos(target, Math.PI, FOLLOW_PITCH.def, dist);
    const d = cameraPullIn(target, cam, wallBoxes3d(segmentBoxes(segs)));
    assert.ok(near(d, dist), `seed=${seed} d=${d}`);
  }
});

test('liftPitch keeps the requested pitch when nothing blocks', () => {
  assert.equal(liftPitch(T, 0, FOLLOW_PITCH.min, 5, []), FOLLOW_PITCH.min);
  assert.equal(liftPitch(T, Math.PI, FOLLOW_PITCH.min, 5, wall3), FOLLOW_PITCH.min); // 墙在前方
});

// 小人在格心 / 贴墙，相机转到身后墙方向：抬高俯角后距离可用、线段安全、不超过上限
for (const [name, gap] of [
  ['cell center', 0.5],
  ['hugging the wall', PLAYER_RADIUS + 0.05],
]) {
  test(`liftPitch raises a low pitch over a wall behind (${name})`, () => {
    const walls = wallBoxes3d([{ minX: -5, maxX: 5, minZ: gap - 0.05, maxZ: gap + 0.05 }]);
    const dist = 6;
    assert.ok(cameraPullIn(T, followCameraPos(T, 0, FOLLOW_PITCH.min, dist), walls) < CAMERA_MIN_DIST);
    const p = liftPitch(T, 0, FOLLOW_PITCH.min, dist, walls);
    assert.ok(p > FOLLOW_PITCH.min && p <= FOLLOW_PITCH.max + 1e-12, `p=${p}`);
    const d = cameraPullIn(T, followCameraPos(T, 0, p, dist), walls);
    assert.ok(d >= CAMERA_MIN_DIST, `d=${d}`);
  });
}

test('liftPitch never lifts past what a short ideal distance needs', () => {
  // 理想距离本身比 CAMERA_MIN_DIST 短：只要求不被拉近
  const p = liftPitch(T, 0, FOLLOW_PITCH.min, 0.5, wall3);
  assert.equal(p, FOLLOW_PITCH.min);
});

test('liftPitch falls back to the least-blocked pitch when nothing clears', () => {
  const tower = wallBoxes3d([{ minX: -5, maxX: 5, minZ: 0.45, maxZ: 0.55 }], 100);
  const p = liftPitch(T, 0, FOLLOW_PITCH.min, 6, tower);
  assert.ok(Number.isFinite(p) && p >= FOLLOW_PITCH.min && p <= FOLLOW_PITCH.max + 1e-12);
  const dp = cameraPullIn(T, followCameraPos(T, 0, p, 6), tower);
  for (let q = FOLLOW_PITCH.min; q <= FOLLOW_PITCH.max; q += deg(1)) {
    assert.ok(cameraPullIn(T, followCameraPos(T, 0, q, 6), tower) <= dp + 0.05);
  }
});

// ---------- Task 3: 输入换算与手势状态机 ----------
import {
  TURN_SPEED,
  STICK_DEAD_ZONE,
  LOOK_SPEED,
  inputFromKeys,
  inputFromStick,
  applyKeyEvent,
  createPointerRouter,
} from '../maze-3d/movement.js';

test('input constants', () => {
  assert.ok(near(TURN_SPEED, (2 * Math.PI) / 3));
  assert.equal(STICK_DEAD_ZONE, 0.1);
  assert.equal(LOOK_SPEED, 0.005);
});

test('inputFromKeys combos', () => {
  const k = (...codes) => inputFromKeys(new Set(codes));
  assert.deepEqual(k('KeyW'), { forward: 1, strafe: 0, turn: 0 });
  assert.equal(k('KeyW', 'KeyS').forward, 0);
  const wd = k('KeyW', 'KeyD');
  assert.ok(near(wd.forward, Math.SQRT1_2) && near(wd.strafe, Math.SQRT1_2));
  assert.equal(k('ArrowRight').turn, 1);
  assert.equal(k('ArrowLeft').turn, -1);
  assert.equal(k('KeyQ', 'KeyE').turn, 0);
  assert.equal(k('ArrowDown').forward, -1);
  assert.equal(k('KeyA').strafe, -1);
  const ua = k('ArrowUp', 'KeyA');
  assert.ok(near(Math.hypot(ua.forward, ua.strafe), 1));
  assert.deepEqual(k(), { forward: 0, strafe: 0, turn: 0 });
});

test('inputFromStick dead zone and scaling', () => {
  assert.deepEqual(inputFromStick(4, 0, 50), { forward: 0, strafe: 0 });
  assert.deepEqual(inputFromStick(0, 0, 50), { forward: 0, strafe: 0 });
  assert.ok(near(inputFromStick(0, -50, 50).forward, 1));
  assert.ok(near(inputFromStick(0, -100, 50).forward, 1));
  assert.ok(near(inputFromStick(50 * 0.55, 0, 50).strafe, 0.5));
  const d = inputFromStick(30, -40, 50);
  assert.ok(near(Math.hypot(d.forward, d.strafe), 1));
  assert.ok(near(d.strafe, 0.6) && near(d.forward, 0.8));
});

test('applyKeyEvent ignores auto-repeat', () => {
  const keys = new Set();
  const ev = (type, code, extra = {}) => ({
    type,
    code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  });
  assert.equal(applyKeyEvent(keys, ev('keydown', 'KeyW')), true);
  assert.ok(keys.has('KeyW'));
  keys.clear();
  for (let i = 0; i < 3; i++) applyKeyEvent(keys, ev('keydown', 'KeyW', { repeat: true }));
  assert.equal(keys.size, 0);
  applyKeyEvent(keys, ev('keyup', 'KeyW'));
  applyKeyEvent(keys, ev('keydown', 'KeyW'));
  assert.ok(keys.has('KeyW'));
  applyKeyEvent(keys, ev('keyup', 'KeyW', { repeat: true, metaKey: true }));
  assert.equal(keys.size, 0);
  applyKeyEvent(keys, ev('keydown', 'KeyW', { metaKey: true }));
  applyKeyEvent(keys, ev('keydown', 'KeyS', { ctrlKey: true }));
  applyKeyEvent(keys, ev('keydown', 'KeyD', { altKey: true }));
  assert.equal(keys.size, 0);
  assert.equal(applyKeyEvent(keys, ev('keydown', 'KeyX')), false);
  assert.equal(keys.size, 0);
  assert.equal(applyKeyEvent(keys, ev('keydown', 'ArrowUp')), true);
  assert.ok(keys.has('ArrowUp'));
});

const touch = (id, x, y, side, kind = 'touch') => ({ id, kind, x, y, side });

test('left stick and right look together do not zoom', () => {
  const r = createPointerRouter();
  assert.equal(r.down(touch(1, 100, 300, 'left')), true);
  assert.equal(r.down(touch(2, 600, 300, 'right')), true);
  r.move({ id: 1, x: 130, y: 280 });
  r.move({ id: 2, x: 650, y: 310 });
  assert.deepEqual(r.stick, { active: true, originX: 100, originY: 300, dx: 30, dy: -20 });
  assert.deepEqual(r.consume(), { look: { dx: 50, dy: 10 }, zoom: 1 });
  assert.deepEqual(r.consume(), { look: { dx: 0, dy: 0 }, zoom: 1 });
});

function pinched() {
  const r = createPointerRouter();
  r.down(touch(2, 600, 300, 'right'));
  r.down(touch(3, 700, 300, 'right'));
  return r;
}

test('two right fingers pinch', () => {
  const r = pinched();
  assert.equal(r.roles()[2], 'pinch');
  assert.equal(r.roles()[3], 'pinch');
  r.move({ id: 3, x: 800, y: 300 });
  r.move({ id: 2, x: 590, y: 300 });
  const c = r.consume();
  assert.ok(near(c.zoom, 100 / 210), `zoom=${c.zoom}`);
  assert.deepEqual(c.look, { dx: 0, dy: 0 });
});

test('lifting one pinch finger resumes look without jump', () => {
  const r = pinched();
  r.move({ id: 3, x: 800, y: 300 });
  r.move({ id: 2, x: 590, y: 300 });
  r.consume();
  r.up(3);
  assert.equal(r.roles()[2], 'look');
  assert.equal(r.roles()[3], undefined);
  r.move({ id: 2, x: 600, y: 300 });
  const c = r.consume();
  assert.equal(c.look.dx, 10);
  assert.equal(c.zoom, 1);
  // 再按下新的右侧手指：以当前两指距离为新基准
  r.down(touch(4, 650, 300, 'right'));
  r.move({ id: 4, x: 700, y: 300 });
  assert.ok(near(r.consume().zoom, 50 / 100));
});

test('third right finger and second left finger are ignored', () => {
  const r = pinched();
  assert.equal(r.down(touch(4, 750, 300, 'right')), false);
  assert.equal(r.down(touch(5, 100, 300, 'left')), true);
  assert.equal(r.down(touch(6, 120, 300, 'left')), false);
  const roles = r.roles();
  assert.equal(roles[4], undefined);
  assert.equal(roles[6], undefined);
  r.move({ id: 6, x: 500, y: 500 });
  r.move({ id: 4, x: 900, y: 300 });
  assert.equal(r.stick.dx, 0);
  assert.deepEqual(r.consume(), { look: { dx: 0, dy: 0 }, zoom: 1 });
});

test('stick finger crossing to right half keeps its role', () => {
  const r = createPointerRouter();
  r.down(touch(1, 100, 300, 'left'));
  r.move({ id: 1, x: 700, y: 300 });
  r.down(touch(2, 650, 300, 'right'));
  assert.equal(r.roles()[2], 'look');
  r.down(touch(3, 750, 300, 'right'));
  assert.deepEqual(r.roles(), { 1: 'stick', 2: 'pinch', 3: 'pinch' });
  r.move({ id: 1, x: 720, y: 300 });
  assert.equal(r.consume().zoom, 1);
  assert.equal(r.stick.dx, 620);
});

test('cancel equals up and is idempotent', () => {
  const r = createPointerRouter();
  r.down(touch(1, 100, 300, 'left'));
  r.move({ id: 1, x: 140, y: 300 });
  r.cancel(1);
  assert.equal(r.stick.active, false);
  assert.equal(r.stick.dx, 0);
  r.up(1);
  r.cancel(1);
  assert.deepEqual(r.roles(), {});
  r.down(touch(2, 600, 300, 'right'));
  r.cancel(2);
  r.cancel(2);
  assert.deepEqual(r.roles(), {});
});

test('reset clears everything', () => {
  const r = pinched();
  r.down(touch(1, 100, 300, 'left'));
  r.move({ id: 1, x: 150, y: 300 });
  r.move({ id: 3, x: 900, y: 300 });
  r.reset();
  assert.deepEqual(r.roles(), {});
  const s = r.stick;
  assert.equal(s.active, false);
  assert.equal(s.dx, 0);
  assert.equal(s.dy, 0);
  assert.deepEqual(r.consume(), { look: { dx: 0, dy: 0 }, zoom: 1 });
  assert.equal(r.down(touch(7, 100, 300, 'left')), true);
});

test('mouse is look on either half', () => {
  const r = createPointerRouter();
  assert.equal(r.down(touch(1, 100, 300, 'left', 'mouse')), true);
  assert.equal(r.roles()[1], 'look');
  r.move({ id: 1, x: 110, y: 305 });
  assert.deepEqual(r.consume().look, { dx: 10, dy: 5 });
  assert.equal(r.stick.active, false);
});
