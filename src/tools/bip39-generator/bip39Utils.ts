/**
 * BIP-39 mnemonic helpers (mnemonic generation, decoding and seed derivation).
 *
 * The module is split in two layers on purpose:
 *
 *   - A synchronous core that only does bit shuffling. It never hashes anything
 *     itself: the SHA-256 digest of the entropy is a *parameter*. That keeps the
 *     interesting arithmetic (checksum bit counts, 11-bit grouping) pure and
 *     directly testable, and lets the check script feed a digest produced by
 *     node:crypto while the browser feeds one from Web Crypto.
 *   - Thin async wrappers that call Web Crypto for SHA-256 and PBKDF2 and add
 *     the error reporting the UI needs.
 *
 * Randomness and hashing are injected rather than reached for, so nothing here
 * reads a clock, touches the DOM or imports React. `crypto.getRandomValues` is
 * called by the component and the bytes are handed in.
 *
 * Deliberately out of scope (see the tool description): BIP-32/44 derivation,
 * address generation, QR codes. This module stops at the 64-byte seed.
 */
import { BIP39_ENGLISH_WORDS } from './wordlist';

/** Entropy sizes BIP-39 allows, in bits. */
export type EntropyBits = 128 | 160 | 192 | 224 | 256;

/** Selectable entropy sizes, in the order the UI offers them. */
export const ENTROPY_BITS: readonly EntropyBits[] = [128, 160, 192, 224, 256];

/**
 * Words produced per entropy size, straight from the BIP-39 table:
 * CS = ENT / 32, MS = (ENT + CS) / 11.
 */
export const WORD_COUNT: Record<EntropyBits, number> = {
  128: 12,
  160: 15,
  192: 18,
  224: 21,
  256: 24,
};

/**
 * The inverse table, used to recover the entropy size of a pasted mnemonic.
 *
 * A word count with no entry here (11, 13, 25, ...) is not a valid BIP-39
 * sentence, so the parse fails rather than guessing.
 */
export const BITS_BY_WORD_COUNT: Readonly<Record<number, EntropyBits>> = {
  12: 128,
  15: 160,
  18: 192,
  21: 224,
  24: 256,
};

/** Bits of checksum for an entropy size: ENT / 32. */
export function checksumBitCount(bits: EntropyBits): number {
  return bits / 32;
}

/** The word list, exposed so the UI can count it and tests can inspect it. */
export const WORDLIST: readonly string[] = BIP39_ENGLISH_WORDS;

/** The BIP-39 word list, in order. */
export function wordlistSize(): number {
  return WORDLIST.length;
}

/** Index of a word, or -1. Case-sensitive: the list is lowercase by definition. */
export function wordIndex(word: string): number {
  return WORDLIST.indexOf(word);
}

/**
 * Suggests words that start with the same four letters as `typo`.
 *
 * BIP-39 guarantees that the first four letters identify a word uniquely, which
 * is why wallets let people type abbreviations. That same property makes a
 * four-letter prefix a good typo hint: a misheard or mistyped word very often
 * shares its prefix with the intended one.
 */
export function suggestWords(typo: string): string[] {
  const prefix = typo.slice(0, 4);
  if (prefix.length < 4) return [];
  return WORDLIST.filter((word) => word.startsWith(prefix));
}

/** Reads bytes as a big-endian bit array (most significant bit first). */
export function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >> shift) & 1);
  }
  return bits;
}

/**
 * Packs a bit array back into bytes (big-endian, most significant bit first).
 *
 * The length must be a multiple of 8: BIP-39 entropy is always a whole number of
 * bytes, and a truncated group would silently drop the low bits of the last
 * byte.
 */
export function bitsToBytes(bits: readonly number[]): Uint8Array {
  if (bits.length % 8 !== 0) {
    throw new Error(`位数组长度 ${bits.length} 不是 8 的倍数，无法还原为字节`);
  }
  const bytes = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bytes.length; i += 1) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i * 8 + j] ? 1 : 0);
    bytes[i] = value;
  }
  return bytes;
}

/** Lowercase hex of raw bytes. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Parses hex into bytes, strictly.
 *
 * Used by the UI so a hand-written entropy can be turned into a mnemonic. A
 * stray character, an odd digit count or an empty string is an error: quietly
 * dropping a nibble would generate a valid-looking mnemonic for the wrong
 * entropy.
 */
export function parseHexBytes(text: string): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  const cleaned = text.trim().replace(/[\s:_-]/g, '').replace(/^0x/i, '');
  if (cleaned === '') return { ok: false, error: '十六进制熵为空' };
  const stray = /[^0-9a-fA-F]/.exec(cleaned);
  if (stray) return { ok: false, error: `含有非十六进制字符「${stray[0]}」` };
  if (cleaned.length % 2 !== 0) {
    return { ok: false, error: `有 ${cleaned.length} 位十六进制数字，必须成对（每字节 2 位）` };
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return { ok: true, bytes };
}

/**
 * Rejects an entropy buffer that is not one of the five legal sizes.
 *
 * A length check in bytes is the same as "a multiple of 32 bits" here because
 * the five legal sizes are exactly 16/20/24/28/32 bytes. 17 bytes is the
 * interesting rejection: it is not a multiple of 4 bytes, and treating it as
 * "about 136 bits" would produce a mnemonic whose checksum is nonsense.
 */
export function validateEntropy(entropy: Uint8Array): string | null {
  const bits = entropy.length * 8;
  if (!ENTROPY_BITS.includes(bits as EntropyBits)) {
    return `熵长度 ${bits} 位（${entropy.length} 字节）不合法，BIP-39 只接受 128 / 160 / 192 / 224 / 256 位（16 / 20 / 24 / 28 / 32 字节，必须是 32 位的倍数）`;
  }
  return null;
}

/** The checksum bits of an entropy digest: the first ENT/32 bits, as a string. */
export function checksumBitsFromDigest(digest: Uint8Array, count: number): string {
  return bytesToBits(digest).slice(0, count).join('');
}

/**
 * entropy + checksum -> mnemonic, given the SHA-256 digest of the entropy.
 *
 * The concatenated bits are read 11 at a time, most significant bit first, each
 * group indexing the word list. The digest is passed in rather than computed
 * here so this stays synchronous and testable.
 */
export function entropyToMnemonicFromDigest(entropy: Uint8Array, digest: Uint8Array): string {
  const error = validateEntropy(entropy);
  if (error) throw new Error(error);
  const bits = entropy.length * 8;
  const cs = checksumBitCount(bits as EntropyBits);
  const stream = bytesToBits(entropy).concat(bytesToBits(digest).slice(0, cs));
  const words: string[] = [];
  for (let i = 0; i < stream.length; i += 11) {
    let index = 0;
    for (let j = 0; j < 11; j += 1) index = (index << 1) | stream[i + j];
    words.push(WORDLIST[index]);
  }
  return words.join(' ');
}

/** One word that is not in the list, with its 1-based position. */
export interface UnknownWord {
  position: number;
  word: string;
  suggestions: string[];
}

/** A mnemonic that could not be decoded. */
export interface MnemonicFailure {
  ok: false;
  code: 'empty' | 'count' | 'unknown';
  error: string;
  /** Tokens after normalisation, so the UI can still show what it read. */
  words: string[];
  /** Words that are not in the list (only for code === 'unknown'). */
  unknown: UnknownWord[];
  /** True when upper-case letters had to be folded away to find the words. */
  caseFolded: boolean;
  /** True when the input had runs of whitespace that were collapsed. */
  whitespaceCollapsed: boolean;
}

/** A successfully decoded mnemonic. */
export interface MnemonicParse {
  ok: true;
  /** The sentence rebuilt from the canonical words, single spaces. */
  normalized: string;
  words: string[];
  indices: number[];
  bits: EntropyBits;
  wordCount: number;
  checksumLength: number;
  entropy: Uint8Array;
  entropyHex: string;
  /** Checksum bits carried by the sentence, as a bit string. */
  checksumBits: string;
  /** The same checksum bits read as an integer. */
  checksumValue: number;
  caseFolded: boolean;
  whitespaceCollapsed: boolean;
}

/** A decoded mnemonic plus the result of checking its checksum. */
export interface MnemonicInspection extends MnemonicParse {
  /** Checksum bits the entropy's own SHA-256 digest demands. */
  expectedChecksumBits: string;
  expectedChecksumValue: number;
  checksumValid: boolean;
}

/**
 * Splits a mnemonic into words the way a human would: any run of whitespace
 * separates words, leading and trailing whitespace is ignored, and the
 * ideographic space U+3000 counts as whitespace too (it is what other BIP-39
 * word lists use, and it arrives whenever a sentence is copied from a document).
 *
 * Upper case is folded for *lookup* but reported separately: the list is lower
 * case, so accepting "ABANDON" is convenient, yet the user should be told the
 * input was not canonical instead of silently getting a different string.
 */
export function splitMnemonic(text: string): { words: string[]; caseFolded: boolean; whitespaceCollapsed: boolean } {
  const trimmed = text.trim();
  const tokens = trimmed.split(/[\s\u3000]+/).filter((token) => token !== '');
  const caseFolded = tokens.some((token) => token !== token.toLowerCase());
  const canonical = tokens.map((token) => token.toLowerCase());
  return {
    words: canonical,
    caseFolded,
    // Compared against the original tokens, so folding case does not also look
    // like a whitespace problem.
    whitespaceCollapsed: tokens.join(' ') !== trimmed,
  };
}

/**
 * Decodes a mnemonic into indices, entropy and the checksum it carries.
 *
 * No hashing happens here, so the checksum cannot be *verified* yet; the caller
 * compares `checksumBits` against `checksumBitsFromDigest(sha256(entropy))`.
 */
export function parseMnemonic(text: string): MnemonicParse | MnemonicFailure {
  const { words, caseFolded, whitespaceCollapsed } = splitMnemonic(text);

  if (words.length === 0) {
    return {
      ok: false,
      code: 'empty',
      error: '请输入助记词',
      words,
      unknown: [],
      caseFolded,
      whitespaceCollapsed,
    };
  }

  const bits = BITS_BY_WORD_COUNT[words.length];
  if (!bits) {
    return {
      ok: false,
      code: 'count',
      error: `助记词有 ${words.length} 个词，BIP-39 只允许 12 / 15 / 18 / 21 / 24 个词（对应 128 / 160 / 192 / 224 / 256 位熵）`,
      words,
      unknown: [],
      caseFolded,
      whitespaceCollapsed,
    };
  }

  const unknown: UnknownWord[] = [];
  const indices: number[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const index = wordIndex(words[i]);
    if (index < 0) {
      unknown.push({ position: i + 1, word: words[i], suggestions: suggestWords(words[i]) });
    } else {
      indices.push(index);
    }
  }
  if (unknown.length > 0) {
    const first = unknown[0];
    const hint = first.suggestions.length > 0 ? `，是想输入「${first.suggestions[0]}」吗？` : '';
    return {
      ok: false,
      code: 'unknown',
      error: `第 ${first.position} 个词「${first.word}」不在 BIP-39 英文词表中${hint}`,
      words,
      unknown,
      caseFolded,
      whitespaceCollapsed,
    };
  }

  const stream: number[] = [];
  for (const index of indices) {
    for (let shift = 10; shift >= 0; shift -= 1) stream.push((index >> shift) & 1);
  }

  const checksumLength = checksumBitCount(bits);
  const entropyBits = stream.slice(0, words.length * 11 - checksumLength);
  const checksumBits = stream.slice(words.length * 11 - checksumLength).join('');
  const entropy = bitsToBytes(entropyBits);

  return {
    ok: true,
    normalized: words.join(' '),
    words,
    indices,
    bits,
    wordCount: words.length,
    checksumLength,
    entropy,
    entropyHex: bytesToHex(entropy),
    checksumBits,
    checksumValue: Number.parseInt(checksumBits, 2),
    caseFolded,
    whitespaceCollapsed,
  };
}

/** A generated mnemonic with everything the UI displays. */
export interface GeneratedMnemonic extends MnemonicParse {
  mnemonic: string;
}

/** Outcome of generating a mnemonic from caller-supplied entropy. */
export type GenerateOutcome = { ok: true; result: GeneratedMnemonic } | { ok: false; error: string };

const encoder = new TextEncoder();

/**
 * Copies into a fresh ArrayBuffer-backed view.
 *
 * TypeScript types Uint8Array as possibly backed by a SharedArrayBuffer, which
 * Web Crypto's BufferSource rejects.
 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

function subtleOrNull(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null;
}

/** SHA-256 via Web Crypto. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = subtleOrNull();
  if (!subtle) throw new Error('当前环境不支持 Web Crypto，无法计算 SHA-256');
  return new Uint8Array(await subtle.digest('SHA-256', toBuffer(bytes)));
}

/**
 * Fills a buffer with cryptographically secure random bytes.
 *
 * The component passes `crypto.getRandomValues` in, so this module never
 * reaches for a global: in a test the filler can be a fixed sequence, which is
 * the only way to assert anything about a generator's output.
 */
export function randomEntropy(bits: EntropyBits, fill: (target: Uint8Array) => void): Uint8Array {
  const bytes = new Uint8Array(bits / 8);
  fill(bytes);
  return bytes;
}

/**
 * entropy -> mnemonic, hashing the entropy with Web Crypto.
 *
 * The entropy must be supplied by the caller: this function does not generate
 * it, which keeps the whole pipeline deterministic given its input.
 */
export async function entropyToMnemonic(entropy: Uint8Array): Promise<GenerateOutcome> {
  const error = validateEntropy(entropy);
  if (error) return { ok: false, error };
  try {
    const digest = await sha256(entropy);
    const bits = (entropy.length * 8) as EntropyBits;
    const checksumLength = checksumBitCount(bits);
    const parsed = parseMnemonic(entropyToMnemonicFromDigest(entropy, digest));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const checksumBits = checksumBitsFromDigest(digest, checksumLength);
    return {
      ok: true,
      result: {
        ...parsed,
        mnemonic: parsed.normalized,
        // The checksum shown for a *generated* mnemonic comes from the digest,
        // not from re-reading the sentence, so a bug in the encoder cannot make
        // the displayed checksum agree with a wrong sentence.
        checksumBits,
        checksumValue: Number.parseInt(checksumBits, 2),
      },
    };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : '生成失败' };
  }
}

/** Decodes a mnemonic and verifies its checksum against the entropy's digest. */
export async function inspectMnemonic(text: string): Promise<MnemonicInspection | MnemonicFailure> {
  const parsed = parseMnemonic(text);
  if (!parsed.ok) return parsed;
  try {
    const digest = await sha256(parsed.entropy);
    const expectedChecksumBits = checksumBitsFromDigest(digest, parsed.checksumLength);
    return {
      ...parsed,
      expectedChecksumBits,
      expectedChecksumValue: Number.parseInt(expectedChecksumBits, 2),
      checksumValid: expectedChecksumBits === parsed.checksumBits,
    };
  } catch (cause) {
    return {
      ok: false,
      code: 'unknown',
      error: cause instanceof Error ? cause.message : '校验和无法计算',
      words: parsed.words,
      unknown: [],
      caseFolded: parsed.caseFolded,
      whitespaceCollapsed: parsed.whitespaceCollapsed,
    };
  }
}

/**
 * mnemonic (+ optional passphrase) -> 64-byte seed, per the BIP-39 KDF.
 *
 * PBKDF2-HMAC-SHA512, 2048 iterations, password = the sentence in UTF-8 NFKD,
 * salt = "mnemonic" + passphrase in UTF-8 NFKD. The iteration count is low by
 * modern password-hashing standards because it is a key-stretching step over a
 * high-entropy secret, not a password check — that is what the spec mandates and
 * what every wallet implements.
 *
 * Both arguments are NFKD-normalised. For the English list that is a no-op, but a
 * passphrase with accents or compatibility characters would otherwise derive a
 * different seed than every other wallet; the reference implementation's own
 * test suite asserts NFC/NFD/NFKC/NFKD forms agree.
 *
 * The sentence is used verbatim apart from normalisation: this is the one place
 * where normalising the spacing of the input is the caller's job, because a
 * different string is a different seed by definition.
 */
export async function mnemonicToSeed(mnemonic: string, passphrase = ''): Promise<Uint8Array> {
  const subtle = subtleOrNull();
  if (!subtle) throw new Error('当前环境不支持 Web Crypto，无法派生种子');
  const password = encoder.encode(mnemonic.normalize('NFKD'));
  const salt = encoder.encode(`mnemonic${passphrase}`.normalize('NFKD'));
  const key = await subtle.importKey('raw', toBuffer(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: toBuffer(salt), iterations: 2048, hash: 'SHA-512' },
    key,
    512,
  );
  return new Uint8Array(bits);
}

/** Splits long hex output into fixed-width groups for readability. */
export function groupHex(hex: string, size = 8): string {
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += size) groups.push(hex.slice(i, i + size));
  return groups.join(' ');
}

/** The passphrase actually fed to the KDF, so the UI can show it is empty. */
export function describePassphrase(passphrase: string): string {
  return passphrase === ''
    ? '未设置口令：种子完全由助记词决定，任何拿到助记词的人都能还原它'
    : '已加口令：口令错误会派生出一个完全不同的、同样合法的钱包（BIP-39 的合理推诿性）';
}
