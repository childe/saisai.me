// 第 8 章：电容与定时。
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { solve } from '../solve.js';
import { PHYS } from '../parts.js';
import { relayOnSet } from '../relay.js';
import { lampLit, ledLit, ofType, result, noProgress, presetCircuit } from '../task-kit.js';

const BATTERY_IDLE_A = 0.001;

// 灯靠电容撑着的继电器点亮：
// 1. 把继电器全部当作释放再解一次，这盏灯就不亮（灯确实靠继电器）；
// 2. 有吸合的继电器线圈此刻有电流，把电容电压全部清零再解一次，这电流就没了（线圈确实靠电容）。
// 第 2 条拦住两种不用电容的情况：刚断开开关、继电器还没来得及释放的那一帧；继电器自锁。
function litByRelay(ws, br, id) {
  const off = solve(ws.circuit, br, { on: new Set(), caps: ws.caps?.v ?? {} });
  return off.ok && !lampLit(off, br, id);
}

function relayHeldByCap(ws, br) {
  const on = relayOnSet(ws.relays ?? { on: {} });
  const held = [...on].filter(id => Math.abs(ws.result.parts[id]?.i ?? 0) >= PHYS.RELAY_RELEASE_A);
  if (!held.length) return false;
  const drained = solve(ws.circuit, br, { on, caps: {} });
  return drained.ok && held.some(id => Math.abs(drained.parts[id]?.i ?? 0) < PHYS.RELAY_RELEASE_A);
}

const SLOW_DV = 0.1;
const SLOW_COUNT = 4;
const emptyToggle = () => ({ state: null, v: {}, count: 0, flips: 0, dir: 0 });

// 慢速切换计数：stateOf 给出的状态变了，同时满足下面三条才计一次：
// - 自上次状态变化以来继电器翻转过（拦住手动删线、接线）；
// - 自上次计数以来某个电容电压变了 SLOW_DV 以上（拦住继电器不靠电容、哒哒乱跳）；
// - 这次电容电压变化的方向和上次计数时相反，即充、放交替（拦住旁边单独充电的电容）。
// stateOf 返回 null 表示这一刻不算状态，跳过。
function slowToggle(progress, ws, stateOf) {
  const state = stateOf(ws);
  if (state === null || state === progress.state) return progress;
  const v = ws.caps?.v ?? {};
  const flips = ws.relays?.flips ?? 0;
  if (progress.state === null) return { ...progress, state, v, flips };
  const flipped = flips > progress.flips;
  const dvs = Object.keys(v).map(id => v[id] - (progress.v[id] ?? v[id])).filter(dv => Math.abs(dv) >= SLOW_DV);
  const dir = dvs.length ? Math.sign(dvs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a))) : 0;
  if (flipped && dir && dir !== progress.dir) return { state, v, flips, dir, count: progress.count + 1 };
  return { ...progress, state, flips };
}

// 「自己闪的灯」的闪光电路，不带灯：电池 → com，nc → 电阻 → 电容∥线圈。
// 电容竖放在线圈左边，导线都绕开元件本体；右侧留空放 LED。
const flasherPreset = () => presetCircuit(
  [['B', 'battery', 10, 24, { cells: 2 }], ['K', 'relay', 24, 12], ['R', 'resistor', 34, 13, { ohms: 47 }],
    ['C', 'capacitor', 18, 12, { farads: 0.5 }, { rot: 1 }]],
  [['B.p', 'K.com', { via: [[8, 6], [28, 6], [28, 12]] }], ['K.nc', 'R.a'], ['R.b', 'C.a', { via: [[38, 13], [38, 8], [18, 8]] }],
    ['K.x', 'C.a', { via: [[20, 11], [20, 10]] }], ['K.y', 'C.b', { via: [[20, 13], [20, 14]] }], ['B.n', 'C.b']],
);

// 只有红色 LED 亮 → 'red'，只有绿色亮 → 'green'，其他时刻不算状态。
function ledColorState(ws) {
  const br = brokenSet(ws.damage);
  const litColors = new Set(ofType(ws.circuit, 'led').filter(d => ledLit(ws.result, br, d.id)).map(d => d.params.color));
  if (litColors.size !== 1) return null;
  const [color] = litColors;
  return color === 'red' || color === 'green' ? color : null;
}

export const CH8 = [
  {
    id: 43, chapter: 8, name: '会存电的电容', goal: '断开开关以后，让灯再亮一会儿',
    palette: { battery: 1, switch: 1, lamp: 1, capacitor: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    // 灯亮着、电池却没在供电，说明是电容在点灯。
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      if (!ofType(ws.circuit, 'lamp').some(l => lampLit(ws.result, br, l.id))) return result(false, progress);
      const busy = ofType(ws.circuit, 'battery').some(b => Math.abs(ws.result.parts[b.id]?.i ?? 0) >= BATTERY_IDLE_A);
      return busy ? result(false, progress, '现在是电池在点灯。断开开关看看，灯还亮吗？') : result(true, progress);
    },
  },
  {
    id: 44, chapter: 8, name: '延时关灯', goal: '断开开关以后，让继电器多吸一会儿，灯晚一点再灭',
    palette: { battery: 1, switch: 1, relay: 1, capacitor: 1, lamp: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    // 开关都断开了，灯还靠继电器亮着，说明电容在帮线圈撑着。
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lit = ofType(ws.circuit, 'lamp').filter(l => lampLit(ws.result, br, l.id));
      if (!lit.length) return result(false, progress);
      if (ofType(ws.circuit, 'switch').some(s => s.params.closed)) return result(false, progress, '灯亮了。断开开关，看灯能不能晚一点再灭');
      return result(lit.some(l => litByRelay(ws, br, l.id)) && relayHeldByCap(ws, br), progress);
    },
  },
  {
    id: 45, chapter: 8, name: '自己闪的灯', goal: '不用开关，让灯自己一亮一灭',
    // 电阻默认 10Ω：47Ω 起，1 节电池时线圈电流不到吸合值，继电器不动。
    palette: { battery: 1, relay: 1, resistor: 1, capacitor: 1, lamp: 1 }, defaults: { resistor: { ohms: 10 } },
    preset: () => createCircuit(), initProgress: emptyToggle,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const next = slowToggle(progress, ws, w => (ofType(w.circuit, 'lamp').some(l => lampLit(w.result, br, l.id)) ? 'on' : 'off'));
      return result(next.count >= SLOW_COUNT, next);
    },
  },
  {
    id: 46, chapter: 8, name: '自动红绿灯',
    goal: '给闪光电路接上红灯和绿灯，让它们自己轮流亮。绿灯比红灯亮得久，因为电容充电比放电快',
    palette: { led: 2, resistor: 2 }, lockPreset: true, preset: flasherPreset, initProgress: emptyToggle,
    check(progress, ws) {
      const next = slowToggle(progress, ws, ledColorState);
      const leds = ofType(ws.circuit, 'led');
      const hint = leds.length && !leds.some(d => d.params.color === 'green') ? '把一个 LED 的颜色改成绿色' : null;
      return result(next.count >= SLOW_COUNT, next, hint);
    },
  },
];
