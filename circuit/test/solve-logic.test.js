import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, relayKeyOf, connectivity } from '../lib/solve.js';
import { PARTS, PHYS } from '../lib/parts.js';
import { build } from './helpers.js';

const ON_K = { on: new Set(['K']) };

// 线圈回路 B1→K.x→K.y，触点回路 B2→K.com→K.<contact>→L
const relayLamp = contact => build({ parts: { B1: ['battery'], K: ['relay'], B2: ['battery'], L: ['lamp'] },
  wires: [['B1.p', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'K.com'], [`K.${contact}`, 'L.a'], ['L.b', 'B2.n']] });

test('new parts: terminals distinct, inside [-2,2], off the lever rect', () => {
  for (const type of ['relay', 'button', 'dpdt', 'display']) {
    const def = PARTS[type];
    const pts = def.terms.map(t => def.termPos[t]);
    assert.equal(new Set(pts.map(p => p.join(','))).size, pts.length, type);
    for (const [x, y] of pts) {
      assert.ok(x >= -2 && x <= 2 && y >= -2 && y <= 2, type);
      assert.ok(!(Math.abs(x) <= 0.6 && y >= -1.8 && y <= -0.6), type);
    }
    for (const g of def.groups ?? []) for (const t of g) assert.ok(def.terms.includes(t), type);
  }
  for (const t of ['x', 'y']) assert.equal(PARTS.relay.termPos[t][0], -2);
  for (const t of ['com', 'no', 'nc']) assert.ok(PARTS.relay.termPos[t][0] > 0);
});

test('relay coil draws current, contact follows opts.on', () => {
  const c = relayLamp('no');
  const off = solve(c);
  assert.ok(Math.abs(off.parts.K.i - 1.5 / 30.1) < 1e-3);
  assert.ok(off.parts.L.p < 1e-6);
  assert.equal(off.relayKey, '');
  const on = solve(c, new Set(), ON_K);
  assert.ok(on.parts.L.p > 0.2);
  assert.equal(on.relayKey, 'K');
});

test('relay nc conducts when released', () => {
  const c = relayLamp('nc');
  assert.ok(solve(c).parts.L.p > 0.2);
  assert.ok(solve(c, new Set(), ON_K).parts.L.p < 1e-6);
});

test('relay coil and contacts are separate components', () => {
  const find = connectivity(relayLamp('no'));
  assert.notEqual(find('K.x'), find('K.com'));
  assert.equal(find('K.x'), find('K.y'));
  assert.equal(find('K.com'), find('K.no'));
  assert.equal(find('K.com'), find('K.nc'));
  assert.equal(find('K.no'), find('L.b'));
  assert.equal(find('K.x'), find('B1.n'));
});

test('relayKeyOf sorts ids', () => {
  assert.equal(relayKeyOf(new Set()), '');
  assert.equal(relayKeyOf(new Set(['K2', 'A', 'K1'])), 'A,K1,K2');
});

test('button conducts only when pressed', () => {
  const lamp = pressed => solve(build({ parts: { B: ['battery'], S: ['button', { pressed }], L: ['lamp'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] })).parts.L.p;
  assert.ok(lamp(false) < 1e-6);
  assert.ok(lamp(true) > 0.2);
});

test('dpdt switches both poles together', () => {
  const r = to => solve(build({
    parts: { B: ['battery'], S: ['dpdt', { to }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.c1'], ['S.a1', 'L1.a'], ['L1.b', 'B.n'], ['B.p', 'S.c2'], ['S.a2', 'L2.a'], ['L2.b', 'B.n']],
  }));
  const a = r('a'), b = r('b');
  assert.ok(a.parts.L1.p > 0.2 && a.parts.L2.p > 0.2);
  assert.ok(b.parts.L1.p < 1e-6 && b.parts.L2.p < 1e-6);
  // 读第一组：c1 与当前接通端
  assert.ok(Math.abs(a.parts.S.i) > 0.1);
});

test('display value sums powered inputs', () => {
  const wires = [['B.p', 'D.i1'], ['B.p', 'D.i4'], ['D.g', 'B.n']];
  const parts = { B: ['battery'], D: ['display'] };
  const r = solve(build({ parts, wires }));
  assert.equal(r.parts.D.value, 5);
  assert.deepEqual([r.parts.D.v, r.parts.D.i, r.parts.D.p], [0, 0, 0]);
  assert.equal(solve(build({ parts, wires: [...wires, ['B.p', 'D.i8']] })).parts.D.value, 13);
});

test('display reads 0 when reversed or common floating', () => {
  const parts = { B: ['battery'], D: ['display'] };
  assert.equal(solve(build({ parts, wires: [['B.n', 'D.i1'], ['B.p', 'D.g']] })).parts.D.value, 0);
  assert.equal(solve(build({ parts, wires: [['B.p', 'D.i2']] })).parts.D.value, 0);
});

test('relay contact short still solves and alarms', () => {
  const c = build({ parts: { B1: ['battery'], K: ['relay'], B2: ['battery'] },
    wires: [['B1.p', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'K.com'], ['K.no', 'B2.n']] });
  const r = solve(c, new Set(), ON_K);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.parts.B2.i) > PHYS.SHORT_A);
  assert.ok(Math.abs(r.parts.K.i - 1.5 / 30.1) < 1e-3);
});

test('circuits without new parts solve exactly as before', () => {
  const c = build({ parts: { B: ['battery'], F: ['fuse', { rating: 2 }], L: ['lamp'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'F.a'], ['F.b', 'B.n']] });
  const a = solve(c), b = solve(c, new Set(), { on: new Set() });
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(a.parts, b.parts);
});
