/**
 * Text <-> Unicode escape conversion.
 *
 * Pure logic only: no React, no DOM, no clipboard, no clock. Everything here is
 * a total function of its arguments, which is what lets the check script drive
 * it with known vectors and an exhaustive sweep.
 *
 * ## The one thing this module has to get right
 *
 * A JavaScript string is not a sequence of characters, it is a sequence of
 * UTF-16 **code units**. `'😀'.length === 2`, and `'😀'.charCodeAt(0)` is the
 * high surrogate `0xD83D` — neither of those numbers is the character's
 * identity. The identity is the **code point** `U+1F600`, and the only platform
 * interface that speaks code points is `codePointAt` / `fromCodePoint`.
 *
 * Every loop in this file therefore advances over code points, never over
 * `str[i]`. Iterating code units is the classic bug: it turns one emoji into
 * two "characters", produces a bogus `U+D83D U+DE00` code point list and, if
 * those units are then UTF-8 encoded one by one, produces the 6-byte CESU-8
 * sequence `ED A0 BD ED B8 80` instead of the correct 4-byte `F0 9F 98 80`.
 *
 * ## Why the backslash / ampersand / "U+" guards exist
 *
 * The default output keeps ASCII visible characters literal, so escaping then
 * unescaping is expected to return the original text exactly. That only holds
 * if the escaper refuses to emit a *literal* character run that the unescaper
 * would itself have decoded. Text containing `\u0041`, `&#65;` or `U+0041`
 * literally would otherwise come back as `A`. The guards escape exactly those
 * ambiguous starters (`\`, `&` before `#`, `U`/`u` before `+` and a hex digit)
 * and nothing else, so ordinary prose survives unchanged. Writing an escape
 * that decodes to an escape-like literal is always safe, because the escape is
 * consumed as a whole before the literal tail is looked at.
 *
 * Two more ambiguities are specific to the `U+XXXX` notation:
 *
 *   1. Its hex run has no terminator, so `U+0100` followed by a literal `0`
 *      would be read as `U+01000`. The escaper therefore also escapes a hex
 *      digit that sits immediately after an escape in that style, and repeats
 *      for a whole run of them.
 *   2. The code point *list* has to separate entries with something, and a
 *      space is the only readable choice — but a literal space between two
 *      escapes would then be eaten by the decoder. The escaper escapes such a
 *      whitespace run, and the decoder drops whitespace only when it sits
 *      directly between two `U+` escapes. A space next to ordinary text is left
 *      alone, so `hello U+1F600` still decodes to `hello 😀`.
 *
 * The `\uXXXX` form is exactly four digits and the other forms are closed by
 * `}`, `;` or the separator, so none of them needs this.
 */

/** Output notations offered to the user. */
export const ESCAPE_STYLES = [
  'js',
  'es6',
  'codepoint',
  'html-decimal',
  'html-hex',
  'list',
] as const;

export type EscapeStyle = (typeof ESCAPE_STYLES)[number];

/** Largest legal Unicode code point. */
export const MAX_CODE_POINT = 0x10ffff;

/** The character every unencodable code unit is folded to, as TextEncoder does. */
const REPLACEMENT_CODE_POINT = 0xfffd;

export interface EscapeOptions {
  style: EscapeStyle;
  /**
   * Escape ASCII as well. Off by default: escaping `Hello` into `\u0048...`
   * makes the output unreadable, and the point of the tool is usually to deal
   * with the non-ASCII characters.
   */
  escapeAscii: boolean;
  /** Uppercase A-F in hex output. Input parsing accepts either case. */
  uppercase: boolean;
  /**
   * Pad hex to at least four digits. Applies to the hex notations only; the
   * `\uXXXX` form is always exactly four digits because that is its grammar,
   * and decimal HTML entities have no padding concept.
   */
  padTo4: boolean;
}

export interface EscapeResult {
  output: string;
  /** Number of code points in the input (not UTF-16 code units). */
  codePointCount: number;
  /** How many of them were written as an escape. */
  escapedCount: number;
}

/** Everything the tool displays about one character. */
export interface CharInfo {
  char: string;
  /** The identity of the character, e.g. 0x1F600. */
  codePoint: number;
  codePointHex: string;
  /** UTF-16 code units, 1 for BMP characters and 2 for a surrogate pair. */
  codeUnits: number[];
  utf16Hex: string;
  /** RFC 3629 UTF-8 bytes. */
  utf8: number[];
  utf8Hex: string;
  /** True when the code point is an unpaired surrogate (invalid text). */
  loneSurrogate: boolean;
}

export interface TextSummary {
  codePointCount: number;
  codeUnitCount: number;
  utf8ByteCount: number;
  surrogatePairCount: number;
  loneSurrogateCount: number;
}

export interface UnescapeSuccess {
  ok: true;
  text: string;
  /** Number of escape sequences consumed. A surrogate pair written as two
   * `\uXXXX` escapes counts as two. */
  escapeCount: number;
  /** Number of surrogate pairs that were folded into a single code point. */
  surrogatePairCount: number;
}

export interface UnescapeFailure {
  ok: false;
  /** Chinese explanation, ready to show in the UI. */
  message: string;
  /** UTF-16 offset of the offending sequence in the input. */
  index: number;
  /** The offending source text, trimmed for display. */
  snippet: string;
}

export type UnescapeResult = UnescapeSuccess | UnescapeFailure;

interface CodePointEntry {
  codePoint: number;
  char: string;
}

function hexDigits(value: number, minWidth: number, uppercase: boolean): string {
  const text = value.toString(16).padStart(minWidth, '0');
  return uppercase ? text.toUpperCase() : text;
}

export function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

export function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** Surrogates are code *units*, never legal code points. */
export function isSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdfff;
}

export function isHexDigit(character: string | undefined): boolean {
  return character !== undefined && /^[0-9a-fA-F]$/.test(character);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /^\s$/.test(character);
}

/** Whether a `U+XXXX` escape starts at this offset. */
function startsCodePointEscape(input: string, index: number): boolean {
  return (
    (input[index] === 'U' || input[index] === 'u') &&
    input[index + 1] === '+' &&
    isHexDigit(input[index + 2])
  );
}

/** Splits a supplementary code point into its UTF-16 surrogate pair. */
export function surrogatePair(codePoint: number): [number, number] {
  const offset = codePoint - 0x10000;
  return [0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff)];
}

/**
 * UTF-8 bytes for a code point, per RFC 3629.
 *
 * A lone surrogate has no valid UTF-8 form. `TextEncoder` substitutes U+FFFD
 * (the replacement character) and so does this function, rather than emitting
 * the 3-byte WTF-8 sequence that no decoder accepts — that keeps this table
 * byte-for-byte equal to what the platform would actually transmit.
 */
export function utf8Bytes(codePoint: number): number[] {
  const cp = isSurrogate(codePoint) ? REPLACEMENT_CODE_POINT : codePoint;

  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
  if (cp < 0x10000) {
    return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
  }
  return [
    0xf0 | (cp >> 18),
    0x80 | ((cp >> 12) & 0x3f),
    0x80 | ((cp >> 6) & 0x3f),
    0x80 | (cp & 0x3f),
  ];
}

/**
 * Walks the string by code point.
 *
 * Written with explicit surrogate arithmetic rather than `codePointAt` so the
 * check script can compare two independent implementations, and so a lone
 * surrogate is visible as its own entry instead of being silently replaced.
 */
function codePointEntries(text: string): CodePointEntry[] {
  const entries: CodePointEntry[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const nextUnit = index + 1 < text.length ? text.charCodeAt(index + 1) : -1;

    if (isHighSurrogate(unit) && isLowSurrogate(nextUnit)) {
      const codePoint = 0x10000 + ((unit - 0xd800) << 10) + (nextUnit - 0xdc00);
      entries.push({ codePoint, char: text.slice(index, index + 2) });
      index += 1;
    } else {
      entries.push({ codePoint: unit, char: text[index] });
    }
  }

  return entries;
}

export function describeText(text: string): CharInfo[] {
  return codePointEntries(text).map((entry) => {
    const codeUnits =
      entry.codePoint > 0xffff ? surrogatePair(entry.codePoint) : [entry.codePoint];
    const utf8 = utf8Bytes(entry.codePoint);

    return {
      char: entry.char,
      codePoint: entry.codePoint,
      codePointHex: `U+${hexDigits(entry.codePoint, 4, true)}`,
      codeUnits: [...codeUnits],
      utf16Hex: codeUnits.map((unit) => hexDigits(unit, 4, true)).join(' '),
      utf8,
      utf8Hex: utf8.map((byte) => hexDigits(byte, 2, true)).join(' '),
      loneSurrogate: isSurrogate(entry.codePoint),
    } satisfies CharInfo;
  });
}

export function summariseText(text: string): TextSummary {
  const entries = codePointEntries(text);
  let utf8ByteCount = 0;
  let surrogatePairCount = 0;
  let loneSurrogateCount = 0;

  for (const entry of entries) {
    utf8ByteCount += utf8Bytes(entry.codePoint).length;
    if (entry.codePoint > 0xffff) surrogatePairCount += 1;
    else if (isSurrogate(entry.codePoint)) loneSurrogateCount += 1;
  }

  return {
    codePointCount: entries.length,
    codeUnitCount: text.length,
    utf8ByteCount,
    surrogatePairCount,
    loneSurrogateCount,
  };
}

/** True when the text contains an unpaired surrogate, i.e. is not valid text. */
export function hasLoneSurrogate(text: string): boolean {
  return summariseText(text).loneSurrogateCount > 0;
}

/** The escape sequence for one code point in the requested notation. */
export function formatCodePoint(codePoint: number, options: EscapeOptions): string {
  const width = options.padTo4 ? 4 : 1;

  switch (options.style) {
    case 'js': {
      // The `\uXXXX` grammar is exactly four hex digits, so `padTo4` cannot
      // shorten it. Above the BMP it takes a surrogate pair, because that is
      // the only thing a JS / JSON string literal can hold.
      if (codePoint <= 0xffff) {
        return `\\u${hexDigits(codePoint, 4, options.uppercase)}`;
      }
      const [high, low] = surrogatePair(codePoint);
      return (
        `\\u${hexDigits(high, 4, options.uppercase)}` +
        `\\u${hexDigits(low, 4, options.uppercase)}`
      );
    }
    case 'es6':
      return `\\u{${hexDigits(codePoint, width, options.uppercase)}}`;
    case 'codepoint':
    case 'list':
      return `U+${hexDigits(codePoint, width, options.uppercase)}`;
    case 'html-decimal':
      return `&#${codePoint};`;
    case 'html-hex':
      return `&#x${hexDigits(codePoint, width, options.uppercase)};`;
  }
}

/**
 * Whether leaving this character literal would let the unescaper misinterpret
 * it as the start of an escape sequence.
 */
function startsEscape(entries: CodePointEntry[], index: number): boolean {
  const codePoint = entries[index].codePoint;

  // Backslash: `\uXXXX` and `\u{...}` are recognised no matter which style
  // produced the text, so it is guarded in every style.
  if (codePoint === 0x5c) return true;

  // Ampersand, but only directly before a `#`: `&` on its own is just an
  // ampersand and escaping every one of them in the HTML styles would be noisy.
  if (codePoint === 0x26) return entries[index + 1]?.codePoint === 0x23;

  // U or u, but only in the `U+XXXX` shape.
  if (codePoint === 0x55 || codePoint === 0x75) {
    if (entries[index + 1]?.codePoint !== 0x2b) return false;
    return isHexDigit(entries[index + 2]?.char);
  }

  return false;
}

export function escapeText(text: string, options: EscapeOptions): EscapeResult {
  const entries = codePointEntries(text);
  const escaped: boolean[] = new Array(entries.length).fill(false);

  if (options.style === 'list') {
    // A code point list is the enumeration itself: listing only the non-ASCII
    // characters would leave the ASCII ones as opaque text and defeat it.
    escaped.fill(true);
  } else {
    for (let index = 0; index < entries.length; index += 1) {
      const { codePoint } = entries[index];
      escaped[index] =
        options.escapeAscii ||
        codePoint > 0x7e ||
        codePoint < 0x20 ||
        codePoint === 0x7f ||
        startsEscape(entries, index);
    }

    if (options.style === 'codepoint') {
      // `U+0100` has no closing delimiter, so a following literal `0` would be
      // absorbed into the number. Escaping the hex digit that follows an escape
      // terminates it (the replacement starts with `U`, which is not hex), and
      // the loop propagates for as long as hex digits keep following.
      for (let index = 0; index < entries.length - 1; index += 1) {
        if (escaped[index] && !escaped[index + 1] && isHexDigit(entries[index + 1].char)) {
          escaped[index + 1] = true;
        }
      }

      // Whitespace between two escapes is what the decoder treats as a code
      // point separator, so it has to be escaped to survive a round trip. Only
      // a run with an escape on both sides qualifies; `a U+4E2D b` keeps its
      // spaces. This runs after the hex pass because a hex digit escaped there
      // counts as the left-hand escape.
      for (let index = 0; index < entries.length; index += 1) {
        if (!escaped[index] || !isWhitespace(entries[index + 1]?.char)) continue;
        let end = index + 1;
        while (end < entries.length && isWhitespace(entries[end].char)) end += 1;
        if (end < entries.length && escaped[end]) {
          for (let inner = index + 1; inner < end; inner += 1) escaped[inner] = true;
        }
      }
    }
  }

  const parts = entries.map((entry, index) =>
    escaped[index] ? formatCodePoint(entry.codePoint, options) : entry.char,
  );

  return {
    output: options.style === 'list' ? parts.join(' ') : parts.join(''),
    codePointCount: entries.length,
    escapedCount: escaped.filter(Boolean).length,
  };
}

function failure(index: number, snippet: string, message: string): UnescapeFailure {
  return { ok: false, message, index, snippet };
}

/** Builds the message for a code point outside Unicode or inside the surrogate block. */
function validateCodePoint(
  value: number,
  index: number,
  raw: string,
): UnescapeFailure | null {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CODE_POINT) {
    return failure(index, raw, `码位 ${raw} 超出 Unicode 范围 U+0000 至 U+10FFFF`);
  }
  if (isSurrogate(value)) {
    return failure(
      index,
      raw,
      `U+${hexDigits(value, 4, true)} 是 UTF-16 代理码元，不是合法码位（孤立代理）`,
    );
  }
  return null;
}

/**
 * Decodes every notation this tool can produce, plus `\\` for a literal
 * backslash.
 *
 * Malformed input fails loudly instead of guessing. A lone surrogate in
 * particular must be an error rather than a silent U+FFFD: a replacement
 * character destroys the information that something was wrong, and the caller
 * cannot tell the difference between "the data said U+FFFD" and "the data was
 * broken".
 *
 * `\` followed by anything other than `u` or another `\` is kept verbatim,
 * because ordinary text is full of `\p`, `\t` and Windows paths that were never
 * meant as escapes.
 */
export function unescapeText(input: string): UnescapeResult {
  const parts: string[] = [];
  let escapeCount = 0;
  let surrogatePairCount = 0;
  let index = 0;

  const pushCodePoint = (value: number, at: number, raw: string): UnescapeFailure | null => {
    const problem = validateCodePoint(value, at, raw);
    if (problem) return problem;
    parts.push(String.fromCodePoint(value));
    return null;
  };

  while (index < input.length) {
    const character = input[index];

    if (character === '\\') {
      const next = input[index + 1];

      if (next === '\\') {
        parts.push('\\');
        index += 2;
        continue;
      }

      if (next !== 'u') {
        parts.push(character);
        index += 1;
        continue;
      }

      const bodyStart = index + 2;

      if (input[bodyStart] === '{') {
        const close = input.indexOf('}', bodyStart + 1);
        if (close === -1) {
          return failure(index, input.slice(index, index + 10), '不完整的 \\u{...} 转义：缺少右花括号');
        }
        const digits = input.slice(bodyStart + 1, close);
        if (digits.length === 0 || !/^[0-9a-fA-F]+$/.test(digits)) {
          return failure(
            index,
            input.slice(index, close + 1),
            `\\u{...} 里必须是十六进制数字，读到的却是「${digits || '空'}」`,
          );
        }
        const problem = pushCodePoint(Number.parseInt(digits, 16), index, input.slice(index, close + 1));
        if (problem) return problem;
        escapeCount += 1;
        index = close + 1;
        continue;
      }

      const four = input.slice(bodyStart, bodyStart + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(four)) {
        return failure(
          index,
          input.slice(index, bodyStart + 4),
          `\\u 后面必须紧跟 4 位十六进制数字，这里读到「${four || '（结尾）'}」`,
        );
      }

      const unit = Number.parseInt(four, 16);

      if (isHighSurrogate(unit)) {
        // A high surrogate means nothing on its own: it is only the first half
        // of a pair, and the second half has to be the very next escape.
        const lowStart = bodyStart + 4;
        const lowText = input.slice(lowStart, lowStart + 6);
        const lowMatch = /^\\u([0-9a-fA-F]{4})$/.exec(lowText);
        if (!lowMatch) {
          return failure(
            index,
            input.slice(index, index + 10),
            `孤立的高代理 \\u${four.toUpperCase()}：后面不是配对的低代理 \\uDC00 至 \\uDFFF`,
          );
        }
        const low = Number.parseInt(lowMatch[1], 16);
        if (!isLowSurrogate(low)) {
          return failure(
            index,
            input.slice(index, lowStart + 6),
            `孤立的高代理 \\u${four.toUpperCase()}：后面的 \\u${lowMatch[1].toUpperCase()} 不是低代理`,
          );
        }
        const codePoint = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
        parts.push(String.fromCodePoint(codePoint));
        escapeCount += 2;
        surrogatePairCount += 1;
        index = lowStart + 6;
        continue;
      }

      if (isLowSurrogate(unit)) {
        return failure(
          index,
          four,
          `孤立的低代理 \\u${four.toUpperCase()}：它只能跟在 \\uD800 至 \\uDBFF 之后`,
        );
      }

      parts.push(String.fromCharCode(unit));
      escapeCount += 1;
      index = bodyStart + 4;
      continue;
    }

    if (character === '&' && input[index + 1] === '#') {
      const isHexForm = input[index + 2] === 'x' || input[index + 2] === 'X';
      const digitsStart = index + (isHexForm ? 3 : 2);
      const semicolon = input.indexOf(';', digitsStart);
      const digits = semicolon === -1 ? input.slice(digitsStart) : input.slice(digitsStart, semicolon);
      const valid = isHexForm ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits);

      if (semicolon === -1 || !valid) {
        return failure(
          index,
          input.slice(index, digitsStart + 12),
          'HTML 数字实体格式错误，应为 &#十进制; 或 &#x十六进制;',
        );
      }

      const problem = pushCodePoint(Number.parseInt(digits, isHexForm ? 16 : 10), index, input.slice(index, semicolon + 1));
      if (problem) return problem;
      escapeCount += 1;
      index = semicolon + 1;
      continue;
    }

    if ((character === 'U' || character === 'u') && input[index + 1] === '+') {
      let end = index + 2;
      while (end < input.length && isHexDigit(input[end])) end += 1;

      if (end > index + 2) {
        const problem = pushCodePoint(Number.parseInt(input.slice(index + 2, end), 16), index, input.slice(index, end));
        if (problem) return problem;
        escapeCount += 1;

        // A whitespace run directly between two `U+` escapes is a list
        // separator, so it is skipped. Whitespace next to anything else is
        // literal text and is left for the normal path below.
        let after = end;
        while (after < input.length && isWhitespace(input[after])) after += 1;
        index = after > end && startsCodePointEscape(input, after) ? after : end;
        continue;
      }
    }

    parts.push(character);
    index += 1;
  }

  return { ok: true, text: parts.join(''), escapeCount, surrogatePairCount };
}
