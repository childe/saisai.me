"""按 manifest 把本地 mp3 上传到阿里云 OSS。幂等：大小一致则跳过。"""

import argparse
import json
import os
import sys

import oss2
from dotenv import load_dotenv

PREFIX = "english-audio/g1a/"


def local_path(src_dir, track):
    """manifest 里的 key 不含原始中文名，按 no 在源目录里反查文件。"""
    want = "%02d " % track["no"]
    for root, _dirs, files in os.walk(src_dir):
        for name in files:
            if name.startswith(want) and name.lower().endswith(".mp3"):
                return os.path.join(root, name)
    raise FileNotFoundError("源目录里找不到编号 %d 的 mp3" % track["no"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src_dir", help="解压后的音频目录")
    p.add_argument("-m", "--manifest", default="english-audio/data/g1a.json")
    args = p.parse_args()

    load_dotenv()
    auth = oss2.Auth(
        os.environ["OSS_ACCESS_KEY_ID"], os.environ["OSS_ACCESS_KEY_SECRET"]
    )
    bucket = oss2.Bucket(
        auth, "https://" + os.environ["OSS_ENDPOINT"], os.environ["OSS_BUCKET"]
    )

    manifest = json.load(open(args.manifest, encoding="utf-8"))
    tracks = [t for u in manifest["units"] for t in u["tracks"]]

    uploaded = skipped = 0
    for i, track in enumerate(tracks, 1):
        path = local_path(args.src_dir, track)
        key = PREFIX + track["key"]
        size = os.path.getsize(path)
        try:
            if bucket.head_object(key).content_length == size:
                skipped += 1
                print("[%d/%d] 跳过 %s" % (i, len(tracks), key))
                continue
        except oss2.exceptions.NoSuchKey:
            pass
        with open(path, "rb") as f:
            bucket.put_object(key, f, headers={"Content-Type": "audio/mpeg"})
        uploaded += 1
        print("[%d/%d] 上传 %s (%d bytes)" % (i, len(tracks), key, size))

    print("完成：上传 %d，跳过 %d" % (uploaded, skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main())
