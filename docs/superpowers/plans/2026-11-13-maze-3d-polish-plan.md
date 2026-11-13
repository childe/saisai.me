# 3D 迷宫画面打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开局镜头对准迷宫；小人脚下圆形软阴影；墙脚暗边；终点光柱、闪光粒子与通关彩带；画面边缘的终点方向提示。

**Architecture:** 所有可测的数学与数据步进放进新模块 `maze-3d/effects.js`（纯函数，node 可测），墙盒 slab 求交从 `cameraPullIn` 抽成 `movement.js` 的 `slabInterval` 供两边共用；`main.js` 只负责建网格 / DOM、每帧更新、在 `window.__maze3d` 暴露验收所需字段；跟随视角的相机观察点改为小人前方 `LOOK_AHEAD` 格的前瞻点（偏移平滑，避障与 `liftPitch` 都以前瞻点为准）；浏览器验收脚本新增 `p*` 检查，并修正受开局朝向与前瞻观察点影响的旧检查（只改前提与观察点口径，不放宽阈值）。

**Tech Stack:** 原生 ES modules、vendor three.js r187、Canvas 2D、`node --test`、Python Playwright + Pillow（`~/tmp/fuck/c/.venv/bin/python`），格式化用 `/opt/homebrew/bin/black`。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261113-141153-maze-3d-polish/docs/superpowers/specs/2026-11-13-maze-3d-polish-design.md`

## 修订记录

- **r2（2026-11-13，实现阶段 Task 1 受阻后修订）**：原 Task 1 只把开局 `yaw` 改成 `3π/4`，实测 `check_p1`（画面中心 60% 区域迷宫占比 ≥ 50%）只有 34%（基线 35%）；扫遍俯角 15°–75° 与缩放 0.7 / 1.0 / 1.5，最高 44.5%，达不到验收线。用户选定「跟随视角镜头前瞻」方案，design.md 第 1 节、方案节、测试节已更新。本次修订：
  - Task 1 改为在已有未提交的部分实现（`effects.js` 的 `startYaw` 与单测、`main.js` 的 `resetPlayer` / `__maze3d.startYaw`、`maze3d_accept.py` 的 `maze_fraction` / `p1_round` / `check_p1` / `check_6` 断言、`maze-3d-page.test.mjs` 的 `OWN`）之上继续，新增 `LOOK_AHEAD`、`lookAheadTarget` 纯函数与单测，跟随相机观察点改为平滑后的前瞻点，`cameraTarget` 调试字段返回实际观察点。
  - 前瞻让观察点最多离开小人 1.5 格，「迷宫全部在场景雾 near 以内」与「外围地面边缘在雾终点之外」两条不变式的余量不够：`followFogRange` / `groundFogFarMax` 增加可选的 `lookAhead` 参数，`main.js` 传入 `LOOK_AHEAD`；对应浏览器检查（g3 / g3b 的雾公式、g7 的 Python 独立公式）同步加上前瞻量（只会更严，不放宽）。
  - 依赖观察点的旧检查在 Task 1 内更新：`f6`（安全断言不变，先断言「15° 时连线确实被墙挡」这一前提，格心场景改为面朝墙）、`f10`（默认开局 + 原「朝南」前提各测一次）。
  - Task 9 Step 3 增加第三类允许的旧检查修改：观察点从小人移到前瞻点。
  - black 路径改为 `/opt/homebrew/bin/black`（`~/tmp/fuck/c/.venv/bin/black` 不存在）。
  - Task 2–8 不受前瞻影响，内容不变。
- **r3（2026-11-13，实现阶段 Task 6 受阻后修订）**：Task 1–5 已提交（`a3cbbc1..1f529a6`），Task 6（光柱 / 粒子）已实现但未提交。加入光柱后 `t5` 在城堡主题下终点与道路的屏幕颜色距离为 55.6 / 56.9，低于 60（改动前为 62.7，本就是全场最小的一对：终点红 `0xe53935` 与道路红 `0xff6b6b` 同为红色系，原始 RGB 距离只有 78.0）。用户选定方案：3D 道路颜色由红色改为金黄色（design.md 新增第 6 节）。本次修订：
  - Task 6 增加「起点（r3）」说明与 Step 4b「道路改为金黄色」：给出 `COLORS.path = 0xffd740` 的验算表（四个主题下与终点、起点、普通地板、雾地板、过渡色、小人橙色的 RGB 欧氏距离最小 89.8 ≥ 60），新增读取 `main.js` 的 `COLORS` 做距离检查的 node 单测，替换单测与浏览器检查中写死的旧道路色常量（只改颜色常量，不放宽阈值）。
  - Task 6 Step 5 的浏览器检查范围加入用到道路色常量的 `4`、`5`、`f8`、`t1`；Step 6 的 `git add` 加入 `tests/maze-3d-themes.test.mjs`。
  - Global Constraints 加一行道路颜色。Task 1–5、Task 7–9 不受影响，内容不变。

## Global Constraints

- 不开 `renderer.shadowMap`，不加后期效果；不改操作、碰撞、迷宫生成、迷雾判定；不做「指个方向」提示、脚印、声音、计时、星星收集、角色 / 外围装饰。
- yaw 约定：前方 = `(sin yaw, −cos yaw)`；three.js `rotation.y = −yaw`。
- 开局 / 重新生成 / 切尺寸 / 再来一局：`yaw = startYaw(size)`（正方形迷宫恒为 `3π/4`），小人模型同朝向。
- 跟随视角镜头前瞻：`LOOK_AHEAD = 1.5`（格）；观察点 = 小人位置 + 平滑后的前瞻偏移，高度仍为 `TARGET_HEIGHT`；相机仍按 yaw / 实际俯角 / 距离摆在观察点后方；`liftPitch`、`cameraPullIn`、`camera.lookAt` 都用这个观察点；前瞻只影响构图，不影响碰撞；第一人称不受影响。
- 阴影：64×64 径向渐变 Canvas 纹理，中心不透明度 0.35、边缘 0；半径 `1.2 × PLAYER_RADIUS`；`MeshBasicMaterial` 透明、`depthWrite: false`；y = 0.005；第一人称隐藏。
- 暗边：宽 0.18，墙根 0.3 不透明度渐变到外侧 0，黑色；1×64 竖向渐变纹理；一个 `InstancedMesh`；内部墙段两侧各 1 个实例，外边界墙段只朝内 1 个；墙段被迷雾隐藏时对应实例缩放为 0。
- 光柱：开口圆柱，半径 0.35、高 6、金黄，底部透明度 0.45 → 顶部 0（竖向渐变纹理），`AdditiveBlending`、`depthWrite: false`、`fog: false`；透明度倍率在 [0.7, 1.0] 随时间正弦变化；20 颗上升粒子（`Points`，`sizeAttenuation: true`，`fog: false`），到顶从底部重生；光柱与粒子不受迷雾隐藏；原有星星保留。
- 彩带：覆盖画面的 2D `<canvas id="confetti">`（放在 `#stage` 之外，否则会破坏验收脚本的 `#stage > canvas:not(#minimap)` 选择器），`position: fixed; inset: 0; pointer-events: none; z-index: 9`（`#win` 是 10）；约 120 片，持续 2.5 秒后 0.5 秒淡出并停止绘制；只在 `updatePlayer()` 里 `state` 变 `'won'` 那一刻启动；`buildMaze()` 开头立即取消（停绘、清画布、`confettiActive = false`）；`prefers-reduced-motion: reduce` 时不播放。
- 方向提示：三种 `mode`（`'hidden' | 'marker' | 'edge'`）；采样点 = 终点格中心上方 0.4、1.5、3、5；「在画面内」= 相机空间 `−z > near` 且 NDC x、y ∈ [−1, 1]；遮挡 = 相机位置到采样点线段与当前可见墙盒（外扩 0）slab 求交；边框内缩 28px；距离 = 小人到终点格中心的水平距离四舍五入，文案 `「N 格」`；通关后 `mode` 固定 `'hidden'`；箭头与标记 `pointer-events: none`。
- 道路颜色（r3）：3D 页面 `COLORS.path = 0xffd740`（金黄，CSS `#ffd740`）；终点仍为 `0xe53935`；与四个主题的终点、起点、`floorBase`、`fogFloor`、过渡色 `mixHex(floorBase, fogFloor, 0.5)`、小人 `COLORS.player` 的 RGB 欧氏距离都 ≥ 60；2D 迷宫页面的道路颜色不变。
- 新纹理（阴影/粒子共用的径向纹理、暗边纹理、光柱纹理）启动时各建一次，不随主题重建，不计入 `textureCount`（`liveTextures` 不变）。
- 性能：同条件平均帧时间不超过改动前（`origin/main` = `3aa67ab`）的 1.3 倍。
- 截图目录：`/Users/jialiu/Projects/saisai.me/.xdev/20261113-141153-maze-3d-polish/screenshots/`。
- JS 测试：在 worktree 根目录 `node --test tests/`。Python：`~/tmp/fuck/c/.venv/bin/python`；改完 Python 用 `/opt/homebrew/bin/black`（venv 里没有 black）。不要往 `~` 下 `npm install`；不要用裸 `git stash`。
- 基线代码副本：`B=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad/maze3d-polish-baseline`，`rm -rf "$B" && mkdir -p "$B" && git -C <worktree> archive 3aa67ab | tar -x -C "$B"`。Task 1 起需要。
- 浏览器检查一律以 `?seed=12345&...&debug=1` 打开；新检查名以 `p` 开头登记进 `CHECKS`。

## Review Focus

1. 开局朝向从 `π` 改成 `3π/4` 会让依赖「开局朝南」的旧检查失败（至少 `check_6` 断言 `yaw == π`）。Task 9 跑全量；凡因开局朝向失败的旧检查，在其开头显式 `set_test_input(page, yaw=math.pi)` 恢复原前提，`check_6` 改为断言 `startYaw`。
2. 前瞻点与小人之间隔着墙（面朝墙站在格心，前瞻点越过墙）：相机→观察点连线穿过这面墙，`liftPitch` 必须抬高俯角从墙顶看过去，连线不穿墙、相机不在墙盒内、距离不小于 `min(ideal, CAMERA_MIN_DIST)`。Task 1 的 `f6` 格心场景改为面朝墙专门覆盖这一情况，并先断言 15° 时连线确实被挡（前提不成立就 FAIL，不允许静默通过）。
3. 小人在边角格朝外走时前瞻点落到迷宫外，迷宫最远点到相机的距离可超过 `相机距离 + size·√2`，迷宫远角会被场景雾染色、外围地面边缘可能进入雾终点以内。Task 1 给 `followFogRange` / `groundFogFarMax` 加 `lookAhead` 余量并有单测；g3b / g7 用加了前瞻量的公式断言。
4. 终点格上的光柱是加法混合，会改变终点格在截图里的颜色，使 `t5` 的「终点色可分辨」检查失真。Task 6 把光柱网格加入 `floorSamplePoints` 的遮挡物列表，只取光柱后面没覆盖到的采样点；t5 必须仍 PASS。
5. 光柱脉动和粒子是随时间变化的像素：凡比较两张截图的旧检查（`g3` 在 yaw = 3π/4 对比关雾前后像素）会被动画干扰。Task 6 提供 `setBeamForTest({ paused: true })`；Task 9 在 `g3` 截图前调用它。
6. 「再来一局」在彩带播放中途点击：彩带必须立即停、画布清空、按钮可点。Task 8 的 p6 在通关后 0.5 秒内点击并断言。
7. 性能对比 `t7` 的基线开局朝南、当前版本开局 `3π/4`：Task 9 Step 1 用两边共用的 `perf_fixed_start` 统一朝向、俯仰、缩放后再计时，并比较 `endPos`/`wins` 确认轨迹一致。前瞻只改相机位置、不改移动，同样按键下轨迹仍一致；两边画面构图不同属于本功能的真实负载，计入比较。
8. 第一人称原地转一整圈时终点穿过相机平面（`cz` 过 0）：箭头坐标必须始终有限、不跳到无穷。Task 3 单测覆盖 `cz` 从 +0.5 到 −0.5，Task 7 的 p5 每帧记录 `endHint`。

---

### Task 1: 开局朝向 `startYaw`、跟随视角镜头前瞻与 `effects.js` 模块

**起点（r2）**：worktree 里已有本任务未提交的部分实现，**在其上继续，不要删除重做**：
- `maze-3d/effects.js`：`startYaw(size)` 已实现；`tests/maze-3d-effects.test.mjs`：`startYaw` 单测已有且通过。
- `maze-3d/main.js`：已 `import { startYaw } from './effects.js'`，`resetPlayer()` 用 `yaw = startYaw(size)`，`__maze3d` 已有 `get startYaw()`。
- `tests/maze-3d-page.test.mjs`：`OWN` 已含 `'effects.js'`。
- `tests/browser/maze3d_accept.py`：`MAZE_FRACTION_JS`、`maze_fraction`、`p1_round`、`check_p1`（已登记进 `CHECKS`）已写好，`check_6` 已断言 `3π/4`。这些不再改动，除非下文明确要求。
- 已知事实：只改 yaw 时 `p1` 实测 frac = 34%（基线 35%），所以 `p1` 现在是 FAIL，由本任务的前瞻让它通过。

**Files:**
- Modify: `maze-3d/effects.js`（加 `LOOK_AHEAD`、`lookAheadTarget`）
- Modify: `tests/maze-3d-effects.test.mjs`
- Modify: `maze-3d/game-logic.js`（`followFogRange`、`groundFogFarMax` 加可选参数 `lookAhead`）
- Modify: `tests/maze-3d-core.test.mjs`（新增前瞻余量单测；现有断言不动）
- Modify: `maze-3d/main.js`（`placeFollow` 约 490-506 行、`updateSceneFog` 约 543 行、`updateGroundExtent` 约 181 行、`__maze3d.cameraTarget` 约 1217 行，新增 `__maze3d.lookAhead`）
- Modify: `tests/browser/maze3d_accept.py`（`FOG_MATCH_JS`、`FOG_TRANSITION_JS`、`ground_fog_far_max`、`low_pitch_wall_view`、`check_f6`、`check_f10`）

**Interfaces:**
- Produces:
  - `effects.js`：`startYaw(size: number) -> number`（已有）；`LOOK_AHEAD = 1.5`；`lookAheadTarget(playerPos: {x, z}, yaw: number, dist: number) -> {x, z}`，返回 `{x: x + sin(yaw)·dist, z: z − cos(yaw)·dist}`，不改入参。`effects.js` 只允许 import `./movement.js`，不碰 DOM / three.js。
  - `game-logic.js`：`followFogRange(idealDistance, size, lookAhead = 0)` → `near = idealDistance + size·√2 + lookAhead`，`far = near + 25`；`groundFogFarMax(size, zoomMax, lookAhead = 0)` → 跟随项加 `lookAhead`（第一人称项不变）。默认参数下返回值与现在完全相同（现有 core 单测不改）。
  - `main.js`：跟随视角观察点 `camTarget = (playerState.x + lookOff.x, TARGET_HEIGHT, playerState.z + lookOff.z)`，`lookOff` 是平滑后的前瞻偏移；`__maze3d.cameraTarget` 跟随视角返回实际 `camTarget`，第一人称返回 `{x: playerState.x, y: TARGET_HEIGHT, z: playerState.z}`；`__maze3d.lookAhead` 只读，等于 `LOOK_AHEAD`。
  - Python：`ground_fog_far_max(size, zoom_max=1.5, look_ahead=LOOK_AHEAD)`，模块常量 `LOOK_AHEAD = 1.5`（与 effects.js 一致）。

- [ ] **Step 1: 写失败的单测**

`tests/maze-3d-effects.test.mjs` 追加：

```js
test('lookAheadTarget offsets along yaw forward', () => {
  const p = { x: 2.5, z: 3.5 };
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  const cases = [
    [0, 0, -1.5],                 // 北：−z
    [Math.PI / 2, 1.5, 0],        // 东：+x
    [Math.PI, 0, 1.5],            // 南：+z
    [(3 * Math.PI) / 2, -1.5, 0], // 西：−x
    [(3 * Math.PI) / 4, 1.5 * Math.SQRT1_2, 1.5 * Math.SQRT1_2], // 东南
  ];
  for (const [yaw, dx, dz] of cases) {
    const t = lookAheadTarget(p, yaw, LOOK_AHEAD);
    assert.ok(near(t.x, p.x + dx) && near(t.z, p.z + dz), `yaw ${yaw}`);
  }
  assert.deepEqual(lookAheadTarget(p, 1.234, 0), { x: 2.5, z: 3.5 });
  assert.deepEqual(p, { x: 2.5, z: 3.5 });
  assert.equal(LOOK_AHEAD, 1.5);
});
```

`tests/maze-3d-core.test.mjs` 追加：

```js
test('fog ranges include look-ahead margin', () => {
  const r = L.followFogRange(8.6, 10, 1.5);
  assert.ok(Math.abs(r.near - (8.6 + 10 * Math.SQRT2 + 1.5)) < 1e-9);
  assert.ok(Math.abs(r.far - (r.near + 25)) < 1e-9);
  for (const s of [10, 15, 20]) {
    assert.ok(Math.abs(L.groundFogFarMax(s, 1.5, 1.5) - (L.groundFogFarMax(s, 1.5) + 1.5)) < 1e-9);
    for (const z of [0.7, 1, 1.5]) {
      const o = L.followOffset(10);
      assert.ok(L.followFogRange(Math.hypot(o.h, o.d) * z, s, 1.5).far <= L.groundFogFarMax(s, 1.5, 1.5) + 1e-9);
    }
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-effects.test.mjs tests/maze-3d-core.test.mjs`
Expected: FAIL，`lookAheadTarget` / `LOOK_AHEAD` 未导出；fog 新测 near 少了 1.5。

- [ ] **Step 3: 实现纯函数**

- `effects.js`：`LOOK_AHEAD`、`lookAheadTarget` 按 Interfaces。
- `game-logic.js`：`followFogRange`、`groundFogFarMax` 按 Interfaces 加第三个参数，注释写明「前瞻观察点最多离开小人 lookAhead 格」。

Run: `node --test tests/`
Expected: 全部 PASS（现有 `followFogRange` / `groundFogFarMax` / `groundHalfExtent` 断言不变且通过）。

- [ ] **Step 4: `main.js` 跟随相机改用前瞻观察点**

- 新增 `const lookOff = new THREE.Vector3()`（y 恒为 0）。`placeFollow(k, snap)` 开头：
  1. `want = lookAheadTarget({x: 0, z: 0}, yaw, LOOK_AHEAD)`；`snap` 时 `lookOff.set(want.x, 0, want.z)`，否则 `lookOff.lerp(tmpWant, k)`（与 `smoothCam` 同一个 `k`，即 `1 − 0.001^dt`）。平滑的是偏移向量而不是观察点本身：长度始终 ≤ `LOOK_AHEAD`，小人移动时观察点不拖尾。
  2. `camTarget.set(playerState.x + lookOff.x, TARGET_HEIGHT, playerState.z + lookOff.z)`。
  3. 其余不变：`liftPitch(camTarget, …)`、`followCameraPos(camTarget, …)`、`cameraPullIn(camTarget, smoothCam, boxes3d)`、`camera.lookAt(camTarget)` 全部以新观察点为准。
- `placeFirstPerson` 不动。
- `updateSceneFog`：`followFogRange(Math.max(idealDistance(), dCur), size, LOOK_AHEAD)`；`updateGroundExtent`：`groundFogFarMax(size, ZOOM_MAX, LOOK_AHEAD)`。
- `__maze3d`：`cameraTarget` 按 Interfaces 改；加 `get lookAhead()`。
- 相机区注释更新为「观察点 = 小人前方 LOOK_AHEAD 格（偏移平滑）」。

- [ ] **Step 5: 更新依赖观察点 / 雾公式的旧浏览器检查（不放宽阈值）**

- 模块常量 `LOOK_AHEAD = 1.5`。
- `FOG_MATCH_JS`：`L.followFogRange(…, M.size, M.lookAhead)`。
- `FOG_TRANSITION_JS`：`need = M.cameraDistance + M.size * Math.SQRT2 + M.lookAhead`。
- `ground_fog_far_max`：跟随项加 `look_ahead`；docstring 同步。
- `low_pitch_wall_view(page, yaw, shot)`：读到 `target = cameraTarget`（现在是前瞻观察点）后，用 Python 按 `followCameraPos` 公式求 15° 俯角、`cameraIdealDistance` 下的理想相机位置 `ideal15`，`blocked15 = any(segment_hits_box(target, ideal15, b) for b in boxes)`；`ok` 追加 `blocked15`（前提：15° 时连线确实被墙挡，所以「必须抬高」才有意义），detail 打印 `blocked15` 与 `target`。其余断言（不穿墙、不在盒内、`usable`、`lifted`）与阈值不变。
- `check_f6`：
  - 格心场景改为**面朝墙**：`yaw = DIR_YAW[d]`（前瞻点越过墙，相机→观察点连线穿过这面墙；原「背对墙」时观察点离墙 2.0 格，15° 连线在墙处高 0.936 > 墙盒顶 0.92，前提不成立）。截图名不变。
  - 格心 60° 子项沿用面朝墙状态，断言不变（`dist60 ≥ 0.98 × ideal60`）。
  - 贴墙子项保持原样（背对墙后退 1 秒；观察点离墙约 1.83 格，15° 时连线在墙处高约 0.89，仍被挡）。
  - docstring 改为「格心面朝墙（前瞻点越过墙）与背对墙贴墙两处……」。
- `check_f10`：两个子项都断言 `dist ≥ 0.98 × ideal`：a. 默认开局（`yaw = 3π/4`，相机在西北角外）；b. `set_test_input(page, yaw=math.pi)` + `set_test_input(page)` 后等 1500ms（原「朝南、相机在北侧入口外」前提）。docstring 同步。

- [ ] **Step 6: 运行确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only p1,6,f6,f10,g3,g3b,g7,g1,g8 --baseline-root "$B"`
Expected: 全部 PASS；p1 details 里 frac ≥ 50%，并含 baseline frac；f6 两处 `blocked15=True`。

升级条件：如果 `LOOK_AHEAD = 1.5` 下 p1 的 frac 仍 < 50%，停止，不要自行改 `LOOK_AHEAD`、默认俯角或缩放，也不要放宽 p1 阈值；把 frac 实测值写进报告交回编排器。其余检查 FAIL 时按 superpowers:systematic-debugging 定位：属于产品缺陷就改 `main.js`；属于检查前提变化，只允许 Task 9 Step 3 列出的三类修改。

- [ ] **Step 7: black 并 commit**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/effects.js maze-3d/game-logic.js maze-3d/main.js tests/maze-3d-effects.test.mjs tests/maze-3d-core.test.mjs tests/maze-3d-page.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 开局朝向迷宫中心，跟随视角镜头前瞻"
```

---

### Task 2: 共用 slab 求交与 `segmentBlocked`

**Files:**
- Modify: `maze-3d/movement.js`（`cameraPullIn` 约 200-235 行）
- Modify: `maze-3d/effects.js`
- Test: `tests/maze-3d-effects.test.mjs`

**Interfaces:**
- Produces:
  - `movement.js`：`slabInterval(o: number[3], d: number[3], box) -> [tEnter, tExit] | null`；`box` 为 `{minX,maxX,minY,maxY,minZ,maxZ}`；直线 `o + t·d` 与盒子无交返回 null。`cameraPullIn` 改为调用它，行为不变。
  - `effects.js`：`segmentBlocked(a: {x,y,z}, b: {x,y,z}, boxes) -> boolean`：线段 `t ∈ [0, 1]` 与任一盒子区间 `[tEnter, tExit]` 有重叠即为真；`a == b` 返回 false。

- [ ] **Step 1: 写失败的单测**

盒子取 `wallBoxes3d(segmentBoxes([{ x: 1, z: 0.5, along: 'z' }]), WALL_HEIGHT, 0)[0]`（x ∈ [0.95, 1.05]，y ∈ [0, 0.8]，z ∈ [−0.05, 1.05]）：

```js
test('segmentBlocked', () => {
  const box = [wallBoxes3d(segmentBoxes([{ x: 1, z: 0.5, along: 'z' }]), WALL_HEIGHT, 0)[0]];
  assert.equal(segmentBlocked({ x: 0.5, y: 0.4, z: 0.5 }, { x: 1.5, y: 0.4, z: 0.5 }, box), true);  // 穿墙
  assert.equal(segmentBlocked({ x: 0.5, y: 0.9, z: 0.5 }, { x: 1.5, y: 0.9, z: 0.5 }, box), false); // 越过墙顶
  assert.equal(segmentBlocked({ x: 0.5, y: 0.4, z: -1 }, { x: 0.5, y: 0.4, z: 2 }, box), false);   // 平行不接触
  assert.equal(segmentBlocked({ x: 0.5, y: 0.4, z: 0.5 }, { x: 0.9, y: 0.4, z: 0.5 }, box), false); // 没到墙
});
test('slabInterval', () => {
  const b = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
  assert.deepEqual(slabInterval([-1, 0.5, 0.5], [1, 0, 0], b), [1, 2]);
  assert.equal(slabInterval([-1, 2, 0.5], [1, 0, 0], b), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-effects.test.mjs`
Expected: FAIL，`slabInterval` / `segmentBlocked` 未导出。

- [ ] **Step 3: 实现**

把 `cameraPullIn` 内层 3 轴循环原样搬进 `slabInterval`（`|d[k]| < 1e-12` 时 o 在区间外返回 null，否则跳过该轴；`tEnter > tExit` 返回 null）。`cameraPullIn` 的 `tEnter <= 0` 忽略、`tEnter <= 1 && tEnter < best` 取最小规则保持不变。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/`
Expected: 全部 PASS（含 `maze-3d-movement.test.mjs` 中现有 `cameraPullIn` 测试）。

- [ ] **Step 5: Commit**

```bash
git add maze-3d/movement.js maze-3d/effects.js tests/maze-3d-effects.test.mjs
git commit -m "refactor(maze-3d): 抽出 slab 求交，新增 segmentBlocked"
```

---

### Task 3: 方向提示纯函数 `edgeArrow` 与 `endHintMode`

**Files:**
- Modify: `maze-3d/effects.js`
- Test: `tests/maze-3d-effects.test.mjs`

**Interfaces:**
- Produces:
  - `HINT_INSET = 28`；`BEAM_SAMPLE_HEIGHTS = [0.4, 1.5, 3, 5]`。
  - `edgeArrow(cam: {x,y,z}, viewW, viewH, inset) -> {x, y, angle}`：x、y 为相对画面左上角的 CSS 像素。
  - `endHintMode(samples: Array<{inView: boolean, occluded: boolean}>) -> 'hidden' | 'marker' | 'edge'`。

- [ ] **Step 1: 写失败的单测**

用 `W=1280, H=720, I=28`，`onBorder(p)` = `|p.x − I| < 1e-6 || |p.x − (W−I)| < 1e-6 || |p.y − I| < 1e-6 || |p.y − (H−I)| < 1e-6`，且 x ∈ [I, W−I]、y ∈ [I, H−I]。

- `edgeArrow({x:-1,y:0,z:-5})` → x = I、`|angle − π| < 1e-9`；`{x:1,y:0,z:-5}` → x = W−I、angle = 0；`{x:0,y:1,z:-5}`（上）→ y = I、angle = −π/2；`{x:0,y:-1,z:-5}`（下）→ y = H−I、angle = π/2；`{x:1,y:1,z:-5}` → 落在边框、x > W/2、y < H/2。
- 背后偏右 `{x:1,y:0,z:5}` → x = W−I。
- 正后方 `{x:0,y:0,z:5}` → `{x: W/2, y: H−I, angle: π/2}`。
- 跨越相机平面：`x = 1, y = 0`，`z` 从 0.5 每步 −0.01 到 −0.5：每步 x、y、angle 都 `Number.isFinite`，相邻两步 `hypot(Δx, Δy) ≤ 2`。
- 宽高比：`(1280,720)`、`(800,800)`、`(720,1280)` 下 `{x:3,y:2,z:-1}` 都 `onBorder`。
- `endHintMode`：`[{inView:true,occluded:true},{inView:true,occluded:false}]` → `'hidden'`；`[{inView:true,occluded:true},{inView:false,occluded:false}]` → `'marker'`；全部 `inView:false` → `'edge'`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-effects.test.mjs`
Expected: FAIL，函数未导出。

- [ ] **Step 3: 实现**

按 spec「终点方向提示」第 2–5 步：`(dx, dy) = (cx, −cy)`；`hypot < 1e-6` 时取 `(0, 1)`；从 `(W/2, H/2)` 出发，`t = min(halfW/|dx|, halfH/|dy|)`（分量为 0 的一侧取 Infinity），`halfW = W/2 − inset`、`halfH = H/2 − inset`；`angle = atan2(dy, dx)`。`endHintMode`：有 `inView && !occluded` → hidden；否则有 `inView` → marker；否则 edge。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add maze-3d/effects.js tests/maze-3d-effects.test.mjs
git commit -m "feat(maze-3d): 终点方向提示的箭头位置与模式判定"
```

---

### Task 4: 小人圆形软阴影

**Files:**
- Modify: `maze-3d/effects.js`、`maze-3d/main.js`
- Test: `tests/maze-3d-effects.test.mjs`
- Modify: `tests/browser/maze3d_accept.py`（新增 `check_p2`）

**Interfaces:**
- Consumes: `PLAYER_RADIUS`、`playerModelScale()`（movement.js）。
- Produces:
  - `effects.js`：`SHADOW_RADIUS = 1.2 * PLAYER_RADIUS`；`shadowLook(lift: number) -> {scale, opacity}`，`l = clamp(lift, 0, 0.1)`，`scale = 1 − 3l`，`opacity = 1 − 5l`（材质 opacity 倍率，纹理本身中心 alpha 0.35）。
  - `main.js`：`makeRadialTexture()` → 64×64 `CanvasTexture`，白色径向渐变，中心 alpha 0.35、边缘 0（Task 6 的粒子复用同一张纹理，粒子材质 opacity 另设）；`__maze3d.shadow` → `{x, z, visible, scale, opacity}`。

- [ ] **Step 1: 写失败的单测**

```js
test('shadowLook shrinks and fades with lift', () => {
  assert.deepEqual(shadowLook(0), { scale: 1, opacity: 1 });
  const a = shadowLook(0.02), b = shadowLook(0.05);
  assert.ok(b.scale < a.scale && a.scale < 1 && b.opacity < a.opacity && a.opacity < 1);
  assert.deepEqual(shadowLook(1), shadowLook(0.1));
  assert.deepEqual(shadowLook(-1), shadowLook(0));
  assert.ok(Math.abs(SHADOW_RADIUS - 1.2 * PLAYER_RADIUS) < 1e-12);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-effects.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `shadowLook` 按上面公式。
- `main.js`：启动时建 `PlaneGeometry(2·SHADOW_RADIUS, 2·SHADOW_RADIUS)`、`rotation.x = −π/2`，`MeshBasicMaterial({ map: radialTex, color: 0x000000, transparent: true, depthWrite: false })`，`position.y = 0.005`，`renderOrder` 低于光柱；直接加到 `scene`（不挂在 `player` 下，避免继承模型缩放与起伏）。
- 每帧在 `updatePlayer()` 末尾：`shadow.position.x/z = playerState.x/z`；`lift = bodyGroup.position.y × playerModelScale()`；按 `shadowLook(lift)` 设 `shadow.scale` 与 `material.opacity`。
- `setView()` 里 `shadow.visible = !first`（与 `player.visible` 同处）。
- 不改 `liveTextures`。

- [ ] **Step 4: 写浏览器检查 `check_p2`**

`size=10`、迷雾关；`open_dir` 后 `walk_to` 一格（走动中用 `record_frames(page, "shadow", 800, during=...)` 或走完读一次均可），断言每次读数 `hypot(shadow.x − playerPos.x, shadow.z − playerPos.z) ≤ 0.01` 且 `visible`；点 `#view-btn` 进第一人称后 `shadow.visible == False`；再切回 `True`；`textureCount == 5`；无页面错误。

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only p2,t1`
Expected: 全部 PASS。

- [ ] **Step 6: black 并 commit**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/effects.js maze-3d/main.js tests/maze-3d-effects.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 小人脚下圆形软阴影"
```

---

### Task 5: 墙脚暗边

**Files:**
- Modify: `maze-3d/effects.js`、`maze-3d/main.js`（`buildMaze`、`disposeMaze`、`applyWallVisibility`）
- Test: `tests/maze-3d-effects.test.mjs`
- Modify: `tests/browser/maze3d_accept.py`（新增 `check_p3`）

**Interfaces:**
- Consumes: `wallSegments` 的段（`{x, z, along, cells}`；`cells.length === 1` 即外边界段）；`WALL_THICKNESS`、`WALL_LENGTH`。
- Produces:
  - `effects.js`：`FOOT_STRIP_WIDTH = 0.18`；`wallFootStrips(segments) -> Array<{seg, x, z, nx, nz, rotY}>`。`(nx, nz)` 是从墙指向该侧地板的单位法向；条带中心 = 墙中心 + n × `(WALL_THICKNESS/2 + FOOT_STRIP_WIDTH/2)`；`rotY = atan2(nx, nz)`。内部段输出两条（n 与 −n），外边界段只输出指向其唯一格中心的那一条。
  - `main.js`：`__maze3d.footStripCount`（实例数）；`__maze3d.footStripsVisible()` → `Array<{seg, visible}>`（`visible` 用现有 `instanceHidden` 判断）。

- [ ] **Step 1: 写失败的单测**

用 `new MazeGenerator(10, 10, 12345).generate().connections` → `wallSegments`：
- `strips.length === inner × 2 + outer`。
- 每条：along `'x'` 的段 `nx === 0 && |nz| === 1`、`strip.x === seg.x`、`|strip.z − seg.z| ≈ 0.14`；along `'z'` 对称；`|rotY − atan2(nx, nz)| < 1e-12`。
- 外边界段的唯一条带法向指向 `cells[0]` 中心（`(col + 0.5 − seg.x)·nx + (row + 0.5 − seg.z)·nz > 0`）。
- 每个内部段恰好出现两次，法向相反。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-effects.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `wallFootStrips` 按上面定义。
- `main.js`：启动时建暗边纹理（1×64 canvas，顶端 `rgba(0,0,0,0.3)` → 底端 `rgba(0,0,0,0)`；默认 `flipY` 下 canvas 顶端对应 v = 1）。几何 `PlaneGeometry(WALL_LENGTH, FOOT_STRIP_WIDTH)` 后 `rotateX(−π/2)`：本地 +y（深色边）落到世界 −z，所以实例旋转 `rotY` 后深色边朝向 −n 即墙根。材质 `MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: −1, polygonOffsetUnits: −1 })`；y = 0.003。
- `buildMaze` 里建 `InstancedMesh(stripGeo, stripMat, strips.length)`，`frustumCulled = false`；`disposeMaze` 一并移除 / `dispose()`。
- `applyWallVisibility()` 里对每条带用其 `seg` 的同一 `visible` 设缩放 1 或 0，`instanceMatrix.needsUpdate = true`。
- 主题切换不碰它。

- [ ] **Step 4: 写浏览器检查 `check_p3`**

`size=10`，`preset_storage("1", "1")`：
- `footStripCount` 等于页面里 `import('/maze-3d/effects.js')` 后 `wallFootStrips(M.segments).length`。
- `footStripsVisible()` 每项的 `visible` 等于 `wallsVisible()[seg]`；至少一项为 false、一项为 true。
- 点 `#fog-btn` 关迷雾后全部 `visible == True`。
- `textureCount == 5`，无页面错误。

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only p3,t5,4`
Expected: 全部 PASS；t5 各主题 `min ≥ 60`（语义颜色仍可分辨）。

- [ ] **Step 6: black 并 commit**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/effects.js maze-3d/main.js tests/maze-3d-effects.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 墙脚暗边"
```

---

### Task 6: 终点光柱与闪光粒子

**起点（r3）**：worktree 里已有本任务 Step 1–4 的未提交实现（`effects.js`、`main.js`、`tests/maze-3d-effects.test.mjs`、`tests/browser/maze3d_accept.py` 的改动），**在其上继续，不要删除重做**。已知事实：Step 5 跑 `t5` 时城堡主题终点–道路距离 55.6 / 56.9 < 60 而 FAIL；按用户选定方案由 Step 4b 把道路改成金黄色解决。先确认 Step 1–4 的内容都已在工作区（缺什么补什么），再做 Step 4b。

**Files:**
- Modify: `maze-3d/effects.js`、`maze-3d/main.js`（场景构建、`buildMaze`、`frame`、`floorSamplePoints`、调试对象；r3：`COLORS.path` 约第 84 行）
- Test: `tests/maze-3d-effects.test.mjs`
- Modify: `tests/maze-3d-themes.test.mjs`（r3：`ground and fogFloor colors` 里的道路色常量；新增道路色距离单测）
- Modify: `tests/browser/maze3d_accept.py`（新增 `check_p4a`、助手 `project_css`；r3：替换写死的旧道路色 `#ff6b6b`）

**Interfaces:**
- Consumes: Task 4 `makeRadialTexture()`。
- Produces:
  - `effects.js`：`BEAM_RADIUS = 0.35`、`BEAM_HEIGHT = 6`、`SPARK_COUNT = 20`；`beamPulse(t: seconds) -> number`，取值 [0.7, 1.0]（`0.85 + 0.15·sin(2t)`）。
  - `main.js`：`beam`（Mesh）、`sparks`（Points）；`__maze3d.beamEnabled` → `beam.visible`；调试钩子（仅 `debug`）`setBeamForTest({ visible?: boolean, paused?: boolean })`：`visible` 只切光柱圆柱（不切粒子），`paused` 为真时光柱脉动与粒子位置停止推进。
  - Python：`project_css(cam, p, cw, ch) -> (x, y) | None`：用 `cameraState` 的 `view`（列主序）把世界点变到相机空间，`−z ≤ near` 返回 None，否则按 `fov`、`aspect` 求 NDC 再换算 CSS 像素。

- [ ] **Step 1: 写失败的单测**

```js
test('beamPulse stays in [0.7, 1]', () => {
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 10; t += 0.01) { const v = beamPulse(t); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= 0.7 - 1e-12 && hi <= 1 + 1e-12 && lo < 0.71 && hi > 0.99);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-effects.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现**

- 光柱：`CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 24, 1, true)`；纹理 1×64 canvas 白色，底端 alpha 0.45 → 顶端 0（圆柱 v = 0 在底部）；`MeshBasicMaterial({ color: 0xffd54f, map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide })`；`buildMaze` 里放到 `(size − 0.5, BEAM_HEIGHT/2, size − 0.5)`。每帧（未暂停）`material.opacity = beamPulse(t)`。
- 粒子：`BufferGeometry` 20 个点，每个点记录角度、半径（0.15–0.5）、速度（0.6–1.2 单位/秒）；每帧 `y += v·dt`，`y > BEAM_HEIGHT` 时减去 `BEAM_HEIGHT`；`PointsMaterial({ map: radialTex, color: 0xfff3b0, size: 0.12, sizeAttenuation: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false })`；位置相对终点格中心，`buildMaze` 时重设中心。
- 两者不参与 `applyWallVisibility` / 迷雾逻辑；`frustumCulled = false`。
- `floorSamplePoints` 的 `intersectObjects` 列表加入 `beam`（光柱挡住的地板点不取样，见 Review Focus 2）；`screenHitsScene` 不改。

- [ ] **Step 4: 写浏览器检查 `check_p4a`**

1. 1280×800、`size=10`、`preset_storage("1", "1")`（终点在迷雾外）；`teleportForTest(0, 0)`；`yaw_e = atan2(9.5 − 0.5, −(9.5 − 0.5))`；`set_test_input(yaw=yaw_e, pitch=15°)` 后清输入；`setBeamForTest({ paused: true })`；`wait_camera_still`。
2. 断言 `beamEnabled == True`、`endHint.mode == 'hidden'`（`endHint` 在 Task 7 才有：本任务先只断言 `beamEnabled`，Task 7 Step 4 回来补上这一条）。
3. 截图；`project_css` 求终点格中心高度 1.5 与 3 的投影点作为区域上下界，半宽 = `max(3, 光柱半径在该深度的投影像素)`；左右相邻区域水平平移 ±4 倍半宽、同尺寸。`diff = 区域平均亮度 − max(左, 右)`。
4. 对 `BASELINE_ROOT` 同条件（不调用基线没有的钩子：用 `page.evaluate` 判断 `setBeamForTest` 存在才调用）求 `diff_base`。
5. 判定 `diff ≥ diff_base + BEAM_LUMA_MARGIN`；常量 `BEAM_LUMA_MARGIN` 先跑一次看两者数值后定，不得小于 5，写进脚本并在 details 打印 `diff`、`diff_base`、`margin`。

- [ ] **Step 4b（r3）: 道路颜色改为金黄色 `0xffd740`**

**色值验算**（数据来源：`maze-3d/main.js` 的 `COLORS`——`start 0x4caf50`、`end 0xe53935`、`player 0xff9800`；`maze-3d/themes.js` 的 `floorBase`、`fogFloor`；过渡色 = `mixHex(floorBase, fogFloor, 0.5)`。距离 = RGB 欧氏距离，阈值 60，沿用 t5 规则）。

`0xffd740` = (255, 215, 64)：

| 主题 | 终点 | 起点 | 普通地板 | 雾地板 | 过渡色 | 小人橙 |
| --- | --- | --- | --- | --- | --- | --- |
| garden（`fffaf0` / `7d8a72`） | 160.5 | 184.1 | 179.4 | 159.2 | 132.0 | 89.8 |
| brick（`f7f3ee` / `8c8079`） | 160.5 | 184.1 | 176.4 | 155.1 | 134.2 | 89.8 |
| blocks（`f4f6f8` / `7c8794`） | 160.5 | 184.1 | 186.9 | 175.0 | 153.5 | 89.8 |
| castle（`aeb3bc` / `575b63`） | 160.5 | 184.1 | 152.4 | 211.7 | 167.9 | 89.8 |

最小值 89.8（小人橙），全部 ≥ 60。旧道路色 `0xff6b6b` 与终点只有 78.0。

屏幕颜色预估（t5 测的是纹理 × 光照后的像素）：用改动前 `test-results.txt` 里 t5 记录的旧道路渲染值除以 `0xff6b6b` 得到每主题每通道系数（城堡约 0.75），乘到 `0xffd740` 上，再与同一份记录里各主题的终点 / 起点 / 地板 / 雾渲染值比较：最小为城堡「道路–普通地板」118.6，「道路–终点」最小 128.0（城堡），离 60 余量很大。落选候选（同一脚本算出）：`0xffc107` 与小人橙只差 41.6；`0xffcc33` 与小人橙 72.8；`0xffd54f` 与光柱同色，城堡渲染后与地板 109.1，余量小于 `0xffd740`。

1. 写失败的单测：`tests/maze-3d-themes.test.mjs` 追加（`readFileSync`、`join`、`here`、`dist`、`mixHex`、`THEMES`、`THEME_IDS` 文件里都已有）：

```js
test('3D path color is distinguishable from floor kinds and the player', () => {
  const src = readFileSync(join(here, '..', 'maze-3d', 'main.js'), 'utf8');
  const block = src.match(/const COLORS = \{([\s\S]*?)\};/)[1];
  const C = Object.fromEntries(
    [...block.matchAll(/(\w+):\s*0x([0-9a-f]{6})/gi)].map(([, k, h]) => [k, parseInt(h, 16)]),
  );
  assert.equal(C.path, 0xffd740);
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    const refs = {
      end: C.end, start: C.start, floor: t.floorBase, fog: t.fogFloor,
      fogEdge: mixHex(t.floorBase, t.fogFloor, 0.5), player: C.player,
    };
    for (const [k, c] of Object.entries(refs)) {
      assert.ok(dist(C.path, c) >= 60, `${id} path vs ${k}: ${dist(C.path, c)}`);
    }
  }
});
```

同文件 `ground and fogFloor colors` 里 `[t.floorBase, 0x4caf50, 0xe53935, 0xff6b6b]` 的 `0xff6b6b` 改为 `0xffd740`（阈值 60 不变）。

2. Run: `node --test tests/maze-3d-themes.test.mjs`
   Expected: 新测 FAIL（`C.path` 仍是 `0xff6b6b`）。
3. `main.js` `COLORS.path` 改为 `0xffd740`，行尾注释写「金黄；与终点红区分（见 design 第 6 节）」。
4. `tests/browser/maze3d_accept.py` 把所有 `'#ff6b6b'` / `"#ff6b6b"` 字面量改为 `#ffd740`（`FLOOR_WANT_JS` 的 `path`、两处 `PATH_STATE_JS`、`check_5` 内联 JS、`check_t1` 两次 `COUNT_HEX_JS` 调用）。只改颜色常量；变量名（如 `red`）、阈值、判定逻辑都不动。
5. Run: `grep -rn "ff6b6b" maze-3d tests` 
   Expected: 无输出（2D 迷宫页面不在 `maze-3d/` 下，不受影响）。
6. Run: `node --test tests/`
   Expected: 全部 PASS。

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only p4a,t5,5,4,f8,t1 --baseline-root "$B"`
Expected: 全部 PASS；t5 各主题 `min ≥ 60`，details 中各主题 `path=` 渲染值为黄色系（R、G 都明显大于 B）。

升级条件：如果 t5 仍有某对距离 < 60，停止，不要改色值、不要放宽阈值、不要改取样方式；把 t5 的 details 原文写进报告交回编排器。

- [ ] **Step 6: black 并 commit**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/effects.js maze-3d/main.js tests/maze-3d-effects.test.mjs tests/maze-3d-themes.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 终点光柱与闪光粒子，3D 道路改为金黄色"
```

---

### Task 7: 终点方向提示（箭头 / 标记）

**Files:**
- Modify: `maze-3d/index.html`（`#stage` 内加 `#end-arrow`、`#end-marker` 与样式）
- Modify: `maze-3d/main.js`（`updateEndHint()`、`applyWallVisibility`、`frame`、调试对象）
- Modify: `tests/browser/maze3d_accept.py`（`check_p4a` 补断言；新增 `check_p4b`、`check_p5`）

**Interfaces:**
- Consumes: Task 2 `segmentBlocked`、`slabInterval`；Task 3 `edgeArrow`、`endHintMode`、`HINT_INSET`、`BEAM_SAMPLE_HEIGHTS`；movement.js `wallBoxes3d`、`segmentBoxes`、`WALL_HEIGHT`。
- Produces: `__maze3d.endHint` → `{mode, x, y, angle, distance}`：`x, y` 为相对 `#stage` 左上角 CSS 像素——`marker` 时是标记位置，其余时是 `edgeArrow` 的位置；`angle` 始终是 `edgeArrow` 的角度；`distance` 为整数格数。

- [ ] **Step 1: 写浏览器检查（先失败）**

`check_p4b`、`check_p5` 都用 1280×800、`size=10`：
- `check_p4b`：`preset_storage("1", "1")`，跟随视角，`teleportForTest(0, 0)`，`yaw = yaw_e − (π − 0.8)`（终点在右后方）；等 300ms；断言 `beamEnabled`、`mode == 'edge'`、`x > W/2`、`cos(angle) > 0`、`#end-arrow` 可见、`#end-marker` 不可见、箭头文字为 `f"{distance} 格"` 且 `distance == round(hypot(9, 9)) == 13`。
- `check_p5`（子项都写进 details，全部满足才 PASS）：
  - a. 同 p4b 的背对状态为 edge；再设 `yaw = yaw_e`、`wait_camera_still` → `mode == 'hidden'`，两个提示元素都不可见。
  - b. `preset_storage("0", "5")`，第一人称，`pitch = 0`；按距终点欧氏距离从远到近遍历所有格（距离 ≥ 5），`teleportForTest` 后 `yaw` 设为指向终点格中心，等 2 帧读 `endHint`；找到第一个 `mode == 'marker'` 的格即停。断言找到、`I ≤ x ≤ W−I`、`I ≤ y ≤ H−I`（W、H 取 `#stage` 尺寸）、`#end-marker` 可见、`#end-arrow` 不可见。
  - c. 跟随视角、迷雾关、`pitch = 15°`、`setZoomForTest(0.7)`；对距终点 Chebyshev 距离 2–4 的格（最多 12 个），`teleportForTest` 后朝向终点，`wait_camera_still`，`setBeamForTest({ paused: true })`。截图 A；`setBeamForTest({ visible: false })` 截图 B；恢复 `visible: true`。`seen = A、B 之间 RGB 距离 ≥ 20 的像素数 ≥ 30`。断言每个状态 `(mode == 'hidden') == seen`；details 记录 hidden / marker 各几个。
  - d. 第一人称，`teleportForTest(0, 0)`；用 `record_frames(page, "endHint", 6000, during=drag)`，`drag` 在 `#stage` 内按下鼠标、水平移动 450px（30 步）、松开、移回起点，重复 3 次。断言每帧 `x`、`y`、`angle` 都有限（`math.isfinite`），`yaw` 总变化 ≥ 2π。
  - e. 回到 p4b 的 edge 状态，取 `endHint.x/y` 加上 `#stage` 的页面偏移，在该点按下鼠标水平拖 100px；断言 `|Δyaw| ≥ 0.4`；`getComputedStyle` 两个提示元素的 `pointerEvents` 都是 `none`。
- `check_p4a`：补断言 `endHint.mode == 'hidden'`。

- [ ] **Step 2: 运行确认失败**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only p4a,p4b,p5`
Expected: FAIL（`endHint` 未定义）。

- [ ] **Step 3: 实现**

- `index.html`：`#stage` 内加
  `<div id="end-arrow" hidden><div class="end-arrow-head"></div><span class="end-dist"></span></div>` 与 `<div id="end-marker" hidden><div class="end-dot"></div><span class="end-dist"></span></div>`；绝对定位、`left: 0; top: 0`，用 `transform: translate(x, y)` 定位并以自身中心对齐；`z-index: 1`；`pointer-events: none`（子元素也是）；`[hidden] { display: none }`。箭头头部是指向 +x 的三角，只对 `.end-arrow-head` 施加 `rotate(angle rad)`，距离文字不旋转。
- `main.js`：
  - `applyWallVisibility()` 同时算 `hintBoxes = wallBoxes3d(segmentBoxes(可见段), WALL_HEIGHT, 0)`。
  - `updateEndHint()`：在 `updateCamera` 之后、`render` 之前调用；先 `camera.updateMatrixWorld()`。`state === 'won'` 时 `mode = 'hidden'`。否则对每个采样高度：世界点 → `matrixWorldInverse` 得相机空间点 `v`；`inView = −v.z > camera.near` 且 `v` 再乘 `projectionMatrix` 的 NDC x、y ∈ [−1, 1]；`occluded = segmentBlocked(camera.position, 世界点, hintBoxes)`。`mode = endHintMode(samples)`。`edgeArrow` 输入高度 0.4 那个点的相机空间坐标，`viewW/H = stage.clientWidth/clientHeight`。`marker` 位置 = 画面内采样点中高度最高者的 NDC 换算 CSS 像素，再夹到 `[HINT_INSET, W − HINT_INSET] × [HINT_INSET, H − HINT_INSET]`。
  - DOM：只在 `mode` 变化时切 `hidden`；距离文字只在变化时写。
  - `__maze3d.endHint` 返回最近一次结果。

- [ ] **Step 4: 运行确认通过**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only p4a,p4b,p5,8,11 --baseline-root "$B"` 然后 `node --test tests/`
Expected: 全部 PASS（8、11 是现有布局与指针检查，确认新元素不破坏它们）。

- [ ] **Step 5: black 并 commit**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/index.html maze-3d/main.js tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 画面边缘的终点方向提示"
```

---

### Task 8: 通关彩带

**Files:**
- Modify: `maze-3d/effects.js`、`maze-3d/main.js`（`updatePlayer` 判胜处、`buildMaze` 开头、`frame`、调试对象）、`maze-3d/index.html`（`<canvas id="confetti">` 放在 `#win` 之前、`#stage` 之外，及样式）
- Test: `tests/maze-3d-effects.test.mjs`
- Modify: `tests/browser/maze3d_accept.py`（新增 `check_p6`）

**Interfaces:**
- Produces:
  - `effects.js`：`CONFETTI_COUNT = 120`、`CONFETTI_HOLD = 2.5`、`CONFETTI_FADE = 0.5`；`createConfetti(n, width, height, rand = Math.random) -> {t: 0, pieces}`，每片 `{x, y, vx, vy, rot, vr, w, h, color}`，初始 `y ∈ [−height·0.5, 0]`；`confettiStep(state, dt, height) -> {t, pieces, alpha, done}`（返回新对象，不改入参）：`t += dt`；每片 `vy` 加重力、`x += vx·dt`（可带正弦摆动）、`y += vy·dt`、`rot += vr·dt`；`alpha = t ≤ HOLD ? 1 : max(0, 1 − (t − HOLD)/FADE)`；`done = alpha === 0 || 所有片 y > height + 20`。
  - `main.js`：`startConfetti()`、`cancelConfetti()`；`__maze3d.confettiActive`。

- [ ] **Step 1: 写失败的单测**

用固定种子的 `rand`（如简单 LCG）：
- `createConfetti(120, 800, 600, rand).pieces.length === 120`。
- 从 `createConfetti` 起以 `dt = 1/60` 步进到 `t = 1`：`done === false`、`alpha === 1`。
- 所有片手动设为 `y = 700` 后 `confettiStep(s, 0.016, 600).done === true`（落到底即结束）。
- 步进到 `t ≥ 3.0` 时 `done === true`、`alpha === 0`。
- `confettiStep` 不修改传入的 `state.pieces[0].y`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/maze-3d-effects.test.mjs`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `index.html`：`#confetti { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9; }`。
- `startConfetti()`：`matchMedia('(prefers-reduced-motion: reduce)').matches` 时直接返回；按 `innerWidth/innerHeight × devicePixelRatio` 设画布像素尺寸，`createConfetti` 后 `confettiActive = true`。只在 `updatePlayer()` 中 `state = 'won'` 那一处、紧挨 `$('win').hidden = false` 调用。
- `frame()` 里 `confettiActive` 时 `confettiStep` 并绘制（`globalAlpha = alpha`，每片旋转矩形）；`done` 时清画布、`confettiActive = false`。
- `cancelConfetti()`：`confettiActive = false`、`clearRect` 全画布、丢弃状态；`buildMaze()` 第一行调用。

- [ ] **Step 4: 写浏览器检查 `check_p6`**

`size=10`：
1. `walk_to_exit` 成功后立即读 `confettiActive == True`；`wait_for_function(!confettiActive, timeout=3500)` 成功（记录用时，要求 ≤ 3.5 秒）。
2. `click #again-btn`、`wait_idle`，再次 `walk_to_exit`；胜利后 300ms 内断言 `document.elementFromPoint(按钮中心)` 是 `#again-btn` 或其后代；`page.click("#again-btn")`；随后立即断言 `confettiActive == False`、`#confetti` 的 `getImageData` 全部 alpha 为 0、`#win` 隐藏。
3. 新上下文 `reduced_motion="reduce"`（`open_page` 的 `**ctx_kwargs` 透传）：通关后 600ms 内每 100ms 读一次 `confettiActive`，全为 False。
4. 无页面错误。

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/` 然后 `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only p6,6,6b`
Expected: 全部 PASS。

- [ ] **Step 6: black 并 commit**

```bash
/opt/homebrew/bin/black tests/browser/maze3d_accept.py
git add maze-3d/effects.js maze-3d/main.js maze-3d/index.html tests/maze-3d-effects.test.mjs tests/browser/maze3d_accept.py
git commit -m "feat(maze-3d): 通关彩带"
```

---

### Task 9: 截图、性能与全量验收

**Files:**
- Modify: `tests/browser/maze3d_accept.py`（新增 `check_p8`；`perf_fixed_start` 与 `perf_round` 的 `prepare`/`debug` 参数，`check_t7` 统一起始条件；`SHOTS` 默认值；`--write` 头部「人工检查」文案；修正受开局朝向 / 动画影响的旧检查）
- Modify: `maze-3d/README.md`
- Modify: `tests/browser/test-results.txt`（由 `--write` 生成）

**Interfaces:**
- Consumes: 前面所有 `__maze3d` 字段与钩子。

- [ ] **Step 1: 写 `check_p8` 与文案**

- `check_p8`：每个主题（`THEME_IDS`）1280×800、`size=10`、`theme_init(tid)`、默认迷雾设置：开局 `wait_idle` + 600ms 截图存 `SHOTS / f"polish-{tid}-start.png"`；再设成 p4b 的背对终点状态，断言 `endHint.mode == 'edge'` 后截图存 `polish-{tid}-arrow.png`。8 个文件都存在且非空才 PASS。
- `SHOTS` 默认改为 `/Users/jialiu/Projects/saisai.me/.xdev/20261113-141153-maze-3d-polish/screenshots`。
- `--write` 头部「人工检查」改为：查看该目录下 `polish-*-start.png`（开局迷宫占画面主体、阴影、暗边、光柱）与 `polish-*-arrow.png`（边缘箭头与距离）。保持 `自动检查：` 行格式（`tests/maze-3d-accept-report.test.mjs` 守着）。
- `README.md` 加一段：终点有光柱和闪光，看不到光柱时画面边缘有箭头和距离；通关有彩带（系统开启「减少动态效果」时不播放）。
- 性能（spec 测试 7）沿用 `t7`（基线 vs 各主题，1.3 倍阈值），但**必须先统一两边的起始条件**：基线开局 `yaw = π`、当前版本开局 `yaw = 3π/4`，原 `perf_round` 不带 `debug=1`，两边按同样按键走出的轨迹、碰撞、迷雾更新和画面负载都不同，结论可能误通过也可能误失败。不能等 FAIL 后再修。改法：
  - 新增一个两边共用的固定场景准备函数 `perf_fixed_start(page)`：`set_test_input(page, yaw=math.pi, pitch=<基线开局 pitch，从基线页面 __maze3d 读出后写死为常量>)`，然后 `set_test_input(page)` 还回真实输入；`setZoomForTest(<基线默认缩放常量>)`；场景雾保持默认（不调用 `setSceneFogForTest`）；主题仍由 `init_script` 指定。小人保持在开局格不传送。只调用基线也有的钩子（`setInputForTest`、`setZoomForTest`），不调用本次新增的钩子。
  - `perf_round` 增加参数 `prepare=None`、`debug=False`：`debug=True` 时 URL 追加 `&debug=1`；`wait_idle` 之后若有 `prepare` 就调用它，再 `wait_for_timeout(800)` 等相机跟随稳定，然后才 `resetFrameStats()`。默认参数下行为不变（`check_9` 不受影响）。
  - `check_t7` 的基线与各主题调用都传 `debug=True, prepare=perf_fixed_start`；驱动保持 `play_continuous`（同样的按键序列）。
  - 一致性记录：`perf_round` 在驱动结束后多返回 `endPos`（`playerPos`）与 `wins`（驱动中点击「再来一局」的次数，`play_continuous` 改为返回该计数）；`fmt_perf` 把两者写进 detail。`check_t7` 判定前比较：任一主题与基线 `wins` 不同，或 `endPos` 水平距离 > 1.5 格，返回 `None, detail + " | INCONCLUSIVE: trajectory differs"`，不给出 PASS/FAIL。
  - 硬件为 SwiftShader 时仍按原逻辑返回 INCONCLUSIVE。

- [ ] **Step 2: 准备基线并跑全量**

```bash
B=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad/maze3d-polish-baseline
rm -rf "$B" && mkdir -p "$B"
git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261113-141153-maze-3d-polish archive 3aa67ab | tar -x -C "$B"
cd /Users/jialiu/Projects/saisai.me/.worktrees/20261113-141153-maze-3d-polish
node --test tests/
~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --baseline-root "$B"
```

Expected: 记录所有 FAIL 项。

- [ ] **Step 3: 修正受影响的旧检查**

对每个 FAIL 项先按 superpowers:systematic-debugging 定位原因，只允许以下三类修改，其余原因要改产品代码：
- 原因是开局朝向不再朝南：在该检查打开页面、`wait_idle` 之后加 `set_test_input(page, yaw=math.pi)` + `set_test_input(page)` 恢复原前提，并在注释写明。
- 原因是光柱 / 粒子动画让前后两张截图像素不同（已知 `g3`）：在截图前调用 `setBeamForTest({ paused: true })`。
- 原因是跟随视角观察点从小人移到前瞻点（Task 1 已处理 f6、f10、g3、g3b、g7；其余检查同理）：断言改用实际观察点 `cameraTarget` / 带 `lookAhead` 的公式，或在注释里写明后把场景调整到原前提仍成立的位置，并加一条断言证明前提成立。安全性断言（相机不穿墙、不在墙盒内）与所有数值阈值不许放宽。

`t7` 不在本步处理范围：它的起始条件已在 Step 1 统一；若 Step 1 改完后 `t7` 仍 FAIL，属于真实性能退化，要改产品代码，不许改检查。

修改后重跑失败项直到 PASS，然后 `/opt/homebrew/bin/black tests/browser/maze3d_accept.py`。

- [ ] **Step 4: 全量写结果**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --write --baseline-root "$B"`
Expected: 退出码 0，`test-results.txt` 中 `自动检查：PASS`；p1 含 `baseline frac=`；t7 各主题 `ok avg ≤ 1.3 × baseline`，detail 里基线与各主题的 `endPos`、`wins` 一致（若 t7 为 INCONCLUSIVE（SwiftShader，或 trajectory differs 重跑一次仍不一致），如实保留，不改判定）；截图目录有 8 张 `polish-*.png`。

- [ ] **Step 5: Commit**

```bash
git add tests/browser/maze3d_accept.py tests/browser/test-results.txt maze-3d/README.md
git commit -m "test(maze-3d): 画面打磨验收检查与全量结果"
```
