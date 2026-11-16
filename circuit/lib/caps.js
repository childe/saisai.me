// 电容状态：每个电容两端的电压（v）。没有记录的电容电压为 0。
import { PHYS } from './parts.js';

export function createCaps() {
  return { v: {} };
}

const capIds = circuit => circuit.parts.filter(p => p.type === 'capacitor').map(p => p.id);

// 只清掉已不存在的电容；没变时返回同一个对象。
export function pruneCaps(caps, circuit) {
  const ids = new Set(capIds(circuit));
  const keys = Object.keys(caps.v);
  if (keys.every(k => ids.has(k))) return caps;
  return { v: Object.fromEntries(keys.filter(k => ids.has(k)).map(k => [k, caps.v[k]])) };
}

// 每个电容的电流都小于 CAP_REST_A 就算静止；没有电容也算。
export function capsAtRest(circuit, result) {
  return capIds(circuit).every(id => Math.abs(result.parts[id]?.i ?? 0) < PHYS.CAP_REST_A);
}

// 把这一步解出的电容电压记下来。
export function stepCaps(caps, circuit, result) {
  const v = {};
  for (const id of capIds(circuit)) v[id] = result.parts[id]?.v ?? caps.v[id] ?? 0;
  return { v };
}
