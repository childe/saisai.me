import test from 'node:test';
import assert from 'node:assert/strict';
import { dragSegment, hitTest } from '../lib/geometry.js';
import { build } from './helpers.js';

const Z = [[3, 5], [8, 5], [8, 10], [13, 10]];

// 第三个参数是指针相对按下位置的位移 delta，不是绝对坐标
test('dragSegment moves a middle segment perpendicular by the pointer delta and snaps', () => {
  assert.deepEqual(dragSegment(Z, 1, [2.4, 1.3]), [[10, 5], [10, 10]]);
  assert.deepEqual(dragSegment(Z, 1, [0.2, -2]), [[8, 5], [8, 10]]);
  assert.deepEqual(dragSegment(Z, 1, [-4.9, 0]), [[3, 10]]);
});

test('dragSegment on the first / last / only segment keeps endpoints fixed', () => {
  assert.deepEqual(dragSegment(Z, 0, [0.6, -1.8]), [[3, 3], [8, 3], [8, 10]]);
  assert.deepEqual(dragSegment(Z, 2, [-2, 2.4]), [[8, 5], [8, 12], [13, 12]]);
  assert.deepEqual(dragSegment([[3, 5], [13, 5]], 0, [0, 2]), [[3, 7], [13, 7]]);
  assert.deepEqual(dragSegment([[3, 5], [13, 5]], 0, [0, 35]), [[3, 18], [13, 18]]);
});

test('pressing off the handle centre and moving only along the segment keeps the route', () => {
  // 在首段把手 (5.5,5) 下方约 0.5 格按下后只水平移动：delta.y 为 0 或很小，路线不变
  // （若按绝对坐标取整，按下点 y≈5.5 会让线段跳到 y=6）
  assert.deepEqual(dragSegment(Z, 0, [3, 0]), [[8, 5], [8, 10]]);
  assert.deepEqual(dragSegment(Z, 0, [-1, 0.4]), [[8, 5], [8, 10]]);
  // 在中段（竖直）把手右侧按下后只上下移动：delta.x 为 0，路线不变
  assert.deepEqual(dragSegment(Z, 1, [0, 3]), [[8, 5], [8, 10]]);
});

// B(5,5) p=(3,5)；L(15,10) a=(13,10)；路线 (3,5)→(13,5)→(13,10)，中点 (8,5)、(13,7.5)
const bl = () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  return c;
};

test('handles only exist on the selected wire', () => {
  const c = bl();
  assert.deepEqual(hitTest(c, [8, 5]), { kind: 'wire', id: 'w1' });
  assert.deepEqual(hitTest(c, [8, 5], 1, 'w1'), { kind: 'handle', wire: 'w1', seg: 0 });
  assert.deepEqual(hitTest(c, [13.2, 7.5], 1, 'w1'), { kind: 'handle', wire: 'w1', seg: 1 });
  assert.deepEqual(hitTest(c, [11, 5.2], 1, 'w1'), { kind: 'wire', id: 'w1' });
});

test('terminal wins over a handle', () => {
  const c = bl();
  c.wires[0].via = [[3, 6], [13, 6]]; // 首段 (3,5)→(3,6)，中点 (3,5.5) 落在 B.p 触控区内
  assert.deepEqual(hitTest(c, [3, 5.4], 1, 'w1'), { kind: 'terminal', part: 'B', term: 'p' });
});

test('a node has no body to grab', () => {
  const c = build({ parts: { N: ['node'] }, wires: [] });
  c.parts[0].x = 20; c.parts[0].y = 15;
  assert.deepEqual(hitTest(c, [20.2, 15]), { kind: 'terminal', part: 'N', term: 'o' });
  assert.equal(hitTest(c, [20.9, 15]), null);
});

test('dragSegment keeps a half-grid segment in place when moved only along it (all rotations)', () => {
  // 自连导线的 U 形底边在半格上（SELF_WIRE_OFFSET=1.5）；沿线段方向拖动不应跳到整格
  const down = [[4, 8], [4, 9.5], [8, 9.5], [8, 8]]; // rot 0：底边水平 y=9.5
  assert.deepEqual(dragSegment(down, 1, [3, 0]), [[4, 9.5], [8, 9.5]]);
  assert.deepEqual(dragSegment(down, 1, [-2, 0.3]), [[4, 9.5], [8, 9.5]]);
  assert.deepEqual(dragSegment(down, 1, [0, 1.2]), [[4, 10.5], [8, 10.5]]);
  const up = [[8, 8], [8, 6.5], [4, 6.5], [4, 8]]; // rot 2：底边水平 y=6.5
  assert.deepEqual(dragSegment(up, 1, [2, 0]), [[8, 6.5], [4, 6.5]]);
  const left = [[6, 6], [4.5, 6], [4.5, 10], [6, 10]]; // rot 1：竖直 x=4.5
  assert.deepEqual(dragSegment(left, 1, [0, 3]), [[4.5, 6], [4.5, 10]]);
  assert.deepEqual(dragSegment(left, 1, [-1.1, 0]), [[3.5, 6], [3.5, 10]]);
  const right = [[6, 10], [7.5, 10], [7.5, 6], [6, 6]]; // rot 3：竖直 x=7.5
  assert.deepEqual(dragSegment(right, 1, [0, -2]), [[7.5, 10], [7.5, 6]]);
  // 半格线段仍限制在画布内
  assert.deepEqual(dragSegment(down, 1, [0, 30]), [[4, 17.5], [8, 17.5]]);
});
