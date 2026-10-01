/**
 * systemd `OnCalendar` → cron.
 *
 * ## The semantics that do not translate
 *
 * systemd combines the weekday restriction and the date restriction with
 * **AND**; cron combines them with **OR**. This was verified against
 * `systemd-analyze`, not assumed:
 *
 *     $ systemd-analyze calendar --iterations=3 "Mon..Fri *-*-01 09:00"
 *     Mon..Fri *-*-01 09:00:00
 *       Next elapse: Tue 2026-12-01 09:00:00   # the 1st, which is a Tuesday
 *       Iteration #2: Fri 2027-01-01 09:00:00  # the 1st, which is a Friday
 *
 * So it fires on the 1st *only when that day is also Mon–Fri*. The cron
 * equivalent `0 9 1 * 1-5` fires on **every** Mon–Fri **and** every 1st — far
 * more often. There is no 5-field cron expression that means the same thing, so
 * this module refuses to emit one and says why, rather than producing something
 * that silently fires on the wrong days.
 *
 * Other verified behaviours this module relies on:
 * - `HH:MM/step` repeats **within that hour only**: `09:00/15` is 09:00, 09:15,
 *   09:30, 09:45 and then the next day, i.e. cron `0,15,30,45 9 * * *`.
 * - `~` for "last day of month" is **not** accepted by systemd 257
 *   (`Failed to parse calendar specification`), so it is not implemented.
 * - `second` is a full field, so sub-minute schedules have no 5-field cron form.
 */

export interface SysField {
  /** Original text, e.g. `00/5`. */
  raw: string;
  /**
   * Offset counting back from the end of the month, from the `~N` form.
   *
   * systemd writes the day-of-month as `MM~N` (note the tilde replacing the
   * usual dash) to mean "the Nth last day of that month": `*-02~03` is the third
   * last day of February, which is the 26th in a 28-day year and the 27th in a
   * leap year. `N` is bounded to 1..28 because the offset has to be valid for the
   * shortest month — verified against `systemd-analyze`, which rejects `~29`
   * even for a 31-day month.
   */
  fromEnd: number | null;
  /**
   * Matching values, or `null` when the field is unrestricted (`*`).
   *
   * `null` is distinct from "every value listed" because cron distinguishes a
   * bare star from an explicit enumeration in some contexts, and because that
   * difference decides whether the output uses the step form or a long list.
   */
  values: number[] | null;
  /** Repetition step, from `a/b` or `a..b/c`. */
  step: number | null;
}

export interface ParsedOnCalendar {
  /** The input after keyword expansion, as systemd would normalise it. */
  normalized: string;
  weekday: SysField;
  year: SysField;
  month: SysField;
  day: SysField;
  hour: SysField;
  minute: SysField;
  second: SysField;
  /** Timezone suffix if present, e.g. `UTC`. */
  timezone: string | null;
}

export type OnCalendarParseResult =
  | { ok: true; parsed: ParsedOnCalendar }
  | { ok: false; error: string };

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  aliases?: Record<string, number>;
}

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * Keyword shorthands, expanded to their canonical expressions.
 *
 * Kept byte-identical to what `systemd-analyze` prints for the same keyword so
 * the "normalized" line the UI shows is truthful.
 */
const KEYWORDS: Record<string, string> = {
  minutely: '*-*-* *:*:00',
  hourly: '*-*-* *:00:00',
  daily: '*-*-* 00:00:00',
  midnight: '*-*-* 00:00:00',
  weekly: 'Mon *-*-* 00:00:00',
  monthly: '*-*-01 00:00:00',
  quarterly: '*-01,04,07,10-01 00:00:00',
  'semi-annually': '*-01,07-01 00:00:00',
  semiannually: '*-01,07-01 00:00:00',
  yearly: '*-01-01 00:00:00',
  annually: '*-01-01 00:00:00',
};

/**
 * Parses one systemd field.
 *
 * Supports the full systemd grammar for a single component: `*`, a value, a
 * comma list, an `a..b` range, and a `/step` repetition applied to any of them.
 */
export function parseSysField(raw: string, spec: FieldSpec): SysField | { error: string } {
  const text = raw.trim();
  if (!text) return { error: `${spec.name}字段为空` };

  if (text === '*' || text === '*-*') {
    return { raw: text, values: null, step: null, fromEnd: null };
  }

  const resolve = (token: string): number | null => {
    const lower = token.toLowerCase();
    if (spec.aliases && lower in spec.aliases) return spec.aliases[lower];
    if (!/^\d+$/.test(token)) return null;
    return Number(token);
  };

  // Split off a repetition step: `a/b`, `a..b/c`.
  const slash = text.lastIndexOf('/');
  let body = text;
  let step: number | null = null;

  if (slash !== -1) {
    body = text.slice(0, slash);
    const stepText = text.slice(slash + 1);
    if (!/^\d+$/.test(stepText)) {
      return { error: `${spec.name}字段的步长 "${stepText}" 不是整数` };
    }
    step = Number(stepText);
    if (step === 0) return { error: `${spec.name}字段的步长不能为 0` };
  }

  // The `~N` form: an offset from the end of the month rather than a fixed day.
  //
  // Note that any `/step` has already been stripped into `step` above, so the
  // value reported here must be that one — reading it out of this match again
  // silently dropped the step, because by now it is no longer in the text.
  const tilde = /^~([0-9]+)$/.exec(body);
  if (tilde) {
    const offset = Number(tilde[1]);
    // 28 is systemd's own cap: the offset must make sense in every month.
    if (offset < 1 || offset > 28) {
      return {
        error: `${spec.name}字段的 ~${offset} 超出范围：倒数偏移必须在 1-28 之间` +
          '（要对最短的 2 月也成立，systemd 就是这样限制的）',
      };
    }
    return { raw: text, values: null, step, fromEnd: offset };
  }

  const values = new Set<number>();

  for (const part of body.split(',')) {
    const piece = part.trim();
    if (!piece) return { error: `${spec.name}字段中有空白项` };

    if (piece === '*') {
      for (let value = spec.min; value <= spec.max; value += step ?? 1) {
        values.add(value);
      }
      continue;
    }

    // Range uses `..` in systemd, not `-`.
    if (piece.includes('..')) {
      const [fromText, toText] = piece.split('..');
      const from = resolve(fromText);
      const to = resolve(toText);
      if (from === null || to === null) {
        return { error: `${spec.name}字段的区间 "${piece}" 无法识别` };
      }
      if (from > to) {
        return { error: `${spec.name}字段的区间起点大于终点：${piece}` };
      }
      if (from < spec.min || to > spec.max) {
        return {
          error: `${spec.name}字段的区间 ${piece} 超出取值范围 ${spec.min}-${spec.max}`,
        };
      }
      for (let value = from; value <= to; value += step ?? 1) values.add(value);
      continue;
    }

    const single = resolve(piece);
    if (single === null) {
      return { error: `${spec.name}字段的值 "${piece}" 无法识别` };
    }
    // Range checking matters: without it a typo like month 13 or hour 25 would
    // be accepted and produce an expression the target rejects or misreads.
    if (single < spec.min || single > spec.max) {
      return {
        error: `${spec.name}字段的值 ${single} 超出取值范围 ${spec.min}-${spec.max}`,
      };
    }

    if (step !== null) {
      // `a/b` means from a to the maximum, every b.
      for (let value = single; value <= spec.max; value += step) values.add(value);
    } else {
      values.add(single);
    }
  }

  if (values.size === 0) return { error: `${spec.name}字段没有匹配任何值` };

  return {
    raw: text,
    values: [...values].sort((a, b) => a - b),
    step,
    fromEnd: null,
  };
}

/** Splits an OnCalendar value into its day, date, time and optional timezone. */
export function parseOnCalendar(input: string): OnCalendarParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: '请输入 OnCalendar 表达式' };

  // A trailing `UTC` / `Asia/Shanghai` style token is a timezone, not a field.
  const tokens = trimmed.split(/\s+/);
  let timezone: string | null = null;
  if (tokens.length > 1 && /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(tokens[tokens.length - 1])) {
    timezone = tokens.pop() ?? null;
  }

  let expression = tokens.join(' ');

  // Keyword shorthands replace the whole expression.
  const keyword = KEYWORDS[expression.toLowerCase()];
  if (keyword) expression = keyword;

  if (!expression) return { ok: false, error: '表达式为空' };

  const parts = expression.split(/\s+/);

  // systemd accepts the parts in a fixed order but each is optional, so a bare
  // time (`09:00`) or a bare date (`*-*-01`) is valid.
  let weekdayText: string | null = null;
  let dateText: string | null = null;
  let timeText: string | null = null;

  for (const part of parts) {
    if (part.includes(':')) {
      if (timeText) return { ok: false, error: '出现了两个时间部分' };
      timeText = part;
    } else if (/^[A-Za-z]/.test(part)) {
      if (weekdayText) return { ok: false, error: '出现了两个星期部分' };
      weekdayText = part;
    } else if (part.includes('-')) {
      if (dateText) return { ok: false, error: '出现了两个日期部分' };
      dateText = part;
    } else {
      return { ok: false, error: `无法识别的部分 "${part}"` };
    }
  }

  // Date: YYYY-MM-DD (each component may be `*`, a list or a range).
  let yearText = '*';
  let monthText = '*';
  let dayText = '*';

  if (dateText) {
    // The `~` form replaces the month/day separator: `*-02~03` is year `*`,
    // month `02`, day "third last". Handling it here keeps the rest of the
    // parser unchanged, since `~N` only ever appears in the day position.
    const tildeSplit = /^(.*?)-(.*?)~(.*)$/.exec(dateText);
    if (tildeSplit) {
      yearText = tildeSplit[1];
      monthText = tildeSplit[2];
      dayText = `~${tildeSplit[3]}`;
    } else {
      const segments = dateText.split('-');
      if (segments.length !== 3) {
        return {
          ok: false,
          error: `日期部分 "${dateText}" 应为 年-月-日 三段（或 年-月~倒数 形式）`,
        };
      }
      [yearText, monthText, dayText] = segments;
    }
  }

  // Time: HH:MM:SS, with SS optional.
  let hourText = '*';
  let minuteText = '*';
  let secondText = '*';

  if (timeText) {
    const segments = timeText.split(':');
    if (segments.length < 2 || segments.length > 3) {
      return { ok: false, error: `时间部分 "${timeText}" 应为 时:分 或 时:分:秒` };
    }
    [hourText, minuteText] = segments;
    if (segments.length === 3) secondText = segments[2];
  }

  const weekday = parseSysField(weekdayText ?? '*', {
    name: '星期',
    min: 0,
    max: 6,
    aliases: WEEKDAY_ALIASES,
  });
  if ('error' in weekday) return { ok: false, error: weekday.error };

  const YEAR_SPEC = { name: '年', min: 1970, max: 9999 };
  const year = parseSysField(yearText, YEAR_SPEC);
  if ('error' in year) return { ok: false, error: year.error };

  const month = parseSysField(monthText, { name: '月', min: 1, max: 12 });
  if ('error' in month) return { ok: false, error: month.error };

  const day = parseSysField(dayText, { name: '日', min: 1, max: 31 });
  if ('error' in day) return { ok: false, error: day.error };

  const hour = parseSysField(hourText, { name: '小时', min: 0, max: 23 });
  if ('error' in hour) return { ok: false, error: hour.error };

  const minute = parseSysField(minuteText, { name: '分钟', min: 0, max: 59 });
  if ('error' in minute) return { ok: false, error: minute.error };

  const second = parseSysField(secondText, { name: '秒', min: 0, max: 59 });
  if ('error' in second) return { ok: false, error: second.error };

  return {
    ok: true,
    parsed: {
      normalized: expression,
      weekday,
      year,
      month,
      day,
      hour,
      minute,
      second,
      timezone,
    },
  };
}

/**
 * Renders a systemd field as the cron equivalent.
 *
 * The `a/b` form in cron means "from a, step b, **continuing to the field's
 * maximum**" — it is not a general "these values every b". So it may only be
 * used when the progression actually reaches the maximum. Emitting `1/1` for
 * Mon–Fri, for example, produces Mon–Sun: a silently wider schedule. That bug
 * was found by the systemd cross-validation test, which is why the field bounds
 * are now required arguments rather than assumed.
 */
function toCronField(field: SysField, bounds: { min: number; max: number }): string {
  if (field.values === null) return '*';

  const values = field.values;
  if (values.length === 1) return String(values[0]);

  // A fully covered range is what the bare star already means.
  if (values.length === bounds.max - bounds.min + 1) return '*';

  const gap = values[1] - values[0];
  const regular = values.every(
    (value, index) => index === 0 || value - values[index - 1] === gap,
  );

  if (regular && gap > 0) {
    // A contiguous run is expressed exactly (and more readably) as a range.
    if (gap === 1) return `${values[0]}-${values[values.length - 1]}`;

    const reachesMax = values[values.length - 1] + gap > bounds.max;
    if (reachesMax) return `${values[0]}/${gap}`;
  }

  return values.join(',');
}

export interface OnCalendarToCronResult {
  ok: true;
  /** 5-field cron, or null when cron cannot express the semantics. */
  cron: string | null;
  /** 6-field cron with a leading seconds field, when seconds are constrained. */
  cronWithSeconds: string | null;
  /** What cron would do if written with its own OR semantics — not equivalent. */
  approximateCron: string | null;
  notes: string[];
  /** True when the conversion changes behaviour. */
  lossy: boolean;
  /** True when no cron expression means the same thing. */
  impossible: boolean;
}

/** Converts a parsed OnCalendar to cron, reporting every compromise. */
export function onCalendarToCron(input: string): OnCalendarToCronResult | { ok: false; error: string } {
  const result = parseOnCalendar(input);
  if (!result.ok) return { ok: false, error: result.error };
  const { parsed } = result;

  const notes: string[] = [];
  let lossy = false;
  let impossible = false;

  const MINUTE = { min: 0, max: 59 };
  const HOUR = { min: 0, max: 23 };
  const DAY = { min: 1, max: 31 };
  const MONTH = { min: 1, max: 12 };
  const WEEKDAY = { min: 0, max: 6 };

  const minute = toCronField(parsed.minute, MINUTE);
  const hour = toCronField(parsed.hour, HOUR);
  const day = toCronField(parsed.day, DAY);
  const month = toCronField(parsed.month, MONTH);
  const weekday = toCronField(parsed.weekday, WEEKDAY);

  const weekdayRestricted = parsed.weekday.values !== null;
  const dateRestricted =
    parsed.day.values !== null || parsed.month.values !== null || parsed.day.fromEnd !== null;

  // cron has no "Nth from the end of the month" syntax at all, so this cannot be
  // expressed faithfully. The day ranges over `29-N .. 32-N` because the target
  // day is `length - N + 1` and month lengths are 28..31, which makes a range a
  // principled (if imperfect) stand-in.
  const fromEnd = parsed.day.fromEnd;
  if (fromEnd !== null) {
    impossible = true;
    lossy = true;
    const low = Math.max(1, 29 - fromEnd);
    const high = 32 - fromEnd;
    notes.push(
      `日期使用了 ~${fromEnd}（该月倒数第 ${fromEnd} 天）。cron 没有「倒数第几天」的写法，` +
        '因此无法等价表达——不同月份的天数不同（28/29/30/31），目标日期本身就会变。',
    );
    notes.push(
      `cron 的近似写法是 0 0 ${low}-${high} * *：覆盖所有可能的目标日期（${low} 到 ${high} 号），` +
        `但每个月会多触发几次，请确认业务能接受。`,
    );
  }

  if (weekdayRestricted && dateRestricted) {
    // The AND/OR mismatch. Refusing is the only honest option.
    impossible = true;
    lossy = true;
    notes.push(
      'systemd 是把「星期」与「日期」取交集（两者都要满足），cron 是取并集（任一满足就触发）。' +
        '因此没有任何一个 cron 表达式与它等价——直接翻译会导致触发次数明显变多，' +
        '所以这里不生成正式结果，只在下方给出「并集写法」供你判断。',
    );
  }

  if (parsed.year.values !== null) {
    lossy = true;
    notes.push(
      `表达式限定了年份（${parsed.year.raw}），而 cron 没有年份字段，年份条件会被丢弃`,
    );
  }

  const secondsRestricted =
    parsed.second.values !== null &&
    !(parsed.second.values.length === 1 && parsed.second.values[0] === 0);

  let cron: string | null = null;
  let cronWithSeconds: string | null = null;

  if (!impossible) {
    cron = [minute, hour, day, month, weekday].join(' ');
  }

  if (secondsRestricted) {
    lossy = true;
    const secondText = toCronField(parsed.second, { min: 0, max: 59 });
    // A 6-field form expresses it, but only for cron implementations that
    // support a seconds field — most do not.
    cronWithSeconds = [secondText, minute, hour, day, month, weekday].join(' ');
    notes.push(
      `表达式限定了秒（${parsed.second.raw}），标准 cron 没有秒字段。` +
        '下方附带了 6 段写法，但只有支持秒的实现（部分发行版、Quartz、Spring）才认；' +
        '标准 cron 只能退化为每分钟。',
    );
    if (!impossible && cron !== null) {
      notes.push('注意：5 段结果会忽略秒，实际触发频率会高于原表达式。');
    }
  }

  if (parsed.timezone) {
    lossy = true;
    notes.push(
      `表达式指定了时区 ${parsed.timezone}。cron 使用系统时区（或 crontab 的 CRON_TZ），` +
        '请确认服务器时区与之一致，否则触发时刻会整体偏移。',
    );
  }

  const approximateCron = impossible
    ? [
        minute,
        hour,
        fromEnd !== null ? `${Math.max(1, 29 - fromEnd)}-${32 - fromEnd}` : day,
        month,
        weekday,
      ].join(' ')
    : null;

  if (impossible && approximateCron && fromEnd === null) {
    notes.push(
      `并集写法为 ${approximateCron}：在每次「星期满足」以及每次「日期满足」时都会触发，次数更多。`,
    );
  }

  if (parsed.hour.values !== null && parsed.hour.values.length === 1) {
    // A repetition inside a fixed hour is a common source of surprise; state
    // what it actually expands to rather than leaving it implicit.
    const step = parsed.minute.step;
    if (step !== null && parsed.minute.values !== null) {
      notes.push(
        `HH:MM/step 在 systemd 里只在该小时内重复：${parsed.hour.raw}:${parsed.minute.raw} ` +
          `实际是每小时的第 ${parsed.hour.values[0]} 小时内的第 ${parsed.minute.values.join('、')} 分钟。`,
      );
    }
  }

  if (!lossy && !impossible) {
    notes.push('该表达式可以完整对应到 cron，行为一致。');
  }

  return {
    ok: true,
    cron,
    cronWithSeconds,
    approximateCron,
    notes,
    lossy,
    impossible,
  };
}

/** Examples used by the UI and by the cross-validation test. */
export const ONCALENDAR_SAMPLES: Array<{ label: string; expression: string; note: string }> = [
  { label: '每 5 分钟', expression: '*:0/5:00', note: '分字段步长，可完整对应' },
  { label: '每天 09:00', expression: '*-*-* 09:00:00', note: '最常见的形式' },
  { label: '工作日 09:00', expression: 'Mon..Fri *-*-* 09:00:00', note: '星期限定，可完整对应' },
  { label: '每月 1 日', expression: '*-*-01 00:00:00', note: '日期限定，可完整对应' },
  { label: '每小时整点', expression: 'hourly', note: '关键字简写' },
  { label: '每天 09:00 起每 15 分钟', expression: '09:00/15', note: '只在该小时内重复' },
  { label: '每 30 秒', expression: '*-*-* *:*:0/30', note: 'cron 无秒字段' },
  { label: '工作日且每月 1 日', expression: 'Mon..Fri *-*-01 09:00:00', note: '并集/交集冲突，cron 无法等价表达' },
];
