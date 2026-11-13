// 编辑器 state 与 reducer：撤销、元件栏上限、清空确认、模式切换。
import {
  createCircuit, addPart, movePart, rotatePart, removePart, setParam, addWire, removeWire, findPart,
  setWireVia, splitWire, resolveEnd,
} from './circuit.js';
import { wirePoints, nearestOnRoute } from './geometry.js';
import { createDamage, repair } from './damage.js';
import { settle, tick } from './engine.js';
import { TASKS, evaluateTask, remainingPalette } from './tasks.js';

const HISTORY_MAX = 100;

function makeSpace(circuit, damage = createDamage()) {
  return { ...settle(circuit, damage), history: [] };
}

function makeTaskSpace(index) {
  const task = TASKS[index];
  const progress = task.initProgress();
  const space = { ...makeSpace(task.preset()), index, progress, passed: false, hint: null };
  return evaluate(space);
}

function evaluate(space) {
  const r = evaluateTask(TASKS[space.index], space.progress, space);
  return { ...space, progress: r.progress, hint: r.hint, passed: space.passed || r.passed };
}

export function createEditor() {
  return {
    mode: 'free',
    style: 'cartoon',
    muted: false,
    selection: null,
    confirmClear: false,
    free: makeSpace(createCircuit()),
    task: makeTaskSpace(0),
  };
}

export function activeSpace(state) {
  return state.mode === 'task' ? state.task : state.free;
}

function withSpace(state, space, extra = {}) {
  const s = state.mode === 'task' ? evaluate(space) : space;
  return { ...state, [state.mode]: s, ...extra };
}

// 提交一次电路改动：推入撤销栈（coalesce 时不推），然后 settle。
function commit(state, circuit, { coalesce = false, extra = {}, damage } = {}) {
  const space = activeSpace(state);
  if (circuit === space.circuit) return state;
  let history = space.history;
  if (!coalesce) {
    history = [...history, space.circuit];
    if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
  }
  const ws = settle(circuit, damage ?? space.damage);
  return withSpace(state, { ...space, ...ws, history }, extra);
}

const currentTask = state => (state.mode === 'task' ? TASKS[state.task.index] : null);

const sameSelection = (a, b) => (a === b) || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export function reduce(state, action) {
  const space = activeSpace(state);
  const c = space.circuit;
  const task = currentTask(state);
  switch (action.type) {
    case 'setMode':
      if (action.mode !== 'free' && action.mode !== 'task') return state;
      if (action.mode === state.mode) return state;
      return { ...state, mode: action.mode, selection: null, confirmClear: false };
    case 'setStyle':
      if (action.style !== 'cartoon' && action.style !== 'symbol') return state;
      if (action.style === state.style) return state;
      return { ...state, style: action.style };
    case 'toggleMute':
      return { ...state, muted: !state.muted };
    case 'place': {
      if (task && !(remainingPalette(task, c)[action.partType] > 0)) return state;
      const params = task?.defaults?.[action.partType] ?? {};
      const r = addPart(c, action.partType, action.x, action.y, params);
      if (!r.id) return state;
      return commit(state, r.circuit, { extra: { selection: { kind: 'part', id: r.id } } });
    }
    case 'move':
      return commit(state, movePart(c, action.id, action.x, action.y), { coalesce: !!action.coalesce });
    case 'rotate':
      return commit(state, rotatePart(c, action.id));
    case 'connect': {
      // 两端可以是端点，也可以是导线上的一点（先分割）；任一步失败，整个动作作废。
      const { from, to } = action;
      if (from?.wire !== undefined && from.wire === to?.wire) return state;
      const r1 = resolveEnd(c, from);
      const r2 = r1 && resolveEnd(r1.circuit, to);
      const r = r2 && addWire(r2.circuit, r1.end, r2.end, action.via);
      return r ? commit(state, r.circuit) : state;
    }
    case 'splitWire': {
      const w = c.wires.find(x => x.id === action.id);
      const pts = w && wirePoints(c, w);
      if (!pts) return state;
      const s = splitWire(c, w.id, nearestOnRoute(pts, action.at).P);
      if (!s) return state;
      return commit(state, s.circuit, { extra: { selection: { kind: 'part', id: s.node } } });
    }
    case 'setWireVia':
      return commit(state, setWireVia(c, action.id, action.via), { coalesce: !!action.coalesce });
    case 'toggle': {
      const p = findPart(c, action.id);
      if (p?.type === 'switch') return commit(state, setParam(c, p.id, 'closed', !p.params.closed));
      if (p?.type === 'spdt') return commit(state, setParam(c, p.id, 'to', p.params.to === 'a' ? 'b' : 'a'));
      return state;
    }
    case 'setParam': {
      const p = findPart(c, action.id);
      if (!p) return state;
      if (task?.locked?.[p.type]?.includes(action.key)) return state;
      return commit(state, setParam(c, action.id, action.key, action.value), { coalesce: !!action.coalesce });
    }
    case 'deletePart': {
      const sel = sameSelection(state.selection, { kind: 'part', id: action.id }) ? null : state.selection;
      return commit(state, removePart(c, action.id), { extra: { selection: sel } });
    }
    case 'deleteWire': {
      const sel = sameSelection(state.selection, { kind: 'wire', id: action.id }) ? null : state.selection;
      return commit(state, removeWire(c, action.id), { extra: { selection: sel } });
    }
    case 'repair': {
      const d = repair(space.damage, action.id);
      if (d === space.damage) return state;
      return withSpace(state, { ...space, ...settle(c, d) });
    }
    case 'select': {
      const target = action.target ? { kind: action.target.kind, id: action.target.id } : null;
      if (sameSelection(target, state.selection)) return state;
      return { ...state, selection: target };
    }
    case 'undo': {
      if (!space.history.length) return state;
      const snap = space.history[space.history.length - 1];
      const restored = { ...snap, rev: c.rev + 1, topoRev: c.topoRev + 1, nextId: Math.max(snap.nextId, c.nextId) };
      const ws = settle(restored, space.damage);
      return withSpace(state, { ...space, ...ws, history: space.history.slice(0, -1) }, { selection: null });
    }
    case 'askClear':
      return state.confirmClear ? state : { ...state, confirmClear: true };
    case 'cancelClear':
      return state.confirmClear ? { ...state, confirmClear: false } : state;
    case 'confirmClear': {
      if (!state.confirmClear) return state;
      const base = task ? task.preset() : createCircuit();
      const fresh = { ...base, rev: c.rev + 1, topoRev: c.topoRev + 1, nextId: Math.max(base.nextId, c.nextId) };
      const history = [...space.history, c].slice(-HISTORY_MAX);
      let next = { ...space, ...settle(fresh, createDamage()), history };
      if (task) next = { ...next, progress: task.initProgress(), passed: false, hint: null };
      return withSpace(state, next, { confirmClear: false, selection: null });
    }
    case 'chooseTask': {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= TASKS.length) return state;
      return { ...state, task: makeTaskSpace(action.index), selection: state.mode === 'task' ? null : state.selection };
    }
    case 'nextTask': {
      if (state.task.index >= TASKS.length - 1) return state;
      return reduce(state, { type: 'chooseTask', index: state.task.index + 1 });
    }
    case 'tick': {
      const ws = tick(space, action.dt);
      if (ws === space) return state;
      return withSpace(state, { ...space, ...ws });
    }
    default:
      return state;
  }
}
