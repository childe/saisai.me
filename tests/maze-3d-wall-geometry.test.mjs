import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wallGroupLayout, wallUvScale, applyWallUvs } from '../maze-3d/wall-geometry.js';

const here = dirname(fileURLToPath(import.meta.url));

test('group layout puts top face last', () => {
  const idx = Array.from({ length: 36 }, (_, i) => i);
  const { index, groups } = wallGroupLayout(idx);
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  assert.deepEqual(index, [...range(0, 12), ...range(18, 36), ...range(12, 18)]);
  assert.deepEqual(groups, [
    { start: 0, count: 30, materialIndex: 0 },
    { start: 30, count: 6, materialIndex: 1 },
  ]);
});

test('uv scale by world size', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  for (const f of [0, 1]) {
    const [u, v] = wallUvScale(f);
    close(u, 0.1 / 1.1);
    close(v, 1);
  }
  for (const f of [2, 3]) {
    const [u, v] = wallUvScale(f);
    close(u, 1);
    close(v, 0.125);
  }
  for (const f of [4, 5]) assert.deepEqual(wallUvScale(f), [1, 1]);
});

test('applyWallUvs scales in place', () => {
  const uv = new Float32Array(48).fill(1);
  applyWallUvs(uv);
  assert.ok(Math.abs(uv[0] - 0.1 / 1.1) < 1e-6 && uv[1] === 1); // px 顶点 0
  assert.ok(uv[16] === 1 && Math.abs(uv[17] - 0.125) < 1e-6); // py 顶点 8
  assert.ok(uv[32] === 1 && uv[33] === 1); // pz 顶点 16
});

test('wall-geometry.js has no imports', () => {
  assert.doesNotMatch(readFileSync(join(here, '..', 'maze-3d', 'wall-geometry.js'), 'utf8'), /\bimport\b/);
});
