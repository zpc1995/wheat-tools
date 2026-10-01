import { GlobeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'http-status-codes',
  name: 'HTTP 状态码速查',
  description:
    '按类别与关键词查 HTTP 状态码：码值、标准英文名、中文说明与出处（RFC 9110 等），明确标注已废弃与未注册的非标准码；点击即可复制码值。只做速查，不解析响应头。',
  tags: ['HTTP', '状态码', '速查', 'API'],
  category: 'dev',
  icon: GlobeRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'HTTP status codes',
      description:
        'Look up HTTP status codes by class or keyword: the code, its standard English name, a Chinese explanation and the RFC it comes from, with deprecated and nonstandard codes called out. Click a code to copy it. Reference only — it does not parse response headers.',
      tags: ['http', 'status codes', 'reference', 'api'],
    },
  },
};
