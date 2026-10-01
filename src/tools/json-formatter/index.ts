import { BracesRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { JsonFormatterTool } from './JsonFormatterTool';

export const manifest: ToolManifest = {
  id: 'json-formatter',
  name: 'JSON 格式化',
  description:
    '粘贴 JSON 字符串，即时校验并格式化为可展开、可收起的树形结构。',
  tags: ['JSON', '格式化', '校验'],
  icon: BracesRegular,
  version: '0.1.0',
};

export default JsonFormatterTool;
