import { CalendarClockRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { CronBuilderTool } from './CronBuilderTool';

export const manifest: ToolManifest = {
  id: 'cron-builder',
  name: 'CRON 表达式',
  description:
    '校验、生成并预览 CRON 表达式：给出中文语义说明与接下来 8 次执行时间，支持可视化构建与常用模板。',
  tags: ['CRON', '定时', '调度'],
  icon: CalendarClockRegular,
  version: '0.1.0',
};

export default CronBuilderTool;
