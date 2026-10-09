# 英语教材配套音频播放页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 saisai.me 增加 `english-audio` 子项目：81 条教材配套音频存阿里云 OSS，页面按单元列出、点击即播，并为跟读提供慢速与单曲循环。

**Architecture:** 构建期用 Python 脚本从解压目录解析出 manifest（JSON，进 git），另一个脚本按 manifest 把 mp3 以 ASCII key 上传 OSS。前端是纯静态页，沿用本仓库现有写法（`<script>` 标签 + 全局 class，无构建工具、无 npm），fetch manifest 后渲染左栏单元导航 + 右栏曲目卡片 + 底部常驻播放条。

**Tech Stack:** Python 3（mutagen 读时长、oss2 上传、pytest 测试）、原生 HTML/CSS/JS（无框架、无打包）。

**Spec:** `docs/superpowers/specs/2026-10-09-english-audio-design.md`

## Global Constraints

- Python 包管理一律用 `uv pip install`，禁止 `pip install`。虚拟环境用 `~/tmp/fuck/c/.venv`。
- 每次改完 Python 代码用 black 格式化：venv 内无 black，用 `/opt/homebrew/bin/black`。
- 前端不引入任何框架、构建工具或 npm 依赖；沿用仓库现有写法：`<script src="x.js"></script>` 顺序加载 + 全局 class，4 空格缩进。
- OSS：Endpoint `oss-cn-shanghai.aliyuncs.com`，Bucket `ohsaisai`，前缀 `english-audio/g1a/`。
- AccessKey 只从项目根 `.env` 读，绝不出现在代码、manifest 或 commit 里。`.gitignore` 已含 `.env`。
- 所有 OSS object key 必须匹配 `^[a-z0-9][a-z0-9/._-]*$`（全小写、无空格、无中文）。
- 页面可点目标最小 44×44px，正文字号 ≥16px。
- 目标设备优先级：10 寸平板横屏（约 1280×800）> 手机竖屏（<700px）> 桌面。

## Review Focus

1. **`Unit 10` 被 `Unit 1` 的规则误匹配** —— 解析 `65 Unit 10-Small task.mp3` 必须得到 unit 10，而不是 unit 1 加一段残留文本。测试在 Task 1。
2. **出现映射表里没有的板块名** —— 脚本必须抛出带文件名的异常，而不是静默产出空 kind 让页面显示无图标的卡片。测试在 Task 1。
3. **mutagen 读不出时长**（文件损坏或非 CBR） —— manifest 省略 `duration` 字段，页面相应位置留空而不是显示 `NaN:aN` 或 `undefined`。测试在 Task 1（脚本侧）和 Task 4（页面侧）。
4. **上传中断后重跑** —— 已存在且大小一致的 object 跳过，不重传也不报错，脚本可反复执行。验证在 Task 3。
5. **生成的 key 混入大写或空格** —— 板块名含空格（`Small task`）和大写，slug 必须全部处理掉；用正则断言全部 81 个 key。测试在 Task 1。

---

## File Structure

```
english-audio/
  index.html                    页面骨架、script 标签顺序
  styles.css                    全部样式（含响应式断点）
  player.js                     class Player —— 封装 <audio>：播放/暂停/seek/倍速/循环/结束回调
  ui.js                         class UI —— 渲染左栏单元导航、右栏曲目卡片、播放条显示
  main.js                       class App —— 加载 manifest、串起 Player 与 UI、localStorage、Media Session
  data/g1a.json                 manifest（进 git）
  scripts/build_manifest.py     解压目录 → manifest
  scripts/test_build_manifest.py pytest
  scripts/upload_oss.py         按 manifest 上传 OSS
  README.md                     子项目说明

index.html                      （根）加入口
README.md                       （根）加入口
.env                            （根，不进 git）OSS 凭据
```

---

### Task 1: manifest 构建脚本（TDD）

**Files:**
- Create: `english-audio/scripts/build_manifest.py`
- Test: `english-audio/scripts/test_build_manifest.py`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces:
  - `SECTIONS: dict[str, tuple[str, str]]` —— 板块名 → `(kind, 中文副标题)`
  - `parse_track(filename: str) -> dict` —— 解析单个 mp3 文件名；返回
    `{"no": int, "unit_id": str, "unit_title": str, "kind": str, "title": str, "subtitle": str, "key": str}`；
    板块名未知时抛 `ValueError`
  - `build(src_dir: str) -> dict` —— 遍历目录产出完整 manifest（含 `duration`）

- [ ] **Step 1: 准备环境**

```bash
source ~/tmp/fuck/c/.venv/bin/activate
uv pip install mutagen oss2 python-dotenv
```

- [ ] **Step 2: 写失败的测试**

创建 `english-audio/scripts/test_build_manifest.py`：

```python
import pytest

from build_manifest import parse_track


def test_plain_track():
    t = parse_track("02 Unit 1-Small task.mp3")
    assert t["no"] == 2
    assert t["unit_id"] == "unit01"
    assert t["unit_title"] == "Unit 1"
    assert t["kind"] == "task"
    assert t["title"] == "Small task"
    assert t["subtitle"] == "小任务"
    assert t["key"] == "unit01/02-small-task.mp3"


def test_variant_suffix():
    t = parse_track("05 Unit 1-Song time-A.mp3")
    assert t["title"] == "Song time A"
    assert t["kind"] == "song"
    assert t["key"] == "unit01/05-song-time-a.mp3"


def test_unit_ten_is_not_unit_one():
    t = parse_track("65 Unit 10-Small task.mp3")
    assert t["unit_id"] == "unit10"
    assert t["unit_title"] == "Unit 10"
    assert t["title"] == "Small task"
    assert t["key"] == "unit10/65-small-task.mp3"


def test_starter():
    t = parse_track("01 Starter.mp3")
    assert t["unit_id"] == "starter"
    assert t["kind"] == "starter"
    assert t["key"] == "01-starter.mp3"


def test_word_bank():
    t = parse_track("72 Word bank-Unit 1.mp3")
    assert t["unit_id"] == "wordbank"
    assert t["unit_title"] == "Word bank"
    assert t["kind"] == "wordbank"
    assert t["title"] == "Unit 1"
    assert t["key"] == "wordbank/72-unit-01.mp3"


def test_word_bank_unit_ten():
    t = parse_track("81 Word bank-Unit 10.mp3")
    assert t["title"] == "Unit 10"
    assert t["key"] == "wordbank/81-unit-10.mp3"


def test_unknown_section_raises():
    with pytest.raises(ValueError) as e:
        parse_track("99 Unit 1-Dancing time.mp3")
    assert "Dancing time" in str(e.value)
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd english-audio/scripts && python -m pytest test_build_manifest.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'build_manifest'`

- [ ] **Step 4: 写实现**

创建 `english-audio/scripts/build_manifest.py`：

```python
"""从解压后的教材音频目录生成 manifest JSON。

zip 内文件名为 GBK 编码，解压时需还原；本脚本接受已还原为 UTF-8 的目录。
"""

import argparse
import json
import os
import re

BASE_URL = "https://ohsaisai.oss-cn-shanghai.aliyuncs.com/english-audio/g1a/"

# 板块名 -> (kind, 中文副标题)
SECTIONS = {
    "Starter": ("starter", "开始啦"),
    "Small task": ("task", "小任务"),
    "Topic words": ("words", "单词"),
    "Song time": ("song", "唱一唱"),
    "Rhyme time": ("rhyme", "童谣"),
    "Chant time": ("chant", "说唱"),
    "Talking time": ("talking", "对话"),
    "Story time": ("story", "故事"),
}

WORD_BANK = "Word bank"

FILENAME_RE = re.compile(r"^(\d+)\s+(.+)\.mp3$")
UNIT_RE = re.compile(r"^Unit (\d+)-(.+)$")
VARIANT_RE = re.compile(r"^(.*?)-([AB])$")


def slug(text):
    """'Song time A' -> 'song-time-a'"""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def parse_track(filename):
    m = FILENAME_RE.match(filename)
    if not m:
        raise ValueError("无法解析的文件名: %s" % filename)
    no = int(m.group(1))
    body = m.group(2)

    if body.startswith(WORD_BANK + "-"):
        title = body[len(WORD_BANK) + 1 :]
        n = int(title.rsplit(" ", 1)[1])
        kind, subtitle = "wordbank", "单词表"
        return {
            "no": no,
            "unit_id": "wordbank",
            "unit_title": WORD_BANK,
            "kind": kind,
            "title": title,
            "subtitle": subtitle,
            "key": "wordbank/%02d-unit-%02d.mp3" % (no, n),
        }

    um = UNIT_RE.match(body)
    if um:
        unit_no = int(um.group(1))
        rest = um.group(2)
        unit_id = "unit%02d" % unit_no
        unit_title = "Unit %d" % unit_no
        prefix = "%s/" % unit_id
    else:
        rest = body
        unit_id = "starter"
        unit_title = "Starter"
        prefix = ""

    vm = VARIANT_RE.match(rest)
    if vm:
        section, variant = vm.group(1), vm.group(2)
    else:
        section, variant = rest, None

    if section not in SECTIONS:
        raise ValueError("未知板块名 %r（文件 %s）" % (section, filename))
    kind, subtitle = SECTIONS[section]
    title = "%s %s" % (section, variant) if variant else section

    return {
        "no": no,
        "unit_id": unit_id,
        "unit_title": unit_title,
        "kind": kind,
        "title": title,
        "subtitle": subtitle,
        "key": "%s%02d-%s.mp3" % (prefix, no, slug(title)),
    }


def read_duration(path):
    try:
        from mutagen.mp3 import MP3

        return round(MP3(path).info.length, 1)
    except Exception:
        return None


def build(src_dir):
    tracks = []
    for root, _dirs, files in os.walk(src_dir):
        for name in files:
            if not name.lower().endswith(".mp3"):
                continue
            t = parse_track(name)
            d = read_duration(os.path.join(root, name))
            if d is not None:
                t["duration"] = d
            tracks.append(t)

    tracks.sort(key=lambda t: t["no"])

    units = []
    index = {}
    for t in tracks:
        uid = t.pop("unit_id")
        utitle = t.pop("unit_title")
        if uid not in index:
            index[uid] = {
                "id": uid,
                "title": utitle,
                "subtitle": "单词表" if uid == "wordbank" else "",
                "tracks": [],
            }
            units.append(index[uid])
        index[uid]["tracks"].append(t)

    return {
        "id": "g1a",
        "title": "英语 一年级上册",
        "baseUrl": BASE_URL,
        "units": units,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src_dir", help="解压后的音频目录")
    p.add_argument("-o", "--out", required=True, help="输出 JSON 路径")
    args = p.parse_args()

    manifest = build(args.src_dir)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    n = sum(len(u["tracks"]) for u in manifest["units"])
    print("写入 %s：%d 个单元，%d 条音频" % (args.out, len(manifest["units"]), n))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd english-audio/scripts && python -m pytest test_build_manifest.py -v`
Expected: 7 passed

- [ ] **Step 6: 补一条 key 格式的断言测试**

追加到 `test_build_manifest.py`：

```python
import re

KEY_RE = re.compile(r"^[a-z0-9][a-z0-9/._-]*$")


def test_all_keys_are_safe_ascii():
    names = ["01 Starter.mp3"]
    for unit in range(1, 11):
        names += [
            "%02d Unit %d-Small task.mp3" % (unit * 7, unit),
            "%02d Unit %d-Topic words.mp3" % (unit * 7 + 1, unit),
            "%02d Unit %d-Song time-A.mp3" % (unit * 7 + 2, unit),
        ]
    for name in names:
        key = parse_track(name)["key"]
        assert KEY_RE.match(key), key


def test_duration_absent_when_unreadable(tmp_path):
    from build_manifest import read_duration

    bad = tmp_path / "broken.mp3"
    bad.write_bytes(b"not an mp3")
    assert read_duration(str(bad)) is None
```

- [ ] **Step 7: 跑全部测试**

Run: `cd english-audio/scripts && python -m pytest test_build_manifest.py -v`
Expected: 9 passed

- [ ] **Step 8: 格式化并提交**

```bash
/opt/homebrew/bin/black english-audio/scripts/
git add english-audio/scripts/build_manifest.py english-audio/scripts/test_build_manifest.py
git commit -m "feat(english-audio): manifest 构建脚本与文件名解析测试"
```

---

### Task 2: 解压素材并生成真实 manifest

**Files:**
- Create: `english-audio/data/g1a.json`
- Create: `english-audio/scripts/extract_zip.py`

**Interfaces:**
- Consumes: Task 1 的 `build_manifest.py`
- Produces: `english-audio/data/g1a.json`（81 条音频，给 Task 3 与 Task 4 用）

- [ ] **Step 1: 写解压脚本**

创建 `english-audio/scripts/extract_zip.py`（zip 内文件名是 GBK，直接 unzip 会乱码）：

```python
"""解压教材音频 zip，把 GBK 文件名还原为 UTF-8。"""

import argparse
import os
import zipfile


def extract(zip_path, out_dir):
    z = zipfile.ZipFile(zip_path)
    count = 0
    for info in z.infolist():
        try:
            name = info.filename.encode("cp437").decode("gbk")
        except (UnicodeEncodeError, UnicodeDecodeError):
            name = info.filename
        target = os.path.join(out_dir, name)
        if name.endswith("/"):
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(z.read(info))
        count += 1
    return count


def main():
    p = argparse.ArgumentParser()
    p.add_argument("zip_path")
    p.add_argument("out_dir")
    args = p.parse_args()
    print("解压 %d 个文件到 %s" % (extract(args.zip_path, args.out_dir), args.out_dir))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 解压到临时目录**

```bash
source ~/tmp/fuck/c/.venv/bin/activate
python english-audio/scripts/extract_zip.py \
  ~/Downloads/《英语（一年级上册）》教材配套音频.zip \
  /tmp/g1a-src
```

Expected: `解压 81 个文件到 /tmp/g1a-src`

- [ ] **Step 3: 生成 manifest**

```bash
mkdir -p english-audio/data
python english-audio/scripts/build_manifest.py /tmp/g1a-src -o english-audio/data/g1a.json
```

Expected: `写入 english-audio/data/g1a.json：12 个单元，81 条音频`

- [ ] **Step 4: 人工核对**

```bash
python -c "
import json
m = json.load(open('english-audio/data/g1a.json'))
print([u['id'] for u in m['units']])
print(sum(len(u['tracks']) for u in m['units']))
print([t for t in m['units'][1]['tracks']])
print('缺时长的条目:', [t['title'] for u in m['units'] for t in u['tracks'] if 'duration' not in t])
"
```

Expected: 12 个单元 id 依次为 `starter, unit01…unit10, wordbank`；总数 81；缺时长的条目为空列表。

- [ ] **Step 5: 格式化并提交**

```bash
/opt/homebrew/bin/black english-audio/scripts/
git add english-audio/scripts/extract_zip.py english-audio/data/g1a.json
git commit -m "feat(english-audio): 解压脚本与一年级上册 manifest"
```

---

### Task 3: 上传 OSS

**Files:**
- Create: `english-audio/scripts/upload_oss.py`
- Create: `.env`（不进 git）

**Interfaces:**
- Consumes: Task 2 的 `data/g1a.json`
- Produces: OSS 上 `english-audio/g1a/` 下的 81 个可公开访问的 mp3

- [ ] **Step 1: 写 .env**

凭据不进任何受版本控制的文件，包括本计划。把真实值手工填进项目根 `.env`：

```bash
cat >> .env <<'EOF'
OSS_ACCESS_KEY_ID=<你的 AccessKey ID>
OSS_ACCESS_KEY_SECRET=<你的 AccessKey Secret>
OSS_ENDPOINT=oss-cn-shanghai.aliyuncs.com
OSS_BUCKET=ohsaisai
EOF
chmod 600 .env
grep -q '^\.env$' .gitignore && echo ".env 已被忽略"
```

Expected: 打印 `.env 已被忽略`

- [ ] **Step 2: 写上传脚本**

创建 `english-audio/scripts/upload_oss.py`：

```python
"""按 manifest 把本地 mp3 上传到阿里云 OSS。幂等：大小一致则跳过。"""

import argparse
import json
import os
import sys

import oss2
from dotenv import load_dotenv

PREFIX = "english-audio/g1a/"


def local_path(src_dir, track):
    """manifest 里的 key 不含原始中文名，按 no 在源目录里反查文件。"""
    want = "%02d " % track["no"]
    for root, _dirs, files in os.walk(src_dir):
        for name in files:
            if name.startswith(want) and name.lower().endswith(".mp3"):
                return os.path.join(root, name)
    raise FileNotFoundError("源目录里找不到编号 %d 的 mp3" % track["no"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src_dir", help="解压后的音频目录")
    p.add_argument("-m", "--manifest", default="english-audio/data/g1a.json")
    args = p.parse_args()

    load_dotenv()
    auth = oss2.Auth(os.environ["OSS_ACCESS_KEY_ID"], os.environ["OSS_ACCESS_KEY_SECRET"])
    bucket = oss2.Bucket(
        auth, "https://" + os.environ["OSS_ENDPOINT"], os.environ["OSS_BUCKET"]
    )

    manifest = json.load(open(args.manifest, encoding="utf-8"))
    tracks = [t for u in manifest["units"] for t in u["tracks"]]

    uploaded = skipped = 0
    for i, track in enumerate(tracks, 1):
        path = local_path(args.src_dir, track)
        key = PREFIX + track["key"]
        size = os.path.getsize(path)
        try:
            if bucket.head_object(key).content_length == size:
                skipped += 1
                print("[%d/%d] 跳过 %s" % (i, len(tracks), key))
                continue
        except oss2.exceptions.NoSuchKey:
            pass
        with open(path, "rb") as f:
            bucket.put_object(key, f, headers={"Content-Type": "audio/mpeg"})
        uploaded += 1
        print("[%d/%d] 上传 %s (%d bytes)" % (i, len(tracks), key, size))

    print("完成：上传 %d，跳过 %d" % (uploaded, skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: 先上传一条试水**

```bash
source ~/tmp/fuck/c/.venv/bin/activate
python - <<'EOF'
import json
m = json.load(open('english-audio/data/g1a.json'))
m['units'] = [m['units'][0]]
json.dump(m, open('/tmp/g1a-one.json', 'w'), ensure_ascii=False)
EOF
python english-audio/scripts/upload_oss.py /tmp/g1a-src -m /tmp/g1a-one.json
curl -sI https://ohsaisai.oss-cn-shanghai.aliyuncs.com/english-audio/g1a/01-starter.mp3 | head -5
```

Expected: `HTTP/1.1 200 OK` 且 `Content-Type: audio/mpeg`。
若是 `403`，说明 Bucket 未开公共读 —— 到阿里云控制台给 `english-audio/*` 配公共读，再继续。

- [ ] **Step 4: 上传全部**

```bash
python english-audio/scripts/upload_oss.py /tmp/g1a-src
```

Expected: `完成：上传 80，跳过 1`（Starter 在 Step 3 已传）

- [ ] **Step 5: 验证幂等（Review Focus #4）**

```bash
python english-audio/scripts/upload_oss.py /tmp/g1a-src
```

Expected: `完成：上传 0，跳过 81`

- [ ] **Step 6: 抽查三个 URL**

```bash
for k in 01-starter.mp3 unit03/18-rhyme-time.mp3 wordbank/81-unit-10.mp3; do
  curl -so /dev/null -w "%{http_code} %{size_download} $k\n" \
    "https://ohsaisai.oss-cn-shanghai.aliyuncs.com/english-audio/g1a/$k"
done
```

Expected: 三行都是 `200` 且 size 与 manifest 中文件大小相符。

- [ ] **Step 7: 配置 CORS 并验证**

在阿里云 OSS 控制台给 Bucket `ohsaisai` 加跨域规则：来源 `https://saisai.me`，方法 `GET`、`HEAD`，允许 Header `*`。然后：

```bash
curl -sI -H "Origin: https://saisai.me" \
  https://ohsaisai.oss-cn-shanghai.aliyuncs.com/english-audio/g1a/01-starter.mp3 \
  | grep -i access-control
```

Expected: 出现 `Access-Control-Allow-Origin: https://saisai.me`

- [ ] **Step 8: 格式化并提交**

```bash
/opt/homebrew/bin/black english-audio/scripts/
git status --short   # 确认 .env 不在列表里
git add english-audio/scripts/upload_oss.py
git commit -m "feat(english-audio): OSS 上传脚本"
```

---

### Task 4: 页面骨架与曲目列表

**Files:**
- Create: `english-audio/index.html`
- Create: `english-audio/styles.css`
- Create: `english-audio/ui.js`
- Create: `english-audio/main.js`

**Interfaces:**
- Consumes: `data/g1a.json`（Task 2）
- Produces:
  - `class UI` —— `constructor()`；`renderUnits(units, activeId)`；`renderTracks(unit, activeNo)`；
    `onUnitClick(fn)`；`onTrackClick(fn)`；`setStatus(html)`；静态 `UI.formatTime(seconds)`
  - `class App` —— `start()`；属性 `manifest`、`unit`

- [ ] **Step 1: 写 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>英语听力 - 一年级上册</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header class="topbar">
        <h1>🎧 英语 一年级上册</h1>
    </header>

    <main class="layout">
        <nav class="units" id="units"></nav>
        <section class="tracks" id="tracks"></section>
    </main>

    <footer class="playbar" id="playbar" hidden>
        <div class="playbar-main">
            <button class="btn-play" id="btn-play" aria-label="播放">▶</button>
            <div class="now">
                <div class="now-title" id="now-title"></div>
                <div class="seek">
                    <input type="range" id="seek" min="0" max="1000" value="0" aria-label="播放进度">
                    <span class="time" id="time">0:00 / 0:00</span>
                </div>
            </div>
        </div>
        <div class="playbar-tools">
            <span class="rate-group">
                🐢
                <button class="rate" data-rate="0.6">0.6x</button>
                <button class="rate" data-rate="0.8">0.8x</button>
                <button class="rate is-on" data-rate="1">1.0x</button>
            </span>
            <button id="btn-back">⏪5</button>
            <button id="btn-fwd">⏩5</button>
            <button id="btn-loop">🔁 单曲循环</button>
        </div>
    </footer>

    <div class="status" id="status" hidden></div>

    <audio id="audio" preload="none"></audio>

    <script src="player.js"></script>
    <script src="ui.js"></script>
    <script src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 styles.css**

```css
:root {
    --bg: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    --card: #ffffff;
    --ink: #2d3142;
    --muted: #6c757d;
    --accent: #667eea;
    --bar-h: 112px;
}

* { box-sizing: border-box; }

body {
    margin: 0;
    padding-bottom: var(--bar-h);
    font-family: 'PingFang SC', 'Segoe UI', system-ui, sans-serif;
    font-size: 17px;
    color: var(--ink);
    background: var(--bg);
    min-height: 100vh;
}

.topbar { padding: 14px 20px; }
.topbar h1 { margin: 0; font-size: 1.4em; color: #fff; }

.layout {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 16px;
    padding: 0 20px;
    align-items: start;
}

.units {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--card);
    border-radius: 12px;
    padding: 12px;
}

.unit-btn {
    min-height: 48px;
    border: none;
    border-radius: 10px;
    background: #f1f3f9;
    color: var(--ink);
    font-size: 17px;
    font-weight: 600;
    cursor: pointer;
}

.unit-btn.is-on { background: var(--accent); color: #fff; }

.tracks {
    background: var(--card);
    border-radius: 12px;
    padding: 16px;
}

.tracks h2 { margin: 0 0 12px; font-size: 1.3em; }

.track {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 64px;
    padding: 10px 16px;
    margin-bottom: 10px;
    border: 1px solid #e9ecef;
    border-radius: 10px;
    background: #f8f9fa;
    text-align: left;
    font-size: 17px;
    color: var(--ink);
    cursor: pointer;
}

.track:hover { background: #eef0fb; }
.track.is-on { background: var(--accent); color: #fff; border-color: var(--accent); }
.track-icon { font-size: 1.8em; }
.track-text { flex: 1; }
.track-title { font-weight: 600; }
.track-sub { font-size: 0.85em; opacity: 0.75; }
.track-dur { font-variant-numeric: tabular-nums; opacity: 0.75; }

.playbar {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    background: #ffffff;
    border-top: 2px solid #e9ecef;
    padding: 10px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.playbar-main { display: flex; align-items: center; gap: 14px; }

.btn-play {
    width: 56px; height: 56px;
    border: none; border-radius: 50%;
    background: var(--accent); color: #fff;
    font-size: 24px; cursor: pointer;
}

.now { flex: 1; min-width: 0; }
.now-title { font-weight: 600; margin-bottom: 4px; }
.seek { display: flex; align-items: center; gap: 12px; }
#seek { flex: 1; height: 32px; }
.time { font-variant-numeric: tabular-nums; color: var(--muted); }

.playbar-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.playbar-tools button, .rate {
    min-height: 44px; min-width: 56px;
    border: 1px solid #d7dbe8; border-radius: 10px;
    background: #f8f9fa; color: var(--ink);
    font-size: 16px; cursor: pointer;
}
.playbar-tools button.is-on, .rate.is-on { background: var(--accent); color: #fff; border-color: var(--accent); }
.rate-group { display: flex; align-items: center; gap: 6px; }

.status {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    padding: 24px;
    text-align: center;
    font-size: 20px;
    background: #fff3cd;
    cursor: pointer;
}

@media (max-width: 700px) {
    .layout { grid-template-columns: 1fr; }
    .units { flex-direction: row; overflow-x: auto; }
    .unit-btn { flex: 0 0 auto; padding: 0 16px; }
}
```

- [ ] **Step 3: 写 ui.js**

```javascript
const KIND_ICON = {
    starter: '🚀',
    task: '✅',
    words: '🔤',
    song: '🎵',
    rhyme: '📜',
    chant: '🥁',
    talking: '💬',
    story: '📖',
    wordbank: '📚'
};

class UI {
    constructor() {
        this.unitsEl = document.getElementById('units');
        this.tracksEl = document.getElementById('tracks');
        this.statusEl = document.getElementById('status');
        this.unitHandler = null;
        this.trackHandler = null;

        this.unitsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.unit-btn');
            if (btn && this.unitHandler) this.unitHandler(btn.dataset.id);
        });
        this.tracksEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.track');
            if (btn && this.trackHandler) this.trackHandler(Number(btn.dataset.no));
        });
    }

    static formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    onUnitClick(fn) { this.unitHandler = fn; }
    onTrackClick(fn) { this.trackHandler = fn; }

    renderUnits(units, activeId) {
        this.unitsEl.innerHTML = units.map((u) => {
            const on = u.id === activeId ? ' is-on' : '';
            const label = u.id === 'wordbank' ? '📚 单词表' : u.title;
            return `<button class="unit-btn${on}" data-id="${u.id}">${label}</button>`;
        }).join('');
    }

    renderTracks(unit, activeNo) {
        const rows = unit.tracks.map((t) => {
            const on = t.no === activeNo ? ' is-on' : '';
            const dur = t.duration ? UI.formatTime(t.duration) : '';
            return `<button class="track${on}" data-no="${t.no}">
                <span class="track-icon">${KIND_ICON[t.kind] || '🎧'}</span>
                <span class="track-text">
                    <span class="track-title">${t.title}</span>
                    <span class="track-sub">${t.subtitle}</span>
                </span>
                <span class="track-dur">${dur}</span>
            </button>`;
        }).join('');
        const sub = unit.subtitle ? ` <small>${unit.subtitle}</small>` : '';
        this.tracksEl.innerHTML = `<h2>${unit.title}${sub}</h2>` + rows;
    }

    setStatus(html) {
        if (!html) {
            this.statusEl.hidden = true;
            this.statusEl.innerHTML = '';
            return;
        }
        this.statusEl.hidden = false;
        this.statusEl.innerHTML = html;
    }
}
```

注意 `renderTracks` 里 `t.duration` 缺失时渲染空字符串，不是 `NaN:aN`（Review Focus #3）。

- [ ] **Step 4: 写 main.js（本任务只做渲染，播放在 Task 5 接上）**

```javascript
class App {
    constructor() {
        this.ui = new UI();
        this.manifest = null;
        this.unit = null;
    }

    async start() {
        const res = await fetch('data/g1a.json');
        this.manifest = await res.json();
        this.unit = this.manifest.units[0];

        this.ui.onUnitClick((id) => this.selectUnit(id));
        this.ui.onTrackClick((no) => console.log('track', no));

        this.ui.renderUnits(this.manifest.units, this.unit.id);
        this.ui.renderTracks(this.unit, null);
    }

    selectUnit(id) {
        this.unit = this.manifest.units.find((u) => u.id === id);
        this.ui.renderUnits(this.manifest.units, id);
        this.ui.renderTracks(this.unit, null);
    }
}

document.addEventListener('DOMContentLoaded', () => new App().start());
```

- [ ] **Step 5: 本地起服务验证**

`fetch` 在 `file://` 下会被浏览器拦截，必须起本地服务：

```bash
cd english-audio && python3 -m http.server 8777
```

浏览器打开 `http://localhost:8777/`，确认：
- 左栏 12 个按钮：Starter、Unit 1…Unit 10、📚 单词表
- 点 Unit 3，右栏标题变成 `Unit 3`，7 条卡片带图标、中文副标题、时长
- 点 📚 单词表，10 条 `Unit 1`…`Unit 10`
- 开发者工具切 iPhone 尺寸（<700px），左栏变成顶部横向滚动条
- Console 无报错，点卡片打印 `track <编号>`

- [ ] **Step 6: 提交**

```bash
git add english-audio/index.html english-audio/styles.css english-audio/ui.js english-audio/main.js
git commit -m "feat(english-audio): 页面骨架与单元/曲目列表渲染"
```

---

### Task 5: 播放器与播放条

**Files:**
- Create: `english-audio/player.js`
- Modify: `english-audio/main.js`

**Interfaces:**
- Consumes: Task 4 的 `UI`（`renderTracks`、`UI.formatTime`）
- Produces:
  - `class Player` —— `constructor(audioEl)`；`load(url, {autoplay})`；`toggle()`；`seekTo(seconds)`；
    `nudge(delta)`；`setRate(rate)`；`setLoop(on)`；`get playing()`；
    回调 `onTime(fn)`、`onEnded(fn)`、`onState(fn)`

- [ ] **Step 1: 写 player.js**

```javascript
class Player {
    constructor(audioEl) {
        this.audio = audioEl;
        this.timeHandler = null;
        this.endedHandler = null;
        this.stateHandler = null;

        this.audio.addEventListener('timeupdate', () => this.emitTime());
        this.audio.addEventListener('loadedmetadata', () => this.emitTime());
        this.audio.addEventListener('play', () => this.emitState());
        this.audio.addEventListener('pause', () => this.emitState());
        this.audio.addEventListener('ended', () => {
            if (this.endedHandler) this.endedHandler();
        });
    }

    get playing() { return !this.audio.paused; }
    get currentTime() { return this.audio.currentTime; }
    get duration() { return this.audio.duration; }

    onTime(fn) { this.timeHandler = fn; }
    onEnded(fn) { this.endedHandler = fn; }
    onState(fn) { this.stateHandler = fn; }

    emitTime() {
        if (this.timeHandler) this.timeHandler(this.audio.currentTime, this.audio.duration);
    }

    emitState() {
        if (this.stateHandler) this.stateHandler(this.playing);
    }

    load(url, options) {
        const opts = options || {};
        this.audio.src = url;
        this.audio.load();
        if (opts.startAt) {
            this.audio.addEventListener('loadedmetadata', () => {
                this.audio.currentTime = opts.startAt;
            }, { once: true });
        }
        if (opts.autoplay) return this.audio.play();
        return Promise.resolve();
    }

    toggle() {
        if (this.playing) {
            this.audio.pause();
            return Promise.resolve();
        }
        return this.audio.play();
    }

    seekTo(seconds) {
        if (isFinite(seconds)) this.audio.currentTime = seconds;
    }

    nudge(delta) {
        this.seekTo(Math.max(0, Math.min(this.audio.duration || 0, this.audio.currentTime + delta)));
    }

    setRate(rate) {
        this.audio.playbackRate = rate;
        this.audio.preservesPitch = true;
        this.audio.mozPreservesPitch = true;
        this.audio.webkitPreservesPitch = true;
    }

    setLoop(on) { this.audio.loop = on; }
}
```

`preservesPitch = true` 保证 0.6x 慢放不变调（Safari 需要 `webkitPreservesPitch`）。

- [ ] **Step 2: 在 main.js 接上播放**

把 `main.js` 整体替换为：

```javascript
class App {
    constructor() {
        this.ui = new UI();
        this.player = new Player(document.getElementById('audio'));
        this.manifest = null;
        this.unit = null;
        this.track = null;

        this.playbar = document.getElementById('playbar');
        this.btnPlay = document.getElementById('btn-play');
        this.nowTitle = document.getElementById('now-title');
        this.seek = document.getElementById('seek');
        this.timeEl = document.getElementById('time');
        this.seeking = false;
    }

    async start() {
        const res = await fetch('data/g1a.json');
        this.manifest = await res.json();
        this.unit = this.manifest.units[0];

        this.ui.onUnitClick((id) => this.selectUnit(id));
        this.ui.onTrackClick((no) => this.playTrack(no, true));

        this.btnPlay.addEventListener('click', () => this.player.toggle());
        this.seek.addEventListener('input', () => { this.seeking = true; });
        this.seek.addEventListener('change', () => {
            this.seeking = false;
            const d = this.player.duration;
            if (isFinite(d)) this.player.seekTo((this.seek.value / 1000) * d);
        });

        this.player.onTime((t, d) => this.renderTime(t, d));
        this.player.onState((playing) => {
            this.btnPlay.textContent = playing ? '⏸' : '▶';
            this.btnPlay.setAttribute('aria-label', playing ? '暂停' : '播放');
        });
        this.player.onEnded(() => this.playNext());

        this.ui.renderUnits(this.manifest.units, this.unit.id);
        this.ui.renderTracks(this.unit, null);
    }

    selectUnit(id) {
        this.unit = this.manifest.units.find((u) => u.id === id);
        this.ui.renderUnits(this.manifest.units, id);
        const activeNo = this.track && this.unitOf(this.track).id === id ? this.track.no : null;
        this.ui.renderTracks(this.unit, activeNo);
    }

    unitOf(track) {
        return this.manifest.units.find((u) => u.tracks.indexOf(track) !== -1);
    }

    playTrack(no, autoplay) {
        const track = this.unit.tracks.find((t) => t.no === no);
        if (!track) return;
        this.track = track;
        this.playbar.hidden = false;
        this.nowTitle.textContent = this.unit.title + ' · ' + track.title;
        this.ui.renderTracks(this.unit, no);
        this.player.load(this.manifest.baseUrl + track.key, { autoplay: autoplay });
    }

    playNext() {
        if (!this.track) return;
        const unit = this.unitOf(this.track);
        const i = unit.tracks.indexOf(this.track);
        if (i < 0 || i + 1 >= unit.tracks.length) return;
        if (unit.id !== this.unit.id) this.selectUnit(unit.id);
        this.playTrack(unit.tracks[i + 1].no, true);
    }

    renderTime(t, d) {
        if (!this.seeking && isFinite(d) && d > 0) {
            this.seek.value = Math.round((t / d) * 1000);
        }
        this.timeEl.textContent = UI.formatTime(t) + ' / ' + UI.formatTime(d);
    }
}

document.addEventListener('DOMContentLoaded', () => new App().start());
```

- [ ] **Step 3: 验证**

```bash
cd english-audio && python3 -m http.server 8777
```

打开 `http://localhost:8777/`，确认：
- 点任一曲目开始播放，播放条出现，标题形如 `Unit 3 · Rhyme time`
- 播放/暂停按钮图标在 ▶ / ⏸ 间切换
- 进度条随播放前进；拖动进度条跳转且不被 timeupdate 打架
- 一条播完自动播本单元下一条；单元最后一条播完停止
- 播放中点左栏别的单元，音频**不中断**，播放条仍显示原曲目

- [ ] **Step 4: 提交**

```bash
git add english-audio/player.js english-audio/main.js
git commit -m "feat(english-audio): 播放器与常驻播放条"
```

---

### Task 6: 跟读功能（慢速 / 循环 / 回跳）与续播

**Files:**
- Modify: `english-audio/main.js`

**Interfaces:**
- Consumes: Task 5 的 `Player.setRate`、`Player.setLoop`、`Player.nudge`
- Produces: `App.prefs`（`{unitId, no, time, rate, loop}`，存 localStorage 键 `english-audio:g1a`）

- [ ] **Step 1: 在 App 里加偏好读写**

在 `main.js` 的 `class App` 内加两个方法：

```javascript
    loadPrefs() {
        try {
            return JSON.parse(localStorage.getItem('english-audio:g1a')) || {};
        } catch (e) {
            return {};
        }
    }

    savePrefs() {
        const p = {
            unitId: this.unit ? this.unit.id : null,
            no: this.track ? this.track.no : null,
            time: this.player.currentTime,
            rate: this.rate,
            loop: this.loop
        };
        try {
            localStorage.setItem('english-audio:g1a', JSON.stringify(p));
        } catch (e) {
            // 隐私模式下 localStorage 写入会抛异常，忽略即可
        }
    }
```

- [ ] **Step 2: 在 constructor 里补字段**

在 `this.seeking = false;` 之后加：

```javascript
        this.btnBack = document.getElementById('btn-back');
        this.btnFwd = document.getElementById('btn-fwd');
        this.btnLoop = document.getElementById('btn-loop');
        this.rateBtns = Array.from(document.querySelectorAll('.rate'));
        this.rate = 1;
        this.loop = false;
```

- [ ] **Step 3: 在 start() 里绑定控件并恢复上次状态**

把 `start()` 里 `this.ui.renderUnits(...)` 之前的部分补上：

```javascript
        this.btnBack.addEventListener('click', () => this.player.nudge(-5));
        this.btnFwd.addEventListener('click', () => this.player.nudge(5));
        this.btnLoop.addEventListener('click', () => this.setLoop(!this.loop));
        this.rateBtns.forEach((b) => {
            b.addEventListener('click', () => this.setRate(Number(b.dataset.rate)));
        });

        const prefs = this.loadPrefs();
        this.setRate(prefs.rate || 1);
        this.setLoop(Boolean(prefs.loop));

        const saved = prefs.unitId && this.manifest.units.find((u) => u.id === prefs.unitId);
        if (saved) this.unit = saved;
```

并把 `start()` 结尾改成：

```javascript
        this.ui.renderUnits(this.manifest.units, this.unit.id);
        this.ui.renderTracks(this.unit, null);

        if (saved && prefs.no) {
            this.playTrack(prefs.no, false, prefs.time || 0);
        }

        setInterval(() => this.savePrefs(), 3000);
        window.addEventListener('pagehide', () => this.savePrefs());
```

刷新后只**定位**到上次曲目和进度，不自动播放。

同时把 Task 5 里 `playTrack` 的签名从 `playTrack(no, autoplay)` 改成
`playTrack(no, autoplay, startAt)`，内部的 `load` 调用相应改为：

```javascript
        this.player.load(this.manifest.baseUrl + track.key, {
            autoplay: autoplay,
            startAt: startAt || 0
        });
```

- [ ] **Step 4: 加 setRate / setLoop / Media Session**

在 `class App` 内加：

```javascript
    setRate(rate) {
        this.rate = rate;
        this.player.setRate(rate);
        this.rateBtns.forEach((b) => {
            b.classList.toggle('is-on', Number(b.dataset.rate) === rate);
        });
        this.savePrefs();
    }

    setLoop(on) {
        this.loop = on;
        this.player.setLoop(on);
        this.btnLoop.classList.toggle('is-on', on);
        this.savePrefs();
    }

    updateMediaSession() {
        if (!('mediaSession' in navigator) || !this.track) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.track.title,
            artist: this.unit.title,
            album: this.manifest.title
        });
        navigator.mediaSession.setActionHandler('play', () => this.player.toggle());
        navigator.mediaSession.setActionHandler('pause', () => this.player.toggle());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
        navigator.mediaSession.setActionHandler('seekbackward', () => this.player.nudge(-5));
        navigator.mediaSession.setActionHandler('seekforward', () => this.player.nudge(5));
    }
```

在 `playTrack()` 末尾（`this.player.load(...)` 之后）加两行：

```javascript
        this.player.setRate(this.rate);
        this.updateMediaSession();
```

`load()` 会重置 `playbackRate`，所以每次换曲都要重设倍速。

- [ ] **Step 5: 验证**

```bash
cd english-audio && python3 -m http.server 8777
```

逐条确认：
- 点 `0.6x`，声音变慢但**音调不变**（不是"大叔音"）；按钮高亮跟着切换
- 换一首后倍速仍然是 0.6x
- 开 `🔁 单曲循环`，一条播完原地重播，不跳下一条
- 关循环后播完自动跳下一条
- `⏪5` 回退 5 秒，在开头点不会跳到负数
- 刷新页面，左栏停在上次单元，播放条显示上次曲目和进度，且**没有**自动播放
- 平板/手机锁屏后，锁屏控件显示曲名并能播放暂停

- [ ] **Step 6: 提交**

```bash
git add english-audio/main.js
git commit -m "feat(english-audio): 慢速、单曲循环、回跳 5 秒与续播"
```

---

### Task 7: 错误处理与加载态

**Files:**
- Modify: `english-audio/main.js`
- Modify: `english-audio/player.js`

**Interfaces:**
- Consumes: Task 4 的 `UI.setStatus`
- Produces: `Player.onError(fn)` 回调

- [ ] **Step 1: 在 player.js 加 error 事件**

在 `constructor` 的事件绑定里追加：

```javascript
        this.errorHandler = null;
        this.audio.addEventListener('error', () => {
            if (this.errorHandler) this.errorHandler();
        });
        this.audio.addEventListener('stalled', () => {
            if (this.errorHandler) this.errorHandler();
        });
```

并加方法：

```javascript
    onError(fn) { this.errorHandler = fn; }
```

- [ ] **Step 2: 在 main.js 处理 manifest 加载失败**

把 `start()` 开头的 fetch 换成：

```javascript
    async start() {
        try {
            const res = await fetch('data/g1a.json');
            if (!res.ok) throw new Error(res.status);
            this.manifest = await res.json();
        } catch (e) {
            this.ui.setStatus('😟 没有加载到内容，点我重试');
            document.getElementById('status').addEventListener(
                'click', () => location.reload(), { once: true }
            );
            return;
        }
```

- [ ] **Step 3: 处理音频加载失败**

在 `start()` 里绑定：

```javascript
        this.player.onError(() => {
            this.ui.setStatus('😟 没连上网络，点我重试');
            document.getElementById('status').addEventListener('click', () => {
                this.ui.setStatus('');
                if (this.track) this.playTrack(this.track.no, true);
            }, { once: true });
        });
```

并在 `playTrack()` 开头清掉上一次的提示：

```javascript
        this.ui.setStatus('');
```

- [ ] **Step 4: 验证**

```bash
cd english-audio && python3 -m http.server 8777
```

- 开发者工具 Network 选 Offline，点一条曲目 → 底部出现 `😟 没连上网络，点我重试`
- 恢复网络，点提示 → 提示消失并正常播放
- 把 `data/g1a.json` 临时改名后刷新 → 整页提示 `😟 没有加载到内容，点我重试`，点击后重载。验证完改回来
- 提示文字是大字（20px）、高对比，不出现任何错误码

- [ ] **Step 5: 提交**

```bash
git add english-audio/main.js english-audio/player.js
git commit -m "feat(english-audio): 断网与加载失败的友好提示"
```

---

### Task 8: 子项目入口与文档

**Files:**
- Create: `english-audio/README.md`
- Modify: `index.html`（根，在 `solve-equation` 那个 `.folder-section` 之后）
- Modify: `README.md`（根，在项目列表末尾）

**Interfaces:**
- Consumes: 以上全部
- Produces: 无

- [ ] **Step 1: 写子项目 README**

创建 `english-audio/README.md`：

```markdown
# 英语教材配套音频

《英语（一年级上册）》教材配套音频的在线收听页。按单元列出，点击即播，
为跟读提供 0.6x / 0.8x 慢速、单曲循环和回跳 5 秒。

音频存在阿里云 OSS（`ohsaisai` bucket，前缀 `english-audio/g1a/`），
曲目信息在 `data/g1a.json`。

## 本地预览

`fetch` 在 `file://` 下会被拦截，需要起本地服务：

    python3 -m http.server 8777

然后打开 http://localhost:8777/

## 重新生成与上传

    source ~/tmp/fuck/c/.venv/bin/activate
    uv pip install mutagen oss2 python-dotenv

    python scripts/extract_zip.py <教材音频.zip> /tmp/g1a-src
    python scripts/build_manifest.py /tmp/g1a-src -o data/g1a.json
    python scripts/upload_oss.py /tmp/g1a-src

上传脚本从项目根 `.env` 读 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` /
`OSS_ENDPOINT` / `OSS_BUCKET`，幂等（已存在且大小一致则跳过）。

## 测试

    cd scripts && python -m pytest test_build_manifest.py -v
```

- [ ] **Step 2: 根 index.html 加入口**

在 `solve-equation` 的 `</div>` 之后、`</div>`（container）之前插入：

```html
        <div class="folder-section">
            <div class="folder-name">
                <span class="folder-icon">📁</span>
                english-audio
            </div>
            <ul class="file-list">
                <li class="file-item">
                    <a href="english-audio/index.html" class="file-link">英语听力 · 一年级上册</a>
                </li>
            </ul>
        </div>
```

- [ ] **Step 3: 根 README.md 加一节**

在文件末尾追加：

```markdown
### 🎧 [英语听力 · 一年级上册](english-audio/index.html) (english-audio)
《英语（一年级上册）》教材配套音频。按单元收听，支持慢速跟读与单曲循环。
```

- [ ] **Step 4: 验证**

```bash
cd /Users/jialiu/Projects/saisai.me && python3 -m http.server 8777
```

打开 `http://localhost:8777/`，确认导航页多出 english-audio 一项，点进去页面正常。

- [ ] **Step 5: 提交**

```bash
git add english-audio/README.md index.html README.md
git commit -m "docs(english-audio): 子项目说明与导航入口"
```

---

## 最终验收清单

部署（push 到 main，GitHub Pages 自动发布）后，在 **10 寸平板横屏** 上实际走一遍：

- [ ] https://saisai.me/english-audio/ 打开，12 个单元都在
- [ ] 点 Unit 3 → 点 `Rhyme time` → 正常出声
- [ ] 0.6x 慢放不变调
- [ ] 单曲循环开关有效
- [ ] ⏪5 有效
- [ ] 单元内自动连播
- [ ] 刷新后停在上次位置
- [ ] 锁屏能控制播放
- [ ] 手机竖屏下单元变成顶部横向滚动条，操作区拇指够得到
