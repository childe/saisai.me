// 页面逻辑：两种模式
//   自己做：每一步从几个选项里选做法，最后自己填 x 的值
//   看讲解：点「下一步」看程序一步步解，每步配一句说明
import { generate, LEVELS } from './lib/generate.js';
import {
  applyOp, choicesFor, eqTokens, interTokens, opExplain, solutionOf, solvePath,
  toText, validOps, verifyLines,
} from './lib/equation.js';
import { parseAnswer, eq as fracEq, toText as fracText } from './lib/frac.js';
import { initialProgress, record, UP_AFTER } from './lib/progress.js';
import { tokensHtml } from './lib/render.js';

const STORE_KEY = 'solve-equation:v1';
const MAX_ANSWER_TRIES = 2;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const board = document.getElementById('board');
const actions = document.getElementById('actions');
const toastEl = document.getElementById('toast');

const saved = load();
const state = {
  mode: saved.mode === 'explain' ? 'explain' : 'practice',
  progress: initialProgress(LEVELS.some(l => l.id === saved.level) ? saved.level : 2),
  original: null, // 原方程
  cur: null, // 当前化简到的方程
  path: [], // 讲解模式的步骤
  stepNo: 0,
  mistakes: 0,
  answerTries: 0,
  phase: 'idle', // choose | answer | explain | done
  busy: false,
  lastStep: null, // 最后一步的 DOM，填答案时用
};

// ---------- 存储 ----------

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ mode: state.mode, level: state.progress.level })); } catch { /* 无痕模式等 */ }
}

// ---------- 可跳过的等待 ----------
// 动画进行中再点一下（或按空格），剩下的等待立刻结束

let skipping = false;
const waiters = new Set();

function sleep(ms) {
  if (skipping || reducedMotion) return Promise.resolve();
  return new Promise(resolve => {
    const w = () => { clearTimeout(timer); waiters.delete(w); resolve(); };
    const timer = setTimeout(w, ms);
    waiters.add(w);
  });
}

function skipAnimation() {
  skipping = true;
  [...waiters].forEach(w => w());
}

async function run(task) {
  if (state.busy) { skipAnimation(); return; }
  state.busy = true;
  skipping = false;
  try { await task(); } finally {
    state.busy = false;
    skipping = false;
  }
}

// ---------- DOM 小工具 ----------

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function lineEl(tokens, cls = '') {
  return el('div', `line ${cls}`.trim(), tokensHtml(tokens));
}

function scrollToBottom() {
  const last = board.lastElementChild;
  if (last) last.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
}

async function fadeIn(node) {
  node.classList.add('hidden');
  await nextFrame();
  node.classList.remove('hidden');
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

// ---------- 设置栏 ----------

function renderSettings() {
  document.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  const levels = document.getElementById('levels');
  levels.innerHTML = '';
  for (const l of LEVELS) {
    const b = el('button', 'level', `${l.id} ${l.name}`);
    b.title = l.desc;
    b.setAttribute('aria-pressed', String(l.id === state.progress.level));
    b.addEventListener('click', () => setLevel(l.id));
    levels.appendChild(b);
  }
  const level = LEVELS[state.progress.level - 1];
  document.getElementById('levelDesc').textContent = level.desc;
  const stars = document.getElementById('stars');
  if (state.mode === 'practice' && state.progress.level < LEVELS.length) {
    stars.textContent = '★'.repeat(state.progress.streak) + '☆'.repeat(UP_AFTER - state.progress.streak);
    stars.title = `连续 ${UP_AFTER} 题一次做对就升级`;
  } else {
    stars.textContent = '';
  }
}

function setLevel(id) {
  if (state.busy) return;
  state.progress = initialProgress(id);
  save();
  newProblem();
}

function setMode(mode) {
  if (state.busy || mode === state.mode) return;
  state.mode = mode;
  save();
  restart(state.original);
}

// ---------- 出题 ----------

function newProblem() {
  restart(generate(state.progress.level));
}

function restart(original) {
  state.original = original;
  state.cur = original;
  state.path = solvePath(original);
  state.stepNo = 0;
  state.mistakes = 0;
  state.answerTries = 0;
  state.lastStep = null;
  board.innerHTML = '';
  board.appendChild(lineEl(eqTokens(original), 'line-original'));
  renderSettings();
  if (state.mode === 'practice') showChoices();
  else showExplainControls();
}

// ---------- 一步的动画 ----------
// 说明 → 中间行（新加的项淡入、要消掉的项闪烁后划掉）→ 结果行
// withResult = false 时停在中间行，留给孩子自己填答案

async function playStep(before, o, after, withResult = true) {
  state.stepNo += 1;
  const box = el('div', 'step');
  const caption = el('div', 'caption', `<span class="no">${state.stepNo}</span><span>${opExplain(before, o)}</span>`);
  box.appendChild(caption);
  board.appendChild(box);
  await fadeIn(caption);
  scrollToBottom();

  const inter = interTokens(before, o);
  state.lastInter = inter;
  if (inter) {
    const line = lineEl(inter, 'inter');
    box.appendChild(line);
    await fadeIn(line);
    await sleep(250);
    line.classList.add('show-new');
    await sleep(500);
    if (line.querySelector('.mk-cancel, .mk-merge')) {
      line.classList.add('blink');
      await sleep(850);
      line.classList.add('struck');
    }
  }
  if (withResult) await appendResult(box, after);
  state.lastStep = box;
  return box;
}

async function appendResult(box, after) {
  const line = lineEl(eqTokens(after), after.ans ? 'result answer-line' : 'result');
  box.appendChild(line);
  await fadeIn(line);
  scrollToBottom();
  await sleep(300);
}

async function playVerify() {
  const v = solutionOf(state.original);
  const lines = verifyLines(state.original, v);
  const box = el('div', 'verify');
  const caption = el('div', 'caption', `验算：把 x = ${fracText(v)} 代回原方程`);
  box.appendChild(caption);
  board.appendChild(box);
  await fadeIn(caption);
  const subst = lineEl(lines.subst);
  box.appendChild(subst);
  await fadeIn(subst);
  scrollToBottom();
  await sleep(700);
  const values = lineEl(lines.values, 'ok');
  values.insertAdjacentHTML('beforeend', lines.ok ? '<span class="check">✓ 两边相等</span>' : '');
  box.appendChild(values);
  await fadeIn(values);
  scrollToBottom();
}

// ---------- 自己做 ----------

function showChoices(message) {
  state.phase = 'choose';
  actions.innerHTML = '';
  actions.appendChild(el('p', 'prompt', state.stepNo === 0 ? '第一步怎么做？' : '下一步怎么做？'));
  const choices = choicesFor(state.cur);
  const grid = el('div', 'choices');
  if (choices.some(c => c.label.length > 12)) grid.classList.add('wide');
  choices.forEach((c, i) => {
    const b = el('button', 'choice');
    b.textContent = c.label;
    b.dataset.index = String(i + 1);
    b.addEventListener('click', () => onChoice(c, b));
    grid.appendChild(b);
  });
  actions.appendChild(grid);
  const hint = el('p', 'hint');
  hint.hidden = !message;
  if (message) hint.textContent = message;
  actions.appendChild(hint);

  const row = el('div', 'row');
  const hintBtn = el('button', 'secondary', '💡 提示');
  hintBtn.addEventListener('click', () => {
    if (state.busy) return;
    state.mistakes += 1;
    const best = validOps(state.cur)[0];
    const i = choices.findIndex(c => c.ok && c.op.type === best.type);
    grid.children[i]?.classList.add('suggest');
    hint.className = 'hint';
    hint.hidden = false;
    hint.textContent = `试试「${choices[i].label}」：${opExplain(state.cur, best)}`;
  });
  const watch = el('button', 'secondary', '👀 看这题的讲解');
  watch.addEventListener('click', () => setMode('explain'));
  row.append(hintBtn, watch);
  actions.appendChild(row);
}

function onChoice(c, button) {
  if (state.busy || state.phase !== 'choose' || button.disabled) return;
  const hint = actions.querySelector('.hint');
  if (!c.ok) {
    state.mistakes += 1;
    button.classList.add('wrong');
    button.disabled = true;
    hint.className = 'hint bad';
    hint.hidden = false;
    hint.textContent = `不对哦：${c.hint}`;
    return;
  }
  run(async () => {
    actions.innerHTML = '';
    const before = state.cur;
    const after = applyOp(before, c.op);
    await playStep(before, c.op, after, !after.ans);
    state.cur = after;
    if (after.ans) showAnswerInput();
    else showChoices();
  });
}

function showAnswerInput() {
  state.phase = 'answer';
  actions.innerHTML = '';
  actions.appendChild(el('p', 'prompt', '算一算，x 等于几？'));
  const form = el('form', 'answer-form');
  form.innerHTML = '<i class="x">x</i><span>=</span><input id="answer" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="x 的值"><button class="primary" type="submit">确定</button>';
  actions.appendChild(form);
  const hint = el('p', 'hint');
  hint.textContent = '可以写整数、负数或分数，比如 6、−3、7/2';
  actions.appendChild(hint);
  const input = form.querySelector('input');
  input.focus({ preventScroll: true });
  form.addEventListener('submit', e => {
    e.preventDefault();
    onAnswer(input.value, hint, input);
  });
}

function onAnswer(raw, hint, input) {
  if (state.busy) return;
  const v = parseAnswer(raw);
  if (!v) {
    hint.className = 'hint bad';
    hint.textContent = '要写一个数，比如 6、−3 或 7/2';
    return;
  }
  const ans = state.cur.ans;
  if (fracEq(v, ans)) return run(finishProblem);
  state.mistakes += 1;
  state.answerTries += 1;
  if (state.answerTries >= MAX_ANSWER_TRIES) {
    hint.className = 'hint bad';
    hint.textContent = `答案是 x = ${fracText(ans)}，看看下面的过程。`;
    return run(finishProblem);
  }
  const right = state.lastInter ? toText(state.lastInter).split(' = ').pop() : '';
  hint.className = 'hint bad';
  hint.textContent = right ? `再算一算：${right} 等于几？` : '再算一算。';
  input.select();
}

async function finishProblem() {
  if (state.phase === 'answer') {
    actions.querySelector('form')?.remove();
    await appendResult(state.lastStep, state.cur);
  }
  await sleep(300);
  await playVerify();
  showDone();
}

// ---------- 看讲解 ----------

function showExplainControls() {
  state.phase = 'explain';
  actions.innerHTML = '';
  const total = state.path.length + 1;
  const next = el('button', 'primary big', '下一步 ▶');
  next.addEventListener('click', explainNext);
  actions.appendChild(next);
  actions.appendChild(el('div', 'counter', state.stepNo === 0 ? `共 ${total} 步（最后一步是验算）` : `第 ${state.stepNo} 步 / 共 ${total} 步`));
  actions.appendChild(el('div', 'tip', '点算式或按空格也能走下一步'));
}

function explainNext() {
  if (state.phase !== 'explain') return;
  run(async () => {
    const step = state.path[state.stepNo];
    if (step) {
      await playStep(step.before, step.op, step.after);
      state.cur = step.after;
      showExplainControls();
    } else {
      await playVerify();
      showDone();
    }
  });
}

// ---------- 做完一题 ----------

function showDone() {
  state.phase = 'done';
  actions.innerHTML = '';
  if (state.mode === 'practice') {
    const { progress, event } = record(state.progress, state.mistakes);
    state.progress = progress;
    save();
    const msg = state.mistakes === 0 ? '一次做对！⭐' : `做完了！这题错了 ${state.mistakes} 次，再来一题巩固一下。`;
    actions.appendChild(el('p', state.mistakes === 0 ? 'hint good' : 'hint', msg));
    if (event === 'up') toast(`连续 ${UP_AFTER} 题一次做对，升到「${LEVELS[progress.level - 1].name}」！`);
    if (event === 'suggestDown') {
      const easier = LEVELS[progress.level - 2];
      const b = el('button', 'secondary', `这几题有点难，换「${easier.name}」试试`);
      b.addEventListener('click', () => setLevel(easier.id));
      actions.appendChild(b);
    }
    renderSettings();
  }
  const next = el('button', 'primary big', '下一题 ▶');
  next.addEventListener('click', () => { if (!state.busy) newProblem(); });
  actions.prepend(next);
  next.focus({ preventScroll: true });
}

// ---------- 事件 ----------

document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

board.addEventListener('click', () => {
  if (state.busy) skipAnimation();
  else if (state.phase === 'explain') explainNext();
});

document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space' || e.key === 'Enter') {
    e.preventDefault();
    if (state.busy) skipAnimation();
    else if (state.phase === 'explain') explainNext();
    else if (state.phase === 'done') newProblem();
    return;
  }
  if (state.phase === 'choose' && /^[1-4]$/.test(e.key)) {
    actions.querySelector(`.choice[data-index="${e.key}"]`)?.click();
  }
});

newProblem();
