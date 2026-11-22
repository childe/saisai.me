# 电路课程重排 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把电路小任务从 8 章重排成 7 章：找故障并入电表章并补教学关，「挑战」章改成单刀双掷开关与保险丝章，第 2 章三关改成 3 盏灯。

**Architecture:** 关卡数据在 `circuit/lib/tasks/ch*.js`，每章一个数组；`circuit/lib/tasks.js` 拼成 `TASKS` 和 `CHAPTERS`。找故障的通用判定在 `circuit/lib/task-kit.js` 的 `faultTask`，题目栏 HTML 在 `circuit/lib/taskbar.js`（纯函数），面板按钮在 `circuit/view.js`。全部是无依赖的 ES module，测试用 `node --test`。

**Tech Stack:** 原生 JS ES modules，`node:test`，无构建步骤。

**Spec:** `docs/superpowers/specs/2026-11-22-circuit-curriculum-v2-design.md`

## Global Constraints

- 判定只看求解结果，不看元件摆放位置。
- 不改 `circuit/lib/parts.js` 里的物理常数。
- 保留 `node` 元件类型（逻辑章在用）。
- 已有关卡 id 不变；新关 id 48；29 删除后不复用。
- 题面每条不超过 3 句；说明文字逐字取自 spec。
- 每个任务结束时 `cd circuit && node --test test/` 全绿再提交。
- 提交作者 `childe <rmself@qq.com>`，commit message 末尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 所有命令在 worktree `/Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2` 下执行；用绝对路径或 `git -C`，不要依赖 `cd` 后的相对路径（本环境里 `cd dir && 相对路径` 会失效）。

## Review Focus

1. 第 22 关重做后，孩子把电压表接在好导线两头读 0 V、坏导线两头读 3 V，接在灯两端也读 0 V。→ Task 3 的 `每根好导线 0 V、坏导线 ≥ 2.9 V、灯 0 V` 测试。
2. 孩子先量电池（读 3 V），再选中电池按「就是它坏了」：电池不是候选，按钮必须是灰的，说明「这关坏的是灯，不是它」。→ Task 2 的 `accuse 对非候选返回 null`、Task 4 的 `选中电池时按钮 disabled 且有说明`。
3. 第 23 关里拨开关找不亮的组合时，孩子可能把电压表接在开关公共端和没拨到的那一边；此时指认该开关若错，提示文案不能说「它两端是 0 V」。→ Task 2 的提示文案固定为「不是它。好的地方是 0 V，坏的地方才是 3 V。换一道再来」，不描述读数。
4. 第 10 关 3 盏灯串联在 1 节电池下一盏都不亮，孩子看到的是「接好了但不亮」，必须有提示。→ Task 5 的 `series3 返回提示「灯不亮或者太暗，换个接法让它们都亮亮的」`。
5. 重排后数组索引全变，`chooseTask`/`nextTask` 按索引走；选关列表里第 3 章第 7 关必须是「断开的地方」而不是旧索引上的别的关。→ Task 1 的 `tasks in curriculum order` 全量名字断言、Task 4 的 `taskListHtml` 断言。

---

### Task 1: 章节重排（只搬家，不改判定）

**Files:**
- Modify: `circuit/lib/tasks.js`
- Rename: `circuit/lib/tasks/ch5-faults.js` → `circuit/lib/tasks/ch3-faults.js`（去掉 23 和 `stairsPreset`，`chapter: 3`，导出 `CH3_FAULTS`）
- Rename: `circuit/lib/tasks/ch6-challenge.js` → `circuit/lib/tasks/ch5-spdt-fuse.js`（导出 `CH5`，`chapter: 5`，顺序 24, 23, 26, 27, 25, 28；23 连同 `stairsPreset` 搬进来；删除 29；删除 38）
- Modify: `circuit/lib/tasks/ch4-mixed.js`（38 连同 check 搬到数组末尾，`chapter: 4`）
- Rename: `circuit/lib/tasks/ch7-logic.js` → `circuit/lib/tasks/ch6-logic.js`（导出 `CH6`，所有 `chapter: 7` → `6`）
- Rename: `circuit/lib/tasks/ch8-capacitor.js` → `circuit/lib/tasks/ch7-capacitor.js`（导出 `CH7`，所有 `chapter: 8` → `7`）
- Rename tests: `test/tasks-ch5.test.js` → `test/tasks-ch3-faults.test.js`，`test/tasks-ch6.test.js` → `test/tasks-ch5.test.js`，`test/tasks-ch7.test.js` → `test/tasks-ch6.test.js`，`test/tasks-ch8.test.js` → `test/tasks-ch7.test.js`
- Modify tests: `test/tasks.test.js`, `test/tasks-ch3.test.js`, `test/tasks-ch4.test.js`, `test/view-tasks.test.js`, `test/editor-tasks.test.js:220`

**Interfaces:**
- Produces: `CHAPTERS` = 7 项，名字依次 `认识元件, 串联与并联, 电表, 混联, 单刀双掷开关与保险丝, 逻辑与加法器, 电容与定时`。
- Produces: `TASKS = [...CH1, ...CH2, ...CH3, ...CH3_FAULTS, ...CH4, ...CH5, ...CH6, ...CH7]`，不再 `.sort`。`TASKS.map(t => t.id)` 为 `[1..16, 21, 22, 17, 18, 19, 20, 38, 24, 23, 26, 27, 25, 28, 30..37, 39..42, 43..47]`（Task 3 再在 16 后插 48）。
- Produces: `chapterIndex(T(23)) === 2`，`chapterIndex(T(38)) === 5`，`chapterIndex(T(28)) === 6`。

- [ ] **Step 1: 改 `test/tasks.test.js`**

把 `chapters and ids line up` 改成 `CHAPTERS.length === 7`、`chapter` 在 1..7、id 唯一，删掉「已排序」断言。把 `tasks in curriculum order` 的名字表改成新顺序（第 3 章末尾先只有 `哪盏灯坏了, 断掉的导线`，第 4 章末尾 `一亮一暗`，第 5 章 `楼梯灯, 失灵的开关, 红绿灯, 两档风扇, 保险丝救场, 防盗报警`），id 表改成上面 Interfaces 的数组，`per` 改成 `[5, 5, 8, 5, 6, 12, 5]`。`existing tasks keep curriculum ids and names` 删掉 `29`。`chapterIndex(T(29))` 改成 `chapterIndex(T(23)) === 2` 和 `chapterIndex(T(38)) === 5`。

- [ ] **Step 2: 改其他测试的章号和索引**

- `test/tasks-ch3.test.js:193`：`[11, 12, 13, 14, 15, 16, 21, 22]`。
- `test/tasks-ch4.test.js:17`：`[17, 18, 19, 20, 38]`。
- 原 `tasks-ch6.test.js`（改名后 `tasks-ch5.test.js`）：删掉 `task 29` 测试；把 `task 38` 的 5 个测试整体搬到 `test/tasks-ch4.test.js`；`chapter === 6` 那条改成 `TASKS.filter(t => t.chapter === 5).map(t => t.id)` 等于 `[24, 23, 26, 27, 25, 28]`。
- 原 `tasks-ch7.test.js`（改名后 `tasks-ch6.test.js`）第 141–143 行：`chapter 6 is listed with 12 tasks`，`CHAPTERS.some(c => c.n === 6 && c.name === '逻辑与加法器')`，`chapter === 6`。
- 原 `tasks-ch8.test.js`（改名后 `tasks-ch7.test.js`）第 47、48、278 行：`n === 7`，`chapter === 7`。
- 原 `tasks-ch5.test.js`（改名后 `tasks-ch3-faults.test.js`）：第一条测试改成 `TASKS.filter(t => t.chapter === 3).map(t => t.id)` 以 `[21, 22]` 结尾，循环里去掉 23；`task 23` 的测试搬到 `test/tasks-ch5.test.js`；`accuse` 循环里的 `[21, 22, 23]` 保留（id 查找不受章影响）。
- `test/view-tasks.test.js`：`第 7 章 · 电容与定时`，`第 6 章 · 逻辑与加法器`，`<h3>` 7 个，`data-task=` 46 个；`inTask(20)` 两处改成 `inTask(TASKS.indexOf(T(21)))`（在文件顶部加 `import { TASKS } from '../lib/tasks.js'; const T = id => TASKS.find(t => t.id === id);`），`inTask(11)`→`inTask(TASKS.indexOf(T(12)))`，`inTask(15)`→`inTask(TASKS.indexOf(T(16)))`。
- `test/editor-tasks.test.js:220`：读上下文，若 `index: 11` 指第 12 关则改成 `TASKS.indexOf(T(12))`。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/ 2>&1 | tail -5`
Expected: FAIL（CHAPTERS 长度、顺序、章号）

- [ ] **Step 4: 搬文件、改 `tasks.js`**

`git mv` 四个关卡文件和四个测试文件；按 Files 一节改导出名、`chapter` 字段和数组顺序；`tasks.js` 的 import、`CHAPTERS`、`TASKS` 按 Interfaces 改。`ch5-spdt-fuse.js` 顶部注释改成 `// 第 5 章：单刀双掷开关与保险丝。`，`ch3-faults.js` 顶部注释改成 `// 第 3 章末尾：用电压表找故障。预置电路里藏着一处故障，先量再指认。`

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/ 2>&1 | tail -5`
Expected: 全部 pass，fail 0

- [ ] **Step 6: 提交**

```bash
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 add -A circuit
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 commit -m "refactor(circuit): 课程重排成 7 章，找故障并入电表章，挑战章改为单刀双掷开关与保险丝"
```

---

### Task 2: faultTask 规则：候选类型、量过即可、提示文案

**Files:**
- Modify: `circuit/lib/task-kit.js`（`faultTask`、`MEASURE_FIRST`）
- Modify: `circuit/lib/editor.js:241-248`（指认错误的提示）
- Modify: `circuit/lib/tasks/ch3-faults.js`、`circuit/lib/tasks/ch5-spdt-fuse.js`（给 21、22、23 加 `suspect`）
- Test: `circuit/test/tasks-ch3-faults.test.js`，`circuit/test/editor-tasks.test.js`

**Interfaces:**
- Produces: `faultTask({ id, chapter, name, goal, how, palette, variants, preset, suspect })`，`suspect = { types: string[], name: string }`，`types` 里 `'wire'` 表示导线，其余是元件 type。21 用 `{ types: ['lamp'], name: '灯' }`，22 用 `{ types: ['wire'], name: '导线' }`，23 用 `{ types: ['spdt'], name: '开关' }`。
- Produces: 返回的 task 带 `suspect` 字段原样透出；`initProgress()` 返回 `{ found: false, probed: [] }`；`check` 不再写 `measured`；`hint` 在 `probed` 为空时是 `'先用电压表量一量'`，否则 `null`。
- Produces: `accuse(progress, target, ws)`：目标不是预置、或类型不在 `suspect.types`、或没量过 → `null`；带 `fault` → `'right'`；否则 `'wrong'`。
- Produces: `editor.js` 的 `WRONG_HINT = '不是它。好的地方是 0 V，坏的地方才是 3 V。换一道再来'`，指认错时 `task.hint` 等于它。
- Consumes: `probedItems(c)`（已有）。

- [ ] **Step 1: 改 `test/tasks-ch3-faults.test.js`**

- 第一条测试里 `initProgress()` 断言改成 `{ found: false, probed: [] }`；加 `assert.deepEqual(T(21).suspect, { types: ['lamp'], name: '灯' })`，22 为 `{ types: ['wire'], name: '导线' }`。
- 删掉 `metersRead: ...` 测试（`metersRead` 本身保留给第 3 章其他关）。
- `accuse` 测试：`checked.progress.measured` 的断言删掉；量电池后 `checked.hint` 应为 `null`（量过东西了）；新增 `assert.equal(t.accuse(checked.progress, { kind: 'part', id: bat }, wsb), null, 'battery is not a suspect')`。
- `check: hint before measuring...` 改名为 `check: hint until something is probed`：初始 `hint === '先用电压表量一量'`；电压表接在电池两端后 `hint === null`，`progress.probed` 含 `part:<bat>`；拆掉电压表后 `probed` 仍含它、`hint` 仍 `null`；`found: true` 时 `passed`。
- 新增 `0 V reading still counts as probed`：21 关变体 `'L1'`，电压表接 L2 两端，`evaluateTask` 后 `progress.probed` 含 `part:<L2>` 且 `hint === null`。

- [ ] **Step 2: 加 `test/editor-tasks.test.js` 的指认测试**

```js
test('accuse wrong suspect restarts with the rule hint; non-suspect is ignored', () => {
  let s = inTask(TASKS.indexOf(T(21)));
  const lampBad = s.task.circuit.parts.find(p => p.type === 'lamp' && p.fault);
  const lampGood = s.task.circuit.parts.find(p => p.type === 'lamp' && !p.fault);
  const bat = s.task.circuit.parts.find(p => p.type === 'battery');
  s = across(s, { part: bat.id, term: 'p' }, { part: bat.id, term: 'n' });
  const before = s;
  s = play(s, { type: 'accuse', target: { kind: 'part', id: bat.id } });
  assert.equal(s, before);
  s = across(s, { part: lampGood.id, term: 'a' }, { part: lampGood.id, term: 'b' });
  s = play(s, { type: 'accuse', target: { kind: 'part', id: lampGood.id } });
  assert.equal(s.task.hint, '不是它。好的地方是 0 V，坏的地方才是 3 V。换一道再来');
  assert.deepEqual(s.task.progress, { found: false, probed: [] });
});
```

（`inTask`、`across`、`play` 若该文件没有，从 `test/view-tasks.test.js` 复制同名 helper。）

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/tasks-ch3-faults.test.js test/editor-tasks.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 4: 实现**

- `task-kit.js`：`MEASURE_FIRST = '先用电压表量一量'`；`faultTask` 按 Interfaces 重写（去掉 `measured`，`accuse` 先查 `suspect.types.includes(target.kind === 'wire' ? 'wire' : item.type)`）。`metersRead` 保留。
- `editor.js`：`const WRONG_HINT = '不是它。好的地方是 0 V，坏的地方才是 3 V。换一道再来'`，`case 'accuse'` 用它。
- 三关加 `suspect`。

- [ ] **Step 5: 跑全部测试确认通过**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/ 2>&1 | tail -5`
Expected: fail 0

- [ ] **Step 6: 提交**

```bash
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 add -A circuit
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 commit -m "feat(circuit): 找故障只能指认题目里那类零件，接上电压表就算量过"
```

---

### Task 3: 新关 48、重做 22、四关题面与说明

**Files:**
- Modify: `circuit/lib/tasks/ch3-faults.js`（新增 48 放数组首位；重写 22 的 preset；21 改 goal/how）
- Modify: `circuit/lib/tasks/ch5-spdt-fuse.js`（23 改 goal/how）
- Modify: `circuit/lib/tasks.js`（无需改：48 在 `CH3_FAULTS` 数组里自然进入顺序）
- Test: `circuit/test/tasks-ch3-faults.test.js`，`circuit/test/tasks-ch5.test.js`，`circuit/test/tasks.test.js`

**Interfaces:**
- Produces: 关卡字段 `how: string`（说明，可选），四关的 `goal` 和 `how` 逐字如下：
  - 48 `name: '断开的地方'`，`goal: '量一量断开的开关'`，`how: '开关断开，灯不亮。用电压表量开关两端，再量灯两端。断开的地方能量到电池的 3 V，好好的灯是 0 V。'`
  - 21 `goal: '找出坏掉的那一盏灯'`，`how: '三盏灯串联，有一盏灯丝断了，所以全都不亮。用电压表挨个量，读到 3 V 的就是它。点它，再按『就是它坏了』。'`
  - 22 `name: '哪根线断了'`，`goal: '找出断掉的那根导线'`，`how: '灯都不亮，可是灯和开关都是好的，是一根导线里面断了。把电压表接在一根导线的两头，读到 3 V 的就是它。点那根线，再按『就是它坏了』。'`
  - 23 `goal: '找出坏掉的那个开关'`，`how: '这是你上一关搭的楼梯灯，可是有一个开关坏了。先拨一拨：两个开关拨到同一边时灯该亮，哪种拨法不亮？把电压表接在那个开关的公共端（没标字母的那一头）和它拨到的那一边，读到 3 V 的就是坏的。'`
- Produces: 48 = `{ id: 48, chapter: 3, palette: { voltmeter: 1 }, lockPreset: true, variants: undefined, preset(), initProgress: () => ({ probed: [], sawOpen: false }), check }`。preset：`B` 电池 2 节、`S` 开关 `closed: false`、`L` 灯，三根预置导线串成一圈。`check`：把 `probedItems(ws.circuit)` 并入 `progress.probed`；若当前有电压表量在开关两端（`probedItems` 含 `part:<S>`）且该电压表 `|v| ≥ 2.5` 则 `sawOpen = true`；通过条件 `probed` 含 `part:<S>` 和 `part:<L>` 且 `sawOpen`；`hint`：`probed` 为空时 `'先用电压表量一量'`，否则 `null`。没有 `accuse`。
- Produces: 22 = `faultTask({ id: 22, chapter: 3, variants: [0, 1, 2, 3], suspect: { types: ['wire'], name: '导线' }, palette: { voltmeter: 1 }, preset: wiresPreset })`。`wiresPreset(bad)`：`B` 电池 2 节、`S` 开关 `closed: true`、`L1`、`L2` 灯；四根预置导线依次 `B.p→S.a`、`S.b→L1.a`、`L1.b→L2.a`、`L2.b→B.n`，第 `bad` 根带 `{ fault: 'open' }`；每根导线都给 `via` 绕开元件（坐标由实现者定，要求每根至少 4 格长）。不含 `node` 元件。
- Produces: `TASKS` id 顺序在 16 后插入 48：`[1..16, 48, 21, 22, 17, ...]`。

- [ ] **Step 1: 写测试**

`test/tasks-ch3-faults.test.js` 新增/改写：

```js
test('chapter 3 ends with 48, 21, 22', () => {
  assert.deepEqual(TASKS.filter(t => t.chapter === 3).map(t => t.id), [11, 12, 13, 14, 15, 16, 48, 21, 22]);
});

test('task 48: preset switch open and lamp dark; measuring switch (3 V) then lamp (0 V) passes', () => {
  const t = T(48);
  assert.equal(t.accuse, undefined);
  const c = t.preset();
  const S = ofType(c, 'switch')[0], L = ofType(c, 'lamp')[0];
  assert.equal(S.params.closed, false);
  assert.ok([...c.parts, ...c.wires].every(x => x.preset));
  let r = evaluateTask(t, t.initProgress(), wsOf(c));
  assert.equal(r.hint, '先用电压表量一量'); assert.equal(r.passed, false);
  const onS = withVoltmeter(c, S.id, 'a', S.id, 'b');
  assert.ok(Math.abs(solve(onS.circuit, new Set()).parts[onS.vid].v) >= 2.9);
  r = evaluateTask(t, r.progress, wsOf(onS.circuit));
  assert.equal(r.passed, false); assert.equal(r.hint, null);
  const onL = withVoltmeter(c, L.id, 'a', L.id, 'b');
  assert.ok(Math.abs(solve(onL.circuit, new Set()).parts[onL.vid].v) < 0.1);
  r = evaluateTask(t, r.progress, wsOf(onL.circuit));
  assert.equal(r.passed, true);
});

test('task 48: measuring the lamp only, or the switch only while closed, does not pass', () => {
  const t = T(48);
  const c = t.preset();
  const S = ofType(c, 'switch')[0], L = ofType(c, 'lamp')[0];
  const onL = withVoltmeter(c, L.id, 'a', L.id, 'b');
  assert.equal(evaluateTask(t, t.initProgress(), wsOf(onL.circuit)).passed, false);
  const closed = withParams(c, { [S.id]: { closed: true } });
  const onS = withVoltmeter(closed, S.id, 'a', S.id, 'b');
  let r = evaluateTask(t, t.initProgress(), wsOf(onS.circuit));
  r = evaluateTask(t, r.progress, wsOf(withVoltmeter(closed, L.id, 'a', L.id, 'b').circuit));
  assert.equal(r.passed, false);
});

test('task 22: four long preset wires, one open per variant, no node parts, all lamps dark', () => {
  const t = T(22);
  assert.deepEqual(t.variants, [0, 1, 2, 3]);
  assert.deepEqual(t.palette, { voltmeter: 1 });
  for (const v of t.variants) {
    const c = t.preset(v);
    assert.equal(c.wires.length, 4);
    assert.equal(ofType(c, 'node').length, 0);
    assert.equal(faulty(c).length, 1);
    assert.ok(c.wires.includes(faulty(c)[0]));
    assert.ok(ofType(c, 'switch')[0].params.closed);
    const ws = wsOf(c, v);
    assert.ok(ofType(c, 'lamp').every(l => !lampLit(ws.result, new Set(), l.id)));
    for (const w of c.wires) {
      const m = withVoltmeter(c, w.a.part, w.a.term, w.b.part, w.b.term);
      const reading = Math.abs(solve(m.circuit, new Set()).parts[m.vid].v);
      if (w.fault) assert.ok(reading >= 2.9, `variant ${v} bad wire reads ${reading}`);
      else assert.ok(reading < 0.1, `variant ${v} good wire reads ${reading}`);
    }
    for (const l of ofType(c, 'lamp')) {
      const m = withVoltmeter(c, l.id, 'a', l.id, 'b');
      assert.ok(Math.abs(solve(m.circuit, new Set()).parts[m.vid].v) < 0.1);
    }
  }
});

test('goal and how texts', () => {
  assert.equal(T(48).goal, '量一量断开的开关');
  assert.equal(T(21).goal, '找出坏掉的那一盏灯');
  assert.equal(T(22).name, '哪根线断了');
  assert.ok(T(21).how.includes('读到 3 V 的就是它'));
  assert.ok(T(22).how.includes('点那根线'));
});
```

删掉旧的 `task 22: fault is on a branch wire...` 和 `task 22: at least 3 candidate wires...` 两条；`21, 22: at least one lamp is dark` 保留。`accuse` 循环测试里 22 的 `other` 仍是「没有 fault 的预置导线」，照旧可用。

`test/tasks-ch5.test.js`：加 `assert.equal(T(23).goal, '找出坏掉的那个开关'); assert.ok(T(23).how.includes('公共端'))`。

`test/tasks.test.js`：名字表第 3 章末尾改成 `'断开的地方', '哪盏灯坏了', '哪根线断了'`，id 表在 16 后插 48，`per` 改 `[5, 5, 9, 5, 6, 12, 5]`，`existing tasks keep curriculum ids and names` 加 `48: '断开的地方'`、`22: '哪根线断了'`。`test/view-tasks.test.js` 的 `data-task=` 数改 47。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/tasks-ch3-faults.test.js test/tasks.test.js 2>&1 | tail -5`
Expected: FAIL（T(48) 不存在）

- [ ] **Step 3: 实现 48、重做 22、改四关文字**

按 Interfaces 写。48 的 `check` 里取电压表读数用 `ws.result.parts[v.id].v`（`ws.result.ok` 已由 `evaluateTask` 保证）。22 的 `via` 坐标参考 `ch3-faults.js` 里 21 的写法，电池在左下、开关左上、两盏灯上排，回程导线从右侧绕到底部。

- [ ] **Step 4: 跑全部测试确认通过**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/ 2>&1 | tail -5`
Expected: fail 0

- [ ] **Step 5: 提交**

```bash
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 add -A circuit
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 commit -m "feat(circuit): 找故障加教学关「断开的地方」，「哪根线断了」重做，四关题面加说明"
```

---

### Task 4: 题目栏说明行、指认按钮状态、锁定件隐藏删除旋转

**Files:**
- Modify: `circuit/lib/taskbar.js`（`taskbarHtml`、`taskbarCacheKey`）
- Modify: `circuit/styles.css`（`.task-how`）
- Modify: `circuit/view.js:166-215`（`renderPanel`）
- Test: `circuit/test/view-tasks.test.js`

**Interfaces:**
- Consumes: `task.how`（Task 3）、`task.suspect`（Task 2）、`progress.probed`。
- Produces: `taskbarHtml` 在标题行之后、答题行之前输出 `<div class="task-how">${task.how}</div>`（仅当 `task.how`）。
- Produces: 指认行的四种状态（`task.accuse` 存在时）：
  1. 已通过：按钮 `disabled`，无说明。
  2. 没选中、或选中的不是预置件：按钮 `disabled`，说明 `点一下你觉得坏的那个，再按这里`。
  3. 选中的预置件类型不在 `task.suspect.types`：按钮 `disabled`，说明 `这关坏的是${task.suspect.name}，不是它`。
  4. 选中的是候选但没量过：按钮 `disabled`，说明 `先把电压表接在它两端量一量`。
  5. 候选且量过：按钮可点，无说明。
  说明放在按钮后同一行 `<span>` 里，不再用 `title`。
- Produces: `taskbarCacheKey` 把 `selectedIsPreset` 换成「选中件的 kind:type 或 null」，去掉 `measured`。
- Produces: `view.js` 的 `renderPanel`：当 `state.mode === 'task'` 且当前关 `lockPreset` 且选中的元件/导线/连接点 `preset` 为真时，不输出「旋转 90°」「删除」按钮（切换、换新、滑块照常）。

- [ ] **Step 1: 改 `test/view-tasks.test.js`**

- `taskbarHtml: accuse button disabled until measured and a preset item is selected` 改成：未选中时 `disabled` 且含 `点一下你觉得坏的那个，再按这里`。
- `taskbarHtml: accuse needs the selected item probed; disabled after passing` 改成：量电池后选中电池 → `disabled` 且含 `这关坏的是灯，不是它`；选中没量过的坏灯 → `disabled` 且含 `先把电压表接在它两端量一量`；量过坏灯再选中 → 不 `disabled` 且三种说明都不出现；`passed` → `disabled`。去掉 `progress.measured` 断言。
- 新增 `taskbarHtml: how line shows for fault levels only`：`inTask(TASKS.indexOf(T(21)))` 的 HTML 含 `<div class="task-how">` 和 `读到 3 V 的就是它`；`inTask(0)` 不含 `task-how`。
- `taskListHtml` 测试：`第 7 关 · 断开的地方` 出现在 `第 3 章 · 电表` 之后、`第 4 章` 之前；`第 2 关 · 失灵的开关` 出现在 `第 5 章 · 单刀双掷开关与保险丝` 之后。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/view-tasks.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: 实现 `taskbar.js`、`styles.css`、`view.js`**

`.task-how { font-size: 1rem; color: #4a3f33; line-height: 1.5; }` 放在 `.task-title` 规则后。`view.js` 里判断 `const lockedItem = task?.lockPreset && item.preset`，三处按钮行（连接点、元件、导线）按它省略旋转/删除。

- [ ] **Step 4: 跑全部测试确认通过**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/ 2>&1 | tail -5`
Expected: fail 0

- [ ] **Step 5: 浏览器核对 `view.js`（无单测）**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 && python3 -m http.server 8765 --bind 127.0.0.1`，打开 `http://127.0.0.1:8765/circuit/`，小任务 → 选关 → 第 3 章第 8 关，点一盏灯：面板只有标题，没有「删除」「旋转 90°」；第 6 章第 8 关（全加器）点预置开关：有「切换」，没有删除旋转。

- [ ] **Step 6: 提交**

```bash
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 add -A circuit
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 commit -m "feat(circuit): 题目栏显示说明行，指认按钮按状态给说明，锁定件不显示删除旋转"
```

---

### Task 5: 第 2 章三关改 3 盏灯、2 个开关

**Files:**
- Modify: `circuit/lib/tasks/ch2-series.js`（6、7、10）
- Test: `circuit/test/tasks-ch2.test.js`

**Interfaces:**
- Produces: 6 `palette: { battery: 1, lamp: 3 }`，判定 `lamps.length >= 3 && 全亮`，其余不变。
- Produces: 7 `palette: { battery: 1, lamp: 3, switch: 2 }`，`goal: '每个开关只管一盏灯，第三盏一直亮'`。判定：`anySwitchPair(ws, (t, br) => ...)` 里存在三盏互不相同的灯 `a, b, c`，满足 `truth(k => lampLit(t[k], br, a.id), ['tt', 'tf'])`、`truth(k => lampLit(t[k], br, b.id), ['tt', 'ft'])`、`truth(k => lampLit(t[k], br, c.id), ['tt', 'tf', 'ft', 'ff'])`。
- Produces: 10 `palette: { battery: 1, lamp: 3, switch: 1 }`，判定 `lamps.length >= 3`，三盏 `on` 时都亮且 `p >= BRIGHT_P`，`off` 时都不亮。`HINT10 = '灯不亮或者太暗，换个接法让它们都亮亮的'`，触发条件：某个开关 `off` 时没有灯亮，`on` 时每盏灯 `p > 1e-4`（有电流）但不是每盏 `p >= BRIGHT_P`。

- [ ] **Step 1: 改 `test/tasks-ch2.test.js`**

- `task 6`：`series2`/并联改成三盏灯 `L1, L2, L3`（串联链 `B.p→L1.a, L1.b→L2.a, L2.b→L3.a, L3.b→B.n`；并联三条支路）；新增断言：只接两盏灯并联 `run(6, par2).passed === false`。
- `task 7`：通过电路：`B.p→L1.a, L1.b→B.n`（常亮），`B.p→S1.a, S1.b→L2.a, L2.b→B.n`，`B.p→S2.a, S2.b→L3.a, L3.b→B.n`；失败电路一：两个开关串在干路上；失败电路二：只有一个开关管一盏、另一个开关不接。
- `task 10`：`par`/`ser` 改三盏灯；`ser` 的 `hint === '灯不亮或者太暗，换个接法让它们都亮亮的'`；两盏灯并联 `passed === false`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/tasks-ch2.test.js 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: 实现**

按 Interfaces 改 `ch2-series.js`；注释里的功率数改成实测（1 节电池 3 盏串联每盏约 0.02 W，不亮）。

- [ ] **Step 4: 跑全部测试确认通过**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/ 2>&1 | tail -5`
Expected: fail 0

- [ ] **Step 5: 提交**

```bash
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 add -A circuit
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 commit -m "feat(circuit): 第 2 章改成 3 盏灯，一个亮一个灭用两个开关"
```

---

### Task 6: README 数字与浏览器走查

**Files:**
- Modify: `README.md:29`

- [ ] **Step 1: 改 README**

「带 7 章 36 关小任务，含预测计算、找故障，最后用继电器搭电铃和全加器」改成「带 7 章 47 关小任务，含预测计算、用电压表找故障，用继电器搭电铃、全加器和计数器，用电容做闪光灯」。

- [ ] **Step 2: 全量测试**

Run: `cd /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2/circuit && node --test test/ 2>&1 | tail -5`
Expected: fail 0

- [ ] **Step 3: 浏览器走查**

起 `python3 -m http.server 8765` 于 worktree 根目录，依次玩：第 2 章第 1 关（三盏灯串联和并联，看光晕差别）、第 3 章第 7、8、9 关（按说明量、指认）、第 5 章第 2 关（拨开关、量开关、指认）、选关列表 7 章。记录任何题面显示溢出或按钮状态不对的问题，修掉。

- [ ] **Step 4: 提交**

```bash
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 add -A
git -C /Users/jialiu/Projects/saisai.me/.worktrees/circuit-curriculum-v2 commit -m "docs: 电路实验室关卡数更新"
```
