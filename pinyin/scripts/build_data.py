"""生成 data/pinyin.json。

id / key 里 ü 一律写作 v（lv = ü，ve = üe，vn = ün），避免 URL 与文件名编码问题；
display 才是屏幕上的真实字形。
"""

import json
import os
import sys

BASE_URL = "https://ohsaisai.oss-cn-shanghai.aliyuncs.com/pinyin/"

# 可选音色。音频按 <baseUrl><voice>/<key> 存放，所以 key 里不带音色，
# 换音色只是换 URL 前缀，不用重建数据。
VOICES = [
    {"id": "aitong", "label": "童声"},
    {"id": "xiaoyun", "label": "女声"},
    {"id": "xiaogang", "label": "男声"},
]
DEFAULT_VOICE = "aitong"

# (字母, 呼读音)
#
# 注意：声母 w 的呼读音是 wu，和韵母 u 送进 TTS 的音节完全一样；y/yi 与韵母 i
# 同理。两对的音频内容相同 —— 这是呼读音规则决定的，不是 bug。
# 选择题里它们不会同时出现，只因为干扰项兜底按 group 过滤（见 lib/distractors.js
# 第三级）。谁要放宽那一级，就会在「全部」范围里造出两个读音完全一样的选项。
SHENGMU = [
    ("b", "bo"),
    ("p", "po"),
    ("m", "mo"),
    ("f", "fo"),
    ("d", "de"),
    ("t", "te"),
    ("n", "ne"),
    ("l", "le"),
    ("g", "ge"),
    ("k", "ke"),
    ("h", "he"),
    ("j", "ji"),
    ("q", "qi"),
    ("x", "xi"),
    ("zh", "zhi"),
    ("ch", "chi"),
    ("sh", "shi"),
    ("r", "ri"),
    ("z", "zi"),
    ("c", "ci"),
    ("s", "si"),
    ("y", "yi"),
    ("w", "wu"),
]

# (组 id, 组标题, [(内部 id, 显示字形, 零声母合成音节)])
YUNMU = [
    (
        "danyun",
        "单韵母",
        [
            ("a", "a", "a"),
            ("o", "o", "wo"),
            ("e", "e", "e"),
            ("i", "i", "yi"),
            ("u", "u", "wu"),
            ("lv", "ü", "yu"),
        ],
    ),
    (
        "fuyun",
        "复韵母",
        [
            ("ai", "ai", "ai"),
            ("ei", "ei", "ei"),
            ("ui", "ui", "wei"),
            ("ao", "ao", "ao"),
            ("ou", "ou", "ou"),
            ("iu", "iu", "you"),
            ("ie", "ie", "ye"),
            ("ve", "üe", "yue"),
            ("er", "er", "er"),
        ],
    ),
    (
        "biyun",
        "鼻韵母",
        [
            ("an", "an", "an"),
            ("en", "en", "en"),
            ("in", "in", "yin"),
            ("un", "un", "wen"),
            ("vn", "ün", "yun"),
            ("ang", "ang", "ang"),
            ("eng", "eng", "eng"),
            ("ing", "ing", "ying"),
            ("ong", "ong", "weng"),
        ],
    ),
]

# 仍需从载体音节裁掉声母才能得到的韵母。
#
# o / eng / ong 都没有能用的零声母音节 —— 连收录 413 个音节的公有领域
# 真人音库都缺这三个，TTS 引擎同样没有，只能瞎凑：实测 ph="ong1" 和
# ph="wong1" 都返回 288 字节的静音，ph="o1" 被读成了「欧」。
#
# o 和 ong 改为借用最接近的**真实**音节（见 YUNMU 里的 wo / weng），
# 不必裁切；eng 没有合适的借用对象（weng 已经给了 ong），仍从 beng 裁。
# 载体挑塞音声母：爆破之后有明确的除阻段，切点找得准。
DERIVED_FROM = {"eng": "beng"}

# 声调符号，按《汉语拼音方案》标在主元音上。
TONE_MARKS = {
    "a": "āáǎà",
    "o": "ōóǒò",
    "e": "ēéěè",
    "i": "īíǐì",
    "u": "ūúǔù",
    "ü": "ǖǘǚǜ",
}

VOWEL_ORDER = "aoeiuü"


def mark_vowel(display):
    """返回 display 里该标调的那个元音的下标。

    有 a 标 a；没 a 有 o 或 e 就标它；其余（iu / ui / un 这类）标在最后一个元音上。
    """
    for ch in "aoe":
        if ch in display:
            return display.index(ch)
    idxs = [i for i, c in enumerate(display) if c in VOWEL_ORDER]
    return idxs[-1]


def with_tone(display, tone):
    i = mark_vowel(display)
    ch = display[i]
    return display[:i] + TONE_MARKS[ch][tone - 1] + display[i + 1 :]


# 易混同伴。声母按发音部位 + 字形；韵母按前后鼻音、形近、同主元音。
_PEERS = [
    # 声母：发音部位
    ["b", "p", "m", "f"],
    ["d", "t", "n", "l"],
    ["g", "k", "h"],
    ["j", "q", "x"],
    ["zh", "ch", "sh", "r"],
    ["z", "c", "s"],
    ["zh", "z"],
    ["ch", "c"],
    ["sh", "s"],
    # 声母：字形易混
    ["b", "d"],
    ["p", "q"],
    ["b", "p"],
    ["d", "q"],
    ["y", "w"],
    ["y", "x"],
    ["w", "m"],
    # 韵母：前后鼻音
    ["an", "ang"],
    ["en", "eng"],
    ["in", "ing"],
    # 韵母：形近易混
    ["ui", "iu"],
    ["ui", "ei"],
    ["iu", "ou"],
    ["ie", "ve"],
    ["ie", "ei"],
    ["un", "vn"],
    ["u", "lv"],
    ["ai", "ei"],
    ["ao", "ou"],
    ["an", "en"],
    ["ang", "eng"],
    # 韵母：同主元音
    ["a", "ai", "ao"],
    ["e", "ei", "er"],
    ["i", "in", "ing"],
    ["o", "ou", "ong"],
    ["u", "un"],
    ["lv", "vn", "ve"],
]


def confusions_for(base):
    out = []
    for group in _PEERS:
        if base in group:
            for other in group:
                if other != base and other not in out:
                    out.append(other)
    return out


def build():
    groups = [
        {
            "id": "shengmu",
            "title": "声母",
            "items": [
                {
                    "id": letter,
                    "display": letter,
                    "readAs": read_as,
                    "ssml": read_as + "1",
                    "key": "sm/%s.mp3" % letter,
                }
                for letter, read_as in SHENGMU
            ],
        }
    ]

    for gid, title, finals in YUNMU:
        items = []
        for fid, display, syllable in finals:
            for tone in (1, 2, 3, 4):
                if fid == "er" and tone == 1:
                    continue  # 现代汉语没有 ēr
                item = {
                    "id": "%s%d" % (fid, tone),
                    "display": with_tone(display, tone),
                    "baseDisplay": display,
                    "base": fid,
                    "tone": tone,
                    "ssml": "%s%d" % (syllable, tone),
                    "key": "ym/%s%d.mp3" % (fid, tone),
                }
                if fid in DERIVED_FROM:
                    item["derive"] = "%s%d" % (DERIVED_FROM[fid], tone)
                items.append(item)
        groups.append({"id": gid, "title": title, "items": items})

    bases = [s[0] for s in SHENGMU]
    bases += [f[0] for _g, _t, finals in YUNMU for f in finals]

    return {
        "baseUrl": BASE_URL,
        "voices": VOICES,
        "defaultVoice": DEFAULT_VOICE,
        "groups": groups,
        "confusions": {b: confusions_for(b) for b in bases},
    }


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "data", "pinyin.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    data = build()
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    n = sum(len(g["items"]) for g in data["groups"])
    print("写出 %s，共 %d 条" % (os.path.normpath(out), n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
