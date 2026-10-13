import { CodeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'toml-yaml',
  name: 'TOML ↔ YAML',
  description:
    'TOML 与 YAML 双向转换，复用 TOML 解析器与 yaml 依赖。四种日期时间逐一说明映射方式（本地时间不会被当成 UTC），YAML 的 null、非字符串键会明确报错，大整数丢精度会警告，锚点与别名会展开。不保留注释与原始排版。',
  tags: ['TOML', 'YAML', '配置', 'Kubernetes', 'TOML 转 YAML', 'YAML 转 TOML'],
  category: 'dev',
  icon: CodeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'TOML ↔ YAML',
      description:
        'Two-way TOML/YAML conversion reusing the existing TOML parser and the yaml dependency. Every date-time mapping is spelled out (a local time is never treated as UTC), YAML null and non-string keys are reported instead of dropped, loss of integer precision is warned about, and anchors are expanded. Comments and original formatting are not kept.',
      tags: ['TOML', 'YAML', 'config', 'Kubernetes', 'TOML to YAML', 'YAML to TOML'],
    },
  },
};
