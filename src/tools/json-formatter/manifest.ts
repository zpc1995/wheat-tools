import { BracesRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'json-formatter',
  name: 'JSON 格式化',
  description:
    '粘贴 JSON 字符串，即时校验并格式化为可展开、可收起的树形结构。',
  tags: ['JSON', '格式化', '校验'],
  category: 'text',
  icon: BracesRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "JSON formatter",
      description:
        "Paste JSON on the left and get a collapsible, syntax-highlighted tree on the right, with live validation that reports the line and column of an error.",
      tags: ["JSON","format","validate"],
    },
  },
};
