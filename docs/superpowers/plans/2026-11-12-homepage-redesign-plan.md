# 首页改版（赛赛的工具箱）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `index.html` 从「📁 目录 + 📄 文字链接」改成一屏六张大插图卡片，一年级小朋友看图就能选工具。

**Architecture:** 单文件 `index.html`：内联 `<style>` + 六个 `<a class="card">`，每张卡片内嵌一幅内联 SVG 插图。无 JavaScript、无外部资源。用一个 Node 内置 `node:test` 静态测试文件按正则检查 HTML 文本，响应式布局用 headless Chrome 截图人工核对。

**Tech Stack:** HTML5、CSS（Grid、media queries、自定义属性）、内联 SVG；测试用 Node 内置 `node:test` + `node:assert/strict`（与 `pinyin/test/*.test.js` 同一风格，无 npm 依赖）。

**Spec:** `docs/superpowers/specs/2026-11-12-homepage-redesign-design.md`

## Global Constraints

- 只改 `index.html`，另新增测试文件 `tests/homepage.test.mjs`。不改任何子工具页面，不改 `README.md`。
- 纯静态单文件，无构建步骤、无框架、无 npm 依赖、无 `<script>`。
- 不加载任何外部资源：无 CDN、无 Google Fonts、无外部图片、无 `<link>`、无 `<img>`、无 `@import`、无 `url(http…)`。
- `<html lang="zh-CN">`，`<title>赛赛的工具箱</title>`，页头大标题「赛赛的工具箱」。
- 字体：系统字体栈 `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif`。
- 六张卡片的顺序、短名、链接固定为：
  1. 学拼音 → `pinyin/index.html`
  2. 英语听力 → `english-audio/index.html`
  3. 解方程 → `solve-equation/index.html`
  4. 坐标绘图器 → `x-y-line/coordinate-plotter.html`
  5. 迷宫生成器 → `maze-gen/maze.html`
  6. 跳一跳 → `tiao-yi-tiao/game.html`
- 断点：≥ 900px 3 列；360–899px 2 列；< 360px 1 列。
- 只做浅色主题，不做暗色模式。
- 每个插图 SVG 带 `aria-hidden="true"`；卡片可访问名称来自文字。
- 页面可见文字中不得出现 📁、📄、英文目录名（`x-y-line`、`maze-gen`、`jump-game`、`solve-equation`、`english-audio`、`pinyin`、`tiao-yi-tiao`）。

## Review Focus

1. **iPad 触屏上的「粘住的 hover」**：手指点过后卡片一直保持上浮状态。期望：上浮效果只在 `@media (hover: hover)` 下生效，按下效果用 `:active`。测试见 Task 1 `hover effect is gated by hover media query`。
2. **最窄宽度下长标题撑破卡片**：360px 两列时每张卡约 160px，「坐标绘图器」「迷宫生成器」五个大字可能溢出，引发横向滚动。期望：标题字号用 `clamp()` 随视口缩小，且卡片 `min-width: 0`。测试见 Task 1 `grid items can shrink`，Task 3 360px 截图核对。
3. **键盘用户看不到焦点**：Tab 到卡片时没有可见焦点框。期望：`.card:focus-visible` 有明显 outline。测试见 Task 1 `focus-visible outline exists`。
4. **开启「减少动态效果」的设备仍有动画**。期望：`prefers-reduced-motion: reduce` 下取消 transition 和 transform。测试见 Task 1 `reduced motion disables transitions`。
5. **SVG 在某些浏览器里按固有尺寸渲染**（缺 `viewBox` 或写死 `width`/`height` 像素），导致插图过大撑破或过小。期望：每个 SVG 有 `viewBox`，不带像素 `width`/`height` 属性，CSS 设 `width:100%; height:auto`。测试见 Task 2 `every svg has viewBox and no fixed size`。

---

## 共享约定（所有任务都依赖）

卡片 DOM 结构固定如下，Task 1 建立，Task 2/3 只替换 `<svg>` 内容：

```html
<a class="card" href="pinyin/index.html" data-tool="pinyin">
  <span class="card-art"><svg class="art" viewBox="0 0 200 150" aria-hidden="true" focusable="false">…</svg></span>
  <span class="card-title">学拼音</span>
  <span class="card-desc">…</span>
</a>
```

- `data-tool` 取值依次为：`pinyin`、`english`、`equation`、`plotter`、`maze`、`jump`。
- 每张卡片的主色通过该卡片上的 CSS 自定义属性 `--accent`（主色）和 `--tint`（插图区浅底）设置，写在 `.card[data-tool="…"]` 规则里。具体色值由实现者定，六色彼此区分明显。
- 所有 SVG 统一 `viewBox="0 0 200 150"`。
- 卡片说明文案（`.card-desc`）：
  - 学拼音：`声母 韵母 四声调`
  - 英语听力：`一年级上册`
  - 解方程：`一元一次方程求解`
  - 坐标绘图器：`描点 连成线`
  - 迷宫生成器：`从起点走到终点`
  - 跳一跳：`按住蓄力 跳过去`

测试文件 `tests/homepage.test.mjs` 顶部共享工具（Task 1 写入，后续任务复用）：

- `const html` = `index.html` 全文（`fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')`）。
- `function cards()` → 返回 `[{ tool, href, title, desc, svg }]`，按出现顺序，用正则从每个 `<a class="card" …>…</a>` 中提取。
- `function visibleText()` → 去掉 `<style>…</style>` 和所有标签后的文本。

运行全部测试：`node --test tests/`

---

### Task 1: 页面骨架、卡片网格与样式

**Files:**
- Create: `tests/homepage.test.mjs`
- Modify: `index.html`（整文件重写）

**Interfaces:**
- Consumes: 无
- Produces: 上面「共享约定」里的卡片 DOM、`data-tool` 取值、`--accent`/`--tint` 变量、测试工具函数 `cards()`、`visibleText()`。本任务每张卡片的 `<svg class="art" viewBox="0 0 200 150" aria-hidden="true" focusable="false">` 内放一个占位 `<rect>`（铺满 `--tint` 色），Task 2/3 替换。

- [ ] **Step 1: 写失败测试** `tests/homepage.test.mjs`，包含以下用例：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
// html / cards() / visibleText() 见「共享约定」

const EXPECTED = [
  ['pinyin',   'pinyin/index.html',                '学拼音'],
  ['english',  'english-audio/index.html',         '英语听力'],
  ['equation', 'solve-equation/index.html',        '解方程'],
  ['plotter',  'x-y-line/coordinate-plotter.html', '坐标绘图器'],
  ['maze',     'maze-gen/maze.html',               '迷宫生成器'],
  ['jump',     'tiao-yi-tiao/game.html',           '跳一跳'],
];

test('lang and title', () => {
  assert.match(html, /<html[^>]*lang="zh-CN"/);
  assert.match(html, /<title>赛赛的工具箱<\/title>/);
  assert.match(html, /<h1[^>]*>[\s\S]*赛赛的工具箱[\s\S]*<\/h1>/);
});

test('six cards in order with fixed links and titles', () => {
  const c = cards();
  assert.equal(c.length, 6);
  assert.deepEqual(c.map(x => [x.tool, x.href, x.title]), EXPECTED);
});

test('cards have the agreed descriptions', () => {
  assert.deepEqual(cards().map(x => x.desc), [
    '声母 韵母 四声调', '一年级上册', '一元一次方程求解',
    '描点 连成线', '从起点走到终点', '按住蓄力 跳过去',
  ]);
});

test('every card has an aria-hidden svg', () => {
  for (const c of cards()) assert.match(c.svg, /^<svg[^>]*aria-hidden="true"/);
});

test('no folder/file icons or english dir names in visible text', () => {
  assert.doesNotMatch(html, /📁|📄/);
  const t = visibleText();
  for (const n of ['x-y-line','maze-gen','jump-game','solve-equation','english-audio','pinyin','tiao-yi-tiao'])
    assert.ok(!t.includes(n), n);
});

test('no external requests and no script', () => {
  const h = html.replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '');
  assert.doesNotMatch(h, /https?:\/\//);
  assert.doesNotMatch(h, /(src|href)="\/\//);
  assert.doesNotMatch(h, /<script|<link|<img|<iframe|@import|@font-face/i);
  assert.doesNotMatch(h, /url\(\s*['"]?(https?:)?\/\//);
});

test('system font stack', () => {
  assert.match(html, /font-family:[^;]*"PingFang SC"[^;]*"Microsoft YaHei"[^;]*sans-serif/);
});

test('breakpoints 900 and 360', () => {
  assert.match(html, /grid-template-columns:\s*repeat\(3,/);
  assert.match(html, /@media\s*\(max-width:\s*899px\)[^{]*\{[^}]*\{[^}]*repeat\(2,/);
  assert.match(html, /@media\s*\(max-width:\s*359px\)[^{]*\{[^}]*\{[^}]*(1fr\s*;|repeat\(1,)/);
});

test('grid items can shrink', () => {
  assert.match(html, /\.card\s*\{[^}]*min-width:\s*0/);
  assert.match(html, /\.card-title\s*\{[^}]*font-size:\s*clamp\(/);
});

test('hover effect is gated by hover media query', () => {
  assert.match(html, /@media\s*\(hover:\s*hover\)[^{]*\{[^}]*\.card:hover/);
  assert.match(html, /\.card:active/);
});

test('focus-visible outline exists', () => {
  assert.match(html, /\.card:focus-visible\s*\{[^}]*outline:\s*[1-9]/);
});

test('reduced motion disables transitions', () => {
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?(transition:\s*none|transition-duration:\s*0)/);
});

test('no dark mode', () => {
  assert.doesNotMatch(html, /prefers-color-scheme/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/`
Expected: 多数用例 FAIL（例如 `six cards in order…` 报 `0 !== 6`，`no folder/file icons…` 命中 📁）。

- [ ] **Step 3: 重写 `index.html`**

要点（具体数值由实现者定）：
- `body` 暖色浅底（奶油/米白），深色文字；`<header>` 内 `<h1>赛赛的工具箱</h1>`，旁边一个小装饰 SVG（工具箱或星星，`aria-hidden="true"`）。
- `<main class="grid">` 内六张卡片，结构与顺序严格按「共享约定」；`.grid` 默认 `repeat(3, minmax(0, 1fr))`，`@media (max-width: 899px)` 改 `repeat(2, minmax(0, 1fr))`，`@media (max-width: 359px)` 改 `1fr`。两个 media 块里 `.grid { grid-template-columns: … }` 必须是块内第一条规则（测试正则依赖这个顺序）。
- `.card`：`display:flex; flex-direction:column; min-width:0;` 圆角、白底、柔和阴影、`text-decoration:none`；`.card-art` 用 `background: var(--tint)`，占卡片高度大半（插图区 `aspect-ratio: 4 / 3`）；`.art { display:block; width:100%; height:auto; }`。
- `.card-title` 大号粗体，`font-size: clamp(…)`；`.card-desc` 明显更小、颜色更淡但对比度足够。
- 交互：`.card` 有 `transition`；`@media (hover: hover) { .card:hover { transform: translateY(…) } }`；`.card:active { transform: scale(0.98) }`；`.card:focus-visible { outline: 4px solid var(--accent); outline-offset: 4px }`；`@media (prefers-reduced-motion: reduce) { .card { transition: none } .card:hover, .card:active { transform: none } }`。
- 页面左右留白保证 375px 下无横向滚动；页脚可省略。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add index.html tests/homepage.test.mjs
git commit -m "feat(home): 首页改为大卡片网格布局"
```

---

### Task 2: 学习类三幅插图（学拼音、英语听力、解方程）

**Files:**
- Modify: `index.html`（替换 `data-tool` 为 `pinyin`、`english`、`equation` 三张卡片内 `<svg>` 的占位内容）
- Modify: `tests/homepage.test.mjs`（追加用例）

**Interfaces:**
- Consumes: Task 1 的卡片 DOM、`cards()`、`--accent`/`--tint`。
- Produces: 无新接口。

- [ ] **Step 1: 追加失败测试**

```js
const svgOf = tool => cards().find(c => c.tool === tool).svg;
const shapeCount = s => (s.match(/<(path|rect|circle|ellipse|line|polyline|polygon|text)\b/g) || []).length;

test('every svg has viewBox and no fixed size', () => {
  for (const c of cards()) {
    assert.match(c.svg, /^<svg[^>]*viewBox="0 0 200 150"/);
    assert.doesNotMatch(c.svg.match(/^<svg[^>]*>/)[0], /\s(width|height)="/);
  }
});

test('pinyin art shows tone-marked letters', () => {
  const s = svgOf('pinyin');
  for (const ch of ['ā', 'á', 'ǎ', 'à']) assert.ok(s.includes(ch), ch);
  assert.ok(shapeCount(s) >= 5);
});

test('english art shows headphones and ABC', () => {
  const s = svgOf('english');
  assert.match(s, /ABC|>A<[\s\S]*>B<[\s\S]*>C</);
  assert.ok(shapeCount(s) >= 6);
});

test('equation art shows x = ?', () => {
  const s = svgOf('equation');
  assert.match(s, /x\s*(=|＝)\s*\?|x\s*(=|＝)\s*？/);
  assert.ok(shapeCount(s) >= 5);
});
```

注：`every svg has viewBox…` 在本任务结束时对六张卡片都应通过（Task 1 的占位 SVG 已满足）。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/`
Expected: `pinyin art…`、`english art…`、`equation art…` FAIL。

- [ ] **Step 3: 画三幅插图**

风格统一：扁平、圆角、描边粗细一致（如统一 `stroke-width="6"`、`stroke-linecap="round"`）或无描边；主色用该卡片的 `--accent`（可在 SVG 内写 `fill="var(--accent)"` 或 `style`），辅以白色和深色。
- 学拼音：一行大号 `ā á ǎ à`（`<text>`，字体继承系统字体栈），声调符号可用主色突出；可加一个小喇叭或嘴巴装饰。
- 英语听力：一副大耳机 + 两侧声波弧线，中间或下方写 `ABC`。
- 解方程：一架天平，一边托盘上一个写着 `x` 的方块，另一边若干小圆砝码；天平上方写 `x = ?`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: 截图自查插图可识别**

Run:
```bash
cd /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign && \
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --window-size=1280,900 --screenshot="$TMPDIR/home-1280.png" "file://$PWD/index.html"
```
用 Read 打开 `$TMPDIR/home-1280.png`。Expected：前三张卡片插图分别一眼可认出「拼音声调字母」「耳机 + ABC」「天平 + x = ?」，字母没有被裁切。

- [ ] **Step 6: Commit**

```bash
git add index.html tests/homepage.test.mjs
git commit -m "feat(home): 学拼音、英语听力、解方程插图"
```

---

### Task 3: 工具/游戏类三幅插图（坐标绘图器、迷宫生成器、跳一跳）与响应式核对

**Files:**
- Modify: `index.html`（替换 `plotter`、`maze`、`jump` 三张卡片 `<svg>` 的占位内容；按截图结果微调 CSS）
- Modify: `tests/homepage.test.mjs`（追加用例）

**Interfaces:**
- Consumes: Task 1 的卡片 DOM、`cards()`；Task 2 的 `svgOf()`、`shapeCount()`。
- Produces: 无。

- [ ] **Step 1: 追加失败测试**

```js
test('plotter art has axes, two points and a line', () => {
  const s = svgOf('plotter');
  assert.ok((s.match(/<(line|path|polyline)\b/g) || []).length >= 3); // 两条坐标轴 + 一条直线
  assert.ok((s.match(/<circle\b/g) || []).length >= 2);               // 两个点
});

test('maze art has walls and start/end markers', () => {
  const s = svgOf('maze');
  assert.ok(shapeCount(s) >= 8);
  assert.ok((s.match(/<(circle|polygon|path)\b[^>]*fill="(?!none)/g) || []).length >= 2); // 起点、终点
});

test('jump art has a figure, two blocks and an arc', () => {
  const s = svgOf('jump');
  assert.ok((s.match(/<(rect|polygon|path)\b/g) || []).length >= 2);  // 两个方块
  assert.match(s, /<path\b[^>]*d="[^"]*[QqCcAa]/);                      // 跳跃弧线（曲线命令）
  assert.match(s, /<(circle|ellipse)\b/);                               // 小人的头
});

test('no placeholder-only svg remains', () => {
  for (const c of cards()) assert.ok(shapeCount(c.svg) >= 5, c.tool);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/`
Expected: `plotter art…`、`maze art…`、`jump art…`、`no placeholder-only svg remains` FAIL。

- [ ] **Step 3: 画三幅插图**

风格与 Task 2 一致。
- 坐标绘图器：带箭头的 x、y 轴，浅色网格线，两个主色圆点，一条穿过两点的直线（虚线弧不需要）。
- 迷宫生成器：方形迷宫墙（`<path>` 或若干 `<line>`），左上入口一个绿色圆点/旗子，右下出口一颗星，可选一条浅色虚线路径。
- 跳一跳：两个立体感方块（顶面 + 侧面用 `<polygon>`），左方块上一个小人（圆头 + 身体），一条虚线弧（`<path d="M… Q…">`，`stroke-dasharray`）从小人指向右方块。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: 四个宽度截图核对布局**

Run:
```bash
cd /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign && \
for s in 340,900 360,900 375,900 768,1024 1280,900; do \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars=false \
    --window-size=$s --screenshot="$TMPDIR/home-${s%,*}.png" "file://$PWD/index.html"; done
```
用 Read 逐张打开。Expected：
- 1280：3 列；768：2 列；375 和 360：2 列；340：1 列。
- 每张截图中卡片右边缘与页面右边缘之间有留白，没有卡片或标题被右侧裁切，底部无横向滚动条。
- 「坐标绘图器」「迷宫生成器」在 360 宽下标题在卡片内（可换行，不溢出）。
- 六幅插图看图就能分辨是哪个工具；页面上没有 📁、📄、英文目录名。

如果任一项不满足：调整 `index.html` 的 CSS（间距、`clamp()` 下限、留白），重跑 Step 4 和 Step 5。

- [ ] **Step 6: 核对链接目标存在**

Run:
```bash
cd /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign && \
for f in pinyin/index.html english-audio/index.html solve-equation/index.html x-y-line/coordinate-plotter.html maze-gen/maze.html tiao-yi-tiao/game.html; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
```
Expected：六行全是 `OK`。

- [ ] **Step 7: 确认只改了允许的文件**

Run: `git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign diff --name-only main...HEAD; git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign status --short`
Expected：除 `docs/superpowers/` 下的文档外，只出现 `index.html` 和 `tests/homepage.test.mjs`。

- [ ] **Step 8: Commit**

```bash
git add index.html tests/homepage.test.mjs
git commit -m "feat(home): 坐标绘图器、迷宫、跳一跳插图"
```
