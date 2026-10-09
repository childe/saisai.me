import { AudioBank } from './audio.js';
import { resolveBaseUrl } from './lib/base-url.js';
import { pickVoice, voiceBaseUrl } from './lib/voice.js';
import { mount as mountChart } from './chart.js';
import { mount as mountQuiz } from './quiz.js';
import { mount as mountShadow } from './shadow.js';

const VIEWS = { chart: mountChart, quiz: mountQuiz, shadow: mountShadow };

const VOICE_KEY = 'pinyin:voice';

function readVoice() {
  try {
    return localStorage.getItem(VOICE_KEY);
  } catch (_) {
    return null;   // 隐私模式下不可用，用默认音色
  }
}

function writeVoice(id) {
  try {
    localStorage.setItem(VOICE_KEY, id);
  } catch (_) { /* 存不下就算了，不影响使用 */ }
}

/** 音色选择器。换音色只换音频地址前缀，当前视图原地重建。 */
/**
 * 第一次触碰页面时解锁音频输出。
 *
 * iOS 只认用户手势同步执行的那一小段：在它之外创建的 AudioContext 会一直
 * suspended，之后再 resume() 也不生效，表现就是"电脑有声、iPhone 没声"。
 * 用 capture + once，保证比任何按钮的处理器都先跑到。
 */
function installAudioUnlock(ctx) {
  const once = () => {
    ctx.bank.unlock();
    for (const ev of ['pointerdown', 'touchstart', 'click']) {
      document.removeEventListener(ev, once, true);
    }
  };
  for (const ev of ['pointerdown', 'touchstart', 'click']) {
    document.addEventListener(ev, once, true);
  }
}

function mountVoicePicker(data, ctx, show) {
  const sel = document.getElementById('voice');
  if (!sel || !Array.isArray(data.voices) || data.voices.length < 2) {
    document.getElementById('voicebar')?.remove();
    return;
  }
  for (const v of data.voices) {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.label;
    sel.appendChild(o);
  }
  sel.value = ctx.voice;
  sel.addEventListener('change', () => {
    ctx.voice = sel.value;
    writeVoice(sel.value);
    ctx.bank.stop();
    ctx.bank = new AudioBank(voiceBaseUrl(data.baseUrl, sel.value));
    ctx.bank.unlock();              // 换音色是用户手势，顺手把新上下文解锁
    show(document.querySelector('.tab[aria-selected="true"]').dataset.view);
  });
}

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
  data.baseUrl = resolveBaseUrl(data.baseUrl, location.search);
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
  const voice = pickVoice(data, readVoice(), location.search);
  const ctx = { data, voice, bank: new AudioBank(voiceBaseUrl(data.baseUrl, voice)) };
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

  mountVoicePicker(data, ctx, show);
  installAudioUnlock(ctx);
  show('chart');
}

start();
