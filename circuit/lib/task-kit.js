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
    c = { ...r.circuit, wires: r.circuit.wires.map(w => (w.id === r.id ? { ...w, ...extra, preset: true } : w)) };
  }
  return c;
}

// 把 closeIds 里的开关合上后求解，返回元件 partId 的 |field| 读数。
export function presetReading(circuit, closeIds, partId, field) {
  const changes = Object.fromEntries(closeIds.map(id => [id, { closed: true }]));
  return Math.abs(solve(withParams(circuit, changes), new Set()).parts[partId][field]);
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
