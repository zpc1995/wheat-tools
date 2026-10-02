import { CodeBlockRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'markdown-html',
  name: 'Markdown 转 HTML',
  description:
    '把 Markdown 编译成可复制的 HTML 源码：可选完整文档或片段、Tailwind 类名或内嵌样式、目录、压缩。原始 HTML 默认转义，javascript: 与 data: 链接被拦掉。它输出字符串，不做实时预览——渲染后的预览请用「Markdown 预览」。',
  tags: ['Markdown', 'HTML', '转换', 'XSS'],
  category: 'text',
  icon: CodeBlockRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Markdown to HTML',
      description:
        'Compiles Markdown into copyable HTML source: full document or fragment, Tailwind classes or embedded CSS, table of contents, minification. Raw HTML is escaped by default and javascript:/data: links are refused. It emits a string and does not preview — use "Markdown preview" for rendered output.',
      tags: ['Markdown', 'HTML', 'convert', 'XSS'],
    },
  },
};
