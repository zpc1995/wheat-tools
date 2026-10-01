/**
 * Basic authentication: building and parsing `Authorization: Basic …` (RFC 7617).
 *
 * Pure functions — no React, no network, no clock. The only globals used are
 * `btoa` / `atob`, `TextEncoder` / `TextDecoder` and `Uint8Array`, all of which
 * exist in browsers and in Node, so the same code can be checked by a Node
 * script. Nothing here ever sends a request: the tool stops at producing a
 * header value and a command the user can run themselves.
 *
 * ## The two things that actually matter
 *
 * **1. Base64 is applied to *octets*, so the character encoding has to be chosen
 * first — and RFC 7617 does not choose it for you.**
 * Section 2 defines the user-pass as user-id, a colon, then the password, and
 * says that sequence is encoded "into an octet sequence", but deliberately
 * leaves the default encoding undefined for backwards compatibility: "most
 * implementations chose either a locale-specific encoding such as ISO-8859-1,
 * or UTF-8". The only value the standard defines for the challenge's `charset`
 * parameter is UTF-8, and it is *purely advisory*. In practice almost every
 * server today decodes credentials as UTF-8, which is why UTF-8 is the default
 * here — but a user hitting `é`-shaped login failures on an old service should
 * try ISO-8859-1, so both are offered instead of being assumed.
 *
 * `btoa` cannot help with this: it throws on any code unit above U+00FF, which
 * is exactly why the byte conversion happens first (see the check script, which
 * asserts the throw). `btoa` is only ever handed a string of one-byte
 * characters built from the octets.
 *
 * **2. A colon in the user-id cannot be represented.**
 * The first colon in the user-pass separates user-id from password; text after
 * it belongs to the password. RFC 7617: "a user-id containing a colon character
 * is invalid […] User-ids containing colons cannot be encoded in user-pass
 * strings." This module reports that rather than silently producing a header
 * that authenticates as a different user.
 *
 * Control characters are also forbidden by the RFC (`CTL`), but that is reported
 * as a warning: the encoding itself is still well-defined.
 */

/** Character encoding used to turn the user-pass into octets. */
export type Charset = 'utf-8' | 'iso-8859-1';

export interface EncodeOptions {
  /**
   * How to convert the user-pass into octets. Defaults to `utf-8`, which is what
   * real servers expect even though the RFC defines no default.
   */
  charset?: Charset;
}

/** A reason the credentials are invalid or the encoding is lossy. */
export type EncodeIssue =
  /** The user-id contains a colon; the credentials cannot be represented. */
  | 'colon-in-username'
  /** ISO-8859-1 cannot represent a character in the credentials. */
  | 'latin1-unrepresentable'
  /** A control character, which RFC 7617 forbids in user-id and password. */
  | 'control-characters'
  | 'empty-username'
  | 'empty-password'
  /** Credentials contain non-ASCII characters, so the charset choice matters. */
  | 'non-ascii';

export interface BasicAuthBuild {
  /** False when an `errors` entry makes the header meaningless. */
  ok: boolean;
  /** The user-pass string, decoded, for display. */
  userPass: string;
  /** The octets that get Base64-encoded. */
  bytes: number[];
  /** The token68 value: Base64 of `bytes`. Empty when encoding failed. */
  base64: string;
  /** The complete header line, or an empty string when encoding failed. */
  header: string;
  charset: Charset;
  /** Blocking problems. */
  errors: EncodeIssue[];
  /** Worth knowing, but the header is still usable. */
  warnings: EncodeIssue[];
}

/** Base64 of a byte sequence, via `btoa` over a one-byte-per-character string. */
export function bytesToBase64(bytes: number[]): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Strips whitespace, validates, and decodes Base64 to octets.
 *
 * Returns `null` for anything that is not Base64, so a malformed header is
 * reported as malformed instead of decoded into nonsense. Missing padding is
 * accepted (`QWxh…ZQ` as well as `QWxh…ZQ==`), because header values do get
 * copied around by hand; a length of `4n+1` is rejected, since no byte sequence
 * can produce it.
 */
export function base64ToBytes(value: string): number[] | null {
  const compact = value.replace(/\s+/g, '');
  if (compact === '') return [];
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;

  const unpadded = compact.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return null;

  const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }

  const bytes: number[] = [];
  for (let index = 0; index < binary.length; index += 1) {
    bytes.push(binary.charCodeAt(index));
  }
  return bytes;
}

/** `74 65 73 74` — the octet dump shown next to the header. */
export function bytesToHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** True when any character is a control character per RFC 5234 `CTL`. */
function hasControlCharacters(text: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(text);
}

/** ISO-8859-1 octets, or `null` when a character has no such representation. */
function toLatin1Bytes(text: string): number[] | null {
  const bytes: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number;
    if (codePoint > 0xff) return null;
    bytes.push(codePoint);
  }
  return bytes;
}

/**
 * Builds the `Authorization` header for a user-id and password.
 *
 * Never throws, and always returns the octets it would send, so the UI can show
 * *why* a set of credentials is problematic rather than just refusing.
 */
export function encodeBasicAuth(
  username: string,
  password: string,
  options: EncodeOptions = {},
): BasicAuthBuild {
  const charset = options.charset ?? 'utf-8';
  const userPass = `${username}:${password}`;

  const errors: EncodeIssue[] = [];
  const warnings: EncodeIssue[] = [];

  let bytes: number[] = [];
  if (charset === 'utf-8') {
    bytes = [...new TextEncoder().encode(userPass)];
  } else {
    const latin1 = toLatin1Bytes(userPass);
    if (latin1 === null) errors.push('latin1-unrepresentable');
    else bytes = latin1;
  }

  if (username.includes(':')) errors.push('colon-in-username');
  if (hasControlCharacters(userPass)) warnings.push('control-characters');
  if (username === '') warnings.push('empty-username');
  if (password === '') warnings.push('empty-password');
  if (/[^\u0000-\u007f]/.test(userPass)) warnings.push('non-ascii');

  const base64 = bytes.length > 0 ? bytesToBase64(bytes) : '';

  return {
    ok: errors.length === 0,
    userPass,
    bytes,
    base64,
    header: base64 === '' ? '' : `Authorization: Basic ${base64}`,
    charset,
    errors,
    warnings,
  };
}

/** Why a pasted header could not be parsed. */
export type ParseIssue =
  | 'empty'
  | 'unknown-scheme'
  | 'invalid-base64'
  /** The decoded text has no colon, so it is not a user-pass string. */
  | 'missing-colon';

export interface ParsedAuthorization {
  ok: boolean;
  issue: ParseIssue | null;
  /** Scheme as written, or `null` when only a bare token was pasted. */
  scheme: string | null;
  base64: string | null;
  userPass: string | null;
  username: string | null;
  password: string | null;
  bytes: number[];
  /**
   * How the octets had to be interpreted. The header itself does not say, so
   * this is a best guess: bytes that are valid UTF-8 are reported as UTF-8,
   * anything else falls back to ISO-8859-1.
   */
  byteEncoding: 'utf-8' | 'iso-8859-1' | null;
  /** True when the octets are all ASCII, where the guess cannot be wrong. */
  asciiOnly: boolean;
  hasControlCharacters: boolean;
}

function emptyParse(issue: ParseIssue): ParsedAuthorization {
  return {
    ok: false,
    issue,
    scheme: null,
    base64: null,
    userPass: null,
    username: null,
    password: null,
    bytes: [],
    byteEncoding: null,
    asciiOnly: false,
    hasControlCharacters: false,
  };
}

/** Decodes octets as UTF-8, falling back to ISO-8859-1 when they are not valid UTF-8. */
function decodeOctets(bytes: number[]): {
  text: string;
  encoding: 'utf-8' | 'iso-8859-1';
  asciiOnly: boolean;
} {
  const asciiOnly = bytes.every((byte) => byte < 0x80);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    return { text, encoding: 'utf-8', asciiOnly };
  } catch {
    // Not valid UTF-8, so the sender was using some single-byte encoding; the
    // RFC's historical default of ISO-8859-1 is the best available guess.
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return { text, encoding: 'iso-8859-1', asciiOnly: false };
  }
}

/**
 * Parses an `Authorization: Basic …` header, or just the Base64 token.
 *
 * Accepts the full header line (with or without the `Authorization:` prefix, any
 * capitalisation), the `Basic <token>` form, or a bare token, because those are
 * the three shapes that get pasted into a tool like this.
 */
export function parseAuthorizationHeader(input: string): ParsedAuthorization {
  let value = input.trim();
  if (value === '') return emptyParse('empty');

  // Optional "Authorization:" / "Proxy-Authorization:" prefix, any case.
  value = value.replace(/^[A-Za-z-]*Authorization\s*:\s*/i, '').trim();
  if (value === '') return emptyParse('empty');

  let scheme: string | null = null;
  let token = value;
  const match = /^([A-Za-z][A-Za-z0-9._~+/-]*)\s+(.+)$/.exec(value);
  if (match) {
    scheme = match[1];
    token = match[2].trim();
  }

  if (scheme !== null && scheme.toLowerCase() !== 'basic') {
    return { ...emptyParse('unknown-scheme'), scheme, base64: token };
  }

  const bytes = base64ToBytes(token);
  if (bytes === null) {
    return { ...emptyParse('invalid-base64'), scheme, base64: token };
  }

  const { text, encoding, asciiOnly } = decodeOctets(bytes);
  const separator = text.indexOf(':');
  const controlCharacters = hasControlCharacters(text);

  if (separator === -1) {
    return {
      ...emptyParse('missing-colon'),
      scheme,
      base64: token,
      bytes,
      userPass: text,
      username: text,
      byteEncoding: encoding,
      asciiOnly,
      hasControlCharacters: controlCharacters,
    };
  }

  return {
    ok: true,
    issue: null,
    scheme,
    base64: token,
    bytes,
    userPass: text,
    username: text.slice(0, separator),
    // Everything after the *first* colon is the password; a password may itself
    // contain colons, a user-id may not.
    password: text.slice(separator + 1),
    byteEncoding: encoding,
    asciiOnly,
    hasControlCharacters: controlCharacters,
  };
}

/**
 * Quotes a value for a POSIX shell.
 *
 * Single quotes make everything literal, but a single quote cannot appear inside
 * them, so it is closed, escaped and reopened: `it's` becomes `'it'\''s'`. Getting
 * this wrong turns a password containing an apostrophe into a broken command, or
 * worse, into two commands.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface CurlCommands {
  /** `curl --user …`, which lets curl do the Base64 encoding itself. */
  userFlag: string;
  /** `curl --header 'Authorization: Basic …'`, which pins the exact octets. */
  headerFlag: string;
}

/**
 * curl equivalents of the header.
 *
 * Both forms are produced because they are not equivalent: `--user` sends the
 * bytes of the argument as the shell passed them, so it can only be trusted when
 * the service reads credentials as UTF-8. The `--header` form carries the exact
 * Base64 this module computed, which is the only way to be sure about
 * ISO-8859-1.
 */
export function buildCurlCommands(
  username: string,
  password: string,
  url: string,
  options: EncodeOptions = {},
): CurlCommands {
  const target = shellQuote(url.trim() || 'https://example.com/');
  const built = encodeBasicAuth(username, password, options);
  return {
    userFlag: `curl --user ${shellQuote(built.userPass)} ${target}`,
    headerFlag: built.header === '' ? '' : `curl --header ${shellQuote(built.header)} ${target}`,
  };
}

/**
 * A browser `fetch` snippet that is correct for non-ASCII credentials.
 *
 * The obvious `btoa(user + ':' + pass)` throws `InvalidCharacterError` on any
 * character above U+00FF, so the snippet converts to octets first. The snippet
 * follows the selected charset, because a snippet that silently encodes UTF-8
 * while the header above it used ISO-8859-1 would be worse than no snippet.
 */
export function buildFetchSnippet(
  username: string,
  password: string,
  url: string,
  options: EncodeOptions = {},
): string {
  const target = url.trim() || 'https://example.com/';
  const charset = options.charset ?? 'utf-8';
  const octets =
    charset === 'utf-8'
      ? 'new TextEncoder().encode(credentials)'
      : 'Array.from(credentials, (char) => char.charCodeAt(0))';

  return [
    `const credentials = ${JSON.stringify(`${username}:${password}`)};`,
    `const bytes = ${octets};`,
    // Spread would work but breaks past a few tens of thousands of arguments;
    // the loop has no such cliff and is no harder to read.
    'let binary = "";',
    'for (const byte of bytes) binary += String.fromCharCode(byte);',
    'const token = btoa(binary);',
    '',
    `await fetch(${JSON.stringify(target)}, {`,
    '  headers: { Authorization: `Basic ${token}` },',
    '});',
  ].join('\n');
}

/** The Node equivalent, where `Buffer` does the byte conversion and Base64. */
export function buildNodeSnippet(username: string, password: string): string {
  return [
    `const token = Buffer.from(${JSON.stringify(`${username}:${password}`)}, "utf8")`,
    '  .toString("base64");',
    '// headers: { Authorization: `Basic ${token}` }',
  ].join('\n');
}

/**
 * RFC 7617 example from Section 2, kept next to the implementation so the
 * documented sample is visible where it is used.
 *
 * `Aladdin` / `open sesame` → `QWxhZGRpbjpvcGVuIHNlc2FtZQ==`.
 */
export const RFC_7617_EXAMPLE_USERNAME = 'Aladdin';
export const RFC_7617_EXAMPLE_PASSWORD = 'open sesame';
export const RFC_7617_EXAMPLE_BASE64 = 'QWxhZGRpbjpvcGVuIHNlc2FtZQ==';
