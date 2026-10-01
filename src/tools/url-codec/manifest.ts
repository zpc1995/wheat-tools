import { LinkRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'url-codec',
  name: 'URL 编解码',
  description:
    'URL 编码与解码，区分「组件 / 整条链接 / 表单」三种转义方式，并解析查询参数与 URL 结构。',
  tags: ['URL', '编码', '查询串'],
  category: 'network',
  icon: LinkRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "URL encoder",
      description:
        "Three escaping modes (component, whole URL, form) plus query-string and URL-structure inspection.",
      tags: ["URL","encode","decode"],
    },
  },
};
