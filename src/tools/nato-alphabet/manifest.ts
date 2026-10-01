import { BookLetterRegular } from '@fluentui/react-icons';
import type { ToolManifest } from '../types';

export const manifest: ToolManifest = {
  id: 'nato-alphabet',
  name: '北约音标字母表',
  description:
    '把文本逐字读成 ICAO / NATO 音标字母（ABC → Alfa Bravo Charlie），也能从字母表词序列还原文本，并给出 26 个字母与 10 个数字的完整映射表。官方拼写按 ICAO 用 Alfa、Juliett、Xray，Alpha / Juliet / X-ray 作为常见变体标注。中文等无法映射的字符会原样透传或跳过，不猜读音；不播放音频。',
  tags: ['北约', '音标字母', 'ICAO', '拼读'],
  category: 'text',
  icon: BookLetterRegular,
  version: '0.1.0',
  translations: {
    'en-US': {
      name: 'NATO phonetic alphabet',
      description:
        'Spell text out with the ICAO / NATO radiotelephony alphabet (ABC becomes Alfa Bravo Charlie) and read a sequence of code words back. Includes the full 26-letter and 10-digit table with the official ICAO spellings — Alfa, Juliett, Xray — and the common variants (Alpha, Juliet, X-ray) labelled as such. Characters the alphabet cannot represent, such as Chinese, are passed through or skipped rather than guessed at. No audio.',
      tags: ['nato', 'phonetic alphabet', 'icao', 'spelling'],
    },
  },
};
