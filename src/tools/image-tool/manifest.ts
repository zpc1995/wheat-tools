import { ImageRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'image-tool',
  name: '图片压缩',
  description:
    '本地压缩与缩放图片（JPEG/WebP/PNG），显示体积对比，并可转为 Base64 data URL 与嵌入代码。',
  tags: ['图片', '压缩', 'Base64'],
  category: 'media',
  icon: ImageRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "Image compressor",
      description:
        "Compress and resize images (JPEG/WebP/PNG) locally, compare file sizes, and convert to a Base64 data URL with embed snippets.",
      tags: ["image","compress","Base64"],
    },
  },
};
