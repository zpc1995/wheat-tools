/**
 * Pure helpers behind the RSA key pair generator: PEM, DER, JWK and fingerprints.
 *
 * Only `generateRsaKeyPair` and `sha256Bytes` touch Web Crypto. Everything else
 * takes bytes and returns bytes or strings, which is what makes the tricky parts
 * testable: PEM line wrapping, base64 padding, DER integer normalisation and the
 * base64url encoding JWK requires are all decided by pure code that a Node check
 * script can compare against `node:crypto` directly.
 *
 * The JWK is assembled here from the exported DER rather than copied from
 * `subtle.exportKey('jwk', ...)`. That is deliberate: it means the modulus and
 * exponents are read by this module's own ASN.1 reader, so the check script can
 * compare every field against an independent implementation instead of
 * comparing Web Crypto with itself.
 */

/** Signature or encryption scheme, using the Web Crypto algorithm names. */
export type RsaAlgorithm = 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'RSA-OAEP';

/** Hash functions offered with every scheme. */
export type RsaHash = 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Pick-list order in the UI: signature first, encryption last. */
export const RSA_ALGORITHMS: readonly RsaAlgorithm[] = [
  'RSASSA-PKCS1-v1_5',
  'RSA-PSS',
  'RSA-OAEP',
];

export const RSA_HASHES: readonly RsaHash[] = ['SHA-256', 'SHA-384', 'SHA-512'];

/**
 * Modulus lengths that may be generated.
 *
 * 1024 is absent on purpose, and it is not merely "not recommended": it is below
 * the floor every current guideline sets. `validateModulusLength` returns an
 * explicit message for it so a caller that passes 1024 anyway is told why rather
 * than silently receiving a weak key.
 */
export const ALLOWED_MODULUS_LENGTHS: readonly number[] = [2048, 3072, 4096];

/** The length this tool refuses, kept as a named constant for the UI copy. */
export const REJECTED_MODULUS_LENGTH = 1024;

/** What each scheme is actually for, shown next to the picker. */
export const ALGORITHM_NOTES: Record<RsaAlgorithm, string> = {
  'RSASSA-PKCS1-v1_5':
    '签名（JWT 的 RS256 / RS384 / RS512）。填充是确定性的，兼容性最好，老系统几乎都认；新设计更推荐 RSA-PSS。',
  'RSA-PSS':
    '签名（JWT 的 PS256 / PS384 / PS512）。带随机盐的概率性填充，有更完整的安全性证明，是 RFC 8017 推荐的现代用法；部分老系统不支持。',
  'RSA-OAEP':
    '加密（JWA 的 RSA-OAEP-256 / RSA-OAEP-384 / RSA-OAEP-512）。只能加密，不能签名；单次能加密的明文长度受模长限制，大数据应改为「用它加密一个对称密钥，再用 AES 加密数据」。',
};

/** How the hash choice changes the key. */
export const HASH_NOTES: Record<RsaHash, string> = {
  'SHA-256': '默认选择，兼容性最好。',
  'SHA-384': '强度更高，签名长度不变，计算略慢。',
  'SHA-512': '最高强度；配合 2048 位模长时收益有限，更适合 3072 / 4096 位。',
};

/** One-line trade-off per offered modulus length. */
export const MODULUS_LENGTH_NOTES: Record<number, string> = {
  2048: '推荐。约 112 位安全强度，生成很快，所有场景都支持。',
  3072: '约 128 位安全强度，面向 2031 年之后的使用；生成通常需要 1 秒左右。',
  4096: '约 152 位安全强度，余量最大，但生成可能要几秒，签名与解密也更慢。',
};

/** Why 1024 is not on the list at all. */
export const MODULUS_1024_REASON =
  '1024 位 RSA 只有约 80 位安全强度：NIST SP 800-57 自 2014 年起已不再允许它用于政府系统，' +
  '多家 CA 与软件厂商也早已停止签发或接受。它至今没有被公开分解，但已落在有充足预算的攻击者能力范围边缘，' +
  '因此本工具直接不提供该选项，而不是生成后再提醒。';

/** Result of decoding a PEM block. */
export type PemDecodeResult =
  | { ok: true; label: string; der: Uint8Array }
  | { ok: false; error: string };

/** Public key numbers, as unsigned big-endian bytes with leading zeros removed. */
export interface RsaPublicComponents {
  n: Uint8Array;
  e: Uint8Array;
}

/** Private key numbers, in the order RFC 8017 defines them. */
export interface RsaPrivateComponents extends RsaPublicComponents {
  d: Uint8Array;
  p: Uint8Array;
  q: Uint8Array;
  dp: Uint8Array;
  dq: Uint8Array;
  qi: Uint8Array;
}

/** Public key in JWK form (RFC 7517 / RFC 7518). */
export interface RsaPublicJwk {
  kty: 'RSA';
  n: string;
  e: string;
  alg: string;
  key_ops: string[];
  ext: true;
}

/** Private key in JWK form; carries every CRT parameter. */
export interface RsaPrivateJwk extends RsaPublicJwk {
  d: string;
  p: string;
  q: string;
  dp: string;
  dq: string;
  qi: string;
}

/** Parameters accepted by the generator. */
export interface RsaKeyPairRequest {
  modulusLength: number;
  algorithm: RsaAlgorithm;
  hash: RsaHash;
}

/** Everything the UI needs after one successful generation. */
export interface RsaKeyPairResult {
  modulusLength: number;
  algorithm: RsaAlgorithm;
  hash: RsaHash;
  /** JWA name for the combination, for example RS256 or RSA-OAEP-256. */
  jwa: string;
  /** Live Web Crypto handles, kept so callers can sign or encrypt immediately. */
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  /** Raw SPKI and PKCS#8 bytes, the input to every derived form below. */
  publicDer: Uint8Array;
  privateDer: Uint8Array;
  publicPem: string;
  privatePem: string;
  publicJwk: RsaPublicJwk;
  privateJwk: RsaPrivateJwk;
  fingerprintHex: string;
  fingerprintColon: string;
  /** Real modulus length read back from the DER, not the requested value. */
  modulusBits: number;
  /** Public exponent as a decimal string, normally 65537. */
  publicExponent: string;
}

/** Outcome of a generation attempt. */
export type RsaKeyPairOutcome =
  | { ok: true; result: RsaKeyPairResult }
  | { ok: false; error: string };

const encoder = new TextEncoder();

/** Encodes text as UTF-8 bytes. */
export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/**
 * Copies bytes into a fresh ArrayBuffer-backed view.
 *
 * TypeScript 5.7 types `Uint8Array` as `Uint8Array<ArrayBufferLike>`, which Web
 * Crypto's `BufferSource` rejects because it could be a SharedArrayBuffer.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

/**
 * Base64 of raw bytes.
 *
 * Chunked because `String.fromCharCode(...bytes)` overflows the call stack for
 * large inputs. Keys are small, but a shared helper should not have a size cliff.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/** Decodes Base64 to bytes, or returns null when the text is not Base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * base64url without padding, as RFC 7515 section 2 defines it for JWK members.
 *
 * The padding must be dropped: `node:crypto` and every JWK consumer reject a
 * `n` value ending in `=`, and the alphabet swaps `+` and `/` for `-` and `_`.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Compares two byte arrays without converting them to strings. */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Wraps DER bytes in a PEM block with the exact layout RFC 7468 requires.
 *
 * Generators must emit exactly 64 base64 characters per line and end the block
 * with a newline. The common one-liner `base64.replace(/(.{64})/g, '$1\n')` gets
 * both wrong: it silently drops the final partial line (the last characters of
 * every key), and when the body is an exact multiple of 64 it leaves a trailing
 * blank line. This loop is used instead, and the check script demonstrates the
 * data loss the one-liner causes.
 */
export function encodePem(label: string, der: Uint8Array): string {
  const base64 = bytesToBase64(der);
  const lines: string[] = [];
  for (let index = 0; index < base64.length; index += 64) {
    lines.push(base64.slice(index, index + 64));
  }
  const body = lines.length > 0 ? lines.map((line) => `${line}\n`).join('') : '';
  return `-----BEGIN ${label}-----\n${body}-----END ${label}-----\n`;
}

/**
 * Parses a single PEM block back to DER bytes.
 *
 * Line width is *not* enforced. RFC 7468 tells generators to wrap at 64 but
 * explicitly lets parsers accept other widths, and real files in the wild are
 * wrapped at 64 or 76 or not at all; rejecting them would make the decoder
 * useless on pasted keys while catching nothing that matters. What is enforced
 * is everything that would change the bytes: a BEGIN line first, a matching END
 * line, base64-only characters and a length that is a multiple of four.
 */
export function decodePem(text: string): PemDecodeResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'PEM 内容为空' };
  }

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return { ok: false, error: 'PEM 内容为空' };

  const begin = /^-----BEGIN (.+)-----$/.exec(lines[0]);
  if (!begin) {
    return {
      ok: false,
      error: '缺少 -----BEGIN ...----- 头，或 BEGIN 行之前还有其它内容',
    };
  }
  const label = begin[1];

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('-----END')) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === -1) {
    return { ok: false, error: `缺少 -----END ${label}----- 尾` };
  }

  const end = /^-----END (.+)-----$/.exec(lines[endIndex]);
  if (!end) return { ok: false, error: '-----END 行格式非法' };
  if (end[1] !== label) {
    return {
      ok: false,
      error: `头尾标签不一致：BEGIN ${label} 对应 END ${end[1]}`,
    };
  }

  if (lines.slice(endIndex + 1).some((line) => line !== '')) {
    return { ok: false, error: 'END 行之后仍有内容，只接受单个 PEM 块' };
  }

  const body = lines.slice(1, endIndex).join('');
  if (body === '') return { ok: false, error: 'PEM 主体为空' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    return {
      ok: false,
      error: 'PEM 主体含有非 Base64 字符（base64url 的 - 与 _ 也不接受）',
    };
  }
  if (body.length % 4 !== 0) {
    return {
      ok: false,
      error: `PEM 主体 Base64 长度为 ${body.length}，不是 4 的倍数`,
    };
  }

  const der = base64ToBytes(body);
  if (!der || der.length === 0) {
    return { ok: false, error: 'PEM 主体的 Base64 无法解码' };
  }
  return { ok: true, label, der };
}

/** One parsed ASN.1 element: tag, content bytes and where it ends. */
interface DerElement {
  tag: number;
  value: Uint8Array;
  /** Offset of the first content byte. */
  start: number;
  /** Offset just past this element. */
  end: number;
}

/**
 * Reads one DER element at `offset`.
 *
 * Only the subset the RSA structures use is supported: single-byte tags,
 * definite lengths of up to four bytes, and the shortest-form rule DER
 * requires. Anything else returns null, so a malformed blob ends up as a clean
 * "not a key" rather than a wrong key.
 */
function readElement(bytes: Uint8Array, offset: number): DerElement | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  const tag = bytes[offset];
  // High-tag-number form (0x1f) does not appear in these structures.
  if ((tag & 0x1f) === 0x1f) return null;

  let cursor = offset + 1;
  let length = bytes[cursor];
  cursor += 1;

  if (length === 0x80) return null; // indefinite length is not valid DER
  if (length > 0x80) {
    const count = length & 0x7f;
    if (count > 4 || cursor + count > bytes.length) return null;
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = length * 256 + bytes[cursor + index];
    }
    cursor += count;
    // DER must use the shortest possible length form.
    if (length < 0x80) return null;
  }

  if (cursor + length > bytes.length) return null;
  return {
    tag,
    value: bytes.subarray(cursor, cursor + length),
    start: cursor,
    end: cursor + length,
  };
}

/**
 * Reads an INTEGER and strips the sign byte.
 *
 * DER writes a leading 0x00 whenever the top bit is set, so a 2048-bit modulus
 * is 257 bytes on the wire and 256 bytes of actual number. JWK wants the
 * minimal unsigned form, so the zeros must go. An all-zero INTEGER is rejected:
 * a zero modulus or exponent is not a key.
 */
function readUnsignedInteger(
  bytes: Uint8Array,
  offset: number,
): { value: Uint8Array; end: number } | null {
  const element = readElement(bytes, offset);
  if (!element || element.tag !== 0x02) return null;
  let index = 0;
  while (index < element.value.length && element.value[index] === 0) index += 1;
  if (index === element.value.length) return null;
  return { value: element.value.slice(index), end: element.end };
}

/** Reads a small non-negative INTEGER such as a version number; zero is valid. */
function readVersion(
  bytes: Uint8Array,
  offset: number,
): { value: number; end: number } | null {
  const element = readElement(bytes, offset);
  if (!element || element.tag !== 0x02) return null;
  if (element.value.length === 0 || element.value.length > 4) return null;
  let value = 0;
  for (const byte of element.value) value = value * 256 + byte;
  return { value, end: element.end };
}

/**
 * DER content of the rsaEncryption OID, 1.2.840.113549.1.1.1 (RFC 8017 A.1).
 *
 * Checked rather than assumed: an EC or Ed25519 SubjectPublicKeyInfo has the
 * same outer shape (SEQUENCE, AlgorithmIdentifier, BIT STRING), so without the
 * OID check a different algorithm's key could be walked as if it were RSA.
 */
const RSA_ENCRYPTION_OID = new Uint8Array([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
]);

/** True when an AlgorithmIdentifier starts with the rsaEncryption OID. */
function isRsaAlgorithm(bytes: Uint8Array, algorithm: DerElement): boolean {
  const oid = readElement(bytes, algorithm.start);
  return oid !== null && oid.tag === 0x06 && bytesEqual(oid.value, RSA_ENCRYPTION_OID);
}

/**
 * Extracts n and e from an SPKI (SubjectPublicKeyInfo) blob.
 *
 * Layout: SEQUENCE { AlgorithmIdentifier, BIT STRING { SEQUENCE { n, e } } }.
 * Returns null for anything that is not that shape.
 */
export function parseRsaPublicKeyDer(der: Uint8Array): RsaPublicComponents | null {
  const outer = readElement(der, 0);
  if (!outer || outer.tag !== 0x30) return null;

  const algorithm = readElement(der, outer.start);
  if (!algorithm || algorithm.tag !== 0x30 || !isRsaAlgorithm(der, algorithm)) return null;

  const bitString = readElement(der, algorithm.end);
  if (!bitString || bitString.tag !== 0x03) return null;
  // The first content byte of a BIT STRING counts unused trailing bits.
  if (bitString.value.length < 1 || bitString.value[0] !== 0) return null;

  const rsa = readElement(der, bitString.start + 1);
  if (!rsa || rsa.tag !== 0x30) return null;

  const modulus = readUnsignedInteger(der, rsa.start);
  if (!modulus) return null;
  const exponent = readUnsignedInteger(der, modulus.end);
  if (!exponent) return null;

  return { n: modulus.value, e: exponent.value };
}

/**
 * Extracts every CRT parameter from a PKCS#8 blob.
 *
 * Layout: SEQUENCE { INTEGER version, AlgorithmIdentifier, OCTET STRING {
 * SEQUENCE { version, n, e, d, p, q, dp, dq, qi } } }.
 */
export function parseRsaPrivateKeyDer(der: Uint8Array): RsaPrivateComponents | null {
  const outer = readElement(der, 0);
  if (!outer || outer.tag !== 0x30) return null;

  const version = readVersion(der, outer.start);
  if (!version) return null;

  const algorithm = readElement(der, version.end);
  if (!algorithm || algorithm.tag !== 0x30 || !isRsaAlgorithm(der, algorithm)) return null;

  const privateKeyInfo = readElement(der, algorithm.end);
  if (!privateKeyInfo || privateKeyInfo.tag !== 0x04) return null;

  const rsa = readElement(der, privateKeyInfo.start);
  if (!rsa || rsa.tag !== 0x30) return null;

  const innerVersion = readVersion(der, rsa.start);
  if (!innerVersion) return null;

  // Eight integers follow the inner version, in RFC 8017 order:
  // n, e, d, p, q, dp, dq, qi.
  const values: Uint8Array[] = [];
  let cursor = innerVersion.end;
  for (let index = 0; index < 8; index += 1) {
    const integer = readUnsignedInteger(der, cursor);
    if (!integer) return null;
    values.push(integer.value);
    cursor = integer.end;
  }

  return {
    n: values[0],
    e: values[1],
    d: values[2],
    p: values[3],
    q: values[4],
    dp: values[5],
    dq: values[6],
    qi: values[7],
  };
}

/** JWA identifiers (RFC 7518) for the scheme and hash combinations offered. */
const JWA_NAMES: Record<RsaAlgorithm, Record<RsaHash, string>> = {
  'RSASSA-PKCS1-v1_5': { 'SHA-256': 'RS256', 'SHA-384': 'RS384', 'SHA-512': 'RS512' },
  'RSA-PSS': { 'SHA-256': 'PS256', 'SHA-384': 'PS384', 'SHA-512': 'PS512' },
  'RSA-OAEP': {
    'SHA-256': 'RSA-OAEP-256',
    'SHA-384': 'RSA-OAEP-384',
    'SHA-512': 'RSA-OAEP-512',
  },
};

/** The JWA `alg` value for a scheme and hash pair. */
export function jwaAlgorithm(algorithm: RsaAlgorithm, hash: RsaHash): string {
  return JWA_NAMES[algorithm][hash];
}

/**
 * The JWK `key_ops` a public key gets.
 *
 * The values are the ones Web Crypto itself derives from the requested usages.
 * They are included because a key exported for verification should not silently
 * look usable for encryption; a consumer that needs different operations can
 * still drop the member before importing.
 */
export function publicKeyOps(algorithm: RsaAlgorithm): string[] {
  return algorithm === 'RSA-OAEP' ? ['encrypt'] : ['verify'];
}

/** The JWK `key_ops` a private key gets. */
export function privateKeyOps(algorithm: RsaAlgorithm): string[] {
  return algorithm === 'RSA-OAEP' ? ['decrypt'] : ['sign'];
}

/**
 * Assembles a public JWK from raw numbers.
 *
 * Pure on purpose: given the same bytes it always produces the same JSON, which
 * is what lets the check script compare every member against `node:crypto`'s
 * own JWK export.
 */
export function assemblePublicJwk(
  components: RsaPublicComponents,
  algorithm: RsaAlgorithm,
  hash: RsaHash,
): RsaPublicJwk {
  return {
    kty: 'RSA',
    n: base64UrlEncode(components.n),
    e: base64UrlEncode(components.e),
    alg: jwaAlgorithm(algorithm, hash),
    key_ops: publicKeyOps(algorithm),
    ext: true,
  };
}

/** Assembles a private JWK, CRT parameters included. */
export function assemblePrivateJwk(
  components: RsaPrivateComponents,
  algorithm: RsaAlgorithm,
  hash: RsaHash,
): RsaPrivateJwk {
  return {
    kty: 'RSA',
    n: base64UrlEncode(components.n),
    e: base64UrlEncode(components.e),
    d: base64UrlEncode(components.d),
    p: base64UrlEncode(components.p),
    q: base64UrlEncode(components.q),
    dp: base64UrlEncode(components.dp),
    dq: base64UrlEncode(components.dq),
    qi: base64UrlEncode(components.qi),
    alg: jwaAlgorithm(algorithm, hash),
    key_ops: privateKeyOps(algorithm),
    ext: true,
  };
}

/**
 * Bit length of an unsigned big-endian integer, ignoring leading zeros.
 *
 * Read back from the key itself rather than trusting the requested length, so a
 * provider that quietly generated something else cannot go unnoticed.
 */
export function modulusBitLength(bytes: Uint8Array): number {
  let index = 0;
  while (index < bytes.length && bytes[index] === 0) index += 1;
  if (index === bytes.length) return 0;
  let bits = (bytes.length - index - 1) * 8;
  let value = bytes[index];
  while (value > 0) {
    bits += 1;
    value >>= 1;
  }
  return bits;
}

/** A small unsigned integer as a decimal string; used for the public exponent. */
export function bytesToDecimalString(bytes: Uint8Array): string {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return String(value);
}

/** Lowercase hex of raw bytes. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Lowercase hex, the form `openssl dgst -sha256` prints. */
export function formatFingerprintHex(digest: Uint8Array): string {
  return bytesToHex(digest);
}

/**
 * Colon-separated uppercase hex, the form `openssl x509 -fingerprint` prints.
 *
 * This is the copyable fingerprint: grouping by byte is what people compare by
 * eye, and it matches what `openssl ... | openssl dgst -sha256 -c` produces.
 */
export function formatFingerprintColon(digest: Uint8Array): string {
  return digest.length === 0
    ? ''
    : Array.from(digest, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/**
 * SHA-256 of raw bytes through Web Crypto.
 *
 * Asynchronous because the platform digest is; the formatting above stays pure
 * so a digest obtained in a check script can be compared with a known value.
 */
export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前环境不支持 Web Crypto，无法计算指纹');
  const digest = await subtle.digest('SHA-256', toArrayBuffer(bytes));
  return new Uint8Array(digest);
}

/**
 * Rejects a modulus length that must not be generated.
 *
 * Returns null when the value is acceptable. 1024 is called out by name so the
 * caller can show the reason instead of a generic "not in the list" message.
 */
export function validateModulusLength(value: number): string | null {
  if (!Number.isInteger(value)) {
    return `密钥长度必须是整数位数，收到 ${value}`;
  }
  if (value === REJECTED_MODULUS_LENGTH) {
    return `1024 位已不安全（安全强度仅约 80 位，NIST 自 2014 年起不再允许），本工具不提供`;
  }
  if (!ALLOWED_MODULUS_LENGTHS.includes(value)) {
    return `密钥长度只支持 ${ALLOWED_MODULUS_LENGTHS.join(' / ')} 位，收到 ${value}`;
  }
  return null;
}

/** Usages accepted by Web Crypto for the selected scheme. */
function keyUsagesFor(algorithm: RsaAlgorithm): KeyUsage[] {
  return algorithm === 'RSA-OAEP' ? ['encrypt', 'decrypt'] : ['sign', 'verify'];
}

/**
 * Generates a key pair and derives every exported form from it.
 *
 * The heavy, non-deterministic part is the platform's `generateKey`; everything
 * after it is the pure code above, so there is exactly one place where the
 * result depends on the environment. The key handles are returned alongside the
 * text forms so a caller can immediately prove the pair works by signing or
 * encrypting with it.
 */
export async function generateRsaKeyPair(
  request: RsaKeyPairRequest,
): Promise<RsaKeyPairOutcome> {
  const invalid = validateModulusLength(request.modulusLength);
  if (invalid) return { ok: false, error: invalid };

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return { ok: false, error: '当前环境不支持 Web Crypto，无法生成密钥' };
  }

  try {
    const pair = await subtle.generateKey(
      {
        name: request.algorithm,
        modulusLength: request.modulusLength,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: request.hash,
      },
      // Extractable, because exporting the PEM and JWK forms is the whole point.
      true,
      keyUsagesFor(request.algorithm),
    );

    const publicDer = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
    const privateDer = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));

    const publicComponents = parseRsaPublicKeyDer(publicDer);
    const privateComponents = parseRsaPrivateKeyDer(privateDer);
    if (!publicComponents || !privateComponents) {
      return { ok: false, error: '导出的 DER 无法解析，已放弃这次结果' };
    }

    const digest = await sha256Bytes(publicDer);

    return {
      ok: true,
      result: {
        modulusLength: request.modulusLength,
        algorithm: request.algorithm,
        hash: request.hash,
        jwa: jwaAlgorithm(request.algorithm, request.hash),
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        publicDer,
        privateDer,
        publicPem: encodePem('PUBLIC KEY', publicDer),
        privatePem: encodePem('PRIVATE KEY', privateDer),
        publicJwk: assemblePublicJwk(publicComponents, request.algorithm, request.hash),
        privateJwk: assemblePrivateJwk(privateComponents, request.algorithm, request.hash),
        fingerprintHex: formatFingerprintHex(digest),
        fingerprintColon: formatFingerprintColon(digest),
        modulusBits: modulusBitLength(publicComponents.n),
        publicExponent: bytesToDecimalString(publicComponents.e),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '密钥生成失败',
    };
  }
}
