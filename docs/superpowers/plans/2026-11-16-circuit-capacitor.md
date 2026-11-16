# 电容元件和第 8 章第一关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给电路实验室加上会随时间充放电的电容元件，并加第 8 章第 1 关「会存电的电容」。

**Architecture:** 电容在求解器里用后向欧拉等效（电导 C/h 并联电流源 C/h·v₀）。电容电压存在工作区的 `caps` 状态里，和 `relays` 并列；`settle` 用极小步长求"这一瞬间"，不改 `caps`；`tick` 用 `h = dt` 推进一步并写回。没有电池但有带电电容的分量也要解。

**Tech Stack:** 原生 ES modules，测试用 `node --test`（在 `circuit/` 目录下跑 `node --test test/`），无构建步骤。

**Spec:** `docs/superpowers/specs/2026-11-16-circuit-capacitor-design.md`

## Global Constraints

- 元件类型名 `capacitor`，显示名「电容」，端点 `a`、`b`，参数 `farads` 选项 `[0.1, 0.5, 1]`，默认 `0.5`。
- 新常数放进 `PHYS`：`CAP_H: 1e-3`（settle 步长）、`CAP_REST_A: 1e-6`（静止判据，电流）、`CAP_FULL_V: 3`（竖条满格电压）。
- 电容不会损坏、没有故障类型；冲击电流照现有损坏规则处理，不为电容开例外。
- 没有电容的电路行为不变：现有 292 个测试全部照旧通过。
- 第 8 章：`CHAPTERS` 加 `{ n: 8, name: '电容与定时' }`；关卡 id 38，名字「会存电的电容」，题目「断开开关以后，让灯再亮一会儿」，元件栏 `{ battery: 1, switch: 1, lamp: 1, capacitor: 1 }`。
- 第 38 关提示原文：「现在是电池在点灯。断开开关看看，灯还亮吗？」
- 代码注释用中文，风格和周围代码一致（短注释、一行讲一件事）。
- commit 作者必须是 `childe <rmself@qq.com>`（GitHub 仓库，不能用公司身份）。commit message 结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

- 移动、旋转已充电的电容：电压保留（编辑走 settle，settle 带着 `caps`）。→ Task 2 测试 `moving a charged capacitor keeps its voltage`。
- 充电后把电容所有导线拆掉：电容孤立，电压保持不变，tick 判为静止。→ Task 2 测试 `isolated charged capacitor keeps voltage and rests`。
- 没有电池、只有带电电容和电压表的电路：电压表读出电容电压。→ Task 1 测试 `voltmeter reads a charged capacitor without battery`。
- 以后红绿灯要用的继电器闪光器（电池 → 常闭触点 → 电阻 → 电容∥线圈）：会反复吸合释放，不会算不出、不会卡住。→ Task 2 测试 `relay flasher with capacitor keeps flipping`。
- 「重来」和换关后电容从 0 开始。→ Task 2 测试 `clear resets capacitor charge`。

---

### Task 1: 电容元件和求解器

**Files:**
- Modify: `circuit/lib/parts.js`（`PHYS`、`PART_TYPES`、`PARTS`）
- Modify: `circuit/lib/solve.js`（`solveComponent`、`solveWithLeds`、`readPart`、`solve`）
- Test: `circuit/test/solve-cap.test.js`（新建）

**Interfaces:**
- Produces:
  - `PARTS.capacitor = { label: '电容', terms: ['a','b'], termPos 同 two('a','b'), params: { farads: { default: 0.5, options: [0.1, 0.5, 1] } }, lever: false }`；`PART_TYPES` 末尾追加 `'capacitor'`。
  - `solve(circuit, broken, opts)` 新增 `opts.caps`（`{ 电容id: 电压 }`，缺省 `{}`）和 `opts.h`（秒，缺省 `PHYS.CAP_H`）。
  - `result.parts[电容id] = { v: Va−Vb, i: (C/h)·(v − v₀) 即从 a 流进电容的电流, p: v·i }`。

- [ ] **Step 1: 写失败的测试** `circuit/test/solve-cap.test.js`，用 `build` / `loop`（`test/helpers.js`）搭电路：
  - `capacitor part is registered`：`PART_TYPES.includes('capacitor')`，`defaultParams('capacitor')` 深等于 `{ farads: 0.5 }`。
  - `uncharged capacitor acts like a short at the first instant`：电池(1 节) → 电阻 10Ω → 电容 1F → 电池，`solve(c, new Set(), { caps: {}, h: 1e-3 })`：`parts.C.v` 小于 0.01，`parts.R.i` 约等于 0.148（1.5/10.1，误差 0.01 内）。
  - `charged capacitor sources current into a lamp without battery`：只有灯 L 和电容 C 接成回路，`caps: { C: 1.5 }, h: 1e-3`：`result.ok` 为 true，`Math.abs(parts.L.i)` 约 0.15（误差 0.01 内），`parts.C.v` 约 1.5。
  - `voltmeter reads a charged capacitor without battery`：电压表 V 并在电容 C 两端，`caps: { C: 1.2 }`：`Math.abs(parts.V.v)` 约 1.2（误差 0.01）。
  - `backward Euler step matches RC charging`：电池 1 节 + 电阻 10Ω + 电容 1F 串联，从 `caps: {}` 起用 `h = 0.05` 连续解 40 步（每步把 `parts.C.v` 作为下一步 `caps.C`），共 2 秒；期望 `v ≈ 1.5·(1 − e^(−2/10.1))`，误差 2% 内。
  - `circuit without capacitor is unchanged`：电池 + 灯的结果在传不传 `opts.caps/h` 时完全相同（`deepEqual`）。

- [ ] **Step 2: 跑测试确认失败**
  Run: `cd circuit && node --test test/solve-cap.test.js`
  Expected: FAIL（`capacitor` 未注册）

- [ ] **Step 3: 实现**
  - `parts.js`：加 `PHYS.CAP_H / CAP_REST_A / CAP_FULL_V`、`PART_TYPES` 追加 `'capacitor'`、`PARTS.capacitor`。
  - `solve.js`：`solveComponent` / `solveWithLeds` 多接一个 `cap = { caps, h }` 参数。每个不在 `broken` 里的电容：`stampG(a, b, C/h)`，再 `stampI(b, a, C/h · v₀)`（v₀ = `caps[id] ?? 0`）。`readPart` 加 `case 'capacitor'`。
  - `solve()` 里分量是否求解：有没坏的电池，**或**有 |v₀| > 1e-9 的电容就解；参考点优先电池 `n`，否则第一个这样的电容的 `b`。其余照旧记 0 V。

- [ ] **Step 4: 跑测试确认通过，且全套不回退**
  Run: `cd circuit && node --test test/`
  Expected: 全部 PASS（原 292 个 + 新增）

- [ ] **Step 5: Commit**
  ```bash
  git add circuit/lib/parts.js circuit/lib/solve.js circuit/test/solve-cap.test.js
  git commit -m "feat(circuit): 电容元件和求解器里的电容等效"
  ```

---

### Task 2: 电容状态和时间推进

**Files:**
- Create: `circuit/lib/caps.js`
- Modify: `circuit/lib/engine.js`（`settle`、`tick`）
- Modify: `circuit/lib/editor.js:73,122,199,212`（把 `space.caps` 传给 `settle`）
- Test: `circuit/test/engine-cap.test.js`（新建）

**Interfaces:**
- Consumes: Task 1 的 `solve(..., { on, caps, h })` 和 `result.parts[电容id].{v,i}`。
- Produces:
  - `caps.js`：`createCaps() → { v: {} }`；`pruneCaps(caps, circuit) → caps`（只删已不存在的电容，没变返回同一对象）；`capsAtRest(circuit, result) → boolean`（每个电容 `|result.parts[id].i| < PHYS.CAP_REST_A`；没有电容为 true）；`stepCaps(caps, circuit, result) → caps`（把每个电容的 `result.parts[id].v` 写进新的 `v`）。
  - `settle(circuit, damage, relays = createRelays(), caps = createCaps())` 返回值多一个 `caps` 字段（已 prune）。求解时传 `{ on, caps: caps.v, h: PHYS.CAP_H }`；不改 caps。
  - `tick(ws, dt)`：现有损坏、继电器逻辑之后（含其中可能的 settle），若 `!capsAtRest(circuit, result)`：用 `{ on, caps: caps.v, h: dt }` 解一次；解得 ok 就返回 `{ ...ws2, caps: stepCaps(...), result: 新解, trail: [] }`。静止且损坏、继电器都没变时返回原 `ws`（同一对象）。`ws.caps` 缺省按 `createCaps()` 处理。

- [ ] **Step 1: 写失败的测试** `circuit/test/engine-cap.test.js`：
  - `capacitor charges to about 63% after one RC`：电池 1 节 + 电阻 10Ω + 电容 1F，`settle` 后 `tick(ws, 0.05)` 200 次（10 秒 ≈ 1 个 RC = 10.1 秒，R 含电池内阻 0.1Ω）：`ws.caps.v.C / 1.5` 在 0.60–0.66 之间。
  - `slow charge still advances at 120 Hz`：电阻 1000Ω + 电容 1F，`tick(ws, 1/120)` 120 次后 `ws.caps.v.C > 0.001`。
  - `tick returns the same object once at rest`：电阻 10Ω + 电容 0.1F，tick 到 `capsAtRest` 为真（最多 400 次 0.05），之后 `tick(ws, 0.05) === ws`。
  - `lamp keeps glowing after the switch opens`：电池 → 开关 S(合) → 灯 L → 电池，电容 C(1F) 并在灯两端；充电 40 次 tick(0.05)；`settle(setParam(c, 'S', 'closed', false), ws.damage, ws.relays, ws.caps)` 后 `parts.L.p >= PHYS.LAMP_LIT_P`；再 tick 4 秒仍亮；再 tick 10 秒不亮。
  - `moving a charged capacitor keeps its voltage`：充电后 `movePart` 电容再 `settle(..., ws.caps)`，`caps.v.C` 不变。
  - `isolated charged capacitor keeps voltage and rests`：充电后 `removeWire` 拆掉电容两根导线再 settle，`caps.v.C` 不变，且 `tick(ws, 0.05) === ws`。
  - `removing the capacitor prunes its charge`：`removePart` 后 settle，`'C' in ws.caps.v` 为 false。
  - `inrush blows a fuse in series with a capacitor`：电池 → 保险丝(0.5A) → 电容 → 电池，settle 后 `ws.damage.broken` 含保险丝。
  - `inrush burns an LED in series with a capacitor`：电池 2 节 → LED → 电容 → 电池，settle 后 `ws.damage.broken` 含 LED。
  - `relay flasher with capacitor keeps flipping`：电池 2 节，`B.p → K.com`，`K.nc → R(47Ω).a`，`R.b → C.a`、`R.b → K.x`，`C.b`、`K.y` → `B.n`，电容 0.1F；tick(0.02) 共 10 秒：`ws.relays.flips >= 4`，每步 `ws.result.ok` 为 true。
  - `clear resets capacitor charge`（走 editor）：`createEditor()` 自由模式放电池、电阻、电容并连线（用 `reduce` 的现有动作，参照 `test/editor.test.js` 的写法），tick 充电后执行清空（`clear` 两次确认，参照现有清空测试），`activeSpace` 的 `caps.v` 为空对象。

- [ ] **Step 2: 跑测试确认失败**
  Run: `cd circuit && node --test test/engine-cap.test.js`
  Expected: FAIL（`caps.js` 不存在）

- [ ] **Step 3: 实现** `caps.js`（仿照 `relay.js` 的 `pick` / 同对象返回写法）、`engine.js` 的 `settle` / `tick`、`editor.js` 四处 `settle(..., space.relays)` 改为 `settle(..., space.relays, space.caps)`。重置类调用（`makeSpace`、`restartTask`、清空）不传 caps，靠默认值归零。

- [ ] **Step 4: 跑全套测试**
  Run: `cd circuit && node --test test/`
  Expected: 全部 PASS

- [ ] **Step 5: Commit**
  ```bash
  git add circuit/lib/caps.js circuit/lib/engine.js circuit/lib/editor.js circuit/test/engine-cap.test.js
  git commit -m "feat(circuit): 电容随时间充放电"
  ```

---

### Task 3: 电容的画法和属性面板

**Files:**
- Modify: `circuit/lib/drawings.js`（加 `capacitor(part, style, vis)`）
- Modify: `circuit/lib/viewmodel.js`（`partVisual` 加 `vis.charge`）
- Modify: `circuit/view.js:18-23`（`PARAM_UI` 加 `farads`）
- Test: `circuit/test/viewmodel.test.js`、`circuit/test/drawings.test.js`（追加）

**Interfaces:**
- Consumes: `result.parts[电容id].v`、`PHYS.CAP_FULL_V`。
- Produces: `partVisual` 返回的 `vis.charge`（0–1，= `clamp(|v| / CAP_FULL_V, 0, 1)`；`!ok` 或无读数时为 0；其他元件也带 `charge: 0`）。`blankVisual()`（view.js）补 `charge: 0`。

- [ ] **Step 1: 写失败的测试**
  - viewmodel：`capacitor charge follows voltage`：`partVisual({ id:'C', type:'capacitor', params:{farads:0.5} }, { v: 1.5, i: 0, p: 0 }, null, true).charge` 等于 0.5；`v: -6` 时为 1；`ok = false` 时为 0。
  - drawings：`capacitor shows farads label and charge bar`：`drawPart(电容, 'symbol', { ...vis, charge: 0.5 })` 含 `0.5F`；charge 0 和 1 时画出的 SVG 不同。现有"所有 PART_TYPES 两种风格都能画"的测试会自动覆盖电容。

- [ ] **Step 2: 跑测试确认失败**
  Run: `cd circuit && node --test test/viewmodel.test.js test/drawings.test.js`
  Expected: FAIL

- [ ] **Step 3: 实现**
  - `drawings.js`：简笔风格画两块平行竖极板，卡通风格画电解电容罐子；两种风格都在旁边画竖条，填充高度按 `vis.charge`；下方 `<text class="label">` 写 `${farads}F`（同保险丝写法）。引线到端点 `±80, 0`。
  - `viewmodel.js`：加 `charge` 字段和 `case 'capacitor'`。
  - `view.js`：`PARAM_UI.farads = { name: '容量', label: v => \`${v}F\` }`。

- [ ] **Step 4: 跑全套测试，并在浏览器里看一眼**
  Run: `cd circuit && node --test test/`，Expected: 全部 PASS。
  再在仓库根目录 `python3 -m http.server 8000`，打开 `http://localhost:8000/circuit/`，自由模式放一个电池、开关、灯、电容，合上开关看竖条涨满，断开看灯慢慢熄灭、竖条下降。

- [ ] **Step 5: Commit**
  ```bash
  git add circuit/lib/drawings.js circuit/lib/viewmodel.js circuit/view.js circuit/test/viewmodel.test.js circuit/test/drawings.test.js
  git commit -m "feat(circuit): 电容的画法和容量选项"
  ```

---

### Task 4: 第 8 章第 1 关「会存电的电容」

**Files:**
- Create: `circuit/lib/tasks/ch8-capacitor.js`
- Modify: `circuit/lib/tasks.js`（import `CH8`、`CHAPTERS` 加第 8 章、`TASKS` 合并）
- Test: `circuit/test/tasks-ch8.test.js`（新建）

**Interfaces:**
- Consumes: Task 2 的 `settle(..., caps)` / `tick`；`task-kit.js` 的 `lampLit`、`ofType`、`result`、`noProgress`。
- Produces: `export const CH8 = [{ id: 38, chapter: 8, name: '会存电的电容', goal: '断开开关以后，让灯再亮一会儿', palette: { battery: 1, switch: 1, lamp: 1, capacitor: 1 }, preset: () => createCircuit(), initProgress: noProgress, check }]`。

- [ ] **Step 1: 写失败的测试** `circuit/test/tasks-ch8.test.js`（`run` 写法参照 `tasks-ch7.test.js`，但要先 tick 充电）：
  - `38 passes when the capacitor lights the lamp after the switch opens`：电池 → 开关 → 灯 → 电池、电容并灯；合上 tick 2 秒，断开后 settle（带 caps），`evaluateTask(...).passed` 为 true。
  - `38 fails when the battery lights the lamp`：同一电路开关合着：`passed` false，`hint` 等于「现在是电池在点灯。断开开关看看，灯还亮吗？」。
  - `38 fails without a capacitor`：去掉电容，断开开关后 `passed` false。
  - `38 fails with the capacitor in series`：电池 → 开关 → 灯 → 电容 → 电池，充电后断开，`passed` false。
  - `chapter 8 is listed`：`CHAPTERS` 含 `{ n: 8, name: '电容与定时' }`，`TASKS` 里 id 38 的 `chapter` 为 8。

- [ ] **Step 2: 跑测试确认失败**
  Run: `cd circuit && node --test test/tasks-ch8.test.js`
  Expected: FAIL

- [ ] **Step 3: 实现** `check`：有灯 `lampLit` 且每节电池 `|i| < 0.001` → 过关；有灯亮但有电池 `|i| >= 0.001` → 不过，给提示；否则不过、无提示。

- [ ] **Step 4: 跑全套测试，并在浏览器里过一遍这一关**
  Run: `cd circuit && node --test test/`，Expected: 全部 PASS（`tasks.test.js` 里关卡总数之类的断言如需更新，一并改）。
  浏览器里打开第 8 章第 1 关，搭出正确接法，确认过关提示出现。

- [ ] **Step 5: Commit**
  ```bash
  git add circuit/lib/tasks/ch8-capacitor.js circuit/lib/tasks.js circuit/test/tasks-ch8.test.js
  git commit -m "feat(circuit): 第 8 章第一关：会存电的电容"
  ```
