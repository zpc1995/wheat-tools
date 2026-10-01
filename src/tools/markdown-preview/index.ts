import { DocumentTextRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { MarkdownPreviewTool } from './MarkdownPreviewTool';

export const manifest: ToolManifest = {
  id: 'markdown-preview',
  name: 'Markdown 预览',
  description:
    '实时渲染 Markdown（GFM 表格、任务列表、代码块），带目录导航；原始 HTML 不解析，从根本上避免 XSS。',
  tags: ['Markdown', '预览', 'GFM'],
  category: 'text',
  icon: DocumentTextRegular,
  version: '0.1.0',
};

export default MarkdownPreviewTool;
