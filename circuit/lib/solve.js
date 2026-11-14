// 电路求解：连通分量 + 节点分析（诺顿等效电池，无附加行）。
import { PARTS, PHYS, wireR } from './parts.js';
import { solveLinear } from './linalg.js';
import { terminalPoint } from './geometry.js';

export function brokenKeyOf(broken) {
  return [...broken].sort().join(',');
}

// 吸合的继电器集合的键，和 brokenKeyOf 一样。
export function relayKeyOf(on) {
  return [...on].sort().join(',');
}

const key = (id, term) => `${id}.${term}`;

const DISPLAY_INPUTS = [['i1', 1], ['i2', 2], ['i4', 4], ['i8', 8]];

// 元件内部连通的端点分组：继电器线圈和触点、双刀双掷两组互不相连。
const groupsOf = type => PARTS[type].groups ?? [PARTS[type].terms];

// 每类元件贡献的电导：返回 [[term0, term1, g], ...]。断开、未选、损坏的不出现。on：吸合的继电器 id。
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
  relay: (p, on) => [
    ['x', 'y', 1 / PHYS.RELAY_R],
    ['com', on.has(p.id) ? 'no' : 'nc', 1 / PHYS.R_CLOSED],
  ],
  button: p => (p.params.pressed ? [['a', 'b', 1 / PHYS.R_CLOSED]] : []),
  dpdt: p => [
    ['c1', `${p.params.to}1`, 1 / PHYS.R_CLOSED],
    ['c2', `${p.params.to}2`, 1 / PHYS.R_CLOSED],
  ],
  display: () => DISPLAY_INPUTS.map(([t]) => [t, 'g', 1 / PHYS.DISPLAY_R]),
};

function conductancesOf(part, broken, on) {
  if (broken.has(part.id) || part.fault === 'open') return [];
  if (part.type === 'spdt' && part.fault === `open-${part.params.to}`) return []; // 故障只废掉这一掷
  return CONDUCTANCES[part.type]?.(part, on) ?? [];
}

function emfOf(part, broken) {
  if (part.type !== 'battery' || broken.has(part.id)) return 0;
  return part.params.cells * PHYS.V_CELL;
}

function failed(circuit, bk, rk) {
  return { ok: false, rev: circuit.rev, topoRev: circuit.topoRev, brokenKey: bk, relayKey: rk, nodes: {}, parts: {}, wires: {} };
}

// 画在同一格点上的端点看起来接在一起，也就当作接在一起：补一根看不见的导线。
function junctionWires(circuit) {
  const out = [];
  const byPoint = new Map();
  for (const p of circuit.parts) {
    for (const term of PARTS[p.type].terms) {
      const pt = terminalPoint(p, term).join(',');
      const end = { part: p.id, term };
      if (byPoint.has(pt)) out.push({ id: `j${out.length}`, a: byPoint.get(pt), b: end });
      else byPoint.set(pt, end);
    }
  }
  return out;
}

// 并查集分量。wires 含隐含导线。元件内部按 groups 分组连通。
function components(circuit, wires) {
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
    for (const ts of groupsOf(p.type)) for (let i = 1; i < ts.length; i++) union(key(p.id, ts[0]), key(p.id, ts[i]));
  }
  for (const w of wires) {
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
// 跨两个分量的元件（继电器）只盖两端都在本分量里的电导：不在 idx 里的端点会被当成参考地。
function solveComponent(nodeKeys, parts, wires, broken, on, ref, ledVd) {
  const inside = new Set(nodeKeys);
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
  // GMIN 是对地电导；连接点不贡献电导，跳过它的端点。
  const nodeTerms = new Set(parts.filter(p => p.type === 'node').map(p => key(p.id, 'o')));
  for (const [k, i] of idx) if (!nodeTerms.has(k)) G[i][i] += PHYS.GMIN;
  for (const p of parts) {
    for (const [t0, t1, g] of conductancesOf(p, broken, on)) {
      const a = key(p.id, t0), b = key(p.id, t1);
      if (inside.has(a) && inside.has(b)) stampG(a, b, g);
    }
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
  for (const w of wires) stampG(key(w.a.part, w.a.term), key(w.b.part, w.b.term), 1 / wireR(w));
  const x = m ? solveLinear(G, I) : [];
  if (!x) return null;
  const V = { [ref]: 0 };
  for (const [k, i] of idx) V[k] = x[i];
  return V;
}

// LED 牛顿迭代；没有 LED 时只解一次。未收敛返回 null。
function solveWithLeds(nodeKeys, parts, wires, broken, on, ref, maxIter) {
  const leds = parts.filter(p => p.type === 'led' && !broken.has(p.id));
  const ledVd = new Map(leds.map(p => [p.id, 0]));
  if (!leds.length) return solveComponent(nodeKeys, parts, wires, broken, on, ref, ledVd);
  for (let it = 0; it < maxIter; it++) {
    const V = solveComponent(nodeKeys, parts, wires, broken, on, ref, ledVd);
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

function readPart(p, V, broken, on) {
  const v = t => V[key(p.id, t)] ?? 0;
  const gs = conductancesOf(p, broken, on);
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
    case 'node': return { v: 0, i: 0, p: 0 };
    case 'spdt': {
      const vv = v('c') - v(p.params.to);
      const i = gOf('c', p.params.to) * vv;
      return { v: vv, i, p: vv * i };
    }
    case 'dpdt': { // 读第一组
      const to = `${p.params.to}1`;
      const vv = v('c1') - v(to);
      const i = gOf('c1', to) * vv;
      return { v: vv, i, p: vv * i };
    }
    case 'display': { // 输入比公共端高出阈值才算 1
      const lit = broken.has(p.id) ? [] : DISPLAY_INPUTS.filter(([t]) => v(t) - v('g') >= PHYS.DISPLAY_ON_V);
      return { v: 0, i: 0, p: 0, value: lit.reduce((s, [, w]) => s + w, 0) };
    }
    default: { // 继电器读线圈 x→y
      const [t0, t1] = PARTS[p.type].terms;
      const vv = v(t0) - v(t1);
      const i = gOf(t0, t1) * vv;
      return { v: vv, i, p: vv * i };
    }
  }
}

// 求解和 connectivity 共用的分量划分。断线视为不存在，重合端点补隐含导线。
function split(circuit) {
  const allWires = [...circuit.wires.filter(w => w.fault !== 'open'), ...junctionWires(circuit)];
  return { allWires, ...components(circuit, allWires) };
}

// 按导线、重合端点和元件内部连通，返回 'partId.term' → 所在分量的根。
// 电路里没有的端点键返回 undefined。
export function connectivity(circuit) {
  const { find } = split(circuit);
  return find;
}

// opts.on：吸合的继电器 id 集合；opts.maxIter：LED 迭代上限。
export function solve(circuit, broken = new Set(), opts = {}) {
  const bk = brokenKeyOf(broken);
  const on = opts.on ?? new Set();
  const rk = relayKeyOf(on);
  const { allWires, groups, find } = split(circuit);
  // 元件挂到它每一组端点所在的分量下；继电器可能同时挂在两个分量。
  const partsByRoot = new Map();
  for (const p of circuit.parts) {
    const roots = new Set(groupsOf(p.type).map(ts => find(key(p.id, ts[0]))));
    for (const r of roots) {
      if (!partsByRoot.has(r)) partsByRoot.set(r, []);
      partsByRoot.get(r).push(p);
    }
  }
  const wiresByRoot = new Map();
  for (const w of allWires) {
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
    const V = solveWithLeds(g, ps, wiresByRoot.get(root) ?? [], broken, on, key(bat.id, 'n'), opts.maxIter ?? 100);
    if (!V) return failed(circuit, bk, rk);
    for (const k of g) {
      if (!Number.isFinite(V[k])) return failed(circuit, bk, rk);
      nodes[k] = V[k];
    }
  }
  const parts = {};
  for (const p of circuit.parts) parts[p.id] = readPart(p, nodes, broken, on);
  const wires = {};
  for (const w of circuit.wires) {
    if (w.fault === 'open') { wires[w.id] = { i: 0 }; continue; } // 断线：视为不存在
    const va = nodes[key(w.a.part, w.a.term)] ?? 0, vb = nodes[key(w.b.part, w.b.term)] ?? 0;
    wires[w.id] = { i: (va - vb) / wireR(w) };
  }
  for (const r of Object.values(parts)) if (![r.v, r.i, r.p].every(Number.isFinite)) return failed(circuit, bk, rk);
  return { ok: true, rev: circuit.rev, topoRev: circuit.topoRev, brokenKey: bk, relayKey: rk, nodes, parts, wires };
}
