import { DocumentTextRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { HexViewerTool } from './HexViewerTool';

export const manifest: ToolManifest = {
  id: 'hex-viewer',
  name: 'HEX 查看器',
  description:
    '查看任意文件的十六进制与文本、按文件头识别真实类型、统计熵与可打印字符、提取内嵌可读字符串。',
  tags: ['HEX', '二进制', '文件'],
  category: 'dev',
  icon: DocumentTextRegular,
  version: '0.1.0',
};

export default HexViewerTool;
