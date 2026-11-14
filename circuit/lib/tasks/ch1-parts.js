// 第 1 章：认识元件。
import { solve } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, ledLit, buzzerOn, withParams, ofType, result, noProgress, presetCircuit } from '../task-kit.js';

export const CH1 = [
  {
    id: 1, chapter: 1, name: '点亮一盏灯', goal: '让灯亮起来', palette: { battery: 1, lamp: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      return result(ofType(ws.circuit, 'lamp').some(l => lampLit(ws.result, br, l.id)), progress);
    },
  },
  {
    id: 2, chapter: 1, name: '加个开关', goal: '用开关控制灯', palette: { battery: 1, lamp: 1, switch: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      for (const s of ofType(ws.circuit, 'switch')) {
        const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!on.ok || !off.ok) continue;
        if (lamps.some(l => lampLit(on, br, l.id) && !lampLit(off, br, l.id))) return result(true, progress);
      }
      return result(false, progress);
    },
  },
  {
    id: 3, chapter: 1, name: '门铃', goal: '按下开关，蜂鸣器就响', palette: { battery: 1, switch: 1, buzzer: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const buzzers = ofType(ws.circuit, 'buzzer');
      for (const s of ofType(ws.circuit, 'switch')) {
        const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!on.ok || !off.ok) continue;
        if (buzzers.some(z => buzzerOn(on, br, z.id) && !buzzerOn(off, br, z.id))) return result(true, progress);
      }
      return result(false, progress);
    },
  },
  {
    id: 4, chapter: 1, name: '让风扇反转', goal: '让风扇反着转', palette: {},
    preset: () => presetCircuit([['B', 'battery', 9, 12], ['M', 'motor', 9, 5]], [['B.p', 'M.a'], ['M.b', 'B.n']]),
    initProgress: noProgress,
    check(progress, ws) {
      return result(ofType(ws.circuit, 'motor').some(m => ws.result.parts[m.id]?.v < -0.5), progress);
    },
  },
  {
    id: 5, chapter: 1, name: '让 LED 亮起来', goal: '点亮 LED，别烧坏它', palette: { battery: 2, led: 1, resistor: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      return result(ofType(ws.circuit, 'led').some(d => ledLit(ws.result, br, d.id)), progress);
    },
  },
];
