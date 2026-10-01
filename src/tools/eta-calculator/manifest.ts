import { TimerRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'eta-calculator',
  name: '预计完成时间',
  description:
    '按当前进度或「剩余项目数 × 每项耗时」估算剩余时间与完成时刻，自动选择秒/分/时/天显示，并按样本量标注预估可信度与大致误差。时间基准由输入提供，不读系统时钟；不做进度持久化，也不预测人的效率变化。',
  tags: ['预计完成', '剩余时间', '进度', '速度', 'ETA'],
  category: 'dev',
  icon: TimerRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'ETA calculator',
      description:
        'Estimates the remaining time and finish moment from progress so far, or from "items left × time per item". Durations are shown in whichever unit reads best, and every estimate carries a confidence level and a rough margin derived from the sample size. The time base is an input, never the system clock; progress is not persisted and human productivity is not modelled.',
      tags: ['eta', 'remaining time', 'progress', 'throughput'],
    },
  },
};
