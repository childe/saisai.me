import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startYaw } from '../maze-3d/effects.js';

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
