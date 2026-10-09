import { AudioBank } from './audio.js';
import { mount as mountChart } from './chart.js';
import { mount as mountQuiz } from './quiz.js';
import { mount as mountShadow } from './shadow.js';

const VIEWS = { chart: mountChart, quiz: mountQuiz, shadow: mountShadow };

export function showStatus(text, onClick) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.hidden = false;
  el.onclick = onClick ? () => { el.hidden = true; onClick(); } : null;
}

export function hideStatus() {
  document.getElementById('status').hidden = true;
}

export async function loadData() {
  const res = await fetch('data/pinyin.json');
  if (!res.ok) throw new Error('数据 ' + res.status);
  const data = await res.json();
  data.items = data.groups.flatMap((g) =>
    g.items.map((it) => ({ ...it, group: g.id })));
  data.byId = new Map(data.items.map((it) => [it.id, it]));
  return data;
}

async function start() {
  let data;
  try {
    data = await loadData();
  } catch (_) {
    showStatus('😟 没有加载到内容，点我重试', () => location.reload());
    return;
  }
  const ctx = { data, bank: new AudioBank(data.baseUrl) };
  const root = document.getElementById('view');

  function show(name) {
    ctx.bank.stop();
    for (const t of document.querySelectorAll('.tab')) {
      t.setAttribute('aria-selected', String(t.dataset.view === name));
    }
    root.replaceChildren();
    hideStatus();
    VIEWS[name](root, ctx);
  }

  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => show(t.dataset.view));
  }
  show('chart');
}

start();
