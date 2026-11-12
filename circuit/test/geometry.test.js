import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID, rotatePoint, terminalPoint, hitTest, wireRoute, snap, touchAreas } from '../lib/geometry.js';
import { build } from './helpers.js';

test('rotation is clockwise in screen coords', () => {
  const z = p => p.map(v => v + 0); // 把 -0 规整成 0
  assert.deepEqual(z(rotatePoint([2, 0], 1)), [0, 2]);
  assert.deepEqual(z(rotatePoint([2, 0], 2)), [-2, 0]);
});

test('terminalPoint follows position and rotation', () => {
  const p = { id: 'L', type: 'lamp', x: 10, y: 8, rot: 1, params: {} };
  assert.deepEqual(terminalPoint(p, 'a').map(v => v + 0), [10, 6]);
});

test('touch areas stay >= 44 screen px at any scale and never overlap', () => {
  for (const k of [1.2, 1, 0.9, 0.8, 0.6]) {
    const { termR, lever, body } = touchAreas(k);
    const px = g => g * GRID * k; // 格 → 屏幕像素
    for (const r of [lever, body]) {
      assert.ok(px(r.x1 - r.x0) >= 44 - 1e-9 && px(r.y1 - r.y0) >= 44 - 1e-9, `k=${k}`);
    }
    assert.ok(px(termR * 2) >= 44 - 1e-9, `k=${k} term`);
    assert.ok(lever.y1 <= body.y0, `k=${k} disjoint`);
  }
});

test('hitTest honours scale: point outside base rect but inside scaled area hits at k=0.6', () => {
  const c = build({ parts: { S: ['switch'] }, wires: [] });
  c.parts[0].x = 5; c.parts[0].y = 5;
  assert.equal(hitTest(c, [5, 3.1]), null);                      // k=1：拨片 y0 = −1.8 → 绝对 3.2，点在外
  assert.deepEqual(hitTest(c, [5, 3.1], 0.6), { kind: 'lever', id: 'S' });
  assert.deepEqual(hitTest(c, [5, 6.1], 0.6), { kind: 'part', id: 'S' });
});

test('hitTest priority and lever only on switches', () => {
  const c = build({ parts: { S: ['switch'], L: ['lamp'] }, wires: [] });
  const [s, l] = c.parts;
  s.x = 5; s.y = 5; l.x = 15; l.y = 5;
  assert.deepEqual(hitTest(c, [5, 4]), { kind: 'lever', id: 'S' });
  assert.deepEqual(hitTest(c, [5, 5]), { kind: 'part', id: 'S' });
  assert.deepEqual(hitTest(c, [3, 5]), { kind: 'terminal', part: 'S', term: 'a' });
  assert.equal(hitTest(c, [15, 4]), null);
  s.rot = 1;
  assert.deepEqual(hitTest(c, [6, 5]), { kind: 'lever', id: 'S' });
});

test('wire hit and route', () => {
  assert.deepEqual(wireRoute([1, 1], [4, 3]), [[1, 1], [4, 1], [4, 3]]);
  assert.deepEqual(wireRoute([1, 1], [4, 1]), [[1, 1], [4, 1]]);
  assert.deepEqual(snap([0.4, 30.6]), [3, 15]);
});

test('hitTest finds a wire 0.3 grid from its midpoint', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  const [b, l] = c.parts;
  b.x = 5; b.y = 5; l.x = 15; l.y = 10;
  // B.p = (3,5)，L.a = (13,10)；走线 (3,5)→(13,5)→(13,10)，水平段中点 (8,5)
  assert.deepEqual(hitTest(c, [8, 5.3]), { kind: 'wire', id: 'w1' });
  assert.equal(hitTest(c, [8, 6.2]), null);
});

test('a wire across one part detours around the body so it stays selectable', () => {
  const c = build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] });
  c.parts[0].x = 6; c.parts[0].y = 8;
  assert.deepEqual(hitTest(c, [6, 9.5]), { kind: 'wire', id: 'w1' });
  c.parts[0].rot = 1;
  assert.deepEqual(hitTest(c, [4.5, 8]), { kind: 'wire', id: 'w1' });
});
