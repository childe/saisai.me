"""把合成音的音高曲线换成标准调型，音色保持不变。

为什么需要这一步：句子级 TTS 把一个孤立音节当成一句完整的话来读，
在词汇声调之上叠了句末语调。实测 12 个阿里云发音人，没有一个四声
形状全对 —— xiaoyun 叠降调（一声从 264 掉到 206Hz），aitong 叠升调
（一声往上走 3.2 个半音）。后果不只是跟读打分错，是音频本身在教错的调。

做法：WORLD 声码器拆出 F0 / 频谱包络 / 非周期性成分，只把 F0 换成
按《汉语拼音方案》的标准调型（赵元任五度标调法）生成的曲线，
再重新合成。音色、音长、音强都来自原音，只有音高被改写。

声调基准取这条音频自身 F0 的中位数，所以换调不会改变说话人的音域。
"""

import argparse
import glob
import json
import os
import sys

import numpy as np

# 赵元任五度标调法 → 相对说话人音高中心的半音偏移，t 为 0..1 的归一化时间。
# 五度之间约 2 个半音：5 度 ≈ +4，3 度 ≈ 0，1 度 ≈ -4。
_SHAPES = {
    1: lambda t: np.full_like(t, 4.0),  # 55  高平
    2: lambda t: 0.0 + 4.0 * t,  # 35  中升
    3: lambda t: np.where(  # 214 低降升
        t < 0.55, -2.0 - 2.0 * (t / 0.55), -4.0 + 6.0 * ((t - 0.55) / 0.45)
    ),
    4: lambda t: 4.0 - 10.0 * t,  # 51  全降
}


def tone_contour(tone, n):
    """长度为 n 的标准调型，单位是相对音高中心的半音。"""
    if tone not in _SHAPES:
        raise ValueError("没有第 %r 声" % (tone,))
    t = np.linspace(0.0, 1.0, n) if n > 1 else np.zeros(1)
    return np.asarray(_SHAPES[tone](t), dtype=np.float64)


def retone_file(src, dst, tone):
    """就地换调。返回 (说话人音高中心 Hz, 有声帧数)，无声则返回 None。"""
    import pyworld as pw
    import soundfile as sf

    x, sr = sf.read(src, always_2d=True)
    x = np.ascontiguousarray(x.mean(axis=1), dtype=np.float64)

    f0, sp, ap = pw.wav2world(x, sr, frame_period=5.0)
    idx = np.where(f0 > 0)[0]
    if len(idx) < 5:
        return None

    base = float(np.median(f0[idx]))
    span = max(1, idx[-1] - idx[0])
    t = (idx - idx[0]) / span

    new_f0 = f0.copy()
    shape = np.asarray(_SHAPES[tone](t), dtype=np.float64)
    new_f0[idx] = base * 2.0 ** (shape / 12.0)

    y = pw.synthesize(new_f0, sp, ap, sr, frame_period=5.0)
    peak = float(np.abs(y).max())
    if peak > 0:
        y = y / peak * 0.9
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    sf.write(dst, y, sr, format="MP3")
    return base, len(idx)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-d", "--data", default="pinyin/data/pinyin.json")
    p.add_argument("-s", "--src", default="/tmp/pinyin-audio")
    p.add_argument("-o", "--out", default="/tmp/pinyin-audio-retoned")
    p.add_argument(
        "--shengmu-tone",
        type=int,
        default=1,
        help="声母呼读音按第几声换调（默认一声，和合成时一致）",
    )
    args = p.parse_args()

    data = json.load(open(args.data, encoding="utf-8"))
    items = [it for g in data["groups"] for it in g["items"]]

    done = skipped = 0
    for i, it in enumerate(items, 1):
        src = os.path.join(args.src, it["key"])
        if not os.path.exists(src):
            raise FileNotFoundError("缺少 %s，先跑 tts_aliyun.py" % src)
        tone = it.get("tone", args.shengmu_tone)
        res = retone_file(src, os.path.join(args.out, it["key"]), tone)
        if res is None:
            skipped += 1
            print("[%d/%d] %s 取不到 F0，跳过" % (i, len(items), it["key"]))
            continue
        done += 1
        print(
            "[%d/%d] %s  %d声  中心 %.0fHz  %d 有声帧"
            % (i, len(items), it["key"], tone, res[0], res[1])
        )

    print("完成：换调 %d，跳过 %d，输出在 %s" % (done, skipped, args.out))
    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())
