/**
 * Hashing helpers.
 *
 * MD5 is implemented here because `crypto.subtle` deliberately does not offer
 * it (the algorithm is broken for collision resistance). It is still widely
 * needed for non-security checksums, ETag-style fingerprints and legacy
 * interop, so it ships as a plain, self-contained implementation of RFC 1321
 * rather than pulling in a dependency.
 *
 * SHA-1 / SHA-256 come from the platform (`crypto.subtle`).
 */

/** Per-round left-rotation amounts from RFC 1321. */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16,
  23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** `floor(abs(sin(i + 1)) * 2^32)` for i in 0..63, as in the reference. */
const K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** Encodes text as UTF-8 bytes. */
function utf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

/** MD5 of raw bytes, returned as a 16-byte array (RFC 1321 digest order). */
export function md5Bytes(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;

  // Message is padded with 0x80, zeros, and the 64-bit little-endian length,
  // rounded up to a whole number of 512-bit blocks.
  const paddedLength = (((input.length + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(input);
  buffer[input.length] = 0x80;

  const view = new DataView(buffer.buffer);
  // Length is written as two 32-bit words (low, then high) to stay exact.
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(
    paddedLength - 4,
    Math.floor(bitLength / 4294967296) >>> 0,
    true,
  );

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const m = new Uint32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      m[i] = view.getUint32(offset + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const sum = (a + f + K[i] + m[g]) >>> 0;
      const rotated = rotateLeft(sum, SHIFTS[i]);

      a = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const out = new DataView(digest.buffer);
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  return digest;
}

/** MD5 of a UTF-8 string, as lowercase hex. */
export function md5Hex(input: string): string {
  return toHex(md5Bytes(utf8Bytes(input)));
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Base64 of raw bytes. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface HashResult {
  /** Lowercase hex digest. */
  hex: string;
  /** Uppercase hex digest. */
  upper: string;
  /** Base64 of the raw digest. */
  base64: string;
  /** Digest length in bits. */
  bits: number;
  /** Digest length in bytes. */
  bytes: number;
}

function toResult(digest: Uint8Array): HashResult {
  const hex = toHex(digest);
  return {
    hex,
    upper: hex.toUpperCase(),
    base64: bytesToBase64(digest),
    bits: digest.length * 8,
    bytes: digest.length,
  };
}

export function md5(input: string): HashResult {
  return toResult(md5Bytes(utf8Bytes(input)));
}

/** SHA-1 / SHA-256 via the platform Web Crypto API. */
export async function subtleHash(
  algorithm: 'SHA-1' | 'SHA-256',
  input: string,
): Promise<HashResult> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 Web Crypto，无法计算 ' + algorithm);
  }
  // TS 5.7+ types `Uint8Array` as `Uint8Array<ArrayBufferLike>`, which Web
  // Crypto's `BufferSource` rejects (it could be a SharedArrayBuffer). Copying
  // into a fresh ArrayBuffer-backed view gives an unambiguous type, and the
  // input here is a text-sized payload so the copy is negligible.
  const bytes = new Uint8Array(utf8Bytes(input));
  const digest = await globalThis.crypto.subtle.digest(
    algorithm,
    bytes.buffer as ArrayBuffer,
  );
  return toResult(new Uint8Array(digest));
}

/** Reads a file as bytes (used for file hashing). */
export async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Human-readable byte size, e.g. `1.2 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
