import { TextNumberFormatRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'roman-numeral',
  name: '罗马数字转换器',
  description:
    '阿拉伯数字与标准罗马数字双向转换，逐位展示拆解过程（1994 = M + CM + XC + IV）。严格限定在标准写法可表示的范围：0、负数、小数与 4000 以上会说明原因而不是给出臆造的写法。',
  tags: ['罗马数字', '转换', '进制', '数字'],
  category: 'text',
  icon: TextNumberFormatRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Roman numeral converter',
      description:
        'Convert between Arabic numbers and standard Roman numerals with a step-by-step breakdown (1994 = M + CM + XC + IV). Only spellings the standard system can express are accepted: zero, negatives, fractions and values above 3999 are explained rather than guessed at.',
      tags: ['roman numerals', 'converter', 'numerals', 'numbers'],
    },
  },
};
