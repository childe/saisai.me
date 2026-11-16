# 计数器台阶三关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第 7 章「全加器」之后插入三关（会记住的继电器、按一下换一下、0 1 2 转圈圈），「按钮计数器」后移做展示。

**Architecture:** 三关都是 `lockPreset: true`、`palette: {}` 的预置电路，小朋友只能加导线（`connect`）。判定靠每帧的进度状态机：自锁关看「按下时灯亮、松手后仍亮」，切换 / 循环关复用计数器的连续计数（加模数和「只在按下时变化」选项）。

**Tech Stack:** 原生 ES modules，`node --test`（在 `circuit/` 下运行）。

**Spec:** `docs/superpowers/specs/2026-11-16-circuit-counter-steps-design.md`

## Global Constraints

- 关卡 id 连续 1..46：新关 39、40、41；「按钮计数器」39→42；第 8 章 40..43→43..46。第 7 章 12 关，各章关卡数 `[5, 5, 6, 4, 3, 7, 12, 4]`。
- 「按钮计数器」的电路和判定行为不变（只改 id）。
- 继电器标签沿用「现 / 下 / 按」。
- 所有预置电路通过和计数器一样的版面检查：端点在板内（3..w-3, 3..h-3）且不重合、元件本体不重叠、导线不压别的端点、不同网络的导线不相碰。
- 改完代码后 `cd circuit && node --test` 全部通过。

## Review Focus

- 按钮直接接显示器 i1（第 40 关）：按下 1、松开 0，不能过关 → Task 3 测试。
- 灯直接经「清零」开关接电池（第 39 关）：合上清零灯亮，不能过关 → Task 2 测试。
- 按住按钮不放（第 40、41 关）：只变一次 → Task 3、4 测试。
- 补对一根、漏一根（第 40、41 关）：不能过关 → Task 3、4 测试。
- 清零后重来（第 39 关）：断开清零灯灭，再合上灯不亮，再按一次又能锁住 → Task 2 测试。

---

### Task 1: 编号后移与计数进度通用化

**Files:**
- Modify: `circuit/lib/tasks/ch7-logic.js`（计数器 id 39→42；`countStep` 加参数）
- Modify: `circuit/lib/tasks/ch8-capacitor.js`（id 40..43 → 43..46）
- Modify: `circuit/test/tasks.test.js`、`circuit/test/tasks-ch7.test.js`、`circuit/test/tasks-ch8.test.js`、`circuit/test/view-tasks.test.js`（引用的 id）

**Interfaces:**
- Produces: `countStep(progress, ws, { mod = 10, onPress = false } = {})`，返回 `{ last, steps }`。`onPress` 为真时，显示器变化的那一刻没有预置按钮按下，这次变化记 `steps: 0`。

- [ ] 改 id，测试里的 id 引用跟着改（chapter 7 列表暂为 `[30..37, 42]`，名字顺序表、id→名字表同步）。
- [ ] `countStep` 加 `{ mod, onPress }`，计数器调用保持默认。
- [ ] `node --test` 全过，提交 `refactor(circuit): 计数器后移到 42，第 8 章顺延`。

### Task 2: 第 39 关「会记住的继电器」

**Files:**
- Modify: `circuit/lib/tasks/ch7-logic.js`（预置 `latchPreset`、判定、关卡对象）
- Test: `circuit/test/tasks-ch7.test.js`

**预置**：电池 BAT、按钮 K、开关「清零」（params `closed: true`）、继电器 R（标签「继电器」可省）、灯 L。
导线：BAT.p→K.a；K.b→R.x；R.y→BAT.n；BAT.p→清零.a；清零.b→R.com；R.no→L.a；L.b→BAT.n。缺的线：R.no→R.x。电池节数保证锁住后线圈与灯并联时线圈电流仍 ≥ 吸合电流。

**判定**：进度 `{ lit: bool, byPress: bool }`。灯由灭变亮时若预置按钮按着，`byPress = true`，否则 false；灯灭则 `byPress = false`。`byPress && 灯亮 && 按钮松开` 即过关。

**文案**：`name: '会记住的继电器'`，`goal: '按一下按钮，松手后灯还亮着。把继电器的常开触点接回它自己的线圈，让它自己拉住自己。断开「清零」开关，它就忘了'`，`paletteNote: '只需要接一根导线'`。

- [ ] 写测试：版面检查；未接线时按下灯亮、松开灯灭、不过关；接上 R.no→R.x 后 tap 一次过关；直接接 BAT.p→L.a（灯常亮），拨清零开关后按一下也不过关（灯不是在按下时变亮）；锁住后断开清零灯灭，再合上灯不亮。
- [ ] 跑测试看失败，实现，跑测试通过，提交 `feat(circuit): 第 7 章加「会记住的继电器」`。

### Task 3: 第 40 关「按一下换一下」

**Files:**
- Create: `circuit/lib/tasks/toggle-preset.js`（导出 `togglePreset()`）
- Modify: `circuit/lib/tasks/ch7-logic.js`
- Test: `circuit/test/tasks-ch7.test.js`

**预置**：继电器 现（标签「现」）、下（「下」）、按现、按下（都标「按」），显示器 D，电池，按钮 K。接法与计数器的 1 位相同：
现.com、下.com 接正极；按现.com→现 线圈；按现.no←下.no；按下.com→下 线圈；按下.no←下.no（自锁）；现.no→D.i1；两个「按」线圈串联后经 K 接正极；D.g 和各线圈另一端接负极。
缺的线：① 现.no→按现.nc ② 现.nc→按下.nc。

**判定**：`countStep(progress, ws, { mod: 2, onPress: true })`，`steps >= 4` 过关。

**文案**：`goal: '按一下，显示器在 0 和 1 之间换一下。接两根线：「现」的常开触点接到「按」的常闭触点，让「现」记住现在的数；「现」的常闭触点接到「下」旁边那个「按」的常闭触点，下一个数就是现在反过来。连着换 4 次过关'`，`paletteNote: '只需要接两根导线'`。

- [ ] 写测试：版面检查；两根线都接后 tap 序列为 1,0,1,0 且第 4 下过关；按住 40 帧只变一次；只接①或只接②不过关（tap 6 次）；按钮直接接 D.i1（K.b→D.i1）不过关。
- [ ] 实现、通过、提交 `feat(circuit): 第 7 章加「按一下换一下」`。

### Task 4: 第 41 关「0 1 2 转圈圈」

**Files:**
- Create: `circuit/lib/tasks/count3-preset.js`（导出 `count3Preset()`）
- Modify: `circuit/lib/tasks/ch7-logic.js`、`circuit/test/tasks-ch7.test.js`（chapter 7 列表改为 `[30..37, 39, 40, 41, 42]`）、`circuit/test/tasks.test.js`（名字顺序、关卡数）

**预置**：现1、现2a、现2b（现2a/现2b 线圈串联，都标「现2」）、下1、下2、4 个「按」，显示器 D（i1、i2），电池，按钮 K。
位 1、位 2 各按计数器的结构接（现.no→显示器、按现.nc←现.no 自锁、按现.no←下.no、按下.no←下.no 自锁）。现1.com、现2a.com 接正极；现2b.nc→按下1.nc。
缺的线：① 现1.no→按下2.nc ② 现1.nc→现2b.com。

**判定**：`countStep(progress, ws, { mod: 3, onPress: true })`，`steps >= 6` 过关。

**文案**：`goal: '按一下加 1：0、1、2，再回到 0。接两根线：「现1」的常开触点接到「下2」旁边「按」的常闭触点（现在是 1，下一个是 2）；第二个「现2」的常闭触点接到「下1」旁边「按」的常闭触点（现在是 0，下一个是 1）。转两圈过关'`，`paletteNote: '只需要接两根导线'`。

- [ ] 写测试：版面检查；接好后 tap 序列 1,2,0,1,2,0，第 6 下过关；按住只加 1；只接①或只接②不过关。
- [ ] 实现、通过、更新章节测试、提交 `feat(circuit): 第 7 章加「0 1 2 转圈圈」`。
