import { TextNumberFormatRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'text-statistics',
  name: '文本统计',
  description:
    '码点数、字素簇数、UTF-16 码元数、UTF-8 字节数四个口径分别统计，另有行/段/句/词数、阅读时间估算、字符频率表与 Unicode 类别分布。解释为什么与编辑器显示的字数不一致。',
  tags: ['字数', '字符统计', 'Unicode', '码点', '字素簇'],
  category: 'text',
  icon: TextNumberFormatRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Text statistics',
      description:
        'Counts code points, grapheme clusters, UTF-16 code units and UTF-8 bytes separately, plus lines, paragraphs, sentences, words, a reading-time estimate, character frequency and a Unicode category breakdown — and explains why an editor reports a different character count.',
      tags: ['text', 'count', 'unicode', 'code points', 'graphemes'],
    },
  },
};
