"""按 data/pinyin.json 合成 118 条标准音。幂等：已存在且大小合理则跳过。

带 derive 字段的条目（o / eng / ong）没有能用的零声母音节，改为合成
载体音节再裁掉声母 —— 原因见 build_data.py 里 DERIVED_FROM 的注释。
"""

import argparse
import json
import os
import sys

import numpy as np
import requests
from dotenv import load_dotenv

from smoke_tts import get_token

HOST = "https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts"
# aitong（儿童音）。实测 xiaoyun 把孤立音节当整句读，在词汇声调之上叠了
# 句末降调：一声从 264 掉到 206Hz（降 4 个半音），三声被读成下降调，
# 四条里只有四声的形状是对的。aitong 的四声形状基本正确。见 README。
DEFAULT_VOICE = "aitong"
MIN_BYTES = 1000  # 比这还小基本是失败或静音


def synthesis_plan(item):
    """返回 (要合成的音节, 是否需要裁掉声母)。

    带 derive 的条目没有能用的零声母音节，只能从载体音节裁出来。
    """
    if item.get("derive"):
        return item["derive"], True
    return item["ssml"], False


def build_ssml(ssml):
    """汉字只是载体，发音完全由 ph 决定。"""
    return '<speak><phoneme alphabet="py" ph="%s">啊</phoneme></speak>' % ssml


def pending_items(items, out_dir):
    out = []
    for it in items:
        path = os.path.join(out_dir, it["key"])
        if os.path.exists(path) and os.path.getsize(path) >= MIN_BYTES:
            continue
        out.append(it)
    return out


def vowel_onset(samples, sample_rate, frame_ms=5):
    """找元音起始点，用来从 dōng 里裁掉声母 d。

    算短时能量，找到能量首次超过峰值 25% 并在之后连续 30ms 保持的位置。
    塞音爆破是个孤立尖峰，撑不过 30ms，因此会被跳过。
    """
    hop = max(1, int(sample_rate * frame_ms / 1000))
    n = len(samples) // hop
    if n == 0:
        return 0
    energy = np.array(
        [
            float(np.sqrt(np.mean(samples[i * hop : (i + 1) * hop] ** 2)))
            for i in range(n)
        ]
    )
    if energy.max() <= 0:
        return 0
    thresh = energy.max() * 0.25
    hold = max(1, int(30 / frame_ms))
    for i in range(n - hold):
        if np.all(energy[i : i + hold] >= thresh):
            return i * hop
    return 0


FADE_MS = 25  # 切口处的淡入时长


def fade_in(y, sample_rate, ms=FADE_MS):
    """就地加升余弦淡入。

    从音节中间硬切会让声音没有起音过程，听感是"咔"一下蹦出来：实测未加
    淡入的 ong 在 12.6ms 就冲到半峰，其他韵母都要 ~87ms。
    """
    n = min(len(y), int(sample_rate * ms / 1000))
    if n > 1:
        ramp = 0.5 * (1.0 - np.cos(np.linspace(0.0, np.pi, n)))
        y[:n] *= ramp.reshape(-1, *([1] * (y.ndim - 1)))
    return y


def trim_initial(mp3_path):
    """就地把 mp3 的声母段裁掉，返回裁掉的毫秒数。

    只在 --ong-mode trim-dong 下用到：普通话没有单独的 ong 音节，
    只能合成 dōng 再把 d 裁掉（教学上示范 ong 本来就是这么做的）。

    用 soundfile（libsndfile ≥ 1.1 直接读写 MP3），不走 pydub ——
    后者解 mp3 要系统装 ffmpeg，多一个装不上就全线卡住的依赖。
    """
    import soundfile as sf

    data, sr = sf.read(mp3_path, always_2d=True)
    mono = data.mean(axis=1)

    onset = vowel_onset(mono, sr)
    cut = np.array(data[onset:], dtype=np.float64)
    sf.write(mp3_path, fade_in(cut, sr), sr, format="MP3")
    return int(onset * 1000 / sr)


def synth_to(token, appkey, ssml, out_path, voice=DEFAULT_VOICE):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    payload = {
        "appkey": appkey,
        "token": token,
        "text": build_ssml(ssml),
        "format": "mp3",
        "sample_rate": 16000,
        "voice": voice,
    }
    r = requests.post(HOST, json=payload, timeout=20)
    if "audio" not in r.headers.get("Content-Type", ""):
        raise RuntimeError("合成失败 %s: %s" % (ssml, r.text[:200]))
    with open(out_path, "wb") as f:
        f.write(r.content)
    return len(r.content)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-d", "--data", default="pinyin/data/pinyin.json")
    p.add_argument("-o", "--out", default="/tmp/pinyin-audio")
    p.add_argument("--voice", default=DEFAULT_VOICE)
    args = p.parse_args()

    load_dotenv()
    token = get_token(
        os.environ["OSS_ACCESS_KEY_ID"], os.environ["OSS_ACCESS_KEY_SECRET"]
    )
    appkey = os.environ["NLS_APPKEY"]

    data = json.load(open(args.data, encoding="utf-8"))
    items = [it for g in data["groups"] for it in g["items"]]
    todo = pending_items(items, args.out)
    print("共 %d 条，待合成 %d 条" % (len(items), len(todo)))

    for i, it in enumerate(todo, 1):
        ssml, needs_trim = synthesis_plan(it)
        path = os.path.join(args.out, it["key"])
        size = synth_to(token, appkey, ssml, path, args.voice)
        note = ""
        if needs_trim:
            note = "，裁掉声母 %dms" % trim_initial(path)
        print(
            "[%d/%d] %s <- %s (%d bytes)%s"
            % (i, len(todo), it["key"], ssml, size, note)
        )

    print("完成，音频在 %s（发音人 %s）" % (args.out, args.voice))
    return 0


if __name__ == "__main__":
    sys.exit(main())
