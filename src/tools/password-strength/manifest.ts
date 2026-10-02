import { PasswordRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'password-strength',
  name: '密码强度分析仪',
  description:
    '分析你输入的密码：按字符集算熵，再按模式（弱口令表、单词、键盘序、序列、重复、日期、上下文词）重新估算有效熵，给出分场景的破解时间量级与可操作的改进建议。只在本页内存中计算，不上传、不保存。',
  tags: ['密码强度', '熵', '弱口令', '破解时间'],
  category: 'crypto',
  icon: PasswordRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Password strength analyser',
      description:
        'Analyses a password instead of generating one: charset entropy, then an effective entropy from pattern matching (weak-password list, words, keyboard runs, sequences, repeats, dates, context words), plus order-of-magnitude crack times and quantified advice. Everything stays in the page; nothing is uploaded or stored.',
      tags: ['password strength', 'entropy', 'weak passwords', 'crack time'],
    },
  },
};
