# 3D 迷宫外围地面与柔和迷雾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 3D 迷宫加一圈与主题配套、向地平线雾化消失的外围地面，天空按世界仰角着色，视野外格子改用主题雾地板色并加一圈过渡色。

**Architecture:** 纯数据与纯函数放在 `themes.js`（地面纹理、颜色）和 `game-logic.js`（过渡圈判定、雾距离、地面半边长），用 node 单元测试锁定；`main.js` 只负责把它们接到 three.js 场景（地面网格跟随相机按整格移动、等距柱状天空、跟随视角距离雾）并在 `window.__maze3d` 暴露验收需要的状态；浏览器验收脚本扩展新检查并改造受影响的旧检查。

**Tech Stack:** 原生 ES modules、vendor three.js r187（`maze-3d/vendor/three.module.js`）、Canvas 2D、`node --test`、Python Playwright + Pillow（`~/tmp/fuck/c/.venv`）。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261113-102305-maze-3d-ground-fog/docs/superpowers/specs/2026-11-13-maze-3d-ground-fog-design.md`

## Global Constraints

- 只改视觉：不改操作、碰撞、迷宫生成、迷雾判定（`isInFogView` 不变）、墙在迷雾外隐藏的规则、相机、小地图。
- 不加树木、石头、云朵等装饰物。
- `themes.js` 不得 import 任何东西，不得出现 `document` / `window` / `THREE`（现有测试 `themes.js has no three/DOM dependency` 守住）；新绘制函数只能用假上下文白名单内的方法与属性。
- `game-logic.js` 新函数为纯函数，不依赖 three.js / DOM。
- 外围地面 y = −0.045；地面中心 = (`Math.round(camera.position.x)`, `Math.round(camera.position.z)`)；纹理 `RepeatWrapping`，每格重复一次。
- `groundHalfExtent(fogFarMax, fovDeg, aspect) = ceil(fogFarMax × sqrt(1 + tan²(fov/2) × (1 + aspect²))) + 2`。
- `fogFarMax = max(hypot(followOffset(10).h, followOffset(10).d) × ZOOM_MAX + size × √2 + 25, max(25.5, size × 1.5))`；20×20 时约 73.7；不变量 `fogFarMax < camera.far (200)`。
- 跟随视角雾：`near = idealDistance() + size × √2`，`far = near + 25`；第一人称雾：`near = 0.5`，`far = fogOn ? fogRadius + 0.5 : size × 1.5`（不变）。
- 天空：等距柱状贴图，`mapping = THREE.EquirectangularReflectionMapping`，赋给 `scene.background`；上半部仰角 90° → 0° 从 `sky.top` 线性渐变到 `sky.bottom`，下半部纯 `fogColor`；仍是 1 张贴图。
- 主题纹理 5 张（墙面、墙顶、地板、外围地面、天空），`textureCount` 恒为 5，主题切换释放旧主题纹理。
- 雾地板色 `fogFloor` 与 `floorBase`、起点 `0x4caf50`、终点 `0xe53935`、道路 `0xff6b6b` 的 RGB 欧氏距离都 ≥ 60；过渡色 = `floorBase` 与 `fogFloor` 各 50% 混合，只用在 Chebyshev 距离 N+1 一圈，不参与该检查。
- 自动降画质时外围地面纹理 `anisotropy` 也降为 1。
- 性能：同条件平均帧时间不超过改动前（`origin/feat/maze-3d-free-move-20261113-091931`）的 1.3 倍。
- 截图目录：`/Users/jialiu/Projects/saisai.me/.xdev/20261113-102305-maze-3d-ground-fog/screenshots/`。
- JS 测试命令：`node --test tests/`（在 worktree 根目录）。Python：`~/tmp/fuck/c/.venv/bin/python`；改完 Python 用 `~/tmp/fuck/c/.venv/bin/black`（没有就 `/opt/homebrew/bin/black`）格式化。
- 不要往 `~` 下 `npm install`；不要用裸 `git stash`。
- 基线代码副本（Task 6 起需要）：`git -C <worktree> archive origin/feat/maze-3d-free-move-20261113-091931 | tar -x -C <scratchpad>/maze3d-ground-fog-baseline`，其中 `<scratchpad>` = `/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad`。

## Review Focus

1. 运行中窗口比例变化（手机横竖屏、桌面拖成 3:1）后地面边缘仍不可见 —— `resize()` 必须按新 aspect 重算半边长。Task 6 的 g7 先以 1280×800 打开再改成 1500×500，走 resize 路径。
2. 运行中切换迷宫尺寸 10 → 20 后地面半边长与跟随雾随之更新 —— g7 以 size=10 打开再点 20 号尺寸按钮。
3. 滚轮 / 双指缩放后跟随雾 near/far 立即跟上，迷宫内不被染色 —— Task 5 的 g3 用真实滚轮缩放后断言 `sceneFog` 与 `followFogRange` 一致。
4. 跟随 → 第一人称 → 跟随来回切换后雾参数正确还原 —— g3 覆盖。
5. 已自动降画质后再切主题，新主题的外围地面纹理仍是 anisotropy 1 —— Task 4 改造 t7b 为 4 个条目。

---

### Task 1: 主题数据与外围地面纹理（themes.js）

**Files:**
- Modify: `maze-3d/themes.js`
- Test: `tests/maze-3d-themes.test.mjs`

**Interfaces:**
- Produces:
  - `THEMES[id].ground: number`（外围地面主色调，十六进制）、`THEMES[id].fogFloor: number`。取值：

    | 主题 | `ground` | `fogFloor` |
    |---|---|---|
    | garden | `0x5e9e3f` | `0x7d8a72` |
    | brick | `0xbdb5a8` | `0x8c8079` |
    | blocks | `0x8bc34a` | `0x7c8794` |
    | castle | `0x7a6c5a` | `0x575b63` |

  - `paintGround(id: string, ctx: CanvasRenderingContext2D, size: number): void` —— 未知 id 回落默认主题，固定种子：`mulberry32(hash32(0x6a09 + THEME_IDS.indexOf(id)))`。不要改现有 `rngFor` / `SURFACE`（墙、墙顶、地板纹理必须逐笔不变，否则 t2 对比度基线会漂；直接给 `SURFACE` 加 `ground: 3` 会和下一个主题的墙面种子撞车）。
  - `mixHex(a: number, b: number, t: number): number` —— 每通道 `Math.round(a + (b − a) × t)`。

- [ ] **Step 1: 写失败测试**（追加到 `tests/maze-3d-themes.test.mjs`，import 增加 `paintGround`, `mixHex`）

```js
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
// p 到线段 ab（RGB 空间）的最短距离
function segDist(p, a, b) { /* 投影到线段并 clamp 到 [0,1]，返回欧氏距离 */ }

test('ground and fogFloor colors', () => {
  const isColor = (c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.ok(isColor(t.ground) && isColor(t.fogFloor), id);
    for (const c of [t.floorBase, 0x4caf50, 0xe53935, 0xff6b6b]) {
      assert.ok(dist(t.fogFloor, c) >= 60, `${id} fogFloor vs ${c.toString(16)}: ${dist(t.fogFloor, c)}`);
    }
    // 地面主色与天空渐变线段、迷宫地板都要分得开（g1 天空占比检查依赖它）
    assert.ok(segDist(t.ground, t.sky.top, t.sky.bottom) >= 40, `${id} ground vs sky`);
    assert.ok(dist(t.ground, t.floorBase) >= 60, `${id} ground vs floor`);
  }
});

test('mixHex', () => {
  assert.equal(mixHex(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(mixHex(0x123456, 0xabcdef, 0), 0x123456);
  assert.equal(mixHex(0x123456, 0xabcdef, 1), 0xabcdef);
  assert.equal(mixHex(0xff0000, 0x0000ff, 0.5), 0x800080);
});

test('paintGround deterministic and differs per theme', () => {
  const runs = {};
  for (const id of [...THEME_IDS, 'nope']) {
    const a = fakeCtx(); paintGround(id, a.ctx, 256);
    const b = fakeCtx(); paintGround(id, b.ctx, 256);
    assert.ok(a.calls.some(([n]) => n === 'fillRect'));
    assert.ok(a.calls.length >= 20);
    assert.deepEqual(a.calls, b.calls);
    runs[id] = JSON.stringify(a.calls);
  }
  assert.equal(runs.nope, runs.garden);
  assert.equal(new Set(THEME_IDS.map((id) => runs[id])).size, 4);
  // 第一笔铺底色就是主题 ground
  for (const id of THEME_IDS) {
    const hex = '#' + THEMES[id].ground.toString(16).padStart(6, '0');
    assert.ok(runs[id].includes(JSON.stringify(hex)), `${id} base fill`);
  }
});
```

同时把现有 `paint functions deterministic and draw` 的循环列表改成 `[paintWall, paintWallTop, paintFloor, paintGround]`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-themes.test.mjs`
Expected: FAIL，`paintGround` / `mixHex` 未导出。

- [ ] **Step 3: 实现**

在 `THEMES` 里加上表中颜色；加 `mixHex`、`paintGround` 与四个绘制函数 `groundGarden / groundBrick / groundBlocks / groundCastle`（`GROUND` 表 + 上面的独立种子）。每个函数先用 `hexCss(THEMES[id].ground)`（小写 `#rrggbb`）`fillRect` 铺满，再画：
- 花园：数百片深浅不一的绿色细长草叶（`ellipse`，用 `wrapX` 横向无缝，纵向同理需要无缝，可写 `wrapXY`）。
- 砖墙：2×2 方形浅色石板，石板间留拼缝（与 `floorBrick` 同构，但色调为灰米色，和迷宫内地板区分开）。
- 积木：底色铺满，4×4 规则凸点（阴影圆 + 亮色圆 + 高光圆），颜色基于 `ground` 的深 / 浅变体。
- 城堡：棕灰泥土底色上随机深浅斑块与碎石小圆点（`wrapXY` 无缝）。
纹理每格重复一次，必须上下左右无缝。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/maze-3d-themes.test.mjs`
Expected: PASS（含原有用例）。

- [ ] **Step 5: Commit**

```bash
git add maze-3d/themes.js tests/maze-3d-themes.test.mjs
git commit -m "feat(maze-3d): 主题外围地面纹理与雾地板色"
```

---

### Task 2: 过渡圈与雾 / 地面尺寸纯函数（game-logic.js）

**Files:**
- Modify: `maze-3d/game-logic.js`
- Test: `tests/maze-3d-core.test.mjs`

**Interfaces:**
- Produces:
  - `fogRing(center: {row,col}, cell: {row,col}, radius: number): boolean` —— Chebyshev 距离 === radius + 1。
  - `floorKind(cell, size, { inView, onPath, edge }): 'path'|'fogEdge'|'fog'|'start'|'end'|'floor'` —— `onPath` 优先；`!inView` 时 `edge ? 'fogEdge' : 'fog'`；`edge` 缺省为 false（旧调用不变）。
  - `groundFogFarMax(size: number, zoomMax: number): number` —— 公式见 Global Constraints（`zoomMax` 作参数传入，避免 game-logic 依赖 movement.js）。
  - `groundHalfExtent(fogFarMax: number, fovDeg: number, aspect: number): number` —— 公式见 Global Constraints，返回整数。
  - `followFogRange(idealDistance: number, size: number): { near: number, far: number }` —— `near = idealDistance + size × Math.SQRT2`，`far = near + 25`。

- [ ] **Step 1: 写失败测试**（追加到 `tests/maze-3d-core.test.mjs`，沿用文件里的 `L` 与 `near` 助手）

```js
test('fogRing and floorKind fogEdge', () => {
  const c = { row: 10, col: 10 };
  const N = 3;
  const kind = (cell) => L.floorKind(cell, 20, {
    inView: L.isInFogView(c, cell, N), onPath: false, edge: L.fogRing(c, cell, N),
  });
  assert.equal(kind({ row: 13, col: 10 }), 'floor');   // 距离 N
  assert.equal(kind({ row: 14, col: 7 }), 'fogEdge');  // 距离 N+1（含对角）
  assert.equal(kind({ row: 6, col: 14 }), 'fogEdge');
  assert.equal(kind({ row: 15, col: 10 }), 'fog');     // 距离 N+2
  assert.equal(L.fogRing(c, { row: 13, col: 13 }, N), false);
  assert.equal(L.fogRing(c, { row: 14, col: 14 }, N), true);
  assert.equal(L.floorKind({ row: 0, col: 0 }, 10, { inView: false, onPath: true, edge: true }), 'path');
  assert.equal(L.floorKind({ row: 0, col: 0 }, 10, { inView: false, onPath: false, edge: true }), 'fogEdge');
  assert.equal(L.floorKind({ row: 0, col: 0 }, 10, { inView: true, onPath: false, edge: false }), 'start');
  assert.equal(L.floorKind({ row: 0, col: 0 }, 10, { inView: false, onPath: false }), 'fog');
});

test('followFogRange', () => {
  near(L.followFogRange(8.6, 10), { near: 8.6 + 10 * Math.SQRT2, far: 8.6 + 10 * Math.SQRT2 + 25 });
});

test('groundFogFarMax', () => {
  assert.ok(Math.abs(L.groundFogFarMax(20, 1.5) - 73.6865) < 1e-3);
  assert.ok(Math.abs(L.groundFogFarMax(10, 1.5) - 59.5443) < 1e-3);
  for (const s of [10, 15, 20]) assert.ok(L.groundFogFarMax(s, 1.5) < 200);
  // 跟随上界不小于任何可达的跟随雾终点
  for (const s of [10, 15, 20]) for (const r of [1, 5, 10, 25]) for (const z of [0.7, 1, 1.5]) {
    const o = L.followOffset(r);
    assert.ok(L.followFogRange(Math.hypot(o.h, o.d) * z, s).far <= L.groundFogFarMax(s, 1.5) + 1e-9);
  }
  // 第一人称上界
  for (const s of [10, 15, 20]) assert.ok(Math.max(25.5, s * 1.5) <= L.groundFogFarMax(s, 1.5));
});

test('groundHalfExtent keeps every visible edge point beyond fog far', () => {
  assert.equal(L.groundHalfExtent(L.groundFogFarMax(20, 1.5), 50, 3), 134);
  assert.equal(L.groundHalfExtent(L.groundFogFarMax(20, 1.5), 50, 1), 91);
  const tan = Math.tan((25 * Math.PI) / 180);
  for (const s of [10, 15, 20]) for (const aspect of [1, 3, 4]) {
    const F = L.groundFogFarMax(s, 1.5);
    const E = L.groundHalfExtent(F, 50, aspect);
    // 视锥四角与 9×9 网格方向：相机空间 v = (x·tan·aspect, y·tan, −1)，深度 = t（沿 −z）。
    // 水平距离 ≤ 欧氏距离 = t·|v|；边缘点水平距离 ≥ E − 1，所以深度 ≥ (E − 1) / |v|。
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const x = -1 + i / 4, y = -1 + j / 4;
      const len = Math.hypot(x * tan * aspect, y * tan, 1);
      assert.ok((E - 1) / len >= F, `size=${s} aspect=${aspect} x=${x} y=${y}`);
    }
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-core.test.mjs`
Expected: FAIL，`L.fogRing is not a function` 等。

- [ ] **Step 3: 实现上述五个函数**（`floorKind` 改签名时保持现有 `floorKind priority` 用例通过）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add maze-3d/game-logic.js tests/maze-3d-core.test.mjs
git commit -m "feat(maze-3d): 迷雾过渡圈与外围地面尺寸纯函数"
```

---

### Task 3: 视野外格子改用雾地板色与过渡色（main.js + 旧浏览器检查）

**Files:**
- Modify: `maze-3d/main.js`（`COLORS`、`kindAt`、`applyFloorColors`，约 62-69、399-416 行）
- Modify: `tests/browser/maze3d_accept.py`（`FOG_STATE_JS`、`check_4` 的 (c)、`check_5` 的 start/endWant、`check_t5` 场景 C）

**Interfaces:**
- Consumes: Task 1 的 `THEMES[id].fogFloor`、`mixHex`；Task 2 的 `fogRing`、`floorKind(..., { edge })`。
- Produces: `__maze3d.floorKindAt(row, col)` 现在可能返回 `'fogEdge'`；`floorColorHex` 返回的雾格颜色为主题 `fogFloor` / 过渡色。

- [ ] **Step 1: 改验收脚本（先让它失败）**

在脚本里加助手 `FLOOR_WANT_JS`（页面里同时 import `game-logic.js` 与 `themes.js`），按格算期望颜色：

```js
// arg = 视野半径；返回期望 hex：path > fogEdge / fog > start / end / floor
const t = T.THEMES[M.theme];
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const want = { floor: hex(t.floorBase), fog: hex(t.fogFloor),
  fogEdge: hex(T.mixHex(t.floorBase, t.fogFloor, 0.5)),
  start: '#4caf50', end: '#e53935', path: '#ff6b6b' };
// kind = L.floorKind(cell, M.size, { inView, onPath: false, edge: M.fog.on && L.fogRing(M.display, cell, arg) })
```

- `FOG_STATE_JS` 的 `floorMismatch`：每格 `M.floorColorHex(row, col) !== want[kind]` 即计 1；另外返回 `edgeCells`（种类为 fogEdge 的格数）。`check_4` (a) 和 (e) 额外要求 `edgeCells > 0`。`logic()` 只 import game-logic，需要新增一个同时 import 两个模块的求值助手 `logic_themes(page, expr, arg)`（可用 `L`, `T`, `M`, `arg`）。
- `check_4` (c)：`dark` 改为统计颜色等于 `want.fog` 或 `want.fogEdge` 的格数，仍要求 0。
- `check_5`：`startWant` / `endWant` 改用同一规则（视野外时按 `fogRing` 取 `fogEdge` 或 `fog` 的期望 hex）。
- `check_t5` 场景 C（视野 1）：`fog` 取样候选改为 `3 <= dist <= 4`（距离 2 现在是过渡圈）；新增 `got_edge` 取样 `dist == 2`、`want='fogEdge'`，只要求取到（不参与 ≥ 60 两两比较），写进 notes。

- [ ] **Step 2: 运行确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 4,5,t5`
Expected: 4 FAIL（`floorMismatch > 0`，页面仍是 `#333333`、无 fogEdge）。

- [ ] **Step 3: 改 main.js**

- `COLORS` 删掉 `fog`。
- `kindAt(row, col)` 传 `edge: fogOn && fogRing(display, { row, col }, fogRadius)`。
- `applyFloorColors()`：`floor` → `floorBase`；`fog` → `theme.fogFloor`；`fogEdge` → `mixHex(floorBase, theme.fogFloor, 0.5)`；其余用 `COLORS[kind]`。

- [ ] **Step 4: 运行确认通过**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 4,4b,5,11,t5` 然后 `node --test tests/`
Expected: 全部 PASS；t5 各主题 `min` ≥ 60。

- [ ] **Step 5: black 格式化并 commit**

```bash
~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py
git add maze-3d/main.js tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 视野外格子用主题雾地板色并加过渡圈"
```

---

### Task 4: 外围地面网格与第 5 张纹理（main.js）

**Files:**
- Modify: `maze-3d/main.js`（场景构建、`buildMaze`、`resize`、`frame`、`downgrade`、`ensureTextures`、`applyTheme`、调试对象）
- Modify: `tests/browser/maze3d_accept.py`（`check_t1`、`check_t6` 的纹理数 4 → 5；`check_t7b` 的 anisotropy `[1,1,1]` → `[1,1,1,1]`；t1 加地面纹理随主题变化）

**Interfaces:**
- Consumes: `paintGround`（Task 1）；`groundFogFarMax`、`groundHalfExtent`（Task 2）；`ZOOM_MAX`（movement.js 已导出）。
- Produces（`window.__maze3d`）：
  - `get ground()` → `{ cx, cz, y, halfExtent, repeat: [rx, ry], mapUuid }`（`mapUuid` = 地面材质当前 map 的 `uuid`）。
  - `get textureAnisotropy()` → `[wall, top, floor, ground]` 四项。
  - `get cameraState()` → `{ pos: [x,y,z], forward: [x,y,z], fov, aspect, near, far, view: number[16] }`（`view` = `camera.matrixWorldInverse.elements`，列主序；读之前 `camera.updateMatrixWorld()`）。
  - 仅 `?debug=1`：`teleportForTest(row, col)` —— 把小人放到格中心、速度清零、更新 `display`、`recomputeFog()`、`snapCamera()`；`setZoomForTest(z)` —— 按 `[ZOOM_MIN, ZOOM_MAX]` 夹紧后赋给 `cameraZoom`。

- [ ] **Step 1: 改验收脚本（先让它失败）**

- `check_t1`、`check_t6` 中所有 `!= 4` / `== 4` / `textures=4` 改为 5。
- `check_t1` 每个主题记录 `m3(page, "ground")["mapUuid"]`，要求四个主题两两不同、重复点击同一主题不变。
- `check_t7b` 三处 `[1, 1, 1]` 改为 `[1, 1, 1, 1]`。

- [ ] **Step 2: 运行确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only t1,t6,t7b`
Expected: FAIL（`textureCount` 仍为 4，`ground` 未定义）。

- [ ] **Step 3: 实现**

- 新建 `groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }))`，`rotation.x = −π/2`，`position.y = −0.045`，`frustumCulled = false`，加入场景。
- `let groundE = 0;` `function updateGroundExtent()`：`groundE = groundHalfExtent(groundFogFarMax(size, ZOOM_MAX), camera.fov, camera.aspect)`；`groundMesh.scale.set(2 * groundE, 2 * groundE, 1)`；若有当前地面纹理则 `repeat.set(2 * groundE, 2 * groundE)`。在 `buildMaze` 末尾和 `resize()` 里（`updateProjectionMatrix` 之后）调用；`applyTheme` 换纹理后也设一次 `repeat`。
- `frame()` 中 `updateCamera(dt)` 之后：`groundMesh.position.x = Math.round(camera.position.x)`，`z` 同理。`snapCamera()` 之后同样同步一次（抽成 `syncGround()`），保证调试读数与相机一致。
- `ensureTextures`：新增 `ground: makeCanvasTexture((ctx, n) => paintGround(id, ctx, n))`；释放列表加 `'ground'`。`applyTheme` 把 `groundMesh.material.map` 纳入 `changed` 判断与 `needsUpdate`。
- `downgrade()` 与 `textureAnisotropy` 调试 getter 都加上 `currentTextures.ground`。
- 加上 Interfaces 列出的调试 getter 与 debug-only 钩子。

- [ ] **Step 4: 运行确认通过**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 1,t1,t2,t6,t7b,t9` 然后 `node --test tests/`
Expected: 全部 PASS；t1 / t6 `textures=5`。人工打开 `t9` 截图确认迷宫四周有地面。

- [ ] **Step 5: black 格式化并 commit**

```bash
~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py
git add maze-3d/main.js tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 迷宫外围加主题地面"
```

---

### Task 5: 等距柱状天空与跟随视角距离雾（main.js）+ 检查 g1 / g3 / g8

**Files:**
- Modify: `maze-3d/main.js`（`makeSkyTexture`、`updateSceneFog`、`frame`、调试对象）
- Modify: `tests/browser/maze3d_accept.py`（新增 `check_g1`、`check_g3`、`check_g8` 并登记到 `CHECKS`）

**Interfaces:**
- Consumes: Task 2 `followFogRange`；Task 4 `cameraState`、`teleportForTest`、`setZoomForTest`。
- Produces（`window.__maze3d`）：
  - `get sceneFog()` → `null | { near, far, color: '#rrggbb' }`。
  - `screenHitsScene(x, y)`（CSS px，相对 canvas 左上角）→ `boolean`：射线命中未隐藏的墙实例、地板、星星、可见的小人中任一个。
  - 仅 `?debug=1`：`setSceneFogForTest(enabled: boolean)` —— false 时 `updateSceneFog()` 总是置 `scene.fog = null`，true 恢复正常逻辑并立即调用一次 `updateSceneFog()`。
- Python 助手（脚本内）：`horizon_y(page, img)` → 地平线在截图中的像素行（可为负或超出高度）：`θ = asin(−forward.y)`，`y_css = H/2 × (1 − tan θ / tan(fov/2))`（H 为 canvas `clientHeight`），乘 `img.height / clientHeight`。基线代码没有 `cameraState`，`check_g1` 对基线改用 `cameraPitch`（跟随视角 θ 即 `cameraPitch`，fov 50）。`sky_dist(px, theme)` → 像素到 `[sky.top, sky.bottom]` RGB 线段的距离。

- [ ] **Step 1: 写失败的检查**

- `check_g1`：四个主题，`?seed=12345&size=10&debug=1`，视口 1280×800，等 idle 后 600ms 截图。在地平线以下的行（`max(0, horizon_y)` 到底）取 32×32 均匀网格，统计 `sky_dist ≤ 12` 的占比，要求 ≤ 0.10。若给了 `--baseline-root`，用基线服务器同样测一次 garden，只记录不判定（`baseline sky=xx%`）。
- `check_g3`（迷宫内不受距离雾影响 + 雾参数跟随）：
  1. `size=20`，`preset_storage("0", "5")`（迷雾关），`setZoomForTest(1.5)`，`setInputForTest({yaw: 3π/4, pitch: 15°})` 后清输入，`settle_camera`。在 `(19,19)`、`(19,0)`、`(0,19)` 中取第一个 `floorSamplePoints` 非空的格，截图取样中位数；`setSceneFogForTest(false)` 后等 300ms 再取同样点；两次 `rgb_dist ≤ 8`。随后 `setSceneFogForTest(true)`。
  2. 断言 `sceneFog` 的 `near/far` 与 `L.followFogRange(M.cameraIdealDistance, M.size)` 相差 < 1e-6，且 `color` 等于主题 `fogColor`。
  3. 在 canvas 中心 `page.mouse.wheel(0, -400)`，等 300ms：`cameraZoom` 变了，且 `sceneFog` 仍与 `followFogRange` 一致。
  4. 点 `#view-btn` 进第一人称：`sceneFog.near == 0.5`、`far == size × 1.5`（迷雾关）；再点回跟随：重新等于 `followFogRange`。
- `check_g8`（地平线无接缝）：四个主题 × 五个状态，视口 1280×800，`size=10`，`preset_storage("1", "1")`（迷雾开、视野 1），`teleportForTest(0, 0)`、`yaw = 0`（朝北，起点格北侧无墙）：
  - 跟随 pitch 15°、40°；第一人称 pitch 0°、+20°、−20°（`setInputForTest({pitch})`，正值向下看）。
  - 每个状态等 400ms 截图，存为 `SHOTS / f"horizon-{tid}-{state}.png"`。
  - 算 `horizon_y`；若 `horizon_y − 3 < 0` 或 `horizon_y + 3 ≥ 高度`（跟随 40° 时地平线在画面外），记录 `offscreen` 并视为通过。
  - 否则在 16 个等距列中挑 `screenHitsScene` 在 `horizon_y ± 3` 两点都为 false 的列，要求至少 4 列，且每列两点 `rgb_dist ≤ 8`。

- [ ] **Step 2: 运行确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only g1,g3,g8`
Expected: g3 FAIL（`sceneFog` 在跟随视角为 null）；g8 FAIL（屏幕空间渐变在地平线下方不是雾色）。

- [ ] **Step 3: 实现**

- `makeSkyTexture(theme)`：canvas 8×256，`createLinearGradient(0, 0, 0, 256)`，色标 `0 → sky.top`、`0.5 → sky.bottom`、`1 → fogColor`（四个主题 `sky.bottom === fogColor`，下半部即纯雾色）；`tex.mapping = THREE.EquirectangularReflectionMapping`，保留 `SRGBColorSpace`、`generateMipmaps = false`、`LinearFilter`。
- `updateSceneFog()`：被 `setSceneFogForTest(false)` 关掉时置 null；第一人称保持原逻辑；跟随视角用 `followFogRange(idealDistance(), size)` 设置 / 新建 `THREE.Fog(theme.fogColor, near, far)`。
- `frame()` 在 `updateCamera(dt)` 之后每帧调用 `updateSceneFog()`（只改两个数字，覆盖滚轮、双指缩放、迷雾开关、尺寸变化所有入口）。
- 加上 Interfaces 列出的调试接口。

- [ ] **Step 4: 运行确认通过**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only g1,g3,g8,1,3,t2,t5,f6`
Expected: 全部 PASS；g1 各主题天空占比 ≤ 10%。

- [ ] **Step 5: black 格式化并 commit**

```bash
~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py
git add maze-3d/main.js tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 天空按世界仰角着色，跟随视角远处雾化"
```

---

### Task 6: 地面边缘不可见检查 g7、截图目录与全量验收

**Files:**
- Modify: `tests/browser/maze3d_accept.py`（新增 `check_g7`；`SHOTS` 默认值；`--write` 头部「人工检查」文案）
- Modify: `maze-3d/README.md`（主题段落补一句外围地面与雾）
- Modify: `tests/browser/test-results.txt`（由 `--write` 生成）

**Interfaces:**
- Consumes: Task 4 `ground`、`cameraState`、`teleportForTest`、`setZoomForTest`；Task 5 `sceneFog`、`horizon_y`。
- Produces: Python 助手 `edge_min_depth(cam, seg)` → `float | None`：把世界线段两端用 `cam["view"]`（列主序 4×4）变换到相机空间，按 6 个半空间 `−z ≥ near`、`−z ≤ far`、`±x ≤ −z·tan(fov/2)·aspect`、`±y ≤ −z·tan(fov/2)` 做 Liang–Barsky 裁剪；线段与视锥无交集返回 None，否则返回裁剪后两端 `−z` 的较小值（深度沿线段线性，最小值在端点）。

- [ ] **Step 1: 写检查 `check_g7`**

1. 以 1280×800 打开 `?seed=12345&size=10&debug=1`，`preset_storage("0", "5")`（迷雾关）；点 20 号尺寸按钮，等 `size == 20`；`page.set_viewport_size({"width": 1500, "height": 500})`，等 300ms。
2. `setZoomForTest(1.5)`。对四个角 `(0,0)`、`(0,19)`、`(19,0)`、`(19,19)` 依次 `teleportForTest`，对 yaw ∈ {0°, 45°, …, 315°} 依次 `setInputForTest({yaw, pitch: 15°})` 后清输入，等 1200ms（相机平滑与避障收敛）。
   - 读 `ground`、`cameraState`、`sceneFog`。地面四条边（y = `ground.y`，`cx ± E`、`cz ± E`）各调 `edge_min_depth`，非 None 的都要 `≥ sceneFog.far − 1e-6`。
   - 截图；左右各 5% 宽的竖条，取中线列；对 `horizon_y + 2` 到「该列射线与地面平面交点深度 = `sceneFog.far`」所在行之间的每 4 行取一点（深度按 `cameraState` 逐行算：`v = (x_ndc·tan·aspect, y_ndc·tan, −1)`，世界方向 `d = R·v`，`t = (ground.y − pos.y) / d.y`，`t > 0` 时深度 = t），要求与主题 `fogColor` 的 `rgb_dist ≤ 8`；每个状态至少取到 1 个点。
   - 记录失败状态的角、yaw、最小深度。
3. 32 个状态全部通过且无页面错误才 PASS；额外要求过程中 `ground.halfExtent == 134`（20×20、3:1 的期望值）。
4. 登记到 `CHECKS`。

- [ ] **Step 2: 运行**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only g7`
Expected: PASS，`states=32/32`，`halfExtent=134`。若失败，按 superpowers:systematic-debugging 排查（先确认 `resize()` 和 `buildMaze` 都调用了 `updateGroundExtent()`）。

- [ ] **Step 3: 截图目录、文案与 README**

- `SHOTS` 默认改为 `/Users/jialiu/Projects/saisai.me/.xdev/20261113-102305-maze-3d-ground-fog/screenshots`。
- `--write` 头部「人工检查」改为：查看该目录下四个主题的跟随 / 第一人称 / 面墙截图与 `horizon-*.png`，确认迷宫外有主题地面、地平线无色带、视野外格子不是纯黑。
- `maze-3d/README.md` 主题说明加一句：迷宫外围有配套地面，远处渐隐到雾色；视野外格子用主题雾色。
- `black` 格式化脚本。

- [ ] **Step 4: 准备基线并全量验收**

```bash
B=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad/maze3d-ground-fog-baseline
rm -rf "$B" && mkdir -p "$B"
git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261113-102305-maze-3d-ground-fog archive origin/feat/maze-3d-free-move-20261113-091931 | tar -x -C "$B"
cd /Users/jialiu/Projects/saisai.me/.worktrees/20261113-102305-maze-3d-ground-fog
node --test tests/
~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --write --baseline-root "$B"
```

Expected: `node --test` 全 PASS；验收脚本退出码 0，`test-results.txt` 中 `自动检查：PASS`，t7 各主题 `ok avg ≤ 1.3 × baseline`，g1 行含 `baseline sky=` 记录；截图目录有 4 × 3 张 t9 截图和 20 张 `horizon-*.png`。若 t7 结果为 INCONCLUSIVE（SwiftShader），在结果中如实保留，不改判定。

- [ ] **Step 5: Commit**

```bash
git add tests/browser/maze3d_accept.py tests/browser/test-results.txt maze-3d/README.md
git commit -m "test(maze-3d): 外围地面边缘不可见检查与全量验收结果"
```
