/**
 * Estimated-time-of-arrival arithmetic.
 *
 * Pure functions only: no React, no DOM, and **no clock**. Every timestamp is a
 * parameter (`startAtMs`, `nowMs`), which is the only reason any of this is
 * testable — a function that calls `Date.now()` internally cannot be checked
 * against a hand-computed example, so in practice it never is. The check script
 * even asserts that this file contains no `Date.now` / `performance.now` call.
 *
 * ## What this does not do
 *
 *   - It does not store progress anywhere. Refresh the page and the numbers are
 *     gone; that is a deliberate non-feature, not an omission.
 *   - It does not model human productivity. A rate measured over the last few
 *     items is extrapolated as a constant, and the tool says so out loud:
 *     every estimate carries a confidence level and a rough spread, and an
 *     estimate from very little data is reported as unreliable rather than
 *     dressed up with decimals.
 *
 * ## Why division by zero is an error, not Infinity
 *
 * "0 of 100 done" and "25 of 100 done in 0 seconds" both have an undefined rate.
 * Returning Infinity (or NaN) would flow into the remaining-time calculation
 * and surface as "剩余 0 毫秒" or "剩余 ∞", both of which look like answers.
 * They are refused with an explicit code so the UI can explain instead.
 */

/** Units the tool accepts on input and chooses between on output. */
export type TimeUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day';

export const UNIT_MS: Record<TimeUnit, number> = {
  millisecond: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export const UNIT_LABEL: Record<TimeUnit, string> = {
  millisecond: '毫秒',
  second: '秒',
  minute: '分钟',
  hour: '小时',
  day: '天',
};

/** Input units offered in the UI, coarse to fine. */
export const INPUT_UNITS: TimeUnit[] = ['second', 'minute', 'hour', 'day'];

/**
 * Below this elapsed time no estimate is trustworthy, however many items were
 * finished: a couple of very fast items early on say almost nothing about the
 * rest. Ten seconds is a judgement call, but it is a stated one.
 */
export const SHORT_ELAPSED_MS = 10_000;

/** Fewer completed items than this always means a low-confidence estimate. */
export const MIN_SAMPLES_MEDIUM = 5;

/** Fewer completed items than this cannot reach high confidence. */
export const MIN_SAMPLES_HIGH = 20;

export function toMs(value: number, unit: TimeUnit): number {
  return value * UNIT_MS[unit];
}

export function fromMs(ms: number, unit: TimeUnit): number {
  return ms / UNIT_MS[unit];
}

/** Picks the largest unit in which a duration still reads as a number >= 1. */
export function autoUnit(ms: number): TimeUnit {
  const magnitude = Math.abs(ms);
  if (magnitude < UNIT_MS.second) return 'millisecond';
  if (magnitude < UNIT_MS.minute) return 'second';
  if (magnitude < UNIT_MS.hour) return 'minute';
  if (magnitude < UNIT_MS.day) return 'hour';
  return 'day';
}

export interface DurationParts {
  negative: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

/** Breaks a duration into calendar-free components (a day is exactly 24 hours). */
export function durationParts(ms: number): DurationParts {
  const negative = ms < 0;
  const total = Math.round(Math.abs(ms));
  return {
    negative,
    days: Math.floor(total / UNIT_MS.day),
    hours: Math.floor((total % UNIT_MS.day) / UNIT_MS.hour),
    minutes: Math.floor((total % UNIT_MS.hour) / UNIT_MS.minute),
    seconds: Math.floor((total % UNIT_MS.minute) / UNIT_MS.second),
    milliseconds: total % 1000,
  };
}

/** Formats a duration in one fixed unit, e.g. formatDurationIn(90000, 'minute') is "1.5". */
export function formatDurationIn(
  ms: number,
  unit: TimeUnit,
  decimals = 3,
): string {
  if (!Number.isFinite(ms)) return '—';
  return formatNumber(fromMs(ms, unit), decimals);
}

/**
 * Number formatting shared by the estimates and the component. Kept here —
 * rather than imported from the percentage tool — so this module stays
 * dependency-free and its output is pinned by the check script.
 */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const rounded = Number(value.toFixed(Math.max(0, Math.min(20, decimals))));
  const text = String(rounded === 0 ? 0 : rounded);
  return text;
}

/**
 * Formats a duration in the most readable unit, showing at most two components
 * ("1 天 1 小时", "45 秒", "1.5 秒", "500 毫秒").
 *
 * Components below the second shown one are dropped, so a 25-hour estimate
 * reads "1 天 1 小时" and not "1.041666 天". The sub-second fraction is only
 * shown when seconds are the smallest component.
 */
export function formatDurationHuman(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms === 0) return '0 毫秒';
  const sign = ms < 0 ? '-' : '';
  const magnitude = Math.abs(ms);

  if (magnitude < UNIT_MS.second) {
    return `${sign}${formatNumber(Math.round(magnitude), 0)} 毫秒`;
  }

  const totalSeconds = magnitude / UNIT_MS.second;
  const parts: Array<[TimeUnit, number]> = [
    ['day', Math.floor(totalSeconds / 86_400)],
    ['hour', Math.floor((totalSeconds % 86_400) / 3600)],
    ['minute', Math.floor((totalSeconds % 3600) / 60)],
    ['second', totalSeconds % 60],
  ];

  const first = parts.findIndex(([, value]) => value >= 1);
  if (first === -1) return `${sign}0 毫秒`;
  const next = parts.findIndex(([, value], index) => index > first && value >= 1);
  const picked = next === -1 ? [parts[first]] : [parts[first], parts[next]];

  const text = picked
    .map(([unit, value], index) => {
      // Only the last component may carry a fraction; the leading one is a
      // whole count, so "1.5 小时 30 分钟" can never appear.
      const isLast = index === picked.length - 1;
      const shown = isLast ? formatNumber(value, 3) : String(Math.floor(value));
      return `${shown} ${UNIT_LABEL[unit]}`;
    })
    .join(' ');

  return `${sign}${text}`;
}

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface Confidence {
  level: ConfidenceLevel;
  /** Why the level is what it is, in words meant for the user. */
  reason: string;
  /**
   * Relative half-width of the estimate, from the sample size: 1 / sqrt(n).
   * Null when it cannot be quantified (no samples, or an assumed per-item time).
   */
  spreadRatio: number | null;
  /** Absolute half-width in milliseconds, derived from `spreadRatio`. */
  spreadMs: number | null;
}

/**
 * Derives a confidence level from how much evidence there is.
 *
 * The relative spread uses 1 / sqrt(completed), the standard error of a mean
 * for approximately Poisson-like completion counts. It is a rough model, but it
 * turns "this is probably inaccurate" into a number the user can judge — and
 * crucially it is reported alongside the estimate instead of hiding behind one.
 */
export function confidenceFor(
  completed: number,
  elapsedMs: number,
  remainingMs: number | null,
): Confidence {
  const spreadRatio = completed > 0 ? 1 / Math.sqrt(completed) : null;
  const spreadMs =
    remainingMs !== null && remainingMs > 0 && spreadRatio !== null
      ? remainingMs * spreadRatio
      : null;

  const causes: string[] = [];
  if (completed < MIN_SAMPLES_MEDIUM) {
    causes.push(
      `只完成了 ${formatNumber(completed, 0)} 项，样本太少（少于 ${MIN_SAMPLES_MEDIUM} 项）`,
    );
  }
  if (elapsedMs < SHORT_ELAPSED_MS) {
    causes.push(
      `已用时间只有 ${formatDurationHuman(elapsedMs)}，短于 ${formatDurationHuman(SHORT_ELAPSED_MS)}，这段时间的速度说明不了什么`,
    );
  }

  let level: ConfidenceLevel;
  if (causes.length > 0) {
    level = 'low';
  } else if (completed < MIN_SAMPLES_HIGH) {
    level = 'medium';
    causes.push(`完成 ${completed} 项，样本量中等（少于 ${MIN_SAMPLES_HIGH} 项）`);
  } else {
    level = 'high';
    causes.push(
      `已完成 ${completed} 项、用时 ${formatDurationHuman(elapsedMs)}，样本量足够`,
    );
  }
  if (spreadRatio !== null) {
    causes.push(
      `按样本量估计的相对不确定度约 ±${formatNumber(spreadRatio * 100, 0)}%`,
    );
  }

  return { level, reason: causes.join('；'), spreadRatio, spreadMs };
}

export type EstimateBasis = 'measured' | 'assumed';

export interface EtaEstimate {
  /** `measured` = derived from progress so far; `assumed` = from a stated per-item time. */
  basis: EstimateBasis;
  total: number;
  completed: number;
  elapsedMs: number;
  remainingItems: number;
  /** Items per millisecond, or null when it is undefined (nothing completed). */
  ratePerMs: number | null;
  remainingMs: number;
  /** Absolute finish time when a time base was supplied, otherwise null. */
  finishAtMs: number | null;
  confidence: Confidence;
  /** Non-fatal caveats worth showing next to the number. */
  notes: string[];
}

export type EtaErrorCode =
  | 'invalid-input'
  | 'inconsistent'
  | 'no-progress'
  | 'zero-time'
  | 'overflow';

export type EtaResult =
  | { ok: true; value: EtaEstimate }
  | { ok: false; code: EtaErrorCode; error: string };

export interface ProgressInput {
  total: number;
  completed: number;
  elapsedMs: number;
}

export interface EtaOptions {
  /**
   * Current time, supplied by the caller. When present the estimate includes an
   * absolute finish timestamp; when absent only relative durations are given.
   */
  currentAtMs?: number | null;
}

/**
 * Estimates the finish from progress so far.
 *
 * The remaining time is `剩余项目数 × 已用时间 ÷ 已完成数`, computed in that
 * order on purpose: `(100 - 25) * 600000 / 25` is exactly 1800000, while
 * dividing by the pre-computed rate `25 / 600000` first can land on
 * 1800000.0000000002.
 */
export function estimateEta(
  input: ProgressInput,
  options: EtaOptions = {},
): EtaResult {
  const { total, completed, elapsedMs } = input;

  if (!Number.isFinite(total) || !Number.isFinite(completed) || !Number.isFinite(elapsedMs)) {
    return {
      ok: false,
      code: 'invalid-input',
      error: '请输入有效数字（总量、已完成量、时间都不能为空、NaN 或无穷大）',
    };
  }
  if (total <= 0) {
    return { ok: false, code: 'invalid-input', error: '总量必须大于 0' };
  }
  if (completed < 0) {
    return { ok: false, code: 'invalid-input', error: '已完成量不能为负数' };
  }
  if (elapsedMs < 0) {
    return { ok: false, code: 'invalid-input', error: '已用时间不能为负数' };
  }
  if (completed > total) {
    return {
      ok: false,
      code: 'inconsistent',
      error: '已完成量大于总量：数据不一致，请检查输入',
    };
  }

  // Narrow once, so the arithmetic below never adds to a possible null.
  const supplied = options.currentAtMs ?? null;
  const currentAtMs =
    supplied !== null && Number.isFinite(supplied) ? supplied : null;

  if (completed === total) {
    const ratePerMs = elapsedMs > 0 ? completed / elapsedMs : null;
    return {
      ok: true,
      value: {
        basis: 'measured',
        total,
        completed,
        elapsedMs,
        remainingItems: 0,
        ratePerMs,
        remainingMs: 0,
        finishAtMs: currentAtMs,
        confidence: {
          level: 'high',
          reason: '任务已完成，剩余时间为 0。',
          spreadRatio: null,
          spreadMs: null,
        },
        notes:
          ratePerMs === null
            ? ['总量等于已完成量且已用时间为 0：任务被瞬间完成，给不出速度。']
            : [],
      },
    };
  }

  if (completed === 0) {
    return {
      ok: false,
      code: 'no-progress',
      error: '已完成量为 0：还没有任何进度可以推算速度，无法估计完成时间',
    };
  }
  if (elapsedMs === 0) {
    return {
      ok: false,
      code: 'zero-time',
      error: '已用时间为 0：速度的分母是 0（不能除以 0），无法估计完成时间',
    };
  }

  const ratePerMs = completed / elapsedMs;
  const remainingItems = total - completed;
  const remainingMs = (remainingItems * elapsedMs) / completed;
  if (!Number.isFinite(remainingMs)) {
    return {
      ok: false,
      code: 'overflow',
      error: '计算结果超出可表示范围，请检查输入数量级',
    };
  }

  const finishAtMs = currentAtMs === null ? null : currentAtMs + remainingMs;
  if (finishAtMs !== null && !Number.isFinite(finishAtMs)) {
    return {
      ok: false,
      code: 'overflow',
      error: '完成时刻超出可表示的日期范围，请检查输入数量级',
    };
  }

  const notes: string[] = [];
  if (completed < MIN_SAMPLES_MEDIUM) {
    notes.push('这是基于极少量样本的粗略推算，请把它当作数量级，而不是一个精确时刻。');
  }
  if (remainingItems <= 2) {
    notes.push('剩余项目已经很少：单个项目的快慢就会明显改变完成时刻。');
  }

  return {
    ok: true,
    value: {
      basis: 'measured',
      total,
      completed,
      elapsedMs,
      remainingItems,
      ratePerMs,
      remainingMs,
      finishAtMs,
      confidence: confidenceFor(completed, elapsedMs, remainingMs),
      notes,
    },
  };
}

/**
 * Estimates from "remaining items × time per item", for work where the per-item
 * cost is known up front rather than measured.
 *
 * This is a different kind of claim from `estimateEta`: it is arithmetic on a
 * stated assumption, not a measurement, so it is marked `assumed` and never
 * gets a statistical spread. The UI labels it accordingly.
 */
export function estimateFromPerItem(
  remainingItems: number,
  perItemMs: number,
  options: EtaOptions = {},
): EtaResult {
  if (!Number.isFinite(remainingItems) || !Number.isFinite(perItemMs)) {
    return {
      ok: false,
      code: 'invalid-input',
      error: '请输入有效数字（剩余项目数与每项耗时都不能为空、NaN 或无穷大）',
    };
  }
  if (remainingItems < 0) {
    return { ok: false, code: 'invalid-input', error: '剩余项目数不能为负数' };
  }
  if (perItemMs <= 0) {
    return { ok: false, code: 'invalid-input', error: '每项耗时必须大于 0' };
  }

  const supplied = options.currentAtMs ?? null;
  const currentAtMs =
    supplied !== null && Number.isFinite(supplied) ? supplied : null;
  const remainingMs = remainingItems * perItemMs;
  if (!Number.isFinite(remainingMs)) {
    return {
      ok: false,
      code: 'overflow',
      error: '计算结果超出可表示范围，请检查输入数量级',
    };
  }
  const finishAtMs = currentAtMs === null ? null : currentAtMs + remainingMs;
  if (finishAtMs !== null && !Number.isFinite(finishAtMs)) {
    return {
      ok: false,
      code: 'overflow',
      error: '完成时刻超出可表示的日期范围，请检查输入数量级',
    };
  }

  const notes =
    remainingItems === 0
      ? ['剩余项目数为 0：已经做完了。']
      : ['这是按你给定的「每项耗时」直接相乘的结果，没有包含波动；只是假设，不是测量。'];

  return {
    ok: true,
    value: {
      basis: 'assumed',
      total: remainingItems,
      completed: 0,
      elapsedMs: 0,
      remainingItems,
      ratePerMs: 1 / perItemMs,
      remainingMs,
      finishAtMs,
      confidence: {
        level: remainingItems === 0 ? 'high' : 'medium',
        reason:
          remainingItems === 0
            ? '剩余项目数为 0，无需估计。'
            : '按给定的每项耗时推算：这是假设，不是测量，实际可能更长。',
        spreadRatio: null,
        spreadMs: null,
      },
      notes,
    },
  };
}

/** Estimates from an absolute start and current time. Both are caller-supplied. */
export function estimateFromTimes(
  total: number,
  completed: number,
  startAtMs: number,
  nowMs: number,
): EtaResult {
  if (!Number.isFinite(startAtMs) || !Number.isFinite(nowMs)) {
    return {
      ok: false,
      code: 'invalid-input',
      error: '请输入有效的开始时间与当前时间',
    };
  }
  if (nowMs < startAtMs) {
    return {
      ok: false,
      code: 'inconsistent',
      error: '当前时刻早于开始时间：无法得到负的已用时间，请检查输入',
    };
  }
  return estimateEta(
    { total, completed, elapsedMs: nowMs - startAtMs },
    { currentAtMs: nowMs },
  );
}

// ---------------------------------------------------------------------------
// Civil time formatting
// ---------------------------------------------------------------------------

/** The largest timestamp `Date` can represent (about year 275760). */
export const MAX_DATE_MS = 8.64e15;

/**
 * Formats an epoch timestamp as "YYYY-MM-DD HH:MM:SS" at a given UTC offset.
 *
 * The offset is a parameter rather than something read from the environment
 * (`getTimezoneOffset()` lives in the component), so the output is reproducible
 * in the check script. The implementation deliberately delegates the calendar
 * arithmetic to `Date`: reimplementing leap years and month lengths by hand is
 * exactly where this kind of code goes wrong.
 */
export function formatTimestamp(epochMs: number, offsetMinutes = 0): string {
  if (!Number.isFinite(epochMs) || Math.abs(epochMs) > MAX_DATE_MS) return '—';
  const offset = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const shifted = new Date(epochMs + offset * 60_000);
  if (Number.isNaN(shifted.getTime())) return '—';
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** Formats a UTC offset in minutes as "UTC+08:00". */
export function formatOffset(offsetMinutes: number): string {
  const total = Math.round(Number.isFinite(offsetMinutes) ? offsetMinutes : 0);
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Number of days in a 1-based month, delegated to the Date calendar. */
export function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  // setUTCFullYear is used instead of Date.UTC because the latter maps years
  // 0–99 onto 1900–1999, which would silently move a year-50 timestamp.
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

/**
 * Parses "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM:SS" as civil time at the given
 * offset, returning epoch milliseconds or null for anything invalid.
 *
 * Fields are validated against the calendar rather than letting `Date` roll
 * them over: `2023-02-29` must be rejected, not silently become March 1.
 */
export function parseLocalDateTime(
  text: string,
  offsetMinutes = 0,
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const utc = date.getTime();
  if (Number.isNaN(utc)) return null;
  const offset = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  return utc - offset * 60_000;
}
