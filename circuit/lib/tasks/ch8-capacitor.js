// 第 8 章：电容与定时。
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { solve } from '../solve.js';
import { lampLit, ledLit, ofType, result, noProgress, presetCircuit } from '../task-kit.js';

const BATTERY_IDLE_A = 0.001;

// 灯靠继电器点亮：把继电器全部当作释放再解一次，这盏灯就不亮。
function litByRelay(ws, br, id) {
  const off = solve(ws.circuit, br, { on: new Set(), caps: ws.caps?.v ?? {} });
  return off.ok && !lampLit(off, br, id);
}

const SLOW_DV = 0.1;
const SLOW_COUNT = 4;
const emptyToggle = () => ({ state: null, v: {}, count: 0 });

// 慢速切换计数：stateOf 给出的状态变了，且自上次计数以来某个电容电压变了 SLOW_DV 以上，才计一次。
// 继电器不靠电容、自己哒哒乱跳时电容电压不变，不计数。stateOf 返回 null 表示这一刻不算状态，跳过。
function slowToggle(progress, ws, stateOf) {
  const state = stateOf(ws);
  if (state === null || state === progress.state) return progress;
  const v = ws.caps?.v ?? {};
  if (progress.state === null) return { ...progress, state, v };
  const moved = Object.keys(v).some(id => Math.abs(v[id] - (progress.v[id] ?? 0)) >= SLOW_DV);
  return moved ? { state, v, count: progress.count + 1 } : { ...progress, state };
}

// 第「自己闪的灯」关的闪光电路，不带灯：电池 → com，nc → 电阻 → 电容∥线圈。右侧留空放 LED。
const flasherPreset = () => presetCircuit(
  [['B', 'battery', 8, 14, { cells: 2 }], ['K', 'relay', 20, 8], ['R', 'resistor', 30, 14, { ohms: 47 }], ['C', 'capacitor', 18, 22, { farads: 0.5 }]],
  [['B.p', 'K.com'], ['K.nc', 'R.a'], ['R.b', 'K.x'], ['K.y', 'B.n'], ['R.b', 'C.a'], ['C.b', 'B.n']],
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
    id: 40, chapter: 8, name: '会存电的电容', goal: '断开开关以后，让灯再亮一会儿',
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
    id: 41, chapter: 8, name: '延时关灯', goal: '断开开关以后，让继电器多吸一会儿，灯晚一点再灭',
    palette: { battery: 1, switch: 1, relay: 1, capacitor: 1, lamp: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    // 开关都断开了，灯还靠继电器亮着，说明电容在帮线圈撑着。
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lit = ofType(ws.circuit, 'lamp').filter(l => lampLit(ws.result, br, l.id));
      if (!lit.length) return result(false, progress);
      if (ofType(ws.circuit, 'switch').some(s => s.params.closed)) return result(false, progress, '灯亮了。断开开关，看灯能不能晚一点再灭');
      return result(lit.some(l => litByRelay(ws, br, l.id)), progress);
    },
  },
  {
    id: 42, chapter: 8, name: '自己闪的灯', goal: '不用开关，让灯自己一亮一灭',
    palette: { battery: 1, relay: 1, resistor: 1, capacitor: 1, lamp: 1 },
    preset: () => createCircuit(), initProgress: emptyToggle,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const next = slowToggle(progress, ws, w => (ofType(w.circuit, 'lamp').some(l => lampLit(w.result, br, l.id)) ? 'on' : 'off'));
      return result(next.count >= SLOW_COUNT, next);
    },
  },
  {
    id: 43, chapter: 8, name: '自动红绿灯',
    goal: '给闪光电路接上红灯和绿灯，让它们自己轮流亮。绿灯比红灯亮得久，因为电容充电比放电快',
    palette: { led: 2, resistor: 2 }, lockPreset: true, preset: flasherPreset, initProgress: emptyToggle,
    check(progress, ws) {
      const next = slowToggle(progress, ws, ledColorState);
      return result(next.count >= SLOW_COUNT, next);
    },
  },
];
