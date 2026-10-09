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

原本设计里它占 3 分。拿**同样 118 个音节、三个不同说话人**的真实录音
（aitong / hanyupinyin.cn / 公有领域音库）做过检索实验：拿 A 说话人的某个
韵母，去 B 说话人的 23 个候选里找回它自己。随机基线 top-1 约 4%、中位名次 12。

| 方案 | aitong→hyp | aitong→pd | hyp→pd |
|---|---|---|---|
| MFCC 每条自归一 | 13% / 名次 6 | **0% / 15** | 19% / 5 |
| MFCC 按说话人归一 | 0% / 8 | 5% / 16 | 19% / 5 |
| 梅尔声谱按说话人归一 | 4% / 3 | 5% / 11 | 14% / 5 |
| 共振峰 F1/F2 按基频归一 | 13% / 4 | 24% / 5 | 14% / 3 |

两个结论：

1. **原来的 MFCC 每条自归一是错的** —— 对 0.4 秒的音节做均值方差归一化，
   等于把这个音节自己的音色特征当通道偏差减掉了。换个录音条件直接掉到随机以下。
2. **共振峰最好，但仍不够下判决** —— 中位名次 3–5（共 23 个候选）换算成
   二分判别力约 AUC 0.86，每 7 次错 1 次。而且参与对比的都是成人或 TTS 的
   清晰发音，换成孩子含糊的发音只会更差。对一年级孩子来说，七次里冤枉一次
   "读错了"，这种反馈不如不给。

试过在 JS 里实现共振峰提取，没做成：滑动平均做不出谱包络，倒谱平滑的截断点
在基频 200Hz 下卡不准（F1=700 会测成 500 或 219，随截断点大幅摆动）。
Python 实验用的是 WORLD 声码器的谱包络，不是几十行能复刻的；正规做法是
LPC + 多项式求根。考虑到上限本来就不够下判决，没有继续。

**要真判发音准不准，只能上专业的发音评测服务。**
[阿里云拼音评测](https://help.aliyun.com/zh/document_detail/2996306.html)
（`coreType: "cn.raw.score"`）正好对口：`refText` 直接写 `"ang3"` 这种单独的
声母或韵母带声调号，返回 `pron`（发音准确度）、`tone`（声调得分）、音素级细分，
[0.004 元/次](https://help.aliyun.com/zh/document_detail/2996336.html)。
需要开通「智能科教内容生成平台」，并加一个藏密钥的代理（本站是纯静态的，
密钥不能进前端）。

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

    python pinyin/scripts/tts_aliyun.py -o pinyin/audio
    # 然后开页面时带上 ?audio=local

`pinyin/audio/` 已加入 .gitignore，不会进仓库。
本地目录也按音色分（`audio/<voice>/ym/a1.mp3`），和 OSS 的结构一致。
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
un→wen、ün→yun、ing→ying，以及 **o→wo、ong→weng**（见下）。

### o / eng / ong 另有处理

这三个没有自己的零声母音节，见下面「o / eng / ong」一节。

### 合成之后必须验一遍

接口返回 200 **不等于**合成成功：引擎遇到不认识的音节会返回一个 288 字节的
空 MP3 帧，状态码照样是 200。冒烟脚本因此按字节数判静音：

    python pinyin/scripts/smoke_tts.py
    afplay /tmp/pinyin-smoke/ong1.mp3

它只合成 8 条高风险音节到 `/tmp/pinyin-smoke`，**仍然要人耳逐条确认声调**
—— 字节数只能排除静音，排除不了读错调（`ph="o1"` 就被读成过「欧」）。
整批合成完之后再跑一次 `audit_tones.py` 做调型验收。

## 音色可以切换

页面顶部能选 **童声 aitong / 女声 xiaoyun / 男声 xiaogang**，选择记在
localStorage 里，`?voice=<id>` 可以临时覆盖。

音频按 `<baseUrl><voice>/<key>` 存放，所以换音色只是换 URL 前缀 ——
数据本身（key、声调、干扰项）和音色无关，加音色不用重建数据：

1. 在 `build_data.py` 的 `VOICES` 里加一行
2. `tts_aliyun.py --voice <id> -o /tmp/pinyin-audio-v/<id>`
3. `retone.py -s /tmp/pinyin-audio-v/<id> -o /tmp/pinyin-retoned-v/<id>`
4. `upload_oss.py -s /tmp/pinyin-retoned-v/<id> --prefix pinyin/<id>/`

**换音色不影响跟读打分**：所有音色都经过同一套换调，调型是一样的。
三套的调型验收：aitong 96%、xiaoyun 100%、xiaogang 99%。

阿里云中文发音人约 60 个，童声/萝莉音有 9 个
（aitong、sitong、xiaobei、aiwei、aibao、zhiwei、jielidou、yuer、zhibei_emo），
都验过支持 phoneme 标签。音色对比页在 `audio/probe/voices.html`（本地工具，
不进仓库）。

> 探测发音人时注意**别用高并发** —— 6 路并发会触发限流，返回的错误很像
> "这个音色不可用"，实际串行重试全都正常。

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

### 解法：换调（`scripts/retone.py`）

合成之后把音高曲线换成标准调型再重新合成。WORLD 声码器拆出
F0 / 频谱包络 / 非周期性成分，**只改写 F0**，音色、音长、音强都来自原音；
声调基准取该条音频自身 F0 的中位数，所以不改变说话人的音域。
调型按赵元任五度标调法：一声 55、二声 35、三声 214、四声 51。

效果（`tools/tone-check.html`，95 条韵母）：

| 素材 | 判对 |
|---|---|
| xiaoyun 原始 | 约 1/4 的形状正确 |
| aitong 原始 | 65 / 95（68%） |
| 公有领域真人 | 69 / 83（83%） |
| hanyupinyin.cn | 83 / 95（87%） |
| **aitong + 换调（上线用的）** | **90 / 95（95%）** |

还判错的 5 条：4 条是我们自己合成的三声被判成二声，1 条是 hanyupinyin
的 `óng`。二声和三声都是「先降后升」，而归一化去掉了「二声偏高、三声偏低」
这个信息，只靠形状区分有物理上限 —— 试过三版模板，这是最好的平衡。

重跑验收：起本地服务后打开
`pinyin/tools/tone-check.html?dir=audio/retoned`（不带 `?dir=` 查 `audio/`）。

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
        requests aliyun-python-sdk-core python-dotenv numpy oss2 soundfile \
        pyworld "setuptools<81"

（`pyworld` 换调用；它 import `pkg_resources`，setuptools 81 起移除了该模块，
所以要钉版本。）

流程：

    python pinyin/scripts/build_data.py       # 生成 data/pinyin.json
    python pinyin/scripts/smoke_tts.py        # 先验高风险音节，人耳确认
    python pinyin/scripts/tts_aliyun.py       # -> /tmp/pinyin-audio
    python pinyin/scripts/retone.py           # -> /tmp/pinyin-retoned
    python pinyin/scripts/upload_oss.py -s /tmp/pinyin-retoned

    # 验收：调型对不对
    python pinyin/scripts/audit_tones.py /tmp/pinyin-retoned

合成与上传都幂等：已存在且大小一致则跳过。换调纯本地计算。

**顺序不能换**：带 `derive` 的条目是先合成载体音节再裁掉声母，
必须裁完再换调，否则换调会把声母那一段也算进调型里。

## 每个韵母的音频是怎么来的

所有音频都先由阿里云 TTS（aitong）合成，再统一换调。差别在于**送进 TTS 的是哪个音节**。

| 组 | 韵母 | 送进 TTS | 备注 |
|---|---|---|---|
| 单韵母 | **a** | 直接合成 `a` |  |
| 单韵母 | **o** | 借用 `wo` | ⚠️ 不是标准呼读式 |
| 单韵母 | **e** | 直接合成 `e` |  |
| 单韵母 | **i** | 借用 `yi` | 标准呼读式 |
| 单韵母 | **u** | 借用 `wu` | 标准呼读式 |
| 单韵母 | **ü** | 借用 `yu` | 标准呼读式 |
| 复韵母 | **ai** | 直接合成 `ai` |  |
| 复韵母 | **ei** | 直接合成 `ei` |  |
| 复韵母 | **ui** | 借用 `wei` | 标准呼读式 |
| 复韵母 | **ao** | 直接合成 `ao` |  |
| 复韵母 | **ou** | 直接合成 `ou` |  |
| 复韵母 | **iu** | 借用 `you` | 标准呼读式 |
| 复韵母 | **ie** | 借用 `ye` | 标准呼读式 |
| 复韵母 | **üe** | 借用 `yue` | 标准呼读式 |
| 复韵母 | **er** | 直接合成 `er` |  |
| 鼻韵母 | **an** | 直接合成 `an` |  |
| 鼻韵母 | **en** | 直接合成 `en` |  |
| 鼻韵母 | **in** | 借用 `yin` | 标准呼读式 |
| 鼻韵母 | **un** | 借用 `wen` | 标准呼读式 |
| 鼻韵母 | **ün** | 借用 `yun` | 标准呼读式 |
| 鼻韵母 | **ang** | 直接合成 `ang` |  |
| 鼻韵母 | **eng** | 合成 `beng` 再裁掉声母 | ⚠️ 有裁切 |
| 鼻韵母 | **ing** | 借用 `ying` | 标准呼读式 |
| 鼻韵母 | **ong** | 借用 `weng` | ⚠️ 不是标准呼读式 |

11 个韵母送的是**零声母呼读式**（i→yi、u→wu、ü→yu、ui→wei、iu→you、ie→ye、
üe→yue、in→yin、un→wen、ün→yun、ing→ying）—— 这是课本教的读法，不是将就。

**三个例外，也是最可能听着不对的三个**：

- **`o` → `wo`（窝）** —— 多一个 [u] 介音。直接合成 `ph="o1"` 会被引擎读成「欧」。
- **`ong` → `weng`（翁）** —— **韵母其实是 ueng 不是 ong**，主元音都不同。
  但普通话没有单独的 ong 音节，`ph="ong1"` 和 `ph="wong1"` 都返回静音。
- **`eng`** —— 从 `beng` 裁掉声母，裁切点靠能量起点检测，可能留残音或切过头。

声母 23 个全部按呼读音直接合成（b→bo、zh→zhi、w→wu…），没有借用或裁切。

## o / eng / ong：三个没有零声母音节的韵母

这三个是整套素材里唯一的难点，坑踩了好几轮，记在这里免得重走：

- **`ong` 在普通话里根本不是一个独立音节**，`o`（喔）和 `eng`（鞥）极其罕见。
  连收录 413 个音节的公有领域真人音库都缺这三个 —— 它收的是实际成词的音节。
- **TTS 引擎同样没有，但它不报错，只会瞎凑**：实测 `ph="ong1"` 和
  `ph="wong1"` 都返回 288 字节的空 MP3 帧（接口仍是 200）；`ph="o1"`
  被读成了「欧」。冒烟脚本因此改成按字节数判静音。
- `wong` 是粤语拼音，普通话没有这个音节，引擎不认。

现在的做法：

| 韵母 | 来源 | 为什么 |
|---|---|---|
| `o` | 合成 **`wo`**（窝） | 真实音节；韵母 [uɔ] 前面只多一个介音 |
| `ong` | 合成 **`weng`**（翁） | 真实音节；是最接近的后鼻韵母 |
| `eng` | 合成 `beng` 再**裁掉声母** | 没有可借的真实音节（weng 已经给了 ong） |

前两个不需要裁切，只是换个音节合成，所以只有 `eng` 还带 `derive` 字段。

**整套音频不含任何第三方素材**，全部由我们自己合成，没有授权问题。
考察过的外部来源（公有领域音库、Shtooka、hanyupinyin.cn 等）都只用于
对比试听，没有进入产物。

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
2. ~~跑 `smoke_tts.py` 确认 `ong`~~ —— 已完成，见「o / eng / ong」一节。
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
