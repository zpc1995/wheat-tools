/**
 * Word-boundary detection and case conversion for identifiers, file names and
 * column headers.
 *
 * ## Why the obvious one-liner is wrong
 *
 * The canonical "camelCase to snake_case" snippet is
 *
 *     value.replace(/([A-Z])/g, '_$1').toLowerCase()
 *
 * and it is correct only for the simplest shape. It turns `XMLHttpRequest` into
 * `x_m_l_http_request`, `getHTTPResponseCode` into `get_h_t_t_p_response_code`
 * and `parse2DArray` into `parse2_d_array`. Read aloud, the words are
 * XML / Http / Request and parse / 2 / D / Array. So the split cannot be a
 * character-class substitution; it has to be a pass over the string that knows
 * where an acronym ends. The check script keeps that naive version around and
 * asserts that it disagrees with this module, so the difference is defended
 * rather than asserted in prose.
 *
 * ## Classification
 *
 * Every code point lands in exactly one class: upper, lower, other-letter,
 * digit, glue, emoji or separator. Two decisions in that list are worth stating
 * because they are the ones that break other converters:
 *
 *   - `other-letter` covers the letters that have no case: CJK ideographs,
 *     kana, Hangul, Arabic, Hebrew, Devanagari, Thai. A run of them is one word
 *     (`日本語` stays whole), and a switch between the cased and uncased letter
 *     world is a boundary (`中文Name` is 中文 / Name). Accented Latin letters are
 *     *not* in this class — `é` is `lower` and `Ü` is `upper` — so `café` and
 *     `ÜberNice` survive intact instead of being torn apart by an ASCII test.
 *   - `glue` covers the code points that attach to whatever precedes them:
 *     combining marks, and the joiners that hold emoji sequences together (ZWJ
 *     and the tag characters behind flag sequences). Glue never starts a new
 *     word, which is what keeps a decomposed `e` + acute accent in one piece and
 *     a family emoji in one glyph. The single exception is glue with no base at
 *     all (a stray combining accent at the start of a run), which is kept as its
 *     own word so that nothing is silently deleted — agreed with Unicode
 *     grapheme segmentation, which also gives it its own cluster.
 *
 * Emoji are treated as words of their own rather than as separators, because
 * deleting user content is worse than an odd-looking conversion: `hi🚀there`
 * becomes `hi_🚀_there` rather than `hi_there`. The emoji predicate is
 * `Extended_Pictographic` plus skin-tone modifiers and regional indicators. It
 * does claim a few text-presentation symbols such as the copyright sign; that
 * over-inclusion is deliberate, since the alternative is dropping them.
 *
 * Everything else — whitespace, punctuation, currency and maths symbols,
 * control characters — is a separator. `_`, `-`, `.`, `/` and space are all
 * just separators, which is what makes the reverse direction (any style in,
 * words out) fall out of the same code path.
 *
 * ## No React, no globals
 *
 * Pure `string -> value` functions only. The UI calls exactly the functions the
 * check script calls, so what is verified is what ships.
 */

/** Upper bound on the input the UI will process, in UTF-16 code units. */
export const MAX_INPUT_CHARS = 200_000;

export type CharClass =
  | 'upper'
  | 'lower'
  | 'other-letter'
  | 'digit'
  | 'glue'
  | 'emoji'
  | 'separator';

/** Why a word starts where it does. Surfaced in the UI so the split is legible. */
export type BreakKind =
  | 'start'
  | 'separator'
  | 'lower-upper'
  | 'acronym-end'
  | 'letter-digit'
  | 'digit-letter'
  | 'script-change'
  | 'emoji'
  | 'combining-mark';

export interface Token {
  text: string;
  /** The rule that put this word where it is. */
  break: BreakKind;
  /** Verbatim separator text between the previous word and this one, if any. */
  separator: string;
}

export interface TokenizeResult {
  tokens: Token[];
  /** Separator text before the first word. Dropped by every style. */
  leading: string;
  /** Separator text after the last word. Dropped by every style. */
  trailing: string;
}

export interface InputLine {
  /** 1-based, as shown in the UI. */
  index: number;
  text: string;
  words: TokenizeResult;
}

/**
 * Code points that glue onto whatever precedes them instead of starting a word:
 * combining marks, plus the joiners that hold emoji sequences together (ZWJ and
 * the tag characters behind flag sequences). Treating the joiners as glue rather
 * than as emoji is what keeps a stray ZWJ attached to the letter before it, which
 * is where Unicode grapheme segmentation puts it too.
 */
const GLUE_RE = /\p{M}|\u200D|[\u{E0020}-\u{E007F}]/u;
const UPPER_RE = /\p{Lu}|\p{Lt}/u;
const LOWER_RE = /\p{Ll}/u;
const LETTER_RE = /\p{L}/u;
const NUMBER_RE = /\p{N}/u;

/**
 * Emoji sequence constituents: the pictographs, the skin-tone modifiers and the
 * regional indicators behind flag sequences. The joiners between them are glue
 * (above), which is what keeps a family emoji in one piece instead of three.
 */
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}/u;

/** Classifies one code point. The argument must be a single code point. */
export function classify(codePoint: string): CharClass {
  if (GLUE_RE.test(codePoint)) return 'glue';
  if (UPPER_RE.test(codePoint)) return 'upper';
  if (LOWER_RE.test(codePoint)) return 'lower';
  if (LETTER_RE.test(codePoint)) return 'other-letter';
  if (NUMBER_RE.test(codePoint)) return 'digit';
  if (EMOJI_RE.test(codePoint)) return 'emoji';
  return 'separator';
}

/**
 * The whole splitting rule, as one function.
 *
 * `prev` is the class of the last non-glue code point of the word being built,
 * `cur` the class of the code point under consideration and `next` the class of
 * the next non-glue code point (needed only for the acronym rule). Glue is
 * excluded on both sides, which makes combining marks and emoji joiners
 * transparent to the rules instead of a special case inside each one.
 */
function boundaryReason(
  prev: CharClass,
  cur: CharClass,
  next: CharClass | null,
): BreakKind | null {
  if (prev === 'emoji' || cur === 'emoji') return prev === cur ? null : 'emoji';

  // Digits are never welded to letters: `parse2DArray` is parse / 2 / D / Array,
  // and `PBKDF2_ITERATIONS` comes apart as PBKDF / 2 / ITERATIONS. That is the
  // price of `2D` reading as two words, and it is paid consistently.
  if (prev === 'digit' && cur === 'digit') return null;
  if (prev === 'digit') return 'digit-letter';
  if (cur === 'digit') return 'letter-digit';

  // A run of uncased letters is one word: 日本語 stays whole, and so does a
  // Devanagari cluster. Switching between the cased and the uncased world is a
  // boundary, which is what separates 中文Name into two words without touching
  // either of them.
  if (prev === 'other-letter' && cur === 'other-letter') return null;
  if (prev === 'other-letter' || cur === 'other-letter') return 'script-change';

  // A lower-case letter followed by an upper-case one is the camel hump.
  if (prev === 'lower' && cur === 'upper') return 'lower-upper';

  // An upper-case run belongs to the previous word unless a lower-case letter
  // follows it, in which case that last capital starts the next word:
  // `XMLHttpRequest` is XML / Http / Request, not X / M / L / Http / Request.
  if (prev === 'upper' && cur === 'upper' && next === 'lower') return 'acronym-end';

  return null;
}

interface RawWord {
  text: string;
  break: BreakKind;
}

/**
 * Splits one separator-free run of code points into words.
 *
 * `from` and `to` are indices into `cps` / `classes`, which the caller built
 * once for the whole input: re-deriving the classes per run would make a long
 * pasted list quadratic.
 */
function splitRun(
  cps: readonly string[],
  classes: readonly CharClass[],
  from: number,
  to: number,
): RawWord[] {
  const words: RawWord[] = [];
  let buffer = '';
  /** Class of the last non-glue code point in `buffer`, or null while the buffer holds glue only. */
  let lastClass: CharClass | null = null;
  let pendingBreak: BreakKind = 'start';

  const nextSignificant = (at: number): CharClass | null => {
    for (let i = at + 1; i < to; i += 1) {
      if (classes[i] !== 'glue') return classes[i];
    }
    return null;
  };

  const flush = () => {
    if (buffer !== '') {
      words.push({ text: buffer, break: pendingBreak });
      buffer = '';
    }
  };

  for (let i = from; i < to; i += 1) {
    const cls = classes[i];

    if (cls === 'glue') {
      buffer += cps[i];
      continue;
    }

    if (buffer === '') {
      buffer = cps[i];
      lastClass = cls;
      continue;
    }

    if (lastClass === null) {
      // The buffer held only stray leading glue; the base that follows is a
      // word of its own. Grapheme-cluster segmentation agrees with this.
      flush();
      pendingBreak = 'combining-mark';
      buffer = cps[i];
      lastClass = cls;
      continue;
    }

    const reason = boundaryReason(lastClass, cls, nextSignificant(i));
    if (reason === null) {
      buffer += cps[i];
      lastClass = cls;
      continue;
    }

    flush();
    pendingBreak = reason;
    buffer = cps[i];
    lastClass = cls;
  }

  flush();
  return words;
}

/**
 * Splits arbitrary text into words.
 *
 * Works on code points rather than UTF-16 units throughout, so an emoji outside
 * the basic plane is one element and never a lone surrogate.
 */
export function tokenize(input: string): TokenizeResult {
  const cps = [...input];
  const classes = cps.map(classify);
  const tokens: Token[] = [];
  let leading = '';
  let trailing = '';
  let index = 0;
  let firstRun = true;

  while (index < cps.length) {
    let separator = '';
    while (index < cps.length && classes[index] === 'separator') {
      separator += cps[index];
      index += 1;
    }

    if (index >= cps.length) {
      // Input that ends in separators. If there was no word at all then the
      // whole input is leading filler, which keeps the two fields disjoint.
      if (tokens.length === 0) leading = separator;
      else trailing = separator;
      break;
    }

    const runStart = index;
    while (index < cps.length && classes[index] !== 'separator') index += 1;
    const words = splitRun(cps, classes, runStart, index);

    for (let w = 0; w < words.length; w += 1) {
      if (firstRun && w === 0) {
        leading = separator;
        tokens.push({ text: words[w].text, break: 'start', separator: '' });
      } else if (w === 0) {
        tokens.push({ text: words[w].text, break: 'separator', separator });
      } else {
        tokens.push({ text: words[w].text, break: words[w].break, separator: '' });
      }
    }

    firstRun = false;
  }

  return { tokens, leading, trailing };
}

/**
 * Splits on any of the three line endings while *keeping* the separators, so
 * the non-line parts can be converted and the whole thing reassembled byte for
 * byte. A pasted column of identifiers is the common case for this tool, and
 * silently normalising CRLF to LF would be a defect.
 */
function splitParts(input: string): { isLine: boolean; text: string }[] {
  return input
    .split(/(\r\n|\r|\n)/)
    .map((text, position) => ({ isLine: position % 2 === 0, text }));
}

/** Per-line tokenisation, for the transparency panel in the UI. */
export function tokenizeLines(input: string): InputLine[] {
  const lines: InputLine[] = [];
  for (const part of splitParts(input)) {
    if (!part.isLine) continue;
    lines.push({ index: lines.length + 1, text: part.text, words: tokenize(part.text) });
  }
  return lines;
}

/** Human-readable label for each boundary rule, shown next to the words. */
export const BREAK_LABELS: Record<BreakKind, string> = {
  start: '起始位置',
  separator: '分隔符',
  'lower-upper': '小写 → 大写',
  'acronym-end': '连续大写在此结束',
  'letter-digit': '字母 → 数字',
  'digit-letter': '数字 → 字母',
  'script-change': '书写系统切换',
  emoji: 'emoji 边界',
  'combining-mark': '前导组合符号 / 连接符之后',
};

/**
 * Title-cases one word: first code point upper, the rest lower.
 *
 * The expansion case is why this is not `word[0].toUpperCase() + word.slice(1)`.
 * `toUpperCase` can return several code points — `ß` becomes `SS`, the `fi`
 * ligature becomes `FI` — and using the whole expansion as the head leaves two
 * capitals in a row. A second pass would then read those two capitals back as
 * an acronym and produce something different, so the conversion would not be
 * idempotent. Unicode's titlecase mapping for exactly these code points keeps
 * only the first character upper (`ß` to `Ss`), and that is reproduced here.
 */
export function titleWord(word: string): string {
  const lowered = [...word.toLowerCase()];
  if (lowered.length === 0) return '';

  const head = [...lowered[0].toUpperCase()];
  const tail = lowered.slice(1).join('');
  if (head.length === 1) return head[0] + tail;

  return head[0] + head.slice(1).join('').toLowerCase() + tail;
}

export type CaseStyleId =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'constant'
  | 'kebab'
  | 'train'
  | 'dot'
  | 'path'
  | 'space'
  | 'title'
  | 'sentence'
  | 'upper'
  | 'lower';

export interface CaseStyle {
  id: CaseStyleId;
  /** The conventional name of the style, which doubles as its example shape. */
  label: string;
  /** Chinese gloss for the row. */
  description: string;
  /** Text inserted between words. */
  separator: string;
  /** Maps one word (and its position) to its output form. */
  caseWord: (word: string, index: number) => string;
}

const lowerWord = (word: string) => word.toLowerCase();
const upperWord = (word: string) => word.toUpperCase();
const capitalised = (word: string) => titleWord(word);
const firstCapitalised = (word: string, index: number) =>
  index === 0 ? titleWord(word) : word.toLowerCase();

/**
 * The styles, in the order the UI lists them: the programmer-facing ones first
 * because that is where this tool differs from a plain upper/lower button.
 *
 * `space case` and `lower case` really do produce the same string. They are
 * both listed anyway because both names are in use and a converter that silently
 * omits one of them reads as broken; the UI says so out loud instead of
 * pretending there is a difference.
 */
export const CASE_STYLES: readonly CaseStyle[] = [
  {
    id: 'camel',
    label: 'camelCase',
    description: '首词小写，其余首字母大写，无分隔符',
    separator: '',
    caseWord: (word, index) => (index === 0 ? word.toLowerCase() : capitalised(word)),
  },
  {
    id: 'pascal',
    label: 'PascalCase',
    description: '每词首字母大写，无分隔符',
    separator: '',
    caseWord: capitalised,
  },
  {
    id: 'snake',
    label: 'snake_case',
    description: '小写，下划线分隔',
    separator: '_',
    caseWord: lowerWord,
  },
  {
    id: 'constant',
    label: 'SCREAMING_SNAKE_CASE',
    description: '大写，下划线分隔',
    separator: '_',
    caseWord: upperWord,
  },
  {
    id: 'kebab',
    label: 'kebab-case',
    description: '小写，连字符分隔',
    separator: '-',
    caseWord: lowerWord,
  },
  {
    id: 'train',
    label: 'TRAIN-CASE',
    description: '大写，连字符分隔',
    separator: '-',
    caseWord: upperWord,
  },
  {
    id: 'dot',
    label: 'dot.case',
    description: '小写，点号分隔',
    separator: '.',
    caseWord: lowerWord,
  },
  {
    id: 'path',
    label: 'path/case',
    description: '小写，斜杠分隔',
    separator: '/',
    caseWord: lowerWord,
  },
  {
    id: 'space',
    label: 'space case',
    description: '小写，空格分隔',
    separator: ' ',
    caseWord: lowerWord,
  },
  {
    id: 'title',
    label: 'Title Case',
    description: '每词首字母大写，空格分隔',
    separator: ' ',
    caseWord: capitalised,
  },
  {
    id: 'sentence',
    label: 'Sentence case',
    description: '仅首词首字母大写，空格分隔',
    separator: ' ',
    caseWord: firstCapitalised,
  },
  {
    id: 'upper',
    label: 'UPPER CASE',
    description: '全部大写，空格分隔',
    separator: ' ',
    caseWord: upperWord,
  },
  {
    id: 'lower',
    label: 'lower case',
    description: '全部小写，空格分隔（结果与 space case 相同）',
    separator: ' ',
    caseWord: lowerWord,
  },
];

const STYLE_BY_ID = new Map(CASE_STYLES.map((style) => [style.id, style]));

/** Looks a style up, falling back to `camel` rather than throwing at render time. */
export function styleById(id: CaseStyleId): CaseStyle {
  return STYLE_BY_ID.get(id) ?? CASE_STYLES[0];
}

/** Joins already-split words in the given style. */
export function convertWords(words: readonly string[], style: CaseStyleId): string {
  const spec = styleById(style);
  return words.map((word, index) => spec.caseWord(word, index)).join(spec.separator);
}

/** Converts one line (no line endings) — the primitive the UI and checks use. */
export function convertLine(line: string, style: CaseStyleId): string {
  return convertWords(
    tokenize(line).tokens.map((token) => token.text),
    style,
  );
}

/**
 * Converts every line of `input` independently, preserving the original line
 * endings. Lines are independent on purpose: a pasted list of identifiers is
 * one identifier per line, and a newline is not a word separator.
 */
export function convertCase(input: string, style: CaseStyleId): string {
  return splitParts(input)
    .map((part) => (part.isLine ? convertLine(part.text, style) : part.text))
    .join('');
}

export interface StyleResult {
  style: CaseStyle;
  value: string;
}

/** Every style at once, which is what the results panel renders. */
export function convertAll(input: string): StyleResult[] {
  return CASE_STYLES.map((style) => ({ style, value: convertCase(input, style.id) }));
}

/** Renders the tokenisation as plain text, for the copy button. */
export function formatTokenization(lines: readonly InputLine[]): string {
  const blocks: string[] = [];

  for (const line of lines) {
    const { tokens, leading, trailing } = line.words;
    const rows: string[] = [`输入: ${line.text === '' ? '（空行）' : line.text}`];

    if (tokens.length === 0) {
      rows.push('  （没有可切分的词）');
    } else {
      const width = Math.max(...tokens.map((token) => [...token.text].length));
      tokens.forEach((token, position) => {
        const padding = ' '.repeat(width - [...token.text].length);
        let reason: string;
        if (position === 0) {
          reason = leading === '' ? BREAK_LABELS.start : `${BREAK_LABELS.start}（前导 ${JSON.stringify(leading)} 已丢弃）`;
        } else if (token.break === 'separator') {
          reason = `分隔符 ${JSON.stringify(token.separator)}`;
        } else {
          reason = BREAK_LABELS[token.break];
        }
        rows.push(`  ${token.text}${padding}  ← ${reason}`);
      });
    }

    if (trailing !== '') {
      rows.push(`  （尾随 ${JSON.stringify(trailing)} 已丢弃）`);
    }
    blocks.push(rows.join('\n'));
  }

  return blocks.join('\n\n');
}

/** The tokenisation as a compact one-line summary, for narrow screens. */
export function wordCount(lines: readonly InputLine[]): number {
  return lines.reduce((total, line) => total + line.words.tokens.length, 0);
}

/** Prefilled example: it exercises every boundary rule that is easy to get wrong. */
export const SAMPLE_INPUT = [
  'getHTTPResponseCode',
  'XMLHttpRequest',
  'userID',
  'parse2DArray',
  '__proto__',
  '_private',
  '-leading',
  'some_Mixed-input here',
  '已存在Some中文和emoji🚀',
].join('\n');
