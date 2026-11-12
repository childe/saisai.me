// 把编辑器 state 画进 SVG 与面板。state 未变时直接返回；元件、导线按 id 做最小更新。
import { activeSpace } from './lib/editor.js';
import { PARTS, PART_TYPES } from './lib/parts.js';
import { GRID, wirePoints, LEVER_RECT } from './lib/geometry.js';
import { partVisual, wireFlow } from './lib/viewmodel.js';
import { drawPart } from './lib/drawings.js';
import { TASKS, remainingPalette } from './lib/tasks.js';

let last = null;
const wireCache = new Map();
const partCache = new Map();
let paletteKey = '';
let panelKey = '';

const PARAM_UI = {
  cells: { name: '电池节数', label: v => `${v} 节` },
  color: { name: '颜色', label: v => ({ red: '红', green: '绿', blue: '蓝', yellow: '黄' })[v] },
  ohms: { name: '阻值', label: v => (v >= 1000 ? `${v / 1000}kΩ` : `${v}Ω`) },
  rating: { name: '额定电流', label: v => `${v}A` },
};

const blankVisual = () => ({ glow: 0, burnt: false, alarm: false, spin: 0, volume: 0, text: '--', stale: false });

export function miniArt(type, style) {
  const def = PARTS[type];
  const params = Object.fromEntries(Object.entries(def.params).map(([k, d]) => [k, d.default]));
  const ys = def.terms.map(t => def.termPos[t][1] * GRID);
  const top = Math.min(-50, ...ys.map(y => y - 12), def.lever ? LEVER_RECT.y0 * GRID - 4 : 0);
  const bottom = Math.max(50, ...ys.map(y => y + 12));
  const art = drawPart({ id: 'mini', type, x: 0, y: 0, rot: 0, params }, style, blankVisual());
  return `<svg viewBox="-92 ${top} 184 ${bottom - top}" aria-hidden="true">${art}</svg>`;
}

// 按 id 同步一组子元素：只替换内容变化了的元素。
function sync(group, cache, items) {
  const keep = new Set(items.map(it => it.id));
  for (const [id, entry] of cache) {
    if (!keep.has(id)) { entry.el.remove(); cache.delete(id); }
  }
  for (const it of items) {
    let entry = cache.get(it.id);
    if (!entry) {
      const el = document.createElementNS(group.namespaceURI, 'g');
      entry = { el, html: null, attrs: '' };
      cache.set(it.id, entry);
    }
    const attrKey = JSON.stringify(it.attrs);
    if (entry.attrs !== attrKey) {
      for (const [k, v] of Object.entries(it.attrs)) entry.el.setAttribute(k, v);
      entry.attrs = attrKey;
    }
    if (entry.html !== it.html) {
      entry.el.innerHTML = it.html;
      entry.html = it.html;
    }
    group.appendChild(entry.el);
  }
}

export function wireItems(state, space, extra = () => '') {
  const { circuit } = space;
  const sel = state.selection;
  const items = [];
  for (const w of circuit.wires) {
    const pts = wirePoints(circuit, w);
    if (!pts) continue;
    const ptsAttr = pts.map(([x, y]) => `${x * GRID},${y * GRID}`).join(' ');
    const selected = sel?.kind === 'wire' && sel.id === w.id;
    items.push({
      id: w.id,
      attrs: { 'data-id': w.id, class: 'wire-g' },
      html: `<polyline class="wire${selected ? ' selected' : ''}" points="${ptsAttr}"/>${extra(w, ptsAttr)}`,
    });
  }
  return items;
}

function partItems(state, space) {
  const { circuit, result, damage } = space;
  const sel = state.selection;
  return circuit.parts.map(p => {
    const vis = partVisual(p, result.ok ? result.parts[p.id] : undefined, damage, result.ok);
    const selected = sel?.kind === 'part' && sel.id === p.id;
    let art = drawPart(p, state.style, vis);
    if (p.type === 'motor' && Math.abs(vis.spin) >= 0.05) {
      const period = Math.round((1 / Math.abs(vis.spin)) * 100) / 100;
      art = art.replace('class="fan"', `class="fan spinning" style="animation-duration:${period}s;animation-direction:${vis.spin < 0 ? 'reverse' : 'normal'}"`);
    }
    const selBox = selected ? `<rect class="sel" x="-74" y="-${p.type === 'rheostat' || PARTS[p.type].lever ? 84 : 46}" width="148" height="${p.type === 'rheostat' || PARTS[p.type].lever ? 130 : 92}" rx="12"/>` : '';
    return {
      id: p.id,
      vis,
      attrs: { 'data-id': p.id, class: `part ${p.type}`, transform: `translate(${p.x * GRID} ${p.y * GRID}) rotate(${p.rot * 90})` },
      html: selBox + art,
    };
  });
}

function renderToolbar(dom, state, space) {
  for (const b of dom.modeButtons) b.classList.toggle('on', b.dataset.mode === state.mode);
  for (const b of dom.styleButtons) b.classList.toggle('on', b.dataset.style === state.style);
  dom.undoBtn.disabled = space.history.length === 0;
  if (dom.muteBtn) dom.muteBtn.textContent = state.muted ? '🔇' : '🔊';
}

function renderPalette(dom, state, space) {
  const task = state.mode === 'task' ? TASKS[state.task.index] : null;
  const remain = task ? remainingPalette(task, space.circuit) : null;
  const types = task ? PART_TYPES.filter(t => t in task.palette) : PART_TYPES;
  const key = JSON.stringify([state.style, state.mode, task?.id, remain]);
  if (key === paletteKey) return;
  paletteKey = key;
  const list = dom.palette.querySelector('.palette-list');
  if (!types.length) {
    list.innerHTML = '<div class="pal-note">只需要改导线</div>';
    return;
  }
  list.innerHTML = types.map(t => {
    const n = remain ? remain[t] : null;
    const empty = n === 0;
    return `<div class="pal-item${empty ? ' empty' : ''}" data-type="${t}">` +
      `${n !== null ? `<span class="count">×${n}</span>` : ''}${miniArt(t, state.style)}<div class="name">${PARTS[t].label}</div></div>`;
  }).join('');
}

function renderPanel(dom, state, space) {
  const sel = state.selection;
  const { circuit, damage } = space;
  let html = null, key = 'none';
  if (sel?.kind === 'part') {
    const p = circuit.parts.find(x => x.id === sel.id);
    if (p) {
      const def = PARTS[p.type];
      const task = state.mode === 'task' ? TASKS[state.task.index] : null;
      const locked = task?.locked?.[p.type] ?? [];
      const { pos, ...rest } = p.params;
      const burnt = !!damage.broken[p.id];
      key = JSON.stringify(['part', p.id, rest, burnt, locked, state.mode]);
      if (key !== panelKey) {
        let body = `<h2>${def.label}</h2>`;
        for (const [k, d] of Object.entries(def.params)) {
          if (locked.includes(k) || !PARAM_UI[k] || !d.options) continue;
          body += `<div class="param-name">${PARAM_UI[k].name}</div><div class="row">` +
            d.options.map(v => `<button class="btn${p.params[k] === v ? ' on' : ''}" data-action="param" data-key="${k}" data-value='${JSON.stringify(v)}'>${PARAM_UI[k].label(v)}</button>`).join('') +
            '</div>';
        }
        if (p.type === 'rheostat') {
          body += `<div class="param-name">滑片位置</div><input type="range" min="0" max="1" step="0.01" value="${p.params.pos}" data-key="pos">`;
        }
        const extra = [];
        if (def.lever) extra.push('<button class="btn" data-action="toggle">切换</button>');
        if (burnt) extra.push('<button class="btn on" data-action="repair">换新</button>');
        if (extra.length) body += `<div class="row">${extra.join('')}</div>`;
        body += '<div class="row"><button class="btn" data-action="rotate">旋转 90°</button><button class="btn danger" data-action="deletePart">删除</button></div>';
        html = body;
      }
      const range = dom.panel.querySelector('input[type="range"]');
      if (html === null && range && document.activeElement !== range) range.value = String(p.params.pos);
    }
  } else if (sel?.kind === 'wire' && circuit.wires.some(w => w.id === sel.id)) {
    key = JSON.stringify(['wire', sel.id]);
    if (key !== panelKey) html = '<h2>导线</h2><div class="row"><button class="btn danger" data-action="deleteWire">删除</button></div>';
  }
  if (key === 'none') {
    dom.panel.hidden = true;
    dom.panel.innerHTML = '';
    panelKey = key;
    return;
  }
  if (html !== null) {
    dom.panel.innerHTML = html;
    panelKey = key;
  }
  dom.panel.hidden = false;
}

// 导线上的电流小点：一个周期 16 单位，时长 16 / speed 秒。
function flowMarkup(space) {
  const { result } = space;
  return (w, ptsAttr) => {
    const f = wireFlow(result.ok ? result.wires[w.id] : undefined, result.ok);
    if (!f) return '';
    const dur = Math.round((16 / f.speed) * 1000) / 1000;
    return `<polyline class="flow" points="${ptsAttr}" style="animation-duration:${dur}s;animation-direction:${f.dir < 0 ? 'reverse' : 'normal'}"/>`;
  };
}

// 当前空间所有蜂鸣器音量的最大值。
export function buzzerVolume(state) {
  const { circuit, result, damage } = activeSpace(state);
  let v = 0;
  for (const p of circuit.parts) {
    if (p.type !== 'buzzer') continue;
    v = Math.max(v, partVisual(p, result.ok ? result.parts[p.id] : undefined, damage, result.ok).volume);
  }
  return v;
}

let taskbarKey = '';
function renderTaskbar(dom, state) {
  if (state.mode !== 'task') {
    dom.taskbar.hidden = true;
    if (dom.tasklist) dom.tasklist.hidden = true;
    taskbarKey = '';
    return;
  }
  const t = state.task;
  const task = TASKS[t.index];
  const key = JSON.stringify([t.index, t.hint, t.passed]);
  dom.taskbar.hidden = false;
  if (key === taskbarKey) return;
  taskbarKey = key;
  const pass = t.passed
    ? `<div class="passed">🎉 完成啦！${t.index < TASKS.length - 1 ? '<button class="btn on" data-task-action="next">下一关 →</button>' : ''}</div>`
    : '';
  dom.taskbar.innerHTML =
    `<div class="task-row"><span class="task-title">第 ${task.id} 关 · ${task.name}：${task.goal}</span>` +
    `<button class="btn" data-task-action="list">选关</button></div>` +
    (t.hint ? `<div class="hint">💡 ${t.hint}</div>` : '') + pass;
  if (dom.tasklist) {
    for (const b of dom.tasklist.querySelectorAll('[data-task]')) b.classList.toggle('on', Number(b.dataset.task) === t.index);
  }
}

export function render(dom, state) {
  if (state === last) return;
  last = state;
  const space = activeSpace(state);
  renderToolbar(dom, state, space);
  renderTaskbar(dom, state);
  renderPalette(dom, state, space);
  sync(dom.wires, wireCache, wireItems(state, space, flowMarkup(space)));
  sync(dom.parts, partCache, partItems(state, space));
  dom.board.classList.toggle('stale', !space.result.ok);
  dom.banner.hidden = space.result.ok;
  dom.confirm.hidden = !state.confirmClear;
  renderPanel(dom, state, space);
}
