import test from 'node:test';
import assert from 'node:assert/strict';
import { startTrace, stepTrace, tracePath, BOARD } from '../lib/geometry.js';

const run = (start, samples) => samples.reduce(stepTrace, startTrace(start));
const ortho = pts => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);
const onGrid = pts => pts.slice(1, -1).every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)
  && x >= 0 && x <= BOARD.w && y >= 0 && y <= BOARD.h);

test('straight drag has no corners', () => {
  const t = run([3, 5], [[4, 5.2], [6, 4.8], [9, 5.3], [12, 5.1]]);
  assert.deepEqual(tracePath(t, [13, 5]), [[3, 5], [13, 5]]);
});

test('jitter under one grid makes no corners', () => {
  const t = run([3, 5], [[4, 5.6], [6, 4.3], [8, 5.9], [10, 4.2]]);
  assert.equal(t.pts.length, 1);
  assert.deepEqual(tracePath(t, [13, 5]), [[3, 5], [13, 5]]);
});

test('L and U shapes', () => {
  const l = run([3, 5], [[5, 5], [8, 5.1], [8.2, 6.3], [8.1, 9], [8, 11]]);
  assert.deepEqual(tracePath(l, [8, 12]), [[3, 5], [8, 5], [8, 12]]);
  const u = run([3, 5], [[6, 5], [9, 5], [9.1, 6.2], [9, 9], [7.6, 9.2], [5, 9], [4, 9]]);
  const p = tracePath(u, [4, 7]);
  assert.deepEqual(p, [[3, 5], [9, 5], [9, 9], [4, 9], [4, 7]]);
  assert.ok(ortho(p) && onGrid(p));
});

test('backtracking onto the drawn segment eats the corner', () => {
  const t = run([3, 5], [[6, 5], [9, 5], [9.1, 6.2], [9, 8], [9, 5.3], [11, 5.1]]);
  assert.deepEqual(tracePath(t, [12, 5]), [[3, 5], [12, 5]]);
});

test('returning to the start cell resets to the plain L', () => {
  const t = run([3, 5], [[8, 5], [3.3, 5.2]]);
  assert.equal(t.dir, null);
  assert.deepEqual(tracePath(t, [8, 9]), [[3, 5], [8, 5], [8, 9]]);
});

test('one big jump gives a single corner; corners stay on the board', () => {
  assert.deepEqual(tracePath(run([3, 5], [[10, 9]]), [10, 9]), [[3, 5], [10, 5], [10, 9]]);
  const far = run([3, 5], [[10, 5], [40.4, 7]]);
  assert.ok(onGrid(tracePath(far, [28, 7])));
});
