import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpec, parse, format } from '../lib/grid.js';
import { solveUnique } from '../lib/solve.js';
import { rng } from '../lib/generate.js';
import { drillOk, makeDrill } from '../lib/drill-gen.js';
import { CHAPTERS } from '../data/drills.js';
import { PUZ6 } from './fixtures.js';

const ORDER = ['hidden', 'naked', 'locked', 'pair'];
const empties = s => [...s].filter(x => x === '.').length;

test('drillOk: hidden fixture passes, rejects non-unique and wrong technique', () => {
  const spec = getSpec(6);
  assert.equal(drillOk(parse(PUZ6), spec, 'hidden'), true);
  // 有排除法可用 → 不是唯一余数的小题
  assert.equal(drillOk(parse(PUZ6), spec, 'naked'), false);
  assert.equal(drillOk(Array(36).fill(0), spec, 'hidden'), false);
});

test('makeDrill returns a valid drill within maxEmpty', () => {
  const spec = getSpec(6);
  const d = makeDrill(6, 'hidden', rng(1), { maxEmpty: 10 });
  assert.ok(d);
  assert.ok(empties(d.puzzle) <= 10);
  assert.ok(drillOk(parse(d.puzzle), spec, 'hidden'));
  assert.equal(format(solveUnique(parse(d.puzzle), spec)), d.solution);
  assert.ok(d.uses >= 1);
});

test('chapter layout', () => {
  assert.deepEqual(CHAPTERS.map(c => c.id), ORDER);
  assert.deepEqual(CHAPTERS.map(c => c.name), ['排除法', '唯一余数', '区块', '数对']);
  for (const ch of CHAPTERS) {
    assert.equal(ch.slots.length, 8);
    for (const slot of ch.slots) {
      assert.ok(slot.length >= 3 && slot.length <= 5);
      assert.equal(new Set(slot.map(v => v.size)).size, 1); // 同题位尺寸一致
    }
  }
});

test('hidden and naked chapters: first 3 slots 6x6, rest 9x9', () => {
  for (const ch of CHAPTERS.slice(0, 2))
    assert.deepEqual(ch.slots.map(s => s[0].size), [6, 6, 6, 9, 9, 9, 9, 9]);
});

test('every drill exercises its chapter technique', () => {
  for (const ch of CHAPTERS) for (const slot of ch.slots) for (const d of slot) {
    const spec = getSpec(d.size), v = parse(d.puzzle);
    assert.ok(drillOk(v, spec, ch.id), `${ch.id} ${d.puzzle}`);
    assert.equal(format(solveUnique(v, spec)), d.solution);
  }
});

test('9x9 drills leave at most 20 empty cells unless relaxed', () => {
  for (const ch of CHAPTERS.slice(0, 2)) for (const slot of ch.slots) for (const d of slot)
    if (d.size === 9) assert.ok(empties(d.puzzle) <= 20);
});

test('no duplicate drills', () => {
  const all = CHAPTERS.flatMap(ch => ch.slots.flat().map(d => d.puzzle));
  assert.equal(new Set(all).size, all.length);
});

test('locked and pair chapters: first 3 slots 6x6 (relaxation level 1), rest 9x9', () => {
  for (const ch of CHAPTERS.slice(2))
    assert.deepEqual(ch.slots.map(s => s[0].size), [6, 6, 6, 9, 9, 9, 9, 9]);
});

test('6x6 empty-cell caps: hidden 10, naked 12, locked/pair 16 (relaxed); 9x9 locked/pair 20', () => {
  const cap6 = { hidden: 10, naked: 12, locked: 16, pair: 16 };
  for (const ch of CHAPTERS) for (const slot of ch.slots) for (const d of slot)
    assert.ok(empties(d.puzzle) <= (d.size === 6 ? cap6[ch.id] : 20), `${ch.id} ${d.puzzle}`);
});
