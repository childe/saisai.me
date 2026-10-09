# 学拼音

小学一年级的汉语拼音跟练页。三个模式：拼音表试听、听音选形的选择题、
带声调曲线对比的跟读打分。

## TTS 合成说明

118 条标准音由阿里云智能语音交互（ISI）合成，用 SSML 的 phoneme 标签
按拼音加声调号精确控调，不靠挑汉字去凑声调：

    <speak><phoneme alphabet="py" ph="ang3">啊</phoneme></speak>

汉字只是载体，发音完全由 `ph` 决定。

### 韵母要写成零声母音节

`ph` 必须是合法音节，所以韵母单独呼读时的写法和屏幕字形不同：
i→yi、u→wu、ü→yu、ui→wei、iu→you、ie→ye、üe→yue、in→yin、
un→wen、ün→yun、ing→ying。数据里 `display` 和 `ssml` 因此是两个字段。

### ong 的特殊处理

**普通话没有单独的 `ong` 音节**（`weng` 是韵母 ueng，音不同，不能顶替），
所以它是唯一需要特判的一条。两条路：

1. `direct` —— 引擎若按拼音直接映射音素，能正确读出 ong，就照常合成。
2. `trim-dong` —— 否则合成 `dong1`–`dong4`，再用能量起点检测裁掉声母 `d`。
   教学上示范 ong 本来就是「dōng 去掉 d」。

**当前结论：尚未验证。** 冒烟测试还没跑过（需要先开通服务拿 appkey），
`tts_aliyun.py` 的 `--ong-mode` 默认是 `direct`。跑完冒烟测试后回来更新这一节。

重跑冒烟测试：

    python pinyin/scripts/smoke_tts.py
    afplay /tmp/pinyin-smoke/ong1.mp3

它只合成 8 条高风险音节（ong 四声、eng1、er2、yu1、you1）到 `/tmp/pinyin-smoke`，
**必须人耳逐条确认**，不能只看接口返回 200。

## 重新生成音频

前置：在阿里云控制台开通「智能语音交互」，建项目拿 appkey；
OSS 复用 english-audio 那套凭证。项目根 `.env` 需要：

    OSS_ACCESS_KEY_ID=...
    OSS_ACCESS_KEY_SECRET=...
    OSS_ENDPOINT=oss-cn-shanghai.aliyuncs.com
    OSS_BUCKET=ohsaisai
    NLS_APPKEY=...

依赖（用 uv，不要用 pip）：

    uv pip install --python ~/tmp/fuck/c/.venv/bin/python \
        --index-url https://mirrors.aliyun.com/pypi/simple/ \
        requests aliyun-python-sdk-core python-dotenv numpy oss2 pydub

流程：

    python pinyin/scripts/build_data.py          # 生成 data/pinyin.json
    python pinyin/scripts/smoke_tts.py           # 先验高风险音节，人耳确认
    python pinyin/scripts/tts_aliyun.py --ong-mode direct
    python pinyin/scripts/upload_oss.py

后两步都幂等：已合成/已上传且大小一致则跳过。

Bucket 需对 `pinyin/*` 开公共读，跨域规则沿用现有的
（允许来源 `https://saisai.me` 的 GET / HEAD）。验证：

    curl -sI https://ohsaisai.oss-cn-shanghai.aliyuncs.com/pinyin/ym/a1.mp3 | head -3
    curl -sI -H 'Origin: https://saisai.me' \
      https://ohsaisai.oss-cn-shanghai.aliyuncs.com/pinyin/ym/a1.mp3 \
      | grep -i access-control-allow-origin

**跨域头是必须的** —— 跟读要用 `fetch` + `decodeAudioData` 读标准音，
不像 `<audio>` 标签那样能绕过 CORS。
