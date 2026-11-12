# 3D 迷宫纹理主题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `maze-3d` 加四种可切换主题（花园树篱 / 砖墙 / 彩色积木 / 石头城堡）。墙面、墙顶、地板用运行时 Canvas 纹理，天空、光照、雾色随主题变化。切换主题不影响游戏状态。

**Architecture:** 新增纯数据 + 纯绘制模块 `maze-3d/themes.js`（不依赖 three.js 和 DOM，可在 node 中测试）。新增纯函数模块 `maze-3d/wall-geometry.js`，负责墙几何的面分组重排与 UV 缩放（同样可在 node 中测试）。`main.js` 负责把这两个模块接到 three.js 上：生成 `CanvasTexture`、两材质 `InstancedMesh`、`HemisphereLight`、渐变天空，并提供 `applyTheme(id)` 与调试接口。浏览器验收脚本 `tests/browser/maze3d_accept.py` 新增 `t*` 系列检查。

**Tech Stack:** 原生 ES module + three.js r187（`maze-3d/vendor/`，已有）+ Canvas 2D；`node --test`；Python Playwright + Pillow（`~/tmp/fuck/c/.venv`）。

**Spec:** `/Users/jialiu/Projects/saisai.me/.worktrees/20261113-001535-maze-3d-themes/docs/superpowers/specs/2026-11-13-maze-3d-themes-design.md`

## Global Constraints

- 只改 `maze-3d/`、`tests/` 下的文件，以及根 `README.md` 的 3D 迷宫一行。不改 `maze-3d/game-logic.js`、`maze-3d/maze-core.js`、`maze-gen/`。
- 不引入图片文件，不加 npm 依赖，不加 URL 参数，不引用外部 URL。
- 主题 id 只有 `garden`、`brick`、`blocks`、`castle`；默认 `garden`。
- `localStorage` 键为 `maze3d.theme`。读写一律走 `main.js` 已有的 `storageGet` / `storageSet`（内部已有 try/catch）。
- 按钮文字（逐字）：`🌳 花园`、`🧱 砖墙`、`🧸 积木`、`🏰 城堡`。
- 纹理尺寸：墙面、墙顶、地板都是 256×256；天空是 2×256。`colorSpace = THREE.SRGBColorSpace`。墙和地板纹理开 mipmap，`wrapS/wrapT = RepeatWrapping`，`anisotropy = quality === 'high' ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1`。
- 墙尺寸不变：`BoxGeometry(1.1, 0.8, 0.1)`。
- 起点 / 终点 / 道路 / 迷雾色沿用 `COLORS.start/end/path/fog`（`0x4caf50`、`0xe53935`、`0xff6b6b`、`0x333333`）。只有普通格改为主题的 `floorBase`。
- 小人、终点星星、小地图的外观不变。
- 绘制函数只允许调用这些 Canvas 2D 方法：`fillRect`、`strokeRect`、`clearRect`、`beginPath`、`closePath`、`moveTo`、`lineTo`、`arc`、`ellipse`、`rect`、`quadraticCurveTo`、`fill`、`stroke`、`save`、`restore`、`translate`、`rotate`；属性只设 `fillStyle`、`strokeStyle`、`lineWidth`、`globalAlpha`、`lineCap`、`lineJoin`。测试中的假上下文遇到其他方法会抛错。
- JS 沿用现有风格（2 空格、单引号、分号）。修改 Python 文件后用 `~/tmp/fuck/c/.venv/bin/black`（没有就用 `/opt/homebrew/bin/black`）格式化。
- 不要 `git commit`，不要 `git push`。提交由编排器统一做。每个任务结束时只保证工作区里的改动完整、测试通过。
- 单元测试命令（在 worktree 根目录执行）：`node --test tests/`。
- 浏览器验收命令：`~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py [--only ...]`。不要往 `~` 下 `npm install`。

## Review Focus

1. 存储被禁用（`getItem` / `setItem` 抛异常），或存了非法值（`'foo'`、`'GARDEN'`、`''`）时：页面以花园主题启动，点主题按钮正常切换，没有控制台错误。测试在 Task 5（`t4`）。
2. 先切到积木主题，再「重新生成」或改尺寸（15×15）：新迷宫的墙仍按积木调色板着色，`textureCount` 仍为 4，没有重建纹理。测试在 Task 5（`t1`）。
3. 再次点击当前已高亮的主题：不重建纹理（`textureStats.builds` 不变），`textureCount` 不变。测试在 Task 5（`t1`）。
4. 开着道路 / 迷雾时切换主题：道路格仍是 `#ff6b6b`，迷雾格仍是 `#333333`，普通格变成新主题的 `floorBase`；第一人称转身动画中途切换，转身照常完成。测试在 Task 5（`t1`、`t3`）。
5. 自动降画质换了新 renderer 之后：主题纹理仍显示（新 renderer 重新上传纹理），`anisotropy` 降为 1，之后新建的主题纹理也是 1。测试在 Task 7（`t7b`）。

---

## 文件结构

- Create `maze-3d/themes.js`：主题数据、`parseTheme`、确定性哈希、三个纹理绘制函数。
- Create `maze-3d/wall-geometry.js`：`BoxGeometry` 面分组重排与 UV 缩放（只处理数组，不 import three）。
- Modify `maze-3d/main.js`：主题纹理生命周期、两材质墙、半球光、渐变天空、雾色、`applyTheme`、主题按钮、调试接口。
- Modify `maze-3d/index.html`：在 `#view-row` 之后加 `#theme-row`，加 `.theme-btn` 样式。
- Modify `README.md`（根目录）：3D 迷宫一行补「四种主题可切换」。
- Create `tests/maze-3d-themes.test.mjs`、`tests/maze-3d-wall-geometry.test.mjs`。
- Modify `tests/maze-3d-page.test.mjs`。
- Modify `tests/browser/maze3d_accept.py`、`tests/browser/test-results.txt`。

---

### Task 1: `themes.js` 主题数据、哈希与纹理绘制

**Files:**
- Create: `maze-3d/themes.js`
- Test: `tests/maze-3d-themes.test.mjs`

**Interfaces:**
- Produces:
  - `export const THEME_IDS = ['garden', 'brick', 'blocks', 'castle'];`
  - `export const DEFAULT_THEME = 'garden';`
  - `export function parseTheme(value: unknown): string`：严格相等匹配 `THEME_IDS`，否则返回 `'garden'`。
  - `export const THEMES: Record<id, Theme>`，`Theme` 结构如下。颜色都是 `0xRRGGBB` 整数，强度都是正数：
    ```
    { label: string,
      sky: { top: number, bottom: number },
      fogColor: number,                      // 恒等于 sky.bottom
      hemi: { sky: number, ground: number, intensity: number },
      sun: { color: number, intensity: number },
      floorBase: number,
      wallTint: number,
      blockPalette?: number[] }              // 只有 blocks 有，长度 5
    ```
  - `export function blockColorIndex(segmentIndex: number, paletteLength: number): number`
  - `export function wallShade(segmentIndex: number): number`，取值范围 `[0.92, 1.0]`
  - `export function paintWall(id: string, ctx: CanvasRenderingContext2D, size: number): void`
  - `export function paintWallTop(id, ctx, size): void`
  - `export function paintFloor(id, ctx, size): void`
  - 三个绘制函数开头都先执行 `id = parseTheme(id)`，非法 id 按花园画。

- [ ] **Step 1: 写失败测试 `tests/maze-3d-themes.test.mjs`**

测试文件里定义 `fakeCtx()`：用 `Proxy` 记录每次方法调用 `[name, ...args]`，以及每次属性赋值 `['set', prop, value]`。允许的方法和属性见 Global Constraints，其他方法调用直接 `throw`。测试用例：

```js
test('theme ids', () => {
  assert.deepEqual(THEME_IDS, ['garden', 'brick', 'blocks', 'castle']);
  assert.equal(DEFAULT_THEME, 'garden');
  for (const id of THEME_IDS) assert.equal(parseTheme(id), id);
  for (const bad of [null, undefined, '', 'GARDEN', 'foo', 1, {}]) assert.equal(parseTheme(bad), 'garden');
});

test('theme data complete', () => {
  const isColor = (c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;
  const labels = { garden: '🌳 花园', brick: '🧱 砖墙', blocks: '🧸 积木', castle: '🏰 城堡' };
  assert.deepEqual(Object.keys(THEMES).sort(), [...THEME_IDS].sort());
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.equal(t.label, labels[id]);
    for (const c of [t.sky.top, t.sky.bottom, t.fogColor, t.hemi.sky, t.hemi.ground, t.sun.color, t.floorBase, t.wallTint]) assert.ok(isColor(c), `${id} ${c}`);
    assert.equal(t.fogColor, t.sky.bottom);
    assert.ok(t.hemi.intensity > 0 && t.sun.intensity > 0);
  }
  assert.equal(THEMES.blocks.blockPalette.length, 5);
  assert.ok(THEMES.blocks.blockPalette.every(isColor));
  for (const id of ['garden', 'brick', 'castle']) assert.equal(THEMES[id].blockPalette, undefined);
});

test('blockColorIndex deterministic and uniform', () => {
  const counts = [0, 0, 0, 0, 0];
  let sameAdjacent = 0;
  for (let i = 0; i < 1000; i++) {
    const k = blockColorIndex(i, 5);
    assert.equal(k, blockColorIndex(i, 5));
    assert.ok(Number.isInteger(k) && k >= 0 && k < 5);
    counts[k]++;
    if (i > 0 && k === blockColorIndex(i - 1, 5)) sameAdjacent++;
  }
  for (const c of counts) assert.ok(c >= 100 && c <= 300, `count ${c}`);
  assert.ok(sameAdjacent <= 350, `sameAdjacent ${sameAdjacent}`);
});

test('wallShade deterministic in range', () => {
  for (let i = 0; i < 1000; i++) {
    const s = wallShade(i);
    assert.equal(s, wallShade(i));
    assert.ok(s >= 0.92 && s <= 1.0);
  }
});

test('paint functions deterministic and draw', () => {
  for (const fn of [paintWall, paintWallTop, paintFloor])
    for (const id of [...THEME_IDS, 'nope']) {
      const a = fakeCtx(); fn(id, a.ctx, 256);
      const b = fakeCtx(); fn(id, b.ctx, 256);
      assert.ok(a.calls.some(([n]) => n === 'fillRect'), `${fn.name} ${id}`);
      assert.ok(a.calls.length >= 20);
      assert.deepEqual(a.calls, b.calls);
    }
  const g = fakeCtx(); paintWall('garden', g.ctx, 256);
  const n = fakeCtx(); paintWall('nope', n.ctx, 256);
  assert.deepEqual(n.calls, g.calls);
});

test('themes.js has no three/DOM dependency', () => {
  const src = readFileSync(join(here, '..', 'maze-3d', 'themes.js'), 'utf8');
  assert.doesNotMatch(src, /\bimport\b/);
  assert.doesNotMatch(src, /\b(document|window|THREE)\b/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/maze-3d-themes.test.mjs`
Expected: FAIL，报 `Cannot find module .../maze-3d/themes.js`

- [ ] **Step 3: 实现 `maze-3d/themes.js`**

哈希与随机数：
- `hash32(n)`：murmur3 fmix32（`h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0`）。
- `blockColorIndex(i, n) = hash32(i + 0x9e37) % n`。
- `wallShade(i) = 0.92 + 0.08 * (hash32(i + 0x51ed) / 0xffffffff)`。
- 绘制函数内部用 mulberry32 PRNG。种子在每次调用时按 `(主题, 表面)` 固定，例如 `hash32(themeIndex * 3 + surfaceIndex + 1)`。不得用 `Math.random`。

主题数据起始值如下。Task 6 的 `t5`（语义色距离）和 `t2`（墙面对比度）是最终判定。这两项不过时只调整强度、`floorBase` 和纹理明暗，不改结构：

| id | sky.top / sky.bottom | hemi sky / ground / intensity | sun color / intensity | floorBase | wallTint | blockPalette |
|---|---|---|---|---|---|---|
| garden | `0x7ec8f5` / `0xd8f0ff` | `0xffffff` / `0xb7d9a0` / 2.0 | `0xfff4e0` / 1.0 | `0xfffaf0` | `0xffffff` | — |
| brick | `0x8fc4f0` / `0xffe2c4` | `0xfff3e0` / `0xc9a68a` / 2.0 | `0xffe8c8` / 1.0 | `0xf7f3ee` | `0xffffff` | — |
| blocks | `0x9fd8ff` / `0xe8f7ff` | `0xffffff` / `0xdde6f0` / 2.1 | `0xffffff` / 1.0 | `0xf4f6f8` | `0xffffff` | `[0xef5350, 0xffca28, 0x42a5f5, 0x66bb6a, 0xffa726]` |
| castle | `0x5d7290` / `0xa9b8cc` | `0xdfe6f0` / `0x6b6f78` / 1.9 | `0xfff0dc` / 0.9 | `0xaeb3bc` | `0xffffff` | — |

城堡的「深色石板」只靠 `floorBase` 压暗普通格，地板纹理本身仍保持浅色。原因：起点 / 终点 / 道路格是语义色乘以同一张地板纹理，纹理变暗会让终点红与道路红的距离掉到 60 以下（两者原始 RGB 距离只有约 77）。

纹理内容约束（`size` = 256；画布坐标 y 向下）：
- **墙面 `paintWall`**：横向必须无缝平铺（x=0 与 x=256 处图案连续），因为相邻墙段首尾相接。亮、暗两类元素各占面积 ≥10%，保证贴墙时亮度 5%–95% 分位差 ≥40。
  - garden：深绿底，铺满 3–4 种绿色叶片椭圆（亮度跨度约 40–170），约 2% 面积是白 / 黄 / 粉小花点。
  - brick：错缝砌法。砖 64×32 px（对应世界尺寸 0.275×0.1，比例不被拉伸），奇数行偏移 32 px，砖缝 4 px 深灰（亮度 ≤70）。每块砖在 3–4 种红褐色中按 PRNG 取色。
  - blocks：只画灰度（颜色由实例色乘上）。浅灰底（亮度 ≥200），用深灰分块线分成 2 块积木（竖线在 x=0 与 x=128），每块左上沿画白色圆角高光、右下沿画暗边。
  - castle：大小不一的矩形石块（宽 40–90 px，高 28–48 px，按行排布），灰度 110–190，石缝深色（亮度约 50），宽 4 px。
- **墙顶 `paintWallTop`**：图案纵向以 32 px 为周期重复。墙顶 UV 的 V 只占 0–0.125（Task 2），即只显示 32 px 高的条带，所以任意 32 px 条带看起来都要一致。横向无缝。
  - garden：比墙面更深的绿叶。
  - brick：米色压顶石（底色约 `#e8dcc0`），每 64 px 一条接缝。
  - blocks：浅灰底，每 64 px 一个直径约 20 px 的凸点圆（带高光），纵向居中于每个 32 px 条带。
  - castle：深灰石（灰度约 80–110），带接缝。
- **地板 `paintFloor`**：整张一个格子（地板顶面 UV 为 0–1）。底色亮度 ≥225（0–255）。深色细节（石子轮廓、石板缝、凸点阴影）总面积 ≤15%，且最暗处亮度 ≥150。
  - garden：浅米色底 + 圆形 / 椭圆浅色石子，石子带淡轮廓。
  - brick：2×2 方形石板（缝在 x/y = 0、128）。
  - blocks：浅灰底 + 4×4 凸点圆（带高光与淡阴影）。
  - castle：3–4 块不规则大石板，浅灰底、浅缝。

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/maze-3d-themes.test.mjs`
Expected: PASS（6 个测试）

---

### Task 2: `wall-geometry.js` 墙几何的分组与 UV

**Files:**
- Create: `maze-3d/wall-geometry.js`
- Test: `tests/maze-3d-wall-geometry.test.mjs`

**Interfaces:**
- 背景：three r187 的 `BoxGeometry(1.1, 0.8, 0.1)` 有 24 个顶点、36 个索引。面的顺序是 px、nx、py、ny、pz、nz。第 f 个面占顶点 `4f..4f+3`、索引 `6f..6f+5`，默认分组为 `{start: 6f, count: 6, materialIndex: f}`。px/nx 面的 u 沿 z（深 0.1）、v 沿 y（高 0.8）；py/ny 面的 u 沿 x（宽 1.1）、v 沿 z（深 0.1）；pz/nz 面的 u 沿 x、v 沿 y。
- Produces:
  - `export function wallGroupLayout(index: ArrayLike<number>): { index: number[], groups: {start:number,count:number,materialIndex:number}[] }`：新索引依次为面 px、nx、ny、pz、nz 的 6 个索引，然后是 py 的 6 个。分组固定为 `[{start:0,count:30,materialIndex:0},{start:30,count:6,materialIndex:1}]`。
  - `export function wallUvScale(face: number, dims = { w: 1.1, h: 0.8, d: 0.1 }): [number, number]`：px/nx（0、1）→ `[d/w, 1]`；py/ny（2、3）→ `[1, d/h]`；pz/nz（4、5）→ `[1, 1]`。
  - `export function applyWallUvs(uv: Float32Array | number[], dims?): void`：原地把面 f 的 4 个顶点的 u、v 分别乘以 `wallUvScale(f, dims)`。

- [ ] **Step 1: 写失败测试**

```js
test('group layout puts top face last', () => {
  const idx = Array.from({ length: 36 }, (_, i) => i);
  const { index, groups } = wallGroupLayout(idx);
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  assert.deepEqual(index, [...range(0, 12), ...range(18, 36), ...range(12, 18)]);
  assert.deepEqual(groups, [
    { start: 0, count: 30, materialIndex: 0 },
    { start: 30, count: 6, materialIndex: 1 },
  ]);
});

test('uv scale by world size', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  for (const f of [0, 1]) { const [u, v] = wallUvScale(f); close(u, 0.1 / 1.1); close(v, 1); }
  for (const f of [2, 3]) { const [u, v] = wallUvScale(f); close(u, 1); close(v, 0.125); }
  for (const f of [4, 5]) assert.deepEqual(wallUvScale(f), [1, 1]);
});

test('applyWallUvs scales in place', () => {
  const uv = new Float32Array(48).fill(1);
  applyWallUvs(uv);
  assert.ok(Math.abs(uv[0] - 0.1 / 1.1) < 1e-6 && uv[1] === 1);      // px 顶点 0
  assert.ok(uv[16] === 1 && Math.abs(uv[17] - 0.125) < 1e-6);         // py 顶点 8
  assert.ok(uv[32] === 1 && uv[33] === 1);                             // pz 顶点 16
});

test('wall-geometry.js has no imports', () => {
  assert.doesNotMatch(readFileSync(join(here, '..', 'maze-3d', 'wall-geometry.js'), 'utf8'), /\bimport\b/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/maze-3d-wall-geometry.test.mjs`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现 `maze-3d/wall-geometry.js`**（三个导出函数，签名见 Interfaces）

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/maze-3d-wall-geometry.test.mjs`
Expected: PASS（4 个测试）

---

### Task 3: 页面主题按钮行与静态检查

**Files:**
- Modify: `maze-3d/index.html`（`<style>` 中 `.size-btn.active` 规则一带；`#view-row` 之后）
- Modify: `README.md`（「🧊 3D 迷宫」条目说明）
- Modify: `tests/maze-3d-page.test.mjs`

**Interfaces:**
- Produces（DOM，Task 4/5 使用）：
  - `<div class="row" id="theme-row">`，紧跟在 `#view-row` 之后
  - 四个按钮：`<button class="theme-btn" id="theme-garden" data-theme="garden">🌳 花园</button>`，以及 `theme-brick` / `🧱 砖墙`、`theme-blocks` / `🧸 积木`、`theme-castle` / `🏰 城堡`，按此顺序排列。HTML 里初始都不带 `active`（由 `main.js` 设置）。

- [ ] **Step 1: 在 `tests/maze-3d-page.test.mjs` 加失败测试**

- `OWN` 数组加入 `'themes.js'`、`'wall-geometry.js'`（这样已有的 `no external references` 测试会覆盖这两个文件）。
- 新测试：

```js
test('theme buttons', () => {
  const html = read('index.html');
  const ids = ['garden', 'brick', 'blocks', 'castle'];
  const labels = ['🌳 花园', '🧱 砖墙', '🧸 积木', '🏰 城堡'];
  let last = html.indexOf('id="view-row"');
  assert.ok(last > 0);
  const rowAt = html.indexOf('id="theme-row"');
  assert.ok(rowAt > last);
  ids.forEach((id, i) => {
    const re = new RegExp(`<button class="theme-btn" id="theme-${id}" data-theme="${id}">${labels[i]}</button>`);
    const m = html.match(re);
    assert.ok(m, id);
    assert.ok(m.index > rowAt);
  });
  const rule = html.match(/\.theme-btn\s*\{([^}]*)\}/);
  assert.ok(rule && /min-height\s*:\s*(4[4-9]|[5-9]\d)px/.test(rule[1]), 'min-height >= 44px');
  assert.match(html, /\.theme-btn\.active/);
});

test('no image files in maze-3d', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [e.name]);
  const imgs = walk(dir).filter((n) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(n));
  assert.deepEqual(imgs, []);
});
```

（`readdirSync` 从 `node:fs` 引入。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/maze-3d-page.test.mjs`
Expected: `theme buttons` FAIL；`no external references` 因 `wall-geometry.js` / `themes.js` 不存在而 FAIL（如果 Task 1、2 已完成则 PASS）；`no image files` PASS

- [ ] **Step 3: 改 `maze-3d/index.html`**

- 加 `.theme-btn`：背景色、hover 色与 `.size-btn` 相同（`#4CAF50` / `#45a049`），`min-height: 44px`。把 `.size-btn.active` 选择器扩为 `.size-btn.active, .theme-btn.active`（共用同一条 active 样式）。
- 在 `#view-row` 的 `</div>` 之后插入 `#theme-row` 和四个按钮（格式与 Interfaces 完全一致）。`.row` 已有 `flex-wrap: wrap`，小屏可换行。
- 根 `README.md` 的 3D 迷宫说明末尾加：「四种主题（花园、砖墙、积木、城堡）可切换。」

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/`
Expected: 全部 PASS

---

### Task 4: `main.js` 主题渲染与切换

**Files:**
- Modify: `maze-3d/main.js`

**Interfaces:**
- Consumes：Task 1 的 `THEME_IDS, THEMES, parseTheme, blockColorIndex, wallShade, paintWall, paintWallTop, paintFloor`；Task 2 的 `wallGroupLayout, applyWallUvs`；Task 3 的 `.theme-btn[data-theme]` 按钮。
- Produces（Task 5–7 的浏览器检查依赖这些，`window.__maze3d` 上新增）：
  - `get theme(): string`：当前主题 id
  - `get textureCount(): number`：当前已创建且未 `dispose()` 的主题纹理数（墙面、墙顶、地板、天空）。稳定状态下恒为 4
  - `get textureStats(): { builds: number, lastMs: number }`：主题纹理生成总次数，以及最近一次生成 4 张纹理的耗时（毫秒，`performance.now()` 差值）
  - `wallColorHex(i: number): string`：第 i 段墙的实例色，格式 `'#rrggbb'`，与 `floorColorHex` 一致

- [ ] **Step 1: 跑现有浏览器检查，记下改动前状态**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 1,12,2,4,5,6,11,3,9c`
Expected: 全部 PASS（这是回归基线；改动后同一命令必须仍然全部 PASS）

- [ ] **Step 2: 实现主题加载与 renderer 清屏色**

- 在模块顶部、`createRenderer` 调用之前：`let themeId = parseTheme(storageGet('maze3d.theme'));`。
- `createRenderer` 改用 `THEMES[themeId].fogColor` 作清屏色。`downgrade()` 里新 renderer 同样取当前主题的 `fogColor`。
- 从 `COLORS` 删除 `background`、`wall`、`floor`（它们由主题决定）。小地图里的硬编码色（`#f2efe6`、`#7e57c2` 等）保持不变。

- [ ] **Step 3: 实现墙几何与材质**

- `wallGeometry`：`new THREE.BoxGeometry(1.1, 0.8, 0.1)`，然后 `applyWallUvs(geo.attributes.uv.array)`；`const { index, groups } = wallGroupLayout(geo.index.array)`；`geo.setIndex(index)`；`geo.clearGroups()`；逐个 `addGroup`。
- `wallMaterials = [new THREE.MeshLambertMaterial({ color: 0xffffff }), new THREE.MeshLambertMaterial({ color: 0xffffff })]`（墙面、墙顶），`InstancedMesh(wallGeometry, wallMaterials, n)`。
- `floorMaterial` 保持白色，加 `map`。

- [ ] **Step 4: 实现主题纹理生命周期**

- `makeCanvasTexture(paint)`：建 256×256 canvas，`paint(ctx, 256)`，包成 `CanvasTexture`。设置 `colorSpace = SRGBColorSpace`、`wrapS = wrapT = RepeatWrapping`、`anisotropy`（规则见 Global Constraints），保留默认 mipmap 与 `LinearMipmapLinearFilter`。创建时 `liveTextures += 1`。
- `makeSkyTexture(theme)`：2×256 canvas，用 `createLinearGradient(0, 0, 0, 256)` 从 `sky.top` 到 `sky.bottom` 填满。`colorSpace = SRGBColorSpace`，`generateMipmaps = false`，`minFilter = LinearFilter`。创建时 `liveTextures += 1`。（`createLinearGradient` 只在 `main.js` 用，不受 Task 1 的方法白名单约束。）
- `currentTextures = { id, wall, top, floor, sky } | null`。`ensureTextures(id)`：如果 `currentTextures?.id === id` 直接返回。否则记时，生成 4 张新纹理，`textureStats.builds += 1`、`lastMs = 耗时`，然后对旧的 4 张逐个 `dispose()` 并 `liveTextures -= 1`，再替换 `currentTextures`。

- [ ] **Step 5: 实现光照、天空、雾**

- 删掉 `AmbientLight`，加 `const hemi = new THREE.HemisphereLight()`，保留 `sun`。
- `updateSceneFog()` 新建 `Fog` 时用当前主题 `fogColor`。

- [ ] **Step 6: 实现 `applyTheme(id)` 与墙 / 地板着色**

- `colorWalls()`：对每段墙 `setColorAt`。`blocks` 主题取 `blockPalette[blockColorIndex(i, palette.length)]`；其他主题取 `tmpColor.setHex(wallTint).multiplyScalar(wallShade(i))`。末尾设 `walls.instanceColor.needsUpdate = true`。`buildMaze` 新建 `walls` 后、加入场景前调用它。
- 抽出 `kindAt(row, col)`，与原 `applyFloorColors` 内的 `floorKind(...)` 调用一致。`applyFloorColors` 改用 `kindAt`；`kind === 'floor'` 时用 `THEMES[themeId].floorBase`，其他 kind 用 `COLORS[kind]`。`buildMaze` 里初始化地板色同样用 `floorBase`。
- `applyTheme(id)`，按顺序执行：
  1. `id = parseTheme(id)`，`themeId = id`
  2. `ensureTextures(id)`
  3. 设置 `wallMaterials[0].map`、`wallMaterials[1].map`、`floorMaterial.map`；只有 map 对象实际变化时，才对三个材质设 `needsUpdate = true`
  4. `scene.background = sky`；`renderer.setClearColor(fogColor)`；`scene.fog` 存在时设置 `scene.fog.color`
  5. 设置 `hemi.color`、`hemi.groundColor`、`hemi.intensity`、`sun.color`、`sun.intensity`
  6. 如果 `walls` 存在，调用 `colorWalls()`；如果 `floor` 存在，调用 `applyFloorColors()`
  7. `.theme-btn` 按 `dataset.theme === id` 切换 `active` 类
  8. `storageSet('maze3d.theme', id)`
- `applyTheme` 不调用 `cancelAnimation`、`buildMaze`、`recomputeFog`，也不改 `state` / `anim` / `pos` / `view` / `fogOn` / `showPath`。
- 绑定：每个 `.theme-btn` 的 `click` 调 `applyTheme(btn.dataset.theme)`。
- 启动顺序：先 `applyTheme(themeId)`，再 `buildMaze(seed, size)`。
- `downgrade()` 成功换 renderer 后：对 `currentTextures` 中的墙面、墙顶、地板三张纹理设 `anisotropy = 1; needsUpdate = true`。新 renderer 设清屏色为当前 `fogColor`。

- [ ] **Step 7: 调试对象加 `theme`、`textureCount`、`textureStats`、`wallColorHex`**（签名见 Interfaces）

- [ ] **Step 8: 跑回归与单元测试**

Run: `node --test tests/ && ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only 1,12,2,4,5,6,11,3,9c`
Expected: 全部 PASS，且没有控制台错误

---

### Task 5: 浏览器验收：切换、动画、持久化、内存、小屏

**Files:**
- Modify: `tests/browser/maze3d_accept.py`

**Interfaces:**
- Consumes：Task 3 的按钮 id；Task 4 的 `theme`、`textureCount`、`textureStats`、`wallColorHex`、`floorColorHex`、`generation`、`state`、`player`。
- Produces（Task 6/7 复用的辅助函数）：
  - `THEME_IDS = ["garden", "brick", "blocks", "castle"]`
  - `click_theme(page, tid)`：执行 `page.click(f"#theme-{tid}")`
  - `active_themes(page) -> list[str]`：返回带 `active` 类的 `.theme-btn` 的 `data-theme` 列表
  - `theme_init(tid) -> str`：返回 init script，内容为 `try { localStorage.setItem('maze3d.theme', tid) } catch {}`
  - `themes_mod(page, expr, arg=None)`：同 `logic()`，但 import `/maze-3d/themes.js` 为 `T`
- 新检查注册进 `CHECKS`：`t1`、`t3`、`t4`、`t6`、`t8`

- [ ] **Step 1: 写检查**

- `t1`（切换与一致性）：`?seed=S&size=10`。
  - 默认 `theme == "garden"`，`active_themes == ["garden"]`。
  - 依次点四个主题。每次检查：`theme == tid`；`active_themes == [tid]`；普通格 `(1,1)` 的 `floorColorHex` 等于 `THEMES[tid].floorBase` 的十六进制（用 `themes_mod` 取）；`textureCount == 4`。
  - 再次点击当前主题：`textureStats.builds` 不变。
  - 点「显示道路」后切换主题：值为 `'#ff6b6b'` 的格子数不变。
  - 切到 `blocks` 后点 `#regen-btn` 再点 `#size-15`：`wallColorHex(i)` 等于调色板色 `blockPalette[blockColorIndex(i,5)]`（抽查 i = 0..9，用 `themes_mod` 算期望值）；`textureCount == 4`；`builds` 不变。
  - 全程 `no_errors`。
- `t3`（移动中切换）：`?seed=S&size=10`，跟随视角。
  - 从起点找一个满足「`next_stop` 与当前位置相距 ≥2 格」的方向：在当前格尝试 4 个方向；没有就沿 `path_dir` 走一步再找，最多 20 次。
  - 记下 `gen0 = generation` 与期望终点 `exp`。按方向键后立刻执行 `page.evaluate("() => { const s = window.__maze3d.state; document.getElementById('theme-castle').click(); return s; }")`，断言返回值为 `'moving'`。
  - `wait_settled` 后断言：`pos == exp`，`generation == gen0`，`theme == 'castle'`。
  - 第一人称部分：切到第一人称，按 `ArrowLeft` 后立刻用同样方式点 `#theme-brick`，断言当时 `state == 'turning'`。`wait_idle` 后 `facing` 等于 `L.turn(before, 'left')`，`theme == 'brick'`。
- `t4`（持久化）：
  - 点 `#theme-brick` 后 `page.reload()`：`theme == 'brick'`，`active_themes == ['brick']`。
  - 依次把 `localStorage['maze3d.theme']` 设成 `'foo'`、`'GARDEN'`、`''`，每次 reload 后 `theme == 'garden'`。
  - 用已有的 `BLOCK_STORAGE` 作 init script 打开新页：`theme == 'garden'`；点 `#theme-castle` 后 `theme == 'castle'`。
  - 全程无 `pageerror`。
- `t6`（纹理释放）：新页面（默认 `garden`，此时 `builds == 1`）。第 `i` 次（`i = 0..19`）点击 `THEME_IDS[(i + 1) % 4]`，即从 `brick` 开始循环，保证每次点击都与当前主题不同。
  - 每次点击后断言：`textureCount == 4`，且 `textureStats.builds` 比上一次点击后恰好增加 1（断言消息带上 `i` 与 `tid`，便于定位出错的那次切换）。
  - 循环结束后：`textureCount == 4`，`textureStats.builds == 21`（启动 1 次 + 20 次切换）。
  - 再点击一次当前主题：`textureCount == 4`，`builds` 仍为 21。
- `t8`（375px）：`viewport 375×667, is_mobile, has_touch, device_scale_factor=2`。断言 `scrollWidth <= 375`；四个按钮的 `bounding_box().height >= 44`；按钮都在 `#theme-row` 内，且其 `y` 大于 `#view-row` 的 `y`。

- [ ] **Step 2: 运行检查**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only t1,t3,t4,t6,t8`
Expected: 5 项 PASS。某项 FAIL 说明 Task 4 实现有误：修 `main.js`，不要放宽断言。

- [ ] **Step 3: 格式化**

Run: `~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py`
Expected: 无错误

---

### Task 6: 调试取样接口与墙面对比度 / 语义色验收

**Files:**
- Modify: `maze-3d/main.js`（调试对象区）
- Modify: `tests/browser/maze3d_accept.py`

**Interfaces:**
- Consumes：Task 4 的 `kindAt`、`walls`、`player`、`star`、`camera`、`renderer`；Task 5 的辅助函数。
- Produces（`window.__maze3d` 新增）：
  - `floorKindAt(row, col): 'floor'|'start'|'end'|'path'|'fog'`：返回 `kindAt(row, col)`。
  - `floorSamplePoints(row, col): {x:number, y:number}[]`：取地板顶面（y = 0.001）上 5 个点：格心，以及 `(±0.3, ±0.3)` 四个内缩点。用 `camera` 投影，丢弃 NDC 超出 `[-1,1]` 或 `z > 1` 的点。从 `camera.position` 向该点发 `Raycaster`，对 `[walls, star, player]` 递归求交，忽略这几类命中：`player.visible === false` 时命中小人的、命中缩放为 0 的墙实例的（同 `wallsVisible` 的判定）。存在距离小于「相机到该点距离 − 0.01」的命中即视为被遮挡。返回未遮挡点的 CSS 像素坐标，相对 renderer canvas 左上角：`x = (ndc.x+1)/2*canvas.clientWidth`，`y = (1-ndc.y)/2*canvas.clientHeight`。调用前先执行一次 `camera.updateMatrixWorld()`。
  - `wallContrast(): { colors: number, std: number, spread: number }`：先 `renderer.render(scene, camera)`，再在绘制缓冲中心 50% 区域按 16×16 网格 `readPixels`。点坐标 `x = floor(w*(0.25 + 0.5*(i+0.5)/16))`，y 同理。`colors` 是不同 RGB 的个数。`luma = 0.299R + 0.587G + 0.114B`。`std` 是总体标准差。`spread = 升序排列后下标 floor(0.95*255) 的值 − 下标 floor(0.05*255) 的值`。
- 验收脚本新增：
  - `start_server(root=ROOT)`（加参数，默认不变）
  - 命令行参数 `--baseline-root PATH`（改动前代码的副本，见 Step 1）
  - `canvas_image(page) -> PIL.Image`：`page.locator("#stage > canvas:not(#minimap)").screenshot()` 后用 Pillow 打开，转 RGB
  - `screen_metrics(img) -> dict`：在图像上用与 `wallContrast` 相同的网格和公式计算 `colors / std / spread`（图像 y 向下，网格对称，无需翻转）
  - `face_wall(page)`：第一人称下按 `ArrowLeft` 转身（最多 4 次），直到 `next_stop(page, facing)` 为 `None`。返回朝向；转满 4 次仍未面墙返回 `None`
  - 检查 `t2`、`t5`

- [ ] **Step 1: 准备改动前代码副本**

Run: `mkdir -p "$SCRATCH/maze3d-baseline" && git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261113-001535-maze-3d-themes archive "$(git -C /Users/jialiu/Projects/saisai.me/.worktrees/20261113-001535-maze-3d-themes merge-base HEAD main)" maze-3d | tar -x -C "$SCRATCH/maze3d-baseline"`，其中 `SCRATCH=/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad`
Expected: 存在 `$SCRATCH/maze3d-baseline/maze-3d/main.js`，且其中含 `0x7e57c2`

- [ ] **Step 2: 写检查 `t2`（墙面对比度）**

- `--baseline-root` 未给时返回 `(None, "need --baseline-root")`。
- 基线：用 `start_server(baseline_root)` 起第二个服务器。打开 `?seed=S&size=10`，切第一人称，`face_wall`，等 300 ms，记录 `screen_metrics(canvas_image(page))`。
- 新版：对每个主题，用 `theme_init(tid)` 打开 `?seed=S&size=10`，切第一人称，`face_wall`，等 300 ms。记录 `wallContrast()` 与 `screen_metrics`。判定：`colors >= 12`、`spread >= 40`、`std >= 10`。同时无控制台错误，`theme == tid`。
- detail 写出：基线的 colors / spread / std，以及每个主题两种方法的数值。

- [ ] **Step 3: 写检查 `t5`（格子语义色）**

对每个主题，`theme_init(tid)` + `preset_storage`（已有函数）设迷雾状态，打开 `?seed=S&size=10`，跟随视角。辅助函数 `sample_kind(page, img, cells, want)`：遍历候选格，要求 `floorKindAt == want`，且 `floorSamplePoints` 非空，用第一个满足的格。取这些点在 `img` 中的像素，返回各通道中位数 RGB；找不到满足的格返回 `None`（判 FAIL）。

- 场景 A（迷雾关、道路关）：
  - 按 `entrance_dir` 走一步，取 `start`（候选 `(0,0)`）与 `floor`（候选为全部格，按与小人的距离由近到远排序）。
  - 终点：设计文档写的是在「离开起点一步」的位置取终点格，但跟随相机位于小人南侧 `d = 8`、高 `h = 11` 处，终点格在相机背后，取不到。所以在同一模式下沿 `path_dir` 继续走，直到与终点的 Chebyshev 距离 ≤ 2，或下一站就是终点为止，再取 `end`（候选 `(n-1,n-1)`）。
- 场景 B（迷雾关）：点 `#show-path-btn`，取 `path`（候选为小人附近、非起点非终点的格）与 `floor`。
- 场景 C（迷雾开、视野 1、道路关）：取 `fog`（候选为距小人 2–3 格的格子）与 `floor`（视野内）。记录 `floorKindAt(n-1,n-1) == 'fog'`。
- 场景 D：在场景 C 的基础上沿 `path_dir` 前进，直到终点与小人的 Chebyshev 距离 ≤ 1，且小人不在终点。断言 `floorKindAt(n-1,n-1) == 'end'`，并取 `end`。
- 判定：每个主题五类颜色（`floor` 取场景 A 的值，`end` 取场景 D 的值）两两 RGB 欧氏距离都 ≥ 60；场景 C 中终点为 `fog`；无控制台错误。detail 写出每类 RGB 和最小距离对。
- 如果某主题 FAIL：调该主题的 `hemi.intensity` / `sun.intensity` / `floorBase` 或提亮地板纹理（Task 1 的约束内），不要放宽 60 的阈值。

- [ ] **Step 4: 实现调试接口**（签名见 Interfaces），加在 `window.__maze3d` 上

- [ ] **Step 5: 运行检查**

Run: `~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --only t2,t5 --baseline-root "$SCRATCH/maze3d-baseline"`
Expected: 两项 PASS；`t2` 的 detail 中基线 `colors` 明显小于 12、`spread` 明显小于 40

- [ ] **Step 6: 格式化并跑单元测试**

Run: `~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py && node --test tests/`
Expected: 全部 PASS

---

### Task 7: 性能、降画质、截图与结果文件

**Files:**
- Modify: `tests/browser/maze3d_accept.py`
- Modify: `tests/browser/test-results.txt`（由 `--write` 生成）

**Interfaces:**
- Consumes：Task 5、6 的辅助函数；已有的 `perf_round`、`play_rounds`、`check_9` 的 GPU 启动方式；Task 4 的 `textureStats`。
- Produces：检查 `t7`、`t7b`、`t9`；命令行参数 `--shots DIR`。

- [ ] **Step 1: 扩展 `perf_round`**

- 新增参数 `init_script=None`、`base` 可以指向基线服务器。
- 返回值增加 `downgradeCount`、`textureMs`（`textureStats.lastMs`；基线没有该属性时为 `None`，用 `page.evaluate("() => window.__maze3d.textureStats ? window.__maze3d.textureStats.lastMs : null")` 读取）。
- 已有 `check_9` 的行为不变。

- [ ] **Step 2: 写 `t7`（性能对比）**

- 需要 `--baseline-root`，否则返回 `None`。
- 用与 `check_9` 相同的 GPU 浏览器启动（`--use-angle=metal --enable-gpu`，先 headless 再 headed）。只测 `mobile=True`（20×20、iPhone SE、4 倍 CPU 降速、同一 seed、同一 `play_rounds`）。
- 先测基线，再依次测四个主题（`init_script=theme_init(tid)`）。
- 判定：
  - 任一次 renderer 名含 `swiftshader`，或各次 `renderer` 不相同 → 返回 `None`（INCONCLUSIVE），detail 写出原因。
  - 基线 `quality == 'high'` 且 `downgradeCount == 0` 时：某主题 `downgradeCount > 0` → 该主题 FAIL，detail 写「触发降级 downgradeCount=N」；否则要求 `avg <= 1.3 × 基线 avg`。
  - 基线本身触发了降级：每个主题按 `avg <= 1.3 × 基线 avg` 比较，detail 注明「基线已降级，非高画质比较」。此时整体返回 `None`（不作为高画质通过的依据）。
  - 任一次有控制台错误 → FAIL。
- detail 写出每次的 `avg / p95 / quality / downgradeCount / renderer / textureMs`。

- [ ] **Step 3: 写 `t7b`（降画质后切换）**

- 打开 `?seed=S&size=10&debug=1&slow=40`，等待 `quality == 'low'`。
- 切第一人称，`face_wall`。依次点四个主题，每次检查：`theme == tid`，`active_themes == [tid]`，`wallContrast()` 满足 `colors >= 12`、`spread >= 40`、`std >= 10`。
- 再点一次 `garden`（此时会新建纹理），确认无错误。
- 全程无控制台错误。

- [ ] **Step 4: 写 `t9`（截图）**

- `--shots` 默认为 `/Users/jialiu/Projects/saisai.me/.xdev/20261113-001535-maze-3d-themes/screenshots`，运行时 `mkdir(parents=True, exist_ok=True)`。
- 每个主题用 `theme_init(tid)` 打开 `?seed=S&size=10`（视口 1280×800），等 500 ms：
  - 存跟随视角截图 `<shots>/<tid>-follow.png`。
  - 切第一人称，用 `face_walkable` 朝向一条通道，存 `<shots>/<tid>-first.png`。
  - 再 `face_wall`，存 `<shots>/<tid>-first-wall.png`。
- 用 `canvas_image` 同款的 canvas 元素截图保存。判定：12 个文件都存在且大小 > 0，无控制台错误。detail 写出目录。

- [ ] **Step 5: 结果文件写入人工检查占位**

`--write` 时在头部 `自动检查：...`（只代表自动检查结论，人工验收单独记录）之后加两行：
- `基线代码：<baseline-root>（merge-base）`
- `人工检查：待用户查看 <shots> 下 12 张截图，确认四种风格纹理明显`

- [ ] **Step 6: 跑全量并写结果**

Run: `~/tmp/fuck/c/.venv/bin/black tests/browser/maze3d_accept.py && node --test tests/ && ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py --write --baseline-root "$SCRATCH/maze3d-baseline"`
Expected：
- `node --test` 全部 PASS。
- 浏览器检查中原有各项与 `t1`–`t9` 全部 PASS。只有 `9` / `t7` 在无 GPU 时允许 INCONCLUSIVE（这种情况下退出码为 1）。如果出现 INCONCLUSIVE，在最终回报里原样说明，不要改判定。
- `tests/browser/test-results.txt` 已更新。
- 截图目录下有 12 张 PNG。
