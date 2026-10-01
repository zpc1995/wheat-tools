
---

### 下载

- **`wheat-tools-<tag>.zip`** —— 构建好的静态站点，解压即可部署，不需要 Node 或 pnpm。
  包内有 `部署说明.txt`。
- GitHub 自动提供的 `Source code` 压缩包是源代码，需要自行
  `pnpm install && pnpm build`。

### 在线版本

https://zpc1995.github.io/wheat-tools/

### 验证

构建产物在发布前已通过仓库中的逻辑检查套件（1600+ 项断言）。
浏览器相关检查（工具冒烟、可访问性）需要在本地运行 `pnpm verify:all`。
