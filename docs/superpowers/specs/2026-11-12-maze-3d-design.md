# 3D 迷宫设计

## 意图

用户原话：「我们再做一个3D迷宫，使用webgl」。在可行性讨论中用户同意了以下约定：使用放在仓库里的 three.js（不依赖外部 CDN）；复用现有 2D 迷宫的生成器，同 seed 同迷宫；默认斜上方跟随视角，可切换第一人称（第一人称配小地图）；键盘方向键 / WASD 与触屏方向按钮操控，不能穿墙；支持迷雾且视野可调；默认较小尺寸；低端设备降画质。

使用者主要是一年级小朋友（在 iPad / 手机 / 电脑上玩），其次是大人。3D 迷宫要「一看就会玩、玩起来不晕」。

## 目标

- 新页面 `maze-3d/index.html`，用 WebGL（three.js）渲染一张 3D 迷宫：地板、立体墙、起点、终点、小人。
- 迷宫数据与 2D 迷宫生成器完全一致：同一个 `seed` 与尺寸，3D 与 2D 生成的 `connections` 逐格相同。
- 两种视角，用一个按钮切换：
  - **跟随视角（默认）**：相机在小人斜上方、固定朝北（屏幕上方 = 迷宫上方），平滑跟随小人。方向键含义与 2D 一致（上就是往屏幕上方走），不会转晕。
  - **第一人称**：相机在小人眼睛高度，朝小人面朝的方向。右上角显示小地图（2D 俯视，标出小人位置与朝向）。
- 移动按「格」进行，与 2D 页面一致：按一次方向，小人沿该方向走到下一个路口（复用 2D 的「走到下一个路口」规则），带平滑动画。撞墙方向不动。不做连续物理移动，因此不存在穿墙。
  - 跟随视角：上 / 下 / 左 / 右 = 往北 / 南 / 西 / 东走，小人转身朝向移动方向。
  - 第一人称：上 = 朝前走；左 / 右 = 原地左转 / 右转 90°（带转身动画）；下 = 原地掉头 180°。
- 操控：键盘方向键与 WASD；触屏在画面下方显示四个方向按钮（每个至少 56×56px）。电脑上同样显示按钮，可以用鼠标点。
- 到达终点（右下角格）时显示「恭喜！你成功走出了迷宫！」的页面内提示层（不用 `alert`），带「再来一局」按钮（生成新 seed）。
- 尺寸按钮：10×10、15×15、20×20，默认 10×10。
- 「重新生成」按钮：换新 seed，写回 URL 参数 `seed`。页面支持 `?seed=&size=` 参数，打开同一张迷宫。
- 「显示道路 / 隐藏道路」按钮：在地板上用红色标出从小人当前位置到终点的路径（复用 2D 的寻路结果格式）。
- 迷雾：与 2D 迷雾语义一致——只显示以小人为中心、Chebyshev 距离 ≤ N 的格子；视野外的墙隐藏、地板变成深色。默认开启、N = 5，可用「−」「+」在 1–25 之间调节，到边界时按钮禁用。开关与 N 保存在 `localStorage`（键名与 2D 页面不同，互不影响，读写包 try/catch）。第一人称下另加 three.js 距离雾（`THREE.Fog`）营造氛围，远端与 N 对应。
- 首页 `index.html` 新增第 7 张卡片「3D 迷宫」，链接 `maze-3d/index.html`，配一幅等轴测立体迷宫插图（内联 SVG，风格与现有卡片一致），描述「立体迷宫 走出去」。
- README 的项目列表新增一条 3D 迷宫。
- 设备不支持 WebGL 时，页面显示「这个设备不支持 3D，可以玩 2D 迷宫」及指向 `../maze-gen/maze.html` 的链接，不白屏。

## 非目标

- 不改 2D 迷宫页面 `maze-gen/maze.html` 的任何内容。
- 不做连续自由移动、跳跃、鼠标拖拽转视角、陀螺仪。
- 不做声音、计时、计分、排行榜。
- 不做阴影、贴图、后期效果；材质用纯色 + 简单光照。
- 不做已探索区域记忆。
- 不引入构建步骤、框架；不新增 `package.json`。

## 反目标（做到了也算失败）

- 页面依赖任何外部 URL（CDN、字体、图片）。
- 同一 seed 下 3D 与 2D 的迷宫不一样。
- 小人能穿过墙，或能走到 2D 里走不到的格子。
- 跟随视角下按「上」小人却往屏幕其他方向走。
- 中端手机（例如 iPhone SE 级别）上 20×20 迷宫移动动画明显卡顿（持续低于 30fps）。
- 手机竖屏下方向按钮遮住小人，或出现横向滚动。

## 方案

### 文件结构

```
maze-3d/
  index.html            页面骨架、样式、按钮；<script type="module" src="main.js">
  maze-core.js          ES module：SeededRandom、MazeGenerator（从 2D 页面原样复制）
  game-logic.js         ES module，纯函数：canMove、findNextIntersection、findPath、turn、isInFogView、clampRadius
  main.js               ES module：three.js 场景、相机、动画、UI 绑定、localStorage
  vendor/three.module.js       three.js 官方构建入口，固定版本 0.187.0（r187）
  vendor/three.core.js         同版本核心模块，被 three.module.js 以 `./three.core.js` 相对导入
  vendor/LICENSE               three.js 的 MIT 许可证
  README.md             一句话说明
```

- `maze-core.js` 与 `game-logic.js` 不碰 DOM 与 three.js，可在 node 中直接 `import` 测试。
- `main.js` 用相对路径 `import * as THREE from './vendor/three.module.js'`。r187 的入口模块依赖同目录的 `three.core.js`，两个文件必须来自同一版本、一起放入 `vendor/`，不改动其内部 import 路径。
- ES module 无法通过 `file://` 加载；站点经 GitHub Pages 以 http(s) 提供，本地测试用 `python3 -m http.server`。

### 与 2D 生成器保持一致

`maze-core.js` 中的 `SeededRandom` 与 `MazeGenerator` 从 `maze-gen/maze.html` 原样复制（只加 `export`）。用测试锁定一致性：测试从 `maze.html` 源码中截取这两个类，在 `node:vm` 中求值，与 `maze-core.js` 对多组 (seed, size) 比较 `generate()` 的输出，必须深度相等。2D 以后改了生成器而 3D 没跟上，这个测试会失败。

`findNextIntersection` 复制 2D 的逻辑改为接收参数的纯函数，测试对多组 seed 比较结果与 2D 一致。

`findPath` **不**照搬 2D：2D 的 `findPath` 固定从 `[0,0]` 出发，并额外拒绝 `maze !== 0` 的格子，而 2D 的移动只看双向 `connections`（例如 seed=1、size=10 时，从入口可走到的 `(3,6)` 的 `maze` 值为 1）。小人离开起点后照搬会找不到路。3D 定义 `findPath(connections, start, end)`：BFS，相邻判定与移动、墙体生成共用同一个 `canMove(connections, from, to)`（仅看双向 `connections` 与边界）。测试要求：对多组 seed，从入口出发经 `findNextIntersection` 实际走到的若干位置调用 `findPath`，结果首格为当前位置、末格为终点、每相邻两格 `canMove` 为真。不再要求与 2D 寻路逐格一致。

### 场景

- 1 格 = 1 个世界单位。格子 (row, col) 中心在 `(col + 0.5, 0, row + 0.5)`，北为 −z。
- 墙：对每对相邻格子，若 `canMove` 为假，在两格之间放一段墙；外边界除入口（左上格的上 / 左边）与出口（右下格的下 / 右边）外都放墙。墙厚 0.1、高 0.8。所有墙段用一个 `InstancedMesh`（一次绘制调用）。
- 地板：每格一块，`InstancedMesh` + `instanceColor`：普通格浅色，起点格绿色，终点格红色，视野外格深灰 `#333`，解路径格红色（显示道路时，优先级高于迷雾）。
- 小人：球形身体 + 两只眼睛（眼睛表示朝向），颜色醒目。终点格上方放一颗缓慢旋转的黄色星星。
- 光照：一盏环境光 + 一盏方向光；不开阴影。
- 迷雾隐藏墙：视野外的墙实例把矩阵缩放设为 0。只在小人「所在格」变化、N 变化、开关变化、生成迷宫时重算一次，不是每帧都算。
- 动画中途的格子位置：移动动画按格推进，每到达一个新格就更新「显示格」，迷雾按显示格计算（与 2D 设计中的 `displayPosition` 相同）。

### 交互状态

游戏状态只有四种：`idle`、`moving`、`turning`、`won`。

- 只有 `idle` 接受方向输入；`moving` / `turning` 期间的方向输入直接丢弃（不排队），`won` 期间忽略方向输入。
- 移动 / 转身动画结束时回到 `idle`；到达终点格时进入 `won` 并显示提示层。
- 每次生成迷宫（切尺寸、重新生成、再来一局）递增一个 `generation` 计数，并把状态重置为 `idle`、小人回入口、朝向南。动画回调先比对自己启动时的 `generation`，不一致即放弃，不写回小人位置、迷雾或小地图。
- 视角切换在任何状态下都可点：立即取消进行中的动画，小人落到当前「显示格」，状态回 `idle`，再切换相机。

### 相机

- 跟随视角：相机位于小人位置 + `(0, h, d)`（`h`、`d` 随 N 略增，保证能看到视野内的格子），看向小人；每帧用插值平滑跟随。
- 第一人称：相机在小人格中心、高 0.45，朝向小人面朝方向；转身用 200ms 插值。小人模型在第一人称下隐藏。
- 小地图：右上角 `<canvas>`（约 140×140px），只画视野内已显示的墙（迷雾关闭时画全图）、小人位置与朝向箭头；随移动刷新。

### 画质

- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`，不开抗锯齿以外的特效。
- 自动降画质：连续 2 秒平均帧时间超过 33ms 时，把像素比降到 1 并关闭抗锯齿（重建 renderer），只降一次。
- 页面不可见时（`visibilitychange`）停止渲染循环。

### 界面布局

自上而下：标题「3D 迷宫」→ 尺寸按钮行 → 视角 / 迷雾 / 视野行 → 画布（宽度 100%，高度约为视口的 60%）→ 方向按钮（十字排列）→ 重新生成 / 显示道路 / 隐藏道路 → 操作提示。小屏下各行 flex 换行，不产生横向滚动。按钮风格沿用 2D 页面。页面左上角放「← 首页」链接。

## 测试

自动测试（`node --test tests/`，不加 npm 依赖）：

- `tests/maze-3d-core.test.mjs`：
  - 多组 (seed, size)（含 10、15、20）下 `maze-core.js` 与 `maze.html` 中的生成器输出深度相等。
  - `findPath`：从多个实际可达位置出发，路径首格为起点、末格为终点、每一步 `canMove` 为真。
  - `canMove` / `findNextIntersection`：边界、墙、入口出口外沿不可走出迷宫。
  - 第一人称 `turn`：左转、右转、掉头四个朝向循环正确。
  - `isInFogView` 边界：距离 N 可见、N+1 不可见；`clampRadius` 夹在 [1, 25]，非法输入回退 5。
- `tests/maze-3d-page.test.mjs`（读取源码的静态检查）：
  - `maze-3d/` 下所有文件不含 `http://`、`https://`、`//` 开头的外部引用。
  - `vendor/three.module.js` 与 `vendor/three.core.js` 存在且版本均为 r187；`three.module.js` 只以 `./three.core.js` 相对导入；`main.js` 以相对路径引入 `./vendor/three.module.js`；`vendor/LICENSE` 存在。
  - 页面含尺寸、视角、迷雾开关、「−」「+」、方向按钮、重新生成、显示 / 隐藏道路等控件；不含 `alert(`。
  - 存在 WebGL 不支持时的降级文案与指向 2D 迷宫的链接。
- `tests/homepage.test.mjs`：卡片数改为 7，`EXPECTED` 与描述数组加上 `['maze3d', 'maze-3d/index.html', '3D 迷宫']` 与「立体迷宫 走出去」，其余首页约束（无外部请求、无脚本、SVG 有 viewBox 等）对新卡片同样成立。

浏览器验收（Playwright 驱动 Chromium，`python3 -m http.server` 提供页面，固定 seed；记录到 test-results.txt）：

1. 页面加载无控制台错误，画布非空白（截图中像素不全是同一种颜色）。
2. 跟随视角下按方向键 / 点方向按钮，小人位置与 `findNextIntersection` 结果一致；往墙走不动。
3. 切换到第一人称：上 = 前进，左右转向，下掉头；小地图显示并随移动更新。
4. 迷雾：视野外墙实例被隐藏、地板变深；「−」「+」到 1 / 25 禁用；关闭后全图可见；刷新后保持。
5. 显示道路：路径格为红色；隐藏后恢复。
6. 走到终点显示恭喜提示层，「再来一局」生成新迷宫并更新 URL。
7. 同 seed 跨页面一致：用 `?seed=S` 打开 2D 页面，`page.evaluate` 调用其 `setMazeSize(size)`（size 取 2D 已有的 10 与 20）后读 `currentConnections`；用 `?seed=S&size=size` 打开 3D 页面取出 `connections`，两者深度相等。15×15 在 2D 页面无尺寸按钮，由自动测试中 `node:vm` 隔离求值两边生成器覆盖。不修改 2D 页面。
8. 375px 宽：无横向滚动，方向按钮不遮挡画布中心。
9. 性能（回归基线）：20×20、iPhone SE 设备模拟 + 4 倍 CPU 降速下，连续移动 10 步期间记录帧时间分布，平均 ≤ 33ms 且 p95 ≤ 50ms；同时记录桌面数据。
10. 用 `--disable-webgl` 启动浏览器打开页面，显示降级文案与 2D 链接。
11. 动画中途切尺寸 / 重新生成 / 切视角：旧动画不再改变新迷宫中小人的位置；连续快速按键时小人每次只走一段。
12. 离线加载：所有模块请求（`main.js`、`maze-core.js`、`game-logic.js`、`vendor/three.module.js`、`vendor/three.core.js`）均为本地 200；拦截全部非本地请求后页面仍正常渲染。

真机验收（人工，一次）：在至少一台实际 iPhone 或 iPad 上，20×20 迷宫在跟随视角与第一人称下各连续移动、转身 10 次，确认无明显卡顿；如触发自动降画质，确认降级后可正常游玩。在 test-results.txt 记录设备型号、系统与浏览器版本、是否触发降级，以及页面内统计的帧时间平均值与 p95。
