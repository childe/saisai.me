# 3D 迷宫玩法设计

## 意图

用户在「还能改进什么」的清单里选定的改进拆成三个依次叠加的 PR。A「画面打磨」已合入（`docs/superpowers/specs/2026-11-13-maze-3d-polish-design.md`）。本文是第二个 PR「玩法」，包含：

1. 小地图上的脚印和已探索格子。
2. 音效（脚步、撞墙、通关、收集星星），带静音开关；安卓手机震动。
3. 计时和最佳成绩。
4. 可收集的星星。

后续 PR：C「角色与场景」（可爱角色、外围装饰）。本 PR 不涉及它。

网站面向小朋友；页面是 GitHub Pages 上的静态 ES 模块，没有构建步骤。本 PR 不加依赖，不加音频文件。

现状参考（`maze-3d/main.js`）：

- 小地图 `#minimap`（`index.html` 中 `#stage` 右上角 140×140 的 `<canvas>`，`z-index: 2`）只在第一人称显示：`setView()` 里 `$('minimap').hidden = !first`；帧循环中 `if (view === 'first') drawMinimap()`。底图（地板、终点、墙）画在离屏 canvas `miniBase` 上，只在 `recomputeFog()` 把 `miniBaseDirty` 置真后重画；底图只画当前迷雾视野内的墙（`wallInView`），视野外的格子与地板同色。每帧在底图上画小人圆点和朝向三角。
- `recomputeFog()` 是迷雾唯一的重算入口：显示格 `display` 变化、迷雾开关或视野半径变化、显示 / 隐藏道路、`buildMaze()`、`teleportForTest()` 都经过它。
- 迷雾判定 `isInFogView(center, cell, radius)` 用 Chebyshev 距离；`cellVisible(row, col)` 在迷雾关时恒为真。
- 判胜在 `updatePlayer()`：显示格变为终点格时 `state = 'won'`、速度清零、`$('win').hidden = false`、`startConfetti()`。通关层 `#win` 里只有 `#win-text`（「恭喜！你成功走出了迷宫！」）和「再来一局」按钮 `#again-btn`。
- 「再来一局」和「重新生成」都调用 `regenerate()` → `buildMaze(newSeed, size)`；切换尺寸调用 `buildMaze(seed, newSize)`。三者都经过 `buildMaze()`。
- 移动：`stepPlayer(state, input, yaw, dt, grid)`（`movement.js`）返回碰撞后的位置，速度 = 实际位移 / dt；`MAX_SPEED = 2.2` 格/秒。输入来自 `currentInput()`（键盘 + 摇杆，或调试钩子 `setInputForTest`）。
- `localStorage` 只通过 `storageGet()` / `storageSet()`（`main.js:103` 起）读写，这两个函数兜住隐私模式下的异常。已有键：`maze3d.theme`、`maze3d.fogOn`、`maze3d.fogRadius`。
- 启动顺序：`applyTheme()` → `buildMaze()` → 预渲染一帧（着色器编译、纹理上传）→ `WARM_FRAMES = 16` 帧预热（前 8 帧以不透明度 0.01 显示终点方向提示）→ `startLoop()` 并挂出 `window.__maze3d`（就绪标志）。
- 终点方向箭头在小地图可见时用 `avoidRect(arrow, miniRect(), HINT_INSET)` 避开小地图（判断条件是 `minimap.hidden`，不是视角）。
- 终点上方有旋转的黄色星星 `buildStar()`（`COLORS.star = 0xffd600`，外半径 0.25，高 0.6）；3D 道路色 `COLORS.path = 0xffd740`；小人色 `COLORS.player = 0xff9800`。
- 迷宫生成器 `MazeGenerator`（`maze-core.js`）与 2D 页面逐 seed 一致，有单元测试比对。生成器不保证每个格子都能从起点走到（非主路格子只随机打开 1–2 个方向）。

## 目标

### 1. 小地图：已探索格子与脚印

**已探索格子**

- 本局中曾经进入过迷雾视野的格子都算「已探索」。迷雾关闭时，全部格子算已探索。
- 记录方式：一个 `Uint8Array(size × size)`。在 `recomputeFog()` 里更新：迷雾开时把当前视野（以 `display` 为中心、半径 `fogRadius` 的正方形，夹到迷宫内）内的格子置 1；迷雾关时全部置 1。所以迷雾开关、视野半径变化、走到新格子都会更新记录。
- 已探索的格子不会变回未探索：本局中途关一次迷雾再打开，全部格子保持已探索；视野调小也不清除记录。
- `buildMaze()`（「再来一局」、重新生成、切换尺寸）清空记录，然后按开局视野重新标记。

**小地图画法**（只改 `drawMinimapBase()`，仍然只在 `miniBaseDirty` 时重画）

| 格子 | 颜色 |
| --- | --- |
| 当前视野内（迷雾关时为全部格子） | 地板色 `#f2efe6`（与现在相同） |
| 已探索、不在当前视野内 | 暗一档的地板色 `#d9d3c4`，让孩子看出「视野」范围 |
| 未探索（只在迷雾开时出现） | 雾色 `#5b6270` |
| 终点格 | 红色 `#e53935`，无论是否探索都画（终点光柱在 3D 画面里本来就一直可见） |

- 墙：一段墙紧邻的格子（`seg.cells`）中有任意一个已探索就画；迷雾关时全部画。墙色、线宽不变。
- 同色格子合并成一条路径、一次 `fill()`，不逐格调用 `fillRect` 设置颜色。

**脚印**

- 脚印是小人真正走过的格子，按访问顺序记录：
  - `buildMaze()` 时记录起点格。
  - `updatePlayer()` 里显示格变化（即走进新格子）时记录新格子。`teleportForTest()` 不记录脚印（瞬移不是走过）。
  - 重复走进一个已在记录里的格子时，把它从原位置移到末尾。所以记录长度 ≤ size²（20×20 时最多 400），按「最近一次走过」排序，不会无限增长。
- 画法：每个脚印格中心画一个棕色小圆点 `#8d6e63`，半径 `max(1.5 × dpr, 0.12 × cell)`。越早的脚印越淡：不透明度从最旧的 0.35 线性升到最新的 0.9。脚印画在底图上（走进新格子时 `recomputeFog()` 本来就会让底图重画），不增加每帧开销。
- 当前格的脚印被每帧画的小人圆点盖住，这是预期效果。

**星星标记**：见第 4 节。

**小地图在两种视角都显示**（决定）

- 改为跟随视角和第一人称都显示小地图：删除 `setView()` 中按视角隐藏小地图的逻辑，页面开局就显示。
- 理由：迷雾在两种视角下同样遮住远处；跟随视角是默认视角，孩子大多在跟随视角下玩。「走过的路」和「还没去过的地方」正是孩子在迷雾里最需要的信息。只在第一人称显示，就等于大多数孩子看不到本 PR 的新内容。
- 窄屏（`max-width: 480px`）时小地图缩小为 110×110，减少遮挡画面。
- 帧循环改为「小地图可见就调用 `drawMinimap()`」。`drawMinimap()` 记录上次画的 `playerState.x`、`playerState.z`、`yaw`；三者变化都不超过 1e-4、底图也不脏、画布尺寸不变时直接返回，不重画。
- 终点方向箭头：`updateEndHint()` 已按 `minimap.hidden` 决定是否避让，跟随视角下自动避开小地图，不改逻辑。箭头和标记的 `z-index: 3` 仍高于小地图。

### 2. 音效与震动

所有声音用 Web Audio 实时合成（`OscillatorNode` + `GainNode`），不加音频文件。

| 名称 | 触发条件 | 声音 | 震动 |
| --- | --- | --- | --- |
| `step` | 小人实际走过的距离每累计 0.5 格触发一次 | 三角波，40ms，高低两个音（330Hz / 392Hz）交替，峰值增益 0.06，指数衰减 | 无 |
| `bump` | 撞墙（判定见下） | 正弦波，0.15s 内从 140Hz 滑到 60Hz，峰值增益 0.25 | `vibrate(25)` |
| `star` | 收集一颗星星 | 正弦波两个音：988Hz，0.08s 后 1319Hz，各 0.25s 衰减，峰值增益 0.15 | 无 |
| `win` | 判胜那一刻 | 三角波琶音 523 / 659 / 784 / 1047Hz，间隔 0.12s，最后一个音延长到 0.5s，峰值增益 0.18 | `vibrate([80, 60, 80, 60, 200])` |

**脚步**

- 每帧用 `stepPlayer` 前后位置之差（实际位移，不是输入）累加距离。推着墙走不动时位移为 0，不响脚步。
- 累加器在 `buildMaze()` 时清零；判胜后不再累加。

**撞墙判定**

不改 `stepPlayer`。在 `updatePlayer()` 里每帧算两个量：

- 「在推」：`hypot(input.forward, input.strafe) ≥ 0.5`。
- 「走不动」：实际位移 < 0.5 × 期望位移，期望位移 = `MAX_SPEED × min(1, hypot(forward, strafe)) × dt`。

两者同时成立并且持续 ≥ 0.15 秒，触发一次撞墙。0.15 秒用来排除从静止起步的加速段：`ACCEL` 下 0.075 秒就达到半速，起步不会误判。斜着贴墙滑行时实际位移约为期望位移的 cos(夹角)，夹角 < 60° 不算撞墙。

触发后进入「已撞」状态，直到松开（不在推）或者走得动了（实际位移 ≥ 0.5 × 期望位移）才重新武装。再加 0.6 秒冷却：两次撞墙之间至少隔 0.6 秒。所以一直顶着墙只响一次、震一次。

**AudioContext 生命周期**

- 页面加载时不创建 `AudioContext`。在 `window` 上监听 `keydown`、`pointerdown`、`touchend`（捕获阶段、`passive`）；第一次用户手势且声音开着时，创建 `new (window.AudioContext || window.webkitAudioContext)()`，状态为 `suspended` 就调用 `resume()`。创建成功后移除这三个监听。
- 声音关着时不创建。之后点「声音：开」本身是一次用户手势，这时创建。
- 页面切到后台（`visibilitychange` 为 hidden）时 `suspend()`；回到前台时，如果之前已经创建，就 `resume()`。
- 环境不支持 Web Audio（没有构造函数，或构造抛异常）：记为 `'unsupported'`，之后所有播放都是空操作，不抛异常，不在控制台报错。
- `resume()` 返回的 Promise 加 `.catch(() => {})`。

**静音开关**

- 在 `#view-row` 的「全屏」按钮前加按钮 `#sound-btn`，文字「声音：开」/「声音：关」（与「迷雾：开」同一写法）。
- 一个开关同时控制声音和震动。
- 状态存到 `maze3d.sound`（`'1'` / `'0'`），用 `storageGet()` / `storageSet()`；没有存过时默认开（与 `maze3d.fogOn` 同样写法：`storageGet('maze3d.sound') !== '0'`）。
- 关闭时主增益节点立即置 0，正在响的尾音也被切掉。

**震动**

- 只在 `typeof navigator.vibrate === 'function'` 时调用，调用包在 `try` 里。iOS Safari 没有这个函数，直接跳过。
- 声音关时不震动。

### 3. 计时与最佳成绩

**计时**

- 开局时间显示 `00:00.0`，不走。
- 本局第一次「实际移动」时开始计时：`updatePlayer()` 里 `state === 'idle'`、计时未开始、本帧实际位移 > 1e-6。只转视角、拖动镜头、`teleportForTest()` 都不算移动。
- 计时用帧循环的 `dt`（已经夹在 ≤ 0.1 秒）累加。所以页面在后台（渲染循环停止）时计时暂停；极慢设备上计时与游戏内移动同步变慢。这对孩子是公平的。
- 判胜那一刻停止计时，冻结显示。
- `buildMaze()`（「再来一局」、重新生成、切换尺寸）清零并回到「未开始」。切换主题、迷雾、视角、显示道路都不影响计时。
- 显示格式 `mm:ss.t`（分:秒.十分之一秒）；超过 99:59.9 时显示 `99:59.9`。只在十分之一秒位变化时写 DOM，每秒最多写 10 次。

**最佳成绩**

- 每个尺寸（10 / 15 / 20）一个记录，存到 `maze3d.best.10`、`maze3d.best.15`、`maze3d.best.20`，值为整数毫秒字符串。读出的值不是正整数（缺失、`'abc'`、`'-5'`、`'0'`、`'NaN'`）都当作没有记录。
- 时间精度：计时器内部按 `dt × 1000` 累加，可能含小数。判胜结算时统一取 `timeMs = Math.round(timer.elapsedMs)`，之后的比较、写存储、`lastResult.timeMs`、`#win-time` 显示都只用这个整数。HUD 在游戏中途显示的是未取整的 `elapsedMs` 经 `formatTime` 向下取整的结果，不受影响。
- 通关时：本局时间（整数毫秒）小于记录、或者没有记录，就写入新记录，并显示「新纪录!」。
- 迷雾开关、视野半径、视角、主题都不分开记录。这是有意接受的简化：给孩子看一个数字最简单；本局中途切换迷雾时也不需要规定成绩算到哪一边。
- 本局走的时候道路开着的，本局成绩不计入最佳（看着道路走不算本事）。判定规则：
  - 计时开始那一刻（首次实际移动），`pathUsedThisRun ||= showPath`。所以「开局先点显示道路、不隐藏就开始走」也不计入。
  - 计时开始后点「显示道路」，`pathUsedThisRun = true`。
  - 之后点「隐藏道路」不撤销 `pathUsedThisRun`。
  - 计时开始前点过「显示道路」、但开始走之前已经点了「隐藏道路」的，不影响。
  - `showPath` 在 `buildMaze()` 中不清除（现有行为，`main.js` 里重新生成、切换尺寸都保留道路开关）；`pathUsedThisRun` 在 `buildMaze()` 中清零。道路开着进入下一局时，由第一条规则在下一局计时开始时置真。
  - 通关层仍显示用时，并显示「这局看了道路，不计入最佳成绩」。

**通关层**

`#win` 的 `.win-box` 里，在 `#win-text` 下加：

- `#win-time`：「用时 00:42.3」
- `#win-best`：「最佳 00:38.1」（新纪录时等于本局时间；本局不计入且没有记录时不显示）
- `#win-record`：「新纪录!」（醒目的金色徽标；不是新纪录时 `hidden`）
- `#win-path-note`：「这局看了道路，不计入最佳成绩」（只在本局不计入时显示）
- `#win-stars`：「⭐ 收集了 k / N 颗星星」；k = N 时显示「⭐ 全部 N 颗星星都收集到了！」

### 4. 可收集的星星

**数量**：尺寸 10 → 3 颗，15 → 5 颗，20 → 7 颗。

**位置**（纯函数 `placeStars(connections, seed, count)`，同 seed 同尺寸结果相同；不改迷宫生成器，不消耗生成器的随机数）：

1. 从起点 BFS（`canMove`），得到可达格子和到起点的步数。BFS 不从终点继续向外扩展（走到终点即通关，经过终点才能到的格子在通关前拿不到）。只有这样可达的格子能放星星：生成器不保证每格都可达，放在不可达格子里的星星永远拿不到。
2. 候选格 = 可达格子，去掉起点、终点，以及与起点或终点 Chebyshev 距离为 1 的格子（开局一步就拿到、或通关时顺手拿到都没意思）。
3. 用 `findPath` 得到起点到终点的最短路线。每个候选格的权重：死胡同（可通行方向数 = 1）+2，不在最短路线上 +1。
4. 用独立的随机数生成器（mulberry32，种子由 `seed` 的低 32 位与高 32 位混合得到，常数写在代码里）按行优先顺序给每个候选格一个随机数。候选格按「权重降序，随机数升序」排序。
5. 贪心挑选：最小间距 `D` 从 `floor(size / 3)`（10 → 3，15 → 5，20 → 6）开始。按排序依次挑，与已挑中的每颗星星的曼哈顿距离都 ≥ `D` 才要。挑够 `count` 颗就结束；挑不够就清空、`D` 减 1 重来，最小到 `D = 1`。
6. 返回 `[{ row, col }]`，按挑中顺序。

**外观**

- 程序生成的五角星：`THREE.Shape` 外半径 0.16、内半径 0.07，`ExtrudeGeometry` 厚 0.05，所有星星共用一份几何。两种材质：正反面 `MeshLambertMaterial`，颜色初值 `0xffb300`（琥珀金），`emissive` 初值 `0x553300`，让城堡这类暗色主题下也亮；侧面颜色初值 `0x8d5a00`（深琥珀），旋转时形成深色描边，在浅色地板和金黄道路上都能看清。
- 颜色要求（计划按此规则验算后定值）：正面色与 `COLORS.path`（`0xffd740`）、四个主题的 `floorBase` 的 RGB 欧氏距离都 ≥ 60。初值 `0xffb300` 与道路色的距离约 73。
- 与终点星星区分：终点星星更大（外半径 0.25）、更高（0.6）、颜色 `0xffd600`，上方有光柱。
- 动画：绕竖轴自转 2 弧度/秒；高度在 0.35 ± 0.05 之间上下浮动（正弦，周期约 2 秒）；每颗星星的相位按序号错开。
- 网格对象启动时建 7 个（最大数量），放在一个 `Group` 里，`buildMaze()` 只设置位置和 `visible`，不新建、不销毁。
- 迷雾：星星所在格子不在迷雾视野内时隐藏，与墙同一判定（`cellVisible(row, col)`）；在 `recomputeFog()` 里更新 `visible`，不逐帧判断。已收集的星星一直隐藏。星星材质受场景距离雾影响（默认 `fog: true`），与墙一致。

**收集**

- `updatePlayer()` 里、`state === 'idle'` 时，逐颗检查未收集的星星：小人中心到星星所在格中心的水平距离 < 0.4 就收集。走廊宽度减去碰撞半径后，小人中心离格心最多约 0.17，所以穿过或走进星星所在的格子就一定能拿到。
- 收集时：隐藏星星；播放 `star` 声音；更新计数；底图标脏（小地图标记消失）。
- 通关不需要星星；通关层显示收集数（见第 3 节）。

**计数显示**：见第 5 节的「⭐ k/N」。

**小地图标记**：未收集、并且所在格已探索的星星，在小地图上画一个琥珀色 `#ffb300`、深色描边 `#8d5a00` 的小圆点，半径 `max(2 × dpr, 0.22 × cell)`。未探索格里的星星不画，否则小地图会提前暴露星星位置。收集后标记消失。标记画在底图上、脚印之上。

### 5. 游戏信息栏（HUD）

- 在 `#stage` 里左上角加 `#hud`（左上各内缩 8px，圆角半透明白底，与小地图同一风格），两项：
  - `#timer`：「⏱ 00:00.0」
  - `#star-count`：「⭐ 0/3」
- `pointer-events: none`，不拦截摇杆和拖动；`z-index: 2`，低于终点方向箭头和标记（3）。箭头落到信息栏上时箭头盖在上面，不另做避让。
- 放在舞台内（不是舞台外的一行），理由：孩子玩的时候盯着舞台；手机横屏和全屏时舞台外的行可能被挤出屏幕。
- 信息栏开局就显示，在预热帧里完成第一次光栅化，不产生游戏中途的一次性卡顿。

## 非目标

- 不改迷宫生成（`maze-core.js`），不改 2D 迷宫页面。
- 不改操作、碰撞（`stepPlayer` 不改）、迷雾判定。
- 不做背景音乐，不加音频文件，不做音量滑块。
- 不做在线排行榜，不按迷雾、视野、视角、主题分开记录最佳成绩。
- 不做星星收集动画（只有声音、计数和消失），不要求收集星星才能通关。
- 不做 iOS 震动（Safari 不支持 `navigator.vibrate`）。
- 不做 PR C 的内容。

## 反目标

- 页面一加载就创建或播放音频（浏览器自动播放策略会报警告，孩子会被吓到）。
- 顶着墙一直响撞墙声、一直震动。
- 静音后仍然震动，或者刷新页面后静音状态丢失。
- 不支持 Web Audio 或 `vibrate` 的环境里抛异常或控制台报错。
- 计时在页面加载时、或只转视角时就开始走；通关后计时还在走；「再来一局」后计时没有清零。
- 看着道路走出的成绩刷新了最佳成绩。
- 星星放在不可达的格子、起点、终点上；同一 seed 刷新后星星换了位置。
- 星星透过迷雾显示，或者小地图在未探索的地方暴露星星。
- 星星在某个主题下与地板或道路分不清。
- 小地图挡住终点方向箭头，或信息栏拦截摇杆。
- 脚印、已探索记录随游戏时间无限增长；帧循环里每帧分配对象导致掉帧；性能检查平均帧时间超过改动前的 1.3 倍。

## 方案

**新模块 `maze-3d/gameplay.js`**（纯逻辑，不碰 DOM、不依赖 three.js，可在 node 中测试）：

- `STAR_COUNTS = { 10: 3, 15: 5, 20: 7 }`，`starCountFor(size)`。
- `placeStars(connections, seed, count)`：见第 4 节。内部的 `mulberry32(seed)` 也导出，便于测试。
- `STAR_PICK_RADIUS = 0.4`；`starHit(px, pz, star)`：返回布尔值，不分配对象。
- `markExplored(explored, size, center, radius, fogOn)`：原地修改 `Uint8Array`，返回本次新标记的格数。
- `pushFootprint(trail, index)`：原地修改数组（`index = row × size + col`）；与末尾相同不变；已存在则移到末尾；返回 `trail`。
- `FOOTPRINT_ALPHA = [0.35, 0.9]`，`footprintAlpha(i, n)`：第 i 个（0 = 最旧）脚印的不透明度。
- `formatTime(ms)` → `'mm:ss.t'`，向下取整到十分之一秒，夹到 `99:59.9`。
- `parseBest(str)` → 正整数毫秒或 `null`。
- `updateBest(prevStr, timeMs, eligible)` → `{ best, isNew, write }`：`timeMs` 先 `Math.round` 成整数再比较，`write` 为要写入的字符串（整数毫秒）或 `null`；`eligible` 为假时 `isNew = false`、`write = null`、`best = parseBest(prevStr)`。
- `createGameTimer()`：`{ start(), tick(dt), stop(), reset(), started, running, elapsedMs }`；`tick` 只在 running 时累加。
- `createStepCounter(stride = 0.5)`：`add(dist)` 返回本次触发的脚步数（整数），内部累计余量；`reset()`。
- `createBumpDetector({ hold = 0.15, cooldown = 0.6, ratio = 0.5 })`：`update(pushing, moved, wanted, dt)` 返回布尔值（本帧是否触发）；`reset()`。
- `MINI_COLORS`：小地图各种颜色常量（地板、暗地板、雾、墙、终点、脚印、星星、星星描边），`main.js` 与浏览器检查共用同一组值。

这几个工厂函数返回的对象在 `buildMaze()` 外创建一次，帧循环里只调用方法，不新建对象。

**新模块 `maze-3d/sound.js`**：

- `createSfx({ win = window, enabled, log })`：
  - `unlock()`：在用户手势里调用；按第 2 节创建或恢复 `AudioContext`。
  - `setEnabled(on)`；`enabled` 只读。
  - `play(name, variant)`：`name` 为 `'step' | 'bump' | 'star' | 'win'`；关闭时直接返回；开启时先调用 `log`（如果有），再在有可用 `AudioContext`（状态为 `running`）时排程振荡器。每个振荡器在 `onended` 里断开连接。
  - `vibrate(pattern)`：开启并且 `win.navigator.vibrate` 是函数时调用，包在 `try` 里。
  - `suspend()` / `resume()`：供 `visibilitychange` 使用。
  - `state`：`'none'`（还没创建）、`'unsupported'`、或 `AudioContext.state`。
- 音色参数（频率、时长、增益）写成模块内常量表，与第 2 节的表一致。

**`main.js` 改动**：

- 导入两个新模块。状态：`explored`、`footTrail`、`stars`（`[{ row, col, collected }]`）、`starMeshes`、`timer`、`stepCounter`、`bumpDetector`、`pathUsedThisRun`、`lastResult`、`sfx`。
- `buildMaze()`：清空并重建以上本局状态；`placeStars()`；放置星星网格；`pushFootprint` 起点；更新 HUD。
- `recomputeFog()`：先 `markExplored()`，再设置星星可见性，再标脏底图。
- `updatePlayer()`：记录 `stepPlayer` 前的位置；之后算实际位移 → 计时开始判定 → 脚步计数 → 撞墙检测 → 收集星星 → 显示格变化时 `pushFootprint` + `recomputeFog()` + 判胜。判胜时依次：停止计时、`updateBest()`、写存储、填写通关层、`play('win')`、`vibrate`、`startConfetti()`。
- 帧循环：`timer.tick(dt)`；更新 HUD（十分之一秒位变化才写）；星星自转与浮动；小地图可见时 `drawMinimap()`（内部有「没变就跳过」）。
- 计时开始判定处：`timer.start()` 的同时 `pathUsedThisRun ||= showPath`。
- 「显示道路」按钮：计时已开始时 `pathUsedThisRun = true`。「隐藏道路」不改 `pathUsedThisRun`。
- 判胜结算：`timeMs = Math.round(timer.elapsedMs)`，再调用 `updateBest()`（见第 3 节「时间精度」）。
- 首次手势监听、`#sound-btn`、`visibilitychange` 中挂接 `sfx.suspend()` / `sfx.resume()`。
- 预渲染：`buildMaze()` 之后的首帧预渲染前，把 7 个星星网格临时全部设为可见，渲染完恢复。理由：three.js 只为可见对象编译着色器；开局时星星可能全在迷雾外，第一次出现时编译会卡一帧。
- 星星与终点星星共用 `buildStar` 的造形逻辑：把五角星 `Shape` 的生成抽成按外半径、内半径参数化的函数。

**`index.html` 改动**：`#sound-btn`；`#hud`（含 `#timer`、`#star-count`）及样式；`.win-box` 内新增元素及样式；窄屏小地图 110px。

**调试对象 `window.__maze3d` 新增只读字段**：

- `minimapVisible`：`!minimap.hidden`。
- `minimapLayout`：`{ px, pad, cell, dpr }`，浏览器检查按它把格子换算到小地图像素。
- `explored`：已探索格数；`exploredAt(row, col)`：布尔值。
- `footprints`：`[[row, col], ...]` 的副本，最旧在前。
- `stars`：`[{ row, col, collected, visible }]`（`visible` 为网格的 `visible`）；`starsCollected`；`starTotal`。
- `timer`：`{ started, running, elapsedMs, text }`。
- `lastResult`：最近一次通关的 `{ timeMs, bestMs, isNew, eligible, stars, total }`；未通关为 `null`。
- `soundOn`；`audioState`（即 `sfx.state`）。
- `?debug=1` 时：`sfxLog`（最近 100 条 `{ name, variant, t }` 的副本）、`clearSfxLog()`；测试钩子 `setStarsForTest({ paused })`：`paused` 为真时停止自转和浮动，浮动停在 0.35，每颗星星正面朝向相机。

**其他**：

- `tests/maze-3d-page.test.mjs` 的 `OWN` 列表加入 `gameplay.js`、`sound.js`（继续检查没有外部引用）。
- `maze-3d/README.md` 补充小地图脚印、声音开关、计时与星星的说明。
- 新增纹理数为 0（星星不用纹理），主题纹理数 `textureCount` 不变。

## 测试

### 单元测试（`node --test`，新增 `tests/maze-3d-gameplay.test.mjs`、`tests/maze-3d-sound.test.mjs`）

- `starCountFor`：10 / 15 / 20 分别为 3 / 5 / 7。
- `placeStars`（seed 1..200 × 三个尺寸，用 `MazeGenerator` 生成迷宫）：
  - 数量等于 `starCountFor(size)`，格子互不相同。
  - 不在起点、终点上，与起点、终点的 Chebyshev 距离 ≥ 2。
  - 每颗都能从起点走到（`findPath` 非空）。
  - 不经过终点也能走到：测试里另做一次 BFS，终点格不入队扩展，所有星星都在 BFS 结果内。
  - 两两曼哈顿距离 ≥ 2。
  - 同一 seed 调用两次结果完全相同；调用前后 `MazeGenerator` 对同一 seed 的生成结果不变。
  - 对全部 600 个迷宫统计：死胡同或不在最短路线上的星星占比 ≥ 80%。
  - 构造一个只有一条走廊、可达候选格少的小迷宫：`D` 逐级放宽后仍挑够数量；候选格不足时返回全部候选格、不死循环。
- `markExplored`：迷雾开时只标视野正方形（中心在角上时夹到迷宫内）；返回新标格数；同一中心再调用返回 0；迷雾关时全部置 1；之后迷雾开、视野 1 再调用，已标记的格子保持 1。
- `pushFootprint`：与末尾相同不变；新格追加；重复格移到末尾；长度不超过 size²。
- `footprintAlpha`：最旧 0.35，最新 0.9，单调递增；n = 1 时为 0.9。
- `formatTime`：0 → `00:00.0`；1234 → `00:01.2`；59999 → `00:59.9`；61050 → `01:01.0`；超过 99:59.9 的值 → `99:59.9`。
- `parseBest` / `updateBest`：无记录时 `isNew` 为真；更快时 `isNew` 为真并写入；相等或更慢时 `isNew` 为假、不写；非法记录值当作无记录；`eligible` 为假时不写、`isNew` 为假；`timeMs = 1234.6`、无记录时 `write === '1235'`；同一 `timeMs`、记录为 `'1235'` 时视为相等，`isNew` 为假、`write === null`。
- `createGameTimer`：未 `start` 时 `tick` 不累加；`stop` 后不累加；`reset` 清零并回到未开始。
- `createStepCounter`：连续 `add(0.1)` 20 次共触发 4 次；一次 `add(1.2)` 触发 2 次，余量 0.2 留到下一次；`reset` 清余量。
- `createBumpDetector`（dt = 1/60）：
  - 推着墙（`moved = 0`）持续 0.14 秒不触发，到 0.15 秒触发一次；之后一直推 3 秒不再触发。
  - 松开 1 帧再推：距上次触发不足 0.6 秒时不触发，满 0.6 秒且又持续 0.15 秒后触发。
  - 从静止起步：按 `stepPlayer` 的 `ACCEL` 模拟开阔地起步，全程不触发。
  - 斜向贴墙滑行，`moved / wanted = cos(45°)`：不触发。
- `createSfx`：
  - `win` 没有 `AudioContext` / `webkitAudioContext`：`unlock()`、四种 `play()`、`vibrate()` 都不抛异常，`state === 'unsupported'`。
  - 假的 `AudioContext`（记录 `createOscillator` 调用次数）：`unlock()` 前 `state === 'none'`、`play` 不创建振荡器但调用 `log`；`unlock()` 后 `play('win')` 创建 4 个振荡器。
  - `setEnabled(false)` 后 `play` 不调用 `log`、不创建振荡器，`vibrate` 不调用 `navigator.vibrate`。
  - `navigator.vibrate` 抛异常时 `vibrate()` 不抛异常。
- 颜色规则：星星正面色与 `COLORS.path`、四个主题 `floorBase` 的 RGB 欧氏距离都 ≥ 60（颜色常量从 `gameplay.js` 导出，便于测试）。
- 原有单元测试全部保持通过。

### 浏览器验收（扩展 `tests/browser/maze3d_accept.py`，新检查编号用前缀 `b`）

原有检查全部保持通过。因本 PR 有意改变的行为，以下原有检查按新行为更新断言，不放宽阈值：

- `check_3`：跟随视角下小地图也可见（原断言「跟随视角隐藏小地图」改为「两种视角都可见」）；其余断言不变。
- `canvas_image()`：截图前临时给 `#minimap`、`#hud` 设 `visibility: hidden`，截完恢复。理由：Playwright 的元素截图包含盖在 canvas 上的元素，而使用 `canvas_image()` 的检查（t2、t5、g1、p1、p4a 等）测量的是 3D 画面本身。检查覆盖层布局的 `check_8`、`p5m` 不使用这个辅助函数，不受影响。
- `check_8`：增加断言：375×667 竖屏下 `#hud`、`#minimap` 都在舞台内；`#sound-btn` 不与舞台重叠；小地图宽度为 110px。

新增检查（页面都带 `?seed=12345&debug=1`，除注明外尺寸 10）：

1. **b1 已探索格子**：迷雾开、视野 1。开局时 `explored === 4`（起点在角上，视野 2×2）。沿起点到终点的 `findPath` 路线走到第 7 格（路线下标 6，不通关；目标格不写死，因为该 seed 的迷宫有不可达格，如 (0, 3)）后 `explored` 增加，且路上每格视野内的格子都 `exploredAt` 为真。小地图像素检查：取格子左上四分之一处（避开中心的脚印）的像素，已探索格与 `MINI_COLORS` 中的地板色或暗地板色的 RGB 距离 ≤ 20；未探索格与雾色的距离 ≤ 20。点「迷雾：关」后 `explored === 100`，再点「迷雾：开」仍为 100。
2. **b2 脚印**：走一条 ≥ 5 格的路线（用 `walk_to`），`footprints` 依次等于路线上的格子；小地图上路线中非当前格的格心像素与脚印色 `#8d6e63`（按不透明度与地板色混合后的期望值）的距离 ≤ 30。往回走一格，该格移到 `footprints` 末尾，长度不变。`teleportForTest` 之后 `footprints` 不变。「再来一局」后 `footprints` 只剩起点。
3. **b3 小地图在跟随视角**：开局（跟随视角）`minimapVisible` 为真；第一人称仍为真。跟随视角下背对终点，让箭头落在右边框靠上处：箭头矩形与小地图矩形不相交（与 p5m 同样的判断）。小人不动、视角不动时，连续 30 帧小地图的 `toDataURL()` 不变。
4. **b4 计时**：开局 1 秒内不动：`timer.started` 为假、`text === '00:00.0'`、`#timer` 文字含 `00:00.0`。只转视角（`setInputForTest({ turn: 1 })` 0.5 秒）：仍未开始。前进：200ms 内 `started` 为真，再过 1 秒 `elapsedMs` 在 [800, 1400] 内。走到终点：`state === 'won'` 时 `running` 为假；间隔 500ms 两次读到的 `elapsedMs` 相等；`#win-time` 文字含 `formatTime(lastResult.timeMs)`。点「再来一局」：`elapsedMs === 0`、`started` 为假。切换到 15×15：同样清零。
5. **b5 最佳成绩**：
   - 用 `init_script` 预设 `maze3d.best.10 = '9999999'`（只在键不存在时写入，刷新不会覆盖），走到终点：`lastResult.isNew` 为真，`#win-record` 可见且文字为「新纪录!」，`localStorage['maze3d.best.10'] === String(lastResult.timeMs)`，`maze3d.best.15` 不存在。
   - 同一上下文刷新页面（不再预设），再走到终点：`lastResult.bestMs` ≤ 上一局写入的记录，`#win-best` 显示 `formatTime(lastResult.bestMs)`。这说明记录跨刷新保留。
   - 预设 `'1'`，走到终点：`isNew` 为假，`#win-record` 隐藏，存储仍为 `'1'`，`#win-best` 含 `00:00.0`。
   - 预设 `'abc'`：当作无记录，通关后 `isNew` 为真并写入。
   - 预设 `'9999999'`，前进 0.5 秒后点「显示道路」，走到终点：`eligible` 为假、`isNew` 为假、存储仍为 `'9999999'`、`#win-path-note` 可见。
   - 开着道路开始走：预设 `'9999999'`，开局不动，点「显示道路」，再前进并走到终点：`eligible` 为假、存储仍为 `'9999999'`、`#win-path-note` 可见。
   - 道路开关跨局保留：上一局点「显示道路」后点「再来一局」（不隐藏道路），新一局走到终点：`eligible` 为假、存储不变。
   - 开始前看过道路再隐藏：开局不动，点「显示道路」再点「隐藏道路」，然后走到终点：`eligible` 为真。
   - 整数毫秒：任一通关后 `Number.isInteger(lastResult.timeMs)` 为真，`localStorage['maze3d.best.10']` 匹配 `/^[1-9]\d*$/`。
6. **b6 声音（调试日志）**：
   - 页面打开、没有任何手势时 `audioState === 'none'`。用 `page.keyboard.press('Shift')` 之后 `audioState` 不是 `'none'`（`'running'` 或 `'suspended'` 都接受：无头环境的音频设备状态不可控，声音本身无法在无头环境中听到，所以用 `sfxLog` 验证触发）。
   - `clearSfxLog()` 后沿直线走 2 格：`step` 条目 3–5 条，`variant` 交替。
   - 找一个面前是墙的格子（`find_wall_cell`），顶着墙前进 2 秒：`bump` 恰好 1 条。松开 0.7 秒再顶 1 秒：`bump` 共 2 条。顶墙期间没有 `step` 条目。
   - 走到一颗星星：出现 1 条 `star`。走到终点：出现 1 条 `win`。
7. **b7 震动**：`init_script` 把 `navigator.vibrate` 替换为记录调用参数的函数。顶墙 2 秒：记录恰好 1 次 `25`。通关：记录到 `[80, 60, 80, 60, 200]`。
8. **b8 静音**：点 `#sound-btn`：文字变为「声音：关」，`localStorage['maze3d.sound'] === '0'`，`soundOn` 为假。重复 b6 的顶墙和走路：`sfxLog` 无新增，`vibrate` 记录无新增。刷新页面：按钮仍为「声音：关」，`soundOn` 为假；在静音状态下按键后 `audioState === 'none'`（静音时不创建）。再点一次：「声音：开」、存储为 `'1'`、`audioState` 不是 `'none'`。
9. **b9 无 Web Audio、无震动**：`init_script` 删除 `window.AudioContext`、`window.webkitAudioContext` 和 `navigator.vibrate`。按键、顶墙、收集星星、通关、点静音开关：无页面错误，无控制台 error，`audioState === 'unsupported'`，`sfxLog` 照常记录。
10. **b10 星星数量与确定性**：尺寸 10 / 15 / 20 下 `starTotal` 为 3 / 5 / 7，`#star-count` 文字为「⭐ 0/3」等；同一 seed 刷新后 `stars` 的格子列表完全相同；页面上的格子列表与在页面中调用 `gameplay.js` 的 `placeStars` 的结果相同。
11. **b11 收集星星**：用 `walk_to` 走到第一颗星星的格子：`starsCollected === 1`，`#star-count` 为「⭐ 1/3」，该星星 `collected` 为真、`visible` 为假；小地图该格心不再有星星标记色（与 `#ffb300` 的距离 > 60）。在该格来回走：计数不再增加。走到终点：`#win-stars` 含「1 / 3」。「再来一局」：`starsCollected === 0`。
12. **b12 星星与迷雾**：迷雾开、视野 1：视野外的星星 `visible` 为假，小地图该格无星星标记（格子为雾色）。`teleportForTest` 到星星相邻格：该星星 `visible` 为真，小地图出现星星标记。再瞬移走：3D 中星星 `visible` 为假，小地图标记仍在（格子已探索、星星未收集）。
13. **b13 星星可见度**：四个主题各一次。迷雾关，`setStarsForTest({ paused: true })`，瞬移到星星相邻格，跟随视角朝向星星。用 `cameraState` 和 `project_css` 求星星中心的屏幕位置，取该点 3×3 平均色，与星星周围 0.6 格处地板点的颜色距离 ≥ 60。再点「显示道路」，若星星所在格在道路上，与道路色也 ≥ 60；不在道路上时，取最近的道路格作为对照点。
14. **b14 性能**：沿用 t7 的方法（GPU、iPhone SE、4 倍 CPU 降速、`perf_fixed_start`、`play_continuous`），基线为 merge-base 代码。新代码中小地图在跟随视角显示、星星在场、声音开启（驱动按键是用户手势，会真实创建 `AudioContext`）。各主题平均帧时间 ≤ 基线的 1.3 倍，且不触发降画质。t7 本身继续通过。
15. **b15 截图**：保存到 `<repo>/.xdev/20261114-103742-maze-3d-gameplay/screenshots/`（脚本用 `--shots` 传入）：
    - 四个主题各一张 `gameplay-{主题}-play.png`：迷雾开、视野 2，走过 ≥ 6 格之后，跟随视角下画面里能看到至少一颗星星，小地图有脚印和未探索区。
    - `gameplay-first-person.png`：第一人称，小地图有脚印和星星标记。
    - `gameplay-win.png`：新纪录通关层，含用时、最佳、新纪录、星星数。
    - 全部文件存在且非空才 PASS；`--write` 时在结果文件头写明请用户人工查看这些截图。
16. **b16 无报错**：以上所有新检查都用 `no_errors(errors)` 收尾：没有 `pageerror`，没有控制台 error。
