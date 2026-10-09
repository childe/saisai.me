"""把合成好的 mp3 上传到阿里云 OSS。幂等：大小一致则跳过。"""

import argparse
import json
import os
import sys

import oss2
from dotenv import load_dotenv

DEFAULT_PREFIX = "pinyin/"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-s", "--src", default="/tmp/pinyin-audio")
    p.add_argument("-d", "--data", default="pinyin/data/pinyin.json")
    p.add_argument(
        "--prefix",
        default=DEFAULT_PREFIX,
        help="OSS 前缀。多音色时用 pinyin/<voice>/",
    )
    args = p.parse_args()

    load_dotenv()
    auth = oss2.Auth(
        os.environ["OSS_ACCESS_KEY_ID"], os.environ["OSS_ACCESS_KEY_SECRET"]
    )
    bucket = oss2.Bucket(
        auth, "https://" + os.environ["OSS_ENDPOINT"], os.environ["OSS_BUCKET"]
    )

    prefix = args.prefix if args.prefix.endswith("/") else args.prefix + "/"
    data = json.load(open(args.data, encoding="utf-8"))
    items = [it for g in data["groups"] for it in g["items"]]

    uploaded = skipped = 0
    for i, it in enumerate(items, 1):
        path = os.path.join(args.src, it["key"])
        if not os.path.exists(path):
            raise FileNotFoundError("缺少 %s，先跑 tts_aliyun.py" % path)
        key = prefix + it["key"]
        size = os.path.getsize(path)
        try:
            if bucket.head_object(key).content_length == size:
                skipped += 1
                continue
        except oss2.exceptions.NoSuchKey:
            pass
        with open(path, "rb") as f:
            bucket.put_object(key, f, headers={"Content-Type": "audio/mpeg"})
        uploaded += 1
        print("[%d/%d] 上传 %s (%d bytes)" % (i, len(items), key, size))

    print("完成：上传 %d，跳过 %d（前缀 %s）" % (uploaded, skipped, prefix))
    return 0


if __name__ == "__main__":
    sys.exit(main())
