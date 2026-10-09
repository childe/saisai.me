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
