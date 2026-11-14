import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProgress, record, UP_AFTER } from '../lib/progress.js';

test('levels up after UP_AFTER perfect problems in a row', () => {
  let p = initialProgress(2);
  for (let i = 1; i < UP_AFTER; i++) {
    const r = record(p, 0);
    assert.equal(r.event, null);
    p = r.progress;
  }
  const r = record(p, 0);
  assert.equal(r.event, 'up');
  assert.deepEqual(r.progress, { level: 3, streak: 0, struggles: 0 });
});

test('a mistake resets the streak; no level above 5', () => {
  let p = { level: 5, streak: UP_AFTER - 1, struggles: 0 };
  assert.equal(record(p, 0).event, null);
  p = record({ level: 3, streak: 2, struggles: 0 }, 1).progress;
  assert.equal(p.streak, 0);
});

test('suggests an easier level after two hard problems in a row, never below 1', () => {
  let r = record(initialProgress(3), 2);
  assert.equal(r.event, null);
  r = record(r.progress, 3);
  assert.equal(r.event, 'suggestDown');
  assert.equal(r.progress.level, 3, 'only a suggestion, level unchanged');
  r = record(record(initialProgress(1), 2).progress, 2);
  assert.equal(r.event, null);
});
