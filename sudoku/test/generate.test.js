import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpec, parse, format } from '../lib/grid.js';
import { solveUnique, countSolutions } from '../lib/solve.js';
import { logicalSolve } from '../lib/techniques.js';
import { PUZ6 } from './fixtures.js';
import {
  rng, randomSolution, LEVELS, gradePuzzle, generateFree, FREE_LEVELS, digPuzzle, ALLOWED,
} from '../lib/generate.js';

test('rng is deterministic and in [0,1)', () => {
  const a = rng(7), b = rng(7);
  for (let i = 0; i < 20; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('randomSolution is a valid full grid', () => {
  for (const size of [6, 9]) {
    const v = randomSolution(size, rng(1)), s = getSpec(size);
    for (const u of s.units) assert.equal(new Set(u.cells.map(c => v[c])).size, size);
  }
});

test('gradePuzzle', () => {
  assert.equal(gradePuzzle(parse(PUZ6), getSpec(6)), 'intro');
  assert.equal(gradePuzzle(parse('.'.repeat(36)), getSpec(6)), null);
});

test('digPuzzle keeps uniqueness and logical solvability', () => {
  for (const size of [6, 9]) {
    const spec = getSpec(size);
    const sol = randomSolution(size, rng(3));
    const p = digPuzzle(sol, spec, ALLOWED.medium, rng(4));
    assert.equal(countSolutions(p, spec), 1);
    assert.ok(logicalSolve(p, spec, ALLOWED.medium).solved);
    assert.deepEqual(solveUnique(p, spec), sol);
    assert.ok(p.some(v => v === 0));
  }
});

test('generateFree honours level for every open level', () => {
  for (const size of [6, 9]) for (const level of FREE_LEVELS[size]) {
    const r = generateFree(size, level, rng(42), { deadline: Date.now() + 10000 });
    assert.ok(r, `${size} ${level}`);
    assert.equal(gradePuzzle(parse(r.puzzle), getSpec(size)), level);
    assert.equal(format(solveUnique(parse(r.puzzle), getSpec(size))), r.solution);
  }
});

test('FREE_LEVELS always offers 9x9 all four levels', () => {
  assert.deepEqual(FREE_LEVELS[9], LEVELS);
});

test('generateFree returns null past deadline', () => {
  assert.equal(generateFree(9, 'hard', rng(1), { deadline: Date.now() - 1 }), null);
});
