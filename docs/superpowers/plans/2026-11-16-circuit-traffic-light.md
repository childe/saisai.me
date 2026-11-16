# 第 8 章红绿灯三关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第 8 章新增「延时关灯」「自己闪的灯」「红绿灯」三关。

**Architecture:** 只加关卡对象到 `circuit/lib/tasks/ch8-capacitor.js`；慢速切换计数抽成一个共用函数；不改求解器和引擎。

**Tech Stack:** 原生 ES modules，`node --test circuit/test/`（在 worktree 根目录跑）。

**Spec:** `docs/superpowers/specs/2026-11-16-circuit-traffic-light-design.md`

## Global Constraints

- 关卡 id 41、42、43，chapter 8；若 main 已占用则顺延并同步测试。
- 名字和题目：41「延时关灯」/「断开开关以后，让继电器多吸一会儿，灯晚一点再灭」；42「自己闪的灯」/「不用开关，让灯自己一亮一灭」；43「红绿灯」/「给闪光电路接上红灯和绿灯，让它们自己轮流亮。绿灯比红灯亮得久，因为电容充电比放电快」。
- 41 提示原文：「灯亮了。断开开关，看灯能不能晚一点再灭」。
- 慢速切换：电容电压变化阈值 0.1 V，计 4 次过关。
- commit 作者 `childe <rmself@qq.com>`，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

- 第 43 关红绿接反（常闭接绿）也能过。→ Task 3 测试 `43 passes with colors swapped`。
- 第 42 关灯接在常开触点上也能过。→ Task 2 测试 `42 passes with lamp on no`。
- 第 41 关灯直接接电池、继电器空转不能过。→ Task 1 测试。
- 第 43 关预置电路被锁，参数是 2 节 / 47Ω / 0.5F。→ Task 3 测试 `43 preset is locked flasher`。
- 第 42、43 关重来后计数清零（`initProgress` 返回新对象）。→ Task 2 测试 `42 progress starts empty`。

---

### Task 1: 第 41 关「延时关灯」

**Files:** Modify `circuit/lib/tasks/ch8-capacitor.js`；Test `circuit/test/tasks-ch8.test.js`（追加）；Modify `circuit/test/tasks.test.js`、`circuit/test/view-tasks.test.js`（关卡总数）。

**Interfaces:** Produces 关卡对象 id 41；`check` 用 `solve(ws.circuit, brokenSet(ws.damage), { on: new Set(), caps: ws.caps?.v ?? {} })` 判断灯是否靠继电器。

- [ ] Step 1: 写测试（tick 推进写法同现有 `charged`）：`41 passes when relay holds the lamp after the switch opens`（正确接法 C=0.1，合上 tick 1 秒，断开后 settle 带 caps → passed）；`41 hints while the switch is closed`（不断开 → passed false，hint 等于提示原文）；`41 fails with the lamp wired to the battery`（灯直接接电池、继电器+电容照接，断开后 → false）；`41 fails without the capacitor`（断开后 tick 0.2 秒 → false）。目录断言改为 41 关。
- [ ] Step 2: `node --test circuit/test/tasks-ch8.test.js` → FAIL。
- [ ] Step 3: 实现。
- [ ] Step 4: `node --test circuit/test/` → 全部 PASS。
- [ ] Step 5: commit `feat(circuit): 第 8 章「延时关灯」`。

### Task 2: 第 42 关「自己闪的灯」和慢速切换计数

**Files:** 同 Task 1。

**Interfaces:** Produces `slowToggle(progress, ws, stateOf) → progress`（模块内函数）：`progress = { state, v, count }`；`stateOf(ws)` 返回可比较的状态值（字符串）；状态变了且任一电容 |v − progress.v[id]| ≥ 0.1 时 count+1 并记下当前电容电压；状态变了但电容没变时只更新 state。`initProgress: () => ({ state: null, v: {}, count: 0 })`。

- [ ] Step 1: 写测试：`42 passes after the lamp blinks on its own`（1 节 / 10Ω / 0.5F，灯接 nc；逐帧 tick 0.02 并在每帧 `evaluateTask` 推进 progress，20 秒内 passed）；`42 passes with lamp on no`；`42 fails when the relay buzzes without a capacitor`（电容不接，20 秒内不过）；`42 progress starts empty`（两次 `initProgress()` 结果深等于 `{ state: null, v: {}, count: 0 }` 且不是同一对象）。
- [ ] Step 2: 跑 → FAIL。
- [ ] Step 3: 实现 `slowToggle` 和第 42 关。
- [ ] Step 4: 全套 PASS。
- [ ] Step 5: commit `feat(circuit): 第 8 章「自己闪的灯」`。

### Task 3: 第 43 关「红绿灯」

**Files:** 同 Task 1。

**Interfaces:** Consumes `slowToggle`；`presetCircuit`（task-kit）。预置名字 `B`(battery, cells 2)、`K`(relay)、`R`(resistor 47)、`C`(capacitor 0.5)，导线同设计里的闪光接法；`lockPreset: true`；`palette: { led: 2, resistor: 2 }`。状态：只有红色 LED 亮 → `'red'`，只有绿色亮 → `'green'`，其他 → `'none'`；只在 red↔green 之间（经过 none 也算）计数——实现上 `stateOf` 返回 `'none'` 时不更新 state。

- [ ] Step 1: 写测试：`43 preset is locked flasher`（预置 4 个元件、参数正确、`lockPreset` 为真）；`43 passes with red on nc and green on no`（预置上加 R1/R2 100Ω 和两个 LED，逐帧推进，40 秒内过关）；`43 passes with colors swapped`；`43 fails with two red LEDs`。
- [ ] Step 2: 跑 → FAIL。
- [ ] Step 3: 实现。摆放坐标不重叠，右侧留空位。
- [ ] Step 4: 全套 PASS。
- [ ] Step 5: commit `feat(circuit): 第 8 章「红绿灯」`。
