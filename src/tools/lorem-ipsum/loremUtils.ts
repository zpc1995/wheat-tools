/**
 * Pure text generation for the Lorem ipsum generator.
 *
 * Two properties drive the design.
 *
 * 1. The random source is a *parameter*, never read from the environment.
 *    `Math.random` inside this file would make every run different, so the
 *    output could not be asserted against a fixed expectation, and a reported
 *    bug could never be reproduced. Callers pass a `() => number` (or use
 *    `seededRandom(seed)`, which is deterministic and engine independent
 *    because it only uses 32-bit integer arithmetic).
 *
 * 2. No configuration is read from the DOM or from globals: everything that
 *    changes the output travels in one options object. That keeps the whole
 *    generator exercisable from plain Node, which is where the checks run.
 *
 * The module imports nothing at all, so it can be transpiled and imported by
 * `scripts/check-lorem-ipsum.mjs` without a React or browser environment.
 */

/** Generation granularity: a number of paragraphs, sentences or words. */
export type LoremUnit = 'paragraph' | 'sentence' | 'word';

/** Which placeholder language the filler words come from. */
export type LoremLanguage = 'latin' | 'chinese';

/** Element used to wrap each paragraph when HTML output is requested. */
export type LoremTag = 'p' | 'div';

/**
 * Classic opening sentence, in its standard spelling.
 *
 * This is quoted text that has been copied verbatim for centuries, so the
 * spelling is not a matter of taste: `adipiscing` (not `adipisicing`),
 * `consectetur` (not `consectetuer`) and `elit` (not `elite`). The checks
 * compare against this exact string.
 */
export const CLASSIC_OPENER =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

/**
 * Latin filler vocabulary.
 *
 * Every generated Latin word is drawn from this list, so the checks can assert
 * "no word outside the bank" instead of eyeballing the output. Entries are
 * plain lowercase words with no punctuation and no surrounding whitespace —
 * punctuation is applied by the sentence builder, which is what keeps the
 * spacing rules (one space between words, no double spaces, no edge spaces)
 * enforceable in one place.
 */
export const LATIN_WORDS: readonly string[] = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
  'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'eu', 'fugiat', 'nulla', 'pariatur', 'excepteur',
  'sint', 'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui',
  'officia', 'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'at', 'vero',
  'eos', 'accusamus', 'iusto', 'odio', 'dignissimos', 'ducimus', 'blanditiis',
  'praesentium', 'voluptatum', 'deleniti', 'atque', 'corrupti', 'quos',
  'dolores', 'quas', 'molestias', 'excepturi', 'obcaecati', 'cupiditate',
  'provident', 'similique', 'mollitia', 'animi', 'laboriosam', 'dolorum',
  'fuga', 'harum', 'quidem', 'rerum', 'facilis', 'expedita', 'distinctio',
  'nam', 'libero', 'tempore', 'cum', 'soluta', 'nobis', 'eligendi', 'optio',
  'cumque', 'impedit', 'quo', 'minus', 'quod', 'maxime', 'placeat', 'facere',
  'possimus', 'omnis', 'voluptas', 'assumenda', 'repellendus', 'temporibus',
  'quibusdam', 'aut', 'officiis', 'debitis', 'necessitatibus', 'saepe',
  'eveniet', 'voluptates', 'repudiandae', 'recusandae', 'itaque', 'earum',
  'hic', 'tenetur', 'a', 'sapiente', 'delectus', 'reiciendis', 'voluptatibus',
  'maiores', 'perferendis', 'doloribus', 'asperiores', 'repellat', 'totam',
  'rem', 'aperiam', 'eaque', 'ipsa', 'quae', 'illo', 'inventore', 'veritatis',
  'quasi', 'architecto', 'beatae', 'vitae', 'dicta', 'explicabo', 'nemo',
  'ipsam', 'quia', 'voluptatem', 'accusantium', 'doloremque', 'laudantium',
  'ab', 'ratione', 'sequi', 'nesciunt', 'neque', 'porro', 'quisquam',
  'dolorem', 'adipisci', 'numquam', 'eius', 'modi', 'tempora', 'incidunt',
  'magnam', 'quaerat', 'etiam', 'minima', 'nostrum', 'exercitationem', 'ullam',
  'corporis', 'suscipit', 'magni',
];

/**
 * Chinese filler sentences.
 *
 * This is *not* a translation of the Latin. It is the convention Chinese
 * front-end projects actually use, where the classic Latin text is unreadable
 * and jarring: sentences that plainly say "this is placeholder copy for layout
 * testing, replace it with real content".
 *
 * These are whole sentences rather than a bag of words, and that is a
 * deliberate difference from the Latin bank. Drawing random Chinese words makes
 * grammatically meaningless noise ("的支持实际，同时页面"): Chinese has no
 * spaces and few inflectional cues, so word-level shuffling cannot produce
 * readable filler. Whole-sentence templates are the smallest unit that stays
 * readable while still being clearly fake.
 */
export const CHINESE_SENTENCES: readonly string[] = [
  '这里是一段中文占位文字。',
  '这段文字仅用于排版测试与效果预览。',
  '请在实际开发时替换成真实的内容。',
  '当前页面的数据尚未接入，先以占位文字填充。',
  '标题与正文的长度可以按需调整。',
  '中文项目的占位文字通常直接使用中文，而不是拉丁文假文。',
  '以下内容没有任何实际含义，只为了让界面更接近完成状态。',
  '这里的文字用于检查行高、间距与折行效果。',
  '列表、表格与卡片都可以先用这段文字填充。',
  '完成开发后请删除这些占位文字。',
  '如果看到这段文字，说明文案尚未最终确定。',
  '占位文字的长度建议与真实文案大致相当。',
  '这一段用于演示段落的排版效果。',
  '请替换成项目自己的介绍文字。',
  '设计稿评审时可以先用它来观察版式。',
];

/**
 * Punctuation the Chinese bank may contain, in addition to Han characters.
 *
 * The two quoted forms are written as escapes so that the pair of apostrophe
 * shaped quotation marks does not appear literally inside a single-quoted
 * string, which would end it early.
 */
const CHINESE_PUNCTUATION = '。，、；：\u201c\u201d\u2018\u2019（）《》';

const CHINESE_CHARACTER = /[\u4e00-\u9fff]/;

/** The character set allowed in Chinese filler: Han characters, punctuation. */
export function isChineseFiller(text: string): boolean {
  for (const character of text) {
    if (!CHINESE_CHARACTER.test(character) && !CHINESE_PUNCTUATION.includes(character)) {
      return false;
    }
  }
  return true;
}

/**
 * Splits one Chinese filler sentence into word-sized chunks.
 *
 * Used by word-level output only. Chinese has no separators, so the chunks are
 * chosen so that each one is a plausible word or short phrase (`这里是一段` is
 * not one, `这里` and `一段` are) and their concatenation is always the original
 * sentence — which is what keeps the single-sentence output readable.
 */
const CHINESE_CHUNKS: readonly string[] = [
  '这里', '一段', '中文', '占位', '文字', '这段', '仅用于', '排版', '测试',
  '与', '效果', '预览', '请', '在', '实际', '开发', '时', '替换', '成', '真实',
  '的', '内容', '当前', '页面', '数据', '尚未', '接入', '先', '以', '填充',
  '标题', '正文', '长度', '可以', '按需', '调整', '项目', '通常', '直接',
  '使用', '而', '不是', '拉丁文', '假文', '以下', '没有', '任何', '含义',
  '只', '为了', '让', '界面', '更', '接近', '完成', '状态', '用于', '检查',
  '行高', '间距', '折行', '列表', '表格', '卡片', '都', '这些', '删除',
  '如果', '看到', '说明', '文案', '最终', '确定', '建议', '大致', '相当',
  '演示', '段落', '自己', '介绍', '设计稿', '评审', '观察', '版式',
];

/**
 * Sentences per paragraph, inclusive bounds.
 *
 * Chosen to look like real body copy rather than a wall of one-sentence
 * paragraphs; the exact value per paragraph is drawn from the random source.
 */
export const MIN_SENTENCES_PER_PARAGRAPH = 3;
export const MAX_SENTENCES_PER_PARAGRAPH = 6;

/**
 * Hard ceiling on any requested count.
 *
 * Infinity or 1e9 would otherwise be an unbounded allocation inside a click
 * handler, freezing the tab. 50000 words is already a very long document, so
 * the cap is far above any real use and the UI reports the effective value.
 */
export const MAX_COUNT = 50_000;

/** Returns a random number in the interval [0, 1). */
export type RandomSource = () => number;

export interface LoremOptions {
  unit: LoremUnit;
  /** Requested count; clamped to integers in [0, MAX_COUNT]. */
  count: number;
  language: LoremLanguage;
  /**
   * Prefix the text with the classic opening sentence.
   *
   * Ignored for Chinese, where there is no equivalent fixed sentence. When it
   * applies it consumes one of the requested sentences (or the opening words
   * of the paragraph/sentence), so the requested count stays exact.
   */
  classicOpening: boolean;
  /** Wrap each paragraph in a tag. Done only if `html` is true. */
  html: boolean;
  tag: LoremTag;
}

/** Clamps an arbitrary number to an integer in [0, MAX_COUNT]. */
export function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  if (truncated <= 0) return 0;
  return truncated > MAX_COUNT ? MAX_COUNT : truncated;
}

/**
 * Deterministic pseudo-random source (mulberry32).
 *
 * Passed in rather than called internally, so a fixed seed gives byte-identical
 * output on every run and on every engine: the generator is pure 32-bit integer
 * arithmetic, not floating-point noise like `Math.random`. `>>> 0` keeps every
 * intermediate unsigned; without it the bitwise ops still coerce to int32 and
 * the sequence would be identical, but keeping it explicit makes the intent
 * obvious and avoids a signed shift sneaking in later.
 */
export function seededRandom(seed: number): RandomSource {
  const start = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reads the source once, snapping anything outside [0, 1) into a usable index.
 *
 * A source that returns exactly 1 (or a negative value) is a caller bug, but
 * letting it index past the end of the word bank would surface as `undefined`
 * in the middle of the text — far harder to diagnose than a clamped index.
 */
function pickIndex(random: RandomSource, length: number): number {
  const value = random();
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return length - 1;
  return Math.floor(value * length);
}

/**
 * Uppercases the first Latin letter, leaving everything else untouched.
 *
 * The pattern is anchored. An unanchored `[a-z]` finds the first lowercase
 * letter *anywhere*, which turns an already-capitalised word into a mangled one
 * ("Lorem" becomes "LOrem"); that bug is asserted against in the check.
 */
export function firstLetterUpper(text: string): string {
  return text.replace(/^[a-z]/, (character) => character.toUpperCase());
}

/** Uppercases the first letter of every whitespace separated word. */
export function titleCase(text: string): string {
  return text
    .split(' ')
    .map((word) => firstLetterUpper(word))
    .join(' ');
}

/**
 * The word bank for a language: single Latin words, or Chinese filler
 * sentences. Both are "the pool filler is drawn from", which is why the two
 * languages share the accessor even though the units differ.
 */
export function wordBank(language: LoremLanguage): readonly string[] {
  return language === 'chinese' ? CHINESE_SENTENCES : LATIN_WORDS;
}

/** Sentence terminator for a language. */
export function sentenceEnd(language: LoremLanguage): string {
  return language === 'chinese' ? '。' : '.';
}

/**
 * Joins filler units with the separator the language uses: a space for Latin
 * words, nothing at all for Chinese.
 */
export function joinWords(words: readonly string[], language: LoremLanguage): string {
  return language === 'chinese' ? words.join('') : words.join(' ');
}

/**
 * Number of words the classic opening contributes.
 *
 * Derived from the sentence helper rather than hard-coded to 8, so editing the
 * opener cannot silently desynchronise the requested-word-count maths.
 */
export const CLASSIC_OPENER_WORD_COUNT = sentenceWordCount(
  CLASSIC_OPENER,
  'latin',
);

/**
 * Words in one sentence of the given language.
 *
 * Latin counts whitespace separated tokens (a trailing comma stays attached to
 * its word, which is how a reader counts them too — the classic opening is 8).
 * Chinese has no spaces, so the whole sentence counts as one token; the word
 * count is only ever asserted for Latin, and the Chinese output is measured in
 * characters and sentence terminators instead.
 */
export function sentenceWordCount(
  sentence: string,
  language: LoremLanguage,
): number {
  if (language === 'chinese') {
    const matches = sentence.replace(/[。，、！？；：""''（）]/g, '').match(/\S+/g);
    return matches ? matches.length : 0;
  }
  const matches = sentence.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * One Latin sentence of filler, of exactly `words` words.
 *
 * Every word is title-cased. Prose would lowercase the interior words, but this
 * generator also feeds mock headings and card titles, and a uniform rule
 * ("every word capitalised, first word first") is the one the output can be
 * checked against without a second convention to keep in sync.
 *
 * The comma rule is deterministic rather than random — one after the fourth
 * word and then every seventh — so the rhythm looks measured and the number of
 * random draws stays predictable.
 */
function buildSentence(random: RandomSource, words: number): string {
  const target = words < 1 ? 1 : words;
  const picked: string[] = [];
  for (let index = 0; index < target; index += 1) {
    picked.push(LATIN_WORDS[pickIndex(random, LATIN_WORDS.length)]);
  }

  let body = picked.join(' ');
  if (target > 4) {
    const pieces: string[] = [];
    for (let index = 0; index < picked.length; index += 1) {
      const isLast = index === picked.length - 1;
      const needsComma =
        !isLast && (index === 3 || (index > 3 && (index - 3) % 7 === 0));
      pieces.push(needsComma ? `${picked[index]},` : picked[index]);
    }
    body = pieces.join(' ');
  }

  return `${titleCase(body)}.`;
}

/**
 * Cuts a Chinese filler sentence into chunks, greedily longest-first.
 *
 * Chinese has no word separators, so word-level output has to choose them. The
 * greedy cut keeps whole phrases together (`这里` and `一段` rather than
 * `这里` + `是一`), and searching the chunk list in descending length order is
 * what makes it prefer `仅用于` over `仅` + `用于`. Any character not covered by
 * the list becomes a single-character chunk, so the concatenation is always the
 * original sentence and no character can be silently dropped.
 */
export function cutChineseWords(sentence: string): string[] {
  const byLength = [...CHINESE_CHUNKS].sort((left, right) => right.length - left.length);
  const chunks: string[] = [];
  let rest = sentence;
  while (rest.length > 0) {
    const next = byLength.find((chunk) => rest.startsWith(chunk));
    if (next) {
      chunks.push(next);
      rest = rest.slice(next.length);
    } else {
      chunks.push(rest[0]);
      rest = rest.slice(1);
    }
  }
  return chunks;
}

/**
 * Applies the generator's casing rule to a hand-assembled sentence.
 *
 * Exported because the check builds expected sentences with it instead of
 * duplicating the rule: if the rule changes, the expectation follows, and the
 * properties that really matter (the classic opening, the word bank, the
 * counts) stay independent of casing.
 */
export function normaliseSentenceCase(
  sentence: string,
  language: LoremLanguage,
): string {
  return language === 'chinese' ? sentence : titleCase(sentence);
}

/** Draws an integer in [min, max]; falls back to `min` on a bad source. */
function randomInt(random: RandomSource, min: number, max: number): number {
  const span = max - min + 1;
  return min + pickIndex(random, span);
}

/**
 * Builds `count` sentences of filler.
 *
 * When `classicOpening` is set the first sentence is the classic opening
 * exactly as it is quoted everywhere, followed by a full stop. Nothing is
 * appended to it: padding the sentence with random words would break the
 * "starts with the canonical text" guarantee the reader is checking for, and a
 * period after `elit` is the least invasive way to give it a terminator. The
 * opening counts as one of the requested sentences, so the total stays exact.
 */
export function generateSentences(
  random: RandomSource,
  count: number,
  language: LoremLanguage,
  classicOpening: boolean,
): string[] {
  const total = clampCount(count);
  if (total === 0) return [];

  const sentences: string[] = [];
  const useClassic =
    classicOpening && language === 'latin' && CLASSIC_OPENER_WORD_COUNT > 0;

  if (useClassic) {
    sentences.push(`${CLASSIC_OPENER}${sentenceEnd('latin')}`);
  }

  for (let index = sentences.length; index < total; index += 1) {
    if (language === 'chinese') {
      // Whole sentences, never repeated back to back: repeating the same
      // sentence twice in a row reads as a bug even in filler.
      const previous = sentences[sentences.length - 1];
      let candidate = CHINESE_SENTENCES[pickIndex(random, CHINESE_SENTENCES.length)];
      if (candidate === previous && CHINESE_SENTENCES.length > 1) {
        candidate =
          CHINESE_SENTENCES[(CHINESE_SENTENCES.indexOf(candidate) + 1) % CHINESE_SENTENCES.length];
      }
      sentences.push(candidate);
    } else {
      sentences.push(buildSentence(random, randomInt(random, 6, 16)));
    }
  }

  return sentences;
}

/** Capitalises the first word of each paragraph-sized block. */
export function normaliseParagraphCase(
  paragraph: string,
  language: LoremLanguage,
): string {
  if (language === 'chinese') return paragraph;
  return firstLetterUpper(paragraph);
}

/** Wraps each paragraph in the chosen tag, one per line. */
export function wrapHtml(paragraphs: readonly string[], tag: LoremTag): string {
  return paragraphs.map((paragraph) => `<${tag}>${paragraph}</${tag}>`).join('\n');
}

/** Applies HTML wrapping when requested; a no-op otherwise. */
export function maybeHtml(
  paragraphs: readonly string[],
  options: LoremOptions,
): string {
  if (!options.html) return paragraphs.join('\n\n');
  return wrapHtml(paragraphs, options.tag);
}

/**
 * Builds `count` paragraphs, each holding 3-6 sentences.
 *
 * A Chinese paragraph is capped at the length of the sentence bank rather than
 * padded with repeats, so it reads as a paragraph instead of the same sentence
 * three times.
 */
export function generateParagraphs(
  random: RandomSource,
  count: number,
  language: LoremLanguage,
  classicOpening: boolean,
): string[] {
  const total = clampCount(count);
  const paragraphs: string[] = [];

  for (let index = 0; index < total; index += 1) {
    const wanted = Math.min(
      randomInt(random, MIN_SENTENCES_PER_PARAGRAPH, MAX_SENTENCES_PER_PARAGRAPH),
      language === 'chinese' ? CHINESE_SENTENCES.length : Number.MAX_SAFE_INTEGER,
    );
    const sentences = generateSentences(
      random,
      wanted,
      language,
      // Only the very first paragraph can carry the opening; every later one
      // would repeat it, which looks like a generation bug to the reader.
      classicOpening && index === 0,
    );
    paragraphs.push(normaliseParagraphCase(sentences.join(' '), language));
  }

  return paragraphs;
}

/**
 * Builds Latin words joined by a single space.
 *
 * Chinese delegates to `generateChineseWords`: "a number of words" means a
 * number of characters there, and the output is cut from one filler sentence so
 * that it still reads as Chinese.
 */
export function generateWords(
  random: RandomSource,
  count: number,
  language: LoremLanguage,
): string {
  const total = clampCount(count);
  if (total === 0) return '';
  if (language === 'chinese') return generateChineseWords(random, total);
  const picked: string[] = [];
  for (let index = 0; index < total; index += 1) {
    picked.push(LATIN_WORDS[pickIndex(random, LATIN_WORDS.length)]);
  }
  return picked.join(' ');
}

/**
 * `count` Chinese characters, cut as words from filler sentences.
 *
 * Punctuation is dropped rather than counted: the unit is characters, and a
 * comma or full stop would silently consume part of the requested budget.
 *
 * The loop works through whole sentences and restarts at a sentence boundary.
 * Carrying the leftover of one sentence into the middle of the next is what a
 * plain accumulator does, and because Chinese has no separator to fall back on
 * the two halves fuse into an unreadable fragment (…大致相当标题与…). Restarting
 * keeps every chunk taken from a real sentence, which is also why the text
 * reads as (a run of) genuine filler rather than letters in a bag.
 */
export function generateChineseWords(
  random: RandomSource,
  count: number,
): string {
  const total = clampCount(count);
  const picked: string[] = [];
  let length = 0;
  let guard = 0;
  while (length < total && guard < total + 1000) {
    guard += 1;
    const sentence = CHINESE_SENTENCES[pickIndex(random, CHINESE_SENTENCES.length)];
    for (const chunk of cutChineseWords(sentence)) {
      if (length >= total) break;
      const plain = chunk.replace(/[。，]/g, '');
      if (plain === '') continue;
      const room = total - length;
      const piece = plain.length <= room ? plain : plain.slice(0, room);
      picked.push(piece);
      length += piece.length;
      if (piece.length < plain.length) break;
    }
  }
  return picked.join('');
}

/**
 * The whole generator.
 *
 * Unit semantics, which are what the checks assert:
 * - 'word': exactly `count` words. No terminator is added: a list of words is
 *   not a sentence, and appending '.' would make the word count ambiguous.
 * - 'sentence': exactly `count` sentence terminators; the classic opening
 *   counts as one of them.
 * - 'paragraph': exactly `count` paragraphs, separated by a blank line in plain
 *   text and by one tag per paragraph in HTML mode.
 */
export function generateLorem(
  random: RandomSource,
  options: LoremOptions,
): string {
  if (options.unit === 'word') {
    return maybeHtml([generateWords(random, options.count, options.language)], options);
  }
  if (options.unit === 'sentence') {
    const sentences = generateSentences(
      random,
      options.count,
      options.language,
      options.classicOpening,
    );
    return maybeHtml([sentences.join(' ')], options);
  }
  const paragraphs = generateParagraphs(
    random,
    options.count,
    options.language,
    options.classicOpening,
  );
  return maybeHtml(paragraphs, options);
}

/**
 * Splits plain text back into paragraphs for counting.
 *
 * HTML output is deliberately kept out of this: the tag-balance check is what
 * validates that form, and pretending `<p>` markup is a paragraph separator
 * here would hide a malformed tag behind a passing count.
 */
export function splitParagraphs(text: string): string[] {
  if (text.trim() === '') return [];
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Splits a sentence run into sentences.
 *
 * Latin splits on '.', Chinese on '。'. Both characters are excluded from the
 * word banks, so a terminator in the output can only have been added by the
 * sentence builder.
 */
export function splitSentences(text: string, language: LoremLanguage): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  const pattern = language === 'chinese' ? /。/ : /\./;
  return trimmed
    .split(pattern)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Words that came from outside the language's bank.
 *
 * Compared case-insensitively, because the sentence builder title-cases its
 * words and Chinese needs no casing at all. Comparing exactly would report every
 * capitalised word as unknown, which is noise rather than a defect. Exported
 * from the implementation (rather than only living in the check) so the same
 * rule is available to the UI if a bank is ever edited by hand.
 */
export function invalidWords(
  words: readonly string[],
  language: LoremLanguage,
): string[] {
  const bank = new Set(wordBank(language).map((word) => word.toLowerCase()));
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (!bank.has(key) && !seen.has(key)) {
      seen.add(key);
      invalid.push(word);
    }
  }
  return invalid;
}

/**
 * Splits generated text into countable words.
 *
 * Latin: split on whitespace and drop the commas the sentence builder attaches,
 * which leaves exactly the bank words. Chinese: the whole run is one entry,
 * because the text has no word separators once the spaces between sentences are
 * included; the Chinese readout therefore reports characters and sentences
 * rather than a word count.
 */
export function splitWords(text: string, language: LoremLanguage): string[] {
  const matches = text.trim().match(/\S+/g);
  if (!matches) return [];
  if (language === 'chinese') return matches;
  return matches.flatMap((token) => token.replace(/,/g, '').split(' '));
}

export interface LoremStats {
  characters: number;
  words: number;
  sentences: number;
  paragraphs: number;
}

/** Counts what was generated, for the readout under the output box. */
export function describeLorem(
  text: string,
  language: LoremLanguage,
): LoremStats {
  return {
    characters: text.length,
    words: splitWords(text, language).filter((word) => word !== '').length,
    sentences: splitSentences(text, language).length,
    paragraphs: splitParagraphs(text).length,
  };
}

/**
 * Strips the wrapping tag from HTML output, so the counting helpers above can
 * be used on text that was generated with `html: true`.
 *
 * The closing tag plus the newline after it becomes one blank line, so two
 * adjacent `<p>` blocks stay two paragraphs. Simply deleting every tag would
 * glue them together; blindly replacing every tag with a newline would leave a
 * blank line *inside* each paragraph, since the opening tag is on its own line
 * too. The result equals the plain-text form of the same seed.
 */
export function stripHtmlTags(text: string): string {
  return text
    .replace(/<\/[a-z][a-z0-9]*>\n(?=<)/gi, '\n\n')
    .replace(/<\/?[a-z][a-z0-9]*>/gi, '');
}
