/**
 * Random token generation — pure logic.
 *
 * Two things this module deliberately does *not* do:
 *
 * 1. **It never touches a random source of its own.** Randomness arrives as a
 *    `RandomSource` argument. That is what makes every property here testable
 *    with a seeded generator, and it makes a `Math.random` call impossible to
 *    introduce without the caller handing one in. The component supplies
 *    `crypto.getRandomValues`, which is the only cryptographically secure
 *    source a browser has.
 * 2. **It never encodes a token by slicing an integer.** Hex and Base64 are
 *    produced by consuming whole bytes and grouping their bits, which is why
 *    `bytesToBase64` can be compared byte-for-byte against Node's own encoder
 *    in the check script.
 *
 * Why not `Math.random`: it is a fast PRNG with a small internal state. It looks
 * random and passes casual statistical tests, but its output is a deterministic
 * function of that state, and the state can be recovered from a handful of
 * outputs. A token an attacker can predict is not a secret regardless of how it
 * looks.
 */

export type TokenFormat = 'hex' | 'base64' | 'base64url' | 'custom';

export const HEX_ALPHABET = '0123456789abcdef';
export const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export interface TokenFormatInfo {
  id: TokenFormat;
  label: string;
  alphabet: string;
  bitsPerChar: number;
  note: string;
}

export const TOKEN_FORMATS: readonly TokenFormatInfo[] = [
  {
    id: 'hex',
    label: 'Hex（十六进制）',
    alphabet: HEX_ALPHABET,
    bitsPerChar: 4,
    note: '每字符 4 位。只含 0-9a-f，放进 URL、文件名、配置项或日志里都不需要转义。',
  },
  {
    id: 'base64',
    label: 'Base64',
    alphabet: BASE64_ALPHABET,
    bitsPerChar: 6,
    note: '每字符 6 位，同样长度下信息量比 Hex 高 50%。含 + 与 /，放进 URL 或文件名时通常需要转义。',
  },
  {
    id: 'base64url',
    label: 'Base64URL',
    alphabet: BASE64URL_ALPHABET,
    bitsPerChar: 6,
    note: '与 Base64 同样的信息密度，把 + 和 / 换成 - 和 _，可以直接放进 URL、Cookie 与文件名。',
  },
  {
    id: 'custom',
    label: '自定义字符集',
    alphabet: '',
    bitsPerChar: 0,
    note: '自己指定字符集。去掉 0/O、1/l/I 这类形近字符会牺牲一点熵，但能显著降低抄错、念错的概率。',
  },
];

export const FORMAT_IDS: readonly TokenFormat[] = TOKEN_FORMATS.map((format) => format.id);

/** Default custom alphabet: no 0/O, 1/l/I, so it can be read aloud safely. */
export const DEFAULT_CUSTOM_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const MAX_TOKEN_LENGTH = 4096;
export const MAX_TOKEN_COUNT = 10000;
/**
 * Cap on `count × length` for one batch.
 *
 * 10 000 tokens of 4 096 characters is 40 MB of text, which no interface should
 * try to render; the cap keeps the worst case at half a megabyte while still
 * allowing the 10 000-token batch the uniqueness check exercises.
 */
export const MAX_BATCH_CHARS = 500_000;
export const MAX_CUSTOM_ALPHABET = 256;
export const MAX_PREFIX_LENGTH = 64;
export const GROUP_SIZES: readonly number[] = [0, 2, 3, 4, 5, 6, 8];

/**
 * Returns `count` bytes. The caller decides where they come from; in the app
 * that is `crypto.getRandomValues`, in the checks it is a seeded generator or
 * `node:crypto.randomBytes`.
 */
export type RandomSource = (count: number) => Uint8Array;

export interface TokenOptions {
  format: TokenFormat;
  length: number;
  count: number;
  /** Fixed prefix such as `sk_` or `ghp_`; it adds no entropy. */
  prefix: string;
  /** Insert a separator every N characters for readability; 0 disables it. */
  groupSize: number;
  customCharset: string;
}

export const DEFAULT_TOKEN_OPTIONS: TokenOptions = {
  format: 'hex',
  length: 32,
  count: 5,
  prefix: '',
  groupSize: 4,
  customCharset: DEFAULT_CUSTOM_CHARSET,
};

export interface TokenValidationOk {
  ok: true;
  alphabet: string[];
}

export interface TokenValidationError {
  ok: false;
  error: string;
}

export type TokenValidation = TokenValidationOk | TokenValidationError;

/** Drops whitespace, control characters and duplicates, keeping the order. */
export function sanitiseCustomAlphabet(customCharset: string): string[] {
  const seen = new Set<string>();
  const alphabet: string[] = [];
  for (const char of customCharset) {
    // Iterating a string yields code points, so an emoji is one character here
    // even though it is two UTF-16 units.
    if (/\s/.test(char) || /[\u0000-\u001f\u007f]/.test(char)) continue;
    if (seen.has(char)) continue;
    seen.add(char);
    alphabet.push(char);
  }
  return alphabet;
}

/** The character set a format draws from, as an array of code points. */
export function buildAlphabet(format: TokenFormat, customCharset: string): string[] {
  if (format === 'hex') return [...HEX_ALPHABET];
  if (format === 'base64') return [...BASE64_ALPHABET];
  if (format === 'base64url') return [...BASE64URL_ALPHABET];
  return sanitiseCustomAlphabet(customCharset);
}

export function validateOptions(options: TokenOptions): TokenValidation {
  if (!Number.isInteger(options.length) || options.length < 1) {
    return { ok: false, error: '长度必须是大于 0 的整数' };
  }
  if (options.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: `长度上限为 ${MAX_TOKEN_LENGTH}` };
  }
  if (!Number.isInteger(options.count) || options.count < 1) {
    return { ok: false, error: '数量必须是大于 0 的整数' };
  }
  if (options.count > MAX_TOKEN_COUNT) {
    return { ok: false, error: `单批数量上限为 ${MAX_TOKEN_COUNT}` };
  }
  if (options.length * options.count > MAX_BATCH_CHARS) {
    return {
      ok: false,
      error: `单批总字符数（数量 × 长度）上限为 ${MAX_BATCH_CHARS}，当前为 ${options.length * options.count}`,
    };
  }
  if (!FORMAT_IDS.includes(options.format)) {
    return { ok: false, error: `未知的输出格式：${String(options.format)}` };
  }
  if (options.prefix.length > MAX_PREFIX_LENGTH) {
    return { ok: false, error: `前缀不能超过 ${MAX_PREFIX_LENGTH} 个字符` };
  }
  if (/[\s\u0000-\u001f\u007f]/.test(options.prefix)) {
    return { ok: false, error: '前缀不能包含空白或控制字符' };
  }
  if (!GROUP_SIZES.includes(options.groupSize)) {
    return { ok: false, error: `分组长度只能是 ${GROUP_SIZES.join(' / ')}` };
  }

  const alphabet = buildAlphabet(options.format, options.customCharset);
  if (options.format === 'custom') {
    if (alphabet.length < 2) {
      return { ok: false, error: '自定义字符集至少需要 2 个不同的字符' };
    }
    if (alphabet.length > MAX_CUSTOM_ALPHABET) {
      return { ok: false, error: `自定义字符集最多 ${MAX_CUSTOM_ALPHABET} 个字符` };
    }
  }

  return { ok: true, alphabet };
}

/** Hex encoding: two characters per byte, lower case, no separators. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Standard Base64 without the `=` padding.
 *
 * Written out rather than delegating to `btoa`, because `btoa` takes a binary
 * string (so every byte above 0x7f would have to be escaped first) and because
 * this way the encoding can be checked against Node's own implementation.
 * Padding is omitted on purpose: the caller slices to an exact character count,
 * and a truncated group is still uniform per character because each output
 * character carries exactly six bits.
 */
export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  const table = urlSafe ? BASE64URL_ALPHABET : BASE64_ALPHABET;
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : undefined;
    const third = index + 2 < bytes.length ? bytes[index + 2] : undefined;

    out += table[first >> 2];
    out += table[((first & 0x03) << 4) | (second === undefined ? 0 : second >> 4)];
    if (second === undefined) break;
    out += table[((second & 0x0f) << 2) | (third === undefined ? 0 : third >> 6)];
    if (third === undefined) break;
    out += table[third & 0x3f];
  }
  return out;
}

/** Number of bytes needed to produce `length` characters of a format. */
export function byteCountFor(format: TokenFormat, length: number): number {
  if (format === 'hex') return Math.ceil(length / 2);
  if (format === 'base64' || format === 'base64url') return Math.ceil((length * 6) / 8);
  return 0;
}

/**
 * Encodes whole bytes and truncates to `length` characters.
 *
 * Truncation is safe for these alphabets: every character is a whole 4-bit or
 * 6-bit group of the byte stream, so a prefix of the encoding is as uniform as
 * the full encoding. This is why hex and Base64 do not need rejection sampling,
 * and why the result can be compared against Node's encoder character by
 * character.
 */
export function encodeBytes(bytes: Uint8Array, format: TokenFormat, length: number): string {
  if (format === 'hex') return bytesToHex(bytes).slice(0, length);
  if (format === 'base64') return bytesToBase64(bytes, false).slice(0, length);
  if (format === 'base64url') return bytesToBase64(bytes, true).slice(0, length);
  throw new Error('自定义字符集不使用字节编码');
}

/**
 * Draws `length` characters uniformly from `alphabet` using rejection sampling.
 *
 * `byte % alphabetSize` skews towards the first `256 % alphabetSize` characters
 * unless the byte range is trimmed to a whole multiple of the alphabet size
 * first. Bytes in the incomplete tail are drawn again instead, which keeps every
 * character exactly equally likely.
 */
export function randomChars(
  alphabet: string[],
  length: number,
  source: RandomSource,
): string {
  const size = alphabet.length;
  if (size < 2) throw new Error('字符集至少需要 2 个字符');
  if (size > MAX_CUSTOM_ALPHABET) throw new Error('字符集过大');

  const limit = Math.floor(256 / size) * size;
  let out = '';
  // Counted separately from `out.length`: an astral character (an emoji in a
  // custom alphabet) is two UTF-16 units, and counting those would stop the
  // loop short and return a token shorter than asked for.
  let produced = 0;
  let guard = 0;

  while (produced < length) {
    const batch = source(Math.max((length - produced) * 2, 8));
    if (batch.length === 0) throw new Error('随机源没有返回任何字节');
    for (const value of batch) {
      if (value >= limit) continue;
      out += alphabet[value % size];
      produced += 1;
      if (produced === length) break;
    }
    guard += 1;
    if (guard > 1000) throw new Error('随机源拒绝了过多取值');
  }

  return out;
}

export interface GeneratedToken {
  /** The random part, without the prefix. */
  body: string;
  /** Prefix plus body: what is actually used. */
  value: string;
  /** Prefix plus grouped body: what is shown, for easier transcription. */
  display: string;
}

export interface TokenBatch {
  format: TokenFormat;
  prefix: string;
  groupSize: number;
  alphabetSize: number;
  bitsPerChar: number;
  bitsPerToken: number;
  equivalentBytes: number;
  /** Total entropy across the batch, i.e. bitsPerToken × count. */
  totalBits: number;
  /** log10 of the chance that two tokens in this batch collide. */
  log10CollisionChance: number;
  tokens: GeneratedToken[];
  /** Grouped rendering, for the text area. */
  displayText: string;
  /** Ungrouped values, for the clipboard and the exported file. */
  rawText: string;
}

export type TokenBatchResult = { ok: true; batch: TokenBatch } | { ok: false; error: string };

/** `length × log2(alphabetSize)`. */
export function entropyBits(length: number, alphabetSize: number): number {
  if (length <= 0 || alphabetSize <= 1) return 0;
  return length * Math.log2(alphabetSize);
}

/** Equivalent number of uniformly random bytes for a given number of bits. */
export function equivalentBytes(bits: number): number {
  return bits / 8;
}

/**
 * log10 of the probability that at least two of `count` tokens collide, by the
 * birthday bound `count² / 2^(bits+1)`. Reported so a short token with a large
 * count is visibly a bad idea rather than silently full of duplicates.
 */
export function log10CollisionChance(count: number, bitsPerToken: number): number {
  if (count < 2 || bitsPerToken <= 0) return -Infinity;
  const pairsLog10 = Math.log10((count * (count - 1)) / 2);
  return pairsLog10 - bitsPerToken * Math.log10(2);
}

/** Inserts `separator` every `groupSize` characters. */
export function groupToken(text: string, groupSize: number, separator = ' '): string {
  if (groupSize <= 0) return text;
  const chars = [...text];
  const groups: string[] = [];
  for (let index = 0; index < chars.length; index += groupSize) {
    groups.push(chars.slice(index, index + groupSize).join(''));
  }
  return groups.join(separator);
}

function buildToken(
  options: TokenOptions,
  alphabet: string[],
  source: RandomSource,
): GeneratedToken {
  const body =
    options.format === 'custom'
      ? randomChars(alphabet, options.length, source)
      : encodeBytes(
          source(byteCountFor(options.format, options.length)),
          options.format,
          options.length,
        );

  return {
    body,
    value: `${options.prefix}${body}`,
    display: `${options.prefix}${groupToken(body, options.groupSize)}`,
  };
}

export function generateToken(options: TokenOptions, source: RandomSource): TokenBatchResult {
  const validation = validateOptions(options);
  if (!validation.ok) return validation;

  return {
    ok: true,
    batch: assembleBatch(options, validation.alphabet, [buildToken(options, validation.alphabet, source)]),
  };
}

export function generateTokens(options: TokenOptions, source: RandomSource): TokenBatchResult {
  const validation = validateOptions(options);
  if (!validation.ok) return validation;

  const tokens: GeneratedToken[] = [];
  for (let index = 0; index < options.count; index += 1) {
    tokens.push(buildToken(options, validation.alphabet, source));
  }

  return { ok: true, batch: assembleBatch(options, validation.alphabet, tokens) };
}

function assembleBatch(
  options: TokenOptions,
  alphabet: string[],
  tokens: GeneratedToken[],
): TokenBatch {
  const bitsPerToken = entropyBits(options.length, alphabet.length);
  const bitsPerChar = alphabet.length > 1 ? Math.log2(alphabet.length) : 0;

  return {
    format: options.format,
    prefix: options.prefix,
    groupSize: options.groupSize,
    alphabetSize: alphabet.length,
    bitsPerChar,
    bitsPerToken,
    equivalentBytes: equivalentBytes(bitsPerToken),
    totalBits: bitsPerToken * tokens.length,
    log10CollisionChance: log10CollisionChance(tokens.length, bitsPerToken),
    tokens,
    displayText: tokens.map((token) => token.display).join('\n'),
    rawText: tokens.map((token) => token.value).join('\n'),
  };
}

/** Text for the clipboard or the exported file. */
export function tokensToText(tokens: GeneratedToken[], grouped: boolean): string {
  return tokens.map((token) => (grouped ? token.display : token.value)).join('\n');
}
