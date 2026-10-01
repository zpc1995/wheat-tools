import { DocumentTextRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'text-diff',
  name: '文本对比',
  description:
    '逐行对比两段文本，LCS 算法保证最小差异脚本；行内改动词级高亮，长文本自动折叠未变部分。',
  tags: ['Diff', '对比', '文本'],
  category: 'text',
  icon: DocumentTextRegular,
  version: '0.1.0',
};
