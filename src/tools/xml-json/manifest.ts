import { CodeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'xml-json',
  name: 'XML 转 JSON',
  description:
    'XML 与 JSON 双向转换，自写解析器：属性、#text、重复子元素成数组、命名空间、CDATA、注释与处理指令，拒绝 DTD 与外部实体（防 XXE）。映射约定写在界面上，并明确说明它是有损的。',
  tags: ['XML', 'JSON', '转换', 'XXE'],
  category: 'text',
  icon: CodeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'XML to JSON',
      description:
        'Two-way XML/JSON conversion with a hand-written parser: attributes, #text, repeated children as arrays, namespaces, CDATA, comments and processing instructions. DTDs and external entities are refused (XXE). The mapping is documented on the page and is honestly described as lossy.',
      tags: ['XML', 'JSON', 'convert', 'XXE'],
    },
  },
};
