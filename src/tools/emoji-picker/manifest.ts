import { EmojiRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'emoji-picker',
  name: 'Emoji 选择器',
  description:
    '一个分好类的精选 emoji 表，支持中英文关键词搜索，点击即可复制。选中后显示它的码点、UTF-16 码元与 UTF-8 字节，并解释家庭这类用 ZWJ 连接的组合序列为什么在代码里那么长。只收录几百个常用 emoji，不是全量 Unicode 表情库，也不含肤色与性别变体。',
  tags: ['emoji', '表情', '码点', '复制'],
  category: 'text',
  icon: EmojiRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Emoji Picker',
      description:
        'A categorised, curated emoji table with Chinese and English keyword search and click-to-copy. The selection panel shows the code points, UTF-16 units and UTF-8 bytes, and explains why a ZWJ sequence such as the family emoji is so long in code. A few hundred common emoji only: not the full Unicode set, and no skin-tone or gender variants.',
      tags: ['emoji', 'picker', 'code points', 'copy'],
    },
  },
};
