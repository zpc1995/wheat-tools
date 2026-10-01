/**
 * HTTP request helpers.
 *
 * ## The CORS reality this tool has to be honest about
 *
 * A browser will not let page script read a cross-origin response unless that
 * server sends matching `Access-Control-Allow-*` headers. When it does not,
 * `fetch` rejects with a bare `TypeError: Failed to fetch` — the browser
 * deliberately withholds why, so a CORS rejection, a DNS failure, a refused
 * connection and a TLS error are **indistinguishable** from JavaScript. There is
 * no API that reveals the difference.
 *
 * That is why the error path here does not guess. It reports what was attempted,
 * lists the plausible causes, and tells the user how to confirm it (browser
 * devtools network panel, or the same request from curl) rather than blaming the
 * URL or claiming the server is down.
 *
 * It also means this tool cannot be a general-purpose API client: it can only
 * call servers that opt in to cross-origin reads. The UI says so up front
 * instead of letting people conclude the tool is broken.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

let counter = 0;
export function makeRow(key = '', value = '', enabled = true): KeyValue {
  counter += 1;
  return { id: `row-${counter}`, key, value, enabled };
}

export type BodyMode = 'none' | 'json' | 'form' | 'text';

export interface RequestSpec {
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyMode: BodyMode;
  body: string;
  /** Milliseconds before the request is aborted. */
  timeoutMs: number;
  /** Follow redirects; `follow` hides the 3xx status from script. */
  redirect: RequestRedirect;
}

export const DEFAULT_REQUEST: RequestSpec = {
  method: 'GET',
  url: 'https://httpbin.org/get',
  params: [],
  headers: [],
  bodyMode: 'none',
  body: '',
  timeoutMs: 15000,
  redirect: 'follow',
};

/**
 * Headers the browser refuses to let script set.
 *
 * Attempting them is silently ignored (or throws in strict cases), which would
 * otherwise look like the server ignoring the header.
 */
export const FORBIDDEN_HEADERS = [
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
];

/** Headers the browser will not expose on the response. */
export const HIDDEN_RESPONSE_HEADERS = ['set-cookie', 'set-cookie2'];

/** Appends enabled query parameters to a URL, replacing existing duplicates. */
export function buildUrl(base: string, params: KeyValue[]): string {
  const active = params.filter((row) => row.enabled && row.key.trim() !== '');
  if (active.length === 0) return base.trim();

  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    // Not an absolute URL; return the base unchanged rather than mangling it.
    return base.trim();
  }

  for (const row of active) {
    url.searchParams.append(row.key.trim(), row.value);
  }
  return url.toString();
}

export interface HeaderParseResult {
  headers: Array<{ key: string; value: string }>;
  /** Headers that were rejected, with the reason. */
  rejected: Array<{ key: string; reason: string }>;
}

/**
 * Parses a raw header block (`Name: value` per line).
 *
 * Blank lines and `#` comments are skipped, which makes it possible to paste a
 * block straight out of a curl command or devtools.
 */
export function parseHeaderBlock(text: string): HeaderParseResult {
  const headers: Array<{ key: string; value: string }> = [];
  const rejected: Array<{ key: string; reason: string }> = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      rejected.push({ key: trimmed, reason: '缺少冒号，应为「名称: 值」' });
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) {
      rejected.push({ key: trimmed, reason: '名称为空' });
      continue;
    }
    if (FORBIDDEN_HEADERS.includes(key.toLowerCase())) {
      rejected.push({ key, reason: '这是浏览器禁止脚本设置的请求头' });
      continue;
    }
    headers.push({ key, value });
  }

  return { headers, rejected };
}

/** Builds the final header map from table rows plus the free-form block. */
export function collectHeaders(
  rows: KeyValue[],
  rawBlock: string,
): { headers: Record<string, string>; rejected: Array<{ key: string; reason: string }> } {
  const headers: Record<string, string> = {};
  const rejected: Array<{ key: string; reason: string }> = [];

  for (const row of rows) {
    if (!row.enabled || !row.key.trim()) continue;
    if (FORBIDDEN_HEADERS.includes(row.key.trim().toLowerCase())) {
      rejected.push({ key: row.key.trim(), reason: '浏览器禁止脚本设置该请求头' });
      continue;
    }
    headers[row.key.trim()] = row.value;
  }

  const parsed = parseHeaderBlock(rawBlock);
  for (const header of parsed.headers) headers[header.key] = header.value;
  rejected.push(...parsed.rejected);

  return { headers, rejected };
}

export interface BodyResult {
  body: BodyInit | undefined;
  /** Content-Type that will be applied automatically, if any. */
  contentType: string | null;
  error: string | null;
}

/**
 * Prepares the request body.
 *
 * `form` mode validates that every key is present and URL-encodes the pairs,
 * because a malformed form body produces a confusing 400 far from the cause.
 */
export function prepareBody(spec: RequestSpec, formRows: KeyValue[]): BodyResult {
  if (spec.method === 'GET' || spec.method === 'HEAD') {
    if (spec.bodyMode !== 'none' && spec.body.trim()) {
      return {
        body: undefined,
        contentType: null,
        error: `${spec.method} 请求不应携带请求体（浏览器会忽略或直接报错）`,
      };
    }
    return { body: undefined, contentType: null, error: null };
  }

  if (spec.bodyMode === 'none') return { body: undefined, contentType: null, error: null };

  if (spec.bodyMode === 'json') {
    const text = spec.body.trim();
    if (!text) return { body: undefined, contentType: 'application/json', error: null };
    try {
      // Re-stringify so the payload is valid JSON even if the user typed
      // trailing commas or comments would break it — but report failure rather
      // than sending something the server will reject with an opaque 400.
      const parsed = JSON.parse(text) as unknown;
      return {
        body: JSON.stringify(parsed),
        contentType: 'application/json',
        error: null,
      };
    } catch (error) {
      return {
        body: undefined,
        contentType: null,
        error: `请求体不是合法 JSON：${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (spec.bodyMode === 'form') {
    const params = new URLSearchParams();
    for (const row of formRows) {
      if (!row.enabled || !row.key.trim()) continue;
      params.append(row.key.trim(), row.value);
    }
    return {
      body: params.toString(),
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
      error: null,
    };
  }

  return { body: spec.body, contentType: null, error: null };
}

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface ResponseInfo {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  /** True when the response was opaque (no-cors), so nothing is readable. */
  opaque: boolean;
  headers: HeaderEntry[];
  /** Headers the browser withheld. */
  hiddenHeaders: string[];
  bodyText: string;
  /** Byte length of the decoded body. */
  bodyBytes: number;
  /** True when the body looked binary rather than text. */
  binary: boolean;
  contentType: string;
  redirected: boolean;
  elapsedMs: number;
}

/** Decodes a response body, flagging content that is probably binary. */
export async function readResponseBody(
  response: Response,
): Promise<{ text: string; bytes: number; binary: boolean }> {
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Sample the start: a NUL byte or a high proportion of control characters
  // means it is not text and showing it as such would just be noise.
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  let control = 0;
  for (const byte of sample) {
    // Allow tab, newline and carriage return.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  const binary = sample.length > 0 && control / sample.length > 0.1;

  if (binary) {
    return { text: '', bytes: bytes.length, binary: true };
  }

  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
    bytes: bytes.length,
    binary: false,
  };
}

/** Collects the readable response headers, noting any that were withheld. */
export function readResponseHeaders(response: Response): {
  headers: HeaderEntry[];
  hiddenHeaders: string[];
} {
  const headers: HeaderEntry[] = [];
  const hiddenHeaders: string[] = [];

  response.headers.forEach((value, name) => {
    headers.push({ name, value });
  });
  headers.sort((a, b) => a.name.localeCompare(b.name));

  // `forEach` skips forbidden response headers entirely, so probe for them to
  // be able to say "the server set a cookie you cannot see here" rather than
  // silently omitting it.
  for (const name of HIDDEN_RESPONSE_HEADERS) {
    if (response.headers.get(name) === null) hiddenHeaders.push(name);
  }

  return { headers, hiddenHeaders };
}

export interface ErrorExplanation {
  title: string;
  /** What most likely happened, most likely first. */
  causes: string[];
  /** How the user can confirm which cause it was. */
  howToCheck: string[];
}

/**
 * Turns a fetch rejection into something actionable.
 *
 * The key point: the browser hides the real cause, so this lists the plausible
 * causes in order (CORS first, because that is by far the most common for a
 * browser-based client) and never asserts one of them as fact.
 */
export function explainError(error: unknown, request: { method: string; url: string }): ErrorExplanation {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'AbortError') {
    return {
      title: '请求已中止',
      causes: ['你点击了取消', `超过了设定的超时时间`],
      howToCheck: ['如需等待更久，请调大超时时间后重试'],
    };
  }

  // A TLS/certificate problem surfaces as a TypeError too, so it is listed as a
  // possible cause rather than a separate branch.
  const causes = [
    '目标服务器没有允许跨域读取（未返回 Access-Control-Allow-Origin）——浏览器里最常见的原因',
    `地址或域名无法解析、或写法有误：${request.url}`,
    '服务器拒绝连接、端口未开放，或 TLS 证书无效',
    '请求被浏览器扩展、代理或公司网络策略拦截',
  ];

  // The browser's own message is appended rather than replacing the list above:
  // it is almost always just "Failed to fetch", which is useless on its own but
  // worth showing so the tool is not suspected of hiding information.
  if (message) causes.push(`浏览器返回的原始信息：${message}`);

  return {
    title: '请求失败：浏览器未告知具体原因',
    causes,
    howToCheck: [
      '打开开发者工具的 Network 面板重发一次，那里会显示真实原因（CORS、DNS、证书等）',
      `用命令行确认服务器本身是否可达：curl -i -X ${request.method} '${request.url}'`,
      '若 curl 能通而这里不能，基本可以确定是 CORS：需要服务器返回 Access-Control-Allow-Origin',
    ],
  };
}

export interface StatusInfo {
  label: string;
  tone: 'success' | 'redirect' | 'client' | 'server' | 'unknown';
}

/** Classifies an HTTP status for display. */
export function describeStatus(status: number): StatusInfo {
  if (status === 0) {
    return { label: '0（无法读取，可能是 opaque 响应）', tone: 'unknown' };
  }
  if (status >= 200 && status < 300) return { label: '成功', tone: 'success' };
  if (status >= 300 && status < 400) return { label: '重定向', tone: 'redirect' };
  if (status >= 400 && status < 500) return { label: '客户端错误', tone: 'client' };
  if (status >= 500) return { label: '服务端错误', tone: 'server' };
  return { label: '信息响应', tone: 'unknown' };
}

/** Pretty-prints a body when it is JSON, otherwise returns it unchanged. */
export function prettyBody(text: string, contentType: string): string {
  const looksJson = /json/i.test(contentType) || /^\s*[[{]/.test(text);
  if (!looksJson) return text;
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Checks whether a URL is same-origin, which is the only case where the tool
 * can promise the response is readable.
 */
export function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** A curl command that reproduces the request, for use outside the browser. */
export function toCurl(spec: RequestSpec, formRows: KeyValue[], fullUrl: string): string {
  const parts = [`curl -i -X ${spec.method} '${fullUrl}'`];

  const { headers } = collectHeaders(spec.headers, '');
  for (const [key, value] of Object.entries(headers)) {
    parts.push(`  -H '${key}: ${value}'`);
  }

  const prepared = prepareBody(spec, formRows);
  if (prepared.body) {
    parts.push(`  --data-raw '${String(prepared.body).replace(/'/g, "'\\''")}'`);
  } else if (spec.bodyMode === 'json' && spec.body.trim()) {
    parts.push(`  --data-raw '${spec.body.trim().replace(/'/g, "'\\''")}'`);
  }

  return parts.join(' \\\n');
}

export interface HistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  status: number | null;
  elapsedMs: number | null;
  at: number;
}

/** Ready-made requests that are known to be CORS-enabled, so they work. */
export const REQUEST_PRESETS: Array<{ label: string; note: string; spec: Partial<RequestSpec> }> = [
  {
    label: 'GET httpbin',
    note: 'httpbin.org 允许跨域，可看到完整响应',
    spec: { method: 'GET', url: 'https://httpbin.org/get', bodyMode: 'none' },
  },
  {
    label: 'POST JSON',
    note: '回显你发送的 JSON',
    spec: {
      method: 'POST',
      url: 'https://httpbin.org/post',
      bodyMode: 'json',
      body: '{\n  "name": "wheat-tools",\n  "ok": true\n}',
    },
  },
  {
    label: '查看请求头',
    note: '回显服务端收到的请求头',
    spec: { method: 'GET', url: 'https://httpbin.org/headers', bodyMode: 'none' },
  },
  {
    label: '指定状态码',
    note: '用 404 验证错误分支的展示',
    spec: { method: 'GET', url: 'https://httpbin.org/status/404', bodyMode: 'none' },
  },
  {
    label: '延迟 3 秒',
    note: '验证超时与取消',
    spec: { method: 'GET', url: 'https://httpbin.org/delay/3', bodyMode: 'none', timeoutMs: 15000 },
  },
  {
    label: 'CORS 受限示例',
    note: '该地址不允许跨域读取，用来看失败时的说明是否清楚',
    spec: { method: 'GET', url: 'https://example.com/', bodyMode: 'none' },
  },
];
