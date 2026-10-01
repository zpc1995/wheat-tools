import { GlobeRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { HttpClientTool } from './HttpClientTool';

export const manifest: ToolManifest = {
  id: 'http-client',
  name: 'HTTP 请求测试',
  description:
    '在浏览器里发送 HTTP 请求并查看响应；受 CORS 限制，失败时列出可能原因与排查方式而不是猜测，并可生成对照 curl 命令。',
  tags: ['HTTP', 'API', '请求'],
  category: 'network',
  icon: GlobeRegular,
  version: '0.1.0',
};

export default HttpClientTool;
