/**
 * Text ↔ binary, anchored to UTF-8 bytes.
 *
 * ## Why the bytes are not the characters
 *
 * "Text to binary" almost always means: encode the text as UTF-8, then print
 * every byte as eight bits. It does *not* mean "print each character's code
 * point". That difference is the single most common way this kind of tool is
 * wrong:
 *
 *   - "A" is one byte, 0x41, so 01000001 — one character, eight bits.
 *   - "中" is one character, but its code point U+4E2D needs 16 bits, while
 *     UTF-8 stores it in three bytes: 11100100 10111000 10101101.
 *   - "😀" is one character, its code point U+1F600 needs 21 bits, and UTF-8
 *     stores it in four bytes: 11110000 10011111 10011000 10000000.
 *
 * A loop over `charCodeAt(i).toString(2)` gets all three wrong, and a loop over
 * `codePointAt(i)` is still not UTF-8 either. The check suite pins those naive
 * variants down so the difference cannot silently regress.
 *
 * ## Why UTF-8 is implemented here rather than delegated to TextEncoder
 *
 * `TextEncoder` is the authority this code is measured against, so calling it
 * would make the comparison circular. The encoder and the strict decoder below
 * are written out longhand so the checks can compare them, byte for byte, with
 * `TextEncoder` and `TextDecoder` — the platform implementations.
 */

/** How the eight-bit groups are laid out. */
export type SeparatorMode = 'none' | 'byte' | 'group8';

/** Modes in the order the UI offers them. */
export const SEPARATOR_MODES: readonly SeparatorMode[] = ['none', 'byte', 'group8'];

/** Bytes per line for the `group8` layout. */
export const GROUP_SIZE = 8;

/**
 * Upper bound on the per-byte table the UI renders.
 *
 * The conversion itself has no cap, but a table row per byte would make the
 * page unusable for a long document. Above this the table is cut off and says
 * so; the full result stays in the copyable output.
 */
export const MAX_TABLE_BYTES = 256;

export interface TextStats {
  /** Number of UTF-8 bytes. */
  byteCount: number;
  /** Number of Unicode code points — what a reader would call "characters". */
  charCount: number;
  /**
   * `text.length`, i.e. number of UTF-16 code units.
   *
   * Surfaced separately because it is the number JavaScript reports and it is
   * the one that surprises people: "😀".length is 2, not 1.
   */
  utf16Length: number;
}

/**
 * Counts code points.
 *
 * `text.length` cannot be used: it counts UTF-16 code units, so every emoji
 * outside the BMP counts as two. Iterating with `codePointAt` and stepping
 * over the low surrogate is the correct count.
 */
export function countCharacters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const codePoint = text.codePointAt(i) ?? 0;
    // A code point above U+FFFF was read from a surrogate pair, so the next
    // code unit belongs to the character already counted.
    if (codePoint > 0xffff) i += 1;
    count += 1;
  }
  return count;
}

/** Byte and character counts for a piece of text. */
export function describeText(text: string): TextStats {
  return {
    byteCount: encodeUtf8(text).length,
    charCount: countCharacters(text),
    utf16Length: text.length,
  };
}

/**
 * UTF-8 encoder.
 *
 * Matches the WHATWG encoding algorithm, including its treatment of malformed
 * input: an unpaired surrogate encodes as U+FFFD (0xEF 0xBF 0xBD), which is
 * exactly what `TextEncoder` does. Returning the raw surrogate instead would
 * make this encoder disagree with the platform on input such as "a\uD800b".
 */
export function encodeUtf8(text: string): number[] {
  const bytes: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    let codePoint = text.codePointAt(i) ?? 0;
    // A code point above U+FFFF came from a surrogate pair; skip its second
    // code unit so it is not encoded again.
    if (codePoint > 0xffff) i += 1;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return bytes;
}

export interface DecodeFailure {
  ok: false;
  error: string;
}

export type DecodeResult = { ok: true; text: string } | DecodeFailure;

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Strict UTF-8 decoder.
 *
 * "Strict" means the three things a permissive decoder lets through are
 * rejected with a reason: overlong encodings (0xC0 0x80 for NUL), surrogate
 * code points, and code points above U+10FFFF. Accepting them would let two
 * different byte strings decode to the same text and would round-trip back to
 * different bytes — the classic UTF-8 security bug. `TextDecoder` with
 * `fatal: true` is the oracle this is checked against.
 */
export function decodeUtf8(bytes: readonly number[]): DecodeResult {
  const codePoints: number[] = [];
  let i = 0;

  while (i < bytes.length) {
    const first = bytes[i];
    let codePoint: number;
    let length: number;
    let minimum: number;

    if (first < 0x80) {
      codePoint = first;
      length = 1;
      minimum = 0;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      length = 2;
      minimum = 0x80;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      length = 3;
      minimum = 0x800;
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07;
      length = 4;
      minimum = 0x10000;
    } else {
      return {
        ok: false,
        error: `第 ${i + 1} 个字节 0x${hexByte(first)} 不是合法的 UTF-8 起始字节。`,
      };
    }

    if (i + length > bytes.length) {
      return {
        ok: false,
        error:
          `第 ${i + 1} 个字节 0x${hexByte(first)} 表示一个 ${length} 字节字符的开头，` +
          `但后面只剩 ${bytes.length - i - 1} 个字节，数据被截断了。`,
      };
    }

    for (let offset = 1; offset < length; offset += 1) {
      const next = bytes[i + offset];
      if ((next & 0xc0) !== 0x80) {
        return {
          ok: false,
          error:
            `第 ${i + offset + 1} 个字节 0x${hexByte(next)} 不是合法的 UTF-8 续字节` +
            `（续字节必须是 10xxxxxx）。`,
        };
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }

    if (codePoint < minimum) {
      return {
        ok: false,
        error:
          `第 ${i + 1}–${i + length} 个字节是"过长编码"（overlong）：` +
          `它本可以用更少的字节表示 U+${codePoint.toString(16).toUpperCase()}，` +
          `UTF-8 不允许这种写法。`,
      };
    }
    if (codePoint > 0x10ffff) {
      return {
        ok: false,
        error:
          `第 ${i + 1}–${i + length} 个字节解出 U+${codePoint
            .toString(16)
            .toUpperCase()}，超出 Unicode 的最大码位 U+10FFFF。`,
      };
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      return {
        ok: false,
        error:
          `第 ${i + 1}–${i + length} 个字节编码的是代理区码位 U+D800–U+DFFF，` +
          `这些码位不能出现在 UTF-8 里（它们只用于 UTF-16 内部表示）。`,
      };
    }

    codePoints.push(codePoint);
    i += length;
  }

  let text = '';
  for (const codePoint of codePoints) text += String.fromCodePoint(codePoint);
  return { ok: true, text };
}

/** Renders bytes as eight-bit groups. */
export function bytesToBinary(bytes: readonly number[], mode: SeparatorMode = 'byte'): string {
  const groups = bytes.map((byte) => byte.toString(2).padStart(8, '0'));

  if (mode === 'none') return groups.join('');
  if (mode === 'byte') return groups.join(' ');

  // `group8`: space between bytes, newline every GROUP_SIZE bytes. Without the
  // line break a long document is one unreadable line that also forces the
  // textarea to scroll horizontally forever.
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += GROUP_SIZE) {
    lines.push(groups.slice(i, i + GROUP_SIZE).join(' '));
  }
  return lines.join('\n');
}

/** Renders bytes as uppercase two-digit hex, one space between bytes. */
export function bytesToHex(bytes: readonly number[]): string {
  return bytes.map(hexByte).join(' ');
}

/** Renders bytes as decimal values, one space between bytes. */
export function bytesToDecimal(bytes: readonly number[]): string {
  return bytes.join(' ');
}

export interface BinaryParseFailure {
  ok: false;
  error: string;
}

export type BinaryParseResult = { ok: true; bytes: number[] } | BinaryParseFailure;

/**
 * Parses a binary string into bytes, leniently about layout and strictly about
 * content.
 *
 * Spaces, tabs and newlines are ignored so a value copied out of a terminal,
 * wrapped by the textarea or produced by any of the three separator modes still
 * parses. Anything that is not 0 or 1, however, is reported rather than
 * dropped: silently ignoring a stray character would turn a typo into a
 * different message with no indication that anything was lost.
 */
export function binaryToBytes(input: string): BinaryParseResult {
  const bits = input.replace(/\s+/g, '');

  for (let index = 0; index < bits.length; index += 1) {
    const character = bits[index];
    if (character !== '0' && character !== '1') {
      return {
        ok: false,
        error:
          `第 ${index + 1} 个二进制位是 “${character}”，只允许 0 和 1` +
          `（空格与换行会被忽略，其它字符不会）。`,
      };
    }
  }

  if (bits.length === 0) return { ok: true, bytes: [] };

  if (bits.length % 8 !== 0) {
    const remainder = bits.length % 8;
    return {
      ok: false,
      error:
        `二进制位数为 ${bits.length}，不是 8 的倍数：每 8 位组成一个字节，` +
        `末尾多出 ${remainder} 位（补齐到 ${bits.length + (8 - remainder)} 位才合法）。`,
    };
  }

  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return { ok: true, bytes };
}

export interface TextToBinaryResult extends TextStats {
  bytes: number[];
  binary: string;
  hex: string;
  decimal: string;
}

/** The whole text → binary conversion in one call. */
export function textToBinary(text: string, mode: SeparatorMode = 'byte'): TextToBinaryResult {
  const bytes = encodeUtf8(text);
  return {
    bytes,
    binary: bytesToBinary(bytes, mode),
    hex: bytesToHex(bytes),
    decimal: bytesToDecimal(bytes),
    byteCount: bytes.length,
    charCount: countCharacters(text),
    utf16Length: text.length,
  };
}

export interface BinaryToTextSuccess extends TextStats {
  ok: true;
  text: string;
  bytes: number[];
  hex: string;
  decimal: string;
}

export type BinaryToTextResult = BinaryToTextSuccess | BinaryParseFailure | DecodeFailure;

/** The whole binary → text conversion in one call, with the failure reason. */
export function binaryToText(input: string): BinaryToTextResult {
  const parsed = binaryToBytes(input);
  if (!parsed.ok) return parsed;

  const decoded = decodeUtf8(parsed.bytes);
  if (!decoded.ok) return decoded;

  return {
    ok: true,
    text: decoded.text,
    bytes: parsed.bytes,
    hex: bytesToHex(parsed.bytes),
    decimal: bytesToDecimal(parsed.bytes),
    byteCount: parsed.bytes.length,
    charCount: countCharacters(decoded.text),
    utf16Length: decoded.text.length,
  };
}

/**
 * The tempting-but-wrong rendering, kept only so the UI and the checks can show
 * what it produces next to the correct answer.
 *
 * It takes every code point, writes it in base two and pads it to eight bits.
 * That looks like "text to binary" and is what a tool written from intuition
 * usually does, but it is not UTF-8: it produces six bits of padding noise for
 * a Chinese character and 21 bits for an emoji, and the result cannot be read
 * back as bytes by anything else. `padStart` cannot even mask the overflow, so
 * a code point above U+00FF prints more than eight digits.
 */
export function naiveCodePointBinary(text: string): string {
  return Array.from(text)
    .map((character) => (character.codePointAt(0) ?? 0).toString(2).padStart(8, '0'))
    .join(' ');
}

export interface ByteRow {
  /** 1-based byte offset, as a hex viewer numbers them. */
  index: number;
  binary: string;
  hex: string;
  decimal: number;
}

/** One table row per byte, truncated to `limit` entries. */
export function byteRows(
  bytes: readonly number[],
  limit: number = MAX_TABLE_BYTES,
): { rows: ByteRow[]; truncated: boolean } {
  const shown = bytes.slice(0, limit);
  return {
    rows: shown.map((byte, index) => ({
      index: index + 1,
      binary: byte.toString(2).padStart(8, '0'),
      hex: hexByte(byte),
      decimal: byte,
    })),
    truncated: bytes.length > shown.length,
  };
}
