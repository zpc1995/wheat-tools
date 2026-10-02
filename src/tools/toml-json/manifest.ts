import { SettingsRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'toml-json',
  name: 'TOML 转 JSON',
  description:
    'TOML 与 JSON 双向转换，解析器与序列化器自写：表、数组表、内联表、四种日期时间、多行字符串、不同进制整数与 inf/nan。日期用 $type 标签保留类型，JSON 的 null 无法表示会明确报错。',
  tags: ['TOML', 'JSON', '配置', 'Cargo'],
  category: 'text',
  icon: SettingsRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'TOML to JSON',
      description:
        'Two-way TOML/JSON conversion with a hand-written parser and serialiser: tables, arrays of tables, inline tables, all four date-time types, multiline strings, every integer base and inf/nan. Dates keep their type through $type tags; JSON null is reported as unrepresentable.',
      tags: ['TOML', 'JSON', 'config', 'Cargo'],
    },
  },
};
