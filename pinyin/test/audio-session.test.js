import test from 'node:test';
import assert from 'node:assert/strict';
import { setPlayback, setPlayAndRecord, sessionType } from '../lib/audio-session.js';

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

test('不支持 audioSession 时要说"不支持"，不能和正常长得一样', () => {
  // 这是关键信息：说明 setPlayback() 根本没生效，问题不在我们的代码里，
  // 而在 iOS 版本（audioSession 要 16.4+）。
  withNavigator({});
  assert.equal(sessionType(), '不支持');
});

test('支持时如实返回当前类型', () => {
  withNavigator({ audioSession: { type: 'play-and-record' } });
  assert.equal(sessionType(), 'play-and-record');
});

test('要录音时把会话切成 play-and-record', () => {
  // 'playback' 是在告诉 iOS"这个页面只放音不录音"。设成它之后再去
  // 要麦克风，拿不到。录之前必须先切过去。
  const session = { type: 'playback' };
  withNavigator({ audioSession: session });
  assert.equal(setPlayAndRecord(), true);
  assert.equal(session.type, 'play-and-record');
});

test('不支持 audioSession 时切换不报错', () => {
  withNavigator({});
  assert.equal(setPlayAndRecord(), false);
});
