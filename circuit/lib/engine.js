// 引擎：settle（解 → 损坏 → 再解直到稳定）、tick（按时间累计过载）。
import { solve } from './solve.js';
import { advance, brokenSet, brokenKey } from './damage.js';

const MAX_SETTLE = 20;

export function settle(circuit, damage) {
  let d = damage;
  const trail = [];
  let r;
  for (let n = 0; n < MAX_SETTLE; n++) {
    r = solve(circuit, brokenSet(d));
    if (r.ok) trail.push(r);
    const d2 = advance(d, r, 0, circuit);
    if (brokenKey(d2) === brokenKey(d)) return { circuit, damage: d2, result: r, trail };
    d = d2;
  }
  return { circuit, damage: d, result: { ...r, ok: false, nodes: {}, parts: {}, wires: {} }, trail };
}

export function tick(ws, dt) {
  if (!ws.result.ok) return ws;
  const d = advance(ws.damage, ws.result, dt, ws.circuit);
  if (d === ws.damage) return ws;
  if (brokenKey(d) !== brokenKey(ws.damage)) return settle(ws.circuit, d);
  return { ...ws, damage: d, trail: [] };
}
