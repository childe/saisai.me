import test from 'node:test';
import assert from 'node:assert/strict';
import { setPlayback } from '../lib/audio-session.js';

function withNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

test('把音频会话设成 playback', () => {
  const session = { type: 'auto' };
  withNavigator({ audioSession: session });
  assert.equal(setPlayback(), true);
  assert.equal(session.type, 'playback');
});

test('用过麦克风之后要能把会话抢回来', () => {
  // iOS 上 getUserMedia 会把会话切成 play-and-record，输出从扬声器
  // 改走听筒 —— 听上去就是"没声音"。停掉音轨并不会自动切回来。
  const session = { type: 'play-and-record' };
  withNavigator({ audioSession: session });
  setPlayback();
  assert.equal(session.type, 'playback');
});

test('不支持 audioSession 的浏览器不报错', () => {
  withNavigator({});
  assert.equal(setPlayback(), false);
});

test('设置时抛异常也不报错', () => {
  withNavigator({ audioSession: { set type(_) { throw new Error('nope'); } } });
  assert.equal(setPlayback(), false);
});
