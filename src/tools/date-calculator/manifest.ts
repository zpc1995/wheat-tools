import { CalendarLtrRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'date-calculator',
  name: '日期计算器',
  description:
    '两日期相差、日期加减、年龄与工作日推算。日历月按截断处理（1 月 31 日 +1 月 = 2 月 28 日），跨夏令时也是「加一天」。',
  tags: ['日期', '计算', '工作日'],
  category: 'time',
  icon: CalendarLtrRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: "Date calculator",
      description:
        "Difference between two dates, date arithmetic, age and business-day counting. Calendar months truncate (31 Jan + 1 month = 28 Feb) and a day means a calendar day even across a DST change.",
      tags: ["date","calculate","business days"],
    },
  },
};
