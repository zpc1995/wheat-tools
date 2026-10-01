import { KeyRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'jwt-decoder',
  name: 'JWT 解码',
  description:
    '查看 JWT 的 Header 与 Payload、时间声明与算法风险提示。只解码不验签——解码成功不代表令牌可信。',
  tags: ['JWT', '令牌', '解码'],
  category: 'network',
  icon: KeyRegular,
  version: '0.1.0',
};
