import { Recorder } from './record.js';
import { analyzeSamples } from './lib/analyze.js';
import { dtw } from './lib/dtw.js';
import { scorePronunciation } from './lib/score.js';
import { drawContours } from './tone-plot.js';

const MIC_HINT = {
  denied: '麦克风没打开。去「设置 → Safari → 麦克风」允许后刷新页面',
  unsupported: '这个浏览器不支持录音，先听标准音吧',
  failed: '麦克风打不开，先听标准音吧',
};

const TAP_WINDOW_MS = 600;
const TAPS_FOR_DEBUG = 3;

/** 当前挂载的跟读实例，供全局的调试面板开关找到它。 */
let activeToggleDebug = null;

function installDebugTap() {
  const title = document.getElementById('title');
  if (!title || title.dataset.debugTap) return;
  title.dataset.debugTap = '1';
  let taps = 0;
  let timer = null;
  title.addEventListener('click', () => {
    taps += 1;
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, TAP_WINDOW_MS);
    if (taps >= TAPS_FOR_DEBUG) {
      taps = 0;
      if (activeToggleDebug) activeToggleDebug();
    }
  });
}

export function mount(root, { data, bank }) {
  const pool = data.items;
  let item = pool[Math.floor(Math.random() * pool.length)];
  let recorder = null;
  let lastRecording = null;
  let debugOn = false;

  root.innerHTML = `
    <div class="shadow">
      <div class="target" id="sh-target"></div>
      <button class="replay" id="sh-std">🔊 听标准音</button>
      <button class="mic" id="sh-mic">按住说话</button>
      <div class="result" id="sh-result" hidden>
        <div class="stars" id="sh-stars"></div>
        <div class="comment" id="sh-comment"></div>
        <canvas class="tone-plot" id="sh-plot"></canvas>
        <div class="plot-legend">
          <span class="ref"><i></i>标准音</span>
          <span class="me"><i></i>我读的</span>
        </div>
        <div class="playback">
          <button id="sh-play-std">听标准音</button>
          <button id="sh-play-me">听我读的</button>
        </div>
      </div>
      <div class="debug" id="sh-debug" hidden></div>
      <div class="shadow-nav">
        <button id="sh-again">再试一次</button>
        <button id="sh-next">下一个 →</button>
      </div>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);
  const result = $('sh-result');
  const debugBox = $('sh-debug');
  const mic = $('sh-mic');

  activeToggleDebug = () => {
    debugOn = !debugOn;
    debugBox.hidden = !debugOn;
  };
  installDebugTap();

  function render() {
    $('sh-target').textContent = item.display;
    result.hidden = true;
    lastRecording = null;
    $('sh-std').textContent = '🔊 听标准音';
  }

  async function playStandard() {
    try {
      await bank.play(item);
    } catch (_) {
      $('sh-std').textContent = '😟 音频没加载出来，点我重试';
    }
  }

  async function ensureMic() {
    if (!recorder) recorder = new Recorder(bank.ctx);
    const ok = await recorder.init();
    if (!ok) {
      mic.disabled = true;
      mic.textContent = MIC_HINT[recorder.error] || MIC_HINT.failed;
    }
    return ok;
  }

  function showScore(score, refContour, userContour) {
    result.hidden = false;
    $('sh-stars').textContent = score.stars === null
      ? '—'
      : '★'.repeat(score.stars) + '☆'.repeat(10 - score.stars);
    $('sh-comment').textContent = score.message;
    debugBox.textContent = JSON.stringify(score.debug, null, 1);
    debugBox.hidden = !debugOn;
    drawContours($('sh-plot'), { reference: refContour, user: userContour });
  }

  async function finish(pcm) {
    const sr = bank.ctx.sampleRate;
    lastRecording = pcm;

    const mine = analyzeSamples(pcm, sr);
    if (!mine) {
      // Review Focus #2：全程没出声
      showScore(
        { stars: null, message: '没听到声音，再大声一点试试', debug: {} },
        null, null);
      return;
    }

    let refContour = null;
    let mfccDistance = Infinity;
    try {
      const buf = await bank.buffer(item);
      const ref = analyzeSamples(buf.getChannelData(0), buf.sampleRate);
      if (ref) {
        refContour = ref.contour;
        if (ref.frames.length && mine.frames.length) {
          mfccDistance = dtw(mine.frames, ref.frames);
        }
      }
    } catch (_) {
      // 标准音取不到，退回模板判调，仍能给分
    }

    const input = {
      userContour: mine.contour && Array.from(mine.contour),
      refContour: refContour && Array.from(refContour),
      targetTone: item.tone || 1,
      mfccDistance,
      durationSec: mine.duration,
    };
    const score = scorePronunciation(input);
    // 采校准样本用：控制台里 copy(JSON.stringify(window.__lastShadow))
    window.__lastShadow = { id: item.id, display: item.display, input, score };
    showScore(score, refContour, mine.contour);
  }

  // —— 事件 ——
  $('sh-std').addEventListener('click', playStandard);

  let holding = false;

  async function press(e) {
    e.preventDefault();
    if (holding) return;
    if (!(await ensureMic())) return;
    holding = true;
    mic.classList.add('recording');
    mic.textContent = '松开结束';
    recorder.start();
  }

  async function release(e) {
    if (!holding) return;
    e.preventDefault();
    holding = false;
    mic.classList.remove('recording');
    mic.textContent = '按住说话';
    await finish(await recorder.stop());
  }

  mic.addEventListener('touchstart', press, { passive: false });
  mic.addEventListener('touchend', release);
  mic.addEventListener('touchcancel', release);
  mic.addEventListener('mousedown', press);
  mic.addEventListener('mouseup', release);
  mic.addEventListener('mouseleave', release);

  $('sh-play-std').addEventListener('click', playStandard);
  $('sh-play-me').addEventListener('click', () => {
    if (lastRecording) bank.playSamples(lastRecording, bank.ctx.sampleRate);
  });
  $('sh-again').addEventListener('click', render);
  $('sh-next').addEventListener('click', () => {
    item = pool[Math.floor(Math.random() * pool.length)];
    render();
  });

  render();
}
