# 电路实验室 · 第 7 章「逻辑与加法器」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增继电器、按钮、双刀双掷开关、数字显示器四个元件，以及第 7 章 7 关（id 30–36），从显示器、半加器一路到全加器。

**Architecture:** 求解器 `solve` 多收一个「哪些继电器吸合」的集合，继电器线圈和触点分属不同连通分量。继电器吸合状态放在工作区 `relays`（和 `damage` 并列），由 `tick` 按 0.05 s 延时推进，翻转后重新 `settle`。关卡判定用 `stableSolve` 对每种输入组合迭代到继电器稳定，不模拟时间。按钮按下状态存在 `params.pressed`，按下/松开不进撤销历史。

**Tech Stack:** 原生 ES modules、SVG、Web Audio；测试 `node:test`。

**Spec:** `docs/superpowers/specs/2026-11-14-circuit-logic-chapter-design.md`

## Global Constraints

- 新增物理常数加进 `PHYS`（`circuit/lib/parts.js`）：`RELAY_R: 30`、`RELAY_PULL_A: 0.02`、`RELAY_RELEASE_A: 0.01`、`RELAY_DELAY: 0.05`、`DISPLAY_R: 1000`、`DISPLAY_ON_V: 0.75`。现有常数不改。
- 没有新元件的电路，求解结果、现有 29 关判定和行为完全不变；全量测试 `node --test circuit/test/*.test.js` 一直保持全绿（现有 212 个）。
- 继电器状态、按钮按下都不改变撤销历史；继电器翻转不改 `circuit.rev`。
- 新元件 type 名固定：`relay`、`button`、`dpdt`、`display`；端点名固定：relay `x y com no nc`，button `a b`，dpdt `c1 a1 b1 c2 a2 b2`，display `i1 i2 i4 i8 g`。
- 显示器：0–9 显示数字，10–15 显示 `E`，求解失败显示 `-`。
- 界面文字用中文；代码注释风格、密度跟现有文件一致。
- 提交到 GitHub，作者身份用本仓库已配置的 `childe`，不能出现公司邮箱/姓名。

## Review Focus

1. 继电器所在的电路发生电池短路（例如触点把电池正负极接通）：求解仍然成功，电池照常报警，画板不变灰。→ Task 1 测试 `relay contact short still solves and alarms`。
2. 孩子按住按钮时撤销、或松手事件丢失（pointercancel）：按钮必须回到松开状态，不能卡在按下。→ Task 3 测试 `undo restores a released button`；Task 4 的 app 手势在 cancel 时也发 `release`。
3. 删除一个正吸合的继电器、或撤销到它不存在的版本：残留的 `relays.on` / `hold` 被清掉，不影响新放的同 id 元件。→ Task 2 测试 `relay state of removed parts is dropped`。
4. 显示器公共端悬空或接反：显示 0，不显示乱数。→ Task 1 测试 `display reads 0 when reversed or common floating`。
5. 第 36 关每次操作都重新判定（8 种组合 × 迭代）：一次判定在参考接法上 < 50 ms，拖导线不卡。→ Task 7 测试 `full adder check is fast`。

---

### Task 1: 新元件的求解

**Files:**
- Modify: `circuit/lib/parts.js`（`PHYS` 新常数；`PARTS` 加四个元件；每个元件可选 `groups`）
- Modify: `circuit/lib/solve.js`
- Test: `circuit/test/solve-logic.test.js`

**Interfaces:**
- Produces:
  - `PARTS.relay`：`label: '继电器'`，terms `['x','y','com','no','nc']`，`groups: [['x','y'],['com','no','nc']]`，`params: {}`，`lever: false`。
  - `PARTS.button`：`label: '按钮'`，terms `['a','b']`，`params: { pressed: { default: false, options: [false, true] } }`，`lever: true`。
  - `PARTS.dpdt`：`label: '双刀双掷开关'`，terms `['c1','a1','b1','c2','a2','b2']`，`groups: [['c1','a1','b1'],['c2','a2','b2']]`，`params: { to: { default: 'a', options: ['a','b'] } }`，`lever: true`。
  - `PARTS.display`：`label: '数字显示器'`，terms `['i1','i2','i4','i8','g']`，`params: {}`，`lever: false`。
  - 端点格点坐标由实现者定：同一元件端点互不重合，都在 x、y ∈ [-2, 2]；继电器线圈在左（x = -2），触点在右；双刀双掷两组上下排列；不压在 `LEVER_RECT`（x ±0.6、y -1.8…-0.6）里。
  - 本任务**不**把新 type 加进 `PART_TYPES`（Task 4 加，届时有画法）。
  - `solve(circuit, broken = new Set(), opts = {})`：`opts.on` 是吸合的继电器 id 的 `Set`（缺省空集），`opts.maxIter` 缺省 100。返回值多一个 `relayKey: string`（吸合 id 排序后逗号连接，同 `brokenKeyOf`）。
  - `export function relayKeyOf(on: Set<string>): string`。
  - `export function connectivity(circuit): (termKey: string) => string`：按导线、重合端点和元件内部（按 `groups`）连通，返回 `'partId.term'` → 所在分量的根。
  - `result.parts[displayId]` 多一个 `value`（0–15 的整数）。
  - `result.parts[relayId]` 的 `v`、`i` 是线圈（x→y）的电压、电流。
  - `result.parts[dpdtId]` 读第一组（c1 与当前接通端）。

- [ ] **Step 1: 写失败测试 `circuit/test/solve-logic.test.js`**（用 `test/helpers.js` 的 `build`）

```js
test('relay coil draws current, contact follows opts.on', () => {
  const c = build({ parts: { B1: ['battery'], K: ['relay'], B2: ['battery'], L: ['lamp'] },
    wires: [['B1.p', 'K.x'], ['K.y', 'B1.n'], ['B2.p', 'K.com'], ['K.no', 'L.a'], ['L.b', 'B2.n']] });
  const off = solve(c);
  assert.ok(Math.abs(off.parts.K.i - 1.5 / 30.1) < 1e-3);
  assert.ok(off.parts.L.p < 1e-6);
  const on = solve(c, new Set(), { on: new Set(['K']) });
  assert.ok(on.parts.L.p > 0.2);
  assert.equal(on.relayKey, 'K');
});
test('relay nc conducts when released', () => { /* 同上接 nc：off 时灯亮，on 时灯灭 */ });
test('relay coil and contacts are separate components', () => {
  // 线圈回路电池 B1、触点回路电池 B2，两边互不相连：connectivity 里 K.x 与 K.com 根不同
});
test('button conducts only when pressed', () => { /* pressed:false 灯灭，pressed:true 灯亮 */ });
test('dpdt switches both poles together', () => {
  // 两盏灯分别接 a1、a2：to 'a' 两灯都亮；to 'b' 都灭
});
test('display value sums powered inputs', () => {
  // 电池 + 接 i1、i4，- 接 g → value 5；再接 i8 → 13
});
test('display reads 0 when reversed or common floating', () => {
  // 电池 - 接 i1、+ 接 g → 0；g 悬空、+ 接 i2 → 0
});
test('relay contact short still solves and alarms', () => {
  // B2.p→K.com，K.no→B2.n，on 集含 K：result.ok，|B2.i| > PHYS.SHORT_A
});
test('circuits without new parts solve exactly as before', () => {
  // 取 engine.test.js 里的 fuse/lamp 电路，solve(c) 与 solve(c, new Set(), { on: new Set() }) 的 nodes 深相等
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test circuit/test/solve-logic.test.js`
Expected: FAIL（`PARTS.relay` 不存在 / `solve` 不认 `opts.on`）

- [ ] **Step 3: 在 `parts.js` 加常数和四个元件；在 `solve.js` 实现**

要点（不是现成代码能推出来的部分）：
- `components()`：同一元件按 `PARTS[type].groups ?? [terms]` 分组合并，不再把所有端点并在一起。
- 一个元件可能跨两个分量：`partsByRoot` 要把元件挂到它每个 group 所在的根下；`solveComponent` 只盖章两端都在本分量 `nodeKeys` 里的电导（不在本分量的端点不能被当成参考地）。
- `conductancesOf(part, broken, on)`：relay → 线圈 `['x','y',1/RELAY_R]`，加 `['com', on.has(id) ? 'no' : 'nc', 1/R_CLOSED]`；button → pressed 时 `['a','b',1/R_CLOSED]`；dpdt → `['c1', to+'1']`、`['c2', to+'2']`；display → 每个输入到 `g` 一条 `1/DISPLAY_R`。
- `readPart` display：`value = Σ w`，其中 `V(iw) - V(g) ≥ DISPLAY_ON_V`；`v/i/p` 取 0。
- `connectivity` 复用 `components()`。

- [ ] **Step 4: 运行新测试和全量测试**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/parts.js circuit/lib/solve.js circuit/test/solve-logic.test.js
git commit -m "feat(circuit): 求解器支持继电器、按钮、双刀双掷开关和数字显示器"
```

---

### Task 2: 继电器状态与定时推进

**Files:**
- Create: `circuit/lib/relay.js`
- Modify: `circuit/lib/engine.js`
- Test: `circuit/test/engine-relay.test.js`

**Interfaces:**
- Consumes: Task 1 的 `solve(..., { on })`、`relayKeyOf`、`result.parts[relayId].i`。
- Produces（`relay.js`）：
  - `createRelays(): { on: {}, hold: {}, flips: 0 }`
  - `relayOnSet(r): Set<string>`
  - `wantOn(circuit, result, onSet): Set<string>`：按回差判断每个继电器想要的状态。当前吸合的：|i| ≥ `RELAY_RELEASE_A` 保持；当前释放的：|i| ≥ `RELAY_PULL_A` 才想吸合。
  - `advanceRelays(r, result, dt, circuit)`：结果过期（`!ok`、`rev` 不同、`relayKey !== relayKeyOf(relayOnSet(r))`）原样返回；想要状态与当前不同就累计 `hold[id] += dt`，达到 `RELAY_DELAY` 翻转、`flips += 1`、清 hold；条件消失清 hold；不在电路里的 id 清掉；没有变化时返回同一个对象。
- Produces（`engine.js`）：
  - `settle(circuit, damage, relays = createRelays())`：求解时传 `{ on: relayOnSet(relays) }`，返回值多 `relays`（只清掉已不存在的 id，不翻转）。
  - `tick(ws, dt)`：先推进 damage（同现在），再 `advanceRelays`；吸合集合变了就 `settle(ws.circuit, d, r)`；只有 hold/flips 变了返回 `{ ...ws, relays: r }`。

- [ ] **Step 1: 写失败测试 `circuit/test/engine-relay.test.js`**

```js
test('relay pulls in only after RELAY_DELAY', () => {
  // Task 1 的「开关→线圈，触点点灯」电路（开关合上）：settle 后灯灭；tick 0.03 灯仍灭；再 tick 0.03 灯亮，relays.on.K === true
});
test('relay releases after delay when coil current drops', () => { /* 合上吸合后，setParam 断开开关再 settle（传入原 relays），tick 0.06 后释放 */ });
test('hysteresis: 15 mA keeps a pulled relay but does not pull a released one', () => {
  // 线圈串 47Ω 电阻，1 节电池下线圈电流约 19.5 mA（先用 solve 断言在 10–20 mA 之间）
});
test('self-interrupting relay keeps flipping and never greys the board', () => {
  // B.p→K.x，K.y→K.nc，K.com→B.n：连续 tick 0.05 共 20 次，flips ≥ 8，每次 ws.result.ok 为真
});
test('relay flip does not bump circuit.rev', () => {});
test('relay state of removed parts is dropped', () => { /* 吸合后 removePart，再 settle：relays.on 里没有该 id */ });
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test circuit/test/engine-relay.test.js`
Expected: FAIL（`../lib/relay.js` 不存在）

- [ ] **Step 3: 实现 `relay.js` 和 `engine.js` 改动**

- [ ] **Step 4: 运行全量测试**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/relay.js circuit/lib/engine.js circuit/test/engine-relay.test.js
git commit -m "feat(circuit): 继电器带延时吸合释放，定时循环推进"
```

---

### Task 3: 编辑器：按钮按住、双刀双掷切换、继电器状态贯通

**Files:**
- Modify: `circuit/lib/editor.js`
- Test: `circuit/test/editor-logic.test.js`

**Interfaces:**
- Consumes: Task 2 的 `settle(circuit, damage, relays)`、`createRelays`。
- Produces：
  - 新动作 `{ type: 'press', id }`、`{ type: 'release', id }`：只对 `button` 生效，`setParam(c, id, 'pressed', true/false)`，按 `coalesce: true` 提交（不进撤销历史）；预置锁定的按钮也能按。
  - `toggle` 动作支持 `dpdt`（`to` 在 'a'、'b' 间切换）。
  - 所有保留原电路的 `settle` 调用（`commit`、`repair`、`undo`）传 `space.relays`；新建电路的（`makeSpace`、`restartTask`、`confirmClear`）用新的 `createRelays()`。
  - `undo` 恢复的快照里所有按钮 `pressed` 置为 false。

- [ ] **Step 1: 写失败测试**

```js
test('press and release do not touch history', () => { /* 放按钮 → history 长度 n；press、release 后仍为 n，pressed 正确 */ });
test('undo restores a released button', () => { /* press 时再放一个灯（进历史），undo 后按钮 pressed === false */ });
test('toggle flips dpdt', () => {});
test('relays survive commits but reset on clear and task restart', () => {
  // 自由模式搭吸合电路，tick 到吸合，再 place 一个灯：relays.on 仍含该继电器；confirmClear 后 relays.on 为空
});
test('press on a non-button is ignored', () => {});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test circuit/test/editor-logic.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

- [ ] **Step 4: 运行全量测试**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/editor.js circuit/test/editor-logic.test.js
git commit -m "feat(circuit): 编辑器支持按住按钮、切换双刀双掷开关"
```

---

### Task 4: 画法、视觉、交互和声音

**Files:**
- Modify: `circuit/lib/parts.js`（`PART_TYPES` 末尾加 `'relay', 'button', 'dpdt', 'display'`）
- Modify: `circuit/lib/drawings.js`、`circuit/lib/viewmodel.js`、`circuit/view.js`、`circuit/app.js`、`circuit/sound.js`、`circuit/styles.css`（如需要）
- Test: `circuit/test/drawings.test.js`、`circuit/test/viewmodel.test.js`、`circuit/test/static.test.js`

**Interfaces:**
- Consumes: Task 1–3。
- Produces：
  - `partVisual(part, reading, damage, ok, relays)`：多一个 `vis.on`（`!!relays?.on?.[part.id]`）；display 的 `vis.text`：`ok` 时 value ≤ 9 为数字字符串、> 9 为 `'E'`，`!ok` 时 `'-'`。view 调用处传 `space.relays`。
  - `drawPart` 四种新 type 两种画法：relay 铁片随 `vis.on` 变化，触点旁标常开/常闭；button 按下时按钮帽位置不同；dpdt 两组触点 + 虚线连杆，随 `to` 变化；display 显示 `vis.text`。
  - 参数面板：`button` 不显示「切换」按钮（其余 lever 元件照旧）。
  - `app.js`：在 `button` 的拨片区按下 → `dispatch({ type: 'press', id })`，并记在手势里；`endGesture` 不论 cancelled 与否，都对记下的按钮发 `release`，且不再发 `toggle`。
  - `sound.js`：`createBuzzer()` 返回值多 `click(muted)`，播一声约 20 ms 的短促咔哒；`app.js` 每帧比较活动工作区的 `relays.flips`，变大就 `click(state.muted)`。

- [ ] **Step 1: 补失败测试**

```js
// drawings.test.js 'state shows up in drawing' 里追加：
assert.notEqual(drawPart(mk('relay'), 'cartoon', vis({ on: true })), drawPart(mk('relay'), 'cartoon', vis()));
assert.notEqual(drawPart(mk('button', { pressed: true }), 'symbol', vis()), drawPart(mk('button'), 'symbol', vis()));
assert.notEqual(drawPart(mk('dpdt', { to: 'b' }), 'cartoon', vis()), drawPart(mk('dpdt'), 'cartoon', vis()));
assert.match(drawPart(mk('display'), 'symbol', vis({ text: '7' })), />7</);
// viewmodel.test.js：
test('display text: digit, E above 9, - when invalid', () => { /* value 5 → '5'；12 → 'E'；ok false → '-' */ });
test('relay vis.on follows relays state', () => {});
```

已有的 `every type renders in both styles…` 测试自动覆盖新 type 的端点和拨片。

- [ ] **Step 2: 运行，确认失败**

Run: `node --test circuit/test/drawings.test.js circuit/test/viewmodel.test.js`
Expected: FAIL

- [ ] **Step 3: 实现画法、viewmodel、view、app 手势、声音**

- [ ] **Step 4: 运行全量测试**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 浏览器里手动验证**（用 `run` skill 或静态服务器打开 `circuit/index.html`）

在自由模式依次确认：四个新元件出现在元件栏、两种画法都正常；按住按钮灯亮、松手灭；继电器开关电路合上后约 0.05 s 吸合、有咔哒声；自断自通电路持续跳动、画板不变灰；显示器接 1、4 显示 5。

- [ ] **Step 6: Commit**

```bash
git add circuit/
git commit -m "feat(circuit): 新元件的画法、按住交互和继电器咔哒声"
```

---

### Task 5: 关卡判定工具

**Files:**
- Modify: `circuit/lib/task-kit.js`
- Test: `circuit/test/task-kit-logic.test.js`

**Interfaces:**
- Consumes: Task 1 `solve`、`connectivity`；Task 2 `wantOn`。
- Produces：
  - `stableSolve(circuit, broken, force = null)`：`force` 为 `'off'` / `'on'` 时把所有继电器强制释放/吸合，直接返回 `{ stable: true, result }`；否则从全部释放开始，每轮 `solve` 后用 `wantOn` 同时更新所有继电器，状态不变返回 `{ stable: true, result, on }`，状态重复或超过 32 轮返回 `{ stable: false }`；`result.ok` 为假也返回 `{ stable: false }`。
  - `relayMatters(circuits, broken, output)`：`circuits` 是各输入组合下的电路，`output(result)` 返回可比较的字符串；有任一组合在 `force 'off'` 或 `'on'` 下的输出与 `stableSolve` 不同即返回 true。
  - `displayValue(result, broken, id)`：返回 `result.parts[id]?.value ?? null`。

- [ ] **Step 1: 写失败测试**

```js
test('stableSolve settles a relay driven by a closed switch', () => { /* on 含继电器，灯亮 */ });
test('stableSolve reports a self-interrupting relay as unstable', () => {});
test('relayMatters is false when the lamp ignores the relay', () => { /* 开关直接控灯，旁边放个空接的继电器 */ });
test('relayMatters is true for a relay-driven lamp', () => {});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test circuit/test/task-kit-logic.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

- [ ] **Step 4: 运行全量测试**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/task-kit.js circuit/test/task-kit-logic.test.js
git commit -m "feat(circuit): 继电器关卡判定工具 stableSolve"
```

---

### Task 6: 第 7 章关卡 30–34

**Files:**
- Create: `circuit/lib/tasks/ch7-logic.js`（导出 `CH7`）
- Modify: `circuit/lib/tasks.js`（`CHAPTERS` 加 `{ n: 7, name: '逻辑与加法器' }`，`TASKS` 合入 `CH7`）
- Test: `circuit/test/tasks-ch7.test.js`

**Interfaces:**
- Consumes: Task 5 的 `stableSolve`、`relayMatters`、`displayValue`；task-kit 已有的 `withParams`、`ofType`、`result`、`noProgress`、`lampLit`。
- Produces：以下关卡对象，字段格式同 `ch6-challenge.js`。开关闭合算 1。

| id | name | goal | palette | variants | 过关 |
|---|---|---|---|---|---|
| 30 | 认识数字显示器 | `v => \`让显示器显示 ${v}\`` | `{ battery: 1, display: 1 }` | `[3, 5, 6, 7, 9]` | 当前 `ws.result` 里某个显示器 value === 变体 |
| 31 | 半加器 | 两个开关代表 A、B，显示器显示 A+B | `{ battery: 1, dpdt: 2, display: 1 }` | — | 存在有序 dpdt 对 (d1, d2)、各自「1 位置」m1、m2 ∈ {a, b}，4 种组合下某个显示器 value === A+B |
| 32 | 认识继电器 | 合上开关，继电器点亮另一节电池那边的灯 | `{ battery: 2, switch: 1, relay: 1, lamp: 1 }` | — | 某开关 s、某灯 L：合上稳定且 L 亮、断开稳定且 L 灭；`relayMatters`；`connectivity` 里 L.a 与 s.a 根不同 |
| 33 | 继电器非门 | 开关合上灯灭，断开灯亮 | 同 32 | — | 亮灭与 32 相反；`relayMatters` |
| 34 | 继电器与门 / 或门 | `v => v === 'and' ? '两个开关都合上，灯才亮' : '随便合上一个开关，灯就亮'` | `{ battery: 2, switch: 2, relay: 2, lamp: 1 }` | `['and', 'or']` | 某有序开关对 4 种组合都稳定、灯亮灭符合真值表；`relayMatters` |

- [ ] **Step 1: 写失败测试 `circuit/test/tasks-ch7.test.js`**

每关至少一个参考接法能过、一个典型错误过不了：

```js
test('30 display: 4+1 shows 5', ...);            test('30 display: only i4 does not pass for 5', ...);
test('31 half adder: reference wiring passes', ...);  // 设计文档「参考接法」
test('31 half adder: either 1-position mapping passes', ...); // 把两个开关的 to 都翻一遍再判，仍过
test('31 half adder: sum without carry fails', ...);
test('32 relay: two separate loops pass', ...);
test('32 relay: lamp on the coil battery fails', ...);   // 灯和线圈同一节电池 → connectivity 相同 → 不过
test('32 relay: switch drives lamp directly fails', ...); // relayMatters 为假
test('33 not gate: nc contact passes', ...);      test('33 not gate: no contact fails', ...);
test('34 and: two relays in series pass', ...);   test('34 and: one relay with two switches in series passes', ...);
test('34 or: parallel contacts pass', ...);       test('34 or: and-wiring fails the or variant', ...);
test('chapter 7 is listed with 5 tasks so far', ...); // CHAPTERS 含 n 7；TASKS 里 chapter 7 的关数
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test circuit/test/tasks-ch7.test.js`
Expected: FAIL

- [ ] **Step 3: 实现关卡**

- [ ] **Step 4: 运行全量测试**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS（`tasks.test.js` 里若有按总关数写死的断言，同步更新）

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/tasks/ch7-logic.js circuit/lib/tasks.js circuit/test/tasks-ch7.test.js circuit/test/tasks.test.js
git commit -m "feat(circuit): 第 7 章关卡：显示器、半加器、继电器门电路"
```

---

### Task 7: 自制电铃（35）与全加器（36）

**Files:**
- Modify: `circuit/lib/tasks/ch7-logic.js`
- Modify: `README.md`（电路实验室介绍里提到新元件和第 7 章，如该处有元件/章节列表）
- Test: `circuit/test/tasks-ch7.test.js`

**Interfaces:**
- Consumes: Task 2 `ws.relays.flips`；Task 5；task-kit `presetCircuit`。
- Produces：

**35 自制电铃**：goal「按住按钮，继电器自己哒哒响」，palette `{ battery: 1, button: 1, relay: 1 }`，`initProgress: () => ({ base: null, seen: false })`。
- 进度：有按钮 pressed 时，`base` 为空就记下 `ws.relays.flips`；`flips - base ≥ 4` 置 `seen: true`；没有按钮按下时 `base` 清空（`seen` 保留）。
- 过关：`seen` 且存在按钮 b：`withParams` 设 pressed true 时 `stableSolve` 不稳定，设 false 时稳定且该继电器不在 `on` 里。

**36 全加器**：goal「三个开关 A、B、C，显示器显示 A+B+C」，palette `{}`，`lockPreset: true`。
- `preset`：用 `presetCircuit` 摆开关 A、B、C，继电器 A1、A2、B1、B2、B3、C1、C2，显示器 1 个，电池 2 节；预置导线接好「开关 → 线圈 → 线圈电池负极」和「显示器 g → 逻辑电池负极」，开关另一端接线圈电池正极。每个预置元件带 `tag`（用 `extra` 参数，值即上面的名字，电池为 `BC`、`BL`，显示器 `D`），供测试定位。坐标由实现者排，必须全部在 28×18 画板内且互不重叠。
- 过关：三个预置开关 8 种组合都 `stableSolve` 稳定，且显示器 value === A+B+C。

- [ ] **Step 1: 写失败测试**

```js
test('35 bell: nc self-interrupt passes after holding the button', () => {
  // 搭 B.p→btn.a，btn.b→K.x，K.y→K.nc，K.com→B.n；editor press 后 tick 0.05 × 10，判定 passed
});
test('35 bell: tapping a no-contact relay does not pass', () => {
  // 用 no 触点，按下/松开 6 次：stableSolve 按下时稳定 → 不过
});
test('36 full adder: preset fits the board and nothing overlaps', () => {
  // 每个端点在 [0,28]×[0,18] 内；不同元件的端点不重合
});
test('36 full adder: reference wiring passes all 8 combos', () => {
  // 按设计文档「参考接法」，用 tag 找元件、addWire 接触点网络
});
test('36 full adder: sum-only wiring fails', () => {});
test('full adder check is fast', () => {
  // 参考接法下 check 一次 < 50 ms（performance.now）
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test circuit/test/tasks-ch7.test.js`
Expected: FAIL

- [ ] **Step 3: 实现两关和预置；更新 README**

- [ ] **Step 4: 运行全量测试**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 浏览器里手动验证**

打开第 7 章逐关试：35 按住按钮能听到连续咔哒、过关；36 预置布局清楚，按参考接法接完 8 种组合都正确显示，端点在 iPad 尺寸下点得准（窗口缩到约 1024×768 看一遍）。

- [ ] **Step 6: Commit**

```bash
git add circuit/lib/tasks/ch7-logic.js circuit/test/tasks-ch7.test.js README.md
git commit -m "feat(circuit): 第 7 章：自制电铃和全加器"
```

---

### 收尾：开 PR 并合并

- [ ] 确认 `git log` 里本分支所有提交的作者都不是公司身份。
- [ ] 推送分支，用 `gh pr create` 开 PR（描述列出新元件、7 关和测试数），等 CI（若有）通过后 `gh pr merge`。
