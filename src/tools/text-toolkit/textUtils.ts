/**
 * Text transformation pipeline.
 *
 * Operations are pure `string → string` functions plus a few that need lines.
 * They are defined as data so the UI can render them generically and, more
 * importantly, so they can be composed and unit-tested without a DOM.
 */

export type LineEnding = 'lf' | 'crlf' | 'keep';

export interface TextOperation {
  id: string;
  label: string;
  group: '大小写' | '行处理' | '空白与标点' | '编码' | '统计';
  run: (input: string) => string;
}

/** Splits into lines while preserving the information needed to rejoin. */
export function splitLines(input: string): string[] {
  return input.split(/\r\n|\r|\n/);
}

export function countWords(input: string): number {
  // Count CJK characters individually, otherwise whitespace-separated tokens.
  const cjk = (input.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const withoutCjk = input.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');
  const words = withoutCjk.trim() ? withoutCjk.trim().split(/\s+/).length : 0;
  return cjk + words;
}

const ORDINALS = (value: number) =>
  new Intl.NumberFormat('en-US').format(value);

export const TEXT_OPERATIONS: TextOperation[] = [
  // --- Case ---
  {
    id: 'upper',
    label: '转大写',
    group: '大小写',
    run: (input) => input.toUpperCase(),
  },
  {
    id: 'lower',
    label: '转小写',
    group: '大小写',
    run: (input) => input.toLowerCase(),
  },
  {
    id: 'title',
    label: '每词首字母大写',
    group: '大小写',
    run: (input) =>
      input.replace(/\b([a-z])(\w*)/gi, (_, first: string, rest: string) =>
        first.toUpperCase() + rest.toLowerCase(),
      ),
  },
  {
    id: 'sentence',
    label: '句首大写',
    group: '大小写',
    run: (input) =>
      input
        .toLowerCase()
        .replace(/(^\s*\w|[.!?。！？]\s*\w)/g, (match) => match.toUpperCase()),
  },

  // --- Lines ---
  {
    id: 'sort',
    label: '按行排序（A→Z）',
    group: '行处理',
    run: (input) =>
      splitLines(input)
        .slice()
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
        .join('\n'),
  },
  {
    id: 'sort-desc',
    label: '按行排序（Z→A）',
    group: '行处理',
    run: (input) =>
      splitLines(input)
        .slice()
        .sort((a, b) => b.localeCompare(a, 'zh-Hans-CN'))
        .join('\n'),
  },
  {
    id: 'sort-length',
    label: '按行长排序',
    group: '行处理',
    run: (input) =>
      splitLines(input)
        .slice()
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .join('\n'),
  },
  {
    id: 'dedupe',
    label: '去除重复行',
    group: '行处理',
    run: (input) => [...new Set(splitLines(input))].join('\n'),
  },
  {
    id: 'dedupe-keep-order',
    label: '去除重复行（保留首次出现顺序）',
    group: '行处理',
    run: (input) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const line of splitLines(input)) {
        const key = line.trim();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(line);
      }
      return out.join('\n');
    },
  },
  {
    id: 'reverse-lines',
    label: '行序反转',
    group: '行处理',
    run: (input) => splitLines(input).reverse().join('\n'),
  },
  {
    id: 'shuffle-lines',
    label: '随机打乱行序',
    group: '行处理',
    run: (input) => {
      const lines = splitLines(input);
      // Fisher–Yates: unbiased, unlike `sort(() => Math.random() - 0.5)`.
      for (let i = lines.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      return lines.join('\n');
    },
  },
  {
    id: 'number-lines',
    label: '添加行号',
    group: '行处理',
    run: (input) =>
      splitLines(input)
        .map((line, index) => `${String(index + 1).padStart(3, ' ')}  ${line}`)
        .join('\n'),
  },
  {
    id: 'wrap-json-array',
    label: '转为 JSON 数组',
    group: '行处理',
    run: (input) =>
      JSON.stringify(
        splitLines(input).filter((line) => line.trim() !== ''),
        null,
        2,
      ),
  },
  {
    id: 'join-comma',
    label: '合并为单行（逗号分隔）',
    group: '行处理',
    run: (input) =>
      splitLines(input)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(', '),
  },

  // --- Whitespace & punctuation ---
  {
    id: 'trim-lines',
    label: '去除每行首尾空白',
    group: '空白与标点',
    run: (input) => splitLines(input).map((line) => line.trim()).join('\n'),
  },
  {
    id: 'remove-blank',
    label: '删除空行',
    group: '空白与标点',
    run: (input) =>
      splitLines(input)
        .filter((line) => line.trim() !== '')
        .join('\n'),
  },
  {
    id: 'collapse-spaces',
    label: '合并连续空白',
    group: '空白与标点',
    run: (input) => input.replace(/[ \t]{2,}/g, ' '),
  },
  {
    id: 'collapse-blank-lines',
    label: '合并连续空行为一行',
    group: '空白与标点',
    run: (input) => input.replace(/(\r?\n\s*){2,}/g, '\n\n'),
  },
  {
    id: 'remove-all-spaces',
    label: '删除所有空白',
    group: '空白与标点',
    run: (input) => input.replace(/\s+/g, ''),
  },
  {
    id: 'strip-punctuation',
    label: '去除标点符号',
    group: '空白与标点',
    run: (input) => input.replace(/[\p{P}\p{S}]/gu, ''),
  },
  {
    id: 'to-halfwidth',
    label: '全角转半角',
    group: '空白与标点',
    run: (input) =>
      input.replace(/[\uff01-\uff5e]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) - 0xfee0),
      ).replace(/\u3000/g, ' '),
  },
  {
    id: 'to-fullwidth',
    label: '半角转全角',
    group: '空白与标点',
    run: (input) =>
      input.replace(/[!-~]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) + 0xfee0),
      ).replace(/ /g, '\u3000'),
  },

  // --- Encoding ---
  {
    id: 'slug',
    label: '转为 URL slug',
    group: '编码',
    run: (input) =>
      input
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, ''),
  },
  {
    id: 'escape-json',
    label: 'JSON 字符串转义',
    group: '编码',
    run: (input) => JSON.stringify(input).slice(1, -1),
  },
  {
    id: 'unescape-json',
    label: 'JSON 字符串反转义',
    group: '编码',
    run: (input) => {
      try {
        return JSON.parse(`"${input.replace(/"/g, '\\"')}"`) as string;
      } catch {
        return input;
      }
    },
  },
  {
    id: 'to-html-entities',
    label: '转 HTML 实体',
    group: '编码',
    run: (input) =>
      input.replace(/[&<>"']/g, (char) => {
        const map: Record<string, string> = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        };
        return map[char];
      }),
  },
  {
    id: 'from-html-entities',
    label: 'HTML 实体还原',
    group: '编码',
    run: (input) =>
      input
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&'),
  },

  // --- Statistics as text ---
  {
    id: 'stats',
    label: '插入文本统计',
    group: '统计',
    run: (input) => {
      const lines = splitLines(input);
      const words = countWords(input);
      const chars = input.length;
      const charsNoSpace = input.replace(/\s/g, '').length;
      return [
        `行数：${ORDINALS(lines.length)}`,
        `词数：${ORDINALS(words)}`,
        `字符数：${ORDINALS(chars)}`,
        `字符数（不含空白）：${ORDINALS(charsNoSpace)}`,
        `字节数（UTF-8）：${ORDINALS(new Blob([input]).size)}`,
        '',
        input,
      ].join('\n');
    },
  },
];

export interface TextStats {
  lines: number;
  nonEmptyLines: number;
  words: number;
  chars: number;
  charsNoSpace: number;
  bytes: number;
  /** Most frequent lines, useful for quickly spotting duplicates. */
  duplicates: Array<{ line: string; count: number }>;
}

export function analyseText(input: string): TextStats {
  const lines = splitLines(input);
  const counts = new Map<string, number>();

  for (const line of lines) {
    const key = line.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([line, count]) => ({ line, count }));

  return {
    lines: lines.length,
    nonEmptyLines: lines.filter((line) => line.trim() !== '').length,
    words: countWords(input),
    chars: input.length,
    charsNoSpace: input.replace(/\s/g, '').length,
    bytes: new Blob([input]).size,
    duplicates,
  };
}

/** Normalises line endings to the requested style. */
export function applyLineEnding(input: string, ending: LineEnding): string {
  if (ending === 'keep') return input;
  const normalised = input.replace(/\r\n|\r/g, '\n');
  return ending === 'lf' ? normalised : normalised.replace(/\n/g, '\r\n');
}
