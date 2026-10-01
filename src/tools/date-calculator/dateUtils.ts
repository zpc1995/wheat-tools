/**
 * Date arithmetic and differences.
 *
 * ## The three traps this module exists to avoid
 *
 * 1. **Month overflow.** JavaScript's `setMonth` overflows instead of clamping:
 *    `new Date(2026, 0, 31).setMonth(1)` yields 3 March, not 28 February. Almost
 *    nobody wants "31 January plus one month" to land in the next month, so
 *    clamping is done explicitly.
 *
 * 2. **DST and "one day".** Adding 24 hours is not the same as advancing the
 *    calendar by one day in a zone with daylight saving — the wall-clock time
 *    shifts by an hour. Day/week/month/year arithmetic therefore works on
 *    calendar components, while hour/minute arithmetic uses exact milliseconds.
 *    Both behaviours are intentional and stated in the UI.
 *
 * 3. **`Date` parsing of date-only strings.** `new Date('2026-01-15')` is parsed
 *    as **UTC** midnight per spec, while `new Date(2026, 0, 15)` is local
 *    midnight. Mixing the two shifts results by a day for anyone west of UTC, so
 *    date-only input is always parsed into local components here.
 */

export type DateInput = string;

export interface ParseOutcome {
  ok: true;
  date: Date;
  /** True when the input carried a time component rather than being date-only. */
  hasTime: boolean;
  /** How the value was interpreted, for display. */
  source: 'date-only' | 'date-time' | 'timestamp';
}

export type ParseResult = ParseOutcome | { ok: false; error: string };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const EPOCH = /^\d{9,13}$/;

/**
 * Parses user input into a local `Date`.
 *
 * Accepts `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM[:SS]` (with or without a zone suffix)
 * and 10- or 13-digit epoch values. Bare `Date` string parsing is deliberately
 * not used, for the reason described above.
 */
export function parseDate(input: DateInput): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: '请输入日期' };

  // Epoch seconds or milliseconds, told apart by digit count.
  if (EPOCH.test(text)) {
    const value = Number(text);
    const ms = text.length === 10 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return { ok: false, error: '时间戳超出可表示范围' };
    return { ok: true, date, hasTime: true, source: 'timestamp' };
  }

  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    const date = new Date(y, m - 1, d, 0, 0, 0, 0);
    // Reject impossible dates that would silently roll over (2026-02-30).
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
      return { ok: false, error: `${text} 不是一个真实存在的日期` };
    }
    return { ok: true, date, hasTime: false, source: 'date-only' };
  }

  const dateTime = DATE_TIME.exec(text);
  if (dateTime) {
    const [, y, m, d, hh, mi, ss] = dateTime;
    // A trailing `Z` or offset means the instant is absolute; `Date` handles
    // that correctly, so only the zone-less form needs the local construction.
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text);
    const date = hasZone
      ? new Date(text.replace(' ', 'T'))
      : new Date(
          Number(y),
          Number(m) - 1,
          Number(d),
          Number(hh),
          Number(mi),
          Number(ss ?? 0),
          0,
        );
    if (Number.isNaN(date.getTime())) return { ok: false, error: '无法解析该日期时间' };
    return { ok: true, date, hasTime: true, source: 'date-time' };
  }

  return {
    ok: false,
    error: '无法识别的格式。可用 YYYY-MM-DD、YYYY-MM-DD HH:MM:SS，或 10/13 位时间戳',
  };
}

/** Formats a date as `YYYY-MM-DD`. */
export function toDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Formats a date and time as `YYYY-MM-DD HH:MM:SS`. */
export function toDateTimeString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${toDateString(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:` +
    `${pad(date.getSeconds())}`
  );
}

/** Days in a given month (1-based month). */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/**
 * Adds calendar months, clamping to the target month's length.
 *
 * `Jan 31 + 1 month` is `Feb 28/29`, not `Mar 2/3`; `Mar 31 - 1 month` is
 * `Feb 28/29`. This is the behaviour people expect from "one month later", and
 * it is what `setMonth` gets wrong on its own.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  const totalMonths = year * 12 + month + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth + 1));

  return new Date(
    targetYear,
    targetMonth,
    clampedDay,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

/**
 * Adds calendar years, with the same clamping (29 Feb + 1 year = 28 Feb).
 */
export function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12);
}

export interface AddOptions {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
}

export const ZERO_ADD: AddOptions = {
  years: 0,
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
};

/**
 * Applies all offsets.
 *
 * Calendar units are applied via component arithmetic (so "one day later" keeps
 * the wall-clock time across a DST boundary), then clock units are added as
 * exact milliseconds (so "in 90 minutes" means 90 real minutes).
 */
export function addToDate(date: Date, options: AddOptions): Date {
  let result = addYears(date, options.years);
  result = addMonths(result, options.months);

  // Days and weeks are calendar steps, not 24-hour blocks.
  const calendarDays = options.days + options.weeks * 7;
  if (calendarDays !== 0) {
    result = new Date(
      result.getFullYear(),
      result.getMonth(),
      result.getDate() + calendarDays,
      result.getHours(),
      result.getMinutes(),
      result.getSeconds(),
      result.getMilliseconds(),
    );
  }

  const clockMs = options.hours * 3_600_000 + options.minutes * 60_000;
  if (clockMs !== 0) result = new Date(result.getTime() + clockMs);

  return result;
}

export interface Difference {
  /** Signed total milliseconds (to - from). */
  totalMs: number;
  /** Whole days between the two calendar dates, ignoring time of day. */
  calendarDays: number;
  /** Completed years/months/days, the "age" style breakdown. */
  years: number;
  months: number;
  days: number;
  /** Exact clock breakdown of the remainder. */
  hours: number;
  minutes: number;
  seconds: number;
  /** Total units, for a quick read. */
  totalWeeks: number;
  totalHours: number;
  totalMinutes: number;
  /** Weekday count in the interval, when computing business days. */
  businessDays: number;
  /** True when the second date is earlier than the first. */
  negative: boolean;
}

/** Midnight of the given date, in local time. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Counts weekdays (Mon–Fri) in [from, to), respecting direction. */
export function countBusinessDays(from: Date, to: Date): number {
  const forward = to >= from;
  const start = startOfDay(forward ? from : to);
  const end = startOfDay(forward ? to : from);

  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return forward ? count : -count;
}

/**
 * Difference between two instants.
 *
 * The year/month/day breakdown is anchored on `addMonths`, so the two functions
 * are exact inverses: `difference(a, addMonths(a, n)).months` is `n`. That
 * matters for month-end dates, where naive "borrow from the previous month"
 * arithmetic is simply wrong — from 31 January to 1 March it produced
 * `1 month, −2 days`, because one borrow is not always enough. Anchoring gives
 * the expected `1 month, 1 day` (31 Jan + 1 month = 28 Feb, + 1 day = 1 Mar).
 */
export function difference(from: Date, to: Date): Difference {
  const totalMs = to.getTime() - from.getTime();
  const negative = totalMs < 0;

  // Calendar-day distance based on local dates, so a 23- or 25-hour DST day
  // still counts as one day.
  const fromDay = startOfDay(from).getTime();
  const toDay = startOfDay(to).getTime();
  const calendarDays = Math.round((toDay - fromDay) / 86_400_000);

  // Work on the ordered pair so the arithmetic only has to handle one direction.
  const [a, b] = negative ? [to, from] : [from, to];

  // Largest whole number of months from `a` that does not overshoot `b`.
  let totalMonths = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (addMonths(a, totalMonths) > b) totalMonths -= 1;
  if (totalMonths < 0) totalMonths = 0;

  const anchor = addMonths(a, totalMonths);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  // Remaining whole days, then the clock part of the final partial day.
  let days = Math.round(
    (startOfDay(b).getTime() - startOfDay(anchor).getTime()) / 86_400_000,
  );

  const anchorSeconds =
    anchor.getHours() * 3600 + anchor.getMinutes() * 60 + anchor.getSeconds();
  const targetSeconds =
    b.getHours() * 3600 + b.getMinutes() * 60 + b.getSeconds();
  let clockSeconds = targetSeconds - anchorSeconds;

  if (clockSeconds < 0) {
    // The last day is not complete; borrow it.
    clockSeconds += 86_400;
    days -= 1;
  }

  const absMs = Math.abs(totalMs);

  return {
    totalMs,
    calendarDays,
    years,
    months,
    days,
    hours: Math.floor(clockSeconds / 3600),
    minutes: Math.floor((clockSeconds % 3600) / 60),
    seconds: clockSeconds % 60,
    totalWeeks: Math.floor(calendarDays / 7),
    totalHours: Math.floor(absMs / 3_600_000),
    totalMinutes: Math.floor(absMs / 60_000),
    businessDays: countBusinessDays(from, to),
    negative,
  };
}

/**
 * Adds N business days, skipping weekends.
 *
 * `n` may be negative to go backwards. Weekends are the only non-working days
 * considered — public holidays differ per country and cannot be guessed.
 */
export function addBusinessDays(date: Date, n: number): Date {
  if (n === 0) return new Date(date);

  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  const cursor = new Date(date);

  // Bounded so a pathological input cannot spin forever.
  let guard = 0;
  while (remaining > 0 && guard < 100_000) {
    cursor.setDate(cursor.getDate() + step);
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
    guard += 1;
  }
  return cursor;
}

export interface AgeBreakdown {
  years: number;
  months: number;
  days: number;
  /** Total completed days lived. */
  totalDays: number;
  /** Next birthday. */
  nextBirthday: Date;
  /** Days until the next birthday. */
  daysToNextBirthday: number;
  /** Weekday of the next birthday. */
  nextBirthdayWeekday: string;
}

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Computes age and the next birthday from a birth date. */
export function ageFrom(birth: Date, reference: Date): AgeBreakdown {
  const diff = difference(birth, reference);

  // The next occurrence of the birth month/day, clamped for 29 February.
  const thisYearMonth = Math.min(
    birth.getMonth(),
    11,
  );
  const day = Math.min(
    birth.getDate(),
    daysInMonth(reference.getFullYear(), thisYearMonth + 1),
  );
  let next = new Date(reference.getFullYear(), thisYearMonth, day);
  if (next < startOfDay(reference)) {
    const nextYearDay = Math.min(
      birth.getDate(),
      daysInMonth(reference.getFullYear() + 1, thisYearMonth + 1),
    );
    next = new Date(reference.getFullYear() + 1, thisYearMonth, nextYearDay);
  }

  return {
    years: diff.years,
    months: diff.months,
    days: diff.days,
    totalDays: Math.abs(diff.calendarDays),
    nextBirthday: next,
    daysToNextBirthday: Math.abs(
      Math.round((startOfDay(next).getTime() - startOfDay(reference).getTime()) / 86_400_000),
    ),
    nextBirthdayWeekday: WEEKDAYS_ZH[next.getDay()] ?? '',
  };
}

/** ISO-8601 week number and related info, useful alongside a date. */
export interface DateInfo {
  weekday: string;
  isoWeek: number;
  dayOfYear: number;
  daysInMonth: number;
  quarter: number;
  isLeapYear: boolean;
  iso: string;
  utc: string;
  timestampSeconds: number;
  timestampMs: number;
  timeZone: string;
  offsetMinutes: number;
}

export function describeDate(date: Date): DateInfo {
  const year = date.getFullYear();
  const target = new Date(year, date.getMonth(), date.getDate());
  const day = target.getDay() || 7;
  target.setDate(target.getDate() + 4 - day);
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const isoWeek = Math.floor(
    Math.round((target.getTime() - yearStart.getTime()) / 86_400_000) / 7,
  ) + 1;

  const startOfYear = new Date(year, 0, 0);
  const isLeap = daysInMonth(year, 2) === 29;

  return {
    weekday: WEEKDAYS_ZH[date.getDay()] ?? '',
    isoWeek,
    dayOfYear: Math.floor((date.getTime() - startOfYear.getTime()) / 86_400_000),
    daysInMonth: daysInMonth(year, date.getMonth() + 1),
    quarter: Math.floor(date.getMonth() / 3) + 1,
    isLeapYear: isLeap,
    iso: date.toISOString(),
    utc: date.toUTCString(),
    timestampSeconds: Math.floor(date.getTime() / 1000),
    timestampMs: date.getTime(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    offsetMinutes: -date.getTimezoneOffset(),
  };
}

export function formatDurationZh(totalMs: number): string {
  const abs = Math.abs(totalMs);
  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} 天`);
  if (hours % 24 > 0) parts.push(`${hours % 24} 小时`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60} 分`);
  if (seconds % 60 > 0 || parts.length === 0) parts.push(`${seconds % 60} 秒`);

  return `${totalMs < 0 ? '−' : ''}${parts.join(' ')}`;
}

/** Common quick offsets offered in the UI. */
export const QUICK_OFFSETS: Array<{ label: string; options: Partial<AddOptions> }> = [
  { label: '+1 天', options: { days: 1 } },
  { label: '+1 周', options: { weeks: 1 } },
  { label: '+1 个月', options: { months: 1 } },
  { label: '+3 个月', options: { months: 3 } },
  { label: '+1 年', options: { years: 1 } },
  { label: '−1 天', options: { days: -1 } },
  { label: '−1 个月', options: { months: -1 } },
  { label: '+90 分钟', options: { minutes: 90 } },
];

/** Fixed values used by the tests and the "today" button. */
export function todayString(): string {
  return toDateString(new Date());
}
