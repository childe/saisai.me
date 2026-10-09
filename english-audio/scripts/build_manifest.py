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
