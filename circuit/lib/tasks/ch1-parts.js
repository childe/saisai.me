// 第 1 章：认识元件。
import { PHYS } from '../parts.js';
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
  {
    id: 25, chapter: 1, name: '保险丝救场', goal: '用保险丝保护短路的电池', palette: { fuse: 1 },
    how: '电池的正极和负极被一根导线直接连起来了，这叫短路，电流大得会烧坏电池。把保险丝接进短路的那根导线，电流一大它就先熔断，电池就没事了。',
    preset: () => presetCircuit([['B', 'battery', 9, 12], ['L', 'lamp', 9, 5]], [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']]),
    initProgress: () => ({ pre: null }),
    // 保险丝熔断前要流过和电池一样大的短路电流（接在短路那条线上），熔断后电池电流回到正常。
    check(progress, ws) {
      const f = ofType(ws.circuit, 'fuse')[0];
      const b = ofType(ws.circuit, 'battery')[0];
      if (!f || !b) return result(false, progress);
      let pre = progress.pre;
      for (const r of ws.trail) {
        if (r.brokenKey.split(',').includes(f.id)) continue;
        if (!r.parts[f.id] || !r.parts[b.id]) continue;
        pre = { iFuse: Math.abs(r.parts[f.id].i), iBatt: Math.abs(r.parts[b.id].i) };
      }
      const next = pre === progress.pre ? progress : { pre };
      const blown = !!ws.damage.broken[f.id];
      const iNow = Math.abs(ws.result.parts[b.id]?.i ?? Infinity);
      const passed = blown && iNow < PHYS.SHORT_A && !!pre &&
        Math.abs(pre.iFuse - pre.iBatt) <= 0.05 * pre.iBatt && pre.iFuse > PHYS.SHORT_A;
      return result(passed, next);
    },
  },
];
