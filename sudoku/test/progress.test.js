import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStars, saveStars, loadInstantCheck, saveInstantCheck } from '../lib/progress.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };

test('stars keep the best', () => {
  const s = mem();
  saveStars('hidden', 0, 2, s); saveStars('hidden', 0, 1, s); saveStars('hidden', 0, 3, s);
  assert.deepEqual(loadStars(s), { 'hidden-0': 3 });
});

test('instant check defaults on', () => {
  const s = mem();
  assert.equal(loadInstantCheck(s), true);
  saveInstantCheck(false, s);
  assert.equal(loadInstantCheck(s), false);
});

test('throwing storage falls back', () => {
  assert.deepEqual(loadStars(broken), {});
  assert.equal(loadInstantCheck(broken), true);
  assert.doesNotThrow(() => { saveStars('hidden', 0, 3, broken); saveInstantCheck(false, broken); });
  assert.deepEqual(loadStars({ getItem: () => '{bad json', setItem() {} }), {});
});
