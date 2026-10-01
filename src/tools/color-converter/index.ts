import { ColorRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { ColorConverterTool } from './ColorConverterTool';

export const manifest: ToolManifest = {
  id: 'color-converter',
  name: '颜色格式转换',
  description:
    'HEX / RGB / HSL / HSV / CMYK 互转，带透明度预览、WCAG 对比度评级、色阶与内置颜色名。',
  tags: ['颜色', 'HEX', '对比度'],
  category: 'media',
  icon: ColorRegular,
  version: '0.1.0',
};

export default ColorConverterTool;
