// 第 5 章：找故障。预置电路里藏着一处故障，先量再指认。
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

// 22：电池 → 开关(合上) → L1 一路；另一路经连接点 N1、N2 到 L2。N1、N2 之间的导线和开关到 N1 的导线是两个候选
const branchPreset = bad => presetCircuit([
  ['B', 'battery', 5, 12, { cells: 2 }], ['S', 'switch', 5, 5, { closed: true }],
  ['L1', 'lamp', 11, 5], ['L2', 'lamp', 11, 12],
  ['N1', 'node', 9, 8], ['N2', 'node', 9, 10],
], [
  ['B.p', 'S.a'], ['S.b', 'L1.a'],
  ['S.b', 'N1.o', { via: [[7, 8]], ...(bad === 0 ? { fault: 'open' } : {}) }],
  ['N1.o', 'N2.o', bad === 1 ? { fault: 'open' } : {}],
  ['N2.o', 'L2.a'],
  ['L1.b', 'B.n', { via: [[15, 5], [15, 16], [7, 16]] }], ['L2.b', 'B.n', { via: [[15, 12], [15, 16], [7, 16]] }],
]);

// 23：楼梯灯，故障是某个开关的某一掷接触不良。variant 如 'S1.a' 表示 S1 的 a 掷
const stairsPreset = variant => {
  const [sw, throwName] = variant.split('.');
  const bad = name => (name === sw ? { fault: `open-${throwName}` } : {});
  return presetCircuit([
    ['B', 'battery', 5, 12, { cells: 2 }],
    ['S1', 'spdt', 5, 5, {}, bad('S1')], ['S2', 'spdt', 15, 5, {}, bad('S2')],
    ['L', 'lamp', 13, 12],
  ], [
    ['B.p', 'S1.c'],
    ['S1.a', 'S2.a', { via: [[7, 2], [19, 2], [19, 4]] }],
    ['S1.b', 'S2.b', { via: [[7, 8], [19, 8], [19, 6]] }],
    ['S2.c', 'L.a', { via: [[13, 5], [11, 5]] }],
    ['L.b', 'B.n', { via: [[15, 15], [7, 15]] }],
  ]);
};

export const CH5 = [
  faultTask({
    id: 21, chapter: 5, name: '哪盏灯坏了', goal: '三盏灯都不亮，用电压表找出坏掉的那一盏',
    palette: { voltmeter: 1 }, variants: ['L1', 'L2', 'L3'], preset: lampsPreset,
  }),
  faultTask({
    id: 22, chapter: 5, name: '断掉的导线', goal: '有一盏灯不亮，找出断掉的那根导线',
    palette: { voltmeter: 1, ammeter: 1 }, variants: [0, 1], preset: branchPreset,
  }),
  faultTask({
    id: 23, chapter: 5, name: '失灵的开关', goal: '楼梯灯有时不亮，找出哪个开关坏了',
    palette: { voltmeter: 1 }, variants: ['S1.a', 'S1.b', 'S2.a', 'S2.b'], preset: stairsPreset,
  }),
];
