import { CodeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'html-entities',
  name: 'HTML 实体转义',
  description:
    '把 < > & " \' 转义成 HTML 实体，或把命名实体与数字实体还原成字符：内置 WHATWG 标准的全部 2125 个命名实体，未知实体与越界码位原样保留而不是变成空，可选避免二次转义。只做实体转换，不做 HTML 净化、不解析标签。',
  tags: ['HTML', '实体', '转义', '反转义', 'nbsp', 'escape'],
  category: 'text',
  icon: CodeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'HTML Entities',
      description:
        'Escape < > & " \' into HTML character references, or decode named and numeric references back to text. Ships all 2125 named entities from the WHATWG standard; unknown names and non-character code points are preserved verbatim instead of vanishing, with an option to avoid double-escaping. Entity conversion only — it does not sanitise HTML or parse markup.',
      tags: ['html', 'entities', 'escape', 'unescape', 'nbsp'],
    },
  },
};
