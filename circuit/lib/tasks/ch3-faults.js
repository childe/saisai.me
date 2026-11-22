// 第 3 章末尾：用电压表找故障。先教「电压都落在断开的地方」，再在预置电路里找藏着的故障，先量再指认。
import { faultTask, presetCircuit, probedItems, ofType, result, MEASURE_FIRST } from '../task-kit.js';

// 48：电池 + 断开的开关 + 一盏灯串成一圈。量开关两端读 3 V，量灯两端读 0 V。
const openSwitchPreset = () => presetCircuit([
  ['B', 'battery', 5, 12, { cells: 2 }], ['S', 'switch', 5, 5, { closed: false }], ['L', 'lamp', 13, 5],
], [
  ['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n', { via: [[17, 5], [17, 16], [7, 16]] }],
]);

// 21：电池 + L1、L2、L3 串联，其中一盏灯丝断了
const lampsPreset = bad => presetCircuit([
  ['B', 'battery', 5, 12, { cells: 2 }],
  ['L1', 'lamp', 5, 5, {}, bad === 'L1' ? { fault: 'open' } : {}],
  ['L2', 'lamp', 11, 5, {}, bad === 'L2' ? { fault: 'open' } : {}],
  ['L3', 'lamp', 17, 5, {}, bad === 'L3' ? { fault: 'open' } : {}],
], [
  ['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'L3.a'], ['L3.b', 'B.n', { via: [[21, 5], [21, 16], [7, 16]] }],
]);

// 22：电池 → 开关(合上) → L1 → L2 → 电池，四根导线里有一根内部断了。导线留够长度，方便点选。
const wiresPreset = bad => {
  const open = k => (bad === k ? { fault: 'open' } : {});
  return presetCircuit([
    ['B', 'battery', 5, 13, { cells: 2 }], ['S', 'switch', 5, 5, { closed: true }],
    ['L1', 'lamp', 13, 5], ['L2', 'lamp', 21, 5],
  ], [
    ['B.p', 'S.a', open(0)],
    ['S.b', 'L1.a', open(1)],
    ['L1.b', 'L2.a', open(2)],
    ['L2.b', 'B.n', { via: [[25, 5], [25, 17], [7, 17]], ...open(3) }],
  ]);
};

export const CH3_FAULTS = [
  {
    id: 48, chapter: 3, name: '断开的地方', goal: '量一量断开的开关',
    how: '开关断开，灯不亮。用电压表量开关两端，再量灯两端。断开的地方能量到电池的 3 V，好好的灯是 0 V。',
    palette: { voltmeter: 1 }, lockPreset: true, preset: openSwitchPreset,
    initProgress: () => ({ probed: [], sawOpen: false }),
    check(progress, ws) {
      const old = progress.probed ?? [];
      const now = probedItems(ws.circuit);
      const fresh = now.filter(k => !old.includes(k));
      const S = ofType(ws.circuit, 'switch').find(p => p.preset);
      const L = ofType(ws.circuit, 'lamp').find(p => p.preset);
      // 量开关时读到接近电池电压，才算看到了「断开处有电压」。
      const high = ofType(ws.circuit, 'voltmeter').some(v => Math.abs(ws.result.parts[v.id]?.v ?? 0) >= 2.5);
      const sawOpen = progress.sawOpen || (!!S && now.includes(`part:${S.id}`) && high);
      const next = fresh.length || sawOpen !== progress.sawOpen ? { ...progress, probed: [...old, ...fresh], sawOpen } : progress;
      const passed = next.sawOpen && !!S && !!L && next.probed.includes(`part:${S.id}`) && next.probed.includes(`part:${L.id}`);
      return result(passed, next, next.probed.length ? null : MEASURE_FIRST);
    },
  },
  faultTask({
    id: 21, chapter: 3, name: '哪盏灯坏了', goal: '找出坏掉的那一盏灯',
    how: '三盏灯串联，有一盏灯丝断了，所以全都不亮。用电压表挨个量，读到 3 V 的就是它。点它，再按『就是它坏了』。',
    palette: { voltmeter: 1 }, variants: ['L1', 'L2', 'L3'], preset: lampsPreset, suspect: { types: ['lamp'], name: '灯' },
  }),
  faultTask({
    id: 22, chapter: 3, name: '哪根线断了', goal: '找出断掉的那根导线',
    how: '灯都不亮，可是灯和开关都是好的，是一根导线里面断了。把电压表接在一根导线的两头，读到 3 V 的就是它。点那根线，再按『就是它坏了』。',
    palette: { voltmeter: 1 }, variants: [0, 1, 2, 3], preset: wiresPreset, suspect: { types: ['wire'], name: '导线' },
  }),
];
