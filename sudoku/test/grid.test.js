import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpec, parse, format, candidates, bits } from '../lib/grid.js';
import { countSolutions, solveUnique } from '../lib/solve.js';
import { SOL6, PUZ6 } from './fixtures.js';

test('spec geometry', () => {
  const s9 = getSpec(9), s6 = getSpec(6);
  assert.equal(s9.units.length, 27);
  assert.equal(s6.units.length, 18);
  assert.deepEqual([s6.boxRows, s6.boxCols], [2, 3]);
  assert.deepEqual(s6.units.find(u => u.kind === 'box' && u.index === 1).cells, [3, 4, 5, 9, 10, 11]);
  assert.equal(s9.peers[0].length, 20);
  assert.equal(s6.peers[0].length, 12);
});
test('parse/format roundtrip', () => {
  assert.equal(format(parse(PUZ6)), PUZ6);
  assert.equal(parse(PUZ6)[0], 0);
});
test('candidates respect peers and eliminated', () => {
  const s = getSpec(6), v = parse(PUZ6);
  assert.deepEqual(bits(candidates(v, s)[0]), [1]);
  assert.deepEqual(bits(candidates(v, s, new Set(['0:1']))[0]), []);
  assert.equal(candidates(v, s)[1], 0);
});
test('solution counting', () => {
  const s = getSpec(6);
  assert.equal(countSolutions(parse(PUZ6), s), 1);
  assert.equal(format(solveUnique(parse(PUZ6), s)), SOL6);
  assert.equal(countSolutions(parse('.'.repeat(36)), s), 2); // 封顶 limit
  assert.equal(solveUnique(parse('.'.repeat(36)), s), null);
});
test('extra: spec caching, unitsOf, 9x9 empty board is fast', () => {
  assert.equal(getSpec(9), getSpec(9));
  const s9 = getSpec(9);
  assert.equal(s9.unitsOf[0].length, 3);
  assert.deepEqual(s9.unitsOf[0].map(i => s9.units[i].kind), ['row', 'col', 'box']);
  assert.equal(countSolutions(parse('.'.repeat(81)), s9), 2);
});
