import test from 'node:test';
import assert from 'node:assert/strict';
import { wirePoints, expandRoute, simplifyRoute, nearestOnRoute, splitRoute, joinRoute } from '../lib/geometry.js';
import { build } from './helpers.js';

const norm = pts => pts.map(p => p.map(v => v + 0));
const ortho = pts => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);
// B(5,5): p=(3,5) n=(7,5)；L(15,10): a=(13,10) b=(17,10)
const bl = (via) => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  if (via) c.wires[0].via = via;
  return c;
};

test('auto routes are unchanged (L and same-part U)', () => {
  const c = bl();
  assert.deepEqual(wirePoints(c, c.wires[0]), [[3, 5], [13, 5], [13, 10]]);
  assert.equal(expandRoute, wirePoints);
  const u = build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] });
  u.parts[0].x = 6; u.parts[0].y = 8;
  assert.deepEqual(norm(wirePoints(u, u.wires[0])), [[4, 8], [4, 9.5], [8, 9.5], [8, 8]]);
});

test('explicit via routes through corners and stays orthogonal after move/rotate', () => {
  const c = bl([[3, 12]]);
  assert.deepEqual(wirePoints(c, c.wires[0]), [[3, 5], [3, 12], [13, 12], [13, 10]]);
  c.parts[1].x = 17;
  assert.deepEqual(wirePoints(c, c.wires[0]), [[3, 5], [3, 12], [15, 12], [15, 10]]);
  c.parts[1].rot = 1;
  const pts = norm(wirePoints(c, c.wires[0]));
  assert.ok(ortho(pts), JSON.stringify(pts));
  assert.deepEqual(pts.at(-1), [17, 8]);
});

test('via [] on the same part is a straight route, not a U', () => {
  const u = build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] });
  u.parts[0].x = 6; u.parts[0].y = 8; u.wires[0].via = [];
  assert.deepEqual(wirePoints(u, u.wires[0]), [[4, 8], [8, 8]]);
});

test('simplifyRoute drops duplicates and collinear points', () => {
  assert.deepEqual(simplifyRoute([[3, 5], [3, 5], [8, 5], [13, 5], [13, 10]]), [[3, 5], [13, 5], [13, 10]]);
  assert.deepEqual(simplifyRoute([[2, 2], [2, 2]]), [[2, 2], [2, 2]]);
});

test('nearestOnRoute snaps along the segment only', () => {
  const pts = [[3, 5], [13, 5], [13, 10]];
  assert.deepEqual(nearestOnRoute(pts, [8.4, 5.3]), { seg: 0, P: [8, 5] });
  assert.deepEqual(nearestOnRoute(pts, [12.8, 7.6]), { seg: 1, P: [13, 8] });
  const u = [[4, 8], [4, 9.5], [8, 9.5], [8, 8]];
  assert.deepEqual(nearestOnRoute(u, [6.2, 9.7]), { seg: 1, P: [6, 9.5] });
  assert.deepEqual(nearestOnRoute(u, [4.2, 8.6]), { seg: 0, P: [4, 9] });
});

test('splitRoute / joinRoute', () => {
  const pts = [[3, 5], [13, 5], [13, 10]];
  assert.deepEqual(splitRoute(pts, [8, 5]), { via1: [], via2: [[13, 5]] });
  assert.deepEqual(splitRoute(pts, [13, 5]), { via1: [], via2: [] });
  assert.deepEqual(splitRoute(pts, [13, 8]), { via1: [[13, 5]], via2: [] });
  assert.equal(splitRoute(pts, [3, 5]), null);
  assert.equal(splitRoute(pts, [13, 10]), null);
  assert.equal(splitRoute(pts, [8, 6]), null);
  assert.deepEqual(joinRoute([[3, 5], [8, 5]], [[8, 5], [13, 5], [13, 10]]), [[13, 5]]);
  assert.deepEqual(joinRoute([[3, 5], [13, 5], [13, 8]], [[13, 8], [13, 10]]), [[13, 5]]);
});

test('splitRoute keeps a later corner that revisits the split point', () => {
  // 端点拖线可生成两次经过 (8,5) 的路线；只去掉分割处紧邻的那一个，后面再次经过的拐点保留
  const pts = [[3, 5], [8, 5], [8, 2], [4, 2], [4, 10], [8, 10], [8, 5], [13, 5], [13, 12]];
  const sp = splitRoute(pts, [8, 5]);
  assert.deepEqual(sp, { via1: [], via2: [[8, 2], [4, 2], [4, 10], [8, 10], [8, 5], [13, 5]] });
  // 两段重新拼接后与原路线一致
  const merged = joinRoute([pts[0], ...sp.via1, [8, 5]], [[8, 5], ...sp.via2, pts.at(-1)]);
  assert.deepEqual(merged, pts.slice(1, -1));
  // 在第二次经过的线段内部分割，同样保持路线
  const sp2 = splitRoute(pts, [6, 10]);
  assert.deepEqual(sp2, { via1: [[8, 5], [8, 2], [4, 2], [4, 10]], via2: [[8, 10], [8, 5], [13, 5]] });
});
