import { AudioBank } from './audio.js';
import { formatDiag } from './lib/audio-diag.js';
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
    // 复用同一个 AudioBank：只换地址前缀。新建会多出一个 AudioContext，
    // 而 iOS 对同时存在的上下文有上限，切几次就没声了。
    ctx.bank.setBaseUrl(voiceBaseUrl(data.baseUrl, sel.value));
    ctx.bank.unlock();              // 换音色是用户手势，顺手确认一下解锁状态
    show(document.querySelector('.tab[aria-selected="true"]').dataset.view);
  });
}

/**
 * 音频诊断条。iPhone 上看不了控制台，所以把上下文状态、是否降级、最近
 * 一次错误直接贴在页面底部。正常情况下它是隐藏的，`?debug=1` 强制显示。
 */
function mountAudioDiag(ctx) {
  const el = document.getElementById('audiodiag');
  if (!el) return;
  const debug = new URLSearchParams(location.search).has('debug');
  const render = () => {
    const text = formatDiag(ctx.bank.diagnose(), debug);
    el.hidden = text === null;
    if (text !== null) el.textContent = text;
  };
  render();
  setInterval(render, 1000);
  if (debug) mountSelfTest(ctx, render);
}

/**
 * `?debug=1` 下的自检面板。三个按钮把"没声音"拆成可以分别回答的问题：
 *
 *   1. 走增益链响一声 —— 不碰网络不碰解码，只测输出链路
 *   2. 直连喇叭响一声 —— 绕开增益和压缩器
 *   3. 加载一条音频   —— 只做 fetch + 解码，报告卡在哪一步
 *
 * 听得到 1：输出链路没问题，问题在音频本身 → 看 3
 * 只听得到 2：增益链（多半是压缩器）把声音吃了
 * 两个都听不到：上下文或设备层面的问题，跟 Web Audio 的图无关
 */
function mountSelfTest(ctx, render) {
  const host = document.getElementById('audiodiag');
  if (!host) return;
  const panel = document.createElement('div');
  panel.id = 'selftest';

  const out = document.createElement('div');
  const say = (t) => { out.textContent = t; render(); };

  const button = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    panel.appendChild(b);
    return b;
  };

  button('① 响一声（走增益链）', () => {
    ctx.bank.beep();
    say('① 已发声：走 增益→压缩器→喇叭');
  });
  button('② 响一声（直连喇叭）', () => {
    ctx.bank.beep({ direct: true });
    say('② 已发声：绕开增益链，直连喇叭');
  });
  button('③ 加载一条音频', async () => {
    const item = ctx.data.groups[0].items[0];
    say('③ 正在取 ' + ctx.bank.url(item) + ' …');
    const r = await ctx.bank.probe(item);
    say(r.ok
      ? '③ 成功：解码出 ' + r.duration.toFixed(2) + ' 秒'
      : '③ 失败于 ' + r.step + '：' + r.detail);
  });

  panel.appendChild(out);
  host.parentNode.insertBefore(panel, host);
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
  mountAudioDiag(ctx);
  show('chart');
}

start();
