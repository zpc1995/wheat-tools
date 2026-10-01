/**
 * Payload templates and colour helpers for the QR generator.
 *
 * The presets exist because the common QR payload formats (WiFi, vCard, mail)
 * have fiddly escaping rules that are easy to get wrong by hand.
 */

export interface QrPreset {
  key: string;
  label: string;
  description: string;
  /** Builds the payload; a function so templates can carry sensible defaults. */
  build: () => string;
}

/**
 * Escapes a value for the WiFi payload format.
 *
 * The spec requires `\`, `;`, `,`, `:` and `"` to be backslash-escaped,
 * otherwise a password containing a semicolon silently splits the payload.
 */
export function escapeWifiValue(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

/** Escapes a value for the `mailto:` query string. */
export function escapeMailto(value: string): string {
  return encodeURIComponent(value);
}

export const QR_PRESETS: QrPreset[] = [
  {
    key: 'url',
    label: '网址',
    description: '普通链接，扫码后直接打开',
    build: () => 'https://wheat.chat',
  },
  {
    key: 'text',
    label: '纯文本',
    description: '任意文本内容',
    build: () => '麦工具 · wheat tools',
  },
  {
    key: 'wifi',
    label: 'WiFi 连接',
    description: '扫码直接连 WiFi，注意密码会用明文编码',
    build: () =>
      `WIFI:T:WPA;S:${escapeWifiValue('我的WiFi')};P:${escapeWifiValue(
        'password123',
      )};H:false;;`,
  },
  {
    key: 'email',
    label: '发送邮件',
    description: '扫码后打开邮件客户端',
    build: () =>
      `mailto:hello@wheat.chat?subject=${escapeMailto('来自二维码的问候')}`,
  },
  {
    key: 'phone',
    label: '拨打电话',
    description: '扫码后进入拨号界面',
    build: () => 'tel:+8613800138000',
  },
  {
    key: 'sms',
    label: '发送短信',
    description: '扫码后打开短信应用并预填内容',
    build: () => 'SMSTO:+8613800138000:你好',
  },
  {
    key: 'vcard',
    label: '联系人名片',
    description: 'vCard 3.0 格式，可导入通讯录',
    build: () =>
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:张;三',
        'FN:张三',
        'ORG:麦工具',
        'TITLE:工程师',
        'TEL;TYPE=CELL:+8613800138000',
        'EMAIL:hello@wheat.chat',
        'URL:https://wheat.chat',
        'END:VCARD',
      ].join('\n'),
  },
  {
    key: 'geo',
    label: '地理位置',
    description: '扫码后在地图中打开坐标',
    build: () => 'geo:39.9042,116.4074',
  },
];

/** Parses `#rgb`, `#rrggbb` (and the same without `#`) into 0-255 channels. */
export function parseHexColor(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      Number.parseInt(hex[0] + hex[0], 16),
      Number.parseInt(hex[1] + hex[1], 16),
      Number.parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

/** WCAG relative luminance of a colour. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (raw: number) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two colours, or null if either is unparseable.
 * Used to warn about palettes that扫码器 will struggle with.
 */
export function contrastRatio(a: string, b: string): number | null {
  const first = parseHexColor(a);
  const second = parseHexColor(b);
  if (!first || !second) return null;

  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Whether the "dark" colour is actually darker than the "light" one.
 * QR readers assume a dark foreground on a light background; an inverted code
 * often fails to scan, so the UI warns about it.
 */
export function canRenderOnWhite(dark: string, light: string): boolean {
  const first = parseHexColor(dark);
  const second = parseHexColor(light);
  if (!first || !second) return true;
  return luminance(first) < luminance(second);
}
