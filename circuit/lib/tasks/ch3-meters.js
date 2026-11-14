// 第 3 章：电表。
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, ofType, result, noProgress, predictTask, presetCircuit, presetReading } from '../task-kit.js';

// presetCircuit 逐个加元件，元件按列出顺序编号 p1、p2……，读数按名字取。
const idOf = (parts, name) => `p${parts.findIndex(([n]) => n === name) + 1}`;
// 预置电路里所有开关合上后的读数。
const closedReading = (c, id, field) => presetReading(c, ofType(c, 'switch').map(s => s.id), id, field);
const withinPct = (x, y, pct) => Math.abs(x - y) <= pct * Math.abs(y);

// 12：电池 → 开关 → A1 → 灯 → 灯 → A2 → 电池
const seriesParts = cells => [
  ['B', 'battery', 5, 12, { cells }], ['S', 'switch', 5, 5], ['A1', 'ammeter', 11, 5], ['L1', 'lamp', 17, 5],
  ['L2', 'lamp', 17, 12], ['A2', 'ammeter', 11, 12],
];
const seriesWires = [['B.p', 'S.a'], ['S.b', 'A1.p'], ['A1.n', 'L1.a'], ['L1.b', 'L2.b'], ['L2.a', 'A2.n'], ['A2.p', 'B.n']];
const seriesPreset = cells => presetCircuit(seriesParts(cells), seriesWires);

// 13：电池 → 开关 → 灯 → 灯 → 电池，电压表并在第一盏灯上
const dividerParts = cells => [
  ['B', 'battery', 5, 12, { cells }], ['S', 'switch', 5, 5], ['L1', 'lamp', 11, 5], ['L2', 'lamp', 17, 5], ['V', 'voltmeter', 11, 12],
];
const dividerWires = [
  ['B.p', 'S.a'], ['S.b', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n', { via: [[19, 15], [7, 15]] }],
  ['V.p', 'L1.a'], ['V.n', 'L1.b'],
];
const dividerPreset = cells => presetCircuit(dividerParts(cells), dividerWires);

// 14：电池 → 开关 → A2 → n 盏并联的灯 → 电池，A1 串在第一盏灯的支路上
function branchSpec({ cells, n }) {
  const parts = [
    ['B', 'battery', 5, 12, { cells }], ['S', 'switch', 5, 5], ['A2', 'ammeter', 11, 5], ['A1', 'ammeter', 17, 5], ['L1', 'lamp', 23, 5],
  ];
  const wires = [
    ['B.p', 'S.a'], ['S.b', 'A2.p'], ['A2.n', 'A1.p'], ['A1.n', 'L1.a'], ['L1.b', 'B.n', { via: [[26, 5], [26, 16], [7, 16]] }],
  ];
  for (let k = 2; k <= n; k++) {
    const y = 5 + (k - 1) * 4;
    parts.push([`L${k}`, 'lamp', 23, y]);
    wires.push(['A2.n', `L${k}.a`, { via: [[14, 5], [14, y]] }], [`L${k}.b`, 'B.n', { via: [[26, y], [26, 16], [7, 16]] }]);
  }
  return { parts, wires };
}
const branchPreset = v => { const { parts, wires } = branchSpec(v); return presetCircuit(parts, wires); };

const SER_A1 = idOf(seriesParts(1), 'A1');
const SER_A2 = idOf(seriesParts(1), 'A2');
const V_ID = idOf(dividerParts(1), 'V');
const BR_A1 = idOf(branchSpec({ cells: 1, n: 2 }).parts, 'A1');
const BR_A2 = idOf(branchSpec({ cells: 1, n: 2 }).parts, 'A2');

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
  predictTask({
    id: 12, chapter: 3, name: '串联电流', goal: '猜一猜，A2 会读多少电流？', variants: [2, 3, 4], preset: seriesPreset, unit: 'A',
    target: ws => Math.abs(ws.result.parts[SER_A2].i),
    question: cells => `合上开关后 A1 读 ${closedReading(seriesPreset(cells), SER_A1, 'i').toFixed(2)} A。猜猜 A2 读多少？`,
  }),
  predictTask({
    id: 13, chapter: 3, name: '串联分压', goal: '猜一猜，电压表会读多少伏？', variants: [2, 3, 4], preset: dividerPreset, unit: 'V',
    target: ws => Math.abs(ws.result.parts[V_ID].v),
    question: cells => `电池是 ${cells * 1.5} V，两盏一样的灯串联。猜猜电压表读多少？`,
  }),
  predictTask({
    id: 14, chapter: 3, name: '并联干路', goal: '猜一猜，A2 会读多少电流？',
    variants: [{ cells: 1, n: 2 }, { cells: 2, n: 2 }, { cells: 1, n: 3 }, { cells: 2, n: 3 }], preset: branchPreset, unit: 'A',
    target: ws => Math.abs(ws.result.parts[BR_A2].i),
    question: v => `A1 读 ${closedReading(branchPreset(v), BR_A1, 'i').toFixed(2)} A，${v.n} 盏一样的灯并联。猜猜 A2 读多少？`,
  }),
  {
    id: 15, chapter: 3, name: '精确调电流', goal: '把灯的电流调到 0.1 安', palette: { battery: 1, lamp: 1, rheostat: 1, ammeter: 1 },
    defaults: { battery: { cells: 1 } }, locked: { battery: ['cells'] },
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      const P = ws.result.parts;
      const ok = ofType(ws.circuit, 'ammeter').some(a => {
        const ai = Math.abs(P[a.id].i);
        return ai >= 0.095 && ai <= 0.105 &&
          ofType(ws.circuit, 'lamp').some(l => lampLit(ws.result, br, l.id) && withinPct(Math.abs(P[l.id].i), ai, 0.05));
      });
      return result(ok, progress);
    },
  },
  {
    id: 16, chapter: 3, name: 'LED 能受多大电流', goal: '做实验，找出 LED 最多能通过多少电流', palette: { battery: 2, rheostat: 1, ammeter: 1, led: 2 },
    answer: { kind: 'measure', question: () => 'LED 最多能通过多少电流？', unit: 'A' },
    preset: () => createCircuit(), initProgress: () => ({ answer: null, sawSeries: false, burned: false }),
    submit: (progress, value) => ({ progress: { ...progress, answer: value }, hint: null }),
    check(progress, ws) {
      const leds = ofType(ws.circuit, 'led'), meters = ofType(ws.circuit, 'ammeter');
      const seen = [...ws.trail, ws.result].some(r => meters.some(a => {
        const ai = Math.abs(r.parts?.[a.id]?.i ?? 0);
        return ai >= 0.02 && leds.some(d => withinPct(Math.abs(r.parts[d.id]?.i ?? 0), ai, 0.05));
      }));
      const sawSeries = progress.sawSeries || seen;
      const burned = progress.burned || leds.some(d => ws.damage.broken[d.id]);
      const next = sawSeries === progress.sawSeries && burned === progress.burned ? progress : { ...progress, sawSeries, burned };
      if (next.answer == null) return result(false, next);
      if (!sawSeries || !burned) return result(false, next, '先用电流表和变阻器做实验，把 LED 调到烧坏为止');
      if (next.answer >= 0.025 && next.answer <= 0.035) return result(true, next);
      return result(false, next, '再看看 LED 烧坏前电流表读多少');
    },
  },
];
