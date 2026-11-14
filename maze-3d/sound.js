// 3D 迷宫音效：Web Audio 实时合成（OscillatorNode + GainNode），不用音频文件。
// AudioContext 通过注入的 win 取得，node 里可以用假对象测试。
// 页面加载时不创建 AudioContext；第一次用户手势里调用 unlock() 才创建。

// 每个音符：type 波形、freq 起始频率、freqEnd 结束频率（滑音，可省略）、at 相对开始的秒、dur 时长、peak 峰值增益
export const TONES = {
  // step 由 variant 选一个音：0 → 330Hz，1 → 392Hz
  step: [
    { type: 'triangle', freq: 330, at: 0, dur: 0.04, peak: 0.06 },
    { type: 'triangle', freq: 392, at: 0, dur: 0.04, peak: 0.06 },
  ],
  bump: [{ type: 'sine', freq: 140, freqEnd: 60, at: 0, dur: 0.15, peak: 0.25 }],
  star: [
    { type: 'sine', freq: 988, at: 0, dur: 0.25, peak: 0.15 },
    { type: 'sine', freq: 1319, at: 0.08, dur: 0.25, peak: 0.15 },
  ],
  win: [
    { type: 'triangle', freq: 523, at: 0, dur: 0.18, peak: 0.18 },
    { type: 'triangle', freq: 659, at: 0.12, dur: 0.18, peak: 0.18 },
    { type: 'triangle', freq: 784, at: 0.24, dur: 0.18, peak: 0.18 },
    { type: 'triangle', freq: 1047, at: 0.36, dur: 0.5, peak: 0.18 },
  ],
};

const FLOOR = 0.0001; // 指数包络不能到 0
const ATTACK = 0.005;

export function createSfx({ win = globalThis, enabled = true, log = null } = {}) {
  let on = Boolean(enabled);
  let state = 'none'; // 'none' | 'unsupported' | 'created'
  let ctx = null;
  let master = null;

  function tone(note, gainPeak) {
    const t0 = ctx.currentTime + note.at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.freq, t0);
    if (note.freqEnd) osc.frequency.exponentialRampToValueAtTime(note.freqEnd, t0 + note.dur);
    if (gainPeak > 0) {
      g.gain.setValueAtTime(FLOOR, t0);
      g.gain.exponentialRampToValueAtTime(gainPeak, t0 + ATTACK);
      g.gain.exponentialRampToValueAtTime(FLOOR, t0 + note.dur);
    } else {
      g.gain.setValueAtTime(0, t0);
    }
    osc.connect(g);
    g.connect(master);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  }

  return {
    unlock() {
      if (!on) return;
      if (state !== 'none') {
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      const Ctor = win.AudioContext || win.webkitAudioContext;
      if (!Ctor) {
        state = 'unsupported';
        return;
      }
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
      } catch {
        ctx = null;
        master = null;
        state = 'unsupported';
        return;
      }
      state = 'created';
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      // 预热：静音 10ms 振荡器，把首次建节点的开销放在手势这一刻
      try {
        tone({ type: 'sine', freq: 440, at: 0, dur: 0.01 }, 0);
      } catch {
        // 预热失败不影响之后播放
      }
    },
    setEnabled(value) {
      on = Boolean(value);
      if (!master) return;
      if (on) {
        master.gain.cancelScheduledValues(0);
        master.gain.value = 1;
      } else {
        master.gain.cancelScheduledValues(0);
        master.gain.value = 0;
      }
    },
    get enabled() {
      return on;
    },
    play(name, variant = 0) {
      if (!on) return;
      if (log) log(name, variant);
      if (!ctx || ctx.state !== 'running') return;
      const notes = TONES[name];
      if (!notes) return;
      try {
        if (name === 'step') tone(notes[variant & 1], notes[variant & 1].peak);
        else for (const n of notes) tone(n, n.peak);
      } catch {
        // 播放失败不影响游戏
      }
    },
    vibrate(pattern) {
      if (!on) return;
      const nav = win.navigator;
      if (!nav || typeof nav.vibrate !== 'function') return;
      try {
        nav.vibrate(pattern);
      } catch {
        // 某些环境禁止震动
      }
    },
    suspend() {
      if (ctx) ctx.suspend().catch(() => {});
    },
    resume() {
      if (ctx) ctx.resume().catch(() => {});
    },
    get state() {
      if (state === 'created') return ctx.state;
      return state;
    },
  };
}

// 用户手势解锁音频。触屏的 pointerdown 不是浏览器认可的激活事件（触屏在 pointerup / touchend 才激活），
// 在它里面新建或 resume 的 AudioContext 会停在 suspended。所以：
// 每次手势都调用 unlock()（已建好但 suspended 时它会再 resume 一次），
// 只有确认 running（或浏览器不支持 Web Audio）之后才移除监听。返回移除全部监听的函数。
export const UNLOCK_EVENTS = ['keydown', 'pointerdown', 'pointerup', 'touchend'];

export function installGestureUnlock(win, sfx, events = UNLOCK_EVENTS) {
  const opts = { capture: true, passive: true };
  function remove() {
    for (const type of events) win.removeEventListener(type, onGesture, opts);
  }
  function settled() {
    const s = sfx.state;
    return s === 'running' || s === 'unsupported';
  }
  function onGesture() {
    if (settled()) return remove();
    if (!sfx.enabled) return;
    sfx.unlock();
    if (settled()) remove();
  }
  for (const type of events) win.addEventListener(type, onGesture, opts);
  return remove;
}
