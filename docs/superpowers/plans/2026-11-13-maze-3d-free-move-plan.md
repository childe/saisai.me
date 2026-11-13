# 3D 迷宫连续移动与自由视角 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `maze-3d` 的离散移动（一按走到路口、一次转 90°）改成连续移动 + 连续转向 + 可斜视的自由视角，支持鼠标拖动和触屏虚拟摇杆 / 拖动转视角 / 捏合缩放；迷宫生成不变。

**Architecture:** 新增纯逻辑模块 `maze-3d/movement.js`（不依赖 three.js 和 DOM，node 可测）：墙碰撞矩形、圆与矩形碰撞、带加减速的 `stepPlayer`、键盘 / 摇杆输入换算、相机三维避障与距离平滑、手势仲裁状态机。`main.js` 删除离散移动状态机，每帧「读输入 → stepPlayer → 更新模型 → 所在格变化时重算迷雾 → 更新相机 → 渲染」；DOM 指针事件绑在 `#stage` 上转给手势状态机。浏览器验收脚本删掉依赖离散移动的检查，改造其余检查，新增 `f*` 系列。

**Tech Stack:** 原生 ES module + three.js r187（`maze-3d/vendor/`，已有）；`node --test`；Python Playwright + Pillow（`~/tmp/fuck/c/.venv`）。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261113-091931-maze-3d-free-move/docs/superpowers/specs/2026-11-13-maze-3d-free-move-design.md`

## Global Constraints

- 只改 `maze-3d/`（不含 `maze-core.js`、`vendor/`）和 `tests/` 下的文件。不改 `maze-gen/`、不改 2D 页面、不改迷宫生成。
- 不加 npm 依赖、不引用外部 URL、不加图片文件（`tests/maze-3d-page.test.mjs` 已有检查）。新文件 `movement.js` 要加进该测试的 `OWN` 列表。
- 不做跳跃、奔跑、重力、物理引擎、陀螺仪、手柄；不把视角角度存进 `localStorage`。
- 数值（全部从 spec 逐字取，定义在 `movement.js` 并导出）：`PLAYER_RADIUS = 0.28`、`WALL_THICKNESS = 0.1`、`WALL_LENGTH = 1.1`、`WALL_HEIGHT = 0.8`、`TARGET_HEIGHT = 0.4`、`CAMERA_MARGIN = 0.12`、最高速度 2.2 格/秒、0→满速 0.15 秒、满速→停 0.1 秒、子步上限 0.1、转速 120°/秒、摇杆死区 10%、跟随 `pitch` 15°–75° 默认 40°、第一人称 `pitch` −30°–30° 默认 0°、跟随距离缩放 0.7×–1.5×。
- 角度约定（全计划统一）：`yaw` 单位弧度，水平前方向量 = `(sin yaw, −cos yaw)`（x, z）。`yaw = 0` 朝北（−z），`yaw = π/2` 朝东（+x），按 `→` / `E` 时 `yaw` 增大（右转）。右方向量 = `(cos yaw, sin yaw)`。three.js 中 `rotation.y = −yaw`。`pitch` 单位弧度，正值 = 往下看（跟随视角就是俯角）。初始 / 重置 `yaw = π`（朝南）。
- 文案（逐字）：电脑提示「WASD / 方向键移动，拖动鼠标转视角」；触屏提示「左边拖动走路，右边拖动转视角」；全屏按钮「全屏」/「退出全屏」。
- JS 沿用现有风格（2 空格、单引号、分号）。改 Python 后用 `~/tmp/fuck/c/.venv/bin/black`（没有就 `/opt/homebrew/bin/black`）格式化。
- 不要 `git commit`、不要 `git push`、不要用裸 `git stash`。提交由编排器统一做；每个任务结束时保证工作区改动完整、测试通过。
- 单元测试命令（worktree 根目录）：`node --test tests/`（沙箱里可能没有输出，需要时关闭沙箱运行）。
- 浏览器验收命令：`~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py [--only ...]`。不要往 `~` 下 `npm install`。

## Review Focus

1. 按住方向键时窗口失焦 / 切后台（`keyup` 丢失）：小人应停下，回来后不自己继续走。测试在 Task 7（检查 `11` 的 blur 与 visibilitychange 部分）。
2. 沿最短路在 T 字路口、拐角、墙端头处行走：小人不能卡住。测试在 Task 1（`path-follow reaches the exit`）。
3. 摇杆手指滑进右半边，再按下右侧新手指：摇杆手指不参与捏合、角色不变，新手指成为视角指针。测试在 Task 3（`stick finger crossing to right half keeps its role`）。
4. 观察点落在外扩包围盒内、或相机被拉到极近：`cameraPullIn` 返回有限非负数，不出现 NaN。测试在 Task 2（`cameraPullIn ignores a box containing the target`、`never NaN`）。
5. 胜利后仍按住 `W` 点「再来一局」：小人留在起点不动，直到重新按键。测试在 Task 8（`f7`）。

---

## 文件结构

- Create `maze-3d/movement.js`：常量、墙矩形与网格索引、圆碰撞、`stepPlayer`、输入换算、相机避障与距离平滑、手势状态机、小人模型尺寸。
- Modify `maze-3d/game-logic.js`：删除 `findNextIntersection`、`isIntersection`、`turn`、`resolveInput`、`facingYaw` 及 `OPPOSITE` / `LEFT_OF` / `RIGHT_OF`。保留 `DIRS`（`findPath` 在用）及其余函数。
- Modify `maze-3d/main.js`：删离散移动，接连续移动、相机、键盘、指针、摇杆、全屏、调试接口。
- Modify `maze-3d/index.html`：删 `.dpad`，加 `#stick`、两套提示、`#fullscreen-btn`、`#stage { touch-action: none }`。
- Modify `maze-3d/README.md`：补一句操作说明。
- Create `tests/maze-3d-movement.test.mjs`。
- Modify `tests/maze-3d-core.test.mjs`、`tests/maze-3d-page.test.mjs`。
- Modify `tests/browser/maze3d_accept.py`、`tests/browser/test-results.txt`。

---

### Task 1: `movement.js` 常量、墙矩形、碰撞与 `stepPlayer`

**Files:**
- Create: `maze-3d/movement.js`
- Test: `tests/maze-3d-movement.test.mjs`

**Interfaces:**
- Consumes: `wallSegments(connections)`、`findPath`、`canMove`（`game-logic.js`，段对象 `{x, z, along: 'x'|'z', cells}`）；`MazeGenerator`（`maze-core.js`，测试用）。
- Produces（全部从 `maze-3d/movement.js` 导出）：
  - 常量 `PLAYER_RADIUS`、`WALL_THICKNESS`、`WALL_LENGTH`、`WALL_HEIGHT`、`MAX_SPEED = 2.2`、`ACCEL = 2.2 / 0.15`、`DECEL = 2.2 / 0.1`、`MAX_SUBSTEP = 0.1`。
  - `PLAYER_PARTS: Array<{x, y, z, r}>`：小人各球体（身体 `{0, 0.3, 0, 0.3}`；眼 `{±0.11, 0.4, −0.25, 0.08}`；瞳孔 `{±0.11, 0.4, −0.32, 0.04}`），`main.js` 按它建模型。
  - `playerModelScale(parts = PLAYER_PARTS, radius = PLAYER_RADIUS) -> number`：`radius / max(hypot(p.x, p.z) + p.r)`。
  - `type Box = {minX, maxX, minZ, maxZ}`。
  - `wallBoxes(segments, size) -> Box[]`：每段墙按 `WALL_LENGTH × WALL_THICKNESS` 转矩形（`along 'x'`：x 方向半长 0.55、z 方向半厚 0.05；`along 'z'` 反之），再追加 4 个外边界开口封闭矩形，对应 `wallSegments` 跳过的段：`{x: 0.5, z: 0, 'x'}`、`{x: 0, z: 0.5, 'z'}`、`{x: size − 0.5, z: size, 'x'}`、`{x: size, z: size − 0.5, 'z'}`。（比 spec 多一个 `size` 参数：封闭矩形的位置要用它。）
  - `createBoxGrid(boxes, size) -> { boxes, size, near(x, z): Box[] }`：每个矩形按半径 `PLAYER_RADIUS` 外扩后登记到它覆盖的格子；`near` 取 `cellOf` 所在格（行列钳到 `[0, size−1]`）的列表。
  - `collideCircle(pos: {x, z}, radius, boxes: Box[]) -> {x, z}`：最多迭代 8 次，每次对重叠的矩形按最近点方向推出（圆心在矩形内时按最小穿透轴推出），无重叠即返回。
  - `cellOf(pos: {x, z}) -> {row, col}`：`{row: floor(z), col: floor(x)}`。
  - `stepPlayer(state: {x, z, vx, vz}, input: {forward, strafe}, yaw, dt /*秒*/, grid) -> {x, z, vx, vz}`：纯函数，不改入参。

- [ ] **Step 1: 写失败测试 `tests/maze-3d-movement.test.mjs`**

公共工具：`open = createBoxGrid([], 100)`，起点 `{x: 50, z: 50, vx: 0, vz: 0}`；`run(state, input, yaw, seconds, grid, dt = 1/60)` 循环调用 `stepPlayer` 并返回每帧状态数组。`overlaps(p, box)` = 圆心到矩形最近点距离 `< PLAYER_RADIUS − 1e-6`。

```js
test('accelerates to max speed and stops within 0.15s', () => {
  const s = run(start, { forward: 1, strafe: 0 }, 0, 1, open);
  const d = 50 - s.at(-1).z;               // yaw 0 = 朝 −z
  assert.ok(d > 1.95 && d < 2.1, `d=${d}`);
  const stop = run(s.at(-1), { forward: 0, strafe: 0 }, 0, 0.15, open);
  assert.equal(Math.hypot(stop.at(-1).vx, stop.at(-1).vz), 0);
});
test('diagonal input never exceeds MAX_SPEED', ...)   // input {forward: 1, strafe: 1} 跑 1s，每帧 hypot(vx,vz) <= MAX_SPEED + 1e-9
test('yaw convention: yaw=PI/2 forward moves +x', ...) // x 增大、z 基本不变
test('head-on wall: stops in front', ...)
  // boxes = [{minX:-5,maxX:5,minZ:-0.05,maxZ:0.05}]，起点 (0, 1)，yaw 0 前进 2s：
  // 末帧 z - 0.05 >= PLAYER_RADIUS - 1e-6 且 z < 0.05 + PLAYER_RADIUS + 0.01
test('oblique wall: slides along it', ...)            // 同一面墙，yaw = PI/4 前进 2s：x 增加 > 1.0，z 同上不穿墙
test('dt=0.5 hitch does not tunnel', ...)             // 起点 (0, 0.5)，单步 dt=0.5 前进：z >= 0.05 + PLAYER_RADIUS - 1e-6
test('cannot leave through entrance or exit', ...)
  // size 10 真迷宫（seed 1）：起点 (0.5,0.5) 分别 yaw 0、yaw 3PI/2 前进 2s → z、x >= PLAYER_RADIUS - 1e-6
  // 终点格心 (9.5,9.5) 分别 yaw PI、yaw PI/2 前进 2s → z、x <= 10 - PLAYER_RADIUS + 1e-6
test('random input fuzz never overlaps walls or leaves maze', ...)
  // seeds [1, 42, 12345] × size [10, 20]；用 SeededRandom(seed) 生成 2000 帧：
  // 每 30 帧换一次 forward/strafe ∈ [-1,1]、yaw ∈ [0, 2PI)；dt 取 [0.008, 0.05]，每 200 帧插一帧 dt=0.5。
  // 每帧断言 x,z ∈ [PLAYER_RADIUS - 1e-6, size - PLAYER_RADIUS + 1e-6]，且对 wallBoxes 中每个矩形 !overlaps。
test('0.9 corridor and L corner are passable', ...)
  // 直道：boxes 两条竖墙 x∈[-0.05,0.05] 与 x∈[0.95,1.05]，z∈[-10,10]；起点 (0.5, 5) 朝北 3s → z < 0。
  // L 形：2×2 手工 connections，(0,0)↔(0,1)↔(1,1) 连通、其余不通；wallBoxes(wallSegments(c), 2)；
  // 起点格心 (0.5,0.5)，yaw PI/2 前进 1s，再 yaw PI 前进 1s → cellOf = {row:1, col:1}。
test('path-follow reaches the exit', ...)
  // seeds [1, 42, 12345] × size [10, 20]：每帧取 findPath(c, cellOf(p), 终点)[1] 的格心为目标，
  // yaw = atan2(tx - x, -(tz - z))，forward 1，dt 1/60；模拟时长上限 = 路径格数 × 1.5 秒。
  // 断言到达终点格；且在最终位置 !overlaps 任何矩形。
test('playerModelScale keeps every part inside PLAYER_RADIUS', ...)
  // s = playerModelScale()；对每个 part：(hypot(x,z) + r) * s <= PLAYER_RADIUS + 1e-9；且 s > 0.7
test('cellOf floors', ...)                            // cellOf({x: 3.99, z: 0.01}) → {row: 0, col: 3}
test('wallBoxes closes all four border gaps', ...)
  // size 10 任意 seed：boxes.length === segments.length + 4；在 (0.5, 0)、(0, 0.5)、(9.5, 10)、(10, 9.5) 各有一个矩形包含该点
test('createBoxGrid.near covers every box touching a circle there', ...)
  // size 10 真迷宫：随机 500 个点，所有与该点半径 PLAYER_RADIUS 圆相交的矩形都在 near(x, z) 中
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/maze-3d-movement.test.mjs`
Expected: FAIL，`Cannot find module ... movement.js`。

- [ ] **Step 3: 在 `maze-3d/movement.js` 实现上述导出**

`stepPlayer` 的顺序：
1. `input` 模长 > 1 时归一化；目标速度 = `(forward·前 + strafe·右) × MAX_SPEED`。
2. 速度向目标速度逼近，每帧最多变化 `rate·dt`；`rate` 在目标速度非零时取 `ACCEL`，为零时取 `DECEL`（逼近时用向量差的模长钳制，保证能精确到 0）。
3. 位移 = 速度 × dt；子步数 `n = max(1, ceil(|位移| / MAX_SUBSTEP))`；每个子步加 `位移 / n`，然后 `collideCircle(pos, PLAYER_RADIUS, grid.near(pos.x, pos.z))`。
4. 返回的速度 = 实际总位移 / dt（撞墙时法向分量自然消失，沿墙分量保留）；`dt = 0` 时原样返回。

文件头注释说明角度约定（同 Global Constraints）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/maze-3d-movement.test.mjs`
Expected: 全部 PASS。

---

### Task 2: `movement.js` 相机几何：三维避障、理想位置、距离平滑

**Files:**
- Modify: `maze-3d/movement.js`
- Test: `tests/maze-3d-movement.test.mjs`

**Interfaces:**
- Consumes: `Box`、`wallBoxes`、`WALL_HEIGHT`（Task 1）。
- Produces：
  - 常量 `TARGET_HEIGHT = 0.4`、`CAMERA_MARGIN = 0.12`、`FOLLOW_PITCH = {min: 15°, max: 75°, def: 40°}`、`FIRST_PITCH = {min: −30°, max: 30°, def: 0}`（都存弧度）、`ZOOM_MIN = 0.7`、`ZOOM_MAX = 1.5`。
  - `type Box3 = {minX, maxX, minY, maxY, minZ, maxZ}`。
  - `wallBoxes3d(boxes, height = WALL_HEIGHT, margin = CAMERA_MARGIN) -> Box3[]`：水平各边外扩 `margin`，`minY = −margin`、`maxY = height + margin`。
  - `followCameraPos(target: {x,y,z}, yaw, pitch, dist) -> {x, y, z}`：`x = tx − sin(yaw)·cos(pitch)·dist`，`y = ty + sin(pitch)·dist`，`z = tz + cos(yaw)·cos(pitch)·dist`。
  - `cameraPullIn(target, cameraPos, boxes3d) -> number`：线段 `target → cameraPos` 与每个盒子做 slab 求交，取 `tEnter ∈ (0, 1]` 的最小值，返回 `tEnter × 线段长`；无交点返回线段长。`target` 已在某盒子内（`tEnter <= 0 < tExit`）时忽略该盒子。线段长为 0 时返回 0。
  - `smoothCameraDistance(dCur, dWant, dSafe, k) -> number`：`dCur > dSafe` 时返回 `dSafe`；否则返回 `min(dCur + (dWant − dCur)·k, dSafe)`。

- [ ] **Step 1: 写失败测试（追加到 `tests/maze-3d-movement.test.mjs`）**

```js
const wall = wallBoxes3d([{ minX: -5, maxX: 5, minZ: 0.95, maxZ: 1.05 }]); // 位于 target 南面 1 处
const T = { x: 0, y: TARGET_HEIGHT, z: 0 };
test('cameraPullIn: low segment through wall is pulled to the wall', () => {
  const cam = followCameraPos(T, 0, FOLLOW_PITCH.min, 5);          // 相机在南面（+z）
  const d = cameraPullIn(T, cam, wall);
  const zHit = 0.95 - CAMERA_MARGIN;
  assert.ok(d < 5 && Math.abs(d * Math.cos(FOLLOW_PITCH.min) - zHit) < 1e-6);
});
test('cameraPullIn: no walls returns full length', ...)          // cameraPullIn(T, cam, []) ≈ 5
test('cameraPullIn: segment above wall top is not pulled', ...)
  // pitch 75°：线段在 z=0.83 处高度 0.4 + tan(75°)·0.83 > WALL_HEIGHT + CAMERA_MARGIN → 返回 ≈ 5
test('cameraPullIn ignores a box containing the target', ...)
  // 盒子包住 T，另一面墙在 z≈1：返回值 = 撞第二面墙的距离；单独只有包住 T 的盒子时返回线段长
test('cameraPullIn never NaN', ...)                               // cameraPos === target → 0；结果 Number.isFinite 且 >= 0
test('wallBoxes3d expands by margin', ...)                        // minY = -0.12, maxY = 0.92, 水平各扩 0.12
test('followCameraPos: yaw 0 puts camera south and above', ...)  // z > tz, y > ty, x ≈ tx；距离 = dist
test('smoothCameraDistance: always <= dSafe, snaps in, eases out', () => {
  const safes = [8, 8, 3, 3, 3, 8, 8, 8, 8, 8];
  let d = 8; const seq = [];
  for (const s of safes) { d = smoothCameraDistance(d, 8, s, 0.2); seq.push(d); }
  seq.forEach((v, i) => assert.ok(v <= safes[i] + 1e-12));
  assert.equal(seq[2], 3);                 // 一帧收到位
  assert.ok(seq[5] > 3 && seq[5] < 8);     // 恢复是渐进的
  for (let i = 6; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-movement.test.mjs`
Expected: 新增用例 FAIL（导出不存在）。

- [ ] **Step 3: 实现上述导出**

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/maze-3d-movement.test.mjs`
Expected: 全部 PASS。

---

### Task 3: `movement.js` 输入换算与手势状态机

**Files:**
- Modify: `maze-3d/movement.js`
- Test: `tests/maze-3d-movement.test.mjs`

**Interfaces:**
- Produces：
  - 常量 `TURN_SPEED = 2π/3`（弧度/秒，即 120°/秒）、`STICK_DEAD_ZONE = 0.1`、`LOOK_SPEED = 0.005`（弧度/像素）。
  - `inputFromKeys(keys: Set<string>) -> {forward, strafe, turn}`：用 `KeyboardEvent.code`。`KeyW`/`ArrowUp` → forward +1；`KeyS`/`ArrowDown` → −1；`KeyD` → strafe +1；`KeyA` → −1；`ArrowRight`/`KeyE` → turn +1；`ArrowLeft`/`KeyQ` → −1。相反键抵消；`(forward, strafe)` 模长 > 1 时归一化。
  - `inputFromStick(dx, dy, radius, deadZone = STICK_DEAD_ZONE) -> {forward, strafe}`：`m = min(hypot/radius, 1)`；`m < deadZone` → 0；否则幅度 `(m − deadZone)/(1 − deadZone)`，`strafe = dx/hypot·幅度`，`forward = −dy/hypot·幅度`（屏幕向上 = 前进）。
  - `createPointerRouter()` 返回：
    - `down(e: {id, kind: 'mouse'|'touch'|'pen', x, y, side: 'left'|'right'}) -> boolean`（分到角色返回 true，调用方据此 `setPointerCapture`）
    - `move(e: {id, x, y})`、`up(id)`、`cancel(id)`（与 `up` 相同，重复调用无副作用）、`reset()`
    - `consume() -> {look: {dx, dy}, zoom}`：返回自上次 `consume` 以来累计的视角像素增量和缩放倍数（无缩放为 1），然后清零 / 置 1
    - `get stick -> {active, originX, originY, dx, dy}`（不清零）
    - `roles() -> Record<id, 'stick'|'look'|'pinch'>`
  - 仲裁规则照 spec「手势仲裁」逐条实现：鼠标按下即视角指针；触摸 / 笔左半边且无摇杆 → 摇杆（`origin` = 按下点）；右半边且无视角指针 → 视角；右半边已有视角且无第二指 → 两指都标 `'pinch'`，基准 = 两指当前距离；其余忽略。捏合中每次移动 `zoom *= 上次距离 / 当前距离`。捏合中抬起一指 → 剩下那根变回 `'look'`，以其当前位置为新拖动基准。摇杆指针抬起 → `stick` 归零、`active = false`。

- [ ] **Step 1: 写失败测试**

```js
test('inputFromKeys combos', ...)
  // {KeyW} → {forward:1,strafe:0,turn:0}；{KeyW,KeyS} → forward 0；{KeyW,KeyD} → forward=strafe=Math.SQRT1_2；
  // {ArrowRight} → turn 1；{KeyQ, KeyE} → turn 0；{ArrowUp, KeyA} 模长 ≈ 1
test('inputFromStick dead zone and scaling', ...)
  // (4, 0, 50) → 0,0；(0, -50, 50) → forward 1；(0, -100, 50) → forward 1（钳到 1）；(50·0.55, 0, 50) → strafe ≈ 0.5；
  // (30, -40, 50) 模长 = 1 且方向保持
test('left stick and right look together do not zoom', ...)
  // down {1, touch, 100,300, left}；down {2, touch, 600,300, right}；move 1 → (130,280)；move 2 → (650,310)
  // stick = {active:true, originX:100, originY:300, dx:30, dy:-20}；consume() → look {dx:50, dy:10}, zoom 1
test('two right fingers pinch', ...)
  // down 2 (600,300) right；down 3 (700,300) right；roles 2、3 = 'pinch'；move 3 → (800,300)；move 2 → (590,300)
  // consume().zoom ≈ 100/210；look {0,0}
test('lifting one pinch finger resumes look without jump', ...)
  // 接上例后 up(3)；roles[2] === 'look'；move 2 → (600,300)；consume().look.dx === 10
test('third right finger and second left finger are ignored', ...)  // down 返回 false，roles 不含它们
test('stick finger crossing to right half keeps its role', ...)
  // down 1 left 摇杆；move 1 到 x=700；down 2 right → 'look'（不是 pinch）；down 3 right → 2、3 pinch，roles[1] 仍 'stick'
test('cancel equals up and is idempotent', ...)                   // cancel(1) 后 stick.active false；再次 up(1)/cancel(1) 不抛错
test('reset clears everything', ...)                               // roles() 为 {}，stick {active:false,dx:0,dy:0}，consume() look 0 zoom 1
test('mouse is look on either half', ...)                          // down {kind:'mouse', side:'left'} → 'look'
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-movement.test.mjs`
Expected: 新增用例 FAIL。

- [ ] **Step 3: 实现上述导出**

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/maze-3d-movement.test.mjs`
Expected: 全部 PASS。

---

### Task 4: `main.js` 连续移动、键盘、跟随 / 第一人称相机；移除离散移动与方向按钮

**Files:**
- Modify: `maze-3d/main.js`、`maze-3d/index.html`、`maze-3d/game-logic.js`
- Test: `tests/maze-3d-core.test.mjs`、`tests/maze-3d-page.test.mjs`

**Interfaces:**
- Consumes: Task 1–3 的全部导出。
- Produces（`window.__maze3d` 新增 / 变更，供 Task 6–7 使用）：
  - `state`：只有 `'idle'`（游戏中）和 `'won'`。
  - `player`、`display`、`playerCell`：都返回所在格 `{row, col}`（`player` 不再有 `facing`）。
  - `playerPos -> {x, z}`、`yaw`、`pitch`（弧度）、`cameraZoom`、`cameraDistance`（跟随视角实际距离 `d_cur`；第一人称为 0）、`cameraIdealDistance`（`hypot(followOffset(r).h, followOffset(r).d) × zoom`，`r = fogOn ? fogRadius : 10`）、`cameraPos -> {x,y,z}`、`cameraTarget -> {x,y,z}`、`wallBoxes3d`。
  - `setInputForTest(v: {forward?, strafe?, turn?, yaw?, pitch?} | null)`：仅 `?debug=1` 时存在。非 null 时用它的 `forward/strafe/turn` 替代键盘与摇杆输入；`yaw`、`pitch` 为数字时直接赋值（`pitch` 按当前视角范围钳制）。`null` 恢复真实输入。
  - 保留 `cameraYaw`、`segments`、`fogRecomputeCount` 等现有字段。

- [ ] **Step 1: 改单元测试**

`tests/maze-3d-core.test.mjs`：
- 删除 `NEXT_MARK`、`ISX_MARK`、`load2DMove`、`findNextIntersection matches 2D`、`turn cycles`、`resolveInput`、`facingYaw` 用例。保留 `CAN_MOVE_MARK` 与 `extractBlock picks top-level canMove`。
- `findPath from reachable positions`：起点集合改为从 (0,0) 按 `canMove` 做 BFS 取前 30 格（不再用 `findNextIntersection`）；去掉 `seed=1 size=10 should reach (3,6)` 断言；其余断言不变。
- 加 `test('discrete-move helpers are gone', ...)`：`L.findNextIntersection`、`L.isIntersection`、`L.turn`、`L.resolveInput`、`L.facingYaw` 都是 `undefined`。

`tests/maze-3d-page.test.mjs`：
- `OWN` 加 `'movement.js'`。
- `page has all controls`：去掉四个 `btn-*`，加断言 `!html.includes('class="dpad"')`。
- 删除 `dpad buttons are at least 56px and manipulation`。
- 加 `test('stage disables touch gestures', ...)`：`#stage { ... }` 规则体匹配 `/touch-action\s*:\s*none/`。
- 加 `test('main uses shared size constants', ...)`：`main.js` 从 `./movement.js` 导入 `WALL_LENGTH`、`WALL_HEIGHT`、`WALL_THICKNESS`、`PLAYER_RADIUS`，且不含 `BoxGeometry(1.1`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/`
Expected: `discrete-move helpers are gone`、`stage disables touch gestures`、`main uses shared size constants`、dpad 相关断言 FAIL。

- [ ] **Step 3: 改 `game-logic.js`**

删除 `OPPOSITE`、`LEFT_OF`、`RIGHT_OF`、`isIntersection`、`findNextIntersection`、`turn`、`resolveInput`、`facingYaw`。

- [ ] **Step 4: 改 `index.html`**

删除 `.dpad` 元素及其两条 CSS 规则；`#stage` 规则加 `touch-action: none;`；`.hint` 文案先改成「WASD / 方向键移动，拖动鼠标转视角」（触屏提示在 Task 5 加）。

- [ ] **Step 5: 改 `main.js`**

- 删除 `STEP_MS`、`TURN_MS`、`pos`、`anim`、`cancelAnimation`、`shortestYaw`（若模型转向要用，可保留为工具函数）、`handleDirection`、`stepAnimation`、`KEY_DIRS`、dpad 绑定，以及 `showNoWebGL` 中对 `.dpad` 的引用、`facingYaw` / `findNextIntersection` / `resolveInput` 的 import。
- 墙几何：`new THREE.BoxGeometry(WALL_LENGTH, WALL_HEIGHT, WALL_THICKNESS)`，`applyWallUvs(uv, {w: WALL_LENGTH, h: WALL_HEIGHT, d: WALL_THICKNESS})`，实例 y = `WALL_HEIGHT / 2`。
- 小人：按 `PLAYER_PARTS` 建球体，放进一个子 `Group`（`bodyGroup`），外层 `player` 组 `scale.setScalar(playerModelScale())`。走路起伏：速度 > 0.05 时 `bodyGroup.position.y = 0.03·|sin(phase)|`，`phase += speed·dt·2π`（每格两次起伏）；静止时归 0。朝向：速度 > 0.05 时目标朝向 = `atan2(vx, −vz)`，`player.rotation.y` 以 `k = 1 − 0.001^(dt)`（dt 秒）沿最短角度逼近 `−目标朝向`。
- `buildMaze`：算 `boxes = wallBoxes(segments, size)`、`grid = createBoxGrid(boxes, size)`、`boxes3d = wallBoxes3d(boxes)`；调用 `resetPlayer()`（位置 (0.5, 0.5)，速度 0，`yaw = π`，模型朝南，`display` = (0,0)）和 `resetInput()`；`state = 'idle'`；其余照旧（`generation += 1` 保留）。
- `resetInput()`：清空按键集合、`router.reset()`、隐藏摇杆（Task 5 加 DOM 后生效）、`testInput` 不清（测试钩子独立）。在窗口 `blur`、`visibilitychange` 变隐藏、`buildMaze` 时调用。
- 键盘：`keydown` 有 Ctrl/Meta/Alt 时忽略；`e.code` 属于 `inputFromKeys` 识别的码时加入集合，方向键 `preventDefault`；`keyup` 移除。
- 每帧（`dt` 秒，沿用 100ms 上限）：
  1. `state !== 'won'` 时：输入 = `testInput ?? 合并(inputFromKeys(keys), inputFromStick(router.stick…))`（forward、strafe 相加后交给 `stepPlayer` 归一化）；`yaw += turn·TURN_SPEED·dt`；`router.consume()` 的 `look` 累加到 `yaw += dx·LOOK_SPEED`、`pitch += dy·LOOK_SPEED`（钳到当前视角范围），`zoom` 乘到 `cameraZoom`（钳到 [0.7, 1.5]）；`playerState = stepPlayer(...)`。
  2. 所在格变化：更新 `display`、`recomputeFog()`；进入 `(size−1, size−1)` 时 `state = 'won'`、速度清零、显示 `#win`。
  3. 更新模型、相机、渲染。`won` 状态下不推进小人，但仍可转视角。
- 跟随相机（每帧）：`target = (x, TARGET_HEIGHT, z)`（不平滑）；`ideal = followCameraPos(target, yaw, pitch, cameraIdealDistance)`；`smoothCam.lerp(ideal, k)`（`k = 1 − 0.001^(dt)`）；`dir = normalize(smoothCam − target)`，`dWant = |smoothCam − target|`；`dSafe = cameraPullIn(target, target + dir·dWant, boxes3d)`；`dCur = smoothCameraDistance(dCur, dWant, dSafe, k)`；`camera.position = target + dir·dCur`，`camera.lookAt(target)`。`snapCamera()` 直接把 `smoothCam` 设为 `ideal`、`dCur = dSafe`。
- 第一人称：`camera.position = (x, EYE_HEIGHT, z)`，`camera.rotation.set(−pitch, −yaw, 0, 'YXZ')`。
- `setView(next)`：保留 `yaw`，`pitch` 设为该视角的 `def`，然后 `snapCamera()`。
- 小地图：`recomputeFog` 时把底图（地块、墙）画进离屏 canvas；第一人称每帧把底图贴到 `#minimap`，再在 `playerPos` 处画圆点和朝 `(sin yaw, −cos yaw)` 方向的三角箭头。
- 调试对象按 Interfaces 补字段；`setInputForTest` 只在 `debug` 时挂上。

- [ ] **Step 6: 跑单元测试**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 7: 跑不依赖离散移动的浏览器检查**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 1,10,12,7,13,t1,t4,t6`
Expected: 全部 PASS（这些检查只用 `wait_idle`、渲染、生成与主题，不走离散移动）。

---

### Task 5: 指针输入：鼠标拖动 / 滚轮、虚拟摇杆、触屏视角与捏合、全屏、两套提示

**Files:**
- Modify: `maze-3d/main.js`、`maze-3d/index.html`、`maze-3d/README.md`
- Test: `tests/maze-3d-page.test.mjs`

**Interfaces:**
- Consumes: `createPointerRouter`、`inputFromStick`、`STICK_DEAD_ZONE`、`ZOOM_MIN/MAX`（Task 3、2）；Task 4 的 `resetInput`、`cameraZoom`。
- Produces（DOM，供 Task 7–8 使用）：`#stick`（含 `#stick-knob`），隐藏时带 `hidden` 属性；`#fullscreen-btn`；`.hint-desktop`、`.hint-touch`。摇杆底座半径常量 `STICK_RADIUS = 50`（CSS 像素，`main.js` 内）。

- [ ] **Step 1: 写失败的页面静态测试**

```js
test('joystick overlay does not take pointer events', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="stick"') && html.includes('id="stick-knob"'));
  const m = html.match(/#stick\s*\{([^}]*)\}/);
  assert.ok(m && /pointer-events\s*:\s*none/.test(m[1]));
  // #stick 位于 #stage 内：indexOf('id="stage"') < indexOf('id="stick"') < #stage 的闭合
});
test('fullscreen button and two hint texts', () => {
  const html = read('index.html');
  assert.match(html, /id="fullscreen-btn"[^>]*hidden[^>]*>全屏</);
  assert.ok(html.includes('WASD / 方向键移动，拖动鼠标转视角'));
  assert.ok(html.includes('左边拖动走路，右边拖动转视角'));
  assert.match(html, /@media\s*\(pointer:\s*coarse\)/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-page.test.mjs`
Expected: 两个新用例 FAIL。

- [ ] **Step 3: 改 `index.html`**

- `#stage` 内加 `<div id="stick" hidden><div id="stick-knob"></div></div>`：绝对定位、`pointer-events: none`、`z-index` 高于 canvas 低于小地图；底座直径 100px 半透明圆，摇杆头直径 44px；`#stick[hidden] { display: none; }`。
- `#view-row` 末尾加 `<button id="fullscreen-btn" hidden>全屏</button>`。
- 原 `.hint` 改为两段：`<p class="hint hint-desktop">WASD / 方向键移动，拖动鼠标转视角</p>`、`<p class="hint hint-touch">左边拖动走路，右边拖动转视角</p>`；默认隐藏 `.hint-touch`，`@media (pointer: coarse)` 下显示 `.hint-touch`、隐藏 `.hint-desktop`。

- [ ] **Step 4: 改 `main.js`**

- 指针监听绑在 `stage` 上（不是 canvas）：`pointerdown` 时用 `stage.getBoundingClientRect()` 判断 `side`（`clientX − left < width / 2` 为 `'left'`），`kind = e.pointerType`；`router.down(...)` 返回 true 时 `stage.setPointerCapture(e.pointerId)` 并 `preventDefault()`。`pointermove` → `router.move`。`pointerup`、`pointercancel`、`lostpointercapture` → `releasePointer(id)`（内部 `router.up(id)`，可重复调用）。
- 摇杆显示：每帧按 `router.stick` 更新 `#stick`：`active` 时取消 `hidden`，底座中心放在 `origin`（换成相对 stage 的坐标），摇杆头偏移 = `(dx, dy)` 钳到半径 `STICK_RADIUS`；否则 `hidden`。摇杆输入用 `inputFromStick(dx, dy, STICK_RADIUS)`。
- 滚轮：`stage` 上 `wheel`（`passive: false`，`preventDefault`），`cameraZoom = clamp(cameraZoom · exp(deltaY · 0.001), ZOOM_MIN, ZOOM_MAX)`。
- 全屏：`document.fullscreenEnabled` 为真时取消按钮 `hidden`；点击时已全屏则 `document.exitFullscreen()`，否则 `document.documentElement.requestFullscreen()`；`fullscreenchange` 时切换按钮文字「全屏」/「退出全屏」。尺寸由已有 `ResizeObserver` 跟上。
- `resetInput()` 同时隐藏 `#stick`。降画质替换 canvas 不碰 router 状态（监听器在 `stage` 上，本来就不受影响）。

- [ ] **Step 5: 改 `maze-3d/README.md`**

追加一句：「电脑用 WASD / 方向键走路、拖动鼠标转视角；触屏左边拖动走路、右边拖动转视角、双指缩放。」

- [ ] **Step 6: 跑单元测试**

Run: `node --test tests/`
Expected: 全部 PASS。

---

### Task 6: 浏览器验收：公共助手与现有检查改造

**Files:**
- Modify: `tests/browser/maze3d_accept.py`

**Interfaces:**
- Consumes: Task 4 的调试字段与 `setInputForTest`；Task 5 的 `#stick`、`#fullscreen-btn`。
- Produces（Python 助手，Task 7 也用）：
  - `walk_to(page, row, col, center=True, timeout_ms=60000) -> bool`：页面须带 `&debug=1`。在页面里装一个 rAF 驱动：每帧取 `L.findPath(M.connections, M.playerCell, {row, col})`，下一格（已到目标格且 `center` 时取目标格）格心为目标点，`yaw = atan2(tx − x, −(tz − z))`，`M.setInputForTest({forward: 1, strafe: 0, turn: 0, yaw})`；到达目标格（`center` 时还要距格心 < 0.1）或超时后 `setInputForTest(null)` 并 resolve。返回后再等 200ms 让速度归零。
  - `set_test_input(page, **kw)`：包装 `M.setInputForTest(kw or None)`。
  - `wall_dir(page)`：当前格四个方向中有内部墙段（相邻格在迷宫内且 `!canMove`）的第一个方向名，没有返回 None。`DIR_YAW = {"up": 0, "right": π/2, "down": π, "left": 3π/2}`。
  - `find_wall_cell(page)`：从 (0,0) 按 BFS 找到最近的有内部墙的格子并 `walk_to` 过去，返回方向名。
  - `record_frames(page, expr, ms)`：在页面装 rAF 采样器，每帧记录 `expr` 的值，`ms` 毫秒后返回数组。
  - `play_continuous(page, seconds=8)`：`keyboard.down('w')`，交替按住 `ArrowRight` 1 秒 / 松开 1 秒，期间若 `state == 'won'` 点「再来一局」；结束后松开所有键。
  - `play_rounds_legacy(page)`：原 `play_rounds` 原样改名，只用于基线代码。
  - `face_wall_legacy(page)`：原 `face_wall` 原样改名，只用于基线代码。
  - `perf_round(browser, base, mobile, init_script=None, driver=play_continuous)`。

- [ ] **Step 1: 删除与改名**

删除 `check_2`、`check_14`、`press_dir`、`next_stop`、`face_walkable`、`entrance_dir`、`far_direction`、`walk_to_win`。`play_rounds` → `play_rounds_legacy`，`face_wall` → `face_wall_legacy`（这两个内部仍用旧 API，只在基线服务器上跑，需要的旧助手内联进它们）。`SHOTS` 默认改为 `/Users/jialiu/Projects/saisai.me/.xdev/20261113-091931-maze-3d-free-move/screenshots`。

- [ ] **Step 2: 新增 Interfaces 中列出的助手**

- [ ] **Step 3: 改造现有检查（URL 需要 `setInputForTest` 的加 `&debug=1`）**

| 检查 | 改法 |
|---|---|
| `1`、`10`、`12`、`7`、`13`、`t1`、`t4`、`t6`、`t8`、`4b`、`9b`、`t7b` | 不改逻辑；只修因删除助手导致的引用 |
| `3` | 切第一人称：按钮文字、小地图显示、`playerVisible` 为 false；`yaw` 与切换前相同，`pitch` = 0；切回跟随：`pitch` ≈ 40°（误差 0.5°） |
| `4` | (e) 静止 1 秒 `fogRecomputeCount` 不变；`walk_to` 相邻可达格后恰好 +1（跨一个格）；`FOG_STATE_JS` 不变（用 `M.display`） |
| `5` | 用 `walk_to` 走到路径上第二格，道路长度减 1，其余断言不变 |
| `6` | 改为 spec 验收 7：`walk_to(size−1, size−1)` → `#win` 可见、`state == 'won'`；点「再来一局」→ `playerCell == (0,0)`、`playerPos` 距 (0.5, 0.5) < 1e-6、`yaw` ≈ π、`generation` +1、seed 变化 |
| `6b` | 胜利后按住 `w` 1 秒：`playerPos` 不变、`state` 仍 `won` |
| `8` | 375×667 竖屏：`scrollWidth == 375`；`#stage` 与所有按钮矩形不相交；用 CDP 在 stage 左半边按下触点后 `#stick` 矩形在 `#stage` 内、与按钮不相交；小地图在 stage 内；横屏部分不变 |
| `9`、`t7` | `perf_round` 新代码用 `play_continuous`，基线（`t7` 的 baseline 轮）用 `play_rounds_legacy`；阈值不变（`t7` 已是「≤ 基线 1.3 倍且不降画质」，即 spec 验收 10） |
| `9c` | 降画质后（`quality == 'low'`、`downgradeCount == 1`）：按住 `w` 0.5 秒位置变化；鼠标在 stage 拖动 100px `yaw` 变化；CDP 触摸左半边拖动后位置变化 |
| `11` | (a) 按住 `w` 时点 `#size-15`：`playerPos` 回到 (0.5, 0.5) 且之后 300ms 不动（按键集合已清空，键仍按着）；再点 `#regen-btn` 同样。(b) 按住 `w` 时 `window.dispatchEvent(new Event('blur'))`：300ms 后位置不再变化。(c) 按住 `w` 时模拟 `visibilitychange` 变隐藏再变可见（沿用 `9b` 的 `defineProperty` 写法）：之后位置不再变化 |
| `t2` | 新代码：`find_wall_cell` 后第一人称，`setInputForTest({yaw: DIR_YAW[d], pitch: 0})`；基线：`face_wall_legacy`；阈值不变 |
| `t3` | 按住 `w` 中途点主题按钮：`generation` 不变，点击后 300ms 内 `playerPos` 继续变化 |
| `t5` | 原「走到某格」改用 `walk_to`；其余取色断言不变 |
| `t9` | 跟随截图不变；第一人称看通道：`setInputForTest({yaw: 能走的方向})`；面墙：`find_wall_cell` + 对应 `yaw` |

- [ ] **Step 4: 格式化并运行**

Run: `~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py && ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 1,3,4,4b,5,6,6b,7,8,9b,9c,10,11,12,13,t1,t3,t4,t5,t6,t8,t7b`
Expected: 全部 PASS。

---

### Task 7: 浏览器验收：连续移动、触摸、相机避障新检查与结果文件

**Files:**
- Modify: `tests/browser/maze3d_accept.py`、`tests/browser/test-results.txt`

**Interfaces:**
- Consumes: Task 6 的助手；Task 4、5 的调试字段与 DOM。
- Produces: 检查 `f1`–`f9`，注册进 `CHECKS`。

CDP 触摸统一用 `cdp = page.context.new_cdp_session(page)` 和 `cdp.send("Input.dispatchTouchEvent", {"type": "touchStart"|"touchMove"|"touchEnd"|"touchCancel", "touchPoints": [{"x", "y", "id"}...]})`；上下文开 `has_touch=True`。每次多指事件带上所有仍按着的触点。

- [ ] **Step 1: 写新检查**

- `f1`（spec 验收 1）：`record_frames(page, 'playerPos', 600)` 期间按住 `w` 500ms。断言：相邻帧位移最大值 < 0.1；总位移 > 0.5；不同位置数 ≥ 10。
- `f2`（验收 2）：按住 `ArrowRight` 750ms，记录 `yaw`。断言：总增量在 90° ± 15°；相邻帧增量都 ≥ 0 且 < 10°。
- `f3`（验收 3）：`find_wall_cell` 得到方向 `d`，`setInputForTest({yaw: DIR_YAW[d]})` 后 `setInputForTest(null)`，按住 `w` 2 秒。断言：`playerCell` 不变；圆心到该墙面的距离 ≥ `0.28 − 0.01`（墙面坐标 = 格边界 ∓ 0.05）。
- `f4`（验收 4）：视口 900×600、`has_touch`。(a) 左半边 touchStart → touchMove 向上 60px 持续 500ms：`playerPos` 改变，`#stick` 可见。(b) 右半边单指拖动 (+80, +40)：`yaw`、`pitch` 都变。(c) 两指同时（左摇杆 + 右拖动）：位置与 `yaw` 都变，`cameraZoom` 不变。(d) 全程 `window.scrollY` 不变。(e) 摇杆手指移到 stage 外（y = stage 底 + 50）后 touchEnd：300ms 后 `playerPos` 不再变化、`#stick` 有 `hidden`。(f) 同 (e) 但用 touchCancel，结果相同。(g) 视口改为 600×600 后在 stage 宽度 40% 处按下：成为摇杆（`#stick` 可见）。
- `f5`（验收 5）：鼠标在 stage 内按下拖动 (+100, +50)：`yaw`、`pitch` 变化；`pitch` 在 [15°, 75°]。滚轮 `deltaY = +2000` 十次：`cameraZoom == 1.5`；`deltaY = −2000` 十次：`cameraZoom == 0.7`；`cameraDistance` 随之变化。
- `f6`（验收 6）：`find_wall_cell` 得到方向 `d`（小人站在**格心**；贴墙站时 60° 线段会在墙的近侧进入外扩盒，验收要求的「60° 不拉近」只在格心成立）。`setInputForTest({yaw: DIR_YAW[d] + π, pitch: 15°})`（小人背对墙，相机转到墙后），等 1.5 秒。用 Python 实现独立的 slab 求交 `segment_hits_box(a, b, box)`，断言：`cameraTarget → cameraPos` 不与 `wallBoxes3d` 任何盒子相交（允许端点贴面，容差 1e-4）；`cameraPos` 不在任何盒子内；`cameraDistance < cameraIdealDistance`。再 `pitch = 60°` 等 1.5 秒：`cameraDistance ≥ 0.98 × cameraIdealDistance`。`sampleDistinctColors()` 只记入 detail 不判失败。低俯角时存截图 `SHOTS / "follow-lowpitch-wall.png"`。
- `f7`（Review Focus 5）：`walk_to` 终点获胜后 `keyboard.down('w')`，点「再来一局」，300ms 内 `playerPos` 不变（仍在 (0.5, 0.5)）；`keyboard.up('w')` 后再按住 `w` 300ms，位置改变。
- `f8`（验收 8）：`walk_to` 一个距起点 ≥ 3 格的格子；`M.display == M.playerCell`，`FOG_STATE_JS` 无不一致。
- `f9`（验收 9）：依次切视角、切 4 个主题、点 `#size-20`、`#regen-btn`，每步后等 300ms；`no_errors(errors)`；`state == 'idle'`。

- [ ] **Step 2: 更新 `--write` 报告头**

人工检查行改为：`人工检查：待用户查看 {SHOTS} 下截图（四种主题的跟随 / 第一人称 / 面墙，及 follow-lowpitch-wall.png），确认斜视角与贴墙视角能看到小人`。保留 `f"自动检查：{'PASS' if all_ok else 'FAIL'}"` 原样（`tests/maze-3d-accept-report.test.mjs` 检查它）。

- [ ] **Step 3: 格式化并跑新检查**

Run: `~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py && ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only f1,f2,f3,f4,f5,f6,f7,f8,f9`
Expected: 全部 PASS。

- [ ] **Step 4: 准备基线代码并跑全量写结果**

```bash
B=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad/maze3d-free-move-baseline
rm -rf "$B" && mkdir -p "$B"
git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261113-091931-maze-3d-free-move archive "$(git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261113-091931-maze-3d-free-move merge-base HEAD main)" | tar -x -C "$B"
~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --write --baseline-root "$B"
```
Expected: 退出码 0；`tests/browser/test-results.txt` 第 5 行为 `自动检查：PASS`；`SHOTS` 目录下有 12 张主题截图和 `follow-lowpitch-wall.png`。

- [ ] **Step 5: 跑单元测试**

Run: `node --test tests/`
Expected: 全部 PASS。
