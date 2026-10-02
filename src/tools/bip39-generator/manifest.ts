import { DocumentKeyRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'bip39-generator',
  name: 'BIP39 助记词生成器',
  description:
    '生成与解析 BIP-39 英文助记词：128/160/192/224/256 位熵对应 12/15/18/21/24 个词，可从助记词反向恢复熵并验证校验和，并按 PBKDF2-HMAC-SHA512（2048 轮）派生 64 字节种子。使用官方英文词表，全部计算在本地完成。不做 BIP-32/44 派生、地址生成与二维码。',
  tags: ['BIP39', '助记词', '钱包', '种子', '熵', '校验和'],
  category: 'crypto',
  icon: DocumentKeyRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'BIP39 mnemonic generator',
      description:
        'Generate and decode BIP-39 English mnemonics: 128/160/192/224/256 bits of entropy for 12/15/18/21/24 words, recover entropy and verify the checksum, and derive the 64-byte seed with PBKDF2-HMAC-SHA512 (2048 rounds). Uses the official English word list and computes everything locally. No BIP-32/44 derivation, no addresses, no QR codes.',
      tags: ['BIP39', 'mnemonic', 'wallet', 'seed', 'entropy', 'checksum'],
    },
  },
};
