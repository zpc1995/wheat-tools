/**
 * Display formatting for the PDF signature inspector.
 *
 * Split from the parser so the parsing module stays about bytes. Both are pure
 * functions of their arguments — no DOM, no clock, no locale lookup — so the
 * self-check can exercise the exact strings the UI will show.
 */

export interface ByteRangeLike {
  errors: string[];
  usable: boolean;
  signedBytes: number;
  coveragePercent: number;
  reachesEnd: boolean;
  trailingBytes: number;
  segments: Array<{ start: number; end: number; length: number }>;
  gapBytes: number;
}

/** Human-readable byte size using binary units. */
export function formatByteSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return `${size} 字节`;
  if (size < 1024) return `${size} 字节`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}

/**
 * Formats a PDF date string (`D:YYYYMMDDHHmmSSOHH'mm'`) for display.
 *
 * Returns the original text when it does not match the shape rather than
 * guessing: a plausible-looking wrong date on a signature record is worse than
 * an obviously unparsed one.
 */
export function formatPdfDate(raw: string | null): string | null {
  if (!raw) return null;
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Z+-])(\d{2})?'?(\d{2})?'?)?/.exec(
    raw.trim(),
  );
  if (!match) return raw;
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', zone] = match;
  const base = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  if (!zone) return `${base}（未标注时区）`;
  if (zone === 'Z') return `${base} UTC`;
  return `${base} UTC${zone}${match[8] ?? '00'}:${match[9] ?? '00'}`;
}

/**
 * One-line statement of whether the signature covers the whole file.
 *
 * This is the only integrity claim the tool makes, so the wording avoids
 * "valid": covering every byte says the signature was computed over this exact
 * file, not that the signature is trustworthy.
 */
export function describeCoverage(range: ByteRangeLike | null): string {
  if (!range) return '没有 /ByteRange，无法判断签名覆盖了哪些字节。';
  if (!range.usable) return `ByteRange 异常，无法计算覆盖范围：${range.errors.join('；')}`;
  if (range.reachesEnd) {
    return `签名覆盖到文件末尾：已签 ${range.signedBytes} 字节，占全文 ${range.coveragePercent}%。`;
  }
  return (
    `签名未覆盖整个文件：已签 ${range.signedBytes} 字节（占全文 ${range.coveragePercent}%），` +
    `末尾 ${range.trailingBytes} 字节不在签名范围内。`
  );
}

/** Compact `[start, end)` list for a table cell. */
export function describeSegments(range: ByteRangeLike | null): string {
  if (!range || range.segments.length === 0) return '—';
  return range.segments.map((segment) => `[${segment.start}, ${segment.end})`).join(' + ');
}

/** `[0 100 200 300]` style rendering of the raw entry. */
export function describeByteRangeValues(values: number[] | null): string {
  if (!values || values.length === 0) return '—';
  return `[${values.map((value) => (Number.isFinite(value) ? String(value) : '非数值')).join(' ')}]`;
}
