/**
 * Cron expression parsing, validation, description and next-run calculation.
 *
 * Supports the standard 5-field form (`minute hour day-of-month month
 * day-of-week`) plus an optional leading seconds field (6-field, Quartz-ish
 * ordering without the year). Named months/weekdays, `*`, ranges, steps and
 * comma lists are all accepted.
 *
 * Deliberately not supported: `L`, `W`, `#` (Quartz extensions). They are
 * rejected with a clear message rather than silently mis-scheduled.
 */

export type FieldKey =
  | 'second'
  | 'minute'
  | 'hour'
  | 'dayOfMonth'
  | 'month'
  | 'dayOfWeek';

interface FieldSpec {
  key: FieldKey;
  label: string;
  min: number;
  max: number;
  /** Display names for numeric values (1-based months, 0/7 = Sunday). */
  names?: string[];
  /** Whether `7` is an alias for `0` (Sunday). */
  sundayAlias?: boolean;
}

const MONTH_NAMES = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

const DOW_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const FIELD_SPECS: FieldSpec[] = [
  { key: 'minute', label: '分钟', min: 0, max: 59 },
  { key: 'hour', label: '小时', min: 0, max: 23 },
  { key: 'dayOfMonth', label: '日', min: 1, max: 31 },
  { key: 'month', label: '月', min: 1, max: 12, names: MONTH_NAMES },
  { key: 'dayOfWeek', label: '星期', min: 0, max: 6, names: DOW_NAMES, sundayAlias: true },
];

const SECOND_SPEC: FieldSpec = { key: 'second', label: '秒', min: 0, max: 59 };

const MONTH_ALIASES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_ALIASES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export interface CronField {
  key: FieldKey;
  raw: string;
  /** Every matching value, ascending. */
  values: number[];
  /** True when the field matches everything (used for the DOM/DOW rule). */
  isWildcard: boolean;
}

export interface ParsedCron {
  expression: string;
  /** Canonical field order: second?, minute, hour, dom, month, dow. */
  fields: CronField[];
  hasSeconds: boolean;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  second?: CronField;
}

export type CronParseResult =
  | { ok: true; value: ParsedCron }
  | { ok: false; error: string };

/**
 * Resolves one token to a number.
 *
 * The discriminant is `resolved` rather than `ok` on purpose: this result is
 * consumed inside `parseField`, whose own return type also uses `ok`, and
 * sharing the discriminant makes the success branches structurally
 * incompatible.
 */
type ResolveResult =
  | { resolved: true; value: number }
  | { resolved: false; error: string };

function resolveValue(token: string, spec: FieldSpec): ResolveResult {
  const lower = token.toLowerCase();

  if (spec.key === 'month' && lower in MONTH_ALIASES) {
    return { resolved: true, value: MONTH_ALIASES[lower] };
  }
  if (spec.key === 'dayOfWeek' && lower in DOW_ALIASES) {
    return { resolved: true, value: DOW_ALIASES[lower] };
  }

  if (!/^\d+$/.test(token)) {
    return { resolved: false, error: `无法识别的取值 “${token}”` };
  }

  let value = Number(token);
  // Cron accepts both 0 and 7 for Sunday.
  if (spec.sundayAlias && value === 7) value = 0;

  if (value < spec.min || value > spec.max) {
    return {
      resolved: false,
      error: `取值 ${token} 超出 ${spec.label} 的范围（${spec.min}-${spec.max}）`,
    };
  }
  return { resolved: true, value };
}

function parseField(
  raw: string,
  spec: FieldSpec,
): { ok: true; field: CronField } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${spec.label}字段为空` };
  }

  const values = new Set<number>();

  for (const part of trimmed.split(',')) {
    const piece = part.trim();
    if (!piece) {
      return { ok: false, error: `${spec.label}字段里有多余的逗号` };
    }

    // Split off `/<step>` first so `1-10/2` and `*/5` both work.
    const [rangePart, stepPart, ...extra] = piece.split('/');
    if (extra.length > 0) {
      return { ok: false, error: `“${piece}” 里出现了多个 “/”` };
    }

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) {
        return { ok: false, error: `步长 “${stepPart}” 必须是正整数` };
      }
      step = Number(stepPart);
      if (step < 1) {
        return { ok: false, error: `步长必须大于 0（收到 ${stepPart}）` };
      }
    }

    let from: number;
    let to: number;

    if (rangePart === '*') {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes('-')) {
      const bounds = rangePart.split('-');
      if (bounds.length !== 2) {
        return { ok: false, error: `范围 “${rangePart}” 格式应为 a-b` };
      }
      const start = resolveValue(bounds[0].trim(), spec);
      if (!start.resolved) {
        return { ok: false, error: start.error };
      }
      const end = resolveValue(bounds[1].trim(), spec);
      if (!end.resolved) {
        return { ok: false, error: end.error };
      }
      if (start.value > end.value) {
        return {
          ok: false,
          error: `范围 “${rangePart}” 的起点大于终点`,
        };
      }
      from = start.value;
      to = end.value;
    } else {
      const single = resolveValue(rangePart, spec);
      if (!single.resolved) {
        return { ok: false, error: single.error };
      }
      // `5/10` means "starting at 5, every 10" → 5,15,25,...
      from = single.value;
      to = stepPart === undefined ? single.value : spec.max;
    }

    for (let value = from; value <= to; value += step) {
      values.add(value);
    }
  }

  if (values.size === 0) {
    return { ok: false, error: `${spec.label}字段没有匹配任何值` };
  }

  return {
    ok: true,
    field: {
      key: spec.key,
      raw: trimmed,
      values: [...values].sort((a, b) => a - b),
      isWildcard: trimmed === '*' || trimmed === '*/1',
    },
  };
}

/** Parses and validates a cron expression. */
export function parseCron(expression: string): CronParseResult {
  const text = expression.trim().replace(/\s+/g, ' ');
  if (!text) return { ok: false, error: '请输入 CRON 表达式' };

  // Quartz extensions are rejected explicitly instead of being misread.
  if (/[LW#]/i.test(text)) {
    return {
      ok: false,
      error: '暂不支持 L / W / # 等 Quartz 扩展语法，请使用标准 5 段（或带秒的 6 段）表达式',
    };
  }
  if (text.includes('?')) {
    return {
      ok: false,
      error: '暂不支持 “?” 语法，请用 “*” 表示“任意值”',
    };
  }

  const parts = text.split(' ');
  if (parts.length !== 5 && parts.length !== 6) {
    return {
      ok: false,
      error: `需要 5 段（分 时 日 月 周）或 6 段（秒 + 上面 5 段），当前是 ${parts.length} 段`,
    };
  }

  const hasSeconds = parts.length === 6;
  const specs = hasSeconds ? [SECOND_SPEC, ...FIELD_SPECS] : FIELD_SPECS;

  const parsed: CronField[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const result = parseField(parts[i], specs[i]);
    if (!result.ok) return result;
    parsed.push(result.field);
  }

  const byKey = (key: FieldKey) => parsed.find((field) => field.key === key)!;

  return {
    ok: true,
    value: {
      expression: text,
      fields: parsed,
      hasSeconds,
      second: hasSeconds ? byKey('second') : undefined,
      minute: byKey('minute'),
      hour: byKey('hour'),
      dayOfMonth: byKey('dayOfMonth'),
      month: byKey('month'),
      dayOfWeek: byKey('dayOfWeek'),
    },
  };
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

/**
 * Describes a single field from its raw text.
 * Examples: "*" becomes 每X, and a step such as "0/5" becomes 每 5 X.
 */
function describeField(field: CronField, spec: FieldSpec): string {
  const unit = spec.label;
  const raw = field.raw;
  const name = (value: number) => spec.names?.[spec.key === 'month' ? value - 1 : value] ?? String(value);

  if (raw === '*' || raw === '*/1') {
    return spec.key === 'dayOfWeek' ? '每天' : `每${unit}`;
  }

  const stepMatch = /^\*\/(\d+)$/.exec(raw);
  if (stepMatch) return `每 ${stepMatch[1]} ${unit}`;

  const rangeStepMatch = /^(\d+|\w+)-(\d+|\w+)\/(\d+)$/.exec(raw);
  if (rangeStepMatch) {
    return `${name(Number(rangeStepMatch[1]))} 到 ${name(Number(rangeStepMatch[2]))} 之间每 ${rangeStepMatch[3]} ${unit}`;
  }

  const rangeMatch = /^(\d+|\w+)-(\d+|\w+)$/.exec(raw);
  if (rangeMatch) {
    return `${name(Number(rangeMatch[1]))} 到 ${name(Number(rangeMatch[2]))}`;
  }

  if (raw.includes(',')) {
    return field.values.map(name).join('、');
  }

  return field.values.map(name).join('、');
}

/** Builds a human-readable sentence for a valid expression. */
export function describeCron(cron: ParsedCron): string {
  const specOf = (key: FieldKey) => FIELD_SPECS.find((s) => s.key === key)!;
  const parts: string[] = [];

  if (cron.hasSeconds && cron.second) {
    if (!cron.second.isWildcard) {
      parts.push(`${describeField(cron.second, SECOND_SPEC)}秒`);
    }
  }

  const minuteText = describeField(cron.minute, specOf('minute'));
  const hourText = describeField(cron.hour, specOf('hour'));

  // Combine the time parts into the most idiomatic phrasing.
  if (cron.hour.raw === '*' && cron.minute.raw === '*') {
    parts.push('每分钟');
  } else if (cron.hour.raw === '*') {
    parts.push(minuteText);
  } else {
    const hours = cron.hour.values.map((h) => `${String(h).padStart(2, '0')} 时`);
    if (cron.minute.raw === '*') {
      parts.push(`${hours.join('、')}内的每一分钟`);
    } else {
      const minutes = cron.minute.values.map((m) => String(m).padStart(2, '0'));
      if (hours.length * minutes.length <= 8) {
        const combos: string[] = [];
        for (const h of hours) {
          for (const m of minutes) combos.push(`${h}${m} 分`);
        }
        parts.push(combos.join('、'));
      } else {
        parts.push(`${hourText} 的 ${minuteText}`);
      }
    }
  }

  const monthWildcard = cron.month.raw === '*';
  const domWildcard = cron.dayOfMonth.raw === '*';
  const dowWildcard = cron.dayOfWeek.raw === '*';

  if (!monthWildcard) {
    parts.push(`在 ${describeField(cron.month, specOf('month'))}`);
  }

  if (!domWildcard) {
    parts.push(`在 ${describeField(cron.dayOfMonth, specOf('dayOfMonth'))}号`);
    if (!dowWildcard) {
      // Cron's standard rule: with both restricted, either may match.
      parts.push(
        `，或${describeField(cron.dayOfWeek, specOf('dayOfWeek'))}（两者满足其一即触发）`,
      );
    }
  } else if (!dowWildcard) {
    parts.push(`仅在 ${describeField(cron.dayOfWeek, specOf('dayOfWeek'))}`);
  }
  // When day-of-month and day-of-week are both `*`, the expression runs every
  // day, so appending "每天" would only repeat the time clause.

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Next-run calculation
// ---------------------------------------------------------------------------

export interface CronRun {
  date: Date;
  /** Time until this run, in milliseconds. */
  deltaMs: number;
}

/**
 * Returns the next `count` matching times after `from`.
 *
 * Implemented by advancing the `Date` field-by-field rather than testing every
 * minute, which keeps it fast even for sparse expressions such as "0 3 1 1 *" (once a year).
 */
export function nextRuns(
  cron: ParsedCron,
  count = 8,
  from: Date = new Date(),
): CronRun[] {
  const runs: CronRun[] = [];
  const needsSecondPrecision = Boolean(
    cron.second && !cron.second.isWildcard,
  );

  // Never scan more than ~5 years of minutes; guards against impossible
  // combinations such as `0 0 30 2 *` (Feb 30).
  const maxIterations = 5 * 366 * 24 * 60;
  let iterations = 0;

  const candidate = new Date(from.getTime());
  // Start at the next whole minute (or second) boundary, exclusive of `from`.
  candidate.setMilliseconds(0);
  if (needsSecondPrecision) {
    candidate.setSeconds(candidate.getSeconds() + 1);
  } else {
    candidate.setSeconds(0);
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  const secondSet = new Set(cron.second?.values ?? [0]);
  const minuteSet = new Set(cron.minute.values);
  const hourSet = new Set(cron.hour.values);
  const domSet = new Set(cron.dayOfMonth.values);
  const monthSet = new Set(cron.month.values);
  // Normalise cron's 0-6 (and 7) weekday to JS getDay().
  const dowSet = new Set(cron.dayOfWeek.values.map((v) => v % 7));

  while (runs.length < count && iterations < maxIterations) {
    iterations += 1;
    const year = candidate.getFullYear();

    // Month
    if (!monthSet.has(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, needsSecondPrecision ? 0 : 0, 0);
      candidate.setMinutes(0);
      candidate.setSeconds(0);
      continue;
    }

    // Day: standard cron semantics — when both DOM and DOW are restricted,
    // a match on either one is enough.
    const domMatch = domSet.has(candidate.getDate());
    const dowMatch = dowSet.has(candidate.getDay());
    const domRestricted = cron.dayOfMonth.raw !== '*';
    const dowRestricted = cron.dayOfWeek.raw !== '*';

    let dayOk: boolean;
    if (domRestricted && dowRestricted) dayOk = domMatch || dowMatch;
    else if (domRestricted) dayOk = domMatch;
    else if (dowRestricted) dayOk = dowMatch;
    else dayOk = true;

    if (!dayOk) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      candidate.setMinutes(0);
      candidate.setSeconds(0);
      continue;
    }

    // Hour
    if (!hourSet.has(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    // Minute
    if (!minuteSet.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }

    // Second
    if (needsSecondPrecision && !secondSet.has(candidate.getSeconds())) {
      candidate.setSeconds(candidate.getSeconds() + 1, 0);
      continue;
    }

    const date = new Date(candidate.getTime());
    runs.push({ date, deltaMs: date.getTime() - from.getTime() });

    if (needsSecondPrecision) {
      candidate.setSeconds(candidate.getSeconds() + 1);
    } else {
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    // Bail out if we somehow run past a sane horizon.
    if (candidate.getFullYear() - year > 5) break;
  }

  return runs;
}

/** True when the expression can never fire, e.g. `0 0 30 2 *`. */
export function isImpossible(cron: ParsedCron): boolean {
  return nextRuns(cron, 1).length === 0;
}

/** Templates offered in the builder UI. */
export interface CronTemplate {
  label: string;
  expression: string;
  description: string;
}

export const CRON_TEMPLATES: CronTemplate[] = [
  { label: '每分钟', expression: '* * * * *', description: '用于高频心跳任务' },
  { label: '每 5 分钟', expression: '*/5 * * * *', description: '常见的轮询间隔' },
  { label: '每小时整点', expression: '0 * * * *', description: '整点执行一次' },
  { label: '每天零点', expression: '0 0 * * *', description: '日终批处理' },
  { label: '每天 9 点', expression: '0 9 * * *', description: '每日定时提醒' },
  { label: '工作日 9 点', expression: '0 9 * * 1-5', description: '仅周一至周五' },
  { label: '每周一零点', expression: '0 0 * * 1', description: '周报类任务' },
  { label: '每月 1 号零点', expression: '0 0 1 * *', description: '月度结算' },
  { label: '每季度首日', expression: '0 0 1 1,4,7,10 *', description: '季度任务' },
  { label: '每天 8 点与 20 点', expression: '0 8,20 * * *', description: '一天两次' },
];

/** Formats a run time for the preview list. */
export function formatRun(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const week = DOW_NAMES[date.getDay()] ?? '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${week} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Human-readable "in 3 分 20 秒" style delta. */
export function formatDelta(ms: number): string {
  if (ms < 1000) return '即将触发';
  const totalSeconds = Math.round(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const chunks: string[] = [];
  if (days) chunks.push(`${days} 天`);
  if (hours) chunks.push(`${hours} 小时`);
  if (minutes) chunks.push(`${minutes} 分`);
  if (seconds && !days) chunks.push(`${seconds} 秒`);
  return `${chunks.slice(0, 3).join(' ')}后`;
}

export { FIELD_SPECS as CRON_FIELD_SPECS, DOW_NAMES, MONTH_NAMES };
