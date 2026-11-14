import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSfx, TONES } from '../maze-3d/sound.js';

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
