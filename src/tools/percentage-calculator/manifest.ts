import { TextPercentRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'percentage-calculator',
  name: '百分比计算器',
  description:
    '按问题类型分类的百分比入口：X 的 Y%、占比、变化率、增减与反推原值、打折互算、百分比差异与百分点、按权重分配、千分比与基点换算。每张卡片标明公式，除以 0 或溢出会明确报错而不是显示 Infinity。',
  tags: ['百分比', '占比', '变化率', '折扣', '基点'],
  category: 'dev',
  icon: TextPercentRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Percentage calculator',
      description:
        'One card per percentage question: percent of, what percent, percent change, increase and decrease with reverse lookup, discount triple, percent difference versus percentage points, weighted allocation with exact remainder handling, and permille or basis-point conversion. Every card shows its formula; division by zero and overflow are reported instead of showing Infinity.',
      tags: ['percentage', 'percent change', 'discount', 'basis points'],
    },
  },
};
