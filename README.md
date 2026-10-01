# wheat tools · 麦工具

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

| 工具 | ID | 说明 |
| --- | --- | --- |
| **JSON 格式化** | `json-formatter` | 左侧粘贴 JSON，右侧渲染可展开/收起的语法高亮树；实时校验并给出行列位置；支持缩进切换、压缩、复制、下载。 |
| **UUID 生成器** | `uuid-generator` | 进入即生成 v4 UUID，可重新生成；历史可复制、收藏、导出 txt。 |
| **时间戳转换** | `timestamp-converter` | Unix 时间戳与日期互转，按位数自动识别秒/毫秒，给出 ISO、UTC、多时区、周数与相对时间。 |
| **MD5 生成器** | `md5-generator` | 自实现 MD5（Web Crypto 不提供），同时给出 SHA-1/SHA-256；支持文件哈希与结果比对校验。 |
| **CRON 表达式** | `cron-builder` | 校验、中文语义描述、接下来 8 次执行时间预览，支持可视化构建与常用模板。 |
| **Base64 编解码** | `base64-converter` | 正确处理中文与 emoji，兼容 URL 安全字符集与无填充输入；解码可预览图片、格式化 JSON、下载二进制。 |
| **外网 IP 查询** | `ip-lookup` | 查询出口公网 IP 及归属地、运营商、ASN、时区。**这是唯一会发起第三方网络请求的工具。** |
| **二维码生成器** | `qrcode-generator` | 网址/文本/WiFi/名片等生成二维码，可调纠错等级、尺寸、留白、配色，并提示低对比度与反色风险。 |

> 除「外网 IP 查询」外，所有工具都在浏览器本地完成计算，不产生任何网络请求。

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
| `node scripts/check-tools.mjs` | 冒烟测试：在真实浏览器里逐个打开每个工具，断言渲染成功且无报错 |
| `node scripts/verify-ui.mjs` | 深度交互：搜索、主题切换、JSON 树展开/收起/报错定位、UUID 生成与历史 |

```bash
pnpm build
node scripts/check-md5.mjs && node scripts/check-cron.mjs \
  && node scripts/check-base64.mjs && node scripts/check-qrcode.mjs
node scripts/check-tools.mjs && node scripts/verify-ui.mjs
```

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

#### 自定义域名 `wheat.chat`

站点发布在自定义 apex 域名上，从**根路径**提供服务，所以工作流把 `VITE_BASE` 设为
`/`。`public/CNAME` 里的 `wheat.chat` 会被复制到构建产物根目录。

##### 第 0 步（必做，否则后面全部无效）

**先在仓库 Settings → Pages → Custom domain 填入 `wheat.chat` 并保存。**

这一步不只是"登记"：GitHub Pages 依据请求的 `Host` 决定提供哪个站点。
未登记时，即使把请求正确反代到 GitHub 的 IP，也会返回 **404**，而且
HTTPS 证书只有 `*.github.io`（不含 `wheat.chat`），浏览器会直接报证书错误。
（已实测：`Host: wheat.chat` 打到 `185.199.108.153` → `HTTP/2 404`，`server: GitHub.com`。）

##### 方式一：直接改 DNS（最简单）

**前提**：`wheat.chat` 当前指向阿里云 `<服务器地址>` 上的 nginx；若仍在用，
请先确认可以接管，或在方式二里保留这台机器。

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
> 另外注意：DNS 服务商常会给 apex 域名预设一条 A 记录（你的域名现在就有），
> 需要先删掉。DNS 生效最长 24 小时；GitHub 签发 HTTPS 证书可能再需要几分钟到几小时。

##### 方式二：保留现有 nginx，做反向代理

若想继续持有 `<服务器地址>`（例如那台机器还跑着别的东西），把 nginx 变成
GitHub Pages 的反向代理。完整配置见
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
