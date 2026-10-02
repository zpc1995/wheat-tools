import { TagRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'xml-formatter',
  name: 'XML 格式化',
  description:
    'XML 的缩进格式化、压缩与语法校验：缩进宽度、属性换行、注释保留可选，校验会给出出错的行列位置与代码片段。基于解析树而不是正则，因此 CDATA、注释和属性里的「>」不会被打乱。不做 XSD/DTD 校验，不做 XSLT。',
  tags: ['XML', '格式化', '压缩', '校验'],
  category: 'dev',
  icon: TagRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'XML formatter',
      description:
        'Pretty-print, minify and validate XML: configurable indent, one attribute per line, optional comment retention. Validation reports the line and column plus the offending snippet. It works on a parse tree rather than regexes, so CDATA, comments and ">" inside attributes survive. No XSD/DTD validation and no XSLT.',
      tags: ['XML', 'format', 'minify', 'validate'],
    },
  },
};
