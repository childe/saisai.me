import test from 'node:test';
import assert from 'node:assert/strict';
import { PART_TYPES, PARTS, defaultParams, isValidParam, PHYS } from '../lib/parts.js';
import { createCircuit, addPart, movePart, rotatePart, removePart, setParam, addWire, removeWire } from '../lib/circuit.js';
import { build, loop } from './helpers.js';

test('catalog has 16 types with terms', () => {
  assert.equal(PART_TYPES.length, 16);
  for (const t of PART_TYPES) assert.ok(PARTS[t].terms.every(n => PARTS[t].termPos[n]));
  assert.deepEqual(PARTS.rheostat.terms, ['a', 'b', 'w']);
  assert.equal(PARTS.switch.lever && PARTS.spdt.lever, true);
  assert.equal(defaultParams('battery').cells, 1);
  assert.equal(isValidParam('resistor', 'ohms', 33), false);
  assert.equal(isValidParam('battery', 'cells', 4), true);
  assert.equal(PHYS.LAMP_BURN_P, 2 * PHYS.LAMP_P_RATED);
});

test('ops are immutable and bump rev / topoRev', () => {
  const c0 = createCircuit();
  const { circuit: c1, id } = addPart(c0, 'lamp', 5, 5);
  assert.equal(c0.parts.length, 0);
  assert.deepEqual([c1.rev, c1.topoRev], [1, 1]);
  const c2 = movePart(c1, id, 6, 5);
  assert.deepEqual([c2.rev, c2.topoRev], [2, 1]);
  const c3 = rotatePart(c2, id);
  assert.equal(c3.parts[0].rot, 1);
  const c4 = setParam(c3, id, 'nope', 1);
  assert.equal(c4, c3);
});

test('addWire rejects self, duplicates and bad terms', () => {
  let c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [] });
  const r = addWire(c, { part: 'B', term: 'p' }, { part: 'L', term: 'a' });
  assert.ok(r);
  c = r.circuit;
  assert.equal(addWire(c, { part: 'L', term: 'a' }, { part: 'B', term: 'p' }), null);
  assert.equal(addWire(c, { part: 'B', term: 'p' }, { part: 'B', term: 'p' }), null);
  assert.equal(addWire(c, { part: 'B', term: 'x' }, { part: 'L', term: 'b' }), null);
  assert.ok(addWire(c, { part: 'B', term: 'p' }, { part: 'B', term: 'n' })); // 同一元件两端允许
});

test('removePart drops attached wires', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a'], ['L.b', 'B.n']] });
  const d = removePart(c, 'L');
  assert.equal(d.wires.length, 0);
  assert.equal(d.topoRev, c.topoRev + 1);
  assert.equal(removeWire(c, 'w1').wires.length, 1);
});

test('loop pairs chain into external wires only', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  assert.deepEqual(c.wires.map(w => [`${w.a.part}.${w.a.term}`, `${w.b.part}.${w.b.term}`]), [['B.p', 'L.a'], ['L.b', 'B.n']]);
  assert.throws(() => loop({ B: ['battery'] }, ['B.p', 'B.n', 'B.p']));
});
