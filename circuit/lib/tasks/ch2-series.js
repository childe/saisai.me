// 第 2 章：串联与并联。
import { solve } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, buzzerOn, withParams, ofType, result, noProgress, anySwitchPair, truth } from '../task-kit.js';

const HINT6 = '试试另一种接法，亮度有什么不同？';
// 灯接 1 节电池：并联时每盏约 0.22 W，串联时每盏约 0.06 W，以 0.15 W 区分。
const BRIGHT_P = 0.15;
const HINT10 = '两盏灯有点暗，换个接法让它们都亮亮的';

export const CH2 = [
  {
    id: 6, chapter: 2, name: '串联和并联', goal: '两种接法都试，比一比亮度', palette: { battery: 1, lamp: 2 },
    defaults: { battery: { cells: 2 } }, locked: { battery: ['cells'] },
    preset: () => createCircuit(), initProgress: () => ({ first: null }),
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      const bothLit = lamps.length >= 2 && lamps.every(l => lampLit(ws.result, br, l.id));
      const hint = progress.first ? HINT6 : null;
      if (!bothLit) return result(false, progress, hint);
      const powers = Object.fromEntries(lamps.map(l => [l.id, ws.result.parts[l.id].p]));
      if (!progress.first) return result(false, { first: { topoRev: ws.result.topoRev, powers } }, HINT6);
      if (ws.result.topoRev === progress.first.topoRev) return result(false, progress, HINT6);
      const now = Object.values(powers).sort((a, b) => a - b);
      const before = Object.values(progress.first.powers).sort((a, b) => a - b);
      if (now.length !== before.length) return result(false, progress, HINT6);
      const differ = now.every((p, i) => Math.max(p, before[i]) / Math.min(p, before[i]) >= 2);
      return result(differ, progress, differ ? null : HINT6);
    },
  },
  {
    id: 7, chapter: 2, name: '一个亮一个灭', goal: '一个开关只控制其中一个灯', palette: { battery: 1, lamp: 2, switch: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      if (lamps.length < 2) return result(false, progress);
      for (const s of ofType(ws.circuit, 'switch')) {
        const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!on.ok || !off.ok) continue;
        const litOff = lamps.filter(l => lampLit(off, br, l.id)).length;
        const allOn = lamps.every(l => lampLit(on, br, l.id));
        if (litOff === 1 && allOn) return result(true, progress);
      }
      return result(false, progress);
    },
  },
  {
    id: 8, chapter: 2, name: '保险箱', goal: '两个开关都合上，灯才亮', palette: { battery: 1, lamp: 1, switch: 2 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const lamps = ofType(ws.circuit, 'lamp');
      return result(anySwitchPair(ws, (t, br) =>
        lamps.some(l => truth(k => lampLit(t[k], br, l.id), ['tt']))), progress);
    },
  },
  {
    id: 9, chapter: 2, name: '前门后门', goal: '前门、后门的开关都能让门铃响', palette: { battery: 1, buzzer: 1, switch: 2 },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const buzzers = ofType(ws.circuit, 'buzzer');
      return result(anySwitchPair(ws, (t, br) =>
        buzzers.some(z => truth(k => buzzerOn(t[k], br, z.id), ['tt', 'tf', 'ft']))), progress);
    },
  },
  {
    id: 10, chapter: 2, name: '总开关', goal: '一个开关管两盏灯，两盏都要亮亮的', palette: { battery: 1, lamp: 2, switch: 1 },
    defaults: { battery: { cells: 1 } }, locked: { battery: ['cells'] },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      if (lamps.length < 2) return result(false, progress);
      let dim = false;
      for (const s of ofType(ws.circuit, 'switch')) {
        const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!on.ok || !off.ok) continue;
        if (!lamps.every(l => lampLit(on, br, l.id)) || lamps.some(l => lampLit(off, br, l.id))) continue;
        if (lamps.every(l => on.parts[l.id].p >= BRIGHT_P)) return result(true, progress);
        dim = true;
      }
      return result(false, progress, dim ? HINT10 : null);
    },
  },
];
