import { LinkRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'url-params',
  name: 'URL 参数编辑器',
  description:
    '按行编辑查询参数：保留重复键与顺序、区分无值参数与空值，可原样输出原始转义字节（带签名 URL 必需）。',
  tags: ['URL', '参数', '查询串'],
  category: 'network',
  icon: LinkRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "URL parameter editor",
      description:
        "Edit query parameters row by row, preserving repeated keys and their order, distinguishing a valueless parameter from an empty one, and able to re-emit the original escaping byte for byte (needed for signed URLs).",
      tags: ["URL","parameters","query string"],
    },
  },
};
