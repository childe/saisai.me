// 关卡判定工具：亮灭判断、开关组合表、预置电路构造。
import { PHYS } from './parts.js';
import { solve } from './solve.js';
import { brokenSet } from './damage.js';
import { createCircuit, addPart, addWire, cloneCircuit } from './circuit.js';

export function lampLit(result, broken, id) {
  const r = result?.parts?.[id];
  return !!r && !broken.has(id) && r.p >= PHYS.LAMP_LIT_P;
}

export function ledLit(result, broken, id) {
  const r = result?.parts?.[id];
  return !!r && !broken.has(id) && r.i >= PHYS.LED_LIT_A;
}

export function buzzerOn(result, broken, id) {
  const r = result?.parts?.[id];
  return !!r && !broken.has(id) && r.v > 0 && r.i >= 0.001;
}

export function motorOn(result, broken, id) {
  const r = result?.parts?.[id];
  return !!r && !broken.has(id) && Math.abs(r.v) >= 0.5;
}

export function withParams(circuit, changes) {
  const c = cloneCircuit(circuit);
  for (const p of c.parts) if (changes[p.id]) Object.assign(p.params, changes[p.id]);
  return c;
}

export const ofType = (c, type) => c.parts.filter(p => p.type === type);
export const result = (passed, progress, hint = null) => ({ progress, passed, hint });
export const noProgress = () => ({});

// 用给定元件和导线搭一个预置电路，全部标 preset。
// parts 项 [名字, type, x, y, params?, extra?]，wires 项 [a, b, extra?]，端点写 '名字.端点'；extra 合并到元件/导线上（如 { fault: 'open' }）。
export function presetCircuit(parts, wires) {
  let c = createCircuit();
  const ids = {};
  for (const [name, type, x, y, params = {}, extra = {}] of parts) {
    const r = addPart(c, type, x, y);
    c = r.circuit;
    ids[name] = r.id;
    c = { ...c, parts: c.parts.map(p => (p.id === r.id ? { ...p, params: { ...p.params, ...params }, ...extra, preset: true } : p)) };
  }
  for (const [a, b, extra = {}] of wires) {
    const [pa, ta] = a.split('.'), [pb, tb] = b.split('.');
    const r = addWire(c, { part: ids[pa], term: ta }, { part: ids[pb], term: tb });
    if (!r) throw new Error(`presetCircuit: 导线 ${a} - ${b} 加不上`);
    c = { ...r.circuit, wires: r.circuit.wires.map(w => (w.id === r.id ? { ...w, ...extra, preset: true } : w)) };
  }
  return c;
}

// 把 closeIds 里的开关合上后求解，返回元件 partId 的 |field| 读数。
export function presetReading(circuit, closeIds, partId, field) {
  const changes = Object.fromEntries(closeIds.map(id => [id, { closed: true }]));
  return Math.abs(solve(withParams(circuit, changes), new Set()).parts[partId][field]);
}

// 预测题判对：误差不超过实际值的 10%，至少 0.01。
export const withinTolerance = (guess, actual) => Math.abs(guess - actual) <= Math.max(0.1 * Math.abs(actual), 0.01);

const NEED_SWITCH = '合上开关看看！';
const PEEKED = '你已经看过读数了，点「重来」再猜';
const presetSwitches = c => ofType(c, 'switch').filter(p => p.preset);

// 预测题：预置电路里的总开关一开始断开，孩子先猜读数，再合上开关核对。
// 总开关就是预置元件里的开关，所以不用单独传名字。target(ws) 给出要核对的实际读数。
export function predictTask({ id, chapter, name, goal, variants, preset, target, question, unit }) {
  return {
    id, chapter, name, goal, palette: {}, variants, preset, lockPreset: true,
    answer: { kind: 'predict', question, unit }, target,
    initProgress: () => ({ answer: null, wrong: false }),
    submit(progress, value, ws) {
      if (progress.answer != null || progress.peeked || presetSwitches(ws.circuit).some(s => s.params.closed)) return null;
      return { progress: { ...progress, answer: value }, hint: NEED_SWITCH };
    },
    check(progress, ws) {
      if (progress.answer == null) {
        // 没猜就合过开关，等于偷看了读数；锁住，只能重来。
        if (!progress.peeked && !presetSwitches(ws.circuit).some(s => s.params.closed)) return result(false, progress);
        return result(false, progress.peeked ? progress : { ...progress, peeked: true }, PEEKED);
      }
      const sw = presetSwitches(ws.circuit);
      if (!sw.length || !sw.every(s => s.params.closed)) return result(false, progress, NEED_SWITCH);
      if (!ws.result.ok) return result(false, progress);
      const actual = target(ws);
      const wrongHint = `实际是 ${actual.toFixed(2)} ${unit}，差了一点。点「重来」再算一次`;
      if (progress.wrong) return result(false, progress, wrongHint);
      if (withinTolerance(progress.answer, actual)) return result(true, progress);
      return result(false, { ...progress, wrong: true }, wrongHint);
    },
  };
}

// 两个开关的四种组合各解一次，键是「s1 合上? s2 合上?」，如 'tf'；有一种解不出就返回 null。
export function switchTable(circuit, broken, s1, s2) {
  const table = {};
  for (const a of [true, false]) for (const b of [true, false]) {
    const r = solve(withParams(circuit, { [s1]: { closed: a }, [s2]: { closed: b } }), broken);
    if (!r.ok) return null;
    table[(a ? 't' : 'f') + (b ? 't' : 'f')] = r;
  }
  return table;
}

// 每一对开关（两种顺序）的四种组合，交给 pred 判断。
export function anySwitchPair(ws, pred) {
  const br = brokenSet(ws.damage);
  const sw = ofType(ws.circuit, 'switch');
  for (const a of sw) for (const b of sw) {
    if (a === b) continue;
    const table = switchTable(ws.circuit, br, a.id, b.id);
    if (table && pred(table, br)) return true;
  }
  return false;
}

// 只看开关组合下谁亮：on(k) 是组合 k 下的亮灭，want 是期望亮的组合。
export const truth = (on, want) => ['tt', 'tf', 'ft', 'ff'].every(k => on(k) === want.includes(k));

// 孩子有没有用电表量过：求解过程中电流表 |i| ≥ 0.01 A，或电压表 |v| ≥ 0.1 V。
export function metersRead(ws) {
  const meters = ws.circuit.parts.filter(p => p.type === 'ammeter' || p.type === 'voltmeter');
  return [...(ws.trail ?? []), ws.result].some(r => meters.some(m => {
    const x = r?.parts?.[m.id];
    return !!x && (m.type === 'ammeter' ? Math.abs(x.i) >= 0.01 : Math.abs(x.v) >= 0.1);
  }));
}

const MEASURE_FIRST = '先用电表量一量';

// 找故障：预置电路里藏着一处故障（元件或导线带 fault），孩子用电表量，再指认。
// 指认由编辑器处理：accuse 只判对错，found 由编辑器写进 progress。
export function faultTask({ id, chapter, name, goal, palette, variants, preset }) {
  return {
    id, chapter, name, goal, palette, variants, preset, lockPreset: true,
    initProgress: () => ({ measured: false, found: false }),
    check(progress, ws) {
      const measured = progress.measured || metersRead(ws);
      const next = measured === progress.measured ? progress : { ...progress, measured };
      return result(next.found, next, measured ? null : MEASURE_FIRST);
    },
    accuse(progress, target, ws) {
      if (!progress.measured) return null;
      const item = (target.kind === 'wire' ? ws.circuit.wires : ws.circuit.parts).find(x => x.id === target.id);
      if (!item?.preset) return null;
      return item.fault ? 'right' : 'wrong';
    },
  };
}
