// 电路数据模型与不可变编辑操作。
import { PARTS, defaultParams, isValidParam } from './parts.js';

export function createCircuit() {
  return { rev: 0, topoRev: 0, nextId: 1, parts: [], wires: [] };
}

export function cloneCircuit(c) {
  return {
    ...c,
    parts: c.parts.map(p => ({ ...p, params: { ...p.params } })),
    wires: c.wires.map(w => ({ ...w, a: { ...w.a }, b: { ...w.b } })),
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

export function removePart(c, id) {
  if (!findPart(c, id)) return c;
  return {
    ...bump(c, true),
    parts: c.parts.filter(p => p.id !== id),
    wires: c.wires.filter(w => w.a.part !== id && w.b.part !== id),
  };
}

const validEnd = (c, e) => {
  const p = e && findPart(c, e.part);
  return !!p && PARTS[p.type].terms.includes(e.term);
};
const sameEnd = (x, y) => x.part === y.part && x.term === y.term;

export function addWire(c, a, b) {
  if (!validEnd(c, a) || !validEnd(c, b) || sameEnd(a, b)) return null;
  if (c.wires.some(w => (sameEnd(w.a, a) && sameEnd(w.b, b)) || (sameEnd(w.a, b) && sameEnd(w.b, a)))) return null;
  const id = `w${c.nextId}`;
  const wire = { id, a: { part: a.part, term: a.term }, b: { part: b.part, term: b.term } };
  return { circuit: { ...bump(c, true), nextId: c.nextId + 1, wires: [...c.wires, wire] }, id };
}

export function removeWire(c, id) {
  if (!c.wires.some(w => w.id === id)) return c;
  return { ...bump(c, true), wires: c.wires.filter(w => w.id !== id) };
}
