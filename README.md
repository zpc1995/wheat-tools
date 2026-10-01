# wheat tools · 麦工具

wheat tools（麦工具）是一个前端小工具集合。首页是总入口，每个小工具都是 `src/tools/` 下**独立目录**里的模块，
新增工具不需要改动入口或路由代码。

技术栈：Vite + React 18 + TypeScript + [Fluent UI React v9](https://react.fluentui.dev/)
（严格按 [Fluent 2](https://fluent2.microsoft.design/) 设计规范：中性色层级、圆角、
阴影、Segoe UI Variable 字体、亮/暗双主题）。

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

| 工具 | 说明 |
| --- | --- |
| **JSON 格式化** (`json-formatter`) | 左侧粘贴 JSON，右侧渲染可展开/收起的语法高亮树；实时校验并在出错时给出行列位置；支持缩进切换、压缩、复制、下载、示例数据。 |
| **UUID 生成器** (`uuid-generator`) | 进入即自动生成一个 v4 UUID，可一键重新生成；底部保留本次进入后的全部历史（可复制单条、收藏、导出 txt）。 |

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

## UI 自动化验证

`scripts/verify-ui.mjs` 会用无头 Chromium 加载**生产构建**并跑一遍真实交互：
总入口、搜索过滤、主题切换、JSON 树展开/收起、解析报错、UUID 自动生成与历史、
格式切换、返回导航，并把截图与 JSON 报告写入 `.screenshots/`。

```bash
pnpm build && node scripts/verify-ui.mjs
```

> 该脚本通过 `file://` 加载内联后的构建产物，因为本环境的浏览器无法完成 http 导航。
> 应用本身生产环境使用 HashRouter（可部署到任意静态托管）；
> `VITE_ROUTER=memory` 会换成内存路由，仅在受限环境下验证时使用。

## 部署

`pnpm build` 产出纯静态 `dist/`，可直接托管在任意静态服务器（GitHub Pages、Nginx、
对象存储等）。由于使用 hash 路由，无需配置服务端回退规则。
