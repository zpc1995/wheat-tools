import { TagRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'ulid-generator',
  name: 'ULID 生成器',
  description:
    '按 ULID 规范生成 26 位 Crockford Base32 标识符：前 10 位是毫秒时间戳、后 16 位是随机数，字符串排序即时间排序。支持批量生成、单调递增（同一毫秒内随机部分自增）、反解时间戳与随机部分、复制与收藏历史。不做 UUID 互转，转换请用 UUID 生成器。',
  tags: ['ULID', '标识符', '随机', '单调递增', 'Crockford Base32'],
  category: 'dev',
  icon: TagRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'ULID generator',
      description:
        'Generates 26-character Crockford Base32 ULIDs: a 48-bit millisecond timestamp followed by 80 bits of randomness, so string order matches time order. Batch generation, optional monotonic mode for ids made within one millisecond, decoding back to timestamp and randomness, copy and favourites. It does not convert ULIDs to or from UUIDs.',
      tags: ['ULID', 'identifier', 'random', 'monotonic', 'Crockford Base32'],
    },
  },
};
