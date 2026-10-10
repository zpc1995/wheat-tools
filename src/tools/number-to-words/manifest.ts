import { NumberSymbolRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'number-to-words',
  name: '数字转文字',
  description:
    '把数字写成文字：英文基数词与序数词（含负数、小数、到 quintillion）、中文普通读法与财务金融大写（壹佰贰拾叁）、支票风格的英文货币读法（one hundred twenty-three dollars and 45/100）。输入按十进制字符串处理，不经过浮点数，因此 0.1 + 0.2 不会被读成十七位小数。不做其它语言。',
  tags: ['数字转文字', '英文读法', '中文大写', '金融大写', '序数词', '支票'],
  category: 'text',
  icon: NumberSymbolRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Number to words',
      description:
        'Spells numbers out: English cardinals and ordinals (negatives, decimals, up to quintillion), Chinese plain and financial-capital readings, and cheque-style English currency (one hundred twenty-three dollars and 45/100). The value is handled as a decimal string rather than a double, so 0.1 + 0.2 does not become seventeen decimal places. No languages other than English and Chinese.',
      tags: ['number to words', 'spell out', 'ordinal', 'cheque', 'Chinese numerals'],
    },
  },
};
