// 题目栏与选关列表的 HTML 生成。纯函数，不碰 DOM，方便在 node 里测试。
import { TASKS, CHAPTERS, goalText, chapterIndex } from './tasks.js';

// 选关列表：每章一个标题加一组按钮，data-task 是全局序号（从 0 起）。
export function taskListHtml() {
  return CHAPTERS.map(ch => {
    const buttons = TASKS.map((t, i) => [t, i]).filter(([t]) => t.chapter === ch.n)
      .map(([t, i]) => `<button class="btn" data-task="${i}">第 ${chapterIndex(t)} 关 · ${t.name}</button>`).join('');
    return `<h3>第 ${ch.n} 章 · ${ch.name}</h3><div class="tasklist-items">${buttons}</div>`;
  }).join('');
}

// 去空格后是有限非负数就返回数值，否则 null。
export function parseAnswer(text) {
  const s = String(text ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// 选中的预置件的类型（导线算 'wire'）；没选中、或选中的是孩子自己加的东西，返回 null。
const selectedPresetType = (state, circuit) => {
  const sel = state.selection;
  if (!sel) return null;
  const list = sel.kind === 'part' ? circuit.parts : circuit.wires;
  const item = list.find(x => x.id === sel.id);
  if (!item?.preset) return null;
  return sel.kind === 'wire' ? 'wire' : item.type;
};

// 选中的东西量过两端没有（找故障只能指认量过的）。
const selectedProbed = (state, t) => !!state.selection && (t.progress.probed ?? []).includes(`${state.selection.kind}:${state.selection.id}`);
const PICK_FIRST = '点一下你觉得坏的那个，再按这里';
const PROBE_FIRST = '先把电压表接在它两端量一量';

// 「就是它坏了」按钮的状态：通过后灰且无说明；没选中预置件、选中的不是这关的候选、候选没量过，各有一句说明；候选量过了才能点。
function accuseState(state, t, task) {
  if (t.passed) return { ok: false, tip: '' };
  const type = selectedPresetType(state, t.circuit);
  if (!type) return { ok: false, tip: PICK_FIRST };
  if (!task.suspect?.types.includes(type)) return { ok: false, tip: `这关坏的是${task.suspect.name}，不是它` };
  if (!selectedProbed(state, t)) return { ok: false, tip: PROBE_FIRST };
  return { ok: true, tip: '' };
}

export function taskbarCacheKey(state) {
  const t = state.task;
  return JSON.stringify([t.index, t.variantIndex, t.hint, t.passed, t.progress.answer,
    selectedPresetType(state, t.circuit), selectedProbed(state, t)]);
}

export function taskbarHtml(state) {
  const t = state.task;
  const task = TASKS[t.index];
  const answered = t.progress.answer != null;
  const lockInput = task.answer?.kind === 'predict' && answered;
  const title = `第 ${task.chapter} 章 · 第 ${chapterIndex(task)} 关 · ${task.name}：${goalText(task, t.variant)}`;
  let html = `<div class="task-row"><span class="task-title">${title}</span>` +
    `<button class="btn" data-task-action="list">选关</button></div>`;
  if (task.how) html += `<div class="task-how">${task.how}</div>`;
  if (task.answer) {
    const { kind, question, unit } = task.answer;
    const off = lockInput || t.passed ? ' disabled' : '';
    const value = answered ? ` value="${Number(t.progress.answer)}"` : '';
    html += `<div class="task-row answer-row"><span>${question(t.variant)}</span>` +
      `<input id="answerInput" type="number" step="0.01" min="0" inputmode="decimal"${value}${off}> ${unit} ` +
      `<button class="btn" data-task-action="submit"${off}>${kind === 'predict' ? '我猜好了' : '提交答案'}</button></div>`;
  }
  if (task.accuse) {
    const { ok, tip } = accuseState(state, t, task);
    html += `<div class="task-row"><button class="btn" data-task-action="accuse"${ok ? '' : ' disabled'}>就是它坏了！</button>` +
      `${tip ? `<span class="accuse-tip">${tip}</span>` : ''}</div>`;
  }
  if (t.hint) html += `<div class="hint">💡 ${t.hint}</div>`;
  if (t.passed) {
    html += `<div class="passed">🎉 完成啦！${t.index < TASKS.length - 1 ? '<button class="btn on" data-task-action="next">下一关 →</button>' : ''}</div>`;
  }
  return html;
}
