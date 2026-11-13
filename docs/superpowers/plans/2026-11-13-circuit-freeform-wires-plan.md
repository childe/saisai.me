# 电路实验室：自由画导线与导线上加连接点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导线可以跟手画成直角折线、可以拖动线段调整路线，可以在导线上加「连接点」并从连接点或导线上直接拉出分支。

**Architecture:** 导线新增可选字段 `via`（拐点数组，有无区分自动/显式走线）和 `r`（导线电阻）。新增单端点元件类型 `node`。所有路线计算是 `lib/geometry.js` 里的纯函数（展开、分割、拼接、最近点、轨迹、线段拖动）；`lib/circuit.js` 做不可变的分割/合并/清理；`lib/editor.js` 把每个编辑动作包成一次 commit（一步撤销）；`app.js` 只做手势锁定与预览。

**Tech Stack:** 原生 ES modules，无构建、无依赖；测试 `node:test` + `node:assert/strict`。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261113-090827-circuit-freeform-wires/docs/superpowers/specs/2026-11-13-circuit-freeform-wires-design.md`（执行前通读，本计划只写决定，不复述理由）

**路径约定：** 下文相对路径都相对 `circuit/`。测试命令从 worktree 根目录执行：`node --test circuit/test`。

## Global Constraints

- 没有 `via` 字段的导线，`wirePoints` 输出与改动前逐点相同（含同元件 U 形，`SELF_WIRE_OFFSET = 1.5`）。
- `via` 存在即显式路线，**包括 `[]`**；`via: []` 的同元件导线不走 U 形。新画、调整、分割、合并产生的导线一律写数组，不写回 `undefined`。
- 导线电阻 = `w.r ?? PHYS.R_WIRE`；分割两段各 `R / 2`，合并 `r1 + r2`。旧数据、预设、新画的导线、`junctionWires` 都不写 `r`。
- `node` 不进 `PART_TYPES`（`PART_TYPES.length` 仍为 12），不受任务元件数量限制。
- 命中优先级：terminal > handle（仅选中导线）> lever > part > wire。未传选中导线时 `hitTest` 结果与改动前完全相同（含返回对象形状 `{ kind: 'wire', id }`）。
- 触控命中区不小于 `MIN_TOUCH_PT = 44`（把手半径用 `touchAreas(k).termR`）；拖动阈值沿用 `DRAG_PX = 8`。
- 每个编辑动作只占一步撤销；线段拖动用 `coalesce`；`pointercancel` 不回滚已提交的结果。
- 测试放 `circuit/test/`，沿用 `node:test`；所有现有测试不改即通过。
- 坐标比较时注意 `-0`：测试里用 `norm = pts => pts.map(p => p.map(v => v + 0))` 再 `deepEqual`。

## Review Focus

1. 删除一个普通元件，连到它的导线被删后，与其相邻的连接点若已无导线应被清理，仍有导线的保留 → Task 5 测试 `removePart prunes nodes left without wires`。
2. 任务模式下在预设导线（自动走线）上加连接点：任务元件栏余量不变，电路仍可求解且任务判定不倒退 → Task 6 测试 `task mode: splitting a preset wire keeps palette and pass state`。
3. 连接点落在别的元件端点同一格点上时，按「重合端点接通」处理（`junctionWires` 对单端点元件生效）→ Task 1 测试 `node coincident with a terminal is connected`。
4. `connect` 中先分割导线、后 `addWire` 失败（重复连线等）时，整个动作作废，不留下孤立连接点或被分割的导线 → Task 6 测试 `connect that fails after split leaves circuit untouched`。
5. 删除连接点时，若它的两根导线另一端是同一个端点（合并后成自环），退化为「删连接点和所有相连导线」，不产生 a、b 相同的导线 → Task 5 测试 `removing a node whose two wires meet the same terminal deletes everything`。

---

### Task 1: `node` 元件、导线电阻 `r`、求解器适配

**Files:**
- Modify: `lib/parts.js`（`PARTS` 加 `node`；新增 `wireR`）
- Modify: `lib/solve.js:134`（加电导）、`lib/solve.js:235`（导线电流）、`solveComponent` 的 GMIN 循环、`readPart`
- Modify: `lib/circuit.js` `cloneCircuit`
- Test: `test/node-solve.test.js`（新建）

**Interfaces:**
- Produces:
  - `PARTS.node = { label: '连接点', terms: ['o'], termPos: { o: [0, 0] }, params: {}, lever: false }`（不加进 `PART_TYPES`）
  - `export function wireR(w): number` in `lib/parts.js` → `w.r ?? PHYS.R_WIRE`
  - `solve` 对 `node` 的读数 `{ v: 0, i: 0, p: 0 }`
  - `cloneCircuit` 深拷贝 `via`（`via` 不存在时克隆结果也没有 `via` 键），`r` 随导线拷贝

**决定（实现方必须照做）：** `solveComponent` 里 `G[i][i] += PHYS.GMIN` 只加在**非连接点**的节点上（连接点端点键为 `${id}.o` 且该元件 `type === 'node'`）。理由：GMIN 是对地电导，连接点「不贡献电导」。已实测：不跳过时电池—灯回路加一个连接点，电池电流相对误差约 9.9e-9，超出验收的 1e-9；跳过后约 2.7e-12。连接点只通过导线与其他节点相连，导线链必然到达一个带 GMIN 的普通端点，矩阵不会奇异。

- [ ] **Step 1: 写失败测试** `test/node-solve.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../lib/solve.js';
import { settle } from '../lib/engine.js';
import { createDamage } from '../lib/damage.js';
import { PARTS, PART_TYPES, PHYS, wireR } from '../lib/parts.js';
import { cloneCircuit } from '../lib/circuit.js';
import { build, loop } from './helpers.js';

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
const sameReadings = (r0, r1, ids, tol) => {
  for (const id of ids) for (const k of ['v', 'i', 'p'])
    assert.ok(rel(r0.parts[id][k], r1.parts[id][k]) <= tol, `${id}.${k} ${r0.parts[id][k]} vs ${r1.parts[id][k]}`);
};
// B.p → N.o → X.<t0>，两段各 R/2；X.<t1> → B.n
const viaNode = (xType, t0, t1) => {
  const c = build({ parts: { B: ['battery'], N: ['node'], X: [xType] }, wires: [['B.p', 'N.o'], ['N.o', `X.${t0}`], [`X.${t1}`, 'B.n']] });
  c.parts[1].y = 9; // 节点不与任何端点重合
  c.wires[0].r = PHYS.R_WIRE / 2; c.wires[1].r = PHYS.R_WIRE / 2;
  return c;
};

test('node part is a hidden one-terminal type', () => {
  assert.deepEqual(PARTS.node.terms, ['o']);
  assert.deepEqual(PARTS.node.termPos.o, [0, 0]);
  assert.equal(PART_TYPES.includes('node'), false);
  assert.equal(PART_TYPES.length, 12);
});

test('wire resistance defaults to R_WIRE and r is used by the solver', () => {
  assert.equal(wireR({}), PHYS.R_WIRE);
  assert.equal(wireR({ r: 0.25 }), 0.25);
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  c.wires[0].r = 1;
  const r = solve(c);
  assert.ok(rel(r.parts.L.i, 1.5 / (PHYS.R_CELL + PHYS.LAMP_R + 1 + PHYS.R_WIRE)) < 1e-6);
  assert.ok(rel(r.wires.w1.i, r.parts.L.i) < 1e-6);
});

test('a node on a wire changes nothing (lamp loop and low-resistance ammeter loop)', () => {
  const lamp0 = solve(loop({ B: ['battery'], X: ['lamp'] }, ['B.p', 'X.a', 'X.b', 'B.n']));
  const lamp1 = solve(viaNode('lamp', 'a', 'b'));
  sameReadings(lamp0, lamp1, ['B', 'X'], 1e-9);
  assert.deepEqual(lamp1.parts.N, { v: 0, i: 0, p: 0 });
  const am0 = solve(loop({ B: ['battery'], X: ['ammeter'] }, ['B.p', 'X.p', 'X.n', 'B.n']));
  assert.ok(Math.abs(am0.parts.X.i - 13.39) < 0.01);
  sameReadings(am0, solve(viaNode('ammeter', 'p', 'n')), ['B', 'X'], 1e-9);
});

test('parallel through nodes matches parallel from one terminal (1e-3)', () => {
  const direct = build({ parts: { B: ['battery'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'L1.a'], ['B.p', 'L2.a'], ['L1.b', 'B.n'], ['L2.b', 'B.n']] });
  const nodes = build({ parts: { B: ['battery'], N1: ['node'], N2: ['node'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'N1.o'], ['N1.o', 'L1.a'], ['N1.o', 'L2.a'], ['L1.b', 'N2.o'], ['L2.b', 'N2.o'], ['N2.o', 'B.n']] });
  nodes.parts[1].y = 12; nodes.parts[2].y = 14;
  const a = solve(direct), b = solve(nodes);
  for (const id of ['L1', 'L2']) {
    assert.ok(rel(a.parts[id].p, b.parts[id].p) <= 1e-3);
    assert.ok(b.parts[id].p >= PHYS.LAMP_LIT_P);
  }
  assert.deepEqual(settle(nodes, createDamage()).damage.broken, {});
});

test('node coincident with a terminal is connected', () => {
  // L.a 在 (13,5)；把 N 放到同一格点，N.o—B.p 一根导线即可点亮灯
  const c = build({ parts: { B: ['battery'], N: ['node'], L: ['lamp'] }, wires: [['B.p', 'N.o'], ['L.b', 'B.n']] });
  c.parts[1].x = 13; c.parts[1].y = 5; c.parts[2].x = 15; c.parts[2].y = 5;
  assert.ok(solve(c).parts.L.p >= PHYS.LAMP_LIT_P);
});

test('cloneCircuit keeps via mode and r', () => {
  const c = loop({ B: ['battery'], L: ['lamp'] }, ['B.p', 'L.a', 'L.b', 'B.n']);
  c.wires[0].via = [[3, 8]]; c.wires[0].r = 0.0005;
  const k = cloneCircuit(c);
  assert.deepEqual(k.wires[0].via, [[3, 8]]);
  assert.equal(k.wires[0].r, 0.0005);
  assert.equal('via' in k.wires[1], false);
  k.wires[0].via[0][0] = 99;
  assert.equal(c.wires[0].via[0][0], 3);
  c.wires[1].via = [];
  assert.deepEqual(cloneCircuit(c).wires[1].via, []);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/node-solve.test.js`
Expected: FAIL（`wireR` 未导出 / `PARTS.node` 为 undefined）

- [ ] **Step 3: 实现**
  - `lib/parts.js`：加 `PARTS.node` 与 `wireR`。
  - `lib/solve.js`：两处 `PHYS.R_WIRE` 换成 `wireR(w)`；`readPart` 加 `case 'node': return { v: 0, i: 0, p: 0 };`；GMIN 按上面的决定跳过连接点端点。`CONDUCTANCES` 不加 `node`。
  - `lib/circuit.js` `cloneCircuit`：`Array.isArray(w.via)` 时 `via: w.via.map(p => [...p])`，否则不写 `via` 键。

- [ ] **Step 4: 运行确认通过，并跑全量**

Run: `node --test circuit/test`
Expected: 全部 PASS（现有 solve 测试不改）

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/parts.js circuit/lib/solve.js circuit/lib/circuit.js circuit/test/node-solve.test.js
git commit -m "feat(circuit): 连接点元件与导线电阻字段"
```

---

### Task 2: 路线展开、分割、拼接、最近点（geometry 纯函数）

**Files:**
- Modify: `lib/geometry.js`
- Test: `test/wire-route.test.js`（新建）

**Interfaces:**
- Consumes: `PARTS.node`（Task 1）
- Produces（全部从 `lib/geometry.js` 导出，`Point = [number, number]`）:
  - `simplifyRoute(points: Point[]): Point[]` — 去掉相邻重复点；去掉与前后点同 x 或同 y 的中间点；结果至少 2 个点（全部重合时返回 `[p, p]`）。
  - `wirePoints(circuit, wire): Point[] | null` — 无 `via`：原逻辑不动（不经 `simplifyRoute`）。有 `via`：对 `[A, ...via, B]` 相邻两点依次 `wireRoute` 拼接，再 `simplifyRoute`。
  - `export const expandRoute = wirePoints;`
  - `nearestOnRoute(points: Point[], pt: Point): { seg: number, P: Point }` — 取距离最小的线段（并列取序号小的）；水平段 `P = [clamp(round(pt.x), min x, max x), 段的 y]`，竖直段同理。
  - `splitRoute(points: Point[], P: Point): { via1: Point[], via2: Point[] } | null` — P 等于首点或末点、或不在任何线段上（距离 > 1e-9）时返回 `null`。设 P 落在第 `i` 段（`points[i]→points[i+1]`）：`via1 = points.slice(1, i + 1)`、`via2 = points.slice(i + 1, -1)`，并从两者中剔除与 P 相等的点（P 恰为拐点时）。
  - `joinRoute(pts1: Point[], pts2: Point[]): Point[]` — `pts1` 以连接点结尾、`pts2` 以连接点开头（都是完整折线），返回 `simplifyRoute([...pts1, ...pts2.slice(1)]).slice(1, -1)`。说明：spec 写的是 `joinRoute(via1, P, via2)`；去共线点必须看到两端端点，所以改为接收完整折线，语义不变。

- [ ] **Step 1: 写失败测试** `test/wire-route.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { wirePoints, expandRoute, simplifyRoute, nearestOnRoute, splitRoute, joinRoute } from '../lib/geometry.js';
import { build } from './helpers.js';

const norm = pts => pts.map(p => p.map(v => v + 0));
const ortho = pts => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);
// B(5,5): p=(3,5) n=(7,5)；L(15,10): a=(13,10) b=(17,10)
const bl = (via) => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  if (via) c.wires[0].via = via;
  return c;
};

test('auto routes are unchanged (L and same-part U)', () => {
  const c = bl();
  assert.deepEqual(wirePoints(c, c.wires[0]), [[3, 5], [13, 5], [13, 10]]);
  assert.equal(expandRoute, wirePoints);
  const u = build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] });
  u.parts[0].x = 6; u.parts[0].y = 8;
  assert.deepEqual(norm(wirePoints(u, u.wires[0])), [[4, 8], [4, 9.5], [8, 9.5], [8, 8]]);
});

test('explicit via routes through corners and stays orthogonal after move/rotate', () => {
  const c = bl([[3, 12]]);
  assert.deepEqual(wirePoints(c, c.wires[0]), [[3, 5], [3, 12], [13, 12], [13, 10]]);
  c.parts[1].x = 17;
  assert.deepEqual(wirePoints(c, c.wires[0]), [[3, 5], [3, 12], [15, 12], [15, 10]]);
  c.parts[1].rot = 1;
  const pts = norm(wirePoints(c, c.wires[0]));
  assert.ok(ortho(pts), JSON.stringify(pts));
  assert.deepEqual(pts.at(-1), [17, 8]);
});

test('via [] on the same part is a straight route, not a U', () => {
  const u = build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] });
  u.parts[0].x = 6; u.parts[0].y = 8; u.wires[0].via = [];
  assert.deepEqual(wirePoints(u, u.wires[0]), [[4, 8], [8, 8]]);
});

test('simplifyRoute drops duplicates and collinear points', () => {
  assert.deepEqual(simplifyRoute([[3, 5], [3, 5], [8, 5], [13, 5], [13, 10]]), [[3, 5], [13, 5], [13, 10]]);
  assert.deepEqual(simplifyRoute([[2, 2], [2, 2]]), [[2, 2], [2, 2]]);
});

test('nearestOnRoute snaps along the segment only', () => {
  const pts = [[3, 5], [13, 5], [13, 10]];
  assert.deepEqual(nearestOnRoute(pts, [8.4, 5.3]), { seg: 0, P: [8, 5] });
  assert.deepEqual(nearestOnRoute(pts, [12.8, 7.6]), { seg: 1, P: [13, 8] });
  const u = [[4, 8], [4, 9.5], [8, 9.5], [8, 8]];
  assert.deepEqual(nearestOnRoute(u, [6.2, 9.7]), { seg: 1, P: [6, 9.5] });
  assert.deepEqual(nearestOnRoute(u, [4.2, 8.6]), { seg: 0, P: [4, 9] });
});

test('splitRoute / joinRoute', () => {
  const pts = [[3, 5], [13, 5], [13, 10]];
  assert.deepEqual(splitRoute(pts, [8, 5]), { via1: [], via2: [[13, 5]] });
  assert.deepEqual(splitRoute(pts, [13, 5]), { via1: [], via2: [] });
  assert.deepEqual(splitRoute(pts, [13, 8]), { via1: [[13, 5]], via2: [] });
  assert.equal(splitRoute(pts, [3, 5]), null);
  assert.equal(splitRoute(pts, [13, 10]), null);
  assert.equal(splitRoute(pts, [8, 6]), null);
  assert.deepEqual(joinRoute([[3, 5], [8, 5]], [[8, 5], [13, 5], [13, 10]]), [[13, 5]]);
  assert.deepEqual(joinRoute([[3, 5], [13, 5], [13, 8]], [[13, 8], [13, 10]]), [[13, 5]]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/wire-route.test.js`
Expected: FAIL（`simplifyRoute` 等未导出）

- [ ] **Step 3: 在 `lib/geometry.js` 实现上述五个函数并扩展 `wirePoints`**（`wireRoute`、`hitTest` 本任务不改）

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/geometry.js circuit/test/wire-route.test.js
git commit -m "feat(circuit): 导线显式路线的展开、分割与拼接"
```

---

### Task 3: 手指轨迹 → 直角路线

**Files:**
- Modify: `lib/geometry.js`
- Test: `test/wire-trace.test.js`（新建）

**Interfaces:**
- Consumes: `simplifyRoute`、`wireRoute`（Task 2 / 现有）、`BOARD`
- Produces:
  - `type Trace = { pts: Point[], dir: 'h' | 'v' | null }`（`pts[0]` 是起点，其余是已落下的拐点）
  - `startTrace(start: Point): Trace` → `{ pts: [start], dir: null }`
  - `stepTrace(trace: Trace, pt: Point): Trace`（纯函数，不修改入参）
  - `tracePath(trace: Trace, end: Point): Point[]` — 完整折线（起点…终点），已 `simplifyRoute`。导线的 `via` = `tracePath(t, end).slice(1, -1)`。
  - 常量 `TRACE_TURN = 1`（落拐点的偏离阈值，格）、`TRACE_BACK = 0.5`（回退吃掉的距离阈值，格）

**算法（参数可调，行为须满足测试）：** `stepTrace(t, pt)`，令 `last = t.pts.at(-1)`：
1. 回退：当 `pts.length >= 2` 且 `pt` 到线段 `pts.at(-2)→pts.at(-1)` 的距离 `< TRACE_BACK`：弹出最后一个拐点，`dir` 改为被弹出拐点之前那段的方向；循环直到不满足。
2. 只剩起点且 `pt` 到起点距离 `< TRACE_TURN`：`dir = null`，返回。
3. `dir === null`：若 `max(|dx|, |dy|) >= TRACE_TURN`（相对起点），`dir = |dx| >= |dy| ? 'h' : 'v'`；本步不落拐点，返回。
4. `dir === 'h'` 且 `|pt.y - last.y| >= TRACE_TURN`：拐点 `c = [clamp(round(pt.x), 0, BOARD.w), last.y]`，`dir = 'v'`。`dir === 'v'` 对称（`c = [last.x, clamp(round(pt.y), 0, BOARD.h)]`）。若 `c` 与 `last` 相同：只改 `dir`，且当 `pts.length >= 2` 时弹出 `last`（它已变成共线点）；否则把 `c` 推入 `pts`。

`tracePath(t, end)`：`dir === 'h'` 时在 `last` 与 `end` 之间插入 `[end.x, last.y]`；`'v'` 时插入 `[last.x, end.y]`；`null` 时用 `wireRoute(last, end)`（水平优先，与现在的 L 形一致）。最后 `simplifyRoute`。

- [ ] **Step 1: 写失败测试** `test/wire-trace.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTrace, stepTrace, tracePath, BOARD } from '../lib/geometry.js';

const run = (start, samples) => samples.reduce(stepTrace, startTrace(start));
const ortho = pts => pts.every((p, i) => i === 0 || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);
const onGrid = pts => pts.slice(1, -1).every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)
  && x >= 0 && x <= BOARD.w && y >= 0 && y <= BOARD.h);

test('straight drag has no corners', () => {
  const t = run([3, 5], [[4, 5.2], [6, 4.8], [9, 5.3], [12, 5.1]]);
  assert.deepEqual(tracePath(t, [13, 5]), [[3, 5], [13, 5]]);
});

test('jitter under one grid makes no corners', () => {
  const t = run([3, 5], [[4, 5.6], [6, 4.3], [8, 5.9], [10, 4.2]]);
  assert.equal(t.pts.length, 1);
  assert.deepEqual(tracePath(t, [13, 5]), [[3, 5], [13, 5]]);
});

test('L and U shapes', () => {
  const l = run([3, 5], [[5, 5], [8, 5.1], [8.2, 6.3], [8.1, 9], [8, 11]]);
  assert.deepEqual(tracePath(l, [8, 12]), [[3, 5], [8, 5], [8, 12]]);
  const u = run([3, 5], [[6, 5], [9, 5], [9.1, 6.2], [9, 9], [7.6, 9.2], [5, 9], [4, 9]]);
  const p = tracePath(u, [4, 7]);
  assert.deepEqual(p, [[3, 5], [9, 5], [9, 9], [4, 9], [4, 7]]);
  assert.ok(ortho(p) && onGrid(p));
});

test('backtracking onto the drawn segment eats the corner', () => {
  const t = run([3, 5], [[6, 5], [9, 5], [9.1, 6.2], [9, 8], [9, 5.3], [11, 5.1]]);
  assert.deepEqual(tracePath(t, [12, 5]), [[3, 5], [12, 5]]);
});

test('returning to the start cell resets to the plain L', () => {
  const t = run([3, 5], [[8, 5], [3.3, 5.2]]);
  assert.equal(t.dir, null);
  assert.deepEqual(tracePath(t, [8, 9]), [[3, 5], [8, 5], [8, 9]]);
});

test('one big jump gives a single corner; corners stay on the board', () => {
  assert.deepEqual(tracePath(run([3, 5], [[10, 9]]), [10, 9]), [[3, 5], [10, 5], [10, 9]]);
  const far = run([3, 5], [[10, 5], [40.4, 7]]);
  assert.ok(onGrid(tracePath(far, [28, 7])));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/wire-trace.test.js`
Expected: FAIL（`startTrace` 未导出）

- [ ] **Step 3: 在 `lib/geometry.js` 实现 `startTrace` / `stepTrace` / `tracePath` 与两个常量**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/geometry.js circuit/test/wire-trace.test.js
git commit -m "feat(circuit): 手指轨迹生成直角导线路线"
```

---

### Task 4: 线段拖动与把手命中

**Files:**
- Modify: `lib/geometry.js`（新增 `dragSegment`；`hitTest` 加第 4 个参数；本体命中跳过 `node`）
- Test: `test/wire-handle.test.js`（新建）

**Interfaces:**
- Consumes: `simplifyRoute`、`wirePoints`（Task 2）
- Produces:
  - `dragSegment(points: Point[], seg: number, delta: Point): Point[]`（返回新 `via`）— `points` 是**手势开始时**展开的完整折线；`delta` 是指针相对**按下位置**的位移（网格单位，`[g.x - down.x, g.y - down.y]`），不是指针绝对坐标：按下点可以偏离把手中心最多 `termR`，用绝对坐标取整会让线段在手指没有垂直移动时跳格。水平段：新 `y = clamp(round(points[seg].y + delta.y), 0, BOARD.h)`，把 `points[seg]`、`points[seg+1]` 的 y 改为新值；竖直段对称（`x = clamp(round(points[seg].x + delta.x), 0, BOARD.w)`）。若 `seg === 0`，在首点后插入 `[A.x, 新y]`（竖直段则 `[新x, A.y]`），首点 A 不动；若 `seg === points.length - 2`，末点前对称插入。最后 `simplifyRoute(...).slice(1, -1)`。
  - `hitTest(circuit, pt, k = 1, selWire = null)` — `selWire` 为选中导线 id。端点检查之后、拨片之前：对该导线展开折线每段中点 `m`，若 `dist(pt, m) <= termR`，返回最近的 `{ kind: 'handle', wire: selWire, seg }`。`selWire` 为空时行为与改动前完全一致。本体（`part`）检查跳过 `type === 'node'`（连接点没有本体，只有端点）。

- [ ] **Step 1: 写失败测试** `test/wire-handle.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { dragSegment, hitTest } from '../lib/geometry.js';
import { build } from './helpers.js';

const Z = [[3, 5], [8, 5], [8, 10], [13, 10]];

// 第三个参数是指针相对按下位置的位移 delta，不是绝对坐标
test('dragSegment moves a middle segment perpendicular by the pointer delta and snaps', () => {
  assert.deepEqual(dragSegment(Z, 1, [2.4, 1.3]), [[10, 5], [10, 10]]);
  assert.deepEqual(dragSegment(Z, 1, [0.2, -2]), [[8, 5], [8, 10]]);
  assert.deepEqual(dragSegment(Z, 1, [-4.9, 0]), [[3, 10]]);
});

test('dragSegment on the first / last / only segment keeps endpoints fixed', () => {
  assert.deepEqual(dragSegment(Z, 0, [0.6, -1.8]), [[3, 3], [8, 3], [8, 10]]);
  assert.deepEqual(dragSegment(Z, 2, [-2, 2.4]), [[8, 5], [8, 12], [13, 12]]);
  assert.deepEqual(dragSegment([[3, 5], [13, 5]], 0, [0, 2]), [[3, 7], [13, 7]]);
  assert.deepEqual(dragSegment([[3, 5], [13, 5]], 0, [0, 35]), [[3, 18], [13, 18]]);
});

test('pressing off the handle centre and moving only along the segment keeps the route', () => {
  // 在首段把手 (5.5,5) 下方约 0.5 格按下后只水平移动：delta.y 为 0 或很小，路线不变
  // （若按绝对坐标取整，按下点 y≈5.5 会让线段跳到 y=6）
  assert.deepEqual(dragSegment(Z, 0, [3, 0]), [[8, 5], [8, 10]]);
  assert.deepEqual(dragSegment(Z, 0, [-1, 0.4]), [[8, 5], [8, 10]]);
  // 在中段（竖直）把手右侧按下后只上下移动：delta.x 为 0，路线不变
  assert.deepEqual(dragSegment(Z, 1, [0, 3]), [[8, 5], [8, 10]]);
});

// B(5,5) p=(3,5)；L(15,10) a=(13,10)；路线 (3,5)→(13,5)→(13,10)，中点 (8,5)、(13,7.5)
const bl = () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  return c;
};

test('handles only exist on the selected wire', () => {
  const c = bl();
  assert.deepEqual(hitTest(c, [8, 5]), { kind: 'wire', id: 'w1' });
  assert.deepEqual(hitTest(c, [8, 5], 1, 'w1'), { kind: 'handle', wire: 'w1', seg: 0 });
  assert.deepEqual(hitTest(c, [13.2, 7.5], 1, 'w1'), { kind: 'handle', wire: 'w1', seg: 1 });
  assert.deepEqual(hitTest(c, [11, 5.2], 1, 'w1'), { kind: 'wire', id: 'w1' });
});

test('terminal wins over a handle', () => {
  const c = bl();
  c.wires[0].via = [[3, 6], [13, 6]]; // 首段 (3,5)→(3,6)，中点 (3,5.5) 落在 B.p 触控区内
  assert.deepEqual(hitTest(c, [3, 5.4], 1, 'w1'), { kind: 'terminal', part: 'B', term: 'p' });
});

test('a node has no body to grab', () => {
  const c = build({ parts: { N: ['node'] }, wires: [] });
  c.parts[0].x = 20; c.parts[0].y = 15;
  assert.deepEqual(hitTest(c, [20.2, 15]), { kind: 'terminal', part: 'N', term: 'o' });
  assert.equal(hitTest(c, [20.9, 15]), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/wire-handle.test.js`
Expected: FAIL（`dragSegment` 未导出）

- [ ] **Step 3: 实现 `dragSegment`，扩展 `hitTest`**

- [ ] **Step 4: 运行确认通过（含 `test/geometry.test.js` 不改通过）**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/geometry.js circuit/test/wire-handle.test.js
git commit -m "feat(circuit): 选中导线的线段把手与拖动"
```

---

### Task 5: 电路编辑：带路线的连线、分割、合并、清理

**Files:**
- Modify: `lib/circuit.js`
- Test: `test/wire-edit.test.js`（新建）

**Interfaces:**
- Consumes: `wireR`（Task 1）；`wirePoints`、`nearestOnRoute`、`splitRoute`、`joinRoute`（Task 2）
- Produces（`lib/circuit.js` 导出）:
  - `addWire(c, a, b, via?)` — `via` 为数组时存拷贝；未传时导线对象**没有** `via` 键。其余规则不变。
  - `setWireVia(c, id, via): Circuit` — 新 `via` 与旧值逐点相同时返回原 `c`；否则 `bump(c, false)`（拓扑不变）。
  - `splitWire(c, id, P): { circuit, node: string } | null` — `splitRoute(wirePoints(c, w), P)` 为 `null` 时返回 `null`。用 `addPart(c, 'node', P[0], P[1])` 建连接点（坐标原样，可以是半格）；新导线 `{ id, a: w.a, b: {part: node, term: 'o'}, via: via1, r: wireR(w) / 2 }` 与 `{ id, a: {node,'o'}, b: w.b, via: via2, r: wireR(w) / 2 }`，id 用 `w${nextId}` 递增；两根新导线**放在原导线在数组中的位置**（保证求解叠加顺序，合并后可逐位还原）。`topoRev` 加 1。
  - `resolveEnd(c, end): { circuit, end: {part, term} } | null` — `end` 为 `{part, term}` 时原样返回；为 `{wire, at}` 时取 `P = nearestOnRoute(wirePoints(c, w), at).P`，P 等于 `w.a` / `w.b` 的端点坐标时返回该端点（不分割），否则 `splitWire` 并返回 `{part: node, term: 'o'}`；导线不存在返回 `null`。
  - `removeWire(c, id)` — 删除后，原导线两端中 `type === 'node'` 且已无任何导线的连接点一并删除。
  - `removePart(c, id)` — 若该元件是 `node`：恰好连两根导线且两根的另一端不是同一端点 → 合并：较小数组下标的导线记为 `w1`，各自定向（`pts1` 以连接点结尾、`pts2` 以连接点开头，需要时 `reverse()`），新导线 `{ id: w${nextId}, a: w1 远端, b: w2 远端, via: joinRoute(pts1, pts2), r: wireR(w1) + wireR(w2) }` 放在 `w1` 原下标处，删除连接点；其他情况 → 删除连接点及所有相连导线。若不是 `node`：原逻辑，之后对被删导线另一端的连接点做同样的「无导线即删除」清理。

- [ ] **Step 1: 写失败测试** `test/wire-edit.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { addWire, setWireVia, splitWire, resolveEnd, removeWire, removePart } from '../lib/circuit.js';
import { wirePoints, nearestOnRoute, rotatePoint, terminalPoint, simplifyRoute } from '../lib/geometry.js';
import { solve } from '../lib/solve.js';
import { partVisual } from '../lib/viewmodel.js';
import { createDamage } from '../lib/damage.js';
import { PHYS } from '../lib/parts.js';
import { build } from './helpers.js';

const norm = pts => pts.map(p => p.map(v => v + 0));
const route = (c, id) => norm(wirePoints(c, c.wires.find(w => w.id === id)));
const nodeWires = (c, n) => c.wires.filter(w => w.a.part === n || w.b.part === n);
// 两段拼接后多出分割点 P（共线中间点），先去共线点再与原路线比较
const joined = (c, h1, h2) => norm(simplifyRoute([...route(c, h1.id), ...route(c, h2.id).slice(1)]));
// B(5,5) p=(3,5) n=(7,5)；L(15,10) a=(13,10) b=(17,10)；w1: B.p→L.a 路线 (3,5)→(13,5)→(13,10)
const bl = (type = 'lamp', t = ['a', 'b']) => {
  const c = build({ parts: { B: ['battery'], L: [type] }, wires: [['B.p', `L.${t[0]}`], [`L.${t[1]}`, 'B.n']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  return c;
};

test('addWire stores via only when given', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [] });
  const r1 = addWire(c, { part: 'B', term: 'p' }, { part: 'L', term: 'a' });
  assert.equal('via' in r1.circuit.wires[0], false);
  const r2 = addWire(c, { part: 'B', term: 'p' }, { part: 'L', term: 'a' }, [[3, 8]]);
  assert.deepEqual(r2.circuit.wires[0].via, [[3, 8]]);
});

test('setWireVia is a no-op for the same via', () => {
  const c = bl(); c.wires[0].via = [[13, 5]];
  assert.equal(setWireVia(c, 'w1', [[13, 5]]), c);
  const d = setWireVia(c, 'w1', [[3, 8], [13, 8]]);
  assert.deepEqual(d.wires[0].via, [[3, 8], [13, 8]]);
  assert.equal(d.topoRev, c.topoRev);
});

test('splitWire keeps the route and halves r; refuses endpoints', () => {
  const c = bl();
  const before = route(c, 'w1');
  const s = splitWire(c, 'w1', [8, 5]);
  const n = s.circuit.parts.find(p => p.id === s.node);
  assert.deepEqual([n.type, n.x, n.y], ['node', 8, 5]);
  const [h1, h2] = s.circuit.wires.slice(0, 2);
  assert.deepEqual([h1.a, h1.b, h2.a, h2.b], [{ part: 'B', term: 'p' }, { part: s.node, term: 'o' }, { part: s.node, term: 'o' }, { part: 'L', term: 'a' }]);
  assert.deepEqual([h1.r, h2.r], [PHYS.R_WIRE / 2, PHYS.R_WIRE / 2]);
  assert.deepEqual(route(s.circuit, h1.id), [[3, 5], [8, 5]]);
  assert.deepEqual(route(s.circuit, h2.id), [[8, 5], [13, 5], [13, 10]]);
  assert.deepEqual(joined(s.circuit, h1, h2), before);
  assert.equal(splitWire(c, 'w1', [3, 5]), null);
  assert.equal(splitWire(c, 'w1', [8, 6]), null);
});

test('resolveEnd splits mid-wire and reuses endpoints', () => {
  const c = bl();
  assert.deepEqual(resolveEnd(c, { wire: 'w1', at: [3, 5] }).end, { part: 'B', term: 'p' });
  const r = resolveEnd(c, { wire: 'w1', at: [8.3, 5.2] });
  assert.equal(r.circuit.parts.at(-1).type, 'node');
  assert.deepEqual(r.end, { part: r.circuit.parts.at(-1).id, term: 'o' });
  assert.equal(resolveEnd(c, { wire: 'nope', at: [8, 5] }), null);
});

test('removing a two-wire node merges back with summed r', () => {
  const c = bl();
  const s = splitWire(c, 'w1', [8, 5]);
  const m = removePart(s.circuit, s.node);
  assert.equal(m.parts.some(p => p.type === 'node'), false);
  assert.equal(m.wires.length, 2);
  assert.deepEqual([m.wires[0].a, m.wires[0].b], [{ part: 'B', term: 'p' }, { part: 'L', term: 'a' }]);
  assert.equal(m.wires[0].r, PHYS.R_WIRE);
  assert.deepEqual(route(m, m.wires[0].id), route(c, 'w1'));
});

test('same-part U wire: split on each segment and merge, all four rotations', () => {
  for (let rot = 0; rot < 4; rot++) {
    const c = build({ parts: { B: ['battery'] }, wires: [['B.p', 'B.n']] });
    Object.assign(c.parts[0], { x: 10, y: 9, rot });
    const orig = route(c, 'w1');
    const p1 = terminalPoint(c.parts[0], 'p');
    const onLeg = rotatePoint([0, 1], rot).map((v, i) => p1[i] + v);
    const midBottom = [(orig[1][0] + orig[2][0]) / 2, (orig[1][1] + orig[2][1]) / 2];
    for (const at of [midBottom, onLeg]) {
      const P = nearestOnRoute(orig, at).P;
      const s = splitWire(c, 'w1', P);
      assert.ok(s, `rot=${rot} at=${at}`);
      const [h1, h2] = s.circuit.wires;
      assert.deepEqual(route(s.circuit, h1.id).at(-1), norm([P])[0], `rot=${rot} h1 ends at P`);
      assert.deepEqual(route(s.circuit, h2.id)[0], norm([P])[0], `rot=${rot} h2 starts at P`);
      assert.deepEqual(joined(s.circuit, h1, h2), orig, `rot=${rot}`);
      const m = removePart(s.circuit, s.node);
      assert.deepEqual(route(m, m.wires[0].id), orig, `rot=${rot} merged`);
    }
  }
});

test('adding then removing nodes keeps solver readings (lamp and ammeter loops)', () => {
  for (const [type, t] of [['lamp', ['a', 'b']], ['ammeter', ['p', 'n']]]) {
    const c0 = bl(type, t);
    const r0 = solve(c0);
    const text = (c, r) => partVisual(c.parts.find(p => p.id === 'L'), r.parts.L, createDamage(), true).text;
    let c = c0;
    const nodes = [];
    // 1) 原导线 (10,5)；2) 后半段 (13,8)；3) 前半段（已分出的半段）(6,5)
    for (const [pick, P] of [[0, [10, 5]], [1, [13, 8]], [0, [6, 5]]]) {
      const s = splitWire(c, c.wires[pick].id, P);
      c = s.circuit; nodes.push(s.node);
      const r = solve(c);
      for (const id of ['B', 'L']) for (const k of ['v', 'i', 'p'])
        assert.ok(Math.abs(r.parts[id][k] - r0.parts[id][k]) <= 1e-9 * Math.abs(r0.parts[id][k]), `${type} ${id}.${k}`);
      assert.equal(text(c, r), text(c0, r0));
    }
    for (const n of nodes) c = removePart(c, n);
    assert.equal(c.wires[0].r, PHYS.R_WIRE);
    const r1 = solve(c);
    assert.deepEqual(r1.parts, r0.parts);
    assert.deepEqual(r1.nodes, r0.nodes);
  }
});

test('merging two separately drawn wires sums to 2 × R_WIRE', () => {
  const c = build({ parts: { B: ['battery'], N: ['node'], L: ['lamp'] }, wires: [['B.p', 'N.o'], ['N.o', 'L.a'], ['L.b', 'B.n']] });
  c.parts[1].y = 9;
  const m = removePart(c, 'N');
  assert.equal(m.wires[0].r, 2 * PHYS.R_WIRE);
  const a = solve(c), b = solve(m);
  for (const id of ['B', 'L']) for (const k of ['v', 'i', 'p'])
    assert.ok(Math.abs(a.parts[id][k] - b.parts[id][k]) <= 1e-9 * Math.abs(a.parts[id][k]));
});

test('removing a node with three wires deletes it and its wires', () => {
  const c = build({ parts: { B: ['battery'], N: ['node'], L1: ['lamp'], L2: ['lamp'] },
    wires: [['B.p', 'N.o'], ['N.o', 'L1.a'], ['N.o', 'L2.a'], ['L1.b', 'B.n']] });
  const m = removePart(c, 'N');
  assert.equal(m.parts.some(p => p.id === 'N'), false);
  assert.deepEqual(m.wires.map(w => w.id), ['w4']);
});

test('removing a node whose two wires meet the same terminal deletes everything', () => {
  const c = build({ parts: { B: ['battery'], N: ['node'] }, wires: [['B.p', 'N.o'], ['N.o', 'B.p']] });
  const m = removePart(c, 'N');
  assert.equal(m.parts.some(p => p.id === 'N'), false);
  assert.equal(m.wires.length, 0);
});

test('removeWire prunes a node only when it has no wires left', () => {
  const s = splitWire(bl(), 'w1', [8, 5]);
  const [h1, h2] = s.circuit.wires;
  const c1 = removeWire(s.circuit, h1.id);
  assert.ok(c1.parts.some(p => p.id === s.node));
  const c2 = removeWire(c1, h2.id);
  assert.equal(c2.parts.some(p => p.id === s.node), false);
});

test('removePart prunes nodes left without wires', () => {
  // N1 只连 L；N2 连 L 和 B。删 L 后 N1 无导线被清理，N2 保留。
  const c = build({ parts: { B: ['battery'], L: ['lamp'], N1: ['node'], N2: ['node'] },
    wires: [['L.a', 'N1.o'], ['L.b', 'N2.o'], ['N2.o', 'B.n']] });
  const m = removePart(c, 'L');
  assert.deepEqual(m.parts.map(p => p.id), ['B', 'N2']);
  assert.equal(nodeWires(m, 'N2').length, 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/wire-edit.test.js`
Expected: FAIL（`setWireVia` / `splitWire` 未导出）

- [ ] **Step 3: 在 `lib/circuit.js` 实现上述接口**（`circuit.js` 新增从 `./geometry.js` 的导入；`geometry.js` 不导入 `circuit.js`，无循环）

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/circuit.js circuit/test/wire-edit.test.js
git commit -m "feat(circuit): 导线分割、合并与孤立连接点清理"
```

---

### Task 6: 编辑器 action（一步撤销）

**Files:**
- Modify: `lib/editor.js`
- Test: `test/editor-wires.test.js`（新建）

**Interfaces:**
- Consumes: `addWire`、`setWireVia`、`splitWire`、`resolveEnd`、`removeWire`、`removePart`（Task 5）
- Produces（`reduce` 的 action）:
  - `{ type: 'connect', from: End, to: End, via?: Point[] }`，`End = { part, term } | { wire, at: Point }`。`from.wire` 与 `to.wire` 相同时返回原 state。依次 `resolveEnd(from)`、`resolveEnd(to)`（在上一步结果上）、`addWire(..., via)`；任一步为 `null` 则返回原 state（不留下分割）。成功时一次 `commit`，selection 不变。
  - `{ type: 'splitWire', id, at: Point }` — `P = nearestOnRoute(wirePoints(c, w), at).P`；`splitWire` 为 `null` 时返回原 state；否则一次 `commit`，`selection = { kind: 'part', id: node }`。
  - `{ type: 'setWireVia', id, via, coalesce? }` — `commit(state, setWireVia(c, id, via), { coalesce: !!action.coalesce })`。
  - `deletePart` / `deleteWire` 沿用现有 action，删除逻辑由 Task 5 的 `removePart` / `removeWire` 承担（含合并、清理）。

- [ ] **Step 1: 写失败测试** `test/editor-wires.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, reduce, activeSpace } from '../lib/editor.js';
import { remainingPalette, TASKS } from '../lib/tasks.js';

const play = (s, ...as) => as.reduce(reduce, s);
const circ = s => activeSpace(s).circuit;
// B(5,5) p=(3,5) n=(7,5)；L(15,10) a=(13,10)；w: B.p→L.a 路线 (3,5)→(13,5)→(13,10)
function setup() {
  let s = play(createEditor(), { type: 'place', partType: 'battery', x: 5, y: 5 }, { type: 'place', partType: 'lamp', x: 15, y: 10 });
  const [b, l] = circ(s).parts.map(p => p.id);
  s = play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { part: l, term: 'a' }, via: [[13, 5]] });
  return { s, b, l, w: circ(s).wires[0].id };
}

test('connect stores via', () => {
  const { s } = setup();
  assert.deepEqual(circ(s).wires[0].via, [[13, 5]]);
});

test('tap-split selects the node and undoes in one step', () => {
  const { s, w } = setup();
  const s1 = play(s, { type: 'splitWire', id: w, at: [8.3, 5.2] });
  const node = circ(s1).parts.find(p => p.type === 'node');
  assert.deepEqual([node.x, node.y], [8, 5]);
  assert.deepEqual(s1.selection, { kind: 'part', id: node.id });
  assert.equal(play(s, { type: 'splitWire', id: w, at: [3, 5] }), s);
  const s2 = play(s1, { type: 'undo' });
  assert.deepEqual(circ(s2).wires.map(x => x.id), [w]);
  assert.equal(circ(s2).parts.length, 2);
});

test('connect from a terminal onto a wire, and wire to wire, are single undo steps', () => {
  let { s, b, l, w } = setup();
  s = play(s, { type: 'place', partType: 'lamp', x: 20, y: 15 });
  const l2 = circ(s).parts.at(-1).id;
  const s1 = play(s, { type: 'connect', from: { part: l2, term: 'a' }, to: { wire: w, at: [8, 5] }, via: [[18, 5]] });
  assert.equal(circ(s1).wires.length, 3);
  assert.equal(circ(s1).parts.filter(p => p.type === 'node').length, 1);
  assert.equal(circ(play(s1, { type: 'undo' })).wires.length, 1);
  s = play(s, { type: 'connect', from: { part: l, term: 'b' }, to: { part: b, term: 'n' }, via: [[17, 12], [7, 12]] });
  const w2 = circ(s).wires[1].id;
  const s2 = play(s, { type: 'connect', from: { wire: w, at: [10, 5] }, to: { wire: w2, at: [10, 12] }, via: [] });
  assert.equal(circ(s2).parts.filter(p => p.type === 'node').length, 2);
  assert.equal(circ(s2).wires.length, 5);
  assert.equal(circ(play(s2, { type: 'undo' })).wires.length, 2);
  assert.equal(play(s, { type: 'connect', from: { wire: w, at: [8, 5] }, to: { wire: w, at: [13, 8] }, via: [] }), s);
});

test('connect that fails after split leaves circuit untouched', () => {
  const { s, b, w } = setup();
  // 先在 (8,5) 分割出 N，分出的半段已是 B.p—N.o，再连 N.o—B.p 是重复连线 → addWire 失败，分割也作废
  assert.equal(play(s, { type: 'connect', from: { wire: w, at: [8, 5] }, to: { part: b, term: 'p' }, via: [] }), s);
  // at 落在导线起点 → 解析为 B.p 本身，与起点相同 → addWire 失败
  assert.equal(play(s, { type: 'connect', from: { part: b, term: 'p' }, to: { wire: w, at: [3, 5] }, via: [] }), s);
});

test('segment drag is one undo step', () => {
  const { s, w } = setup();
  const s1 = play(s,
    { type: 'setWireVia', id: w, via: [[3, 6], [13, 6]] },
    { type: 'setWireVia', id: w, via: [[3, 7], [13, 7]], coalesce: true },
    { type: 'setWireVia', id: w, via: [[3, 8], [13, 8]], coalesce: true });
  assert.deepEqual(circ(s1).wires[0].via, [[3, 8], [13, 8]]);
  assert.deepEqual(circ(play(s1, { type: 'undo' })).wires[0].via, [[13, 5]]);
});

test('deleting a selected node merges, undo restores it', () => {
  const { s, w } = setup();
  const s1 = play(s, { type: 'splitWire', id: w, at: [8, 5] });
  const s2 = play(s1, { type: 'deletePart', id: s1.selection.id });
  assert.equal(s2.selection, null);
  assert.equal(circ(s2).wires.length, 1);
  assert.equal(circ(s2).parts.some(p => p.type === 'node'), false);
  assert.equal(circ(play(s2, { type: 'undo' })).parts.filter(p => p.type === 'node').length, 1);
});

test('task mode: splitting a preset wire keeps palette and pass state', () => {
  const idx = TASKS.findIndex(t => t.preset().wires.length > 0);
  let s = play(createEditor(), { type: 'setMode', mode: 'task' }, { type: 'chooseTask', index: idx });
  const before = { palette: remainingPalette(TASKS[idx], circ(s)), passed: s.task.passed, ok: s.task.result.ok };
  s = play(s, { type: 'splitWire', id: circ(s).wires[0].id, at: [10, 8] });
  assert.equal(circ(s).parts.some(p => p.type === 'node'), true);
  assert.deepEqual(remainingPalette(TASKS[idx], circ(s)), before.palette);
  assert.equal(s.task.result.ok, before.ok);
  assert.ok(s.task.passed || !before.passed);
});
```

注：第一个带预设导线的任务是 `TASKS[6]`，其首根导线路线已核对为 `[[4,8],[12,8]]`，`[10, 8]` 在导线上。

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/editor-wires.test.js`
Expected: FAIL（`splitWire` / `setWireVia` action 未处理，返回原 state）

- [ ] **Step 3: 在 `lib/editor.js` 的 `reduce` 中实现 `connect`（扩展）、`splitWire`、`setWireVia`**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS（`test/editor.test.js` 不改通过：不带 `via` 的 `connect` 仍生成自动走线导线）

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/editor.js circuit/test/editor-wires.test.js
git commit -m "feat(circuit): 连线、加连接点、调整路线的编辑动作"
```

---

### Task 7: 画连接点、选中样式、面板、导线把手

**Files:**
- Modify: `lib/drawings.js`（`DRAW.node`；`drawPart` 对 `node` 不追加 `terms(part)`）
- Modify: `view.js`（`partItems` 的选中框、`renderPanel` 的连接点面板、`wireItems` 的把手）
- Modify: `styles.css`（`.node-dot`、`.handle`）
- Test: `test/drawings.test.js`（追加）、`test/view-wires.test.js`（新建，只测纯函数 `wireItems`）

**Interfaces:**
- Consumes: `PARTS.node`（Task 1）、`wirePoints`（Task 2）
- Produces:
  - `drawPart({type:'node',...}, style, vis)`：卡通风 `<circle class="node-dot" data-term="o" cx="0" cy="0" r="7" fill="#b87333" .../>`；符号风同结构，`r="5" fill="#3a2e25"`（`INK`）。不画白色 `.term` 圆，免得盖住圆点。
  - `view.partItems`：选中的 `node` 用 `<circle class="sel" cx="0" cy="0" r="16"/>`，不用矩形框。
  - `view.renderPanel`：`node` 面板为 `<h2>连接点</h2>` + 只有一个 `data-action="deletePart"` 按钮；`panelKey` 用 `['node', id]`。
  - `view.wireItems(state, space, extra)`：选中导线的 `html` 末尾追加每段中点的 `<circle class="handle" cx=".." cy=".." r="10"/>`（像素坐标 = 网格 × `GRID`）；未选中导线不变。
  - CSS：`.handle { fill: #fff; stroke: var(--accent); stroke-width: 3; }`；`.node-dot` 无需额外样式（颜色写在属性里）。

- [ ] **Step 1: 写失败测试**

追加到 `test/drawings.test.js`：

```js
test('node renders as a dot in both styles and stays out of the palette', () => {
  for (const [style, r] of [['cartoon', 7], ['symbol', 5]]) {
    const s = drawPart(mk('node'), style, vis());
    assert.match(s, new RegExp(`class="node-dot"[^>]*r="${r}"`));
    assert.match(s, /data-term="o"/);
    assert.doesNotMatch(s, /NaN|undefined|Infinity|class="term"/);
  }
  assert.equal(PART_TYPES.includes('node'), false);
});
```

新建 `test/view-wires.test.js`（`view.js` 顶层不触碰 DOM，可以在 node 里导入；若导入失败，先确认 `view.js` 顶层没有 `document` 访问）：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { wireItems } from '../view.js';
import { build } from './helpers.js';

test('handles are drawn only on the selected wire, one per segment midpoint', () => {
  const c = build({ parts: { B: ['battery'], L: ['lamp'] }, wires: [['B.p', 'L.a']] });
  c.parts[0].x = 5; c.parts[0].y = 5; c.parts[1].x = 15; c.parts[1].y = 10;
  const space = { circuit: c };
  assert.doesNotMatch(wireItems({ selection: null }, space)[0].html, /class="handle"/);
  const html = wireItems({ selection: { kind: 'wire', id: 'w1' } }, space)[0].html;
  const hs = [...html.matchAll(/class="handle" cx="([\d.]+)" cy="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(hs, [[320, 200], [520, 300]]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test circuit/test/drawings.test.js circuit/test/view-wires.test.js`
Expected: FAIL（没有 `node-dot` / `handle`）

- [ ] **Step 3: 实现 `drawings.js`、`view.js`、`styles.css` 的改动**

- [ ] **Step 4: 运行确认通过**

Run: `node --test circuit/test`
Expected: 全部 PASS（含 `static.test.js`）

- [ ] **Step 5: Commit**

```bash
git add circuit/lib/drawings.js circuit/view.js circuit/styles.css circuit/test/drawings.test.js circuit/test/view-wires.test.js
git commit -m "feat(circuit): 连接点与导线把手的画法"
```

---

### Task 8: 手势改造（`app.js`）与手动验收

**Files:**
- Modify: `app.js`（`pointerdown` / `pointermove` / `endGesture`）
- Test: 无新增自动化测试（手势层没有 DOM 测试环境）；靠 Task 2–7 的纯函数测试 + 手动验收

**Interfaces:**
- Consumes: `hitTest(c, g, k, selWire)`、`wirePoints`、`nearestOnRoute`、`startTrace`、`stepTrace`、`tracePath`、`dragSegment`、`terminalPoint`（Task 2–4）；action `connect`、`splitWire`、`setWireVia`、`select`（Task 6）

**手势规则（按下时锁定 `gesture.hit.kind`，移动中不改判）：**

- `pointerdown`：`selWire = state.selection?.kind === 'wire' ? state.selection.id : null`；`hit = hitTest(circuit(), g, scale(), selWire)`。
  - `terminal`：`gesture.from = { part, term }`，`gesture.trace = startTrace(terminalPoint(...))`。
  - `handle`：`gesture.base = wirePoints(circuit(), wire)`、`gesture.seg = hit.seg`、`gesture.down = g`（按下时的网格坐标，不取整）、`gesture.lastVia = JSON.stringify(当前 via 或 base.slice(1,-1))`。
  - `wire`：`P = nearestOnRoute(wirePoints(...), g).P`；`gesture.from = { wire: hit.id, at: P }`，`gesture.trace = startTrace(P)`。
  - `part` / `lever`：原逻辑。
- `pointermove`（对 `terminal`，以及 `wire` 且 `moved`）：`trace = stepTrace(trace, g)`（若浏览器支持 `e.getCoalescedEvents`，对每个合并事件依次 `stepTrace`）。`target = hitTest(circuit(), g, scale())`：
  - `terminal` 且不是起点 → 预览终点 = 该端点坐标，画现有青色圆圈。
  - `wire` 且 `target.id !== from.wire` → 终点 `P' = nearestOnRoute(...).P`，在 `P'` 画 `<circle r="10" fill="#0ea5b7"/>`。
  - 否则终点 = 手指位置 `g`。
  - 预览 `<polyline class="preview">` 的点 = `tracePath(trace, 终点)`。
- `pointermove`（`handle` 且 `moved`）：`via = dragSegment(base, seg, [g[0] - down[0], g[1] - down[1]])`（传相对按下位置的位移，不传 `g` 本身）；`JSON.stringify(via) !== lastVia` 时 `dispatch({ type: 'setWireVia', id, via, coalesce: gesture.dragging })`，然后 `dragging = true`、更新 `lastVia`。（只在路线真的变了时派发，保证第一次派发不带 coalesce、撤销栈有一条记录。）
- `endGesture`（`cancelled` 时只清预览，直接返回）：
  - `terminal`：
    - `!moved` 且起点元件是 `node` → `select { kind: 'part', id }`。
    - 终点命中 `terminal`（非起点）→ `connect { from, to: {part, term}, via: tracePath(trace, 端点坐标).slice(1, -1) }`。
    - 终点命中 `wire` → `connect { from, to: { wire, at: P' }, via: tracePath(trace, P').slice(1, -1) }`。
    - 其他 → 不派发。
  - `handle`：`!moved` → `splitWire { id: wire, at: g }`；`moved` → 不派发（已实时提交）。
  - `wire`：`!moved` → 若 `selWire === hit.id` 则 `splitWire { id, at: g }`，否则 `select wire`（与现在一样）。`moved` → 同 `terminal` 的落点规则，`from = gesture.from`；终点为同一根导线时不派发。
  - `part` / `lever` / 空白：原逻辑。

- [ ] **Step 1: 按上面规则改 `app.js`**

- [ ] **Step 2: 跑全量自动化测试**

Run: `node --test circuit/test`
Expected: 全部 PASS

- [ ] **Step 3: 本地起服务做手动验收**

Run: `python3 -m http.server 8765 --directory /Users/jialiu/Projects/saisai.me/.worktrees/20261113-090827-circuit-freeform-wires/circuit`，浏览器打开 `http://localhost:8765/`（可用 `claude-in-chrome` 或 `run` skill；有 iPad 时用 iPad Safari）。逐条检查，每条记录「通过 / 不通过 + 现象」：
  1. 从电池 + 端点按住，先往下、再往右、再往上拖到灯的端点松手：生成 Z/U 形导线，拐点与手指轨迹一致。
  2. 沿直线拖动时手指上下小幅抖动（< 1 格）：导线是直线，没有锯齿。
  3. 轻点导线 → 出现把手；拖中段把手：线段平移、两侧跟着伸缩，不拉出新导线；撤销一次回到拖动前。
  4. 轻点中段把手（不拖）：在把手位置出现连接点，连接点被选中，面板只有「删除」。
  5. 旧式自动 U 形（无 `via`）：新手势总写 `via`，自由搭建里画不出旧路线，改用预设夹具。切到任务模式，选任务「保险丝救场」（`TASKS[9]`）；其预设导线 `w5` 连电池 `p1` 的 p、n 两端，是旧式自动 U 形，路线 `(4,8)→(4,9.5)→(8,9.5)→(8,8)`。轻点该导线选中，再轻点底部横段（y = 9.5，x 在 4–8 之间）：外观不变，横段上多一个圆点。
  5b. 新手势画的 U 形：自由搭建里放一个电池，从 + 端点按住，向下拖 2 格、横向拖到 − 端点正下方、再向上拖到 − 端点松手：生成的 U 形拐点与手指轨迹一致且在整格上；选中后轻点底部横段：外观不变，多一个圆点。
  6. 在导线中间加连接点，从连接点拉一根线到另一盏灯：两灯按并联发光。
  7. 从一根导线（未选中）上按住拖出，松手在另一根导线上：两头都自动生成连接点；撤销一次全部恢复。
  8. 选中连接点（两根导线）点「删除」：两根合并成一根，路线不变。
  9. 预设任务的导线外观、轻点选中/删除行为与改动前相同。

- [ ] **Step 4: Commit**

```bash
git add circuit/app.js
git commit -m "feat(circuit): 跟手画导线、拖动线段与导线上拉分支的手势"
```
