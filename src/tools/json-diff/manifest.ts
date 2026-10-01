import { BranchCompareRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'json-diff',
  name: 'JSON 结构化对比',
  description:
    '比较两份 JSON 的结构差异，按 JSON Pointer 列出新增、删除、改值的键；数组可按 id 字段配对，重排不算差异。与逐行文本对比不同，这里比较的是解析后的结构。',
  tags: ['JSON', 'Diff', '结构化对比', 'JSON Pointer'],
  category: 'dev',
  icon: BranchCompareRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'JSON structural diff',
      description:
        'Compare two JSON documents structurally: added, removed and changed keys listed by JSON Pointer, with type changes called out separately. Arrays can be matched by an id field, so reordering the same elements reports no differences. Unlike a line-by-line text diff, this compares the parsed structure — three-way merge and JSON Patch generation are not offered.',
      tags: ['json', 'diff', 'structural', 'json pointer'],
    },
  },
};
