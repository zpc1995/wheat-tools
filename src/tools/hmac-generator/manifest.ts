import { ShieldKeyholeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'hmac-generator',
  name: 'HMAC 生成器',
  description:
    '用密钥对消息计算 HMAC 摘要（SHA-256 / SHA-384 / SHA-512 / SHA-1），密钥可按文本或十六进制输入，摘要可输出 hex 与 Base64，用于接口签名与消息认证的核对。',
  tags: ['HMAC', '消息认证', '签名', 'SHA-256'],
  category: 'crypto',
  icon: ShieldKeyholeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'HMAC generator',
      description:
        'Compute an HMAC tag (SHA-256 / SHA-384 / SHA-512 / SHA-1) over a message with a text or hex key, and read it as hex or Base64. Built on Web Crypto, verified against the RFC 4231 and RFC 2202 vectors.',
      tags: ['HMAC', 'message authentication', 'signature', 'SHA-256'],
    },
  },
};
