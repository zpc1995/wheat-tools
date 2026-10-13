import { FingerprintRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'md5-generator',
  name: '哈希计算',
  description:
    '一次算出 MD5、SHA-1、SHA-256、SHA-384、SHA-512 五种摘要。MD5 是纯实现（Web Crypto 不提供），SHA 系列走平台 Web Crypto。支持文件哈希、结果比对与大小写不敏感的粘贴核对。',
  tags: ['哈希', 'MD5', 'SHA-256', 'SHA-512', '校验'],
  category: 'crypto',
  icon: FingerprintRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "Hash calculator",
      description:
        "MD5, SHA-1, SHA-256, SHA-384 and SHA-512 in one pass. MD5 is hand-written because Web Crypto does not provide it; the SHA family uses the platform. File hashing and digest comparison included.",
      tags: ["hash","MD5","SHA-256","SHA-512","checksum"],
    },
  },
};
