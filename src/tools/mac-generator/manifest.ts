import { NetworkAdapter16Regular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'mac-generator',
  name: 'MAC 地址生成器',
  description:
    '生成 48 位 MAC 地址：默认置本地管理位（U/L = 1），因此不会冒用 IEEE 分配给真实厂商的 OUI 前缀，可与真实硬件共存。可切换单播/组播、指定 OUI 前缀，输出冒号、连字符、Cisco 点分与无分隔四种格式，并解读首字节两个标志位的含义与 OUI / NIC 分段。不做 OUI 厂商查询（那需要 IEEE 注册表数据）。',
  tags: ['MAC 地址', '网卡地址', 'OUI', '本地管理', '随机生成'],
  category: 'network',
  icon: NetworkAdapter16Regular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'MAC address generator',
      description:
        'Generates 48-bit MAC addresses with the locally-administered bit set by default, so a random prefix never impersonates an OUI that the IEEE has assigned to a real vendor. Unicast/multicast toggle, optional OUI prefix, four output notations (colon, hyphen, Cisco dotted, plain), and a decode of the two flag bits plus the OUI / NIC split. It does not look up the vendor behind an OUI.',
      tags: ['MAC address', 'hardware address', 'OUI', 'locally administered'],
    },
  },
};
