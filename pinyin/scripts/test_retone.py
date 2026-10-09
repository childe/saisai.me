import numpy as np

from retone import tone_contour


def test_length():
    assert len(tone_contour(1, 20)) == 20
    assert len(tone_contour(3, 7)) == 7


def test_first_tone_is_level():
    c = tone_contour(1, 20)
    assert c.max() - c.min() < 0.5, "一声要平，实际起伏 %.2f" % (c.max() - c.min())


def test_first_tone_sits_high():
    """55 高平：一声在说话人音域的偏上位置。"""
    assert tone_contour(1, 20).mean() > 2


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


def test_third_tone_starts_and_stays_low():
    """214：三声整体位于音域下部。"""
    assert tone_contour(3, 20).min() < -3


def test_fourth_tone_falls_monotonically():
    c = tone_contour(4, 20)
    assert np.all(np.diff(c) <= 1e-9), "四声不该有上升段"
    assert c[0] - c[-1] >= 6, "降得太少：%.2f 个半音" % (c[0] - c[-1])


def test_fourth_starts_highest_and_ends_lowest():
    c4 = tone_contour(4, 20)
    assert c4[0] >= tone_contour(1, 20)[0] - 0.5
    assert c4[-1] <= tone_contour(3, 20).min() + 1.5


def test_tones_are_mutually_distinct():
    cs = {t: tone_contour(t, 20) for t in (1, 2, 3, 4)}
    for a in cs:
        for b in cs:
            if a < b:
                d = float(np.abs(cs[a] - cs[b]).mean())
                assert d > 1.5, "声调 %d 和 %d 太像了（平均差 %.2f 半音）" % (a, b, d)


def test_unknown_tone_is_rejected():
    import pytest

    with pytest.raises(ValueError):
        tone_contour(5, 20)
