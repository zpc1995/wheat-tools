# wheat tools · 麦工具

> **本项目由 DeepSeek Harness 0.2.0-rc.2 构建。**
> 代码、测试、文档与发布流水线均由该 agent 编写，人工只负责提出需求与验收。
> 页面底部与 `index.html` 的 `generator` 元信息里也标注了这一点。

wheat tools（麦工具）是一个前端小工具集合。首页是总入口，每个小工具都是 `src/tools/` 下**独立目录**里的模块，
新增工具不需要改动入口或路由代码。

技术栈：Vite + React 18 + TypeScript + [Fluent UI React v9](https://react.fluentui.dev/)
（严格按 [Fluent 2](https://fluent2.microsoft.design/) 设计规范：中性色层级、圆角、
阴影、Segoe UI Variable 字体、亮/暗双主题）。

> [!NOTE]
> **本项目的代码由 AI 编写。** 整体架构、组件实现、样式与自动化验证脚本均由 AI
> 生成，人工负责需求定义、设计取舍的决策与结果验收。提交记录中的作者信息是项目
> 维护者本人。
>
> 因此请不要默认其实现已经过充分的人工审查；涉及安全敏感场景（例如解析不可信
> 输入、处理凭据）时，建议先自行复核相关代码。

## 快速开始

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5273
pnpm build      # 产出 dist/
pnpm preview    # 预览构建产物
pnpm typecheck  # tsc -b
```

> 本仓库把 pnpm store 放在工作区内的 `.pnpm-store/`（该环境下全局缓存路径只读）。
> 若换了环境，可以直接 `pnpm install` 使用默认 store。

## 已有工具

共 65 个工具，按左侧导航的大类分组。导航顶部常驻「工具箱首页」入口，
便于从任意工具一键归位；「常用工具」按打开次数排序，「我的收藏」由卡片
右上角的星标维护，两者都存在浏览器 localStorage。

### 按工具代码分割

每个工具目录拆成两个文件，让**元数据与实现分开加载**：

```
src/tools/<id>/
├── manifest.ts   只有元数据（名称、描述、分类、一个图标）—— 被注册表立即导入
├── index.ts      惰性入口：重新导出 manifest 与默认组件
└── <Name>Tool.tsx
```

注册表用 `import.meta.glob('./*/manifest.ts', { eager: true })` 立即拿到全部元数据，
再用 `import.meta.glob('./*/index.ts')` 拿到**加载函数**。因此首页只需要元数据，
工具实现（以及 yaml、marked、qrcode 这些依赖）留在各自 chunk 里按需加载。

实测首屏 JS 从 **1108 KB 降到 398 KB**（未压缩），打开 YAML 工具时才加载它那
107 KB 的解析器。卡片与侧边栏在鼠标悬停/键盘聚焦时就会预取对应 chunk，
所以正常点击时通常已经没有加载等待。

### 发布 Releases

推送 `v*` 形式的 tag 会自动创建一个 GitHub Release（工作流：`.github/workflows/release.yml`）。

Release 里除了 GitHub 自动附带的源码压缩包，还有一份**构建好的静态站点**：

| 附件 | 说明 |
| --- | --- |
| `wheat-tools-vX.Y.Z.zip` | 解压即可部署，**不需要 Node 或 pnpm**。包内含 `部署说明.txt` |
| `Source code`（GitHub 自动） | 源代码，需要自行 `pnpm install && pnpm build` |

之所以把构建产物也放上去：自建部署的意义就是摆脱对 GitHub Pages 可达性的依赖，
所以「下载一个压缩包、解压到网站根目录」这条路要能走得通，而不是先装一套 Node 工具链。

发布流程（不是自动的，需要人为决定版本号）：

```bash
# 1. 改版本号并提交
node -p "require('./package.json').version"     # 确认当前版本
#    编辑 package.json 的 version 字段，然后：
git add package.json && git commit -m "chore: 发布 vX.Y.Z"

# 2. 推 tag，剩下交给 Actions
git tag vX.Y.Z && git push origin vX.Y.Z
```

流水线会在发布前依次执行：类型检查、逻辑检查套件（1600+ 项断言）、构建、打包。
**任何一步失败都不会产生 Release**，所以 tag 不会被用来发布一个连自己测试都过不了的版本。
另外会校验 tag 与 `package.json` 的版本号一致，不一致直接失败并提示怎么改。

浏览器相关检查（工具冒烟、可访问性）不在流水线里跑：runner 上没有 Chromium，
而**跑不了的检查不能被显示成通过**。它们在本地用 `pnpm verify:all` 执行。

### 工具内搜索与可访问性

条目多的工具带搜索框：正则速查表 49 条（另有 10 条陷阱）、单位换算 93 个单位（10 个类别）、颜色名 28 个。
匹配规则刻意保持可预期：忽略大小写、**多词是「与」而非「或」**、
按字段分别匹配而不跨字段拼接（否则 `x` 与 `y` 会假命中 `xy`）。
在速查表里搜索时会**跨全部 6 组**查找而不是只搜当前标签页——只搜可见标签页
会把用户正要找的结果藏起来；结果行会标出所属分组。

可访问性方面：页面有唯一的 `h1`（工具名），各分区标题是真正的 `h2`
（共 106 处，批量加上 `as="h2"`），Markdown 预览里的标题整体下移一级，
避免与页面标题争抢文档大纲。全部 65 个工具通过自动审计。

### 多语言

界面支持**简体中文**与**English**，右上角切换，选择记在 localStorage 里。

覆盖范围（这一点值得说清楚，避免期望错位）：

| 范围 | 状态 |
| --- | --- |
| 界面壳层（顶栏、侧边栏、首页、工具页框架、加载态） | 已全部翻译 |
| 65 个工具的**名称 / 说明 / 标签** | 已全部翻译 |
| 工具**内部**的文字（约 1.9 万字） | 仍为中文，界面会显示明确提示 |

工具内部那些解释性文字占比最大，机械替换只会变差；因此宁可让它在英文界面下
如实显示「该工具的内容目前只有中文」，也不给出半生不熟的译文。逐工具接入的机制
已经就位（字典 + `useI18n`），可以按需推进。

实现上的两个约束：

- **字典用类型兜底**：`en-US` 声明为 `zh-CN` 推导出的 `Dictionary` 类型，
  少一个 key 就是编译错误，不会变成线上空白文案。
- **语言默认跟随浏览器**，已保存的选择优先。品牌名 `wheat tools / 麦工具`
  在两种语言下都保持不变。

### 主题与配色

默认**暗色**，右上角切换浅色。

主色是**紫罗兰（色相 258°）**，不是 Fluent 默认蓝 —— 默认蓝会让界面看起来像
未经设计的 Fluent 示例。之所以用完整的 16 级色阶而不是一个色值：**任何高饱和紫色
作为暗色背景上的文字都不达标**（实测最深的候选只有约 2:1），所以暗色主题必须取
色阶的浅色段，这正是 `createDarkTheme` 的用法。

色阶里的取舍都有实测依据（WCAG AA 4.5:1）：

| 用途 | 对比度 |
| --- | --- |
| 白字 / 品牌填充底（浅色主题） | 6.96 ✓ |
| 品牌文字 / 白底（浅色主题链接） | 6.96 ✓ |
| 品牌文字 / 深色底（暗色主题链接） | 4.54 ✓ |

最后一行是关键：用均分的色阶时，Fluent 的暗色主题会取 100 号做
`colorBrandForeground1`，实测只有 **3.77**，正文链接不达标。把浅色段整体提亮
才有这 4.54，这也是色阶在代码里写死而非用公式生成的原因。

### 布局与滚动

侧边栏与内容区是**两个独立的滚动容器**：在任一侧滚动都不会带动另一侧，
滚到尽头也不会传递给对方（`overscroll-behavior: contain`），文档本身不滚动。

这一点最初是坏的——`.wt-body` 的父元素是 FluentProvider 的 `display: block`
外层，因此 `flex: 1 1 auto` 从未生效，`flex-basis` 退化为内容高度，两个面板
都长成了全高、跟着文档一起滚。修复方式是加一个高度受约束的 flex 列容器
（`.wt-app`）。浏览器实测：文档 `scrollHeight` 等于视口高度，两个面板
`scrollHeight > clientHeight` 且各自独立。

工具分类**默认收起**（常用工具与我的收藏保持展开），顶部有「全部展开／全部收起」，
展开状态会记在 localStorage 里。

### 编程工具

| 工具 | ID | 说明 |
| --- | --- | --- |
| **进制转换** | `number-base` | 2–36 进制互转。整数用 BigInt 精确换算（超过 2^53 不丢精度），小数用缩放整数运算而非浮点。 |
| **正则测试** | `regex-tester` | 实时匹配高亮、捕获组与命名分组、替换预览；防零宽匹配死循环，并提示灾难性回溯风险。 |
| **UUID 生成器** | `uuid-generator` | 进入即生成 v4 UUID，可重新生成；历史可复制、收藏、导出 txt。 |
| **JSON 转类型** | `json-to-type` | 从一份或多份 JSON 样本生成 TypeScript 接口或 Go 结构体；多样本合并可推断可选字段，生成的 TS 经编译器校验。 |
| **JSON Schema 生成** | `json-schema` | 生成 draft 2020-12 Schema；多样本合并推断 required，并说明 format 与 additionalProperties 的真实行为。 |
| **正则速查表** | `regex-cheatsheet` | 字符类、锚点、量词、分组、标志与常用模式；**每条都由测试真正编译并匹配过**，并列明 JS 特有陷阱。 |
| **单位换算** | `unit-converter` | 10 个类别互转；温度按仿射变换处理，存储区分 1000 与 1024，数值对照 NIST 定义值。 |
| **HEX 查看器** | `hex-viewer` | 十六进制与文本查看、按文件头识别真实类型、熵与可打印占比统计、提取内嵌可读字符串。 |
| **ULID 生成器** | `ulid-generator` | Crockford Base32 ULID，支持单调递增模式（同毫秒也严格按字符串有序）；随机部分溢出时按规范抛错而非回绕。 |
| **Chmod 计算器** | `chmod-calculator` | 九个 rwx 位 + setuid/setgid/sticky 与八进制/符号互转，生成 `chmod` 命令。大小写 `s/S`、`t/T` 按有无执行位区分，与 `ls -l` 语义一致。 |
| **数学表达式计算器** | `math-evaluator` | 手写词法+递归下降解析，**全程不用 eval / new Function**。`^` 右结合、一元负号低于幂（`-2^2 = -4`）。页面有专门章节用实测演示为什么不能用 eval。 |
| **Git 速查表** | `git-cheatsheet` | 73 条命令按**场景**分组，13 条危险命令每条都写明补救办法（多数点名 `git reflog`）。核心检查是**危险等级与语义一致**，防止以后新增条目悄悄降级。 |
| **JSON 结构化对比** | `json-diff` | 与 `text-diff` 的区别是解析后按结构比。数组可**按标识字段配对**——按 `id` 配对后数组重排只有位置移动、零内容差异。用 JSON Pointer 定位。 |
| **JSON ↔ CSV** | `json-csv` | 表头取键的并集，嵌套对象按点号路径扁平化。CSV 解析遵循 RFC 4180（引号、字段内换行）。可选 BOM——Excel 打开无 BOM 的 UTF-8 CSV 会把中文显示成乱码。 |
| **预计完成时间** | `eta-calculator` | 按进度或每项耗时估算。**有意显示不确定性**（由 1/√n 推出 ±误差），样本少时提示不可靠，而不是给一个假装精确的时间。 |
| **百分比计算器** | `percentage-calculator` | 11 张卡片各带公式。含「涨 Y% 再降 Y% 不等于原值」这个高频误区。分配用最大余数法，各份之和精确等于总数。 |
| **SafeLink 解码器** | `safelink-decoder` | 还原 Defender 包装的链接。`sdata` 是签名但**明确标注本工具不验证**，`signatureVerified` 恒为 false。`+` 号的表单/RFC 3986 歧义两种读法并排显示。 |
| **OTP 验证码生成器** | `otp-generator` | TOTP（RFC 6238）与 HOTP（RFC 4226），密钥不保存不上传。参照 RFC 4226 附录 D 与 RFC 6238 附录 B 的**全部官方向量**（含中间的 HMAC 摘要与截断偏移）。 |
| **密码强度分析仪** | `password-strength` | 字符集熵 + **模式分析**（弱口令榜、键盘序、重复、序列、日期）。反证断言：`password123` 长度够但模式弱，判为强是错的。 |
| **Token 生成器** | `token-generator` | hex / Base64 / Base64URL / 自定义字符集。只用 `crypto.getRandomValues`，并用**卡方检验**验证分布、断言实现里没有 `Math.random`。 |
| **RSA 密钥对生成器** | `rsa-key-pair` | 2048/3072/4096 位（不提供 1024 并说明原因）。把生成的 PEM 交给 `node:crypto` 做**真实签名验签与 OAEP 加解密往返** —— 证明密钥真的可用，不只是格式像。 |
| **电话号码解析** | `phone-parser` | 覆盖 39 个国家/地区，未收录的明确告知不猜。用 Ofcom 影视保留号段与 ITU-T E.164 做参照。 |
| **字符串混淆器** | `string-obfuscator` | 字符层面的可逆混淆（leet / 零宽 / 同形字 / 反转…）。**诚实标注每种手法的局限**，leet 反解列出全部候选而非假装唯一。 |
| **PDF 签名信息查看器** | `pdf-signature-inspector` | **只读结构，不做密码学验证**（界面常驻声明）。做扎实的是 `/ByteRange` 算术 —— 能看出签名后是否被追加内容。 |
| **XML 转 JSON** | `xml-json` | 自写解析器，**拒绝 DTD 与外部实体**（XXE）。诚实说明映射**必然有损**（属性 vs 元素、混合内容顺序）。用 CPython `xml.etree` 作为独立参照。 |
| **TOML 转 JSON** | `toml-json` | 自写解析器与序列化器，含 TOML 专有的四种日期时间类型。用 **Python `tomllib`** 作为独立参照（Node 无内置 TOML）。 | 每行/逗号/分号/空格/制表符/JSON/SQL IN/Markdown/有序/HTML/YAML 任意互转，每种按该语言的转义规则处理。 | 65 条状态码，含标准英文名、中文说明、**出处（RFC + 小节）**与规范程度徽标。非标准码（418/449/509）写明身份而不混入标准表。 |

### 时间工具

| 工具 | ID | 说明 |
| --- | --- | --- |
| **时间戳转换** | `timestamp-converter` | Unix 时间戳与日期互转，按位数自动识别秒/毫秒，给出 ISO、UTC、多时区、周数与相对时间。 |
| **CRON 表达式** | `cron-builder` | 校验、中文语义描述、接下来 8 次执行时间预览，支持可视化构建与常用模板。 |
| **在线时钟** | `online-clock` | 大字时钟、世界时间换算（自动处理夏令时与半小时时区）、可在刷新后继续的倒计时。 |
| **秒表** | `stopwatch` | 毫秒级计时与分段计次：逐段用时列表、自动标出最快与最慢段，刷新后继续计时。**读数由时钟推导而非按定时器累加，长时间计时不漂移。** |
| **日期计算器** | `date-calculator` | 两日期相差、日期加减、年龄与工作日推算；日历月按截断处理，跨夏令时也是「加一天」。 |
| **定时表达式转换** | `cron-convert` | 四向：cron 转 systemd / Actions / crontab，systemd OnCalendar 反解回 cron（含月末倒数 `~N`），分析 Actions workflow 的定时计划，以及解析 crontab 文件内容。语义差异会明确标注或直接拒绝。 |

### 文本与格式

| 工具 | ID | 说明 |
| --- | --- | --- |
| **JSON 格式化** | `json-formatter` | 左侧粘贴 JSON，右侧渲染可展开/收起的语法高亮树；实时校验并给出行列位置。 |
| **YAML 转 JSON** | `yaml-json` | 双向转换，重复键报错、自定义标签不求值、别名炸弹有上限；可查看结构树与统计。 |
| **Base64 编解码** | `base64-converter` | 正确处理中文与 emoji，兼容 URL 安全字符集与无填充；解码可预览图片、下载二进制。 |
| **文本对比** | `text-diff` | 逐行对比，LCS 保证最小差异脚本；行内改动词级高亮，长文本自动折叠未变部分。 |
| **文本处理** | `text-toolkit` | 30 余种操作：大小写、行排序/去重/洗牌、空白与标点、全半角、转义、统计，支持撤销。 |
| **Markdown 预览** | `markdown-preview` | GFM 渲染与目录；**原始 HTML 不解析**，XSS 在结构上不可能发生。 |
| **罗马数字转换** | `roman-numeral` | 1–3999 双向转换与拆解展示。解码从严：`IIII`、`VX`、`IL` 一律拒绝并给出「它读作 N，标准写法是 X」的对照。 |
| **Lorem ipsum** | `lorem-ipsum` | 段落/句子/单词三种粒度，随机源可种子化（同种子输出逐字节相同）。中文占位用中文项目常见写法而非拉丁文对译。 |
| **IBAN 验证器** | `iban-validator` | mod-97 校验、国家识别、长度核对与 BBAN 按注册表字段拆分（89 国）。**不校验账号是否真实存在**——那需要银行接口。 |
| **命名风格转换** | `case-converter` | 13 种编程命名风格互转，附逐词切词展示（`getHTTPResponseCode` → `get/HTTP/Response/Code`）。切词边界与 ICU 字素簇对齐。 |
| **文本转 Unicode** | `text-to-unicode` | 六种转义风格双向转换。核心是**码位与 UTF-16 码元的区别**：`😀` 是一个码位、两个码元，孤立代理明确报错而不静默产出 `U+FFFD`。 |
| **文本转二进制** | `text-to-binary` | 按 **UTF-8 字节**转 8 位二进制（中文 3 字节、emoji 4 字节），反向宽松解析并拒绝非 0/1 输入。 |
| **北约音标字母表** | `nato-alphabet` | 文本 ↔ 读法双向。按 ICAO 官方拼写（`Alfa`、`Juliett`、`Xray`、`Whiskey`），数字把 ICAO 读法单列一栏并说明「读法不是另一套拼写」。无法映射的字符原样透传，**绝不编读音**。 |
| **HTML 实体转义** | `html-entities` | WHATWG 全表 2125 个命名实体 + 数字实体。处理了 `&` 必须先替换、只解一层、未知实体原样保留等经典陷阱。 |

### 哈希与加密

| 工具 | ID | 说明 |
| --- | --- | --- |
| **Basic 认证头** | `basic-auth` | 生成与解析 `Authorization: Basic`。**把 RFC 7617 的 charset 歧义写在界面上**——协议本身没定义 user-pass 的编码，charset 只在服务端 401 挑战里且只是建议，所以只能猜。 |
| **HMAC 生成器** | `hmac-generator` | HMAC-SHA-1/256/384/512，密钥支持文本或 hex，输出 hex 与 Base64。对照 RFC 4231 与 RFC 2202 官方向量。 |
| **MD5 生成器** | `md5-generator` | 自实现 MD5（Web Crypto 不提供），同时给出 SHA-1/SHA-256；支持文件哈希与结果比对。 |
| **AES 加解密** | `aes-crypto` | AES-256-GCM（含完整性校验），口令经 PBKDF2 派生；密文自带盐与 IV，支持文件。 |
| **密码生成器** | `password-generator` | 用 crypto 生成随机密码或单词短语（拒绝采样消除取模偏差），以熵值衡量强度，支持批量。 |

### 网络工具

| 工具 | ID | 说明 |
| --- | --- | --- |
| **URL 编解码** | `url-codec` | 区分「组件 / 整条链接 / 表单」三种转义方式，并解析查询参数与 URL 结构。 |
| **URL 参数编辑器** | `url-params` | 按行编辑查询参数：保留重复键与顺序、区分无值参数与空值，可原样输出原始转义字节（签名 URL 必需）。 |
| **IPv6 ULA 生成器** | `ipv6-ula` | RFC 4193 的 `fd00::/8` 全局 ID，支持纯随机与 §3.2.2 的 NTP+EUI-64 推导两种算法，输出符合 RFC 5952 的压缩形式。 |
| **随机端口生成** | `random-port` | 按 IANA 区间（动态/注册/全部）生成随机端口。**明确不做端口探测**——浏览器无法发起任意 TCP/UDP 连接，本机占用无从得知，界面提示用 `ss -lntu` 自行核实。 |
| **IPv4 子网计算器** | `ipv4-subnet` | CIDR 计算网络/广播/可用范围与地址类别，32 位二进制分色展示，支持子网划分。**`/31` 与 `/32` 按 RFC 3021 与主机路由处理**，通用公式在这两种前缀下是错的。 |
| **外网 IP 查询** | `ip-lookup` | 同时查询 IPv4 与 IPv6 公网地址并各自显示归属地、运营商、ASN、时区。**这是唯一会发起第三方网络请求的工具。** |
| **JWT 解码** | `jwt-decoder` | 查看 Header/Payload、时间声明与算法风险。**只解码不验签**，UI 明确说明解码成功不代表令牌可信。 |
| **HTTP 请求测试** | `http-client` | 发送 HTTP 请求并查看响应。受 CORS 限制：失败时列出可能原因与排查方法而不是猜测，并可生成对照 curl 命令。 |

### 图片与媒体

| 工具 | ID | 说明 |
| --- | --- | --- |
| **二维码生成器** | `qrcode-generator` | 可调纠错等级、尺寸、留白、配色，含 WiFi/名片模板，并提示低对比度与反色风险。 |
| **二维码识别** | `qrcode-reader` | 上传图片识别二维码，内容拆成带标签的字段（WiFi/名片/2FA/网址）；危险协议被拦下并给出钓鱼提示。 |
| **颜色格式转换** | `color-converter` | HEX/RGB/HSL/HSV/CMYK 互转，带透明度预览、WCAG 对比度评级与色阶。 |
| **图片压缩** | `image-tool` | 本地压缩与缩放（JPEG/WebP/PNG），体积对比，转 Base64 data URL 与嵌入代码。 |

> 除「外网 IP 查询」外，所有工具都在浏览器本地完成计算，不产生任何网络请求。
> 「AES 加解密」与「Markdown 预览」的实现里额外说明了各自的安全边界与取舍。

## 使用统计与收藏

- 打开工具时在 localStorage 累加一次计数（`wheat-tools:usage:v1`），
  「常用工具」按次数排序并显示次数；次数相同则按最近使用排序。
- 卡片右上角星标切换收藏，「我的收藏」实时同步（首页与侧边栏共用同一份状态）。
- 只保存工具 id 与次数，**不涉及任何输入内容**；读取时带校验与修复，
  数据损坏也不会导致页面崩溃。

## 项目结构

```
src/
├── app/                      # 外壳：主题、顶栏、总入口、工具页框架、路由
│   ├── App.tsx               # 由注册表生成路由表
│   ├── AppHeader.tsx         # Fluent 2 顶栏（返回 / 主题切换）
│   ├── HomeLauncher.tsx      # 总入口：搜索 + 工具卡片网格
│   ├── ToolPage.tsx          # 单个工具的页面外壳（标题、描述、返回）
│   └── theme.tsx             # 亮/暗主题 + localStorage 持久化
├── tools/
│   ├── types.ts              # ToolManifest / RegisteredTool 契约
│   ├── registry.ts           # 自动注册（import.meta.glob 扫描）
│   ├── json-formatter/       # 工具模块（独立目录）
│   └── uuid-generator/
└── styles/global.css         # 设计令牌驱动的全局样式
```

## 新增一个小工具

1. 新建目录 `src/tools/<my-tool>/`，目录名必须与 `manifest.id` 完全一致。
2. 新建 `src/tools/<my-tool>/index.ts`，导出 `manifest` 与默认组件：

```ts
import { WrenchRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { MyTool } from './MyTool';

export const manifest: ToolManifest = {
  id: 'my-tool',            // 必须等于目录名，路由为 #/tools/my-tool
  name: '我的工具',
  description: '一句话说明这个工具做什么。',
  tags: ['示例'],
  icon: WrenchRegular,
  version: '0.1.0',
};

export default MyTool;
```

3. 组件返回内容即可，页面外壳（顶栏、标题、返回入口）由 `ToolPage` 提供：

```tsx
export function MyTool() {
  return (
    <section className="wt-surface">
      <div className="wt-surface__header">…</div>
      <div className="wt-surface__body">…</div>
    </section>
  );
}
```

刷新页面后，工具卡片会自动出现在总入口，路由也会自动注册 —— **无需改动任何其它文件**。

`registry.ts` 在启动时会校验每个模块：目录名与 `id` 不符、缺少 `manifest`、缺少默认导出、
`id` 重复等都会在控制台给出明确警告，并在跳过该工具的同时保证其余工具照常工作。

## 样式约定

- 颜色、圆角、间距一律使用 Fluent 2 设计令牌（`var(--colorNeutralBackground1)` 等），
  不要写死色值，这样亮/暗主题自动跟随。
- 「面板」结构用现成的全局类：`.wt-surface` / `.wt-surface__header` / `.wt-surface__body`；
  两栏布局用 `.wt-split`；等宽文本区用 `.wt-code-area`、`.wt-code-scroll`。
- 组件私有样式用 Griffel 的 `makeStyles`；需要被测试或跨组件复用的稳定钩子才写进
  `global.css`（例如 `.wt-history__row`、`.wt-tool-card`）。

## 验证

所有检查都用 `node` 直接运行，不需要测试框架：

| 脚本 | 作用 |
| --- | --- |
| `node scripts/check-md5.mjs` | MD5 正确性：RFC 1321 官方向量 + UTF-8 + 填充边界（对照 `node:crypto`） |
| `node scripts/check-cron.mjs` | CRON 解析/调度：跨日、跨月、跨年、闰年 2/29、DOM/DOW 或语义、不可能表达式 |
| `node scripts/check-base64.mjs` | Base64：UTF-8 往返、URL 安全字符集、无填充、内容识别 |
| `node scripts/check-qrcode.mjs` | 二维码：用独立解码器（jsqr）反向解码生成的图片，断言载荷无损 |
| `node scripts/check-url.mjs` | URL 编解码：逐条对照平台 `encodeURIComponent` / `encodeURI`，查询串往返 |
| `node scripts/check-base.mjs` | 进制转换：BigInt 边界（2^64、2^128）、小数精度、2–36 进制全量往返 |
| `node scripts/check-color.mjs` | 颜色：各格式解析、HSL/HSV 全色相往返、WCAG 对比度 |
| `node scripts/check-clock.mjs` | 时钟：UTC 偏移符号、冬夏令时、半小时时区、ISO 周、时长解析 |
| `node scripts/check-regex.mjs` | 正则：**零宽匹配防死循环**（带超时守卫）、风险识别、替换、lastIndex 重置 |
| `node scripts/check-yaml.mjs` | YAML：重复键、自定义标签不求值、别名炸弹、原型污染、往返一致 |
| `node scripts/check-markdown.mjs` | Markdown：协议白名单、扫描源码断言无 `dangerouslySetInnerHTML` |
| `node scripts/check-aes.mjs` | AES：口令派生、GCM 篡改检测、随机盐/IV、信封解析（跑 Node WebCrypto） |
| `node scripts/check-jwt.mjs` | JWT：base64url 细节、时间声明、算法提醒；断言实现中不存在验签调用 |
| `node scripts/check-diff.mjs` | 文本对比：LCS 最小性、重建一致性、词级 diff 保真、折叠计数 |
| `node scripts/check-cheatsheet.mjs` | 正则速查表：**逐条真正编译并匹配示例**，标志必要性 |
| `node scripts/check-jsontype.mjs` | JSON 转类型：**生成的 TS 回灌 TypeScript 编译器**校验语法与引用 |
| `node scripts/check-units.mjs` | 单位换算：对照 NIST 定义值，全类别两两往返自洽 |
| `node scripts/check-hex.mjs` | HEX：行构建、特征表自洽、熵、字符串提取、多宽度解读 |
| `node scripts/check-cronconvert.mjs` | 定时转换：并集/交集差异标注、步长写法、Actions 5 段限制 |
| `node scripts/check-image.mjs` | 图片压缩：等比缩放、Base64 体积估算与真实编码交叉核对 |
| `node scripts/check-password.mjs` | 密码生成：**两万次抽样断言字符分布均匀**（取模偏差检测） |
| `node scripts/check-http.mjs` | HTTP：URL 构建、请求头解析与禁止头、请求体校验、**错误解释不武断归因**、curl 生成 |
| `node scripts/check-urlparams.mjs` | URL 参数：重复键与顺序保留、无值/空值区分、原始字节保真、参数对比 |
| `node scripts/check-actions.mjs` | Actions workflow：UTC 与本地对照、5 段限制、5 分钟下限、60 天停用提示 |
| `node scripts/check-qrread.mjs` | 二维码识别：**用 qrcode 生成、jsQR 解码的真实往返**，以及各类载荷的分类与安全提示 |
| `node scripts/check-schema.mjs` | JSON Schema：**用 ajv 拿样本回灌**，样本必须通过、破坏后必须被拒；并实测 format 的注解语义 |
| `node scripts/check-date.mjs` | 日期：月末截断、闰年、夏令时、**difference 是 addMonths 的精确逆运算** |
| `node scripts/check-crontab.mjs` | crontab：环境变量作用域、`%` 截断、cron.d 用户字段、`@reboot` 语义、方言歧义 |
| `node scripts/check-filter.mjs` | 列表过滤：大小写、多词「与」、按字段匹配不跨字段误命中 |
| `node scripts/check-a11y.mjs` | **可访问性审计**：用浏览器 AX 树判断可访问名，并真实按键走一遍 Tab 顺序 |
| `node scripts/check-sidebar.mjs` | 侧边栏开合：用**真实鼠标事件**验证宽屏收起与窄屏抽屉，含状态记忆 |
| `node scripts/check-usage.mjs` | 常用工具排序与上限（按打开次数，上限 10） |
| `node scripts/check-stopwatch.mjs` | 秒表：格式化、暂停/继续、计次分段、随机操作序列的不变量 |
| `node scripts/check-stopwatch-ui.mjs` | 秒表的浏览器行为：显示真的在走、计次渲染、快捷键、刷新后续走 |
| `node scripts/check-ulid-generator.mjs` | ULID：Crockford 字母表、单调递增、溢出抛错、独立 BigInt 参照实现 |
| `node scripts/check-hmac-generator.mjs` | HMAC：**RFC 4231 与 RFC 2202 官方向量** + node:crypto 交叉验证 |
| `node scripts/check-roman-numeral.mjs` | 罗马数字：1..3999 穷举往返 + 数位表编码器 + 独立正则解码器 |
| `node scripts/check-iban-validator.mjs` | IBAN：**SWIFT 注册表官方示例** + 两份独立 mod-97 实现 + 定义性质 |
| `node scripts/check-lorem-ipsum.mjs` | Lorem ipsum：经典开头逐字、数量语义、同种子确定性（含反证） |
| `node scripts/check-chmod-calculator.mjs` | Chmod：0..7777 穷举 + **CPython stat.filemode** + **真实 GNU coreutils** 三重比对 |
| `node scripts/check-http-status-codes.mjs` | HTTP 状态码：**IANA 注册表** + Node 的 `http.STATUS_CODES` 两张表互相印证 |
| `node scripts/check-ipv4-subnet.mjs` | IPv4 子网：独立位运算 oracle（105 万项比对）+ `/31`、`/32` 陷阱专门断言 |
| `node scripts/check-case-converter.mjs` | 命名风格：独立分词实现 + **ICU `Intl.Segmenter`** + 仓库里 3000+ 真实标识符 |
| `node scripts/check-text-to-unicode.mjs` | Unicode 转义：自写 UTF-8 编码器在**全部 111 万个合法码位**上与 `TextEncoder` 一致 |
| `node scripts/check-text-to-binary.mjs` | 文本转二进制：`TextEncoder` 与 `TextDecoder({fatal:true})` 双向比对 |
| `node scripts/check-nato-alphabet.mjs` | 北约字母表：ICAO 官方词表逐条比对 |
| `node scripts/check-html-entities.mjs` | HTML 实体：**Chromium 自身的 HTML 解析器**逐条比对 2125 个命名实体 |
| `node scripts/check-basic-auth.mjs` | Basic 认证：**RFC 7617 官方示例** + Base64 四路互验 |
| `node scripts/check-random-port.mjs` | 随机端口：RFC 6335 区间表与全部 65536 个取值逐一比对 |
| `node scripts/check-ipv6-ula.mjs` | IPv6 ULA：**RFC 5952** 规则 + Node 的 WHATWG URL 原生 IPv6 序列化 |
| `node scripts/check-math-evaluator.mjs` | 数学求值：**node:vm 的 eval** 与自写调度场算法两套独立求值器交叉验证 |
| `node scripts/check-percentage-calculator.mjs` | 百分比：独立朴素算式 + 舍入的反证（`Math.round(1.005*100)` 是错的） |
| `node scripts/check-eta-calculator.mjs` | ETA：手算已知值 + `Date` 原生 ISO 输出 + 源码级断言不读系统时钟 |
| `node scripts/check-json-csv.mjs` | JSON/CSV：**CPython csv 模块逐字节比对** + RFC 4180 |
| `node scripts/check-list-converter.mjs` | 列表转换：`JSON.parse` + `yaml` 库 + **CPython sqlite3 / html.parser** |
| `node scripts/check-json-diff.mjs` | JSON 对比：往返性质（打补丁后与右侧深度相等）+ 自反性 + 对称性 + RFC 6901 |
| `node scripts/check-safelink-decoder.mjs` | SafeLink：构造式往返回环 + 浏览器 `URLSearchParams` 作为独立参照 |
| `node scripts/check-git-cheatsheet.mjs` | Git 速查：危险等级与实际语义一致性（丢数据的必须标危险、只读必须标安全） |
| `node scripts/check-otp-generator.mjs` | OTP：**RFC 4226 附录 D 与 RFC 6238 附录 B 全量向量**（含中间值）+ `node:crypto` |
| `node scripts/check-password-strength.mjs` | 密码强度：SecLists 弱口令榜排名 + **XKCD #936 的 ~28 位** |
| `node scripts/check-token-generator.mjs` | Token：**RFC 4648 向量** + `Buffer` 交叉验证 + 卡方检验（并用有偏源验证检验有效） |
| `node scripts/check-rsa-key-pair.mjs` | RSA：`node:crypto` 解析 PEM 并做**真实签名/加解密往返** + JWK 逐字段比对 |
| `node scripts/check-phone-parser.mjs` | 电话号码：Ofcom 影视保留段 + ITU-T E.164 + 122 个号码四种形式的往返 |
| `node scripts/check-string-obfuscator.mjs` | 混淆：**NFKC 原生交叉验证** + 7 种变换全部 128 个子集的往返回环 |
| `node scripts/check-pdf-signature-inspector.mjs` | PDF：手工构造的合法 PDF + **`pdfinfo` 交叉验证** + `/ByteRange` 手算算术 |
| `node scripts/check-xml-json.mjs` | XML：**CPython `xml.etree`** 逐节点比对 + 生成的 XML 交它解析（良构性证明） |
| `node scripts/check-toml-json.mjs` | TOML：**CPython `tomllib`** 逐值比对 + 生成的 TOML 交它解析 |

一次性运行全部逻辑检查（CI 与本地通用）：

```bash
pnpm verify       # 逻辑检查（32 项，1600+ 断言）
pnpm verify:all   # 连同需要 Chromium 的浏览器检查
```
| `node scripts/check-oncalendar.mjs` | OnCalendar 反解：**与 systemd-analyze 的实际触发时刻逐次比对**（见下） |
| `node scripts/check-comments.mjs` | 检测块注释是否被提前闭合（见下） |
| `node scripts/check-registry.mjs` | 每个工具目录都已注册：id 与目录名一致、含分类与默认导出（见下） |
| `node scripts/check-tools.mjs` | 冒烟测试：在真实浏览器里逐个打开每个工具，断言渲染成功且无报错 |
| `node scripts/verify-ui.mjs` | 深度交互：搜索、主题切换、JSON 树展开/收起/报错定位、UUID 生成与历史 |

```bash
pnpm build
for s in md5 cron base64 qrcode url base color clock regex yaml markdown aes; do
  node "scripts/check-$s.mjs" || exit 1
done
node scripts/check-tools.mjs && node scripts/verify-ui.mjs
node scripts/check-comments.mjs && node scripts/check-registry.mjs
node scripts/check-a11y.mjs
```

> 这些检查刻意验证「正确性」而不只是「跑通」：MD5 用 RFC 1321 官方向量、
> URL 编码对照平台实现、二维码用独立解码器反向解码、正则用超时守卫断言
> 零宽匹配一定会返回、生成的 TypeScript 回灌编译器校验。多个真实缺陷就是
> 这样被抓出来的——例如 `readableTextColor` 的三元分支写反、
> UTC 偏移符号整体颠倒、YAML 别名炸弹在 `toJS()` 阶段抛异常导致转换中断、
> 协议相对地址被误判为非法协议、JSON 转类型中根接口被命名为 `Root2`。
>
> `check-schema.mjs` 与 `check-qrread.mjs` 也用「真实工具」而非桩验证：
> Schema 会用 ajv 拿原始样本回灌（样本必须通过，删掉必填字段必须被拒），
> 二维码会用 qrcode 生成、pngjs 转像素、再由工具自己的解码路径读回。
> 两者都立刻暴露了问题——Schema 的 required 传播、二维码在 400px 下
> 解不出密集码（实测 600px 才够，因此把解码降采样上限从 1600 放宽到 3000）。
>
> `check-oncalendar.mjs` 用了权威实现做交叉验证：本机有
> `systemd-analyze`，所以不是比对字符串，而是把 17 个表达式的
> **真实触发时刻**逐次比对（systemd 报的时刻 vs 转成 cron 后求值器算出的时刻）。
> 这条测试立刻抓出一个隐蔽 bug：cron 的 `a/b` 含义是「从 a 起每 b 直到字段上限」，
> 我却把 `Mon..Fri` 输出成 `1/1` —— 那是周一到周日，悄悄放宽了计划。
> 现在只在步进确实到达字段上限时才用 `a/b`，否则用区间或列举。
> 同一测试还确认了 `HH:MM/step` 只在该小时内重复，以及
> `Mon..Fri *-*-01` 确实是交集语义（systemd 下次触发在 12-01 周二），
> 因此该表达式被明确拒绝而不是给出一个看起来对的错误答案。
>
> `check-sidebar.mjs` 存在的直接原因是一个真实 bug：开合按钮本该在宽屏隐藏，
> 但 Fluent 运行时注入的 Button 样式在 `global.css` 之后追加、同优先级下胜出，
> 于是 `display: none` 静默失效——按钮在桌面端一直可见，点击只改了一个该宽度下
> 没有任何规则响应的状态。所以它用**真实鼠标事件**而不是程序化 `.click()`：
> 后者绕过命中测试，在坏掉的版本上照样「通过」。
>
> `check-a11y.mjs` 做了两件别的检查做不到的事。一是**可访问名取自浏览器
> 的 AX 树**而不是手写推断——手写版把 Fluent 的 checkbox 全判成「无名字」，
> 因为 `<input>` 没有文本内容，而浏览器能从关联的 `<label>` 算出名字；
> 二是**真实按键走一遍 Tab 顺序**，而不是只看标记。
> 它还查出了两处我自己实现里的假阴性：Fluent 的焦点环画在父元素上
> （Dropdown 按钮自身 `outline: none`、父元素 `solid 2px`），
> 以及 Markdown 预览把文档里的 `#` 渲染成第二个 `h1` 与页面标题冲突。
> 另外它带有「产物比源码旧就报错」的守卫——我自己就先踩了一次：
> 改完源码忘了重新构建，审计的是上一版产物，结论同时包含已修复和未修复的问题。
>
> `check-registry.mjs` 补上的是验证盲区：注册表靠 glob 查找
> `./<目录>/index.ts`，因此缺少该文件的工具目录会在应用里彻底消失，
> 但它仍能通过类型检查，甚至能通过逐工具冒烟测试（那只遍历「已注册」的工具）。
> `text-toolkit` 就这样一度成为死代码，用户永远打不开。
>
> `check-comments.mjs` 值得单独说明：在注释里写下 cron 的步长写法会直接
> 终止该注释，随后是一连串指向无关行的报错，极难定位。这个坑先后踩过两次，
> 于是改成机械检测——用 TypeScript 自带 scanner 分词（字符串、模板字符串、
> 正则都不会误判），覆盖「跨行注释末行后仍跟代码」与「同一行残留第二个
> 结束标记」两种特征，并以注入 bug 的对照实验验证过。

> 浏览器相关的脚本通过 `file://` 加载内联后的构建产物，因为本环境的浏览器无法完成
> http 导航。应用本身生产环境使用 HashRouter（可部署到任意静态托管）；
> `VITE_ROUTER=memory` 会换成内存路由，仅在受限环境下验证时使用。

## 部署

`pnpm build` 产出纯静态 `dist/`，可直接托管在任意静态服务器（Nginx、对象存储、
GitHub Pages 等）。由于使用 hash 路由，**无需任何服务端回退规则**。

### GitHub Pages（已配置自动部署）

仓库自带 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)：
推送到 `main` 后自动构建并发布，也可在 Actions 页面手动触发（`workflow_dispatch`）。

**首次启用只需在仓库里设置一次**：Settings → Pages → Build and deployment →
Source 选择 **GitHub Actions**。（不需要选分支，也不会有 `gh-pages` 分支。）

#### 两个地址可同时访问

构建使用**相对资源路径**（`base: './'`，见 [vite.config.ts](vite.config.ts)），
因此同一份 `dist/` 在任何路径深度都能工作，两个地址同时可用：

| 地址 | 路径 | 说明 |
| --- | --- | --- |
| `https://wheat.chat/` | 根路径 | 需完成下面的自定义域名配置 |
| `https://zpc1995.github.io/wheat-tools/` | 子路径 | 开箱即用，无需额外配置 |

用绝对 `base: '/'` 会让子路径站点白屏（所有资源请求 404），这也是相对路径的原因。

#### 自定义域名 `wheat.chat`

`public/CNAME` 里的 `wheat.chat` 会被复制到构建产物根目录。

##### 第 0 步（必做，否则后面全部无效）

**先在仓库 Settings → Pages → Custom domain 填入 `wheat.chat` 并保存。**

这一步不只是"登记"：GitHub Pages 依据请求的 `Host` 决定提供哪个站点。
未登记时，即使把请求正确反代到 GitHub 的 IP，也会返回 **404**，而且
HTTPS 证书只有 `*.github.io`（不含 `wheat.chat`），浏览器会直接报证书错误。
（已实测：`Host: wheat.chat` 打到 `185.199.108.153` → `HTTP/2 404`，`server: GitHub.com`。）

##### 方式一：把构建产物放到自己服务器上（国内访问推荐）

> ⚠️ **如果你在意国内访问，请优先看这一节。** GitHub Pages 在中国大陆的连通性并不可靠
> （DNS 污染、IP 与 SNI 阻断、间歇性 443 超时都很常见）。无论是把 DNS 指向 GitHub，
> 还是反向代理到 GitHub Pages，都**无法解决**这个问题——请求依然要出境。
> 只有把静态文件放在自己的服务器上，流量才不出境。

完整配置见
[`deploy/nginx-wheat-chat-static.conf`](deploy/nginx-wheat-chat-static.conf)。流程：

```bash
# 1. 本地构建
pnpm build

# 2. 上传到自己的服务器（任一方式）
rsync -av --delete dist/ <部署用户>@<服务器地址>:<网站根目录>/
# 或用 scp / 对象存储 / 宝塔面板等

# 3. 服务器上用 nginx 直接托管（配置见上面的文件）
```

要点：

- **根目录指向 `dist/` 内容**（`root /path/to/site;`），不是指向上级目录。
- `/assets/` 可长期强缓存（文件名带内容哈希），`index.html` 必须不缓存。
- 静态托管建议开启 gzip（GitHub Pages 是自动压缩的，自建服务器默认没开）。
- 这样做的收益：**国内访问稳定 + 两个地址同时可用、互为备份**。
  GitHub 仍然负责版本管理（以及 Pages 上的那个备份站点），只是网站内容由你手动上传。

> 如果以后想要「推送后自动同步到服务器」，可以加一条 GitHub Actions 流水线做 `rsync`，
> 需要额外配置部署专用密钥（`SSH_PRIVATE_KEY` 等 secrets）。当前仓库**未包含**该流水线。

##### 方式二：直接改 DNS 指向 GitHub（最省事，但国内访问不稳）

**前提**：`wheat.chat` 当前指向一台已运行 nginx 的服务器；若那台机器仍在提供别的服务，
请先确认可以接管，或改走方式一保留这台机器。

在 DNS 服务商处为 `wheat.chat` 配置（apex 记录**必须**用 A/AAAA 或 ALIAS，不能用 CNAME）：

| 类型 | 主机 | 值 |
| --- | --- | --- |
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |
| `AAAA`（可选） | `@` | `2606:50c0:8000::153` |
| `AAAA`（可选） | `@` | `2606:50c0:8001::153` |
| `AAAA`（可选） | `@` | `2606:50c0:8002::153` |
| `AAAA`（可选） | `@` | `2606:50c0:8003::153` |
| `CNAME`（可选） | `www` | `zpc1995.github.io` |

> ⚠️ **顺序很重要**：先填自定义域名（第 0 步），再动 DNS。反过来的话，
> 别人可能抢注你的子域。
>
> ⚠️ **国内访问提醒**：这条路线把域名指向 GitHub 的服务器，内容仍然从境外加载，
> 国内访问的稳定性问题**不会因此改善**。若在意国内体验，请用方式一。
>
> 另外注意：DNS 服务商常会给 apex 域名预设一条 A 记录（你的域名现在就有），
> 需要先删掉。DNS 生效最长 24 小时；GitHub 签发 HTTPS 证书可能再需要几分钟到几小时。

###### 变体：反向代理到 GitHub Pages（不推荐）

如果出于某种原因必须保留 GitHub Pages 作为内容源，可以反代过去：

完整配置见
[`deploy/nginx-wheat-chat.conf`](deploy/nginx-wheat-chat.conf)，核心只有几行：

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name wheat.chat;

    ssl_certificate     /etc/nginx/ssl/wheat.chat.pem;
    ssl_certificate_key /etc/nginx/ssl/wheat.chat.key;

    # 上游证书是 *.github.io，所以 SNI 用 github.io
    proxy_ssl_server_name on;
    proxy_ssl_name github.io;

    # 关键：Host 必须是 wheat.chat。用默认的 $proxy_host 会拿到 GitHub 首页或 404
    proxy_set_header Host wheat.chat;

    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_redirect off;

    # 变量 + resolver 才会在运行时解析（upstream 块是启动时解析）
    set $github_upstream "185.199.108.153";
    resolver 223.5.5.5 valid=300s;

    location / {
        proxy_pass https://$github_upstream/;
    }

    location /assets/ {
        proxy_pass https://$github_upstream;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

几个容易踩的点：

- **不要写 `proxy_pass https://wheat.chat`** —— nginx 解析 `wheat.chat` 会得到自己，
  造成无限循环。要用 SNI 直连 GitHub 的 IP（即 `proxy_ssl_name github.io`）。
- **`proxy_set_header Host wheat.chat` 不能省**。GitHub Pages 靠 Host 判断站点。
- **变量形式的 `proxy_pass` 结尾必须带 `/`**（`https://$github_upstream/`），
  否则路径拼接会出错；而 `location /assets/` 里反而**不能**带结尾斜杠，
  否则会丢掉 `/assets/` 前缀。
- 证书需要你自己签（`certbot --webroot -d wheat.chat`，配置里已预留
  `/.well-known/acme-challenge/`），或用阿里云免费证书；不能直接复用 GitHub 的证书。
- 反代会让所有流量经过你的服务器：机器挂掉站点就不可用，也无法享受 GitHub CDN 的
  就近加速。**如果只是想把域名指过来，方式一明显更省事。**

> 实测确认：`ipwho.is` 对任意 Origin 都返回 `Access-Control-Allow-Origin: *`，
> 所以换成 `https://wheat.chat` 后「外网 IP 查询」工具照常工作。

#### 如果去掉自定义域名

站点会回落到 `https://<用户名>.github.io/<仓库名>/`，那是**子路径**，根路径 base 会导致
JS/CSS 全部 404 白屏。此时把工作流里的 `VITE_BASE` 改成
`${{ steps.pages.outputs.base_path || format('/{0}/', github.event.repository.name) }}`
并删掉 `public/CNAME` 即可。

### 部署到其它平台

Vercel / Netlify / Cloudflare Pages 等平台的默认设置即可直接使用：
构建命令 `pnpm build`，输出目录 `dist`。这类平台从根路径提供服务，无需设置 `VITE_BASE`。
