import { CodeBlockEditRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'html-wysiwyg',
  name: '所见即所得 HTML 编辑器',
  description:
    '左侧富文本编辑、右侧实时查看生成的 HTML 源码：粗体、斜体、下划线、删除线、标题、列表、引用、代码与链接。粘贴内容会被强制清理——script、on* 事件属性、javascript: 协议一律移除，并给出清理报告；可选择是否保留粘贴样式、是否只粘贴纯文本、输出是否带内联样式。不做协作、不做撤销栈管理、不做图片上传。',
  tags: ['富文本', 'HTML', '编辑器', '所见即所得', '粘贴清理'],
  category: 'text',
  icon: CodeBlockEditRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'WYSIWYG HTML editor',
      description:
        'Rich-text editing on the left, live HTML source on the right: bold, italic, underline, strikethrough, headings, lists, quotes, code and links. Pasted markup is force-sanitised — script elements, on* event attributes and javascript: URLs are stripped, with a report of what was removed. Choose whether pasted styles are kept, whether paste is plain text only, and whether the output carries inline styles. No collaboration, no undo-stack management, no image upload.',
      tags: ['rich text', 'html', 'editor', 'wysiwyg', 'paste sanitising'],
    },
  },
};
