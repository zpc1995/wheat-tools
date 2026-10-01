import { KeyRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { UuidGeneratorTool } from './UuidGeneratorTool';

export const manifest: ToolManifest = {
  id: 'uuid-generator',
  name: 'UUID 生成器',
  description:
    '进入即自动生成一个 v4 UUID，可一键重新生成，并保留本次进入后的全部历史记录。',
  tags: ['UUID', 'GUID', '随机'],
  icon: KeyRegular,
  version: '0.1.0',
};

export default UuidGeneratorTool;
