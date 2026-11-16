import test from 'node:test';
import assert from 'node:assert/strict';
import { isTextEntry } from '../lib/keys.js';

test('isTextEntry: text inputs swallow shortcuts, sliders do not', () => {
  assert.equal(isTextEntry({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTextEntry({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextEntry({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(isTextEntry({ tagName: 'BUTTON' }), false);
  assert.equal(isTextEntry(null), false);
});
