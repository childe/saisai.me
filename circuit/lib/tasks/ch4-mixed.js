// 第 4 章：混联。
import { solve } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { PHYS } from '../parts.js';
import { lampLit, withParams, ofType, result, noProgress, predictTask, presetCircuit } from '../task-kit.js';

// 18：电池 → 开关 → 电流表 → L1 → (L2 并 L3) → 电池
const mixedParts = cells => [
  ['B', 'battery', 5, 12, { cells }], ['S', 'switch', 5, 5], ['A', 'ammeter', 11, 5], ['L1', 'lamp', 17, 5],
  ['L2', 'lamp', 23, 5], ['L3', 'lamp', 23, 9],
];
const mixedWires = [
  ['B.p', 'S.a'], ['S.b', 'A.p'], ['A.n', 'L1.a'], ['L1.b', 'L2.a'], ['L1.b', 'L3.a', { via: [[20, 5], [20, 9]] }],
  ['L2.b', 'B.n', { via: [[26, 5], [26, 16], [7, 16]] }], ['L3.b', 'B.n', { via: [[26, 9], [26, 16], [7, 16]] }],
];
const mixedPreset = cells => presetCircuit(mixedParts(cells), mixedWires);
const MIXED_A = `p${mixedParts(1).findIndex(([n]) => n === 'A') + 1}`;

// 17：三盏都亮，有一盏至少是另两盏各自的 2 倍，另两盏功率相差不超过 10%。
function mainAndSmall(ws) {
  const br = brokenSet(ws.damage);
  const lamps = ofType(ws.circuit, 'lamp');
  if (lamps.length !== 3 || !lamps.every(l => lampLit(ws.result, br, l.id))) return false;
  const p = lamps.map(l => ws.result.parts[l.id].p);
  return p.some((main, k) => {
    const [x, y] = p.filter((_, j) => j !== k);
    return main >= 2 * x && main >= 2 * y && Math.abs(x - y) <= 0.1 * Math.max(x, y);
  });
}

// 19：对某个开关，断开时两盏都亮；合上时一盏灭，另一盏功率至少翻倍，电池电流不到短路值。
function dimToBright(ws) {
  const br = brokenSet(ws.damage);
  const lamps = ofType(ws.circuit, 'lamp');
  const batteries = ofType(ws.circuit, 'battery');
  if (lamps.length < 2 || !batteries.length) return false;
  return ofType(ws.circuit, 'switch').some(s => {
    const off = solve(withParams(ws.circuit, { [s.id]: { closed: false } }), br);
    const on = solve(withParams(ws.circuit, { [s.id]: { closed: true } }), br);
    if (!off.ok || !on.ok || !lamps.every(l => lampLit(off, br, l.id))) return false;
    if (batteries.some(b => Math.abs(on.parts[b.id].i) >= PHYS.SHORT_A)) return false;
    const lit = lamps.filter(l => lampLit(on, br, l.id));
    return lit.length === 1 && lamps.length === 2 && on.parts[lit[0].id].p >= 2 * off.parts[lit[0].id].p;
  });
}

// 20：对某个变阻器，pos 0 和 pos 1 之间一盏灯明显变化（比值 ≥ 2），另一盏灯不变（比值 ≤ 1.1）。
function oneDims(ws) {
  const br = brokenSet(ws.damage);
  const lamps = ofType(ws.circuit, 'lamp');
  if (lamps.length < 2) return false;
  return ofType(ws.circuit, 'rheostat').some(r => {
    const lo = solve(withParams(ws.circuit, { [r.id]: { pos: 0 } }), br);
    const hi = solve(withParams(ws.circuit, { [r.id]: { pos: 1 } }), br);
    if (!lo.ok || !hi.ok) return false;
    const ratio = l => {
      const a = lo.parts[l.id].p, b = hi.parts[l.id].p;
      return { a, b, r: Math.max(a, b) / Math.min(a, b) };
    };
    const changes = lamps.some(l => { const q = ratio(l); return q.a > 1e-4 && q.b > 1e-4 && q.r >= 2; });
    const steady = lamps.some(l => lampLit(lo, br, l.id) && lampLit(hi, br, l.id) && ratio(l).r <= 1.1);
    return changes && steady;
  });
}

export const CH4 = [
  {
    id: 17, chapter: 4, name: '主灯和小灯', goal: '三盏灯都亮，其中一盏要特别亮', palette: { battery: 1, lamp: 3 },
    defaults: { battery: { cells: 2 } },
    preset: () => createCircuit(), initProgress: noProgress,
    check: (progress, ws) => result(mainAndSmall(ws), progress),
  },
  predictTask({
    id: 18, chapter: 4, name: '混联电流', goal: '猜一猜，电流表会读多少？', variants: [2, 3, 4], preset: mixedPreset, unit: 'A',
    target: ws => Math.abs(ws.result.parts[MIXED_A].i),
    question: cells => `电池 ${cells * PHYS.V_CELL} V，每盏灯 ${PHYS.LAMP_R} Ω。猜猜电流表读多少？`,
  }),
  {
    id: 19, chapter: 4, name: '越灭越亮', goal: '合上开关，一盏灯灭了，另一盏反而更亮', palette: { battery: 1, lamp: 2, switch: 1 },
    defaults: { battery: { cells: 2 } },
    preset: () => createCircuit(), initProgress: noProgress,
    check: (progress, ws) => result(dimToBright(ws), progress),
  },
  {
    id: 20, chapter: 4, name: '一盏调光一盏不变', goal: '转变阻器，一盏灯变亮变暗，另一盏灯不变', palette: { battery: 1, lamp: 2, rheostat: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check: (progress, ws) => result(oneDims(ws), progress),
  },
];
