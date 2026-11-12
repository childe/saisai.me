# 迷宫迷雾模式设计

## 意图

用户原话：「迷宫增加迷雾功能，只能看到自己周围的N个格子，再添加一个按钮，迷雾范围可以增加和减少。默认周围5个格子。」

现在 `maze-gen/maze.html` 一打开就能看到整张迷宫，小朋友一眼就能找到路。迷雾模式把小人视野以外的格子盖住，让走迷宫变成边走边探索；视野大小可以用按钮调节，难度随之可调。

## 目标

- 开启迷雾时，只显示以小人为中心、半径 N 格的方形区域（行差与列差都不超过 N，即 Chebyshev 距离 ≤ N），其余格子被迷雾盖住：格子本身和格子上的墙线都看不见。
- 默认 N = 5。
- 提供一组「−」「+」按钮调节 N，中间显示当前视野数值（例如「视野 5」）。N 最小为 1，最大为 25；到达边界时对应按钮置为禁用。
- 提供一个开关按钮，在「迷雾：开」与「迷雾：关」之间切换。默认开启。关闭时迷宫完全可见，与现在行为一致；关闭时「−」「+」按钮仍可点，调好的数值下次开启时生效。
- 小人移动的每一步动画都实时更新视野（复用 `updatePlayerDisplay`，它在动画每一步都会调用）。
- 以下时机都要重新计算迷雾：小人位置变化、生成/重新生成迷宫、切换迷宫尺寸、调整 N、切换开关。
- N 与开关状态保存在 `localStorage`（读写都包在 try/catch 中，读不到时用默认值：开启、N=5），刷新页面后保持。
- 「显示道路」在迷雾下仍然生效：红色的解路径穿透迷雾显示（用户主动点了显示道路，说明想看答案）。

## 非目标

- 不做「走过的路保留可见」（已探索区域记忆）；离开视野的格子重新被盖住。
- 不做圆形视野、渐变边缘、视线遮挡（墙后面也算可见）。
- 不改迷宫生成算法、寻路、触摸手势、键盘控制。
- 不把 N 或开关写入 URL 参数。
- 不引入构建步骤、框架、npm 依赖。

## 反目标（做到了也算失败）

- 迷雾下仍能看到远处的墙线（墙线是格子内绝对定位的子元素，只改格子背景色挡不住它们）。
- 小人移动时迷雾闪烁或滞后一格。
- 50×50 迷宫下移动明显卡顿。
- 手机竖屏下新增按钮把布局挤乱或出现横向滚动。

## 方案

### 视觉

- 新增 CSS 类 `.fog`：`background-color: #444 !important;`，并用 `.cell.fog > * { visibility: hidden; }` 隐藏格子内的墙线子元素。
- `.solution` 规则需要在迷雾下仍然胜出：增加 `.cell.fog.solution { background-color: #ff0000 !important; }`（解路径格子的墙线仍隐藏，仅显示红色）。
- 小人格子永远在视野内（距离 0），不会被盖住。

### 逻辑

- 新增全局状态 `fogEnabled`（默认 true）、`fogRadius`（默认 5），常量 `FOG_MIN = 1`、`FOG_MAX = 25`。
- 纯函数 `isInFogView(row, col, playerRow, playerCol, radius)`：返回 `Math.abs(row - playerRow) <= radius && Math.abs(col - playerCol) <= radius`。
- 新增全局状态 `displayPosition`（小人当前**画在**哪一格），与 `playerPosition`（逻辑位置）区分。原因：现有 `animateStep()` 只在调用 `updatePlayerDisplay()` 的瞬间把 `playerPosition` 临时设为动画中间位置，随即恢复为起点（`maze-gen/maze.html` 约 1418–1421 行），两帧之间 `playerPosition` 是起点。若迷雾按 `playerPosition` 计算，动画进行中点「−」「+」或迷雾开关会让视野跳回起点，N 小时小人格子本身被盖住。`isMoving` 只拦截移动输入，挡不住这些按钮。
- **位置契约**：`updatePlayerDisplay()` 给格子加 `player` 类的同时，把 `displayPosition` 设为这次使用的位置；`updateFog()` 一律以 `displayPosition` 为中心，不读 `playerPosition`。无论 `updateFog()` 由动画帧、按钮还是生成迷宫触发，迷雾中心与小人画的位置始终一致。
- `updateFog()`：遍历所有 `.cell`，按 index 算出 row/col；若 `fogEnabled` 且不在以 `displayPosition` 为中心的视野内则加 `fog` 类，否则移除。
- 在 `updatePlayerDisplay()` 末尾（设置 `displayPosition` 之后）调用 `updateFog()`。动画中途 `updatePlayerDisplay` 使用临时位置，`displayPosition` 与迷雾逐步跟随，并在两帧之间保持为最近一次画出的位置。
- `generateMaze()` 已调用 `updatePlayerDisplay()`，因此生成/重新生成/切换尺寸会自动刷新迷雾。
- `changeFogRadius(delta)`：把 `fogRadius` 加 delta 后夹在 `[FOG_MIN, FOG_MAX]`，保存、刷新按钮显示、调用 `updateFog()`。
- `toggleFog()`：翻转 `fogEnabled`，保存、刷新按钮文字、调用 `updateFog()`。
- 页面初始化（`DOMContentLoaded`）时先从 `localStorage` 读出状态并刷新按钮显示，再生成迷宫。读出的 N 若不是 `[1, 25]` 内的整数，回退为 5。

### 界面

在尺寸按钮行与迷宫之间新增一行 `.fog-controls`：

```
[迷雾：开]   [−]  视野 5  [+]
```

- 开关按钮与「−」「+」沿用页面现有按钮风格；「−」「+」为方形小按钮（不受全局 `min-width: 120px` 影响），保证手指可点（至少 44px）。
- 该行用 flex 居中、允许换行，手机竖屏不产生横向滚动。
- 页面底部提示文字补一句：「开启迷雾后只能看到小人周围的格子，可用 − / + 调节视野」。

### 性能

50×50 = 2500 个格子，每步动画遍历一次。先用最简单的全量遍历 + `classList.toggle(name, force)`，不预先做格子缓存或区域差量更新。单步耗时尚未实测，列为验收项：在 50×50 迷宫下用 `performance.now()` 包住 `updateFog()`，测量动画期间单次耗时（桌面浏览器与手机浏览器各测一次）。单次不超过 16ms 则保留全量遍历；超过则改为缓存 `.cell` 列表，仍超过再改为只更新新旧视野并集的差量更新。

## 测试

- 在 `tests/` 下新增 `maze-fog.test.mjs`（`node --test` 运行，与 `homepage.test.mjs` 同风格，读取 HTML 源码）：
  - 从 `maze.html` 中提取 `isInFogView` 函数源码并求值，验证边界：距离恰为 N 可见、N+1 不可见、对角线按 Chebyshev 计算。
  - 校验 HTML 中存在迷雾开关按钮、「−」「+」按钮及视野数值元素，默认值为 5。
  - 校验 `.fog` 相关 CSS 规则存在（含隐藏子元素的规则）。
  - 校验 `FOG_MIN = 1`、`FOG_MAX = 25`、默认 `fogRadius = 5`。
  - **行为测试**（不引入 npm 依赖）：用 `node:vm` 执行从 `maze.html` 提取的 `updatePlayerDisplay`、`updateFog`、`animatePlayerMovement`、`changeFogRadius`、`toggleFog` 源码，配最小假 DOM（`document.querySelectorAll('.cell')` 返回带 `classList` 的假格子数组）、手动推进的假 `setTimeout` 和假 `localStorage`。覆盖：
    - 多格移动动画走到中途（已离开起点至少 2 格）时调用 `changeFogRadius` 把 N 调到 1：迷雾中心是当前显示位置而不是起点，小人所在格子没有 `fog` 类。
    - 动画中途调用两次 `toggleFog()`（关再开）：结果同上。
    - 动画结束后迷雾中心等于终点。
    - `fogEnabled = false` 时所有格子都没有 `fog` 类。
    - `localStorage` 读写抛异常时使用默认值（开启、N=5），不报错。
- 浏览器验收：
  - 方向键与滑动移动，视野逐步跟随小人，无闪烁、不滞后一格。
  - 多格移动动画进行中点「−」「+」和迷雾开关，视野不跳回起点，小人不被盖住。
  - 「−」「+」到边界时按钮禁用；关闭迷雾后迷宫完全可见；刷新后状态保持。
  - 重新生成迷宫、切换迷宫尺寸后，迷雾按新起点 (0,0) 覆盖。
  - 显示道路时红色路径穿透迷雾；隐藏道路后这些格子恢复为迷雾。
  - 迷雾格子上看不到墙线。
  - 手机竖屏（宽 375px）下迷雾按钮行不挤乱布局、无横向滚动。
  - 按「性能」一节测量 50×50 下 `updateFog()` 单次耗时并记录。
