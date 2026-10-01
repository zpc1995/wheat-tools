/**
 * Colour parsing and conversion.
 *
 * Supports HEX (3/4/6/8 digits), `rgb()`/`rgba()`, `hsl()`/`hsla()`, `hsv()`
 * and a set of CSS named colours. Conversions go through a single canonical
 * representation — 8-bit sRGB plus alpha — so every format round-trips
 * consistently instead of each pair having its own bespoke maths.
 */

export interface Rgba {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export interface Cmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  teal: '#008080',
  navy: '#000080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  indigo: '#4b0082',
  violet: '#ee82ee',
  tomato: '#ff6347',
  salmon: '#fa8072',
  khaki: '#f0e68c',
  crimson: '#dc143c',
  transparent: '#00000000',
};

export const NAMED_COLORS = Object.entries(NAMED).map(([name, hex]) => ({
  name,
  hex,
}));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rounds to `digits` decimals and returns a **number**.
 *
 * `Number(x.toFixed(n))` rather than `x.toFixed(n)`: the latter returns a
 * string, which silently turns every later numeric comparison into a
 * lexicographic one — `"1.07" > "19.56"` is true. That bug made
 * `readableTextColor` pick the wrong colour.
 */
function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type ParseResult = { ok: true; color: Rgba } | { ok: false; error: string };

/** Parses any supported colour notation. */
export function parseColor(input: string): ParseResult {
  const raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, error: '请输入颜色值' };

  const named = NAMED[raw];
  const text = named ?? raw;

  // --- HEX ---
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) {
      return { ok: false, error: 'HEX 中只能包含 0-9 与 a-f' };
    }
    if (![3, 4, 6, 8].includes(hex.length)) {
      return { ok: false, error: `HEX 长度应为 3/4/6/8 位，当前 ${hex.length} 位` };
    }
    const expand = (part: string) => parseInt(part.length === 1 ? part + part : part, 16);
    const hasAlpha = hex.length === 4 || hex.length === 8;
    const step = hex.length / (hasAlpha ? 4 : 3);

    return {
      ok: true,
      color: {
        r: expand(hex.slice(0, step)),
        g: expand(hex.slice(step, step * 2)),
        b: expand(hex.slice(step * 2, step * 3)),
        a: hasAlpha ? round(expand(hex.slice(step * 3, step * 4)) / 255, 3) : 1,
      },
    };
  }

  // --- Functional notation: rgb()/rgba()/hsl()/hsla()/hsv()/hsb() ---
  const functional = /^(rgba?|hsla?|hsva?|hsba?)\s*\(([^)]+)\)$/.exec(text);
  if (functional) {
    const fn = functional[1];
    // Accept both comma and space separated forms, plus a `/` alpha marker.
    const parts = functional[2]
      .replace(/\//g, ' ')
      .split(/[,\s]+/)
      .filter(Boolean);

    if (parts.length < 3) {
      return { ok: false, error: '至少需要 3 个分量' };
    }

    const numeric = parts.map((part) => {
      const percent = part.endsWith('%');
      const value = Number.parseFloat(percent ? part.slice(0, -1) : part);
      return { value, percent };
    });

    if (numeric.some((item) => !Number.isFinite(item.value))) {
      return { ok: false, error: '存在无法解析的数值' };
    }

    const alpha = numeric[3]
      ? clamp(numeric[3].percent ? numeric[3].value / 100 : numeric[3].value, 0, 1)
      : 1;

    // Channels: 0-255 or 0%-100%. Channel 4 is alpha by convention.
    const channel = (index: number, scale: number) => {
      const item = numeric[index];
      const value = item.percent ? (item.value / 100) * scale : item.value;
      return clamp(Math.round(value), 0, scale);
    };

    if (fn.startsWith('rgb')) {
      return {
        ok: true,
        color: { r: channel(0, 255), g: channel(1, 255), b: channel(2, 255), a: alpha },
      };
    }

    const h = ((numeric[0].value % 360) + 360) % 360;
    const second = clamp(numeric[1].value, 0, 100);
    const third = clamp(numeric[2].value, 0, 100);

    if (fn.startsWith('hsl')) {
      return { ok: true, color: { ...hslToRgb({ h, s: second, l: third }), a: alpha } };
    }
    // hsv/hsb
    return { ok: true, color: { ...hsvToRgb({ h, s: second, v: third }), a: alpha } };
  }

  return {
    ok: false,
    error: '无法识别的颜色格式，支持 #hex、rgb()、hsl()、hsv() 与常见颜色名',
  };
}

export function toHex({ r, g, b, a }: Rgba, withAlpha = false): string {
  const hex = (value: number) =>
    clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  const base = `#${hex(r)}${hex(g)}${hex(b)}`;
  if (!withAlpha) return base;
  return `${base}${hex(a * 255)}`;
}

export function toRgbString(color: Rgba): string {
  const { r, g, b, a } = color;
  return a >= 1
    ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
    : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${round(a, 3)})`;
}

export function rgbToHsl({ r, g, b }: Rgba): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l: round(l * 100, 2) };

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;

  return { h: round(h, 1), s: round(s * 100, 2), l: round(l * 100, 2) };
}

export function hslToRgb({ h, s, l }: Hsl): Rgba {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const hn = ((h % 360) + 360) % 360;

  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hn < 60) [rp, gp, bp] = [c, x, 0];
  else if (hn < 120) [rp, gp, bp] = [x, c, 0];
  else if (hn < 180) [rp, gp, bp] = [0, c, x];
  else if (hn < 240) [rp, gp, bp] = [0, x, c];
  else if (hn < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
    a: 1,
  };
}

export function toHslString(color: Rgba): string {
  const { h, s, l } = rgbToHsl(color);
  return color.a >= 1
    ? `hsl(${h}, ${s}%, ${l}%)`
    : `hsla(${h}, ${s}%, ${l}%, ${round(color.a, 3)})`;
}

export function rgbToHsv({ r, g, b }: Rgba): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: round(h, 1),
    s: round(max === 0 ? 0 : (delta / max) * 100, 2),
    v: round(max * 100, 2),
  };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgba {
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(v, 0, 100) / 100;
  const hn = ((h % 360) + 360) % 360;

  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hn < 60) [rp, gp, bp] = [c, x, 0];
  else if (hn < 120) [rp, gp, bp] = [x, c, 0];
  else if (hn < 180) [rp, gp, bp] = [0, c, x];
  else if (hn < 240) [rp, gp, bp] = [0, x, c];
  else if (hn < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
    a: 1,
  };
}

export function toHsvString(color: Rgba): string {
  const { h, s, v } = rgbToHsv(color);
  return `hsv(${h}, ${s}%, ${v}%)`;
}

export function rgbToCmyk({ r, g, b }: Rgba): Cmyk {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };

  const f = (channel: number) => round(((1 - channel - k) / (1 - k)) * 100, 1);
  return { c: f(rn), m: f(gn), y: f(bn), k: round(k * 100, 1) };
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgba): number {
  const channel = (raw: number) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio against another colour (1–21). */
export function contrastWith(color: Rgba, other: Rgba): number {
  const a = luminance(color);
  const b = luminance(other);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return round((light + 0.05) / (dark + 0.05), 2);
}

/**
 * Picks black or white for text on the given background, whichever has more
 * contrast. This is the practical use of the luminance calculation.
 */
export function readableTextColor(background: Rgba): string {
  const onWhite = contrastWith(background, { r: 255, g: 255, b: 255, a: 1 });
  const onBlack = contrastWith(background, { r: 0, g: 0, b: 0, a: 1 });
  // White text wins when it contrasts *more* with the background. Getting this
  // ternary the wrong way round yields the exact wrong colour in every case,
  // which is why the checker asserts both a light and a dark background.
  return onWhite >= onBlack ? '#ffffff' : '#000000';
}

/** Shades (negative amount) or tints (positive amount) by percentage. */
export function adjustLightness(color: Rgba, deltaPercent: number): Rgba {
  const { h, s, l } = rgbToHsl(color);
  return { ...hslToRgb({ h, s, l: clamp(l + deltaPercent, 0, 100) }), a: color.a };
}

/** Builds a 10-step ramp from black to the colour to white. */
export function buildScale(color: Rgba): Array<{ step: string; color: Rgba }> {
  const { h, s } = rgbToHsl(color);
  const steps: Array<{ step: string; color: Rgba }> = [];
  for (let index = 0; index <= 9; index += 1) {
    const lightness = index * 10 + 5;
    // Keep the hue, interpolate lightness, and fade saturation at the extremes
    // so the ends read as neutral rather than as muddy versions of the hue.
    const distance = Math.abs(lightness - 50) / 50;
    const adjusted = hslToRgb({
      h,
      s: clamp(s * (1 - distance * 0.25), 0, 100),
      l: lightness,
    });
    steps.push({ step: String(lightness), color: adjusted });
  }
  return steps;
}

export { clamp, round };
