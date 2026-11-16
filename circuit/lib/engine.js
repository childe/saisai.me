// 引擎：settle（解 → 损坏 → 再解直到稳定）、tick（按时间累计过载、推进继电器、给电容充放电）。
import { solve, relayKeyOf } from './solve.js';
import { advance, brokenSet, brokenKey } from './damage.js';
import { createRelays, relayOnSet, advanceRelays, pruneRelays } from './relay.js';
import { createCaps, pruneCaps, capsAtRest, stepCaps } from './caps.js';

const MAX_SETTLE = 20;

// 电容按「这一瞬间」解（步长 CAP_H），不改电容状态。
export function settle(circuit, damage, relays = createRelays(), caps = createCaps()) {
  let d = damage;
  const rl = pruneRelays(relays, circuit);
  const cp = pruneCaps(caps, circuit);
  const on = relayOnSet(rl);
  const trail = [];
  let r;
  for (let n = 0; n < MAX_SETTLE; n++) {
    r = solve(circuit, brokenSet(d), { on, caps: cp.v });
    if (r.ok) trail.push(r);
    const d2 = advance(d, r, 0, circuit);
    if (brokenKey(d2) === brokenKey(d)) return { circuit, damage: d2, relays: rl, caps: cp, result: r, trail };
    d = d2;
  }
  return { circuit, damage: d, relays: rl, caps: cp, result: { ...r, ok: false, nodes: {}, parts: {}, wires: {} }, trail };
}

function advanceDamageAndRelays(ws, dt) {
  const relays = ws.relays ?? createRelays();
  const caps = ws.caps ?? createCaps();
  const d = advance(ws.damage, ws.result, dt, ws.circuit);
  const rl = advanceRelays(relays, ws.result, dt, ws.circuit);
  if (d === ws.damage && rl === relays) return ws;
  if (brokenKey(d) !== brokenKey(ws.damage) || relayKeyOf(relayOnSet(rl)) !== relayKeyOf(relayOnSet(relays))) {
    return settle(ws.circuit, d, rl, caps);
  }
  // trail 只在刚 settle 后有意义，这里一律清空
  if (d === ws.damage) return { ...ws, relays: rl, trail: [] };
  return { ...ws, damage: d, relays: rl, trail: [] };
}

export function tick(ws, dt) {
  if (!ws.result.ok) return ws;
  const next = advanceDamageAndRelays(ws, dt);
  if (!next.result.ok || capsAtRest(next.circuit, next.result)) return next;
  // 电容按步长 dt 推进一步，这一步末的解就是新的 result
  const caps = next.caps ?? createCaps();
  const r = solve(next.circuit, brokenSet(next.damage), { on: relayOnSet(next.relays ?? createRelays()), caps: caps.v, h: dt });
  if (!r.ok) return next;
  return { ...next, caps: stepCaps(caps, next.circuit, r), result: r, trail: [] };
}
