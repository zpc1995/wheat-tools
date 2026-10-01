import { CodeTextRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'text-to-unicode',
  name: '文本 ↔ Unicode 转义',
  description:
    '文本与 Unicode 转义互转：\\uXXXX（JS/JSON）、\\u{XXXXX}（ES6）、U+XXXX 码位、HTML 数字实体与纯码位列表，并逐个字符列出码位、UTF-16 码元与 UTF-8 字节。按码位（而非 UTF-16 码元）处理，emoji 等辅助平面字符不会被拆成两个假字符。',
  tags: ['unicode', '转义', '码位', 'emoji', '代理对', 'html 实体'],
  category: 'text',
  icon: CodeTextRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Text ↔ Unicode Escapes',
      description:
        'Convert text to and from Unicode escapes: \\uXXXX (JS/JSON), \\u{XXXXX} (ES6), U+XXXX code points, HTML numeric entities and plain code point lists, with a per-character breakdown of code point, UTF-16 code units and UTF-8 bytes. Iterates by code point, so emoji and other supplementary-plane characters are never split into two fake characters.',
      tags: ['unicode', 'escape', 'code point', 'emoji', 'surrogate pair', 'html entity'],
    },
  },
};
