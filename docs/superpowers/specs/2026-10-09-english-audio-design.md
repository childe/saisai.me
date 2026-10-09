# 英语教材配套音频播放页 — 设计

日期：2026-10-09
子项目目录：`english-audio/`

## 1. 目的与使用场景

给小朋友（小学一年级）听《英语（一年级上册）》教材配套音频。两个真实场景：

1. **老师布置作业，听指定单元** —— 打开页面 → 找到 Unit X → 把这个单元几条听完。
2. **跟读 / 复读练发音** —— 对同一条反复听，需要慢速和重听。

成功标准：小朋友在 10 寸平板横屏下，不需要大人帮忙就能找到并播放指定单元的音频；跟读时能一键慢放和单曲循环。

非目标（明确不做）：A-B 区间复读、离线缓存、收藏/最近播放列表、多册管理 UI。

## 2. 素材

来源：`~/Downloads/《英语（一年级上册）》教材配套音频.zip`（32MB 压缩 / 43MB 解压 / 81 个 mp3）。
zip 内文件名为 GBK 编码，需用 `name.encode('cp437').decode('gbk')` 还原。

解压后结构：

```
《英语 一年级上册》配套音频/
  01 Starter.mp3
  02 Unit 1/   02 Unit 1-Small task.mp3 … 08 Unit 1-Talking time-A.mp3
  03 Unit 2/   09 … 15
  …
  11 Unit 10/  65 … 71
  12 Word bank/ 72 Word bank-Unit 1.mp3 … 81 Word bank-Unit 10.mp3
```

每个 Unit 固定 7 条，板块名为教材板块：`Small task`、`Topic words`、
`Song time` / `Rhyme time` / `Chant time`（每单元只出现其中一种，带 `-A` `-B` 两个变体）、
`Talking time` / `Story time`（带 `-A` 变体）。

`-A` / `-B` 的实际内容未经确认，**本版按各自独立的条目平铺展示**，不做从属分组。
标题直接写 `Song time A` / `Song time B`。等听过实际音频后再决定是否改为分组。

## 3. 存储：阿里云 OSS

- Endpoint `oss-cn-shanghai.aliyuncs.com`，Bucket `ohsaisai`
- 前缀 `english-audio/g1a/`
- 公开 URL 形如
  `https://ohsaisai.oss-cn-shanghai.aliyuncs.com/english-audio/g1a/unit03/18-rhyme-time.mp3`

**上传时重命名为 ASCII key**，中文/英文展示名只存在于 manifest。原因：原文件名含中文与空格，直接做 URL 会在编码、缓存、CDN 上反复踩坑。序号沿用原包编号（01–81），便于和原始素材对账。

```
english-audio/g1a/01-starter.mp3
english-audio/g1a/unit01/02-small-task.mp3
english-audio/g1a/unit01/04-song-time.mp3
english-audio/g1a/unit01/05-song-time-a.mp3
english-audio/g1a/wordbank/72-unit-01.mp3
```

AccessKey 存项目根 `.env`（`.gitignore` 已含 `.env`），上传脚本从环境变量读，不写进代码或 manifest。
音频传完后应在阿里云控制台轮换该 AccessKey —— 页面只需要公共读，不依赖它。

**需要在 OSS 控制台确认**：Bucket 对 `english-audio/*` 开公共读；CORS 规则允许来源
`https://saisai.me` 的 GET（否则 `<audio>` 能播但拿不到精确的加载错误与进度）。

## 4. 仓库结构

```
english-audio/
  index.html
  app.js
  styles.css
  data/g1a.json              manifest，进 git
  scripts/build_manifest.py  解压目录 → manifest
  scripts/upload_oss.py      按 manifest 上传 OSS（oss2 SDK），幂等
  scripts/test_build_manifest.py
  README.md
```

另需在根 `index.html` 与 `README.md` 增加该子项目入口，与现有四个子项目保持同样写法。

## 5. Manifest 格式

`english-audio/data/g1a.json`（下面是格式示例，条目有节选，duration 为示意值）：

```json
{
  "id": "g1a",
  "title": "英语 一年级上册",
  "baseUrl": "https://ohsaisai.oss-cn-shanghai.aliyuncs.com/english-audio/g1a/",
  "units": [
    {
      "id": "starter",
      "title": "Starter",
      "subtitle": "开始啦",
      "tracks": [
        { "no": 1, "key": "01-starter.mp3", "kind": "starter",
          "title": "Starter", "subtitle": "开始啦", "duration": 62.1 }
      ]
    },
    {
      "id": "unit01",
      "title": "Unit 1",
      "subtitle": "",
      "tracks": [
        { "no": 2, "key": "unit01/02-small-task.mp3", "kind": "task",
          "title": "Small task", "subtitle": "小任务", "duration": 11.1 },
        { "no": 4, "key": "unit01/04-song-time.mp3", "kind": "song",
          "title": "Song time", "subtitle": "唱一唱", "duration": 38.8 },
        { "no": 5, "key": "unit01/05-song-time-a.mp3", "kind": "song",
          "title": "Song time A", "subtitle": "唱一唱", "duration": 39.9 }
      ]
    }
  ]
}
```

- `kind` 取值：`starter` `task` `words` `song` `rhyme` `chant` `talking` `story` `wordbank`，决定图标与配色。
- `duration` 单位秒，构建脚本用 `mutagen` 读取；读不到则省略该字段，页面不显示时长。
- `title` 用教材原板块名（英文），`subtitle` 为中文说明，供不认识英文的小朋友辨认。
- Word bank 作为一个独立「单元」，`title` 为 `Word bank` / `单词表`，其 10 条的 `title` 为 `Unit 1` … `Unit 10`。

## 6. 构建脚本

`build_manifest.py <解压目录> -o data/g1a.json`：

- 遍历目录，按文件名解析出：序号、单元、板块名、变体后缀。
  解析规则：`^(\d+)\s+(.+?)\.mp3$` 取序号与主体；主体形如 `Unit 3-Rhyme time-A`
  或 `Word bank-Unit 1` 或 `Starter`。
- 板块名 → `kind` 与中文 `subtitle` 的映射表写死在脚本里。
- 生成 ASCII key（板块名小写、空格转 `-`、变体后缀小写追加）。
- 用 `mutagen` 读时长，缺失则跳过。
- 输出按序号排序的 JSON。

该脚本的文件名解析有真实逻辑，**用 pytest 做 TDD**，覆盖：普通条目、带 `-A`/`-B` 变体、
Starter、Word bank、两位数单元（Unit 10 不能被 Unit 1 的规则误匹配）。

`upload_oss.py`：读 manifest 与 `.env`，逐条上传到 `english-audio/g1a/<key>`，
设置 `Content-Type: audio/mpeg`，已存在且大小一致则跳过，打印进度。

## 7. 页面设计

### 布局（10 寸平板横屏优先，约 1280×800）

```
┌─────────────┬──────────────────────────────────────┐
│ Starter     │  Unit 3                              │
│ Unit 1      │  ┌────────────────────────────────┐  │
│ Unit 2      │  │ ✅  Small task   小任务   0:38  │  │
│▶Unit 3      │  ├────────────────────────────────┤  │
│ Unit 4      │  │ 🔤  Topic words  单词     1:59  │  │
│ ...         │  ├────────────────────────────────┤  │
│ Unit 10     │  │ 📜  Rhyme time   童谣     1:28  │  │
│ 📚 单词表    │  │ 📜  Rhyme time A 童谣     1:35  │  │
└─────────────┴──────────────────────────────────────┘
│ ▶  Unit 3 · Rhyme time   ──●────────  1:02 / 1:28  │
│ 🐢 0.6x  0.8x  [1.0x]   ⏪5  ⏩5   🔁 单曲循环      │
└──────────────────────────────────────────────────────┘
```

- 左栏：单元导航（Starter / Unit 1–10 / 单词表），当前单元高亮。
- 右栏：当前单元的曲目卡片，每张最小 64px 高，整张可点，`kind` 图标 + 英文标题 + 中文副标题 + 时长。
- 底部：常驻播放条。切换单元不打断播放。
- 手机竖屏（< 700px）：左栏变为顶部横向滚动的单元按钮条，右栏与播放条不变。

所有可点目标最小 44×44px，字号不小于 16px，配色高对比。

### 播放器行为

- 播放 / 暂停（大按钮）、上一条 / 下一条（在当前单元内）。
- 进度条可拖动，thumb 加大便于手指操作。
- `⏪5` / `⏩5` 秒。
- 速度 0.6 / 0.8 / 1.0 三个并排按钮（不用下拉框），设置 `preservesPitch = true` 保证慢放不变调。
- `🔁 单曲循环` 开关；关闭时，播完自动进入本单元下一条，单元末尾停止。
- localStorage 记住：上次单元、上次曲目、播放进度、速度、循环开关。下次打开续上（不自动播放，只定位）。
- Media Session API 设置标题与 play/pause/前后曲，支持平板锁屏与耳机线控。
- `<audio preload="none">`，只在点击时赋 URL，避免预下载 43MB。

### 错误处理

- 音频加载/播放失败：播放条显示 `😟 没连上网络，点我重试`，点击重试当前曲目。
- manifest fetch 失败：整页显示同一提示，点击重载。
- 两者都用大字和高对比，不出现技术错误码。

## 8. 测试

- `build_manifest.py` 的解析逻辑：pytest，TDD 先写测试。
- `upload_oss.py`：不写自动化测试（纯 IO），靠幂等 + 上传后抽查 URL 可访问。
- 页面：手动验证清单 —— 10 寸平板横屏、手机竖屏、慢速不变调、单曲循环、单元内连播、
  断网错误提示、刷新后续上进度、锁屏控制。

## 9. 实施顺序

1. `build_manifest.py` + 测试（TDD），对解压目录跑出 `data/g1a.json`。
2. `upload_oss.py`，上传 81 个文件，抽查 URL。
3. 页面：manifest 渲染 → 播放器 → 跟读功能 → 错误处理 → 响应式。
4. 根 `index.html` 与 `README.md` 加入口。
