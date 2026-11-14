// 引擎：settle（解 → 损坏 → 再解直到稳定）、tick（按时间累计过载、推进继电器）。
import { solve, relayKeyOf } from './solve.js';
import { advance, brokenSet, brokenKey } from './damage.js';
import { createRelays, relayOnSet, advanceRelays, pruneRelays } from './relay.js';

const MAX_SETTLE = 20;

export function settle(circuit, damage, relays = createRelays()) {
  let d = damage;
  const rl = pruneRelays(relays, circuit);
  const on = relayOnSet(rl);
  const trail = [];
  let r;
  for (let n = 0; n < MAX_SETTLE; n++) {
    r = solve(circuit, brokenSet(d), { on });
    if (r.ok) trail.push(r);
    const d2 = advance(d, r, 0, circuit);
    if (brokenKey(d2) === brokenKey(d)) return { circuit, damage: d2, relays: rl, result: r, trail };
    d = d2;
  }
  return { circuit, damage: d, relays: rl, result: { ...r, ok: false, nodes: {}, parts: {}, wires: {} }, trail };
}

export function tick(ws, dt) {
  if (!ws.result.ok) return ws;
  const relays = ws.relays ?? createRelays();
  const d = advance(ws.damage, ws.result, dt, ws.circuit);
  const rl = advanceRelays(relays, ws.result, dt, ws.circuit);
  if (d === ws.damage && rl === relays) return ws;
  if (brokenKey(d) !== brokenKey(ws.damage) || relayKeyOf(relayOnSet(rl)) !== relayKeyOf(relayOnSet(relays))) {
    return settle(ws.circuit, d, rl);
  }
  if (d === ws.damage) return { ...ws, relays: rl };
  return { ...ws, damage: d, relays: rl, trail: [] };
}
