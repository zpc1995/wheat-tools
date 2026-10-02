/**
 * One-time password arithmetic: HOTP (RFC 4226), TOTP (RFC 6238), the dynamic
 * truncation in between, and the `otpauth` provisioning URI.
 *
 * ## Why nothing here reads a clock
 *
 * Every time-dependent entry point takes the timestamp as an argument. A TOTP
 * function that calls `Date.now()` internally can only be verified by waiting
 * for the wall clock to roll into the next step, which in practice means it is
 * never verified at all — and the RFC publishes a fixed table of time/code
 * pairs that this code must reproduce byte for byte. Passing the time in makes
 * that table directly assertable.
 *
 * Nothing here is random either: HOTP and TOTP are deterministic functions of
 * (secret, counter), so there is no nonce to stub out.
 *
 * ## Why the HMAC is delegated to Web Crypto
 *
 * HMAC has its own set of well-known ways to go wrong (hashing a short key
 * before use, for instance). The platform implementation is already exercised
 * against the RFC 4231 vectors by the HMAC tool, and the check script here
 * re-derives every digest with `node:crypto` as a second opinion. What this
 * module owns — and therefore what the checks focus on — is the truncation, the
 * counter encoding and the Base32 decoder.
 *
 * The secret is sensitive and is never stored, logged or transmitted: it only
 * ever exists in a React state variable for the lifetime of the page.
 */

/** Hash functions that RFC 6238 permits for the HMAC step. */
export type OtpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

/**
 * Display order for the picker. SHA-1 is first because it is what the
 * `otpauth` URI format defaults to and what authenticator apps interoperate
 * with; the SHA-2 options are shown after it.
 */
export const OTP_ALGORITHMS: readonly OtpAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-512'];

/**
 * Digit counts this tool accepts.
 *
 * RFC 4226 requires support for 6 and permits 7 and 8. 7 is left out on
 * purpose: the `otpauth` URI format and every authenticator app in wide use
 * only understand 6 and 8, so offering 7 would produce a code no server can be
 * provisioned for. Accepting an unsupported digit count silently is worse than
 * refusing it.
 */
export const OTP_DIGITS: readonly number[] = [6, 8];

/** RFC 6238's recommended time step. */
export const DEFAULT_PERIOD_SECONDS = 30;

/** Accepted range for the time step, in seconds. */
export const MIN_PERIOD_SECONDS = 1;
export const MAX_PERIOD_SECONDS = 86_400;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Base32 lengths that cannot occur, as remainders of the encoded length mod 8.
 *
 * Five bits per character means the encoded length groups into 8 characters per
 * 5 bytes; the only meaningful remainders are 0, 2, 4, 5 and 7. A length of the
 * form 8n+1, 8n+3 or 8n+6 would need a partial character that does not exist —
 * `decodeBase32` rejects them rather than inventing bits, because a secret with
 * a mistyped character removed would otherwise decode to a plausible, wrong key
 * and every code derived from it would be wrong with no visible cause.
 */
const INVALID_LENGTH_REMAINDERS = new Set([1, 3, 6]);

export interface Base32Result {
  ok: boolean;
  bytes: Uint8Array;
  /** Uppercase, whitespace-free, padding-free form of the input. */
  normalized: string;
  error: string;
}

export interface OtpTrace {
  /** The moving factor, as passed in (or derived from the time for TOTP). */
  counter: number;
  /** The counter as the 8 bytes that are actually hashed, hex encoded. */
  counterHex: string;
  /** Raw HMAC output. */
  digest: Uint8Array;
  digestHex: string;
  /** Dynamic truncation offset: the low nibble of the last digest byte. */
  offset: number;
  /** The 31-bit dynamic binary code, after masking the top bit away. */
  binary: number;
  /** Zero-padded decimal code. */
  code: string;
}

export type OtpOutcome =
  | { ok: true; trace: OtpTrace }
  | { ok: false; error: string };

export interface TotpState {
  algorithm: OtpAlgorithm;
  digits: number;
  periodSeconds: number;
  code: string;
  /** Number of whole time steps between the Unix epoch and `timeMs`. */
  counter: number;
  /** Milliseconds already elapsed inside the current step. */
  elapsedMs: number;
  /**
   * Whole seconds left before the code expires, in [1, period].
   *
   * Counted down rather than rounded: at 29.5 s into a 30 s step the honest
   * answer is "1 second left", because the code really does stop working when
   * that second elapses.
   */
  secondsRemaining: number;
  /**
   * Share of the step still remaining, in (0, 1]. Drives the progress ring.
   *
   * Never reaches 0: the ring is drawn from this value, and a 0 would render as
   * a full circle of empty track one instant before the code changes, which
   * reads as a stalled timer.
   */
  remainingFraction: number;
  /** Epoch milliseconds at which the current code stops being valid. */
  expiresAtMs: number;
  /** The next step's counter and the code it will show, for early preparation. */
  nextCounter: number;
  nextCode: string;
  trace: OtpTrace;
}

export type TotpOutcome =
  | { ok: true; state: TotpState }
  | { ok: false; error: string };

/** Lowercase hex of raw bytes. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Normalises a Base32 secret without decoding it.
 *
 * Whitespace is removed because authenticator apps display secrets in groups
 * (`JBSW Y3DP EHPK 3PXP`) and that grouped form is what gets pasted; a hyphen is
 * removed for the same reason since some provisioning emails use it. The
 * trailing `=` padding is stripped, and the result is uppercased — RFC 4648
 * defines the alphabet in uppercase, while lower case is common in hand-typed
 * secrets and carries no different meaning.
 */
export function normalizeBase32(text: string): string {
  return text
    .replace(/[\s-]+/g, '')
    .replace(/=+$/, '')
    .toUpperCase();
}

/**
 * Decodes RFC 4648 Base32, which is the encoding every `otpauth` secret uses.
 *
 * Rejects characters outside the alphabet instead of guessing at confusable
 * ones. `0`, `1`, `8` and `9` are the interesting cases: they are absent from
 * the alphabet precisely because they look like `O`, `I`, `B` and `g`, and
 * "helpfully" mapping them back would turn a typo into a valid-looking secret
 * whose every generated code is wrong.
 */
export function decodeBase32(text: string): Base32Result {
  const normalized = normalizeBase32(text);

  if (normalized.length === 0) {
    return { ok: true, bytes: new Uint8Array(0), normalized, error: '' };
  }

  const remainder = normalized.length % 8;
  if (INVALID_LENGTH_REMAINDERS.has(remainder)) {
    return {
      ok: false,
      bytes: new Uint8Array(0),
      normalized,
      error: `Base32 长度 ${normalized.length} 不合法（除以 8 余 ${remainder}），该长度无法由完整的字符拼出字节`,
    };
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      return {
        ok: false,
        bytes: new Uint8Array(0),
        normalized,
        error: `密钥含有非 Base32 字符「${character}」（RFC 4648 字母表为 A-Z 与 2-7）`,
      };
    }
    // `bits` is always below 8 here, so the accumulator never holds more than
    // 12 significant bits and the shifts stay exact.
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }

  // Any leftover bits are discarded. A canonical encoder leaves them zero, but
  // requiring that would reject real-world secrets whose final character was
  // chosen without the padding convention in mind, and the dropped bits cannot
  // change any of the bytes that are kept.
  return { ok: true, bytes: new Uint8Array(bytes), normalized, error: '' };
}

/**
 * Encodes bytes as Base32. Exported for the check script and for round-trip
 * assertions; the tool itself never needs to produce a secret.
 */
export function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

export function isOtpAlgorithm(value: unknown): value is OtpAlgorithm {
  return value === 'SHA-1' || value === 'SHA-256' || value === 'SHA-512';
}

export function isOtpDigits(value: number): boolean {
  return OTP_DIGITS.includes(value);
}

/**
 * The moving factor as the 8 bytes that go into the HMAC.
 *
 * RFC 4226 section 5.2: "The Key (K), the Counter (C), and Data values are
 * hashed high-order byte first." A little-endian encoding is the classic
 * mistake here — it happens to agree for counter 0 and then diverges for every
 * other counter, so it survives a smoke test.
 *
 * `BigInt` is used for the shifting rather than the `>>> 8` dance on a Number,
 * because `>>>` coerces to 32 bits and a counter above 2^32 would be silently
 * truncated there. The caller has already checked that the counter is a safe
 * non-negative integer, which fits in these 8 bytes.
 */
export function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/** The counter as the 16 hex characters the RFC tables print. */
export function counterToHex(counter: number): string {
  return bytesToHex(counterToBytes(counter));
}

/**
 * Dynamic truncation, RFC 4226 section 5.3.
 *
 * The offset comes from the low nibble of the **last** digest byte, not from
 * byte 19. The RFC's reference code spells it `hmac_result[19] & 0xf`, which is
 * correct only for the 20-byte SHA-1 digest it was written for; a port that
 * keeps the literal 19 produces valid-looking codes that disagree with RFC 6238
 * for SHA-256 and SHA-512. The check script pins both forms against the
 * published vectors.
 *
 * The leading byte is masked with 0x7f so the 4 bytes form a 31-bit unsigned
 * integer. Without that mask the top bit makes the value negative in a language
 * with signed 32-bit ints (and in JavaScript, where the shift operators are
 * signed), and the modulo result changes sign — a code that is not merely
 * different but sometimes negative.
 */
export function dynamicTruncate(
  digest: Uint8Array,
  digits: number,
): { offset: number; binary: number; code: string } {
  // Offset can be at most 15, so four bytes starting there need index 18.
  if (digest.length < 19) {
    throw new Error(`摘要只有 ${digest.length} 字节，不足以做动态截断`);
  }

  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const modulus = 10 ** digits;
  return { offset, binary, code: String(binary % modulus).padStart(digits, '0') };
}

/**
 * Copies into a fresh ArrayBuffer-backed view.
 *
 * TypeScript 5.7+ types `Uint8Array` as `Uint8Array<ArrayBufferLike>`, which
 * Web Crypto's `BufferSource` rejects because it could be a SharedArrayBuffer.
 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

/**
 * Replaces a zero-length key with a single zero byte.
 *
 * Web Crypto rejects an empty HMAC key outright (`DataError: Zero-length key is
 * not supported`) even though RFC 2104 defines it. Substituting one 0x00 byte
 * gives the identical HMAC, because the key is zero-padded to the block size
 * either way. `generateHotp` refuses an empty secret before reaching here; this
 * exists so the low-level primitive stays total and the difference between "no
 * key" and "an error from the platform" never leaks into a code path.
 */
function keyForWebCrypto(key: Uint8Array): Uint8Array {
  return key.length === 0 ? new Uint8Array(1) : key;
}

/** Raw HMAC over bytes, via the platform's Web Crypto implementation. */
export async function hmacDigest(
  algorithm: OtpAlgorithm,
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('当前环境不支持 Web Crypto，无法计算 OTP');
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

/**
 * The full HOTP computation, with every intermediate value kept.
 *
 * Returning the digest, offset and 31-bit value rather than just the six digits
 * is deliberate: those are the values RFC 4226 Appendix D prints, so a failure
 * can be located at the step that is actually wrong instead of being reported as
 * one opaque mismatch at the end.
 *
 * This is the unvalidated primitive. It assumes `counter` is a non-negative
 * safe integer and `digits` is 6 or 8, both of which `generateHotp` checks; it
 * is exported so the check script can read the intermediates directly.
 */
export async function hotpTrace(
  secret: Uint8Array,
  counter: number,
  algorithm: OtpAlgorithm,
  digits: number,
): Promise<OtpTrace> {
  const message = counterToBytes(counter);
  const digest = await hmacDigest(algorithm, secret, message);
  const { offset, binary, code } = dynamicTruncate(digest, digits);
  return {
    counter,
    counterHex: bytesToHex(message),
    digest,
    digestHex: bytesToHex(digest),
    offset,
    binary,
    code,
  };
}

function validateSecret(secret: Uint8Array): string {
  return secret.length === 0
    ? '密钥为空：Base32 解码后没有任何字节，无法生成验证码'
    : '';
}

function validateDigits(digits: number): string {
  return isOtpDigits(digits) ? '' : `位数只支持 6 或 8，收到 ${digits}`;
}

function validateCounter(counter: number): string {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    return `计数器必须是不超过 2^53-1 的非负整数，收到 ${counter}`;
  }
  return '';
}

function validatePeriod(periodSeconds: number): string {
  if (!Number.isInteger(periodSeconds)) {
    return `周期必须是整数秒，收到 ${periodSeconds}`;
  }
  if (periodSeconds < MIN_PERIOD_SECONDS || periodSeconds > MAX_PERIOD_SECONDS) {
    return `周期必须在 ${MIN_PERIOD_SECONDS} 到 ${MAX_PERIOD_SECONDS} 秒之间，收到 ${periodSeconds}`;
  }
  return '';
}

/** RFC 4226 HOTP over raw secret bytes, with all inputs validated. */
export async function generateHotp(
  secret: Uint8Array,
  counter: number,
  algorithm: OtpAlgorithm,
  digits: number,
): Promise<OtpOutcome> {
  const problem =
    validateSecret(secret) || validateDigits(digits) || validateCounter(counter) ||
    (isOtpAlgorithm(algorithm) ? '' : `不支持的算法 ${String(algorithm)}`);
  if (problem) return { ok: false, error: problem };

  return { ok: true, trace: await hotpTrace(secret, counter, algorithm, digits) };
}

/**
 * The number of whole time steps between the Unix epoch and `timeMs`.
 *
 * Dividing the milliseconds by the step in milliseconds — rather than dividing
 * seconds by the period — keeps the boundary exact and avoids a division by
 * 1000 that would introduce a rounding step. Flooring is what RFC 6238
 * specifies: 59.999 s is still step 1 for a 30 s period, not step 2.
 */
export function timeStepCounter(timeMs: number, periodSeconds: number): number {
  return Math.floor(timeMs / (periodSeconds * 1000));
}

/** Milliseconds elapsed inside the current step, in [0, periodMs). */
export function timeStepElapsedMs(timeMs: number, periodSeconds: number): number {
  return timeMs % (periodSeconds * 1000);
}

/**
 * RFC 6238 TOTP, plus the countdown the display needs.
 *
 * `timeMs` is required to be a non-negative finite number. Negative time is
 * rejected rather than clamped: the counter would have to go negative, and an
 * 8-byte counter is unsigned, so clamping would quietly answer a different
 * question than the one asked.
 */
export async function generateTotp(
  secret: Uint8Array,
  timeMs: number,
  algorithm: OtpAlgorithm,
  digits: number,
  periodSeconds: number = DEFAULT_PERIOD_SECONDS,
): Promise<TotpOutcome> {
  const problem =
    validateSecret(secret) || validateDigits(digits) || validatePeriod(periodSeconds) ||
    (isOtpAlgorithm(algorithm) ? '' : `不支持的算法 ${String(algorithm)}`);
  if (problem) return { ok: false, error: problem };

  if (!Number.isFinite(timeMs) || timeMs < 0) {
    return { ok: false, error: `时间必须是大于等于 0 的毫秒时间戳，收到 ${timeMs}` };
  }

  const counter = timeStepCounter(timeMs, periodSeconds);
  if (!Number.isSafeInteger(counter)) {
    return { ok: false, error: `时间 ${timeMs} 换算出的计数器超出安全整数范围` };
  }

  const periodMs = periodSeconds * 1000;
  const elapsedMs = timeStepElapsedMs(timeMs, periodSeconds);
  const trace = await hotpTrace(secret, counter, algorithm, digits);
  const nextTrace = await hotpTrace(secret, counter + 1, algorithm, digits);

  return {
    ok: true,
    state: {
      algorithm,
      digits,
      periodSeconds,
      code: trace.code,
      counter,
      elapsedMs,
      secondsRemaining: periodSeconds - Math.floor(elapsedMs / 1000),
      remainingFraction: (periodMs - elapsedMs) / periodMs,
      expiresAtMs: timeMs - elapsedMs + periodMs,
      nextCounter: counter + 1,
      nextCode: nextTrace.code,
      trace,
    },
  };
}

/**
 * Groups a code for reading aloud: six digits as `123 456`, eight as
 * `1234 5678`. The unspaced form is what gets copied and what a server expects,
 * so the grouping is presentation only.
 */
export function formatCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

/** Countdown text, padded so the line does not jitter as it crosses ten. */
export function formatSecondsRemaining(seconds: number): string {
  return `${String(seconds).padStart(2, '0')} 秒`;
}

export interface OtpAuthConfig {
  type: 'totp' | 'hotp';
  /** Normalised Base32 secret, exactly as it should be shown back to the user. */
  secret: string;
  /** Secret length in bytes after decoding. */
  secretBytes: number;
  /** Percent-decoded label from the URI path, without the issuer prefix. */
  label: string;
  /** Issuer from the `issuer` parameter or from the `Issuer:account` prefix. */
  issuer: string;
  algorithm: OtpAlgorithm;
  digits: number;
  periodSeconds: number;
  /** HOTP only; 0 for a TOTP URI. */
  counter: number;
  /** Parameters that were present but carry no meaning for us. */
  ignoredParams: string[];
  warnings: string[];
}

export type OtpAuthOutcome =
  | { ok: true; config: OtpAuthConfig }
  | { ok: false; error: string };

const KNOWN_PARAMS = new Set([
  'secret',
  'issuer',
  'algorithm',
  'digits',
  'period',
  'counter',
]);

/**
 * Parses an `otpauth` provisioning URI (the Google Authenticator key URI
 * format).
 *
 * Parameter names are matched case-insensitively. The format spells them in
 * lower case, and that is what this tool treats as canonical, but real
 * generators in the wild emit `Secret=` and `Period=` often enough that
 * rejecting them would look like a bug on this side. Parameter *values* are
 * where case carries meaning, and they are normalised explicitly: `algorithm`
 * is accepted as `SHA1`, `SHA-1` or `sha1`, because the format says `SHA1` while
 * hand-written URIs tend to copy the hyphenated RFC spelling.
 *
 * An explicitly supplied value that cannot be honoured is an error rather than a
 * silent fallback to the default. Falling back to SHA-1 for an unrecognised
 * `algorithm` would produce a code that looks completely normal and is wrong.
 */
export function parseOtpAuthUri(uri: string): OtpAuthOutcome {
  const trimmed = uri.trim();
  if (!trimmed) return { ok: false, error: '请粘贴 otpauth:// 开头的 URI' };
  if (!/^otpauth:/i.test(trimmed)) {
    return {
      ok: false,
      error: '只识别 otpauth:// 开头的 URI（Google Authenticator 的密钥 URI 格式）',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'URI 无法解析，请检查是否被截断或含有空格' };
  }

  // The host is lower-cased explicitly: `otpauth` is not a special scheme, so
  // the URL parser keeps an opaque host exactly as written.
  const type = parsed.host.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') {
    return {
      ok: false,
      error: `URI 类型是「${parsed.host || '空'}」，只支持 totp 与 hotp`,
    };
  }

  // `searchParams` decodes percent escapes and treats `+` as a space, which is
  // the query-string convention the format is defined in.
  const byLowerName = new Map<string, string>();
  for (const [name, value] of parsed.searchParams) {
    const lower = name.toLowerCase();
    // First occurrence wins, matching how every mainstream parser treats a
    // repeated query parameter.
    if (!byLowerName.has(lower)) byLowerName.set(lower, value);
  }

  const ignoredParams: string[] = [];
  for (const [name] of parsed.searchParams) {
    if (!KNOWN_PARAMS.has(name.toLowerCase())) ignoredParams.push(name);
  }

  const rawSecret = byLowerName.get('secret');
  if (rawSecret === undefined) {
    return { ok: false, error: 'URI 缺少 secret 参数，没有密钥就无法生成验证码' };
  }
  const decoded = decodeBase32(rawSecret);
  if (!decoded.ok) return { ok: false, error: `secret 参数无法解码：${decoded.error}` };
  if (decoded.bytes.length === 0) {
    return { ok: false, error: 'secret 参数是空的 Base32 字符串' };
  }

  const warnings: string[] = [];

  const rawAlgorithm = byLowerName.get('algorithm');
  let algorithm: OtpAlgorithm = 'SHA-1';
  if (rawAlgorithm !== undefined && rawAlgorithm.trim() !== '') {
    const compact = rawAlgorithm.trim().toUpperCase().replace(/-/g, '');
    if (compact === 'SHA1') algorithm = 'SHA-1';
    else if (compact === 'SHA256') algorithm = 'SHA-256';
    else if (compact === 'SHA512') algorithm = 'SHA-512';
    else {
      return {
        ok: false,
        error: `algorithm 参数是「${rawAlgorithm}」，只支持 SHA1 / SHA256 / SHA512`,
      };
    }
  }

  const rawDigits = byLowerName.get('digits');
  let digits = 6;
  if (rawDigits !== undefined && rawDigits.trim() !== '') {
    if (!/^\d+$/.test(rawDigits.trim())) {
      return { ok: false, error: `digits 参数「${rawDigits}」不是十进制数字` };
    }
    digits = Number(rawDigits.trim());
    if (!isOtpDigits(digits)) {
      return { ok: false, error: `digits 参数是 ${digits}，只支持 6 或 8` };
    }
  }

  let period = DEFAULT_PERIOD_SECONDS;
  const rawPeriod = byLowerName.get('period');
  if (rawPeriod !== undefined && rawPeriod.trim() !== '') {
    if (!/^\d+$/.test(rawPeriod.trim())) {
      return { ok: false, error: `period 参数「${rawPeriod}」不是十进制秒数` };
    }
    period = Number(rawPeriod.trim());
    const periodProblem = validatePeriod(period);
    if (periodProblem) return { ok: false, error: `period 参数：${periodProblem}` };
  }

  let counter = 0;
  const rawCounter = byLowerName.get('counter');
  if (type === 'hotp') {
    if (rawCounter !== undefined && rawCounter.trim() !== '') {
      if (!/^\d+$/.test(rawCounter.trim())) {
        return { ok: false, error: `counter 参数「${rawCounter}」不是十进制整数` };
      }
      counter = Number(rawCounter.trim());
      const counterProblem = validateCounter(counter);
      if (counterProblem) return { ok: false, error: `counter 参数：${counterProblem}` };
    }
  } else if (rawCounter !== undefined) {
    warnings.push('TOTP 的 URI 里出现了 counter 参数，已忽略');
  }

  let label = '';
  try {
    label = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    return { ok: false, error: 'URI 路径中的百分号编码不合法' };
  }

  let issuer = (byLowerName.get('issuer') ?? '').trim();
  // The format also allows the issuer as the label prefix, `Issuer:account`.
  // The parameter wins when both are present, which is what the spec says.
  const separator = label.indexOf(':');
  if (separator >= 0) {
    const prefix = label.slice(0, separator).trim();
    label = label.slice(separator + 1).trim();
    if (!issuer && prefix) issuer = prefix;
  }

  if (type === 'totp' && (algorithm !== 'SHA-1' || digits !== 6 || period !== 30)) {
    warnings.push(
      '这不是默认参数组合（Google Authenticator 只支持 SHA-1 / 6 位 / 30 秒），' +
        '部分验证器 App 可能按默认参数显示，导致与本工具的验证码不一致',
    );
  }
  if (decoded.normalized !== rawSecret) {
    warnings.push('密钥已规范化（转为大写并去掉空格与填充符）');
  }

  return {
    ok: true,
    config: {
      type,
      secret: decoded.normalized,
      secretBytes: decoded.bytes.length,
      label,
      issuer,
      algorithm,
      digits,
      periodSeconds: period,
      counter,
      ignoredParams: [...new Set(ignoredParams)],
      warnings: [...new Set(warnings)],
    },
  };
}
