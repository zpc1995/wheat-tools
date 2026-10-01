/**
 * Arbitrary-radix conversion (2–36).
 *
 * Integers are exact via `BigInt`, so arbitrarily long values round-trip
 * without precision loss — `Number` would silently corrupt anything past 2^53.
 *
 * Fractions cannot be exact for most bases, so they are converted digit by
 * digit up to a configurable precision using *scaled integer* arithmetic
 * instead of floating point: the fractional part is repeatedly multiplied by
 * the target base after being scaled to an integer. That avoids the drift you
 * get from `0.1 * 2` style loops.
 */

export const MIN_RADIX = 2;
export const MAX_RADIX = 36;

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export interface ConvertOptions {
  from: number;
  to: number;
  /** Digits kept after the radix point. */
  precision: number;
  /** Lowercase output by default; uppercase is common for HEX. */
  uppercase: boolean;
  /** Insert a separator every N digits (0 disables). */
  group: number;
  /** Prefix for the target base, e.g. `0x` for 16. */
  prefix: boolean;
}

export type ConvertResult =
  | { ok: true; value: string; /** True when the fraction was truncated. */ rounded: boolean }
  | { ok: false; error: string };

const PREFIXES: Record<number, string> = {
  2: '0b',
  8: '0o',
  16: '0x',
};

function digitValue(char: string): number {
  const value = DIGITS.indexOf(char.toLowerCase());
  return value;
}

/**
 * Parses a value in `radix` into an integer and a fraction, both as digit
 * strings of that radix. Sign and separators are tolerated.
 */
export function splitNumber(
  input: string,
  radix: number,
): { ok: true; negative: boolean; integer: string; fraction: string } | { ok: false; error: string } {
  let text = input.trim().toLowerCase();

  // Strip a base prefix if it matches the declared radix; a mismatched prefix
  // is an error rather than being silently ignored.
  const prefixMatch = /^(0[bxo])(.*)$/.exec(text);
  if (prefixMatch) {
    const expected = PREFIXES[radix];
    if (expected && prefixMatch[1] === expected) {
      text = prefixMatch[2];
    } else if (prefixMatch[1] !== '0x' || radix !== 16) {
      text = prefixMatch[2];
    }
  }

  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  // Spaces and underscores are common as digit group separators.
  text = text.replace(/[\s_]/g, '');

  if (!text) return { ok: false, error: '请输入要转换的数值' };

  const dot = text.indexOf('.');
  const integerPart = dot === -1 ? text : text.slice(0, dot);
  const fractionPart = dot === -1 ? '' : text.slice(dot + 1);

  if (text.split('.').length > 2) {
    return { ok: false, error: '小数点数量不正确' };
  }

  for (const char of integerPart + fractionPart) {
    const value = digitValue(char);
    if (value < 0 || value >= radix) {
      return {
        ok: false,
        error: `字符 “${char}” 不属于 ${radix} 进制`,
      };
    }
  }

  return {
    ok: true,
    negative,
    integer: integerPart.replace(/^0+(?=\d)/, '') || '0',
    fraction: fractionPart,
  };
}

/** Converts an integer digit string between radices, exactly. */
function convertInteger(digits: string, from: number, to: number): string {
  if (digits === '0' || digits === '') return '0';

  const fromRadix = BigInt(from);
  const toRadix = BigInt(to);

  let value = 0n;
  for (const char of digits) {
    value = value * fromRadix + BigInt(digitValue(char));
  }

  if (value === 0n) return '0';

  let out = '';
  while (value > 0n) {
    const remainder = Number(value % toRadix);
    out = DIGITS[remainder] + out;
    value /= toRadix;
  }
  return out;
}

/**
 * Converts a fraction between radices with scaled-integer arithmetic.
 *
 * The input fraction is first turned into an integer numerator over radix^n.
 * The result is then produced digit by digit: numerator * toRadix / radix^n
 * yields the next digit, and the remainder carries forward. All operations stay
 * in BigInt, so there is no floating-point drift.
 */
function convertFraction(
  fraction: string,
  from: number,
  to: number,
  precision: number,
): { digits: string; rounded: boolean } {
  if (!fraction || precision <= 0) return { digits: '', rounded: false };

  const fromRadix = BigInt(from);
  const toRadix = BigInt(to);

  // numerator / fromRadix^len
  let numerator = 0n;
  for (const char of fraction) {
    numerator = numerator * fromRadix + BigInt(digitValue(char));
  }
  let denominator = fromRadix ** BigInt(fraction.length);

  if (numerator === 0n) return { digits: '0'.repeat(precision), rounded: false };

  let out = '';
  for (let i = 0; i < precision; i += 1) {
    numerator *= toRadix;
    const digit = numerator / denominator;
    numerator %= denominator;
    out += DIGITS[Number(digit)];
    if (numerator === 0n) break;
  }

  const rounded = numerator !== 0n;
  return { digits: out.padEnd(precision, '0'), rounded };
}

/** Inserts a separator every `size` digits, from the right. */
export function groupDigits(value: string, size: number): string {
  if (size <= 0) return value;
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const dot = body.indexOf('.');
  const integer = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? '' : body.slice(dot);

  const grouped = integer.replace(
    new RegExp(`\\B(?=(.{${size}})+$)`, 'g'),
    ' ',
  );
  return `${negative ? '-' : ''}${grouped}${fraction}`;
}

export function convert(input: string, options: ConvertOptions): ConvertResult {
  const { from, to, precision, uppercase, group, prefix } = options;

  if (from < MIN_RADIX || from > MAX_RADIX || to < MIN_RADIX || to > MAX_RADIX) {
    return { ok: false, error: `进制需在 ${MIN_RADIX}–${MAX_RADIX} 之间` };
  }
  if (precision < 0 || precision > 40) {
    return { ok: false, error: '小数位数需在 0–40 之间' };
  }

  const split = splitNumber(input, from);
  if (!split.ok) return split;

  const integer = convertInteger(split.integer, from, to);
  const { digits: fraction, rounded } = convertFraction(
    split.fraction,
    from,
    to,
    precision,
  );

  let value = split.negative && (integer !== '0' || /[^0]/.test(fraction))
    ? `-${integer}`
    : integer;

  // Trailing zeros in the fraction are noise unless the user keeps all digits.
  const trimmed = fraction.replace(/0+$/, '');
  if (trimmed) value += `.${trimmed}`;

  if (uppercase) value = value.toUpperCase();

  const grouped = group > 0 ? groupDigits(value, group) : value;
  const prefixText = prefix ? (PREFIXES[to] ?? '') : '';

  return { ok: true, value: `${prefixText}${grouped}`, rounded };
}

/** Renders a value in every common base at once. */
export function convertAll(
  input: string,
  from: number,
  precision: number,
): Array<{ radix: number; label: string; value: string | null; error?: string }> {
  const targets = [2, 8, 10, 16];
  return targets.map((radix) => {
    const label =
      radix === 2 ? '二进制' : radix === 8 ? '八进制' : radix === 10 ? '十进制' : '十六进制';
    const result = convert(input, {
      from,
      to: radix,
      precision,
      uppercase: radix === 16,
      group: 0,
      prefix: false,
    });
    return result.ok
      ? { radix, label, value: result.value }
      : { radix, label, value: null, error: result.error };
  });
}

export { DIGITS };
