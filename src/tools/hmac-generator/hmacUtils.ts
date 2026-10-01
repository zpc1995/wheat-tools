/**
 * HMAC helpers (RFC 2104) built on the platform's Web Crypto API.
 *
 * HMAC is deliberately *not* hand-rolled here. Web Crypto's `importKey` +
 * `sign` already follows RFC 2104 exactly: a key longer than the hash block
 * size is hashed first, and any shorter key is zero-padded to the block size.
 * The single most common way to get HMAC wrong is to always hash the key before
 * use, which silently produces a different digest for every key that is not
 * longer than the block. The RFC test vectors in the check script pin that
 * behaviour down.
 *
 * The same code runs unchanged in the browser and in Node 22, so the check
 * script exercises the shipped implementation rather than a copy of it.
 */

/** Hash functions offered for HMAC. */
export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Display order in the picker: modern first, SHA-1 last as the legacy option. */
export const HMAC_ALGORITHMS: readonly HmacAlgorithm[] = [
  'SHA-256',
  'SHA-384',
  'SHA-512',
  'SHA-1',
];

/** Digest length in bits, per FIPS 180-4. */
export const DIGEST_BITS: Record<HmacAlgorithm, number> = {
  'SHA-1': 160,
  'SHA-256': 256,
  'SHA-384': 384,
  'SHA-512': 512,
};

/**
 * HMAC block size in bytes, per RFC 2104 section 2.
 *
 * This is what decides whether the key gets hashed: SHA-1 and SHA-256 use
 * 64-byte blocks, SHA-384 and SHA-512 use 128-byte blocks. It is exported so
 * the UI can explain which of the two the current key fell into.
 */
export const BLOCK_BYTES: Record<HmacAlgorithm, number> = {
  'SHA-1': 64,
  'SHA-256': 64,
  'SHA-384': 128,
  'SHA-512': 128,
};

/** How the key text should be read. */
export type KeyEncoding = 'text' | 'hex';

export interface HmacRequest {
  algorithm: HmacAlgorithm;
  /** Message text, always interpreted as UTF-8. */
  message: string;
  /** Key text, interpreted according to `keyEncoding`. */
  key: string;
  keyEncoding: KeyEncoding;
}

export interface HmacResult {
  algorithm: HmacAlgorithm;
  /** Lowercase hex digest. */
  hex: string;
  /** Uppercase hex digest. */
  upper: string;
  /** Base64 of the same digest bytes. */
  base64: string;
  /** Digest length in bits. */
  bits: number;
  /** Digest length in bytes. */
  bytes: number;
  /** Key length in bytes after decoding the input. */
  keyLength: number;
  /** Message length in bytes after UTF-8 encoding. */
  messageLength: number;
  /**
   * True when the key decoded to zero bytes.
   *
   * The value is still computed (RFC 2104 defines it, and it is what an empty
   * key in node:crypto produces) but callers should warn: an empty key offers
   * no authentication at all, since anyone can recompute the tag.
   */
  emptyKey: boolean;
}

/** Outcome of a full HMAC computation, error message included. */
export type HmacOutcome =
  | { ok: true; result: HmacResult }
  | { ok: false; error: string };

const encoder = new TextEncoder();

/** Encodes text as UTF-8 bytes. */
export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Lowercase hex of raw bytes. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Base64 of raw bytes.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the call stack for
 * large inputs. Digests are tiny, but this helper is also used on pasted
 * fixtures in the UI, so it stays safe at any size.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decodes Base64 to bytes, or returns null when the text is not Base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text.trim());
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface BytesResult {
  ok: boolean;
  bytes: Uint8Array;
  error: string;
}

/**
 * Parses a hex-encoded key.
 *
 * Whitespace, colons and dashes are ignored so the grouping people actually
 * paste (`0b0b 0b0b`, `0b:0b:0b:0b`, the dump style used by the RFCs) all work,
 * and a leading `0x` is accepted. What is *not* accepted is an odd digit count
 * or a stray character: quietly dropping a nibble would compute a valid HMAC
 * over the wrong key, and a wrong-but-plausible answer is worse than an error.
 */
export function parseHexBytes(text: string): BytesResult {
  let cleaned = text.trim().replace(/[\s:_-]/g, '');
  if (/^0x/i.test(cleaned)) cleaned = cleaned.slice(2);

  const stray = /[^0-9a-fA-F]/.exec(cleaned);
  if (stray) {
    return {
      ok: false,
      bytes: new Uint8Array(0),
      error: `密钥含有非十六进制字符「${stray[0]}」`,
    };
  }
  if (cleaned.length % 2 !== 0) {
    return {
      ok: false,
      bytes: new Uint8Array(0),
      error: `十六进制密钥有 ${cleaned.length} 位，必须成对出现（每字节 2 位）`,
    };
  }

  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return { ok: true, bytes, error: '' };
}

/** Turns the key input into bytes according to the selected encoding. */
export function resolveKey(key: string, encoding: KeyEncoding): BytesResult {
  if (encoding === 'hex') return parseHexBytes(key);
  return { ok: true, bytes: utf8Bytes(key), error: '' };
}

/**
 * Copies into a fresh ArrayBuffer-backed view.
 *
 * TypeScript 5.7+ types `Uint8Array` as `Uint8Array<ArrayBufferLike>`, which
 * Web Crypto's `BufferSource` rejects (it could be a SharedArrayBuffer).
 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

/**
 * Replaces a zero-length key with a single zero byte.
 *
 * Web Crypto rejects an empty HMAC key outright (`DataError: Zero-length key is
 * not supported`) even though RFC 2104 defines it and node:crypto accepts it.
 * A one-byte 0x00 key is padded with zeros to the very same block, so HMAC over
 * it is bit-for-bit identical to HMAC over the empty key. Substituting it keeps
 * the tool interoperable instead of failing on a defined input.
 */
function keyForWebCrypto(key: Uint8Array): Uint8Array {
  return key.length === 0 ? new Uint8Array(1) : key;
}

/**
 * Raw HMAC over bytes.
 *
 * Exported separately from `computeHmac` so the check script can feed RFC
 * vectors as bytes without going through the text/hex UI plumbing.
 */
export async function hmacBytes(
  algorithm: HmacAlgorithm,
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('当前环境不支持 Web Crypto，无法计算 HMAC');
  }
  const cryptoKey = await subtle.importKey(
    'raw',
    toBuffer(keyForWebCrypto(key)),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('HMAC', cryptoKey, toBuffer(message));
  return new Uint8Array(signature);
}

/** Builds the display result from a computed digest. */
export function buildHmacResult(
  algorithm: HmacAlgorithm,
  digest: Uint8Array,
  keyLength: number,
  messageLength: number,
): HmacResult {
  const hex = bytesToHex(digest);
  return {
    algorithm,
    hex,
    upper: hex.toUpperCase(),
    base64: bytesToBase64(digest),
    bits: DIGEST_BITS[algorithm],
    bytes: DIGEST_BITS[algorithm] / 8,
    keyLength,
    messageLength,
    emptyKey: keyLength === 0,
  };
}

/** Full pipeline: decode the key, encode the message, compute the digest. */
export async function computeHmac(request: HmacRequest): Promise<HmacOutcome> {
  const key = resolveKey(request.key, request.keyEncoding);
  if (!key.ok) return { ok: false, error: key.error };

  const message = utf8Bytes(request.message);
  try {
    const digest = await hmacBytes(request.algorithm, key.bytes, message);
    return {
      ok: true,
      result: buildHmacResult(
        request.algorithm,
        digest,
        key.bytes.length,
        message.length,
      ),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'HMAC 计算失败',
    };
  }
}

/**
 * Explains how the current key will be treated, so the "key longer than the
 * block size gets hashed first" rule is visible rather than folklore.
 */
export function describeKeyHandling(
  algorithm: HmacAlgorithm,
  keyLength: number,
): string {
  const block = BLOCK_BYTES[algorithm];
  if (keyLength === 0) {
    return `密钥为空：按 RFC 2104 会零填充到 ${block} 字节，不具备任何认证能力`;
  }
  if (keyLength > block) {
    return `${keyLength} 字节 > 块大小 ${block} 字节，先做一次 ${algorithm} 再参与 HMAC`;
  }
  return `${keyLength} 字节，直接零填充到块大小 ${block} 字节`;
}
