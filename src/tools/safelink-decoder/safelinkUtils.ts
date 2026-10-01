/**
 * Microsoft Defender for Office 365 SafeLinks decoding.
 *
 * A SafeLink is a wrapper URL that Microsoft rewrites every link in a mail
 * through, so the click can be checked against policy before the real page is
 * reached:
 *
 *   https://nam12.safelinks.protection.outlook.com/?url=<encoded target>
 *     &data=<metadata>&sdata=<signature>&reserved=0
 *
 * The tool's job is narrow and it is worth stating what it deliberately does
 * not do:
 *
 * - It does **not** verify `sdata`. That needs Microsoft's key material and the
 *   exact signing scheme, neither of which is public; a browser-side tool that
 *   claimed to verify it would be lying. The result therefore carries
 *   `signatureVerified: false` as a constant so the claim cannot drift.
 * - It does **not** fetch, resolve or preview any URL. Every function here is
 *   pure text handling, which is also what makes it testable and safe to run on
 *   a link from a suspicious mail.
 *
 * ## The `+` question
 *
 * In a query string `+` means a space under `application/x-www-form-urlencoded`
 * rules and a literal plus under RFC 3986. The two readings disagree, so the
 * choice has to be argued rather than guessed:
 *
 * - Every mainstream encoder of a *value* escapes a literal plus: JavaScript
 *   `encodeURIComponent('+')` is `%2B`, .NET `Uri.EscapeDataString` likewise.
 *   Microsoft's own links show the same behaviour inside `sdata`, where base64
 *   plus signs survive as `%2B` (for example `...JQ%2BpSpVr4...`). A literal
 *   plus in a well formed link is therefore `%2B`, never a bare `+`.
 * - That leaves a bare `+` only meaningful as form-encoded space, which is how
 *   the reference decoders read it (Go's `url.Query()` as used by
 *   atc0005/safelinks) and how the browser's own `URLSearchParams` reads it.
 *
 * So the default here is form semantics, but a bare `+` is treated as an
 * ambiguity to report rather than a fact: the strict reading is computed too,
 * both are returned, and the UI shows them side by side. A hand-edited link
 * that pasted a literal plus unescaped is exactly the case where guessing
 * silently would corrupt the answer.
 */

/** Refuse to process anything larger; a SafeLink is a few hundred bytes. */
export const MAX_INPUT_LENGTH = 20_000;

/** How many times one `url` value may be percent-decoded. */
export const MAX_DECODE_PASSES = 5;

/** How many nested SafeLink wrappers are unwrapped before giving up. */
export const MAX_WRAPPER_LAYERS = 5;

const SAFELINK_BASE_DOMAIN = 'safelinks.protection.outlook.com';

export type PlusMode = 'space' | 'literal';

export type SafelinkKind = 'safelinks-host' | 'outlook-wrapper';

export interface ParamInfo {
  /** Short label shown next to the parameter name. */
  title: string;
  /** What the parameter is, including what is unknown about it. */
  detail: string;
  /** False for parameters Microsoft has never documented. */
  documented: boolean;
}

export interface SafelinkParam {
  /** Name exactly as written in the URL. */
  name: string;
  /** Lower-cased name used for matching, so `URL` and `url` are the same. */
  key: string;
  /** Raw text between the equals sign and the next ampersand. */
  raw: string;
  /** Decoded with form rules, where a bare plus becomes a space. */
  formValue: string;
  /** Decoded with strict rules, where a bare plus stays a plus. */
  literalValue: string;
  /** Whether the two readings actually differ. */
  ambiguousPlus: boolean;
  /** Explanation of the parameter, or of the fact that it is undocumented. */
  info: ParamInfo;
}

export type WarningCode =
  | 'html-escaped'
  | 'trimmed-envelope'
  | 'multiple-url-params'
  | 'ambiguous-plus'
  | 'malformed-percent'
  | 'decode-limit'
  | 'double-encoded'
  | 'nested-safelink'
  | 'recursion-limit'
  | 'outlook-wrapper-unconfirmed'
  | 'target-not-absolute';

export interface SafelinkWarning {
  code: WarningCode;
  message: string;
}

export interface SafelinkLayer {
  /** 1-based, outermost wrapper first. */
  layer: number;
  kind: SafelinkKind;
  /** Host of this wrapper, lower-cased. */
  host: string;
  /** The wrapper URL itself, as given. */
  wrapper: string;
  /** The raw `url` parameter value, before any decoding. */
  rawUrl: string;
  /** How many percent-decodes were needed to reach `target`. */
  passes: number;
  /** Target under the default reading. */
  target: string;
  /** Target under the strict plus reading, which may differ. */
  targetLiteral: string;
  /** Every query parameter of this wrapper. */
  params: SafelinkParam[];
  /** Percent escapes that were malformed and therefore left untouched. */
  invalidEscapes: string[];
}

export type SafelinkErrorCode =
  | 'empty'
  | 'too-long'
  | 'not-url'
  | 'not-safelink'
  | 'missing-url'
  | 'empty-url';

export interface SafelinkOk {
  ok: true;
  kind: SafelinkKind;
  host: string;
  /** Fully unwrapped destination, default reading. */
  target: string;
  /** Fully unwrapped destination, strict plus reading. */
  targetLiteral: string;
  layers: SafelinkLayer[];
  /** True when the recursion cap stopped a further unwrap. */
  truncated: boolean;
  /** Constant: this tool never verifies `sdata`. */
  signatureVerified: false;
  warnings: SafelinkWarning[];
  /** Convenience: the outermost wrapper's parameters. */
  params: SafelinkParam[];
}

export interface SafelinkFail {
  ok: false;
  code: SafelinkErrorCode;
  error: string;
  warnings: SafelinkWarning[];
}

export type SafelinkResult = SafelinkOk | SafelinkFail;

const PARAM_INFO: Record<string, ParamInfo> = {
  url: {
    title: '真实目标',
    detail:
      'SafeLink 指向的原始地址，经过一层或多层百分号编码。这是本工具要还原的字段。',
    documented: true,
  },
  data: {
    title: '元数据',
    detail:
      '微软未公开的元数据。解码后通常是以竖线分隔的一串字段（版本号、租户或邮箱的 GUID、地址、数字等），但各字段含义没有官方文档，因此这里只解码展示，不解释、也不据此判断安全性。',
    documented: false,
  },
  sdata: {
    title: '完整性签名（未验证）',
    detail:
      '用于让 SafeLink 服务端确认该链接未被篡改的签名值。本工具不验证它：验证需要微软的公钥与签名算法，两者都未公开，纯前端无法做到，假装验证比不验证更糟。这里的值只是原样解码展示。',
    documented: false,
  },
  reserved: {
    title: '保留字段',
    detail: '微软保留的字段，观察到的取值几乎总是 0，含义未公开。',
    documented: false,
  },
};

/** Explains a parameter name, falling back to an honest "undocumented". */
export function explainParam(key: string): ParamInfo {
  return (
    PARAM_INFO[key] ?? {
      title: '未记录参数',
      detail:
        '微软未文档化这个参数。这里只做解码展示，不推测它的含义，也不把它当作安全信号。',
      documented: false,
    }
  );
}

/** True for the SafeLink hosts themselves, at any regional prefix. */
export function isSafelinkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === SAFELINK_BASE_DOMAIN || host.endsWith(`.${SAFELINK_BASE_DOMAIN}`);
}

/**
 * True for the Outlook-on-the-web mail wrapper that sometimes carries a
 * SafeLink.
 *
 * Microsoft does not document these redirect endpoints, so the check is
 * deliberately conservative: the host must be an Outlook web host *and* the
 * path must sit under `/mail`, and the wrapper is only treated as decodable
 * when it actually carries a `url` parameter. Anything else is reported as
 * unrecognised rather than guessed at.
 */
export function isOutlookMailWrapper(hostname: string, pathname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const outlookHost =
    host === 'outlook.office.com' ||
    host === 'outlook.office365.com' ||
    host.endsWith('.outlook.office.com') ||
    host.endsWith('.outlook.office365.com');
  if (!outlookHost) return false;
  return pathname.startsWith('/mail');
}

export interface PercentOutcome {
  text: string;
  /** Escapes such as `%zz` that are not valid percent-encoding. */
  invalid: string[];
}

/**
 * Percent-decodes, tolerating malformed escapes.
 *
 * `decodeURIComponent` throws on the first bad escape, which would throw away
 * everything that *was* readable. A paste from a ticket or a chat client often
 * loses a character, so the fallback decodes the valid stretches and leaves the
 * broken ones verbatim, reporting them so the caller can say the result is
 * partial instead of silently showing a wrong URL.
 */
export function decodePercent(text: string, plusMode: PlusMode): PercentOutcome {
  // The plus conversion belongs to the form-decoding layer, so it happens here
  // rather than at every call site; the strict mode is plain RFC 3986.
  const work = plusMode === 'space' ? text.split('+').join(' ') : text;

  try {
    return { text: decodeURIComponent(work), invalid: [] };
  } catch {
    return decodePercentLenient(work);
  }
}

/**
 * Decodes only the escapes that are well formed.
 *
 * Stretches are decoded separately so one broken escape cannot poison its
 * neighbours, and a stretch that survives as a whole but is not valid UTF-8
 * (a truncated multi-byte sequence pasted without its tail) falls back to a
 * byte-wise decode so the readable part around it is not thrown away.
 */
function decodePercentLenient(work: string): PercentOutcome {
  const invalid: string[] = [];
  let out = '';
  let chunk = '';

  const flush = () => {
    if (chunk === '') return;
    try {
      out += decodeURIComponent(chunk);
    } catch {
      out += decodePercentBytes(chunk);
      invalid.push(chunk);
    }
    chunk = '';
  };

  for (let index = 0; index < work.length; index += 1) {
    const char = work[index];
    if (char === '%') {
      const hex = work.slice(index + 1, index + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        chunk += work.slice(index, index + 3);
        index += 2;
        continue;
      }
      flush();
      invalid.push(work.slice(index, index + 3));
      out += '%';
      continue;
    }
    chunk += char;
  }
  flush();

  return { text: out, invalid };
}

/**
 * Byte-wise fallback for a stretch that is not valid UTF-8 as a whole.
 *
 * `TextEncoder` and `TextDecoder` are the WHATWG Encoding APIs, available in
 * Node as well as the browser, so the logic stays portable and testable. The
 * decoding is lenient: an incomplete sequence becomes U+FFFD rather than
 * aborting the whole value.
 */
function decodePercentBytes(chunk: string): string {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  let literal = '';

  const flushLiteral = () => {
    if (literal === '') return;
    for (const byte of encoder.encode(literal)) bytes.push(byte);
    literal = '';
  };

  for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk[index];
    if (char === '%') {
      const hex = chunk.slice(index + 1, index + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        flushLiteral();
        bytes.push(Number.parseInt(hex, 16));
        index += 2;
        continue;
      }
    }
    literal += char;
  }
  flushLiteral();

  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

/** Splits a query string into decoded parameters, keeping the raw text. */
export function splitQuery(search: string): SafelinkParam[] {
  const cleaned = search.startsWith('?') ? search.slice(1) : search;
  if (cleaned === '') return [];

  const params: SafelinkParam[] = [];
  for (const chunk of cleaned.split('&')) {
    if (chunk === '') continue;
    const equals = chunk.indexOf('=');
    const rawName = equals === -1 ? chunk : chunk.slice(0, equals);
    const rawValue = equals === -1 ? '' : chunk.slice(equals + 1);

    const name = decodePercent(rawName, 'space').text;
    const form = decodePercent(rawValue, 'space');
    const literal = decodePercent(rawValue, 'literal');

    params.push({
      name,
      key: name.toLowerCase(),
      raw: rawValue,
      formValue: form.text,
      literalValue: literal.text,
      ambiguousPlus: form.text !== literal.text,
      info: explainParam(name.toLowerCase()),
    });
  }

  return params;
}

interface DelveOutcome {
  value: string;
  passes: number;
  invalid: string[];
  /** True when the pass cap was reached while escapes remained. */
  limitHit: boolean;
}

/** A value is "decoded enough" once it looks like a URL again, or holds no escapes. */
function looksDecoded(value: string): boolean {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

/**
 * Repeatedly percent-decodes until the value looks like a URL again.
 *
 * One pass is not enough for a target that was encoded twice, which is common
 * when a link has been through a redirector before SafeLinks wrapped it. The
 * loop stops as soon as the value looks like a URL again, which is what keeps a
 * legitimate `%25` or `%3F` *inside* the destination intact: those decode once
 * and are then part of a perfectly good URL, so decoding them again would
 * corrupt the answer rather than help.
 */
function delve(raw: string, plusMode: PlusMode): DelveOutcome {
  const invalid: string[] = [];
  let value = raw;
  let passes = 0;
  let limitHit = false;

  for (;;) {
    if (passes > 0 && looksDecoded(value)) break;
    if (passes >= MAX_DECODE_PASSES) {
      limitHit = /%[0-9A-Fa-f]{2}/.test(value);
      break;
    }
    const step = decodePercent(value, plusMode);
    invalid.push(...step.invalid);
    if (step.text === value) break;
    value = step.text;
    passes += 1;
  }

  return { value, passes, invalid, limitHit };
}

/**
 * Removes characters that mail clients and chat tools wrap URLs in.
 *
 * Angle brackets come from `Link <https://...>` quoting, quotes from shell or
 * HTML copies, and a trailing period from prose. Leaving them on would make the
 * host lookup fail on a perfectly readable link.
 */
function trimEnvelope(input: string): { text: string; trimmed: boolean } {
  let text = input.trim();
  const before = text;
  text = text.replace(/^[<("']+/, '').replace(/[>)"']+$/, '');
  text = text.replace(/\.+$/, '');
  return { text: text.trim(), trimmed: text !== before };
}

function tryParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    // A copied link occasionally loses its scheme. Assume https, but only for
    // text that at least looks like host.tld: otherwise any prose would parse
    // as a URL (the parser accepts almost anything after https://) and the
    // error message would talk about a host that was never there.
    if (!/^[^\s/?#@]+\.[^\s/?#@]+/.test(input)) return null;
    try {
      return new URL(`https://${input}`);
    } catch {
      return null;
    }
  }
}

interface WrapperView {
  kind: SafelinkKind;
  host: string;
  url: URL;
  params: SafelinkParam[];
}

function readWrapper(text: string): WrapperView | null {
  const url = tryParseUrl(text);
  if (!url) return null;

  const host = url.hostname;
  if (isSafelinkHost(host)) {
    return { kind: 'safelinks-host', host, url, params: splitQuery(url.search) };
  }
  if (isOutlookMailWrapper(host, url.pathname)) {
    return { kind: 'outlook-wrapper', host, url, params: splitQuery(url.search) };
  }
  return null;
}

function firstUrlParam(params: SafelinkParam[]): SafelinkParam | undefined {
  return params.find((param) => param.key === 'url');
}

function fail(
  code: SafelinkErrorCode,
  error: string,
  warnings: SafelinkWarning[] = [],
): SafelinkFail {
  return { ok: false, code, error, warnings };
}

/**
 * Decodes a SafeLink URL to its destination.
 *
 * `options.plusMode` only changes how a bare `+` inside the `url` parameter is
 * read; `literal` is offered so the strict RFC 3986 reading can be compared,
 * which is what the UI does when it reports the ambiguity.
 */
export function decodeSafelink(
  input: string,
  options: { plusMode?: PlusMode } = {},
): SafelinkResult {
  const plusMode = options.plusMode ?? 'space';
  const warnings: SafelinkWarning[] = [];

  if (typeof input !== 'string' || input.trim() === '') {
    return fail('empty', '请输入一个 SafeLink URL。');
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return fail(
      'too-long',
      `输入长度为 ${input.length} 个字符，超过上限 ${MAX_INPUT_LENGTH}。SafeLink 通常只有几百个字符，请确认粘贴的内容是否正确。`,
    );
  }

  // Mail bodies escape the ampersands as `&amp;`; undo that before parsing or
  // every parameter after the first would be misread.
  let text = input;
  if (/&amp;/i.test(text)) {
    text = text.replace(/&amp;/gi, '&');
    warnings.push({
      code: 'html-escaped',
      message: '输入里含有 HTML 转义（&amp;），已先还原为 & 再解析。',
    });
  }

  const envelope = trimEnvelope(text);
  if (envelope.trimmed) {
    warnings.push({
      code: 'trimmed-envelope',
      message: '已去掉复制时带上的外层字符（尖括号、引号或句末句点）。',
    });
  }
  text = envelope.text;

  const first = readWrapper(text);
  if (!first) {
    const parsed = tryParseUrl(text);
    if (!parsed) {
      return fail('not-url', '这不是一个可以解析的 URL。', warnings);
    }
    return fail(
      'not-safelink',
      `主机 ${parsed.hostname} 不是 SafeLink 域名（safelinks.protection.outlook.com）也不是 outlook.office.com 的邮件包装链接。`,
      warnings,
    );
  }

  const layers: SafelinkLayer[] = [];
  let current: WrapperView = first;
  let truncated = false;

  for (let layerNumber = 1; layerNumber <= MAX_WRAPPER_LAYERS; layerNumber += 1) {
    const urlParams = current.params.filter((param) => param.key === 'url');
    if (urlParams.length === 0) {
      return fail(
        'missing-url',
        current.kind === 'outlook-wrapper'
          ? `${current.host} 的邮件包装链接里没有 url 参数，无法定位目标。这里不会去请求该链接。`
          : 'SafeLink 里没有 url 参数，无法还原目标。',
        warnings,
      );
    }
    if (urlParams.length > 1) {
      warnings.push({
        code: 'multiple-url-params',
        message: `这个包装里出现了 ${urlParams.length} 个 url 参数，只使用第一个，其余原样列出。`,
      });
    }

    const chosen = urlParams[0];
    if (chosen.raw === '') {
      return fail('empty-url', 'url 参数存在但为空，没有可还原的目标。', warnings);
    }

    const form = delve(chosen.raw, plusMode);
    const strict = delve(chosen.raw, 'literal');

    if (chosen.ambiguousPlus) {
      warnings.push({
        code: 'ambiguous-plus',
        message:
          'url 参数里有未转义的 +。按表单规则它表示空格，按严格规则它是字面加号，两种读法都已给出。',
      });
    }
    if (form.invalid.length > 0) {
      warnings.push({
        code: 'malformed-percent',
        message: `url 参数里有 ${form.invalid.length} 处无法解码的转义或字节序列，这些位置原样保留，还原结果可能不完整。`,
      });
    }
    if (form.limitHit || strict.limitHit) {
      warnings.push({
        code: 'decode-limit',
        message: `解码达到 ${MAX_DECODE_PASSES} 层上限后仍存在转义序列，可能还有更多层编码。`,
      });
    }
    if (form.passes > 1) {
      warnings.push({
        code: 'double-encoded',
        message: `url 参数被编码了 ${form.passes} 层，已逐层解码（只解一次会留下 %xx 残渣）。`,
      });
    }

    layers.push({
      layer: layerNumber,
      kind: current.kind,
      host: current.host,
      wrapper: current.url.href,
      rawUrl: chosen.raw,
      passes: form.passes,
      target: form.value,
      targetLiteral: strict.value,
      params: current.params,
      invalidEscapes: form.invalid,
    });

    const next = readWrapper(form.value);
    if (!next) break;
    if (!firstUrlParam(next.params)) {
      // The destination is itself on a SafeLink host but carries no url
      // parameter, so there is nothing left to unwrap. Keep the successful
      // result and say so rather than turning it into a failure.
      warnings.push({
        code: 'nested-safelink',
        message: `第 ${layerNumber} 层还原出的目标位于 SafeLink 域名上，但没有 url 参数，无法继续还原。`,
      });
      break;
    }

    warnings.push({
      code: 'nested-safelink',
      message: `第 ${layerNumber} 层还原出的目标本身还是一个 SafeLink，继续还原下一层。`,
    });

    if (layerNumber === MAX_WRAPPER_LAYERS) {
      truncated = true;
      warnings.push({
        code: 'recursion-limit',
        message: `已达到 ${MAX_WRAPPER_LAYERS} 层包装上限，停止继续还原；目标可能仍是一个 SafeLink。`,
      });
      break;
    }

    current = next;
  }

  if (first.kind === 'outlook-wrapper') {
    warnings.push({
      code: 'outlook-wrapper-unconfirmed',
      message:
        '这是 outlook.office.com 的邮件包装链接，不是 SafeLink 域名。微软没有公开这类跳转端点的格式，这里只因为它带 url 参数才尝试解码。',
    });
  }

  const outermost = layers[0];
  const last = layers[layers.length - 1];

  // Check the destination the user will actually read, not the first layer's
  // target (which for a nested wrapper is another absolute SafeLink).
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(last.target)) {
    warnings.push({
      code: 'target-not-absolute',
      message:
        '还原出来的目标没有协议前缀，可能仍是残缺的编码，也可能本来就不是绝对 URL，请自行核对。',
    });
  }

  return {
    ok: true,
    kind: outermost.kind,
    host: outermost.host,
    target: last.target,
    targetLiteral: last.targetLiteral,
    layers,
    truncated,
    signatureVerified: false,
    warnings,
    params: outermost.params,
  };
}

/**
 * Splits the decoded `data` value into its pipe-separated fields.
 *
 * Only the splitting is offered. The fields are shown as "field N" because
 * Microsoft never documented what they contain; naming them would be a guess
 * presented as a fact.
 */
export function splitDataFields(value: string): string[] {
  if (value === '') return [];
  return value.split('|');
}
