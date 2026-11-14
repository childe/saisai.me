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

test('throwing globalThis.localStorage falls back when no storage arg', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      get() { throw new SecurityError('blocked'); },
      configurable: true
    });
    assert.deepEqual(loadStars(), {});
    assert.equal(loadInstantCheck(), true);
    assert.doesNotThrow(() => { saveStars('hidden', 0, 3); saveInstantCheck(false); });
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    } else {
      delete globalThis.localStorage;
    }
  }
});

test('invalid stored values (null, number, array) fallback to {}', () => {
  assert.deepEqual(loadStars({ getItem: () => 'null', setItem() {} }), {});
  assert.deepEqual(loadStars({ getItem: () => '5', setItem() {} }), {});
  assert.deepEqual(loadStars({ getItem: () => '[]', setItem() {} }), {});
});
