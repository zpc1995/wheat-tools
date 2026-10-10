import { PersonRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'user-agent-parser',
  name: 'User Agent 分析器',
  description:
    '解析 UA 字符串，提取浏览器与版本、渲染引擎、操作系统与版本、设备类型（桌面/手机/平板/爬虫/游戏主机/电视/命令行）与 CPU 架构，并高亮原始串里匹配到的片段。内置近年主流浏览器与经典 UA、爬虫样本。明确标注局限：UA 由客户端自称、可以任意伪造，且现代浏览器普遍冻结或缩减 UA，结构化替代方案是 Client Hints；结果不能用于安全判断。不做指纹，不发请求。',
  tags: ['User Agent', 'UA', '浏览器检测', '爬虫', 'Client Hints'],
  category: 'network',
  icon: PersonRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'User Agent Parser',
      description:
        'Parses a User-Agent string into browser and version, rendering engine, OS and version, device type (desktop/mobile/tablet/bot/console/TV/CLI) and CPU architecture, highlighting the matched runs in the raw string. Ships with real sample UAs (recent mainstream browsers, classics and crawlers). States its limits plainly: a UA is self-reported and trivially forged, modern browsers freeze or reduce it, and Client Hints are the structured alternative — never use it for security decisions. No fingerprinting, no network requests.',
      tags: ['user agent', 'ua', 'browser detection', 'bot', 'client hints'],
    },
  },
};
