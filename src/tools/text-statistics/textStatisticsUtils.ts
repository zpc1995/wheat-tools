/**
 * Text measurement primitives for the detailed statistics tool.
 *
 * The reason this module exists at all is that "how long is this text?" has
 * four different correct answers, and different programs quote different ones:
 *
 *   - code points   `[...str].length`            what most people mean by 字符
 *   - UTF-16 units  `str.length`                 what JavaScript strings count,
 *                                                and what most editors report
 *   - UTF-8 bytes   `TextEncoder`                what the text costs on disk or
 *                                                over the network
 *   - graphemes     `Intl.Segmenter`             what a human sees as one
 *                                                character
 *
 * For `😀` those are 1 / 2 / 4 / 1. For a decomposed `é` (`e` + U+0301) they are
 * 2 / 2 / 3 / 1. A tool that shows only one number is not wrong so much as
 * incomplete, so this one shows all four and never adds them together.
 *
 * The only external dependency is `Intl.Segmenter`, which is the platform's
 * UAX #29 grapheme segmenter and therefore the authority on grapheme counts.
 * There is a documented approximation for engines without it; it is exercised
 * against `Intl.Segmenter` by the check script rather than assumed to be exact.
 *
 * Nothing here touches React, the DOM or a clock: every function is
 * `string → value`, so the whole module is testable directly under Node.
 */

/** One measured scalar quantity of a text. */
export interface TextMeasurements {
  /** Code points: `[...input].length`. */
  codePoints: number;
  /** Code points that are not Unicode whitespace. */
  codePointsNoWhitespace: number;
  /** UTF-16 code units: `input.length`. */
  utf16Units: number;
  /** Bytes when encoded as UTF-8. */
  utf8Bytes: number;
  /** Grapheme clusters, i.e. what a reader perceives as characters. */
  graphemes: number;
  /** Lines. An empty string counts as 0 lines, not 1. */
  lines: number;
  /** Lines that contain something other than whitespace. */
  nonEmptyLines: number;
  /** Paragraphs: runs of lines separated by at least one blank line. */
  paragraphs: number;
  /** Sentences, estimated from sentence-final punctuation. */
  sentences: number;
}

/** Word counts, kept split because the two languages count differently. */
export interface WordCount {
  total: number;
  /** Han characters, one word each — Chinese has no spaces to split on. */
  chinese: number;
  /** Whitespace-separated tokens of other scripts. */
  latin: number;
}

/** Reading-time estimate, in seconds, with the two halves kept separate. */
export interface ReadingTime {
  totalSeconds: number;
  chineseSeconds: number;
  latinSeconds: number;
}

/**
 * Reading speeds used for the estimate.
 *
 * Chinese: 300 字/分钟, the usual figure quoted for silent reading of Chinese
 * prose. English: 200 词/分钟, a long-standing average for adult readers of
 * English. Both are deliberately coarse — they are order-of-magnitude numbers
 * that depend on the reader and the material, which is why the UI says so.
 */
export const READING_SPEED = {
  chineseCharsPerMinute: 300,
  latinWordsPerMinute: 200,
} as const;

/** One entry of the character-frequency table. */
export interface CharacterFrequency {
  /** The character itself. */
  char: string;
  /** Numeric code point, for stable sorting and for the UI's U+ display. */
  codePoint: number;
  /** `U+1F600` style label. */
  label: string;
  count: number;
  /** Share of all code points in the text, 0–1. */
  ratio: number;
  /** Human-readable Unicode category, e.g. `小写字母 (Ll)`. */
  category: string;
}

/** One bucket of the Unicode category distribution. */
export interface CategoryBucket {
  id: string;
  label: string;
  count: number;
  ratio: number;
}

/** A line, with its length measured in code points rather than UTF-16 units. */
export interface LineStat {
  /** 1-based line number. */
  index: number;
  /** Length in code points. */
  length: number;
  text: string;
}

export interface LineStats {
  longest: LineStat | null;
  /** Shortest *non-empty* line; an empty line would always win otherwise. */
  shortest: LineStat | null;
  /** Mean length of all lines, in code points. */
  average: number;
}

// --- The four counts -------------------------------------------------------

/** Every grapheme cluster of `input`, in order. */
export function graphemeClusters(input: string): string[] {
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    const out: string[] = [];
    for (const piece of segmenter.segment(input)) out.push(piece.segment);
    return out;
  }
  return fallbackGraphemeClusters(input);
}

/**
 * `Intl.Segmenter` instance, created at most once.
 *
 * Constructing a segmenter is not free and the tool re-measures on every
 * keystroke, so it is cached. Creation is wrapped because `Intl.Segmenter`
 * does not exist at all in older engines, and a tool that throws on load is
 * worse than one that falls back to a coarser answer.
 */
let cachedSegmenter: Intl.Segmenter | null | undefined;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (cachedSegmenter === undefined) {
    try {
      cachedSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
    } catch {
      cachedSegmenter = null;
    }
  }
  return cachedSegmenter;
}

function isVariationSelector(codePoint: number): boolean {
  return (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function isSkinTone(codePoint: number): boolean {
  return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

/**
 * The base character a trailing ZWJ sequence is built on.
 *
 * Walks back over joiners, variation selectors and combining marks, because
 * `🏳️‍🌈` is flag + VS16 + ZWJ + rainbow and the character that decides whether
 * the rainbow attaches is the flag, not the variation selector.
 */
function baseBeforeJoiners(input: string): string {
  const chars = [...input];
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const codePoint = chars[i].codePointAt(0) ?? -1;
    if (codePoint === 0x200d || isVariationSelector(codePoint) || /\p{M}/u.test(chars[i])) {
      continue;
    }
    return chars[i];
  }
  return '';
}

/**
 * Coarse stand-in for `Intl.Segmenter`.
 *
 * It joins the cases that actually change a count in practice — combining
 * marks, zero-width joiners, variation selectors, skin-tone modifiers, regional
 * indicator pairs and CRLF — and gives up on the rest. Full UAX #29 is not
 * something to re-implement here; the check script verifies this against
 * `Intl.Segmenter` on a corpus so it cannot quietly rot.
 */
export function fallbackGraphemeClusters(input: string): string[] {
  const clusters: string[] = [];
  let current = '';
  let previousCodePoint = -1;
  let regionalRun = 0;

  for (const char of input) {
    const codePoint = char.codePointAt(0) ?? -1;
    const continues =
      current !== '' &&
      (codePoint === 0x200d ||
        // A joiner only glues the *next* character on when the cluster it
        // trails is an emoji base: `a\u200db` is two clusters, `👨\u200d👩` is
        // one. UAX #29 spells this rule out as extended pictographic + ZWJ.
        (previousCodePoint === 0x200d &&
          /\p{Extended_Pictographic}/u.test(baseBeforeJoiners(current))) ||
        /\p{M}/u.test(char) ||
        isVariationSelector(codePoint) ||
        isSkinTone(codePoint) ||
        (isRegionalIndicator(codePoint) &&
          isRegionalIndicator(previousCodePoint) &&
          regionalRun % 2 === 1) ||
        (previousCodePoint === 0x0d && codePoint === 0x0a));

    if (continues) {
      current += char;
    } else {
      if (current !== '') clusters.push(current);
      current = char;
    }
    regionalRun = isRegionalIndicator(codePoint) ? regionalRun + 1 : 0;
    previousCodePoint = codePoint;
  }

  if (current !== '') clusters.push(current);
  return clusters;
}

export function countCodePoints(input: string): number {
  return [...input].length;
}

export function countUtf16Units(input: string): number {
  return input.length;
}

/**
 * UTF-8 byte length.
 *
 * `TextEncoder` is the platform's authority here. The common bug this replaces
 * is `unescape(encodeURIComponent(s)).length`, which throws on lone surrogates;
 * `TextEncoder` replaces them with U+FFFD instead, which is what the encoding
 * layer actually does.
 */
export function countUtf8Bytes(input: string): number {
  return new TextEncoder().encode(input).length;
}

export function countGraphemes(input: string): number {
  return graphemeClusters(input).length;
}

/** Code points that are not whitespace. */
export function countCodePointsWithoutWhitespace(input: string): number {
  let count = 0;
  for (const char of input) {
    if (!/\s/u.test(char)) count += 1;
  }
  return count;
}

/**
 * Line splitter that treats CRLF, CR and LF alike.
 *
 * Splitting on `'\n'` alone leaves a trailing `\r` on every line of a
 * Windows-saved file, which then counts as an extra character and shifts the
 * longest-line result.
 */
export function splitLines(input: string): string[] {
  return input.split(/\r\n|\r|\n/);
}

export function countLines(input: string): number {
  if (input === '') return 0;
  return splitLines(input).length;
}

export function countNonEmptyLines(input: string): number {
  return splitLines(input).filter((line) => line.trim() !== '').length;
}

/**
 * Paragraphs, where a paragraph is a run of non-blank lines.
 *
 * Whitespace-only lines do not start a new paragraph and do not count as one;
 * `a\n \nb` is two paragraphs, not three.
 */
export function countParagraphs(input: string): number {
  if (input.trim() === '') return 0;
  let paragraphs = 0;
  let inParagraph = false;
  for (const line of splitLines(input)) {
    if (line.trim() === '') {
      inParagraph = false;
    } else if (!inParagraph) {
      paragraphs += 1;
      inParagraph = true;
    }
  }
  return paragraphs;
}

/**
 * Sentence count, estimated from sentence-final punctuation.
 *
 * A terminator run (`...`, `!?`) closes one sentence; the tail after the last
 * terminator counts only if it has non-whitespace in it, so `Hello.` is one
 * sentence rather than two. Abbreviations are not modelled — `e.g. this` reads
 * as two sentences — because doing that properly needs a language model, and a
 * wrong-but-precise number would be worse than a stated approximation.
 */
export function countSentences(input: string): number {
  const parts = input.split(/[.!?。！？…]+/);
  let count = 0;
  for (const part of parts) {
    if (part.trim() !== '') count += 1;
  }
  return count;
}

const HAN = /\p{Script=Han}/u;
const WORD = /[\p{L}\p{N}]+(?:['’\u2019-][\p{L}\p{N}]+)*/gu;

/**
 * Word count with Chinese and non-Chinese kept apart.
 *
 * Chinese is counted per character, because there are no spaces to split on and
 * a "word" would need a dictionary. Everything else is counted as
 * whitespace-delimited tokens; Han characters are blanked out before tokenising
 * so that `你好world` is two words (你好 → 2 Chinese, world → 1 Latin) rather
 * than one glommed token.
 */
export function countWords(input: string): WordCount {
  let chinese = 0;
  let rest = '';
  for (const char of input) {
    if (HAN.test(char)) {
      chinese += 1;
      // A space (not nothing) so that Han characters cannot glue neighbouring
      // Latin tokens together across the boundary.
      rest += ' ';
    } else {
      rest += char;
    }
  }
  const latin = (rest.match(WORD) ?? []).length;
  return { total: chinese + latin, chinese, latin };
}

export function estimateReadingTime(words: WordCount): ReadingTime {
  const chineseSeconds =
    (words.chinese / READING_SPEED.chineseCharsPerMinute) * 60;
  const latinSeconds = (words.latin / READING_SPEED.latinWordsPerMinute) * 60;
  return {
    chineseSeconds,
    latinSeconds,
    totalSeconds: chineseSeconds + latinSeconds,
  };
}

/** Formats a duration in seconds as `3 分 12 秒`, `0.4 秒` or `1 小时 2 分`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${rounded} 秒`;
  }
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const rest = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分`);
  if (rest > 0 && hours === 0) parts.push(`${rest} 秒`);
  return parts.join(' ');
}

/** Everything the summary cards need, in one pass over the text. */
export function measureText(input: string): TextMeasurements {
  return {
    codePoints: countCodePoints(input),
    codePointsNoWhitespace: countCodePointsWithoutWhitespace(input),
    utf16Units: countUtf16Units(input),
    utf8Bytes: countUtf8Bytes(input),
    graphemes: countGraphemes(input),
    lines: countLines(input),
    nonEmptyLines: countNonEmptyLines(input),
    paragraphs: countParagraphs(input),
    sentences: countSentences(input),
  };
}

// --- Unicode categories ----------------------------------------------------

/**
 * Category buckets, matched in order.
 *
 * Order is load-bearing: `\p{L}` also matches uppercase and lowercase letters,
 * so the narrower buckets must be tested first. `\p{P}` before `\p{S}` matters
 * less but keeps the table stable. Buckets rather than the full 30 general
 * categories because nobody reads a table with 30 rows, and the aggregate
 * shape (how much is letters vs punctuation vs symbols) is the useful signal.
 */
const CATEGORY_RULES: Array<{ id: string; label: string; test: RegExp }> = [
  { id: 'uppercase', label: '大写字母 (Lu)', test: /\p{Lu}/u },
  { id: 'lowercase', label: '小写字母 (Ll)', test: /\p{Ll}/u },
  { id: 'letter', label: '其它字母 (Lo/Lm/Lt)', test: /\p{L}/u },
  { id: 'number', label: '数字 (N)', test: /\p{N}/u },
  { id: 'mark', label: '组合记号 (M)', test: /\p{M}/u },
  { id: 'punctuation', label: '标点 (P)', test: /\p{P}/u },
  { id: 'symbol', label: '符号 (S)', test: /\p{S}/u },
  { id: 'separator', label: '空白分隔 (Z)', test: /\p{Z}/u },
  { id: 'control', label: '控制/格式 (C)', test: /\p{C}/u },
];

const CATEGORY_FALLBACK = { id: 'other', label: '其它', test: /[\s\S]/u };

export function unicodeCategory(char: string): { id: string; label: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(char)) return { id: rule.id, label: rule.label };
  }
  const fallback = CATEGORY_FALLBACK;
  return { id: fallback.id, label: fallback.label };
}

/**
 * Distribution of code points across the category buckets.
 *
 * Percentages are of code points, not bytes, and empty buckets are omitted —
 * a nine-row table where six rows are zero hides the answer.
 */
export function categoryDistribution(input: string): CategoryBucket[] {
  const counts = new Map<string, { label: string; count: number }>();
  let total = 0;
  for (const char of input) {
    const category = unicodeCategory(char);
    const existing = counts.get(category.id);
    if (existing) existing.count += 1;
    else counts.set(category.id, { label: category.label, count: 1 });
    total += 1;
  }

  const buckets: CategoryBucket[] = [];
  for (const [id, value] of counts) {
    buckets.push({
      id,
      label: value.label,
      count: value.count,
      ratio: total === 0 ? 0 : value.count / total,
    });
  }
  // Descending by count, then by the table's own order for a stable result.
  const order = CATEGORY_RULES.map((rule) => rule.id).concat('other');
  buckets.sort((a, b) => b.count - a.count || order.indexOf(a.id) - order.indexOf(b.id));
  return buckets;
}

// --- Character frequency ---------------------------------------------------

/** `U+1F600` label for a code point. */
export function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** A printable stand-in for characters that would be invisible in a table. */
export function displayChar(char: string): string {
  if (char === '\n') return '\\n';
  if (char === '\r') return '\\r';
  if (char === '\t') return '\\t';
  if (char === ' ') return '␠';
  if (/\p{C}/u.test(char)) {
    return codePointLabel(char.codePointAt(0) ?? 0);
  }
  return char;
}

/**
 * Character frequency by code point.
 *
 * Counted per code point, not per grapheme, so a combining accent shows up as
 * its own row — that is the honest answer for "which characters are in this
 * file". Ties break on code point so the table does not reshuffle between
 * renders. `limit <= 0` means "all of them".
 */
export function charFrequency(input: string, limit = 20): CharacterFrequency[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (const char of input) {
    const codePoint = char.codePointAt(0) ?? 0;
    counts.set(codePoint, (counts.get(codePoint) ?? 0) + 1);
    total += 1;
  }

  const rows: CharacterFrequency[] = [];
  for (const [codePoint, count] of counts) {
    const char = String.fromCodePoint(codePoint);
    rows.push({
      char,
      codePoint,
      label: codePointLabel(codePoint),
      count,
      ratio: total === 0 ? 0 : count / total,
      category: unicodeCategory(char).label,
    });
  }
  rows.sort((a, b) => b.count - a.count || a.codePoint - b.codePoint);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

// --- Line statistics -------------------------------------------------------

/**
 * Longest, shortest and average line.
 *
 * Lengths are code points, so a line of 10 emoji is 10 rather than the 20 an
 * editor would show. The shortest line ignores empty lines: with a trailing
 * newline present in almost every file, the empty line would always win and the
 * number would carry no information.
 */
export function analyseLines(input: string): LineStats {
  if (input === '') return { longest: null, shortest: null, average: 0 };
  const lines = splitLines(input);

  let longest: LineStat | null = null;
  let shortest: LineStat | null = null;
  let totalLength = 0;

  lines.forEach((text, index) => {
    const length = countCodePoints(text);
    totalLength += length;
    const entry: LineStat = { index: index + 1, length, text };
    if (!longest || length > longest.length) longest = entry;
    if (text.trim() !== '' && (!shortest || length < shortest.length)) {
      shortest = entry;
    }
  });

  return {
    longest,
    shortest,
    average: lines.length === 0 ? 0 : totalLength / lines.length,
  };
}

/**
 * Why a count taken here can differ from the one in an editor.
 *
 * Returned as data rather than baked into the component so the wording can be
 * checked and so the same explanation is available to any caller.
 */
export function editorMismatchNotes(): string[] {
  return [
    '编辑器显示的“字符数”多半是 UTF-16 码元数（JavaScript 的 str.length），emoji 会算成 2 个，组合重音也会各算一个。',
    'Word 一类软件的“字数”通常是词数，中文按字、西文按词，和“字符数”不是一回事。',
    '微博、Twitter 一类平台的计数按码点或字素簇，且 emoji 序列有时按 2 计；本工具把四种口径分别列出，避免猜。',
    '本工具不把任何两个数字相加：码点数、码元数、字节数、字素簇数是四个不同的量。',
  ];
}
