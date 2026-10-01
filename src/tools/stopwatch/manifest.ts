import { TimerRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'stopwatch',
  name: '秒表',
  description:
    '毫秒级计时与分段计次：逐段用时列表、自动标出最快与最慢段，刷新页面后继续计时。计时不依赖定时器累加，长时间计时不会跑偏。',
  tags: ['秒表', '计时', '计次'],
  category: 'time',
  icon: TimerRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Stopwatch',
      description:
        'Millisecond timing with laps: a per-lap breakdown, automatic fastest and slowest markers, and timing that survives a page refresh. Elapsed time is derived from the clock rather than accumulated on each tick, so it does not drift.',
      tags: ['stopwatch', 'timer', 'laps'],
    },
  },
};
