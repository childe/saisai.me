# 首页改版（赛赛的工具箱）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `index.html` 从「📁 目录 + 📄 文字链接」改成一屏六张大插图卡片，一年级小朋友看图就能选工具。

**Architecture:** 单文件 `index.html`：内联 `<style>` + 六个 `<a class="card">`，每张卡片内嵌一幅内联 SVG 插图。无 JavaScript、无外部资源。用一个 Node 内置 `node:test` 静态测试文件检查链接、标题、文案等契约；布局、横向溢出、减少动态效果用「浏览器核对脚本」（见共享约定，自动发现本机 Chrome / Edge / Chromium，在 iframe 里按指定宽度渲染）实测并输出数值，插图可识别度看整页截图人工核对。

**Tech Stack:** HTML5、CSS（Grid、media queries、自定义属性）、内联 SVG；测试用 Node 内置 `node:test` + `node:assert/strict`（与 `pinyin/test/*.test.js` 同一风格，无 npm 依赖）。

**Spec:** `docs/superpowers/specs/2026-11-12-homepage-redesign-design.md`

## Global Constraints

- 只改 `index.html`，另新增测试文件 `tests/homepage.test.mjs`。不改任何子工具页面，不改 `README.md`。
- 纯静态单文件，无构建步骤、无框架、无 npm 依赖、无 `<script>`。
- 不加载任何外部资源：无 CDN、无 Google Fonts、无外部图片、无 `<link>`、无 `<img>`、无 `@import`、无 `url(http…)`。
- `<html lang="zh-CN">`，`<title>赛赛的工具箱</title>`，页头大标题「赛赛的工具箱」。
- 整文件重写时保留现有 `<meta name="viewport" content="width=device-width, initial-scale=1.0">`（缺了它手机会按 980px 桌面宽度渲染，所有断点失效）。
- 本分支在实施开始前已有 `.gitignore` 改动（新增 `.xdev/` 一行，来自设计文档提交）。这是允许的既有变更，实施阶段不要撤销它，也不要再改它。
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
- `function mediaBlock(query)` → 在 `html` 中找到 `@media <query> {`，按花括号配对返回整个块的内部文本；找不到返回 `''`。用于断言「某 media 块里有某条规则」，不依赖块内规则顺序。

运行全部测试：`node --test tests/`

### 浏览器核对脚本（Task 2/3 的视觉验收用，不进仓库）

静态测试只证明 HTML 文本里有某些规则，不能证明渲染结果对。布局与插图的验收以本脚本输出的数值和整页截图为准。

要点（已在本机验证可用）：
- 本机没有 Google Chrome，有 Microsoft Edge。脚本按 Chrome → Edge → Chromium 顺序自动发现浏览器，一个都没有就打印 `NO_BROWSER` 并退出 1。遇到 `NO_BROWSER` 时停下来报告，不要用静态测试代替视觉验收。
- headless 模式下 `--window-size` 宽度小于约 500px 会被抬高（实测 375 → 492），所以窄宽度不能直接靠窗口宽度模拟。脚本把 `index.html` 放进一个指定宽度的 `<iframe>`，iframe 内的 media query 按 iframe 宽度生效（实测 340px 下 `(max-width:359px)` 为 true）。
- iframe 高度 4000px，截图为整页截图；脚本输出 `allVisible=true` 表示最后一张卡片的底边在截图范围内，六张卡片都被覆盖。
- 横向溢出用 `scrollWidth > clientWidth` 实测（`hscroll=`），不凭截图里有没有滚动条判断。
- `titleOverflow=` 统计右边缘超出所在卡片右边缘的 `.card-title` 个数。
- `transition=` 是第一张卡片的计算后 `transition-duration`；带 `--force-prefers-reduced-motion` 运行时应为 `0s`。

把脚本写到临时目录（每次运行前重写一遍，保证内容最新）：

```bash
mkdir -p "$TMPDIR/home-check" && cat > "$TMPDIR/home-check/check.sh" <<'EOS'
#!/bin/bash
# usage: check.sh <worktree> <outdir> [extra browser flags...]
set -u
WT="$1"; OUT="$2"; shift 2
BROWSER=""
for b in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  [ -x "$b" ] && BROWSER="$b" && break
done
[ -n "$BROWSER" ] || { echo "NO_BROWSER"; exit 1; }
TO=""; command -v timeout >/dev/null && TO="timeout 60"
mkdir -p "$OUT"
# 每次调用独立 profile + 60 秒超时，防止 headless 进程挂住
run() { local tag="$1"; shift; $TO "$BROWSER" --headless=new --disable-gpu --allow-file-access-from-files \
  --user-data-dir="$OUT/profile-$tag" "$@" </dev/null 2>/dev/null || echo "BROWSER_FAIL $tag" >&2; }
for w in 340 360 375 768 1280; do
  H=4000; WW=$(( w < 600 ? 600 : w ))
  cat > "$OUT/frame-$w.html" <<EOF
<!doctype html><html><body style="margin:0;background:#888">
<iframe id="f" src="file://$WT/index.html" style="border:0;display:block;width:${w}px;height:${H}px"></iframe>
<script>
f.onload = () => {
  const win = f.contentWindow, d = f.contentDocument, de = d.documentElement;
  const cards = [...d.querySelectorAll('.card')];
  const cols = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size;
  const titleOverflow = cards.filter(c => {
    const t = c.querySelector('.card-title');
    return t && t.getBoundingClientRect().right > c.getBoundingClientRect().right + 0.5;
  }).length;
  const lastBottom = cards.length ? Math.max(...cards.map(c => c.getBoundingClientRect().bottom)) : 0;
  const c0 = cards[0] ? win.getComputedStyle(cards[0]) : null;
  document.title = 'w=' + win.innerWidth + ' cards=' + cards.length + ' cols=' + cols +
    ' hscroll=' + (de.scrollWidth > de.clientWidth) + ' titleOverflow=' + titleOverflow +
    ' allVisible=' + (lastBottom <= $H) + ' transition=' + (c0 ? c0.transitionDuration : '-');
};
</script></body></html>
EOF
  run "dom-$w" "$@" --window-size=$WW,$H --virtual-time-budget=3000 --dump-dom "file://$OUT/frame-$w.html" \
    | grep -o '<title>[^<]*' | sed 's/<title>//'
  run "shot-$w" "$@" --window-size=$WW,$H --screenshot="$OUT/home-$w.png" "file://$OUT/frame-$w.html" >/dev/null
  [ -s "$OUT/home-$w.png" ] || echo "NO_SCREENSHOT w=$w"
done
EOS
chmod +x "$TMPDIR/home-check/check.sh"
```

截图左侧是页面，iframe 右侧（宽度不足 600 时）和下方是灰色底，不属于页面。

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

test('viewport meta kept', () => {
  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1(\.0)?"/);
});

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
  assert.match(mediaBlock('(max-width: 899px)'), /grid-template-columns:\s*repeat\(2,/);
  assert.match(mediaBlock('(max-width: 359px)'), /grid-template-columns:\s*(1fr\s*[;}]|repeat\(1,)/);
});
// 实际列数以浏览器核对脚本的 cols= 为准（Task 3 Step 5）。

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
- `<head>` 保留 `<meta charset="UTF-8">` 和现有 viewport 声明。
- `body` 暖色浅底（奶油/米白），深色文字；`<header>` 内 `<h1>赛赛的工具箱</h1>`，旁边一个小装饰 SVG（工具箱或星星，`aria-hidden="true"`）。
- `<main class="grid">` 内六张卡片，结构与顺序严格按「共享约定」；`.grid` 默认 `repeat(3, minmax(0, 1fr))`，`@media (max-width: 899px)` 改 `repeat(2, minmax(0, 1fr))`，`@media (max-width: 359px)` 改 `1fr`。media 查询写成 `@media (max-width: 899px)` / `@media (max-width: 359px)`（冒号后一个空格，`mediaBlock()` 按这个字面量查找）；块内规则顺序不限。
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

先按「共享约定 → 浏览器核对脚本」写出 `$TMPDIR/home-check/check.sh`，然后 Run:
```bash
"$TMPDIR/home-check/check.sh" /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign "$TMPDIR/home-check/t2"
```
Expected：输出 5 行，每行 `cards=6`；不出现 `NO_BROWSER`。
用 Read 打开 `$TMPDIR/home-check/t2/home-1280.png`（整页截图）。Expected：前三张卡片插图分别一眼可认出「拼音声调字母」「耳机 + ABC」「天平 + x = ?」，字母没有被裁切。
如果输出 `NO_BROWSER`、`NO_SCREENSHOT` 或 stderr 出现 `BROWSER_FAIL`：先重跑一次；仍失败就停下来报告，不要跳过本步。

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
test('no placeholder-only svg remains', () => {
  for (const c of cards()) assert.ok(shapeCount(c.svg) >= 5, c.tool);
});
```

说明：本任务的静态测试只用来驱动「占位图已被替换」。坐标轴、迷宫墙、小人和弧线画得对不对，不用正则断言形状类型（正则通过不能证明画对），统一在 Step 5 看整页截图逐张验收。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/`
Expected: `no placeholder-only svg remains` FAIL，失败信息为 `plotter`（第一张仍是占位图的卡片）。

- [ ] **Step 3: 画三幅插图**

风格与 Task 2 一致。
- 坐标绘图器：带箭头的 x、y 轴，浅色网格线，两个主色圆点，一条穿过两点的直线（虚线弧不需要）。
- 迷宫生成器：方形迷宫墙（`<path>` 或若干 `<line>`），左上入口一个绿色圆点/旗子，右下出口一颗星，可选一条浅色虚线路径。
- 跳一跳：两个立体感方块（顶面 + 侧面用 `<polygon>`），左方块上一个小人（圆头 + 身体），一条虚线弧（`<path d="M… Q…">`，`stroke-dasharray`）从小人指向右方块。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: 五个宽度实测布局 + 整页截图核对**

先重写一遍 `$TMPDIR/home-check/check.sh`（见共享约定），然后 Run:
```bash
WT=/Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign
"$TMPDIR/home-check/check.sh" "$WT" "$TMPDIR/home-check/t3"
"$TMPDIR/home-check/check.sh" "$WT" "$TMPDIR/home-check/t3-rm" --force-prefers-reduced-motion
```
Expected（第一条命令，5 行）：
- 每行 `cards=6 hscroll=false titleOverflow=0 allVisible=true`，`transition=` 不是 `0s`。
- 列数：`w=1280 … cols=3`；`w=768 … cols=2`；`w=375 … cols=2`；`w=360 … cols=2`；`w=340 … cols=1`。

Expected（第二条命令，减少动态效果）：5 行都是 `transition=0s`。

然后用 Read 逐张打开 `$TMPDIR/home-check/t3/home-{1280,768,375,360,340}.png`（整页截图，覆盖全部六张卡片）。Expected：
- 卡片右边缘与页面右边缘之间有留白，没有卡片或标题被右侧裁切。
- 「坐标绘图器」「迷宫生成器」在 360 宽下标题在卡片内（可换行）。
- 六幅插图看图就能分辨是哪个工具：坐标轴 + 两点一线、迷宫墙 + 起点终点、方块 + 小人 + 跳跃弧线，以及 Task 2 的三幅；页面上没有 📁、📄、英文目录名。

如果任一项不满足：调整 `index.html`（CSS 间距、`clamp()` 下限、留白，或插图本身），重跑 Step 4 和 Step 5。
如果输出 `NO_BROWSER`、`NO_SCREENSHOT` 或 stderr 出现 `BROWSER_FAIL`：先重跑一次；仍失败就停下来报告，不要跳过本步。

键盘 Tab/Enter：卡片是原生 `<a href>`，Tab 可达、Enter 跳转由浏览器保证；焦点框样式由 Task 1 `focus-visible outline exists` 检查。headless 下脚本调用 `focus()` 不会触发 `:focus-visible`（已实测），所以本步不自动化键盘检查。

- [ ] **Step 6: 核对链接目标存在**

Run:
```bash
cd /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign && \
for f in pinyin/index.html english-audio/index.html solve-equation/index.html x-y-line/coordinate-plotter.html maze-gen/maze.html tiao-yi-tiao/game.html; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
```
Expected：六行全是 `OK`。

- [ ] **Step 7: 确认只改了允许的文件**

Run: `git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign diff --name-only main...HEAD; git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261112-154332-homepage-redesign status --short`
Expected：除 `docs/superpowers/` 下的文档和既有的 `.gitignore`（实施开始前已在本分支，见 Global Constraints）外，只出现 `index.html` 和 `tests/homepage.test.mjs`。不要为了让本步通过而撤销 `.gitignore` 的改动。

- [ ] **Step 8: Commit**

```bash
git add index.html tests/homepage.test.mjs
git commit -m "feat(home): 坐标绘图器、迷宫、跳一跳插图"
```
