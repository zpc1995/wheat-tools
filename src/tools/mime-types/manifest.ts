import { DocumentRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'mime-types',
  name: 'MIME 类型速查',
  description:
    '扩展名与 MIME 类型双向查询：输入 .docx 查类型，输入 application/json 查扩展名；可按 text / image / audio / video / application / font / multipart 筛选，并标出每种类型的中文说明、是否为可读文本、是否为压缩归档格式。表内收录了 .ts、.xml 这类一个扩展名对应多个类型的情况。只查注册表，不做文件内容嗅探。',
  tags: ['MIME', 'Content-Type', '扩展名', '媒体类型', 'content-type', 'docx'],
  category: 'network',
  icon: DocumentRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'MIME Type Lookup',
      description:
        'Two-way lookup between file extensions and MIME types — type .docx to get the type, application/json to get the extension — with text / image / audio / video / application / font / multipart filters and a Chinese note, readability flag and archive-format flag per type. Ambiguous extensions such as .ts and .xml list every mapping. Registry lookup only: no content sniffing.',
      tags: ['mime', 'content-type', 'extension', 'media type'],
    },
  },
};
