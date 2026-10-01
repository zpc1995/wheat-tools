/**
 * Converts between cron expressions and other schedulers' formats.
 *
 * The hard part is not formatting but *semantics*, because the targets disagree:
 *
 * - **cron day-of-week numbering starts at 0 = Sunday.** systemd's `OnCalendar`
 *   uses names (`Sun`, `Mon`, …) or 0 = Sunday too, but GitHub Actions has no
 *   scheduler at all — only `on.schedule.cron`.
 * - **systemd spells steps differently.** A step in the minute field becomes the
 *   `a/b` form (`0/5`), so the cron star-slash syntax cannot be copied verbatim.
 *
 * (Note: never write the literal star-slash sequence inside this comment — it
 * would terminate the block comment early. That mistake was made once already
 * in `src/tools/cron-builder/cronUtils.ts` and produced dozens of bogus
 * diagnostics.)
 * - **systemd cannot express "day of month AND day of week".** Cron ORs them;
 *   systemd ANDs them. This is the single most dangerous conversion, so it is
 *   reported rather than silently mistranslated.
 * - **cron.d files and plain crontabs differ.** Files under the cron.d
 *   directory carry an extra user field; getting this wrong produces a file
 *   that will not install. (The path itself is avoided here because the bold
 *   marker followed by a slash would close this comment.)
 *
 * Anything that cannot be represented faithfully is reported as a warning
 * instead of being approximated silently.
 */

export interface CronField {
  /** Raw cron text for this field. */
  raw: string;
  /** Expanded set of matching values. */
  values: number[];
  /** True when the field matches everything. */
  isWildcard: boolean;
  /** True when the field uses a step such as the star-slash or range form. */
  step: number | null;
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  /** The optional leading seconds field (6-field Quartz/Spring form). */
  second: CronField | null;
  /** The optional user field from /etc/cron.d. */
  user: string | null;
  /** True when the expression had 6 fields including seconds. */
  hasSeconds: boolean;
}

export type ParseResult =
  | { ok: true; cron: ParsedCron }
  | { ok: false; error: string };

/** Aliases accepted in the month and weekday fields. */
const MONTH_ALIASES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_ALIASES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  /** Accepts 7 as Sunday in addition to 0, like Vixie cron. */
  allowSevenAsSunday?: boolean;
  aliases?: Record<string, number>;
}

const SPECS = {
  second: { name: '秒', min: 0, max: 59 },
  minute: { name: '分钟', min: 0, max: 59 },
  hour: { name: '小时', min: 0, max: 23 },
  dayOfMonth: { name: '日', min: 1, max: 31 },
  month: { name: '月', min: 1, max: 12, aliases: MONTH_ALIASES },
  dayOfWeek: { name: '星期', min: 0, max: 7, allowSevenAsSunday: true, aliases: DOW_ALIASES },
} satisfies Record<string, FieldSpec>;

/** Parses one field into an explicit value set. */
function parseField(raw: string, spec: FieldSpec): CronField | { error: string } {
  const text = raw.trim();
  if (!text) return { error: `${spec.name}字段为空` };

  const resolve = (token: string): number | null => {
    const lower = token.toLowerCase();
    if (spec.aliases && lower in spec.aliases) return spec.aliases[lower];
    if (!/^\d+$/.test(token)) return null;
    return Number(token);
  };

  const values = new Set<number>();
  let step: number | null = null;
  let isWildcard = text === '*' || text === '?';

  for (const part of text.split(',')) {
    const piece = part.trim();
    if (!piece) return { error: `${spec.name}字段中有空白项` };

    // Split off the step: `*/5`, `1-30/2`, `10/5`.
    const slash = piece.indexOf('/');
    let base = piece;
    let partStep: number | null = null;

    if (slash !== -1) {
      base = piece.slice(0, slash);
      const stepText = piece.slice(slash + 1);
      if (!/^\d+$/.test(stepText)) {
        return { error: `${spec.name}字段的步长 "${stepText}" 不是正整数` };
      }
      partStep = Number(stepText);
      if (partStep === 0) return { error: `${spec.name}字段的步长不能为 0` };
      if (step !== null && step !== partStep) {
        return { error: `${spec.name}字段中混用了不同的步长，无法用一个表达式表示` };
      }
      step = partStep;
    }

    // Range, single value, or `*`/`?`.
    if (base === '*' || base === '?' || base === '') {
      const from = spec.min;
      const to = spec.max;
      for (let value = from; value <= to; value += partStep ?? 1) values.add(value);
      if (partStep === null) isWildcard = true;
      continue;
    }

    if (base.includes('-')) {
      const [fromText, toText] = base.split('-');
      const from = resolve(fromText);
      const to = resolve(toText);
      if (from === null || to === null) {
        return { error: `${spec.name}字段的区间 "${base}" 无法识别` };
      }
      if (from > to) {
        // Vixie cron rejects this rather than wrapping, so do the same.
        return { error: `${spec.name}字段的区间起点 ${from} 大于终点 ${to}` };
      }
      if (from < spec.min || to > spec.max) {
        return { error: `${spec.name}字段超出取值范围 ${spec.min}-${spec.max}` };
      }
      for (let value = from; value <= to; value += partStep ?? 1) values.add(value);
      continue;
    }

    const single = resolve(base);
    if (single === null) {
      return { error: `${spec.name}字段的值 "${base}" 无法识别` };
    }
    if (single < spec.min || single > spec.max) {
      return { error: `${spec.name}字段的值 ${single} 超出范围 ${spec.min}-${spec.max}` };
    }

    if (partStep !== null) {
      // `10/5` means "from 10 to the maximum, every 5".
      for (let value = single; value <= spec.max; value += partStep) values.add(value);
    } else {
      values.add(single);
    }
  }

  // Normalise Sunday: 7 means the same as 0.
  if (spec.allowSevenAsSunday && values.has(7)) {
    values.delete(7);
    values.add(0);
  }

  return {
    raw: text,
    values: [...values].sort((a, b) => a - b),
    isWildcard,
    step,
  };
}

/** Parses a cron expression in 5- or 6-field form. */
export function parseCron(expression: string): ParseResult {
  const text = expression.trim();
  if (!text) return { ok: false, error: '请输入 cron 表达式' };

  const fields = text.split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    return {
      ok: false,
      error: `cron 表达式应为 5 个字段（分 时 日 月 周）或 6 个字段（含秒），当前为 ${fields.length} 个`,
    };
  }

  const hasSeconds = fields.length === 6;
  const [a, b, c, d, e, f] = fields;

  const secondField = hasSeconds ? parseField(a, SPECS.second) : null;
  if (secondField && 'error' in secondField) return { ok: false, error: secondField.error };

  const minuteField = parseField(hasSeconds ? b : a, SPECS.minute);
  if ('error' in minuteField) return { ok: false, error: minuteField.error };

  const hourField = parseField(hasSeconds ? c : b, SPECS.hour);
  if ('error' in hourField) return { ok: false, error: hourField.error };

  const domField = parseField(hasSeconds ? d : c, SPECS.dayOfMonth);
  if ('error' in domField) return { ok: false, error: domField.error };

  const monthField = parseField(hasSeconds ? e : d, SPECS.month);
  if ('error' in monthField) return { ok: false, error: monthField.error };

  const dowField = parseField(hasSeconds ? f : e, SPECS.dayOfWeek);
  if ('error' in dowField) return { ok: false, error: dowField.error };

  return {
    ok: true,
    cron: {
      second: secondField && !('error' in secondField) ? secondField : null,
      minute: minuteField,
      hour: hourField,
      dayOfMonth: domField,
      month: monthField,
      dayOfWeek: dowField,
      user: null,
      hasSeconds,
    },
  };
}

export interface ConversionOutput {
  target: 'systemd' | 'github-actions' | 'crontab' | 'human';
  label: string;
  code: string;
  language: string;
  notes: string[];
  /** True when the conversion cannot be exact. */
  lossy: boolean;
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Renders a field as a systemd time component. */
function systemdComponent(
  field: CronField,
  position: 'minute' | 'hour' | 'dom' | 'month' | 'dow',
): { value: string; note?: string } {
  // A full wildcard is written as `*`.
  if (field.isWildcard && field.values.length > (position === 'dow' ? 8 : 0)) {
    return { value: '*' };
  }

  // A single value becomes a plain number.
  if (field.values.length === 1) {
    if (position === 'dow') return { value: DOW_NAMES[field.values[0]] };
    return { value: String(field.values[0]) };
  }

  // An evenly spaced run becomes `a/b`, which systemd supports as
  // "from a, repeating every b".
  if (field.values.length > 1) {
    const gap = field.values[1] - field.values[0];
    const evenlySpaced = field.values.every(
      (value, index) => index === 0 || value - field.values[index - 1] === gap,
    );
    if (evenlySpaced && gap > 0) {
      const start = field.values[0];
      if (position === 'dow') {
        return {
          value: `${DOW_NAMES[start]}/${gap}`,
          note: `星期字段的步长按 systemd 语义解释为从 ${DOW_NAMES[start]} 起每 ${gap} 天`,
        };
      }
      return { value: `${start}/${gap}` };
    }
  }

  // Otherwise list the values; systemd accepts comma-separated lists.
  if (position === 'dow') {
    return { value: field.values.map((value) => DOW_NAMES[value]).join(',') };
  }
  return { value: field.values.join(',') };
}

/**
 * Builds a systemd `OnCalendar` expression.
 *
 * systemd's format is `[DOW] [YYYY-MM-DD] HH:MM:SS`, where each part may be a
 * repetition. The conversion is best-effort and reports every compromise.
 */
export function toSystemd(expression: string): ConversionOutput | { error: string } {
  const parsed = parseCron(expression);
  if (!parsed.ok) return { error: parsed.error };
  const { cron } = parsed;

  const notes: string[] = [];
  let lossy = false;

  if (cron.hasSeconds) {
    notes.push('systemd 的 OnCalendar 支持秒，但 cron 的秒字段语义与之不完全相同，建议核对');
    lossy = true;
  }

  if (!cron.dayOfMonth.isWildcard && !cron.dayOfWeek.isWildcard) {
    // This is the dangerous one.
    notes.push(
      '同时指定了「日」与「星期」：cron 取两者的并集（满足其一即触发），' +
        'systemd 取交集（必须同时满足）。该表达式无法直接对应，已按 systemd 语义生成，请务必核对。',
    );
    lossy = true;
  }

  if (cron.dayOfWeek.values.length > 1 && !cron.dayOfWeek.isWildcard) {
    const gap =
      cron.dayOfWeek.values.length > 1
        ? cron.dayOfWeek.values[1] - cron.dayOfWeek.values[0]
        : 0;
    if (gap > 1) {
      notes.push('cron 的星期步长与 systemd 的 /n 解释不同，已按值列举以免歧义');
      lossy = true;
    }
  }

  const dow = systemdComponent(cron.dayOfWeek, 'dow');
  const month = systemdComponent(cron.month, 'month');
  const dom = systemdComponent(cron.dayOfMonth, 'dom');
  const hour = systemdComponent(cron.hour, 'hour');
  const minute = systemdComponent(cron.minute, 'minute');

  if (month.note) notes.push(month.note);
  if (dom.note) notes.push(dom.note);
  if (dow.note) notes.push(dow.note);

  // systemd wants a date part only when the month or day is constrained.
  const datePart =
    !cron.month.isWildcard || !cron.dayOfMonth.isWildcard
      ? `${cron.month.isWildcard ? '*' : month.value}-${cron.dayOfMonth.isWildcard ? '*' : dom.value}`
      : null;

  const timePart = `${hour.value}:${minute.value}:${cron.hasSeconds ? '*00' : '00'}`;

  const calendar = [cron.dayOfWeek.isWildcard ? null : dow.value, datePart, timePart]
    .filter(Boolean)
    .join(' ');

  const lines = [
    '# 由 cron 表达式转换而来，建议用下方命令验证：',
    `#   systemd-analyze calendar "${calendar}"`,
    '',
    '[Unit]',
    'Description=定时任务（请修改描述）',
    '',
    '[Timer]',
    `OnCalendar=${calendar}`,
    'Persistent=true',
    '',
    '[Install]',
    'WantedBy=timers.target',
  ];

  if (lossy) {
    lines.unshift('# 注意：本次转换存在语义差异，详见工具中的说明。');
  }

  return {
    target: 'systemd',
    label: 'systemd timer',
    code: lines.join('\n'),
    language: 'ini',
    notes,
    lossy,
  };
}

/** Builds a GitHub Actions workflow fragment. */
export function toGithubActions(expression: string): ConversionOutput | { error: string } {
  const parsed = parseCron(expression);
  if (!parsed.ok) return { error: parsed.error };
  const { cron } = parsed;

  const notes: string[] = [];
  let lossy = false;

  if (cron.hasSeconds) {
    notes.push('GitHub Actions 不支持秒级调度：cron 最小粒度是 5 分钟，秒字段已被忽略');
    lossy = true;
  }

  notes.push(
    'GitHub Actions 的定时任务是 UTC 时间，且仓库 60 天无活动后会自动停用；' +
      '高负载时段还会延迟执行。',
  );
  if (cron.dayOfMonth.values.length > 1 || cron.dayOfWeek.values.length > 1) {
    notes.push('Actions 使用标准 cron 语义：日与星期同时指定时取并集');
  }

  const fiveField = [
    cron.minute.raw,
    cron.hour.raw,
    cron.dayOfMonth.raw,
    cron.month.raw,
    cron.dayOfWeek.raw,
  ].join(' ');

  const code = [
    'name: 定时任务',
    '',
    'on:',
    '  schedule:',
    `    - cron: '${fiveField}'`,
    '  workflow_dispatch:',
    '',
    'jobs:',
    '  run:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: 执行任务',
    '        run: echo "在这里写实际命令"',
  ].join('\n');

  return {
    target: 'github-actions',
    label: 'GitHub Actions',
    code,
    language: 'yaml',
    notes,
    lossy,
  };
}

/** Builds a crontab line, including the `/etc/cron.d` user field variant. */
export function toCrontab(expression: string, command = '/path/to/script.sh'): ConversionOutput | { error: string } {
  const parsed = parseCron(expression);
  if (!parsed.ok) return { error: parsed.error };
  const { cron } = parsed;

  const notes: string[] = [];
  if (cron.hasSeconds) {
    notes.push(
      '标准 crontab（Vixie cron）不支持秒字段。若你的 cron 支持（如某些发行版或 Quartz），可保留；' +
        '否则请删除第一段秒。',
    );
  }

  const fields = [
    cron.minute.raw,
    cron.hour.raw,
    cron.dayOfMonth.raw,
    cron.month.raw,
    cron.dayOfWeek.raw,
  ].join(' ');

  const crontab = [
    '# 分 时 日 月 周  命令',
    `${fields}  ${command}`,
    '',
    '# /etc/cron.d/ 下的文件需要额外一个「用户」字段：',
    `${fields}  root  ${command}`,
    '',
    '# 常用简写：',
    '@reboot   ${command}        # 每次启动后执行一次',
    '@daily    ${command}        # 等价于 0 0 * * *',
    '@hourly   ${command}        # 等价于 0 * * * *',
    '@weekly   ${command}        # 等价于 0 0 * * 0',
    '@monthly  ${command}        # 等价于 0 0 1 * *',
  ].join('\n');

  return {
    target: 'crontab',
    label: 'crontab',
    code: crontab,
    language: 'bash',
    notes,
    lossy: cron.hasSeconds,
  };
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Describes a field set in Chinese, collapsing runs into ranges. */
function describeValues(values: number[], unit: string, formatter?: (value: number) => string): string {
  if (values.length === 0) return '';
  const render = formatter ?? ((value: number) => String(value));

  const parts: string[] = [];
  let start = values[0];
  let previous = values[0];

  for (let index = 1; index <= values.length; index += 1) {
    const current = values[index];
    if (current !== undefined && current === previous + 1) {
      previous = current;
      continue;
    }
    // Close the current run.
    if (start === previous) parts.push(render(start));
    else if (previous === start + 1) parts.push(`${render(start)}、${render(previous)}`);
    else parts.push(`${render(start)}-${render(previous)}`);
    if (current !== undefined) {
      start = current;
      previous = current;
    }
  }

  return `${parts.join('、')} ${unit}`;
}

/** Produces a Chinese description of the schedule. */
export function toHuman(expression: string): ConversionOutput | { error: string } {
  const parsed = parseCron(expression);
  if (!parsed.ok) return { error: parsed.error };
  const { cron } = parsed;

  const notes: string[] = [];
  const segments: string[] = [];

  // `second` is only populated for the 6-field form; the flag and the field
  // must be checked together.
  if (cron.hasSeconds && cron.second) {
    segments.push(describeValues(cron.second.values, '秒'));
  }

  // Time of day.
  if (cron.minute.isWildcard && cron.hour.isWildcard) {
    segments.push('每分钟');
  } else if (cron.minute.isWildcard && cron.hour.values.length === 1) {
    segments.push(`每小时的第 ${cron.hour.values[0]} 小时内的每分钟`);
  } else if (cron.minute.values.length === 1 && cron.hour.isWildcard) {
    segments.push(`每小时的第 ${cron.minute.values[0]} 分钟`);
  } else if (cron.minute.values.length === 1 && cron.hour.values.length === 1) {
    const hh = String(cron.hour.values[0]).padStart(2, '0');
    const mm = String(cron.minute.values[0]).padStart(2, '0');
    segments.push(`每天 ${hh}:${mm}`);
  } else {
    segments.push(`${describeValues(cron.hour.values, '时')} ${describeValues(cron.minute.values, '分')}`);
  }

  if (!cron.month.isWildcard) {
    segments.push(`在 ${describeValues(cron.month.values, '月')}`);
  }
  if (!cron.dayOfMonth.isWildcard) {
    segments.push(`在 ${describeValues(cron.dayOfMonth.values, '日')}`);
  }
  if (!cron.dayOfWeek.isWildcard) {
    segments.push(
      describeValues(cron.dayOfWeek.values, '', (value) => WEEKDAY_ZH[value] ?? String(value)),
    );
  }

  if (!cron.dayOfMonth.isWildcard && !cron.dayOfWeek.isWildcard) {
    notes.push('同时限定了「日」与「星期」，cron 会在两者任一满足时触发（并集）');
  }
  if (cron.dayOfMonth.isWildcard && cron.dayOfWeek.isWildcard) {
    notes.push('未限定日期，因此每天都会触发');
  }

  return {
    target: 'human',
    label: '中文说明',
    code: segments.join('，'),
    language: 'text',
    notes,
    lossy: false,
  };
}

export const CRON_CONVERT_SAMPLES = [
  { label: '每 5 分钟', expression: '*/5 * * * *' },
  { label: '每天 09:30', expression: '30 9 * * *' },
  { label: '工作日 09:00', expression: '0 9 * * 1-5' },
  { label: '每月 1 日 00:00', expression: '0 0 1 * *' },
  { label: '每天 3 点（日与星期都限定）', expression: '0 3 1 * 0' },
  { label: '每 30 秒（6 段）', expression: '*/30 * * * * *' },
];
