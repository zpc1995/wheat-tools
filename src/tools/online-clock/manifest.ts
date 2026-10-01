import { ClockRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'online-clock',
  name: '在线时钟',
  description:
    '大字时钟与世界时间换算（自动处理夏令时与半小时时区），附可在刷新后继续的倒计时。',
  tags: ['时钟', '时区', '倒计时'],
  category: 'time',
  icon: ClockRegular,
  version: '0.1.0',
};
