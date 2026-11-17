import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID, BOARD } from '../lib/geometry.js';
import { HOME, MAX_ZOOM, MIN_GRID_PX, fitView, clampView, viewBox, zoomAt, panBy, zoomLimits, contentRect } from '../lib/viewport.js';

const size = { w: 1132, h: 732 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('board is larger than the home view', () => {
  assert.ok(BOARD.w * GRID > HOME.w && BOARD.h * GRID > HOME.h);
});

test('home view shows the old 28x18 board at scale 1', () => {
  const v = fitView(HOME, size);
  near(v.k, 1);
  const [x, y, w, h] = viewBox(v, size);
  near(x, -6); near(y, -6); near(w, 1132); near(h, 732);
});

test('zoomAt keeps the point under the pointer fixed', () => {
  const v = fitView(HOME, size);
  const p = [300, 200];
  const before = viewBox(v, size);
  const z = zoomAt(v, 2, p, size);
  const after = viewBox(z, size);
  near(z.k, 2);
  near(before[0] + p[0] / v.k, after[0] + p[0] / z.k);
  near(before[1] + p[1] / v.k, after[1] + p[1] / z.k);
});

test('zoom is clamped between the whole board and MAX_ZOOM of the home view', () => {
  const v = fitView(HOME, size);
  const { min, max } = zoomLimits(size);
  near(zoomAt(v, 100, [0, 0], size).k, max);
  near(max, MAX_ZOOM);
  near(min, fitView({ x: 0, y: 0, w: BOARD.w * GRID, h: BOARD.h * GRID }, size).k);
  near(zoomAt(v, 0.01, [0, 0], size).k, min);
});

test('fully zoomed out the whole board fits, on wide and tall screens alike', () => {
  for (const s of [size, { w: 1900, h: 900 }, { w: 800, h: 1000 }]) {
    const out = zoomAt(fitView(HOME, s), 0.01, [0, 0], s);
    const [x, y, w, h] = viewBox(out, s);
    assert.ok(x <= 0 && y <= 0 && x + w >= BOARD.w * GRID && y + h >= BOARD.h * GRID);
  }
});

test('on a small screen grid cells stay at least MIN_GRID_PX wide', () => {
  const small = { w: 400, h: 300 };
  near(zoomLimits(small).min * GRID, MIN_GRID_PX);
});

test('a tall circuit fits on a wide screen', () => {
  const wide = { w: 1900, h: 900 };
  const r = contentRect([[3, 3], [40, 41]]);
  const [x, y, w, h] = viewBox(clampView(fitView(r, wide), wide), wide);
  assert.ok(x <= r.x && y <= r.y && x + w >= r.x + r.w && y + h >= r.y + r.h);
});

test('panBy moves the view opposite to the finger and stays on the board', () => {
  const v = clampView({ cx: 1000, cy: 600, k: 2 }, size);
  const p = panBy(v, 100, 50, size);
  near(p.cx, v.cx - 50); near(p.cy, v.cy - 25);
  const far = panBy(v, 1e6, 1e6, size);
  const [x, y] = viewBox(far, size);
  near(x, 0); near(y, 0);
});

test('contentRect never zooms closer than home', () => {
  assert.deepEqual(contentRect([]), HOME);
  const r = contentRect([[10, 8], [12, 9]]);
  assert.ok(r.w >= HOME.w && r.h >= HOME.h);
  near(r.x + r.w / 2, 11 * GRID);
  const big = contentRect([[2, 2], [45, 28]]);
  near(big.w, 49 * GRID);
});
