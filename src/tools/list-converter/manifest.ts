import { TextBulletListRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'list-converter',
  name: '列表格式转换',
  description:
    '在多种列表写法之间互转：每行一项、逗号/分号/空格/制表符分隔、JSON 数组、SQL IN 列表、Markdown 与有序列表、HTML 列表、YAML 列表。每种输出都按该语言的转义规则处理（文本格式加引号、SQL 单引号加倍、JSON 与 YAML 转义、HTML 实体），含分隔符或引号的项不会被拆坏；可去空白、忽略空项、去重与排序，并能反向识别输入格式。',
  tags: ['列表', '转换', 'JSON', 'SQL', 'Markdown', 'YAML', 'HTML', 'CSV'],
  category: 'text',
  icon: TextBulletListRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'List Converter',
      description:
        'Convert between all the ways a flat list gets written: one item per line, comma / semicolon / space / tab separated, a JSON array, a SQL IN list, Markdown bullets and ordered lists, an HTML list and a YAML sequence. Every output follows its own escaping rules (quoting in text formats, doubled quotes in SQL, JSON and YAML escapes, HTML entities) so items containing separators survive, and the input format is detected automatically. Optional trim, drop-empty, dedupe and sort.',
      tags: ['list', 'converter', 'json', 'sql', 'markdown', 'yaml', 'html'],
    },
  },
};
