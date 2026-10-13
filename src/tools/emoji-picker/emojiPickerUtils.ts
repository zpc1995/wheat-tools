/**
 * Emoji lookup, search and "how long is this character really" analysis.
 *
 * Pure logic: no React, no DOM, no clipboard. The platform's own string and
 * encoding APIs (`codePointAt`, the string iterator, `TextEncoder`) are the
 * authority for every count reported here — see `analyseEmoji` — because the
 * whole point of the tool is to show that `.length` is the wrong answer for an
 * emoji.
 */

import {
  EMOJI_CATEGORY_IDS,
  EMOJI_CATEGORY_LABELS,
  EMOJI_TABLE,
  type EmojiCategoryId,
} from './emojiTable';

/** One row of the picker. */
export interface EmojiEntry {
  /** The emoji itself, exactly as it should be copied. */
  char: string;
  /** Simplified Chinese display name, shown under the glyph and matched by search. */
  name: string;
  /** Space-separated English keywords, matched by search. */
  keywords: string;
  category: EmojiCategoryId;
}

export interface EmojiCategory {
  id: EmojiCategoryId;
  label: string;
  entries: EmojiEntry[];
}

/**
 * Parses the `emoji|中文名|english keywords` table.
 *
 * Throws on a malformed line instead of skipping it. A silently dropped row is
 * a missing emoji nobody notices, whereas a throw names the offending line the
 * first time the module loads — and the check script asserts this behaviour, so
 * the failure mode of the data file is itself tested.
 */
export function parseEmojiTable(table: Record<EmojiCategoryId, string>): EmojiEntry[] {
  const entries: EmojiEntry[] = [];
  for (const id of EMOJI_CATEGORY_IDS) {
    const block = table[id];
    if (typeof block !== 'string') {
      throw new Error(`emoji table is missing the "${id}" block`);
    }
    const lines = block.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (line === '') continue;
      const fields = line.split('|');
      if (fields.length !== 3) {
        throw new Error(`emoji table ${id} line ${index + 1}: expected 3 fields, got ${fields.length}: ${line}`);
      }
      const [char, name, keywords] = fields;
      if (char === '' || name === '' || keywords === '') {
        throw new Error(`emoji table ${id} line ${index + 1}: empty field in: ${line}`);
      }
      entries.push({ char, name, keywords, category: id });
    }
  }
  return entries;
}

/** Every curated entry, in table order. */
export const EMOJI: readonly EmojiEntry[] = parseEmojiTable(EMOJI_TABLE);

/** Entries grouped by the categories shown in the picker, in display order. */
export const EMOJI_CATEGORIES: readonly EmojiCategory[] = EMOJI_CATEGORY_IDS.map((id) => ({
  id,
  label: EMOJI_CATEGORY_LABELS[id],
  entries: EMOJI.filter((entry) => entry.category === id),
}));

/** How many emoji this tool ships. Shown in the UI next to the subset notice. */
export const EMOJI_TOTAL = EMOJI.length;

/**
 * The honesty note the UI displays.
 *
 * Unicode 15 has well over 3,600 emoji and a much larger sequence space; this
 * table is a hand-picked subset, and a picker that pretended otherwise would
 * have users hunting for a glyph that was never there.
 */
export const EMOJI_SUBSET_NOTE =
  `精选子集：共 ${EMOJI_TOTAL} 个常用 emoji，按 8 类整理，不是全量 Unicode 表情库（3000+）。` +
  '不含肤色、性别等变体组合。';

/** Formats a numeric code point the way the Unicode charts write it. */
export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The zero-width joiner, the glue inside sequences such as the family emoji.
 *
 * It is a real code point (3 bytes of UTF-8) that renders as nothing at all,
 * which is exactly why an emoji can be five code points long while looking like
 * one picture.
 */
export const ZWJ = 0x200d;

export interface EmojiAnalysis {
  char: string;
  /** Code points in order, from the platform string iterator. */
  codePoints: number[];
  /** Each code point as `U+XXXX`. */
  codePointLabels: string[];
  /** Number of code points — NOT `char.length`. */
  codePointCount: number;
  /** Number of UTF-16 code units, which is what `char.length` reports. */
  utf16Units: number;
  /** UTF-8 bytes in order. */
  utf8Bytes: number[];
  utf8ByteCount: number;
  /** UTF-8 bytes as uppercase hex, space separated. */
  utf8Hex: string;
  /** How many U+200D joiners the sequence contains. */
  zwjCount: number;
  /** Pieces joined by ZWJ: 1 for a plain emoji, 3 for a family of three. */
  componentCount: number;
  /** True when the character is more than one code point. */
  isSequence: boolean;
}

/**
 * Measures a character with the platform's own APIs.
 *
 * `codePointAt` and the string iterator are the authority for code points:
 * iterating a string yields code points, while `.length` yields UTF-16 code
 * units, and the two differ for every emoji above U+FFFF (which is most of
 * them). `TextEncoder` is the authority for UTF-8 bytes; the check script
 * cross-checks it against Node's `Buffer`, an independent implementation.
 */
export function analyseEmoji(char: string): EmojiAnalysis {
  const codePoints: number[] = [];
  for (const piece of char) {
    const codePoint = piece.codePointAt(0);
    if (codePoint !== undefined) codePoints.push(codePoint);
  }

  const utf8Bytes = [...new TextEncoder().encode(char)];
  const zwjCount = codePoints.filter((codePoint) => codePoint === ZWJ).length;

  return {
    char,
    codePoints,
    codePointLabels: codePoints.map(formatCodePoint),
    codePointCount: codePoints.length,
    utf16Units: char.length,
    utf8Bytes,
    utf8ByteCount: utf8Bytes.length,
    utf8Hex: utf8Bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    zwjCount,
    componentCount: zwjCount + 1,
    isSequence: codePoints.length > 1,
  };
}

/**
 * The one-sentence explanation shown under the counts.
 *
 * Worded per shape rather than one generic line, because the interesting case
 * is the ZWJ sequence: "5 个码点" alone does not explain why, and the answer
 * ("three emoji glued by invisible joiners") is the thing the user came for.
 */
export function describeAnalysis(analysis: EmojiAnalysis): string {
  const counts =
    `码点 ${analysis.codePointCount} 个 · UTF-16 码元 ${analysis.utf16Units} 个 · ` +
    `UTF-8 ${analysis.utf8ByteCount} 字节`;

  if (!analysis.isSequence) {
    return `单个码点：${counts}，三者一致。`;
  }
  if (analysis.zwjCount > 0) {
    return (
      `组合序列：${counts}。它由 ${analysis.componentCount} 个 emoji 用 ZWJ（U+200D）连接成一个图形，` +
      'ZWJ 本身不可见但确实占码点与字节，所以它在代码里比看起来长得多。'
    );
  }
  return (
    `组合序列：${counts}。它由多个码点拼成（变体选择符或键帽符号），` +
    '在代码里不是单个字符。'
  );
}

/** Strips a leading variation selector-free variant so search does not care. */
function searchText(entry: EmojiEntry): string {
  const label = EMOJI_CATEGORY_LABELS[entry.category];
  return `${label} ${entry.name} ${entry.keywords}`.toLowerCase();
}

/**
 * Searches by Chinese name, English keywords or category label.
 *
 * Every whitespace-separated token must match, so `red heart` narrows rather
 * than widening the result — the opposite of an OR search, and the behaviour
 * people expect from a filter box. An empty query returns everything, so the
 * caller can render the same list either way.
 */
export function searchEmoji(query: string, entries: readonly EmojiEntry[] = EMOJI): EmojiEntry[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = searchText(entry);
    return tokens.every((token) => haystack.includes(token));
  });
}

/** Entries of one category, for the category tabs. */
export function entriesForCategory(id: EmojiCategoryId): EmojiEntry[] {
  return EMOJI.filter((entry) => entry.category === id);
}
