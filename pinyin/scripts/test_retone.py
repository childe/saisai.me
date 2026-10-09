import numpy as np

from retone import tone_contour


def test_length():
    assert len(tone_contour(1, 20)) == 20
    assert len(tone_contour(3, 7)) == 7


def test_first_tone_is_level():
    c = tone_contour(1, 20)
    assert c.max() - c.min() < 0.5, "一声要平，实际起伏 %.2f" % (c.max() - c.min())


def test_every_tone_is_zero_mean():
    """调型只决定形状，不决定调高。

    每条音频的音高中心取它自己 F0 的中位数。若调型本身带直流偏移，
    换调就等于凭空把整条音升高或降低 —— 一声 +4 半音会把童声
    从 445Hz 推到 560Hz，发尖。
    """
    for t in (1, 2, 3, 4):
        m = float(tone_contour(t, 20).mean())
        assert abs(m) < 0.3, "声调 %d 的调型均值 %.2f，不该有直流偏移" % (t, m)


def test_second_tone_rises_monotonically():
    c = tone_contour(2, 20)
    assert np.all(np.diff(c) >= -1e-9), "二声不该有下降段"
    assert c[-1] - c[0] >= 3, "升得太少：%.2f 个半音" % (c[-1] - c[0])


def test_third_tone_dips_then_rises():
    c = tone_contour(3, 20)
    low = int(np.argmin(c))
    assert 3 <= low <= 14, "低谷落在第 %d 点，应在中段" % low
    assert c[0] - c[low] >= 1, "前段要下降"
    assert c[-1] - c[low] >= 3, "后段要回升"


def test_fourth_tone_falls_monotonically():
    c = tone_contour(4, 20)
    assert np.all(np.diff(c) <= 1e-9), "四声不该有上升段"
    assert c[0] - c[-1] >= 6, "降得太少：%.2f 个半音" % (c[0] - c[-1])


def test_no_tone_swings_beyond_a_child_voice():
    """起伏过大，重合成会发尖发飘。普通话四声最大跨度约 8 个半音。"""
    for t in (1, 2, 3, 4):
        c = tone_contour(t, 20)
        assert c.max() - c.min() <= 9, "声调 %d 跨了 %.1f 个半音" % (
            t,
            c.max() - c.min(),
        )


def test_level_tone_is_the_only_flat_one():
    """一声靠"没有起伏"和其他三个区分，不靠调高。"""
    assert tone_contour(1, 20).var() < 0.01
    for t in (2, 3, 4):
        assert tone_contour(t, 20).var() > 1.0, "声调 %d 起伏太小" % t


def test_contour_shapes_are_not_interchangeable():
    """去均值之后只剩形状，所以用相关系数量，不用距离。

    相关系数接近 1 就意味着两个调型只差一个缩放 —— 分类器用的是自由
    增益拟合，那样两个声调就分不开了。
    """
    import itertools

    cs = {t: tone_contour(t, 20) for t in (2, 3, 4)}
    for a, b in itertools.combinations(cs, 2):
        r = float(np.corrcoef(cs[a], cs[b])[0, 1])
        assert r < 0.9, "声调 %d 和 %d 的形状相关系数 %.2f，太像了" % (a, b, r)


def test_unknown_tone_is_rejected():
    import pytest

    with pytest.raises(ValueError):
        tone_contour(5, 20)
