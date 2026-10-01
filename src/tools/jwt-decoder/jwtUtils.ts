/**
 * JWT decoding.
 *
 * **This only decodes; it never verifies.** A JWT payload is base64url, not
 * encrypted, so anyone can read and alter it. Verifying a signature requires the
 * secret/public key and, more importantly, must happen on a server that can be
 * trusted with that key — a browser tool cannot make a token trustworthy. The
 * UI states this prominently because "it decoded fine" is easily mistaken for
 * "it is valid".
 *
 * Base64url differs from plain base64 in the `-`/`_` alphabet and in omitting
 * padding; both are normalised here before decoding.
 */

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  /** The original compact string. */
  raw: string;
}

export type JwtResult =
  | { ok: true; parts: JwtParts }
  | { ok: false; error: string };

/** Decodes base64url to a UTF-8 string. */
export function base64UrlDecode(input: string): string {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    '=',
  );

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  // `fatal: false` so a malformed segment shows replacement characters instead
  // of throwing; the JSON parse afterwards is the real check.
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodeJsonSegment(segment: string, label: string): Record<string, unknown> {
  const text = base64UrlDecode(segment);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} 不是合法 JSON（解码后为：${text.slice(0, 80)}）`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 应为一个 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

/** Splits and decodes a compact JWS/JWT string. */
export function decodeJwt(token: string): JwtResult {
  const compact = token.trim();
  if (!compact) return { ok: false, error: '请粘贴 JWT' };

  const parts = compact.split('.');
  if (parts.length === 5) {
    return {
      ok: false,
      error: '这是 JWE（5 段，加密令牌），本工具只支持 JWS（3 段，签名令牌）的解码',
    };
  }
  if (parts.length !== 3) {
    return {
      ok: false,
      error: `JWT 应由 3 段组成（header.payload.signature），当前为 ${parts.length} 段`,
    };
  }

  try {
    const header = decodeJsonSegment(parts[0], 'Header');
    const payload = decodeJsonSegment(parts[1], 'Payload');
    return {
      ok: true,
      parts: { header, payload, signature: parts[2], raw: compact },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '解码失败',
    };
  }
}

export interface TimeClaim {
  name: string;
  value: number;
  iso: string;
  relative: string;
  state: 'past' | 'future';
}

const TIME_CLAIMS: Array<{ key: string; label: string }> = [
  { key: 'exp', label: 'exp 过期时间' },
  { key: 'iat', label: 'iat 签发时间' },
  { key: 'nbf', label: 'nbf 生效时间' },
  { key: 'auth_time', label: 'auth_time 认证时间' },
];

/** Formats a relative distance in Chinese. */
function relativeToNow(timestampMs: number, now: number): string {
  const diff = timestampMs - now;
  const abs = Math.abs(diff);
  const units: Array<[string, number]> = [
    ['天', 86_400_000],
    ['小时', 3_600_000],
    ['分钟', 60_000],
    ['秒', 1000],
  ];

  for (const [label, size] of units) {
    if (abs >= size) {
      const count = Math.floor(abs / size);
      return diff < 0 ? `${count} ${label}前` : `${count} ${label}后`;
    }
  }
  return '刚刚';
}

export function extractTimeClaims(
  payload: Record<string, unknown>,
  now = Date.now(),
): TimeClaim[] {
  const out: TimeClaim[] = [];
  for (const claim of TIME_CLAIMS) {
    const value = payload[claim.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    // NumericDate is seconds since the epoch.
    const ms = value * 1000;
    out.push({
      name: claim.label,
      value,
      iso: new Date(ms).toISOString(),
      relative: relativeToNow(ms, now),
      state: ms < now ? 'past' : 'future',
    });
  }
  return out;
}

export type ExpiryState = 'none' | 'valid' | 'expired' | 'not-yet-valid' | 'unknown';

export interface ExpiryVerdict {
  state: ExpiryState;
  message: string;
}

/**
 * Interprets `exp`/`nbf` relative to now.
 *
 * Only reports what the *claims* say — it says nothing about whether the token
 * is authentic, which is why the message avoids the word "valid".
 */
export function checkExpiry(
  payload: Record<string, unknown>,
  now = Date.now(),
): ExpiryVerdict {
  const exp = payload.exp;
  const nbf = payload.nbf;

  if (typeof nbf === 'number' && nbf * 1000 > now) {
    return {
      state: 'not-yet-valid',
      message: `尚未生效（nbf 为 ${new Date(nbf * 1000).toISOString()}）`,
    };
  }

  if (typeof exp !== 'number') {
    return { state: 'none', message: '没有 exp 声明，该令牌不会过期（或过期由服务端另行判断）' };
  }

  if (exp * 1000 < now) {
    return {
      state: 'expired',
      message: `已过期（exp 为 ${new Date(exp * 1000).toISOString()}）`,
    };
  }

  return {
    state: 'valid',
    message: `时间上仍有效，将于 ${new Date(exp * 1000).toISOString()} 过期`,
  };
}

/** Human-readable descriptions for the common registered claims. */
export const CLAIM_NOTES: Record<string, string> = {
  iss: '签发者',
  sub: '主体（通常是用户 id）',
  aud: '受众（接收方）',
  exp: '过期时间（秒级时间戳）',
  nbf: '生效时间（秒级时间戳）',
  iat: '签发时间（秒级时间戳）',
  jti: '令牌唯一标识，可用于防重放',
  scope: '授权范围',
  azp: '授权方',
  alg: '签名算法',
  kid: '密钥 id，用于选择验签公钥',
  typ: '令牌类型，通常为 JWT',
};

export const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImRlbW8ta2V5LTEifQ.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuW8oOS4iSIsImFkbWluIjp0cnVlLCJpYXQiOjE3NjcyMjU2MDAsImV4cCI6MTc2NzIyOTIwMCwic2NvcGUiOiJyZWFkIHdyaXRlIiwiaXNzIjoid2hlYXQuY2hhdCIsImF1ZCI6IndlYiJ9.' +
  'c2lnbmF0dXJlLWRvZXMtbm90LXZlcmlmeS1pbi10aGlzLXRvb2w';

/** Security-relevant observations about the header. */
export function auditHeader(header: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const alg = header.alg;

  if (alg === 'none') {
    notes.push('alg 为 none：令牌没有签名，任何人都可以伪造，绝不应被接受');
  } else if (typeof alg === 'string' && alg.startsWith('HS')) {
    notes.push(
      `${alg} 是对称算法：验签用的是共享密钥。若服务端允许用公钥当作 HMAC 密钥，会形成 alg 混淆漏洞`,
    );
  } else if (typeof alg === 'string' && alg.startsWith('RS')) {
    notes.push(`${alg} 是非对称算法，验签需要对应的公钥`);
  }

  if (header.jku || header.jwk) {
    notes.push('Header 中出现 jku/jwk：由令牌自己提供密钥地址或密钥是危险做法');
  }
  if (typeof alg !== 'string') {
    notes.push('缺少 alg 字段');
  }
  return notes;
}
