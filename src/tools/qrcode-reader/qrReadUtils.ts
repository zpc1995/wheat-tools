import jsQR from 'jsqr';

/**
 * QR code decoding and content classification.
 *
 * ## Why classification matters more than decoding
 *
 * `jsQR` turns pixels into a string; that part is not interesting. What matters
 * is that a QR code is **untrusted input that a human is about to act on** — it
 * can only have come from somewhere the user scanned, and the whole point of QR
 * phishing is that the destination is not readable by eye. So the decoded
 * content is classified and shown as labelled fields rather than as a bare
 * string, and anything that would navigate somewhere is never auto-opened.
 *
 * Structured payloads (`WIFI:`, `BEGIN:VCARD`, `otpauth://`) are parsed into
 * fields, which is genuinely more useful than the raw text — and also makes it
 * obvious when a payload claims to be one thing and contains another.
 */

export interface DecodeOutcome {
  ok: true;
  text: string;
  /** Bounding box of the located code, for drawing an overlay. */
  location: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
  } | null;
  width: number;
  height: number;
  /** Pixel dimensions of the source image. */
  imageWidth: number;
  imageHeight: number;
}

export type DecodeResult = DecodeOutcome | { ok: false; error: string };

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decodes a QR code from raw RGBA pixels. */
export function decodeImage(image: RgbaImage): DecodeResult {
  if (image.width === 0 || image.height === 0) {
    return { ok: false, error: '图像尺寸为 0' };
  }

  // `inversionAttempts: 'attemptBoth'` handles light-on-dark codes, which are
  // common in designs and which the default setting refuses.
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: 'attemptBoth',
  });

  if (!result) {
    return {
      ok: false,
      error:
        '没有识别到二维码。可以尝试：换一张分辨率更高的原图、提高对比度、' +
        '避免反光与倾斜，或裁剪出二维码所在区域后重试。' +
        '注意密集的二维码需要足够的像素——信息量大的码在低分辨率下无法解出，' +
        '而把低分辨率图放大并不能补回丢失的细节。',
    };
  }

  return {
    ok: true,
    text: result.data,
    location: result.location
      ? {
          topLeft: result.location.topLeftCorner,
          topRight: result.location.topRightCorner,
          bottomLeft: result.location.bottomLeftCorner,
          bottomRight: result.location.bottomRightCorner,
        }
      : null,
    width: result.location
      ? Math.round(
          Math.hypot(
            result.location.topRightCorner.x - result.location.topLeftCorner.x,
            result.location.topRightCorner.y - result.location.topLeftCorner.y,
          ),
        )
      : 0,
    height: result.location
      ? Math.round(
          Math.hypot(
            result.location.bottomLeftCorner.x - result.location.topLeftCorner.x,
            result.location.bottomLeftCorner.y - result.location.topLeftCorner.y,
          ),
        )
      : 0,
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

export type ContentKind =
  | 'url'
  | 'text'
  | 'wifi'
  | 'vcard'
  | 'email'
  | 'phone'
  | 'sms'
  | 'geo'
  | 'otpauth'
  | 'json'
  | 'unknown-scheme';

export interface ContentField {
  label: string;
  value: string;
  /** Rendered with a warning colour when true. */
  sensitive?: boolean;
}

export interface Classification {
  kind: ContentKind;
  label: string;
  fields: ContentField[];
  /** Security notes specific to this payload. */
  notes: string[];
}

/** Schemes that browsers will execute rather than navigate to. */
const EXECUTABLE_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:'];

/**
 * Unescapes one component of the `WIFI:` / `MECARD:` style payloads, which use
 * backslash escapes for the reserved characters `\ ; , : "`.
 */
function unescapeWifi(value: string): string {
  return value.replace(/\\([\\;,:"])/g, '$1');
}

/** Splits a `KEY:value;` payload into its parts, honouring escapes. */
function splitEscapedFields(body: string): Array<[string, string]> {
  const parts: Array<[string, string]> = [];
  let current = '';
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === ';') {
      parts.push(...splitOnce(current));
      current = '';
      continue;
    }
    current += char;
  }
  if (current) parts.push(...splitOnce(current));
  return parts;
}

function splitOnce(chunk: string): Array<[string, string]> {
  const index = chunk.indexOf(':');
  if (index === -1) return chunk.trim() ? [[chunk.trim(), '']] : [];
  const key = chunk.slice(0, index).trim();
  const value = unescapeWifi(chunk.slice(index + 1).trim());
  return key ? [[key, value]] : [];
}

const WIFI_SECURITY: Record<string, string> = {
  WPA: 'WPA/WPA2',
  WEP: 'WEP（已不安全）',
  nopass: '无密码（开放网络）',
  '': '未标明',
};

/** Classifies decoded content and extracts structured fields. */
export function classify(text: string): Classification {
  const trimmed = text.trim();
  const notes: string[] = [];

  // --- WiFi ---
  if (/^WIFI:/i.test(trimmed)) {
    const fields = splitEscapedFields(trimmed.slice(5));
    const get = (name: string) =>
      fields.find(([key]) => key.toUpperCase() === name)?.[1] ?? '';

    const security = get('T');
    const password = get('P');
    const hidden = /^true$/i.test(get('H'));

    const out: ContentField[] = [
      { label: '网络名称 SSID', value: get('S') || '（未提供）' },
      { label: '加密方式', value: WIFI_SECURITY[security] ?? security },
    ];
    if (password) out.push({ label: '密码', value: password, sensitive: true });
    if (hidden) out.push({ label: '隐藏网络', value: '是' });
    if (get('I')) out.push({ label: '说明', value: get('I') });

    notes.push('这是 WiFi 配置。连接前请确认 SSID 与密码来自可信来源——' +
      '伪造的 WiFi 二维码是常见的诱导手段。');
    if (security === 'nopass') {
      notes.push('该网络不加密，传输内容可被同一网络中的他人读取。');
    }
    if (security === 'WEP') {
      notes.push('WEP 早已被攻破，应避免在此类网络上传输敏感信息。');
    }

    return { kind: 'wifi', label: 'WiFi 配置', fields: out, notes };
  }

  // --- vCard / MeCard ---
  if (/^BEGIN:VCARD/i.test(trimmed)) {
    const fields: ContentField[] = [];
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const index = line.indexOf(':');
      if (index === -1) continue;
      const key = line.slice(0, index).split(';')[0].toUpperCase();
      const value = line.slice(index + 1).trim();
      if (!value) continue;
      const label =
        { FN: '姓名', N: '姓名（结构化）', TEL: '电话', EMAIL: '邮箱',
          ORG: '组织', TITLE: '职位', URL: '网址', ADR: '地址', NOTE: '备注' }[key] ?? key;
      fields.push({ label, value });
    }
    notes.push('这是联系人名片。导入前请确认联系方式确实来自对方——' +
      '替换收款账号是名片类二维码的典型用途。');
    return { kind: 'vcard', label: '联系人名片', fields, notes };
  }

  if (/^MECARD:/i.test(trimmed)) {
    const fields = splitEscapedFields(trimmed.slice(7)).map(([key, value]) => ({
      label: { N: '姓名', TEL: '电话', EMAIL: '邮箱', ADR: '地址', ORG: '组织' }[key] ?? key,
      value,
    }));
    notes.push('这是 MeCard 联系人格式，导入前请确认来源可信。');
    return { kind: 'vcard', label: '联系人名片（MeCard）', fields, notes };
  }

  // --- 2FA ---
  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const fields: ContentField[] = [
        { label: '类型', value: url.hostname.toUpperCase() },
        {
          label: '账号',
          value: decodeURIComponent(url.pathname.replace(/^\/+/, '')) || '（未提供）',
        },
        { label: '发行方', value: url.searchParams.get('issuer') ?? '（未提供）' },
        {
          label: '算法 / 位数 / 周期',
          value: `${url.searchParams.get('algorithm') ?? 'SHA1'} / ${
            url.searchParams.get('digits') ?? '6'
          } / ${url.searchParams.get('period') ?? '30'} 秒`,
        },
        { label: '密钥', value: url.searchParams.get('secret') ?? '（未提供）', sensitive: true },
      ];
      notes.push(
        '这是两步验证（TOTP）配置，其中的密钥等同于你的第二因素。' +
          '不要把它分享给任何人，也不要在截图里暴露。',
      );
      return { kind: 'otpauth', label: '两步验证配置', fields, notes };
    } catch {
      return {
        kind: 'otpauth',
        label: '两步验证配置',
        fields: [{ label: '原始内容', value: trimmed }],
        notes: ['内容以 otpauth:// 开头但无法解析，请核对后再导入。'],
      };
    }
  }

  // --- 邮件 / 电话 / 短信 / 位置 ---
  if (/^mailto:/i.test(trimmed)) {
    return {
      kind: 'email',
      label: '邮件地址',
      fields: [{ label: '收件人', value: trimmed.slice(7) }],
      notes: ['点击前请核对收件人地址，二维码里的地址和显示的可能不一致。'],
    };
  }

  if (/^(tel|phone):/i.test(trimmed)) {
    return {
      kind: 'phone',
      label: '电话号码',
      fields: [{ label: '号码', value: trimmed.replace(/^[a-z]+:/i, '') }],
      notes: ['陌生号码可能存在高额话费风险（如声讯台）。'],
    };
  }

  if (/^smsto?:/i.test(trimmed)) {
    const body = trimmed.replace(/^smsto?:/i, '');
    const [number, message] = body.split(':');
    return {
      kind: 'sms',
      label: '短信',
      fields: [
        { label: '号码', value: number ?? '' },
        ...(message ? [{ label: '内容', value: decodeURIComponent(message) }] : []),
      ],
      notes: ['发送短信可能产生费用，请确认号码无误。'],
    };
  }

  if (/^geo:/i.test(trimmed)) {
    const coords = trimmed.slice(4).split(',');
    return {
      kind: 'geo',
      label: '地理位置',
      fields: [
        { label: '纬度', value: coords[0] ?? '' },
        { label: '经度', value: coords[1] ?? '' },
        ...(coords[2] ? [{ label: '海拔', value: coords[2] }] : []),
      ],
      notes: ['打开地图会向地图服务暴露你的查询内容。'],
    };
  }

  // --- URL ---
  if (/^https?:\/\//i.test(trimmed)) {
    let host = '';
    try {
      host = new URL(trimmed).host;
    } catch {
      host = '（无法解析）';
    }
    const notes2: string[] = [
      '打开前请先核对域名。二维码钓鱼的常见做法就是把形近域名做成二维码，' +
        '因为地址无法用眼睛预读。',
    ];

    // Lookalike characters and punycode are the two most common disguises.
    if (/xn--/i.test(trimmed)) {
      notes2.push('地址包含 Punycode（xn--），可能是用非拉丁字母伪装的形近域名。');
    }
    if (/@/.test(trimmed.split('://')[1]?.split('/')[0] ?? '')) {
      notes2.push('地址的域名部分含有 @，浏览器会忽略它之前的内容，这常用于伪装。');
    }
    if (/^\s*https:\/\//i.test(trimmed) === false) {
      notes2.push('该地址使用 http 而非 https，传输内容不加密。');
    }

    return {
      kind: 'url',
      label: '网址',
      fields: [
        { label: '域名', value: host },
        { label: '完整地址', value: trimmed },
      ],
      notes: notes2,
    };
  }

  // --- 可执行协议 ---
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && EXECUTABLE_SCHEMES.includes(`${scheme}:`)) {
    return {
      kind: 'unknown-scheme',
      label: `危险协议 ${scheme}:`,
      fields: [{ label: '原始内容', value: trimmed }],
      notes: [
        `内容是 ${scheme}: 协议，这类地址可以执行脚本或加载数据。` +
          '本工具不会把它变成可点击的链接，也强烈建议不要手动打开。',
      ],
    };
  }

  // --- JSON ---
  if (/^\s*[[{]/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const fields: ContentField[] = [];
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          fields.push({ label: key, value: String(value) });
        }
      }
      return {
        kind: 'json',
        label: 'JSON 数据',
        fields,
        notes: ['内容是可解析的 JSON，已按字段展开。'],
      };
    } catch {
      // Falls through to plain text; malformed JSON is still worth showing.
    }
  }

  if (scheme) {
    return {
      kind: 'unknown-scheme',
      label: `自定义协议 ${scheme}:`,
      fields: [{ label: '原始内容', value: trimmed }],
      notes: [
        `内容使用 ${scheme}: 协议，可能是某个应用的自定义链接。` +
          '本工具不会自动打开它，请确认来源后再决定是否处理。',
      ],
    };
  }

  return {
    kind: 'text',
    label: '纯文本',
    fields: [{ label: '内容', value: trimmed }],
    notes: [],
  };
}

/** Formats the decoded content for copy/export, including the classification. */
export function toTextReport(text: string, classification: Classification): string {
  const lines = [`类型：${classification.label}`, ''];
  for (const field of classification.fields) {
    lines.push(`${field.label}：${field.value}`);
  }
  if (classification.notes.length > 0) {
    lines.push('', '提示：');
    for (const note of classification.notes) lines.push(`· ${note}`);
  }
  lines.push('', '原始内容：', text);
  return lines.join('\n');
}

/** Refuses very large images, which would make decoding slow. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * Largest side kept at native resolution while decoding.
 *
 * Downscaling speeds detection up but **breaks dense codes**: a version-23 code
 * (about 800 characters at medium error correction) decodes at 600 px and fails
 * at 400 px, and that was measured, not assumed. Decoding is a one-shot
 * user-initiated action, so correctness wins over a second of latency and the
 * cap is high enough that real photos are almost never resized.
 */
export const MAX_DECODE_DIMENSION = 3000;
