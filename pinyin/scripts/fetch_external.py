"""用外部来源的录音覆盖掉少数几条标准音。

**授权状态见 README「外部素材」一节。** 这里引用的站点带版权声明、
没有开放授权，上线前必须先取得书面许可 —— 脚本不替你解决这件事。

为什么需要：`ong` 在普通话里不是一个独立音节，TTS 合成不出来，我们
只能从 dōng 裁掉声母得到。hanyupinyin.cn 有真人直接念的 ong。

覆盖时做两件事，否则混在一套音频里会很跳：
  - 掐掉前后静音
  - 把发声段的响度对齐到我们这套的水平
音高一个字节都不动 —— 取它就是为了那条真人的调。
"""

import argparse
import json
import os
import sys
import urllib.request

import numpy as np

# 我们的条目 id → 外部文件 URL
SOURCES = {
    "ong1": "http://du.hanyupinyin.cn/du/pinyin/ong1.mp3",
    "ong2": "http://du.hanyupinyin.cn/du/pinyin/ong2.mp3",
    "ong3": "http://du.hanyupinyin.cn/du/pinyin/ong3.mp3",
    "ong4": "http://du.hanyupinyin.cn/du/pinyin/ong4.mp3",
}

FRAME_MS = 10.0
ABS_FLOOR = 0.005
REL_RATIO = 0.15
PAD_MS = 60.0
# 我们这套换调版发声段 RMS 的中位数
TARGET_RMS = 0.26


def _voiced_span(x, sample_rate):
    hop = max(1, int(sample_rate * FRAME_MS / 1000))
    n = len(x) // hop
    if n == 0:
        return None
    energy = np.array(
        [np.sqrt(np.mean(x[i * hop : (i + 1) * hop] ** 2)) for i in range(n)]
    )
    if energy.max() < ABS_FLOOR:
        return None
    hot = np.where(energy >= max(ABS_FLOOR, energy.max() * REL_RATIO))[0]
    if len(hot) == 0:
        return None
    return hot[0] * hop, min(len(x), (hot[-1] + 1) * hop)


def voiced_rms(x, sample_rate):
    """只算发声段的 RMS。整条算的话，静音越长数值越小，没法横向比。"""
    span = _voiced_span(x, sample_rate)
    if span is None:
        return 0.0
    return float(np.sqrt(np.mean(x[span[0] : span[1]] ** 2)))


def trim_silence(x, sample_rate):
    span = _voiced_span(x, sample_rate)
    if span is None:
        return x
    pad = int(sample_rate * PAD_MS / 1000)
    return x[max(0, span[0] - pad) : min(len(x), span[1] + pad)]


def normalize_loudness(x, sample_rate, target=TARGET_RMS):
    cur = voiced_rms(x, sample_rate)
    if cur <= 0:
        return x
    y = x * (target / cur)
    peak = float(np.abs(y).max())
    if peak > 1.0:  # 宁可轻一点也不削顶
        y = y / peak
    return y


def main():
    import soundfile as sf

    p = argparse.ArgumentParser()
    p.add_argument("-d", "--data", default="pinyin/data/pinyin.json")
    p.add_argument("-o", "--out", default="/tmp/pinyin-retoned")
    args = p.parse_args()

    data = json.load(open(args.data, encoding="utf-8"))
    by_id = {i["id"]: i for g in data["groups"] for i in g["items"]}

    for item_id, url in SOURCES.items():
        it = by_id[item_id]
        dst = os.path.join(args.out, it["key"])
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "http://du.hanyupinyin.cn/",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
        tmp = dst + ".download"
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(tmp, "wb").write(raw)

        x, sr = sf.read(tmp, always_2d=True)
        x = x.mean(axis=1)
        before = voiced_rms(x, sr)
        y = normalize_loudness(trim_silence(x, sr), sr)
        sf.write(dst, y, sr, format="MP3")
        os.remove(tmp)
        print(
            "%-6s <- %s  %.2fs→%.2fs  RMS %.3f→%.3f"
            % (
                it["key"],
                url.rsplit("/", 1)[1],
                len(x) / sr,
                len(y) / sr,
                before,
                voiced_rms(y, sr),
            )
        )

    print("覆盖 %d 条。授权状态见 README「外部素材」。" % len(SOURCES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
