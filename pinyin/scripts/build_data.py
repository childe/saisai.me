"""生成 data/pinyin.json。

id / key 里 ü 一律写作 v（lv = ü，ve = üe，vn = ün），避免 URL 与文件名编码问题；
display 才是屏幕上的真实字形。
"""

import json
import os
import sys

BASE_URL = "https://ohsaisai.oss-cn-shanghai.aliyuncs.com/pinyin/"

# (字母, 呼读音)
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
            ("o", "o", "o"),
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
            ("ong", "ong", "ong"),
        ],
    ),
]

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
                items.append(
                    {
                        "id": "%s%d" % (fid, tone),
                        "display": with_tone(display, tone),
                        "baseDisplay": display,
                        "base": fid,
                        "tone": tone,
                        "ssml": "%s%d" % (syllable, tone),
                        "key": "ym/%s%d.mp3" % (fid, tone),
                    }
                )
        groups.append({"id": gid, "title": title, "items": items})

    bases = [s[0] for s in SHENGMU]
    bases += [f[0] for _g, _t, finals in YUNMU for f in finals]

    return {
        "baseUrl": BASE_URL,
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
