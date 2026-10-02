/**
 * URL decomposition and diagnosis.
 *
 * ## Why this delegates to the platform parser
 *
 * Splitting a URL with regular expressions is the classic trap. The grammar has
 * several places where the same character means different things depending on
 * where it sits:
 *
 *   - `@` is allowed *inside* the userinfo, so the authority has to be split at
 *     the LAST `@`, not the first; a first-`@` split turns
 *     `https://user@name:pass@example.com/` into host `name`.
 *   - an IPv6 host is wrapped in brackets and contains colons, so the port must
 *     be found after the closing bracket, not at the last colon.
 *   - `//` can appear inside the path (`/a//b`) and inside the query
 *     (`?next=//evil.example`), so "split on `//`" destroys both.
 *
 * `new URL()` and `URLSearchParams` implement the WHATWG URL standard and are
 * the authority for every field below. Everything here is a *presentation* of
 * those objects plus diagnostics that the parser itself does not surface (such
 * as "the input spelled out a redundant default port", which `new URL()` has
 * already normalised away by the time you look at `.port`).
 *
 * ## Why the decoding differs per segment
 *
 * `decodeURIComponent` is the right tool for the path and the fragment: both are
 * percent-decoded, and `+` is a literal plus sign in both.
 *
 * The query is different. Browsers decode `application/x-www-form-urlencoded`
 * there, where `+` means a space. `decodeURIComponent('q=a+b')` returns `a+b`,
 * which is wrong for a query string; `new URLSearchParams('q=a+b').get('q')`
 * returns `a b`, which is right. That is why the query goes through
 * `URLSearchParams` and the other two do not.
 *
 * Pure logic: no React, no DOM, no clock, no randomness. `URL` is a global in
 * both the browser and Node, which is what makes this file testable directly.
 */

/** Ports that are implied by the scheme and are therefore dropped by `new URL()`. */
export const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};

/** Schemes that the URL standard treats as "special" (they have a host). */
const SPECIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:']);

/** Schemes whose traffic is not protected in transit. */
const INSECURE_SCHEMES = new Set(['http:', 'ws:', 'ftp:']);

/**
 * Click-tracking query keys.
 *
 * The `utm_` prefix is handled separately because campaign tags are open-ended
 * (`utm_creative_format`, `utm_marketing_tactic`, ... were all added after the
 * original five), and enumerating them guarantees missing the next one.
 */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'wbraid',
  'gbraid',
  'srsltid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'igsh',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'vero_id',
  'oly_anon_id',
  'oly_enc_id',
  'mkt_tok',
  'trk',
  'ref_src',
  'spm',
  'scm',
]);

/** Whether a decoded query key is a known tracking parameter. */
export function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/** One decomposition field, ready for the table in the UI. */
export interface UrlField {
  key: string;
  label: string;
  value: string;
  /** Explains a value that is empty because the parser removed it. */
  note?: string;
}

/** One query parameter, keeping the distinctions `URLSearchParams` erases. */
export interface QueryParam {
  index: number;
  /** The raw pair as it appeared, e.g. `a`, `a=`, `a=1`. */
  raw: string;
  key: string;
  /** Decoded value, or `null` when the pair had no `=` at all. */
  value: string | null;
  keyRaw: string;
  valueRaw: string | null;
  /** Whether an `=` was present. `?a` and `?a=` both decode to `a`, but only one had `=`. */
  hasEquals: boolean;
  /** Index of the first pair with the same decoded key, when this is a repeat. */
  duplicateOf: number | null;
  tracking: boolean;
}

/** Percent-decoded view of one URL segment. */
export interface DecodedSegment {
  key: 'pathname' | 'search' | 'hash';
  label: string;
  raw: string;
  decoded: string;
  error: string | null;
  note: string;
}

export interface Diagnostic {
  id: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
}

export interface NestedUrl {
  index: number;
  key: string;
  value: string;
  protocol: string;
}

export interface UrlFields {
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  href: string;
}

export interface UrlAnalysis {
  ok: true;
  input: string;
  base: string | null;
  usedBase: boolean;
  isRelativeInput: boolean;
  href: string;
  fields: UrlFields;
  passwordPresent: boolean;
  defaultPortForScheme: string | null;
  redundantPort: number | null;
  isIpv6Host: boolean;
  isIpv4Host: boolean;
  isSpecialScheme: boolean;
  isOpaque: boolean;
  asciiHostname: string;
  unicodeHostname: string | null;
  rawHostHadNonAscii: boolean;
  segments: DecodedSegment[];
  query: QueryParam[];
  trackingKeys: string[];
  spaFragment: boolean;
  nestedUrls: NestedUrl[];
  diagnostics: Diagnostic[];
}

export interface UrlParseFailure {
  ok: false;
  input: string;
  base: string | null;
  error: string;
  diagnostics: Diagnostic[];
}

export type UrlParseResult = UrlAnalysis | UrlParseFailure;

/** Percent-decodes, reporting malformed escapes instead of throwing. */
export function safeDecodeURIComponent(value: string): { value: string; error: string | null } {
  try {
    return { value: decodeURIComponent(value), error: null };
  } catch (error) {
    return {
      value,
      error: `百分号转义不完整：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Splits a raw query string into pairs while keeping what `URLSearchParams`
 * normalises away.
 *
 * `new URLSearchParams('?a&a=')` reports two entries that both look like
 * `['a', '']`, so "key with no value" and "key with an empty value" become
 * indistinguishable. Whether `=` was present only survives in the raw text, so
 * the pairs are cut here and each side is then decoded with the same
 * form-decoding rules the platform uses.
 */
export function parseQuery(search: string): QueryParam[] {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (raw === '') return [];

  const params: QueryParam[] = [];
  const firstIndexByKey = new Map<string, number>();

  // A trailing `&` produces an empty piece; `URLSearchParams` drops those, and
  // so does this loop, so the two stay in agreement.
  for (const piece of raw.split('&')) {
    if (piece === '') continue;

    const equalsAt = piece.indexOf('=');
    const hasEquals = equalsAt >= 0;
    const keyRaw = hasEquals ? piece.slice(0, equalsAt) : piece;
    const valueRaw = hasEquals ? piece.slice(equalsAt + 1) : null;

    // A single pair can be handed to URLSearchParams directly: it does the
    // `+`-to-space and percent decoding exactly as it would for the whole query.
    const decoded = [...new URLSearchParams(piece)];
    const key = decoded.length > 0 ? decoded[0][0] : keyRaw;
    const value = hasEquals ? (decoded.length > 0 ? decoded[0][1] : (valueRaw ?? '')) : null;

    const previous = firstIndexByKey.get(key);
    if (previous === undefined) firstIndexByKey.set(key, params.length);

    params.push({
      index: params.length,
      raw: piece,
      key,
      value,
      keyRaw,
      valueRaw,
      hasEquals,
      duplicateOf: previous === undefined ? null : previous,
      tracking: isTrackingParam(key),
    });
  }

  return params;
}

/** Finds the authority section of a raw URL string, if it has one. */
function authorityOf(raw: string): string | null {
  const match = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\/([^/?#]*)/.exec(raw);
  return match ? match[1] : null;
}

/**
 * Detects an explicitly written default port.
 *
 * This cannot be read off the parsed object: `new URL('http://a.example:80/')`
 * already reports `port === ''` and `href === 'http://a.example/'`, because
 * normalising the URL is part of parsing it. The information only exists in the
 * raw text, so the raw text is what gets inspected.
 */
export function findRedundantDefaultPort(raw: string, protocol: string): number | null {
  const expected = DEFAULT_PORTS[protocol];
  if (!expected) return null;

  const authority = authorityOf(raw);
  if (!authority) return null;

  // Strip the userinfo: a password may itself contain a colon.
  const at = authority.lastIndexOf('@');
  const hostPart = at >= 0 ? authority.slice(at + 1) : authority;

  // For an IPv6 literal the port follows the closing bracket, and every colon
  // inside the brackets belongs to the address.
  const bracket = hostPart.lastIndexOf(']');
  const colon = hostPart.lastIndexOf(':');
  if (colon < 0 || colon < bracket) return null;

  const portText = hostPart.slice(colon + 1);
  if (!/^[0-9]+$/.test(portText)) return null;
  return Number(portText) === Number(expected) ? Number(portText) : null;
}

/* --- Punycode decoding -------------------------------------------------- */

const PUNYCODE_BASE = 36;
const PUNYCODE_TMIN = 1;
const PUNYCODE_TMAX = 26;
const PUNYCODE_SKEW = 38;
const PUNYCODE_DAMP = 700;
const PUNYCODE_INITIAL_BIAS = 72;
const PUNYCODE_INITIAL_N = 128;

function punycodeDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return PUNYCODE_BASE;
}

function punycodeAdapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX) >> 1) {
    d = Math.floor(d / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return k + Math.floor(((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * d) / (d + PUNYCODE_SKEW));
}

/**
 * Decodes one `xn--` label back to Unicode (RFC 3492).
 *
 * The platform encodes IDN hostnames to Punycode inside `new URL()` but offers
 * no way to read them back, so a decoder is the only way to show the user which
 * name they would actually be visiting. It is checked against the platform's own
 * `domainToUnicode` in the check script, which is what makes it trustworthy.
 *
 * Returns `null` for anything that is not a well-formed Punycode label.
 */
export function punycodeDecodeLabel(label: string): string | null {
  if (label === '') return null;
  const input = label.toLowerCase();
  const output: number[] = [];
  let index = 0;
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;

  const basic = input.lastIndexOf('-');
  if (basic > 0) {
    for (let j = 0; j < basic; j += 1) {
      const code = input.charCodeAt(j);
      if (code >= 0x80) return null;
      output.push(code);
    }
    index = basic + 1;
  }

  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
      if (index >= input.length) return null;
      const digit = punycodeDigit(input.charCodeAt(index));
      index += 1;
      if (digit >= PUNYCODE_BASE) return null;
      i += digit * w;
      const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
      if (digit < t) break;
      w *= PUNYCODE_BASE - t;
    }
    const out = output.length + 1;
    bias = punycodeAdapt(i - oldi, out, oldi === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i, 0, n);
    i += 1;
  }

  try {
    return String.fromCodePoint(...output);
  } catch {
    return null;
  }
}

/** Decodes a whole hostname, leaving labels that are not Punycode untouched. */
export function toUnicodeHostname(hostname: string): string | null {
  if (!hostname) return null;
  let changed = false;
  const labels = hostname.split('.').map((label) => {
    if (!label.startsWith('xn--')) return label;
    const decoded = punycodeDecodeLabel(label.slice(4));
    if (decoded === null) return label;
    changed = true;
    return decoded;
  });
  return changed ? labels.join('.') : null;
}

/** Whether a hostname has an IDN / Punycode label. */
export function hasPunycodeLabel(hostname: string): boolean {
  return hostname.split('.').some((label) => label.startsWith('xn--'));
}

/** Whether a URL string starts with a scheme. */
export function hasScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

/** A value that parses as an absolute URL, i.e. a URL nested inside a parameter. */
export function nestedUrlOf(value: string): { protocol: string; href: string } | null {
  if (hasScheme(value)) {
    try {
      const parsed = new URL(value);
      return { protocol: parsed.protocol, href: parsed.href };
    } catch {
      return null;
    }
  }
  if (value.startsWith('//')) {
    try {
      const parsed = new URL(`https:${value}`);
      return { protocol: '（协议相对）', href: parsed.href };
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a fragment looks like a client-side route rather than an anchor. */
export function isSpaFragment(hash: string): boolean {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body === '') return false;
  // `#/users/1`, `#!/inbox`, `#/` are the conventional hash-routing shapes.
  return body.startsWith('/') || body.startsWith('!');
}

function buildDiagnostics(analysis: Omit<UrlAnalysis, 'diagnostics'>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { fields, query } = analysis;

  if (INSECURE_SCHEMES.has(fields.protocol)) {
    diagnostics.push({
      id: 'insecure-scheme',
      level: 'warning',
      title: `明文协议 ${fields.protocol}`,
      detail:
        '该协议的流量没有加密，路径、查询参数以及下面列出的任何认证信息都会以明文经过网络，可被中间人读取或篡改。建议改用 https: 或 wss:。',
    });
  }

  if (fields.protocol === 'javascript:' || fields.protocol === 'data:') {
    diagnostics.push({
      id: 'dangerous-scheme',
      level: 'error',
      title: `可执行或内联内容协议 ${fields.protocol}`,
      detail:
        'javascript: 可以执行脚本，data: 可以携带任意内容。除非你完全清楚来源，否则不要把它放进链接或 iframe。',
    });
  }

  if (analysis.redundantPort !== null) {
    diagnostics.push({
      id: 'redundant-port',
      level: 'info',
      title: `显式写了默认端口 :${analysis.redundantPort}`,
      detail: `该端口是 ${fields.protocol} 的默认值，去掉后指向完全相同的地址；保留它会让字符串更难比较，也可能绕过只比较主机名的过滤规则。`,
    });
  }

  if (analysis.rawHostHadNonAscii) {
    diagnostics.push({
      id: 'idn-input',
      level: 'info',
      title: '主机名含非 ASCII 字符',
      detail: `浏览器要求主机名是 ASCII，因此输入已被平台按 IDN 规则转换成 Punycode：${analysis.asciiHostname}。同形字攻击（用形近的 Unicode 字符冒充别的域名）正是靠这种转换成立，展示时应同时给出两种写法。`,
    });
  } else if (hasPunycodeLabel(analysis.asciiHostname)) {
    diagnostics.push({
      id: 'punycode',
      level: 'warning',
      title: '主机名是 Punycode（xn--）',
      detail: analysis.unicodeHostname
        ? `Punycode 形式 ${analysis.asciiHostname} 解码后是「${analysis.unicodeHostname}」。看到 xn-- 时应先确认解码结果是不是你真正想访问的域名。`
        : `主机名 ${analysis.asciiHostname} 含 xn-- 标签，但解码失败，可能是伪造或损坏的 IDN 域名。`,
    });
  }

  if (analysis.passwordPresent || analysis.fields.username !== '') {
    diagnostics.push({
      id: 'credentials',
      level: 'warning',
      title: 'URL 中含认证信息',
      detail:
        'user:password@ 形式的凭据会出现在浏览器历史、Referer 头、服务器访问日志和聊天记录里，而且 http: 下是明文。它适合做一次性调试，不适合作为长期传递凭据的方式。',
    });
  }

  if (analysis.trackingKeys.length > 0) {
    diagnostics.push({
      id: 'tracking',
      level: 'info',
      title: `含 ${analysis.trackingKeys.length} 类追踪参数`,
      detail: `识别到：${analysis.trackingKeys.join('、')}。这些参数用于跨站识别来源，分享链接前可以一键移除，不影响页面内容。`,
    });
  }

  if (analysis.spaFragment) {
    diagnostics.push({
      id: 'spa-fragment',
      level: 'info',
      title: '片段（#）看起来是单页应用路由',
      detail:
        '片段不会发送给服务器，只有页面里的脚本会读取它。因此这类地址在服务端日志中全部显示为同一个页面，做重定向或统计时要注意。',
    });
  }

  if (analysis.nestedUrls.length > 0) {
    diagnostics.push({
      id: 'nested-url',
      level: 'warning',
      title: '参数里嵌套了另一个 URL',
      detail: `位置：${analysis.nestedUrls
        .map((item) => `${item.key}=${item.value}`)
        .join('；')}。这类参数常被用作开放重定向或 SSRF 的入口；如果服务端未做白名单校验，攻击者可以把跳转目标改成任意站点。`,
    });
  }

  for (const segment of analysis.segments) {
    if (segment.error) {
      diagnostics.push({
        id: `malformed-${segment.key}`,
        level: 'warning',
        title: `${segment.label} 无法完整解码`,
        detail: `${segment.error}。解析器保留了原始文本；这通常说明链接在复制或拼接时被截断。`,
      });
    }
  }

  if (analysis.isOpaque) {
    diagnostics.push({
      id: 'opaque',
      level: 'info',
      title: '这不是带主机的层级 URL',
      detail: `协议 ${fields.protocol} 没有主机与源（origin 为 null），因此 host、port、origin 都是空的，也没有相对路径可言。`,
    });
  }

  if (query.some((param) => param.duplicateOf !== null)) {
    diagnostics.push({
      id: 'duplicate-params',
      level: 'info',
      title: '存在重复的查询参数键',
      detail:
        '同一键出现多次。不同服务端框架对此处理不同（取第一个、取最后一个、合并成数组），需要按数组处理时尤其要小心。',
    });
  }

  return diagnostics;
}

/**
 * Parses and analyses a URL.
 *
 * `base` mirrors the second argument of `new URL()`: a relative input such as
 * `/a/b` or `?q=1` is resolved against it, exactly as the browser would when
 * following a link on that page. Without a base a relative input is an error,
 * because there is genuinely nothing to resolve it against.
 */
export function analyzeUrl(input: string, base?: string | null): UrlParseResult {
  const trimmed = input.trim();
  const baseTrimmed = base && base.trim() !== '' ? base.trim() : null;

  if (trimmed === '') {
    return { ok: false, input, base: baseTrimmed, error: '请输入要分析的 URL。', diagnostics: [] };
  }

  let parsed: URL;
  try {
    parsed = baseTrimmed ? new URL(trimmed, baseTrimmed) : new URL(trimmed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      input,
      base: baseTrimmed,
      error: hasScheme(trimmed)
        ? `无法解析为 URL：${reason}`
        : `相对地址需要有效的 base 才能解析：${reason}`,
      diagnostics: [],
    };
  }

  const isRelativeInput = !hasScheme(trimmed) && !trimmed.startsWith('//');
  const usedBase = isRelativeInput && baseTrimmed !== null;
  const authoritySource = hasScheme(trimmed) || trimmed.startsWith('//') ? trimmed : baseTrimmed ?? '';

  const fields: UrlFields = {
    protocol: parsed.protocol,
    username: parsed.username,
    password: parsed.password,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    origin: parsed.origin,
    href: parsed.href,
  };

  const query = parseQuery(parsed.search);
  const pathDecoded = safeDecodeURIComponent(parsed.pathname);
  const hashDecoded = safeDecodeURIComponent(parsed.hash);
  const searchDecoded = query
    .map((param) => (param.hasEquals ? `${param.key}=${param.value ?? ''}` : param.key))
    .join('&');

  const segments: DecodedSegment[] = [
    {
      key: 'pathname',
      label: 'pathname 路径',
      raw: parsed.pathname,
      decoded: pathDecoded.value,
      error: pathDecoded.error,
      note: '按百分号解码（与 decodeURIComponent 一致）：`+` 保持为字面的加号；`%2F` 会解码成 `/`，但那只是字符，不会真的多出一个路径层级。',
    },
    {
      key: 'search',
      label: 'search 查询串',
      raw: parsed.search,
      decoded: searchDecoded,
      error: null,
      note: '按表单规则解码（与 URLSearchParams 一致）：`+` 解码成空格，`%xx` 解码成字节。用 decodeURIComponent 处理查询串是错的，它不会把 `+` 当空格。',
    },
    {
      key: 'hash',
      label: 'hash 片段',
      raw: parsed.hash,
      decoded: hashDecoded.value,
      error: hashDecoded.error,
      note: '与路径一样按百分号解码，不做表单解码：`+` 保持为字面的加号。片段不发送给服务器。',
    },
  ];

  const authority = authorityOf(authoritySource);
  const rawHostHadNonAscii = authority !== null && /[^\x00-\x7F]/.test(authority.split('@').pop() ?? '');

  const partial: Omit<UrlAnalysis, 'diagnostics'> = {
    ok: true,
    input,
    base: baseTrimmed,
    usedBase,
    isRelativeInput,
    href: parsed.href,
    fields,
    passwordPresent: parsed.password !== '',
    defaultPortForScheme: DEFAULT_PORTS[parsed.protocol] ?? null,
    redundantPort: findRedundantDefaultPort(authoritySource, parsed.protocol),
    isIpv6Host: parsed.hostname.startsWith('['),
    isIpv4Host: /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(parsed.hostname),
    isSpecialScheme: SPECIAL_SCHEMES.has(parsed.protocol),
    isOpaque: parsed.origin === 'null' && !SPECIAL_SCHEMES.has(parsed.protocol),
    asciiHostname: parsed.hostname,
    unicodeHostname: toUnicodeHostname(parsed.hostname),
    rawHostHadNonAscii,
    segments,
    query,
    trackingKeys: [...new Set(query.filter((param) => param.tracking).map((param) => param.key))],
    spaFragment: isSpaFragment(parsed.hash),
    nestedUrls: query
      .filter((param) => param.value !== null && param.value !== '')
      .map((param) => {
        const nested = nestedUrlOf(param.value as string);
        return nested
          ? { index: param.index, key: param.key, value: param.value as string, protocol: nested.protocol }
          : null;
      })
      .filter((item): item is NestedUrl => item !== null),
  };

  return { ...partial, diagnostics: buildDiagnostics(partial) };
}

/**
 * Removes every recognised tracking parameter.
 *
 * Duplicates are removed wholesale rather than by position: if a key is a
 * tracker, every occurrence of it is a tracker. Everything else keeps its
 * original relative order, which matters because some services care about the
 * first value and others about the last. An unparseable input is returned
 * unchanged, since there is nothing safe to rewrite.
 */
export function removeTrackingParams(href: string): string {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return href;
  }

  const keep = parseQuery(parsed.search).filter((param) => !param.tracking);
  // The kept pairs are copied through in their original raw form rather than
  // re-encoded from the decoded values: re-encoding would silently rewrite
  // escapes (`%20` vs `+`, uppercase vs lowercase hex) and could change how a
  // strict server compares the signature-carrying parts of a query string.
  const search = keep.map((param) => param.raw).join('&');

  // `URL.search` is a setter that adds the leading `?` when the value is not empty.
  parsed.search = search;
  return parsed.href;
}

/** The display order of the decomposition table. */
export const FIELD_ORDER: Array<{ key: keyof UrlFields; label: string }> = [
  { key: 'protocol', label: 'protocol 协议' },
  { key: 'username', label: 'username 用户名' },
  { key: 'password', label: 'password 密码' },
  { key: 'host', label: 'host 主机（含端口）' },
  { key: 'hostname', label: 'hostname 主机名' },
  { key: 'port', label: 'port 端口' },
  { key: 'pathname', label: 'pathname 路径' },
  { key: 'search', label: 'search 查询串' },
  { key: 'hash', label: 'hash 片段' },
  { key: 'origin', label: 'origin 源' },
  { key: 'href', label: 'href 规范化结果' },
];
