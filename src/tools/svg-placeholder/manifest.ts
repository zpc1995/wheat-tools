import { ImageRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'svg-placeholder',
  name: 'SVG 占位图生成器',
  description:
    '生成尺寸精确的 SVG 占位图：宽高、背景色、文字、字号、圆角、边框，可选网格或斜纹底纹与尺寸标注。输出可直接复制或下载的 SVG 源码，以及可塞进 img src 的 Data URL；文字与颜色都做了转义与白名单校验。不做 PNG/JPEG 位图导出。',
  tags: ['SVG', '占位图', 'placeholder', 'Data URL', 'mockup'],
  category: 'media',
  icon: ImageRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'SVG placeholder generator',
      description:
        'Generates a dimension-accurate SVG placeholder: size, background, caption, font size, corner radius and border, with optional grid or stripe fill and edge dimension labels. Outputs copyable or downloadable SVG source plus a data URL for img src, with XML escaping and a colour allow-list. No PNG/JPEG raster export.',
      tags: ['SVG', 'placeholder', 'data URL', 'mockup'],
    },
  },
};
