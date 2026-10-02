import { TagRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'token-generator',
  name: 'Token 生成器',
  description:
    '用 crypto.getRandomValues 生成随机 token（hex / Base64 / Base64URL / 自定义字符集），长度与数量可调，支持前缀、分组显示、批量复制与导出 txt。不用 Math.random，也不生成 JWT。',
  tags: ['token', '随机', 'api key', '熵'],
  category: 'crypto',
  icon: TagRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Token generator',
      description:
        'Generates random tokens with crypto.getRandomValues in hex, Base64, Base64URL or a custom alphabet, with adjustable length and count, an optional prefix, group-separated display, batch copy and txt export. No Math.random and no JWT signing.',
      tags: ['token', 'random', 'api key', 'entropy'],
    },
  },
};
