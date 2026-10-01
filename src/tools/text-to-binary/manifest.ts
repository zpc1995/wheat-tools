import { CodeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'text-to-binary',
  name: '文本 ↔ 二进制',
  description:
    '把文本按 UTF-8 字节转成 8 位二进制，并把二进制还原成文本，同时给出十六进制与十进制字节。转换以字节为单位，不是按字符的码位：中文一个字 3 字节、emoji 4 字节，中文一个字在结果里就是 24 位而不是 16 位。',
  tags: ['二进制', 'UTF-8', '编码', '字节'],
  category: 'text',
  icon: CodeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Text ↔ binary',
      description:
        'Convert text to eight-bit binary and back, on the UTF-8 bytes rather than the characters, with hexadecimal and decimal byte values alongside. A Chinese character is three bytes and an emoji is four, so one character can be 24 or 32 bits long.',
      tags: ['binary', 'utf-8', 'encoding', 'bytes'],
    },
  },
};
