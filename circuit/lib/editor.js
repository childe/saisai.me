// 编辑器 state 与 reducer：撤销、元件栏上限、清空确认、模式切换。
import {
  createCircuit, addPart, movePart, rotatePart, removePart, setParam, addWire, removeWire, findPart,
  setWireVia, splitWire, resolveEnd,
} from './circuit.js';
import { wirePoints, nearestOnRoute } from './geometry.js';
import { createDamage, repair } from './damage.js';
import { settle, tick } from './engine.js';
import { createRelays } from './relay.js';
import { TASKS, evaluateTask, remainingPalette } from './tasks.js';

const HISTORY_MAX = 100;

function makeSpace(circuit, damage = createDamage()) {
  return { ...settle(circuit, damage, createRelays()), history: [] };
}

// 从 n 个变体里均匀选一个，排除上一个（prev），让「重来」换一道题。
export function pickVariant(n, prev, rng = Math.random) {
  if (n <= 1) return 0;
  if (!(prev >= 0 && prev < n)) return Math.floor(rng() * n);
  const k = Math.floor(rng() * (n - 1));
  return k >= prev ? k + 1 : k;
}

const variantsOf = task => task.variants ?? [null];

function makeTaskSpace(index, prev = -1) {
  const task = TASKS[index];
  const variants = variantsOf(task);
  const variantIndex = pickVariant(variants.length, prev);
  const variant = variants[variantIndex];
  const progress = task.initProgress();
  const space = { ...makeSpace(task.preset(variant)), index, variantIndex, variant, progress, passed: false, hint: null };
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
  const ws = settle(circuit, damage ?? space.damage, space.relays);
  return withSpace(state, { ...space, ...ws, history }, extra);
}

const currentTask = state => (state.mode === 'task' ? TASKS[state.task.index] : null);

// lockPreset 的关卡里，预置的元件和导线不能改。
const lockedPart = (task, c, id) => !!task?.lockPreset && !!c.parts.find(p => p.id === id)?.preset;
const lockedWire = (task, c, id) => !!task?.lockPreset && !!c.wires.find(w => w.id === id)?.preset;

// 换个变体重开本关；history 清空，不能撤销回旧题（否则可以排除法过关）。
function restartTask(state, space, task) {
  const c = space.circuit;
  const variants = variantsOf(task);
  const variantIndex = pickVariant(variants.length, space.variantIndex);
  const variant = variants[variantIndex];
  const base = task.preset(variant);
  const fresh = { ...base, rev: c.rev + 1, topoRev: c.topoRev + 1, nextId: Math.max(base.nextId, c.nextId) };
  const next = {
    ...space, ...settle(fresh, createDamage(), createRelays()), history: [],
    variantIndex, variant, progress: task.initProgress(), passed: false, hint: null,
  };
  return withSpace(state, next, { confirmClear: false, selection: null });
}

// 松开电路里所有按住的按钮（只换 parts 数组，没有按住的就原样返回）
const releaseButtons = parts => (parts.some(p => p.type === 'button' && p.params.pressed)
  ? parts.map(p => (p.type === 'button' && p.params.pressed ? { ...p, params: { ...p.params, pressed: false } } : p))
  : parts);

const sameSelection = (a, b) => (a === b) || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export function reduce(state, action) {
  const space = activeSpace(state);
  const c = space.circuit;
  const task = currentTask(state);
  switch (action.type) {
    case 'setMode':
      if (action.mode !== 'free' && action.mode !== 'task') return state;
      if (action.mode === state.mode) return state;
      {
        // 手指抬起时的 release 只发给当前空间；离开前先松开这边按住的按钮，不进历史
        const left = state.mode;
        const sp = state[left];
        const parts = releaseButtons(sp.circuit.parts);
        const out = { ...state, mode: action.mode, selection: null, confirmClear: false };
        if (parts === sp.circuit.parts) return out;
        const circuit = { ...sp.circuit, parts, rev: sp.circuit.rev + 1, topoRev: sp.circuit.topoRev + 1 };
        // 重新 settle 但保留损坏和继电器状态
        return { ...out, [left]: { ...sp, ...settle(circuit, sp.damage, sp.relays) } };
      }
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
      // 挪动、旋转预置元件会让端点重合，等于偷偷接线。
      if (lockedPart(task, c, action.id)) return state;
      return commit(state, movePart(c, action.id, action.x, action.y), { coalesce: !!action.coalesce });
    case 'rotate':
      if (lockedPart(task, c, action.id)) return state;
      return commit(state, rotatePart(c, action.id));
    case 'connect': {
      // 两端可以是端点，也可以是导线上的一点（先分割）；任一步失败，整个动作作废。
      const { from, to } = action;
      if (task?.answer?.kind === 'predict') return state; // 预测题不许接线，免得绕过开关偷看读数
      if (lockedWire(task, c, from?.wire) || lockedWire(task, c, to?.wire)) return state;
      if (from?.wire !== undefined && from.wire === to?.wire) return state;
      const r1 = resolveEnd(c, from);
      const r2 = r1 && resolveEnd(r1.circuit, to);
      const r = r2 && addWire(r2.circuit, r1.end, r2.end, action.via);
      return r ? commit(state, r.circuit) : state;
    }
    case 'splitWire': {
      const w = c.wires.find(x => x.id === action.id);
      if (lockedWire(task, c, action.id)) return state;
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
      if (p?.type === 'dpdt') return commit(state, setParam(c, p.id, 'to', p.params.to === 'a' ? 'b' : 'a'));
      if (p?.type === 'spdt') return commit(state, setParam(c, p.id, 'to', p.params.to === 'a' ? 'b' : 'a'));
      return state;
    }
    case 'press':
    case 'release': {
      // 按钮按住不进撤销历史；预置锁定的按钮也能按
      const p = findPart(c, action.id);
      if (p?.type !== 'button') return state;
      return commit(state, setParam(c, p.id, 'pressed', action.type === 'press'), { coalesce: true });
    }
    case 'setParam': {
      const p = findPart(c, action.id);
      if (!p || lockedPart(task, c, p.id)) return state;
      if (task?.locked?.[p.type]?.includes(action.key)) return state;
      return commit(state, setParam(c, action.id, action.key, action.value), { coalesce: !!action.coalesce });
    }
    case 'deletePart': {
      if (lockedPart(task, c, action.id)) return state;
      const sel = sameSelection(state.selection, { kind: 'part', id: action.id }) ? null : state.selection;
      return commit(state, removePart(c, action.id), { extra: { selection: sel } });
    }
    case 'deleteWire': {
      if (lockedWire(task, c, action.id)) return state;
      const sel = sameSelection(state.selection, { kind: 'wire', id: action.id }) ? null : state.selection;
      return commit(state, removeWire(c, action.id), { extra: { selection: sel } });
    }
    case 'repair': {
      const d = repair(space.damage, action.id);
      if (d === space.damage) return state;
      return withSpace(state, { ...space, ...settle(c, d, space.relays) });
    }
    case 'select': {
      const target = action.target ? { kind: action.target.kind, id: action.target.id } : null;
      if (sameSelection(target, state.selection)) return state;
      return { ...state, selection: target };
    }
    case 'undo': {
      if (!space.history.length) return state;
      const snap = space.history[space.history.length - 1];
      // 按钮不跟着撤销走：恢复出来的快照里一律是松开的
      const released = releaseButtons(snap.parts);
      const restored = { ...snap, parts: released, rev: c.rev + 1, topoRev: c.topoRev + 1, nextId: Math.max(snap.nextId, c.nextId) };
      const ws = settle(restored, space.damage, space.relays);
      return withSpace(state, { ...space, ...ws, history: space.history.slice(0, -1) }, { selection: null });
    }
    case 'askClear':
      return state.confirmClear ? state : { ...state, confirmClear: true };
    case 'cancelClear':
      return state.confirmClear ? { ...state, confirmClear: false } : state;
    case 'confirmClear': {
      if (!state.confirmClear) return state;
      if (task) return restartTask(state, space, task);
      const base = createCircuit();
      const fresh = { ...base, rev: c.rev + 1, topoRev: c.topoRev + 1, nextId: Math.max(base.nextId, c.nextId) };
      const history = [...space.history, c].slice(-HISTORY_MAX);
      return withSpace(state, { ...space, ...settle(fresh, createDamage(), createRelays()), history }, { confirmClear: false, selection: null });
    }
    case 'submitAnswer': {
      if (space.passed) return state; // 过关后再答不改结果
      const r = task?.submit?.(space.progress, action.value, space);
      if (!r) return state;
      const ev = evaluate({ ...space, progress: r.progress });
      return { ...state, task: { ...ev, hint: ev.hint ?? r.hint } };
    }
    case 'accuse': {
      if (!task?.accuse || !action.target || space.passed) return state;
      const verdict = task.accuse(space.progress, action.target, space);
      if (verdict === 'right') return withSpace(state, { ...space, progress: { ...space.progress, found: true } });
      if (verdict !== 'wrong') return state;
      const next = restartTask(state, space, task);
      return { ...next, task: { ...next.task, hint: '不对哦，这关重来' } };
    }
    case 'chooseTask': {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= TASKS.length) return state;
      // 重选当前这关等于换一道题，排除现在这个变体。
      const prev = action.index === state.task.index ? state.task.variantIndex : -1;
      return { ...state, task: makeTaskSpace(action.index, prev), selection: state.mode === 'task' ? null : state.selection };
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
