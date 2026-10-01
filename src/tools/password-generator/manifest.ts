import { KeyRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'password-generator',
  name: '密码生成器',
  description:
    '用 crypto 生成随机密码或单词短语（拒绝采样消除取模偏差），以熵值衡量强度，支持批量生成。',
  tags: ['密码', '随机', '熵'],
  category: 'crypto',
  icon: KeyRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "Password generator",
      description:
        "Generate random passwords or passphrases with `crypto` (rejection sampling removes modulo bias) and judge them by entropy, with batch generation.",
      tags: ["password","random","entropy"],
    },
  },
};
