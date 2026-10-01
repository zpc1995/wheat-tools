import { TextParagraphRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'lorem-ipsum',
  name: 'Lorem ipsum 生成器',
  description:
    '按段落 / 句子 / 单词生成占位文本，可选用经典开头、中文占位文字与 HTML 标签包裹，一键复制。不是翻译工具：中文占位文本不是拉丁文的对译，而是中文项目里常用的“这里是占位文字，请替换成真实内容”写法。',
  tags: ['lorem ipsum', '占位文本', '假文', '中文占位'],
  category: 'text',
  icon: TextParagraphRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'Lorem ipsum generator',
      description:
        'Placeholder text by paragraph, sentence or word, with the classic opening, optional Chinese filler and HTML wrapping, plus one-click copy. It is not a translator: the Chinese filler is the conventional "this is placeholder copy, replace it" wording used in Chinese projects, not a translation of the Latin.',
      tags: ['lorem ipsum', 'placeholder', 'filler text', 'dummy text'],
    },
  },
};
