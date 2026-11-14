// 第 7 章：逻辑与加法器。开关合上（或双刀双掷拨到「1 位置」）算 1。
import { connectivity } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import {
  lampLit, withParams, ofType, result, noProgress, truth, stableSolve, relayMatters, displayValue, presetCircuit,
} from '../task-kit.js';

const BITS = [[1, 1], [1, 0], [0, 1], [0, 0]];
const flip = t => (t === 'a' ? 'b' : 'a');

// 每组开关设定各做一份电路，逐个稳态求解；有一份不稳定就返回 null。
function solveEach(circuit, br, settings) {
  const circuits = settings.map(ch => withParams(circuit, ch));
  const results = [];
  for (const c of circuits) {
    const s = stableSolve(c, br);
    if (!s.stable) return null;
    results.push(s.result);
  }
  return { circuits, results };
}

// 继电器灯题：对每个开关（或有序开关对）和每盏灯，want(lit) 判亮灭对不对，且继电器起作用。
// lit(i) 是第 i 组设定下灯亮不亮；灯还要和每个开关都不在同一个连通回路里，开关只能经继电器管灯。
function relayLampTask(ws, nSwitches, want) {
  const br = brokenSet(ws.damage);
  const sw = ofType(ws.circuit, 'switch');
  const lamps = ofType(ws.circuit, 'lamp');
  const find = connectivity(ws.circuit);
  const groups = nSwitches === 1 ? sw.map(s => [s]) : sw.flatMap(a => sw.filter(b => b !== a).map(b => [a, b]));
  const bits = nSwitches === 1 ? [[1], [0]] : BITS;
  for (const g of groups) {
    const settings = bits.map(bs => Object.fromEntries(g.map((s, i) => [s.id, { closed: !!bs[i] }])));
    const solved = solveEach(ws.circuit, br, settings);
    if (!solved) continue;
    for (const l of lamps) {
      if (g.some(s => find(`${s.id}.a`) === find(`${l.id}.a`))) continue;
      const out = r => String(lampLit(r, br, l.id));
      if (want(i => lampLit(solved.results[i], br, l.id)) && relayMatters(solved.circuits, br, out)) return true;
    }
  }
  return false;
}

// 半加器：有序双刀双掷对 (d1, d2) 和各自的「1 位置」m1、m2，四种组合下某个显示器都显示 A+B。
function halfAdderOk(ws) {
  const br = brokenSet(ws.damage);
  const ds = ofType(ws.circuit, 'dpdt');
  const displays = ofType(ws.circuit, 'display');
  for (const d1 of ds) for (const d2 of ds) {
    if (d1 === d2) continue;
    for (const m1 of ['a', 'b']) for (const m2 of ['a', 'b']) {
      const settings = BITS.map(([a, b]) => ({ [d1.id]: { to: a ? m1 : flip(m1) }, [d2.id]: { to: b ? m2 : flip(m2) } }));
      const solved = solveEach(ws.circuit, br, settings);
      if (!solved) continue;
      if (displays.some(d => BITS.every(([a, b], i) => displayValue(solved.results[i], br, d.id) === a + b))) return true;
    }
  }
  return false;
}

// 电铃：有按钮按住时继电器自己振荡（稳态解不出来），松开后稳定且继电器全部释放。
function bellOk(ws) {
  const br = brokenSet(ws.damage);
  return ofType(ws.circuit, 'button').some(b => {
    if (stableSolve(withParams(ws.circuit, { [b.id]: { pressed: true } }), br).stable) return false;
    const off = stableSolve(withParams(ws.circuit, { [b.id]: { pressed: false } }), br);
    return off.stable && off.on.size === 0;
  });
}

// 第 36 关预置：上排线圈电池 BC 和开关 A、B、C，中排 7 个继电器（转 90°，线圈朝上、触点朝下），
// 下排逻辑电池 BL 和显示器 D。同一开关的线圈串成一串：开关 → 最右的线圈 → … → 最左的线圈 → BC 负极，
// 这样线圈导线只在两处和地线交叉；线圈 20 mA 吸合，1 节电池过 90 Ω 只有约 17 mA（不够），2 节约 33 mA，所以 BC 用 2 节。
// 节点 P1、P2 是正极母线的分叉，G1、G2 是地线母线的分叉。
const RELAYS = [['A1', 4], ['A2', 7], ['B1', 11], ['B2', 14], ['B3', 17], ['C1', 21], ['C2', 24]];
const fullAdderPreset = () => presetCircuit([
  ['BC', 'battery', 2, 3, { cells: 2 }, { tag: 'BC', rot: 1 }],
  ['A', 'switch', 6, 4, {}, { tag: 'A' }],
  ['B', 'switch', 16, 4, {}, { tag: 'B' }],
  ['C', 'switch', 23, 4, {}, { tag: 'C' }],
  ...RELAYS.map(([name, x]) => [name, 'relay', x, 9, {}, { tag: name, rot: 1 }]),
  ['BL', 'battery', 6, 16, {}, { tag: 'BL' }],
  ['D', 'display', 26, 15, {}, { tag: 'D' }],
  ['P1', 'node', 4, 1], ['P2', 'node', 14, 1], ['G1', 'node', 3, 6], ['G2', 'node', 10, 6],
], [
  ['BC.p', 'P1.o'], ['P1.o', 'A.a'], ['P1.o', 'P2.o'], ['P2.o', 'B.a'], ['P2.o', 'C.a'],
  ['A.b', 'A2.x'], ['A2.y', 'A1.x'],
  ['B.b', 'B3.x'], ['B3.y', 'B2.x'], ['B2.y', 'B1.x'],
  ['C.b', 'C2.x'], ['C2.y', 'C1.x'],
  ['BC.n', 'G1.o'], ['G1.o', 'A1.y'], ['G1.o', 'G2.o'], ['G2.o', 'B1.y'], ['G2.o', 'C1.y'],
  ['BL.n', 'D.g', { via: [[8, 17]] }],
]);

// 全加器：预置开关 A、B、C 的 8 种组合都稳定，显示器显示 A+B+C。
function fullAdderOk(ws) {
  const br = brokenSet(ws.damage);
  const tagged = t => ws.circuit.parts.find(p => p.preset && p.tag === t);
  const sw = ['A', 'B', 'C'].map(tagged), d = tagged('D');
  if (sw.some(s => !s) || !d) return false;
  for (let n = 0; n < 8; n++) {
    const bits = [4, 2, 1].map(m => (n & m ? 1 : 0));
    const s = stableSolve(withParams(ws.circuit, Object.fromEntries(sw.map((p, i) => [p.id, { closed: !!bits[i] }]))), br);
    if (!s.stable || displayValue(s.result, br, d.id) !== bits[0] + bits[1] + bits[2]) return false;
  }
  return true;
}

const RELAY_PALETTE = { battery: 2, switch: 1, relay: 1, lamp: 1 };

export const CH7 = [
  {
    id: 30, chapter: 7, name: '认识数字显示器', goal: v => `让显示器显示 ${v}`, palette: { battery: 1, display: 1 },
    variants: [3, 5, 6, 7, 9, 11, 13, 14], preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      return result(ofType(ws.circuit, 'display').some(d => displayValue(ws.result, br, d.id) === ws.variant), progress);
    },
  },
  {
    id: 31, chapter: 7, name: '半加器', goal: '两个开关代表 A、B：拨到 a 是 0，拨到 b 是 1。让显示器显示 A+B', palette: { battery: 1, dpdt: 2, display: 1 },
    preset: () => createCircuit(), initProgress: noProgress,
    check: (progress, ws) => result(halfAdderOk(ws), progress),
  },
  {
    id: 32, chapter: 7, name: '认识继电器', goal: '合上开关，继电器点亮另一节电池那边的灯', palette: RELAY_PALETTE,
    preset: () => createCircuit(), initProgress: noProgress,
    // 设定顺序：合上、断开
    check: (progress, ws) => result(relayLampTask(ws, 1, lit => lit(0) && !lit(1)), progress),
  },
  {
    id: 33, chapter: 7, name: '继电器非门', goal: '开关合上灯灭，断开灯亮', palette: RELAY_PALETTE,
    preset: () => createCircuit(), initProgress: noProgress,
    check: (progress, ws) => result(relayLampTask(ws, 1, lit => !lit(0) && lit(1)), progress),
  },
  {
    id: 34, chapter: 7, name: '继电器与门 / 或门',
    goal: v => (v === 'and' ? '两个开关都合上，灯才亮' : '随便合上一个开关，灯就亮'),
    palette: { battery: 2, switch: 2, relay: 2, lamp: 1 }, variants: ['and', 'or'],
    preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      // BITS 顺序对应 truth 的键 tt、tf、ft、ff
      const keys = ['tt', 'tf', 'ft', 'ff'];
      const want = ws.variant === 'and' ? ['tt'] : ['tt', 'tf', 'ft'];
      return result(relayLampTask(ws, 2, lit => truth(k => lit(keys.indexOf(k)), want)), progress);
    },
  },
  {
    id: 35, chapter: 7, name: '自制电铃', goal: '按住按钮，继电器自己哒哒响', palette: { battery: 1, button: 1, relay: 1 },
    preset: () => createCircuit(), initProgress: () => ({ base: null, seen: false }),
    check(progress, ws) {
      // 按住期间继电器翻转 4 次以上才算真响过；松开就清掉起点，重新按再数
      const flips = ws.relays?.flips ?? 0;
      let next = progress;
      if (!ofType(ws.circuit, 'button').some(b => b.params.pressed)) {
        if (progress.base != null) next = { ...progress, base: null };
      } else {
        const base = progress.base ?? flips;
        const seen = progress.seen || flips - base >= 4;
        if (base !== progress.base || seen !== progress.seen) next = { base, seen };
      }
      return result(next.seen && bellOk(ws), next);
    },
  },
  {
    id: 36, chapter: 7, name: '全加器', goal: '三个开关 A、B、C：断开是 0，合上是 1。让显示器显示 A+B+C', palette: {}, lockPreset: true,
    preset: fullAdderPreset, initProgress: noProgress,
    check: (progress, ws) => result(fullAdderOk(ws), progress),
  },
];
