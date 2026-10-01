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
  translations: {
    'en-US': {
      name: "AES encryption",
      description:
        "AES-256 symmetric encryption (GCM with integrity checking). The passphrase is stretched with PBKDF2 and the ciphertext carries its own salt and IV so it can be decrypted later. Supports files.",
      tags: ["AES","encryption","passphrase"],
    },
  },
};
