/**
 * Base64 helpers with correct UTF-8 handling.
 *
 * `btoa`/`atob` only accept Latin-1, so every path here goes through
 * `TextEncoder`/`TextDecoder`. Decoding is also lenient about the variants
 * people actually paste: URL-safe alphabets, missing padding and embedded
 * whitespace.
 */

export type Base64Alphabet = 'standard' | 'url';

export interface EncodeOptions {
  alphabet: Base64Alphabet;
  /** Emit `=` padding. URL-safe output often omits it. */
  padding: boolean;
}

const STANDARD_TO_URL: Record<string, string> = { '+': '-', '/': '_' };
const URL_TO_STANDARD: Record<string, string> = { '-': '+', _: '/' };

export function encodeBase64(input: string, options: EncodeOptions): string {
  const bytes = new TextEncoder().encode(input);

  let binary = '';
  // Chunked to stay well under the argument-count limit for large inputs.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  let encoded = btoa(binary);
  if (options.alphabet === 'url') {
    encoded = encoded.replace(/[+/]/g, (char) => STANDARD_TO_URL[char] ?? char);
  }
  if (!options.padding) {
    encoded = encoded.replace(/=+$/, '');
  }
  return encoded;
}

/** Base64 of raw bytes, always standard alphabet with padding. */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface DecodeSuccess {
  ok: true;
  /** Decoded bytes. */
  bytes: Uint8Array;
  /** Decoded text when the bytes are valid UTF-8, else null. */
  text: string | null;
  /** Which alphabet the input actually used. */
  alphabet: Base64Alphabet;
  /** True when the input had no `=` padding but was still valid. */
  wasUnpadded: boolean;
}

export type DecodeResult = DecodeSuccess | { ok: false; error: string };

/** Normalises any accepted Base64 dialect into canonical standard form. */
function normalize(input: string): { value: string; alphabet: Base64Alphabet; unpadded: boolean } {
  // Strip all whitespace (line wraps from PEM/JSON are common).
  let value = input.replace(/\s+/g, '');

  let alphabet: Base64Alphabet = 'standard';
  if (/[-_]/.test(value)) {
    alphabet = 'url';
    value = value.replace(/[-_]/g, (char) => URL_TO_STANDARD[char] ?? char);
  }

  const unpadded = !value.endsWith('=');
  // Re-pad to a multiple of 4; `atob` requires it.
  const remainder = value.length % 4;
  if (remainder === 1) {
    // Impossible length for valid Base64; let the decode step report it.
    return { value, alphabet, unpadded };
  }
  if (remainder !== 0) {
    value = value.padEnd(value.length + (4 - remainder), '=');
  }

  return { value, alphabet, unpadded };
}

export function decodeBase64(input: string): DecodeResult {
  const raw = input.replace(/\s+/g, '');
  // The empty string is a valid encoding of zero bytes, so it decodes to an
  // empty result rather than an error. Callers that need to prompt for input
  // (the UI) check for emptiness themselves.
  if (!raw) {
    return {
      ok: true,
      bytes: new Uint8Array(0),
      text: '',
      alphabet: 'standard',
      wasUnpadded: false,
    };
  }

  const { value, alphabet, unpadded } = normalize(raw);

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return {
      ok: false,
      error: '包含 Base64 字母表之外的字符，请检查是否混入了其它内容',
    };
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return { ok: false, error: '不是合法的 Base64 字符串（长度或填充有误）' };
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  // `fatal: true` makes the decoder reject invalid UTF-8 instead of emitting
  // replacement characters, which is what we want for a content sniff.
  let text: string | null = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = null;
  }

  return { ok: true, bytes, text, alphabet, wasUnpadded: unpadded };
}

/** What the decoded content looks like, used to pick a preview. */
export type ContentKind =
  | 'empty'
  | 'json'
  | 'text'
  | 'image'
  | 'pdf'
  | 'binary';

const IMAGE_SIGNATURES: Array<{ mime: string; magic: number[] }> = [
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'image/bmp', magic: [0x42, 0x4d] },
];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/** Detects a likely MIME type from the leading bytes. */
export function detectMime(bytes: Uint8Array): string | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (startsWith(bytes, signature.magic)) return signature.mime;
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  return null;
}

export function classify(bytes: Uint8Array, text: string | null): ContentKind {
  if (bytes.length === 0) return 'empty';

  const mime = detectMime(bytes);
  if (mime?.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';

  if (text !== null) {
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // Looks like JSON but is not parseable; treat as plain text.
      }
    }
    return 'text';
  }

  return 'binary';
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Pretty-prints a JSON string, returning null when it is not valid JSON. */
export function tryFormatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}
