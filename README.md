# wheat tools · 麦工具

由 **DeepSeek Harness** 生成的自用小工具集，共 89 个工具。
除「外网 IP 查询」需要请求第三方接口外，其余全部在浏览器本地运行，不上传任何数据。

**演示地址**：https://zpc1995.github.io/wheat-tools/

---

## 工具

### 编程工具（24）

- **百分比计算器** · `percentage-calculator` — 按问题类型分类的百分比入口：X 的 Y%、占比、变化率、增减与反推原值、打折互算、百分比差异与百分点…
- **单位换算** · `unit-converter` — 长度、重量、温度、面积、体积、速度、存储、时间、压力、能量互转
- **键盘事件信息** · `keycode-info` — 按下任意键，查看 event.key、event.code、已废弃的 keyCode / which…
- **进制转换** · `number-base` — 2–36 进制互转，整数用 BigInt 精确计算不丢精度，支持小数与常用进制对照
- **设备信息** · `device-info` — 查看当前浏览器与设备信息：屏幕与窗口尺寸、像素比、时区与语言、CPU 核心数、内存档位、触摸支持、显示偏好…
- **数学表达式计算器** · `math-evaluator` — 实时求值数学表达式：自带词法分析与语法分析，绝不使用 eval
- **预计完成时间** · `eta-calculator` — 按当前进度或「剩余项目数 × 每项耗时」估算剩余时间与完成时刻，自动选择秒/分/时/天显示…
- **正则测试** · `regex-tester` — 实时匹配高亮、捕获组与命名分组查看、替换预览，并提示灾难性回溯风险
- **正则速查表** · `regex-cheatsheet` — 字符类、锚点、量词、分组、标志与常用模式的速查
- **Chmod 计算器** · `chmod-calculator` — 勾选用户/组/其他的读、写、执行位，实时得出八进制与 rwx 符号权限
- **Docker Run 转 Compose** · `docker-run-compose` — 把 docker run 命令改写成 docker-compose.yml
- **Git 速查表** · `git-cheatsheet` — 按场景（日常提交、分支、撤销与回退、查看历史、暂存、远程协作、排查问题）组织的 Git 命令速查…
- **HEX 查看器** · `hex-viewer` — 查看任意文件的十六进制与文本、按文件头识别真实类型、统计熵与可打印字符、提取内嵌可读字符串
- **HTTP 状态码速查** · `http-status-codes` — 按类别与关键词查 HTTP 状态码：码值、标准英文名、中文说明与出处（RFC 9110 等）…
- **JSON ↔ CSV 转换** · `json-csv` — JSON 数组与 CSV 互转：键取并集、缺失值留空，可按点号路径扁平化（user.name）或把嵌套结构写成…
- **JSON 结构化对比** · `json-diff` — 比较两份 JSON 的结构差异，按 JSON Pointer 列出新增、删除、改值的键
- **JSON 转类型** · `json-to-type` — 从一份或多份 JSON 样本生成 TypeScript 接口或 Go 结构体
- **JSON Schema 生成** · `json-schema` — 从一份或多份 JSON 样本生成 draft 2020-12 Schema
- **PDF 签名信息查看器** · `pdf-signature-inspector` — 只读查看 PDF 里的签名结构：签名者、时间、原因、位置、子过滤器与 /ByteRange 覆盖范围…
- **SQL 格式化** · `sql-formatter` — 把 SQL 排成关键字大写、子句换行的可读形式，或压缩成一行
- **TOML ↔ YAML** · `toml-yaml` — TOML 与 YAML 双向转换，复用 TOML 解析器与 yaml 依赖
- **ULID 生成器** · `ulid-generator` — 按 ULID 规范生成 26 位 Crockford Base32 标识符：前 10 位是毫秒时间戳、后 16…
- **UUID 生成器** · `uuid-generator` — 进入即自动生成一个 v4 UUID，可一键重新生成，并保留本次进入后的全部历史记录
- **XML 格式化** · `xml-formatter` — XML 的缩进格式化、压缩与语法校验：缩进宽度、属性换行、注释保留可选，校验会给出出错的行列位置与代码片段

### 时间工具（6）

- **定时表达式转换** · `cron-convert` — cron 转 systemd timer / GitHub Actions / crontab，并给出中文说明
- **秒表** · `stopwatch` — 毫秒级计时与分段计次：逐段用时列表、自动标出最快与最慢段，刷新页面后继续计时
- **日期计算器** · `date-calculator` — 两日期相差、日期加减、年龄与工作日推算
- **时间戳转换** · `timestamp-converter` — Unix 时间戳与日期互转，自动识别秒/毫秒，并给出 ISO、UTC、多时区与相对时间
- **在线时钟** · `online-clock` — 大字时钟与世界时间换算（自动处理夏令时与半小时时区），附可在刷新后继续的倒计时
- **CRON 表达式** · `cron-builder` — 校验、生成并预览 CRON 表达式：给出中文语义说明与接下来 8 次执行时间，支持可视化构建与常用模板

### 文本与格式（26）

- **北约音标字母表** · `nato-alphabet` — 把文本逐字读成 ICAO / NATO 音标字母（ABC → Alfa Bravo Charlie）…
- **电话号码解析** · `phone-parser` — 解析并格式化电话号码：识别国家码、国内有效号码、长途冠码与分机号，输出 E.164、国际格式、国内格式、tel…
- **列表格式转换** · `list-converter` — 在多种列表写法之间互转：每行一项、逗号/分号/空格/制表符分隔、JSON 数组、SQL IN 列表…
- **罗马数字转换器** · `roman-numeral` — 阿拉伯数字与标准罗马数字双向转换，逐位展示拆解过程（1994 = M + CM + XC + IV）
- **命名风格转换** · `case-converter` — 在 camelCase、PascalCase、snake_case、SCREAMING_SNAKE_CASE…
- **数字转文字** · `number-to-words` — 把数字写成文字：英文基数词与序数词（含负数、小数、到 quintillion）…
- **所见即所得 HTML 编辑器** · `html-wysiwyg` — 左侧富文本编辑、右侧实时查看生成的 HTML 源码：粗体、斜体、下划线、删除线、标题、列表、引用、代码与链接
- **文本 ↔ 二进制** · `text-to-binary` — 把文本按 UTF-8 字节转成 8 位二进制，并把二进制还原成文本，同时给出十六进制与十进制字节
- **文本 ↔ Unicode 转义** · `text-to-unicode` — 文本与 Unicode 转义互转：\\uXXXX（JS/JSON）、\\u{XXXXX}（ES6）…
- **文本处理** · `text-toolkit` — 大小写、行排序/去重/洗牌、空白与标点清理、全半角转换、转义与统计等 30 余种操作，支持撤销
- **文本对比** · `text-diff` — 逐行对比两段文本，LCS 算法保证最小差异脚本
- **文本统计** · `text-statistics` — 码点数、字素簇数、UTF-16 码元数、UTF-8 字节数四个口径分别统计，另有行/段/句/词数、阅读时间估算…
- **邮箱规范化与校验** · `email-normalizer` — 按写明的规则校验邮箱并给出规范化形式：域名统一小写、IDN 域名转 Punycode…
- **字符串混淆器** · `string-obfuscator` — 在字符层面混淆文本并可逆地还原：leet 替换、零宽字符插入、同形字替换、大小写交替、反转、全半角转换…
- **ASCII 艺术字** · `ascii-art-text` — 把文本转成 FIGlet 风格的 ASCII 艺术字
- **Base64 编解码** · `base64-converter` — 文本与 Base64 互转，正确处理中文与 emoji，支持 URL 安全字符集、无填充输入，并可预览图片…
- **Emoji 选择器** · `emoji-picker` — 一个分好类的精选 emoji 表，支持中英文关键词搜索，点击即可复制
- **HTML 实体转义** · `html-entities` — 把 < > & " \
- **IBAN 验证器** · `iban-validator` — 按 ISO 13616 校验 IBAN：检查国家代码、各国长度规则与 mod-97 校验位，并把 BBAN…
- **JSON 格式化** · `json-formatter` — 粘贴 JSON 字符串，即时校验并格式化为可展开、可收起的树形结构
- **Lorem ipsum 生成器** · `lorem-ipsum` — 按段落 / 句子 / 单词生成占位文本，可选用经典开头、中文占位文字与 HTML 标签包裹，一键复制
- **Markdown 预览** · `markdown-preview` — 实时渲染 Markdown（GFM 表格、任务列表、代码块），带目录导航
- **Markdown 转 HTML** · `markdown-html` — 把 Markdown 编译成可复制的 HTML 源码：可选完整文档或片段、Tailwind 类名或内嵌样式…
- **TOML ↔ JSON** · `toml-json` — TOML 与 JSON 双向转换，解析器与序列化器自写：表、数组表、内联表、四种日期时间、多行字符串…
- **XML ↔ JSON** · `xml-json` — XML 与 JSON 双向转换，自写解析器：属性、#text、重复子元素成数组、命名空间、CDATA…
- **YAML 转 JSON** · `yaml-json` — YAML 与 JSON 双向转换，重复键报错、自定义标签不求值、别名炸弹有上限，并可查看结构与统计

### 哈希与加密（9）

- **哈希计算** · `md5-generator` — 一次算出 MD5、SHA-1、SHA-256、SHA-384、SHA-512 五种摘要
- **密码强度分析仪** · `password-strength` — 分析你输入的密码：按字符集算熵，再按模式（弱口令表、单词、键盘序、序列、重复、日期、上下文词）重新估算有效熵…
- **密码生成器** · `password-generator` — 用 crypto 生成随机密码或单词短语（拒绝采样消除取模偏差），以熵值衡量强度，支持批量生成
- **AES 加解密** · `aes-crypto` — AES-256 对称加解密（GCM 含完整性校验），口令经 PBKDF2 派生，密文自带盐与 IV…
- **BIP39 助记词生成器** · `bip39-generator` — 生成与解析 BIP-39 英文助记词：128/160/192/224/256 位熵对应…
- **HMAC 生成器** · `hmac-generator` — 用密钥对消息计算 HMAC 摘要（SHA-256 / SHA-384 / SHA-512 / SHA-1）…
- **OTP 验证码生成器** · `otp-generator` — 按 Base32 密钥生成 TOTP（RFC 6238）与 HOTP（RFC 4226）动态验证码…
- **RSA 密钥对生成器** · `rsa-key-pair` — 用浏览器 Web Crypto 生成 RSA 密钥对：用途可选 RSASSA-PKCS1-v1_5 /…
- **Token 生成器** · `token-generator` — 用 crypto.getRandomValues 生成随机 token（hex / Base64 /…

### 网络工具（17）

- **随机端口生成器** · `random-port` — 按范围批量生成随机端口号：默认 IANA 动态端口 49152–65535，也可选注册端口…
- **外网 IP 查询** · `ip-lookup` — 同时查询 IPv4 与 IPv6 公网地址并各自显示归属地、运营商、ASN 与地区，另可查询任意指定 IP
- **Basic 认证头** · `basic-auth` — 按 RFC 7617 生成 Authorization: Basic 头…
- **HTTP 请求测试** · `http-client` — 在浏览器里发送 HTTP 请求并查看响应
- **IPv4 地址转换器** · `ipv4-converter` — 同一个 IPv4 地址的各种表示形式互转：点分十进制、32 位十进制整数、十六进制、二进制、八进制…
- **IPv4 范围扩展器** · `ipv4-range-expander` — 把起止 IP 范围展开成覆盖它所需的最小 CIDR 集合（贪心取最大对齐块，结果就是数学上的最小集合）…
- **IPv4 子网计算器** · `ipv4-subnet` — 把 CIDR 换算成网络地址、广播地址、掩码与可用主机范围，并用 32 位二进制直观区分网络位与主机位
- **IPv6 ULA 地址生成器** · `ipv6-ula` — 按 RFC 4193 生成 fd00::/8 的本地唯一地址（ULA）前缀：40 位全局 ID…
- **JWT 解码** · `jwt-decoder` — 查看 JWT 的 Header 与 Payload、时间声明与算法风险提示
- **MAC 地址生成器** · `mac-generator` — 生成 48 位 MAC 地址：默认置本地管理位（U/L = 1），因此不会冒用 IEEE 分配给真实厂商的…
- **MIME 类型速查** · `mime-types` — 扩展名与 MIME 类型双向查询：输入 .docx 查类型，输入 application/json 查扩展名
- **Open Graph 社交卡片标签生成器** · `og-meta-generator` — 填写标题、描述、URL 与图片，生成完整的 Open Graph、Twitter Card 与基础 SEO…
- **SafeLink 解码器** · `safelink-decoder` — 还原 Microsoft Defender for Office 365 的 SafeLink 包装链接…
- **URL 编解码** · `url-codec` — URL 编码与解码，区分「组件 / 整条链接 / 表单」三种转义方式，并解析查询参数与 URL 结构
- **URL 参数编辑器** · `url-params` — 按行编辑查询参数：保留重复键与顺序、区分无值参数与空值，可原样输出原始转义字节（带签名 URL 必需）
- **URL 分析器** · `url-parser` — 把一条 URL 逐字段拆开：协议、认证信息（默认打码）、主机、端口、路径、查询、片段，各自按正确的规则解码…
- **User Agent 分析器** · `user-agent-parser` — 解析 UA 字符串，提取浏览器与版本、渲染引擎、操作系统与版本…

### 图片与媒体（7）

- **二维码生成器** · `qrcode-generator` — 把网址、文本、WiFi、名片等生成二维码，可调纠错等级、尺寸、留白与配色，并提示对比度与反色风险
- **二维码识别** · `qrcode-reader` — 上传图片识别二维码，并把内容拆成带标签的字段（WiFi/名片/2FA/网址）
- **摄像头录制** · `camera-recorder` — 用 getUserMedia 与 MediaRecorder 录制摄像头画面：可选择摄像头与麦克风、分辨率…
- **图片压缩** · `image-tool` — 本地压缩与缩放图片（JPEG/WebP/PNG），显示体积对比，并可转为 Base64 data URL…
- **颜色格式转换** · `color-converter` — HEX / RGB / HSL / HSV / CMYK 互转，带透明度预览、WCAG 对比度评级…
- **证件照制作** · `id-photo` — 在浏览器本地抠出人像、换成证件照背景，按一寸、二寸等常用规格裁切，可导出单张或 6 寸相纸拼版。可选本地 AI 模型（MODNet，一次性下载），复杂背景与头发明显更准
- **SVG 占位图生成器** · `svg-placeholder` — 生成尺寸精确的 SVG 占位图：宽高、背景色、文字、字号、圆角、边框，可选网格或斜纹底纹与尺寸标注

---

## 部署（nginx）

纯静态站点，没有后端、没有数据库、不需要 Service Worker。

```bash
pnpm install
pnpm build              # 产物在 dist/

# 拷到服务器
sudo mkdir -p /var/www/wheat-tools
sudo cp -r dist/* /var/www/wheat-tools/
```

```nginx
server {
    listen 80;
    server_name your.domain.com;

    root /var/www/wheat-tools;
    index index.html;

    # 路由用 hash（#/tools/xxx），刷新不会 404；
    # 这一行是给直接访问 / 之外的路径留的余量。
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 构建产物带内容哈希，可以长缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```
