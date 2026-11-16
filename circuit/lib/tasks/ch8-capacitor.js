// 第 8 章：电容与定时。
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, ofType, result, noProgress } from '../task-kit.js';

const BATTERY_IDLE_A = 0.001;

export const CH8 = [
  {
    id: 38, chapter: 8, name: '会存电的电容', goal: '断开开关以后，让灯再亮一会儿',
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
];
