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

# 目标发声时长（秒）。TTS 合成的音节只有 0.25 秒，真人范读约 0.49 秒 ——
# 太短小朋友来不及听清调型，而且响度感知是随时长累积的，短音会显得"声音小"。
TARGET_VOICED = 0.50
# 拉伸上限。拉得太狠 WORLD 会出现金属声和回声感。
MAX_STRETCH = 2.5

# 赵元任五度标调法 → 半音偏移，t 为 0..1 的归一化时间。
# 一度约 2 个半音：55 高平、35 中升、214 低降升、51 全降。
_SHAPES = {
    1: lambda t: np.full_like(t, 0.0),  # 55  高平
    2: lambda t: np.where(  # 35  中升。真实二声是凹型：先微沉约半个半音再陡升
        t < 0.25,
        -2.4 * t,
        -0.6 + 4.6 * np.clip((t - 0.25) / 0.75, 0.0, 1.0) ** 1.4,
    ),
    3: lambda t: np.where(  # 214 低降升
        t < 0.55, -2.0 - 2.0 * (t / 0.55), -4.0 + 6.0 * ((t - 0.55) / 0.45)
    ),
    4: lambda t: 4.0 - 8.0 * t,  # 51  全降
}


def stretch_factor(voiced_seconds, target=TARGET_VOICED):
    """把发声段拉到 target 秒需要的倍数。只拉长，不压缩，并设上限。"""
    if voiced_seconds <= 0:
        return 1.0
    return float(min(MAX_STRETCH, max(1.0, target / voiced_seconds)))


def resample_frames(frames, n):
    """把 WORLD 的参数沿时间轴重采样到 n 帧。

    F0 要特殊处理：0 表示清音，直接线性插值会在清音和浊音之间糊出一个
    假的音高。所以 F0 用最近邻，频谱包络和非周期性成分用线性插值。
    """
    src = np.asarray(frames, dtype=np.float64)
    m = src.shape[0]
    if m == n or m == 0:
        return src
    pos = np.linspace(0.0, m - 1, n)

    if src.ndim == 1:  # F0：最近邻，保住清音的 0
        return src[np.rint(pos).astype(int)]

    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, m - 1)
    w = (pos - lo)[:, None]
    return src[lo] * (1 - w) + src[hi] * w


def tone_contour(tone, n):
    """长度为 n 的标准调型，单位是半音，**已去均值**。

    去均值是关键：调型只决定形状，不决定调高。每条音频的音高中心取它
    自己 F0 的中位数，若调型带直流偏移，换调就等于凭空升降整条音 ——
    一声带 +4 半音会把 445Hz 的童声推到 560Hz，发尖。

    各声调之间的相对高低（一声高、三声低）来自原始合成音本身，不该由
    调型二次施加：每条音节是独立的一段音频，不是一串连读。
    """
    if tone not in _SHAPES:
        raise ValueError("没有第 %r 声" % (tone,))
    t = np.linspace(0.0, 1.0, n) if n > 1 else np.zeros(1)
    c = np.asarray(_SHAPES[tone](t), dtype=np.float64)
    return c - c.mean()


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
    # 按真实时间位置取调型，有声帧不连续时也不会把时间轴揉变形
    full = tone_contour(tone, 256)
    shape = np.interp(t, np.linspace(0.0, 1.0, 256), full)
    new_f0[idx] = base * 2.0 ** (shape / 12.0)

    # 拉长到接近真人范读的时长。音高曲线已经按归一化时间 t 算好，
    # 三组参数一起重采样，调型不会变形。
    voiced_sec = len(idx) * 5.0 / 1000.0
    k = stretch_factor(voiced_sec)
    if k > 1.0:
        n2 = int(round(len(new_f0) * k))
        new_f0 = resample_frames(new_f0, n2)
        sp = resample_frames(sp, n2)
        ap = resample_frames(ap, n2)

    y = pw.synthesize(new_f0, sp, ap, sr, frame_period=5.0)
    peak = float(np.abs(y).max())
    if peak > 0:
        y = y / peak * 0.9
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    sf.write(dst, y, sr, format="MP3")
    return base, len(idx), k


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
            "[%d/%d] %s  %d声  中心 %.0fHz  %d 有声帧  拉伸 %.2fx"
            % (i, len(items), it["key"], tone, res[0], res[1], res[2])
        )

    print("完成：换调 %d，跳过 %d，输出在 %s" % (done, skipped, args.out))
    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())
