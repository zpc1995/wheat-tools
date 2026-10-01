import { GlobeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'ip-lookup',
  name: '外网 IP 查询',
  description:
    '同时查询 IPv4 与 IPv6 公网地址并各自显示归属地、运营商、ASN 与地区，另可查询任意指定 IP。这是本站唯一会发起第三方网络请求的工具。',
  tags: ['IP', '网络', '归属地'],
  category: 'network',
  icon: GlobeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "Public IP lookup",
      description:
        "Look up your public IPv4 and IPv6 addresses with their location, ISP, ASN and time zone. The only tool that makes a third-party network request.",
      tags: ["IP","network","geolocation"],
    },
  },
};
