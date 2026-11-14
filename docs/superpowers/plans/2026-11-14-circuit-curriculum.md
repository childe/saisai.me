# 电路实验室闯关课程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把小任务重排成 6 章 29 关的课程，并加入「找故障」「先猜再验证 / 先测再答」两种新玩法。

**Architecture:** 题目按章拆到 `circuit/lib/tasks/` 下，公共判定工具放 `circuit/lib/task-kit.js`，`circuit/lib/tasks.js` 只负责汇总并保留原有导出。隐藏故障在 `solve.js` 里实现（带 `fault` 的元件/导线不导通）。新玩法的状态（题目参数 variant、提交的答案、指认）由 `editor.js` 的 reducer 管理，题目对象通过 `submit` / `accuse` 钩子参与。

**Tech Stack:** 原生 ES modules，`node --test`，无构建、无依赖。

**Spec:** `docs/superpowers/specs/2026-11-14-circuit-curriculum-design.md`

工作目录：`/Users/jialiu/Projects/saisai.me/.worktrees/circuit-more-tasks`。全量测试命令：`node --test circuit/test/*.test.js`。

## Global Constraints

- 判定只看求解结果，不看元件位置。
- 不改 `PHYS` 物理常数。
- 每关至少一个正确接法通过、一个典型错误接法不通过的单测。
- 预测题判对：`|猜测 − 实际| ≤ max(0.1 × |实际|, 0.01)`。
- 关卡 `id` 为全局序号 1..29，顺序与名称按下表「课程表」。
- 题面短句，孩子能读懂；提示文案按 spec 原文：`先用电表量一量`、`不对哦，这关重来`、`合上开关看看！`、`实际是 X，差了一点。点「重来」再算一次`、`两盏灯有点暗，换个接法让它们都亮亮的`。
- 新预置电路的元件上下错开摆放，导线不穿过元件本体。主目录另一会话正把第 7、10 关（旧编号）预置坐标改成 `battery (9,12)` / 上方元件 `(9,5)`；本分支照此坐标写这两关，合并时以 main 为准。
- git 提交作者用仓库现有身份（`childe <rmself@qq.com>`），不得出现公司邮箱；提交信息末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

1. 孩子在预测题里先合上开关、看到读数再提交：必须被拒绝（开关合上时 `submit` 返回 null）。→ Task 3 测试。
2. 找故障题里删除或分割预置导线、在预置导线中间接线：都必须无效，否则绕过诊断。→ Task 7 测试。
3. 「重来」或指认错误后 variant 必须与上一次不同（variants 多于 1 个时），且已提交答案被清空。→ Task 7 测试。
4. 输入框里填空、非数字、负数：不提交、不报错。→ Task 8 测试（app 层 `parseAnswer`）。
5. 切换关卡、撤销（undo）后，故障标记和 preset 标记不能丢：undo 快照里的电路仍带 `fault`/`preset`。→ Task 7 测试。

---

## 课程表

| id | 章 | 名称 | 来源 |
|---|---|---|---|
| 1 | 1 认识元件 | 点亮一盏灯 | 现有 |
| 2 | 1 | 加个开关 | 现有 |
| 3 | 1 | 门铃 | 草稿 11 |
| 4 | 1 | 让风扇反转 | 现有 |
| 5 | 1 | 让 LED 亮起来 | 现有 |
| 6 | 2 串联与并联 | 串联和并联 | 现有 |
| 7 | 2 | 一个亮一个灭 | 现有 |
| 8 | 2 | 保险箱 | 草稿 12 |
| 9 | 2 | 前门后门 | 草稿 13 |
| 10 | 2 | 总开关 | 草稿 14 |
| 11 | 3 电表 | 量一量 | 现有 |
| 12 | 3 | 串联电流 | 新·预测 |
| 13 | 3 | 串联分压 | 新·预测 |
| 14 | 3 | 并联干路 | 新·预测 |
| 15 | 3 | 精确调电流 | 新 |
| 16 | 3 | LED 能受多大电流 | 新·先测再答 |
| 17 | 4 混联 | 主灯和小灯 | 新 |
| 18 | 4 | 混联电流 | 新·预测 |
| 19 | 4 | 越灭越亮 | 新 |
| 20 | 4 | 一盏调光一盏不变 | 新 |
| 21 | 5 找故障 | 哪盏灯坏了 | 新·故障 |
| 22 | 5 | 断掉的导线 | 新·故障 |
| 23 | 5 | 失灵的开关 | 新·故障 |
| 24 | 6 挑战 | 楼梯灯 | 现有 |
| 25 | 6 | 保险丝救场 | 现有 |
| 26 | 6 | 红绿灯 | 草稿 16 |
| 27 | 6 | 两档风扇 | 新 |
| 28 | 6 | 防盗报警 | 新 |
| 29 | 6 | 风扇和灯 | 草稿 15（保留，作收尾） |

「草稿」指 worktree 里未提交的 `circuit/lib/tasks.js` 第 11–16 关及其测试，搬过去时判定逻辑不变。

## 题目对象接口（所有任务共用）

```js
{
  id, chapter,                 // chapter: 1..6
  name,
  goal: string | (variant) => string,
  palette, defaults?, locked?,           // 同现有
  variants?: any[],                      // 缺省视为 [null]
  preset(variant) => circuit,
  lockPreset?: true,                     // 预置元件/导线不可删、不可分割、不可在中间接线；预置元件参数不可改（开关仍可拨）
  answer?: { kind: 'predict' | 'measure', question: (variant) => string, unit: 'A' | 'V' },
  initProgress() => object,
  check(progress, ws) => { progress, passed, hint },   // ws.variant 可用
  submit?(progress, value, ws) => { progress, hint } | null,  // null = 拒绝
  accuse?(progress, target, ws) => 'right' | 'wrong' | null,  // target = {kind:'part'|'wire', id}；null = 还不能指认
}
```

---

### Task 1: 隐藏故障的求解

**Files:**
- Modify: `circuit/lib/solve.js`（`CONDUCTANCES.spdt`、`conductancesOf`，以及导线进入 `components`/`solveComponent` 前的过滤）
- Test: `circuit/test/solve-fault.test.js`（新建）

**Interfaces:**
- Produces: 元件字段 `fault: 'open'`（两端元件不导通）；单刀双掷开关 `fault: 'open-a' | 'open-b'`（拨到该掷点时不通）；导线字段 `fault: 'open'`（视为不存在）。电池带 `fault` 不在本计划范围。

- [ ] **Step 1: 写失败测试**（用 `test/helpers.js` 的 `build`，第三个参数 `extra` 放 `fault`；导线故障在 build 之后直接给 `c.wires[i].fault = 'open'`）
  - `faulty lamp in series blacks out the loop`：2 节 + L1 + L2(fault open) 串联 → `L1.i` < 1e-6；电压表并在 L2 上读数 ≈ 3 V（误差 0.1）。
  - `open wire behaves like a missing wire`：1 节 + 灯，回路一根导线 `fault: 'open'` → 灯 `|i|` < 1e-6，`result.ok === true`。
  - `spdt fault only kills its throw`：B → S.c，S.a → L.a，S.b → L.a，L.b → B.n，`S.fault = 'open-a'`：`to: 'a'` 灯不亮，`to: 'b'` 灯亮（`p ≥ PHYS.LAMP_LIT_P`）。
  - `fault is not damage`：`settle` 后 `damage.broken` 不含故障元件 id。
- [ ] **Step 2:** `node --test circuit/test/solve-fault.test.js` → FAIL。
- [ ] **Step 3: 实现**：`conductancesOf` 对 `part.fault === 'open'` 返回 `[]`；spdt 在 `part.fault === 'open-' + params.to` 时返回 `[]`；求解用的导线列表滤掉 `w.fault === 'open'`（隐含导线 junctionWires 不受影响）。
- [ ] **Step 4:** 全量测试 PASS。
- [ ] **Step 5:** 提交 `feat(circuit): 元件和导线的隐藏故障`。

### Task 2: 判定工具与第 1、2 章

**Files:**
- Create: `circuit/lib/task-kit.js`
- Create: `circuit/lib/tasks/ch1-parts.js`、`circuit/lib/tasks/ch2-series.js`
- Modify: `circuit/lib/tasks.js`（改为汇总）
- Modify: `circuit/test/tasks.test.js`（只留汇总类测试）；Create: `circuit/test/tasks-ch1.test.js`、`circuit/test/tasks-ch2.test.js`
- Modify: `circuit/test/editor.test.js`（`chooseTask` 的 index 跟着新编号改：原 index 2「串联和并联」→ 5）

**Interfaces:**
- Produces（`task-kit.js`）：`lampLit(result, broken, id)`、`ledLit`、`buzzerOn`、`motorOn`、`withParams(circuit, changes)`、`ofType(circuit, type)`、`result(passed, progress, hint = null)`、`noProgress()`、`switchTable(circuit, broken, s1, s2)`、`anySwitchPair(ws, pred)`、`truth(on, want)`（以上从草稿 tasks.js 原样搬）；
  `presetCircuit(parts, wires) => circuit`：parts 项 `[name, type, x, y, params?, extra?]`（extra 如 `{ fault: 'open' }` 合并到元件上），wires 项 `[a, b, extra?]`（extra 合并到导线上）；所有元件和导线都标 `preset: true`。`a`/`b` 写 `'名字.端点'`，连接点用 type `'node'`、端点 `'o'`。
  `presetReading(circuit, closeIds, partId, field) => number`：把 `closeIds` 里的开关设为合上后求解，返回 `|parts[partId][field]|`。
- Produces（`tasks.js`）：`TASKS`（29 关按 id 排序拼接各章数组）、`CHAPTERS = [{ n: 1, name: '认识元件' }, { n: 2, name: '串联与并联' }, { n: 3, name: '电表' }, { n: 4, name: '混联' }, { n: 5, name: '找故障' }, { n: 6, name: '挑战' }]`、`evaluateTask`、`remainingPalette`，并继续 re-export `lampLit`、`ledLit`、`withParams`。
- Produces：`goalText(task, variant)`（在 `tasks.js`，string 或函数统一取文字）、`chapterIndex(task)`（本章第几关，从 1 起）。
- 本 Task 同时建好 `ch3-meters.js`（只放「量一量」）和 `ch6-challenge.js`（楼梯灯、保险丝救场、红绿灯、风扇和灯），其余新关在后续 Task 加入；id 按课程表写死，汇总测试暂时只断言已有关卡的 id/名称，Task 6 改成完整 29 关。保险丝救场预置坐标改为 `battery (9,12)`、`lamp (9,5)`。

- [ ] **Step 1: 写测试**：把现有/草稿的关卡测试按新 id 搬到 `tasks-ch1/ch2.test.js`（`run(id, circuit)` 改为按 id 找题 `TASKS.find(t => t.id === id)`），另加：
  - `presetCircuit marks parts and wires preset and carries extra`：`presetCircuit([['B','battery',9,12],['L','lamp',9,5,{},{fault:'open'}]], [['B.p','L.a',{fault:'open'}],['L.b','B.n']])` → 所有 parts/wires `preset === true`；L 有 `fault`；第一根导线有 `fault`。
  - `chapters and ids line up`：每个 task 的 `chapter` 在 1..6，`id` 唯一；`CHAPTERS.length === 6`。
  - 第 4 关（让风扇反转）预置坐标：电池 `(9,12)`、风扇 `(9,5)`。
- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现**：搬代码，给每关加 `chapter`，`preset` 签名统一成 `preset(variant)`。
- [ ] **Step 4:** 全量测试 PASS（`editor-wires.test.js`、`editor.test.js` 若引用旧 index，按新编号改）。
- [ ] **Step 5:** 提交 `refactor(circuit): 小任务按章拆分，判定工具独立`。

### Task 3: 第 3 章 电表（含预测与先测再答）

**Files:**
- Modify: `circuit/lib/task-kit.js`（加 `predictTask`、`withinTolerance`）
- Create: `circuit/lib/tasks/ch3-meters.js`
- Test: `circuit/test/tasks-ch3.test.js`

**Interfaces:**
- Produces: `withinTolerance(guess, actual) => boolean`（Global Constraints 的公式）。
- Produces: `predictTask({ id, chapter, name, goal, variants, preset, switches, target, question, unit }) => task`：
  - `switches`：预置总开关名字数组（presetCircuit 里的 name；task 内部通过 `preset: true` 且 type 为 switch 找到它们，判定「全部合上」）。
  - `target(ws) => number`：要比较的实际读数。
  - `submit`：`progress.answer != null` 或任一预置开关合上 → `null`；否则 `{ progress: { ...progress, answer: value }, hint: '合上开关看看！' }`。
  - `check`：无答案 → 不过、hint null；有答案且预置开关都合上且 `ws.result.ok` → `withinTolerance` 则过，否则 `progress.wrong = true`，hint `实际是 ${actual.toFixed(2)} ${unit}，差了一点。点「重来」再算一次`；`wrong` 之后一直不过；有答案但开关没合 → hint `合上开关看看！`。
  - `answer = { kind: 'predict', question, unit }`，`lockPreset: true`。

| id | 预置（开关 S 初始断开） | variants | target | question(variant) |
|---|---|---|---|---|
| 12 | B(cells) → S → A1 → L1 → L2 → A2 → B | cells 2/3/4 | `|A2.i|` | `合上开关后 A1 读 ${a1} A。猜猜 A2 读多少？`（a1 用 `presetReading` 现算，两位小数） |
| 13 | B → S → L1 → L2 → B，电压表 V 并在 L1 | cells 2/3/4 | `|V.v|` | `电池是 ${cells×1.5} V，两盏一样的灯串联。猜猜电压表读多少？` |
| 14 | B → S → A2 → 并联 n 盏灯 → B，A1 串在 L1 支路 | `{cells:1,n:2}` `{cells:2,n:2}` `{cells:1,n:3}` `{cells:2,n:3}` | `|A2.i|` | `A1 读 ${a1} A，${n} 盏一样的灯并联。猜猜 A2 读多少？` |

- 15「精确调电流」：palette `{ battery: 1, lamp: 1, rheostat: 1, ammeter: 1 }`，`defaults/locked` battery cells = 1；通过：某电流表 `|i|` ∈ [0.095, 0.105]，且某盏亮着的灯 `|i|` 与它相差 ≤ 5%。
- 16「LED 能受多大电流」：palette `{ battery: 2, rheostat: 1, ammeter: 1, led: 2 }`；`answer = { kind: 'measure', question: () => 'LED 最多能通过多少电流？', unit: 'A' }`；`submit` 任何时候都接受（覆盖旧答案）；`check` 遍历 `ws.trail` 与 `ws.result`：出现「某电流表 `|i|` ≥ 0.02 且某 LED `|i|` 与它相差 ≤ 5%」记 `progress.sawSeries = true`；`ws.damage.broken` 里有任一 LED 记 `progress.burned = true`（两者一旦为 true 不再清掉）；通过 = 两者都 true 且 `answer` ∈ [0.025, 0.035]；有答案但没做实验 → hint `先用电流表和变阻器做实验，把 LED 调到烧坏为止`；答案不在范围 → hint `再看看 LED 烧坏前电流表读多少`。

- [ ] **Step 1: 写失败测试**
  - `withinTolerance`：`(0.15, 0.148)` true；`(0.2, 0.148)` false；`(0.01, 0.0)` true；`(0.03, 0.0)` false。
  - 对 12/13/14 各一组（每个 variant 都跑）：`ws = settle(withParams(preset(v), {S: {closed:false}}))` 时 `submit(…, 正确值)` 非 null；把 S 合上后的 ws 上 `check` → passed；用 `实际×1.3` 提交 → 不过且 hint 以 `实际是` 开头；S 已合上时 `submit` 返回 null。
  - 12 的数值：cells 2 时 target ≈ 0.148（误差 0.005）；13 cells 2 时 ≈ 1.49；14 `{cells:2,n:2}` 时 ≈ 0.577。
  - 14 所有 variant 灯不过载：每盏灯 `p < PHYS.LAMP_BURN_P`。
  - 15：1 节 + 灯 + 变阻器(a、w 端，pos 调到 0.1) + 电流表串联 → 通过；pos 0.5 → 不过。
  - 16：只提交 0.03、没做实验 → 不过；构造 trail（先 settle 一个 2 节 + 变阻器 pos 1 + 电流表 + LED 串联的电路记下 progress，再把 pos 设 0 settle 使 LED 烧坏，用两次 check 串起 progress）后提交 0.03 → 通过；提交 0.05 → 不过。
- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现** `predictTask`、`withinTolerance` 与第 3 章各关。
- [ ] **Step 4:** 全量 PASS。
- [ ] **Step 5:** 提交 `feat(circuit): 第 3 章电表关卡与预测题`。

### Task 4: 第 4 章 混联

**Files:**
- Create: `circuit/lib/tasks/ch4-mixed.js`
- Test: `circuit/test/tasks-ch4.test.js`

**Interfaces:**
- Consumes: `predictTask`、`presetCircuit`、`task-kit` 判定工具。

| id | 名称 | palette / 预置 | 通过条件 |
|---|---|---|---|
| 17 | 主灯和小灯 | `{battery:1, lamp:3}`，defaults cells 2 | 三盏都亮；有一盏功率 ≥ 另两盏各自的 2 倍；另两盏功率相差 ≤ 10% |
| 18 | 混联电流 | predictTask：B → S → A → L1 → (L2‖L3) → B；variants cells 2/3/4 | target `|A.i|`；question `电池 ${V} V，每盏灯 10 Ω。猜猜电流表读多少？` |
| 19 | 越灭越亮 | `{battery:1, lamp:2, switch:1}`，defaults cells 2 | 对某开关：断开时两盏都亮；合上时一盏不亮、另一盏功率 ≥ 断开时的 2 倍；合上时电池 `|i|` < `PHYS.SHORT_A` |
| 20 | 一盏调光一盏不变 | `{battery:1, lamp:2, rheostat:1}` | 对某变阻器 pos 0 / pos 1：某盏灯两端功率都 > 1e-4 且比值 ≥ 2；另一盏两端都亮且比值 ≤ 1.1 |

- [ ] **Step 1: 写失败测试**：17 主灯串两盏并联（2 节）→ 过，三盏串联 → 不过，三盏并联 → 不过；18 cells 2 target ≈ 0.197，cells 4 时 L1 `p < LAMP_BURN_P`，提交/判定流程同 Task 3 的一组；19 开关并在 L2 两端、L1 串在主路 → 过，开关串在主路 → 不过，开关直接并在电池两端 → 不过；20 变阻器（a、w）只串在 L1 支路、L2 另一支路 → 过，变阻器在干路 → 不过。
- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4:** 全量 PASS。
- [ ] **Step 5:** 提交 `feat(circuit): 第 4 章混联关卡`。

### Task 5: 第 5 章 找故障

**Files:**
- Modify: `circuit/lib/task-kit.js`（加 `faultTask`、`metersRead`）
- Create: `circuit/lib/tasks/ch5-faults.js`
- Test: `circuit/test/tasks-ch5.test.js`

**Interfaces:**
- Produces: `metersRead(ws) => boolean`：`ws.trail` 或 `ws.result` 里有电流表 `|i|` ≥ 0.01 或电压表 `|v|` ≥ 0.1。
- Produces: `faultTask({ id, chapter, name, goal, palette, variants, preset }) => task`：
  - `lockPreset: true`；`initProgress = () => ({ measured: false, found: false })`。
  - `check`：`measured` 一旦为 true 保持；`passed = progress.found`；未量过时 hint `先用电表量一量`，量过后 hint null。
  - `accuse(progress, target, ws)`：`!progress.measured` → null；`target` 指向的元件或导线在 `ws.circuit` 里带 `fault` → `'right'`，否则 `'wrong'`。（是否通过由 editor 把 `found` 写进 progress，见 Task 7。）

| id | 预置 | variants（故障位置） | palette |
|---|---|---|---|
| 21 | 2 节 + L1、L2、L3 串联 | L1 / L2 / L3 `fault: 'open'` | `{voltmeter:1}` |
| 22 | 2 节 + 开关(合上) + 两条并联支路：L1 直连；L2 支路经连接点 N1、N2… 由 ≥ 3 根导线串起 | L2 支路上 ≥ 2 根不直接连 L2 端点的导线之一 `fault: 'open'` | `{voltmeter:1, ammeter:1}` |
| 23 | 楼梯灯：B → S1.c，S1.a–S2.a，S1.b–S2.b，S2.c → L → B | S1/S2 × `open-a`/`open-b` 共 4 种 | `{voltmeter:1}` |

- [ ] **Step 1: 写失败测试**
  - 每关每个 variant：预置电路里恰好一个带 `fault` 的元件或导线；21、22 预置电路里（不拨开关）至少一盏灯不亮。
  - 22 的每个故障导线都不连到 L2 的端点；公共段导线无故障（L1 亮着）。
  - `accuse` 未量过 → null；接一个电压表跨在电池两端 settle、check 后 `measured === true`；指认故障件 → `'right'`；指认另一预置件 → `'wrong'`。
  - 21：电压表并在故障灯两端读数 ≥ 2.9 V，并在好灯两端 < 0.1 V（证明能用电压表找出来）。
  - 23：每个 variant 下，存在某种拨法灯不亮、某种拨法灯亮（故障只影响一个掷点）。
- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4:** 全量 PASS。
- [ ] **Step 5:** 提交 `feat(circuit): 第 5 章找故障关卡`。

### Task 6: 第 6 章 挑战，汇总 29 关

**Files:**
- Modify: `circuit/lib/tasks/ch6-challenge.js`（加两档风扇、防盗报警）
- Test: `circuit/test/tasks-ch6.test.js`；Modify: `circuit/test/tasks.test.js`

| id | 名称 | palette | 通过条件 |
|---|---|---|---|
| 27 | 两档风扇 | `{battery:1, switch:1, spdt:1, resistor:1, motor:1}`，defaults cells 2 | 存在开关 s 与单刀双掷开关 d：s 断开时 d 两档风扇都不转；s 合上时两档都转（`motorOn`），且两档 `|v|` 比值 ≥ 2 |
| 28 | 防盗报警 | `{battery:1, switch:1, buzzer:1, resistor:1}`，defaults cells 2 | 存在开关 s：合上时蜂鸣器不响且电池 `|i|` < `PHYS.SHORT_A`；断开时蜂鸣器响 |

- [ ] **Step 1: 写失败测试**：`twenty-nine tasks in curriculum order`（名称数组按课程表）+ `ids are 1..29` + 每章关数 `[5,5,6,4,3,6]`；27 正确接法（s 在主路，d.c 接电机，d.a 直连电池，d.b 经 10 Ω 电阻）→ 过，不接电阻（两档一样）→ 不过；28 正确接法（电池 → 100 Ω 电阻 → 蜂鸣器 → 电池，开关并在蜂鸣器两端）→ 过，开关并在电池两端（短路）→ 不过，开关串在主路 → 不过；搬来的四关测试原样跑。
- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4:** 全量 PASS。
- [ ] **Step 5:** 提交 `feat(circuit): 第 6 章挑战关卡，课程共 29 关`。

### Task 7: editor 支持题目参数、提交答案、指认、锁定预置

**Files:**
- Modify: `circuit/lib/editor.js`
- Test: `circuit/test/editor-tasks.test.js`（新建）

**Interfaces:**
- Consumes: 题目对象接口（上文）。
- Produces: `pickVariant(n, prev, rng = Math.random) => number`（n ≤ 1 返回 0；否则在 `[0, n)` 中排除 `prev` 后均匀选）；task space 多两个字段：`variantIndex`、`variant`（`ws.variant` 即它，供 `check` 使用）。
- Produces: 新 action：
  - `{ type: 'submitAnswer', value: number }`：调 `task.submit`；返回 null → state 不变；否则写回 progress，再 `evaluate`，hint 用 submit 返回的 hint（`evaluate` 结果的 hint 非 null 时以它为准）。
  - `{ type: 'accuse', target: { kind, id } }`：调 `task.accuse`；null → 不变；`'right'` → `progress.found = true` 并 evaluate；`'wrong'` → 换 variant 重开本关（同「重来」），hint 设为 `不对哦，这关重来`。
- 「重来」：task 模式下 `confirmClear` 改为用新 variant（`pickVariant(n, 当前 variantIndex)`）重建 task space，`history` 保留旧电路以便撤销（沿用现有写法）。`chooseTask` 进入时 `prev = -1`。
- `lockPreset` 时拒绝（state 原样返回）：`deletePart`/`deleteWire` 作用于 `preset` 项；`splitWire` 作用于 preset 导线；`connect` 的 from/to 为 preset 导线上的点（`from.wire`/`to.wire` 指向 preset 导线）；`setParam` 作用于 preset 元件。`toggle`、`move`、`rotate` 不拦。

- [ ] **Step 1: 写失败测试**
  - `pickVariant`：`pickVariant(1, 0) === 0`；`rng` 固定为 `() => 0` 时 `pickVariant(3, 0) === 1`；1000 次随机 `pickVariant(3, 2)` 从不等于 2。
  - 预测题流程（第 12 关）：进入后 `submitAnswer` 正确值 → hint `合上开关看看！`；拨合预置开关 → `passed`；另一局先拨合开关再 `submitAnswer` → state 不变（`progress.answer` 仍为 undefined/null）。
  - 重来：第 12 关提交答案后 `askClear` + `confirmClear` → `variantIndex` 与之前不同、`progress.answer` 为空、`passed === false`。
  - 指认（第 21 关）：未接电表时 `accuse` 故障灯 → state 不变；放电压表并接到电池两端后 `accuse` 一盏好灯 → `variantIndex` 改变、hint `不对哦，这关重来`；重新接电压表后 `accuse` 当前故障灯（从 `s.task.circuit` 里找带 `fault` 的）→ `passed === true`。
  - 锁定（第 22 关）：对 preset 导线 `deleteWire`、`splitWire`、`connect` 到其中点，对 preset 元件 `deletePart`、`setParam` → state 全部不变；`toggle` 预置开关有效。
  - undo 保留标记：第 21 关放一个电压表再 `undo` → 电路里仍有带 `fault` 的灯，所有预置元件仍 `preset === true`。
- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4:** 全量 PASS。
- [ ] **Step 5:** 提交 `feat(circuit): 题目参数随机、提交答案、指认故障与预置锁定`。

### Task 8: 界面：按章选关、题目栏的答题与指认

**Files:**
- Modify: `circuit/view.js`（`renderTaskbar`、选关列表渲染改为函数 `taskListHtml()` 导出）
- Modify: `circuit/app.js`（选关列表用 `taskListHtml()`；`onTaskClick` 处理 `submit`、`accuse`）
- Modify: `circuit/styles.css`（章标题、答题行样式）
- Test: `circuit/test/view-tasks.test.js`（新建，测纯函数）；`circuit/test/static.test.js` 若有断言随改

**Interfaces:**
- Produces（`view.js`）：`taskListHtml() => string`：每章 `<h3>第 N 章 · 章名</h3>` + `<div class="tasklist-items">` 里该章按钮，按钮 `data-task="${全局 index}"`，文字 `第 M 关 · 名称`。
- Produces（`view.js`）：`taskbarHtml(state) => string`（从 `renderTaskbar` 拆出的纯函数）：
  - 标题 `第 ${chapter} 章 · 第 ${M} 关 · ${name}：${goalText(task, variant)}`。
  - `task.answer` 存在：一行 `<span>${question(variant)}</span><input id="answerInput" type="number" step="0.01" min="0" inputmode="decimal"> ${unit} <button class="btn" data-task-action="submit">${kind==='predict' ? '我猜好了' : '提交答案'}</button>`；predict 已提交时 input 和按钮 `disabled`，input 显示已提交的值。
  - `task.accuse` 存在：按钮 `<button class="btn" data-task-action="accuse">就是它坏了！</button>`；当前选中的不是 preset 项或 `!progress.measured` 时 `disabled`。
  - 「重来」沿用工具栏的清空按钮；task 模式下按钮文字改为 `↺ 重来`、确认框文字 `重来这一关？`。
- Produces（`app.js` 或 `view.js`，导出供测试）：`parseAnswer(text) => number | null`：去空格后为有限非负数返回数值，否则 null。
- `renderTaskbar` 的缓存 key 加入 `variantIndex`、`progress.answer`、`progress.measured`、selection 是否为 preset 项；输入框内容不进 key（打字时不重绘）。

- [ ] **Step 1: 写失败测试**
  - `taskListHtml`：含 6 个 `<h3>`；含 29 个 `data-task=`；含 `第 3 章 · 电表` 与 `第 6 关 · LED 能受多大电流`（第 16 关是第 3 章第 6 关）。
  - `taskbarHtml`：第 12 关标题以 `第 3 章 · 第 2 关 · 串联电流` 开头且含 `answerInput`；提交后含 `disabled`；第 21 关未量过时 `就是它坏了！` 按钮 `disabled`；第 1 关不含 `answerInput` 和 `就是它坏了`。
  - `parseAnswer`：`'0.15'` → 0.15；`' 1.5 '` → 1.5；`''`、`'abc'`、`'-1'` → null。
- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现**；`onTaskClick`：`submit` 读 `#answerInput`，`parseAnswer` 为 null 时不 dispatch；`accuse` dispatch `{ type: 'accuse', target: state.selection }`。
- [ ] **Step 4:** 全量 PASS。
- [ ] **Step 5:** 提交 `feat(circuit): 按章选关与题目栏答题、指认`。

### Task 9: 收尾

**Files:**
- Modify: `README.md`（`带 16 个小任务` / `带 10 个小任务` → `带 6 章 29 关小任务，含预测计算和找故障`）

- [ ] **Step 1:** 改 README。
- [ ] **Step 2:** `node --test circuit/test/*.test.js` 与 `node --test tests/*.test.mjs` 全部 PASS。
- [ ] **Step 3:** 手动验收清单交给用户（本环境不能起本地服务器）：打开 `circuit/index.html` → 小任务 → 选关显示 6 章；第 12 关先猜再合开关；第 21 关先量再指认、指错会换位置；第 16 关把 LED 调到烧坏再答。
- [ ] **Step 4:** 提交 `docs: README 更新电路实验室关卡数`。
