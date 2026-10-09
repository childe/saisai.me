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


def test_second_tone_is_a_concave_rise():
    """真实的二声不是一条直线：先微微下沉，再陡升。

    实测 hanyupinyin.cn 和公有领域两套真人录音的二声都是这个形状，
    用直线模板去拟合，会有一多半被判成三声。
    """
    c = tone_contour(2, 20)
    low = int(np.argmin(c))
    assert 1 <= low <= 6, "下沉的低点落在第 %d 点，应在前段" % low
    assert 0.3 <= c[0] - c[low] <= 1.5, "下沉 %.2f 个半音，过深就和三声混了" % (
        c[0] - c[low]
    )
    assert c[-1] - c[low] >= 3.5, "后段升得太少：%.2f 个半音" % (c[-1] - c[low])
    assert np.all(np.diff(c[low:]) >= -1e-9), "低点之后不该再下降"


def test_second_tone_dips_much_less_than_the_third():
    """二者都是先降后升，靠下沉的深浅和时机区分。"""
    c2, c3 = tone_contour(2, 20), tone_contour(3, 20)
    assert (c2[0] - c2.min()) * 2 < (c3[0] - c3.min()), "二声的下沉该浅得多"
    assert int(np.argmin(c2)) < int(np.argmin(c3)), "二声的低点该更靠前"


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


def test_stretch_factor_lengthens_short_syllables():
    """TTS 合成的音节只有 0.25 秒，真人范读是 0.49 秒。
    太短小朋友来不及听清调型，要拉长。"""
    from retone import stretch_factor

    assert stretch_factor(0.25, target=0.50) == 2.0
    assert stretch_factor(0.40, target=0.50) == 1.25


def test_stretch_factor_never_shortens():
    from retone import stretch_factor

    assert stretch_factor(0.80, target=0.50) == 1.0
    assert stretch_factor(0.50, target=0.50) == 1.0


def test_stretch_factor_is_capped():
    """拉得太狠会出现金属声和回声感。"""
    from retone import stretch_factor, MAX_STRETCH

    assert stretch_factor(0.05, target=0.50) == MAX_STRETCH
    assert MAX_STRETCH <= 3.0


def test_stretch_factor_handles_zero():
    from retone import stretch_factor

    assert stretch_factor(0.0, target=0.50) == 1.0


def test_resample_frames_lengthens_the_time_axis():
    """WORLD 的三组参数都要按同一条时间轴重采样，否则对不上。"""
    import numpy as np

    from retone import resample_frames

    f0 = np.array([100.0, 110.0, 120.0, 130.0])
    sp = np.arange(4 * 5, dtype=float).reshape(4, 5)
    out_f0, out_sp = resample_frames(f0, 10), resample_frames(sp, 10)
    assert len(out_f0) == 10
    assert out_sp.shape == (10, 5)
    # 端点保持
    assert abs(out_f0[0] - 100.0) < 1e-9
    assert abs(out_f0[-1] - 130.0) < 1e-9
    assert abs(out_sp[0, 0] - 0.0) < 1e-9


def test_resample_frames_keeps_unvoiced_frames_unvoiced():
    """F0 为 0 表示清音段，插值不能把它糊成一个假的音高。"""
    import numpy as np

    from retone import resample_frames

    f0 = np.array([0.0, 0.0, 200.0, 210.0, 0.0, 0.0])
    out = resample_frames(f0, 20)
    assert out[0] == 0.0 and out[-1] == 0.0
    assert not np.any((out > 0) & (out < 150)), "清音和浊音之间不该插出中间值"
