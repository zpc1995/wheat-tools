/**
 * AES encryption/decryption for the browser.
 *
 * Two decisions matter more than the code:
 *
 * 1. **The password is never the key.** A passphrase is stretched with PBKDF2
 *    (SHA-256, 210k iterations, random 16-byte salt) before use. Using a typed
 *    password directly as an AES key is the single most common mistake here, and
 *    it makes the key searchable trivially.
 * 2. **The ciphertext is self-describing.** The output envelope records the
 *    algorithm, KDF, iteration count, salt and IV. Without those values the data
 *    is undecryptable, and users reliably lose track of them when they are not
 *    embedded. A bare-base64 mode is available but says plainly what it drops.
 *
 * Authenticity is handled by GCM, which is the default. CBC provides no
 * integrity, so tampering is undetectable; the UI states that rather than
 * implying equivalence.
 */

export type CipherAlgorithm = 'AES-GCM' | 'AES-CBC';

/** Iteration count for PBKDF2. High enough to make guessing expensive. */
export const PBKDF2_ITERATIONS = 210_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export interface EncryptOptions {
  password: string;
  algorithm: CipherAlgorithm;
  iterations?: number;
}

export interface Envelope {
  v: 1;
  /** Algorithm name as used by Web Crypto. */
  alg: CipherAlgorithm;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iter: number;
  /** Base64 salt. */
  salt: string;
  /** Base64 initialisation vector. */
  iv: string;
  /** Base64 ciphertext (includes the GCM tag for GCM). */
  data: string;
}

export type EncryptResult =
  | { ok: true; envelope: Envelope; text: string }
  | { ok: false; error: string };

export type DecryptResult =
  | { ok: true; plaintext: string; envelope: Envelope }
  | { ok: false; error: string };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function requireSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 Web Crypto（通常需要 HTTPS 或 localhost）');
  }
  return globalThis.crypto.subtle;
}

/**
 * Derives an AES key from a passphrase.
 *
 * PBKDF2-HMAC-SHA256 with a per-message random salt, so the same password
 * produces a different key for every message and identical plaintexts do not
 * produce identical ciphertexts.
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  algorithm: CipherAlgorithm,
): Promise<CryptoKey> {
  const subtle = requireSubtle();

  const material = await subtle.importKey(
    'raw',
    toBuffer(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: algorithm, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts UTF-8 text and returns a self-describing envelope. */
export async function encrypt(
  plaintext: string,
  options: EncryptOptions,
): Promise<EncryptResult> {
  if (!options.password) {
    return { ok: false, error: '请输入口令' };
  }
  if (!plaintext) {
    return { ok: false, error: '请输入要加密的内容' };
  }

  const iterations = options.iterations ?? PBKDF2_ITERATIONS;

  try {
    const subtle = requireSubtle();
    const salt = randomBytes(SALT_BYTES);
    // A fresh IV per message is mandatory for GCM: reusing an IV under the same
    // key destroys both confidentiality and authenticity.
    const iv = randomBytes(options.algorithm === 'AES-GCM' ? IV_BYTES : 16);
    const key = await deriveKey(options.password, salt, iterations, options.algorithm);

    const ciphertext = await subtle.encrypt(
      // `tagLength: 128` is the GCM authentication tag; omitting it would
      // silently produce a weaker tag.
      options.algorithm === 'AES-GCM'
        ? { name: options.algorithm, iv: toBuffer(iv), tagLength: 128 }
        : { name: options.algorithm, iv: toBuffer(iv) },
      key,
      toBuffer(new TextEncoder().encode(plaintext)),
    );

    const envelope: Envelope = {
      v: 1,
      alg: options.algorithm,
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iter: iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(ciphertext)),
    };

    return { ok: true, envelope, text: formatEnvelope(envelope) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '加密失败',
    };
  }
}

/** Encrypts raw bytes (used for files) and returns the envelope. */
export async function encryptBytes(
  bytes: Uint8Array,
  options: EncryptOptions,
): Promise<EncryptResult> {
  if (!options.password) return { ok: false, error: '请输入口令' };
  if (bytes.length === 0) return { ok: false, error: '文件为空' };

  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  try {
    const subtle = requireSubtle();
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(options.algorithm === 'AES-GCM' ? IV_BYTES : 16);
    const key = await deriveKey(options.password, salt, iterations, options.algorithm);

    const ciphertext = await subtle.encrypt(
      options.algorithm === 'AES-GCM'
        ? { name: options.algorithm, iv: toBuffer(iv), tagLength: 128 }
        : { name: options.algorithm, iv: toBuffer(iv) },
      key,
      toBuffer(bytes),
    );

    const envelope: Envelope = {
      v: 1,
      alg: options.algorithm,
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iter: iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(ciphertext)),
    };
    return { ok: true, envelope, text: formatEnvelope(envelope) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '加密失败' };
  }
}

/** Decrypts an envelope back to text. */
export async function decrypt(
  source: string,
  password: string,
): Promise<DecryptResult> {
  if (!password) return { ok: false, error: '请输入口令' };

  const parsed = parseEnvelope(source);
  if (!parsed.ok) return parsed;

  const envelope = parsed.envelope;

  try {
    const subtle = requireSubtle();
    const key = await deriveKey(
      password,
      fromBase64(envelope.salt),
      envelope.iter,
      envelope.alg,
    );

    const plaintext = await subtle.decrypt(
      envelope.alg === 'AES-GCM'
        ? { name: envelope.alg, iv: toBuffer(fromBase64(envelope.iv)), tagLength: 128 }
        : { name: envelope.alg, iv: toBuffer(fromBase64(envelope.iv)) },
      key,
      toBuffer(fromBase64(envelope.data)),
    );

    return {
      ok: true,
      plaintext: new TextDecoder('utf-8', { fatal: false }).decode(plaintext),
      envelope,
    };
  } catch (error) {
    // GCM reports a failed authentication tag as an OperationError. That is the
    // common case for a wrong password, so say both possibilities.
    const name = error instanceof Error ? error.name : '';
    if (name === 'OperationError') {
      return {
        ok: false,
        error:
          envelope.alg === 'AES-GCM'
            ? '解密失败：口令不正确，或密文已被改动（GCM 校验未通过）'
            : '解密失败：口令不正确，或密文已被改动（CBC 无法校验完整性，请确认数据完整）',
        };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : '解密失败',
    };
  }
}

/** Decrypts to raw bytes (used for files). */
export async function decryptBytes(
  source: string,
  password: string,
): Promise<{ ok: true; bytes: Uint8Array; envelope: Envelope } | { ok: false; error: string }> {
  const result = await decryptRaw(source, password);
  return result;
}

async function decryptRaw(
  source: string,
  password: string,
): Promise<{ ok: true; bytes: Uint8Array; envelope: Envelope } | { ok: false; error: string }> {
  if (!password) return { ok: false, error: '请输入口令' };

  const parsed = parseEnvelope(source);
  if (!parsed.ok) return parsed;
  const envelope = parsed.envelope;

  try {
    const subtle = requireSubtle();
    const key = await deriveKey(
      password,
      fromBase64(envelope.salt),
      envelope.iter,
      envelope.alg,
    );

    const plaintext = await subtle.decrypt(
      envelope.alg === 'AES-GCM'
        ? { name: envelope.alg, iv: toBuffer(fromBase64(envelope.iv)), tagLength: 128 }
        : { name: envelope.alg, iv: toBuffer(fromBase64(envelope.iv)) },
      key,
      toBuffer(fromBase64(envelope.data)),
    );

    return { ok: true, bytes: new Uint8Array(plaintext), envelope };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      ok: false,
      error:
        name === 'OperationError'
          ? '解密失败：口令不正确，或密文已被改动'
          : error instanceof Error
            ? error.message
            : '解密失败',
    };
  }
}

/** Serialises an envelope as JSON with a recognisable prefix. */
export function formatEnvelope(envelope: Envelope): string {
  return `WTENC1:${JSON.stringify(envelope)}`;
}

/**
 * Parses either the prefixed envelope or a bare JSON object, reporting what is
 * missing rather than throwing.
 */
export function parseEnvelope(
  source: string,
): { ok: true; envelope: Envelope } | { ok: false; error: string } {
  const text = source.trim();
  if (!text) return { ok: false, error: '请输入密文' };

  const payload = text.startsWith('WTENC1:') ? text.slice('WTENC1:'.length) : text;

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return {
      ok: false,
      error:
        '密文格式无法识别。请粘贴完整信封（以 WTENC1: 开头），或直接粘贴带 salt/iv/data 的 JSON',
    };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, error: '密文内容不是对象' };
  }

  const record = data as Record<string, unknown>;
  const missing = (['salt', 'iv', 'data'] as const).filter(
    (key) => typeof record[key] !== 'string' || !(record[key] as string),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `密文缺少必要字段：${missing.join('、')}。若只粘贴了 Base64 数据，还需提供 salt 与 iv`,
    };
  }

  const alg = record.alg === 'AES-CBC' ? 'AES-CBC' : 'AES-GCM';
  const iter =
    typeof record.iter === 'number' && record.iter > 0
      ? Math.floor(record.iter)
      : PBKDF2_ITERATIONS;

  return {
    ok: true,
    envelope: {
      v: 1,
      alg,
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iter,
      salt: record.salt as string,
      iv: record.iv as string,
      data: record.data as string,
    },
  };
}

/** Base64 of the ciphertext only — the metadata-free form. */
export function extractBareCiphertext(envelope: Envelope): string {
  return envelope.data;
}

/** Human-readable summary of an envelope, for the "what am I looking at" panel. */
export function describeEnvelope(envelope: Envelope): Array<[string, string]> {
  return [
    ['算法', envelope.alg],
    ['密钥派生', `${envelope.kdf} / ${envelope.hash}`],
    ['迭代次数', envelope.iter.toLocaleString()],
    ['盐（Base64）', envelope.salt],
    ['IV（Base64）', envelope.iv],
    ['密文长度', `${fromBase64(envelope.data).length} 字节`],
    [
      '完整性',
      envelope.alg === 'AES-GCM'
        ? 'GCM 认证标签（可检测篡改）'
        : 'CBC 无完整性校验（无法检测篡改）',
    ],
  ];
}
