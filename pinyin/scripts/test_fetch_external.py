import numpy as np

from fetch_external import normalize_loudness, trim_silence, voiced_rms


def tone(seconds, amp, sr=16000):
    t = np.arange(int(seconds * sr)) / sr
    return amp * np.sin(2 * np.pi * 200 * t), sr


def test_voiced_rms_ignores_silence():
    sr = 16000
    sig, _ = tone(0.3, 0.5)
    padded = np.concatenate([np.zeros(sr), sig, np.zeros(sr)])
    assert abs(voiced_rms(padded, sr) - voiced_rms(sig, sr)) < 0.02


def test_normalize_hits_the_target():
    sig, sr = tone(0.3, 0.2)
    out = normalize_loudness(sig, sr, 0.26)
    assert abs(voiced_rms(out, sr) - 0.26) < 0.01


def test_normalize_does_not_clip():
    sig, sr = tone(0.3, 0.9)
    out = normalize_loudness(sig, sr, 0.9)
    assert np.abs(out).max() <= 1.0


def test_normalize_leaves_silence_alone():
    sr = 16000
    out = normalize_loudness(np.zeros(sr), sr, 0.26)
    assert np.abs(out).max() == 0.0


def test_trim_removes_leading_and_trailing_silence():
    """1.3 秒里只有 0.3 秒在发声，剩下的要掐掉 —— 两端各留 60ms 余量。"""
    from fetch_external import PAD_MS

    sr = 16000
    sig, _ = tone(0.3, 0.5)
    padded = np.concatenate([np.zeros(int(0.5 * sr)), sig, np.zeros(int(0.5 * sr))])
    out = trim_silence(padded, sr)
    expect = 0.3 + 2 * PAD_MS / 1000
    assert abs(len(out) / sr - expect) < 0.03, "剩下 %.3fs，应约 %.3fs" % (
        len(out) / sr,
        expect,
    )


def test_trim_keeps_a_little_headroom():
    sr = 16000
    sig, _ = tone(0.3, 0.5)
    padded = np.concatenate([np.zeros(int(0.5 * sr)), sig, np.zeros(int(0.5 * sr))])
    assert len(trim_silence(padded, sr)) > len(sig)


def test_trim_on_all_silence_returns_input_untouched():
    sr = 16000
    z = np.zeros(sr)
    assert len(trim_silence(z, sr)) == len(z)
