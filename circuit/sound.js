// 蜂鸣器：每种声音一路合成器（嘀嘀 / 摩托车 / 警笛 / 小鸟），各接一个增益节点，按音量开关。
// 某种声音第一次响起时才建它那一路，不用的声音不占振荡器。
// click：继电器翻转时的一声短促咔哒（约 20 ms）。
//
// iPad / iPhone 上要守的几条（pinyin 模块踩过的坑）：
//   1. AudioContext 只能在用户手势里建和 resume。pointerdown 对应 touchstart，
//      iOS 不把它算手势，要等 touchend / click。所以三个事件都要接。
//   2. 手势里播一帧静音 buffer，iOS 才真正放开输出。
//   3. audioSession 设成 playback，否则静音模式下 Web Audio 整个被静掉。
//   4. 不写链式 connect：老 WebKit 的 connect() 返回 undefined。

function osc(ctx, type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start();
  return o;
}

// lfo 按 depth 的幅度去摆动 param：lfo -> gain(depth) -> param。
function wobble(ctx, lfo, depth, param) {
  const g = ctx.createGain();
  g.gain.value = depth;
  lfo.connect(g);
  g.connect(param);
  return g;
}

// 怠速每秒点火 ENGINE_FIRE_HZ 次，录 ENGINE_FIRES 次后首尾相接循环。
const ENGINE_FIRE_HZ = 12;
const ENGINE_FIRES = 16;

// 点火录音：闷响 = 60Hz 和 140Hz 两个衰减正弦，嘶声 = 一小段衰减噪声。
// 尾巴超过结尾的部分绕回开头，循环时接缝听不出来。随机数用固定种子，每次一样。
export function engineSamples(sr) {
  const len = Math.round(sr * ENGINE_FIRES / ENGINE_FIRE_HZ);
  const data = new Float32Array(len);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tail = Math.round(sr * 0.15);
  for (let k = 0; k < ENGINE_FIRES; k++) {
    const start = Math.round(((k + (rand() - 0.5) * 0.08) / ENGINE_FIRE_HZ) * sr);
    const amp = 0.75 + rand() * 0.5;
    for (let i = 0; i < tail; i++) {
      const t = i / sr;
      const thump = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t / 0.03)
        + 0.6 * Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.015);
      const hiss = 0.4 * (rand() * 2 - 1) * Math.exp(-t / 0.008);
      data[(start + i + len) % len] += amp * (thump + hiss);
    }
  }
  let peak = 0;
  for (const x of data) peak = Math.max(peak, Math.abs(x));
  for (let i = 0; i < len; i++) data[i] /= peak;
  return data;
}

function engineBuffer(ctx) {
  const data = engineSamples(ctx.sampleRate);
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

// 每种声音：build(ctx, out) 把声音接到 out，返回 rev(drive)，drive 是 0–1 的油门（按电流算），可用来改音色；
// level 是音量为 1 时的输出增益，几种声音听感上差不多响。
const VOICES = {
  // 原来的 2400Hz 方波。
  beep: {
    level: 0.2,
    build(ctx, out) {
      osc(ctx, 'square', 2400).connect(out);
      return () => {};
    },
  },
  // 发动机：先合成一段“点火录音”——每次点火是一声低沉的闷响加一点排气的嘶声，
  // 每声的轻重、早晚都略有不同——再循环播放。油门越大播得越快，转速越高。
  moto: {
    level: 0.8,
    build(ctx, out) {
      const src = ctx.createBufferSource();
      src.buffer = engineBuffer(ctx);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      src.connect(filter);
      filter.connect(out);
      src.start();
      return drive => {
        const t = ctx.currentTime;
        src.playbackRate.setTargetAtTime(1 + 3 * drive, t, 0.25);
        filter.frequency.setTargetAtTime(900 + 2100 * drive, t, 0.25);
      };
    },
  },
  // 三角波在 550–1350Hz 之间慢慢上下滑，约 2.5 秒一个来回。
  siren: {
    level: 0.35,
    build(ctx, out) {
      const tone = osc(ctx, 'triangle', 950);
      wobble(ctx, osc(ctx, 'sine', 0.4), 400, tone.frequency);
      tone.connect(out);
      return () => {};
    },
  },
  // 正弦波被锯齿波快速扫频，一秒十来声“啾”；再用慢方波开关，一阵一阵地叫。
  bird: {
    level: 0.3,
    build(ctx, out) {
      const tone = osc(ctx, 'sine', 3200);
      wobble(ctx, osc(ctx, 'sawtooth', 11), 900, tone.frequency);
      const am = ctx.createGain();
      am.gain.value = 0.5;
      wobble(ctx, osc(ctx, 'square', 1.3), 0.5, am.gain);
      tone.connect(am);
      am.connect(out);
      return () => {};
    },
  },
};

export const SOUNDS = Object.freeze(Object.keys(VOICES));

export function createBuzzer() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return { unlock() {}, update() {}, click() {} };
  let ctx = null;
  // sound -> { gain, rev, last }
  const voices = new Map();

  function unlock() {
    try {
      if (globalThis.navigator?.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* iOS 16.4 以下不支持 */ }
    try {
      if (!ctx) ctx = new AC();
      // iOS 切后台回来是 'interrupted'，也要在手势里 resume。
      if (ctx.state !== 'running') ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start();
    } catch (err) { console.warn('[circuit sound]', err); }
  }

  function voice(sound) {
    let v = voices.get(sound);
    if (v) return v;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    v = { gain, rev: VOICES[sound].build(ctx, gain), last: 0, lastDrive: -1 };
    voices.set(sound, v);
    return v;
  }

  // volumes：{ beep: { volume: 0.8, drive: 0.2 } }，没列出的声音不响。
  function update(volumes, muted) {
    if (!ctx) return;
    try {
      for (const sound of SOUNDS) {
        const raw = Number(volumes?.[sound]?.volume);
        const v = muted || !Number.isFinite(raw) ? 0 : Math.max(0, Math.min(1, raw));
        const drive = Math.max(0, Math.min(1, Number(volumes?.[sound]?.drive) || 0));
        if (v === 0 && !voices.has(sound)) continue;
        const vc = voice(sound);
        const target = v * VOICES[sound].level;
        if (Math.abs(target - vc.last) >= 1e-4) {
          vc.last = target;
          vc.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.03);
        }
        // 音量封顶后电流还会变（换电池），油门要单独比。
        if (v > 0 && Math.abs(drive - vc.lastDrive) >= 1e-3) {
          vc.lastDrive = drive;
          vc.rev(drive);
        }
      }
    } catch (err) { console.warn('[circuit sound]', err); }
  }

  function click(muted) {
    if (!ctx || muted) return;
    try {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 900;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.025);
    } catch { /* 无声也能用 */ }
  }

  return { unlock, update, click };
}
