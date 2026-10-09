"""TTS 冒烟测试：只合成高风险音节，确认 phoneme 控调是否可用。

高风险项：
  ong1-4  普通话没有单独的 ong 音节，引擎可能直接拒绝
  eng1    罕见音节
  er2     er 没有一声，确认二三四声正常
  yu1     ü 的零声母形式
  you1    iu 的零声母形式
"""

import json
import os
import sys

import requests
from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest
from dotenv import load_dotenv

HOST = "https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts"
RISKY = ["ong1", "ong2", "ong3", "ong4", "eng1", "er2", "yu1", "you1"]
VOICE = "aitong"

# 接口对不认识的音节会返回 200 + 一个空 MP3 帧（实测 288 字节），
# 不报错。光看状态码会把静音当成功，所以按字节数判。
MIN_BYTES = 1000


def get_token(key_id, key_secret):
    client = AcsClient(key_id, key_secret, "cn-shanghai")
    req = CommonRequest()
    req.set_method("POST")
    req.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
    req.set_version("2019-02-28")
    req.set_action_name("CreateToken")
    body = client.do_action_with_exception(req)
    return json.loads(body)["Token"]["Id"]


def synth(token, appkey, ssml, out_path):
    """用 phoneme 标签强制读音。汉字只是载体，发音由 ph 决定。"""
    text = '<speak><phoneme alphabet="py" ph="%s">啊</phoneme></speak>' % ssml
    payload = {
        "appkey": appkey,
        "token": token,
        "text": text,
        "format": "mp3",
        "sample_rate": 16000,
        "voice": VOICE,
    }
    r = requests.post(HOST, json=payload, timeout=20)
    ctype = r.headers.get("Content-Type", "")
    if "audio" not in ctype:
        return False, r.text[:300]
    with open(out_path, "wb") as f:
        f.write(r.content)
    if len(r.content) < MIN_BYTES:
        return False, "%d bytes —— 静音，引擎不认这个音节" % len(r.content)
    return True, "%d bytes" % len(r.content)


def main():
    load_dotenv()
    token = get_token(
        os.environ["OSS_ACCESS_KEY_ID"], os.environ["OSS_ACCESS_KEY_SECRET"]
    )
    appkey = os.environ["NLS_APPKEY"]
    out_dir = "/tmp/pinyin-smoke"
    os.makedirs(out_dir, exist_ok=True)

    failures = []
    for ssml in RISKY:
        ok, info = synth(token, appkey, ssml, os.path.join(out_dir, ssml + ".mp3"))
        print("%-6s %s  %s" % (ssml, "OK  " if ok else "FAIL", info))
        if not ok:
            failures.append(ssml)

    print("\n音频在 %s，请逐个试听确认声调正确。" % out_dir)
    if failures:
        print("合成不出来：%s" % ", ".join(failures))
        if any(f.startswith("ong") for f in failures):
            print("=> ong 合成不出来。见 build_data.py 里 YUNMU / DERIVED_FROM 的注释")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
