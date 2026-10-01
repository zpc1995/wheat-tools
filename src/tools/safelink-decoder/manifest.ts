import { LinkRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'safelink-decoder',
  name: 'SafeLink 解码器',
  description:
    '还原 Microsoft Defender for Office 365 的 SafeLink 包装链接，取出真实目标地址；列出 url / data / sdata / reserved 各参数并说明含义，识别多层编码与嵌套包装。不验证 sdata 签名，不访问任何 URL。',
  tags: ['safelink', 'outlook', '解码', '链接', '网络'],
  category: 'network',
  icon: LinkRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'SafeLink decoder',
      description:
        'Unwraps a Microsoft Defender for Office 365 SafeLink and shows the real destination, lists the url / data / sdata / reserved parameters with what each one means, and handles multi-layer encoding and nested wrappers. It does not verify the sdata signature and never fetches a URL.',
      tags: ['safelink', 'outlook', 'decode', 'link', 'network'],
    },
  },
};
