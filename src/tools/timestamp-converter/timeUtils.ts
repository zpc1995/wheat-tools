/**
 * Timestamp / date conversion helpers.
 *
 * Two conventions have to coexist here: Unix timestamps are seconds, while
 * JavaScript uses milliseconds. Inputs are therefore length-disambiguated, and
 * every conversion reports which unit it assumed so the UI can be explicit
 * rather than silently guessing.
 */

/** Plausible range for a seconds-based timestamp: 1973-03-03 .. 5138-11-16. */
const MIN_SECONDS = 100_000_000;
/** Above this, a numeric input is unambiguously milliseconds. */
const MIN_MILLIS = 100_000_000_000;

export type StampUnit = 'seconds' | 'millis';

export interface ParsedStamp {
  date: Date;
  unit: StampUnit;
  /** The numeric value as given, normalised to seconds for display. */
  seconds: number;
}

export type ParseStampResult =
  | { ok: true; value: ParsedStamp }
  | { ok: false; error: string };

/**
 * Parses free-form user input into a `Date`.
 *
 * Accepted forms:
 * - `1759257600` / `1759257600000` — Unix seconds or milliseconds
 * - anything `Date.parse` understands, e.g. `2025-10-01T04:00:00Z`
 *
 * Numeric input is classified by digit count: 10 digits is seconds, 13 is
 * milliseconds. Values in between are treated as seconds when they land in a
 * sane date range, which keeps a 12-digit millisecond value from being read as
 * a year-5000 timestamp.
 */
export function parseStamp(input: string): ParseStampResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: '请输入时间戳或日期字符串' };

  if (/^-?\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return { ok: false, error: '数值超出可表示范围' };
    }

    const unit: StampUnit = Math.abs(numeric) >= MIN_MILLIS ? 'millis' : 'seconds';
    const millis = unit === 'millis' ? numeric : numeric * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: '无法转换为有效日期' };
    }

    // A seconds value that small would be 1970-01-02; almost always the user
    // meant milliseconds or simply mistyped.
    if (unit === 'seconds' && Math.abs(numeric) < MIN_SECONDS && numeric !== 0) {
      return {
        ok: false,
        error: `${numeric} 太小，看起来不像秒级时间戳（示例：1759257600）`,
      };
    }

    return {
      ok: true,
      value: { date, unit, seconds: Math.floor(millis / 1000) },
    };
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return { ok: false, error: '无法解析该日期字符串，试试 2025-10-01T04:00:00Z' };
  }
  return {
    ok: true,
    value: {
      date: new Date(parsed),
      unit: 'millis',
      seconds: Math.floor(parsed / 1000),
    },
  };
}

/** Formats a date as `YYYY-MM-DD HH:mm:ss`. */
export function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Formats a date as `YYYY-MM-DDTHH:mm` for `datetime-local` inputs. */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The viewer's IANA time zone, or `本地时区` when unavailable. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
  } catch {
    return '本地时区';
  }
}

/** UTC offset rendered as `UTC+08:00`. */
export function formatOffset(date: Date): string {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(totalMinutes);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekday(date: Date): string {
  return WEEKDAYS[date.getDay()] ?? '';
}

/** ISO-8601 week number. */
export function isoWeek(date: Date): number {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // ISO weeks start on Monday: shift Sunday (0) to 7.
  const day = target.getDay() || 7;
  target.setDate(target.getDate() + 4 - day);

  const yearStart = new Date(target.getFullYear(), 0, 1);
  const diffDays = Math.round(
    (target.getTime() - yearStart.getTime()) / 86_400_000,
  );
  return Math.floor(diffDays / 7) + 1;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
];

/**
 * Human-friendly distance from now, e.g. `3 小时前` / `in 2 days`.
 * Falls back to a plain description if `Intl.RelativeTimeFormat` is missing.
 */
export function relativeToNow(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);

  if (abs < 1000) return '就是现在';

  let formatter: Intl.RelativeTimeFormat;
  try {
    formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  } catch {
    return formatDateTime(date);
  }

  for (const [unit, millis] of RELATIVE_UNITS) {
    if (abs >= millis) {
      return formatter.format(Math.round(diff / millis), unit);
    }
  }
  return '就是现在';
}

/**
 * Renders a date in a specific IANA time zone, e.g. `2025-10-01 12:00:00`.
 * Returns null when the zone is not supported by the runtime.
 */
export function formatInZone(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';

    // `hour` can come back as "24" for midnight in some ICU versions.
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get(
      'minute',
    )}:${get('second')}`;
  } catch {
    return null;
  }
}

/** Time zones offered in the UI, preferring the viewer's own where possible. */
export function candidateTimeZones(): string[] {
  const preferred = [
    'UTC',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
  ];
  const local = localTimeZone();
  const list = local && !preferred.includes(local) ? [local, ...preferred] : preferred;
  return list;
}
