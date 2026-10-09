import numpy as np

from tts_aliyun import build_ssml, pending_items, vowel_onset


def test_build_ssml_wraps_phoneme():
    s = build_ssml("ang3")
    assert 'alphabet="py"' in s
    assert 'ph="ang3"' in s
    assert s.startswith("<speak>") and s.endswith("</speak>")


def test_pending_skips_existing(tmp_path):
    items = [
        {"id": "a1", "key": "ym/a1.mp3", "ssml": "a1"},
        {"id": "a2", "key": "ym/a2.mp3", "ssml": "a2"},
    ]
    (tmp_path / "ym").mkdir()
    (tmp_path / "ym" / "a1.mp3").write_bytes(b"x" * 2000)
    assert [i["id"] for i in pending_items(items, str(tmp_path))] == ["a2"]


def test_pending_redoes_truncated_file(tmp_path):
    """长度可疑的文件要重做，否则一次网络抖动会留下静音文件。"""
    items = [{"id": "a1", "key": "ym/a1.mp3", "ssml": "a1"}]
    (tmp_path / "ym").mkdir()
    (tmp_path / "ym" / "a1.mp3").write_bytes(b"x" * 10)
    assert [i["id"] for i in pending_items(items, str(tmp_path))] == ["a1"]


def test_vowel_onset_skips_plosive_burst():
    """dōng 裁声母：爆破后有个短暂低能量区，元音起点在其后。"""
    sr = 16000
    burst = np.zeros(int(0.01 * sr))
    burst[0:40] = 1.0  # 爆破
    gap = np.zeros(int(0.02 * sr))  # 除阻后的低能量段
    vowel = np.sin(np.linspace(0, 200 * np.pi, int(0.3 * sr))) * 0.8
    sig = np.concatenate([burst, gap, vowel])

    onset = vowel_onset(sig, sr)
    assert onset > int(0.02 * sr)
    assert onset < int(0.05 * sr)


def test_vowel_onset_on_pure_vowel_is_near_zero():
    sr = 16000
    sig = np.sin(np.linspace(0, 200 * np.pi, int(0.3 * sr))) * 0.8
    assert vowel_onset(sig, sr) < int(0.02 * sr)


def _dong_like(sr=16000):
    """塞音爆破 + 除阻低能量段 + 元音，模拟 dōng 的开头。"""
    burst = np.zeros(int(0.01 * sr))
    burst[0:40] = 1.0
    gap = np.zeros(int(0.02 * sr))
    t = np.arange(int(0.3 * sr)) / sr
    vowel = 0.8 * (np.sin(2 * np.pi * 200 * t) + 0.3 * np.sin(2 * np.pi * 400 * t))
    return np.concatenate([burst, gap, vowel]), sr


def test_trim_initial_cuts_the_initial_off_a_real_mp3(tmp_path):
    """ong 走的是这条路：合成 dōng 再裁掉声母。整条链路要真能跑。"""
    import soundfile as sf

    from tts_aliyun import trim_initial

    sig, sr = _dong_like()
    path = str(tmp_path / "dong1.mp3")
    sf.write(path, sig, sr)

    cut_ms = trim_initial(path)
    assert 15 <= cut_ms <= 70, "裁掉了 %dms" % cut_ms

    out, out_sr = sf.read(path)
    assert abs(len(out) / out_sr - 0.30) < 0.06, "剩下 %.3fs" % (len(out) / out_sr)

    # 开头应当是持续发声的元音。没裁干净的话，头 30ms 是"爆破尖峰 + 静音"，
    # 峰值很高但 RMS 很低；裁干净了则 RMS 接近整段的水平。
    head = out[: int(0.03 * out_sr)]
    head_rms = float(np.sqrt(np.mean(head**2)))
    whole_rms = float(np.sqrt(np.mean(out**2)))
    assert (
        head_rms > whole_rms * 0.7
    ), "开头还不是元音：head_rms=%.3f whole_rms=%.3f" % (head_rms, whole_rms)


def test_trim_initial_leaves_a_pure_vowel_almost_untouched(tmp_path):
    import soundfile as sf

    from tts_aliyun import trim_initial

    sr = 16000
    t = np.arange(int(0.3 * sr)) / sr
    sf.write(str(tmp_path / "a1.mp3"), 0.8 * np.sin(2 * np.pi * 200 * t), sr)
    assert trim_initial(str(tmp_path / "a1.mp3")) < 20


def _time_to_half_peak_ms(y, sr):
    peak = float(abs(y).max())
    i = int((abs(y) >= peak * 0.5).argmax())
    return i / sr * 1000.0


def test_trim_initial_fades_in_so_the_cut_is_not_abrupt(tmp_path):
    """从音节中间硬切会让声音没有起音过程，听感是"咔"一下蹦出来。

    实测未加淡入时，ong 在 12.6ms 就冲到半峰，而其他韵母都要 ~87ms。
    """
    import soundfile as sf

    from tts_aliyun import trim_initial

    sig, sr = _dong_like()
    path = str(tmp_path / "dong1.mp3")
    sf.write(path, sig, sr)
    trim_initial(path)

    out, out_sr = sf.read(path)
    rise = _time_to_half_peak_ms(out, out_sr)
    assert rise >= 8, "起音只用了 %.1fms，太突兀" % rise
    assert rise <= 45, "淡入太慢（%.1fms），起音被削了" % rise


def test_fade_does_not_eat_the_syllable(tmp_path):
    import soundfile as sf

    from tts_aliyun import trim_initial

    sig, sr = _dong_like()
    path = str(tmp_path / "dong1.mp3")
    sf.write(path, sig, sr)
    trim_initial(path)
    out, out_sr = sf.read(path)
    assert abs(len(out) / out_sr - 0.30) < 0.06, "剩下 %.3fs" % (len(out) / out_sr)


def test_plain_item_is_synthesized_as_is():
    from tts_aliyun import synthesis_plan

    assert synthesis_plan({"ssml": "ang3"}) == ("ang3", False)


def test_derived_item_uses_the_carrier_and_gets_trimmed():
    from tts_aliyun import synthesis_plan

    assert synthesis_plan({"ssml": "ong1", "derive": "dong1"}) == ("dong1", True)
    assert synthesis_plan({"ssml": "o4", "derive": "bo4"}) == ("bo4", True)
    assert synthesis_plan({"ssml": "eng2", "derive": "beng2"}) == ("beng2", True)
