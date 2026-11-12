// 测试用电路构造器。
import { defaultParams } from '../lib/parts.js';

const end = s => {
  const [part, term] = s.split('.');
  return { part, term };
};

export function build({ parts = {}, wires = [] }) {
  const ps = Object.entries(parts).map(([id, [type, params = {}, extra = {}]], i) => ({
    id, type, x: 3 + i * 6, y: 5, rot: 0, params: { ...defaultParams(type), ...params }, ...extra,
  }));
  const ws = wires.map(([a, b], i) => ({ id: `w${i + 1}`, a: end(a), b: end(b) }));
  return { rev: 1, topoRev: 1, nextId: ws.length + 1, parts: ps, wires: ws };
}

export function loop(parts, chain) {
  if (chain.length % 2 !== 0) throw new Error('loop: chain length must be even');
  const wires = [];
  for (let k = 0; k < chain.length; k += 2) wires.push([chain[k], chain[k + 1]]);
  return build({ parts, wires });
}
