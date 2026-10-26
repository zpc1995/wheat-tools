/**
 * WebRTC push/pull test arithmetic, parsing and formatting.
 *
 * Nothing in this file touches React, the DOM, a clock or the network. That is
 * deliberate: the interesting parts of a WHIP/WHEP client — URL validation, SDP
 * inspection, response classification, interval statistics and the diagnostic
 * report — are exactly the parts that cannot be exercised in Node once they are
 * entangled with `RTCPeerConnection` or `fetch`. Keeping them here means
 * `scripts/check-webrtc-tester.mjs` can check them against real captured SDP and
 * hand-built counter snapshots.
 *
 * ## Where the protocol behaviour comes from
 *
 * WHIP and WHEP are both specified in RFC 9725 (the two protocols share one
 * specification). The parts this tool implements are small and are quoted where
 * they matter:
 *
 *   - The client sends `POST` with `Content-Type: application/sdp` whose body is
 *     an SDP offer. For WHIP that offer carries media the client sends; for WHEP
 *     it is a receive-only offer.
 *   - A successful creation is reported as `201 Created` with a `Location`
 *     header naming the resource. `200 OK` is accepted here as well because some
 *     deployments do that, but it is called out as non-standard rather than
 *     silently treated as normal.
 *   - The client releases the resource with `DELETE` on that `Location` URL.
 *   - The answer is SDP in the response body, which the client applies with
 *     `setRemoteDescription`.
 *
 * What the specification does **not** provide is a guarantee that media actually
 * arrives: this tool reports what `getStats` reports and nothing more.
 */

// ---------------------------------------------------------------------------
// Endpoint validation
// ---------------------------------------------------------------------------

export type EndpointResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Trims and validates a WHIP or WHEP endpoint.
 *
 * Only `http:` and `https:` are accepted. A WebRTC endpoint is a normal HTTP
 * resource even though the media is not HTTP, so `ws://` or a bare host is a
 * mistake worth reporting before the browser produces a much less specific
 * `TypeError`. `URL` itself is used as the parser so host case, default ports
 * and path escaping are normalised exactly as the browser would normalise them;
 * the path is otherwise left alone, including a trailing slash, because some
 * deployments distinguish the two and normalising it away could break them.
 */
export function normalizeEndpoint(text: string): EndpointResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, error: '请填写地址，例如 https://your-server:8080/whip。' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: '地址不是完整的 URL。请包含协议，例如 https://your-server:8080/whip。',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `不支持 ${parsed.protocol} 协议。WHIP/WHEP 端点必须是 http:// 或 https:// 地址。`,
    };
  }

  if (parsed.hostname === '') {
    return { ok: false, error: '地址缺少主机名。' };
  }

  return { ok: true, url: parsed.toString() };
}

/** A heuristic only: the endpoint is never rejected because of its path. */
export type WhipWhepPathKind = 'whip' | 'whep' | 'unknown';

/**
 * Guesses whether a URL looks like a WHIP or WHEP endpoint from its path.
 *
 * RFC 9725 does not prescribe any path at all, so this is a hint for the user,
 * not a validation rule. Servers commonly expose `/whip` and `/whep`, but SRS
 * uses `/rtc/v1/whip/`, mediamtx uses `/<path>/whip`, and a gateway may use
 * anything else. The caller must therefore show the hint and continue.
 */
export function isWhipWhepPath(url: string): WhipWhepPathKind {
  let pathname: string;
  try {
    pathname = new URL(url.trim()).pathname;
  } catch {
    return 'unknown';
  }
  const last = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const lower = last.toLowerCase();
  if (lower === 'whip') return 'whip';
  if (lower === 'whep') return 'whep';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// webrtc:// addresses: parsing and WHEP endpoint derivation
// ---------------------------------------------------------------------------

/**
 * Why a `webrtc://` address needs translating before it can be used here.
 *
 * Browsers cannot open a `webrtc://` URL. That spelling is a console
 * convention: every media server exposes WebRTC playback as an ordinary HTTP
 * WHEP endpoint, and the path template differs per server. A user who copies
 * `webrtc://host/live/streamA` from a server console therefore needs it turned
 * into the HTTP endpoint that server actually serves.
 *
 * The two built-in templates map that address as follows:
 *
 *   - SRS (6 and later): `http(s)://host/rtc/v1/whep/?app=live&stream=streamA`
 *   - mediamtx:          `http(s)://host:8889/live/streamA/whep`
 *
 * ZLMediaKit is deliberately absent. Its WHEP path differs from both of these
 * and has changed between versions, so guessing would produce a plausible but
 * wrong endpoint; it goes through the custom template instead.
 *
 * Everything below is pure: no request is made and nothing is looked up over
 * the network. Deriving an endpoint is a string transformation the user can
 * check before connecting, which is exactly what makes it debuggable.
 */

/** A parsed `webrtc://` address. Only `ok: true` values reach the builder. */
export interface WebrtcAddress {
  ok: true;
  /** Host without the port. An IPv6 literal keeps its brackets for use in a URL. */
  host: string;
  /** Explicit port from the address, or null when it had none. */
  port: number | null;
  /** First path segment, percent-decoded. */
  app: string;
  /** Second path segment, percent-decoded. */
  stream: string;
  /** True for `webrtcs://`, which means HTTPS. */
  secure: boolean;
  /** Raw query string including the leading `?`, or an empty string. */
  search: string;
}

export type WebrtcAddressResult = WebrtcAddress | { ok: false; error: string };

/**
 * Detects the prefix that switches the pull panel into derivation mode.
 *
 * Detection is prefix-only on purpose: anything else is treated as a complete
 * HTTP endpoint and goes through `normalizeEndpoint`, so an existing workflow
 * cannot be changed by this feature.
 */
export function isWebrtcUrlInput(text: string): boolean {
  return /^webrtcs?:\/\//i.test(text.trim());
}

const URL_SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\.?$/;
const IPV6_HOST_RE = /^\[[0-9A-Fa-f:.]+\]$/;

/**
 * Parses `webrtc[s]://host[:port]/app/stream[?query]`.
 *
 * Decisions that are visible to the user, and why they were made:
 *
 *   - A trailing slash is accepted and ignored: `/live/streamA/` names the same
 *     stream as `/live/streamA`. Rejecting it would fail on a trailing slash
 *     copied from a console without any benefit.
 *   - Deeper paths (`/live/sub/stream`) are rejected rather than guessed at.
 *     SRS and mediamtx both key a stream by exactly an app and a name, so a
 *     third segment has no place in either template. Dropping it silently would
 *     derive an endpoint for a stream the user did not name; the error points
 *     at the HTTP endpoint field instead, which is the right escape hatch.
 *   - Path segments are percent-decoded here and re-encoded by `buildEndpoint`,
 *     which keeps a name with spaces or Chinese intact through the round trip.
 *   - A fragment is discarded: it never reaches an HTTP server.
 *
 * The port is validated rather than passed to `URL`, because a generic URL error
 * would not tell the user which part of the address was wrong. `URL` is also not
 * used for the whole parse: for a non-special scheme it happily accepts forms
 * this syntax should reject, such as an empty authority before the first slash.
 */
export function parseWebrtcUrl(text: string): WebrtcAddressResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return {
      ok: false,
      error: '请填写 webrtc:// 地址，例如 webrtc://example.com/live/streamA。',
    };
  }

  const schemeMatch = URL_SCHEME_RE.exec(trimmed);
  if (schemeMatch === null) {
    return {
      ok: false,
      error:
        '地址缺少协议。请写成 webrtc://host/app/stream（用 webrtcs:// 表示 HTTPS）；' +
        '完整的 HTTP WHEP 端点请直接用 http(s):// 填写。',
    };
  }

  const scheme = schemeMatch[1].toLowerCase();
  if (scheme !== 'webrtc' && scheme !== 'webrtcs') {
    return {
      ok: false,
      error: `不支持 ${scheme}: 协议。这个输入只解析 webrtc:// 或 webrtcs:// 地址；完整的 HTTP WHEP 端点请直接用 http(s):// 填写。`,
    };
  }

  const afterScheme = trimmed.slice(schemeMatch[0].length);
  if (!afterScheme.startsWith('//')) {
    return {
      ok: false,
      error: `${scheme}: 后面必须紧跟 //，例如 ${scheme}://example.com/live/streamA。`,
    };
  }

  let rest = afterScheme.slice(2);

  const hashIndex = rest.indexOf('#');
  if (hashIndex !== -1) rest = rest.slice(0, hashIndex);

  let search = '';
  const queryIndex = rest.indexOf('?');
  if (queryIndex !== -1) {
    search = rest.slice(queryIndex);
    rest = rest.slice(0, queryIndex);
  }

  const slashIndex = rest.indexOf('/');
  const authority = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  const pathText = slashIndex === -1 ? '' : rest.slice(slashIndex);

  if (authority === '') {
    return {
      ok: false,
      error: '地址缺少主机名（host），例如 webrtc://example.com/live/streamA。',
    };
  }

  if (authority.includes('@')) {
    return {
      ok: false,
      error: '地址不能包含用户名或密码。webrtc:// 地址只接受 host[:port]/app/stream。',
    };
  }

  let host = authority;
  let portText: string | null = null;

  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close === -1) {
      return { ok: false, error: `主机名里的 IPv6 地址缺少右方括号：${authority}` };
    }
    host = authority.slice(0, close + 1);
    const tail = authority.slice(close + 1);
    if (tail !== '') {
      if (!tail.startsWith(':')) {
        return { ok: false, error: `主机名与端口之间只能有一个冒号：${authority}` };
      }
      portText = tail.slice(1);
    }
    if (!IPV6_HOST_RE.test(host)) {
      return { ok: false, error: `主机名里的 IPv6 地址不合法：${host}` };
    }
  } else {
    const colon = authority.indexOf(':');
    if (colon !== -1) {
      if (authority.indexOf(':', colon + 1) !== -1) {
        return {
          ok: false,
          error: 'IPv6 地址必须用方括号包起来，例如 webrtc://[::1]/live/streamA。',
        };
      }
      host = authority.slice(0, colon);
      portText = authority.slice(colon + 1);
    }
    if (host === '' || !HOSTNAME_RE.test(host)) {
      return {
        ok: false,
        error: `主机名不合法：${host === '' ? '（空）' : host}。只接受常规主机名、IPv4，或用方括号包起来的 IPv6。`,
      };
    }
    host = host.toLowerCase();
  }

  let port: number | null = null;
  if (portText !== null) {
    if (!/^\d+$/.test(portText)) {
      return {
        ok: false,
        error: `端口不合法：${portText === '' ? '（空）' : portText}。端口必须是 1-65535 之间的整数。`,
      };
    }
    const value = Number.parseInt(portText, 10);
    if (!Number.isFinite(value) || value < 1 || value > 65535) {
      return {
        ok: false,
        error: `端口不合法：${portText}。端口必须是 1-65535 之间的整数。`,
      };
    }
    port = value;
  }

  const segments: string[] = [];
  for (const raw of pathText.split('/')) {
    if (raw === '') continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return { ok: false, error: `路径里的百分号编码无法解码：${raw}` };
    }
  }

  if (segments.length === 0) {
    return {
      ok: false,
      error:
        '地址缺少 app 与 stream 两段路径，例如 webrtc://example.com/live/streamA 里的 live 与 streamA。',
    };
  }
  if (segments.length === 1) {
    return {
      ok: false,
      error: `地址只有一段路径（app="${segments[0]}"），缺少 stream。需要 webrtc://host/app/stream 两段。`,
    };
  }
  if (segments.length > 2) {
    return {
      ok: false,
      error:
        `地址有 ${segments.length} 段路径，而 webrtc://host/app/stream 只定义 app 与 stream 两段。` +
        '多段路径无法安全套用 SRS/mediamtx 模板，请直接填写服务端真实的 HTTP WHEP 端点。',
    };
  }

  const [app, stream] = segments;
  if (app.trim() === '' || stream.trim() === '') {
    return { ok: false, error: 'app 与 stream 都不能为空。' };
  }

  return {
    ok: true,
    host,
    port,
    app,
    stream,
    secure: scheme === 'webrtcs',
    search,
  };
}

export type WebrtcEndpointKind = 'srs' | 'mediamtx' | 'custom';

export interface WebrtcEndpointOptions {
  kind: WebrtcEndpointKind;
  /** Explicit HTTP port; wins over the port in the address when supplied. */
  httpPort?: number | null;
  /** Required when `kind` is custom; supports the documented placeholders. */
  customTemplate?: string;
}

export type WebrtcEndpointResult =
  | { ok: true; url: string; notes: string[] }
  | { ok: false; error: string };

/** Appends a query string without producing `?&` on a template that ends in `?`. */
function appendSearch(url: string, search: string): string {
  if (search === '') return url;
  if (url.endsWith('?') || url.endsWith('&')) return `${url}${search.slice(1)}`;
  return url.includes('?') ? `${url}&${search.slice(1)}` : `${url}${search}`;
}

/**
 * Fills the custom template's placeholders.
 *
 * `{port}` is replaced together with a preceding colon, so `host:{port}` turns
 * into `host` rather than `host:` when the port is unknown. App and stream are
 * encoded as single path/query components: a template is expected to place them
 * where a segment belongs, and raw spaces or `&` would otherwise change the URL
 * structure the user wrote.
 */
function fillCustomTemplate(
  template: string,
  values: { scheme: string; host: string; app: string; stream: string; port: number | null },
): string {
  const portText = values.port === null ? '' : String(values.port);
  const encoded = {
    app: encodeURIComponent(values.app),
    stream: encodeURIComponent(values.stream),
  };
  const withoutEmptyPortColon = template.replace(
    /:\{port\}/g,
    portText === '' ? '' : `:${portText}`,
  );
  return withoutEmptyPortColon.replace(
    /\{(scheme|host|port|app|stream)\}/g,
    (match: string, key: string) => {
      switch (key) {
        case 'scheme':
          return values.scheme;
        case 'host':
          return values.host;
        case 'port':
          return portText;
        case 'app':
          return encoded.app;
        case 'stream':
          return encoded.stream;
        default:
          return match;
      }
    },
  );
}

/**
 * Turns a parsed address into the HTTP endpoint a WHEP POST can target.
 *
 * Port rules, which are the part users get wrong most often:
 *
 *   - `httpPort` always wins when supplied, because many deployments serve
 *     signalling and the WHEP endpoint on different ports.
 *   - Otherwise the port written in the webrtc:// address is used.
 *   - Otherwise the built-in templates fall back to 80 for http and 443 for
 *     https, and a note says so together with the port the server usually uses.
 *
 * A custom template receives `{port}` empty when neither `httpPort` nor the
 * address supplied one. Injecting 80/443 there would silently rewrite a template
 * that deliberately relies on the scheme default, so the empty value is kept and
 * explained in a note instead.
 *
 * The result is always re-parsed with `URL` (and normalised by it, which drops a
 * redundant default port), so a template that produces something which is not an
 * http(s) URL is reported instead of handed to `fetch`.
 */
export function buildEndpoint(
  parsed: WebrtcAddress,
  options: WebrtcEndpointOptions,
): WebrtcEndpointResult {
  const notes: string[] = [];
  const scheme = parsed.secure ? 'https' : 'http';
  const defaultPort = parsed.secure ? 443 : 80;

  if (!parsed.secure) {
    notes.push(
      'webrtc:// 按 HTTP 推导（端点以 http:// 开头）；若该服务端只开放 HTTPS，请改用 webrtcs://。',
    );
  }

  let explicitPort: number | null = null;
  const rawPort = options.httpPort;
  if (rawPort !== undefined && rawPort !== null) {
    if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
      return {
        ok: false,
        error: `HTTP 端口不合法：${String(rawPort)}。端口必须是 1-65535 之间的整数。`,
      };
    }
    explicitPort = rawPort;
  }

  const customTemplate = (options.customTemplate ?? '').trim();
  if (options.kind === 'custom' && customTemplate === '') {
    return {
      ok: false,
      error: '选择了自定义模板，但模板是空的。请填写例如 http://{host}:{port}/{app}/{stream}/whep。',
    };
  }

  let port: number | null;
  if (options.kind === 'custom') {
    port = explicitPort ?? parsed.port;
    if (port === null) {
      notes.push(
        `模板里的 {port} 为空：端点不带端口，浏览器按 ${scheme} 默认端口 ${defaultPort} 访问；` +
          `若服务端 HTTP 不在 ${defaultPort}，请填「HTTP 端口」，或在模板里把端口写死。`,
      );
    } else if (explicitPort !== null && parsed.port !== null && parsed.port !== explicitPort) {
      notes.push(
        `已用「HTTP 端口」${explicitPort} 覆盖地址里的 ${parsed.port}；地址原端口不用于 WHEP 端点。`,
      );
    } else if (explicitPort !== null) {
      notes.push(`已使用填写的 HTTP 端口 ${explicitPort}。`);
    } else {
      notes.push(
        `使用地址里的端口 ${port} 作为 HTTP 端口；若 WHEP 端口与信令端口不同，请填「HTTP 端口」覆盖。`,
      );
    }
    if (!/\{host\}/.test(customTemplate)) {
      notes.push('模板里没有 {host} 占位符，推导结果不会包含地址中的主机名。');
    }
  } else {
    port = explicitPort ?? parsed.port ?? defaultPort;
    const usualPort = options.kind === 'mediamtx' ? '8889' : '8080';
    if (explicitPort !== null) {
      if (parsed.port !== null && parsed.port !== explicitPort) {
        notes.push(
          `已用「HTTP 端口」${explicitPort} 覆盖地址里的 ${parsed.port}；地址原端口不用于 WHEP 端点。`,
        );
      } else {
        notes.push(`已使用填写的 HTTP 端口 ${explicitPort}。`);
      }
    } else if (parsed.port !== null) {
      notes.push(
        `地址带了端口 ${parsed.port}，按它作为 HTTP 端口推导；` +
          '很多部署的 WHEP 端口与信令端口不同，若不对请填「HTTP 端口」覆盖。',
      );
    } else {
      notes.push(
        `URL 未指定端口，按 HTTP 默认端口 ${defaultPort} 推导；` +
          `若服务端 HTTP 在 ${usualPort}，请把「HTTP 端口」填成 ${usualPort}。`,
      );
    }
    if (options.kind === 'srs') {
      notes.push('按 SRS 6+ 的 /rtc/v1/whep/?app={app}&stream={stream} 模板推导。');
    } else {
      notes.push(
        '按 mediamtx 的 /{app}/{stream}/whep 路径模板推导；mediamtx 的 WHEP 默认在 8889 端口，' +
          '版本不同路径若有变化请改用自定义模板。',
      );
    }
  }

  let filled: string;
  const hostPart = port === null ? parsed.host : `${parsed.host}:${port}`;
  if (options.kind === 'srs') {
    filled =
      `${scheme}://${hostPart}/rtc/v1/whep/` +
      `?app=${encodeURIComponent(parsed.app)}&stream=${encodeURIComponent(parsed.stream)}`;
  } else if (options.kind === 'mediamtx') {
    filled =
      `${scheme}://${hostPart}/${encodeURIComponent(parsed.app)}/` +
      `${encodeURIComponent(parsed.stream)}/whep`;
  } else {
    filled = fillCustomTemplate(customTemplate, {
      scheme,
      host: parsed.host,
      app: parsed.app,
      stream: parsed.stream,
      port,
    });
  }

  const withSearch = appendSearch(filled, parsed.search);
  if (parsed.search !== '') {
    notes.push(
      `地址里的查询串 ${parsed.search} 已原样附加到端点；如果服务端不认这些参数，请从地址里去掉。`,
    );
  }

  let url: URL;
  try {
    url = new URL(withSearch);
  } catch {
    return {
      ok: false,
      error: `推导结果不是合法的 URL：${withSearch}。请检查自定义模板里的占位符与协议。`,
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      error: `推导结果的协议是 ${url.protocol}，不是 http/https。请检查自定义模板是否以 http(s):// 或 {scheme}:// 开头。`,
    };
  }
  if (url.hostname === '') {
    return { ok: false, error: `推导结果缺少主机名：${withSearch}` };
  }

  return { ok: true, url: url.toString(), notes };
}

/** The RTMP push address and ffmpeg command shown next to a webrtc:// address. */
export interface RtmpHint {
  rtmpUrl: string;
  ffmpegCommand: string;
}

/**
 * Builds the RTMP hint for a parsed address.
 *
 * This is help text only: the tool never pushes RTMP and cannot, since a browser
 * has no RTMP stack. The address deliberately carries no port even when the
 * webrtc:// address did: RTMP defaults to 1935, and the port in the webrtc://
 * address is the signalling/HTTP port, so reusing it would point at the wrong
 * service. App and stream are percent-encoded so the command can be pasted
 * into a shell unchanged, and `input.mp4` is a placeholder for a real file.
 */
export function buildRtmpHint(parsed: WebrtcAddress): RtmpHint {
  const rtmpUrl =
    `rtmp://${parsed.host}/${encodeURIComponent(parsed.app)}/` +
    `${encodeURIComponent(parsed.stream)}`;
  return {
    rtmpUrl,
    ffmpegCommand: `ffmpeg -re -stream_loop -1 -i input.mp4 -c copy -f flv ${rtmpUrl}`,
  };
}

// ---------------------------------------------------------------------------
// SDP parsing
// ---------------------------------------------------------------------------

export type SdpDirection = 'sendonly' | 'recvonly' | 'sendrecv' | 'inactive';

export interface SdpCodec {
  payloadType: number;
  encodingName: string;
  clockRate: number;
  /** Explicit channel count, or 1 for audio when the SDP omits it. */
  channels: number | null;
  fmtp: string | null;
}

export interface SdpMediaSection {
  kind: string;
  port: number;
  protocol: string;
  mid: string | null;
  /**
   * The direction that actually applies to this section.
   *
   * RFC 8866 (SDP) says a media section with no direction attribute inherits the
   * session-level direction, and that the default when neither is present is
   * `sendrecv`. Getting this default wrong would make every ordinary Chromium
   * offer look direction-less, so it is resolved here rather than guessed by the
   * caller.
   */
  direction: SdpDirection;
  formats: number[];
  codecs: SdpCodec[];
  iceUfrag: string | null;
  fingerprint: string | null;
  candidateCount: number;
}

export interface ParsedSdp {
  /** True for a syntactically plausible session: `v=0` plus at least one m line. */
  valid: boolean;
  session: {
    iceUfrag: string | null;
    fingerprint: string | null;
    candidateCount: number;
    /** Session-level direction, before the media-level default is applied. */
    direction: SdpDirection | null;
  };
  media: SdpMediaSection[];
  warnings: string[];
}

const DIRECTION_VALUES: readonly SdpDirection[] = [
  'sendonly',
  'recvonly',
  'sendrecv',
  'inactive',
];

function directionFromAttribute(line: string): SdpDirection | null {
  if (!line.startsWith('a=')) return null;
  const value = line.slice(2).trim();
  for (const direction of DIRECTION_VALUES) {
    if (value === direction) return direction;
  }
  return null;
}

interface SectionDraft {
  kind: string;
  port: number;
  protocol: string;
  mid: string | null;
  direction: SdpDirection | null;
  formats: number[];
  codecsByPayload: Map<number, SdpCodec>;
  /** fmtp lines that appeared before their rtpmap, applied when the section ends. */
  fmtpByPayload: Map<number, string>;
  iceUfrag: string | null;
  fingerprint: string | null;
  candidateCount: number;
}

function buildSection(draft: SectionDraft, sessionDirection: SdpDirection | null): SdpMediaSection {
  const codecs: SdpCodec[] = [];
  for (const payloadType of draft.formats) {
    const codec = draft.codecsByPayload.get(payloadType);
    if (codec !== undefined) {
      const fmtp = codec.fmtp ?? draft.fmtpByPayload.get(payloadType) ?? null;
      codecs.push(fmtp === codec.fmtp ? codec : { ...codec, fmtp });
    }
  }
  return {
    kind: draft.kind,
    port: draft.port,
    protocol: draft.protocol,
    mid: draft.mid,
    direction: draft.direction ?? sessionDirection ?? 'sendrecv',
    formats: [...draft.formats],
    codecs,
    iceUfrag: draft.iceUfrag,
    fingerprint: draft.fingerprint,
    candidateCount: draft.candidateCount,
  };
}

/**
 * Parses the SDP fields this tool shows.
 *
 * This is not a general SDP implementation. It extracts the media sections, the
 * effective direction, the payload-type table, the ICE credentials, the
 * fingerprint and the candidate count — enough to explain what was negotiated
 * without pulling in a parser dependency. Unknown attributes are ignored rather
 * than rejected, because an answer from a real server is full of attributes this
 * tool has no opinion about.
 *
 * Line endings are normalised: SDP is defined with CRLF, but browsers and test
 * fixtures hand out bare LF just as often, and a parser that only accepts CRLF
 * fails on data that works fine in the browser.
 */
export function parseSdp(sdp: string): ParsedSdp {
  const warnings: string[] = [];
  const lines = sdp
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());

  let hasVersion = false;
  let sessionDirection: SdpDirection | null = null;
  let sessionUfrag: string | null = null;
  let sessionFingerprint: string | null = null;
  let sessionCandidates = 0;
  let draft: SectionDraft | null = null;
  const media: SdpMediaSection[] = [];

  const finishDraft = () => {
    if (draft !== null) {
      media.push(buildSection(draft, sessionDirection));
      draft = null;
    }
  };

  for (const line of lines) {
    if (line === '') continue;

    if (line.startsWith('m=')) {
      finishDraft();
      const parts = line.slice(2).trim().split(/\s+/);
      if (parts.length < 3) {
        warnings.push(`无法解析的媒体行：${line}`);
        continue;
      }
      const formats = parts
        .slice(3)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value));
      draft = {
        kind: parts[0],
        port: Number.parseInt(parts[1].split('/')[0], 10) || 0,
        protocol: parts[2],
        mid: null,
        direction: null,
        formats,
        codecsByPayload: new Map<number, SdpCodec>(),
        fmtpByPayload: new Map<number, string>(),
        iceUfrag: null,
        fingerprint: null,
        candidateCount: 0,
      };
      continue;
    }

    if (line === 'v=0') {
      hasVersion = true;
      continue;
    }

    const direction = directionFromAttribute(line);
    if (direction !== null) {
      if (draft === null) sessionDirection = direction;
      else draft.direction = direction;
      continue;
    }

    if (line.startsWith('a=ice-ufrag:')) {
      const value = line.slice('a=ice-ufrag:'.length).trim();
      if (draft === null) sessionUfrag = value;
      else draft.iceUfrag = value;
      continue;
    }

    if (line.startsWith('a=fingerprint:')) {
      const value = line.slice('a=fingerprint:'.length).trim();
      if (draft === null) sessionFingerprint = value;
      else draft.fingerprint = value;
      continue;
    }

    if (line.startsWith('a=candidate:')) {
      if (draft === null) sessionCandidates += 1;
      else draft.candidateCount += 1;
      continue;
    }

    if (line.startsWith('a=mid:')) {
      if (draft !== null) draft.mid = line.slice('a=mid:'.length).trim();
      continue;
    }

    if (line.startsWith('a=rtpmap:')) {
      if (draft === null) continue;
      const rest = line.slice('a=rtpmap:'.length);
      const match = /^(\d+)\s+([^/\s]+)\/(\d+)(?:\/(\d+))?/.exec(rest);
      if (!match) {
        warnings.push(`无法解析的 rtpmap：${line}`);
        continue;
      }
      const payloadType = Number.parseInt(match[1], 10);
      const clockRate = Number.parseInt(match[3], 10);
      const explicitChannels = match[4] === undefined ? null : Number.parseInt(match[4], 10);
      draft.codecsByPayload.set(payloadType, {
        payloadType,
        encodingName: match[2],
        clockRate,
        channels: explicitChannels ?? (draft.kind === 'audio' ? 1 : null),
        fmtp: null,
      });
      continue;
    }

    if (line.startsWith('a=fmtp:')) {
      if (draft === null) continue;
      const rest = line.slice('a=fmtp:'.length);
      const match = /^(\d+)\s+(.*)$/.exec(rest);
      if (!match) continue;
      const payloadType = Number.parseInt(match[1], 10);
      const value = match[2].trim();
      const codec = draft.codecsByPayload.get(payloadType);
      if (codec !== undefined) codec.fmtp = value;
      else draft.fmtpByPayload.set(payloadType, value);
    }
  }

  finishDraft();

  // Session-level ICE attributes act as a fallback for sections that omit them.
  const resolved = media.map((section) => ({
    ...section,
    iceUfrag: section.iceUfrag ?? sessionUfrag,
    fingerprint: section.fingerprint ?? sessionFingerprint,
  }));

  if (!hasVersion) warnings.push('缺少 v=0 版本行，这不像是合法的 SDP。');
  if (resolved.length === 0) warnings.push('没有找到 m= 媒体段。');

  return {
    valid: hasVersion && resolved.length > 0,
    session: {
      iceUfrag: sessionUfrag,
      fingerprint: sessionFingerprint,
      candidateCount: sessionCandidates,
      direction: sessionDirection,
    },
    media: resolved,
    warnings,
  };
}

export interface PrimaryCodec {
  kind: string;
  encodingName: string;
  clockRate: number;
  channels: number | null;
  payloadType: number;
}

/**
 * Codecs that are transport plumbing rather than media worth naming in a report.
 *
 * RTX carries retransmissions, RED and ULPFEC carry repair data, CN is comfort
 * noise and telephone-event is DTMF. Listing them as "negotiated codecs" would
 * bury the answer to the question the user is asking.
 */
const NON_PRIMARY_CODECS = new Set([
  'rtx',
  'red',
  'ulpfec',
  'flexfec',
  'flexfec-03',
  'cn',
  'telephone-event',
]);

/** Media codecs actually present in the SDP, deduplicated by kind and format. */
export function primaryCodecs(parsed: ParsedSdp): PrimaryCodec[] {
  const seen = new Set<string>();
  const result: PrimaryCodec[] = [];
  for (const section of parsed.media) {
    for (const codec of section.codecs) {
      if (NON_PRIMARY_CODECS.has(codec.encodingName.toLowerCase())) continue;
      const key = `${section.kind}|${codec.encodingName.toLowerCase()}|${codec.clockRate}|${
        codec.channels ?? ''
      }`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: section.kind,
        encodingName: codec.encodingName,
        clockRate: codec.clockRate,
        channels: codec.channels,
        payloadType: codec.payloadType,
      });
    }
  }
  return result;
}

/** A compact human-readable codec summary, used in the UI and the report. */
export function formatCodecSummary(parsed: ParsedSdp): string {
  const codecs = primaryCodecs(parsed);
  if (codecs.length === 0) return '未识别到媒体编解码器';
  return codecs
    .map((codec) => {
      const kind = codec.kind === 'video' ? '视频' : codec.kind === 'audio' ? '音频' : codec.kind;
      const channels =
        codec.kind === 'audio' && codec.channels !== null ? `/${codec.channels}` : '';
      return `${kind} ${codec.encodingName}/${codec.clockRate}${channels}`;
    })
    .join('，');
}

/** True when SDP text looks like a complete session rather than an error page. */
export function looksLikeSdp(text: string): boolean {
  return parseSdp(text).valid;
}

// ---------------------------------------------------------------------------
// Codec preference and capture planning
// ---------------------------------------------------------------------------

export type CodecPreference = 'auto' | 'h264' | 'vp8' | 'vp9' | 'av1';

/** Whether the browser reported the preferred video codec at all. */
export function hasCodecPreference(
  codecs: readonly { mimeType: string }[],
  preference: CodecPreference,
): boolean {
  if (preference === 'auto') return true;
  const target = `video/${preference}`.toLowerCase();
  return codecs.some((codec) => codec.mimeType.toLowerCase() === target);
}

/**
 * Moves the preferred codec to the front of a capability list.
 *
 * `setCodecPreferences` expresses a preference, not a demand: the remote side
 * may still choose anything it supports, and the browser may ignore the call.
 * The list is stable-partitioned rather than sorted so the relative order of all
 * other codecs — including RTX entries that accompany their primary codec — is
 * preserved. When the preference is absent, the list is returned in the
 * original order, which is the documented "no opinion" behaviour.
 */
export function orderCodecsForPreference<T extends { mimeType: string }>(
  codecs: readonly T[],
  preference: CodecPreference,
): T[] {
  if (preference === 'auto') return [...codecs];
  const target = `video/${preference}`.toLowerCase();
  const matching = codecs.filter((codec) => codec.mimeType.toLowerCase() === target);
  if (matching.length === 0) return [...codecs];
  const rest = codecs.filter((codec) => codec.mimeType.toLowerCase() !== target);
  return [...matching, ...rest];
}

export type CaptureSource = 'camera-mic' | 'camera' | 'mic' | 'screen';

export interface CapturePlan {
  api: 'getUserMedia' | 'getDisplayMedia';
  video: boolean;
  audio: boolean;
}

/** Maps the source picker to the capture API and the tracks to request. */
export function capturePlan(source: CaptureSource): CapturePlan {
  switch (source) {
    case 'camera':
      return { api: 'getUserMedia', video: true, audio: false };
    case 'mic':
      return { api: 'getUserMedia', video: false, audio: true };
    case 'screen':
      return { api: 'getDisplayMedia', video: true, audio: true };
    case 'camera-mic':
    default:
      return { api: 'getUserMedia', video: true, audio: true };
  }
}

// ---------------------------------------------------------------------------
// ICE servers
// ---------------------------------------------------------------------------

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceServersResult {
  servers: IceServerConfig[];
  /** Lines that were not usable, kept verbatim so the UI can quote them. */
  invalid: string[];
}

/**
 * Parses one STUN/TURN URL per line.
 *
 * An empty box means "no ICE servers", which still works on a LAN through host
 * candidates and fails in the way users usually hit behind NAT. Blank lines and
 * `#` comments are ignored. TURN credentials are shared by every TURN URL in the
 * box because that is how the common test setups are configured, and that is
 * also the shape `RTCIceServer` accepts.
 */
export function parseIceServers(text: string, username = '', credential = ''): IceServersResult {
  const invalid: string[] = [];
  const urls: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (!/^(stuns?|turns?):\S+$/i.test(line)) {
      invalid.push(line);
      continue;
    }
    if (!urls.includes(line)) urls.push(line);
  }

  if (urls.length === 0) return { servers: [], invalid };

  const server: IceServerConfig = { urls };
  const name = username.trim();
  const secret = credential.trim();
  if (name !== '' && secret !== '') {
    server.username = name;
    server.credential = secret;
  }
  return { servers: [server], invalid };
}

// ---------------------------------------------------------------------------
// WHIP/WHEP HTTP response
// ---------------------------------------------------------------------------

export interface WhipResponseInput {
  status: number;
  /** Header names are matched case-insensitively. */
  headers?: Record<string, string> | null;
  body?: string | null;
  /**
   * The request URL, used to resolve a relative `Location`.
   *
   * HTTP permits a relative reference in `Location`, and servers do return one
   * (`/resource/abc`). Treating that as unusable would mean never sending the
   * `DELETE` that RFC 9725 requires on stop, so it is resolved against this base
   * instead of being rejected.
   */
  requestUrl?: string | null;
}

export interface WhipResponseResult {
  ok: boolean;
  status: number;
  resourceUrl: string | null;
  answerSdp: string | null;
  /** Fatal explanation, in Chinese, or null when the response was usable. */
  error: string | null;
  /** Non-fatal problem worth showing, or null. */
  warning: string | null;
}

function lowerCaseHeaders(headers: Record<string, string> | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (headers === null || headers === undefined) return map;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string') continue;
    map.set(key.toLowerCase(), value);
  }
  return map;
}

/** Collapses whitespace and cuts a body down to something a screen can show. */
export function truncateText(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength)}…（已截断，原长 ${text.length} 字符）`;
}

function statusExplanation(status: number): string {
  switch (status) {
    case 400:
      return '服务器认为请求不合法（400 Bad Request）：常见原因是 SDP 不被接受、路径或查询参数不对，或服务端没有开启 WHIP/WHEP。';
    case 401:
      return '需要认证或 token 无效（401 Unauthorized）：检查 Bearer token 是否正确、是否已过期。';
    case 403:
      return '服务器拒绝了请求（403 Forbidden）：token 可能没有该流或该路径的权限。';
    case 404:
      return '端点不存在（404 Not Found）：检查地址路径，以及服务端是否发布了 WHIP/WHEP 端点。';
    case 405:
      return '端点不接受 POST（405 Method Not Allowed）：该地址可能是播放页或别的 HTTP 接口，不是 WHIP/WHEP 端点。';
    case 406:
      return '服务器无法提供可接受的 SDP（406 Not Acceptable）：检查编解码偏好是否被服务端支持。';
    case 409:
      return '资源冲突（409 Conflict）：同一个流名可能已经被占用。';
    case 413:
      return '请求体过大（413 Payload Too Large）：SDP 超出了服务端限制。';
    case 415:
      return '不支持的媒体类型（415 Unsupported Media Type）：请求需要 Content-Type: application/sdp。';
    case 429:
      return '请求过于频繁（429 Too Many Requests）：稍后再试。';
    default:
      if (status >= 500) {
        return `服务端内部错误（${status}）：问题在服务端，先查看服务端日志；重试通常无效。`;
      }
      if (status >= 300 && status < 400) {
        return `收到了重定向（${status}）：浏览器通常会跟随，但 WHIP/WHEP 的 POST 不应被重定向。请直接填写最终地址。`;
      }
      return `服务器返回了未预期的状态码 ${status}。`;
  }
}

/**
 * Classifies a WHIP/WHEP POST response.
 *
 * RFC 9725 says a successful creation is `201 Created` with a `Location`
 * header, and that the client later releases that resource with `DELETE`. The
 * checks below therefore distinguish three cases that are easy to conflate:
 *
 *   1. `201` plus a usable `Location`: a fully releasable resource.
 *   2. `201` without `Location`: the answer may still be usable, but the client
 *      has no URL to release, so the warning says exactly that.
 *   3. A 2xx status whose body is not SDP: not usable even though the status
 *      looks successful.
 *
 * Cross-origin note: a browser can only read `Location` when the server lists it
 * in `Access-Control-Expose-Headers`. A missing header here may therefore be a
 * CORS problem on the server even when the header is present on the wire.
 */
/**
 * Resolves a `Location` value, absolute or relative, against the request URL.
 *
 * Exported so the behaviour is testable on its own: a relative reference is
 * legal and common, an absolute one is used as-is, and anything that does not
 * end up as HTTP(S) is rejected.
 */
export function resolveLocation(
  location: string,
  requestUrl: string | null,
): { ok: true; url: string } | { ok: false; error: string } {
  const raw = location.trim();
  if (raw === '') return { ok: false, error: 'Location 为空。' };

  // Absolute form first: no base needed.
  const absolute = normalizeEndpoint(raw);
  if (absolute.ok) return { ok: true, url: absolute.url };

  if (requestUrl === null || requestUrl.trim() === '') {
    return { ok: false, error: '相对 Location 缺少可用于解析的请求地址。' };
  }
  try {
    const base = new URL(requestUrl.trim());
    const resolved = new URL(raw, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return { ok: false, error: `解析后的协议不是 HTTP(S)：${resolved.protocol}` };
    }
    return { ok: true, url: resolved.toString() };
  } catch {
    return { ok: false, error: '无法解析为 URL。' };
  }
}

export function parseWhipResponse(input: WhipResponseInput): WhipResponseResult {
  const status = Number.isFinite(input.status) ? Math.trunc(input.status) : 0;
  const headers = lowerCaseHeaders(input.headers);
  const body = input.body ?? '';
  const locationHeader = (headers.get('location') ?? '').trim();
  const answerSdp = body === '' ? null : body;

  let resourceUrl: string | null = null;
  let warning: string | null = null;

  if (locationHeader !== '') {
    const resolved = resolveLocation(locationHeader, input.requestUrl ?? null);
    if (resolved.ok) {
      resourceUrl = resolved.url;
    } else {
      warning = `服务器返回的 Location 不是可用的 HTTP(S) 地址（${locationHeader}），停止时将无法发送 DELETE。`;
    }
  }

  if (status >= 200 && status < 300) {
    if (!looksLikeSdp(body)) {
      return {
        ok: false,
        status,
        resourceUrl,
        answerSdp: null,
        error:
          `HTTP ${status} 表示成功，但响应正文不是 SDP（应以 v=0 开头并包含 m= 段）。` +
          (body.trim() === ''
            ? '响应正文为空。'
            : `正文开头：${truncateText(body, 300)}`),
        warning,
      };
    }

    if (status !== 201) {
      const note = `服务器返回 ${status}，而 RFC 9725 规定成功创建资源应返回 201 Created；已按成功处理，但部署可能不符合规范。`;
      warning = warning === null ? note : `${warning} ${note}`;
    }

    if (resourceUrl === null) {
      const note =
        '服务器没有返回可用的 Location 头。RFC 9725 要求返回资源 URL，停止时本工具将无法发送 DELETE 释放资源，只能关闭 PeerConnection；请检查服务端实现，以及跨域时是否通过 Access-Control-Expose-Headers 暴露了 Location。';
      warning = warning === null ? note : `${warning} ${note}`;
    }

    return { ok: true, status, resourceUrl, answerSdp, error: null, warning };
  }

  const bodyNote =
    body.trim() === ''
      ? '响应正文为空。'
      : `响应正文：${truncateText(body, 300)}`;
  return {
    ok: false,
    status,
    resourceUrl,
    answerSdp: null,
    error: `${statusExplanation(status)} ${bodyNote}`,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Interval statistics
// ---------------------------------------------------------------------------

export interface RtpSnapshot {
  kind: 'audio' | 'video';
  direction: 'send' | 'recv';
  /** Cumulative bytes sent or received. */
  bytes: number;
  /** Cumulative packets sent or received. */
  packets: number;
  /** Cumulative packets reported lost (normally only meaningful for receive). */
  packetsLost: number;
  /** Cumulative encoded or decoded frames; 0 for audio. */
  frames: number;
  /** The instantaneous value from the stats entry, when the browser reports it. */
  framesPerSecond?: number | null;
  jitterMs?: number | null;
  frameWidth?: number | null;
  frameHeight?: number | null;
}

export interface StatsSnapshot {
  /** Supplied by the caller; this module never reads a clock. */
  timestampMs: number;
  streams: RtpSnapshot[];
  roundTripTimeMs?: number | null;
  availableOutgoingBitrateKbps?: number | null;
}

export interface StreamStatsDelta {
  kind: 'audio' | 'video';
  direction: 'send' | 'recv';
  bitrateKbps: number;
  packets: number;
  packetsLost: number;
  packetLossPercent: number | null;
  fps: number | null;
  jitterMs: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  /** True when a counter went backwards, so the interval was discarded. */
  reset: boolean;
}

export interface StatsDelta {
  elapsedMs: number;
  bitrateKbps: number;
  packetLossPercent: number | null;
  roundTripTimeMs: number | null;
  availableOutgoingBitrateKbps: number | null;
  streams: StreamStatsDelta[];
  /** True when any stream's counters went backwards. */
  reset: boolean;
}

function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function streamKey(stream: RtpSnapshot): string {
  return `${stream.kind}:${stream.direction}`;
}

function zeroDelta(
  stream: RtpSnapshot,
  reset: boolean,
  keepInstantaneous: boolean,
): StreamStatsDelta {
  const fps = stream.framesPerSecond;
  const hasFps = typeof fps === 'number' && Number.isFinite(fps);
  return {
    kind: stream.kind,
    direction: stream.direction,
    bitrateKbps: 0,
    packets: 0,
    packetsLost: 0,
    packetLossPercent: null,
    fps: keepInstantaneous && hasFps ? fps : null,
    jitterMs: keepInstantaneous ? (stream.jitterMs ?? null) : null,
    frameWidth: keepInstantaneous ? (stream.frameWidth ?? null) : null,
    frameHeight: keepInstantaneous ? (stream.frameHeight ?? null) : null,
    reset,
  };
}

/**
 * Turns two cumulative `getStats` snapshots into interval numbers.
 *
 * Bitrate, frame rate and packet-loss rate are all differences divided by the
 * interval. That makes the obvious implementation — subtract and divide — wrong
 * in two situations that really happen:
 *
 *   - `getStats` counters are documented as cumulative, but a track restart, a
 *     transport reset or a browser bug can make the next value smaller. Plain
 *     subtraction then yields a negative bitrate, which reads as nonsense.
 *   - A zero or missing interval would divide by zero and produce `Infinity` or
 *     `NaN`, which then renders as "Infinity kbps".
 *
 * Both cases are handled explicitly: a decrease in any counter marks the stream
 * as reset and the interval contributes zero; a non-positive interval returns
 * zeros and null rates. Frames-per-second falls back to the instantaneous value
 * from the snapshot only when there is no usable frame counter delta, which
 * covers browsers that omit `framesEncoded`.
 */
export function pullStats(
  prev: StatsSnapshot | null,
  next: StatsSnapshot,
  elapsedMs: number,
): StatsDelta {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const elapsedSec = elapsed / 1000;
  const previous = new Map<string, RtpSnapshot>();
  if (prev !== null) {
    for (const stream of prev.streams) previous.set(streamKey(stream), stream);
  }

  const streams: StreamStatsDelta[] = [];
  let totalBitrate = 0;
  let receivedPackets = 0;
  let lostPackets = 0;
  let sawReceive = false;
  let anyReset = false;

  for (const stream of next.streams) {
    const before = previous.get(streamKey(stream));
    if (before === undefined) {
      streams.push(zeroDelta(stream, true, false));
      anyReset = true;
      continue;
    }

    if (elapsed === 0) {
      streams.push(zeroDelta(stream, false, true));
      continue;
    }

    const bytesDelta = finiteOr(stream.bytes, 0) - finiteOr(before.bytes, 0);
    const packetsDelta = finiteOr(stream.packets, 0) - finiteOr(before.packets, 0);
    const lostDelta = finiteOr(stream.packetsLost, 0) - finiteOr(before.packetsLost, 0);
    const framesDelta = finiteOr(stream.frames, 0) - finiteOr(before.frames, 0);

    // Any backwards counter invalidates the whole interval for this stream.
    // Mixing "the byte counter reset but the packet counter did not" would
    // produce a plausible-looking but meaningless rate, so the stream's
    // interval is discarded as a whole.
    if (bytesDelta < 0 || packetsDelta < 0 || lostDelta < 0 || framesDelta < 0) {
      streams.push(zeroDelta(stream, true, false));
      anyReset = true;
      continue;
    }

    const bitrateKbps = (bytesDelta * 8) / 1000 / elapsedSec;
    const denominator = packetsDelta + lostDelta;
    const packetLossPercent = denominator > 0 ? (lostDelta / denominator) * 100 : null;

    let fps: number | null = null;
    if (stream.kind === 'video') {
      if (framesDelta > 0) {
        fps = framesDelta / elapsedSec;
      } else if (stream.framesPerSecond !== null && stream.framesPerSecond !== undefined) {
        const instantaneous = finiteOr(stream.framesPerSecond, Number.NaN);
        fps = Number.isFinite(instantaneous) ? instantaneous : null;
      }
      // A zero frame delta with no instantaneous value means the browser did
      // not expose frame counters at all. Reporting 0 fps would be a claim, not
      // an observation, so the table shows an em dash instead.
    }

    streams.push({
      kind: stream.kind,
      direction: stream.direction,
      bitrateKbps,
      packets: packetsDelta,
      packetsLost: lostDelta,
      packetLossPercent,
      fps,
      jitterMs: stream.jitterMs ?? null,
      frameWidth: stream.frameWidth ?? null,
      frameHeight: stream.frameHeight ?? null,
      reset: false,
    });

    totalBitrate += bitrateKbps;
    if (stream.direction === 'recv') {
      sawReceive = true;
      receivedPackets += packetsDelta;
      lostPackets += lostDelta;
    }
  }

  const combinedDenominator = receivedPackets + lostPackets;
  return {
    elapsedMs: elapsed,
    bitrateKbps: totalBitrate,
    packetLossPercent:
      sawReceive && combinedDenominator > 0 ? (lostPackets / combinedDenominator) * 100 : null,
    roundTripTimeMs: next.roundTripTimeMs ?? null,
    availableOutgoingBitrateKbps: next.availableOutgoingBitrateKbps ?? null,
    streams,
    reset: anyReset,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const NUMBER_ONE_DECIMAL = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  useGrouping: false,
});

/** Formats a rate that is already in kilobits per second. */
export function formatBitrate(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) return '0 kbps';
  if (kbps >= 1000) return `${NUMBER_ONE_DECIMAL.format(kbps / 1000)} Mbps`;
  return `${NUMBER_ONE_DECIMAL.format(kbps)} kbps`;
}

/** Formats a duration as MM:SS, or H:MM:SS once it reaches an hour. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Formats a frame rate, keeping one decimal place. */
export function formatFps(fps: number | null | undefined): string {
  if (fps === null || fps === undefined || !Number.isFinite(fps) || fps < 0) return '—';
  return `${NUMBER_ONE_DECIMAL.format(fps)} fps`;
}

/** Formats a packet-loss percentage; null means "not enough data". */
export function formatPacketLoss(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent) || percent < 0) {
    return '—';
  }
  return `${NUMBER_ONE_DECIMAL.format(percent)}%`;
}

/** Formats a duration-like millisecond value used for RTT and jitter. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  return `${Math.round(ms)} ms`;
}

/** Formats a frame size, or an em dash when the browser did not report one. */
export function formatResolution(
  width: number | null | undefined,
  height: number | null | undefined,
): string {
  if (
    width === null ||
    width === undefined ||
    height === null ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return '—';
  }
  return `${Math.round(width)} × ${Math.round(height)}`;
}

// ---------------------------------------------------------------------------
// Error and support explanations
// ---------------------------------------------------------------------------

export type RtcSupport = 'ok' | 'insecure' | 'unsupported';

/**
 * Classifies whether this page can even attempt a WebRTC connection.
 *
 * The secure-context test comes first because that is the failure users can fix
 * but least expect: on plain http (other than localhost) the browser hides
 * `RTCPeerConnection`-adjacent APIs and media capture behind a secure context,
 * and the resulting error looks like a missing browser feature.
 */
export function describeRtcSupport(
  isSecureContext: boolean,
  hasPeerConnection: boolean,
): RtcSupport {
  if (!isSecureContext) return 'insecure';
  if (!hasPeerConnection) return 'unsupported';
  return 'ok';
}

export interface UiExplanation {
  kind: string;
  title: string;
  detail: string;
}

/**
 * Explains a failed `fetch` to a WHIP/WHEP endpoint.
 *
 * A rejected fetch is deliberately vague: the browser reports the same
 * `TypeError` for DNS failure, connection refused, a TLS error, a mixed-content
 * block and a CORS rejection, and it hides the HTTP status when CORS fails. This
 * function therefore lists the plausible causes in the order a person should
 * check them rather than pretending to know which one happened. The CORS path
 * deserves the detail: `Location` is not readable cross-origin unless the server
 * sends `Access-Control-Expose-Headers: Location`, so a CORS misconfiguration
 * also makes the resource impossible to release.
 */
export function explainFetchFailure(message: string): UiExplanation {
  const suffix = message.trim() === '' ? '' : `（浏览器原文：${message.trim()}）`;
  return {
    kind: 'fetch',
    title: '请求没有完成：无法连接，或被浏览器跨域策略拦截',
    detail:
      '浏览器不会告诉页面这次请求是被 CORS 拦下、域名解析失败、连接被拒绝、证书不受信任，还是 HTTPS 页面请求了 http 地址。' +
      '请依次确认：一、地址和端口可达，服务端已启动 WHIP/WHEP；二、服务端允许当前页面来源的跨域 POST/DELETE，' +
      '并返回 Access-Control-Allow-Origin；三、服务端通过 Access-Control-Expose-Headers 暴露 Location，' +
      '否则浏览器读不到资源 URL；四、HTTPS 页面不能请求 http:// 端点（混合内容会被直接阻止）。' +
      suffix,
  };
}

/** Explains a `getUserMedia` / `getDisplayMedia` failure. */
export function explainCaptureError(name: string, message: string): UiExplanation {
  const suffix = message.trim() === '' ? '' : `（浏览器原文：${message.trim()}）`;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        kind: 'denied',
        title: '采集权限被拒绝',
        detail:
          '浏览器或系统拒绝了摄像头、麦克风或屏幕共享权限。授权提示被拒绝后通常不会自动再弹。' +
          '请点地址栏左侧的权限图标（或站点的“网站设置”），把对应权限改为“允许”，再重新开始。' +
          suffix,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        kind: 'not-found',
        title: '没有找到可用的采集设备',
        detail:
          '系统没有报告匹配的摄像头或麦克风。请确认设备已连接且未被禁用；仅麦克风模式下不要求摄像头。' +
          suffix,
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        kind: 'busy',
        title: '设备被占用或无法读取',
        detail:
          '另一个程序或标签页可能正在使用摄像头/麦克风。请关闭占用程序后重试；屏幕共享被系统拒绝时也可能出现这个错误。' +
          suffix,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        kind: 'constraints',
        title: '设备不支持所请求的采集参数',
        detail:
          '本工具只请求默认的摄像头与麦克风，没有强制分辨率；出现这个错误通常说明所选设备已不可用，请刷新页面后重试。' +
          suffix,
      };
    case 'AbortError':
      return {
        kind: 'aborted',
        title: '屏幕共享被取消',
        detail: '系统或用户取消了这次屏幕共享选择，没有采集到任何轨道。重新开始并选择一个窗口或屏幕即可。' + suffix,
      };
    case 'SecurityError':
      return {
        kind: 'insecure',
        title: '采集需要安全上下文',
        detail:
          '浏览器只在 HTTPS 或 localhost 页面提供摄像头、麦克风和屏幕共享。请通过 https:// 或 http://localhost 打开本页。' +
          suffix,
      };
    case 'TypeError':
      return {
        kind: 'unsupported',
        title: '浏览器不支持所需的采集接口',
        detail:
          '当前浏览器没有提供对应的采集 API（或页面不在安全上下文中）。请改用较新的 Chrome、Edge、Firefox 或 Safari。' +
          suffix,
      };
    default:
      return {
        kind: 'unknown',
        title: '采集媒体失败',
        detail: `发生了未预期的采集错误${name === '' ? '' : `（${name}）`}，请检查系统隐私设置与设备状态。` + suffix,
      };
  }
}

/** Explains a failure returned by `setRemoteDescription`. */
export function explainAnswerError(message: string): UiExplanation {
  const suffix = message.trim() === '' ? '' : `（浏览器原文：${message.trim()}）`;
  return {
    kind: 'answer',
    title: '服务端返回的 answer 无法应用',
    detail:
      '响应虽然像 SDP，但浏览器拒绝把它作为远端描述。常见原因是服务端返回了不完整的 SDP、编解码或 ICE 参数不匹配，' +
      '或者返回了 offer 而不是 answer。可以展开下方 answer SDP 检查，并对照服务端日志。' +
      suffix,
  };
}

// ---------------------------------------------------------------------------
// Diagnostic report
// ---------------------------------------------------------------------------

export interface DiagnosticTimelineEntry {
  /** Milliseconds since the session started, supplied by the caller. */
  atMs: number;
  text: string;
}

export interface DiagnosticSession {
  endpoint: string;
  token: string;
  state: string;
  connectionState: string;
  iceState: string;
  codecs: string;
  stats: StatsDelta | null;
  timeline: DiagnosticTimelineEntry[];
  error: string | null;
  warning: string | null;
}

export interface DiagnosticReportInput {
  userAgent: string;
  /** ISO timestamp, supplied by the caller because this module reads no clock. */
  createdAt: string;
  push: DiagnosticSession | null;
  pull: DiagnosticSession | null;
}

/**
 * Masks a bearer token so it cannot leak into a pasted report.
 *
 * The report is meant to be shared, so the safest useful answer is not "the
 * first and last characters" but simply whether a token was configured. There is
 * no diagnostic value in reproducing any part of it.
 */
export function maskToken(token: string): string {
  return token.trim() === '' ? '未设置' : '已设置（已打码）';
}

const SECRET_QUERY_NAMES = new Set([
  'token',
  'access_token',
  'auth',
  'authorization',
  'key',
  'api_key',
  'apikey',
  'secret',
  'password',
  'passwd',
  'signature',
  'sig',
  'credential',
  'jwt',
]);

/**
 * Masks credentials embedded in a URL query string or userinfo.
 *
 * The token input is separate from the endpoint, but people paste signed URLs
 * too, and a report that reproduces `?token=...` would defeat the point of
 * masking the token field.
 */
export function maskUrlSecrets(url: string): string {
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_NAMES.has(key.toLowerCase())) {
        parsed.searchParams.set(key, 'REDACTED');
        changed = true;
      }
    }
    if (parsed.username !== '' || parsed.password !== '') {
      parsed.username = 'REDACTED';
      parsed.password = 'REDACTED';
      changed = true;
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

function sessionReportLines(
  label: string,
  session: DiagnosticSession | null,
  fallbackEndpoint: string,
): string[] {
  if (session === null) {
    return [`== ${label} ==`, '未启动。'];
  }

  const endpoint = session.endpoint.trim() === '' ? fallbackEndpoint : session.endpoint;
  const lines: string[] = [`== ${label} ==`];
  lines.push(`地址：${endpoint.trim() === '' ? '未填写' : maskUrlSecrets(endpoint.trim())}`);
  lines.push(`认证：${maskToken(session.token)}`);
  lines.push(`状态：${session.state}`);
  lines.push(
    `连接状态：${session.connectionState}；ICE 状态：${session.iceState}`,
  );
  lines.push(`协商编解码：${session.codecs.trim() === '' ? '尚未协商' : session.codecs}`);
  lines.push('最近统计：');
  lines.push(...statsReportLines(session.stats));
  lines.push('状态时间线：');
  if (session.timeline.length === 0) {
    lines.push('  （无）');
  } else {
    for (const entry of session.timeline) {
      lines.push(`  [+${formatDuration(entry.atMs)}] ${entry.text}`);
    }
  }
  lines.push(`错误：${session.error ?? '无'}`);
  lines.push(`警告：${session.warning ?? '无'}`);
  return lines;
}

function statsReportLines(delta: StatsDelta | null): string[] {
  if (delta === null) return ['  尚无采样'];
  const lines: string[] = [
    `  采样间隔：${formatDuration(delta.elapsedMs)}`,
    `  合计码率：${formatBitrate(delta.bitrateKbps)}`,
  ];
  for (const stream of delta.streams) {
    const parts: string[] = [
      `${stream.direction === 'send' ? '发送' : '接收'}${stream.kind === 'video' ? '视频' : '音频'}`,
      `码率 ${formatBitrate(stream.bitrateKbps)}`,
    ];
    if (stream.fps !== null) parts.push(`帧率 ${formatFps(stream.fps)}`);
    if (stream.frameWidth !== null && stream.frameHeight !== null) {
      parts.push(`分辨率 ${formatResolution(stream.frameWidth, stream.frameHeight)}`);
    }
    if (stream.direction === 'recv') {
      parts.push(`丢包率 ${formatPacketLoss(stream.packetLossPercent)}`);
      parts.push(`抖动 ${formatMs(stream.jitterMs)}`);
    }
    lines.push(`  ${parts.join('，')}`);
  }
  if (delta.roundTripTimeMs !== null) lines.push(`  RTT：${formatMs(delta.roundTripTimeMs)}`);
  if (delta.availableOutgoingBitrateKbps !== null) {
    lines.push(`  可用发送带宽：${formatBitrate(delta.availableOutgoingBitrateKbps)}`);
  }
  if (delta.reset) {
    lines.push('  注意：计数器发生回退（重置或回绕），本段增量按 0 处理。');
  }
  return lines;
}

/**
 * Builds the plain-text report behind the "copy diagnostic report" button.
 *
 * Everything that could identify a person or a credential is reduced: the token
 * is never printed, secret-looking query parameters are redacted, and the report
 * says explicitly that the tool cannot verify media delivery. The timestamp is a
 * parameter rather than a clock read so the report is deterministic in tests.
 */
export function buildDiagnosticReport(input: DiagnosticReportInput): string {
  const pushEndpoint = input.push?.endpoint ?? '';
  const pullEndpoint = input.pull?.endpoint ?? '';
  const lines: string[] = [
    'WebRTC 推拉流诊断报告',
    `生成时间：${input.createdAt}`,
    `User-Agent：${input.userAgent.trim() === '' ? '未知' : input.userAgent.trim()}`,
    '说明：本工具只实现 WHIP/WHEP 客户端协议并读取浏览器的 getStats；报告的统计值不代表服务端真的收到了媒体，' +
      '真实推拉流需要可用的 WHIP/WHEP 服务端才能验证。token 与可疑的查询参数已打码。',
    '',
    ...sessionReportLines('推流（WHIP）', input.push, pushEndpoint),
    '',
    ...sessionReportLines('拉流（WHEP）', input.pull, pullEndpoint),
  ];
  return lines.join('\n');
}
