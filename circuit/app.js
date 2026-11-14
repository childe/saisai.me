// 入口：指针事件 → action，state → render。
import { createEditor, reduce, activeSpace } from './lib/editor.js';
import {
  hitTest, terminalPoint, snap, GRID, wirePoints, nearestOnRoute, startTrace, stepTrace, tracePath, dragSegment,
} from './lib/geometry.js';
import { render, miniArt, buzzerVolume } from './view.js';
import { createBuzzer } from './sound.js';
import { taskListHtml, parseAnswer } from './lib/taskbar.js';

const $ = sel => document.querySelector(sel);
const board = $('#board');
const dom = {
  board,
  wires: $('#wires'),
  parts: $('#parts'),
  overlay: $('#overlay'),
  palette: $('#palette'),
  panel: $('#panel'),
  banner: $('#banner'),
  confirm: $('#confirm'),
  confirmText: $('#confirm p'),
  confirmYes: $('#confirm [data-confirm="yes"]'),
  clearBtn: $('#clearBtn'),
  taskbar: $('#taskbar'),
  tasklist: $('#tasklist'),
  modeButtons: [...document.querySelectorAll('#modeSeg [data-mode]')],
  styleButtons: [...document.querySelectorAll('#styleSeg [data-style]')],
  muteBtn: $('#muteBtn'),
  undoBtn: $('#undoBtn'),
};
const ghost = $('#ghost');

let state = createEditor();

export function dispatch(action) {
  const next = reduce(state, action);
  if (next === state) return;
  state = next;
  render(dom, state);
}

const DRAG_PX = 8;

function toGrid(e) {
  const pt = board.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(board.getScreenCTM().inverse());
  return [p.x / GRID, p.y / GRID];
}
const scale = () => board.getScreenCTM()?.a || 1;
const circuit = () => activeSpace(state).circuit;

// ---------- 画布 ----------
// 手势在按下时锁定命中类型（gesture.hit.kind），移动中不改判。
let gesture = null;

function setOverlay(html) {
  dom.overlay.innerHTML = html;
}

const toPts = pts => pts.map(([x, y]) => `${x * GRID},${y * GRID}`).join(' ');
const partById = id => circuit().parts.find(x => x.id === id);
const wireById = id => circuit().wires.find(w => w.id === id);
const sameEnd = (a, b) => a.part !== undefined && a.part === b.part && a.term === b.term;

// 拉线的落点：别的端点、另一根导线上的点，或者只是手指位置（end 为 null）。
function dropTarget(g, from) {
  const target = hitTest(circuit(), g, scale());
  if (target?.kind === 'terminal' && !sameEnd(from, target)) {
    const pt = terminalPoint(partById(target.part), target.term);
    return {
      end: { part: target.part, term: target.term },
      pt,
      mark: `<circle cx="${pt[0] * GRID}" cy="${pt[1] * GRID}" r="16" fill="none" stroke="#0ea5b7" stroke-width="4"/>`,
    };
  }
  if (target?.kind === 'wire' && target.id !== from.wire) {
    const pts = wirePoints(circuit(), wireById(target.id));
    if (pts) {
      const { P } = nearestOnRoute(pts, g);
      return { end: { wire: target.id, at: P }, pt: P, mark: `<circle cx="${P[0] * GRID}" cy="${P[1] * GRID}" r="10" fill="#0ea5b7"/>` };
    }
  }
  return { end: null, pt: g, mark: '' };
}

// 松手时按落点连线；路线取手指轨迹。
function finishWire(gs, g) {
  const d = dropTarget(g, gs.from);
  if (!d.end) return;
  dispatch({ type: 'connect', from: gs.from, to: d.end, via: tracePath(gs.trace, d.pt).slice(1, -1) });
}

board.addEventListener('pointerdown', e => {
  if (gesture) return;
  const g = toGrid(e);
  const c = circuit();
  const selWire = state.selection?.kind === 'wire' ? state.selection.id : null;
  const hit = hitTest(c, g, scale(), selWire);
  gesture = { id: e.pointerId, hit, selWire, sx: e.clientX, sy: e.clientY, moved: false, dragging: false };
  if (hit?.kind === 'lever' && c.parts.find(x => x.id === hit.id)?.type === 'button') {
    // 按钮：按下就接通，松手时在 endGesture 里松开。
    gesture.pressed = hit.id;
    dispatch({ type: 'press', id: hit.id });
  } else if (hit?.kind === 'part') {
    const p = c.parts.find(x => x.id === hit.id);
    gesture.offset = [p.x - g[0], p.y - g[1]];
    gesture.last = [p.x, p.y];
  } else if (hit?.kind === 'terminal') {
    gesture.from = { part: hit.part, term: hit.term };
    gesture.trace = startTrace(terminalPoint(c.parts.find(x => x.id === hit.part), hit.term));
  } else if (hit?.kind === 'handle') {
    const w = c.wires.find(x => x.id === hit.wire);
    gesture.base = wirePoints(c, w);
    gesture.seg = hit.seg;
    gesture.down = g;
    gesture.lastVia = JSON.stringify(Array.isArray(w.via) ? w.via : gesture.base.slice(1, -1));
  } else if (hit?.kind === 'wire') {
    const { P } = nearestOnRoute(wirePoints(c, c.wires.find(x => x.id === hit.id)), g);
    gesture.from = { wire: hit.id, at: P };
    gesture.trace = startTrace(P);
  }
  try { board.setPointerCapture(e.pointerId); } catch { /* 指针已结束时忽略 */ }
  e.preventDefault();
});

// 按住按钮时手指移出画板也算松手。
function releaseButton(gs) {
  if (!gs.pressed) return;
  dispatch({ type: 'release', id: gs.pressed });
  gs.pressed = null;
}

board.addEventListener('pointermove', e => {
  if (!gesture || e.pointerId !== gesture.id) return;
  if (gesture.pressed) {
    const r = board.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) releaseButton(gesture);
    return;
  }
  const dist = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy);
  if (dist > DRAG_PX) gesture.moved = true;
  const { hit } = gesture;
  const g = toGrid(e);
  if (hit?.kind === 'terminal' || (hit?.kind === 'wire' && gesture.moved)) {
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const ev of samples.length ? samples : [e]) gesture.trace = stepTrace(gesture.trace, toGrid(ev));
    const d = dropTarget(g, gesture.from);
    setOverlay(`<polyline class="preview" points="${toPts(tracePath(gesture.trace, d.pt))}"/>${d.mark}`);
  } else if (hit?.kind === 'handle' && gesture.moved) {
    // 传相对按下位置的位移，不传指针绝对坐标。
    const via = dragSegment(gesture.base, gesture.seg, [g[0] - gesture.down[0], g[1] - gesture.down[1]]);
    const key = JSON.stringify(via);
    if (key !== gesture.lastVia) {
      dispatch({ type: 'setWireVia', id: hit.wire, via, coalesce: gesture.dragging });
      gesture.dragging = true;
      gesture.lastVia = key;
    }
  } else if (hit?.kind === 'part' && gesture.moved) {
    const [x, y] = snap([g[0] + gesture.offset[0], g[1] + gesture.offset[1]]);
    if (x !== gesture.last[0] || y !== gesture.last[1]) {
      dispatch({ type: 'move', id: hit.id, x, y, coalesce: gesture.dragging });
      gesture.dragging = true;
      gesture.last = [x, y];
    }
  }
});

function endGesture(e, cancelled) {
  if (!gesture || e.pointerId !== gesture.id) return;
  const gs = gesture;
  const { hit, moved } = gs;
  gesture = null;
  setOverlay('');
  // 按钮不论抬起还是取消都松开，也不再切换。
  if (gs.pressed !== undefined) { releaseButton(gs); return; }
  if (cancelled) return;
  const g = toGrid(e);
  if (!hit) { dispatch({ type: 'select', target: null }); return; }
  switch (hit.kind) {
    case 'terminal':
      if (!moved && partById(hit.part)?.type === 'node') {
        dispatch({ type: 'select', target: { kind: 'part', id: hit.part } });
        break;
      }
      finishWire(gs, g);
      break;
    case 'handle':
      if (!moved) dispatch({ type: 'splitWire', id: hit.wire, at: g });
      break;
    case 'lever':
      if (!moved) dispatch({ type: 'toggle', id: hit.id });
      break;
    case 'part':
      if (!moved) dispatch({ type: 'select', target: { kind: 'part', id: hit.id } });
      break;
    case 'wire':
      if (moved) finishWire(gs, g);
      else if (gs.selWire === hit.id) dispatch({ type: 'splitWire', id: hit.id, at: g });
      else dispatch({ type: 'select', target: { kind: 'wire', id: hit.id } });
      break;
    default:
  }
}
board.addEventListener('pointerup', e => endGesture(e, false));
board.addEventListener('pointercancel', e => endGesture(e, true));
// 指针捕获丢失（系统手势、切后台等）也当作取消，保证按住的按钮会松开。
board.addEventListener('lostpointercapture', e => endGesture(e, true));

// ---------- 元件栏 ----------
let palDrag = null;
const paletteEl = dom.palette;

paletteEl.addEventListener('pointerdown', e => {
  const item = e.target.closest('.pal-item');
  if (!item || item.classList.contains('empty') || palDrag) return;
  palDrag = { id: e.pointerId, type: item.dataset.type, sx: e.clientX, sy: e.clientY, active: false };
  try { paletteEl.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
});

// 移动、松手挂在 window 上：指针第一次移动就可能已经离开元件栏。
window.addEventListener('pointermove', e => {
  if (!palDrag || e.pointerId !== palDrag.id) return;
  if (!palDrag.active) {
    const dx = e.clientX - palDrag.sx, dy = e.clientY - palDrag.sy;
    if (Math.hypot(dx, dy) < DRAG_PX) return;
    palDrag.active = true;
    ghost.innerHTML = miniArt(palDrag.type, state.style);
    ghost.hidden = false;
  }
  e.preventDefault();
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
});

function endPalette(e, cancelled) {
  if (!palDrag || e.pointerId !== palDrag.id) return;
  const { type, active } = palDrag;
  palDrag = null;
  ghost.hidden = true;
  ghost.innerHTML = '';
  if (cancelled || !active) return;
  const r = board.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  const [x, y] = snap(toGrid(e));
  dispatch({ type: 'place', partType: type, x, y });
}
window.addEventListener('pointerup', e => endPalette(e, false));
window.addEventListener('pointercancel', e => endPalette(e, true));

// ---------- 参数面板 ----------
let sliding = false;
dom.panel.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  const sel = state.selection;
  if (!btn || !sel) return;
  const id = sel.id;
  switch (btn.dataset.action) {
    case 'param':
      dispatch({ type: 'setParam', id, key: btn.dataset.key, value: JSON.parse(btn.dataset.value) });
      break;
    case 'toggle': dispatch({ type: 'toggle', id }); break;
    case 'repair': dispatch({ type: 'repair', id }); break;
    case 'rotate': dispatch({ type: 'rotate', id }); break;
    case 'deletePart': dispatch({ type: 'deletePart', id }); break;
    case 'deleteWire': dispatch({ type: 'deleteWire', id }); break;
    default:
  }
});
dom.panel.addEventListener('input', e => {
  const input = e.target;
  if (input.type !== 'range' || state.selection?.kind !== 'part') return;
  dispatch({ type: 'setParam', id: state.selection.id, key: input.dataset.key, value: Number(input.value), coalesce: sliding });
  sliding = true;
});
dom.panel.addEventListener('change', () => { sliding = false; });
dom.panel.addEventListener('pointerup', () => { sliding = false; });

// ---------- 顶栏与确认 ----------
for (const b of dom.modeButtons) b.addEventListener('click', () => dispatch({ type: 'setMode', mode: b.dataset.mode }));
for (const b of dom.styleButtons) b.addEventListener('click', () => dispatch({ type: 'setStyle', style: b.dataset.style }));
dom.undoBtn.addEventListener('click', () => dispatch({ type: 'undo' }));
dom.clearBtn.addEventListener('click', () => dispatch({ type: 'askClear' }));
dom.muteBtn.addEventListener('click', () => dispatch({ type: 'toggleMute' }));
dom.confirm.addEventListener('click', e => {
  const b = e.target.closest('[data-confirm]');
  if (b) dispatch({ type: b.dataset.confirm === 'yes' ? 'confirmClear' : 'cancelClear' });
});

// ---------- 防干扰 ----------
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); dispatch({ type: 'undo' }); return; }
  const sel = state.selection;
  if (sel && (e.key === 'Delete' || e.key === 'Backspace')) {
    dispatch({ type: sel.kind === 'part' ? 'deletePart' : 'deleteWire', id: sel.id });
  }
});

// ---------- 小任务 ----------
dom.tasklist.querySelector('.tasklist-body').innerHTML = taskListHtml();
function onTaskClick(e) {
  const pick = e.target.closest('[data-task]');
  if (pick) {
    dom.tasklist.hidden = true;
    dispatch({ type: 'chooseTask', index: Number(pick.dataset.task) });
    return;
  }
  const b = e.target.closest('[data-task-action]');
  if (!b) return;
  if (b.dataset.taskAction === 'list') dom.tasklist.hidden = false;
  else if (b.dataset.taskAction === 'close') dom.tasklist.hidden = true;
  else if (b.dataset.taskAction === 'next') dispatch({ type: 'nextTask' });
  else if (b.dataset.taskAction === 'submit') {
    const value = parseAnswer($('#answerInput')?.value);
    if (value !== null) dispatch({ type: 'submitAnswer', value });
  } else if (b.dataset.taskAction === 'accuse') {
    if (state.selection) dispatch({ type: 'accuse', target: state.selection });
  }
}
dom.taskbar.addEventListener('click', onTaskClick);
dom.tasklist.addEventListener('click', onTaskClick);

// ---------- 声音与定时循环 ----------
const buzzer = createBuzzer();
window.addEventListener('pointerdown', () => buzzer.unlock(), { capture: true });

let lastT = null;
// 继电器翻转次数：活动工作区的 relays.flips 变大就咔哒一声；换模式时只重记基数。
let lastFlips = 0, lastMode = null;
function frame(t) {
  const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  if (dt > 0) dispatch({ type: 'tick', dt });
  buzzer.update(buzzerVolume(state), state.muted);
  const flips = activeSpace(state).relays?.flips ?? 0;
  if (state.mode === lastMode && flips > lastFlips) buzzer.click(state.muted);
  lastFlips = flips;
  lastMode = state.mode;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

render(dom, state);
