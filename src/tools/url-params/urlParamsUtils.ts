/**
 * URL query-string editing.
 *
 * `URLSearchParams` is used for *parsing* but the working model is an explicit
 * list of rows, because the naive round-trip loses things that matter:
 *
 * - **Repeated keys.** `?tag=a&tag=b` is perfectly valid; a `Record<string,string>`
 *   silently drops all but one.
 * - **Order.** Query order sometimes matters to servers and always matters to
 *   humans comparing two URLs. Object-based models reorder keys.
 * - **Empty values and valueless keys.** `?flag` and `?key=` are different, and
 *   both are common.
 * - **Encoding style.** `+` vs `%20` for spaces, and whether the original used
 *   percent-encoding at all. Re-encoding everything can break signed URLs.
 *
 * So the parser keeps each row's *raw* text alongside its decoded form, and
 * rebuilding can either re-encode (safe, canonical) or preserve the original
 * bytes (needed when the URL carries a signature).
 */

export interface ParamRow {
  id: string;
  /** Decoded key, as shown and edited in the UI. */
  key: string;
  /** Decoded value, as shown and edited in the UI. */
  value: string;
  /**
   * The key text exactly as it appeared in the source, still escaped.
   *
   * Kept because decoding is not reversible: `%2B` and `+` both decode to `+`,
   * and `%20` and `+` both decode to a space. A signed URL's signature covers
   * the original bytes, so re-encoding a decoded value can invalidate it. Raw
   * mode therefore re-emits these, and only falls back to the edited value when
   * the user actually changed it.
   */
  rawKey: string;
  /** The value text exactly as it appeared in the source, still escaped. */
  rawValue: string;
  /** True when the original had no `=` at all, e.g. `?debug`. */
  valueless: boolean;
  /** True when this key appeared more than once; shown as a hint only. */
  duplicate: boolean;
}

export interface ParsedUrl {
  /** Everything before `?`. */
  base: string;
  /** The fragment, including `#`. */
  hash: string;
  rows: ParamRow[];
  /** Warnings that affect fidelity of a round-trip. */
  warnings: string[];
  /** True when the input had a query string at all. */
  hadQuery: boolean;
}

let counter = 0;
export function makeParam(key = '', value = ''): ParamRow {
  counter += 1;
  return {
    id: `p-${counter}`,
    key,
    value,
    // A freshly added row has no original encoding to preserve.
    rawKey: '',
    rawValue: '',
    valueless: false,
    duplicate: false,
  };
}

/** Splits a URL into base, query rows and fragment. */
export function parseUrl(input: string): ParsedUrl | { error: string } {
  const text = input.trim();
  if (!text) return { error: '请输入 URL' };

  // Split the fragment off first: a `#` inside the query would otherwise be
  // treated as the fragment start.
  const hashIndex = text.indexOf('#');
  const withoutHash = hashIndex === -1 ? text : text.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : text.slice(hashIndex);

  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);

  const rows: ParamRow[] = [];
  const warnings: string[] = [];

  if (query) {
    for (const chunk of query.split('&')) {
      if (chunk === '') continue;

      const eq = chunk.indexOf('=');
      const rawKey = eq === -1 ? chunk : chunk.slice(0, eq);
      const rawValue = eq === -1 ? '' : chunk.slice(eq + 1);

      // `URLSearchParams` is what actually decodes the percent-escapes, and it
      // also normalises `+` to a space the way form encoding requires.
      const key = safeDecode(rawKey);
      const value = safeDecode(rawValue);

      counter += 1;
      rows.push({
        id: `p-${counter}`,
        key,
        value,
        rawKey,
        rawValue,
        valueless: eq === -1,
        duplicate: false,
      });
    }
  }

  // Mark duplicates for display; the data model keeps every occurrence.
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  for (const row of rows) {
    if ((counts.get(row.key) ?? 0) > 1) row.duplicate = true;
  }

  if (/[?&][^=&]*%[0-9a-fA-F]{0,1}(?![0-9a-fA-F])/.test(text)) {
    warnings.push('原地址中存在不完整的百分号转义，已按字面处理');
  }

  return { base, hash, rows, warnings, hadQuery: queryIndex !== -1 };
}

/** Decodes one component, falling back to the raw text when it is malformed. */
function safeDecode(text: string): string {
  try {
    // `+` means space in query strings; decodeURIComponent does not do that.
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

export interface BuildOptions {
  /** Encode keys and values with encodeURIComponent. */
  encode: boolean;
  /** Keep `?flag` (no `=`) for rows whose original had no value. */
  keepValueless: boolean;
  /** Drop rows whose key is empty. */
  dropEmptyKeys: boolean;
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = {
  encode: true,
  keepValueless: true,
  dropEmptyKeys: true,
};

/**
 * Returns the text to emit for one component in raw (non-encoding) mode.
 *
 * The original escaped text is reused only while it still decodes to the value
 * currently shown — i.e. while the user has not edited that field. Once edited,
 * the typed text is emitted verbatim, because there is no original encoding for
 * it. Without this check, an edit would be silently discarded.
 */
function rawOrEdited(raw: string, edited: string): string {
  if (!raw) return edited;
  return safeDecode(raw) === edited ? raw : edited;
}

/**
 * Rebuilds the URL from rows.
 *
 * With `encode: true` (the default) every component is percent-encoded, which is
 * canonical and safe for a freshly assembled request. With `encode: false` the
 * original escaping is reproduced byte-for-byte wherever the field was left
 * untouched — required for URLs carrying a signature, where re-encoding changes
 * the bytes the signature was computed over.
 */
export function buildUrl(
  parsed: Pick<ParsedUrl, 'base' | 'hash'>,
  rows: ParamRow[],
  options: BuildOptions = DEFAULT_BUILD_OPTIONS,
): string {
  const parts: string[] = [];

  for (const row of rows) {
    const key = row.key;
    if (options.dropEmptyKeys && key === '') continue;

    const encodedKey = options.encode
      ? encodeURIComponent(key)
      : rawOrEdited(row.rawKey, key);
    const encodedValue = options.encode
      ? encodeURIComponent(row.value)
      : rawOrEdited(row.rawValue, row.value);

    // A row the user has typed a value into should always get an `=`, even if
    // the original omitted it.
    const valueless = options.keepValueless && row.valueless && row.value === '';
    parts.push(valueless ? encodedKey : `${encodedKey}=${encodedValue}`);
  }

  const query = parts.join('&');
  return `${parsed.base}${query ? `?${query}` : ''}${parsed.hash}`;
}

export interface ParamStats {
  total: number;
  enabled: number;
  duplicates: number;
  emptyValues: number;
  /** Query string length once built. */
  queryLength: number;
}

export function collectStats(rows: ParamRow[], built: string): ParamStats {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.key === '') continue;
    counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  }

  const queryIndex = built.indexOf('?');
  const hashIndex = built.indexOf('#');
  const queryEnd = hashIndex === -1 ? built.length : hashIndex;

  return {
    total: rows.length,
    enabled: rows.filter((row) => row.key !== '').length,
    duplicates: [...counts.values()].filter((count) => count > 1).length,
    emptyValues: rows.filter((row) => row.key !== '' && row.value === '').length,
    queryLength: queryIndex === -1 ? 0 : queryEnd - queryIndex - 1,
  };
}

export interface UrlBreakdown {
  protocol: string;
  username: string;
  host: string;
  port: string;
  path: string;
  fragment: string;
  /** True when the input parsed as an absolute URL. */
  absolute: boolean;
}

/** Breaks a URL into its components for the structure panel. */
export function breakdown(url: string): UrlBreakdown {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      username: parsed.username,
      host: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      fragment: parsed.hash,
      absolute: true,
    };
  } catch {
    // Not absolute (or not a URL at all): show the path-ish part as-is so the
    // panel still says something useful instead of an error.
    const hashIndex = url.indexOf('#');
    const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const queryIndex = withoutHash.indexOf('?');
    return {
      protocol: '',
      username: '',
      host: '',
      port: '',
      path: queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex),
      fragment: hashIndex === -1 ? '' : url.slice(hashIndex),
      absolute: false,
    };
  }
}

/**
 * Compares two URLs' query strings.
 *
 * Useful for the common "why is this request different" question, which is
 * tedious to answer by eye on long URLs.
 */
export interface ParamDiff {
  onlyInA: ParamRow[];
  onlyInB: ParamRow[];
  changed: Array<{ key: string; from: string; to: string }>;
  same: string[];
}

export function diffParams(a: ParamRow[], b: ParamRow[]): ParamDiff {
  const mapA = new Map<string, string[]>();
  const mapB = new Map<string, string[]>();

  for (const row of a) {
    if (!row.key) continue;
    mapA.set(row.key, [...(mapA.get(row.key) ?? []), row.value]);
  }
  for (const row of b) {
    if (!row.key) continue;
    mapB.set(row.key, [...(mapB.get(row.key) ?? []), row.value]);
  }

  const onlyInA: ParamRow[] = [];
  const onlyInB: ParamRow[] = [];
  const changed: Array<{ key: string; from: string; to: string }> = [];
  const same: string[] = [];

  for (const [key, values] of mapA) {
    if (!mapB.has(key)) {
      onlyInA.push(...values.map((value) => makeParam(key, value)));
      continue;
    }
    const other = mapB.get(key) as string[];
    // Join repeated keys so `tag=a&tag=b` compares as one unit.
    if (values.join('\u0000') === other.join('\u0000')) same.push(key);
    else changed.push({ key, from: values.join(', '), to: other.join(', ') });
  }

  for (const [key, values] of mapB) {
    if (!mapA.has(key)) onlyInB.push(...values.map((value) => makeParam(key, value)));
  }

  return { onlyInA, onlyInB, changed, same };
}

/**
 * Normalises a path-style query that was pasted without a base.
 *
 * People frequently paste just `a=1&b=2` or `?a=1`. Treating that as a URL
 * would produce nonsense, so it is detected and given a placeholder base.
 */
export function normaliseInput(input: string): string {
  const text = input.trim();
  if (!text) return text;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) return text;
  if (text.startsWith('/')) return text;
  if (text.startsWith('?')) return `https://example.invalid/${text}`;
  if (text.includes('=') && !text.includes('/')) return `https://example.invalid/?${text}`;
  return text;
}

export const URL_EDITOR_SAMPLES: Array<{ label: string; url: string; note: string }> = [
  {
    label: '重复键',
    url: 'https://shop.example.com/search?tag=book&tag=sale&sort=price&page=2',
    note: '同一个键出现多次，用对象模型会丢数据',
  },
  {
    label: '带签名',
    url: 'https://cdn.example.com/file.pdf?X-Signature=aB3%2FdE%2Bf%3D%3D&Expires=1767225600&name=%E6%8A%A5%E5%91%8A.pdf',
    note: '签名覆盖原始字节，重新编码会导致验签失败',
  },
  {
    label: '无值键与空值',
    url: 'https://api.example.com/v1/items?debug&limit=&offset=0&q=',
    note: '?debug 与 ?limit= 是两种不同情况',
  },
  {
    label: '空格编码差异',
    url: 'https://example.com/s?q=hello+world&filter=a%20b',
    note: '+ 与 %20 都表示空格，但重建时只会用一种',
  },
  {
    label: '跟踪参数',
    url: 'https://news.example.com/post/42?utm_source=weibo&utm_medium=social&utm_campaign=spring&id=42&fbclid=xyz',
    note: '常见的待清理参数',
  },
];

/** Well-known tracking parameters that are usually safe to strip. */
export const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'spm',
  'scm',
];

/** Removes known tracking parameters, reporting how many were dropped. */
export function stripTracking(rows: ParamRow[]): { rows: ParamRow[]; removed: number } {
  const kept = rows.filter(
    (row) => !TRACKING_PARAMS.includes(row.key.trim().toLowerCase()),
  );
  return { rows: kept, removed: rows.length - kept.length };
}
