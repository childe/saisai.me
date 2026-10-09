import test from 'node:test';
import assert from 'node:assert/strict';
import { contourPoints, RANGE, PAD } from '../tone-plot.js';

const W = 300;
const H = 140;

test('空曲线给出空点集', () => {
  assert.deepEqual(contourPoints(null, W, H), []);
  assert.deepEqual(contourPoints([], W, H), []);
});

test('点数与曲线点数一致', () => {
  assert.equal(contourPoints(new Array(20).fill(0), W, H).length, 20);
});

test('横向铺满画布的可用宽度', () => {
  const pts = contourPoints(new Array(20).fill(0), W, H);
  assert.equal(pts[0].x, PAD);
  assert.equal(pts[19].x, W - PAD);
});

test('0 半音画在垂直中线上', () => {
  assert.ok(contourPoints(new Array(20).fill(0), W, H).every((p) => p.y === H / 2));
});

test('音高越高画得越靠上', () => {
  const high = contourPoints(new Array(20).fill(5), W, H)[0].y;
  const low = contourPoints(new Array(20).fill(-5), W, H)[0].y;
  assert.ok(high < H / 2, '正半音应在中线上方');
  assert.ok(low > H / 2, '负半音应在中线下方');
});

test('超出量程的值被夹住，不画到画布外', () => {
  const pts = contourPoints([RANGE * 5, -RANGE * 5], W, H);
  assert.ok(pts.every((p) => p.y >= PAD && p.y <= H - PAD),
    '越界点: ' + JSON.stringify(pts));
});

test('单点曲线不产生 NaN', () => {
  assert.ok(contourPoints([0], W, H).every((p) =>
    Number.isFinite(p.x) && Number.isFinite(p.y)));
});
