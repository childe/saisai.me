import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startYaw,
  LOOK_AHEAD,
  lookAheadTarget,
  segmentBlocked,
  edgeArrow,
  endHintMode,
  HINT_INSET,
  BEAM_SAMPLE_HEIGHTS,
  SHADOW_RADIUS,
  shadowLook,
  FOOT_STRIP_WIDTH,
  wallFootStrips,
  BEAM_RADIUS,
  BEAM_HEIGHT,
  SPARK_COUNT,
  beamPulse,
  CONFETTI_COUNT,
  CONFETTI_HOLD,
  CONFETTI_FADE,
  createConfetti,
  confettiStep,
  LOOK_AHEAD_STEPS,
  PLAYER_SIGHT_HEIGHTS,
  followCameraFor,
  followLookAhead,
  avoidRect,
} from '../maze-3d/effects.js';
import { MazeGenerator } from '../maze-3d/maze-core.js';
import { wallSegments, wallInView, followOffset } from '../maze-3d/game-logic.js';
import { slabInterval, wallBoxes3d, segmentBoxes, WALL_HEIGHT, PLAYER_RADIUS } from '../maze-3d/movement.js';

// ---------- Task 1: 开局朝向 ----------
test('startYaw points from start cell to maze center', () => {
  for (const n of [10, 15, 20]) {
    const y = startYaw(n);
    assert.ok(Math.abs(y - (3 * Math.PI) / 4) < 1e-9);
    const fx = Math.sin(y), fz = -Math.cos(y);
    const dx = n / 2 - 0.5, dz = n / 2 - 0.5, len = Math.hypot(dx, dz);
    assert.ok(Math.abs(fx - dx / len) < 1e-9 && Math.abs(fz - dz / len) < 1e-9);
  }
});

test('lookAheadTarget offsets along yaw forward', () => {
  const p = { x: 2.5, z: 3.5 };
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  const cases = [
    [0, 0, -1.5], // 北：−z
    [Math.PI / 2, 1.5, 0], // 东：+x
    [Math.PI, 0, 1.5], // 南：+z
    [(3 * Math.PI) / 2, -1.5, 0], // 西：−x
    [(3 * Math.PI) / 4, 1.5 * Math.SQRT1_2, 1.5 * Math.SQRT1_2], // 东南
  ];
  for (const [yaw, dx, dz] of cases) {
    const t = lookAheadTarget(p, yaw, LOOK_AHEAD);
    assert.ok(near(t.x, p.x + dx) && near(t.z, p.z + dz), `yaw ${yaw}`);
  }
  assert.deepEqual(lookAheadTarget(p, 1.234, 0), { x: 2.5, z: 3.5 });
  assert.deepEqual(p, { x: 2.5, z: 3.5 });
  assert.equal(LOOK_AHEAD, 1.5);
});

// ---------- Task 2: slab 求交 ----------
test('segmentBlocked', () => {
  const box = [wallBoxes3d(segmentBoxes([{ x: 1, z: 0.5, along: 'z' }]), WALL_HEIGHT, 0)[0]];
  assert.equal(segmentBlocked({ x: 0.5, y: 0.4, z: 0.5 }, { x: 1.5, y: 0.4, z: 0.5 }, box), true); // 穿墙
  assert.equal(segmentBlocked({ x: 0.5, y: 0.9, z: 0.5 }, { x: 1.5, y: 0.9, z: 0.5 }, box), false); // 越过墙顶
  assert.equal(segmentBlocked({ x: 0.5, y: 0.4, z: -1 }, { x: 0.5, y: 0.4, z: 2 }, box), false); // 平行不接触
  assert.equal(segmentBlocked({ x: 0.5, y: 0.4, z: 0.5 }, { x: 0.9, y: 0.4, z: 0.5 }, box), false); // 没到墙
  assert.equal(segmentBlocked({ x: 0.5, y: 0.4, z: 0.5 }, { x: 0.5, y: 0.4, z: 0.5 }, box), false); // a == b
});
test('slabInterval', () => {
  const b = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
  assert.deepEqual(slabInterval([-1, 0.5, 0.5], [1, 0, 0], b), [1, 2]);
  assert.equal(slabInterval([-1, 2, 0.5], [1, 0, 0], b), null);
});

// ---------- Task 3: 方向提示 ----------
test('edgeArrow places arrow on inset border', () => {
  const W = 1280, H = 720, I = 28;
  const onBorder = (p, w = W, h = H) =>
    (Math.abs(p.x - I) < 1e-6 || Math.abs(p.x - (w - I)) < 1e-6 || Math.abs(p.y - I) < 1e-6 || Math.abs(p.y - (h - I)) < 1e-6) &&
    p.x >= I - 1e-6 && p.x <= w - I + 1e-6 && p.y >= I - 1e-6 && p.y <= h - I + 1e-6;
  let a = edgeArrow({ x: -1, y: 0, z: -5 }, W, H, I);
  assert.ok(Math.abs(a.x - I) < 1e-9 && Math.abs(a.angle - Math.PI) < 1e-9);
  a = edgeArrow({ x: 1, y: 0, z: -5 }, W, H, I);
  assert.ok(Math.abs(a.x - (W - I)) < 1e-9 && Math.abs(a.angle) < 1e-9);
  a = edgeArrow({ x: 0, y: 1, z: -5 }, W, H, I);
  assert.ok(Math.abs(a.y - I) < 1e-9 && Math.abs(a.angle + Math.PI / 2) < 1e-9);
  a = edgeArrow({ x: 0, y: -1, z: -5 }, W, H, I);
  assert.ok(Math.abs(a.y - (H - I)) < 1e-9 && Math.abs(a.angle - Math.PI / 2) < 1e-9);
  a = edgeArrow({ x: 1, y: 1, z: -5 }, W, H, I);
  assert.ok(onBorder(a) && a.x > W / 2 && a.y < H / 2);
  a = edgeArrow({ x: 1, y: 0, z: 5 }, W, H, I);
  assert.ok(Math.abs(a.x - (W - I)) < 1e-9);
  a = edgeArrow({ x: 0, y: 0, z: 5 }, W, H, I);
  assert.ok(Math.abs(a.x - W / 2) < 1e-9 && Math.abs(a.y - (H - I)) < 1e-9 && Math.abs(a.angle - Math.PI / 2) < 1e-9);
  let prev = null;
  for (let i = 0; i <= 100; i++) {
    const z = 0.5 - 0.01 * i;
    const p = edgeArrow({ x: 1, y: 0, z }, W, H, I);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle), `z ${z}`);
    if (prev) assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) <= 2);
    prev = p;
  }
  for (const [w, h] of [[1280, 720], [800, 800], [720, 1280]]) {
    assert.ok(onBorder(edgeArrow({ x: 3, y: 2, z: -1 }, w, h, I), w, h), `${w}x${h}`);
  }
  assert.equal(HINT_INSET, 28);
  assert.deepEqual(BEAM_SAMPLE_HEIGHTS, [0.4, 1.5, 3, 5]);
});
test('endHintMode', () => {
  assert.equal(endHintMode([{ inView: true, occluded: true }, { inView: true, occluded: false }]), 'hidden');
  assert.equal(endHintMode([{ inView: true, occluded: true }, { inView: false, occluded: false }]), 'marker');
  assert.equal(endHintMode([{ inView: false, occluded: false }, { inView: false, occluded: true }]), 'edge');
});

// ---------- Task 4: 阴影 ----------
test('shadowLook shrinks and fades with lift', () => {
  assert.deepEqual(shadowLook(0), { scale: 1, opacity: 1 });
  const a = shadowLook(0.02), b = shadowLook(0.05);
  assert.ok(b.scale < a.scale && a.scale < 1 && b.opacity < a.opacity && a.opacity < 1);
  assert.deepEqual(shadowLook(1), shadowLook(0.1));
  assert.deepEqual(shadowLook(-1), shadowLook(0));
  assert.ok(Math.abs(SHADOW_RADIUS - 1.2 * PLAYER_RADIUS) < 1e-12);
});

// ---------- Task 5: 墙脚暗边 ----------
test('wallFootStrips: two per inner wall, one inward per outer wall', () => {
  const segs = wallSegments(new MazeGenerator(10, 10, 12345).generate().connections);
  const strips = wallFootStrips(segs);
  const inner = segs.filter((s) => s.cells.length === 2).length;
  const outer = segs.length - inner;
  assert.equal(strips.length, inner * 2 + outer);
  assert.equal(FOOT_STRIP_WIDTH, 0.18);
  const bySeg = new Map();
  for (const st of strips) {
    const seg = segs[st.seg];
    if (seg.along === 'x') {
      assert.ok(st.nx === 0 && Math.abs(st.nz) === 1);
      assert.equal(st.x, seg.x);
      assert.ok(Math.abs(Math.abs(st.z - seg.z) - 0.14) < 1e-12);
    } else {
      assert.ok(st.nz === 0 && Math.abs(st.nx) === 1);
      assert.equal(st.z, seg.z);
      assert.ok(Math.abs(Math.abs(st.x - seg.x) - 0.14) < 1e-12);
    }
    assert.ok(Math.abs(st.rotY - Math.atan2(st.nx, st.nz)) < 1e-12);
    if (!bySeg.has(st.seg)) bySeg.set(st.seg, []);
    bySeg.get(st.seg).push(st);
  }
  for (const [i, list] of bySeg) {
    const seg = segs[i];
    if (seg.cells.length === 1) {
      assert.equal(list.length, 1);
      const [row, col] = seg.cells[0];
      const st = list[0];
      assert.ok((col + 0.5 - seg.x) * st.nx + (row + 0.5 - seg.z) * st.nz > 0);
    } else {
      assert.equal(list.length, 2);
      assert.ok(list[0].nx === -list[1].nx && list[0].nz === -list[1].nz);
    }
  }
  assert.equal(bySeg.size, segs.length);
});

// ---------- Task 6: 光柱 ----------
test('beamPulse stays in [0.7, 1]', () => {
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 10; t += 0.01) { const v = beamPulse(t); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= 0.7 - 1e-12 && hi <= 1 + 1e-12 && lo < 0.71 && hi > 0.99);
  assert.equal(BEAM_RADIUS, 0.35);
  assert.equal(BEAM_HEIGHT, 6);
  assert.equal(SPARK_COUNT, 20);
});

// ---------- Task 8: 通关彩带 ----------
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('confetti constants', () => {
  assert.equal(CONFETTI_COUNT, 120);
  assert.equal(CONFETTI_HOLD, 2.5);
  assert.equal(CONFETTI_FADE, 0.5);
});

test('createConfetti makes n pieces above the screen', () => {
  const s = createConfetti(120, 800, 600, lcg(1));
  assert.equal(s.t, 0);
  assert.equal(s.pieces.length, 120);
  for (const p of s.pieces) {
    assert.ok(p.y >= -300 && p.y <= 0, `y=${p.y}`);
    assert.ok(p.x >= 0 && p.x <= 800, `x=${p.x}`);
    for (const k of ['x', 'y', 'vx', 'vy', 'rot', 'vr', 'w', 'h']) assert.ok(Number.isFinite(p[k]), k);
    assert.equal(typeof p.color, 'string');
  }
});

test('confettiStep holds, fades and finishes', () => {
  let s = createConfetti(120, 800, 600, lcg(2));
  while (s.t < 1 - 1e-9) s = confettiStep(s, 1 / 60, 600);
  assert.equal(s.done, false);
  assert.equal(s.alpha, 1);
  while (s.t < 3.0) s = confettiStep(s, 1 / 60, 600);
  assert.equal(s.done, true);
  assert.equal(s.alpha, 0);
});

test('confettiStep finishes when all pieces fell below the screen', () => {
  const s = createConfetti(120, 800, 600, lcg(3));
  const low = { ...s, pieces: s.pieces.map((p) => ({ ...p, y: 700 })) };
  assert.equal(confettiStep(low, 0.016, 600).done, true);
});

test('confettiStep does not mutate its input', () => {
  const s = createConfetti(120, 800, 600, lcg(4));
  const y0 = s.pieces[0].y;
  const t0 = s.t;
  const n = confettiStep(s, 0.1, 600);
  assert.equal(s.pieces[0].y, y0);
  assert.equal(s.t, t0);
  assert.notEqual(n.pieces[0].y, y0);
});

// ---------- 评审 r1：前瞻不能让墙挡住小人 ----------
const SIGHT_DEG = Math.PI / 180;

function sightSetup(seed, size, row, col, fogRadius) {
  const conn = new MazeGenerator(size, size, seed).generate().connections;
  const segs = wallSegments(conn);
  const boxes3d = wallBoxes3d(segmentBoxes(segs));
  const visible = segs.filter((s) => wallInView(s, { row, col }, fogRadius));
  const sight = wallBoxes3d(segmentBoxes(visible), WALL_HEIGHT, 0);
  return { boxes3d, sight, player: { x: col + 0.5, z: row + 0.5 } };
}

function followDist(fogRadius, zoom) {
  const o = followOffset(fogRadius);
  return Math.hypot(o.h, o.d) * zoom;
}

function playerSeen(player, ahead, yaw, pitch, dist, boxes3d, sight) {
  const cam = followCameraFor(lookAheadTarget(player, yaw, ahead), yaw, pitch, dist, boxes3d);
  return PLAYER_SIGHT_HEIGHTS.every((y) => !segmentBlocked(cam, { x: player.x, y, z: player.z }, sight));
}

test('followLookAhead shortens look-ahead when a wall would hide the player', () => {
  // 评审给出的场景：seed 12345、10×10、(0,1)、yaw 225°、pitch 15°、视野 1、缩放 0.7
  const { boxes3d, sight, player } = sightSetup(12345, 10, 0, 1, 1);
  const yaw = 225 * SIGHT_DEG;
  const pitch = 15 * SIGHT_DEG;
  const dist = followDist(1, 0.7);
  assert.equal(playerSeen(player, LOOK_AHEAD, yaw, pitch, dist, boxes3d, sight), false); // 原实现被挡
  const ahead = followLookAhead(player, yaw, pitch, dist, boxes3d, sight);
  assert.ok(ahead < LOOK_AHEAD);
  assert.equal(playerSeen(player, ahead, yaw, pitch, dist, boxes3d, sight), true);
});

test('followLookAhead keeps full look-ahead in the open start view', () => {
  const { boxes3d, sight, player } = sightSetup(12345, 10, 0, 0, 5);
  assert.equal(followLookAhead(player, startYaw(10), 40 * SIGHT_DEG, followDist(5, 1), boxes3d, sight), LOOK_AHEAD);
});

test('followLookAhead result always sees the player (sweep)', () => {
  const steps = new Set(LOOK_AHEAD_STEPS);
  assert.equal(LOOK_AHEAD_STEPS[0], LOOK_AHEAD);
  assert.equal(LOOK_AHEAD_STEPS[LOOK_AHEAD_STEPS.length - 1], 0);
  let shortened = 0;
  for (const [fogRadius, zoom] of [[1, 0.7], [5, 1], [25, 1.5]]) {
    for (let row = 0; row < 10; row += 3) {
      for (let col = 0; col < 10; col += 3) {
        const { boxes3d, sight, player } = sightSetup(12345, 10, row, col, fogRadius);
        const dist = followDist(fogRadius, zoom);
        for (let yd = 0; yd < 360; yd += 45) {
          for (const pd of [15, 40, 75]) {
            const yaw = yd * SIGHT_DEG;
            const pitch = pd * SIGHT_DEG;
            const ahead = followLookAhead(player, yaw, pitch, dist, boxes3d, sight);
            assert.ok(steps.has(ahead));
            if (ahead < LOOK_AHEAD) shortened += 1;
            if (ahead > 0) {
              assert.ok(
                playerSeen(player, ahead, yaw, pitch, dist, boxes3d, sight),
                `(${row},${col}) yaw ${yd} pitch ${pd} r ${fogRadius}`,
              );
            }
          }
        }
      }
    }
  }
  assert.ok(shortened > 0);
});

// ---------- 评审 r1：终点箭头避开小地图 ----------
test('avoidRect moves a point out of the rect along the shorter way', () => {
  const rect = { left: 752, top: 8, right: 892, bottom: 148 };
  // 右边框上的箭头：向下移出更近，仍在右边框上
  assert.deepEqual(avoidRect({ x: 872, y: 31 }, rect, 28), { x: 872, y: 176 });
  // 上边框上的箭头：向左移出更近，仍在上边框上
  assert.deepEqual(avoidRect({ x: 800, y: 28 }, rect, 28), { x: 724, y: 28 });
  // 外扩 pad 之后才算碰到
  assert.deepEqual(avoidRect({ x: 730, y: 100 }, rect, 28), { x: 724, y: 100 });
  // 不碰到就原样返回，且不改入参
  const p = { x: 500, y: 31 };
  assert.deepEqual(avoidRect(p, rect, 28), { x: 500, y: 31 });
  assert.deepEqual(avoidRect(p, null, 28), { x: 500, y: 31 });
  assert.deepEqual(p, { x: 500, y: 31 });
});
