import { ArrowSwapRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'ipv4-converter',
  name: 'IPv4 地址转换器',
  description:
    '同一个 IPv4 地址的各种表示形式互转：点分十进制、32 位十进制整数、十六进制、二进制、八进制，并解读地址类别与是否私有/保留。也识别 inet_aton 的历史简写（如 127.1、2130706433、0x7f.1）——但会明确标红警告：这些写法是 SSRF 与白名单绕过的常见手法，只用于解读可疑输入，不要写进配置。不计算子网，也不做进制通用转换。',
  tags: ['IPv4', '地址转换', '十进制', '十六进制', 'SSRF'],
  category: 'network',
  icon: ArrowSwapRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'IPv4 address converter',
      description:
        'Converts one IPv4 address between dotted decimal, a 32-bit integer, hex, binary and octal, and explains its class and whether it is private or reserved. It also recognises the historic inet_aton shorthands (127.1, 2130706433, 0x7f.1) — and flags them loudly, because those spellings are a standard SSRF and allow-list bypass. No subnet maths and no general base conversion.',
      tags: ['IPv4', 'address', 'decimal', 'hex', 'SSRF'],
    },
  },
};
