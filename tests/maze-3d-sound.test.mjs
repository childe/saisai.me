import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSfx, installGestureUnlock, TONES } from '../maze-3d/sound.js';

function fakeParam(value = 0) {
  return {
    value,
    setValueAtTime(v) {
      this.value = v;
      return this;
    },
    exponentialRampToValueAtTime(v) {
      this.value = v;
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  };
}

function fakeNode() {
  return {
    connect() {},
    disconnect() {},
  };
}

// 假 window：AudioContext 记录 createOscillator 次数；navigator.vibrate 记录参数 / 抛异常 / 不存在
function fakeWin({ ctx = true, vibrate = 'record' } = {}) {
  let oscillators = 0;
  const vibrations = [];
  const win = { navigator: {} };
  if (ctx) {
    win.AudioContext = class {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = fakeNode();
      }
      createOscillator() {
        oscillators++;
        return {
          ...fakeNode(),
          type: 'sine',
          frequency: fakeParam(440),
          start() {},
          stop() {},
          onended: null,
        };
      }
      createGain() {
        return { ...fakeNode(), gain: fakeParam(1) };
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      suspend() {
        this.state = 'suspended';
        return Promise.resolve();
      }
    };
  }
  if (vibrate === 'record') win.navigator.vibrate = (p) => vibrations.push(p);
  else if (vibrate === 'throw') {
    win.navigator.vibrate = () => {
      throw new Error('nope');
    };
  }
  win.created = () => oscillators;
  win.vibrations = vibrations;
  return win;
}

test('no Web Audio: nothing throws, state unsupported', () => {
  const sfx = createSfx({ win: fakeWin({ ctx: false, vibrate: null }) });
  sfx.unlock();
  for (const n of ['step', 'bump', 'star', 'win']) sfx.play(n);
  sfx.vibrate(25);
  assert.equal(sfx.state, 'unsupported');
});

test('before unlock: logs but no oscillators; after unlock win makes 4', () => {
  const w = fakeWin();
  const logs = [];
  const sfx = createSfx({ win: w, log: (n, v) => logs.push([n, v]) });
  assert.equal(sfx.state, 'none');
  sfx.play('step', 1);
  assert.deepEqual(logs, [['step', 1]]);
  assert.equal(w.created(), 0);
  sfx.unlock();
  assert.equal(sfx.state, 'running');
  const before = w.created();
  sfx.play('win');
  assert.equal(w.created() - before, 4);
});

test('disabled: no log, no oscillators, no vibrate', () => {
  const w = fakeWin();
  const logs = [];
  const sfx = createSfx({ win: w, log: (n) => logs.push(n) });
  sfx.unlock();
  sfx.setEnabled(false);
  const before = w.created();
  sfx.play('bump'); sfx.vibrate(25);
  assert.deepEqual(logs, []);
  assert.equal(w.created(), before);
  assert.deepEqual(w.vibrations, []);
  assert.equal(sfx.enabled, false);
});

test('disabled at creation: unlock does not create a context', () => {
  const sfx = createSfx({ win: fakeWin(), enabled: false });
  sfx.unlock();
  assert.equal(sfx.state, 'none');
});

test('vibrate that throws does not throw', () => {
  const sfx = createSfx({ win: fakeWin({ vibrate: 'throw' }) });
  assert.doesNotThrow(() => sfx.vibrate([80, 60, 80, 60, 200]));
});

test('TONES match the spec table', () => {
  assert.equal(TONES.win.length, 4);
  assert.deepEqual(TONES.win.map((n) => n.freq), [523, 659, 784, 1047]);
  assert.deepEqual(TONES.star.map((n) => n.freq), [988, 1319]);
  assert.equal(TONES.bump[0].freq, 140); assert.equal(TONES.bump[0].freqEnd, 60);
});

// 模拟浏览器的激活限制：只有 win.active 为 true（激活事件中）时，新建的 AudioContext 才是 running、resume 才生效。
// 触屏 pointerdown 不是激活事件，touchend / pointerup 才是
function gatedWin() {
  const listeners = new Map();
  let oscillators = 0;
  const win = {
    active: false,
    navigator: {},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    fire(type, active) {
      win.active = active;
      for (const fn of [...(listeners.get(type) || [])]) fn({ type });
      win.active = false;
    },
    count() {
      let n = 0;
      for (const s of listeners.values()) n += s.size;
      return n;
    },
    created: () => oscillators,
  };
  win.AudioContext = class {
    constructor() {
      this.state = win.active ? 'running' : 'suspended';
      this.currentTime = 0;
      this.destination = fakeNode();
    }
    createOscillator() {
      oscillators++;
      return { ...fakeNode(), type: 'sine', frequency: fakeParam(440), start() {}, stop() {}, onended: null };
    }
    createGain() {
      return { ...fakeNode(), gain: fakeParam(1) };
    }
    resume() {
      if (win.active) this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
  };
  return win;
}

test('touch first: pointerdown leaves context suspended but keeps listeners; touchend resumes and sound plays', async () => {
  const w = gatedWin();
  const sfx = createSfx({ win: w });
  installGestureUnlock(w, sfx);
  const total = w.count();
  assert.ok(total >= 3);
  w.fire('pointerdown', false);
  assert.equal(sfx.state, 'suspended');
  assert.equal(w.count(), total, 'listeners must stay while suspended');
  w.fire('touchend', true);
  await Promise.resolve();
  assert.equal(sfx.state, 'running');
  const before = w.created();
  sfx.play('bump');
  assert.equal(w.created() - before, 1);
  w.fire('pointerdown', false);
  assert.equal(w.count(), 0, 'listeners removed once running');
});

test('touch first: pointerup also unlocks', async () => {
  const w = gatedWin();
  const sfx = createSfx({ win: w });
  installGestureUnlock(w, sfx);
  w.fire('pointerdown', false);
  w.fire('pointerup', true);
  await Promise.resolve();
  assert.equal(sfx.state, 'running');
});

test('gesture unlock: sound off keeps listeners and creates no context; no Web Audio removes listeners', () => {
  const w = gatedWin();
  const sfx = createSfx({ win: w, enabled: false });
  installGestureUnlock(w, sfx);
  const total = w.count();
  w.fire('keydown', true);
  assert.equal(sfx.state, 'none');
  assert.equal(w.count(), total);
  const w2 = gatedWin();
  delete w2.AudioContext;
  const sfx2 = createSfx({ win: w2 });
  installGestureUnlock(w2, sfx2);
  w2.fire('keydown', true);
  assert.equal(sfx2.state, 'unsupported');
  assert.equal(w2.count(), 0);
});
