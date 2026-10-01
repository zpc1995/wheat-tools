/**
 * The ICAO / NATO radiotelephony spelling alphabet, both directions.
 *
 * ## Which spelling is "the" spelling
 *
 * The official table has three spellings that differ from what someone writing
 * from memory produces, and getting them wrong is the usual failure mode of
 * this kind of tool:
 *
 *   - **Alfa**, not Alpha. Spelled with an `f` because `ph` is not pronounced
 *     as `f` in many languages.
 *   - **Juliett**, with a double `t`, so French speakers do not drop the final
 *     consonant.
 *   - **Xray**, with no hyphen, so it is read as one word. NATO's chart and the
 *     ICAO alphabet page use Xray; some ICAO printings and the older ITU table
 *     still write X-ray.
 *
 * `word` below is always the official spelling and `variants` are the common
 * non-official ones. The reverse direction accepts both, but it will only ever
 * *produce* the official spelling, because that is the one that belongs in the
 * output.
 *
 * ## Digits
 *
 * The digit code words are the English names — One, Two, Three, … — not a
 * second set of spellings. ICAO additionally publishes *pronunciation*
 * respellings (WUN, TOO, TREE, FOWER, FIFE, AIT, NINER) for use over radio;
 * those are how to say the word, not how to write it. They are kept in a
 * separate `pronunciation` field so the two can never be confused, and the
 * reverse direction accepts them as input.
 *
 * ## What this file deliberately does not do
 *
 * No audio. Pronouncing the words would mean shipping or fetching audio files,
 * which this toolbox does not do; the mapping table carries the spelling and
 * the ICAO reading instead.
 */

export type NatoKind = 'letter' | 'digit';

export interface NatoEntry {
  /** The character this code word stands for: A–Z or 0–9. */
  char: string;
  /** The official ICAO spelling, exactly as printed in the table. */
  word: string;
  /** Common spellings that are not the official one; accepted on input. */
  variants: string[];
  kind: NatoKind;
  /**
   * ICAO pronunciation respelling for a digit, e.g. WUN for 1. This is a
   * reading guide, never an alternative spelling.
   */
  pronunciation?: string;
  /** Why the spelling is what it is, when it is surprising. */
  note?: string;
}

export const NATO_LETTERS: readonly NatoEntry[] = [
  { char: 'A', word: 'Alfa', variants: ['Alpha'], kind: 'letter', note: '官方用 f 拼写，避免 ph 在非英语环境中被读错；Alpha 是英语里最常见的变体。' },
  { char: 'B', word: 'Bravo', variants: [], kind: 'letter' },
  { char: 'C', word: 'Charlie', variants: [], kind: 'letter', note: '在法语、西班牙语环境中 ch 可读作 sh，官方承认这种读法。' },
  { char: 'D', word: 'Delta', variants: [], kind: 'letter' },
  { char: 'E', word: 'Echo', variants: [], kind: 'letter' },
  { char: 'F', word: 'Foxtrot', variants: [], kind: 'letter' },
  { char: 'G', word: 'Golf', variants: [], kind: 'letter' },
  { char: 'H', word: 'Hotel', variants: [], kind: 'letter' },
  { char: 'I', word: 'India', variants: [], kind: 'letter' },
  { char: 'J', word: 'Juliett', variants: ['Juliet'], kind: 'letter', note: '官方是双 t：法语使用者容易把词尾的单个 t 吞掉。' },
  { char: 'K', word: 'Kilo', variants: [], kind: 'letter' },
  { char: 'L', word: 'Lima', variants: [], kind: 'letter' },
  { char: 'M', word: 'Mike', variants: [], kind: 'letter' },
  { char: 'N', word: 'November', variants: [], kind: 'letter' },
  { char: 'O', word: 'Oscar', variants: [], kind: 'letter' },
  { char: 'P', word: 'Papa', variants: [], kind: 'letter' },
  { char: 'Q', word: 'Quebec', variants: [], kind: 'letter' },
  { char: 'R', word: 'Romeo', variants: [], kind: 'letter' },
  { char: 'S', word: 'Sierra', variants: [], kind: 'letter' },
  { char: 'T', word: 'Tango', variants: [], kind: 'letter' },
  { char: 'U', word: 'Uniform', variants: [], kind: 'letter', note: '在部分语言环境中 u 可读作 oo，官方承认这种读法。' },
  { char: 'V', word: 'Victor', variants: [], kind: 'letter' },
  { char: 'W', word: 'Whiskey', variants: ['Whisky'], kind: 'letter', note: '官方拼写带 e（Whiskey）；Whisky 是酒名的拼法，常被顺手写进来。' },
  { char: 'X', word: 'Xray', variants: ['X-ray'], kind: 'letter', note: 'NATO 官方图表不带连字符（Xray），以保证读成一个词；ICAO 的部分印刷品仍写 X-ray，本工具两者都接受。' },
  { char: 'Y', word: 'Yankee', variants: [], kind: 'letter' },
  { char: 'Z', word: 'Zulu', variants: [], kind: 'letter' },
];

export const NATO_DIGITS: readonly NatoEntry[] = [
  { char: '0', word: 'Zero', variants: [], kind: 'digit', pronunciation: 'ZE-RO' },
  { char: '1', word: 'One', variants: [], kind: 'digit', pronunciation: 'WUN' },
  { char: '2', word: 'Two', variants: [], kind: 'digit', pronunciation: 'TOO' },
  { char: '3', word: 'Three', variants: [], kind: 'digit', pronunciation: 'TREE', note: '读作 TREE，避免被听成 sri 之类的音。' },
  { char: '4', word: 'Four', variants: [], kind: 'digit', pronunciation: 'FOW-ER', note: '读作 FOW-ER，与 for 区分开。' },
  { char: '5', word: 'Five', variants: [], kind: 'digit', pronunciation: 'FIFE', note: '读作 FIFE，避免与 fire 混淆。' },
  { char: '6', word: 'Six', variants: [], kind: 'digit', pronunciation: 'SIX' },
  { char: '7', word: 'Seven', variants: [], kind: 'digit', pronunciation: 'SEV-EN' },
  { char: '8', word: 'Eight', variants: [], kind: 'digit', pronunciation: 'AIT' },
  { char: '9', word: 'Nine', variants: [], kind: 'digit', pronunciation: 'NIN-ER', note: '读作 NIN-ER，与德语 nein（不）区分开。' },
];

/** Letters followed by digits, in table order. */
export const NATO_TABLE: readonly NatoEntry[] = [...NATO_LETTERS, ...NATO_DIGITS];

/**
 * Normalises one written form for lookup.
 *
 * Case, hyphens, spaces and punctuation are all stripped, so "X-ray", "x ray",
 * "ALFA" and "Alfa!" find the same entry. Only ASCII letters and digits
 * survive; anything else normalises to the empty string, which never matches.
 */
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const OFFICIAL_LOOKUP = new Map<string, NatoEntry>();
const VARIANT_LOOKUP = new Map<string, NatoEntry>();
const PRONUNCIATION_LOOKUP = new Map<string, NatoEntry>();

for (const entry of NATO_TABLE) {
  OFFICIAL_LOOKUP.set(normalizeWord(entry.word), entry);
}
for (const entry of NATO_TABLE) {
  // Variants and readings are added second so an official spelling always wins
  // if the same string appears twice.
  for (const variant of entry.variants) VARIANT_LOOKUP.set(normalizeWord(variant), entry);
  if (entry.pronunciation) PRONUNCIATION_LOOKUP.set(normalizeWord(entry.pronunciation), entry);
}

/** How a written form matched. */
export type MatchKind = 'official' | 'variant' | 'pronunciation';

export interface WordMatch {
  entry: NatoEntry;
  kind: MatchKind;
}

/**
 * Look one word up, official spelling first, then variants, then the ICAO
 * digit readings.
 */
export function lookupWord(raw: string): WordMatch | null {
  const key = normalizeWord(raw);
  if (key === '') return null;

  const official = OFFICIAL_LOOKUP.get(key);
  if (official) return { entry: official, kind: 'official' };
  const variant = VARIANT_LOOKUP.get(key);
  if (variant) return { entry: variant, kind: 'variant' };
  const pronunciation = PRONUNCIATION_LOOKUP.get(key);
  if (pronunciation) return { entry: pronunciation, kind: 'pronunciation' };
  return null;
}

/**
 * Spellings that occupy more than one whitespace-separated token.
 *
 * Only X needs this: it used to be written "X-ray" and people still type it as
 * two words. Joining *any* two tokens before lookup would be simpler, but it
 * also resolves "A it" to 8, which is not a spelling anyone uses.
 */
const MULTI_WORD: ReadonlyArray<{ char: string; tokens: readonly string[] }> = [
  { char: 'X', tokens: ['x', 'ray'] },
];

/** The official letters in order, as a single string, for reference output. */
export function officialAlphabet(): string {
  return NATO_LETTERS.map((entry) => entry.word).join(' ');
}

/** The single character a code word stands for, or null. */
export function charToWord(character: string): NatoEntry | null {
  const upper = character.toUpperCase();
  // A few characters uppercase to more than one character (the German eszett
  // becomes SS, the fi ligature becomes FI). Those are not letters of this
  // alphabet, and mapping them would silently expand one character into two.
  if (upper.length !== 1) return null;

  for (const entry of NATO_TABLE) {
    if (entry.char === upper) return entry;
  }
  return null;
}

export type UnmappedMode = 'keep' | 'skip';

export interface NatoItem {
  /** The source character. */
  char: string;
  /** The code word, or null when the character has no mapping. */
  entry: NatoEntry | null;
}

export interface TextToNatoOptions {
  /** Placed between words. */
  separator?: string;
  /**
   * What to do with a character the alphabet cannot represent, such as a
   * Chinese character: pass it through untouched, or drop it. Guessing a
   * spelling is not an option this tool offers.
   */
  unmapped?: UnmappedMode;
}

export interface TextToNatoResult {
  /** One item per non-whitespace source character, in order. */
  items: NatoItem[];
  /** Just the code words, in order. */
  words: string[];
  /** The joined output, including passed-through characters when keeping them. */
  output: string;
  mappedCount: number;
  /** Distinct unmapped characters, in order of first appearance, no whitespace. */
  unmappedChars: string[];
}

/**
 * Spells text out in the alphabet.
 *
 * Case is not carried: the alphabet has one word per letter, so "abc" and "ABC"
 * both become "Alfa Bravo Charlie". That is a property of the alphabet, not a
 * bug, and the reverse direction therefore returns uppercase.
 *
 * Whitespace is not spelled and not reported: it acts as the separator between
 * words. Keeping it would produce runs of spaces (one from the gap, one from
 * the separator) and it could never be recovered anyway, because the reverse
 * direction treats whitespace as a separator. Losing it is stated rather than
 * hidden.
 */
export function textToNato(text: string, options: TextToNatoOptions = {}): TextToNatoResult {
  const separator = options.separator ?? ' ';
  const unmappedMode = options.unmapped ?? 'keep';

  const items: NatoItem[] = [];
  const words: string[] = [];
  const unmappedChars: string[] = [];
  const pieces: string[] = [];

  for (const character of text) {
    if (/^\s$/.test(character)) continue;

    const entry = charToWord(character);
    items.push({ char: character, entry });

    if (entry) {
      words.push(entry.word);
      pieces.push(entry.word);
      continue;
    }

    if (!unmappedChars.includes(character)) unmappedChars.push(character);
    if (unmappedMode === 'keep') pieces.push(character);
  }

  return {
    items,
    words,
    output: pieces.join(separator),
    mappedCount: words.length,
    unmappedChars,
  };
}

/** How one input token was resolved when reading back. */
export type DecodeKind = MatchKind | 'multi-word' | 'literal' | 'unknown';

export interface DecodeItem {
  /** The token or token pair as it appeared, joined by a space. */
  token: string;
  kind: DecodeKind;
  char: string | null;
  entry: NatoEntry | null;
}

export interface NatoToTextOptions {
  /** Keep an unrecognised token in the output, or drop it. */
  unknown?: UnmappedMode;
}

export interface NatoToTextResult {
  /** The recovered text. Code words resolve to uppercase letters and digits. */
  text: string;
  items: DecodeItem[];
  /** Distinct tokens that matched nothing, in order of first appearance. */
  unknown: string[];
  mappedCount: number;
}

/**
 * Reads a sequence of code words back into text.
 *
 * Recognised: the official spelling, the documented variants (Alpha, Juliet,
 * X-ray), the ICAO digit readings (Wun, Tree, Fower, Fife, Niner, …), the
 * two-token spelling "X ray", and a bare Latin letter or digit, so a value that
 * is already partly plain text still comes back.
 *
 * Everything else is reported in `unknown` and either kept verbatim or dropped.
 * Inventing a letter for an unrecognised word would be worse than saying so.
 */
export function natoToText(input: string, options: NatoToTextOptions = {}): NatoToTextResult {
  const unknownMode = options.unknown ?? 'keep';
  const tokens = input.split(/[\s,;、，；/]+/).filter((token) => token !== '');

  const items: DecodeItem[] = [];
  const unknown: string[] = [];
  let text = '';
  let mappedCount = 0;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    const next = index + 1 < tokens.length ? tokens[index + 1] : null;
    const pairKey = next === null ? '' : `${normalizeWord(token)} ${normalizeWord(next)}`;
    const multiWord = MULTI_WORD.find(
      (candidate) => candidate.tokens.join(' ') === pairKey,
    );

    if (multiWord && next !== null) {
      const entry = charToWord(multiWord.char);
      items.push({ token: `${token} ${next}`, kind: 'multi-word', char: multiWord.char, entry });
      text += multiWord.char;
      mappedCount += 1;
      index += 2;
      continue;
    }

    const match = lookupWord(token);
    if (match) {
      items.push({ token, kind: match.kind, char: match.entry.char, entry: match.entry });
      text += match.entry.char;
      mappedCount += 1;
      index += 1;
      continue;
    }

    // A bare letter or digit stands for itself. This is what makes a mixed
    // input such as "Alfa 1 Bravo" readable without turning every unknown word
    // into a guess.
    const literal = token.length === 1 ? charToWord(token) : null;
    if (literal) {
      items.push({ token, kind: 'literal', char: literal.char, entry: literal });
      text += literal.char;
      mappedCount += 1;
      index += 1;
      continue;
    }

    items.push({ token, kind: 'unknown', char: null, entry: null });
    if (!unknown.includes(token)) unknown.push(token);
    if (unknownMode === 'keep') text += token;
    index += 1;
  }

  return { text, items, unknown, mappedCount };
}

/**
 * The mapping table as TSV, for pasting into a spreadsheet or a code comment.
 * Uses a tab separator so the note column may contain any punctuation.
 */
export function tableToTsv(entries: readonly NatoEntry[] = NATO_TABLE): string {
  const header = ['字符', 'ICAO 官方用词', '常见变体', 'ICAO 读法', '说明'].join('\t');
  const rows = entries.map((entry) =>
    [
      entry.char,
      entry.word,
      entry.variants.join('、'),
      entry.pronunciation ?? '',
      entry.note ?? '',
    ].join('\t'),
  );
  return [header, ...rows].join('\n');
}
