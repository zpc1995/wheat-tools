import { DesktopRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'device-info',
  name: '设备信息',
  description:
    '查看当前浏览器与设备信息：屏幕与窗口尺寸、像素比、时区与语言、CPU 核心数、内存档位、触摸支持、显示偏好、WebGL 显卡串、网络类型与电池状态。每项都标注来源 API 与是否标准，并把非标准（多为 Chromium 专有）的属性明确标出。不做指纹，可整体复制为 JSON 或文本。',
  tags: ['设备信息', '浏览器', '屏幕', 'User Agent', '诊断'],
  category: 'dev',
  icon: DesktopRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Device info',
      description:
        'Inspect the current browser and device: screen and window sizes, pixel ratio, time zone and languages, CPU cores, memory tier, touch support, display preferences, the WebGL graphics strings, network type and battery status. Every row names the API it came from and whether that API is standard, with the non-standard (mostly Chromium-only) ones called out. No fingerprinting; copy the whole set as JSON or text.',
      tags: ['device info', 'browser', 'screen', 'user agent', 'diagnostics'],
    },
  },
};
