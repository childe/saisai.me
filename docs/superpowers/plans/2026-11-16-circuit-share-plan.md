# 电路分享链接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自由搭建模式加「🔗 分享」按钮，把当前电路编码进 `#c=...` 链接并复制；打开链接时载入该电路，可接着编辑。

**Architecture:** 新增纯函数模块 `circuit/lib/share.js` 负责电路 ⇄ 紧凑 JSON ⇄ 压缩字符串，以及校验。`editor.js` 加一个 `loadShared` action 把电路放进自由搭建空间。`app.js` 负责按钮、剪贴板、启动时读 hash；`view.js` 只管按钮显隐。

**Tech Stack:** 原生 ES modules，浏览器自带 `CompressionStream` / `DecompressionStream`（`deflate-raw`），`node:test`（Node 26 同样自带这两个 API）。

**Spec:** `docs/superpowers/specs/2026-11-16-circuit-share-design.md`

**路径约定：** 测试命令从 worktree 根目录执行：`node --test circuit/test`。

## Global Constraints

- 链接格式：`<当前页面地址去掉 hash>#c=<数据>`。源码里不得出现 `http://` / `https://` 字面量（`static.test.js` 会查），地址一律从 `location` 取。
- 不用 `localStorage` / `indexedDB`（`static.test.js` 会查）。
- 点「分享」不改地址栏；编辑电路不改地址栏。
- 链接里不带：`rev`、`topoRev`、撤销历史、损坏状态。
- 提示文案（逐字）：`链接已复制，发给朋友吧`、`先搭一个电路再分享`、`链接里的电路打不开`。
- 分享按钮只在自由搭建模式显示。

## Review Focus

1. 被改坏、截断、手工拼出来的 `#c=` 数据：`decodeCircuit` 必须返回 `null`，不能抛异常，也不能载入一个让求解器崩溃的电路（Task 1 的坏数据测试）。
2. 分享时有按钮正被按住（`pressed: true`）：链接里的按钮应是松开的（Task 1 `pack releases pressed buttons`）。
3. 打开链接后接着搭新元件：新元件 id 不能和载入的元件重复（Task 1 校验 id 序号 < `nextId`；Task 2 `loadShared then place gets a fresh id`）。
4. 打开链接后点撤销：不能撤回到空画板之前的状态（Task 2 断言 `history` 为空）。
5. 在小任务模式下打开链接 / 载入：应切到自由搭建，小任务进度不受影响（Task 2 断言 `state.task` 原样保留）。

---

### Task 1: `share.js` 编解码与校验

**Files:**
- Create: `circuit/lib/share.js`
- Test: `circuit/test/share.test.js`

**Interfaces:**
- Consumes: `PARTS`, `defaultParams`, `isValidParam` from `./parts.js`；`BOARD` from `./geometry.js`。
- Produces:
  - `packCircuit(c) -> object`：紧凑格式 `{ v: 1, n: nextId, p: [[id, type, x, y, rot, params], ...], w: [[id, aPart, aTerm, bPart, bTerm, via?, r?], ...] }`。via、r 没有时省略（数组截短）。按钮一律写成 `pressed: false`。
  - `unpackCircuit(obj) -> circuit | null`：返回 `{ rev: 0, topoRev: 0, nextId, parts, wires }`，任何不合法都返回 `null`，不抛异常。
  - `encodeCircuit(c) -> Promise<string>`：`JSON.stringify(packCircuit(c))` → `deflate-raw` → base64url（无 `=` 填充）。
  - `decodeCircuit(s) -> Promise<circuit | null>`：反过来，任何一步失败返回 `null`。
  - `shareUrl(href, code) -> string`：去掉 href 里的 `#...`，拼上 `#c=<code>`。
  - `codeFromHash(hash) -> string | null`：`'#c=abc'` → `'abc'`；其它（空、`#x=1`、`#c=`）→ `null`。

`unpackCircuit` 的校验规则（全部满足才返回电路）：
- `v === 1`；`n` 是正整数；`p`、`w` 是数组。
- 元件：id 匹配 `/^p\d+$/` 且序号 < `n`、不重复；`type` 在 `PARTS` 里；x、y 是 `[0, BOARD.w]`、`[0, BOARD.h]` 内的整数；`rot` ∈ {0,1,2,3}；`params` 是普通对象，每个 key 都通过 `isValidParam`，缺的 key 用 `defaultParams` 补。
- 导线：id 匹配 `/^w\d+$/` 且序号 < `n`、不和其它导线重复；两端的元件存在且端点名在该元件 `PARTS[type].terms` 里；两端不是同一端点；via 若有，是 `[x, y]` 整数点数组，坐标范围同元件；r 若有，是正的有限数。

- [ ] **Step 1: 写失败测试 `circuit/test/share.test.js`**

用 `../test/helpers.js` 的 `build` / `loop` 造电路。测试：
- `round trip keeps parts and wires`：一个带 via、带 `r`、带 node、带各种 params 的电路，`await decodeCircuit(await encodeCircuit(c))` 的 `parts`、`wires`、`nextId` 与原电路 `deepEqual`（rev、topoRev 为 0）。
- `pack releases pressed buttons`：按钮 `pressed: true` 编解码后为 `false`。
- `encoded string is url safe`：结果匹配 `/^[A-Za-z0-9_-]+$/`。
- `decode rejects garbage without throwing`：以下每个都 `await` 得到 `null`：`''`、`'!!!'`、`'abc'`（解压失败）、合法压缩但不是 JSON、`v: 2`、未知元件类型、`rot: 4`、`x: 1.5`、`x: 999`、非法参数值 `{cells: 9}`、未知参数 key、重复元件 id、元件 id 序号 ≥ n、导线连到不存在的元件、导线端点名不存在、导线两端相同、via 含非整数、`r: -1`。（坏 JSON 用一个测试内的小帮手直接压缩任意对象：`deflate-raw` + base64url。）
- `shareUrl replaces existing hash`：`shareUrl('https://saisai.me/circuit/#c=old', 'NEW')` === `'https://saisai.me/circuit/#c=NEW'`；无 hash 的 href 同理。
- `codeFromHash`：`'#c=abc'` → `'abc'`；`''`、`'#'`、`'#c='`、`'#x=1'` → `null`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test circuit/test/share.test.js`
Expected: FAIL，`Cannot find module .../lib/share.js`

- [ ] **Step 3: 实现 `circuit/lib/share.js`**

文件头一行中文注释说明用途（照其它 lib 文件的写法）。base64url 用 `btoa` / `atob` 加字符替换实现（浏览器和 Node 都有）。压缩用 `new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()` 这种写法，解压同理；整个 `decodeCircuit` 包在 try/catch 里。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/share.js circuit/test/share.test.js
git commit -m "feat(circuit): 电路与分享链接数据互转"
```

### Task 2: `loadShared` action

**Files:**
- Modify: `circuit/lib/editor.js`（`reduce` 的 switch 里加一个 case）
- Test: `circuit/test/editor.test.js`

**Interfaces:**
- Consumes: Task 1 `unpackCircuit` 返回的电路形状。
- Produces: action `{ type: 'loadShared', circuit }`：`mode` 变成 `'free'`，`free` 换成新空间（撤销栈为空、损坏和继电器全新），`selection: null`，`confirmClear: false`；`state.task` 不动。新电路的 `rev`、`topoRev` 设为旧 free 电路的值 + 1（和 `confirmClear` 一样，保证视图缓存失效）。`circuit` 不是对象时返回原 state。

- [ ] **Step 1: 写失败测试**（追加到 `circuit/test/editor.test.js`）
- `loadShared replaces free space and clears history`：先在 free 放一个元件，再 `loadShared` 一个 `build({...})` 电路；断言 `mode === 'free'`、parts 与载入电路一致、`activeSpace(s).history.length === 0`、`rev` 大于载入前、`selection === null`。
- `loadShared from task mode keeps task progress`：先 `setMode: 'task'`，记下 `s.task`；`loadShared` 后 `mode === 'free'` 且 `s.task` 与之前 `===`。
- `loadShared then place gets a fresh id`：载入 `nextId: 10` 的电路后 `place`，新元件 id 为 `p10`，不与已有 id 重复。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test circuit/test/editor.test.js`
Expected: 3 个新测试 FAIL

- [ ] **Step 3: 在 `reduce` 里实现 `loadShared`**（用文件里已有的 `makeSpace`）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/editor.js circuit/test/editor.test.js
git commit -m "feat(circuit): 载入分享电路的 action"
```

### Task 3: 分享按钮、提示与打开链接

**Files:**
- Modify: `circuit/index.html`、`circuit/styles.css`、`circuit/view.js`（`renderToolbar`）、`circuit/app.js`
- Test: `circuit/test/static.test.js`

**Interfaces:**
- Consumes: Task 1 `encodeCircuit`、`decodeCircuit`、`shareUrl`、`codeFromHash`；Task 2 `loadShared`。

页面元素（设计方决定）：
- 顶栏 `#muteBtn` 前加 `<button class="btn" id="shareBtn">🔗 分享</button>`。
- 画板容器里（和 `#banner` 同级）加 `<div id="toast" hidden></div>`：样式照 `#banner`，位置在画板底部居中，2.5 秒后自动隐藏。`#banner` 由 `render` 按求解结果控制，不能拿来显示分享提示。
- 同级加 `#shareBox`：结构和样式照 `#confirm`（遮罩 + `.confirm-box`），内容是一行说明「复制下面的链接发给朋友」、一个 `readonly` 的 `<input>`、一个「关闭」按钮。

- [ ] **Step 1: 写失败测试**：`static.test.js` 的 `index.html wiring` 里，id 列表加上 `'shareBtn', 'toast', 'shareBox'`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test circuit/test/static.test.js`
Expected: FAIL，提示缺 `shareBtn`

- [ ] **Step 3: 加 HTML 与 CSS**（见上方元素说明）

- [ ] **Step 4: `view.js`**：`renderToolbar` 里 `if (dom.shareBtn) dom.shareBtn.hidden = state.mode === 'task';`

- [ ] **Step 5: `app.js` 接线**
- `dom` 里加 `shareBtn`、`toast`、`shareBox`。
- `showToast(text)`：显示 `#toast`，2.5 秒后隐藏；连续调用时重置计时。
- 点 `#shareBtn`：自由搭建电路没有元件 → `showToast('先搭一个电路再分享')`；否则 `shareUrl(location.href, await encodeCircuit(circuit))`，`navigator.clipboard.writeText` 成功 → `showToast('链接已复制，发给朋友吧')`；失败或 `navigator.clipboard` 不存在 → 打开 `#shareBox`，把链接填进 input 并 `select()`。不改 `location`。
- `#shareBox` 的「关闭」按钮隐藏它。
- 文件末尾 `render(dom, state)` 之后：`codeFromHash(location.hash)` 有值就 `decodeCircuit`；得到电路 → `dispatch({ type: 'loadShared', circuit })` 然后 `fitContent()`（模式本来就是 free 时 `spaceKey` 不变，`dispatch` 不会自动缩放）；得到 `null` → `showToast('链接里的电路打不开')`。

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 7: 浏览器验证**

在 worktree 根目录起静态服务（`python3 -m http.server 8765`），打开 `http://localhost:8765/circuit/`，逐项确认：
1. 小任务模式看不到「🔗 分享」；自由搭建模式能看到。
2. 空画板点分享，底部提示「先搭一个电路再分享」。
3. 搭一个电池 + 灯 + 开关的回路，拐一根导线，点分享，提示「链接已复制，发给朋友吧」，地址栏不变。
4. 新标签页打开剪贴板里的链接：电路一样，视野自动框住电路，撤销按钮是灰的；接着加元件、连线正常。
5. 把链接的 `#c=` 后面删掉几个字符再打开：提示「链接里的电路打不开」，画板为空。

- [ ] **Step 8: Commit**

```bash
git add circuit/index.html circuit/styles.css circuit/view.js circuit/app.js circuit/test/static.test.js
git commit -m "feat(circuit): 分享按钮与打开分享链接"
```
