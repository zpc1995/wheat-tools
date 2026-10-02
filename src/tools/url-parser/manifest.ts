import { LinkRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'url-parser',
  name: 'URL 分析器',
  description:
    '把一条 URL 逐字段拆开：协议、认证信息（默认打码）、主机、端口、路径、查询、片段，各自按正确的规则解码，并诊断明文协议、冗余默认端口、IDN/Punycode、追踪参数、嵌套 URL 与 SPA 路由。纯本地解析，不发请求、不展开短链。',
  tags: ['URL', '解析', '拆解', '查询参数', '诊断'],
  category: 'network',
  icon: LinkRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'URL Analyzer',
      description:
        'Breaks a URL into its parts — scheme, credentials (masked by default), host, port, path, query and fragment — decodes each part with the correct rules, and diagnoses insecure schemes, redundant default ports, IDN/Punycode, tracking parameters, nested URLs and SPA routes. Everything is parsed locally: no requests are sent and short links are not expanded.',
      tags: ['url', 'parser', 'query string', 'diagnostics'],
    },
  },
};
