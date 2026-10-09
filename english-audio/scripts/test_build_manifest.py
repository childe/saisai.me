import re

import pytest

from build_manifest import parse_track

KEY_RE = re.compile(r"^[a-z0-9][a-z0-9/._-]*$")


def test_plain_track():
    t = parse_track("02 Unit 1-Small task.mp3")
    assert t["no"] == 2
    assert t["unit_id"] == "unit01"
    assert t["unit_title"] == "Unit 1"
    assert t["kind"] == "task"
    assert t["title"] == "Small task"
    assert t["subtitle"] == "小任务"
    assert t["key"] == "unit01/02-small-task.mp3"


def test_variant_suffix():
    t = parse_track("05 Unit 1-Song time-A.mp3")
    assert t["title"] == "Song time A"
    assert t["kind"] == "song"
    assert t["key"] == "unit01/05-song-time-a.mp3"


def test_unit_ten_is_not_unit_one():
    t = parse_track("65 Unit 10-Small task.mp3")
    assert t["unit_id"] == "unit10"
    assert t["unit_title"] == "Unit 10"
    assert t["title"] == "Small task"
    assert t["key"] == "unit10/65-small-task.mp3"


def test_starter():
    t = parse_track("01 Starter.mp3")
    assert t["unit_id"] == "starter"
    assert t["kind"] == "starter"
    assert t["key"] == "01-starter.mp3"


def test_word_bank():
    t = parse_track("72 Word bank-Unit 1.mp3")
    assert t["unit_id"] == "wordbank"
    assert t["unit_title"] == "Word bank"
    assert t["kind"] == "wordbank"
    assert t["title"] == "Unit 1"
    assert t["key"] == "wordbank/72-unit-01.mp3"


def test_word_bank_unit_ten():
    t = parse_track("81 Word bank-Unit 10.mp3")
    assert t["title"] == "Unit 10"
    assert t["key"] == "wordbank/81-unit-10.mp3"


def test_unknown_section_raises():
    with pytest.raises(ValueError) as e:
        parse_track("99 Unit 1-Dancing time.mp3")
    assert "Dancing time" in str(e.value)


def test_all_keys_are_safe_ascii():
    names = ["01 Starter.mp3"]
    for unit in range(1, 11):
        names += [
            "%02d Unit %d-Small task.mp3" % (unit * 7, unit),
            "%02d Unit %d-Topic words.mp3" % (unit * 7 + 1, unit),
            "%02d Unit %d-Song time-A.mp3" % (unit * 7 + 2, unit),
        ]
    for name in names:
        key = parse_track(name)["key"]
        assert KEY_RE.match(key), key


def test_duration_absent_when_unreadable(tmp_path):
    # 没装 mutagen 时 read_duration 本来就返回 None，断言会变得空洞，
    # 所以显式要求 mutagen 在场，否则 skip（而不是假装通过）。
    pytest.importorskip("mutagen")

    from build_manifest import read_duration

    bad = tmp_path / "broken.mp3"
    bad.write_bytes(b"not an mp3")
    assert read_duration(str(bad)) is None
