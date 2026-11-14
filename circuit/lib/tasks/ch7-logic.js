// 第 7 章：逻辑与加法器。开关合上（或双刀双掷拨到「1 位置」）算 1。
import { connectivity } from '../solve.js';
import { brokenSet } from '../damage.js';
import { createCircuit } from '../circuit.js';
import { lampLit, withParams, ofType, result, noProgress, truth, stableSolve, relayMatters, displayValue } from '../task-kit.js';

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

const RELAY_PALETTE = { battery: 2, switch: 1, relay: 1, lamp: 1 };

export const CH7 = [
  {
    id: 30, chapter: 7, name: '认识数字显示器', goal: v => `让显示器显示 ${v}`, palette: { battery: 1, display: 1 },
    variants: [3, 5, 6, 7, 9], preset: () => createCircuit(), initProgress: noProgress,
    check(progress, ws) {
      const br = brokenSet(ws.damage);
      return result(ofType(ws.circuit, 'display').some(d => displayValue(ws.result, br, d.id) === ws.variant), progress);
    },
  },
  {
    id: 31, chapter: 7, name: '半加器', goal: '两个开关代表 A、B，显示器显示 A+B', palette: { battery: 1, dpdt: 2, display: 1 },
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
];
