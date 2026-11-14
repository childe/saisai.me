// 继电器状态：吸合集合（on）、想翻转的累计时长（hold）、翻转次数（flips）。
import { PHYS } from './parts.js';
import { relayKeyOf } from './solve.js';

export function createRelays() {
  return { on: {}, hold: {}, flips: 0 };
}

export function relayOnSet(r) {
  return new Set(Object.keys(r.on));
}

const sameRecord = (x, y) => {
  const kx = Object.keys(x), ky = Object.keys(y);
  return kx.length === ky.length && kx.every(k => Object.hasOwn(y, k) && x[k] === y[k]);
};

const pick = (rec, ids) => Object.fromEntries(Object.entries(rec).filter(([k]) => ids.has(k)));

const relayIds = circuit => new Set(circuit.parts.filter(p => p.type === 'relay').map(p => p.id));

// 回差：吸合的电流降到 RELAY_RELEASE_A 以下才想释放，释放的电流到 RELAY_PULL_A 才想吸合。
export function wantOn(circuit, result, onSet) {
  const want = new Set();
  for (const id of relayIds(circuit)) {
    const i = Math.abs(result.parts[id]?.i ?? 0);
    if (i >= (onSet.has(id) ? PHYS.RELAY_RELEASE_A : PHYS.RELAY_PULL_A)) want.add(id);
  }
  return want;
}

// 只清掉已不存在的继电器，不翻转；没变时返回同一个对象。
export function pruneRelays(r, circuit) {
  const ids = relayIds(circuit);
  const on = pick(r.on, ids), hold = pick(r.hold, ids);
  if (sameRecord(on, r.on) && sameRecord(hold, r.hold)) return r;
  return { ...r, on, hold };
}

export function advanceRelays(r, result, dt, circuit) {
  const onSet = relayOnSet(r);
  if (!result || !result.ok || result.rev !== circuit.rev || result.relayKey !== relayKeyOf(onSet)) return r;
  const ids = relayIds(circuit);
  const on = pick(r.on, ids), hold = pick(r.hold, ids);
  let flips = r.flips;
  const want = wantOn(circuit, result, onSet);
  for (const id of ids) {
    if (want.has(id) === onSet.has(id)) { delete hold[id]; continue; }
    const h = (hold[id] ?? 0) + dt;
    if (h >= PHYS.RELAY_DELAY) {
      if (want.has(id)) on[id] = true; else delete on[id];
      delete hold[id];
      flips += 1;
    } else hold[id] = h;
  }
  if (flips === r.flips && sameRecord(on, r.on) && sameRecord(hold, r.hold)) return r;
  return { on, hold, flips };
}
