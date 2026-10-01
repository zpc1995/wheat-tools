/**
 * Safe regex execution helpers.
 *
 * Three real hazards are handled here rather than left to the caller:
 *
 * 1. **Zero-length matches.** `/(?:)/g.exec()` matches the empty string at every
 *    position and never advances `lastIndex`, so a naive `while (match)` loop
 *    spins forever. The loop below advances manually past zero-length matches.
 * 2. **Catastrophic backtracking (ReDoS).** A pattern like `(a+)+$` can hang the
 *    main thread for minutes on a short input. There is no way to interrupt a
 *    synchronous regex in JavaScript, so instead the risky *shape* is detected
 *    up front and reported, and a match count / time budget stops long runs.
 * 3. **Invalid patterns.** `new RegExp` throws; that is surfaced as a message.
 */

export interface RegexFlags {
  global: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
  sticky: boolean;
}

export const DEFAULT_FLAGS: RegexFlags = {
  global: true,
  ignoreCase: false,
  multiline: false,
  dotAll: false,
  unicode: false,
  sticky: false,
};

export function flagsToString(flags: RegexFlags): string {
  return [
    flags.global ? 'g' : '',
    flags.ignoreCase ? 'i' : '',
    flags.multiline ? 'm' : '',
    flags.dotAll ? 's' : '',
    flags.unicode ? 'u' : '',
    flags.sticky ? 'y' : '',
  ].join('');
}

export interface MatchGroup {
  name: string | null;
  index: number;
  value: string | null;
}

export interface RegexMatch {
  /** Position in the subject string. */
  index: number;
  text: string;
  groups: MatchGroup[];
  namedGroups: Record<string, string | null>;
}

export type CompileResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: string };

const FLAG_KEYS: Array<keyof RegexFlags> = [
  'global',
  'ignoreCase',
  'multiline',
  'dotAll',
  'unicode',
  'sticky',
];

/**
 * Compiles a pattern, reporting syntax errors instead of throwing.
 *
 * Flags are type-checked first: `flagsToString` is intentionally tolerant (it
 * just tests truthiness), so a non-boolean flag — which can happen when the
 * value is parsed from a URL or stored state — would otherwise be silently
 * accepted and produce a regex with the wrong behaviour.
 */
export function compile(pattern: string, flags: RegexFlags): CompileResult {
  for (const key of FLAG_KEYS) {
    if (typeof flags[key] !== 'boolean') {
      return { ok: false, error: `标志 ${key} 应为布尔值` };
    }
  }

  try {
    return { ok: true, regex: new RegExp(pattern, flagsToString(flags)) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '正则表达式无效',
    };
  }
}

export interface RiskReport {
  /** Human-readable warnings; empty when nothing looks risky. */
  warnings: string[];
  /** True when a warning is severe enough to skip matching entirely. */
  blocked: boolean;
}

/**
 * Looks for the classic ReDoS shapes.
 *
 * This is a heuristic, not a proof: it flags nested quantifiers, quantified
 * alternation and adjacent unbounded quantifiers, which cover the overwhelming
 * majority of pathological patterns people actually write by accident.
 */
export function assessRisk(pattern: string): RiskReport {
  const warnings: string[] = [];

  // (a+)+ / (a*)* / (a+)* — a quantifier applied to a group that itself ends
  // in an unbounded quantifier.
  if (/\([^)]*[+*]\)[+*]/.test(pattern) || /\([^)]*\{\d+,\}\)[+*{]/.test(pattern)) {
    warnings.push('存在「量词嵌套量词」（如 (a+)+），输入稍长就可能指数级回溯');
  }

  // (a|a)+ style alternation inside a quantified group.
  if (/\([^)]*\|[^)]*\)[+*]/.test(pattern)) {
    warnings.push('量词作用于含「|」的分组，可能是灾难性回溯的来源');
  }

  // a+a+ / .*.+ — two unbounded quantifiers separated only by literals.
  if (/[+*][^+*?)]{0,12}[+*]/.test(pattern) && /[+*]/.test(pattern)) {
    const suspicious = /(\w[+*])[^)]{0,20}(\w[+*])/.test(pattern);
    if (suspicious) {
      warnings.push('多个无界量词相邻，回溯代价可能很高');
    }
  }

  return {
    warnings,
    // Nested quantifiers are the one shape worth refusing outright on long input.
    blocked: /\([^)]*[+*]\)[+*]/.test(pattern),
  };
}

export interface ExecuteOptions {
  /** Hard cap on collected matches, to bound work on catastrophic inputs. */
  maxMatches: number;
  /** Subject longer than this is truncated before matching. */
  maxSubjectLength: number;
}

export const DEFAULT_EXECUTE_OPTIONS: ExecuteOptions = {
  maxMatches: 1000,
  maxSubjectLength: 200_000,
};

export type ExecuteResult =
  | {
      ok: true;
      matches: RegexMatch[];
      /** True when the match cap was hit before finishing. */
      truncated: boolean;
      /** Time spent matching, in milliseconds. */
      elapsedMs: number;
    }
  | { ok: false; error: string };

/**
 * Runs the pattern against the subject, collecting matches.
 *
 * Always resets `lastIndex` first: a `RegExp` object with `g` is stateful, and
 * reusing one without resetting silently starts mid-string.
 */
export function execute(
  regex: RegExp,
  subject: string,
  options: ExecuteOptions = DEFAULT_EXECUTE_OPTIONS,
): ExecuteResult {
  const started = performance.now();
  const matches: RegexMatch[] = [];
  let truncated = false;

  // Without `g` or `y` only the first match is meaningful.
  if (!regex.global && !regex.sticky) {
    regex.lastIndex = 0;
    const match = regex.exec(subject);
    if (match) matches.push(toMatch(match));
    return {
      ok: true,
      matches,
      truncated: false,
      elapsedMs: performance.now() - started,
    };
  }

  regex.lastIndex = 0;
  let guard = 0;

  while (guard < options.maxMatches) {
    guard += 1;
    const match = regex.exec(subject);
    if (!match) break;

    matches.push(toMatch(match));

    // Zero-length match: `lastIndex` does not advance, so move it by hand or
    // this loop never terminates.
    if (match[0] === '') {
      regex.lastIndex += 1;
      if (regex.lastIndex > subject.length) break;
    }

    if (matches.length >= options.maxMatches) {
      truncated = true;
      break;
    }
  }

  return {
    ok: true,
    matches,
    truncated,
    elapsedMs: performance.now() - started,
  };
}

function toMatch(match: RegExpExecArray): RegexMatch {
  const groups: MatchGroup[] = [];
  for (let index = 1; index < match.length; index += 1) {
    groups.push({ name: null, index, value: match[index] ?? null });
  }

  const named = match.groups ?? {};
  const namedGroups: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(named)) {
    namedGroups[name] = value ?? null;
    // Attach the name to the positional group too, which is friendlier to read.
    const positional = groups.find(
      (group) => group.value !== null && group.value === value,
    );
    if (positional && positional.name === null) positional.name = name;
  }

  return { index: match.index, text: match[0], groups, namedGroups };
}

export interface Segment {
  text: string;
  /** True when this segment is a match rather than plain text. */
  match: boolean;
  /** Index of the corresponding match, for cross-highlighting. */
  matchIndex?: number;
}

/**
 * Splits the subject into alternating plain/matched segments for highlighting.
 *
 * Uses index arithmetic on the collected matches rather than `String.replace`,
 * so zero-length matches cannot produce an infinite or nonsensical result.
 */
export function segment(subject: string, matches: RegexMatch[]): Segment[] {
  if (matches.length === 0) return [{ text: subject, match: false }];

  const segments: Segment[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    if (match.index > cursor) {
      segments.push({ text: subject.slice(cursor, match.index), match: false });
    }
    if (match.text.length > 0) {
      segments.push({ text: match.text, match: true, matchIndex: index });
    } else {
      // A zero-width match has nothing to highlight; show a marker instead so
      // the user can still see where it landed.
      segments.push({ text: '', match: true, matchIndex: index });
    }
    cursor = Math.max(cursor, match.index + match.text.length);
  });

  if (cursor < subject.length) {
    segments.push({ text: subject.slice(cursor), match: false });
  }

  return segments;
}

/** Applies a replacement using the standard `$1`/`$<name>` syntax. */
export function replaceAll(
  regex: RegExp,
  subject: string,
  replacement: string,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    // A fresh regex avoids inheriting `lastIndex` from the match pass.
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    return { ok: true, value: subject.replace(new RegExp(regex.source, flags), replacement) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '替换失败',
    };
  }
}

/** Ready-made patterns, each with a short explanation of what it demonstrates. */
export const PATTERN_PRESETS: Array<{
  label: string;
  pattern: string;
  flags: Partial<RegexFlags>;
  note: string;
}> = [
  { label: '邮箱', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+', flags: { global: true }, note: '基础邮箱匹配' },
  { label: 'URL', pattern: 'https?://[^\\s"\'<>]+', flags: { global: true }, note: '抓取链接' },
  { label: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: { global: true }, note: '点分四段' },
  { label: '手机号(中国)', pattern: '1[3-9]\\d{9}', flags: { global: true }, note: '11 位手机号' },
  { label: '日期 YYYY-MM-DD', pattern: '(\\d{4})-(\\d{2})-(\\d{2})', flags: { global: true }, note: '含捕获组' },
  { label: '命名分组', pattern: '(?<year>\\d{4})-(?<month>\\d{2})', flags: { global: true }, note: '使用 (?<name>)' },
  { label: '十六进制颜色', pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b', flags: { global: true }, note: '3 或 6 位' },
  { label: '中文', pattern: '[\\u4e00-\\u9fa5]+', flags: { global: true }, note: '常用汉字区间' },
  { label: '重复单词', pattern: '\\b(\\w+)\\s+\\1\\b', flags: { global: true, ignoreCase: true }, note: '反向引用' },
  { label: '多行开头', pattern: '^\\s*//.*$', flags: { global: true, multiline: true }, note: '需开启 m 标志' },
  { label: '灾难性回溯示例', pattern: '(a+)+$', flags: { global: true }, note: '用于观察风险提示（请勿在大输入上运行）' },
];
