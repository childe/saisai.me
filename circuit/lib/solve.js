// 电路求解：连通分量 + 节点分析（诺顿等效电池，无附加行）。
import { PARTS, PHYS } from './parts.js';
import { solveLinear } from './linalg.js';

export function brokenKeyOf(broken) {
  return [...broken].sort().join(',');
}

const key = (id, term) => `${id}.${term}`;

// 每类元件贡献的电导：返回 [[term0, term1, g], ...]。断开、未选、损坏的不出现。
const CONDUCTANCES = {
  battery: p => [['p', 'n', 1 / (p.params.cells * PHYS.R_CELL)]],
  lamp: () => [['a', 'b', 1 / PHYS.LAMP_R]],
  switch: p => (p.params.closed ? [['a', 'b', 1 / PHYS.R_CLOSED]] : []),
  led: () => [],
  resistor: p => [['a', 'b', 1 / p.params.ohms]],
  motor: () => [['a', 'b', 1 / PHYS.MOTOR_R]],
  buzzer: () => [['p', 'n', 1 / PHYS.BUZZER_R]],
  rheostat: p => [
    ['a', 'w', 1 / Math.max(p.params.pos * PHYS.RHEO_R, PHYS.R_CLOSED)],
    ['w', 'b', 1 / Math.max((1 - p.params.pos) * PHYS.RHEO_R, PHYS.R_CLOSED)],
  ],
  spdt: p => [['c', p.params.to, 1 / PHYS.R_CLOSED]],
  ammeter: () => [['p', 'n', 1 / PHYS.AMMETER_R]],
  voltmeter: () => [['p', 'n', 1 / PHYS.VOLTMETER_R]],
  fuse: () => [['a', 'b', 1 / PHYS.R_CLOSED]],
};

function conductancesOf(part, broken) {
  if (broken.has(part.id)) return [];
  return CONDUCTANCES[part.type]?.(part) ?? [];
}

function emfOf(part, broken) {
  if (part.type !== 'battery' || broken.has(part.id)) return 0;
  return part.params.cells * PHYS.V_CELL;
}

function failed(circuit, bk) {
  return { ok: false, rev: circuit.rev, topoRev: circuit.topoRev, brokenKey: bk, nodes: {}, parts: {}, wires: {} };
}

// 并查集分量。
function components(circuit) {
  const parent = new Map();
  const find = x => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const p of circuit.parts) for (const t of PARTS[p.type].terms) parent.set(key(p.id, t), key(p.id, t));
  for (const p of circuit.parts) {
    const ts = PARTS[p.type].terms;
    for (let i = 1; i < ts.length; i++) union(key(p.id, ts[0]), key(p.id, ts[i]));
  }
  for (const w of circuit.wires) {
    const a = key(w.a.part, w.a.term), b = key(w.b.part, w.b.term);
    if (parent.has(a) && parent.has(b)) union(a, b);
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(k);
  }
  return { groups: [...groups.values()], find };
}

const ledI = vd => PHYS.LED_IS * (Math.exp(vd / PHYS.LED_VN) - 1);
const VCRIT = PHYS.LED_VN * Math.log(PHYS.LED_VN / (Math.SQRT2 * PHYS.LED_IS));

function pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return { v: arg > 0 ? vold + vt * Math.log(arg) : vcrit, limited: true };
    }
    return { v: vt * Math.log(vnew / vt), limited: true };
  }
  return { v: vnew, limited: false };
}

// 求解一个含电池的分量。ledVd：LED id → 线性化工作点。返回 {nodeKey: V} 或 null。
function solveComponent(nodeKeys, parts, wires, broken, ref, ledVd) {
  const idx = new Map();
  for (const k of nodeKeys) if (k !== ref) idx.set(k, idx.size);
  const m = idx.size;
  const G = Array.from({ length: m }, () => new Array(m).fill(0));
  const I = new Array(m).fill(0);
  const at = k => (idx.has(k) ? idx.get(k) : -1);
  const stampG = (x, y, g) => {
    const i = at(x), j = at(y);
    if (i >= 0) G[i][i] += g;
    if (j >= 0) G[j][j] += g;
    if (i >= 0 && j >= 0) { G[i][j] -= g; G[j][i] -= g; }
  };
  const stampI = (from, to, cur) => { // 电流 cur 从 from 节点经源注入 to 节点
    const i = at(from), j = at(to);
    if (i >= 0) I[i] -= cur;
    if (j >= 0) I[j] += cur;
  };
  for (let i = 0; i < m; i++) G[i][i] += PHYS.GMIN;
  for (const p of parts) {
    for (const [t0, t1, g] of conductancesOf(p, broken)) stampG(key(p.id, t0), key(p.id, t1), g);
    const emf = emfOf(p, broken);
    if (emf) stampI(key(p.id, 'n'), key(p.id, 'p'), emf / (p.params.cells * PHYS.R_CELL));
    if (ledVd.has(p.id)) {
      const vd = ledVd.get(p.id);
      const gd = (PHYS.LED_IS / PHYS.LED_VN) * Math.exp(vd / PHYS.LED_VN) + PHYS.GMIN;
      const ieq = ledI(vd) - gd * vd;
      stampG(key(p.id, 'a'), key(p.id, 'k'), gd);
      stampI(key(p.id, 'a'), key(p.id, 'k'), ieq);
    }
  }
  for (const w of wires) stampG(key(w.a.part, w.a.term), key(w.b.part, w.b.term), 1 / PHYS.R_WIRE);
  const x = m ? solveLinear(G, I) : [];
  if (!x) return null;
  const V = { [ref]: 0 };
  for (const [k, i] of idx) V[k] = x[i];
  return V;
}

// LED 牛顿迭代；没有 LED 时只解一次。未收敛返回 null。
function solveWithLeds(nodeKeys, parts, wires, broken, ref, maxIter) {
  const leds = parts.filter(p => p.type === 'led' && !broken.has(p.id));
  const ledVd = new Map(leds.map(p => [p.id, 0]));
  if (!leds.length) return solveComponent(nodeKeys, parts, wires, broken, ref, ledVd);
  for (let it = 0; it < maxIter; it++) {
    const V = solveComponent(nodeKeys, parts, wires, broken, ref, ledVd);
    if (!V) return null;
    let converged = true;
    for (const p of leds) {
      const old = ledVd.get(p.id);
      const raw = V[key(p.id, 'a')] - V[key(p.id, 'k')];
      if (!Number.isFinite(raw)) return null;
      const lim = pnjlim(raw, old, PHYS.LED_VN, VCRIT);
      if (lim.limited || Math.abs(raw - old) >= 1e-6) converged = false;
      ledVd.set(p.id, lim.v);
    }
    if (converged) return V;
  }
  return null;
}

function readPart(p, V, broken) {
  const v = t => V[key(p.id, t)] ?? 0;
  const gs = conductancesOf(p, broken);
  const gOf = (a, b) => gs.find(([x, y]) => x === a && y === b)?.[2] ?? 0;
  switch (p.type) {
    case 'battery': {
      const vv = v('p') - v('n');
      const emf = emfOf(p, broken);
      const i = broken.has(p.id) ? 0 : (emf - vv) / (p.params.cells * PHYS.R_CELL);
      return { v: vv, i, p: vv * i };
    }
    case 'rheostat': {
      const vaw = v('a') - v('w'), vwb = v('w') - v('b');
      const gaw = gOf('a', 'w'), gwb = gOf('w', 'b');
      return { v: v('a') - v('b'), i: gaw * vaw, p: gaw * vaw * vaw + gwb * vwb * vwb };
    }
    case 'led': {
      const vv = v('a') - v('k');
      const i = broken.has(p.id) ? 0 : ledI(vv);
      return { v: vv, i, p: vv * i };
    }
    case 'spdt': {
      const vv = v('c') - v(p.params.to);
      const i = gOf('c', p.params.to) * vv;
      return { v: vv, i, p: vv * i };
    }
    default: {
      const [t0, t1] = PARTS[p.type].terms;
      const vv = v(t0) - v(t1);
      const i = gOf(t0, t1) * vv;
      return { v: vv, i, p: vv * i };
    }
  }
}

export function solve(circuit, broken = new Set(), opts = { maxIter: 100 }) {
  const bk = brokenKeyOf(broken);
  const { groups, find } = components(circuit);
  const partsByRoot = new Map();
  for (const p of circuit.parts) {
    const r = find(key(p.id, PARTS[p.type].terms[0]));
    if (!partsByRoot.has(r)) partsByRoot.set(r, []);
    partsByRoot.get(r).push(p);
  }
  const wiresByRoot = new Map();
  for (const w of circuit.wires) {
    const a = key(w.a.part, w.a.term);
    if (!circuit.parts.some(p => p.id === w.a.part)) continue;
    const r = find(a);
    if (!wiresByRoot.has(r)) wiresByRoot.set(r, []);
    wiresByRoot.get(r).push(w);
  }
  const nodes = {};
  for (const g of groups) {
    const root = find(g[0]);
    const ps = partsByRoot.get(root) ?? [];
    const bat = ps.find(p => p.type === 'battery' && !broken.has(p.id));
    if (!bat) { for (const k of g) nodes[k] = 0; continue; }
    const V = solveWithLeds(g, ps, wiresByRoot.get(root) ?? [], broken, key(bat.id, 'n'), opts.maxIter ?? 100);
    if (!V) return failed(circuit, bk);
    for (const k of g) {
      if (!Number.isFinite(V[k])) return failed(circuit, bk);
      nodes[k] = V[k];
    }
  }
  const parts = {};
  for (const p of circuit.parts) parts[p.id] = readPart(p, nodes, broken);
  const wires = {};
  for (const w of circuit.wires) {
    const va = nodes[key(w.a.part, w.a.term)] ?? 0, vb = nodes[key(w.b.part, w.b.term)] ?? 0;
    wires[w.id] = { i: (va - vb) / PHYS.R_WIRE };
  }
  for (const r of Object.values(parts)) if (![r.v, r.i, r.p].every(Number.isFinite)) return failed(circuit, bk);
  return { ok: true, rev: circuit.rev, topoRev: circuit.topoRev, brokenKey: bk, nodes, parts, wires };
}
