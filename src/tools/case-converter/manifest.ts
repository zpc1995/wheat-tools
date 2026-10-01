import { TextChangeCaseRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'case-converter',
  name: '命名风格转换',
  description:
    '在 camelCase、PascalCase、snake_case、SCREAMING_SNAKE_CASE、kebab-case、TRAIN-CASE、dot.case、path/case 等 13 种命名风格之间互转，并把切词过程逐词展示出来：连续大写（getHTTPResponseCode）、数字边界（parse2DArray）、前导分隔符（__proto__）都按真实词义断开，中文、emoji 与重音字母不被破坏。多行输入逐行处理。',
  tags: ['命名', '驼峰', '下划线', '切词', '标识符'],
  category: 'text',
  icon: TextChangeCaseRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Case converter',
      description:
        'Convert between 13 naming conventions — camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case, TRAIN-CASE, dot.case, path/case and more — and see exactly how the input was split into words. Acronym runs (getHTTPResponseCode), digit boundaries (parse2DArray) and leading separators (__proto__) are handled by meaning rather than by a character-class substitution, and CJK text, emoji and accented letters survive untouched. Multi-line input is converted line by line.',
      tags: ['naming', 'camelCase', 'snake_case', 'tokenize', 'identifier'],
    },
  },
};
