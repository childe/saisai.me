"""检查一批标准音的声调对不对。

把每条音频的 F0 曲线和四个标准调型比，看最贴合的是不是它本该有的那个声调。
这是对**音频素材**的验收，不是对前端分类器的验收：素材的调不对，跟读打分
必然跟着错，而且音频本身就在教错的调。

和 tools/tone-check.html 做同一件事，但走 pyworld、不需要浏览器，便于反复跑。
两边是各自独立的实现，结论一致才可信。
"""

import argparse
import json
import os
import sys

import numpy as np

from retone import tone_contour

CONTOUR_POINTS = 20
OCTAVE_JUMP = 8.0  # 相邻帧跳变超过这么多半音才考虑倍频错误
OCTAVE_TOL = 3.0
LOCAL_WINDOW = 7  # 局部中位数的窗口
LOCAL_OUTLIER = 4.0  # 偏离局部中位数这么多半音就剔掉（起音/收尾的毛刺）
FIT_GAIN_MIN = 0.3
FIT_GAIN_MAX = 3.0
MIN_FRAMES = 4
FRAME_MS = 10.0
ABS_FLOOR = 0.005  # 低于这个绝对电平一律当静音，挡住真人录音的底噪
REL_RATIO = 0.15
EDGE_FRAMES = 3  # 丢掉有声段两端的帧：浊音起止处的音高估计本来就不可靠


def _unwrap_octaves(semitones):
    """按相邻帧的跳变解缠绕，修掉整段差一个八度的倍频/分频错误。"""
    out = [semitones[0]]
    offset = 0.0
    for v in semitones[1:]:
        jump = v + offset - out[-1]
        octaves = round(jump / 12.0)
        if (
            abs(jump) > OCTAVE_JUMP
            and octaves != 0
            and abs(jump - 12 * octaves) < OCTAVE_TOL
        ):
            offset -= 12 * octaves
        out.append(v + offset)
    return np.asarray(out)


def contour_of(path):
    """音频 → 归一化的声调曲线（半音，相对自身中位数），取不到返回 None。"""
    import pyworld as pw
    import soundfile as sf

    x, sr = sf.read(path, always_2d=True)
    x = np.ascontiguousarray(x.mean(axis=1), dtype=np.float64)

    # 先掐掉前后静音。真人录音动辄 1 秒多，大半是静音和呼吸声，
    # 不掐的话 pyworld 会在噪声段报出 F0，把曲线带歪。
    hop = max(1, int(sr * FRAME_MS / 1000))
    nf = len(x) // hop
    if nf == 0:
        return None
    energy = np.array(
        [np.sqrt(np.mean(x[i * hop : (i + 1) * hop] ** 2)) for i in range(nf)]
    )
    if energy.max() < ABS_FLOOR:
        return None
    voiced = np.where(energy >= max(ABS_FLOOR, energy.max() * REL_RATIO))[0]
    if len(voiced) == 0:
        return None
    pad = int(sr * 0.04)
    x = np.ascontiguousarray(
        x[max(0, voiced[0] * hop - pad) : min(len(x), (voiced[-1] + 1) * hop + pad)]
    )

    f0, _sp, _ap = pw.wav2world(x, sr, frame_period=5.0)
    idx = np.where(f0 > 0)[0]
    if len(idx) < MIN_FRAMES:
        return None

    semis = _unwrap_octaves(12.0 * np.log2(f0[idx]))

    # 剔掉偏离局部中位数太远的帧。音节起音和收尾处最容易出毛刺，
    # 不滤掉会把平直的一声带出一个假的上升段。
    half = LOCAL_WINDOW // 2
    keep = []
    for i in range(len(semis)):
        lo, hi = max(0, i - half), min(len(semis), i + half + 1)
        if abs(semis[i] - np.median(semis[lo:hi])) < LOCAL_OUTLIER:
            keep.append(i)
    if len(keep) < MIN_FRAMES:
        return None
    semis = semis[keep]
    idx = idx[keep]

    # 再丢掉两端的帧。浊音起止处音高估计不可靠，实测连完全平直的一声
    # 都会在第一个点冒出 -1.4 甚至 -6.5 个半音，被拟合成"先低后平"的二声。
    if len(semis) > 2 * EDGE_FRAMES + MIN_FRAMES:
        semis = semis[EDGE_FRAMES:-EDGE_FRAMES]
        idx = idx[EDGE_FRAMES:-EDGE_FRAMES]

    # 按真实时间轴重采样，再减中位数 —— 顺序不能反，有声帧的分布本就不均匀
    t = (idx - idx[0]) / max(1, idx[-1] - idx[0])
    curve = np.interp(np.linspace(0.0, 1.0, CONTOUR_POINTS), t, semis)
    return curve - np.median(curve)


def classify(curve):
    """自由增益拟合四个调型，残差最小的就是判定的声调。"""
    best, best_res = 0, float("inf")
    for tone in (1, 2, 3, 4):
        tpl = tone_contour(tone, len(curve))
        den = float(tpl @ tpl)
        if den < 1e-9:
            res = float(np.sqrt(np.mean(curve**2)))
        else:
            a = float(np.clip((curve @ tpl) / den, FIT_GAIN_MIN, FIT_GAIN_MAX))
            res = float(np.sqrt(np.mean((curve - a * tpl) ** 2)))
        if res < best_res:
            best, best_res = tone, res
    return best


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src", help="待检查的音频目录")
    p.add_argument("-d", "--data", default="pinyin/data/pinyin.json")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    data = json.load(open(args.data, encoding="utf-8"))
    items = [i for g in data["groups"] for i in g["items"] if i.get("tone")]

    ok, wrong, absent = 0, [], []
    for it in items:
        path = os.path.join(args.src, it["key"])
        if not os.path.exists(path):
            absent.append(it["display"])
            continue
        curve = contour_of(path)
        got = classify(curve) if curve is not None else 0
        if got == it["tone"]:
            ok += 1
            if args.verbose:
                print("  ok  %-5s %d声" % (it["display"], it["tone"]))
        else:
            wrong.append((it["display"], it["tone"], got))

    total = len(items) - len(absent)
    print("判对 %d / %d" % (ok, total), end="")
    print("  (%.0f%%)" % (100.0 * ok / total) if total else "")
    if wrong:
        print("判错 %d 条：" % len(wrong))
        for disp, want, got in wrong:
            print(
                "  %-5s 应 %d声，判成 %s"
                % (disp, want, "%d声" % got if got else "测不出")
            )
    if absent:
        print("缺 %d 条：%s" % (len(absent), " ".join(absent)))
    return 0 if not wrong else 1


if __name__ == "__main__":
    sys.exit(main())
