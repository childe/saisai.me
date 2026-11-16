// 第 8 章：电容与定时。
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { solve } from '../solve.js';
import { lampLit, ofType, result, noProgress } from '../task-kit.js';

const BATTERY_IDLE_A = 0.001;

// 灯靠继电器点亮：把继电器全部当作释放再解一次，这盏灯就不亮。
function litByRelay(ws, br, id) {
  const off = solve(ws.circuit, br, { on: new Set(), caps: ws.caps?.v ?? {} });
  return off.ok && !lampLit(off, br, id);
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
];
