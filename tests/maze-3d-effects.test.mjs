import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startYaw, LOOK_AHEAD, lookAheadTarget, segmentBlocked } from '../maze-3d/effects.js';
import { slabInterval, wallBoxes3d, segmentBoxes, WALL_HEIGHT } from '../maze-3d/movement.js';

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
