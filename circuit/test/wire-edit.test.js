import test from 'node:test';
import assert from 'node:assert/strict';
import { addWire, setWireVia, splitWire, resolveEnd, removeWire, removePart } from '../lib/circuit.js';
import { wirePoints, nearestOnRoute, rotatePoint, terminalPoint, simplifyRoute } from '../lib/geometry.js';
import { solve } from '../lib/solve.js';
import { partVisual } from '../lib/viewmodel.js';
import { createDamage } from '../lib/damage.js';
import { PHYS } from '../lib/parts.js';
import { build } from './helpers.js';

const norm = pts => pts.map(p => p.map(v => v + 0));
const route = (c, id) => norm(wirePoints(c, c.wires.find(w => w.id === id)));
const nodeWires = (c, n) => c.wires.filter(w => w.a.part === n || w.b.part === n);
// 两段拼接后多出分割点 P（共线中间点），先去共线点再与原路线比较
const joined = (c, h1, h2) => norm(simplifyRoute([...route(c, h1.id), ...route(c, h2.id).slice(1)]));
// B(5,5) p=(3,5) n=(7,5)；L(15,10) a=(13,10) b=(17,10)；w1: B.p→L.a 路线 (3,5)→(13,5)→(13,10)
const bl = (type = 'lamp', t = ['a', 'b']) => {
  const c = build({ parts: { B: ['battery'], L: [type] }, wires: [['B.p', `L.${t[0]}`], [`L.${t[1]}`, 'B.n']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  return c;
};

test('addWire stores via only when given', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [] });
  const r1 = addWire(c, { part: 'B', term: 'p' }, { part: 'L', term: 'a' });
  assert.equal('via' in r1.circuit.wires[0], false);
  const r2 = addWire(c, { part: 'B', term: 'p' }, { part: 'L', term: 'a' }, [[3, 8]]);
  assert.deepEqual(r2.circuit.wires[0].via, [[3, 8]]);
});

test('setWireVia is a no-op for the same via', () => {
  const c = bl(); c.wires[0].via = [[13, 5]];
  assert.equal(setWireVia(c, 'w1', [[13, 5]]), c);
  const d = setWireVia(c, 'w1', [[3, 8], [13, 8]]);
  assert.deepEqual(d.wires[0].via, [[3, 8], [13, 8]]);
  assert.equal(d.topoRev, c.topoRev);
});

test('splitWire keeps the route and halves r; refuses endpoints', () => {
  const c = bl();
  const before = route(c, 'w1');
  const s = splitWire(c, 'w1', [8, 5]);
  const n = s.circuit.parts.find(p => p.id === s.node);
  assert.deepEqual([n.type, n.x, n.y], ['node', 8, 5]);
  const [h1, h2] = s.circuit.wires.slice(0, 2);
  assert.deepEqual([h1.a, h1.b, h2.a, h2.b], [{ part: 'B', term: 'p' }, { part: s.node, term: 'o' }, { part: s.node, term: 'o' }, { part: 'L', term: 'a' }]);
  assert.deepEqual([h1.r, h2.r], [PHYS.R_WIRE / 2, PHYS.R_WIRE / 2]);
  assert.deepEqual(route(s.circuit, h1.id), [[3, 5], [8, 5]]);
  assert.deepEqual(route(s.circuit, h2.id), [[8, 5], [13, 5], [13, 10]]);
  assert.deepEqual(joined(s.circuit, h1, h2), before);
  assert.equal(splitWire(c, 'w1', [3, 5]), null);
  assert.equal(splitWire(c, 'w1', [8, 6]), null);
});

test('resolveEnd splits mid-wire and reuses endpoints', () => {
  const c = bl();
  assert.deepEqual(resolveEnd(c, { wire: 'w1', at: [3, 5] }).end, { part: 'B', term: 'p' });
  const r = resolveEnd(c, { wire: 'w1', at: [8.3, 5.2] });
  assert.equal(r.circuit.parts.at(-1).type, 'node');
  assert.deepEqual(r.end, { part: r.circuit.parts.at(-1).id, term: 'o' });
  assert.equal(resolveEnd(c, { wire: 'nope', at: [8, 5] }), null);
});

test('removing a two-wire node merges back with summed r', () => {
  const c = bl();
  const s = splitWire(c, 'w1', [8, 5]);
  const m = removePart(s.circuit, s.node);
  assert.equal(m.parts.some(p => p.type === 'node'), false);
  assert.equal(m.wires.length, 2);
  assert.deepEqual([m.wires[0].a, m.wires[0].b], [{ part: 'B', term: 'p' }, { part: 'L', term: 'a' }]);
  assert.equal(m.wires[0].r, PHYS.R_WIRE);
  assert.deepEqual(route(m, m.wires[0].id), route(c, 'w1'));
});

test('same-part U wire: split on each segment and merge, all four rotations', () => {
  for (let rot = 0; rot < 4; rot++) {
    const c = build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] });
    Object.assign(c.parts[0], { x: 10, y: 9, rot });
    const orig = route(c, 'w1');
    const p1 = terminalPoint(c.parts[0], 'p');
    const onLeg = rotatePoint([0, 1], rot).map((v, i) => p1[i] + v);
    const midBottom = [(orig[1][0] + orig[2][0]) / 2, (orig[1][1] + orig[2][1]) / 2];
    for (const at of [midBottom, onLeg]) {
      const P = nearestOnRoute(orig, at).P;
      const s = splitWire(c, 'w1', P);
      assert.ok(s, `rot=${rot} at=${at}`);
      const [h1, h2] = s.circuit.wires;
      assert.deepEqual(route(s.circuit, h1.id).at(-1), norm([P])[0], `rot=${rot} h1 ends at P`);
      assert.deepEqual(route(s.circuit, h2.id)[0], norm([P])[0], `rot=${rot} h2 starts at P`);
      assert.deepEqual(joined(s.circuit, h1, h2), orig, `rot=${rot}`);
      const m = removePart(s.circuit, s.node);
      assert.deepEqual(route(m, m.wires[0].id), orig, `rot=${rot} merged`);
    }
  }
});

test('adding then removing nodes keeps solver readings (lamp and ammeter loops)', () => {
  for (const [type, t] of [['lamp', ['a', 'b']], ['ammeter', ['p', 'n']]]) {
    const c0 = bl(type, t);
    const r0 = solve(c0);
    const text = (c, r) => partVisual(c.parts.find(p => p.id === 'L'), r.parts.L, createDamage(), true).text;
    let c = c0;
    const nodes = [];
    // 1) 原导线 (10,5)；2) 后半段 (13,8)；3) 前半段（已分出的半段）(6,5)
    for (const [pick, P] of [[0, [10, 5]], [1, [13, 8]], [0, [6, 5]]]) {
      const s = splitWire(c, c.wires[pick].id, P);
      c = s.circuit; nodes.push(s.node);
      const r = solve(c);
      for (const id of ['B', 'L']) for (const k of ['v', 'i', 'p'])
        assert.ok(Math.abs(r.parts[id][k] - r0.parts[id][k]) <= 1e-9 * Math.abs(r0.parts[id][k]), `${type} ${id}.${k}`);
      assert.equal(text(c, r), text(c0, r0));
    }
    for (const n of nodes) c = removePart(c, n);
    assert.equal(c.wires[0].r, PHYS.R_WIRE);
    const r1 = solve(c);
    assert.deepEqual(r1.parts, r0.parts);
    assert.deepEqual(r1.nodes, r0.nodes);
  }
});

test('merging two separately drawn wires sums to 2 × R_WIRE', () => {
  const c = build({ parts: { B: ['battery'], N: ['node'], L: ['lamp'] }, wires: [['B.p', 'N.o'], ['N.o', 'L.a'], ['L.b', 'B.n']] });
  c.parts[1].y = 9;
  const m = removePart(c, 'N');
  assert.equal(m.wires[0].r, 2 * PHYS.R_WIRE);
  const a = solve(c), b = solve(m);
  for (const id of ['B', 'L']) for (const k of ['v', 'i', 'p'])
    assert.ok(Math.abs(a.parts[id][k] - b.parts[id][k]) <= 1e-9 * Math.abs(a.parts[id][k]));
});

test('removing a node with three wires deletes it and its wires', () => {
  const c = build({ parts: { B: ['battery'], N: ['node'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'N.o'], ['N.o', 'L1.a'], ['N.o', 'L2.a'], ['L1.b', 'B.n']] });
  const m = removePart(c, 'N');
  assert.equal(m.parts.some(p => p.id === 'N'), false);
  assert.deepEqual(m.wires.map(w => w.id), ['w4']);
});

test('removing a node whose two wires meet the same terminal deletes everything', () => {
  const c = build({ parts: { B: ['battery'], N: ['node'] }, wires: [['B.p', 'N.o'], ['N.o', 'B.p']] });
  const m = removePart(c, 'N');
  assert.equal(m.parts.some(p => p.id === 'N'), false);
  assert.equal(m.wires.length, 0);
});

test('removeWire prunes a node only when it has no wires left', () => {
  const s = splitWire(bl(), 'w1', [8, 5]);
  const [h1, h2] = s.circuit.wires;
  const c1 = removeWire(s.circuit, h1.id);
  assert.ok(c1.parts.some(p => p.id === s.node));
  const c2 = removeWire(c1, h2.id);
  assert.equal(c2.parts.some(p => p.id === s.node), false);
});

test('removePart prunes nodes left without wires', () => {
  // N1 只连 L；N2 连 L 和 B。删 L 后 N1 无导线被清理，N2 保留。
  const c = build({ parts: { B: ['battery'], L: ['lamp'], N1: ['node'], N2: ['node'] },
    wires: [['L.a', 'N1.o'], ['L.b', 'N2.o'], ['N2.o', 'B.n']] });
  const m = removePart(c, 'L');
  assert.deepEqual(m.parts.map(p => p.id), ['B', 'N2']);
  assert.equal(nodeWires(m, 'N2').length, 1);
});
