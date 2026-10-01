import { GlobeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { IpLookupTool } from './IpLookupTool';

export const manifest: ToolManifest = {
  id: 'ip-lookup',
  name: '外网 IP 查询',
  description:
    '查询公网 IP（有 IPv6 优先显示 IPv6）及归属地、运营商、ASN、时区，并可查询任意指定 IP。这是本站唯一会发起第三方网络请求的工具。',
  tags: ['IP', '网络', '归属地'],
  icon: GlobeRegular,
  version: '0.1.0',
};

export default IpLookupTool;
