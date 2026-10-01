/**
 * Time-zone and clock helpers.
 *
 * Formatting goes through `Intl.DateTimeFormat` with an explicit `timeZone`,
 * so the browser's own zone database handles DST correctly instead of a
 * hand-rolled UTC offset table (which is wrong for half-hour zones and twice a
 * year everywhere else).
 */

export interface ZoneOption {
  id: string;
  label: string;
}

/** A curated list — the common "what time is it there" destinations. */
export const ZONE_OPTIONS: ZoneOption[] = [
  { id: 'UTC', label: 'UTC 协调世界时' },
  { id: 'Asia/Shanghai', label: '北京 / 上海' },
  { id: 'Asia/Hong_Kong', label: '香港' },
  { id: 'Asia/Taipei', label: '台北' },
  { id: 'Asia/Tokyo', label: '东京' },
  { id: 'Asia/Seoul', label: '首尔' },
  { id: 'Asia/Singapore', label: '新加坡' },
  { id: 'Asia/Bangkok', label: '曼谷' },
  { id: 'Asia/Kolkata', label: '新德里' },
  { id: 'Asia/Dubai', label: '迪拜' },
  { id: 'Europe/Moscow', label: '莫斯科' },
  { id: 'Europe/Berlin', label: '柏林' },
  { id: 'Europe/Paris', label: '巴黎' },
  { id: 'Europe/London', label: '伦敦' },
  { id: 'America/Sao_Paulo', label: '圣保罗' },
  { id: 'America/New_York', label: '纽约' },
  { id: 'America/Chicago', label: '芝加哥' },
  { id: 'America/Denver', label: '丹佛' },
  { id: 'America/Los_Angeles', label: '洛杉矶' },
  { id: 'Pacific/Auckland', label: '奥克兰' },
  { id: 'Australia/Sydney', label: '悉尼' },
];

/** The viewer's own zone, or `UTC` when it cannot be determined. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function zoneLabel(id: string): string {
  return ZONE_OPTIONS.find((zone) => zone.id === id)?.label ?? id;
}

export interface ZoneTime {
  /** `HH:mm:ss` in the requested hour cycle. */
  time: string;
  /** Short zone abbreviation, e.g. `GMT+8`. */
  abbr: string;
  /** `UTC+08:00` style offset for the given instant. */
  offset: string;
  /** Calendar date in that zone. */
  date: string;
  /** Day-of-week name in that zone. */
  weekday: string;
  /** True when the zone is currently observing DST. */
  isDst: boolean;
}

/**
 * Formats one instant in one zone.
 *
 * Uses `formatToParts` rather than string parsing so the pieces are exact
 * regardless of locale ordering.
 */
export function formatInZone(
  date: Date,
  timeZone: string,
  hour12: boolean,
): ZoneTime {
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12,
  });

  const partsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = partsFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  // DST detection: January and July offsets differ for the same zone.
  const january = zoneOffsetMinutes(new Date(date.getFullYear(), 0, 1), timeZone);
  const july = zoneOffsetMinutes(new Date(date.getFullYear(), 6, 1), timeZone);
  const current = zoneOffsetMinutes(date, timeZone);

  const rawAbbr = pick('timeZoneName');
  // `zoneOffsetMinutes` is already in the conventional sign (east positive):
  // Shanghai +480, New York -240. Negating it here is what produced inverted
  // offsets on every zone, so the value is used as-is.
  const offsetMinutes = current;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset =
    offsetMinutes === 0
      ? 'UTC+00:00'
      : `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(
          abs % 60,
        ).padStart(2, '0')}`;

  return {
    time: timeFormatter.format(date),
    // Prefer the pretty offset over abbreviations like "GMT+8" which vary by ICU.
    abbr: rawAbbr || offset,
    offset,
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    weekday: pick('weekday'),
    isDst: january !== july && current === Math.max(january, july),
  };
}

/**
 * The zone's UTC offset in minutes, east positive (Shanghai +480, New York -240).
 *
 * Computed by rendering the instant in the target zone and reading the wall
 * clock back as if it were UTC; the difference is the offset. The exact
 * sign convention matters and was initially wrong, so it is asserted by
 * `scripts/check-clock.mjs`.
 */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');

    // Rebuild the wall-clock time as if it were UTC, then compare.
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000;
  } catch {
    return 0;
  }
}

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayZh(date: Date): string {
  return WEEKDAYS_ZH[date.getDay()] ?? '';
}

/** ISO-8601 week number. */
export function isoWeek(date: Date): number {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = target.getDay() || 7;
  target.setDate(target.getDate() + 4 - day);
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const diffDays = Math.round((target.getTime() - yearStart.getTime()) / 86_400_000);
  return Math.floor(diffDays / 7) + 1;
}

/** Day of the year, 1-based. */
export function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}

export function formatDateZh(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/**
 * Renders a duration as `HH:MM:SS`, optionally with centiseconds.
 *
 * Countdown and stopwatch both use this so they cannot drift apart in format.
 */
export function formatDuration(ms: number, centis = false): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  const base = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (!centis) return base;
  return `${base}.${pad(Math.floor((clamped % 1000) / 10))}`;
}

/** Parses `HH:MM:SS` into milliseconds; returns null when unparseable. */
export function parseDuration(input: string): number | null {
  const text = input.trim();
  if (!text) return null;

  // Bare number means minutes, which is what people type in a countdown field.
  if (/^\d+$/.test(text)) return Number(text) * 60_000;

  const parts = text.split(':').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => part !== '' && !/^\d+$/.test(part))) return null;

  const numbers = parts.map((part) => (part === '' ? 0 : Number(part)));
  const [hours, minutes, seconds] =
    numbers.length === 3 ? numbers : [0, numbers[0], numbers[1]];

  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

export const TIMER_PRESETS = [
  { label: '1 分钟', ms: 60_000 },
  { label: '3 分钟', ms: 180_000 },
  { label: '5 分钟', ms: 300_000 },
  { label: '10 分钟', ms: 600_000 },
  { label: '25 分钟', ms: 1_500_000 },
  { label: '1 小时', ms: 3_600_000 },
];
