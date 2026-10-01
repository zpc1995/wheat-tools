import { FingerprintRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'md5-generator',
  name: 'MD5 生成器',
  description:
    '计算 MD5 摘要（纯实现，不依赖后端），同时给出 SHA-1 / SHA-256，支持文件哈希与结果校验。',
  tags: ['MD5', '哈希', '校验'],
  category: 'crypto',
  icon: FingerprintRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "MD5 generator",
      description:
        "A hand-written MD5 (Web Crypto does not provide one) alongside SHA-1 and SHA-256, with file hashing and digest comparison.",
      tags: ["MD5","hash","SHA"],
    },
  },
};
