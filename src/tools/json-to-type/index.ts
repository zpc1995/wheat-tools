import { BracesRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { JsonToTypeTool } from './JsonToTypeTool';

export const manifest: ToolManifest = {
  id: 'json-to-type',
  name: 'JSON 转类型',
  description:
    '从一份或多份 JSON 样本生成 TypeScript 接口或 Go 结构体；多样本合并可推断可选字段，生成的 TS 会经过编译校验。',
  tags: ['JSON', 'TypeScript', 'Go', '类型'],
  category: 'dev',
  icon: BracesRegular,
  version: '0.1.0',
};

export default JsonToTypeTool;
