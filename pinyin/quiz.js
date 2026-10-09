import { buildQuestion } from './lib/distractors.js';
import {
  initialState, nextState, optionCount, STREAK_TO_LEVEL_UP,
} from './lib/difficulty.js';

const SCOPE_KEY = 'pinyin:quiz:scope';
const STATE_KEY = 'pinyin:quiz:state';
const NEXT_DELAY_MS = 700;

const SCOPES = [
  { id: 'all', label: '全部' },
  { id: 'shengmu', label: '只声母' },
  { id: 'yunmu', label: '只韵母' },
  { id: 'tones', label: '四声辨别' },
];

function loadState() {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* 隐私模式下不可用，用默认值 */ }
  return initialState();
}

function saveState(state, scope) {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    sessionStorage.setItem(SCOPE_KEY, scope);
  } catch (_) { /* 存不下就算了，不影响做题 */ }
}

function loadScope() {
  try {
    return sessionStorage.getItem(SCOPE_KEY) || 'all';
  } catch (_) {
    return 'all';
  }
}

/** 出题的抽取范围。 */
export function candidatesFor(data, scope) {
  if (scope === 'shengmu') return data.items.filter((i) => i.group === 'shengmu');
  if (scope === 'yunmu' || scope === 'tones') {
    return data.items.filter((i) => i.group !== 'shengmu');
  }
  return data.items;
}

/** 干扰项的取值池。 */
export function poolFor(data, scope, target) {
  if (scope === 'shengmu') return data.items.filter((i) => i.group === 'shengmu');
  if (scope === 'yunmu') return data.items.filter((i) => i.group !== 'shengmu');
  if (scope === 'tones') {
    // 只拿同一基础韵母的四个声调。候选天然不足 10 个，
    // pickDistractors 会自动缩减选项数。
    return data.items.filter((i) => i.base === target.base);
  }
  return data.items;
}

export function mount(root, { data, bank }) {
  let scope = loadScope();
  let state = loadState();
  let question = null;
  let locked = false;

  const bar = document.createElement('div');
  bar.className = 'quiz-bar';
  const scopeSel = document.createElement('select');
  scopeSel.className = 'scope';
  for (const s of SCOPES) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.label;
    scopeSel.appendChild(o);
  }
  scopeSel.value = scope;
  const meter = document.createElement('span');
  meter.className = 'meter';
  bar.append(scopeSel, meter);

  const replay = document.createElement('button');
  replay.className = 'replay';

  const grid = document.createElement('div');
  grid.className = 'opt-grid';

  const next = document.createElement('button');
  next.className = 'next';
  next.textContent = '下一题 →';
  next.hidden = true;

  root.append(bar, replay, grid, next);

  function updateMeter() {
    // 显示真实的选项数，不是想要的难度档位 —— 四声辨别模式下同族只有
    // 4 条（er 只有 3 条），档位再往上爬，屏幕上也还是那几个选项。
    const shown = question ? question.options.length : optionCount(state);
    const capped = shown < optionCount(state) ? '（这一组只有这些）' : '';
    meter.textContent =
      `${shown} 选 1${capped} · 连对 ${state.streak}/${STREAK_TO_LEVEL_UP}`;
  }

  async function speak(item) {
    try {
      await bank.play(item);
    } catch (_) {
      replay.textContent = '😟 音频没加载出来，点我重试';
    }
  }

  function ask() {
    // 切走后定时器还可能触发，别对着已经摘掉的节点出题和放音
    if (!grid.isConnected) return;
    locked = false;
    next.hidden = true;
    replay.textContent = '🔊 再听一遍';

    const candidates = candidatesFor(data, scope);
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    question = buildQuestion(
      target, poolFor(data, scope, target), data.confusions, optionCount(state));

    grid.replaceChildren();
    grid.style.setProperty('--cols', question.options.length > 6 ? 5 : 3);
    for (const opt of question.options) {
      const b = document.createElement('button');
      b.className = 'cell opt';
      b.textContent = opt.display;
      b.addEventListener('click', () => answer(opt, b));
      grid.appendChild(b);
    }
    updateMeter();
    speak(target);
  }

  async function answer(chosen, btn) {
    if (locked) return;
    locked = true;
    const correct = chosen.id === question.target.id;
    state = nextState(state, correct);
    saveState(state, scope);
    updateMeter();

    if (correct) {
      btn.classList.add('ok');
      setTimeout(ask, NEXT_DELAY_MS);
      return;
    }

    btn.classList.add('bad');
    for (const b of grid.children) {
      if (b.textContent === question.target.display) b.classList.add('ok');
    }
    await speak(question.target);
    next.hidden = false;
  }

  scopeSel.addEventListener('change', () => {
    scope = scopeSel.value;
    saveState(state, scope);
    ask();
  });
  replay.addEventListener('click', () => speak(question.target));
  next.addEventListener('click', ask);

  ask();
}
