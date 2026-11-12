# 电路实验室（circuit）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `circuit/` 新增「电路实验室」：iPad 横屏上拖元件、连导线，按真实物理实时算出灯亮、LED、风扇、蜂鸣器、电表、短路、熔断效果，并带 10 个自动判定的小任务。

**Architecture:** 所有逻辑是 `circuit/lib/` 下的纯函数 ES 模块：数据模型 → 求解器 `solve` → 损坏状态 `advance` → 引擎 `settle/tick` → 任务判定 → 编辑器 reducer `reduce(state, action)`。页面层（`circuit/app.js`、`view.js`、`sound.js`）只做两件事：把 Pointer 事件翻译成 action，把 state 画成 SVG。这样除了指针和绘制细节，全部行为都能在 Node 里用 `node:test` 测。

**Tech Stack:** 原生 HTML/CSS/JS ES 模块，SVG 渲染，Pointer Events，Web Audio；测试用 Node 内置 `node:test`（本机 Node v26），零依赖。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261112-153639-circuit-designer/docs/superpowers/specs/2026-11-12-circuit-designer-design.md`

## Global Constraints

- 新目录 `circuit/`，入口 `circuit/index.html`；纯逻辑放 `circuit/lib/`，测试放 `circuit/test/*.test.js`。
- 纯静态：原生 HTML/CSS/JS ES 模块，无构建步骤、无 npm 运行时依赖、不联网（不引用任何外部 URL）。
- 不保存电路：不用 localStorage / IndexedDB / cookie。刷新即清空。
- 目标设备 iPad Safari 横屏、手指操作；触控用 Pointer Events；禁用双指缩放与长按选字对画布的干扰。
- 任何时候界面上不出现 `NaN`、`Infinity`；求解失败时显示「暂时无法计算」，电表显示 `--`。
- 底色沿用首页暖色调 `#fff8ec`；正文颜色 `#3a2e25`（首页插图用的深棕）。
- 所有界面文案用中文；所有命令在仓库根目录 `/Users/jialiu/Projects/saisai.me/.worktrees/20261112-153639-circuit-designer` 下运行。
- 测试命令统一为 `node --test circuit/test/*.test.js`。

## Review Focus

1. **只放了元件、没连全线**（悬空端点、单根悬空导线、孤立元件）——不能报「暂时无法计算」，也不能出 NaN。由 Task 2 的 `floating parts` 测试钉住（GMIN 接参考点）。
2. **导线把同一个元件的两端直接连起来**（电池 + 接 −、灯泡两端短接）——电池应短路报警、灯泡应灭，不能奇异。由 Task 2 `wire across one part` 与 Task 4 电池报警测试钉住。
3. **LED 接在 4 节电池上正接/反接、不加电阻**——牛顿迭代必须收敛：正接瞬时烧坏，反接不亮不坏，全程无 NaN。由 Task 3 测试钉住。
4. **删掉一个连着导线的元件后撤销**——元件和它的导线都回来，`rev` 单调增加，旧求解结果不会被当成当前结果。由 Task 6 `undo deletePart restores wires` 测试钉住。
5. **小任务里删了元件或撤销后，元件栏剩余数量要跟着回来**——剩余数按画布上实际元件数算，不是一个递减计数器。由 Task 5 `remainingPalette` 与 Task 6 `palette limit` 测试钉住。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `circuit/lib/parts.js` | 12 种元件的目录：端点名、端点本地坐标、参数定义、物理常数 `PHYS` |
| `circuit/lib/circuit.js` | 电路数据模型与不可变编辑操作（每次返回新对象，`rev`/`topoRev` 递增） |
| `circuit/lib/linalg.js` | 稠密高斯消元（部分主元） |
| `circuit/lib/solve.js` | `solve(circuit, broken, opts)`：连通分量 + 节点分析 + LED 牛顿迭代 |
| `circuit/lib/damage.js` | 损坏状态与 `advance` |
| `circuit/lib/engine.js` | `settle`（解→损坏→再解直到稳定）、`tick`（定时累计过载） |
| `circuit/lib/tasks.js` | 10 个小任务：元件栏、预置电路、判定器 |
| `circuit/lib/editor.js` | 编辑器 state 与 `reduce(state, action)`：撤销、元件栏上限、清空确认、模式切换 |
| `circuit/lib/geometry.js` | 网格、端点坐标（含旋转）、命中测试、导线直角走线 |
| `circuit/lib/viewmodel.js` | 求解结果 → 视觉参数（光晕、转速、音量、电流点速度、读数文字、色环） |
| `circuit/lib/drawings.js` | 每种元件两种画法的 SVG 字符串 |
| `circuit/index.html` / `styles.css` | 页面骨架与样式 |
| `circuit/view.js` | 把 state 画进 SVG 和面板（DOM） |
| `circuit/sound.js` | 蜂鸣器 Web Audio |
| `circuit/app.js` | 入口：指针事件 → action，`requestAnimationFrame` 驱动 `tick` |
| `circuit/test/helpers.js` | 测试用电路构造器 |
| `index.html`、`README.md`、`tests/homepage.test.mjs` | 首页入口 |

---

### Task 1: 元件目录、电路模型与测试构造器

**Files:**
- Create: `circuit/lib/parts.js`, `circuit/lib/circuit.js`, `circuit/test/helpers.js`
- Test: `circuit/test/circuit.test.js`

**Interfaces:**
- Produces:
  - `PART_TYPES: string[]`，固定顺序：`['battery','lamp','switch','led','resistor','motor','buzzer','rheostat','spdt','ammeter','voltmeter','fuse']`
  - `PARTS[type] = { label: string, terms: string[], termPos: Record<term,[gx,gy]>, params: Record<key, ParamDef>, lever: boolean }`，`ParamDef = { default, options?: any[] } | { default, min, max }`
  - `defaultParams(type) → object`，`isValidParam(type, key, value) → boolean`
  - `PHYS`：全部物理常数（见下表）
  - `Circuit = { rev: number, topoRev: number, nextId: number, parts: Part[], wires: Wire[] }`
  - `Part = { id: string, type: string, x: number, y: number, rot: 0|1|2|3, params: object, preset?: true }`（x、y 是网格整数坐标）
  - `Wire = { id: string, a: {part: string, term: string}, b: {part: string, term: string} }`
  - `createCircuit()`、`addPart(c, type, x, y, params?) → {circuit, id}`、`movePart(c, id, x, y)`、`rotatePart(c, id)`、`removePart(c, id)`、`setParam(c, id, key, value)`、`addWire(c, a, b) → {circuit, id} | null`、`removeWire(c, id)`、`findPart(c, id)`、`cloneCircuit(c)`
  - 测试构造器 `build({ parts: {ID: [type, params?, extra?]}, wires: [['ID.term','ID.term'], ...] }) → Circuit`（元件 id 就是给出的 ID，导线 id 为 `w1, w2…`，`rev: 1, topoRev: 1`）

元件表（端点名与本地网格坐标，旋转前）：

| type | label | terms → termPos | params | lever |
|---|---|---|---|---|
| battery | 电池 | `p`(-2,0) `n`(2,0) | `cells` 1–4，默认 1 | 否 |
| lamp | 小灯泡 | `a`(-2,0) `b`(2,0) | — | 否 |
| switch | 开关 | `a`(-2,0) `b`(2,0) | `closed` [false,true]，默认 false | 是 |
| led | LED | `a`(-2,0) 阳极 `k`(2,0) 阴极 | `color` ['red','green','blue','yellow']，默认 red | 否 |
| resistor | 电阻 | `a` `b` 同上 | `ohms` [10,47,100,220,470,1000]，默认 220 | 否 |
| motor | 小风扇 | `a` `b` | — | 否 |
| buzzer | 蜂鸣器 | `p`(-2,0) `n`(2,0) | — | 否 |
| rheostat | 滑动变阻器 | `a`(-2,0) `b`(2,0) `w`(0,-2) | `pos` 0–1，默认 0.5 | 否 |
| spdt | 单刀双掷开关 | `c`(-2,0) `a`(2,-1) `b`(2,1) | `to` ['a','b']，默认 'a' | 是 |
| ammeter | 电流表 | `p` `n` | — | 否 |
| voltmeter | 电压表 | `p` `n` | — | 否 |
| fuse | 保险丝 | `a` `b` | `rating` [0.5,1,2]，默认 1 | 否 |

`PHYS`（单位 SI）：`V_CELL 1.5, R_CELL 0.1, R_WIRE 1e-3, R_CLOSED 1e-3, GMIN 1e-9, LAMP_R 10, LAMP_P_RATED 0.9, LAMP_BURN_P 1.8, LAMP_LIT_P 0.045, HOLD_S 0.6, SHORT_A 3, LED_IS 1e-12, LED_VN 0.0869, LED_BURN_A 0.030, LED_LIT_A 0.001, MOTOR_R 5, BUZZER_R 50, RHEO_R 50, AMMETER_R 0.01, VOLTMETER_R 1e7`。

`rev` 规则：每个改变电路的操作 `rev + 1`；`addPart / removePart / addWire / removeWire` 另外 `topoRev + 1`；`setParam / movePart / rotatePart` 不动 `topoRev`。所有操作不修改入参。无效操作（id 不存在、参数非法、`addWire` 两端相同、两端点间已有导线、端点名不属于该元件）返回入参原对象（`addWire` 返回 `null`）。`removePart` 同时删掉连在它上面的导线。新 id 用 `nextId`：元件 `p${n}`、导线 `w${n}`。

- [ ] **Step 1: 写失败测试 `circuit/test/circuit.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PART_TYPES, PARTS, defaultParams, isValidParam, PHYS } from '../lib/parts.js';
import { createCircuit, addPart, movePart, rotatePart, removePart, setParam, addWire, removeWire } from '../lib/circuit.js';
import { build } from './helpers.js';

test('catalog has 12 types with terms', () => {
  assert.equal(PART_TYPES.length, 12);
  for (const t of PART_TYPES) assert.ok(PARTS[t].terms.every(n => PARTS[t].termPos[n]));
  assert.deepEqual(PARTS.rheostat.terms, ['a', 'b', 'w']);
  assert.equal(PARTS.switch.lever && PARTS.spdt.lever, true);
  assert.equal(defaultParams('battery').cells, 1);
  assert.equal(isValidParam('resistor', 'ohms', 33), false);
  assert.equal(isValidParam('battery', 'cells', 4), true);
  assert.equal(PHYS.LAMP_BURN_P, 2 * PHYS.LAMP_P_RATED);
});

test('ops are immutable and bump rev / topoRev', () => {
  const c0 = createCircuit();
  const { circuit: c1, id } = addPart(c0, 'lamp', 5, 5);
  assert.equal(c0.parts.length, 0);
  assert.deepEqual([c1.rev, c1.topoRev], [1, 1]);
  const c2 = movePart(c1, id, 6, 5);
  assert.deepEqual([c2.rev, c2.topoRev], [2, 1]);
  const c3 = rotatePart(c2, id);
  assert.equal(c3.parts[0].rot, 1);
  const c4 = setParam(c3, id, 'nope', 1);
  assert.equal(c4, c3);
});

test('addWire rejects self, duplicates and bad terms', () => {
  let c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [] });
  const r = addWire(c, { part: 'B', term: 'p' }, { part: 'L', term: 'a' });
  assert.ok(r);
  c = r.circuit;
  assert.equal(addWire(c, { part: 'L', term: 'a' }, { part: 'B', term: 'p' }), null);
  assert.equal(addWire(c, { part: 'B', term: 'p' }, { part: 'B', term: 'p' }), null);
  assert.equal(addWire(c, { part: 'B', term: 'x' }, { part: 'L', term: 'b' }), null);
  assert.ok(addWire(c, { part: 'B', term: 'p' }, { part: 'B', term: 'n' })); // 同一元件两端允许
});

test('removePart drops attached wires', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a'], ['L.b', 'B.n']] });
  const d = removePart(c, 'L');
  assert.equal(d.wires.length, 0);
  assert.equal(d.topoRev, c.topoRev + 1);
  assert.equal(removeWire(c, 'w1').wires.length, 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/*.test.js`
Expected: FAIL，`Cannot find module '../lib/parts.js'`

- [ ] **Step 3: 实现 `circuit/lib/parts.js`、`circuit/lib/circuit.js`、`circuit/test/helpers.js`**

按上面 Interfaces 与表格实现。`build` 里每个元件位置随意（如 x = 序号×6，y = 5），`params` = `defaultParams(type)` 合并给定值，`extra` 合并进 Part 本身（用于 `{preset: true}`）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/parts.js circuit/lib/circuit.js circuit/test/helpers.js circuit/test/circuit.test.js
git commit -m "feat(circuit): 元件目录与电路数据模型"
```

---

### Task 2: 线性求解器（除 LED 外全部元件）

**Files:**
- Create: `circuit/lib/linalg.js`, `circuit/lib/solve.js`
- Test: `circuit/test/solve.test.js`

**Interfaces:**
- Consumes: Task 1 的 `PARTS`、`PHYS`、Circuit 结构
- Produces:
  - `solveLinear(A: number[][], b: number[]) → number[] | null`（主元绝对值 < 1e-18 或结果非有限时返回 null）
  - `solve(circuit, broken: Set<string> = new Set(), opts = { maxIter: 100 }) → Result`
  - `Result = { ok: boolean, rev: number, topoRev: number, brokenKey: string, nodes: Record<'id.term', number>, parts: Record<id, {v, i, p}>, wires: Record<id, {i}> }`；`ok` 为 false 时 `nodes/parts/wires` 都是 `{}`
  - `brokenKeyOf(broken: Set<string>) → string`（id 排序后用 `,` 连接）
  - 读数约定：两端元件端点 `[t0, t1]` = `terms` 前两个，`v = V(t0) − V(t1)`，`i` = 从 t0 经元件流到 t1 的电流，`p = v·i`。电池：`v = V(p) − V(n)`，`i` = 从 + 端流出到外电路的电流（放电为正），`p = v·i`。滑动变阻器：`v = V(a) − V(b)`，`i` = a→w 段电流，`p` = 两段功率和。单刀双掷：`v = V(c) − V(所选触点)`，`i` = c→所选触点。导线 `i` = a 端 → b 端。

求解方法（由建造者决定的数值细节，这里定死）：
- 每个端点 `id.term` 是一个节点。并查集合并：每根导线的两端；每个元件自己的全部端点（开路的也合并，开路支路不把分量排除）。
- 每个分量：没有电池 → 全部节点电位 0、元件和导线读数全 0。有电池 → 参考点取分量里第一个电池（按 `parts` 顺序）的 `n` 端，电位 0；其余每个节点对参考点并一个 `GMIN`；做节点分析。
- 电池用诺顿等效：电导 `1/(cells·R_CELL)` 接在 p、n 之间，加电流源 `cells·V_CELL/(cells·R_CELL)` 从 n 注入 p。所以不需要电压源附加行。
- 电导：导线 `1/R_WIRE`；闭合开关、单刀双掷所选那一路、未熔断保险丝 `1/R_CLOSED`；灯泡 `1/LAMP_R`；电阻 `1/ohms`；电机 `1/MOTOR_R`；蜂鸣器 `1/BUZZER_R`；电流表 `1/AMMETER_R`；电压表 `1/VOLTMETER_R`；变阻器 a–w `1/max(pos·RHEO_R, R_CLOSED)`、w–b `1/max((1−pos)·RHEO_R, R_CLOSED)`。断开的开关、未选的触点、`broken` 里的元件：不加任何电导。
- `solveLinear` 返回 null 或任一电位非有限 → 整个结果 `ok: false`。

- [ ] **Step 1: 写失败测试 `circuit/test/solve.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { solveLinear } from '../lib/linalg.js';
import { build } from './helpers.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const loop = (parts, chain) => build({ parts, wires: chain.slice(0, -1).map((t, k) => [t, chain[k + 1]]) });

test('solveLinear basic and singular', () => {
  assert.deepEqual(solveLinear([[2, 0], [0, 4]], [2, 8]), [1, 2]);
  assert.equal(solveLinear([[1, 1], [1, 1]], [1, 2]), null);
});

test('one lamp on one cell', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  const r = solve(c);
  assert.equal(r.ok, true);
  near(r.parts.L.i, 0.1485, 1e-3);
  near(r.parts.L.p, 0.2205, 3e-3);
  near(r.parts.B.i, r.parts.L.i, 1e-6);
  assert.deepEqual([r.rev, r.topoRev, r.brokenKey], [c.rev, c.topoRev, '']);
});

test('series vs parallel at 2 cells (spec: ~0.22W vs ~0.83W)', () => {
  const s = solve(loop({ B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    ['B.p', 'L1.a', 'L1.b', 'L2.a', 'L2.b', 'B.n']));
  near(s.parts.L1.p, 0.2205, 5e-3); near(s.parts.L2.p, 0.2205, 5e-3);
  const p = solve(build({ parts: { B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] }));
  near(p.parts.L1.p, 0.832, 1e-2); near(p.parts.L2.p, 0.832, 1e-2);
});

test('open switch: lamp off, voltmeter across switch reads ~battery', () => {
  const c = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n'], ['V.p', 'S.a'], ['V.n', 'S.b']] });
  const r = solve(c);
  assert.ok(Math.abs(r.parts.L.p) < 1e-6);
  near(r.parts.V.v, 1.5, 0.01);
});

test('voltmeter in series: lamp effectively off', () => {
  const r = solve(loop({ B: ['battery'], V: ['voltmeter'], L: ['lamp'] }, ['B.p', 'V.p', 'V.n', 'L.a', 'L.b', 'B.n']));
  assert.ok(r.parts.L.p < 1e-6);
  near(r.parts.V.v, 1.5, 0.01);
});

test('ammeter reads lamp current, reversed reads negative', () => {
  const f = solve(loop({ B: ['battery'], A: ['ammeter'], L: ['lamp'] }, ['B.p', 'A.p', 'A.n', 'L.a', 'L.b', 'B.n']));
  near(f.parts.A.i, f.parts.L.i, 1e-6);
  const r = solve(loop({ B: ['battery'], A: ['ammeter'], L: ['lamp'] }, ['B.p', 'A.n', 'A.p', 'L.a', 'L.b', 'B.n']));
  assert.ok(r.parts.A.i < -0.1);
});

test('rheostat ends give > 30x lamp power ratio', () => {
  const mk = pos => solve(loop({ B: ['battery'], R: ['rheostat', { pos }], L: ['lamp'] }, ['B.p', 'R.a', 'R.w', 'L.a', 'L.b', 'B.n']));
  const hi = mk(0).parts.L.p, lo = mk(1).parts.L.p;
  assert.ok(lo > 1e-4 && hi / lo > 30);
});

test('spdt routes to selected contact', () => {
  const c = to => solve(build({ parts: { B: ['battery'], S: ['spdt', { to }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'S.c'], ['S.a', 'L1.a'], ['S.b', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] }));
  assert.ok(c('a').parts.L1.p > 0.1 && c('a').parts.L2.p < 1e-6);
  assert.ok(c('b').parts.L2.p > 0.1 && c('b').parts.L1.p < 1e-6);
});

test('wire across one part: battery short ~14.8A, shorted lamp dark', () => {
  const r = solve(build({ parts: { B: ['battery'], L: ['lamp'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']] }));
  near(r.parts.B.i, 14.8, 0.2);
  assert.ok(r.parts.L.p < 1e-3);
  const s = solve(build({ parts: { B: ['battery'], L: ['lamp'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['L.a', 'L.b']] }));
  assert.ok(s.parts.L.p < 1e-3);
});

test('floating parts: unwired parts and dangling wires stay ok, no NaN', () => {
  const r = solve(build({ parts: { B: ['battery'], L: ['lamp'], S: ['switch'], M: ['motor'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['S.a', 'M.a']] }));
  assert.equal(r.ok, true);
  for (const x of Object.values(r.nodes)) assert.ok(Number.isFinite(x));
  assert.equal(r.parts.M.i, 0);
  assert.equal(solve(build({ parts: { S: ['switch'] }, wires: [] })).ok, true);
});

test('no battery component: all zero', () => {
  const r = solve(loop({ L: ['lamp'], M: ['motor'] }, ['L.a', 'L.b', 'M.a', 'M.b', 'L.a']));
  assert.equal(r.ok, true);
  assert.ok(Object.values(r.nodes).every(v => v === 0));
});

test('broken lamp is open; motor reverses; opposing batteries cancel', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  const r = solve(c, new Set(['L']));
  assert.ok(Math.abs(r.parts.L.i) < 1e-6);
  assert.equal(r.brokenKey, 'L');
  assert.ok(solve(loop({ B: ['battery'], M: ['motor'] }, ['B.p', 'M.b', 'M.a', 'B.n'])).parts.M.v < -1);
  const o = solve(loop({ B1: ['battery'], B2: ['battery'], L: ['lamp'] }, ['B1.p', 'B2.p', 'B2.n', 'L.a', 'L.b', 'B1.n']));
  assert.ok(Math.abs(o.parts.L.i) < 1e-6);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/solve.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `solveLinear` 于 `circuit/lib/linalg.js`，`solve` / `brokenKeyOf` 于 `circuit/lib/solve.js`**

先不处理 LED（LED 在本任务里当作不加电导的开路元件；Task 3 再补）。把每类元件「贡献哪些电导/电流源」写成按 type 分派的一个小表，Task 3 只往里加 LED。

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/linalg.js circuit/lib/solve.js circuit/test/solve.test.js
git commit -m "feat(circuit): 节点分析求解器（线性元件、连通分量、GMIN）"
```

---

### Task 3: LED 牛顿迭代与求解失败

**Files:**
- Modify: `circuit/lib/solve.js`
- Test: `circuit/test/solve-led.test.js`

**Interfaces:**
- Consumes: Task 2 `solve`
- Produces: `solve` 支持 `led`；`opts.maxIter` 用尽未收敛 → `ok: false`。LED 读数 `i` = 阳极 a → 阴极 k 的电流。

模型：`I(vd) = LED_IS·(exp(vd/LED_VN) − 1)`（2.0V 约 10mA，1.8V 约 1mA）。每次迭代按当前 `vd` 线性化：并联电导 `Gd = LED_IS/LED_VN·exp(vd/LED_VN) + GMIN`，等效电流源 `Ieq = I(vd) − Gd·vd`（a→k）。所有 LED 初值 `vd = 0`。解出新 `vd_raw = V(a) − V(k)` 后用 SPICE 的 pn 结限幅（`VCRIT = LED_VN·ln(LED_VN/(√2·LED_IS))`）：

```js
function pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return { v: arg > 0 ? vold + vt * Math.log(arg) : vcrit, limited: true };
    }
    return { v: vt * Math.log(vnew / vt), limited: true };
  }
  return { v: vnew, limited: false };
}
```

收敛判据：本轮没有任何 LED 被限幅，且所有 LED `|vd_raw − vd_old| < 1e-6`。收敛后 LED 读数用最终 `vd` 代模型算 `i`。没有 LED 的分量只解一次。被 `broken` 的 LED 不加任何电导。

- [ ] **Step 1: 写失败测试 `circuit/test/solve-led.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { build } from './helpers.js';

const loop = (parts, chain) => build({ parts, wires: chain.slice(0, -1).map((t, k) => [t, chain[k + 1]]) });
const finite = r => [...Object.values(r.nodes), ...Object.values(r.parts).flatMap(x => [x.v, x.i, x.p])].every(Number.isFinite);

test('LED forward with 220 ohm on 2 cells: 3-6 mA', () => {
  const r = solve(loop({ B: ['battery', { cells: 2 }], R: ['resistor', { ohms: 220 }], D: ['led'] }, ['B.p', 'R.a', 'R.b', 'D.a', 'D.k', 'B.n']));
  assert.equal(r.ok, true);
  assert.ok(r.parts.D.i > 3e-3 && r.parts.D.i < 6e-3, String(r.parts.D.i));
});

test('LED reversed does not conduct', () => {
  const r = solve(loop({ B: ['battery', { cells: 2 }], R: ['resistor', { ohms: 220 }], D: ['led'] }, ['B.p', 'R.a', 'R.b', 'D.k', 'D.a', 'B.n']));
  assert.ok(Math.abs(r.parts.D.i) < 1e-6);
});

test('LED direct on one cell stays below 1 mA', () => {
  const r = solve(loop({ B: ['battery'], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']));
  assert.ok(r.parts.D.i < 1e-3);
});

test('LED direct on 4 cells: converges, > 30 mA, finite', () => {
  const r = solve(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']));
  assert.equal(r.ok, true);
  assert.ok(r.parts.D.i > 0.03);
  assert.ok(finite(r));
});

test('LED reversed on 4 cells: ok, no current', () => {
  const r = solve(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.k', 'D.a', 'B.n']));
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.parts.D.i) < 1e-6);
});

test('two LEDs in parallel with different resistors converge', () => {
  const r = solve(build({ parts: { B: ['battery', { cells: 3 }], R1: ['resistor', { ohms: 100 }], R2: ['resistor', { ohms: 1000 }], D1: ['led'], D2: ['led'] },
    wires: [['B.p', 'R1.a'], ['B.p', 'R2.a'], ['R1.b', 'D1.a'], ['R2.b', 'D2.a'], ['D1.k', 'B.n'], ['D2.k', 'B.n']] }));
  assert.equal(r.ok, true);
  assert.ok(r.parts.D1.i > r.parts.D2.i && r.parts.D2.i > 1e-3);
});

test('non-convergence yields ok:false with empty readings', () => {
  const r = solve(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']), new Set(), { maxIter: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual([r.nodes, r.parts, r.wires], [{}, {}, {}]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/solve-led.test.js`
Expected: FAIL（LED 电流为 0 等断言失败）

- [ ] **Step 3: 在 `solve.js` 中加入 LED 牛顿迭代与 `maxIter` 失败路径**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/solve.js circuit/test/solve-led.test.js
git commit -m "feat(circuit): LED 指数模型牛顿迭代"
```

---

### Task 4: 损坏状态 `advance` 与引擎 `settle` / `tick`

**Files:**
- Create: `circuit/lib/damage.js`, `circuit/lib/engine.js`
- Test: `circuit/test/engine.test.js`

**Interfaces:**
- Consumes: `solve`、`brokenKeyOf`（Task 2）、`PHYS`
- Produces:
  - `Damage = { broken: Record<id, true>, hold: Record<id, number>, alarm: Record<id, true> }`
  - `createDamage()`、`brokenSet(d) → Set<string>`、`brokenKey(d) → string`（同 `brokenKeyOf`）
  - `advance(d, result, dt, circuit) → Damage`：`!result.ok`、`result.rev !== circuit.rev`、`result.brokenKey !== brokenKey(d)` 任一成立时**原样返回 d（同一对象）**。否则先删掉 circuit 里已不存在的 id，再按规则：
    - fuse：`|i| > rating` → broken（瞬时）
    - led：`i > LED_BURN_A` → broken（瞬时）
    - lamp：`p > LAMP_BURN_P` → `hold += dt`，`hold ≥ HOLD_S` → broken 并删 hold；否则删 hold
    - battery：`|i| > SHORT_A` → `hold += dt`，`hold ≥ HOLD_S` → alarm；否则删 hold 与 alarm
    - 内容没有变化时返回原对象 d
  - `repair(d, id) → Damage`（删 broken[id]、hold[id]）
  - `Workspace = { circuit, damage, result, trail: Result[] }`
  - `settle(circuit, damage) → Workspace`：循环最多 20 次：`r = solve(circuit, brokenSet(d))`；`r.ok` 时 push 进 `trail`；`d2 = advance(d, r, 0, circuit)`；`brokenKey` 不变则返回 `{circuit, damage: d2, result: r, trail}`，否则 `d = d2` 继续。用尽 20 次返回 `result` 为 `{...r, ok: false, nodes: {}, parts: {}, wires: {}}`。
  - `tick(ws, dt) → Workspace`：`!ws.result.ok` → 返回 ws（暂停计时）。`d = advance(...)`；`d === ws.damage` → 返回 ws；`brokenKey` 变了 → `settle(ws.circuit, d)`；否则 `{...ws, damage: d, trail: []}`。

- [ ] **Step 1: 写失败测试 `circuit/test/engine.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamage, advance, repair, brokenKey } from '../lib/damage.js';
import { settle, tick } from '../lib/engine.js';
import { solve } from '../lib/solve.js';
import { setParam, removeWire } from '../lib/circuit.js';
import { build } from './helpers.js';

const loop = (parts, chain) => build({ parts, wires: chain.slice(0, -1).map((t, k) => [t, chain[k + 1]]) });

test('advance ignores invalid or stale results', () => {
  const c = loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']);
  const d = createDamage();
  const r = solve(c);
  assert.equal(advance(d, { ...r, ok: false }, 0, c), d);
  assert.equal(advance(d, r, 0, { ...c, rev: c.rev + 1 }), d);
  assert.equal(advance(d, { ...r, brokenKey: 'X' }, 0, c), d);
  assert.equal(advance(d, r, 0, c).broken.D, true);
});

test('settle: LED on 4 cells burns instantly and then carries no current', () => {
  const ws = settle(loop({ B: ['battery', { cells: 4 }], D: ['led'] }, ['B.p', 'D.a', 'D.k', 'B.n']), createDamage());
  assert.equal(ws.damage.broken.D, true);
  assert.equal(ws.result.ok, true);
  assert.ok(Math.abs(ws.result.parts.D.i) < 1e-6);
  assert.ok(ws.trail[0].parts.D.i > 0.03);
});

test('settle: fuse in short loop blows; trail keeps pre-blow result', () => {
  const c = build({ parts: { B: ['battery'], F: ['fuse', { rating: 2 }], L: ['lamp'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'F.a'], ['F.b', 'B.n']] });
  const ws = settle(c, createDamage());
  assert.equal(ws.damage.broken.F, true);
  assert.ok(Math.abs(ws.trail[0].parts.F.i) > 3);
  assert.ok(Math.abs(ws.result.parts.B.i) < 3);
  assert.ok(ws.result.parts.L.p > 0.1);
});

test('lamp overload burns only after 0.6s held', () => {
  let ws = settle(loop({ B: ['battery', { cells: 4 }], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']), createDamage());
  ws = tick(ws, 0.3);
  assert.equal(ws.damage.broken.L, undefined);
  ws = tick(ws, 0.31);
  assert.equal(ws.damage.broken.L, true);
  assert.ok(Math.abs(ws.result.parts.L.i) < 1e-6);
  assert.equal(brokenKey(repair(ws.damage, 'L')), '');
});

test('sweeping rheostat through high power does not burn the lamp', () => {
  const mk = pos => loop({ B: ['battery', { cells: 4 }], R: ['rheostat', { pos }], L: ['lamp'] }, ['B.p', 'R.a', 'R.w', 'L.a', 'L.b', 'B.n']);
  let ws = settle(mk(0), createDamage());
  ws = tick(ws, 0.3);
  ws = settle(setParam(ws.circuit, 'R', 'pos', 1), ws.damage);
  ws = tick(ws, 0.1);
  ws = settle(setParam(ws.circuit, 'R', 'pos', 0), ws.damage);
  ws = tick(ws, 0.3);
  assert.equal(ws.damage.broken.L, undefined);
});

test('battery short alarm after 0.6s, clears when short removed', () => {
  let ws = settle(build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] }), createDamage());
  ws = tick(ws, 0.3);
  assert.equal(ws.damage.alarm.B, undefined);
  ws = tick(ws, 0.31);
  assert.equal(ws.damage.alarm.B, true);
  ws = settle(removeWire(ws.circuit, 'w1'), ws.damage);
  ws = tick(ws, 0.05);
  assert.equal(ws.damage.alarm.B, undefined);
});

test('tick pauses on invalid result', () => {
  const ws = { circuit: build({ parts: {}, wires: [] }), damage: createDamage(), result: { ok: false }, trail: [] };
  assert.equal(tick(ws, 1), ws);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/engine.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `circuit/lib/damage.js`、`circuit/lib/engine.js`**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/damage.js circuit/lib/engine.js circuit/test/engine.test.js
git commit -m "feat(circuit): 损坏判定与 settle/tick 引擎"
```

---

### Task 5: 10 个小任务与判定器

**Files:**
- Create: `circuit/lib/tasks.js`
- Test: `circuit/test/tasks.test.js`

**Interfaces:**
- Consumes: `solve`、`brokenSet`、`settle`、`createCircuit/addPart/addWire/setParam/cloneCircuit`、`PHYS`
- Produces:
  - `TASKS: Task[]`（10 个，顺序同 spec 第 7 节）。`Task = { id: 1..10, name, goal, palette: Record<type, number>, defaults?: Record<type, object>, locked?: Record<type, string[]>, preset(): Circuit, initProgress(): object, check(progress, ws) → { progress, passed: boolean, hint: string | null } }`
  - `evaluateTask(task, progress, ws)`：`ws.result.ok` 为 false 时返回 `{progress, passed: false, hint: null}` 不调用 `check`；否则调用 `task.check`。
  - `remainingPalette(task, circuit) → Record<type, number>`：`palette[type] − 画布上该类型且非 preset 的元件数`，下限 0。
  - `lampLit(result, broken: Set, id)`：未烧断且 `p ≥ LAMP_LIT_P`；`ledLit(result, broken, id)`：未烧坏且 `i ≥ LED_LIT_A`。
  - `withParams(circuit, changes: Record<id, Record<key, value>>) → Circuit`：在副本上改参数，不改入参。

预置电路一律标 `preset: true`。各关元件栏、预置与判定（「亮」用上面两个函数，broken 用 `brokenSet(ws.damage)`；副本求解用 `solve(withParams(...), broken)`，不调用 `advance`）：

| id | name | goal | palette / 其他 | check |
|---|---|---|---|---|
| 1 | 点亮一盏灯 | 让灯亮起来 | battery 1, lamp 1 | 任一灯亮 |
| 2 | 加个开关 | 用开关控制灯 | battery 1, lamp 1, switch 1 | 存在开关 s：副本 s 闭合时所有灯亮、断开时所有灯都不亮 |
| 3 | 串联和并联 | 两种接法都试，比一比亮度 | battery 1, lamp 2；`defaults.battery = {cells: 2}`；`locked.battery = ['cells']` | 见下 |
| 4 | 一个亮一个灭 | 一个开关只控制其中一个灯 | battery 1, lamp 2, switch 1 | 存在开关 s：断开时恰好一亮一灭；闭合时两灯都亮 |
| 5 | 让 LED 亮起来 | 点亮 LED，别烧坏它 | battery 2, led 1, resistor 1 | 任一 LED 亮（当前真实结果） |
| 6 | 调光台灯 | 用变阻器调灯的亮度 | battery 1, lamp 1, rheostat 1 | 存在变阻器 r 和灯 l：副本 `pos=0`、`pos=1` 各解一次，两次 l 未烧断、功率都 > 1e-4 W，且大 ≥ 小 × 2 |
| 7 | 让风扇反转 | 让风扇反着转 | palette 空；preset：battery(6,8)、motor(14,8)，导线 B.p→M.a、M.b→B.n（正转） | 任一电机 `v < −0.5` |
| 8 | 楼梯灯 | 楼上楼下都能开关同一盏灯 | battery 1, lamp 1, spdt 2 | 存在两个 spdt s1、s2 和灯 l：枚举 4 种 `to` 组合，任一开关单独切换都改变 l 的亮灭 |
| 9 | 量一量 | 测出灯泡的电流和电压 | battery 1, lamp 1, ammeter 1, voltmeter 1 | 存在灯 l（亮）、电流表 A、电压表 V：`|A.i| ≥ 0.01`、`|V.v| ≥ 0.1`、`||A.i|−|l.i|| ≤ 0.05·|l.i|`、`||V.v|−|l.v|| ≤ 0.05·|l.v|` |
| 10 | 保险丝救场 | 用保险丝保护短路的电池 | fuse 1；preset：battery(6,8)、lamp(14,8)，导线 B.p→L.a、L.b→B.n、B.p→B.n（短接） | 见下 |

第 3 关（progress `{ first: null | { topoRev, powers: Record<id, number> } }`）：当前结果两灯都亮时——`first` 为空则记录 `{topoRev: result.topoRev, powers}`，返回 hint `试试另一种接法，亮度有什么不同？`；`first` 已有且 `result.topoRev !== first.topoRev` 且每盏灯 `max(p, p0)/min(p, p0) ≥ 2` → passed。其余情况不改 progress，hint 保持（first 非空时继续返回同一 hint）。

第 10 关（progress `{ pre: null | { iFuse, iBatt } }`）：遍历 `ws.trail`，对每个 `brokenKey` 不含该保险丝 id 的结果，记录 `pre = {iFuse: |F.i|, iBatt: |B.i|}`（取最后一个）。保险丝在 `ws.damage.broken` 且 `|当前 B.i| < 3` 且 `pre` 满足 `|iFuse − iBatt| ≤ 0.05·iBatt` 且 `iFuse > 3` → passed。

- [ ] **Step 1: 写失败测试 `circuit/test/tasks.test.js`**

每关至少一个通过用例、一个不通过用例。用 `settle(circuit, createDamage())` 得到 ws。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, evaluateTask, remainingPalette } from '../lib/tasks.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { setParam, addWire, addPart } from '../lib/circuit.js';
import { build } from './helpers.js';

const T = n => TASKS[n - 1];
const run = (n, c, progress = T(n).initProgress()) => evaluateTask(T(n), progress, settle(c, createDamage()));
const series2 = (cells = 2) => build({ parts: { B: ['battery', { cells }], L1: ['lamp'], L2: ['lamp'] },
  wires: [['B.p', 'L1.a'], ['L1.b', 'L2.a'], ['L2.b', 'B.n']] });

test('ten tasks in spec order', () => {
  assert.deepEqual(TASKS.map(t => t.name), ['点亮一盏灯', '加个开关', '串联和并联', '一个亮一个灭', '让 LED 亮起来', '调光台灯', '让风扇反转', '楼梯灯', '量一量', '保险丝救场']);
});

test('task 2: switch must control lamp', () => {
  const good = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'] }, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(2, good).passed, true);
  const bypass = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'] }, wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['S.a', 'B.p']] });
  assert.equal(run(2, bypass).passed, false);
});

test('task 2 evaluator does not mutate the real circuit', () => {
  const c = build({ parts: { B: ['battery'], S: ['switch'], L: ['lamp'] }, wires: [['B.p', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.n']] });
  const snapshot = structuredClone(c);
  run(2, c);
  assert.deepEqual(c, snapshot);
});

test('task 3: series then parallel passes; changing cells only does not', () => {
  const s = series2();
  const r1 = run(3, s);
  assert.equal(r1.passed, false);
  assert.equal(r1.hint, '试试另一种接法，亮度有什么不同？');
  const sameTopo = setParam(s, 'B', 'cells', 4);
  assert.equal(run(3, sameTopo, r1.progress).passed, false);
  const par = build({ parts: { B: ['battery', { cells: 2 }], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  par.topoRev = s.topoRev + 3;
  assert.equal(run(3, par, r1.progress).passed, true);
});

test('task 5: LED with resistor passes, LED alone on 2 cells burns and fails', () => {
  const ok = build({ parts: { B1: ['battery'], B2: ['battery'], R: ['resistor', { ohms: 220 }], D: ['led'] },
    wires: [['B1.p', 'B2.n'], ['B2.p', 'R.a'], ['R.b', 'D.a'], ['D.k', 'B1.n']] });
  assert.equal(run(5, ok).passed, true);
  const burn = build({ parts: { B1: ['battery'], B2: ['battery'], D: ['led'] }, wires: [['B1.p', 'B2.n'], ['B2.p', 'D.a'], ['D.k', 'B1.n']] });
  assert.equal(run(5, burn).passed, false);
});

test('task 6: wiper used passes, fixed ends fails', () => {
  const mk = w => build({ parts: { B: ['battery'], R: ['rheostat'], L: ['lamp'] }, wires: [['B.p', 'R.a'], [w, 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(6, mk('R.w')).passed, true);
  assert.equal(run(6, mk('R.b')).passed, false);
});

test('task 7: preset runs forward and fails; reversed passes', () => {
  assert.equal(run(7, T(7).preset()).passed, false);
  const rev = build({ parts: { B: ['battery'], M: ['motor'] }, wires: [['B.p', 'M.b'], ['M.a', 'B.n']] });
  assert.equal(run(7, rev).passed, true);
});

test('task 8: staircase wiring passes, single switch fails', () => {
  const st = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'S2.a'], ['S1.b', 'S2.b'], ['S2.c', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(8, st).passed, true);
  const one = build({ parts: { B: ['battery'], S1: ['spdt'], S2: ['spdt'], L: ['lamp'] },
    wires: [['B.p', 'S1.c'], ['S1.a', 'L.a'], ['L.b', 'B.n']] });
  assert.equal(run(8, one).passed, false);
});

test('task 9: correct meters pass, ammeter across lamp fails', () => {
  const ok = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'A.p'], ['A.n', 'L.a'], ['L.b', 'B.n'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(9, ok).passed, true);
  const bad = build({ parts: { B: ['battery'], A: ['ammeter'], L: ['lamp'], V: ['voltmeter'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['A.p', 'L.a'], ['A.n', 'L.b'], ['V.p', 'L.a'], ['V.n', 'L.b']] });
  assert.equal(run(9, bad).passed, false);
});

test('task 10: preset fails; fuse in the short loop passes; fuse elsewhere fails', () => {
  assert.equal(run(10, T(10).preset()).passed, false);
  const inLoop = build({ parts: { B: ['battery'], L: ['lamp'], F: ['fuse'] },
    wires: [['B.p', 'L.a'], ['L.b', 'B.n'], ['B.p', 'F.a'], ['F.b', 'B.n']] });
  assert.equal(run(10, inLoop).passed, true);
  const elsewhere = build({ parts: { B: ['battery'], L: ['lamp'], F: ['fuse'] },
    wires: [['B.p', 'F.a'], ['F.b', 'L.a'], ['L.b', 'B.n'], ['B.p', 'B.n']] });
  assert.equal(run(10, elsewhere).passed, false);
});

test('remainingPalette counts non-preset parts on canvas', () => {
  const t = T(1);
  let c = t.preset();
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 1 });
  c = addPart(c, 'lamp', 5, 5).circuit;
  assert.deepEqual(remainingPalette(t, c), { battery: 1, lamp: 0 });
  assert.deepEqual(remainingPalette(T(7), T(7).preset()), {});
});
```

另外为第 1、4 关各补一个通过、一个不通过用例（第 4 关：并联、开关在一条支路上 → 通过；开关在干路上 → 不通过）。

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/tasks.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `circuit/lib/tasks.js`**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/tasks.js circuit/test/tasks.test.js
git commit -m "feat(circuit): 10 个小任务与物理判定"
```

---

### Task 6: 编辑器 reducer（撤销、元件栏上限、清空、模式）

**Files:**
- Create: `circuit/lib/editor.js`
- Test: `circuit/test/editor.test.js`

**Interfaces:**
- Consumes: Task 1 电路操作、Task 4 `settle/tick/repair/createDamage`、Task 5 `TASKS/evaluateTask/remainingPalette`
- Produces:
  - `createEditor() → EditorState`
  - `EditorState = { mode: 'free'|'task', style: 'cartoon'|'symbol', muted: boolean, selection: null | {kind: 'part'|'wire', id}, confirmClear: boolean, free: Space, task: Space & { index: number, progress, passed: boolean, hint: string|null } }`
  - `Space = Workspace & { history: Circuit[] }`（Workspace 见 Task 4）
  - `activeSpace(state) → Space`
  - `reduce(state, action) → EditorState`；action 无效或无变化时返回**原 state 对象**（view 据此跳过重绘）
  - actions：
    - `{type:'setMode', mode}`、`{type:'setStyle', style}`、`{type:'toggleMute'}`
    - `{type:'place', partType, x, y}`：task 模式下 `remainingPalette` 为 0 则拒绝；参数用 `defaults`。成功后选中新元件。
    - `{type:'move', id, x, y, coalesce?}`、`{type:'rotate', id}`、`{type:'connect', from, to}`
    - `{type:'toggle', id}`：switch 翻 `closed`；spdt 在 'a'/'b' 间切换
    - `{type:'setParam', id, key, value, coalesce?}`：task 模式下 `locked[type]` 里的 key 拒绝
    - `{type:'deletePart', id}`、`{type:'deleteWire', id}`：删除的若是当前选中项，`selection = null`
    - `{type:'repair', id}`、`{type:'select', target}`
    - `{type:'undo'}`、`{type:'askClear'}`、`{type:'cancelClear'}`、`{type:'confirmClear'}`
    - `{type:'chooseTask', index}`、`{type:'nextTask'}`（index 到 9 后不再前进）
    - `{type:'tick', dt}`

规则：
- 每个改变电路的 action 先把当前 circuit 推入 `history`（上限 100，超出丢最早的），`coalesce: true` 时不推。然后 `settle(newCircuit, space.damage)`。
- `undo`：弹出快照，恢复后 `rev = 当前 rev + 1`、`topoRev = 当前 topoRev + 1`（保证旧结果对不上新版本），再 `settle`。history 空时返回原 state。`selection` 置 null。
- `confirmClear`：free → `createCircuit()`；task → `TASKS[index].preset()` 并重置 `progress/passed/hint`。清空可撤销。damage 重置为 `createDamage()`。
- `chooseTask` / `nextTask`：task 空间整体重建为该关预置、空 history、新 progress。
- task 模式下每次 settle 或 tick 后调用 `evaluateTask`；`passed` 一旦为 true 保持到换关或清空。
- `free` 与 `task` 两个空间互不影响。`tick` 只推进当前模式的空间。

- [ ] **Step 1: 写失败测试 `circuit/test/editor.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, reduce, activeSpace } from '../lib/editor.js';

const play = (s, ...as) => as.reduce(reduce, s);
const parts = s => activeSpace(s).circuit.parts;

test('place / move / connect / setParam / delete are undoable', () => {
  let s = play(createEditor(), { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 12, y: 5 });
  const [b, l] = parts(s).map(p => p.id);
  s = play(s, { type: 'move', id: l, x: 13, y: 6 });
  s = play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { part: l, term: 'a' } });
  s = play(s, { type: 'setParam', id: b, key: 'cells', value: 3 });
  s = play(s, { type: 'undo' });
  assert.equal(parts(s)[0].params.cells, 1);
  s = play(s, { type: 'undo' });
  assert.equal(activeSpace(s).circuit.wires.length, 0);
  s = play(s, { type: 'undo' });
  assert.deepEqual([parts(s)[1].x, parts(s)[1].y], [12, 5]);
});

test('undo deletePart restores wires and rev stays monotonic', () => {
  let s = play(createEditor(), { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 12, y: 5 });
  const [b, l] = parts(s).map(p => p.id);
  s = play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { part: l, term: 'a' } },
    { type: 'connect', from: { part: l, term: 'b' }, to: { part: b, term: 'n' } });
  const rev = activeSpace(s).circuit.rev;
  s = play(s, { type: 'select', target: { kind: 'part', id: l } }, { type: 'deletePart', id: l });
  assert.equal(s.selection, null);
  s = play(s, { type: 'undo' });
  assert.equal(activeSpace(s).circuit.wires.length, 2);
  assert.ok(activeSpace(s).circuit.rev > rev + 1);
  assert.equal(activeSpace(s).result.rev, activeSpace(s).circuit.rev);
  assert.ok(activeSpace(s).result.parts[l].p > 0.1);
});

test('coalesced moves make a single undo step', () => {
  let s = play(createEditor(), { type: 'place', partType: 'lamp', x: 5, y: 5 });
  const id = parts(s)[0].id;
  s = play(s, { type: 'move', id, x: 6, y: 5 }, { type: 'move', id, x: 7, y: 5, coalesce: true }, { type: 'move', id, x: 8, y: 5, coalesce: true });
  s = play(s, { type: 'undo' });
  assert.equal(parts(s)[0].x, 5);
});

test('clear needs confirmation and is undoable', () => {
  let s = play(createEditor(), { type: 'place', partType: 'lamp', x: 5, y: 5 }, { type: 'askClear' });
  assert.equal(s.confirmClear, true);
  s = play(s, { type: 'cancelClear' });
  assert.equal(parts(s).length, 1);
  s = play(s, { type: 'askClear' }, { type: 'confirmClear' });
  assert.equal(parts(s).length, 0);
  assert.equal(s.confirmClear, false);
  assert.equal(parts(play(s, { type: 'undo' })).length, 1);
});

test('palette limit in task mode follows deletes and undo', () => {
  let s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: 0 },
    { type: 'place', partType: 'lamp', x: 5, y: 5 });
  const after = play(s, { type: 'place', partType: 'lamp', x: 9, y: 5 });
  assert.equal(after, s);
  s = play(s, { type: 'undo' }, { type: 'place', partType: 'lamp', x: 9, y: 5 });
  assert.equal(parts(s).length, 1);
});

test('task 3 locks battery cells; task 1 passes when wired', () => {
  let s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: 2 }, { type: 'place', partType: 'battery', x: 5, y: 5 });
  const b = parts(s)[0];
  assert.equal(b.params.cells, 2);
  assert.equal(play(s, { type: 'setParam', id: b.id, key: 'cells', value: 4 }), s);
  s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: 0 },
    { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 12, y: 5 });
  const [bb, l] = parts(s).map(p => p.id);
  s = play(s, { type: 'connect', from: { part: bb, term: 'p' }, to: { part: l, term: 'a' } },
    { type: 'connect', from: { part: l, term: 'b' }, to: { part: bb, term: 'n' } });
  assert.equal(s.task.passed, true);
});

test('free and task spaces are independent; toggle flips switches', () => {
  let s = play(createEditor(), { type: 'place', partType: 'switch', x: 5, y: 5 });
  const id = parts(s)[0].id;
  s = play(s, { type: 'toggle', id });
  assert.equal(parts(s)[0].params.closed, true);
  s = play(s, { type: 'setMode', mode: 'task' });
  assert.equal(s.free.circuit.parts.length, 1);
  assert.notEqual(activeSpace(s), s.free);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/editor.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `circuit/lib/editor.js`**

`createEditor()` 的 task 空间初始为第 1 关（index 0）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/editor.js circuit/test/editor.test.js
git commit -m "feat(circuit): 编辑器 reducer（撤销、清空、元件栏上限）"
```

---

### Task 7: 几何与命中测试

**Files:**
- Create: `circuit/lib/geometry.js`
- Test: `circuit/test/geometry.test.js`

**Interfaces:**
- Consumes: `PARTS`
- Produces（坐标单位：网格；1 格 = `GRID` = 40 SVG 单位）：
  - `GRID = 40`，`BOARD = { w: 28, h: 18 }`（格）
  - `rotatePoint([x, y], rot) → [x, y]`：每步顺时针 90°，`(x, y) → (−y, x)`
  - `terminalPoint(part, term) → [gx, gy]`（绝对网格坐标）
  - `BODY_RECT = { x0: -1.6, x1: 1.6, y0: -0.6, y1: 0.6 }`，`LEVER_RECT = { x0: -0.6, x1: 0.6, y0: -1.8, y1: -0.6 }`（本地、旋转前；半开区间，y = −0.6 属于 body）
  - `TERM_R = 0.55`、`WIRE_HIT = 0.5`（格）
  - `hitTest(circuit, [gx, gy]) → null | {kind:'terminal', part, term} | {kind:'lever', id} | {kind:'part', id} | {kind:'wire', id}`；优先级 terminal > lever > part > wire；元件按 `parts` 逆序（后放的在上）。命中矩形时先把点转到元件本地坐标（反向旋转）。
  - `wireRoute(p1, p2) → [x, y][]`：先水平后竖直的直角折线 `[p1, [p2.x, p1.y], p2]`，共线时去掉拐点
  - `snap([x, y]) → [round(x), round(y)]`，并把元件中心钳在 `x ∈ [3, BOARD.w − 3]`、`y ∈ [3, BOARD.h − 3]`

- [ ] **Step 1: 写失败测试 `circuit/test/geometry.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID, rotatePoint, terminalPoint, hitTest, wireRoute, snap, BODY_RECT, LEVER_RECT, TERM_R } from '../lib/geometry.js';
import { build } from './helpers.js';

test('rotation is clockwise in screen coords', () => {
  const z = p => p.map(v => v + 0); // 把 -0 规整成 0
  assert.deepEqual(z(rotatePoint([2, 0], 1)), [0, 2]);
  assert.deepEqual(z(rotatePoint([2, 0], 2)), [-2, 0]);
});

test('terminalPoint follows position and rotation', () => {
  const p = { id: 'L', type: 'lamp', x: 10, y: 8, rot: 1, params: {} };
  assert.deepEqual(terminalPoint(p, 'a').map(v => v + 0), [10, 6]);
});

test('lever and body touch areas are >= 44pt and disjoint', () => {
  const size = r => [(r.x1 - r.x0) * GRID, (r.y1 - r.y0) * GRID];
  assert.ok(size(LEVER_RECT).every(v => v >= 44));
  assert.ok(size(BODY_RECT).every(v => v >= 44));
  assert.ok(LEVER_RECT.y1 <= BODY_RECT.y0);
  assert.ok(TERM_R * 2 * GRID >= 44);
});

test('hitTest priority and lever only on switches', () => {
  const c = build({ parts: { S: ['switch'], L: ['lamp'] }, wires: [] });
  const [s, l] = c.parts;
  s.x = 5; s.y = 5; l.x = 15; l.y = 5;
  assert.deepEqual(hitTest(c, [5, 4]), { kind: 'lever', id: 'S' });
  assert.deepEqual(hitTest(c, [5, 5]), { kind: 'part', id: 'S' });
  assert.deepEqual(hitTest(c, [3, 5]), { kind: 'terminal', part: 'S', term: 'a' });
  assert.equal(hitTest(c, [15, 4]), null);
  s.rot = 1;
  assert.deepEqual(hitTest(c, [6, 5]), { kind: 'lever', id: 'S' });
});

test('wire hit and route', () => {
  assert.deepEqual(wireRoute([1, 1], [4, 3]), [[1, 1], [4, 1], [4, 3]]);
  assert.deepEqual(wireRoute([1, 1], [4, 1]), [[1, 1], [4, 1]]);
  assert.deepEqual(snap([0.4, 30.6]), [3, 15]);
});
```

（再补一条：导线 `B.p→L.a` 中点附近 0.3 格处 `hitTest` 返回 `{kind:'wire', id:'w1'}`。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/geometry.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `circuit/lib/geometry.js`**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/geometry.js circuit/test/geometry.test.js
git commit -m "feat(circuit): 网格几何与触控命中"
```

---

### Task 8: 视觉映射（viewmodel）

**Files:**
- Create: `circuit/lib/viewmodel.js`
- Test: `circuit/test/viewmodel.test.js`

**Interfaces:**
- Consumes: `PHYS`、Result、Damage
- Produces:
  - `partVisual(part, reading | undefined, damage, ok: boolean) → Visual`
  - `Visual = { glow: number, burnt: boolean, alarm: boolean, spin: number, volume: number, text: string | null, stale: boolean }`
    - `stale = !ok`；`!ok` 或 `reading` 缺失时 glow/spin/volume 为 0，电表 `text = '--'`
    - lamp：`glow = clamp(p / LAMP_P_RATED, 0, 2)`，烧断为 0
    - led：`glow = clamp(i / 0.02, 0, 1.5)`，`i < LED_LIT_A` 时 0
    - motor：`spin = v`（圈/秒，带符号）
    - buzzer：`volume = v > 0 && i ≥ 0.001 ? clamp(i / 0.03, 0, 1) : 0`
    - ammeter：`text = formatReading(i, 'A')`；voltmeter：`text = formatReading(v, 'V')`
    - `burnt = !!damage.broken[id]`、`alarm = !!damage.alarm[id]`
  - `wireFlow(reading | undefined, ok) → null | { speed: number, dir: 1 | -1 }`：`!ok` 或 `|i| < 0.001` → null；`speed = clamp(|i|·200, 20, 400)`（SVG 单位/秒），`dir = sign(i)`
  - `formatReading(x, unit) → string`：非有限 → `'--'`；否则保留 2 位小数加空格和单位，`-0.00` 输出 `0.00`
  - `resistorBands(ohms) → string[]`：3 个颜色名（两位有效数字 + 倍率），10→`['brown','black','black']`、47→`['yellow','violet','black']`、100→`['brown','black','brown']`、220→`['red','red','brown']`、470→`['yellow','violet','brown']`、1000→`['brown','black','red']`

- [ ] **Step 1: 写失败测试 `circuit/test/viewmodel.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { partVisual, wireFlow, formatReading, resistorBands } from '../lib/viewmodel.js';
import { createDamage } from '../lib/damage.js';

const lamp = { id: 'L', type: 'lamp', params: {} };
const d = createDamage();

test('lamp glow proportional to power ratio, capped at 2', () => {
  assert.equal(partVisual(lamp, { v: 1, i: 0.1, p: 0.45 }, d, true).glow, 0.5);
  assert.equal(partVisual(lamp, { v: 9, i: 1, p: 9 }, d, true).glow, 2);
  assert.equal(partVisual(lamp, { v: 1, i: 0.1, p: 0.45 }, { ...d, broken: { L: true } }, true).glow, 0);
});

test('invalid result: meters show --, nothing animates, never NaN', () => {
  const am = { id: 'A', type: 'ammeter', params: {} };
  const v = partVisual(am, undefined, d, false);
  assert.equal(v.text, '--');
  assert.equal(v.stale, true);
  assert.equal(formatReading(NaN, 'V'), '--');
  assert.equal(formatReading(-0.001, 'A'), '0.00 A');
  assert.equal(formatReading(1.4849, 'V'), '1.48 V');
  assert.equal(wireFlow({ i: 2 }, false), null);
});

test('motor spin signed, buzzer only forward', () => {
  assert.equal(partVisual({ id: 'M', type: 'motor', params: {} }, { v: -1.4, i: -0.28, p: 0.39 }, d, true).spin, -1.4);
  assert.equal(partVisual({ id: 'Z', type: 'buzzer', params: {} }, { v: -1.5, i: -0.03, p: 0.045 }, d, true).volume, 0);
  assert.equal(partVisual({ id: 'Z', type: 'buzzer', params: {} }, { v: 1.5, i: 0.03, p: 0.045 }, d, true).volume, 1);
});

test('wire flow speed and direction', () => {
  assert.equal(wireFlow({ i: 0.0005 }, true), null);
  assert.deepEqual(wireFlow({ i: -0.15 }, true), { speed: 30, dir: -1 });
  assert.deepEqual(wireFlow({ i: 14 }, true), { speed: 400, dir: 1 });
});

test('resistor color bands', () => {
  assert.deepEqual([10, 47, 100, 220, 470, 1000].map(resistorBands), [
    ['brown', 'black', 'black'], ['yellow', 'violet', 'black'], ['brown', 'black', 'brown'],
    ['red', 'red', 'brown'], ['yellow', 'violet', 'brown'], ['brown', 'black', 'red']]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/viewmodel.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `circuit/lib/viewmodel.js`**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/viewmodel.js circuit/test/viewmodel.test.js
git commit -m "feat(circuit): 求解结果到视觉参数的映射"
```

---

### Task 9: 元件两种画法（SVG 字符串）

**Files:**
- Create: `circuit/lib/drawings.js`
- Test: `circuit/test/drawings.test.js`

**Interfaces:**
- Consumes: `PARTS`、`GRID`、`LEVER_RECT`、`Visual`（Task 8）、`resistorBands`
- Produces: `drawPart(part, style: 'cartoon'|'symbol', visual: Visual) → string`：返回一段 SVG 片段（不含外层 `<g>` 的平移旋转，由 view 包），坐标为本地 SVG 单位（端点在 `termPos × GRID`）。约定：
  - 每个端点画一个 `<circle class="term" data-term="名">`（可见半径约 7，触控范围由 geometry 管）
  - 有拨片的元件把拨片画在 `<g class="lever">` 里，落在 `LEVER_RECT × GRID` 范围内；开关闭合/断开、spdt 指向 a/b 画面不同
  - lamp：`visual.glow > 0` 时画 `<circle class="glow">`，半径与不透明度随 glow 增大；`visual.burnt` 时整体加 `class="burnt"`（灰色、灯丝断开）并且不画光晕
  - led：按 `params.color` 着色；烧坏时 `class="burnt"`（变黑）并画一缕烟
  - battery：节数画在上面（实物画法画 n 节电池，符号画法标 `n×1.5V`）；`visual.alarm` 时加 `class="alarm"` 并画气泡文字「短路啦！」
  - motor：扇叶放在 `<g class="fan">` 里，供 view 设旋转动画
  - resistor：实物画法用 `resistorBands` 的 3 道色环；符号画法用矩形框
  - ammeter / voltmeter：表盘中央 `<text class="reading">` 写 `visual.text`
  - rheostat：滑片位置随 `params.pos` 在 a、b 之间移动
  - 美术细节由实现者决定；配色沿用首页：深棕 `#3a2e25` 线条，暖色填充

- [ ] **Step 1: 写失败测试 `circuit/test/drawings.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPart } from '../lib/drawings.js';
import { PART_TYPES, PARTS, defaultParams } from '../lib/parts.js';

const vis = (o = {}) => ({ glow: 0, burnt: false, alarm: false, spin: 0, volume: 0, text: null, stale: false, ...o });
const mk = (type, params = {}) => ({ id: 'X', type, x: 0, y: 0, rot: 0, params: { ...defaultParams(type), ...params } });

test('every type renders in both styles with all terminals and no NaN', () => {
  for (const t of PART_TYPES) for (const style of ['cartoon', 'symbol']) {
    const s = drawPart(mk(t), style, vis({ text: '--' }));
    for (const term of PARTS[t].terms) assert.match(s, new RegExp(`data-term="${term}"`), `${t}/${style}/${term}`);
    assert.doesNotMatch(s, /NaN|undefined|Infinity/);
    assert.equal(/class="lever"/.test(s), PARTS[t].lever, `${t}/${style} lever`);
  }
});

test('state shows up in drawing', () => {
  assert.match(drawPart(mk('lamp'), 'cartoon', vis({ glow: 1 })), /class="glow"/);
  assert.doesNotMatch(drawPart(mk('lamp'), 'cartoon', vis({ glow: 1, burnt: true })), /class="glow"/);
  assert.match(drawPart(mk('battery'), 'symbol', vis({ alarm: true })), /短路啦！/);
  assert.match(drawPart(mk('ammeter'), 'symbol', vis({ text: '0.15 A' })), /0\.15 A/);
  assert.notEqual(drawPart(mk('switch', { closed: true }), 'symbol', vis()), drawPart(mk('switch'), 'symbol', vis()));
  assert.notEqual(drawPart(mk('spdt', { to: 'b' }), 'cartoon', vis()), drawPart(mk('spdt'), 'cartoon', vis()));
  assert.match(drawPart(mk('resistor', { ohms: 220 }), 'cartoon', vis()), /red/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/drawings.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `circuit/lib/drawings.js`**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/drawings.js circuit/test/drawings.test.js
git commit -m "feat(circuit): 元件实物与符号两种画法"
```

---

### Task 10: 页面骨架与自由搭建交互

**Files:**
- Create: `circuit/index.html`, `circuit/styles.css`, `circuit/view.js`, `circuit/app.js`
- Test: `circuit/test/static.test.js`

**Interfaces:**
- Consumes: `createEditor/reduce/activeSpace`（Task 6）、`hitTest/terminalPoint/wireRoute/snap/GRID/BOARD`（Task 7）、`partVisual/wireFlow`（Task 8）、`drawPart`（Task 9）、`PART_TYPES/PARTS`、`remainingPalette`
- Produces:
  - `render(dom, state)`（`circuit/view.js`）：`dom = { board: SVGSVGElement, palette, panel, banner, confirm, taskbar }`；当 `state` 与上次是同一对象时直接返回
  - `circuit/app.js`：持有 `state`，`dispatch(action)` 调 `reduce` 后 `render`

页面结构（`index.html`）：
- `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`，`<title>电路实验室 - SaiSai.me</title>`，`<script type="module" src="app.js">`
- 顶栏：`⚡ 电路实验室`、模式切换「自由搭建 / 小任务」、画法切换「🧸 实物 / ⊗ 符号」、静音按钮、「↶ 撤销」、「🗑 清空」，按钮最小 44×44
- 左侧 `#palette` 竖排，可上下滑动（`overflow-y: auto`）；每项画该元件的缩小图 + 中文名；task 模式显示剩余数，为 0 时变灰不可拖
- 主区 `<svg id="board" viewBox="0 0 1120 720">`（`BOARD × GRID`），点阵背景（`<pattern>`），分层：`wires`、`parts`、`overlay`（拖线预览、选中框）
- `#panel` 浮在画布右上，`#banner`（「暂时无法计算」），`#confirm`（页内确认：「清空画布？」[清空][取消]），`#taskbar`（Task 11 用，先留空 `hidden`）

触控（`app.js`，全部用 Pointer Events + `setPointerCapture`）：
- 屏幕坐标 → 网格坐标：`svg.getScreenCTM().inverse()` 变换后除以 `GRID`
- 元件栏按下 → 跟手的幽灵图 → 在画布上松手 → `snap` → `place`
- 画布按下：`hitTest` 结果为
  - terminal：画拖线预览；松手时 `hitTest` 到另一个 terminal → `connect`
  - lever：移动不超过 8px 松手 → `toggle`
  - part：移动超过 8px 开始拖动，第一次 `move` 不带 `coalesce`、之后带 `coalesce: true`；没超过就松手 → `select`
  - wire → `select {kind:'wire'}`；空白 → `select null`
- 参数面板（选中元件时）：标题（中文名），按 `PARAMS` 生成控件（options 用分段按钮，rheostat `pos` 用 `<input type="range" min=0 max=1 step=0.01>`，拖动时 `setParam` 第一次不带 `coalesce`、之后带），task 模式隐藏 `locked` 参数；按钮「旋转 90°」「删除」；开关类加「切换」；烧坏的加「换新」。选中导线时只有「删除」。
- 防干扰：`#board, #palette { touch-action: none }`（palette 滚动另用 `touch-action: pan-y` 于列表容器、按住元件项再拖时 `preventDefault`）；`body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none }`；`document.addEventListener('gesturestart', e => e.preventDefault())`
- view 渲染：每根导线一条 `<polyline class="wire">`（`wireRoute` 端点 × GRID）；每个元件一个 `<g transform="translate(x·GRID, y·GRID) rotate(rot·90)" data-id>` 包 `drawPart(...)`；选中项加高亮描边；`result.ok` 为 false 时 `#board` 加 class `stale`（整体降饱和），`#banner` 显示
- 本任务不做动画、声音和任务栏（Task 11）

- [ ] **Step 1: 写失败测试 `circuit/test/static.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('index.html wiring', () => {
  const html = read('index.html');
  assert.match(html, /user-scalable=no/);
  assert.match(html, /<script type="module" src="app\.js">/);
  assert.match(html, /<svg[^>]*id="board"/);
  for (const id of ['palette', 'panel', 'banner', 'confirm', 'taskbar']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /https?:\/\//);
});

test('every relative import resolves and nothing is fetched from the network', () => {
  const files = ['app.js', 'view.js', 'sound.js', ...fs.readdirSync(path.join(root, 'lib')).map(f => `lib/${f}`)]
    .filter(f => fs.existsSync(path.join(root, f)));
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /https?:\/\/|localStorage|indexedDB/, f);
    for (const [, spec] of src.matchAll(/from\s+'(\.[^']+)'/g))
      assert.ok(fs.existsSync(path.join(root, path.dirname(f), spec)), `${f} -> ${spec}`);
  }
});

test('styles use toolbox background and block text selection', () => {
  const css = read('styles.css');
  assert.match(css, /#fff8ec/i);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /user-select:\s*none/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/static.test.js`
Expected: FAIL，`ENOENT ... index.html`

- [ ] **Step 3: 实现 `index.html`、`styles.css`、`view.js`、`app.js`**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 浏览器手动验证**

Run: `python3 -m http.server 8765` 后打开 `http://localhost:8765/circuit/`（有浏览器工具时用 1180×820 视口）。逐条检查：
1. 控制台无报错。
2. 从元件栏拖电池、灯泡到画布，松手后吸附网格。
3. 从电池 + 端拖到灯泡端点、再连回 − 端，出现两根直角导线，灯泡画出光晕。
4. 点开关拨片切换通断，不弹面板；点开关本体弹出面板，「切换」「旋转 90°」「删除」可用；单刀双掷开关同样。
5. 拖动已放置的元件，导线跟着走；撤销一次回到原位。
6. 点导线选中后删除；「清空」弹出页内确认，取消后电路仍在。
7. 切换「实物 / 符号」，位置和连线不变。
8. 双指捏合不缩放页面，长按不出现选字。

- [ ] **Step 6: Commit**

```bash
git add circuit/index.html circuit/styles.css circuit/view.js circuit/app.js circuit/test/static.test.js
git commit -m "feat(circuit): 页面骨架与自由搭建交互"
```

---

### Task 11: 实时效果、声音与小任务界面

**Files:**
- Create: `circuit/sound.js`
- Modify: `circuit/app.js`, `circuit/view.js`, `circuit/styles.css`, `circuit/index.html`
- Test: `circuit/test/static.test.js`（追加）

**Interfaces:**
- Consumes: `reduce` 的 `tick`、`chooseTask`、`nextTask`、`setMode`、`toggleMute`；`TASKS`；`partVisual/wireFlow`
- Produces:
  - `createBuzzer() → { unlock(): void, update(volume: number, muted: boolean): void }`（`circuit/sound.js`）：一个方波 `OscillatorNode` 2400Hz 接 `GainNode`；`unlock()` 在第一次 `pointerdown` 时创建或 `resume()` `AudioContext`（iOS 要求手势内启动）；`update` 把 gain 平滑到 `muted ? 0 : volume × 0.2`（`setTargetAtTime`，时间常数 0.03s）。无 `AudioContext` 时全部为空操作。

实现要点：
- **定时循环**：`requestAnimationFrame` 里算 `dt`（秒，钳到 ≤ 0.1，避免切后台回来一次累计过长），`dispatch({type:'tick', dt})`；reducer 返回同一对象就不重绘。
- **电流小点**：每根导线在 `<polyline class="wire">` 上叠一条 `<polyline class="flow">`，`stroke-dasharray: 2 14`，用 CSS `@keyframes` 移动 `stroke-dashoffset`（一个周期 16 单位）；`animation-duration = 16 / speed` 秒；`dir = -1` 时 `animation-direction: reverse`；`wireFlow` 为 null 时不画 flow。
- **风扇**：`.fan` 用 CSS 旋转动画，周期 `1 / |spin|` 秒，`spin < 0` 反向，`|spin| < 0.05` 不转。
- **蜂鸣器**：每帧取所有蜂鸣器 `volume` 的最大值调 `buzzer.update`；静音按钮切换图标 🔇/🔊。
- **求解失败**：`result.ok === false` 时显示 `#banner`「暂时无法计算」、`#board.stale`（灰色残影）、不画 flow、电表 `--`、蜂鸣器音量 0。
- **小任务界面**（`mode === 'task'`）：
  - `#taskbar` 显示 `第 N 关 · 名称：目标`，右侧「选关」按钮；有 `hint` 时下面一行显示 hint
  - 「选关」打开页内列表（10 项，可随意点，不锁关），点选 → `chooseTask`
  - `passed` 为 true 时显示页内通过提示「完成啦！」和「下一关」按钮（第 10 关只显示「完成啦！」）
  - 元件栏只列出该关 `palette` 里的类型并显示剩余数；第 7 关元件栏为空时显示「只需要改导线」
  - 顶栏模式按钮高亮当前模式

- [ ] **Step 1: 在 `circuit/test/static.test.js` 追加失败测试**

```js
test('effects and task UI are wired', () => {
  const app = read('app.js');
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /type:\s*'tick'/);
  assert.match(read('sound.js'), /export function createBuzzer/);
  const css = read('styles.css');
  assert.match(css, /@keyframes/);
  assert.match(css, /\.flow/);
  const html = read('index.html');
  assert.match(html, /暂时无法计算/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/static.test.js`
Expected: FAIL（`sound.js` 不存在等）

- [ ] **Step 3: 实现上述内容**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 浏览器手动验证**

Run: `python3 -m http.server 8765`，打开 `http://localhost:8765/circuit/`。逐条检查：
1. 电池 + 灯泡接通：导线上小点沿 + → − 方向流动；把电池调成 4 节，约 0.6 秒后灯泡烧断变灰，面板出现「换新」，点后恢复（再次 0.6 秒后又烧断）。
2. 串联两灯比单灯暗；并联两灯与单灯差不多亮。
3. LED 反接不亮；2 节电池 + 220Ω 正接发亮；去掉电阻直接接 2 节电池，LED 立刻烧坏冒烟。
4. 风扇正接、反接旋转方向相反。蜂鸣器正接出声，点静音后无声。
5. 电池被导线短接约 0.6 秒后发红并显示「短路啦！」，删掉短接导线后恢复。
6. 拖动变阻器滑块，灯亮度连续变化。
7. 切到「小任务」，第 1 关接通后出现「完成啦！」和「下一关」；切回「自由搭建」，之前的电路还在。
8. 第 3 关：串联接通出现提示；改成并联后通过。第 10 关：初始电池发红；把保险丝串进短接导线后熔断、灯亮、通过。

- [ ] **Step 6: Commit**

```bash
git add circuit/
git commit -m "feat(circuit): 电流动画、蜂鸣器声音与小任务界面"
```

---

### Task 12: 首页入口与 README

**Files:**
- Modify: `index.html`, `README.md`, `tests/homepage.test.mjs`

**Interfaces:**
- Consumes: main 分支上的卡片网格首页（commit `a876983`，含 `tests/homepage.test.mjs`）

- [ ] **Step 1: 确认本分支已包含首页改版**

Run: `grep -c 'class="card"' index.html`
Expected: `6`。如果输出 `0`（本分支从 `5ceddd1` 分出，还没有改版），执行 `git merge --no-edit main`，再运行一次，输出应为 `6`，且 `tests/homepage.test.mjs` 存在。

- [ ] **Step 2: 改 `tests/homepage.test.mjs` 让它期待第 7 张卡（先失败）**

在 `EXPECTED` 末尾追加 `['circuit', 'circuit/index.html', '电路实验室']`；card 数 `6` 改为 `7`；描述列表末尾追加 `'连电线 点亮小灯'`。文件里其余写死 6 张卡的断言（若有）同步改为 7。

Run: `node --test tests/homepage.test.mjs`
Expected: FAIL（card 数为 6）

- [ ] **Step 3: 在 `index.html` 卡片网格末尾加一张卡**

`<a class="card" href="circuit/index.html" data-tool="circuit">`，`card-title` 为「电路实验室」，`card-desc` 为「连电线 点亮小灯」。在 CSS 的 `data-tool` 配色表里加 `.card[data-tool="circuit"] { --accent: #0ea5b7; --tint: #dcf5f8; }`。插图 `viewBox="0 0 200 150"`、`aria-hidden="true" focusable="false"`，画一个电池、一盏亮着的灯泡和连接两者的导线，风格照抄现有卡片（`var(--tint)` 底、`#3a2e25` 线条、`var(--accent)` 点缀），满足该测试文件里对插图的其余断言（形状数量等）。

- [ ] **Step 4: 在 `README.md` 项目列表末尾追加**

```markdown
### ⚡ [电路实验室](circuit/index.html) (circuit)
拖元件、连导线，自己搭电路。按真实物理计算灯亮、LED、风扇、蜂鸣器、电表读数，会短路报警、保险丝熔断。带 10 个小任务。
```

- [ ] **Step 5: 运行全部测试**

Run: `node --test tests/homepage.test.mjs circuit/test/*.test.js`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add index.html README.md tests/homepage.test.mjs
git commit -m "feat(home): 首页加入电路实验室入口"
```
