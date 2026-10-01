import { TextBulletListSquareRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'text-toolkit',
  name: '文本处理',
  description:
    '大小写、行排序/去重/洗牌、空白与标点清理、全半角转换、转义与统计等 30 余种操作，支持撤销。',
  tags: ['文本', '批量', '行处理'],
  category: 'text',
  icon: TextBulletListSquareRegular,
  version: '0.1.0',
};
