import { GlobeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'ipv6-ula',
  name: 'IPv6 ULA 地址生成器',
  description:
    '按 RFC 4193 生成 fd00::/8 的本地唯一地址（ULA）前缀：40 位全局 ID 支持纯随机或「NTP 时间戳 + EUI-64 的 SHA-1」两种算法，并把全局 ID 的 u 位（掩码 0x02）置 0，输出 /48、/64 与完整地址的规范（RFC 5952 压缩）与完整形式。不做 IPv6 子网计算。',
  tags: ['IPv6', 'ULA', 'RFC 4193', 'RFC 5952', '私有地址'],
  category: 'network',
  icon: GlobeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'IPv6 ULA generator',
      description:
        'Generates RFC 4193 unique local address prefixes under fd00::/8: a 40-bit Global ID either purely random or derived from an NTP timestamp plus an EUI-64 via SHA-1, always with the Global ID u bit (mask 0x02) cleared, formatted as /48, /64 and full addresses in both RFC 5952 compressed and complete forms. It does not do IPv6 subnet maths.',
      tags: ['IPv6', 'ULA', 'RFC 4193', 'RFC 5952', 'private addressing'],
    },
  },
};
