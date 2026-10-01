import { TableRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { YamlJsonTool } from './YamlJsonTool';

export const manifest: ToolManifest = {
  id: 'yaml-json',
  name: 'YAML 转 JSON',
  description:
    'YAML 与 JSON 双向转换，重复键报错、自定义标签不求值、别名炸弹有上限，并可查看结构与统计。',
  tags: ['YAML', 'JSON', '配置'],
  category: 'text',
  icon: TableRegular,
  version: '0.1.0',
};

export default YamlJsonTool;
