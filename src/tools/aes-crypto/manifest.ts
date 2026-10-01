import { LockClosedRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'aes-crypto',
  name: 'AES 加解密',
  description:
    'AES-256 对称加解密（GCM 含完整性校验），口令经 PBKDF2 派生，密文自带盐与 IV 便于日后解密，支持文件。',
  tags: ['AES', '加密', '口令'],
  category: 'crypto',
  icon: LockClosedRegular,
  version: '0.1.0',
};
