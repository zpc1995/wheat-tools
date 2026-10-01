import { GlobeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { IpLookupTool } from './IpLookupTool';

export const manifest: ToolManifest = {
  id: 'ip-lookup',
  name: '外网 IP 查询',
  description:
    '查询当前出口公网 IP，并展示归属地、运营商、ASN 与时区。需注意：这是本站唯一会发起第三方网络请求的工具。',
  tags: ['IP', '网络', '归属地'],
  icon: GlobeRegular,
  version: '0.1.0',
};

export default IpLookupTool;
