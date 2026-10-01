import { ClockRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { TimestampConverterTool } from './TimestampConverterTool';

export const manifest: ToolManifest = {
  id: 'timestamp-converter',
  name: '时间戳转换',
  description:
    'Unix 时间戳与日期互转，自动识别秒/毫秒，并给出 ISO、UTC、多时区与相对时间。',
  tags: ['时间', 'Unix', '时区'],
  icon: ClockRegular,
  version: '0.1.0',
};

export default TimestampConverterTool;
