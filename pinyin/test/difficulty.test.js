import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, initialState, nextState, optionCount, STREAK_TO_LEVEL_UP,
} from '../lib/difficulty.js';

const run = (results) => results.reduce(nextState, initialState());

test('从 4 选 1 起步', () => {
  assert.equal(optionCount(initialState()), 4);
  assert.deepEqual(LEVELS, [4, 6, 10]);
});

test('连对 5 题升一级', () => {
  assert.equal(optionCount(run(Array(STREAK_TO_LEVEL_UP).fill(true))), 6);
});

test('升级后连对计数归零', () => {
  assert.equal(run(Array(STREAK_TO_LEVEL_UP).fill(true)).streak, 0);
});

test('连对 4 题还不升级', () => {
  const s = run(Array(STREAK_TO_LEVEL_UP - 1).fill(true));
  assert.equal(optionCount(s), 4);
  assert.equal(s.streak, 4);
});

test('连对 10 题升两级到顶', () => {
  assert.equal(optionCount(run(Array(STREAK_TO_LEVEL_UP * 2).fill(true))), 10);
});

test('到顶后继续对也不再升', () => {
  const s = run(Array(STREAK_TO_LEVEL_UP * 5).fill(true));
  assert.equal(optionCount(s), 10);
  assert.equal(s.levelIndex, LEVELS.length - 1);
});

test('答错降一级并清零连对', () => {
  let s = run(Array(STREAK_TO_LEVEL_UP).fill(true));
  s = nextState(s, false);
  assert.equal(optionCount(s), 4);
  assert.equal(s.streak, 0);
});

test('最低档答错保持不变', () => {
  const s = nextState(initialState(), false);
  assert.equal(optionCount(s), 4);
  assert.equal(s.levelIndex, 0);
});

test('不修改传入的 state', () => {
  const s = initialState();
  nextState(s, true);
  assert.deepEqual(s, { levelIndex: 0, streak: 0 });
});

test('对错交替时停在最低档', () => {
  assert.equal(optionCount(run([true, false, true, false, true, false])), 4);
});
