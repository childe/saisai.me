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

test('还没碰过页面时上下文本来就没建，不该报红', () => {
  // 打开页面就弹一条红的"音频未创建"是误报：iOS 本来就要等用户手势
  // 之后才允许建上下文。
  assert.equal(formatDiag({ state: '未创建', degraded: false, error: null }, false), null);
});

test('但 ?debug 下还是要看得到未创建这个状态', () => {
  assert.match(formatDiag({ state: '未创建', degraded: false, error: null }, true), /未创建/);
});
