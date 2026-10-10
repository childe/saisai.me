import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiag } from '../lib/audio-diag.js';

const OK = { state: 'running', degraded: false, error: null };

test('一切正常时不显示诊断条', () => {
  assert.equal(formatDiag(OK, false), null);
});

test('加了 ?debug 就算正常也显示', () => {
  assert.match(formatDiag(OK, true), /running/);
});

test('上下文没跑起来要显示出来', () => {
  assert.match(formatDiag({ ...OK, state: 'suspended' }, false), /suspended/);
});

test('降级到直连喇叭要说明白', () => {
  const t = formatDiag({ ...OK, degraded: true }, false);
  assert.match(t, /降级/);
});

test('错误信息要带上', () => {
  const t = formatDiag({ ...OK, error: 'undefined is not an object' }, false);
  assert.match(t, /undefined is not an object/);
});
