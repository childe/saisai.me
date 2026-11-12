// 入口：指针事件 → action，state → render。
import { createEditor, reduce, activeSpace } from './lib/editor.js';
import { hitTest, terminalPoint, wireRoute, snap, GRID } from './lib/geometry.js';
import { render, miniArt, buzzerVolume } from './view.js';
import { createBuzzer } from './sound.js';
import { TASKS } from './lib/tasks.js';

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
let gesture = null;

function setOverlay(html) {
  dom.overlay.innerHTML = html;
}

board.addEventListener('pointerdown', e => {
  if (gesture) return;
  const g = toGrid(e);
  const hit = hitTest(circuit(), g, scale());
  gesture = { id: e.pointerId, hit, sx: e.clientX, sy: e.clientY, moved: false, dragging: false };
  if (hit?.kind === 'part') {
    const p = circuit().parts.find(x => x.id === hit.id);
    gesture.offset = [p.x - g[0], p.y - g[1]];
    gesture.last = [p.x, p.y];
  }
  try { board.setPointerCapture(e.pointerId); } catch { /* 指针已结束时忽略 */ }
  e.preventDefault();
});

board.addEventListener('pointermove', e => {
  if (!gesture || e.pointerId !== gesture.id) return;
  const dist = Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy);
  if (dist > DRAG_PX) gesture.moved = true;
  const { hit } = gesture;
  const g = toGrid(e);
  if (hit?.kind === 'terminal') {
    const p = circuit().parts.find(x => x.id === hit.part);
    const from = terminalPoint(p, hit.term);
    const pts = wireRoute(from, g).map(([x, y]) => `${x * GRID},${y * GRID}`).join(' ');
    const target = hitTest(circuit(), g, scale());
    const mark = target?.kind === 'terminal'
      ? (() => {
        const tp = terminalPoint(circuit().parts.find(x => x.id === target.part), target.term);
        return `<circle cx="${tp[0] * GRID}" cy="${tp[1] * GRID}" r="16" fill="none" stroke="#0ea5b7" stroke-width="4"/>`;
      })()
      : '';
    setOverlay(`<polyline class="preview" points="${pts}"/>${mark}`);
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
  const { hit, moved } = gesture;
  gesture = null;
  setOverlay('');
  if (cancelled) return;
  if (!hit) { dispatch({ type: 'select', target: null }); return; }
  switch (hit.kind) {
    case 'terminal': {
      const target = hitTest(circuit(), toGrid(e), scale());
      if (target?.kind === 'terminal' && !(target.part === hit.part && target.term === hit.term)) {
        dispatch({ type: 'connect', from: { part: hit.part, term: hit.term }, to: { part: target.part, term: target.term } });
      }
      break;
    }
    case 'lever':
      if (!moved) dispatch({ type: 'toggle', id: hit.id });
      break;
    case 'part':
      if (!moved) dispatch({ type: 'select', target: { kind: 'part', id: hit.id } });
      break;
    case 'wire':
      dispatch({ type: 'select', target: { kind: 'wire', id: hit.id } });
      break;
    default:
  }
}
board.addEventListener('pointerup', e => endGesture(e, false));
board.addEventListener('pointercancel', e => endGesture(e, true));

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
$('#clearBtn').addEventListener('click', () => dispatch({ type: 'askClear' }));
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
dom.tasklist.querySelector('.tasklist-items').innerHTML = TASKS
  .map((t, i) => `<button class="btn" data-task="${i}">第 ${t.id} 关 · ${t.name}</button>`).join('');
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
}
dom.taskbar.addEventListener('click', onTaskClick);
dom.tasklist.addEventListener('click', onTaskClick);

// ---------- 声音与定时循环 ----------
const buzzer = createBuzzer();
window.addEventListener('pointerdown', () => buzzer.unlock(), { capture: true });

let lastT = null;
function frame(t) {
  const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  if (dt > 0) dispatch({ type: 'tick', dt });
  buzzer.update(buzzerVolume(state), state.muted);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

render(dom, state);
