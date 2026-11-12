// 损坏状态：烧断/熔断（broken）、过载累计时长（hold）、电池短路报警（alarm）。
import { PHYS } from './parts.js';
import { brokenKeyOf } from './solve.js';

export function createDamage() {
  return { broken: {}, hold: {}, alarm: {} };
}

export function brokenSet(d) {
  return new Set(Object.keys(d.broken));
}

export function brokenKey(d) {
  return brokenKeyOf(brokenSet(d));
}

const sameRecord = (x, y) => {
  const kx = Object.keys(x), ky = Object.keys(y);
  return kx.length === ky.length && kx.every(k => Object.hasOwn(y, k) && x[k] === y[k]);
};

const pick = (rec, ids) => Object.fromEntries(Object.entries(rec).filter(([k]) => ids.has(k)));

export function advance(d, result, dt, circuit) {
  if (!result || !result.ok || result.rev !== circuit.rev || result.brokenKey !== brokenKey(d)) return d;
  const ids = new Set(circuit.parts.map(p => p.id));
  const broken = pick(d.broken, ids), hold = pick(d.hold, ids), alarm = pick(d.alarm, ids);
  for (const p of circuit.parts) {
    const r = result.parts[p.id];
    if (!r) continue;
    switch (p.type) {
      case 'fuse':
        if (Math.abs(r.i) > p.params.rating) broken[p.id] = true;
        break;
      case 'led':
        if (r.i > PHYS.LED_BURN_A) broken[p.id] = true;
        break;
      case 'lamp':
        if (r.p > PHYS.LAMP_BURN_P) {
          const h = (hold[p.id] ?? 0) + dt;
          if (h >= PHYS.HOLD_S) { broken[p.id] = true; delete hold[p.id]; } else hold[p.id] = h;
        } else delete hold[p.id];
        break;
      case 'battery':
        if (Math.abs(r.i) > PHYS.SHORT_A) {
          const h = (hold[p.id] ?? 0) + dt;
          hold[p.id] = h;
          if (h >= PHYS.HOLD_S) alarm[p.id] = true;
        } else { delete hold[p.id]; delete alarm[p.id]; }
        break;
      default:
    }
  }
  if (sameRecord(broken, d.broken) && sameRecord(hold, d.hold) && sameRecord(alarm, d.alarm)) return d;
  return { broken, hold, alarm };
}

export function repair(d, id) {
  if (!d.broken[id] && !Object.hasOwn(d.hold, id)) return d;
  const broken = { ...d.broken }, hold = { ...d.hold };
  delete broken[id];
  delete hold[id];
  return { ...d, broken, hold };
}
