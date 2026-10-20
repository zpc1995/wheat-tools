import { PersonSquareRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'id-photo',
  name: '证件照制作',
  description:
    '在浏览器本地抠出人像、换成证件照背景，按一寸、二寸等常用规格裁切，可导出单张或 6 寸相纸拼版。自动抠图适合背景相对干净的照片，复杂背景可用画笔修整；不做人脸美化。常用规格，具体以受理机构要求为准；驾驶证等尺寸有分歧的规格已在工具内标注。',
  tags: ['证件照', '抠图', '换背景', '拼版', '照片'],
  category: 'media',
  icon: PersonSquareRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'ID Photo Maker',
      description:
        'Cut out a portrait in the browser, replace the background, crop to common ID photo sizes (one-inch, two-inch and others), then export a single photo or a 6-inch print sheet. Automatic matting works best on plain backgrounds; a brush is available for busy ones. Common sizes only: always follow the accepting authority. Sizes with conflicting sources, such as the driver licence entry, are marked in the tool.',
      tags: ['id photo', 'passport photo', 'background removal', 'print sheet', 'photo'],
    },
  },
};
