import { DocumentTextRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'base64-converter',
  name: 'Base64 编解码',
  description:
    '文本与 Base64 互转，正确处理中文与 emoji，支持 URL 安全字符集、无填充输入，并可预览图片、格式化 JSON、编码文件。',
  tags: ['Base64', '编码', '解码'],
  category: 'text',
  icon: DocumentTextRegular,
  version: '0.1.0',
};
