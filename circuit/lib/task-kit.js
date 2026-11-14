// 关卡判定工具：亮灭判断、开关组合表、预置电路构造。
import { PHYS, PARTS } from './parts.js';
import { terminalPoint } from './geometry.js';
import { solve, relayKeyOf } from './solve.js';
import { wantOn } from './relay.js';
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
        // 没猜就看到了读数（合过开关，或电表有读数），等于偷看；锁住，只能重来。
        if (!progress.peeked && !presetSwitches(ws.circuit).some(s => s.params.closed) && !metersRead(ws)) return result(false, progress);
        return result(false, progress.peeked ? progress : { ...progress, peeked: true }, PEEKED);
      }
      const wrongHint = actual => `实际是 ${actual.toFixed(2)} ${unit}，差了一点。点「重来」再算一次`;
      if (progress.wrong) return result(false, progress, wrongHint(progress.actual));
      const sw = presetSwitches(ws.circuit);
      if (!sw.length || !sw.every(s => s.params.closed)) return result(false, progress, NEED_SWITCH);
      if (!ws.result.ok) return result(false, progress);
      const actual = target(ws);
      if (withinTolerance(progress.answer, actual)) return result(true, progress);
      return result(false, { ...progress, wrong: true, actual }, wrongHint(actual));
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
const endKey = e => `${e.part}.${e.term}`;

// 只走导线和重合端点（不穿过元件）的连通关系，返回 find(端点键) → 所在网络；skip 是不走的那根导线。
function wireNets(c, skip = null) {
  const up = {};
  const find = k => (up[k] && up[k] !== k ? (up[k] = find(up[k])) : k);
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) up[ra] = rb; };
  const at = {};
  for (const p of c.parts) for (const term of PARTS[p.type].terms) {
    const pt = terminalPoint(p, term).join(','), k = `${p.id}.${term}`;
    if (at[pt]) join(k, at[pt]); else at[pt] = k;
  }
  for (const w of c.wires) if (w.id !== skip) join(endKey(w.a), endKey(w.b));
  return find;
}

// 哪些预置元件、导线被电压表量过两端：电压表两头各连到目标的一个端点，且两头不在同一网络。
// 导线目标算连通时不走它自己。返回 'part:id' / 'wire:id' 列表。
export function probedItems(c) {
  const vms = ofType(c, 'voltmeter');
  if (!vms.length) return [];
  const hits = (net, ends) => vms.some(v => {
    const p = net(`${v.id}.p`), n = net(`${v.id}.n`);
    return p !== n && ends.some(e => net(e) === p) && ends.some(e => net(e) === n);
  });
  const net = wireNets(c);
  const parts = c.parts.filter(p => p.preset && hits(net, PARTS[p.type].terms.map(t => `${p.id}.${t}`))).map(p => `part:${p.id}`);
  const wires = c.wires.filter(w => w.preset && hits(wireNets(c, w.id), [endKey(w.a), endKey(w.b)])).map(w => `wire:${w.id}`);
  return [...parts, ...wires];
}

// 找故障：预置电路里藏着一处故障（元件或导线带 fault），孩子用电表量，再指认。
// 只能指认用电压表量过两端的东西（probed，拆掉电压表后仍算）。指认由编辑器处理：accuse 只判对错，found 由编辑器写进 progress。
export function faultTask({ id, chapter, name, goal, palette, variants, preset }) {
  return {
    id, chapter, name, goal, palette, variants, preset, lockPreset: true,
    initProgress: () => ({ measured: false, found: false, probed: [] }),
    check(progress, ws) {
      const measured = progress.measured || metersRead(ws);
      const old = progress.probed ?? [];
      const fresh = probedItems(ws.circuit).filter(k => !old.includes(k));
      const next = measured === progress.measured && !fresh.length ? progress : { ...progress, measured, probed: [...old, ...fresh] };
      return result(next.found, next, measured ? null : MEASURE_FIRST);
    },
    accuse(progress, target, ws) {
      if (!progress.measured || !(progress.probed ?? []).includes(`${target.kind}:${target.id}`)) return null;
      const item = (target.kind === 'wire' ? ws.circuit.wires : ws.circuit.parts).find(x => x.id === target.id);
      if (!item?.preset) return null;
      return item.fault ? 'right' : 'wrong';
    },
  };
}

// 继电器关卡的稳态求解：force 为 'off' / 'on' 时全部释放 / 吸合，直接解一次。
// 否则从全部释放开始，每轮同时更新所有继电器，直到状态不变（稳定）；状态重复（振荡）、超过 32 轮或解不出都算不稳定。
export function stableSolve(circuit, broken, force = null) {
  const ids = circuit.parts.filter(p => p.type === 'relay').map(p => p.id);
  if (force) {
    const result = solve(circuit, broken, { on: new Set(force === 'on' ? ids : []) });
    return result.ok ? { stable: true, result } : { stable: false };
  }
  let on = new Set();
  const seen = new Set();
  for (let n = 0; n < 32; n++) {
    const result = solve(circuit, broken, { on });
    if (!result.ok) return { stable: false };
    const next = wantOn(circuit, result, on);
    if (relayKeyOf(next) === relayKeyOf(on)) return { stable: true, result, on };
    if (seen.has(relayKeyOf(next))) return { stable: false };
    seen.add(relayKeyOf(on));
    on = next;
  }
  return { stable: false };
}

// 继电器有没有用：任一输入组合下，把继电器全部释放或全部吸合，输出和真实稳态不同，就算有用。
export function relayMatters(circuits, broken, output) {
  return circuits.some(c => {
    const real = stableSolve(c, broken);
    const key = r => (r.stable ? output(r.result) : null);
    return ['off', 'on'].some(f => key(stableSolve(c, broken, f)) !== key(real));
  });
}

// 显示器读数（0–15）；没有这个元件返回 null。
export const displayValue = (result, broken, id) => result?.parts?.[id]?.value ?? null;
