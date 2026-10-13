import { TextFontRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'ascii-art-text',
  name: 'ASCII 艺术字',
  description:
    '把文本转成 FIGlet 风格的 ASCII 艺术字。内置 Standard 字体，覆盖 ASCII 可打印字符（U+0020–U+007E），可调字距、对齐方式、填充字符与宽度限制，结果可直接复制。只内置这一种字体，不做多字体选择，也不输出彩色或 HTML。',
  tags: ['ASCII 艺术字', 'FIGlet', '横幅', 'banner'],
  category: 'text',
  icon: TextFontRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'ASCII Art Text',
      description:
        'Turns text into FIGlet-style ASCII art using one built-in face that covers printable ASCII (U+0020–U+007E), with letter spacing, alignment, a fill character and a width limit. Copy the result as plain text. One built-in font only: no font picker, no colour and no HTML output.',
      tags: ['ascii art', 'figlet', 'banner'],
    },
  },
};
