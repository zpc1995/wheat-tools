/**
 * Structural reader for PDF signature dictionaries.
 *
 * ## What this module is, and what it deliberately is not
 *
 * This is a **byte-level, read-only structure reader**. It finds signature
 * dictionaries in a PDF and reports what their entries say. It does not open a
 * CMS / PKCS#7 blob, does not check a certificate chain, does not validate a
 * timestamp and does not decide whether a signature is *valid*. Doing any of
 * that in a browser would need a full cryptographic stack plus a trust store,
 * and a half-done version would be worse than none: a green tick produced by a
 * parser that skipped the hard parts is a security claim the code cannot back
 * up.
 *
 * Exactly one thing here is genuinely verifiable from the bytes alone, and the
 * design funnels effort into it: `/ByteRange`. It states which byte ranges the
 * signature was computed over, so comparing it with the real file length tells
 * you whether anything sits **outside** the signed region — that is, whether
 * content was appended after signing. That comparison needs no cryptography and
 * no trust store, so it is the one conclusion this tool is allowed to draw.
 *
 * ## Why this is not a regex over the file
 *
 * The obvious implementation — search the text for `/Type /Sig` — is wrong in
 * both directions, and both directions are covered by assertions in
 * `scripts/check-pdf-signature-inspector.mjs`:
 *
 *   - False positives: those same characters occur inside PDF string literals
 *     (a document digest or a certificate dump), inside hex strings and inside
 *     stream data. A text search reports those as signatures.
 *   - False negatives: `/V 12 0 R` is how a signature field normally points at
 *     its signature dictionary. A search for `/Type /Sig` never follows that
 *     indirection, so it misses real signatures entirely.
 *
 * So the file is tokenised properly (names with `#xx` escapes, literal and hex
 * strings with their escape rules, dictionaries, arrays either nested or shallow)
 * and signature fields are followed through indirect references.
 *
 * ## Purity
 *
 * Everything takes a `Uint8Array` and returns plain data. No DOM, no React, no
 * clock. The byte-to-character step uses an explicit latin1 table rather than
 * `TextDecoder` so that character offset and byte offset stay the same number —
 * every span this module reports is expressed in those offsets.
 */

import { describeCoverage, formatByteSize } from './pdfTextUtils';

export { describeCoverage, formatByteSize };

/** Largest file this tool will read. Bounds the O(n) scans and the memory. */
export const MAX_PDF_BYTES = 32 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Byte helpers                                                        */
/* ------------------------------------------------------------------ */

function isWhitespace(code: number | undefined): boolean {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    code === 0x0c ||
    code === 0x00
  );
}

function isDelimiter(code: number): boolean {
  return (
    code === 0x28 || // (
    code === 0x29 || // )
    code === 0x3c || // <
    code === 0x3e || // >
    code === 0x5b || // [
    code === 0x5d || // ]
    code === 0x7b || // {
    code === 0x7d || // }
    code === 0x2f || // /
    code === 0x25 //   %
  );
}

function isRegular(code: number): boolean {
  return !isWhitespace(code) && !isDelimiter(code);
}

function isDigit(code: number | undefined): boolean {
  return code !== undefined && code >= 0x30 && code <= 0x39;
}

function hexValue(code: number | undefined): number {
  if (code === undefined) return -1;
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

/**
 * Maps every byte to the character with the same code point.
 *
 * Deliberately not `TextDecoder`: the parser addresses the file by byte offset
 * throughout, and a latin1 mapping guarantees `text[i]` describes byte `i`.
 * Any multi-byte encoding would desynchronise every reported span.
 */
export function toLatin1(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const slice = bytes.subarray(start, Math.min(start + CHUNK, bytes.length));
    out += String.fromCharCode(...slice);
  }
  return out;
}

function latin1OfText(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/* ------------------------------------------------------------------ */
/* Text decoding                                                       */
/* ------------------------------------------------------------------ */

/**
 * The ~25 slots where PDFDocEncoding differs from latin1.
 *
 * Decoding a PDF text string as UTF-8 — the intuitive choice — turns every
 * accented signer name into mojibake, because a PDF text string is either
 * UTF-16BE with a BOM or PDFDocEncoding, never UTF-8.
 */
const PDFDOC_SPECIAL: Record<number, string> = {
  0x18: '\u02d8',
  0x19: '\u02c7',
  0x1a: '\u02c6',
  0x1b: '\u02d9',
  0x1c: '\u02dd',
  0x1d: '\u02db',
  0x1e: '\u02da',
  0x1f: '\u02dc',
  0x80: '\u2022',
  0x81: '\u2020',
  0x82: '\u2021',
  0x83: '\u2026',
  0x84: '\u2014',
  0x85: '\u2013',
  0x86: '\u0192',
  0x87: '\u2044',
  0x88: '\u2039',
  0x89: '\u203a',
  0x8a: '\u2212',
  0x8b: '\u2030',
  0x8c: '\u201e',
  0x8d: '\u201c',
  0x8e: '\u201d',
  0x8f: '\u2018',
  0x90: '\u2019',
  0x91: '\u201a',
  0x92: '\u2122',
  0x93: '\ufb01',
  0x94: '\ufb02',
  0x95: '\u0141',
  0x96: '\u0152',
  0x97: '\u0160',
  0x98: '\u0178',
  0x99: '\u017d',
  0x9a: '\u0131',
  0x9b: '\u0142',
  0x9c: '\u0153',
  0x9d: '\u0161',
  0x9e: '\u017e',
  0xa0: '\u20ac',
};

/** Turns PDF text-string bytes into display text. */
export function decodePdfString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const code = bytes[i];
    out += code === 0 ? '' : PDFDOC_SPECIAL[code] ?? String.fromCharCode(code);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lexer                                                               */
/* ------------------------------------------------------------------ */

type TokenKind = 'number' | 'name' | 'string' | 'hex' | 'keyword' | 'punct' | 'eof';

interface Token {
  kind: TokenKind;
  /** Raw text for numbers and keywords, decoded text for names and strings. */
  text: string;
  /** `[start, end)` in byte offsets. */
  start: number;
  end: number;
}

function numberEnd(text: string, start: number): number {
  let i = start;
  if (text[i] === '+' || text[i] === '-') i += 1;
  while (isDigit(text.charCodeAt(i))) i += 1;
  if (text[i] === '.') {
    i += 1;
    while (isDigit(text.charCodeAt(i))) i += 1;
  }
  return i;
}

/**
 * A position-addressed PDF tokeniser.
 *
 * Tokens are cached per start offset: scanning the file for `obj` and then
 * repeating the search for `trailer` re-reads many of the same positions, and
 * re-lexing a literal string with escapes for each of them is wasted work.
 */
class Lexer {
  private readonly text: string;

  private readonly cache = new Map<number, Token>();

  constructor(text: string) {
    this.text = text;
  }

  /** First index at or after `pos` that can begin a token. */
  skipTrivia(pos: number): number {
    const { text } = this;
    let i = Math.max(0, pos);
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (isWhitespace(code)) {
        i += 1;
        continue;
      }
      if (code === 0x25) {
        while (i < text.length && text.charCodeAt(i) !== 0x0a && text.charCodeAt(i) !== 0x0d) i += 1;
        continue;
      }
      return i;
    }
    return i;
  }

  /** Token starting at or after `pos`. */
  token(pos: number): Token {
    const start = this.skipTrivia(pos);
    const cached = this.cache.get(start);
    if (cached) return cached;
    const token = this.scan(start);
    this.cache.set(start, token);
    return token;
  }

  /** Token beginning at exactly `pos`, which must already be trivia-free. */
  tokenAt(pos: number): Token {
    const cached = this.cache.get(pos);
    if (cached) return cached;
    const token = this.scan(pos);
    this.cache.set(pos, token);
    return token;
  }

  private scan(start: number): Token {
    const { text } = this;
    if (start >= text.length) return { kind: 'eof', text: '', start, end: start };
    const code = text.charCodeAt(start);

    if (code === 0x2f) return this.name(start);
    if (code === 0x28) return this.literalString(start);
    if (code === 0x3c) {
      if (text.charCodeAt(start + 1) === 0x3c) {
        return { kind: 'punct', text: '<<', start, end: start + 2 };
      }
      return this.hexString(start);
    }
    if (code === 0x3e && text.charCodeAt(start + 1) === 0x3e) {
      return { kind: 'punct', text: '>>', start, end: start + 2 };
    }
    if (code === 0x5b || code === 0x5d || code === 0x7b || code === 0x7d) {
      return { kind: 'punct', text: text[start], start, end: start + 1 };
    }
    if (code === 0x2b || code === 0x2d || code === 0x2e || isDigit(code)) {
      // `-`, `+` and `.` also begin ordinary keywords in some producers, so the
      // number form is only taken when at least one digit was actually consumed.
      const end = numberEnd(text, start);
      if (end > start && /\d/.test(text.slice(start, end))) {
        return { kind: 'number', text: text.slice(start, end), start, end };
      }
    }
    return this.keyword(start);
  }

  private name(pos: number): Token {
    const { text } = this;
    let i = pos + 1;
    let value = '';
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (!isRegular(code)) break;
      if (code === 0x23) {
        const hi = hexValue(text.charCodeAt(i + 1));
        const lo = hexValue(text.charCodeAt(i + 2));
        if (hi >= 0 && lo >= 0) {
          value += String.fromCharCode(hi * 16 + lo);
          i += 3;
          continue;
        }
      }
      value += text[i];
      i += 1;
    }
    return { kind: 'name', text: value, start: pos, end: i };
  }

  private literalString(pos: number): Token {
    const { text } = this;
    const out: number[] = [];
    let i = pos + 1;
    let depth = 1;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code === 0x5c) {
        i += 1;
        const esc = text.charCodeAt(i);
        if (Number.isNaN(esc)) break;
        if (esc === 0x6e) { out.push(0x0a); i += 1; continue; }
        if (esc === 0x72) { out.push(0x0d); i += 1; continue; }
        if (esc === 0x74) { out.push(0x09); i += 1; continue; }
        if (esc === 0x62) { out.push(0x08); i += 1; continue; }
        if (esc === 0x66) { out.push(0x0c); i += 1; continue; }
        if (esc === 0x28 || esc === 0x29 || esc === 0x5c) { out.push(esc); i += 1; continue; }
        if (esc === 0x0a) { i += 1; continue; }
        if (esc === 0x0d) { i += text.charCodeAt(i + 1) === 0x0a ? 2 : 1; continue; }
        if (esc >= 0x30 && esc <= 0x37) {
          let value = 0;
          let digits = 0;
          while (digits < 3 && i < text.length) {
            const digit = text.charCodeAt(i);
            if (digit < 0x30 || digit > 0x37) break;
            value = value * 8 + (digit - 0x30);
            i += 1;
            digits += 1;
          }
          out.push(value & 0xff);
          continue;
        }
        out.push(esc & 0xff);
        i += 1;
        continue;
      }
      if (code === 0x28) depth += 1;
      if (code === 0x29) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      out.push(code & 0xff);
      i += 1;
    }
    return { kind: 'string', text: toLatin1(Uint8Array.from(out)), start: pos, end: i };
  }

  private hexString(pos: number): Token {
    const { text } = this;
    const digits: number[] = [];
    let i = pos + 1;
    while (i < text.length && text.charCodeAt(i) !== 0x3e) {
      const value = hexValue(text.charCodeAt(i));
      if (value >= 0) digits.push(value);
      i += 1;
    }
    const end = Math.min(i + 1, text.length);
    const out: number[] = [];
    for (let d = 0; d < digits.length; d += 2) {
      const hi = digits[d];
      const lo = d + 1 < digits.length ? digits[d + 1] : 0;
      out.push(hi * 16 + lo);
    }
    return { kind: 'hex', text: toLatin1(Uint8Array.from(out)), start: pos, end };
  }

  private keyword(pos: number): Token {
    const { text } = this;
    let i = pos;
    while (i < text.length && isRegular(text.charCodeAt(i))) i += 1;
    // A stray delimiter that starts no construct still has to make progress.
    if (i === pos) i = pos + 1;
    return { kind: 'keyword', text: text.slice(pos, i), start: pos, end: i };
  }
}

/* ------------------------------------------------------------------ */
/* Object model                                                        */
/* ------------------------------------------------------------------ */

export interface PdfRef {
  kind: 'ref';
  num: number;
  gen: number;
  raw: string;
}

export interface PdfName {
  kind: 'name';
  value: string;
}

export interface PdfNumber {
  kind: 'number';
  value: number;
  raw: string;
}

export interface PdfText {
  kind: 'string' | 'hex';
  bytes: Uint8Array;
  text: string;
  raw: string;
}

export interface PdfBool {
  kind: 'bool';
  value: boolean;
}

export interface PdfNull {
  kind: 'null';
}

export interface PdfArray {
  kind: 'array';
  items: PdfValue[];
  start: number;
  end: number;
}

export interface PdfDict {
  kind: 'dict';
  entries: Map<string, PdfValue>;
  start: number;
  end: number;
  streamStart: number | null;
  streamEnd: number | null;
}

export interface PdfOpaque {
  kind: 'opaque';
  raw: string;
}

export type PdfValue =
  | PdfRef
  | PdfName
  | PdfNumber
  | PdfText
  | PdfBool
  | PdfNull
  | PdfArray
  | PdfDict
  | PdfOpaque;

export interface PdfIndirectObject {
  num: number;
  gen: number;
  /** Byte offset of the `N G obj` header. */
  offset: number;
  value: PdfValue;
}

/** What a trailer (or cross-reference stream) says about the document. */
export interface PdfTrailerInfo {
  rootRef: number | null;
  rootValue: PdfValue | null;
  encryptPresent: boolean;
  isXrefStream: boolean;
}

export interface PdfScan {
  objects: PdfIndirectObject[];
  trailers: PdfTrailerInfo[];
  /** Headers that matched `N G obj` but whose body did not parse. */
  malformed: number;
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

class Parser {
  private readonly lexer: Lexer;

  private readonly text: string;

  constructor(lexer: Lexer, text: string) {
    this.lexer = lexer;
    this.text = text;
  }

  /** Parses the value at `pos` when it is a dictionary, else null. */
  parseDictAt(pos: number): PdfDict | null {
    const value = this.parseValue(pos, true);
    return value && value.kind === 'dict' ? value : null;
  }

  /**
   * Parses one value at `pos`.
   *
   * `deep` controls whether containers are parsed recursively or only measured.
   * Objects are scanned shallowly — their nested dictionaries are never needed,
   * only their extent — while trailers are parsed deeply so that `/Root` inside
   * them is resolved. Shallow containers still expose their full byte span, so
   * nothing about a signature dictionary is lost by measuring nested dictionaries
   * instead of opening them.
   */
  parseValue(pos: number, deep: boolean): PdfValue | null {
    const token = this.lexer.token(pos);
    switch (token.kind) {
      case 'eof':
        return null;
      case 'punct':
        if (token.text === '<<') return this.parseDict(token.end, deep);
        if (token.text === '[') return this.parseArray(token.end, deep);
        return null;
      case 'name':
        return { kind: 'name', value: token.text };
      case 'string':
      case 'hex': {
        const bytes = latin1OfText(token.text);
        return { kind: token.kind, bytes, text: decodePdfString(bytes), raw: token.text };
      }
      case 'number':
        return this.numberOrRef(token);
      case 'keyword':
        if (token.text === 'true') return { kind: 'bool', value: true };
        if (token.text === 'false') return { kind: 'bool', value: false };
        if (token.text === 'null') return { kind: 'null' };
        return null;
      default:
        return null;
    }
  }

  /**
   * A number, or the indirect reference `num gen R`.
   *
   * The reference form is only accepted when both numbers are written as plain
   * integers: `1.0 0 R` is not a reference, and treating it as one would invent
   * an object that cannot exist.
   */
  private numberOrRef(token: Token): PdfValue {
    if (/^[+-]?\d+$/.test(token.text)) {
      const second = this.lexer.token(token.end);
      if (second.kind === 'number' && /^[+-]?\d+$/.test(second.text)) {
        const third = this.lexer.token(second.end);
        if (third.kind === 'keyword' && third.text === 'R') {
          return {
            kind: 'ref',
            num: Number(token.text),
            gen: Number(second.text),
            raw: `${token.text} ${second.text} R`,
          };
        }
      }
    }
    return { kind: 'number', value: Number(token.text), raw: token.text };
  }

  private parseArray(pos: number, deep: boolean): PdfArray {
    const items: PdfValue[] = [];
    const start = pos - 1;
    let cursor = pos;
    while (cursor < this.text.length) {
      const token = this.lexer.token(cursor);
      if (token.kind === 'eof') break;
      if (token.kind === 'punct' && token.text === ']') {
        cursor = token.end;
        break;
      }
      const value = this.parseValue(cursor, deep);
      if (value === null) {
        cursor = token.end;
        continue;
      }
      items.push(value);
      cursor = endOf(value, token);
      if (items.length > 20_000) break;
    }
    return { kind: 'array', items, start, end: cursor };
  }

  private parseDict(pos: number, deep: boolean): PdfDict {
    const entries = new Map<string, PdfValue>();
    const start = pos - 2;
    let cursor = pos;
    while (cursor < this.text.length) {
      const token = this.lexer.token(cursor);
      if (token.kind === 'eof') break;
      if (token.kind === 'punct' && token.text === '>>') {
        cursor = token.end;
        break;
      }
      if (token.kind !== 'name') {
        cursor = token.end;
        continue;
      }
      const key = token.text;
      const value = this.parseValue(token.end, deep);
      if (value === null) {
        cursor = token.end;
        continue;
      }
      if (!entries.has(key)) entries.set(key, value);
      cursor = endOf(value, this.lexer.token(token.end));
      if (entries.size > 20_000) break;
    }

    const dict: PdfDict = {
      kind: 'dict',
      entries,
      start,
      end: cursor,
      streamStart: null,
      streamEnd: null,
    };
    this.readStreamBounds(dict);
    return dict;
  }

  /**
   * Attaches the stream extent to a dictionary that is followed by `stream`.
   *
   * `/Length` is preferred but can be an indirect reference or simply wrong in a
   * damaged file, so the measurement is validated by checking that `endstream`
   * really follows; when it does not, the keyword is searched for instead. That
   * fallback is why a truncated file still yields usable dictionary data.
   */
  private readStreamBounds(dict: PdfDict): void {
    const after = this.lexer.skipTrivia(dict.end);
    if (!this.text.startsWith('stream', after)) return;
    const contentStart = streamContentStart(this.text, after + 6);

    const length = dict.entries.get('Length');
    const declared =
      length && length.kind === 'number' && Number.isInteger(length.value) && length.value >= 0
        ? length.value
        : null;

    let end = declared !== null ? contentStart + declared : -1;
    if (end < 0 || end > this.text.length || !this.text.startsWith('endstream', this.lexer.skipTrivia(end))) {
      const found = this.text.indexOf('endstream', contentStart);
      end = found === -1 ? this.text.length : found;
    }
    dict.streamStart = contentStart;
    dict.streamEnd = end;
  }
}

/** End offset just past `value`, given the token its first byte was lexed from. */
function endOf(value: PdfValue, token: Token): number {
  if (value.kind === 'dict' || value.kind === 'array') return value.end;
  return token.end;
}

/**
 * Skips the end-of-line that must follow the `stream` keyword.
 *
 * A stream begins on the line after the keyword, and that line break belongs to
 * the syntax rather than to the data. Treating the `\n` as the first content byte
 * shifts every offset in the file by one and silently breaks `/ByteRange`
 * arithmetic, which is exactly the kind of off-by-one this tool exists to detect.
 */
export function streamContentStart(text: string, pos: number): number {
  let i = pos;
  if (text.charCodeAt(i) === 0x0d) i += 1;
  if (text.charCodeAt(i) === 0x0a) i += 1;
  return i;
}

/* ------------------------------------------------------------------ */
/* File scanning                                                       */
/* ------------------------------------------------------------------ */

interface ObjectHeader {
  num: number;
  gen: number;
  /** Offset of the body, just after the `obj` keyword. */
  bodyStart: number;
  /** Offset of the header, at the first digit of the object number. */
  offset: number;
}

/**
 * Reads `N G obj` ending exactly at `objAt`, searching backwards for the header.
 *
 * Anchoring on the keyword rather than on a digit is what makes this immune to
 * the classic false positive: the bytes `1 0 obj` inside a stream or a string
 * belong to data, and there is no way to tell from the digits alone.
 */
function readObjectHeader(text: string, objAt: number): ObjectHeader | null {
  if (!text.startsWith('obj', objAt)) return null;
  const afterObj = text.charCodeAt(objAt + 3);
  // `obj` must stand alone. Without this the "obj" inside a longer word — or the
  // "obj" of `endobj` — would be treated as an object header.
  if (!(Number.isNaN(afterObj) || isWhitespace(afterObj) || isDelimiter(afterObj))) return null;

  let i = objAt;
  while (i > 0 && isWhitespace(text.charCodeAt(i - 1))) i -= 1;
  const genEnd = i;
  while (i > 0 && isDigit(text.charCodeAt(i - 1))) i -= 1;
  if (i === genEnd) return null;
  const gen = Number(text.slice(i, genEnd));
  if (i === 0 || !isWhitespace(text.charCodeAt(i - 1))) return null;
  while (i > 0 && isWhitespace(text.charCodeAt(i - 1))) i -= 1;
  const numEnd = i;
  while (i > 0 && isDigit(text.charCodeAt(i - 1))) i -= 1;
  if (i === numEnd) return null;
  const num = Number(text.slice(i, numEnd));
  if (i > 0 && isRegular(text.charCodeAt(i - 1))) return null;

  return { num, gen, bodyStart: objAt + 3, offset: i };
}

/**
 * Finds the next object header at or after `from`.
 *
 * `indexOf('obj')` alone is not enough: a hex string or a literal string can
 * contain those three bytes, and `endobj` ends with them, so a naive search both
 * invents headers inside object data and re-reads the tail of a real one.
 * Candidates that fail the backwards header parse are skipped by searching for
 * the next occurrence.
 */
function nextObjectHeader(text: string, from: number): ObjectHeader | null {
  let at = from;
  for (;;) {
    const found = text.indexOf('obj', at);
    if (found === -1) return null;
    at = found + 3;
    const header = readObjectHeader(text, found);
    if (header) return header;
  }
}

/**
 * Finds every `N G obj ...` in the file and parses its body shallowly.
 *
 * Objects inside object streams are not expanded. Reporting that limitation is
 * more honest than answering "no signature" for a file whose objects live in one,
 * so `inspectPdf` surfaces it as a warning when an `/ObjStm` is present.
 */
export function scanPdfObjects(bytes: Uint8Array): PdfScan {
  const text = toLatin1(bytes);
  const lexer = new Lexer(text);
  const parser = new Parser(lexer, text);

  const objects: PdfIndirectObject[] = [];
  const trailers: PdfTrailerInfo[] = [];
  let malformed = 0;

  let cursor = 0;
  for (;;) {
    const header = nextObjectHeader(text, cursor);
    if (!header) break;
    cursor = header.bodyStart;

    const value = parser.parseValue(lexer.skipTrivia(header.bodyStart), false);
    if (value === null) {
      malformed += 1;
      continue;
    }
    objects.push({ num: header.num, gen: header.gen, offset: header.offset, value });
  }

  // Classic trailers: the `trailer` keyword followed by a dictionary. Modern
  // files put /Root and /Encrypt in a cross-reference stream instead, which the
  // object scan above already collected and which is recognised by /Type /XRef.
  let trailerAt = text.indexOf('trailer');
  while (trailerAt !== -1) {
    const dict = parser.parseDictAt(trailerAt + 'trailer'.length);
    if (dict) trailers.push(trailerInfo(dict, false));
    trailerAt = text.indexOf('trailer', trailerAt + 'trailer'.length);
  }
  for (const object of objects) {
    if (object.value.kind !== 'dict') continue;
    if (nameOf(object.value.entries.get('Type')) === 'XRef') {
      trailers.push(trailerInfo(object.value, true));
    }
  }

  return { objects, trailers, malformed };
}

function trailerInfo(dict: PdfDict, isXrefStream: boolean): PdfTrailerInfo {
  const root = dict.entries.get('Root') ?? null;
  const encrypt = dict.entries.get('Encrypt') ?? null;
  return {
    rootRef: root && root.kind === 'ref' ? root.num : null,
    rootValue: root && root.kind !== 'ref' ? root : null,
    encryptPresent: encrypt !== null,
    isXrefStream,
  };
}

function nameOf(value: PdfValue | undefined): string | null {
  return value && value.kind === 'name' ? value.value : null;
}

function textOf(value: PdfValue | undefined): string | null {
  if (!value) return null;
  if (value.kind === 'string' || value.kind === 'hex') return value.text;
  if (value.kind === 'name') return `/${value.value}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* ByteRange arithmetic                                                */
/* ------------------------------------------------------------------ */

export interface SignatureByteRange {
  /** The offsets exactly as written in `/ByteRange`. */
  values: number[];
  /** Resolved `[start, end)` pairs. */
  segments: Array<{ start: number; end: number; length: number }>;
  /** Remarks that do not invalidate the arithmetic but matter to the reader. */
  problems: string[];
  /** Shapes that make the entry unusable; empty when it is well formed. */
  errors: string[];
  /** Total signed bytes (sum of segment lengths). */
  signedBytes: number;
  /** `signedBytes / fileSize`, 0..1. */
  coverage: number;
  /** Coverage as a percentage rounded to two decimals. */
  coveragePercent: number;
  startsAtZero: boolean;
  /** Last signed segment reaches the final byte of the file. */
  reachesEnd: boolean;
  /** Bytes lying after the last signed segment. */
  trailingBytes: number;
  /**
   * Bytes between the first and last signed segment that no segment covers.
   *
   * For the normal two-segment shape this is the `/Contents` gap. It is reported
   * rather than assumed, because a file can declare two segments with a long gap
   * between them — the gap is then *not* the CMS blob, and anything the signature
   * skipped over sits in it.
   */
  gapBytes: number;
  overlapsOrOutOfOrder: boolean;
  nonIntegerOrNegative: boolean;
  outOfBounds: boolean;
  /** Whether the range is well formed enough for a coverage verdict. */
  usable: boolean;
  /**
   * Whether the range reaches the final structural marker (`startxref` / trailer)
   * of this revision.
   *
   * This is the part of the coverage claim that carries real weight. Any edit —
   * benign or not — produces a new revision whose trailer lives at the end of the
   * file, so a signature that does not cover the trailer is a signature over an
   * *earlier* revision. Whether the later revision merely adds a signature or
   * rewrites content cannot be told from structure alone, which is why the UI
   * states the fact instead of calling it tampering.
   */
  coversTrailer: boolean;
}

function unusableByteRange(values: number[], errors: string[], problems: string[]): SignatureByteRange {
  return {
    values,
    segments: [],
    problems,
    errors,
    signedBytes: 0,
    coverage: 0,
    coveragePercent: 0,
    startsAtZero: false,
    reachesEnd: false,
    trailingBytes: 0,
    gapBytes: 0,
    overlapsOrOutOfOrder: false,
    nonIntegerOrNegative: false,
    outOfBounds: false,
    usable: false,
    coversTrailer: false,
  };
}

/**
 * Resolves a `/ByteRange` against the real file length.
 *
 * The entry alternates start and length — `/ByteRange [0 100 200 300]` means
 * `[0,100)` plus `[200,500)`, **not** two start/end pairs. Reading it as pairs
 * shifts every later segment and makes a file with appended content look fully
 * covered, which is precisely the mistake this function exists to prevent, so
 * the self-check asserts the arithmetic on that literal example. The usual real
 * shape is `[0 a b c]` where the gap `[a, b)` is the `/Contents` hex string
 * itself, written into the file after the signature was computed.
 *
 * Malformed shapes are reported, never thrown: a PDF whose ByteRange does not
 * add up is a finding about the file, not an input error.
 *
 * `trailerOffset` is the byte position of the revision's final `startxref`. When
 * it falls inside a signed segment, the signature covers the document structure
 * that describes this revision.
 */
export function parseByteRange(
  values: number[],
  fileSize: number,
  trailerOffset: number | null = null,
): SignatureByteRange {
  const errors: string[] = [];
  const problems: string[] = [];

  if (values.length === 0) return unusableByteRange(values, ['/ByteRange 为空'], problems);
  if (values.length % 2 !== 0) {
    errors.push(`/ByteRange 元素个数为 ${values.length}，必须是偶数（起始与长度成对出现）`);
  }

  let nonIntegerOrNegative = false;
  for (const value of values) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) nonIntegerOrNegative = true;
  }
  if (nonIntegerOrNegative) {
    errors.push('/ByteRange 含负数或非整数，规范要求每项都是非负整数');
  }
  if (values.some((value) => !Number.isFinite(value))) {
    errors.push('/ByteRange 含非数值元素，无法参与计算');
  }

  const segments: Array<{ start: number; end: number; length: number }> = [];
  let outOfBounds = false;
  for (let i = 0; i + 1 < values.length; i += 2) {
    const start = values[i];
    const length = values[i + 1];
    if (!Number.isFinite(start) || !Number.isFinite(length)) continue;
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0) continue;
    const end = start + length;
    if (end > fileSize) outOfBounds = true;
    segments.push({ start, end, length });
  }
  if (outOfBounds) errors.push(`/ByteRange 存在超出文件长度（${fileSize} 字节）的区段`);

  let overlapsOrOutOfOrder = false;
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i].start < segments[i - 1].end) overlapsOrOutOfOrder = true;
  }
  if (overlapsOrOutOfOrder) errors.push('/ByteRange 区段相互重叠或未按升序排列');

  const startsAtZero = segments.length > 0 && segments[0].start === 0;
  if (segments.length > 0 && !startsAtZero) {
    errors.push('/ByteRange 未从 0 开始，文件头不在签名范围内');
  }

  const usable = errors.length === 0 && segments.length > 0;
  const signedBytes = segments.reduce((sum, segment) => sum + segment.length, 0);
  const last = segments.length > 0 ? segments[segments.length - 1] : null;
  const reachesEnd = usable && last !== null && last.end === fileSize;
  const trailingBytes = last === null ? fileSize : Math.max(0, fileSize - Math.min(last.end, fileSize));

  // Bytes inside the span of the range that no segment covers. With the normal
  // two-segment shape this is exactly the `/Contents` hole, which is expected and
  // excluded from the signature by definition. It is deliberately not capped at the
  // contents length: if a file declares segments with a longer gap, that gap is
  // unsigned bytes the reader should know about, not something to round away.
  let gapBytes = 0;
  if (segments.length > 0 && !overlapsOrOutOfOrder) {
    const span = segments[segments.length - 1].end - segments[0].start;
    gapBytes = Math.max(0, span - signedBytes);
  }

  const coverage = usable && fileSize > 0 ? signedBytes / fileSize : 0;

  const coversTrailer =
    usable &&
    trailerOffset !== null &&
    segments.some((segment) => trailerOffset >= segment.start && trailerOffset < segment.end);

  if (usable && !reachesEnd) {
    problems.push(
      `签名只覆盖到第 ${last?.end} 字节，后面还有 ${trailingBytes} 字节不在签名范围内` +
        '（典型的增量更新：可能只是补签，也可能是签名后追加了内容）',
    );
  }
  if (usable && segments.length > 2) {
    problems.push(`/ByteRange 含 ${segments.length} 个区段，除 /Contents 空洞外还有未覆盖区间`);
  }
  if (usable && trailerOffset !== null && !coversTrailer) {
    problems.push(
      `本次修订的尾部结构（startxref，位于第 ${trailerOffset} 字节）不在签名范围内：签名对应的是更早的一版文件`,
    );
  }

  return {
    values,
    segments,
    problems,
    errors,
    signedBytes,
    coverage,
    coveragePercent: Math.round(coverage * 10_000) / 100,
    startsAtZero,
    reachesEnd,
    trailingBytes,
    gapBytes,
    overlapsOrOutOfOrder,
    nonIntegerOrNegative,
    outOfBounds,
    usable,
    coversTrailer,
  };
}

/* ------------------------------------------------------------------ */
/* Object resolution                                                   */
/* ------------------------------------------------------------------ */

type Resolver = (value: PdfValue | undefined) => PdfValue | null;

function makeResolver(objects: PdfIndirectObject[]): Resolver {
  const byNumber = new Map<number, PdfValue>();
  for (const object of objects) {
    if (!byNumber.has(object.num)) byNumber.set(object.num, object.value);
  }
  return (value) => {
    let current: PdfValue | undefined = value;
    let hops = 0;
    while (current && current.kind === 'ref' && hops < 16) {
      current = byNumber.get(current.num);
      hops += 1;
    }
    return current && current.kind !== 'ref' ? current : null;
  };
}

/** Dotted path of an AcroForm field, assembled through `/Parent` and `/T`. */
function fieldPath(dict: PdfDict, resolve: Resolver): string {
  const parts: string[] = [];
  let current: PdfDict | null = dict;
  let hops = 0;
  while (current && hops < 16) {
    const title = resolve(current.entries.get('T'));
    if (title && (title.kind === 'string' || title.kind === 'hex') && title.text) {
      parts.unshift(title.text);
    }
    const parent = resolve(current.entries.get('Parent'));
    current = parent && parent.kind === 'dict' ? parent : null;
    hops += 1;
  }
  return parts.join('.');
}

interface SignatureField {
  path: string;
  dict: PdfDict;
  objectNumber: number;
  valueDict: PdfDict | null;
  /** Object number of the dictionary `/V` resolves to, when it is an object. */
  valueObjectNumber: number | null;
}

/**
 * Collects every `/FT /Sig` field.
 *
 * Two passes on purpose. The first walks `/AcroForm /Fields` and `/Kids`, which
 * is the documented structure and the only way to learn a field's full dotted
 * name. The second sweeps every object for `/FT /Sig`, which catches a signature
 * field whose AcroForm is missing or damaged — a field the first pass cannot
 * reach is still a field, and dropping it would understate what the file claims.
 */
function collectSignatureFields(objects: PdfIndirectObject[], resolve: Resolver, catalog: PdfDict | null): SignatureField[] {
  const found: SignatureField[] = [];
  /**
   * Field dictionaries already reported.
   *
   * Deliberately separate from the traversal's visited set. Sharing one set means
   * the walk marks a dictionary visited *before* the recording step can look at
   * it, and every signature field reached through `/AcroForm /Fields` silently
   * disappears from the report while the signature dictionary itself — found by a
   * later sweep — still shows up with no field name attached. Two sets, two jobs.
   */
  const reported = new Set<PdfDict>();
  const visited = new Set<PdfDict>();

  const record = (dict: PdfDict, objectNumber: number) => {
    if (reported.has(dict)) return;
    reported.add(dict);
    const value = resolve(dict.entries.get('V'));
    const valueDict = value && value.kind === 'dict' ? value : null;
    const ref = dict.entries.get('V');
    const valueObjectNumber =
      ref && ref.kind === 'ref'
        ? ref.num
        : valueDict
          ? (objects.find((object) => object.value === valueDict)?.num ?? null)
          : null;
    found.push({ path: fieldPath(dict, resolve), dict, objectNumber, valueDict, valueObjectNumber });
  };

  const walk = (dict: PdfDict, objectNumber: number, depth: number) => {
    if (depth > 64 || visited.has(dict)) return;
    visited.add(dict);
    if (nameOf(dict.entries.get('FT')) === 'Sig') record(dict, objectNumber);
    const kids = resolve(dict.entries.get('Kids'));
    if (kids && kids.kind === 'array') {
      for (const kid of kids.items) {
        const resolved = resolve(kid);
        if (resolved && resolved.kind === 'dict') {
          walk(resolved, kid.kind === 'ref' ? kid.num : objectNumber, depth + 1);
        }
      }
    }
  };

  const acroForms: PdfDict[] = [];
  if (catalog) {
    const acro = resolve(catalog.entries.get('AcroForm'));
    if (acro && acro.kind === 'dict') acroForms.push(acro);
  }
  for (const object of objects) {
    if (object.value.kind !== 'dict') continue;
    const acro = resolve(object.value.entries.get('AcroForm'));
    if (acro && acro.kind === 'dict') acroForms.push(acro);
  }
  for (const acro of acroForms) {
    const fields = resolve(acro.entries.get('Fields'));
    if (!fields || fields.kind !== 'array') continue;
    for (const field of fields.items) {
      const resolved = resolve(field);
      if (resolved && resolved.kind === 'dict') {
        walk(resolved, field.kind === 'ref' ? field.num : -1, 0);
      }
    }
  }

  for (const object of objects) {
    if (object.value.kind !== 'dict') continue;
    if (nameOf(object.value.entries.get('FT')) === 'Sig') record(object.value, object.num);
  }

  return found;
}

interface CatalogInfo {
  dict: PdfDict;
  objectNumber: number;
}

function findCatalog(objects: PdfIndirectObject[], trailers: PdfTrailerInfo[]): CatalogInfo | null {
  for (const trailer of trailers) {
    if (trailer.rootRef !== null) {
      const hit = objects.find((object) => object.num === trailer.rootRef && object.value.kind === 'dict');
      if (hit && hit.value.kind === 'dict') return { dict: hit.value, objectNumber: hit.num };
    }
    if (trailer.rootValue && trailer.rootValue.kind === 'dict') {
      return { dict: trailer.rootValue, objectNumber: -1 };
    }
  }
  for (const object of objects) {
    if (object.value.kind !== 'dict') continue;
    if (nameOf(object.value.entries.get('Type')) === 'Catalog' || object.value.entries.has('Pages')) {
      return { dict: object.value, objectNumber: object.num };
    }
  }
  return null;
}

function countPages(
  catalog: CatalogInfo | null,
  objects: PdfIndirectObject[],
  resolve: Resolver,
): { count: number | null; source: 'page-tree' | 'pages-only' | null } {
  const pagesValue = catalog ? resolve(catalog.dict.entries.get('Pages')) : null;
  const pages = pagesValue && pagesValue.kind === 'dict' ? pagesValue : null;

  if (pages) {
    let count = 0;
    const seen = new Set<PdfDict>();
    const walk = (dict: PdfDict, depth: number) => {
      if (depth > 64 || seen.has(dict)) return;
      seen.add(dict);
      const type = nameOf(dict.entries.get('Type'));
      if (type === 'Page') {
        count += 1;
        return;
      }
      const kids = resolve(dict.entries.get('Kids'));
      if (kids && kids.kind === 'array') {
        for (const kid of kids.items) {
          const resolved = resolve(kid);
          if (resolved && resolved.kind === 'dict') walk(resolved, depth + 1);
        }
        return;
      }
      // A /Pages node with no /Kids still describes exactly one page.
      if (dict.entries.has('Contents') || dict.entries.has('MediaBox')) count += 1;
    };
    walk(pages, 0);
    return { count, source: 'page-tree' };
  }

  // No reachable page tree: /Type /Page objects are still countable. This is a
  // weaker source and the report says so, rather than presenting it as exact.
  const direct = objects.filter(
    (object) => object.value.kind === 'dict' && nameOf(object.value.entries.get('Type')) === 'Page',
  );
  if (direct.length > 0) return { count: direct.length, source: 'pages-only' };
  return { count: null, source: null };
}

/* ------------------------------------------------------------------ */
/* Report model                                                        */
/* ------------------------------------------------------------------ */

export interface SignatureInfo {
  /** Object number of the signature dictionary. */
  objectNumber: number;
  /** Signature field paths whose `/V` points here. */
  fieldNames: string[];
  typedAsSig: boolean;
  name: string | null;
  reason: string | null;
  location: string | null;
  contactInfo: string | null;
  /** `/M`, the signing time exactly as written. */
  signingTime: string | null;
  subFilter: string | null;
  filter: string | null;
  byteRange: SignatureByteRange | null;
  /** Length of `/Contents`, i.e. the size of the CMS blob that is not parsed. */
  contentsBytes: number | null;
  /** Entries this reader found but does not interpret. */
  otherKeys: string[];
}

export interface UnsignedSignatureField {
  path: string;
  note: string;
}

export type InspectErrorCode = 'empty' | 'too-large' | 'not-pdf' | 'header-only';

export interface PdfInspection {
  fileName: string;
  fileSize: number;
  headerVersion: string | null;
  catalogVersion: string | null;
  pageCount: number | null;
  pageCountSource: 'page-tree' | 'pages-only' | null;
  encrypted: boolean;
  linearized: boolean;
  /** Trailing `startxref` markers beyond the first — one per incremental update. */
  incrementalUpdates: number;
  /**
   * Byte offset of the file's final `startxref`, the anchor of the current
   * revision's trailer, or null when the file has none.
   */
  trailerOffset: number | null;
  objectStreamsPresent: boolean;
  signatures: SignatureInfo[];
  unsignedSignatureFields: UnsignedSignatureField[];
  warnings: string[];
}

export interface InspectFailure {
  ok: false;
  code: InspectErrorCode;
  message: string;
}

export interface InspectSuccess {
  ok: true;
  report: PdfInspection;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

function readHeaderVersion(bytes: Uint8Array): { version: string; offset: number } | null {
  const limit = Math.min(bytes.length, 1024);
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  for (let start = 0; start + marker.length < limit; start += 1) {
    let ok = true;
    for (let i = 0; i < marker.length; i += 1) {
      if (bytes[start + i] !== marker[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let version = '';
    for (let i = start + marker.length; i < bytes.length && version.length < 4; i += 1) {
      const code = bytes[i];
      if (isDigit(code) || code === 0x2e) version += String.fromCharCode(code);
      else break;
    }
    if (version) return { version, offset: start };
  }
  return null;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** Byte offset of the last `startxref` marker, or null when the file has none. */
function lastStartxrefOffset(text: string): number | null {
  const at = text.lastIndexOf('startxref');
  return at === -1 ? null : at;
}

/**
 * Reads a PDF and reports what its signature dictionaries say.
 *
 * The result never claims a signature is valid; the module header explains why
 * that question is out of scope. `signatures[].byteRange.reachesEnd` is the only
 * integrity statement produced, and it follows purely from arithmetic on
 * `/ByteRange` and the file length.
 */
export function inspectPdf(bytes: Uint8Array, fileName = ''): InspectSuccess | InspectFailure {
  if (bytes.length === 0) {
    return { ok: false, code: 'empty', message: '文件是空的（0 字节），没有任何 PDF 结构可读。' };
  }
  if (bytes.length > MAX_PDF_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      message: `文件 ${formatByteSize(bytes.length)} 超过本工具的 ${formatByteSize(MAX_PDF_BYTES)} 上限，已停止解析。`,
    };
  }

  const header = readHeaderVersion(bytes);
  if (!header) {
    return {
      ok: false,
      code: 'not-pdf',
      message: '文件开头 1024 字节内没有找到 %PDF- 头，这不是一个 PDF 文件。',
    };
  }

  const text = toLatin1(bytes);
  const scan = scanPdfObjects(bytes);
  if (scan.objects.length === 0) {
    return {
      ok: false,
      code: 'header-only',
      message: '文件有 %PDF- 头，但没有任何可解析的间接对象，文件不完整或已损坏。',
    };
  }

  const resolve = makeResolver(scan.objects);
  const catalog = findCatalog(scan.objects, scan.trailers);
  const pageInfo = countPages(catalog, scan.objects, resolve);

  const encrypted =
    scan.trailers.some((trailer) => trailer.encryptPresent) ||
    scan.objects.some(
      (object) =>
        object.value.kind === 'dict' &&
        nameOf(object.value.entries.get('Type')) === 'Encrypt' &&
        object.value.entries.has('Filter'),
    );

  // Linearisation requires the first object to carry /Linearized. Restricting to
  // the first kilobyte avoids matching a stray key deep in the file.
  const linearized = scan.objects.some(
    (object) =>
      object.offset <= 1024 &&
      object.value.kind === 'dict' &&
      object.value.entries.has('Linearized'),
  );

  const objectStreamsPresent = scan.objects.some(
    (object) => object.value.kind === 'dict' && nameOf(object.value.entries.get('Type')) === 'ObjStm',
  );

  const trailerOffset = lastStartxrefOffset(text);

  const warnings: string[] = [];
  if (objectStreamsPresent) {
    warnings.push(
      '文件含对象流（/ObjStm，PDF 1.5 起）。压缩在对象流里的对象需要 FlateDecode 才能展开，本工具不实现解压：如果签名对象被放在对象流里，这里会看不到它。',
    );
  }
  if (scan.malformed > 0) {
    warnings.push(`有 ${scan.malformed} 处 "N G obj" 头部之后的内容无法解析，已跳过。`);
  }
  if (encrypted) {
    warnings.push(
      '文件已加密：字典键名仍然可读，但 /Name、/M 等文字项和 /Contents 是密文，下面显示的文字可能是乱码，也没有解密后重新计算字节范围。',
    );
  }

  const fields = collectSignatureFields(scan.objects, resolve, catalog?.dict ?? null);

  const fieldNamesByObject = new Map<number, string[]>();
  const inlineSignatureDicts: PdfDict[] = [];
  const unsignedSignatureFields: UnsignedSignatureField[] = [];
  for (const field of fields) {
    if (!field.valueDict) {
      unsignedSignatureFields.push({
        path: field.path || `对象 ${field.objectNumber}`,
        note: field.path ? '字段存在但没有 /V，尚未签名。' : '只有 /FT /Sig 的字段，没有 /T 名称。',
      });
      continue;
    }
    if (field.valueObjectNumber !== null) {
      const list = fieldNamesByObject.get(field.valueObjectNumber) ?? [];
      const label = field.path || `对象 ${field.valueObjectNumber}`;
      if (!list.includes(label)) list.push(label);
      fieldNamesByObject.set(field.valueObjectNumber, list);
    } else {
      inlineSignatureDicts.push(field.valueDict);
    }
  }

  const signatures = collectSignatureDicts(scan.objects, fieldNamesByObject, inlineSignatureDicts).map(
    (candidate) => describeSignature(candidate, bytes.length, resolve, trailerOffset),
  );

  return {
    ok: true,
    report: {
      fileName,
      fileSize: bytes.length,
      headerVersion: header.version,
      catalogVersion: catalog ? nameOf(catalog.dict.entries.get('Version')) : null,
      pageCount: pageInfo.count,
      pageCountSource: pageInfo.source,
      encrypted,
      linearized,
      incrementalUpdates: Math.max(0, countOccurrences(text, 'startxref') - 1),
      trailerOffset,
      objectStreamsPresent,
      signatures,
      unsignedSignatureFields,
      warnings,
    },
  };
}

interface SignatureCandidate {
  objectNumber: number;
  dict: PdfDict;
  fieldNames: string[];
  typedAsSig: boolean;
}

/**
 * Picks out the signature dictionaries.
 *
 * A dictionary qualifies when it is `/Type /Sig`, when a signature field's `/V`
 * resolves to it, or when it carries the two entries that only a signature
 * dictionary has (`/ByteRange` and `/SubFilter`). The last rule catches a
 * detached signature dictionary that no field points at, which is what a
 * stripped or repaired file leaves behind.
 */
function collectSignatureDicts(
  objects: PdfIndirectObject[],
  fieldNamesByObject: Map<number, string[]>,
  inlineDicts: PdfDict[],
): SignatureCandidate[] {
  const found: SignatureCandidate[] = [];
  const byNumber = new Map<number, SignatureCandidate>();
  const byIdentity = new Map<PdfDict, SignatureCandidate>();

  const add = (objectNumber: number, dict: PdfDict, typedAsSig: boolean): void => {
    const existing = byIdentity.get(dict);
    if (existing) {
      existing.typedAsSig = existing.typedAsSig || typedAsSig;
      for (const name of fieldNamesByObject.get(objectNumber) ?? []) {
        if (!existing.fieldNames.includes(name)) existing.fieldNames.push(name);
      }
      return;
    }
    const candidate: SignatureCandidate = {
      objectNumber,
      dict,
      fieldNames: [...(fieldNamesByObject.get(objectNumber) ?? [])],
      typedAsSig,
    };
    byIdentity.set(dict, candidate);
    byNumber.set(objectNumber, candidate);
    found.push(candidate);
  };

  for (const object of objects) {
    if (object.value.kind !== 'dict') continue;
    const dict = object.value;
    const typedAsSig = nameOf(dict.entries.get('Type')) === 'Sig';
    const referenced = fieldNamesByObject.has(object.num);
    const hasSignatureKeys = dict.entries.has('ByteRange') || dict.entries.has('SubFilter');
    if (!typedAsSig && !referenced && !hasSignatureKeys) continue;
    add(object.num, dict, typedAsSig);
  }

  for (const [objectNumber, names] of fieldNamesByObject) {
    if (byNumber.has(objectNumber)) continue;
    const object = objects.find((item) => item.num === objectNumber);
    if (object && object.value.kind === 'dict') {
      add(objectNumber, object.value, nameOf(object.value.entries.get('Type')) === 'Sig');
    } else if (names.length > 0) {
      // /V pointed at an object number with no matching object: a broken file.
      // The dangling reference is reported rather than silently dropped.
      found.push({ objectNumber, dict: emptyDict(), fieldNames: [...names], typedAsSig: false });
    }
  }

  for (const dict of inlineDicts) add(-1, dict, nameOf(dict.entries.get('Type')) === 'Sig');

  return found.sort((a, b) => a.objectNumber - b.objectNumber);
}

/** A placeholder for a `/V` that references an object the file does not contain. */
function emptyDict(): PdfDict {
  return { kind: 'dict', entries: new Map(), start: -1, end: -1, streamStart: null, streamEnd: null };
}

const KNOWN_SIGNATURE_KEYS = new Set([
  'Type',
  'Filter',
  'SubFilter',
  'Contents',
  'ByteRange',
  'Name',
  'M',
  'Reason',
  'Location',
  'ContactInfo',
  'Cert',
  'Prop_Build',
  'Reference',
  'V',
  'TV',
  'DocMDP',
  'Perms',
  'Lock',
  'Changes',
  'R',
  'AP',
]);

function describeSignature(
  candidate: SignatureCandidate,
  fileSize: number,
  resolve: Resolver,
  trailerOffset: number | null,
): SignatureInfo {
  const { dict } = candidate;

  const byteRangeValue = dict.entries.get('ByteRange');
  let byteRange: SignatureByteRange | null = null;
  if (byteRangeValue && byteRangeValue.kind === 'array') {
    const numbers = byteRangeValue.items.map((item) =>
      item.kind === 'number' ? item.value : Number.NaN,
    );
    byteRange = parseByteRange(numbers, fileSize, trailerOffset);
  }

  const contentsValue = resolve(dict.entries.get('Contents'));
  const contentsBytes =
    contentsValue && (contentsValue.kind === 'string' || contentsValue.kind === 'hex')
      ? contentsValue.bytes.length
      : null;

  const otherKeys: string[] = [];
  for (const key of dict.entries.keys()) {
    if (!KNOWN_SIGNATURE_KEYS.has(key)) otherKeys.push(key);
  }
  otherKeys.sort();

  return {
    objectNumber: candidate.objectNumber,
    fieldNames: candidate.fieldNames,
    typedAsSig: candidate.typedAsSig,
    name: textOf(dict.entries.get('Name')),
    reason: textOf(dict.entries.get('Reason')),
    location: textOf(dict.entries.get('Location')),
    contactInfo: textOf(dict.entries.get('ContactInfo')),
    signingTime: textOf(dict.entries.get('M')),
    subFilter: textOf(dict.entries.get('SubFilter')),
    filter: textOf(dict.entries.get('Filter')),
    byteRange,
    contentsBytes,
    otherKeys,
  };
}
