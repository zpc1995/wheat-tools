import { ConvertRangeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'ipv4-range-expander',
  name: 'IPv4 范围扩展器',
  description:
    '把起止 IP 范围展开成覆盖它所需的最小 CIDR 集合（贪心取最大对齐块，结果就是数学上的最小集合），反向也能把若干 CIDR 合并成并集范围并重新汇总；同时给出地址总数与主机口径的可用地址数。只做数学上的最小覆盖，不涉及路由聚合的业务语义。',
  tags: ['IPv4', 'CIDR', '地址范围', '汇总', '最小覆盖'],
  category: 'network',
  icon: ConvertRangeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'IPv4 range expander',
      description:
        'Expands a start–end IP range into the minimal set of CIDR blocks that covers it (greedy largest-aligned-block, which provably yields the minimum), and does the reverse: collapses a list of CIDRs into their union ranges and re-summarises them. Reports total addresses and the host-count interpretation. Pure set arithmetic — no routing-policy semantics.',
      tags: ['IPv4', 'CIDR', 'range', 'aggregate', 'coverage'],
    },
  },
};
