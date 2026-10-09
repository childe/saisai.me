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
  // 视图可以返回一个拆卸函数；跟读用它关掉麦克风，否则 iOS 的麦克风
  // 指示灯会一直亮着，且每次重进都新开一条 MediaStream。
  let teardown = null;

  function show(name) {
    ctx.bank.stop();
    if (teardown) teardown();
    teardown = null;
    for (const t of document.querySelectorAll('.tab')) {
      t.setAttribute('aria-selected', String(t.dataset.view === name));
    }
    root.replaceChildren();
    hideStatus();
    teardown = VIEWS[name](root, ctx) || null;
  }

  // 页面被隐藏/关闭时也要放开麦克风
  window.addEventListener('pagehide', () => { if (teardown) teardown(); });

  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => show(t.dataset.view));
  }
  show('chart');
}

start();
