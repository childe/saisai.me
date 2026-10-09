# 英语教材配套音频

《英语（一年级上册）》教材配套音频的在线收听页。按单元列出，点击即播，
为跟读提供 0.6x / 0.8x 慢速、单曲循环和回跳 5 秒。

音频存在阿里云 OSS（`ohsaisai` bucket，前缀 `english-audio/g1a/`），
曲目信息在 `data/g1a.json`。

## 本地预览

`fetch` 在 `file://` 下会被拦截，需要起本地服务：

    python3 -m http.server 8777

然后打开 http://localhost:8777/

## 重新生成与上传

    source ~/tmp/fuck/c/.venv/bin/activate
    uv pip install --index-url https://mirrors.aliyun.com/pypi/simple/ mutagen oss2 python-dotenv

    python scripts/extract_zip.py <教材音频.zip> /tmp/g1a-src
    python scripts/build_manifest.py /tmp/g1a-src -o data/g1a.json
    python scripts/upload_oss.py /tmp/g1a-src

上传脚本从项目根 `.env` 读 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` /
`OSS_ENDPOINT` / `OSS_BUCKET`，幂等（已存在且大小一致则跳过）。

Bucket 需要对 `english-audio/*` 开公共读；跨域规则已配为允许来源
`https://saisai.me` 的 GET / HEAD。

## 测试

    cd scripts && python -m pytest test_build_manifest.py -v
