"""解压教材音频 zip，把 GBK 文件名还原为 UTF-8。"""

import argparse
import os
import zipfile


def extract(zip_path, out_dir):
    z = zipfile.ZipFile(zip_path)
    count = 0
    for info in z.infolist():
        try:
            name = info.filename.encode("cp437").decode("gbk")
        except (UnicodeEncodeError, UnicodeDecodeError):
            name = info.filename
        target = os.path.join(out_dir, name)
        if name.endswith("/"):
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(z.read(info))
        count += 1
    return count


def main():
    p = argparse.ArgumentParser()
    p.add_argument("zip_path")
    p.add_argument("out_dir")
    args = p.parse_args()
    print("解压 %d 个文件到 %s" % (extract(args.zip_path, args.out_dir), args.out_dir))


if __name__ == "__main__":
    main()
