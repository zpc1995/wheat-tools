/**
 * Character level text obfuscation, plus the inverse of every step.
 *
 * The scope is deliberately narrow: this module replaces, inserts and reorders
 * characters. It is not encryption and it is not encoding — Base64, ROT13 and
 * their relatives have their own tools — and it has nothing to do with
 * obfuscating JavaScript source code. What it offers is a small set of
 * transforms whose effect on individual code points can be shown exactly, and
 * whose inverse is available for each one.
 *
 * ## Why the inverse takes the original as an optional argument
 *
 * Most of these transforms destroy information on purpose:
 *
 *   - leet maps `i`, `l` (and their capitals) all to `1`, and a literal `1`
 *     already in the source is left alone, so a `1` in the output has several
 *     possible origins;
 *   - homoglyph replacement picks one lookalike out of several, and text that
 *     already contained Cyrillic cannot be told apart from text converted into
 *     it;
 *   - alternating case overwrites the original casing completely;
 *   - a prefix marker or a zero width character cannot be distinguished from one
 *     that was already present in the source.
 *
 * So `invertStep` has two modes. Without the original it is best effort and
 * reports every position where the answer is not unique. With the original it
 * resolves each position against it and then **verifies** the result by running
 * the forward transform again, so a wrong answer is never returned silently.
 * The `verified` flag records which path was taken.
 *
 * ## Grapheme clusters instead of UTF-16 code units
 *
 * Splitting or reversing with `split` and `join` works on UTF-16 code units,
 * which cuts surrogate pairs in half (`😀` becomes two lone surrogates) and
 * separates a combining mark from its base letter (`e` followed by U+0301).
 * Every position in this module therefore comes from `Intl.Segmenter` at
 * grapheme granularity, with an `Array.from` code point fallback for engines
 * that do not provide it.
 */

/** Identifiers for the available transforms. */
export type TransformId =
  | 'leet'
  | 'homoglyph'
  | 'fullwidth'
  | 'alternating'
  | 'prefix'
  | 'zeroWidth'
  | 'reverse';

/** Which way a homoglyph step goes. */
export type HomoglyphDirection = 'toLookalike' | 'toLatin';

/** Which way a full width step goes. */
export type FullwidthDirection = 'toFull' | 'toHalf';

/** One configured step of a pipeline. */
export type StepConfig =
  | { id: 'leet' }
  | { id: 'homoglyph'; direction: HomoglyphDirection }
  | { id: 'fullwidth'; direction: FullwidthDirection }
  | { id: 'alternating' }
  | { id: 'prefix' }
  | { id: 'zeroWidth' }
  | { id: 'reverse' };

/**
 * Apply order of a pipeline.
 *
 * The order is fixed rather than user sortable: a canonical order is what makes
 * the "revert in the opposite order" instruction checkable, and the individual
 * steps are visible enough that a stable order costs nothing.
 */
export const PIPELINE_ORDER: TransformId[] = [
  'leet',
  'homoglyph',
  'fullwidth',
  'alternating',
  'prefix',
  'zeroWidth',
  'reverse',
];

/** UI friendly description of a transform. */
export interface TransformMeta {
  id: TransformId;
  label: string;
  /** One line shown next to the toggle. */
  summary: string;
  /** The honest caveat, shown in the panel when the transform is on. */
  note: string;
  /** A prominent warning, when the transform is actively misleading. */
  warning?: string;
}

export const TRANSFORM_META: Record<TransformId, TransformMeta> = {
  leet: {
    id: 'leet',
    label: 'leet 替换',
    summary: 'a 到 4、e 到 3、i 和 l 到 1、o 到 0、s 到 5、t 到 7、b 到 8、g 到 9。',
    note:
      '还原不唯一：1 可能是 i、I、l、L，也可能本来就是数字 1；0 可能是 o 或 O，也可能是数字 0。' +
      '正向替换本身也是多对一的（i 与 l 都变成 1），所以只有拿到原文才能确定地还原。',
  },
  homoglyph: {
    id: 'homoglyph',
    label: '同形字替换',
    summary: '把拉丁字母换成外观相同的西里尔或希腊字母，例如 a 换成 U+0430。',
    note:
      '替换后每个被改动的字符都是一个不同的码位，只是字形相同。这类字符不会被 NFKC 规范化折叠，' +
      '因此普通的搜索、比较、查找、排序都会把它们当成完全不同的字符 —— 这既是混淆的目的，也是它的风险。',
    warning:
      '同形字会让文本无法被搜索匹配：一段看上去一模一样的文字，检索时可能永远找不到，' +
      '排序与去重也会把它和正常文本分开，密码、账号、URL 里混入同形字还可能被当成钓鱼。',
  },
  fullwidth: {
    id: 'fullwidth',
    label: '全半角转换',
    summary: '在 ASCII（U+0020 到 U+007E）与全角形式（U+FF01 到 U+FF5E，空格为 U+3000）之间转换。',
    note:
      '范围有意收窄：只覆盖 ASCII 与全角形式这一段。半角片假名（U+FF61 到 U+FF9F）、' +
      '带圈数字、连字等虽然也能被 NFKC 折叠，但不属于这个变换，也不会被改动。',
  },
  alternating: {
    id: 'alternating',
    label: '大小写交替',
    summary: '从首位开始小写、大写交替，得到 aLtErNaTiNg 这样的形状。',
    note:
      '原始大小写被覆盖，无法从结果推断。没有原文时只能全部转成小写，' +
      '而且中文、emoji、数字虽然不区分大小写，仍会占用交替的位置。' +
      '大小写映射会改变长度的字符（İ 小写是两个码位、ß 大写是两个字母）保持原样，否则位次会对不上。',
  },
  prefix: {
    id: 'prefix',
    label: '逐字插入标记',
    summary: '在每个字素簇前面插入一个反斜杠。',
    note:
      '原文里本来就有的反斜杠无法与插入的标记区分，所以没有原文时"删除全部反斜杠"这种还原会误删原有的反斜杠。',
  },
  zeroWidth: {
    id: 'zeroWidth',
    label: '零宽字符插入',
    summary: '在每个字素簇后面插入 U+200B、U+200C、U+200D、U+FEFF 之一，按顺序循环。',
    note:
      '按字素簇插入，避免把 emoji 的 ZWJ 序列或组合字符拆散。其中 U+200D 还可能把相邻的 emoji 连成一个字形。',
    warning:
      '零宽字符会破坏搜索、复制粘贴与部分系统的显示（字符看似不存在，却参与长度与比较），' +
      '而且不少平台会直接过滤掉它们 —— 粘贴到聊天窗口、表单或某些编辑器中就会消失。' +
      '因此它作为混淆并不可靠：过滤掉之后混淆就没了，没过滤掉则下游的检索与比较会出错。',
  },
  reverse: {
    id: 'reverse',
    label: '反转',
    summary: '按字素簇整体反转顺序，代理对与组合字符不会被拆开。',
    note:
      '码位顺序改变，但没有字符被替换。反转是自身的逆操作，因此无原文也能精确还原。' +
      '阿拉伯语等从右到左的文字反转后，显示顺序与码位顺序的对应关系会变得反直觉。',
  },
};

/** Toggle state kept by the UI, one flag per transform. */
export interface PipelineOptions {
  leet: boolean;
  homoglyph: false | HomoglyphDirection;
  fullwidth: false | FullwidthDirection;
  alternating: boolean;
  prefix: boolean;
  zeroWidth: boolean;
  reverse: boolean;
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  leet: false,
  homoglyph: false,
  fullwidth: false,
  alternating: false,
  prefix: false,
  zeroWidth: false,
  reverse: false,
};

/** The canonical step for a transform, used when a step is enabled. */
export function defaultConfig(id: TransformId): StepConfig {
  if (id === 'homoglyph') return { id: 'homoglyph', direction: 'toLookalike' };
  if (id === 'fullwidth') return { id: 'fullwidth', direction: 'toFull' };
  return { id } as StepConfig;
}

/** Turns the toggle state into the ordered pipeline. */
export function configsFor(options: PipelineOptions): StepConfig[] {
  const configs: StepConfig[] = [];
  for (const id of PIPELINE_ORDER) {
    if (id === 'homoglyph') {
      if (options.homoglyph !== false) configs.push({ id, direction: options.homoglyph });
    } else if (id === 'fullwidth') {
      if (options.fullwidth !== false) configs.push({ id, direction: options.fullwidth });
    } else if (options[id]) {
      configs.push(defaultConfig(id));
    }
  }
  return configs;
}

/** Human readable name of one step, including its direction. */
export function stepLabel(config: StepConfig): string {
  switch (config.id) {
    case 'homoglyph':
      return config.direction === 'toLookalike' ? '同形字替换（拉丁 → 同形）' : '同形字替换（同形 → 拉丁）';
    case 'fullwidth':
      return config.direction === 'toFull' ? '全半角转换（半角 → 全角）' : '全半角转换（全角 → 半角）';
    default:
      return TRANSFORM_META[config.id].label;
  }
}

// ---------------------------------------------------------------------------
// Grapheme segmentation and code point helpers
// ---------------------------------------------------------------------------

/**
 * Built once at module load.
 *
 * `Intl.Segmenter` is present in every browser and Node version this project
 * targets, but it is not a hard requirement: falling back to code points still
 * keeps surrogate pairs intact, which is the failure mode that actually
 * corrupts text. Only grapheme level grouping (combining marks, emoji ZWJ
 * sequences) is lost in that fallback.
 */
const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Splits text into user perceived characters. */
export function toGraphemes(text: string): string[] {
  if (text === '') return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
  }
  return Array.from(text);
}

/** Splits text into Unicode code points (never into lone surrogates). */
export function toCodePoints(text: string): string[] {
  return Array.from(text);
}

/** Number of user perceived characters. */
export function graphemeCount(text: string): number {
  return toGraphemes(text).length;
}

/** Number of Unicode code points. */
export function codePointCount(text: string): number {
  return toCodePoints(text).length;
}

/** Formats a code point the way the Unicode charts do. */
export function codePointLabel(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** A printable stand-in for a character that has no visible glyph. */
export function charDisplay(char: string): string {
  if (char === '') return '（空）';
  if (char === ' ') return '␠';
  if (char === '\t') return '→';
  if (char === '\n') return '⏎';
  if (char === '\r') return '␍';
  return char;
}

/** Names for the characters this tool inserts that have no visible glyph. */
export const INVISIBLE_NAMES: Record<number, string> = {
  0x20: 'SPACE',
  0x5c: 'REVERSE SOLIDUS（反斜杠）',
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE（BOM）',
  0xff21: 'FULLWIDTH LATIN CAPITAL LETTER A',
};

/** A short name to show beside a code point in the comparison table. */
export function charName(char: string): string {
  if (char === '') return '插入';
  return INVISIBLE_NAMES[char.codePointAt(0) ?? -1] ?? '';
}

// ---------------------------------------------------------------------------
// leet
// ---------------------------------------------------------------------------

/**
 * The forward leet map, keyed by lower case letter.
 *
 * The interesting entries are the collisions: `i` and `l` both become `1`.
 * That is what makes the reverse direction genuinely ambiguous rather than
 * merely case sensitive, and the reverse candidate table below is derived from
 * this map so the two can never drift apart.
 */
export const LEET_FORWARD: Record<string, string> = {
  a: '4',
  b: '8',
  e: '3',
  g: '9',
  i: '1',
  l: '1',
  o: '0',
  s: '5',
  t: '7',
};

/**
 * Reverse leet candidates, derived from `LEET_FORWARD`.
 *
 * The original character itself is included for every digit, because a digit
 * that was already in the source text is left untouched by the forward pass and
 * is indistinguishable from one the pass produced. Ordering is chosen for
 * readability: letters first, the literal digit last. `candidates[0]` is the
 * best effort answer used when the original is not available.
 */
export const LEET_REVERSE: Record<string, string[]> = (() => {
  const table: Record<string, string[]> = {};
  const digits = new Set(Object.values(LEET_FORWARD));
  for (const digit of digits) {
    const letters: string[] = [];
    for (const [letter, mapped] of Object.entries(LEET_FORWARD)) {
      if (mapped !== digit) continue;
      letters.push(letter, letter.toUpperCase());
    }
    table[digit] = [...new Set(letters), digit];
  }
  return table;
})();

// ---------------------------------------------------------------------------
// homoglyphs
// ---------------------------------------------------------------------------

export interface HomoglyphEntry {
  /** The Latin letter being imitated. */
  latin: string;
  /** The confusable character. */
  lookalike: string;
  script: 'Cyrillic' | 'Greek';
  /** The character name, for display only. */
  name: string;
  /**
   * Whether this entry is the one the forward pass picks when a Latin letter has
   * several lookalikes. Cyrillic is preferred where it exists, matching the six
   * letters the tool documents (a e o p c x).
   */
  preferred: boolean;
}

/**
 * Confusable characters that render like Latin letters.
 *
 * Every entry was checked against the Unicode code charts: the lookalike is a
 * different code point from the Latin letter it imitates, and `normalize('NFKC')`
 * does **not** fold it back. That second property is what makes these useful for
 * obfuscation and dangerous for everyone else — the full width forms below, by
 * contrast, are folded by NFKC, which is why they belong to a different
 * transform.
 */
export const HOMOGLYPH_TABLE: HomoglyphEntry[] = [
  { latin: 'a', lookalike: '\u0430', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER A', preferred: true },
  { latin: 'e', lookalike: '\u0435', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER IE', preferred: true },
  { latin: 'o', lookalike: '\u043E', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER O', preferred: true },
  { latin: 'p', lookalike: '\u0440', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER ER', preferred: true },
  { latin: 'c', lookalike: '\u0441', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER ES', preferred: true },
  { latin: 'x', lookalike: '\u0445', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER HA', preferred: true },
  { latin: 'y', lookalike: '\u0443', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER U', preferred: true },
  { latin: 'i', lookalike: '\u0456', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I', preferred: true },
  { latin: 's', lookalike: '\u0455', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER DZE', preferred: true },
  { latin: 'j', lookalike: '\u0458', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER JE', preferred: true },
  { latin: 'h', lookalike: '\u04BB', script: 'Cyrillic', name: 'CYRILLIC SMALL LETTER SHHA', preferred: true },
  { latin: 'A', lookalike: '\u0410', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER A', preferred: true },
  { latin: 'B', lookalike: '\u0412', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER VE', preferred: true },
  { latin: 'E', lookalike: '\u0415', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER IE', preferred: true },
  { latin: 'H', lookalike: '\u041D', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER EN', preferred: true },
  { latin: 'I', lookalike: '\u0406', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER BYELORUSSIAN-UKRAINIAN I', preferred: true },
  { latin: 'K', lookalike: '\u041A', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER KA', preferred: true },
  { latin: 'M', lookalike: '\u041C', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER EM', preferred: true },
  { latin: 'O', lookalike: '\u041E', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER O', preferred: true },
  { latin: 'P', lookalike: '\u0420', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER ER', preferred: true },
  { latin: 'C', lookalike: '\u0421', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER ES', preferred: true },
  { latin: 'T', lookalike: '\u0422', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER TE', preferred: true },
  { latin: 'X', lookalike: '\u0425', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER HA', preferred: true },
  { latin: 'Y', lookalike: '\u0423', script: 'Cyrillic', name: 'CYRILLIC CAPITAL LETTER U', preferred: true },
  { latin: 'o', lookalike: '\u03BF', script: 'Greek', name: 'GREEK SMALL LETTER OMICRON', preferred: false },
  { latin: 'a', lookalike: '\u03B1', script: 'Greek', name: 'GREEK SMALL LETTER ALPHA', preferred: false },
  { latin: 'e', lookalike: '\u03B5', script: 'Greek', name: 'GREEK SMALL LETTER EPSILON', preferred: false },
  { latin: 'i', lookalike: '\u03B9', script: 'Greek', name: 'GREEK SMALL LETTER IOTA', preferred: false },
  { latin: 'k', lookalike: '\u03BA', script: 'Greek', name: 'GREEK SMALL LETTER KAPPA', preferred: true },
  { latin: 'v', lookalike: '\u03BD', script: 'Greek', name: 'GREEK SMALL LETTER NU', preferred: true },
  { latin: 'p', lookalike: '\u03C1', script: 'Greek', name: 'GREEK SMALL LETTER RHO', preferred: false },
  { latin: 't', lookalike: '\u03C4', script: 'Greek', name: 'GREEK SMALL LETTER TAU', preferred: true },
  { latin: 'u', lookalike: '\u03C5', script: 'Greek', name: 'GREEK SMALL LETTER UPSILON', preferred: true },
  { latin: 'x', lookalike: '\u03C7', script: 'Greek', name: 'GREEK SMALL LETTER CHI', preferred: false },
  { latin: 'A', lookalike: '\u0391', script: 'Greek', name: 'GREEK CAPITAL LETTER ALPHA', preferred: false },
  { latin: 'B', lookalike: '\u0392', script: 'Greek', name: 'GREEK CAPITAL LETTER BETA', preferred: false },
  { latin: 'E', lookalike: '\u0395', script: 'Greek', name: 'GREEK CAPITAL LETTER EPSILON', preferred: false },
  { latin: 'H', lookalike: '\u0397', script: 'Greek', name: 'GREEK CAPITAL LETTER ETA', preferred: false },
  { latin: 'I', lookalike: '\u0399', script: 'Greek', name: 'GREEK CAPITAL LETTER IOTA', preferred: false },
  { latin: 'K', lookalike: '\u039A', script: 'Greek', name: 'GREEK CAPITAL LETTER KAPPA', preferred: false },
  { latin: 'M', lookalike: '\u039C', script: 'Greek', name: 'GREEK CAPITAL LETTER MU', preferred: false },
  { latin: 'N', lookalike: '\u039D', script: 'Greek', name: 'GREEK CAPITAL LETTER NU', preferred: true },
  { latin: 'O', lookalike: '\u039F', script: 'Greek', name: 'GREEK CAPITAL LETTER OMICRON', preferred: false },
  { latin: 'P', lookalike: '\u03A1', script: 'Greek', name: 'GREEK CAPITAL LETTER RHO', preferred: false },
  { latin: 'T', lookalike: '\u03A4', script: 'Greek', name: 'GREEK CAPITAL LETTER TAU', preferred: false },
  { latin: 'Y', lookalike: '\u03A5', script: 'Greek', name: 'GREEK CAPITAL LETTER UPSILON', preferred: false },
  { latin: 'X', lookalike: '\u03A7', script: 'Greek', name: 'GREEK CAPITAL LETTER CHI', preferred: false },
];

/** Latin to the preferred lookalike. Built so a duplicate can never silently win. */
const HOMOGLYPH_FORWARD: Map<string, HomoglyphEntry> = (() => {
  const map = new Map<string, HomoglyphEntry>();
  for (const entry of HOMOGLYPH_TABLE) {
    if (entry.preferred) map.set(entry.latin, entry);
  }
  return map;
})();

/** Lookalike to its Latin original. Unique by construction. */
const HOMOGLYPH_TO_LATIN: Map<string, HomoglyphEntry> = new Map(
  HOMOGLYPH_TABLE.map((entry) => [entry.lookalike, entry]),
);

/** Every lookalike that imitates a given Latin letter, preferred entry first. */
const HOMOGLYPH_ALTERNATIVES: Map<string, HomoglyphEntry[]> = (() => {
  const map = new Map<string, HomoglyphEntry[]>();
  for (const entry of HOMOGLYPH_TABLE) {
    const list = map.get(entry.latin) ?? [];
    if (entry.preferred) list.unshift(entry);
    else list.push(entry);
    map.set(entry.latin, list);
  }
  return map;
})();

/** Exposed for the checker: the preferred lookalike of a Latin letter. */
export function preferredLookalike(latin: string): string | null {
  return HOMOGLYPH_FORWARD.get(latin)?.lookalike ?? null;
}

/** Exposed for display: every lookalike of a Latin letter. */
export function lookalikesOf(latin: string): HomoglyphEntry[] {
  return HOMOGLYPH_ALTERNATIVES.get(latin) ?? [];
}

// ---------------------------------------------------------------------------
// full width
// ---------------------------------------------------------------------------

/** U+0021 to U+007E map to U+FF01 to U+FF5E with this offset. */
const FULLWIDTH_OFFSET = 0xfee0;
const ASCII_PRINTABLE_START = 0x21;
const ASCII_PRINTABLE_END = 0x7e;
const FULLWIDTH_PRINTABLE_START = 0xff01;
const FULLWIDTH_PRINTABLE_END = 0xff5e;
const ASCII_SPACE = 0x20;
const IDEOGRAPHIC_SPACE = 0x3000;

// ---------------------------------------------------------------------------
// zero width characters and the prefix marker
// ---------------------------------------------------------------------------

/**
 * The inserted invisible characters, in the order they cycle.
 *
 * All four have zero advance width. U+200D is a joiner, so inserting it next to
 * an emoji can merge two glyphs — noted in the UI because it is exactly the kind
 * of display damage this transform is warned about.
 */
export const ZERO_WIDTH_CHARS: string[] = ['\u200b', '\u200c', '\u200d', '\ufeff'];

export const PREFIX_MARKER = '\\';

const ZERO_WIDTH_SET = new Set(ZERO_WIDTH_CHARS);

/** Number of characters in this set that appear in the text. */
export function countZeroWidth(text: string): number {
  let count = 0;
  for (const char of text) if (ZERO_WIDTH_SET.has(char)) count += 1;
  return count;
}

/** Number of prefix markers in the text. */
export function countPrefixMarkers(text: string): number {
  let count = 0;
  for (const char of text) if (char === PREFIX_MARKER) count += 1;
  return count;
}

/** The distinct lookalike characters present in the text. */
export function findLookalikes(text: string): HomoglyphEntry[] {
  const found = new Map<string, HomoglyphEntry>();
  for (const char of text) {
    const entry = HOMOGLYPH_TO_LATIN.get(char);
    if (entry) found.set(entry.lookalike, entry);
  }
  return [...found.values()];
}

/** Number of characters that are full width forms covered by this tool. */
export function countFullwidth(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? -1;
    if (code === IDEOGRAPHIC_SPACE) count += 1;
    else if (code >= FULLWIDTH_PRINTABLE_START && code <= FULLWIDTH_PRINTABLE_END) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Applying a step
// ---------------------------------------------------------------------------

/** One character level change, recorded for the comparison table. */
export interface CodePointEdit {
  /** Code point index within this step's input. */
  index: number;
  /** The character before the change, or an empty string for an insertion. */
  from: string;
  fromCode: number | null;
  /** The character after the change, or an empty string for a removal. */
  to: string;
  toCode: number | null;
  /** Why this happened, in the reader's words. */
  note: string;
}

/** Result of applying one step. */
export interface StepResult {
  config: StepConfig;
  label: string;
  input: string;
  output: string;
  edits: CodePointEdit[];
  /** Free text for steps that cannot be described character by character. */
  summary?: string;
}

function editAt(index: number, from: string, to: string, note: string): CodePointEdit {
  return {
    index,
    from,
    fromCode: from === '' ? null : (from.codePointAt(0) ?? null),
    to,
    toCode: to === '' ? null : (to.codePointAt(0) ?? null),
    note,
  };
}

/**
 * Applies a transform to a single character, ignoring context.
 *
 * Only valid for the position preserving steps (leet, homoglyph, full width,
 * alternating); it exists so the inverse can check "would this candidate
 * character have produced the character I see here", which is how the original
 * text is used to resolve ambiguity without being trusted blindly.
 */
export function applyChar(config: StepConfig, char: string, index: number): string {
  switch (config.id) {
    case 'leet': {
      if (char.length !== 1) return char;
      return LEET_FORWARD[char.toLowerCase()] ?? char;
    }
    case 'homoglyph': {
      if (config.direction === 'toLookalike') {
        return HOMOGLYPH_FORWARD.get(char)?.lookalike ?? char;
      }
      return HOMOGLYPH_TO_LATIN.get(char)?.latin ?? char;
    }
    case 'fullwidth': {
      const code = char.codePointAt(0);
      if (code === undefined) return char;
      if (config.direction === 'toFull') {
        if (code === ASCII_SPACE) return String.fromCodePoint(IDEOGRAPHIC_SPACE);
        if (code >= ASCII_PRINTABLE_START && code <= ASCII_PRINTABLE_END) {
          return String.fromCodePoint(code + FULLWIDTH_OFFSET);
        }
        return char;
      }
      if (code === IDEOGRAPHIC_SPACE) return String.fromCodePoint(ASCII_SPACE);
      if (code >= FULLWIDTH_PRINTABLE_START && code <= FULLWIDTH_PRINTABLE_END) {
        return String.fromCodePoint(code - FULLWIDTH_OFFSET);
      }
      return char;
    }
    case 'alternating': {
      const mapped = index % 2 === 0 ? char.toLowerCase() : char.toUpperCase();
      // A few case mappings change length (`İ` lowercases to two code points,
      // `ß` uppercases to two letters). Applying one would shift every later
      // position, and the step is defined position by position, so those
      // characters are left alone instead.
      return Array.from(mapped).length === 1 ? mapped : char;
    }
    default:
      return char;
  }
}

/** Whether a step works character by character at a fixed index. */
function isPositionPreserving(id: TransformId): boolean {
  return id === 'leet' || id === 'homoglyph' || id === 'fullwidth' || id === 'alternating';
}

function applyPositionPreserving(
  config: StepConfig,
  input: string,
  note: (char: string, mapped: string, index: number) => string,
): { output: string; edits: CodePointEdit[] } {
  const points = toCodePoints(input);
  const edits: CodePointEdit[] = [];
  let output = '';
  points.forEach((char, index) => {
    const mapped = applyChar(config, char, index);
    output += mapped;
    if (mapped !== char) edits.push(editAt(index, char, mapped, note(char, mapped, index)));
  });
  return { output, edits };
}

function applyBody(config: StepConfig, input: string): { output: string; edits: CodePointEdit[]; summary?: string } {
  switch (config.id) {
    case 'leet':
      return applyPositionPreserving(
        config,
        input,
        (char) => `leet 替换：${char} 换成 ${LEET_FORWARD[char.toLowerCase()] ?? ''}`,
      );

    case 'homoglyph': {
      if (config.direction === 'toLookalike') {
        return applyPositionPreserving(config, input, (char, mapped) => {
          const entry = HOMOGLYPH_FORWARD.get(char);
          return `同形字：拉丁 ${char} 换成 ${entry?.script ?? ''} ${mapped}，外观相同但码位不同`;
        });
      }
      return applyPositionPreserving(config, input, (char, mapped) => {
        const entry = HOMOGLYPH_TO_LATIN.get(char);
        return `同形字还原：${entry?.script ?? ''} ${char} 换回拉丁 ${mapped}`;
      });
    }

    case 'fullwidth':
      return applyPositionPreserving(config, input, (char, mapped) =>
        config.direction === 'toFull'
          ? `全角化：${char} 换成全角形式 ${mapped}`
          : `半角化：${char} 换成半角形式 ${mapped}`,
      );

    case 'alternating':
      return applyPositionPreserving(
        config,
        input,
        (_char, mapped, index) =>
          `大小写交替：第 ${index} 位按${index % 2 === 0 ? '偶' : '奇'}数位规则换成 ${mapped}（原始大小写被覆盖）`,
      );

    case 'prefix': {
      const graphemes = toGraphemes(input);
      const edits: CodePointEdit[] = [];
      let output = '';
      let cursor = 0;
      for (const grapheme of graphemes) {
        edits.push(editAt(cursor, '', PREFIX_MARKER, `在每个字素簇（${charDisplay(grapheme)}）前插入标记`));
        output += PREFIX_MARKER + grapheme;
        cursor += toCodePoints(grapheme).length;
      }
      return { output, edits };
    }

    case 'zeroWidth': {
      const graphemes = toGraphemes(input);
      const edits: CodePointEdit[] = [];
      let output = '';
      let cursor = 0;
      graphemes.forEach((grapheme, index) => {
        const inserted = ZERO_WIDTH_CHARS[index % ZERO_WIDTH_CHARS.length];
        edits.push(editAt(cursor, '', inserted, `在第 ${index + 1} 个字素簇后插入 ${charName(inserted)}（不可见）`));
        output += grapheme + inserted;
        cursor += toCodePoints(grapheme).length;
      });
      return { output, edits };
    }

    case 'reverse': {
      const graphemes = toGraphemes(input);
      const output = [...graphemes].reverse().join('');
      return {
        output,
        edits: [],
        summary:
          `按 ${graphemes.length} 个字素簇整体反转：码位顺序改变，但没有字符被替换或增删，` +
          '所以这里没有逐字符的替换项。',
      };
    }
  }
}

/** Applies one step and records what changed. */
export function applyStep(config: StepConfig, input: string): StepResult {
  const body = applyBody(config, input);
  return {
    config,
    label: stepLabel(config),
    input,
    output: body.output,
    edits: body.edits,
    summary: body.summary,
  };
}

/** Result of running a whole pipeline. */
export interface PipelineResult {
  configs: StepConfig[];
  steps: StepResult[];
  output: string;
}

/** Applies every step in order. */
export function applyPipeline(configs: StepConfig[], input: string): PipelineResult {
  const steps: StepResult[] = [];
  let current = input;
  for (const config of configs) {
    const result = applyStep(config, current);
    steps.push(result);
    current = result.output;
  }
  return { configs, steps, output: current };
}

// ---------------------------------------------------------------------------
// Inverting a step
// ---------------------------------------------------------------------------

/** A position in the obfuscated text whose original value is not unique. */
export interface Ambiguity {
  /** Code point index within the obfuscated text. */
  index: number;
  char: string;
  code: number;
  /** Every character that could have produced `char`. */
  candidates: string[];
  note: string;
}

/** Result of inverting one step. */
export interface InvertResult {
  config: StepConfig;
  label: string;
  /** The obfuscated text handed in. */
  input: string;
  output: string;
  ambiguities: Ambiguity[];
  /** True when at least one position has several possible origins. */
  uncertain: boolean;
  /** True when the original was supplied and re-applying the step reproduces the input. */
  verified: boolean;
  /** True when re-applying the step to this output reproduces the input. */
  reapplies: boolean;
  notes: string[];
}

/**
 * Candidate originals for one character, or `null` when the character cannot
 * have been produced by this step at all.
 *
 * The character itself is always a candidate when the step leaves its source
 * range untouched as well: a full width `Ａ` in a `toFull` output may have come
 * from an ASCII `A` or have been full width already, and there is no way to tell
 * from the output alone.
 */
function inverseCandidates(config: StepConfig, char: string): string[] | null {
  switch (config.id) {
    case 'leet': {
      const candidates = LEET_REVERSE[char];
      return candidates ? candidates : null;
    }
    case 'homoglyph': {
      if (config.direction === 'toLookalike') {
        const entry = HOMOGLYPH_TO_LATIN.get(char);
        // The inverse is unique, but the original may also have been the Latin
        // letter itself, which the forward pass left alone.
        if (entry) return [entry.latin];
        return null;
      }
      const entries = HOMOGLYPH_ALTERNATIVES.get(char);
      if (!entries) return null;
      return [...entries.map((entry) => entry.lookalike), char];
    }
    case 'fullwidth': {
      const code = char.codePointAt(0);
      if (code === undefined) return null;
      // A plain bijection on the covered range. It is not injective over all
      // text (a full width character that was already there is left alone by the
      // forward pass), but listing "or the character itself" at every position
      // would flag every character of an ordinary conversion; that limitation is
      // stated in a note instead.
      if (config.direction === 'toFull') {
        if (code === IDEOGRAPHIC_SPACE) return [String.fromCodePoint(ASCII_SPACE)];
        if (code >= FULLWIDTH_PRINTABLE_START && code <= FULLWIDTH_PRINTABLE_END) {
          return [String.fromCodePoint(code - FULLWIDTH_OFFSET)];
        }
        return null;
      }
      if (code === ASCII_SPACE) return [String.fromCodePoint(IDEOGRAPHIC_SPACE)];
      if (code >= ASCII_PRINTABLE_START && code <= ASCII_PRINTABLE_END) {
        return [String.fromCodePoint(code + FULLWIDTH_OFFSET)];
      }
      return null;
    }
    case 'alternating': {
      const lowered = char.toLowerCase();
      const uppered = char.toUpperCase();
      const candidates = [...new Set([lowered, uppered, char])];
      return candidates;
    }
    default:
      return null;
  }
}

function invertPositionPreserving(config: StepConfig, input: string): {
  output: string;
  ambiguities: Ambiguity[];
  notes: string[];
} {
  const points = toCodePoints(input);
  const ambiguities: Ambiguity[] = [];
  const notes: string[] = [];
  let output = '';

  points.forEach((char, index) => {
    const candidates = inverseCandidates(config, char);
    if (candidates) {
      output += candidates[0];
      if (candidates.length > 1) {
        ambiguities.push({
          index,
          char,
          code: char.codePointAt(0) ?? 0,
          candidates,
          note:
            config.id === 'leet'
              ? '这一位可能来自多个字母，也可能本来就是数字'
              : config.id === 'homoglyph'
                ? '这一位可能来自多个同形字，也可能本来就是拉丁字母'
                : config.id === 'fullwidth'
                  ? '这一位可能来自转换，也可能本来就是目标形态'
                  : '这一位的原始大小写无法从结果推断',
        });
      }
    } else {
      output += char;
    }
  });

  if (config.id === 'alternating') {
    notes.push('大小写交替覆盖了原始大小写：没有原文时只能全部转成小写，字母数量与用词不受影响。');
  }
  if (config.id === 'fullwidth') {
    notes.push(
      '全半角在覆盖范围内是一一对应的，但原文里本来就处于目标形态的字符无法与转换产生的区分' +
        '（例如半角转全角时，原文里已有的全角字符会被原样保留，还原时会被一并转回半角），这种情况只有原文能确定。',
    );
  }
  return { output, ambiguities, notes };
}

function invertNaive(config: StepConfig, input: string): {
  output: string;
  ambiguities: Ambiguity[];
  notes: string[];
} {
  if (isPositionPreserving(config.id)) return invertPositionPreserving(config, input);

  if (config.id === 'reverse') {
    return {
      output: [...toGraphemes(input)].reverse().join(''),
      ambiguities: [],
      notes: [
        '按字素簇反转是自身的逆操作，因此普通文本无原文也能精确还原。' +
          '例外是文本以孤立的组合字符或连接符开头的情形：反转后字素簇边界会变化，' +
          '此时需要原文才能确定原来的边界。',
      ],
    };
  }

  if (config.id === 'prefix') {
    return {
      output: toCodePoints(input)
        .filter((char) => char !== PREFIX_MARKER)
        .join(''),
      ambiguities: [],
      notes: ['删除了全部反斜杠；原文中本来就存在的反斜杠会一并被删掉，这是没有原文时的固有限制。'],
    };
  }

  // zeroWidth
  return {
    output: toCodePoints(input)
      .filter((char) => !ZERO_WIDTH_SET.has(char))
      .join(''),
    ambiguities: [],
    notes: ['删除了全部零宽字符；原文中本来就存在的零宽字符会一并被删掉，这是没有原文时的固有限制。'],
  };
}

/** Rebuilds the input of a prefix step from its output using the original. */
function resolvePrefix(input: string, original: string): string | null {
  const graphemes = toGraphemes(original);
  let cursor = 0;
  let output = '';
  for (const grapheme of graphemes) {
    if (!input.startsWith(PREFIX_MARKER + grapheme, cursor)) return null;
    output += grapheme;
    cursor += PREFIX_MARKER.length + grapheme.length;
  }
  return cursor === input.length ? output : null;
}

/** Rebuilds the input of a zero width step from its output using the original. */
function resolveZeroWidth(input: string, original: string): string | null {
  const graphemes = toGraphemes(original);
  let cursor = 0;
  let output = '';
  for (let index = 0; index < graphemes.length; index += 1) {
    const grapheme = graphemes[index];
    const inserted = ZERO_WIDTH_CHARS[index % ZERO_WIDTH_CHARS.length];
    if (!input.startsWith(grapheme + inserted, cursor)) return null;
    output += grapheme;
    cursor += grapheme.length + inserted.length;
  }
  return cursor === input.length ? output : null;
}

/**
 * Rebuilds the input of a reverse step from its output using the original.
 *
 * Reversing by grapheme clusters is not always its own inverse: a string that
 * begins with a combining mark or a joiner (anything the Unicode rules attach to
 * a preceding base) is segmented differently once reversed, because there is no
 * longer a base in front of it. The original still says where the cluster
 * boundaries were, so the input is rebuilt cluster by cluster here, and the
 * result is then proved by re-reversing.
 */
function resolveReverse(input: string, original: string): string | null {
  const graphemes = toGraphemes(original);
  const parts = new Array<string>(graphemes.length);
  let cursor = 0;
  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    const grapheme = graphemes[index];
    if (!input.startsWith(grapheme, cursor)) return null;
    parts[index] = grapheme;
    cursor += grapheme.length;
  }
  return cursor === input.length ? parts.join('') : null;
}

/**
 * Resolves every position against the original, then proves the answer.
 *
 * The candidate is accepted only if re-applying the forward step to it
 * reproduces the obfuscated text exactly. That keeps the original from being
 * taken on faith: a mismatched original is detected rather than silently copied.
 */
function resolveWithOracle(config: StepConfig, input: string, original: string): string | null {
  let candidate: string | null = null;

  if (isPositionPreserving(config.id)) {
    const seen = toCodePoints(input);
    const source = toCodePoints(original);
    if (seen.length !== source.length) return null;
    candidate = seen
      .map((char, index) => (applyChar(config, source[index], index) === char ? source[index] : char))
      .join('');
  } else if (config.id === 'prefix') {
    candidate = resolvePrefix(input, original);
  } else if (config.id === 'zeroWidth') {
    candidate = resolveZeroWidth(input, original);
  } else {
    candidate = resolveReverse(input, original);
  }

  if (candidate === null) return null;
  return applyBody(config, candidate).output === input ? candidate : null;
}

/**
 * Inverts one step.
 *
 * `original` is the text the step was applied to. Supplying it turns a best
 * effort answer into a verified one wherever the transform is not one to one.
 */
export function invertStep(config: StepConfig, input: string, original?: string): InvertResult {
  const naive = invertNaive(config, input);
  const reapplies = applyBody(config, naive.output).output === input;
  const base: InvertResult = {
    config,
    label: stepLabel(config),
    input,
    output: naive.output,
    ambiguities: naive.ambiguities,
    // A best effort answer that cannot be re-applied to reproduce the input is
    // not a valid preimage at all, so it is reported as uncertain rather than
    // presented as a result.
    uncertain: naive.ambiguities.length > 0 || config.id === 'alternating' || !reapplies,
    verified: false,
    reapplies,
    notes: naive.notes,
  };

  if (original === undefined) return base;

  const resolved = resolveWithOracle(config, input, original);
  if (resolved === null) {
    return {
      ...base,
      notes: [
        ...base.notes,
        '提供的原文与该混淆文本对不上（重新正向变换无法复现输入），已退回不依赖原文的尽力还原。',
      ],
    };
  }

  return {
    ...base,
    output: resolved,
    ambiguities: [],
    uncertain: false,
    verified: true,
    reapplies: true,
    notes: [...base.notes, '已用原文逐位消歧，并重新正向变换验证通过。'],
  };
}

/** Result of reverting a whole pipeline. */
export interface PipelineRevertResult {
  /** Steps in the order they were reverted, which is the reverse of the apply order. */
  steps: InvertResult[];
  output: string;
  ambiguities: Ambiguity[];
  uncertain: boolean;
  /** True when every step was resolved against the original and verified. */
  verified: boolean;
  /** True when the supplied original actually produces the text being reverted. */
  matchesForward: boolean;
}

/**
 * Reverts a pipeline by walking the steps backwards.
 *
 * The order is not cosmetic: a later step can transform the very characters an
 * earlier step produced (full width turns a leet `1` into `１`, which the leet
 * inverse no longer recognises), so undoing in any other order gives a different
 * and wrong answer.
 */
export function revertPipeline(
  configs: StepConfig[],
  input: string,
  original?: string,
): PipelineRevertResult {
  const forward = original === undefined ? null : applyPipeline(configs, original);
  const matchesForward = forward !== null && forward.output === input;
  let current = input;
  const steps: InvertResult[] = [];

  for (let index = configs.length - 1; index >= 0; index -= 1) {
    const oracle = forward !== null && matchesForward ? forward.steps[index].input : undefined;
    const result = invertStep(configs[index], current, oracle);
    steps.push(result);
    current = result.output;
  }

  const ambiguities = steps.flatMap((step) => step.ambiguities);
  return {
    steps,
    output: current,
    ambiguities,
    uncertain: steps.some((step) => step.uncertain),
    verified: steps.length > 0 && steps.every((step) => step.verified),
    matchesForward,
  };
}

/** The order in which the given pipeline has to be reverted. */
export function revertOrder(configs: StepConfig[]): string[] {
  return [...configs].reverse().map(stepLabel);
}

// ---------------------------------------------------------------------------
// Enumerating the leet candidates
// ---------------------------------------------------------------------------

export interface LeetEnumeration {
  /** Candidate strings, at most `limit` of them. */
  candidates: string[];
  /** How many combinations exist in total, including the ones not listed. */
  total: number;
  truncated: boolean;
}

/**
 * Every string the given text could have been before leet replacement.
 *
 * This is the honest form of the answer: for `1` alone there are five, and the
 * count grows multiplicatively, so a long digit string has thousands of
 * readings. The caller gets a bounded list plus the true total rather than a
 * single string presented as if it were the original.
 */
export function enumerateLeetCandidates(text: string, limit = 256): LeetEnumeration {
  const points = toCodePoints(text);
  let candidates: string[] = [''];
  let total = 1;

  for (const char of points) {
    const options = LEET_REVERSE[char] ?? [char];
    total *= options.length;
    if (candidates.length === 0) continue;
    const next: string[] = [];
    for (const prefix of candidates) {
      for (const option of options) {
        if (next.length >= limit) break;
        next.push(prefix + option);
      }
      if (next.length >= limit) break;
    }
    candidates = next;
  }

  return { candidates, total, truncated: total > candidates.length };
}

// ---------------------------------------------------------------------------
// Sample input
// ---------------------------------------------------------------------------

export const MAX_INPUT_CHARS = 20_000;

/**
 * A sample that exercises every failure mode at once: ASCII letters for leet and
 * homoglyphs, an emoji surrogate pair, a combining mark, Chinese text and
 * Arabic. Whatever the reader switches on, something in the table below will
 * show an interesting change.
 */
export const SAMPLE_INPUT = 'Hello 汉字 e\u0301 😀 1234 مرحبا';
