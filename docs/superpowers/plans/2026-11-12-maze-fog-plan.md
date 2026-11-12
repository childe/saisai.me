# 迷宫迷雾模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `maze-gen/maze.html` 加迷雾模式：只显示小人周围 Chebyshev 距离 ≤ N 的格子，N 可用「−」「+」调节（默认 5，范围 1–25），可开关，状态存 `localStorage`。

**Architecture:** 所有迷雾状态与函数集中写在 `maze.html` 内联脚本的一个带标记的区段（`// ==== fog BEGIN ====` … `// ==== fog END ====`），便于测试按标记提取后放进 `node:vm` 执行。迷雾中心一律用新状态 `displayPosition`（由 `updatePlayerDisplay()` 维护），不读 `playerPosition`。视觉用 `.fog` 类 + CSS 隐藏格子子元素（墙线）。

**Tech Stack:** 单文件 HTML + 原生 JS + CSS；测试用 Node 内置 `node:test`、`node:assert/strict`、`node:vm`、`node:fs`，无 npm 依赖。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261112-181017-maze-fog/docs/superpowers/specs/2026-11-12-maze-fog-design.md`

## Global Constraints

- 只改 `maze-gen/maze.html`，新增 `tests/maze-fog.test.mjs`。不引入构建步骤、框架、npm 依赖、`package.json`。
- 视野判定：`Math.abs(row - playerRow) <= radius && Math.abs(col - playerCol) <= radius`（Chebyshev）。
- 默认 `fogEnabled = true`、`fogRadius = 5`；`FOG_MIN = 1`、`FOG_MAX = 25`。
- 按钮文案：开关「迷雾：开」/「迷雾：关」（全角冒号）；数值「视野 N」；减号用「−」（U+2212），加号「+」。
- 迷雾格子：`background-color: #444 !important;`，`.cell.fog > * { visibility: hidden; }`；`.cell.fog.solution { background-color: #ff0000 !important; }`。
- `localStorage` 每次读写（包括访问 `localStorage` 本身）都包在 try/catch 中；读不到或值非法时用默认值（开启、N=5）。N 必须是 `[1, 25]` 内整数，否则回退 5。
- 不改迷宫生成、寻路、触摸手势、键盘控制；不写 URL 参数；不做已探索记忆、圆形视野、渐变、视线遮挡。
- `updateMazeGridCSS()` 按 `selectorText === '.cell'` 找规则改格子尺寸：不要改动原 `.cell` 规则的选择器，新规则不要恰好写成 `.cell`。
- 运行测试：`node --test tests/`（在 worktree 根目录）。

## Review Focus

1. `localStorage` 存了非法值（半径 `'0'`、`'26'`、`'3.5'`、`'abc'`、`''`）→ N 回退为 5，不报错。测试在 Task 1。
2. 访问 `localStorage` 本身就抛异常（Safari 隐私模式、禁用站点数据）→ 加载得到默认值，保存不抛出。测试在 Task 1。
3. N 大于迷宫（10×10 迷宫，N=25）→ 所有格子可见，无异常。测试在 Task 2。
4. 连续点「−」到 1 以下、「+」到 25 以上 → 数值夹住、对应按钮 `disabled`；迷雾关闭时调 N → 没有格子带 `fog`，重新开启后用新 N。测试在 Task 2。
5. 走到别处后重新生成迷宫（`playerPosition` 重置为 (0,0) 后调 `updatePlayerDisplay()`）→ 迷雾以 (0,0) 为中心。测试在 Task 2。

---

## 文件结构

- Modify `maze-gen/maze.html`
  - `<style>`：在 `.solution` 规则之后加迷雾 CSS；加 `.fog-controls` 布局 CSS。
  - `<body>`：在 `.size-controls` 与 `#maze` 之间加 `.fog-controls` 行；底部提示加一句。
  - `<script>`：在 `let playerPosition = ...;`（约 1010 行）之后插入 fog 区段；修改 `updatePlayerDisplay()`（约 1254 行）；修改 `DOMContentLoaded` 回调（约 1239 行）。
- Create `tests/maze-fog.test.mjs`：源码提取 + 假 DOM + vm 行为测试 + 静态 HTML/CSS 断言。

---

### Task 1: 迷雾状态、视野判定、localStorage 读写

**Files:**
- Modify: `maze-gen/maze.html`（`let playerPosition` 行之后插入 fog 区段）
- Create: `tests/maze-fog.test.mjs`

**Interfaces:**
- Produces（全部位于 fog 区段内，全局作用域）:
  - `const FOG_MIN = 1; const FOG_MAX = 25; const FOG_DEFAULT_RADIUS = 5;`
  - `let fogEnabled = true; let fogRadius = 5; let displayPosition = { row: 0, col: 0 };`
  - `const FOG_ENABLED_KEY = 'maze-fog-enabled'; const FOG_RADIUS_KEY = 'maze-fog-radius';`
  - `isInFogView(row, col, playerRow, playerCol, radius) -> boolean`
  - `loadFogSettings() -> void`：设置 `fogEnabled`、`fogRadius`。`FOG_ENABLED_KEY` 值为 `'false'` 时为 false，其他（含 null）为 true；`FOG_RADIUS_KEY` 用 `Number()` 转换，不是 `[FOG_MIN, FOG_MAX]` 内整数（含 null）则为 `FOG_DEFAULT_RADIUS`。任何异常 → 两项都取默认值。
  - `saveFogSettings() -> void`：写 `String(fogEnabled)`、`String(fogRadius)`；异常吞掉。
  - 测试辅助（在测试文件中）：`createEnv({ size, storage, storageThrows }) -> { run(code), cells, els, tick(), flush() }`，Task 2 复用。

- [ ] **Step 1: 写测试辅助与失败测试**

`tests/maze-fog.test.mjs` 头部的辅助代码（提取与假环境的写法由此确定）:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../maze-gen/maze.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let i = html.indexOf('{', start) + 1, depth = 1;
  for (; depth > 0; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') depth--; }
  return html.slice(start, i);
}

function fogSection() {
  const m = html.match(/\/\/ ==== fog BEGIN ====([\s\S]*?)\/\/ ==== fog END ====/);
  assert.ok(m, 'fog section markers not found');
  return m[1];
}

function fakeClassList() {
  const s = new Set();
  return {
    add: (n) => s.add(n), remove: (n) => s.delete(n), contains: (n) => s.has(n),
    toggle: (n, force) => { const on = force === undefined ? !s.has(n) : !!force; on ? s.add(n) : s.delete(n); return on; },
  };
}

function createEnv({ size = 10, storage = {}, storageThrows = false } = {}) {
  const cells = Array.from({ length: size * size }, () => ({ classList: fakeClassList() }));
  const els = Object.fromEntries(['fog-toggle', 'fog-minus', 'fog-plus', 'fog-radius-value']
    .map((id) => [id, { id, textContent: '', disabled: false }]));
  const queue = [];
  const ctx = {
    console,
    setTimeout: (fn) => { queue.push(fn); return queue.length; },
    document: {
      querySelectorAll: (sel) => sel === '.cell' ? cells
        : sel === '.player' ? cells.filter((c) => c.classList.contains('player')) : [],
      getElementById: (id) => els[id] || null,
    },
  };
  const store = { ...storage };
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  Object.defineProperty(ctx, 'localStorage', {
    get() { if (storageThrows) throw new Error('SecurityError'); return ls; },
  });
  vm.createContext(ctx);
  const src = `let currentSize = ${size}; let playerPosition = { row: 0, col: 0 }; let isMoving = false;\n`
    + fogSection() + '\n' + extractFunction('updatePlayerDisplay') + '\n' + extractFunction('animatePlayerMovement');
  vm.runInContext(src, ctx);
  return {
    cells, els, store,
    run: (code) => vm.runInContext(code, ctx),
    tick: () => { const fn = queue.shift(); if (fn) fn(); },
    flush: () => { let n = 0; while (queue.length && n++ < 1000) queue.shift()(); },
  };
}
```

测试（断言照抄）:

```js
test('fog constants and defaults', () => {
  assert.match(html, /const FOG_MIN = 1;/);
  assert.match(html, /const FOG_MAX = 25;/);
  assert.match(html, /let fogRadius = 5;/);
  assert.match(html, /let fogEnabled = true;/);
});

test('isInFogView uses Chebyshev distance', () => {
  const env = createEnv();
  const v = (r, c, pr, pc, n) => env.run(`isInFogView(${r}, ${c}, ${pr}, ${pc}, ${n})`);
  assert.equal(v(5, 10, 5, 5, 5), true);   // 距离恰为 N
  assert.equal(v(5, 11, 5, 5, 5), false);  // N+1
  assert.equal(v(10, 10, 5, 5, 5), true);  // 对角线 (5,5) 仍可见
  assert.equal(v(11, 10, 5, 5, 5), false);
  assert.equal(v(0, 0, 5, 5, 5), true);
  assert.equal(v(5, 5, 5, 5, 1), true);    // 自身
});

test('loadFogSettings reads stored values', () => {
  const env = createEnv({ storage: { 'maze-fog-enabled': 'false', 'maze-fog-radius': '7' } });
  env.run('loadFogSettings()');
  assert.equal(env.run('fogEnabled'), false);
  assert.equal(env.run('fogRadius'), 7);
});

test('loadFogSettings falls back to defaults on missing or invalid radius', () => {
  for (const bad of [undefined, '0', '26', '3.5', 'abc', '']) {
    const storage = bad === undefined ? {} : { 'maze-fog-radius': bad };
    const env = createEnv({ storage });
    env.run('loadFogSettings()');
    assert.equal(env.run('fogRadius'), 5, `radius ${bad}`);
    assert.equal(env.run('fogEnabled'), true);
  }
});

test('localStorage throwing gives defaults and save does not throw', () => {
  const env = createEnv({ storageThrows: true });
  env.run('fogEnabled = false; fogRadius = 9;');
  env.run('loadFogSettings()');
  assert.equal(env.run('fogEnabled'), true);
  assert.equal(env.run('fogRadius'), 5);
  assert.doesNotThrow(() => env.run('saveFogSettings()'));
});

test('saveFogSettings writes both keys', () => {
  const env = createEnv();
  env.run('fogEnabled = false; fogRadius = 3; saveFogSettings();');
  assert.equal(env.store['maze-fog-enabled'], 'false');
  assert.equal(env.store['maze-fog-radius'], '3');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/maze-fog.test.mjs`
Expected: FAIL，报 `fog section markers not found` 与常量正则不匹配。

- [ ] **Step 3: 在 `maze.html` 的 `let playerPosition = { row: 0, col: 0 };` 之后插入 fog 区段**

以 `        // ==== fog BEGIN ====` 开头、`        // ==== fog END ====` 结尾，内含 Interfaces 中列出的常量、状态、`isInFogView`、`loadFogSettings`、`saveFogSettings`。`loadFogSettings` 把 `localStorage` 的访问写在 try 内（`localStorage.getItem(...)` 而不是先存引用到 try 外）。区段内只引用区段内的名字、`currentSize`、`playerPosition`、`document`、`localStorage`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS（含原 `homepage.test.mjs`）。

- [ ] **Step 5: Commit**

```bash
git add maze-gen/maze.html tests/maze-fog.test.mjs
git commit -m "feat(maze): 迷雾状态、视野判定与本地存储"
```

---

### Task 2: 迷雾刷新、显示位置契约、调节与开关

**Files:**
- Modify: `maze-gen/maze.html`（fog 区段追加函数；`updatePlayerDisplay()` 约 1254 行）
- Test: `tests/maze-fog.test.mjs`

**Interfaces:**
- Consumes: Task 1 的全部常量、状态、`isInFogView`、`saveFogSettings`；测试辅助 `createEnv`。
- Produces（追加到 fog 区段内）:
  - `updateFog() -> void`：遍历 `document.querySelectorAll('.cell')`，index `i` → `row = Math.floor(i / currentSize)`、`col = i % currentSize`；`cell.classList.toggle('fog', fogEnabled && !isInFogView(row, col, displayPosition.row, displayPosition.col, fogRadius))`。不读 `playerPosition`，不碰 `solution` 类。
  - `updateFogControls() -> void`：`#fog-toggle.textContent` = `'迷雾：开'` 或 `'迷雾：关'`；`#fog-radius-value.textContent` = `` `视野 ${fogRadius}` ``；`#fog-minus.disabled = fogRadius <= FOG_MIN`；`#fog-plus.disabled = fogRadius >= FOG_MAX`。某个元素为 null 时跳过该元素。
  - `changeFogRadius(delta) -> void`：`fogRadius = Math.min(FOG_MAX, Math.max(FOG_MIN, fogRadius + delta))`，然后 `saveFogSettings(); updateFogControls(); updateFog();`
  - `toggleFog() -> void`：`fogEnabled = !fogEnabled`，然后 `saveFogSettings(); updateFogControls(); updateFog();`
  - `updatePlayerDisplay()` 新契约：给格子加 `player` 类的同时执行 `displayPosition = { row: playerPosition.row, col: playerPosition.col }`，函数末尾调用 `updateFog()`。

- [ ] **Step 1: 写失败测试**

辅助断言（加在测试文件里）:

```js
const fogged = (env, r, c, size = 10) => env.cells[r * size + c].classList.contains('fog');
function startMove(env, to) {
  env.run(`animatePlayerMovement(playerPosition, ${JSON.stringify(to)}, () => { playerPosition = ${JSON.stringify(to)}; updatePlayerDisplay(); })`);
}
```

测试:

```js
test('fog centers on displayed position when radius changes mid-animation', () => {
  const env = createEnv();
  env.run('updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });   // 第 1 步同步画在 (0,1)
  env.tick(); env.tick();               // 画在 (0,3)
  env.run('changeFogRadius(-10)');      // 夹到 1
  assert.equal(env.run('fogRadius'), 1);
  assert.equal(fogged(env, 0, 3), false);
  assert.ok(env.cells[3].classList.contains('player'));
  assert.equal(fogged(env, 0, 4), false);
  assert.equal(fogged(env, 0, 0), true);
  assert.equal(fogged(env, 0, 5), true);
});

test('toggling fog twice mid-animation keeps center on displayed position', () => {
  const env = createEnv();
  env.run('fogRadius = 1; updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });
  env.tick(); env.tick();
  env.run('toggleFog(); toggleFog();');
  assert.equal(env.run('fogEnabled'), true);
  assert.equal(fogged(env, 0, 3), false);
  assert.equal(fogged(env, 0, 0), true);
});

test('after animation fog centers on destination', () => {
  const env = createEnv();
  env.run('fogRadius = 1; updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });
  env.flush();
  assert.deepEqual(JSON.parse(env.run('JSON.stringify(displayPosition)')), { row: 0, col: 6 });
  assert.equal(fogged(env, 0, 6), false);
  assert.equal(fogged(env, 1, 7), false);
  assert.equal(fogged(env, 0, 4), true);
});

test('fog disabled leaves every cell clear, and radius changes still apply later', () => {
  const env = createEnv();
  env.run('updatePlayerDisplay(); toggleFog(); changeFogRadius(-3);');
  assert.equal(env.cells.some((c) => c.classList.contains('fog')), false);
  assert.equal(env.run('fogRadius'), 2);
  env.run('toggleFog()');
  assert.equal(fogged(env, 2, 2), false);
  assert.equal(fogged(env, 3, 0), true);
});

test('radius larger than maze shows everything', () => {
  const env = createEnv();
  env.run('fogRadius = 25; updatePlayerDisplay()');
  assert.equal(env.cells.some((c) => c.classList.contains('fog')), false);
});

test('radius clamps to [1, 25] and buttons disable at bounds', () => {
  const env = createEnv();
  env.run('changeFogRadius(-1); changeFogRadius(-1); changeFogRadius(-1); changeFogRadius(-1); changeFogRadius(-1);');
  assert.equal(env.run('fogRadius'), 1);
  assert.equal(env.els['fog-minus'].disabled, true);
  assert.equal(env.els['fog-plus'].disabled, false);
  assert.equal(env.els['fog-radius-value'].textContent, '视野 1');
  env.run('changeFogRadius(100)');
  assert.equal(env.run('fogRadius'), 25);
  assert.equal(env.els['fog-plus'].disabled, true);
  assert.equal(env.els['fog-minus'].disabled, false);
  assert.equal(env.store['maze-fog-radius'], '25');
});

test('toggle updates label and storage', () => {
  const env = createEnv();
  env.run('toggleFog()');
  assert.equal(env.els['fog-toggle'].textContent, '迷雾：关');
  assert.equal(env.store['maze-fog-enabled'], 'false');
  env.run('toggleFog()');
  assert.equal(env.els['fog-toggle'].textContent, '迷雾：开');
});

test('regenerating resets fog center to entrance', () => {
  const env = createEnv();
  env.run('fogRadius = 1; updatePlayerDisplay()');
  startMove(env, { row: 0, col: 6 });
  env.flush();
  env.run('playerPosition = { row: 0, col: 0 }; updatePlayerDisplay();'); // 同 generateMaze 的调用顺序
  assert.equal(fogged(env, 0, 0), false);
  assert.equal(fogged(env, 0, 6), true);
});

test('fog controls work when storage throws', () => {
  const env = createEnv({ storageThrows: true });
  assert.doesNotThrow(() => env.run('changeFogRadius(1); toggleFog();'));
  assert.equal(env.run('fogRadius'), 6);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/maze-fog.test.mjs`
Expected: FAIL，报 `changeFogRadius is not defined` / `toggleFog is not defined` / `displayPosition` 未更新。

- [ ] **Step 3: 在 fog 区段追加 `updateFog`、`updateFogControls`、`changeFogRadius`、`toggleFog`，并按 Interfaces 修改 `updatePlayerDisplay()`**

`animatePlayerMovement` 不改：它在每一帧调用 `updatePlayerDisplay()` 时已临时设好 `playerPosition`，`displayPosition` 由此跟随。全量遍历 + `classList.toggle(name, force)`，不做缓存或差量（见 Task 3 性能验收）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add maze-gen/maze.html tests/maze-fog.test.mjs
git commit -m "feat(maze): 迷雾随小人显示位置刷新，支持调节视野与开关"
```

---

### Task 3: 迷雾界面、样式、初始化与浏览器验收

**Files:**
- Modify: `maze-gen/maze.html`（`<style>`、`.size-controls` 与 `#maze` 之间、底部提示 `<p>`、`DOMContentLoaded` 回调）
- Test: `tests/maze-fog.test.mjs`

**Interfaces:**
- Consumes: Task 1 `loadFogSettings()`；Task 2 `updateFogControls()`、`changeFogRadius(delta)`、`toggleFog()`；元素 id `fog-toggle`、`fog-minus`、`fog-plus`、`fog-radius-value`（Task 2 已按这些 id 读写）。
- Produces: 页面上的 `.fog-controls` 行与迷雾 CSS。

- [ ] **Step 1: 写失败测试**

```js
test('fog controls markup sits between size controls and maze', () => {
  const sizeIdx = html.indexOf('class="size-controls"');
  const fogIdx = html.indexOf('class="fog-controls"');
  const mazeIdx = html.indexOf('id="maze"');
  assert.ok(sizeIdx >= 0 && fogIdx > sizeIdx && mazeIdx > fogIdx);
  assert.match(html, /<button[^>]*id="fog-toggle"[^>]*onclick="toggleFog\(\)"[^>]*>迷雾：开<\/button>/);
  assert.match(html, /<button[^>]*id="fog-minus"[^>]*onclick="changeFogRadius\(-1\)"[^>]*>−<\/button>/);
  assert.match(html, /<button[^>]*id="fog-plus"[^>]*onclick="changeFogRadius\(1\)"[^>]*>\+<\/button>/);
  assert.match(html, /id="fog-radius-value"[^>]*>视野 5</);
});

test('fog CSS rules', () => {
  assert.match(html, /\.fog\s*\{[^}]*background-color:\s*#444\s*!important/);
  assert.match(html, /\.cell\.fog\s*>\s*\*\s*\{[^}]*visibility:\s*hidden/);
  assert.match(html, /\.cell\.fog\.solution\s*\{[^}]*background-color:\s*#ff0000\s*!important/);
  assert.match(html, /\.fog-controls\s*\{[^}]*display:\s*flex[^}]*\}/);
  assert.match(html, /\.fog-controls\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(html, /\.fog-step\s*\{[^}]*min-width:\s*44px/);
  assert.match(html, /\.fog-step\s*\{[^}]*height:\s*44px/);
});

test('init loads fog settings before generating maze', () => {
  const m = html.match(/addEventListener\('DOMContentLoaded',\s*function\(\)\s*\{([\s\S]*?)\}\);/);
  assert.ok(m);
  const body = m[1];
  const load = body.indexOf('loadFogSettings()');
  const ctrl = body.indexOf('updateFogControls()');
  const gen = body.indexOf('generateMaze()');
  assert.ok(load >= 0 && ctrl > load && gen > ctrl);
});

test('hint mentions fog', () => {
  assert.match(html, /<p>开启迷雾后只能看到小人周围的格子，可用 − \/ \+ 调节视野<\/p>/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/maze-fog.test.mjs`
Expected: 新增 4 个测试 FAIL，Task 1–2 测试仍 PASS。

- [ ] **Step 3: 实现界面与样式**

- 标记：`<div class="fog-controls">` 内依次为 `#fog-toggle`（class `fog-toggle`）、`#fog-minus`（class `fog-step`，`aria-label="缩小视野"`）、`<span id="fog-radius-value" class="fog-radius">视野 5</span>`、`#fog-plus`（class `fog-step`，`aria-label="扩大视野"`）。按钮属性顺序写成 `id` → `class` → `onclick` → `aria-label`（测试正则要求 `id` 在 `onclick` 之前）。
- 迷雾 CSS 写在 `.solution` 规则之后、任何 `@media` 之外：`.fog`、`.cell.fog > *`、`.cell.fog.solution`，值见 Global Constraints。
- `.fog-controls`：`display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; width: 100%;`，上下间距与 `.size-controls` 一致。
- `.fog-step`：`flex: 0 0 44px; width: 44px; min-width: 44px; height: 44px; padding: 0;`（类选择器优先级高于媒体查询里的 `button` 规则，所以 `min-width: 120/100/80px` 不会作用到它）。`.fog-step:disabled`：灰底（`#9e9e9e`）、`cursor: not-allowed`。
- `.fog-toggle`：`flex: 0 1 auto;`。`.fog-radius`：固定宽度（如 `min-width: 4em; text-align: center;`），数值从 1 位变 2 位时按钮不跳动。
- 底部提示 `<div>` 内追加 Step 1 断言中的 `<p>`。
- `DOMContentLoaded` 回调：在 `updateMazeGridCSS(currentSize);` 之后、`generateMaze();` 之前加 `loadFogSettings(); updateFogControls();`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: 浏览器验收**

在 worktree 根目录运行 `python3 -m http.server 8765`，打开 `http://localhost:8765/maze-gen/maze.html`，逐项检查：

1. 方向键与滑动移动：视野逐格跟随小人，无闪烁，不滞后一格。
2. 多格移动动画进行中点「−」「+」和迷雾开关：视野不跳回起点，小人不被盖住。
3. N=1 时「−」禁用，N=25 时「+」禁用；关闭迷雾后迷宫完全可见；刷新后开关与 N 保持。
4. 重新生成迷宫、切换迷宫尺寸后：迷雾以 (0,0) 为中心。
5. 点「显示道路」：红色路径穿透迷雾；点「隐藏道路」：这些格子恢复为迷雾。
6. 迷雾格子上看不到墙线。
7. DevTools 设备模拟宽 375px 竖屏：迷雾按钮行不挤乱布局，`document.documentElement.scrollWidth <= window.innerWidth` 为 true。
8. 性能：50×50 迷宫，在控制台临时包装 `const _u = updateFog; updateFog = function () { const t = performance.now(); _u(); console.log('updateFog', (performance.now() - t).toFixed(2)); };`，走一段多格移动，记录单次最大耗时（桌面浏览器、手机浏览器或手机模拟各一次）。注意：`updatePlayerDisplay` 内按名字调用 `updateFog`，全局函数声明可被这样替换。
   - 如果单次 ≤ 16ms：保留全量遍历。
   - 如果 > 16ms：把 `.cell` 列表缓存（`renderMaze` 后刷新缓存）再测；仍 > 16ms 则改为只更新新旧视野并集的差量更新。每次改动后重新运行 `node --test tests/` 并全部 PASS。

把第 8 项测得的数值写进实现报告（交给编排器），不要另建文件。

- [ ] **Step 6: Commit**

```bash
git add maze-gen/maze.html tests/maze-fog.test.mjs
git commit -m "feat(maze): 迷雾按钮行、样式与初始化"
```
