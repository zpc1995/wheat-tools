import { IncognitoRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'string-obfuscator',
  name: '字符串混淆器',
  description:
    '在字符层面混淆文本并可逆地还原：leet 替换、零宽字符插入、同形字替换、大小写交替、反转、全半角转换、逐字插入标记，可任意组合并按相反顺序还原，同时逐字符列出码位对照。它不做加密也不做编码（Base64、ROT13 属于编码，另有工具），也不做 JS 代码混淆；对无法唯一还原的变换（leet 的 1 与 0、同形字、大小写交替）会明确列出所有候选而不是假装唯一。',
  tags: ['混淆', '字符', 'leet', '同形字', '零宽字符', '码位', '还原'],
  category: 'text',
  icon: IncognitoRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'String obfuscator',
      description:
        'Character level text obfuscation that can be undone: leet substitution, zero width character insertion, homoglyph replacement, alternating case, reversal, full width conversion and per character marker insertion. Combine them freely, revert in the opposite order, and read a per code point table of exactly what changed. It is neither encryption nor encoding (Base64 and ROT13 belong to other tools) and it is not JavaScript obfuscation; transforms that cannot be inverted uniquely — leet 1 and 0, homoglyphs, alternating case — report every candidate instead of pretending to be exact.',
      tags: ['obfuscate', 'characters', 'leet', 'homoglyph', 'zero width', 'code points'],
    },
  },
};
