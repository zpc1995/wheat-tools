import { ClockRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { CronConvertTool } from './CronConvertTool';

export const manifest: ToolManifest = {
  id: 'cron-convert',
  name: '定时表达式转换',
  description:
    'cron 转 systemd timer / GitHub Actions / crontab，并给出中文说明；日与星期的并集/交集等语义差异会明确标注。',
  tags: ['cron', 'systemd', '定时'],
  category: 'time',
  icon: ClockRegular,
  version: '0.1.0',
};

export default CronConvertTool;
