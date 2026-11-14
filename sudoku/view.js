// 纯渲染：把数据画成 HTML，不改状态、不读写本地存储。事件由 app.js 委托处理（data-action）。
import { highlightDigit, doneDigits, heartsLeft, hintsLeft, MAX_MISTAKES } from './lib/game.js';

export const LEVEL_NAMES = { intro: '入门', easy: '简单', medium: '中等', hard: '挑战' };
export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

export const starText = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(max - n);

// ---------------------------------------------------------------- 首页

export function renderHome(el, { chapters, stars, freeSize, freeLevel, levels, instantCheck }) {
  const rows = chapters.map((ch, i) => {
    const got = ch.slots.map((_, s) => stars[`${ch.id}-${s}`] || 0);
    const done = got.filter(Boolean).length;
    const sum = got.reduce((a, b) => a + b, 0);
    return `<button class="chapter" data-action="chapter" data-id="${ch.id}">
      <span class="ch-no">${CIRCLED[i]}</span>
      <span class="ch-name">${ch.name}</span>
      <span class="ch-count">${done}/${ch.slots.length}</span>
      <span class="ch-stars${sum ? '' : ' none'}">★ ${sum}</span>
    </button>`;
  }).join('');
  const sizeBtns = [6, 9].map(n =>
    `<button class="btn${n === freeSize ? ' on' : ''}" data-action="size" data-size="${n}">${n}×${n}</button>`).join('');
  const levelBtns = levels.map(l =>
    `<button class="btn${l === freeLevel ? ' on' : ''}" data-action="level" data-level="${l}">${LEVEL_NAMES[l]}</button>`).join('');
  el.innerHTML = `<div class="home-wrap">
    <h2>技巧练习</h2>
    <div class="chapters">${rows}</div>
    <h2>自由练习</h2>
    <div class="free">
      <div class="seg">${sizeBtns}</div>
      <div class="seg levels">${levelBtns}</div>
      <button class="btn start" data-action="start">开始 ▶</button>
    </div>
    <button class="toggle${instantCheck ? ' on' : ''}" data-action="instant" aria-pressed="${instantCheck}">
      ⚙ 填错马上提示 <span class="switch">${instantCheck ? '开' : '关'}</span>
    </button>
  </div>`;
}

// ---------------------------------------------------------------- 章节题目列表

export function renderChapter(el, { chapter, stars }) {
  const tiles = chapter.slots.map((variants, s) => {
    const got = stars[`${chapter.id}-${s}`] || 0;
    const size = variants[0].size;
    return `<button class="slot${got ? ' done' : ''}" data-action="slot" data-slot="${s}">
      <span class="slot-no">${s + 1}</span>
      <span class="slot-size">${size}×${size}</span>
      <span class="slot-stars">${starText(got)}</span>
    </button>`;
  }).join('');
  el.innerHTML = `<div class="slots">${tiles}</div>`;
}

// ---------------------------------------------------------------- 做题

export function renderPlayFrame(el) {
  el.innerHTML = `<div class="play">
    <div class="hintline" id="hint"></div>
    <div class="board" id="board"></div>
    <div class="pad" id="pad"></div>
    <div class="tools" id="tools"></div>
  </div>`;
}

export function renderMessage(el, html) {
  el.className = 'board message';
  el.removeAttribute('style');
  el.innerHTML = `<div class="msg">${html}</div>`;
}

const cellSet = list => new Set(list || []);

function digitMap(list) {
  const m = new Map();
  for (const { cell, digit, digits } of list || []) {
    if (!m.has(cell)) m.set(cell, new Set());
    for (const d of digits || [digit]) m.get(cell).add(d);
  }
  return m;
}

function notesHtml(size, mask, temp, strike, hd) {
  let out = '';
  for (let d = 1; d <= size; d++) {
    let cls = '';
    if (strike && strike.has(d)) cls = 'strike';
    else if (mask & (1 << d)) cls = 'note';
    else if (temp && temp.has(d)) cls = 'temp';
    if (cls && cls !== 'strike' && d === hd) cls += ' same';
    out += cls ? `<i class="n ${cls}">${d}</i>` : '<i></i>';
  }
  return `<span class="notes">${out}</span>`;
}

export function renderBoard(el, g) {
  const { size, spec } = g;
  const v = g.hint ? g.hint.view : null;
  const focus = cellSet(v && v.focusCells);
  const shade = cellSet(v && v.shadeCells);
  const outline = cellSet(v && v.outlineCells);
  const digitCells = cellSet(v && v.digitCells);
  const wrongCells = cellSet(v && v.wrongCells);
  const flash = v ? v.flashCell : null;
  const strike = digitMap(v && v.strike);
  const temp = digitMap(v && v.showCandidates);
  const related = new Set();
  if (g.selected !== null) for (const u of spec.unitsOf[g.selected]) for (const c of spec.units[u].cells) related.add(c);
  const hd = highlightDigit(g);

  let html = '';
  for (let cell = 0; cell < spec.cells; cell++) {
    const r = Math.floor(cell / size);
    const c = cell % size;
    const cls = ['cell'];
    if (c === size - 1) cls.push('ex');
    else if (c % spec.boxCols === spec.boxCols - 1) cls.push('bx');
    if (r === size - 1) cls.push('ey');
    else if (r % spec.boxRows === spec.boxRows - 1) cls.push('by');
    const val = g.values[cell];
    if (val) cls.push(g.given[cell] ? 'given' : 'player');
    if (g.wrong.has(cell) || wrongCells.has(cell)) cls.push('wrong');
    if (related.has(cell)) cls.push('rel');
    if (val && val === hd) cls.push('same');
    if (cell === g.selected) cls.push('sel');
    if (focus.has(cell)) cls.push('h-focus');
    if (digitCells.has(cell)) cls.push('h-digit');
    if (shade.has(cell)) cls.push('h-shade');
    if (wrongCells.has(cell)) cls.push('h-wrong');
    if (outline.has(cell)) cls.push('h-outline');
    if (cell === flash) cls.push('h-flash');
    let inner = '';
    if (val) inner = `<span class="digit">${val}</span>`;
    else if (g.notes[cell] || temp.has(cell) || strike.has(cell)) {
      inner = notesHtml(size, g.notes[cell], temp.get(cell), strike.get(cell), hd);
    }
    html += `<div class="${cls.join(' ')}" data-action="cell" data-cell="${cell}">${inner}</div>`;
  }
  el.className = `board s${size}`;
  el.style.setProperty('--n', size);
  el.innerHTML = html;
}

export function renderPad(el, g) {
  const done = doneDigits(g);
  let html = '';
  for (let d = 1; d <= g.size; d++) {
    const cls = ['key'];
    if (done.has(d)) cls.push('done');
    if (g.held === d) cls.push('on');
    html += `<button class="${cls.join(' ')}" data-action="digit" data-digit="${d}">${d}</button>`;
  }
  el.style.setProperty('--n', g.size);
  el.innerHTML = html;
}

export function renderTools(el, g) {
  const left = hintsLeft(g);
  el.innerHTML = `
    <button class="btn tool" data-action="undo">↶ 撤销</button>
    <button class="btn tool" data-action="erase">⌫ 擦除</button>
    <button class="btn tool${g.notesMode ? ' on' : ''}" data-action="notes" aria-pressed="${g.notesMode}">✏️ 笔记</button>
    <button class="btn tool hint-btn${left ? '' : ' off'}" data-action="hint">💡 ${left}</button>`;
}

export function renderHint(el, g) {
  const v = g.hint ? g.hint.view : null;
  el.innerHTML = v ? `<span class="hint-icon">${v.icon}</span><span class="hint-text">${v.text}</span>` : '';
  el.classList.toggle('show', !!v);
}

export function renderHearts(el, g) {
  if (!g || !g.instantCheck) {
    el.hidden = true;
    return;
  }
  const left = heartsLeft(g);
  el.hidden = false;
  el.textContent = '❤️'.repeat(left) + '🤍'.repeat(MAX_MISTAKES - left);
}

export function renderGame(parts, g) {
  renderHint(parts.hint, g);
  renderBoard(parts.board, g);
  renderPad(parts.pad, g);
  renderTools(parts.tools, g);
  renderHearts(parts.hearts, g);
}

// ---------------------------------------------------------------- 遮罩

export function renderOverlay(el, o) {
  if (!o) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  let body;
  if (o.kind === 'failed') {
    body = `<div class="ov-big">💔</div>
      <div class="ov-actions"><button class="btn big on" data-action="restart">🔄 再试一次</button></div>`;
  } else if (o.drill) {
    body = `<div class="ov-big">🎉</div>
      <div class="ov-stars">${starText(o.stars)}</div>
      <div class="ov-actions">
        <button class="btn big on" data-action="next">下一题 ▶</button>
        <button class="btn big" data-action="again">🔄 再来一题</button>
      </div>`;
  } else {
    body = `<div class="ov-big">🎉</div>
      <div class="ov-actions">
        <button class="btn big on" data-action="again">🔄 再来一题</button>
        <button class="btn big" data-action="back">◀ 返回</button>
      </div>`;
  }
  el.innerHTML = `<div class="ov-box ${o.kind}">${body}</div>`;
  el.hidden = false;
}
