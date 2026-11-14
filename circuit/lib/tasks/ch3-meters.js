// 第 3 章：电表。
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, ofType, result, noProgress } from '../task-kit.js';

export const CH3 = [
  {
    id: 11, chapter: 3, name: '量一量', goal: '测出灯泡的电流和电压', palette: { battery: 1, lamp: 1, ammeter: 1, voltmeter: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const P = ws.result.parts;
      for (const l of ofType(ws.circuit, 'lamp')) {
        if (!lampLit(ws.result, br, l.id)) continue;
        const li = Math.abs(P[l.id].i), lv = Math.abs(P[l.id].v);
        for (const a of ofType(ws.circuit, 'ammeter')) for (const v of ofType(ws.circuit, 'voltmeter')) {
          const ai = Math.abs(P[a.id].i), vv = Math.abs(P[v.id].v);
          if (ai >= 0.01 && vv >= 0.1 && Math.abs(ai - li) <= 0.05 * li && Math.abs(vv - lv) <= 0.05 * lv) {
            return result(true, progress);
          }
        }
      }
      return result(false, progress);
    },
  },
];
