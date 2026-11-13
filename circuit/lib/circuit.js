// 电路数据模型与不可变编辑操作。
import { PARTS, defaultParams, isValidParam, wireR } from './parts.js';
import { wirePoints, nearestOnRoute, splitRoute, joinRoute } from './geometry.js';

export function createCircuit() {
  return { rev: 0, topoRev: 0, nextId: 1, parts: [], wires: [] };
}

export function cloneCircuit(c) {
  return {
    ...c,
    parts: c.parts.map(p => ({ ...p, params: { ...p.params } })),
    wires: c.wires.map(w => {
      const k = { ...w, a: { ...w.a }, b: { ...w.b } };
      if (Array.isArray(w.via)) k.via = w.via.map(p => [...p]);
      else delete k.via;
      return k;
    }),
  };
}

export function findPart(c, id) {
  return c.parts.find(p => p.id === id) ?? null;
}

const bump = (c, topo) => ({ ...c, rev: c.rev + 1, topoRev: topo ? c.topoRev + 1 : c.topoRev });

export function addPart(c, type, x, y, params = {}) {
  if (!PARTS[type]) return { circuit: c, id: null };
  const merged = { ...defaultParams(type) };
  for (const [k, v] of Object.entries(params)) if (isValidParam(type, k, v)) merged[k] = v;
  const id = `p${c.nextId}`;
  const part = { id, type, x, y, rot: 0, params: merged };
  return { circuit: { ...bump(c, true), nextId: c.nextId + 1, parts: [...c.parts, part] }, id };
}

function updatePart(c, id, fn, topo = false) {
  const idx = c.parts.findIndex(p => p.id === id);
  if (idx < 0) return c;
  const next = fn(c.parts[idx]);
  if (!next || next === c.parts[idx]) return c;
  const parts = c.parts.slice();
  parts[idx] = next;
  return { ...bump(c, topo), parts };
}

export function movePart(c, id, x, y) {
  return updatePart(c, id, p => (p.x === x && p.y === y ? p : { ...p, x, y }));
}

export function rotatePart(c, id) {
  return updatePart(c, id, p => ({ ...p, rot: (p.rot + 1) % 4 }));
}

export function setParam(c, id, key, value) {
  return updatePart(c, id, p => {
    if (!isValidParam(p.type, key, value)) return p;
    if (p.params[key] === value) return p;
    return { ...p, params: { ...p.params, [key]: value } };
  });
}

const touches = (w, id) => w.a.part === id || w.b.part === id;

// 删掉 ids 里已经没有任何导线的连接点。
function pruneNodes(c, ids) {
  const dead = new Set([...ids].filter(id => findPart(c, id)?.type === 'node' && !c.wires.some(w => touches(w, id))));
  if (!dead.size) return c;
  return { ...c, parts: c.parts.filter(p => !dead.has(p.id)) };
}

// 连接点恰好连两根导线、且两根的另一端不是同一端点时，把两根合并回一根。
function mergeAtNode(c, id) {
  const idxs = c.wires.map((w, i) => (touches(w, id) ? i : -1)).filter(i => i >= 0);
  if (idxs.length !== 2) return null;
  const [w1, w2] = idxs.map(i => c.wires[i]);
  const far1 = w1.a.part === id ? w1.b : w1.a;
  const far2 = w2.a.part === id ? w2.b : w2.a;
  if (sameEnd(far1, far2)) return null;
  const pts1 = wirePoints(c, w1), pts2 = wirePoints(c, w2);
  if (!pts1 || !pts2) return null;
  if (w1.a.part === id) pts1.reverse();
  if (w2.b.part === id) pts2.reverse();
  const wire = {
    id: `w${c.nextId}`, a: { ...far1 }, b: { ...far2 },
    via: joinRoute(pts1, pts2), r: wireR(w1) + wireR(w2),
  };
  const wires = c.wires.slice();
  wires[idxs[0]] = wire;
  wires.splice(idxs[1], 1);
  return { ...bump(c, true), nextId: c.nextId + 1, parts: c.parts.filter(p => p.id !== id), wires };
}

export function removePart(c, id) {
  const part = findPart(c, id);
  if (!part) return c;
  if (part.type === 'node') {
    const merged = mergeAtNode(c, id);
    if (merged) return merged;
  }
  const far = new Set();
  for (const w of c.wires) if (touches(w, id)) { far.add(w.a.part); far.add(w.b.part); }
  far.delete(id);
  return pruneNodes({
    ...bump(c, true),
    parts: c.parts.filter(p => p.id !== id),
    wires: c.wires.filter(w => !touches(w, id)),
  }, far);
}

const validEnd = (c, e) => {
  const p = e && findPart(c, e.part);
  return !!p && PARTS[p.type].terms.includes(e.term);
};
const sameEnd = (x, y) => x.part === y.part && x.term === y.term;

const copyVia = via => via.map(p => [...p]);

export function addWire(c, a, b, via) {
  if (!validEnd(c, a) || !validEnd(c, b) || sameEnd(a, b)) return null;
  if (c.wires.some(w => (sameEnd(w.a, a) && sameEnd(w.b, b)) || (sameEnd(w.a, b) && sameEnd(w.b, a)))) return null;
  const id = `w${c.nextId}`;
  const wire = { id, a: { part: a.part, term: a.term }, b: { part: b.part, term: b.term } };
  if (Array.isArray(via)) wire.via = copyVia(via);
  return { circuit: { ...bump(c, true), nextId: c.nextId + 1, wires: [...c.wires, wire] }, id };
}

export function removeWire(c, id) {
  const w = c.wires.find(x => x.id === id);
  if (!w) return c;
  return pruneNodes({ ...bump(c, true), wires: c.wires.filter(x => x.id !== id) }, [w.a.part, w.b.part]);
}

const sameVia = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length
  && x.every((p, i) => p[0] === y[i][0] && p[1] === y[i][1]);

// 改导线路线：拓扑不变。
export function setWireVia(c, id, via) {
  const idx = c.wires.findIndex(w => w.id === id);
  if (idx < 0 || !Array.isArray(via) || sameVia(c.wires[idx].via, via)) return c;
  const wires = c.wires.slice();
  wires[idx] = { ...wires[idx], via: copyVia(via) };
  return { ...bump(c, false), wires };
}

// 在导线上 P 处加一个连接点，把导线分成两根（各占一半电阻），放在原导线的位置。
export function splitWire(c, id, P) {
  const idx = c.wires.findIndex(w => w.id === id);
  if (idx < 0) return null;
  const w = c.wires[idx];
  const pts = wirePoints(c, w);
  const sp = pts && splitRoute(pts, P);
  if (!sp) return null;
  const { circuit: c1, id: node } = addPart(c, 'node', P[0], P[1]);
  const r = wireR(w) / 2;
  const o = { part: node, term: 'o' };
  const h1 = { id: `w${c1.nextId}`, a: { ...w.a }, b: { ...o }, via: sp.via1, r };
  const h2 = { id: `w${c1.nextId + 1}`, a: { ...o }, b: { ...w.b }, via: sp.via2, r };
  const wires = c1.wires.slice();
  wires.splice(idx, 1, h1, h2);
  return { circuit: { ...c1, nextId: c1.nextId + 2, wires }, node };
}

// 把连线的一端解析成元件端点：{part, term} 原样返回；{wire, at} 在导线上找落点，必要时分割。
export function resolveEnd(c, end) {
  if (!end) return null;
  if (!('wire' in end)) return { circuit: c, end };
  const w = c.wires.find(x => x.id === end.wire);
  const pts = w && wirePoints(c, w);
  if (!pts) return null;
  const { P } = nearestOnRoute(pts, end.at);
  const at = q => P[0] === q[0] && P[1] === q[1];
  if (at(pts[0])) return { circuit: c, end: { ...w.a } };
  if (at(pts.at(-1))) return { circuit: c, end: { ...w.b } };
  const s = splitWire(c, w.id, P);
  if (!s) return null;
  return { circuit: s.circuit, end: { part: s.node, term: 'o' } };
}
