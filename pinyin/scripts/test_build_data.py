import re

from build_data import build, confusions_for

ID_RE = re.compile(r"^[a-z0-9]+$")
KEY_RE = re.compile(r"^(sm|ym)/[a-z0-9]+\.mp3$")


def items(data):
    return [it for g in data["groups"] for it in g["items"]]


def test_total_is_118():
    assert len(items(build())) == 118


def test_23_shengmu():
    data = build()
    sm = [g for g in data["groups"] if g["id"] == "shengmu"][0]
    assert len(sm["items"]) == 23
    assert [i["id"] for i in sm["items"]][:4] == ["b", "p", "m", "f"]


def test_shengmu_has_readas():
    data = build()
    sm = [g for g in data["groups"] if g["id"] == "shengmu"][0]
    by_id = {i["id"]: i for i in sm["items"]}
    assert by_id["b"]["readAs"] == "bo"
    assert by_id["zh"]["readAs"] == "zhi"
    assert by_id["w"]["readAs"] == "wu"
    assert by_id["b"]["ssml"] == "bo1"


def test_er_has_no_first_tone():
    ids = {i["id"] for i in items(build())}
    assert "er1" not in ids
    assert {"er2", "er3", "er4"} <= ids


def test_no_e_hat():
    bases = {i.get("base") for i in items(build())}
    assert "ê" not in bases


def test_yunmu_count_is_95():
    data = build()
    n = sum(len(g["items"]) for g in data["groups"] if g["id"] != "shengmu")
    assert n == 95


def test_display_carries_tone_mark():
    by_id = {i["id"]: i for i in items(build())}
    assert by_id["a1"]["display"] == "ā"
    assert by_id["a3"]["display"] == "ǎ"
    assert by_id["ang4"]["display"] == "àng"
    assert by_id["lv2"]["display"] == "ǘ"


def test_ssml_uses_zero_initial_form():
    """韵母单独呼读要写成合法音节，与 display 不同。"""
    by_id = {i["id"]: i for i in items(build())}
    assert by_id["i1"]["ssml"] == "yi1"
    assert by_id["u1"]["ssml"] == "wu1"
    assert by_id["lv1"]["ssml"] == "yu1"
    assert by_id["iu1"]["ssml"] == "you1"
    assert by_id["ui1"]["ssml"] == "wei1"
    assert by_id["un1"]["ssml"] == "wen1"
    assert by_id["vn1"]["ssml"] == "yun1"
    assert by_id["ing1"]["ssml"] == "ying1"
    assert by_id["ie1"]["ssml"] == "ye1"
    assert by_id["ve1"]["ssml"] == "yue1"
    assert by_id["in1"]["ssml"] == "yin1"
    assert by_id["a1"]["ssml"] == "a1"
    # o 和 ong 没有自己的零声母音节，借用最接近的真实音节：
    # 直接合成 ph="o1" 会被引擎读成「欧」，ph="ong1"/"wong1" 直接返回静音。
    assert by_id["o1"]["ssml"] == "wo1"
    assert by_id["ong1"]["ssml"] == "weng1"


def test_ids_and_keys_are_ascii_safe():
    """ü 在 id 和 key 里写作 v，避免 URL 编码问题。"""
    for it in items(build()):
        assert ID_RE.match(it["id"]), it["id"]
        assert KEY_RE.match(it["key"]), it["key"]


def test_confusions_only_reference_known_bases():
    data = build()
    bases = {i.get("base") or i["id"] for i in items(data)}
    for base, peers in data["confusions"].items():
        assert base in bases, base
        for p in peers:
            assert p in bases, "%s -> %s" % (base, p)
        assert base not in peers


def test_confusions_cover_every_base():
    data = build()
    bases = {i.get("base") or i["id"] for i in items(data)}
    assert bases == set(data["confusions"])
    assert all(len(v) >= 2 for v in data["confusions"].values())


def test_nasal_pairs_are_confusable():
    assert "ang" in confusions_for("an")
    assert "eng" in confusions_for("en")
    assert "ing" in confusions_for("in")


def test_shengmu_confusions_by_articulation_and_shape():
    assert "p" in confusions_for("b")
    assert "d" in confusions_for("b")  # 字形易混
    assert "q" in confusions_for("p")  # 字形易混
    assert "c" in confusions_for("z")


def test_base_url_and_groups():
    data = build()
    assert data["baseUrl"].startswith("https://")
    assert data["baseUrl"].endswith("/pinyin/")
    assert [g["id"] for g in data["groups"]] == [
        "shengmu",
        "danyun",
        "fuyun",
        "biyun",
    ]


def test_yunmu_carries_untoned_display():
    """拼音表要显示去掉调号的字形。不能靠 NFD 剥组合符 ——
    ǖ 会连分音符一起被剥成 u。"""
    by_id = {i["id"]: i for i in items(build())}
    assert by_id["lv1"]["baseDisplay"] == "ü"
    assert by_id["ve2"]["baseDisplay"] == "üe"
    assert by_id["ang4"]["baseDisplay"] == "ang"
    assert by_id["er2"]["baseDisplay"] == "er"


def test_shengmu_has_no_base_display():
    data = build()
    sm = [g for g in data["groups"] if g["id"] == "shengmu"][0]
    assert all("baseDisplay" not in i for i in sm["items"])


def test_problem_finals_are_derived_from_a_carrier_syllable():
    """o / eng / ong 没有能用的零声母音节。

    普通话里 ong 根本不存在；o（喔）和 eng（鞥）极其罕见，连收录 413 个
    音节的公有领域真人音库都没有它们。TTS 引擎同样没有，只能瞎凑：
    实测 ph="ong1" 返回静音，ph="o1" 读成了「欧」。
    所以改为从含该韵母的音节里裁掉声母，和教学上的示范方式一致。
    """
    by_id = {i["id"]: i for i in items(build())}
    assert by_id["eng2"]["derive"] == "beng2"


def test_only_eng_still_needs_trimming():
    """o 和 ong 改为借用真实音节（wo / weng），不再裁切。

    eng 没有合适的借用对象：weng 已经给了 ong，直接合成 ph="eng1"
    听感存疑，所以仍从 beng 裁出来。
    """
    derived = {i["base"] for i in items(build()) if i.get("derive")}
    assert derived == {"eng"}


def test_borrowed_finals_are_not_also_trimmed():
    by_id = {i["id"]: i for i in items(build())}
    for pid in ("o1", "o4", "ong1", "ong4"):
        assert "derive" not in by_id[pid], pid


def test_derive_carries_the_same_tone_as_the_item():
    for it in items(build()):
        if it.get("derive"):
            assert it["derive"].endswith(str(it["tone"])), it["id"]


def test_carrier_initials_are_stops_so_they_cut_cleanly():
    """载体的声母要是塞音：爆破之后有明确的除阻段，切点找得准。"""
    for it in items(build()):
        if it.get("derive"):
            assert it["derive"][0] in "bpdtgk", it["derive"]


def test_voices_are_listed():
    """页面要能切换音色，所以数据里得有可选音色表。"""
    data = build()
    ids = [v["id"] for v in data["voices"]]
    assert ids == ["aitong", "xiaoyun", "xiaogang"]
    assert all(v["label"] for v in data["voices"])
    assert data["defaultVoice"] == "aitong"


def test_default_voice_is_in_the_list():
    data = build()
    assert data["defaultVoice"] in [v["id"] for v in data["voices"]]


def test_keys_stay_voice_independent():
    """key 不含音色，音色是 URL 前缀 —— 换音色不用重建数据。"""
    for it in items(build()):
        assert not any(v["id"] in it["key"] for v in build()["voices"]), it["key"]
