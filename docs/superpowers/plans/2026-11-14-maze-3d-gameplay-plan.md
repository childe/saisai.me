# 3D 迷宫玩法 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小地图显示已探索格子与脚印并在两种视角都显示；Web Audio 合成音效（脚步、撞墙、星星、通关）带静音开关、安卓震动；计时与每个尺寸的最佳成绩；迷宫里可收集的星星；舞台左上角信息栏。

**Architecture:** 所有可测逻辑放进新模块 `maze-3d/gameplay.js`（纯函数与小工厂，不碰 DOM、不依赖 three.js），音频放进新模块 `maze-3d/sound.js`（`AudioContext` 通过注入的 `win` 取得，node 里用假对象测试）。`main.js` 只负责接线：本局状态在 `buildMaze()` 重置，`recomputeFog()` 更新已探索与星星可见性，`updatePlayer()` 里按「实际位移 → 计时 → 脚步 → 撞墙 → 星星 → 换格」的顺序处理，帧循环更新计时显示、星星动画和小地图。浏览器验收脚本新增 `b1`–`b15` 检查，并按 design 更新 `check_3`、`check_8`、`canvas_image()`。

**Tech Stack:** 原生 ES modules、vendor three.js r187、Canvas 2D、Web Audio、`node --test`、Python Playwright + Pillow（`~/tmp/fuck/c/.venv/bin/python`），Python 格式化用 `/opt/homebrew/bin/black`。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261114-103742-maze-3d-gameplay/docs/superpowers/specs/2026-11-14-maze-3d-gameplay-design.md`

## Global Constraints

- 路径变量：每个 Bash 命令开头先设 `W=/Users/jialiu/Projects/saisai.me/.worktrees/20261114-103742-maze-3d-gameplay`、`B=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad/maze3d-gameplay-baseline`、`SHOTS=/Users/jialiu/Projects/saisai.me/.xdev/20261114-103742-maze-3d-gameplay/screenshots`，并 `cd "$W"`。下文命令里的 `$W`、`$B`、`$SHOTS` 都指这三个值。
- 不加依赖、不加音频文件、不加图片、不 `npm install`；页面仍是无构建步骤的静态 ES 模块。新增纹理数为 0（`textureCount` 不变）。
- 不改 `maze-core.js`、不改 2D 迷宫页面、不改 `stepPlayer`、不改迷雾判定（`isInFogView`、`wallInView`）。
- `localStorage` 只经 `storageGet()` / `storageSet()`。新键：`maze3d.sound`（`'1'` / `'0'`，缺省为开：`storageGet('maze3d.sound') !== '0'`）、`maze3d.best.10` / `.15` / `.20`（正整数毫秒字符串）。
- 文案逐字：`声音：开` / `声音：关`；HUD `⏱ mm:ss.t`、`⭐ k/N`；通关层 `用时 mm:ss.t`、`最佳 mm:ss.t`、`新纪录!`、`这局看了道路，不计入最佳成绩`、`⭐ 收集了 k / N 颗星星`、`⭐ 全部 N 颗星星都收集到了！`。
- 小地图颜色：视野内地板 `#f2efe6`、已探索视野外 `#d9d3c4`、未探索 `#5b6270`、终点 `#e53935`、墙 `#7e57c2`（线宽不变）、脚印 `#8d6e63`、星星标记 `#ffb300` 描边 `#8d5a00`。
- 星星数量 10 → 3、15 → 5、20 → 7；正面色 `0xffb300`、`emissive 0x553300`、侧面 `0x8d5a00`；外半径 0.16、内半径 0.07、厚 0.05；浮动高度 0.35 ± 0.05；拾取半径 0.4。
- 音色：`step` 三角波 40ms 330/392Hz 交替 峰值 0.06；`bump` 正弦 0.15s 140→60Hz 峰值 0.25；`star` 正弦 988Hz、0.08s 后 1319Hz、各 0.25s 峰值 0.15；`win` 三角波 523/659/784/1047Hz 间隔 0.12s、末音 0.5s、峰值 0.18。震动 `bump` → `25`，`win` → `[80, 60, 80, 60, 200]`。
- 帧循环里不新建对象（计时器、脚步计数器、撞墙检测器在 `start()` 里各建一次）。
- 新 DOM 覆盖层（`#hud`、`#sound-btn`）和新网格（星星）都要在开局预热（预渲染 + `WARM_FRAMES`）里完成首次光栅化 / 着色器编译；`f1` 必须一直 PASS（PR A 的教训：SwiftShader 首次光栅化会卡 70–400ms）。
- 浏览器检查一律以 `?seed=12345&...&debug=1` 打开（除非注明），新检查名 `b1`–`b15` 登记进 `CHECKS`；每个新检查都以 `no_errors(errors)` 收尾。
- 旧检查只允许 design 点名的三处改动：`check_3`（跟随视角小地图可见）、`canvas_image()`（截图前隐藏 `#minimap`、`#hud`）、`check_8`（新增断言）。其余旧检查失败一律按 superpowers:systematic-debugging 查根因修代码，不放宽阈值。
- Python：`~/tmp/fuck/c/.venv/bin/python`；改完 Python 跑 `/opt/homebrew/bin/black tests/browser/maze3d_accept.py`。JS：`node --test tests/`。
- 基线代码副本 `B=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad/maze3d-gameplay-baseline`（Task 1 建）。截图目录 `SHOTS=/Users/jialiu/Projects/saisai.me/.xdev/20261114-103742-maze-3d-gameplay/screenshots`。
- 全量浏览器验收约 12 分钟：一律用 Bash 的 `run_in_background: true` 跑，输出写日志文件，然后每 60 秒轮询一次日志，直到出现 `EXIT` 行；不要前台阻塞。
- git：用仓库默认身份提交，不要执行 `git config user.name` / `git config user.email`，不要使用 `jia.liu@ctrip.com`；不要 push；不要用裸 `git stash`。

## Review Focus

1. 存储被禁用（`getItem` / `setItem` 抛异常，`check_4b` 的 `BLOCK_STORAGE`）：声音按默认开，最佳成绩当作无记录，通关时写存储失败不抛异常、通关层照常显示「新纪录!」。Task 6 的 `b5` 加一个子场景覆盖。
2. 通关后小人不再移动，但输入仍按着：不能再响 `step` / `bump`、不能再震动，计时不再走。Task 8 的 `b6` 在通关后继续 `forward: 1` 推 1 秒，断言 `sfxLog` 没有新的 `step` / `bump`。
3. 从 20×20（7 颗）切到 10×10（3 颗）：多出来的 4 个星星网格必须隐藏，不能留在旧位置。Task 7 新增调试字段 `starMeshesVisible`，`b10` 在切换后（迷雾关）断言它等于 3。
4. 页面切到后台再回来：渲染循环停止期间计时不走；回到前台不把后台时长算进 `dt`。Task 6 的 `b4` 用改写 `document.visibilityState` + 派发 `visibilitychange` 的方式模拟，断言后台 1 秒内 `elapsedMs` 不变、回来后继续走。
5. 窄屏与横屏之间旋转（跨过 480px 断点，小地图 110px ↔ 140px）：底图必须按新像素尺寸重画，「没变就跳过」的判断要包含画布尺寸。Task 5 的 `check_8` 在横屏后断言 `minimapLayout.px === round(140 × dpr)` 且 `#minimap` 画布宽度等于它。

---

### Task 1: 基线副本与改动前全量结果

不改代码，不提交。后续 `t2`、`t5`、`t7`、`b14` 等对比检查需要基线副本；改动前的全量结果用来分辨「本来就不稳」的检查。

**Files:** 无（只写 scratchpad）

- [ ] **Step 1: 确认 merge-base 与本分支在代码上无差异**

Run: `git -C "$W" merge-base HEAD main` → 期望 `5d1e405f974eedfb7245d17651be3b8c25844c20`。
Run: `git -C "$W" diff --stat 5d1e405 HEAD -- maze-3d tests` → 期望无输出（本分支到目前只改了 docs）。

- [ ] **Step 2: 从主 checkout 导出基线副本**

```bash
B=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad/maze3d-gameplay-baseline
rm -rf "$B" && mkdir -p "$B"
git -C /Users/jialiu/Projects/saisai.me archive 5d1e405 | tar -x -C "$B"
diff -r "$B/maze-3d" "$W/maze-3d" && echo SAME
```
Expected: 输出 `SAME`。

- [ ] **Step 3: 后台跑改动前全量浏览器验收**

用 Bash `run_in_background: true` 执行（不加 `--write`，截图写到 scratchpad，不污染 `SHOTS`）：
```bash
SP=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad
cd "$W" && ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --baseline-root "$B" --shots "$SP/maze3d-gameplay-baseline-shots" > "$SP/maze3d-gameplay-before.log" 2>&1; echo "EXIT $?" >> "$SP/maze3d-gameplay-before.log"
```
每 60 秒轮询：`grep -cE '^(PASS|FAIL|INCONCLUSIVE) ' "$SP/maze3d-gameplay-before.log"; grep '^EXIT' "$SP/maze3d-gameplay-before.log"`，直到出现 `EXIT` 行。
Expected: 51 行结果，`EXIT 0`。若有 FAIL / INCONCLUSIVE，把检查名与原文记在本任务的报告里（后续任务遇到同名检查失败时据此判断是否为本 PR 引入），不要修。Task 2–4 只新增纯逻辑文件，可以在等待期间开始。

---

### Task 2: 星星摆放纯逻辑（`gameplay.js` 第一部分）

**Files:**
- Create: `maze-3d/gameplay.js`
- Create: `tests/maze-3d-gameplay.test.mjs`
- Modify: `tests/maze-3d-page.test.mjs`（`OWN` 加 `'gameplay.js'`）

**Interfaces:**
- Consumes: `game-logic.js` 的 `DIRS`、`canMove(connections, from, to)`、`findPath(connections, start, end) -> Array<[row, col]>`。
- Produces（`gameplay.js` 导出）：
  - `STAR_COUNTS = { 10: 3, 15: 5, 20: 7 }`；`starCountFor(size: number) -> number`（不在表里时按 `STAR_COUNTS[10]`）。
  - `mulberry32(seed: number) -> () => number`（返回 [0, 1) 浮点）。
  - `placeStars(connections, seed: number, count: number) -> Array<{row, col}>`。
  - `STAR_PICK_RADIUS = 0.4`；`starHit(px: number, pz: number, star: {row, col}) -> boolean`（`hypot(px − col − 0.5, pz − row − 0.5) < 0.4`）。
  - `STAR_COLORS = { face: 0xffb300, emissive: 0x553300, side: 0x8d5a00 }`。
  - `STAR_SHAPE = { outer: 0.16, inner: 0.07, depth: 0.05 }`；`STAR_FLOAT = { base: 0.35, amp: 0.05, period: 2, spin: 2 }`。

- [ ] **Step 1: 写失败的测试 `tests/maze-3d-gameplay.test.mjs`（星星部分）**

测试文件顶部 import `readFileSync`（`node:fs`）、`join` / `dirname`（`node:path`）、`fileURLToPath`（`node:url`，用来求 `here`）、`MazeGenerator`（`../maze-3d/maze-core.js`）、`findPath`、`canMove`、`DIRS`（`../maze-3d/game-logic.js`）、`THEMES`、`THEME_IDS`（`../maze-3d/themes.js`），以及上面 gameplay 的导出。辅助函数：`cheb(a, b)`、`manhattan(a, b)`、`rgbDist(a, b)`（与 `tests/maze-3d-themes.test.mjs` 的 `dist` 同公式）、`bfsNoEnd(connections)`（从 (0,0) BFS，终点格入集合但不出队扩展，返回 `Set` of `r*size+c`）、`corridor(size, cells)`（按相邻格列表打通双向连接，返回 `connections`）。

```js
test('starCountFor', () => {
  assert.equal(starCountFor(10), 3);
  assert.equal(starCountFor(15), 5);
  assert.equal(starCountFor(20), 7);
});

test('placeStars over seeds 1..200 × sizes', () => {
  let good = 0, total = 0;
  for (const size of [10, 15, 20]) {
    for (let seed = 1; seed <= 200; seed++) {
      const conn = new MazeGenerator(size, size, seed).generate().connections;
      const stars = placeStars(conn, seed, starCountFor(size));
      const end = { row: size - 1, col: size - 1 };
      const start = { row: 0, col: 0 };
      assert.equal(stars.length, starCountFor(size));
      assert.equal(new Set(stars.map((s) => s.row * size + s.col)).size, stars.length);
      const reach = bfsNoEnd(conn);
      const main = new Set(findPath(conn, start, end).map(([r, c]) => r * size + c));
      for (const s of stars) {
        assert.ok(cheb(s, start) >= 2 && cheb(s, end) >= 2, `${size}/${seed}`);
        assert.ok(findPath(conn, start, s).length > 0);
        assert.ok(reach.has(s.row * size + s.col));
        const exits = Object.values(DIRS).filter(([dr, dc]) =>
          canMove(conn, s, { row: s.row + dr, col: s.col + dc })).length;
        if (exits === 1 || !main.has(s.row * size + s.col)) good++;
        total++;
      }
      for (let i = 0; i < stars.length; i++)
        for (let j = i + 1; j < stars.length; j++) assert.ok(manhattan(stars[i], stars[j]) >= 2);
      assert.deepEqual(placeStars(conn, seed, starCountFor(size)), stars);
      assert.deepEqual(new MazeGenerator(size, size, seed).generate().connections, conn);
    }
  }
  assert.ok(good / total >= 0.8, `ratio ${good / total}`);
});

test('placeStars relaxes spacing on a single corridor', () => {
  // 6×6 L 形走廊：(0,0)→(0,5)→(5,5)；候选格 (0,2)(0,3)(0,4)(0,5)(1,5)(2,5)(3,5)
  const cells = [];
  for (let c = 0; c <= 5; c++) cells.push([0, c]);
  for (let r = 1; r <= 5; r++) cells.push([r, 5]);
  const stars = placeStars(corridor(6, cells), 7, 3);
  const cand = new Set(['0,2', '0,3', '0,4', '0,5', '1,5', '2,5', '3,5']);
  assert.equal(stars.length, 3);
  for (const s of stars) assert.ok(cand.has(`${s.row},${s.col}`));
});

test('placeStars returns all candidates when there are too few', () => {
  // 4×4：(0,0)→(0,3)→(3,3)；候选只有 (0,2)(0,3)(1,3)
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3]];
  const stars = placeStars(corridor(4, cells), 1, 5);
  assert.deepEqual(stars.map((s) => `${s.row},${s.col}`).sort(), ['0,2', '0,3', '1,3']);
});

test('starHit', () => {
  assert.equal(starHit(2.5 + 0.39, 3.5, { row: 3, col: 2 }), true);
  assert.equal(starHit(2.5 + 0.41, 3.5, { row: 3, col: 2 }), false);
});

test('star face color is distinguishable from path and floors', () => {
  // 从 main.js 的 COLORS 读道路色（与 maze-3d-themes.test.mjs 同样的正则）
  const src = readFileSync(join(here, '..', 'maze-3d', 'main.js'), 'utf8');
  const path = parseInt(src.match(/const COLORS = \{[\s\S]*?path:\s*0x([0-9a-f]{6})/i)[1], 16);
  assert.ok(rgbDist(STAR_COLORS.face, path) >= 60);
  for (const id of THEME_IDS) assert.ok(rgbDist(STAR_COLORS.face, THEMES[id].floorBase) >= 60, id);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/maze-3d-gameplay.test.mjs`
Expected: FAIL，`Cannot find module` / 导出不存在。

- [ ] **Step 3: 实现 `maze-3d/gameplay.js` 的星星部分**

文件头注释写明「纯逻辑，不碰 DOM，不依赖 three.js」；只 import `./game-logic.js`。

`mulberry32` 用标准实现（测试不决定它，这里写死）：
```js
export function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```
种子混合（模块内函数，常数写死）：`lo = (seed % 2**32) >>> 0`，`hi = Math.floor(seed / 2**32) >>> 0`，`mixed = (lo ^ Math.imul(hi, 0x9e3779b1) ^ 0x2545f491) >>> 0`。

`placeStars` 按 design 第 4 节 1–6 步：`size = connections.length`；BFS 从 (0,0) 出发，终点格入集合但不扩展；候选 = 可达格去掉 Chebyshev(起点) ≤ 1 和 Chebyshev(终点) ≤ 1 的格；权重 = 死胡同（`canMove` 通的方向数 = 1）+2、不在 `findPath(start, end)` 上 +1；按行优先给每个候选格取一个 `rng()`；排序「权重降序、随机数升序」；`D` 从 `max(1, floor(size / 3))` 起贪心挑（与已挑的曼哈顿距离都 ≥ D），不够就清空、`D − 1` 重来，`D = 1` 仍不够时返回这一轮挑到的全部（此时等于全部候选）。返回 `{row, col}` 新对象数组。

- [ ] **Step 4: `tests/maze-3d-page.test.mjs` 的 `OWN` 加入 `'gameplay.js'`**

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。颜色测试打印的距离：与道路 ≈ 73.4，与四个 `floorBase` 分别 ≈ 250 / 246 / 257 / 205（`0xffb300` 对 `0xffd740`、`0xfffaf0`、`0xf7f3ee`、`0xf4f6f8`、`0xaeb3bc`）。

- [ ] **Step 6: 提交**

```bash
git add maze-3d/gameplay.js tests/maze-3d-gameplay.test.mjs tests/maze-3d-page.test.mjs
git commit -m "feat(maze-3d): 星星摆放纯逻辑 placeStars"
```

---

### Task 3: 小地图、计时、成绩、脚步、撞墙纯逻辑（`gameplay.js` 第二部分）

**Files:**
- Modify: `maze-3d/gameplay.js`
- Modify: `tests/maze-3d-gameplay.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `gameplay.js`；测试里用 `movement.js` 的 `ACCEL`、`MAX_SPEED`。
- Produces（`gameplay.js` 导出）：
  - `markExplored(explored: Uint8Array, size: number, center: {row, col}, radius: number, fogOn: boolean) -> number`（本次新置 1 的格数；迷雾开时标 `[row−r, row+r] × [col−r, col+r]` 夹到迷宫内；迷雾关时全部）。
  - `pushFootprint(trail: number[], index: number) -> number[]`（原地；与末尾相同不变；已存在则移到末尾；否则追加）。
  - `FOOTPRINT_ALPHA = [0.35, 0.9]`；`footprintAlpha(i: number, n: number) -> number`（`n <= 1` 返回 0.9；否则 `0.35 + 0.55 × i / (n − 1)`）。
  - `MINI_COLORS = { floor: '#f2efe6', seen: '#d9d3c4', fog: '#5b6270', end: '#e53935', wall: '#7e57c2', foot: '#8d6e63', star: '#ffb300', starEdge: '#8d5a00' }`。
  - `formatTime(ms: number) -> string`（`'mm:ss.t'`，向下取整到 0.1 秒，夹到 `'99:59.9'`，负数按 0）。
  - `parseBest(str: string | null) -> number | null`（`/^[1-9]\d*$/` 才返回 `Number(str)`）。
  - `updateBest(prevStr, timeMs: number, eligible: boolean) -> { best: number | null, isNew: boolean, write: string | null }`。
  - `createGameTimer() -> { start(), tick(dt: number), stop(), reset(), started: boolean, running: boolean, elapsedMs: number }`（属性用 getter；`tick` 只在 running 时加 `dt × 1000`；`start()` 只在未开始时生效）。
  - `createStepCounter(stride = 0.5) -> { add(dist: number) -> number, reset() }`。
  - `createBumpDetector({ hold = 0.15, cooldown = 0.6, ratio = 0.5 } = {}) -> { update(pushing: boolean, moved: number, wanted: number, dt: number) -> boolean, reset() }`。

- [ ] **Step 1: 追加失败的测试**

```js
test('markExplored', () => {
  const e = new Uint8Array(100);
  assert.equal(markExplored(e, 10, { row: 0, col: 0 }, 1, true), 4);
  assert.deepEqual([e[0], e[1], e[10], e[11], e[2], e[20]], [1, 1, 1, 1, 0, 0]);
  assert.equal(markExplored(e, 10, { row: 0, col: 0 }, 1, true), 0);
  assert.equal(markExplored(e, 10, { row: 5, col: 5 }, 1, true), 9);
  assert.equal(markExplored(e, 10, { row: 0, col: 0 }, 1, false), 100 - 13);
  assert.equal(markExplored(e, 10, { row: 9, col: 9 }, 1, true), 0);
  assert.ok(e.every((v) => v === 1));
});

test('pushFootprint', () => {
  const t = [0];
  pushFootprint(t, 0); assert.deepEqual(t, [0]);
  pushFootprint(t, 1); pushFootprint(t, 2); assert.deepEqual(t, [0, 1, 2]);
  pushFootprint(t, 1); assert.deepEqual(t, [0, 2, 1]);
  const big = [];
  for (let k = 0; k < 1000; k++) pushFootprint(big, k % 100);
  assert.equal(big.length, 100);
});

test('footprintAlpha', () => {
  assert.equal(footprintAlpha(0, 1), 0.9);
  assert.equal(footprintAlpha(0, 5), 0.35);
  assert.equal(footprintAlpha(4, 5), 0.9);
  for (let i = 1; i < 5; i++) assert.ok(footprintAlpha(i, 5) > footprintAlpha(i - 1, 5));
});

test('formatTime', () => {
  assert.equal(formatTime(0), '00:00.0');
  assert.equal(formatTime(1234), '00:01.2');
  assert.equal(formatTime(59999), '00:59.9');
  assert.equal(formatTime(61050), '01:01.0');
  assert.equal(formatTime(99 * 60000 + 59999), '99:59.9');
  assert.equal(formatTime(1e9), '99:59.9');
});

test('parseBest / updateBest', () => {
  for (const s of [null, 'abc', '-5', '0', 'NaN', '1.5', '']) assert.equal(parseBest(s), null, String(s));
  assert.equal(parseBest('1235'), 1235);
  assert.deepEqual(updateBest(null, 5000, true), { best: 5000, isNew: true, write: '5000' });
  assert.deepEqual(updateBest('6000', 5000, true), { best: 5000, isNew: true, write: '5000' });
  assert.deepEqual(updateBest('5000', 5000, true), { best: 5000, isNew: false, write: null });
  assert.deepEqual(updateBest('4000', 5000, true), { best: 4000, isNew: false, write: null });
  assert.deepEqual(updateBest('abc', 5000, true), { best: 5000, isNew: true, write: '5000' });
  assert.deepEqual(updateBest('9999999', 5000, false), { best: 9999999, isNew: false, write: null });
  assert.deepEqual(updateBest(null, 5000, false), { best: null, isNew: false, write: null });
  assert.equal(updateBest(null, 1234.6, true).write, '1235');
  assert.deepEqual(updateBest('1235', 1234.6, true), { best: 1235, isNew: false, write: null });
});

test('createGameTimer', () => {
  const t = createGameTimer();
  t.tick(0.5); assert.equal(t.elapsedMs, 0); assert.equal(t.started, false);
  t.start(); t.tick(0.5); assert.equal(t.elapsedMs, 500); assert.equal(t.running, true);
  t.stop(); t.tick(0.5); assert.equal(t.elapsedMs, 500); assert.equal(t.running, false); assert.equal(t.started, true);
  t.reset(); assert.equal(t.elapsedMs, 0); assert.equal(t.started, false); assert.equal(t.running, false);
});

test('createStepCounter', () => {
  const c = createStepCounter();
  let n = 0;
  for (let i = 0; i < 20; i++) n += c.add(0.1);
  assert.equal(n, 4);
  const d = createStepCounter();
  assert.equal(d.add(1.2), 2);
  assert.equal(d.add(0.3), 1); // 余量 0.2 + 0.3
  d.add(0.4); d.reset();
  assert.equal(d.add(0.2), 0);
});

test('createBumpDetector', () => {
  const dt = 1 / 60;
  const wanted = MAX_SPEED * dt;
  const b = createBumpDetector();
  const hits = [];
  for (let f = 1; f <= 9 + 180; f++) if (b.update(true, 0, wanted, dt)) hits.push(f);
  assert.deepEqual(hits, [9]); // 0.15 s = 第 9 帧；之后 3 秒不再触发

  // 松开 1 帧再推：冷却 0.6 s 内不触发；满 0.6 s 且又持续 0.15 s 后触发
  const c = createBumpDetector();
  let f = 0, first = -1, second = -1;
  while (first < 0) { f++; if (c.update(true, 0, wanted, dt)) first = f; }
  f++; c.update(false, 0, 0, dt);
  while (second < 0 && f < first + 120) { f++; if (c.update(true, 0, wanted, dt)) second = f; }
  assert.ok((second - first) * dt >= 0.6 - 1e-9, `${second - first}`);
  assert.ok((second - first) * dt <= 0.6 + 0.15 + 2 * dt);

  // 从静止起步（开阔地）：全程不触发
  const s = createBumpDetector();
  let v = 0;
  for (let i = 0; i < 60; i++) {
    v = Math.min(MAX_SPEED, v + ACCEL * dt);
    assert.equal(s.update(true, v * dt, wanted, dt), false, `frame ${i}`);
  }

  // 斜 45° 贴墙滑行
  const g = createBumpDetector();
  for (let i = 0; i < 180; i++) assert.equal(g.update(true, wanted * Math.SQRT1_2, wanted, dt), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/maze-3d-gameplay.test.mjs`
Expected: FAIL，新导出不存在。

- [ ] **Step 3: 实现上面 Interfaces 列出的导出**

`updateBest`：先 `t = Math.round(timeMs)`；`eligible` 假 → `{ best: parseBest(prev), isNew: false, write: null }`；`prev = parseBest(prevStr)` 为 null 或 `t < prev` → `{ best: t, isNew: true, write: String(t) }`；否则 `{ best: prev, isNew: false, write: null }`。

`createBumpDetector` 状态：`held`（卡住累计秒）、`armed`（初值 true）、`since`（距上次触发秒，初值 `Infinity`）。每次 `update`：`since += dt`；`stuck = pushing && moved < ratio × wanted`；未武装时：`!pushing || moved >= ratio × wanted` 才重新武装，并 `held = 0`；`stuck` 时 `held += dt`，否则 `held = 0`；`armed && held + 1e-9 >= hold && since + 1e-9 >= cooldown` 时触发：`armed = false`、`since = 0`、`held = 0`、返回 true。`reset()` 恢复初值。

`createStepCounter.add`：`acc += dist; n = Math.floor(acc / stride + 1e-9); acc -= n × stride; return n`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add maze-3d/gameplay.js tests/maze-3d-gameplay.test.mjs
git commit -m "feat(maze-3d): 已探索、脚印、计时、成绩、脚步与撞墙纯逻辑"
```

---

### Task 4: 音效模块 `sound.js`

**Files:**
- Create: `maze-3d/sound.js`
- Create: `tests/maze-3d-sound.test.mjs`
- Modify: `tests/maze-3d-page.test.mjs`（`OWN` 加 `'sound.js'`）

**Interfaces:**
- Produces：
  - `TONES`：常量表 `{ step: [...], bump: [...], star: [...], win: [...] }`，每项是音符数组 `{ type, freq, freqEnd?, at, dur, peak }`（`at` 为相对开始的秒）。`step` 的两个变体由 `variant` 选 330 / 392Hz；`win` 有 4 个音符，前三个 `dur = 0.18`，最后一个 `dur = 0.5`。
  - `createSfx({ win = globalThis, enabled = true, log = null } = {})` 返回：
    - `unlock()`：`enabled` 为假或 `state !== 'none'`（已创建或 `'unsupported'`）时，只在已创建且 `suspended` 时 `resume()`；否则取 `win.AudioContext || win.webkitAudioContext`，没有或构造抛异常 → `'unsupported'`；成功后建主增益（`gain.value = 1`）接 `destination`，`suspended` 时 `ctx.resume().catch(() => {})`，并立即排程一个增益为 0、10ms 的振荡器作预热（把首次建节点的开销放在手势这一刻，避免走路途中卡帧；不调用 `log`）。
    - `setEnabled(on)`：关时主增益 `cancelScheduledValues(0)` 后置 0；开时置 1。`get enabled`。
    - `play(name, variant = 0)`：`!enabled` 直接返回；先 `log?.(name, variant)`；有 `ctx` 且 `ctx.state === 'running'` 时按 `TONES[name]` 每个音符建 `OscillatorNode` + `GainNode` → 主增益，`onended` 里两个节点 `disconnect()`。
    - `vibrate(pattern)`：`enabled` 且 `typeof win.navigator?.vibrate === 'function'` 时 `try { win.navigator.vibrate(pattern) } catch {}`。
    - `suspend()` / `resume()`：有 `ctx` 时调用对应方法并 `.catch(() => {})`。
    - `get state`：`'none' | 'unsupported' | ctx.state`。
  - 只使用这些 AudioParam 方法：`setValueAtTime`、`exponentialRampToValueAtTime`、`cancelScheduledValues`（测试的假对象只实现这些）。

- [ ] **Step 1: 写失败的测试 `tests/maze-3d-sound.test.mjs`**

假对象 `fakeWin({ ctx = true, vibrate = 'record' })` 返回 `win`，另带 `created()`（累计 `createOscillator` 调用次数）和 `vibrations`（`navigator.vibrate` 收到的参数数组）：`AudioContext` 类记录 `oscillators` 计数，`state = 'running'`，有 `currentTime = 0`、`destination`、`createOscillator()`（返回带 `type`、`frequency`（AudioParam 假对象）、`connect`、`disconnect`、`start`、`stop`、`onended` 的对象）、`createGain()`、`resume()` / `suspend()` 返回 `Promise.resolve()`；`navigator.vibrate` 记录参数，或 `vibrate: 'throw'` 时抛异常，或 `vibrate: null` 时不存在。

```js
test('no Web Audio: nothing throws, state unsupported', () => {
  const sfx = createSfx({ win: fakeWin({ ctx: false, vibrate: null }) });
  sfx.unlock();
  for (const n of ['step', 'bump', 'star', 'win']) sfx.play(n);
  sfx.vibrate(25);
  assert.equal(sfx.state, 'unsupported');
});

test('before unlock: logs but no oscillators; after unlock win makes 4', () => {
  const w = fakeWin();
  const logs = [];
  const sfx = createSfx({ win: w, log: (n, v) => logs.push([n, v]) });
  assert.equal(sfx.state, 'none');
  sfx.play('step', 1);
  assert.deepEqual(logs, [['step', 1]]);
  assert.equal(w.created(), 0);
  sfx.unlock();
  assert.equal(sfx.state, 'running');
  const before = w.created();
  sfx.play('win');
  assert.equal(w.created() - before, 4);
});

test('disabled: no log, no oscillators, no vibrate', () => {
  const w = fakeWin();
  const logs = [];
  const sfx = createSfx({ win: w, log: (n) => logs.push(n) });
  sfx.unlock();
  sfx.setEnabled(false);
  const before = w.created();
  sfx.play('bump'); sfx.vibrate(25);
  assert.deepEqual(logs, []);
  assert.equal(w.created(), before);
  assert.deepEqual(w.vibrations, []);
  assert.equal(sfx.enabled, false);
});

test('disabled at creation: unlock does not create a context', () => {
  const sfx = createSfx({ win: fakeWin(), enabled: false });
  sfx.unlock();
  assert.equal(sfx.state, 'none');
});

test('vibrate that throws does not throw', () => {
  const sfx = createSfx({ win: fakeWin({ vibrate: 'throw' }) });
  assert.doesNotThrow(() => sfx.vibrate([80, 60, 80, 60, 200]));
});

test('TONES match the spec table', () => {
  assert.equal(TONES.win.length, 4);
  assert.deepEqual(TONES.win.map((n) => n.freq), [523, 659, 784, 1047]);
  assert.deepEqual(TONES.star.map((n) => n.freq), [988, 1319]);
  assert.equal(TONES.bump[0].freq, 140); assert.equal(TONES.bump[0].freqEnd, 60);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/maze-3d-sound.test.mjs`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `maze-3d/sound.js`**；`OWN` 加 `'sound.js'`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add maze-3d/sound.js tests/maze-3d-sound.test.mjs tests/maze-3d-page.test.mjs
git commit -m "feat(maze-3d): Web Audio 合成音效模块"
```

---

### Task 5: 小地图——已探索格子、脚印、两种视角都显示

**Files:**
- Modify: `maze-3d/main.js`（状态、`buildMaze`、`recomputeFog`、`updatePlayer`、`setView`、`drawMinimapBase`、`drawMinimap`、帧循环、预热、`debugApi`）
- Modify: `maze-3d/index.html`（`#minimap` 去掉 `hidden`；`@media (max-width: 480px)` 里 `#minimap { width: 110px; height: 110px; }`）
- Modify: `tests/browser/maze3d_accept.py`（`canvas_image`、`check_3`、`check_8`，新增 `minimap_image`、`check_b1`、`check_b2`、`check_b3`；`SHOTS` 默认值改为本次截图目录）

**Interfaces:**
- Consumes: `markExplored`、`pushFootprint`、`footprintAlpha`、`MINI_COLORS`（Task 3）。
- Produces（`window.__maze3d` 新字段，后续任务的检查依赖）：
  - `minimapVisible: boolean`；`minimapLayout: { px, pad, cell, dpr }`（即 `miniLayout()`）。
  - `explored: number`（已探索格数）；`exploredAt(row, col) -> boolean`；`footprints: Array<[row, col]>`（副本，最旧在前）。
- Produces（`main.js` 内部，Task 7 使用）：`drawMinimapBase` 在脚印之上画星星标记的位置（留一个 `drawStarMarkers(ctx, lay)` 调用点，Task 5 里为空函数）；`drawMinimap(force = false)`。
- Produces（Python）：`minimap_image(page) -> PIL.Image`（解码 `toDataURL()`）；`mini_px(lay, row, col, fx=0.5, fz=0.5) -> (x, y)`（`pad + (col + fx) × cell`，`pad + (row + fz) × cell`）。

- [ ] **Step 1: 更新旧检查并写新检查（先失败）**

- `canvas_image()`：截图前 `page.evaluate` 把存在的 `#minimap`、`#hud` 的 `style.visibility` 设为 `'hidden'`，`try/finally` 里恢复为 `''`（元素不存在时跳过，基线页面没有 `#hud`）。
- `check_3`：跟随视角断言由 `not mini` 改为 `mini`；docstring 同步。其余断言不变。
- `check_8`：竖屏 375×667 在点 `#view-btn` 之前（跟随视角）断言 `#hud`、`#minimap` 都 `inside(…, stage)`，`#sound-btn` 不与舞台相交，`#minimap` 的 `bounding_box()["width"]` 在 110 ± 0.5；`#hud`、`#sound-btn` 在 Task 6 / Task 8 才加，本任务里元素不存在时这两项记为 `n/a` 并跳过，Task 8 Step 1 把跳过改成必须存在。横屏 667×375 之后 `wait_frames(page, 3)`，断言 `minimapLayout.px == round(140 × dpr)` 且 `#minimap` 画布 `width` 属性等于 `px`（Review Focus 5）。
- `check_b1`（design b1）：`preset_storage("1", "1")`；开局 `explored == 4`；`walk_to(page, 0, 3)` 后 `explored > 4`，并对路线上每个格（`findPath((0,0),(0,3))`）视野正方形内的格子 `exploredAt` 都为真；小地图像素：对每个格取 `mini_px(lay, r, c, 0.25, 0.25)`，跳过与当前格 Chebyshev ≤ 1 的格（小人圆点和朝向三角），跳过终点格；已探索格与 `MINI_COLORS.floor` 或 `.seen` 的距离（取较小者）≤ 20，未探索格与 `.fog` 的距离 ≤ 20；点 `#fog-btn` 后 `explored == 100`，再点一次仍为 100。
- `check_b2`（design b2）：`preset_storage("1", "5")`；`route = findPath((0,0), end)[:6]`；`walk_to(route[5])`；`footprints == route`；对 `route[:-1]` 每个格心像素，期望色 = `alpha × foot + (1 − alpha) × 底色`（`alpha = footprintAlpha(i, n)` 用 Python 复算同公式，底色按该格当前在视野内取 `.floor` 否则 `.seen`），跳过格心与小人中心像素距离 < `2.2 × max(2.5 × dpr, 0.28 × cell) + 2` 的格，距离 ≤ 30；`walk_to(route[4])` 后 `footprints[-1] == route[4]` 且长度仍为 6；`teleportForTest(5, 5)` 后 `footprints` 不变；点 `#regen-btn`（与「再来一局」同走 `regenerate()` → `buildMaze()`；`#again-btn` 只在通关层可见）后 `footprints == [[0, 0]]`。
- `check_b3`（design b3）：开局 `minimapVisible` 为真；点 `#view-btn` 后仍为真，再点回来。`hint_page(…, "0", "5")`，`back_to_end_state(page)` 后 `endHint.mode == 'edge'`，用 `check_p5m` 同样的 JS 判断箭头矩形与小地图矩形不相交；`set_test_input(page)` 后 `wait_camera_still`，连续 30 帧（`wait_frames(page, 1)` × 30）读 `minimap_data(page)`，全部相同。

全部登记进 `CHECKS`：`"b1": check_b1, "b2": check_b2, "b3": check_b3`。`SHOTS` 默认值改为 `SHOTS` 路径（见 Global Constraints）。

- [ ] **Step 2: 跑检查确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 3,b1,b2,b3`
Expected: `3` FAIL（跟随视角小地图隐藏），`b1`–`b3` FAIL（字段不存在）。

- [ ] **Step 3: 实现 `main.js` 与 `index.html` 改动**

- 状态：`let explored = new Uint8Array(0)`、`const footTrail = []`（数组复用，`buildMaze` 里 `length = 0`）。
- `buildMaze()`：在 `recomputeFog()` 之前 `explored = new Uint8Array(size * size)`（尺寸变化时才新建，否则 `fill(0)`），`footTrail.length = 0; pushFootprint(footTrail, 0)`。
- `recomputeFog()`：第一行（计数之后）`markExplored(explored, size, display, fogRadius, fogOn)`，然后原逻辑，`miniBaseDirty = true; drawMinimap()`。
- `updatePlayer()` 换格分支：`pushFootprint(footTrail, c.row * size + c.col)` 在 `recomputeFog()` 之前。`teleportForTest` 不改（不记脚印）。
- `setView()`：删除 `$('minimap').hidden = !first` 和末尾 `if (first) drawMinimap()`。
- `drawMinimapBase(lay)`：三条 `Path2D`（视野内、已探索视野外、未探索）逐格 `rect()`，每种颜色一次 `fill()`；迷雾关时全部归「视野内」；终点格最后单独填 `MINI_COLORS.end`。墙：`!fogOn || seg.cells.some(([r, c]) => explored[r * size + c])` 才画。脚印：`footTrail` 每格中心画圆点，半径 `max(1.5 × dpr, 0.12 × cell)`，`globalAlpha = footprintAlpha(i, n)`，画完恢复 `globalAlpha = 1`。最后调用 `drawStarMarkers(ctx, lay)`（本任务为空）。
- `drawMinimap(force = false)`：`minimap.hidden || !connections` 返回；记录 `miniLast = { x, z, yaw, px }`（`start()` 里建一次，初值 `NaN`）；`!force && !miniBaseDirty && px === miniLast.px && |Δx|、|Δz|、|Δyaw| ≤ 1e-4` 时返回；否则照旧绘制并更新 `miniLast`。
- 帧循环：`if (view === 'first') drawMinimap()` 改为 `if (!minimap.hidden) drawMinimap()`。
- 预热：`warmFrame()` 每帧在 `render` 前调用 `drawMinimap(true)`（让小地图画布逐帧更新的首次开销落在预热里）。
- `debugApi` 加 Interfaces 里的字段。
- `updateEndHint()` 不改（已按 `minimap.hidden` 避让）；注释「第一人称时右上角有小地图」改为「小地图可见时」。

- [ ] **Step 4: 跑检查确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 3,8,b1,b2,b3,p5m,p4b,p5,f1,t9,p8 --baseline-root "$B"`
Expected: 全部 PASS（`check_8` 中 `#hud` / `#sound-btn` 记为 `n/a`）。`f1` 的 `maxStep < 0.1`。

- [ ] **Step 5: black 并提交**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/main.js maze-3d/index.html tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 小地图已探索格子与脚印，两种视角都显示"
```

---

### Task 6: 信息栏、计时、最佳成绩与通关层

**Files:**
- Modify: `maze-3d/index.html`（`#hud` 含 `#timer`；`.win-box` 内 `#win-time`、`#win-best`、`#win-record`、`#win-path-note`；样式）
- Modify: `maze-3d/main.js`
- Modify: `tests/maze-3d-page.test.mjs`（needles 加 `id="hud"`、`id="timer"`、`id="win-time"`、`id="win-best"`、`id="win-record"`、`id="win-path-note"`；`#hud` 规则含 `pointer-events: none`）
- Modify: `tests/browser/maze3d_accept.py`（新增 `gameplay(page, expr, arg)`、`check_b4`、`check_b5`）

**Interfaces:**
- Consumes: `formatTime`、`parseBest`、`updateBest`、`createGameTimer`（Task 3）。
- Produces（`window.__maze3d`）：`timer: { started, running, elapsedMs, text }`（`text = formatTime(elapsedMs)`）；`lastResult: { timeMs, bestMs, isNew, eligible, stars, total } | null`（Task 7 填 `stars`、`total` 之前先填 `0`、`0`）。
- Produces（`main.js` 内部，Task 7 / 8 使用）：`function onWin()`（判胜时的全部动作集中在这里）；`function updateHud()`（帧循环调用，只在文字变化时写 DOM）；`let pathUsedThisRun`。
- Produces（Python）：`gameplay(page, expr, arg=None)`：同 `logic()`，但在页面里 `import('/maze-3d/gameplay.js')` 为 `G`（可用 `G`、`L`、`M`、`arg`）。`best_init(value)`：返回只在键缺失时写 `maze3d.best.10` 的 init script（`if (localStorage.getItem(k) === null) localStorage.setItem(k, v)`，包在 `try` 里）。

- [ ] **Step 1: 写新检查（先失败）**

- `check_b4`（design b4，按原文全部断言）。另加 Review Focus 4：开始计时后，`page.evaluate` 执行 `Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))`，读 `elapsedMs` → 等 1000ms → 再读，两次相等；再 `defineProperty(…, 'visible')` 并派发，等 500ms，`elapsedMs` 增加且增量 ≤ 900ms（回来后 `dt` 不含后台时长）。这一段在 `set_test_input(page)` 不按键时做，计时仍在走（计时只看是否开始，不看是否移动）。
- `check_8`：`#hud` 不存在时改为 FAIL（Task 5 里的 `n/a` 跳过只保留给 `#sound-btn`）。
- `check_b5`（design b5，八个子场景各开一个新上下文，按原文断言；「同一上下文刷新」用 `page.reload()` + `wait_idle`）。走到终点一律 `walk_to_exit(page)`。点「显示道路」前进 0.5 秒用 `face_open` + `set_test_input(forward=1)` + `wait_for_timeout(500)`。另加 Review Focus 1：`init_script=BLOCK_STORAGE`，走到终点：`state == 'won'`、`lastResult.isNew` 为真、`#win-record` 可见、无页面错误。

登记 `"b4"`、`"b5"`。

- [ ] **Step 2: 跑检查确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only b4,b5` 与 `node --test tests/maze-3d-page.test.mjs`
Expected: 都 FAIL。

- [ ] **Step 3: 实现**

`index.html`：
- `#stage` 内、`#minimap` 之后加 `<div id="hud"><span id="timer">⏱ 00:00.0</span></div>`。样式：`position: absolute; top: 8px; left: 8px; z-index: 2; pointer-events: none; display: flex; gap: 10px; padding: 4px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.85); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); font-size: 14px; font-weight: bold; font-variant-numeric: tabular-nums;`。
- `.win-box` 里 `#win-text` 之后、`#again-btn` 之前：`<p id="win-time"></p><p id="win-best" hidden></p><p id="win-record" hidden>新纪录!</p><p id="win-path-note" hidden>这局看了道路，不计入最佳成绩</p>`。`#win-record` 金色徽标：`display: inline-block; background: #ffd600; color: #6d4c00; font-weight: bold; border-radius: 999px; padding: 2px 12px;`；四者 `margin: 0 0 8px`；`[hidden] { display: none; }`。

`main.js`：
- `start()` 里 `const timer = createGameTimer()`、`let pathUsedThisRun = false`、`let lastResult = null`、`let hudTimerText = ''`。
- `buildMaze()`：`timer.reset(); pathUsedThisRun = false; updateHud()`。
- `updatePlayer()`：`stepPlayer` 前记 `px0 = playerState.x, pz0 = playerState.z`；之后 `moved = Math.hypot(x − px0, z − pz0)`；`state === 'idle' && !timer.started && moved > 1e-6` 时 `timer.start(); pathUsedThisRun ||= showPath`。判胜分支里原来的四行动作移到 `onWin()`。
- `onWin()`：`state = 'won'`；速度清零；`timer.stop()`；`timeMs = Math.round(timer.elapsedMs)`；`eligible = !pathUsedThisRun`；`key = 'maze3d.best.' + size`；`r = updateBest(storageGet(key), timeMs, eligible)`；`r.write` 时 `storageSet(key, r.write)`；`lastResult = { timeMs, bestMs: r.best, isNew: r.isNew, eligible, stars: 0, total: 0 }`；填通关层（`#win-time` = `用时 ${formatTime(timeMs)}`；`#win-best` 在 `r.best !== null` 时显示 `最佳 ${formatTime(r.best)}`；`#win-record.hidden = !r.isNew`；`#win-path-note.hidden = eligible`）；`$('win').hidden = false`；`startConfetti()`。
- 「显示道路」点击：`if (timer.started) pathUsedThisRun = true`。「隐藏道路」不动它。
- 帧循环：`updatePlayer(dt)` 之后 `timer.tick(dt); updateHud()`。`updateHud()`：`t = '⏱ ' + formatTime(timer.elapsedMs)`，与 `hudTimerText` 不同才写 `textContent`。
- 预热：`setWarmHint(on)` 同时处理 HUD——`on` 时把 `#timer` 写成 `'⏱ 01:23.4'`（让 0–9 以外的数字字形也先光栅化），`off` 时 `hudTimerText = ''` 并 `updateHud()` 写回真实值。
- `debugApi` 加 `timer`、`lastResult`（返回副本）。

- [ ] **Step 4: 跑检查确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only b4,b5,8,4b,p6,f1,t3 --baseline-root "$B"`
Expected: 全部 PASS；`check_8` 里 `#hud` 不再是 `n/a` 而是 `inside=True`。

- [ ] **Step 5: black 并提交**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/main.js maze-3d/index.html tests/maze-3d-page.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 信息栏计时、最佳成绩与通关层"
```

---

### Task 7: 可收集的星星

**Files:**
- Modify: `maze-3d/main.js`
- Modify: `maze-3d/index.html`（`#hud` 加 `<span id="star-count">⭐ 0/3</span>`；`.win-box` 加 `<p id="win-stars"></p>`）
- Modify: `tests/maze-3d-page.test.mjs`（needles 加 `id="star-count"`、`id="win-stars"`）
- Modify: `tests/browser/maze3d_accept.py`（`check_b10`–`check_b13`）

**Interfaces:**
- Consumes: `placeStars`、`starCountFor`、`starHit`、`STAR_COLORS`、`STAR_SHAPE`、`STAR_FLOAT`、`MINI_COLORS`（Task 2 / 3）；`onWin()`、`updateHud()`、`drawStarMarkers(ctx, lay)` 调用点（Task 5 / 6）。
- Produces（`window.__maze3d`）：`stars: Array<{ row, col, collected, visible }>`；`starsCollected`；`starTotal`；`starMeshesVisible`（星星 `Group` 中 `visible` 为真的网格数，Review Focus 3）；`floorPointCss(x, z) -> {x, y} | null`（地板上一点 `(x, 0.001, z)` 在画面内且没被墙 / 终点星星 / 收集星星 / 小人 / 光柱挡住时返回相对 canvas 的 CSS 像素，`floorSamplePoints` 改为调用它）。`?debug=1` 时 `setStarsForTest({ paused })`。
- Produces（`main.js` 内部，Task 8 使用）：`collectStar(i)`（收集时的全部动作；Task 8 在里面加 `sfx.play('star')`）。

- [ ] **Step 1: 写新检查（先失败）**

- `check_b10`（design b10）：三个尺寸依次点 `#size-10/15/20`，`starTotal`、`#star-count` 文字（`⭐ 0/3` 等）；`page.reload()` 后 `stars` 的格子列表相同；与 `gameplay(page, "G.placeStars(M.connections, M.seed, G.starCountFor(M.size))")` 相同。另加 Review Focus 3：`preset_storage("0", "5")` 下从 20 切回 10 后 `starMeshesVisible == 3`。
- `check_b11`（design b11）：目标星星 = `stars` 中第一颗「`findPath((0,0), 它)` 不经过其他星星格」的星星；`walk_to` 它；断言计数、`collected`、`visible`；`walk_to(path[-2])` → `walk_to(星星格)` → `walk_to(path[-2])`，计数仍为 1；取星星格心小地图像素，与 `#ffb300` 距离 > 60；终点：`p = findPath(当前格, 终点)`，`teleportForTest(*p[-2])`（终点相邻格不会有星星），`walk_to_exit`，`#win-stars` 含 `1 / 3`；`#again-btn` 后 `starsCollected == 0`。
- `check_b12`（design b12）：`preset_storage("1", "1")`；取 `stars[0]`；断言视野外 `visible` 为假、小地图格心与 `.fog` 距离 ≤ 20；`teleportForTest` 到它的一个界内相邻格（Chebyshev 1）：`visible` 为真、格心像素与 `#ffb300` 距离 ≤ 40；`teleportForTest(0, 0)`：`visible` 为假、格心像素与 `#ffb300` 距离 ≤ 40。
- `check_b13`（design b13）：四个主题，`init_script = theme_init(tid) + preset_storage("0", "5")`，1280×800。`setStarsForTest({paused: true})`；星星 = `stars[0]`；相邻格 n 取第一个 `canMove(star, n)` 为真的方向；`teleportForTest(n)`，`face_yaw(atan2(dx, −dz))` 朝向星星；`wait_camera_still` + `wait_frames`；`cam = cameraState`；`project_css(cam, (col+0.5, 0.35, row+0.5), cw, ch)`；`img = canvas_image(page)`，3×3 平均色（按 `img.width / cw` 换算设备像素）。地板对照：8 个方向、距星星中心 0.6 的地板点 `floorPointCss(x, z)`，只取非 null 且该点所在格 `floorKindAt == 'floor'` 的点，至少 1 个，每点颜色与星星色距离 ≥ 60。点「显示道路」后：若星星格 `floorKindAt == 'path'`，对照点取 0.6 圈上所在格为 `'path'` 的点；否则取离星星最近的 `'path'` 格的 `floorSamplePoints`；至少 1 个，距离都 ≥ 60。每个主题 details 打印最小距离。

登记 `"b10"`–`"b13"`。

- [ ] **Step 2: 跑检查确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only b10,b11,b12,b13`
Expected: FAIL。

- [ ] **Step 3: 实现**

- 造形：把 `buildStar()` 里的五角星 `Shape` 抽成 `starShape(outer, inner)`；终点星星用 `starShape(0.25, 0.1)`，外观不变。收集星星：`new THREE.ExtrudeGeometry(starShape(STAR_SHAPE.outer, STAR_SHAPE.inner), { depth: STAR_SHAPE.depth, bevelEnabled: false })` + `center()`，一份几何；材质数组 `[face, side]`（ExtrudeGeometry 组 0 为正反面、组 1 为侧面）：`face = MeshLambertMaterial({ color: STAR_COLORS.face, emissive: STAR_COLORS.emissive })`，`side = MeshLambertMaterial({ color: STAR_COLORS.side })`。启动时建 7 个 `Mesh` 放进 `starGroup`，`scene.add(starGroup)`。
- 状态：`const stars = []`（元素 `{ row, col, collected }`，`buildMaze` 里 `length = 0` 后重填）；`let starTime = 0`、`let starsPaused = false`。
- `buildMaze()`：`placeStars(connections, seed, starCountFor(size))` 填 `stars`；第 i 个网格放到 `(col + 0.5, STAR_FLOAT.base, row + 0.5)`；`recomputeFog()` 前完成。
- `applyStarVisibility()`：网格 i `visible = i < stars.length && !stars[i].collected && cellVisible(row, col)`；在 `recomputeFog()` 里 `markExplored` 之后调用。
- `drawStarMarkers(ctx, lay)`：未收集且 `explored` 的星星画圆，半径 `max(2 × dpr, 0.22 × cell)`，填 `MINI_COLORS.star`，描边 `MINI_COLORS.starEdge`、线宽 `max(1, dpr)`。
- `updatePlayer()`：`state === 'idle'` 时、换格判断之前，逐颗未收集星星 `starHit(x, z, s)` → `collectStar(i)`。`collectStar(i)`：`collected = true`、网格隐藏、`miniBaseDirty = true`、`updateHud()`。
- `updateHud()`：加 `⭐ ${k}/${N}`，文字变化才写。
- `onWin()`：`lastResult.stars = k`、`total = N`；`#win-stars` 文字：`k === N` → `⭐ 全部 ${N} 颗星星都收集到了！`，否则 `⭐ 收集了 ${k} / ${N} 颗星星`。
- 帧循环 `updateCamera(dt)` 之后 `updateStars(dt)`：未暂停时 `starTime += dt`，网格 i：`rotation.y = STAR_FLOAT.spin × starTime + 0.9 × i`，`position.y = base + amp × sin(2π × starTime / period + 1.3 × i)`；暂停时 `position.y = base`，`rotation.y = Math.atan2(camera.position.x − mesh.position.x, camera.position.z − mesh.position.z)`（正面 +z 朝相机）。
- 预渲染：`buildMaze()` 之后、首帧 `renderer.render` 之前，7 个网格全部临时 `visible = true`，render 完调用 `applyStarVisibility()` 恢复。
- `floorSamplePoints` 与 `screenHitsScene` 的遮挡物列表加 `starGroup`；抽出 `floorPointCss(x, z)`。
- `debugApi` 加 Interfaces 里的字段。

星星正面色已在 Task 2 单测验算（与道路 73.4、与 `floorBase` ≥ 204.7）。若 `b13` 在某主题屏幕距离 < 60，按 systematic-debugging 查明原因后调整 `STAR_COLORS`（`face` / `emissive`），同时保证 Task 2 的颜色单测仍 ≥ 60，不降阈值。

- [ ] **Step 4: 跑检查确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only b10,b11,b12,b13,b2,b5,t5,t1,4,5,f1,p4a --baseline-root "$B"`
Expected: 全部 PASS；`b13` 每个主题最小距离 ≥ 60。

- [ ] **Step 5: black 并提交**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/main.js maze-3d/index.html tests/maze-3d-page.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 可收集的星星"
```

---

### Task 8: 音效、震动与静音开关接线

**Files:**
- Modify: `maze-3d/index.html`（`#view-row` 里 `#fullscreen-btn` 前加 `<button id="sound-btn">声音：开</button>`）
- Modify: `maze-3d/main.js`
- Modify: `tests/maze-3d-page.test.mjs`（needles 加 `id="sound-btn"`）
- Modify: `tests/browser/maze3d_accept.py`（`check_b6`–`check_b9`；`check_8` 的 `#sound-btn` 改为必须存在）

**Interfaces:**
- Consumes: `createSfx`（Task 4）；`createStepCounter`、`createBumpDetector`（Task 3）；`collectStar(i)`、`onWin()`（Task 6 / 7）；`movement.js` 的 `MAX_SPEED`。
- Produces（`window.__maze3d`）：`soundOn`；`audioState`（`sfx.state`）；`?debug=1` 时 `sfxLog`（最近 100 条 `{ name, variant, t }` 的副本）、`clearSfxLog()`。
- Produces（Python）：`VIBRATE_RECORD`（init script：`Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value: function (p) { (window.__vib = window.__vib || []).push(p); return true; } })`）；`NO_AUDIO`（init script：`delete window.AudioContext; delete window.webkitAudioContext; delete Navigator.prototype.vibrate;`）；`sfx_names(page) -> list[str]`；`straight_cell(page, n)`（BFS 找第一个「某方向连续 n 格可走」的格与方向，返回 `(cell, dir)`）。

- [ ] **Step 1: 写新检查（先失败）**

- `check_b6`（design b6）：按原文。走直线：`(cell, d) = straight_cell(page, 2)`，`walk_to(cell)`，`face_yaw(DIR_YAW[d])`，`clearSfxLog()`，`walk_to` 该方向第 2 格；`step` 条数 3–5、`variant` 交替。撞墙：`find_wall_cell` → `face_yaw(DIR_YAW[dir])` → `clearSfxLog()` → `set_test_input(forward=1)` 2 秒 → `bump` 恰好 1 条；`set_test_input(page)` 0.7 秒 → `forward=1` 1 秒 → `bump` 共 2 条；时间戳在第一条 `bump` 之后的 `step` 条目数为 0（贴墙前那 0.17 格的移动可能补出一条脚步，不算顶墙期间）。星星：走到 Task 7 `check_b11` 同样选出的星星，`star` 1 条。终点：`walk_to_exit`，`win` 1 条。另加 Review Focus 2：通关后 `clearSfxLog()`，`set_test_input(forward=1)` 1 秒，`sfxLog` 里没有 `step` / `bump`；`timer.elapsedMs` 前后相等。另加：模拟后台（同 `b4` 的 `visibilityState` 写法）后等 300ms，`audioState` 为 `'suspended'`（只在之前为 `'running'` 时断言）。
- `check_b7`（design b7）：`init_script=VIBRATE_RECORD`；按原文。
- `check_b8`（design b8）：按原文。「重复 b6 的顶墙和走路」：顶墙 2 秒 + 沿直线走 2 格，`sfxLog` 长度不变、`window.__vib` 无新增（同时用 `VIBRATE_RECORD`）。
- `check_b9`（design b9）：`init_script=NO_AUDIO`；按原文依次做：`keyboard.press('Shift')`、顶墙 2 秒、走到一颗星星、走到终点、点 `#sound-btn` 两次；`audioState == 'unsupported'`，`sfxLog` 含 `bump`、`star`、`win`，`no_errors`。

`check_8`：`#sound-btn` 不存在时改为 FAIL。登记 `"b6"`–`"b9"`。

- [ ] **Step 2: 跑检查确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only b6,b7,b8,b9`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `start()` 里：`const sfxLog = []`；`const sfx = createSfx({ win: window, enabled: storageGet('maze3d.sound') !== '0', log: debug ? (name, variant) => { sfxLog.push({ name, variant, t: performance.now() }); if (sfxLog.length > 100) sfxLog.shift(); } : null })`；`const stepCounter = createStepCounter()`、`const bumpDetector = createBumpDetector()`、`let stepVariant = 0`。
- 首次手势：`const UNLOCK_EVENTS = ['keydown', 'pointerdown', 'touchend']`；`onGesture()`：`if (!sfx.enabled) return; sfx.unlock(); if (sfx.state !== 'none') 移除三个监听`；用 `{ capture: true, passive: true }` 挂在 `window`，移除时传 `{ capture: true }`。
- `#sound-btn`：`updateSoundUi()` 写 `声音：开` / `声音：关`；点击：`on = !sfx.enabled; sfx.setEnabled(on); storageSet('maze3d.sound', on ? '1' : '0'); if (on) sfx.unlock(); updateSoundUi()`。启动时调用一次 `updateSoundUi()`。
- `visibilitychange`：hidden 分支加 `sfx.suspend()`，visible 分支加 `sfx.resume()`（`sfx.resume` 在没有 ctx 时为空操作）。
- `buildMaze()`：`stepCounter.reset(); bumpDetector.reset(); stepVariant = 0`。
- `updatePlayer()`（`state !== 'won'` 分支内、计时判定之后）：
  - `n = stepCounter.add(moved)`；循环 n 次 `sfx.play('step', stepVariant); stepVariant ^= 1`。
  - `mag = Math.hypot(input.forward, input.strafe)`；`wanted = MAX_SPEED × Math.min(1, mag) × dt`；`if (bumpDetector.update(mag >= 0.5, moved, wanted, dt)) { sfx.play('bump'); sfx.vibrate(25); }`。
- `collectStar(i)` 加 `sfx.play('star')`；`onWin()` 在 `startConfetti()` 之前加 `sfx.play('win'); sfx.vibrate([80, 60, 80, 60, 200])`。
- `debugApi` 加 Interfaces 里的字段。

- [ ] **Step 4: 跑检查确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only b6,b7,b8,b9,8,f1,f4,11,6b,p6 --baseline-root "$B"`
Expected: 全部 PASS。`f1` 的 `maxStep < 0.1`：`f1` 按住 `w` 是第一次手势，会在 keydown 里创建 `AudioContext` 并排程预热振荡器；若 `f1` 失败，记录每帧 `dt` 找出卡顿帧，按 systematic-debugging 处理（例如把首次建节点的开销再提前），不放宽 `f1`。

- [ ] **Step 5: black 并提交**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/main.js maze-3d/index.html tests/maze-3d-page.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 音效、震动与静音开关"
```

---

### Task 9: 性能、截图、README 与全量验收

**Files:**
- Modify: `tests/browser/maze3d_accept.py`（`perf_round` 返回附加字段；`check_t7` 抽出 `perf_compare`；新增 `check_b14`、`check_b15`；`--write` 结果头）
- Modify: `maze-3d/README.md`
- Modify: `tests/browser/test-results.txt`（`--write` 生成）

**Interfaces:**
- Consumes: Task 5–8 的全部调试字段。
- Produces（Python）：`perf_compare(browser, base, extra=None) -> (ok | None, detail)`：`check_t7` 的主体原样搬过来，`extra(name, round)` 对每个新代码轮次返回 `(ok, msg)`。`perf_round` 结尾多读 `extras`：`page.evaluate("() => { const M = window.__maze3d; return { minimapVisible: M.minimapVisible ?? null, starTotal: M.starTotal ?? null, soundOn: M.soundOn ?? null, audioState: M.audioState ?? null }; }")`（基线页面返回 null）。

- [ ] **Step 1: 写 b14、b15 与结果头**

- `check_t7 = lambda browser, base: perf_compare(browser, base)`（改成 `def`，行为不变）。
- `check_b14`：`perf_compare(browser, base, extra=…)`，每个新代码轮次要求 `minimapVisible is True`、`starTotal == 7`、`soundOn is True`、`audioState not in (None, 'none')`（`play_continuous` 按 `w` 是用户手势）。判定规则（1.3 倍、不降画质、SwiftShader → INCONCLUSIVE）与 t7 相同。
- `check_b15`（design b15）：`SHOTS.mkdir(...)`；四个主题各开 1280×800、`init_script = theme_init(tid) + preset_storage("1", "2")`、`reduced_motion="reduce"`。选星星：`stars` 中 `findPath((0,0), 星)` 最长的一颗，路线长度 ≥ 7（不足时在 details 里写明并 FAIL）；`walk_to(path[-2])`，`setStarsForTest({paused: true})`，`face_yaw` 朝向星星，`wait_camera_still`；断言 `len(footprints) >= 6`、该星星 `visible`、`project_css` 星星中心落在 canvas 内；`page.locator("#stage").screenshot(path=SHOTS/f"gameplay-{tid}-play.png")`。garden 那一轮之后再点 `#view-btn` 存 `gameplay-first-person.png`（断言该星星未收集且 `exploredAt` 为真）。另开一页 `init_script = best_init('9999999')`、`reduced_motion="reduce"`：先收集一颗星星再 `walk_to_exit`，断言 `lastResult.isNew`，`page.screenshot(path=SHOTS/"gameplay-win.png")`。6 个文件都存在且非空才 PASS。
- `main()` 的 `--write` 结果头：`人工检查：待用户查看 {SHOTS} 下 gameplay-*-play.png（星星、脚印、未探索区、信息栏）、gameplay-first-person.png 与 gameplay-win.png（用时、最佳、新纪录、星星数）`；`基线代码` 行不变。保留 `自动检查：` 行格式（`tests/maze-3d-accept-report.test.mjs` 依赖）。

登记 `"b14"`、`"b15"`。

- [ ] **Step 2: 跑 b14、b15、t7**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only t7,b14,b15 --baseline-root "$B" --shots "$SHOTS"`
Expected: 三项 PASS（`t7` / `b14` 若因 SwiftShader 判为 INCONCLUSIVE，如实保留，不改判定）；`$SHOTS` 下 6 个 `gameplay-*.png`。用 Read 工具打开这 6 张图看一遍：星星可见、小地图有脚印和雾色区、信息栏在左上、通关层四行齐全。

- [ ] **Step 3: README**

`maze-3d/README.md` 末尾加一段：小地图在两种视角都显示，浅色是当前视野、暗一档是走过看过的地方、深灰是还没去过的地方，棕色圆点是脚印；左上角信息栏显示用时和星星数；第一次走动开始计时，每个尺寸记最佳成绩（看着道路走的那局不计入）；迷宫里藏着星星，走过去就能收集；「声音」按钮同时开关音效和安卓震动。`node --test tests/maze-3d-page.test.mjs`（README 在 `OWN` 里，不能有外部链接）。

- [ ] **Step 4: 后台跑全量验收并写结果**

用 Bash `run_in_background: true`：
```bash
SP=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad
cd "$W" && ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --write --baseline-root "$B" --shots "$SHOTS" > "$SP/maze3d-gameplay-after.log" 2>&1; echo "EXIT $?" >> "$SP/maze3d-gameplay-after.log"
```
每 60 秒轮询：`grep -cE '^(PASS|FAIL|INCONCLUSIVE) ' "$SP/maze3d-gameplay-after.log"; grep -E '^(FAIL|INCONCLUSIVE) ' "$SP/maze3d-gameplay-after.log"; grep '^EXIT' "$SP/maze3d-gameplay-after.log"`，直到出现 `EXIT` 行。
Expected: 66 行结果（原 51 + `b1`–`b15`），`EXIT 0`，`tests/browser/test-results.txt` 里 `自动检查：PASS`。若有 FAIL：先对照 Task 1 的改动前日志判断是否本来就失败；本 PR 引入的失败按 systematic-debugging 修代码后，用 `--only` 重跑该项，再重跑一次全量（同样后台 + 轮询）。`t7` / `b14` 的 INCONCLUSIVE 如实保留。

- [ ] **Step 5: 最终单元测试**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 6: black 并提交**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add tests/browser/maze3d_accept.py tests/browser/test-results.txt maze-3d/README.md
git commit -m "test(maze-3d): 玩法验收检查、截图与全量结果"
```
