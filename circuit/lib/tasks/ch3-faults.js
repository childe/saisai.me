// 第 3 章末尾：用电压表找故障。预置电路里藏着一处故障，先量再指认。
import { faultTask, presetCircuit } from '../task-kit.js';

// 21：电池 + L1、L2、L3 串联，其中一盏灯丝断了
const lampsPreset = bad => presetCircuit([
  ['B', 'battery', 5, 12, { cells: 2 }],
  ['L1', 'lamp', 5, 5, {}, bad === 'L1' ? { fault: 'open' } : {}],
  ['L2', 'lamp', 11, 5, {}, bad === 'L2' ? { fault: 'open' } : {}],
  ['L3', 'lamp', 17, 5, {}, bad === 'L3' ? { fault: 'open' } : {}],
], [
  ['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'L3.a'], ['L3.b', 'B.n', { via: [[21, 5], [21, 16], [7, 16]] }],
]);

// 22：电池 → 开关(合上) → L1 一路；另一路经连接点 N1、N2、N3 到 L2。开关到 N1、N1–N2、N2–N3 三根导线是候选
const branchPreset = bad => presetCircuit([
  ['B', 'battery', 5, 12, { cells: 2 }], ['S', 'switch', 5, 5, { closed: true }],
  ['L1', 'lamp', 11, 5], ['L2', 'lamp', 11, 13],
  ['N1', 'node', 9, 7], ['N2', 'node', 9, 9], ['N3', 'node', 9, 11],
], [
  ['B.p', 'S.a'], ['S.b', 'L1.a'],
  ['S.b', 'N1.o', { via: [[7, 7]], ...(bad === 0 ? { fault: 'open' } : {}) }],
  ['N1.o', 'N2.o', bad === 1 ? { fault: 'open' } : {}],
  ['N2.o', 'N3.o', bad === 2 ? { fault: 'open' } : {}],
  ['N3.o', 'L2.a'],
  ['L1.b', 'B.n', { via: [[15, 5], [15, 16], [7, 16]] }], ['L2.b', 'B.n', { via: [[15, 13], [15, 16], [7, 16]] }],
]);

export const CH3_FAULTS = [
  faultTask({
    id: 21, chapter: 3, name: '哪盏灯坏了', goal: '三盏灯都不亮，用电压表找出坏掉的那一盏',
    palette: { voltmeter: 1 }, variants: ['L1', 'L2', 'L3'], preset: lampsPreset, suspect: { types: ['lamp'], name: '灯' },
  }),
  faultTask({
    id: 22, chapter: 3, name: '断掉的导线', goal: '有一盏灯不亮，找出断掉的那根导线',
    palette: { voltmeter: 1, ammeter: 1 }, variants: [0, 1, 2], preset: branchPreset, suspect: { types: ['wire'], name: '导线' },
  }),
];
