import { BracesRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';
import { RegexTesterTool } from './RegexTesterTool';

export const manifest: ToolManifest = {
  id: 'regex-tester',
  name: '正则测试',
  description:
    '实时匹配高亮、捕获组与命名分组查看、替换预览，并提示灾难性回溯风险。',
  tags: ['正则', 'regex', '匹配'],
  category: 'dev',
  icon: BracesRegular,
  version: '0.1.0',
};

export default RegexTesterTool;
