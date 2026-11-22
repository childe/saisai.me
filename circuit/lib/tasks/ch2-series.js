// 第 2 章：串联与并联。
import { solve } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, buzzerOn, withParams, ofType, result, noProgress, anySwitchPair, truth } from '../task-kit.js';

// 第 6 关：两个 2 节电池各带两盏灯。串联那边每盏约 0.22 W，并联那边约 0.83 W，以 2 倍区分。
const HINT6_SAME = '两边一样亮？看看两边的接法是不是不一样';
const HINT6_ONE = '每个电池各搭一个电路';
// 三盏灯接 1 节电池：并联时每盏约 0.21 W，串联时每盏约 0.02 W（根本不亮），以 0.15 W 区分。
const BRIGHT_P = 0.15;
const HINT10 = '灯不亮或者太暗，换个接法让它们都亮亮的';
// 第 49 关：两个 1 节电池。串联时灯约 2.94 V；并联、或只接一个电池时约 1.49 V，靠出电流的电池个数区分。
const SERIES_V = 2.5;
const PARALLEL_V = 2;
const HINT49_PAR = '再把两个电池并起来试试';
const HINT49_SER = '再把两个电池串起来试试';

// 正在出电流的电池个数（没接上的电池电流为 0）。
const feeding = ws => ofType(ws.circuit, 'battery').filter(b => (ws.result.parts[b.id]?.i ?? 0) > 1e-3).length;

export const CH2 = [
  {
    id: 6, chapter: 2, name: '串联和并联', goal: '搭两个电路，比一比亮度',
    how: '左边：一个电池接两盏灯串联。右边：一个电池接两盏灯并联。两边一起亮，看看哪边亮。',
    palette: { battery: 2, lamp: 4 }, defaults: { battery: { cells: 2 } }, locked: { battery: ['cells'] },
    preset: () => createCircuit(), initProgress: noProgress,
    // 四盏灯同时亮、两个电池都在供电，亮的两盏每盏功率是暗的两盏的 2 倍以上。
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lit = ofType(ws.circuit, 'lamp').filter(l => lampLit(ws.result, br, l.id));
      if (lit.length < 4) return result(false, progress);
      if (feeding(ws) < 2) return result(false, progress, HINT6_ONE);
      const ps = lit.map(l => ws.result.parts[l.id].p).sort((a, b) => a - b);
      const ok = ps[2] >= 2 * ps[1];
      return result(ok, progress, ok ? null : HINT6_SAME);
    },
  },
  {
    id: 49, chapter: 2, name: '电池的串联和并联', goal: '两个电池先串起来、再并起来点亮灯，比一比亮度',
    how: '串联：一个电池的正极接另一个的负极，剩下的两头接灯。并联：正极接正极，负极接负极，再接灯。两种都试，哪种更亮？',
    palette: { battery: 2, lamp: 1 }, defaults: { battery: { cells: 1 } }, locked: { battery: ['cells'] },
    preset: () => createCircuit(), initProgress: () => ({ series: false, parallel: false }),
    // 灯亮且两个电池都在出电流时，灯两端 ≥ 2.5 V 记串联，≤ 2 V 记并联；两种都记到就过关。
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamp = ofType(ws.circuit, 'lamp').find(l => lampLit(ws.result, br, l.id));
      const v = lamp && feeding(ws) >= 2 ? Math.abs(ws.result.parts[lamp.id].v) : 0;
      const series = progress.series || v >= SERIES_V;
      const parallel = progress.parallel || (v > 0 && v <= PARALLEL_V);
      const next = series === progress.series && parallel === progress.parallel ? progress : { series, parallel };
      const hint = series && !parallel ? HINT49_PAR : parallel && !series ? HINT49_SER : null;
      return result(series && parallel, next, hint);
    },
  },
  {
    id: 7, chapter: 2, name: '一个亮一个灭', goal: '每个开关只管一盏灯，第三盏一直亮', palette: { battery: 1, lamp: 3, switch: 2 },
    preset: () => createCircuit(), initProgress: noProgress,
    // 一对开关 (s1, s2)：有一盏灯只跟 s1 亮灭，另一盏只跟 s2，第三盏四种组合下都亮。
    check(progress, ws) {
      const lamps = ofType(ws.circuit, 'lamp');
      if (lamps.length < 3) return result(false, progress);
      const ok = anySwitchPair(ws, (t, br) => {
        const follows = (l, want) => truth(k => lampLit(t[k], br, l.id), want);
        return lamps.some(a => follows(a, ['tt', 'tf']) &&
          lamps.some(b => b !== a && follows(b, ['tt', 'ft']) &&
            lamps.some(c => c !== a && c !== b && follows(c, ['tt', 'tf', 'ft', 'ff']))));
      });
      return result(ok, progress);
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
    id: 10, chapter: 2, name: '总开关', goal: '一个开关管三盏灯，三盏都要亮亮的', palette: { battery: 1, lamp: 3, switch: 1 },
    defaults: { battery: { cells: 1 } }, locked: { battery: ['cells'] },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const lamps = ofType(ws.circuit, 'lamp');
      if (lamps.length < 3) return result(false, progress);
      let dim = false;
      for (const s of ofType(ws.circuit, 'switch')) {
        const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
        const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
        if (!on.ok || !off.ok) continue;
        if (lamps.some(l => lampLit(off, br, l.id))) continue;
        // 开关合上时每盏灯都有电流流过，才算「接法对了但不够亮」。
        if (!lamps.every(l => (on.parts[l.id]?.p ?? 0) > 1e-4)) continue;
        if (lamps.every(l => lampLit(on, br, l.id) && on.parts[l.id].p >= BRIGHT_P)) return result(true, progress);
        dim = true;
      }
      return result(false, progress, dim ? HINT10 : null);
    },
  },
];
