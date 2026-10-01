/**
 * URL encoding/decoding helpers.
 *
 * Three levels of escaping, which people conflate constantly:
 * - `encodeURIComponent` escapes everything that is not unreserved, which is
 *   what you want for a single query *value*.
 * - `encodeURI` keeps URL delimiters (`/ ? # & =`) intact, which is what you
 *   want for a whole URL you are not trying to alter structurally.
 * - form encoding turns spaces into `+` (and is also what `application/x-www-form-urlencoded`
 *   expects), which differs from `encodeURIComponent`'s `%20`.
 *
 * All of them are provided explicitly rather than picking one silently, because
 * the wrong choice corrupts the URL in ways that are easy to miss.
 */

export type EncodeMode = 'component' | 'uri' | 'form';

export interface UrlPair {
  key: string;
  value: string;
}

export type UrlDecodeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Decodes percent-escapes.
 *
 * `decodeURIComponent` throws on a malformed sequence such as a lone `%`, so
 * the failure is surfaced as a message instead of an exception.
 */
export function decodeText(input: string): UrlDecodeResult {
  try {
    return { ok: true, text: decodeURIComponent(input) };
  } catch {
    return {
      ok: false,
      error: '存在不完整的百分号转义（如单独的 % 或 %2），无法解码',
    };
  }
}

/** Form decoding: `+` means space, then the usual percent handling. */
export function decodeForm(input: string): UrlDecodeResult {
  return decodeText(input.replace(/\+/g, ' '));
}

export function encodeText(input: string, mode: EncodeMode): string {
  switch (mode) {
    case 'uri':
      return encodeURI(input);
    case 'form':
      return encodeURIComponent(input).replace(/%20/g, '+');
    case 'component':
    default:
      return encodeURIComponent(input);
  }
}

/**
 * Splits a query string into key/value pairs.
 *
 * Accepts a leading `?` and tolerates a bare fragment, because that is how
 * query strings arrive when copied straight out of a browser.
 */
export function parseQuery(input: string): UrlPair[] {
  const cleaned = input.trim().replace(/^[?#]/, '');
  if (!cleaned) return [];

  return cleaned.split('&').reduce<UrlPair[]>((pairs, chunk) => {
    if (!chunk) return pairs;
    const index = chunk.indexOf('=');
    const rawKey = index === -1 ? chunk : chunk.slice(0, index);
    const rawValue = index === -1 ? '' : chunk.slice(index + 1);

    // Report what the value decodes to; fall back to the raw text so a broken
    // escape still shows something.
    const key = decodeForm(rawKey);
    const value = decodeForm(rawValue);

    pairs.push({
      key: key.ok ? key.text : rawKey,
      value: value.ok ? value.text : rawValue,
    });
    return pairs;
  }, []);
}

/** Rebuilds a query string from pairs. */
export function buildQuery(pairs: UrlPair[]): string {
  return pairs
    .filter((pair) => pair.key.trim() !== '')
    .map(
      (pair) =>
        `${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`,
    )
    .join('&');
}

export interface ParsedUrl {
  ok: boolean;
  protocol?: string;
  host?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  origin?: string;
  username?: string;
  /** Query parameters, already decoded. */
  params?: UrlPair[];
  error?: string;
}

/**
 * Parses a full URL for display.
 *
 * Relative strings are reported as such rather than being resolved against the
 * page origin, which would be misleading.
 */
export function parseUrl(input: string): ParsedUrl {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: '请输入 URL' };

  try {
    const url = new URL(trimmed);
    return {
      ok: true,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      origin: url.origin,
      username: url.username || undefined,
      params: parseQuery(url.search),
    };
  } catch {
    return {
      ok: false,
      error: '不是绝对 URL（缺少协议，如 https://），或格式有误',
    };
  }
}
