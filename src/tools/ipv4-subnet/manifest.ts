import { VirtualNetworkRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'ipv4-subnet',
  name: 'IPv4 子网计算器',
  description:
    '把 CIDR 换算成网络地址、广播地址、掩码与可用主机范围，并用 32 位二进制直观区分网络位与主机位；支持按新前缀列出子网划分表。只处理 IPv4，不做 IPv6，也不查询 IP 归属地。',
  tags: ['IPv4', '子网', 'CIDR', '掩码', '网络'],
  category: 'network',
  icon: VirtualNetworkRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'IPv4 subnet calculator',
      description:
        'Turns a CIDR block into its network address, broadcast address, netmask and usable host range, with a 32-bit binary view that separates network bits from host bits, plus a subnet-splitting table for a new prefix. IPv4 only — no IPv6, and no IP geolocation.',
      tags: ['IPv4', 'subnet', 'CIDR', 'netmask', 'network'],
    },
  },
};
