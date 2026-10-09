# 学拼音

小学一年级的汉语拼音跟练页。三个模式：

- **拼音表** —— 23 个声母和 24 个韵母的四声铺开，点哪个读哪个，整行连播听四声对比
- **选择题** —— 听一个音，从形近音近的选项里挑出来。4 / 6 / 10 三档自适应难度
- **跟读** —— 听标准音、自己读一遍，得 0–10 颗星，并看到自己的音高曲线和标准音叠在一起

目标浏览器是 **iOS Safari**。

## 跟读打分的原理与边界

打分全在浏览器本地算，不联网、不上传录音、不依赖任何云端识别服务。

| 项 | 分 | 说明 |
|---|---|---|
| 声调 | 9 | **有物理依据。** F0 曲线是从波形直接算出来的客观量 |
| 合理性 | 1 | 鼓励分（发声时长在 0.2–2 秒） |
| 声韵母 | **0** | 算，但不计分。见下 |

声调怎么算：录音 → 端点检测掐掉静音 → 提 F0 曲线 → 转半音并减去**本次发音
自身的中位数** → 按真实时间轴重采样到固定点数 → 和标准音的曲线比距离，同时
用一个自由增益去拟合四声的典型形状做分类。两处归一化是关键：减中位数让它
只比形状不比绝对音高（小孩嗓门高一个八度也不影响）；拟合时放开增益让它
只比形状不比起伏深浅（调域窄的人不会被整体判成一声）。

### 声韵母为什么不计分

原本设计里它占 3 分。实测下来这个量不是测量：

| 对比 | MFCC+CMVN+DTW 距离 |
|---|---|
| 同音色，成人 260Hz vs 小孩 430Hz | 3.97 |
| **不同**音色，跨音高 | **3.71** |
| 白噪声 vs 白噪声 | 3.81 |
| 标准音 vs 白噪声 | 4.75 |

不同音色比同音色还「像」，噪声和语音挤在一起 —— 距离被音高差主导，跟读对
没读对无关。把它换成分数只会白送一个约 2 分的常数，让吹麦也能拿九星。
所以它仍然计算、仍然进调试面板，但不参与星数。`test/analyze.test.js` 里
立了一条绊线测试：哪天它真的有判别力了，那条会红，届时再考虑放回计分。

**这不是发音评测，是一个只判声调的练习反馈。** 它分不清「ā」和一声的哼鸣 ——
只要音高走向对，它就给高分。界面和文档都不该宣称它能判断发音对错。真要
音素级的准确度，得接 Azure 或讯飞的发音评测 API，那需要一个藏密钥的服务端
代理，不在本项目范围内。

## 本地预览

### 音频的跨域问题（本地自测必读）

本页所有音频都走 `fetch` + `decodeAudioData`（跟读要拿原始 PCM，
不像 `<audio>` 标签能绕过 CORS）。而 OSS 的跨域规则只放行
`https://saisai.me`，所以在 `localhost` 或局域网 HTTPS 上打开时，
**连拼音表都不会出声**。

本地自测时把音频放到同源：

    python pinyin/scripts/tts_aliyun.py --ong-mode trim-dong -o pinyin/audio
    # 然后开页面时带上 ?audio=local

`pinyin/audio/` 已加入 .gitignore，不会进仓库。
`?audio=<地址>` 也可以指向任意别的 baseUrl。

### 起服务

`fetch` 在 `file://` 下会被拦截，需要起本地服务：

    python3 -m http.server 8777

然后打开 http://localhost:8777/pinyin/

### 跟读必须跑在 HTTPS 下

`getUserMedia` 要求安全上下文。`localhost` 算安全，**局域网 IP 不算** ——
从 iPhone 访问 `http://192.168.x.x:8777` 时麦克风会直接被拒。真机测跟读两条路：

1. 部署到 saisai.me，用手机访问
2. 本地起 HTTPS：

        openssl req -x509 -newkey rsa:2048 -keyout /tmp/k.pem -out /tmp/c.pem \
          -days 7 -nodes -subj "/CN=$(ipconfig getifaddr en0)"
        python3 -c "
        import http.server, ssl
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain('/tmp/c.pem', '/tmp/k.pem')
        srv = http.server.HTTPServer(('0.0.0.0', 8443), http.server.SimpleHTTPRequestHandler)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        srv.serve_forever()
        "

   然后 iPhone 打开 `https://<你的IP>:8443/pinyin/`，信任自签证书。

## 内容：118 条

- 声母 23 个，按**呼读音**合成（b 读「玻 bo」、zh 读「知 zhi」），和课堂一致
- 韵母 24 个 × 四声 = 95 条。**`er` 没有一声**（现代汉语只有 ér ěr èr）；
  不收 `ê`（不在课本 24 韵母表内）

数据在 `data/pinyin.json`，由 `scripts/build_data.py` 生成。
`display`（屏幕字形，带调号）和 `ssml`（TTS 要的零声母音节）是两个字段，
id 和 key 里 ü 一律写作 `v`（`lv`=ü、`ve`=üe、`vn`=ün），避开 URL 编码问题。

## TTS 合成说明

音频由阿里云智能语音交互（ISI）合成，用 SSML 的 phoneme 标签按拼音加声调号
精确控调，不靠挑汉字去凑声调：

    <speak><phoneme alphabet="py" ph="ang3">啊</phoneme></speak>

汉字只是载体，发音完全由 `ph` 决定。

### 韵母要写成零声母音节

`ph` 必须是合法音节，所以韵母单独呼读时的写法和屏幕字形不同：
i→yi、u→wu、ü→yu、ui→wei、iu→you、ie→ye、üe→yue、in→yin、
un→wen、ün→yun、ing→ying。

### ong 的特殊处理

**普通话没有单独的 `ong` 音节**（`weng` 是韵母 ueng，音不同，不能顶替），
它是唯一需要特判的一条。两条路：

1. `direct` —— 引擎若按拼音直接映射音素、能正确读出 ong，就照常合成
2. `trim-dong` —— 否则合成 `dong1`–`dong4`，再用能量起点检测裁掉声母 `d`。
   教学上示范 ong 本来就是「dōng 去掉 d」

**结论：`direct` 走不通，用 `trim-dong`。** 2026-10-09 实测，`ph="ong1"`~`ong4`
接口都返回 200，但合成出来的 mp3 只有 288 字节 —— 一个空 MP3 帧，完全静音。
同批的 eng1 / er2 / yu1 / you1 都是 1800–2000 字节且发音正常。引擎不认 `ong`
这个音节，又不报错。

所以合成时必须带上 `--ong-mode trim-dong`。

冒烟脚本已经会按字节数判静音（接口返回 200 不等于合成成功）：

    python pinyin/scripts/smoke_tts.py
    afplay /tmp/pinyin-smoke/ong1.mp3

它只合成 8 条高风险音节（ong 四声、eng1、er2、yu1、you1）到 `/tmp/pinyin-smoke`，
**仍然要人耳逐条确认声调对不对** —— 字节数只能排除静音，排除不了读错调。

## 发音人与声调质量

**这是本项目最需要盯住的一件事。**

句子级 TTS 把一个孤立音节当成一句完整的话来读，在词汇声调之上叠了句末语调。
实测（`tools/tone-check.html`，把每条标准音喂进跟读用的同一条管线）：

| 发音人 | 四声形状正确 | 毛病 |
|---|---|---|
| xiaoyun | 1/4 | 句末降调。一声从 264 掉到 206Hz（降 4 个半音） |
| aitong | 3/4 | 句末升调。一声往上走 3.2 个半音，被判成二声 |
| siqi / ruoxi / aijia / aiyu / xiaomei / aixia / ninger / zhixiaobai / zhitian_emo | 最好 3/4 | 同类问题 |

**换发音人解决不了** —— 测了 12 个，没有一个四声全对。对照实验确认不是
SSML 写错：`ph="ma1"` 和直接给汉字「妈」，测出来的 F0 完全一致。

后果不只是打分错：**音频本身在教错的调**。孩子听着「ā」是往上走的，
照着读，然后被判「读成了二声」。

重跑验收：起本地服务后打开 `pinyin/tools/tone-check.html`。

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
        requests aliyun-python-sdk-core python-dotenv numpy oss2 soundfile

流程：

    python pinyin/scripts/build_data.py          # 生成 data/pinyin.json
    python pinyin/scripts/smoke_tts.py           # 先验高风险音节，人耳确认
    python pinyin/scripts/tts_aliyun.py --ong-mode trim-dong
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

## 测试

    node --test pinyin/test/*.test.js        # JS，零依赖，用 Node 内置 runner
    python -m pytest pinyin/scripts/ -v      # Python 构建脚本

注意是 glob 不是目录 —— Node 的 `--test` 收到目录参数会当成文件去解析。

`lib/` 下全是纯函数，全部有单测：端点检测、FFT、MFCC+CMVN、DTW、声调归一化
与四声分类、干扰项抽取、难度升降、评分汇总。另有两组跨模块的集成测试：

- `analyze.test.js` —— 合成信号跑完「PCM→端点→F0→归一化→MFCC→DTW→打分」
  全链路，含儿童音域对成人标准音、以及读错声调的情形
- `quiz-scope.test.js` —— 拿真实的 118 条数据，对每个目标 × 每个出题范围 ×
  每个难度验证选项不重复、含正确答案、数量合理

## 阈值校准

`lib/score.js` 顶部的阈值**第一版是猜的**，需要用真实录音调一轮。
连点标题三下打开调试面板看各项原始数值；采样与调整的规矩见
`test/fixtures/README.md`。在采到样本之前，`calibration.test.js` 记为 skipped。

## 第三方代码

`vendor/` 下的文件是手工下载的 ESM，无构建步骤，来源可追溯：

| 文件 | 来源 | 版本 |
|---|---|---|
| `vendor/pitchy.mjs` | `https://cdn.jsdelivr.net/npm/pitchy@4.1.0/+esm` | pitchy 4.1.0 |
| `vendor/fft.mjs` | `https://cdn.jsdelivr.net/npm/fft.js@4.0.4/+esm` | fft.js 4.0.4 |

jsDelivr 的 `+esm` 构建里，pitchy 对 fft.js 的 import 写的是 CDN 绝对路径
`/npm/fft.js@4.0.4/+esm`，离线解析不了。下载后把那一处改成了 `"./fft.mjs"`，
这是对 vendored 文件的唯一改动。升级版本时记得重做这一步。

（`lib/fft.js` 是给 MFCC 自己写的 FFT，和 `vendor/fft.mjs` 是两码事 ——
后者是 pitchy 的依赖。）

## 待办

这个子项目还没跑通最后一公里。按顺序：

1. **开通阿里云「智能语音交互」**，拿 appkey，在项目根建 `.env`
   （见上面「重新生成音频」一节的变量清单）。
2. ~~跑 `smoke_tts.py` 确认 `ong`~~ —— 已完成，结论是 `trim-dong`，
   见上面「ong 的特殊处理」。
3. **合成并上传 118 条音频**，验证公共读和 CORS 头。在此之前页面上所有
   音频都是 404，只有降级提示能看。
4. **真机过一遍跟读**（必须 HTTPS）。重点确认 AudioWorklet 真的采到了声音 ——
   这一条在桌面 Chrome 里验不了：没有用户手势时 AudioContext 处于
   suspended、整个音频图不渲染。若按住说话后总是提示「没听到声音」，
   第一个要查的就是这里。
5. **采真实录音校准阈值**，见 `test/fixtures/README.md`。

### 已知局限（不是 bug，是边界）

- **分不清「ā」和一声的哼鸣。** 只要音高走向对就给高分。声韵母不计分，
  原因见上文。
- 录音没有时长上限，长按会让主线程上的分析卡一下。
- 首次按下时，麦克风授权弹窗会打断触摸；极端情况下会在手指松开后才开始录音。
- 连播四声的过程中切走 tab 已能停下，但点另一个格子打断的路径没有在真实
  音频下验证过（音频还没上传）。
