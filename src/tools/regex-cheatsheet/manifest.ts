import { BookOpenRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'regex-cheatsheet',
  name: '正则速查表',
  description:
    '字符类、锚点、量词、分组、标志与常用模式的速查；每条都由测试真正编译并匹配过，并列出 JS 特有的陷阱。',
  tags: ['正则', '速查', '参考'],
  category: 'dev',
  icon: BookOpenRegular,
  version: '0.1.0',
};
