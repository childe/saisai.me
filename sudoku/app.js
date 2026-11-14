// 页面入口：hash 路由、事件转发给 act()、保存星星与设置。游戏规则全部在 lib/game.js。
import { CHAPTERS } from './data/drills.js';
import { generateFree, FREE_LEVELS } from './lib/generate.js';
import { createGame, act, stars } from './lib/game.js';
import { loadStars, saveStars, loadInstantCheck, saveInstantCheck } from './lib/progress.js';
import {
  CIRCLED, LEVEL_NAMES,
  renderHome, renderChapter, renderPlayFrame, renderMessage, renderGame, renderHearts, renderOverlay,
} from './view.js';

// 区块、数对两章进入时自动填好全盘候选
const AUTO_CANDIDATES = new Set(['locked', 'pair']);

const $ = id => document.getElementById(id);
const screen = $('screen');
const overlay = $('overlay');
const titleEl = $('title');
const backBtn = $('backBtn');
const heartsEl = $('hearts');

const ui = { freeSize: 9, freeLevel: 'easy' };
let play = null; // 当前做题：{ kind: 'drill'|'free', ..., game }
let routeToken = 0;

const chapterIndex = id => CHAPTERS.findIndex(ch => ch.id === id);

function parseRoute(hash) {
  const [name, a, b] = hash.replace(/^#\/?/, '').split('/');
  if (name === 'ch' && chapterIndex(a) >= 0) return { name: 'chapter', ci: chapterIndex(a) };
  if (name === 'play' && chapterIndex(a) >= 0) {
    const ci = chapterIndex(a);
    const slot = Number(b);
    if (Number.isInteger(slot) && slot >= 0 && slot < CHAPTERS[ci].slots.length) return { name: 'play', ci, slot };
  }
  if (name === 'free') {
    const size = Number(a);
    if (FREE_LEVELS[size] && FREE_LEVELS[size].includes(b)) return { name: 'free', size, level: b };
  }
  return { name: 'home' };
}

function setTop(title, back) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  backBtn.dataset.target = back || '';
}

function go(hash) {
  location.hash = hash;
}

// ---------------------------------------------------------------- 路由

function route() {
  routeToken++;
  play = null;
  renderOverlay(overlay, null);
  renderHearts(heartsEl, null);
  const r = parseRoute(location.hash);
  if (r.name === 'chapter') showChapter(r.ci);
  else if (r.name === 'play') startDrill(r.ci, r.slot);
  else if (r.name === 'free') startFree(r.size, r.level);
  else showHome();
  screen.scrollTop = 0;
}

function showHome() {
  setTop('🔢 数独', null);
  const levels = FREE_LEVELS[ui.freeSize];
  if (!levels.includes(ui.freeLevel)) ui.freeLevel = levels[0];
  renderHome(screen, {
    chapters: CHAPTERS, stars: loadStars(),
    freeSize: ui.freeSize, freeLevel: ui.freeLevel, levels,
    instantCheck: loadInstantCheck(),
  });
}

function showChapter(ci) {
  const chapter = CHAPTERS[ci];
  setTop(`${CIRCLED[ci]} ${chapter.name}`, '#/');
  renderChapter(screen, { chapter, stars: loadStars() });
}

function frameParts() {
  renderPlayFrame(screen);
  return { hint: $('hint'), board: $('board'), pad: $('pad'), tools: $('tools'), hearts: heartsEl };
}

function pickVariant(count, avoid) {
  if (count <= 1) return 0;
  let i;
  do i = Math.floor(Math.random() * count); while (i === avoid);
  return i;
}

function startDrill(ci, slot, avoid = -1) {
  const chapter = CHAPTERS[ci];
  const variants = chapter.slots[slot];
  const variant = pickVariant(variants.length, avoid);
  const { size, puzzle, solution } = variants[variant];
  setTop(`${chapter.name} · 第 ${slot + 1} 题`, `#/ch/${chapter.id}`);
  const game = createGame({
    size, puzzle, solution,
    instantCheck: loadInstantCheck(),
    autoCandidates: AUTO_CANDIDATES.has(chapter.id),
  });
  play = { kind: 'drill', ci, slot, variant, game, parts: frameParts() };
  renderOverlay(overlay, null);
  renderGame(play.parts, game);
}

function startFree(size, level) {
  setTop(`自由练习 · ${size}×${size} ${LEVEL_NAMES[level]}`, '#/');
  const token = routeToken;
  play = { kind: 'free', size, level, game: null, parts: frameParts() };
  renderOverlay(overlay, null);
  renderHearts(heartsEl, null);
  renderMessage(play.parts.board, '<span class="spin">🎲</span> 出题中…');
  // 先让「出题中…」画出来，再在主线程上生成
  requestAnimationFrame(() => setTimeout(() => {
    if (token !== routeToken || !play) return;
    const res = generateFree(size, level, Math.random);
    if (token !== routeToken || !play) return;
    if (!res) {
      renderMessage(play.parts.board,
        '这次没出好题<br><button class="btn big on" data-action="regen">🔄 再试一次</button>');
      return;
    }
    play.game = createGame({
      size, puzzle: res.puzzle, solution: res.solution,
      instantCheck: loadInstantCheck(), autoCandidates: false,
    });
    renderGame(play.parts, play.game);
  }, 30));
}

// ---------------------------------------------------------------- 做题事件

function dispatch(action) {
  if (!play || !play.game) return;
  const prev = play.game;
  const next = act(prev, action);
  if (next === prev) return;
  play.game = next;
  renderGame(play.parts, next);
  if (next.status === 'won' && prev.status !== 'won') onWon();
  else if (next.status === 'failed' && prev.status !== 'failed') renderOverlay(overlay, { kind: 'failed' });
  else if (next.status === 'playing') renderOverlay(overlay, null);
}

function onWon() {
  const s = stars(play.game);
  if (play.kind === 'drill') {
    saveStars(CHAPTERS[play.ci].id, play.slot, s);
    renderOverlay(overlay, { kind: 'won', drill: true, stars: s });
  } else {
    renderOverlay(overlay, { kind: 'won', drill: false });
  }
}

function nextDrill() {
  const { ci, slot } = play;
  if (slot + 1 < CHAPTERS[ci].slots.length) go(`#/play/${CHAPTERS[ci].id}/${slot + 1}`);
  else if (ci + 1 < CHAPTERS.length) go(`#/play/${CHAPTERS[ci + 1].id}/0`);
  else go(`#/ch/${CHAPTERS[ci].id}`);
}

function again() {
  if (!play) return;
  if (play.kind === 'drill') startDrill(play.ci, play.slot, play.variant);
  else {
    routeToken++;
    startFree(play.size, play.level);
  }
}

const PLAY_ACTIONS = {
  cell: el => ({ type: 'tapCell', cell: Number(el.dataset.cell) }),
  digit: el => ({ type: 'digit', digit: Number(el.dataset.digit) }),
  erase: () => ({ type: 'erase' }),
  undo: () => ({ type: 'undo' }),
  notes: () => ({ type: 'toggleNotes' }),
  hint: () => ({ type: 'hint' }),
  restart: () => ({ type: 'restart' }),
};

const PAGE_ACTIONS = {
  chapter: el => go(`#/ch/${el.dataset.id}`),
  slot: el => {
    const r = parseRoute(location.hash);
    if (r.name === 'chapter') go(`#/play/${CHAPTERS[r.ci].id}/${el.dataset.slot}`);
  },
  size: el => {
    ui.freeSize = Number(el.dataset.size);
    showHome();
  },
  level: el => {
    ui.freeLevel = el.dataset.level;
    showHome();
  },
  start: () => go(`#/free/${ui.freeSize}/${ui.freeLevel}`),
  instant: () => {
    saveInstantCheck(!loadInstantCheck());
    showHome();
  },
  regen: () => {
    if (!play) return;
    routeToken++;
    startFree(play.size, play.level);
  },
  next: () => play && nextDrill(),
  again,
  back: () => go(backBtn.dataset.target || '#/'),
};

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  if (PLAY_ACTIONS[name]) dispatch(PLAY_ACTIONS[name](el));
  else if (PAGE_ACTIONS[name]) PAGE_ACTIONS[name](el);
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

function moveSelection(dr, dc) {
  const g = play.game;
  if (g.held) dispatch({ type: 'digit', digit: g.held }); // 放下手上的数字，改为选格
  const size = play.game.size;
  const cur = play.game.selected;
  let r = 0;
  let c = 0;
  if (cur !== null) {
    r = Math.min(size - 1, Math.max(0, Math.floor(cur / size) + dr));
    c = Math.min(size - 1, Math.max(0, (cur % size) + dc));
  }
  // 撞到边上不动：再点同一格会取消选中
  if (r * size + c !== cur) dispatch({ type: 'tapCell', cell: r * size + c });
}

function onKey(e) {
  if (!play || !play.game || !overlay.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[1-9]$/.test(e.key)) dispatch({ type: 'digit', digit: Number(e.key) });
  else if (e.key === 'Backspace' || e.key === 'Delete') dispatch({ type: 'erase' });
  else if (e.key === 'n' || e.key === 'N') dispatch({ type: 'toggleNotes' });
  else if (ARROWS[e.key]) moveSelection(...ARROWS[e.key]);
  else return;
  e.preventDefault();
}

screen.addEventListener('click', onClick);
overlay.addEventListener('click', onClick);
backBtn.addEventListener('click', () => go(backBtn.dataset.target || '#/'));
document.addEventListener('keydown', onKey);
window.addEventListener('hashchange', route);
route();
