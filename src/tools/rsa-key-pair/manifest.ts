import { KeyMultipleRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'rsa-key-pair',
  name: 'RSA 密钥对生成器',
  description:
    '用浏览器 Web Crypto 生成 RSA 密钥对：用途可选 RSASSA-PKCS1-v1_5 / RSA-PSS 签名或 RSA-OAEP 加密，长度 2048 / 3072 / 4096 位（不提供已不安全的 1024 位），可导出 PKCS#8 与 SPKI 的 PEM、JWK，并显示公钥 SHA-256 指纹。不做证书与 CSR，也不保存私钥。',
  tags: ['RSA', '密钥对', 'PKCS#8', 'SPKI', 'JWK', '指纹'],
  category: 'crypto',
  icon: KeyMultipleRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'RSA key pair generator',
      description:
        'Generate an RSA key pair with Web Crypto: pick RSASSA-PKCS1-v1_5 or RSA-PSS for signing, or RSA-OAEP for encryption, at 2048, 3072 or 4096 bits (1024 is not offered). Export the private key as PKCS#8 PEM, the public key as SPKI PEM, or both as JWK, and read the public key SHA-256 fingerprint. No certificates or CSRs, and nothing is persisted.',
      tags: ['RSA', 'key pair', 'PKCS#8', 'SPKI', 'JWK', 'fingerprint'],
    },
  },
};
