import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTOUR_POINTS, normalizeContour, classifyTone, contourDistance, TONE_TEMPLATES,
} from '../lib/pitch.js';

/** 造一条 f0 轨迹：shape 是 0..1 上的半音偏移函数，base 是基频。 */
function track(shape, base = 220, n = 40, clarity = 0.95) {
  return Array.from({ length: n }, (_, i) => ({
    f0: base * 2 ** (shape(i / (n - 1)) / 12),
    clarity,
  }));
}

const FLAT = () => 0;
const RISE = (t) => -4 + 9 * t;
const DIP = (t) => -2 - 6 * Math.sin(Math.PI * t) + 8 * t * t;
const FALL = (t) => 5 - 12 * t;

test('归一化到固定点数', () => {
  assert.equal(normalizeContour(track(RISE)).length, CONTOUR_POINTS);
  assert.equal(normalizeContour(track(RISE, 220, 7)).length, CONTOUR_POINTS);
});

test('中位数被移到 0 附近', () => {
  assert.ok(Math.abs(normalizeContour(track(FLAT))[CONTOUR_POINTS >> 1]) < 0.5);
});

test('小孩的高音域和成人同形状曲线归一化后一致', () => {
  const adult = normalizeContour(track(RISE, 200));
  const child = normalizeContour(track(RISE, 420));
  assert.ok(contourDistance(adult, child) < 0.3, '归一化应抹掉绝对音高差');
});

test('全部低清晰度帧返回 null', () => {
  // Review Focus #3：气声/耳语时拿不到可用 F0
  assert.equal(normalizeContour(track(RISE, 220, 40, 0.1)), null);
});

test('可用帧太少返回 null', () => {
  assert.equal(normalizeContour(track(RISE, 220, 2)), null);
});

test('空轨迹返回 null', () => {
  assert.equal(normalizeContour([]), null);
});

test('离谱的 f0 被当野点剔除', () => {
  const t = track(FLAT);
  t[10] = { f0: 3000, clarity: 0.99 };
  t[11] = { f0: 20, clarity: 0.99 };
  const c = normalizeContour(t);
  assert.ok(c.every((v) => Math.abs(v) < 6), '野点没被剔除：' + c.join(','));
});

// 赵元任五度标调法描述的普通话四声，换算成相对自身中位数的半音。
// 刻意**不是** TONE_TEMPLATES 里那几个函数的副本 —— 拿模板自己测自己，
// 测的是重采样往返，不是分类器。
const CHAO = {
  1: () => 4,                                     // 55 高平
  2: (t) => 4 * t,                                // 35 中升
  3: (t) => (t < 0.55                             // 214 低降升
    ? -2 - 2 * (t / 0.55)
    : -4 + 6 * ((t - 0.55) / 0.45)),
  4: (t) => 4 - 8 * t,                            // 51 全降
};

test('真实的四声形状各自被分对', () => {
  for (const [tone, shape] of Object.entries(CHAO)) {
    const got = classifyTone(normalizeContour(track(shape, 250)));
    assert.equal(got.tone, Number(tone), `五度法 ${tone} 声被判成了 ${got.tone} 声`);
  }
});

test('调域窄的说话人不会整体塌成一声', () => {
  // 同样的形状，起伏只有一半。孩子、低声说话都会这样。
  for (const [tone, shape] of Object.entries(CHAO)) {
    const narrow = (t) => shape(t) * 0.5;
    const got = classifyTone(normalizeContour(track(narrow, 250)));
    assert.equal(got.tone, Number(tone), `窄调域的 ${tone} 声被判成了 ${got.tone} 声`);
  }
});

test('调域宽的说话人也不会被判错', () => {
  for (const [tone, shape] of Object.entries(CHAO)) {
    const wide = (t) => shape(t) * 1.8;
    const got = classifyTone(normalizeContour(track(wide, 250)));
    assert.equal(got.tone, Number(tone), `宽调域的 ${tone} 声被判成了 ${got.tone} 声`);
  }
});

test('几乎没有起伏的哼鸣判成一声', () => {
  const hum = normalizeContour(track((t) => 0.2 * Math.sin(9 * t), 250));
  assert.equal(classifyTone(hum).tone, 1);
});

test('倒过来的四声（其实是二声）不该算成四声', () => {
  const upsideDown = normalizeContour(track((t) => -(4 - 8 * t), 250));
  assert.notEqual(classifyTone(upsideDown).tone, 4);
});

test('有四个模板且点数一致', () => {
  assert.equal(Object.keys(TONE_TEMPLATES).length, 4);
  for (const t of Object.values(TONE_TEMPLATES)) {
    assert.equal(t.length, CONTOUR_POINTS);
  }
});

test('置信度在 0..1 且形状明确时更高', () => {
  const clear = classifyTone(normalizeContour(track(FALL)));
  const mushy = classifyTone(normalizeContour(track((t) => -0.5 + t)));
  assert.ok(clear.confidence >= 0 && clear.confidence <= 1);
  assert.ok(clear.confidence > mushy.confidence,
    'clear=' + clear.confidence + ' mushy=' + mushy.confidence);
});

test('contourDistance 对称且自距为 0', () => {
  const a = normalizeContour(track(RISE));
  const b = normalizeContour(track(FALL));
  assert.equal(contourDistance(a, a), 0);
  assert.equal(contourDistance(a, b), contourDistance(b, a));
});

test('整八度的倍频错误要被剔掉，不能卡在边界上留下', () => {
  // 正好 2 倍频是音高检测最典型的失败，差值恰好 12 个半音
  const t = track(FLAT, 300);
  for (const i of [10, 11, 12]) t[i] = { f0: 600, clarity: 0.95 };
  const c = normalizeContour(t);
  assert.ok(c.every((v) => Math.abs(v) < 3),
    '倍频点没被剔除，曲线里有 ' + Math.max(...[...c].map(Math.abs)).toFixed(2) + ' 个半音的尖峰');
});

test('分频错误（半频）同样要被剔掉', () => {
  const t = track(FLAT, 300);
  for (const i of [20, 21, 22]) t[i] = { f0: 150, clarity: 0.95 };
  assert.ok(normalizeContour(t).every((v) => Math.abs(v) < 3));
});

const holeInTheMiddle = () => track(DIP).map((p, i) =>
  (i >= 12 && i <= 28) ? { f0: p.f0, clarity: 0.1 } : p);

const maxJump = (c) => {
  let m = 0;
  for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i] - c[i - 1]));
  return m;
};

test('中间丢帧不把时间轴揉变形', () => {
  // 线性上升的曲线，跨空洞的线性插值应当精确还原。
  // 若把幸存帧当成均匀分布去重采样，空洞被压扁、两侧被拉陡，必然偏离。
  const full = normalizeContour(track(RISE));
  const holed = normalizeContour(
    track(RISE).map((p, i) => (i >= 12 && i <= 28) ? { f0: p.f0, clarity: 0.1 } : p));
  const d = contourDistance(full, holed);
  assert.ok(d < 0.2, '时间轴被揉变形了，和完整曲线差 ' + d.toFixed(2) + ' 个半音');
});

test('三声中段丢帧后仍判成三声', () => {
  // 低谷的数据是真没了，插值只能拉直线、还原不回来 —— 但不该因此判错调
  assert.equal(classifyTone(normalizeContour(holeInTheMiddle())).tone, 3);
});

test('丢帧后相邻点之间不出现断崖', () => {
  const full = maxJump(normalizeContour(track(DIP)));
  const holed = maxJump(normalizeContour(holeInTheMiddle()));
  assert.ok(holed < full * 1.15,
    '丢帧后最大跳变 ' + holed.toFixed(2) + '，完整曲线是 ' + full.toFixed(2));
});

test('中段的倍频错误被局部中位数挡住', () => {
  // 实测 ǔ 的标准音在中段蹦出 +8.6 半音（约一个八度），全局中位数判不出来：
  // 它离全局中位数不到 9 个半音，却把曲线形状彻底带歪。
  const clean = normalizeContour(track(DIP, 250));
  const spiked = track(DIP, 250);
  // 实测偏离全局中位数约 8.6 个半音 —— 正好卡在 9 半音门限的内侧
  for (const i of [18, 19, 20]) spiked[i] = { f0: spiked[i].f0 * 1.64, clarity: 0.95 };
  const got = normalizeContour(spiked);
  const d = contourDistance(clean, got);
  assert.ok(d < 0.8, '倍频点带歪了曲线，和干净曲线差 ' + d.toFixed(2) + ' 个半音');
  assert.equal(classifyTone(got).tone, 3);
});

test('起音处的毛刺被挡住', () => {
  // 实测 ìng 的标准音开头是 -8.3 半音的毛刺，让四声被判成一声
  const clean = normalizeContour(track(FALL, 250));
  const spiked = track(FALL, 250);
  for (const i of [0, 1]) spiked[i] = { f0: spiked[i].f0 / 1.9, clarity: 0.9 };
  const got = normalizeContour(spiked);
  assert.equal(classifyTone(got).tone, 4,
    '起音毛刺把四声带成了 ' + classifyTone(got).tone + ' 声');
  assert.ok(contourDistance(clean, got) < 0.8);
});

test('真正的三声低谷不会被当成野点剔掉', () => {
  // 三声本来就要降下去再回升，局部中位数不能把这个正常起伏当成错误
  const c = normalizeContour(track(DIP, 250));
  assert.equal(classifyTone(c).tone, 3);
  const span = Math.max(...c) - Math.min(...c);
  assert.ok(span > 3, '三声的起伏被压平了：' + span.toFixed(2));
});

test('连成一片的倍频错误被校正回来，而不是被丢掉', () => {
  // 实测 ǔ 的标准音里有连续 11 帧被翻倍（243Hz 报成 486Hz）。
  // 这么宽的一段，局部中位数盖不住；但它正好差一个八度，可以校正。
  const clean = normalizeContour(track(DIP, 250));
  const doubled = track(DIP, 250);
  for (let i = 14; i < 25; i++) doubled[i] = { f0: doubled[i].f0 * 2, clarity: 0.95 };
  const got = normalizeContour(doubled);
  const d = contourDistance(clean, got);
  assert.ok(d < 0.8, '倍频段没校正回来，和干净曲线差 ' + d.toFixed(2) + ' 个半音');
  assert.equal(classifyTone(got).tone, 3);
});

test('分频错误（整段减半）同样被校正', () => {
  const clean = normalizeContour(track(FALL, 300));
  const halved = track(FALL, 300);
  for (let i = 5; i < 16; i++) halved[i] = { f0: halved[i].f0 / 2, clarity: 0.95 };
  assert.ok(contourDistance(clean, normalizeContour(halved)) < 0.8);
  assert.equal(classifyTone(normalizeContour(halved)).tone, 4);
});

test('校正不会把真实的声调起伏当成倍频错误', () => {
  // 四声跨 8 个半音、三声跨 6 个，都远小于一个八度，不该被动
  for (const [shape, want] of [[FLAT, 1], [RISE, 2], [DIP, 3], [FALL, 4]]) {
    const c = normalizeContour(track(shape, 250));
    assert.equal(classifyTone(c).tone, want, '干净的 ' + want + ' 声被校正逻辑改坏了');
  }
});
