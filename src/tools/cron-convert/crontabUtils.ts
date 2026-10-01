import { describeCron, nextRuns, parseCron } from '../cron-builder/cronUtils';
import { toSystemd } from './cronConvertUtils';

/**
 * Crontab file parsing.
 *
 * A crontab is a small configuration language with more in it than the schedule
 * column people paste into converters, and each extra part has a way of biting:
 *
 * - **Environment assignments** (`MAILTO`, `CRON_TZ`, `PATH`, `SHELL`, …) apply
 *   to every job after them. `CRON_TZ` in particular changes when jobs run, so
 *   ignoring it would misreport every subsequent time.
 * - **The `%` character** in a command is special to Vixie cron: it ends the
 *   command and everything after it becomes the job's standard input. A command
 *   containing `%` (a `date +%F`, a URL-encoded string) therefore behaves
 *   differently from how it reads, which is worth flagging.
 * - **cron.d files carry an extra user field.** Pasting a crontab into a
 *   cron.d file, or the reverse, silently reinterprets the command as a
 *   username.
 * - **`@reboot` has no time-of-day meaning** and cannot be expressed as a
 *   calendar expression at all — not in cron, not in systemd, not in Actions.
 * - **Blank lines and comments** look like noise but a `#` inside a command is
 *   *not* a comment in every implementation, so only a leading `#` is treated as
 *   one here.
 */

export interface CronEnvVar {
  /** 1-based line number. */
  line: number;
  name: string;
  value: string;
  /** True for names this tool knows affect scheduling or delivery. */
  known: boolean;
  note?: string;
}

/** Environment names with scheduling or delivery effects worth explaining. */
const KNOWN_ENV: Record<string, string> = {
  CRON_TZ: '为该文件后续的任务指定时区，会改变实际触发时刻',
  TZ: '指定时区（部分实现支持）',
  MAILTO: '任务输出会邮寄到这个地址；设为空字符串则不发送邮件',
  MAILFROM: '邮件发件人地址',
  PATH: '任务执行时的 PATH，与交互式 shell 通常不同',
  SHELL: '执行任务的 shell，默认是 /bin/sh',
  HOME: '任务执行时的 HOME',
  LOGNAME: '任务执行时的登录名',
  RANDOM_DELAY: '为任务的分钟数加一个随机延迟，避免整点并发',
};

export type JobKind = 'standard' | 'shortcut' | 'interval';

export interface CronJob {
  /** 1-based line number in the source. */
  line: number;
  kind: JobKind;
  /** The raw schedule text exactly as written, e.g. a five-field expression. */
  schedule: string;
  /** The user field, present in cron.d/crontab system format. */
  user: string | null;
  /** The command, with `%` handling applied. */
  command: string;
  /** Command text before the first `%`, when the line contained one. */
  commandBeforePercent: string | null;
  /** Standard input produced by `%` segments, when present. */
  stdin: string[] | null;

  parseable: boolean;
  error?: string;
  /** Chinese description of the schedule. */
  description?: string;
  /** Next runs as local `YYYY-MM-DD HH:MM` strings. */
  nextRuns?: string[];
  /** systemd OnCalendar equivalent, when one exists. */
  systemd?: string | null;
  /** Why no systemd equivalent exists, for `@reboot`. */
  systemdNote?: string;

  warnings: string[];
}

/**
 * Which crontab flavour the text is.
 *
 * This cannot always be inferred: `0 1 * * * root /a.sh` is `user root` followed
 * by a command in a system crontab, and the command `root /a.sh` in a user
 * crontab. The same characters mean different things, so the caller may state
 * the dialect and the automatic mode reports what it assumed instead of
 * pretending to be certain.
 */
export type CrontabDialect = 'auto' | 'user' | 'system';

export interface CrontabOptions {
  dialect: CrontabDialect;
}

export const DEFAULT_CRONTAB_OPTIONS: CrontabOptions = { dialect: 'auto' };

export interface CrontabAnalysis {
  ok: true;
  /** Dialect actually used for interpretation. */
  dialect: 'user-crontab' | 'system-crontab';
  /** How that dialect was decided. */
  dialectSource: 'explicit' | 'inferred';
  jobs: CronJob[];
  /** Environment assignments in file order. */
  env: CronEnvVar[];
  /** Lines where the user field could not be decided automatically. */
  ambiguousLines: number[];
  /** Header comments and section markers, for context. */
  comments: Array<{ line: number; text: string }>;
  warnings: string[];
  stats: {
    lines: number;
    jobs: number;
    comments: number;
    envVars: number;
    unparseable: number;
  };
}

export type CrontabResult = CrontabAnalysis | { ok: false; error: string };

/** Shortcut keywords and the 5-field expression each is equivalent to. */
const SHORTCUTS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  // `@reboot` deliberately has no expression: it is an event, not a schedule.
  '@reboot': '',
};

const SPECIAL_COMMANDS = new Set(['@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly']);

/** Strips a trailing `# ...` comment, respecting that `#` inside a command is literal in most implementations. */
function stripLeadingComment(line: string): { text: string; comment: string | null } {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) {
    return { text: '', comment: trimmed.replace(/^#+\s?/, '') };
  }
  return { text: line, comment: null };
}

/**
 * Whether a token could be a sixth time field rather than the start of a command.
 *
 * Counting time fields by "the first N tokens that look field-like" does not
 * work: `/opt/backup.sh` consists only of characters that are also legal in a
 * cron field, so a naive character test swallows the command. The rule used here
 * is structural instead —
 *
 *   - the first five tokens are always time fields (that part is not ambiguous),
 *   - a sixth token counts as a time field only if it *starts* like one: a digit,
 *     `*`, `?`, `,` or `~`, with any `/` followed by a digit or `*`.
 *
 * So a six-field expression with a repeating-seconds prefix keeps all six
 * fields, while a five-field schedule followed by a path keeps the path as its
 * command. Month and weekday names (`MON`, `JAN`) only ever appear inside the
 * first five tokens, so excluding letters here costs nothing.
 */
function isSixthTimeField(token: string): boolean {
  if (!/^[0-9*?,~][0-9*,\-/?~]*$/.test(token)) return false;
  const slash = token.indexOf('/');
  if (slash !== -1 && !/^[0-9*]/.test(token.slice(slash + 1))) return false;
  return true;
}

/**
 * Splits a job line into its schedule and the remainder (user + command).
 *
 * Returns null when there are fewer than five time fields, which is a genuine
 * syntax error rather than a command.
 */
function splitJobLine(text: string): {
  schedule: string;
  rest: string;
} | null {
  const trimmed = text.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  if (tokens[0].startsWith('@')) {
    return { schedule: tokens[0], rest: trimmed.slice(tokens[0].length).trim() };
  }

  if (tokens.length < 5) return null;

  // A sixth field is consumed only when it genuinely looks like one.
  const fieldCount = tokens.length > 5 && isSixthTimeField(tokens[5]) ? 6 : 5;
  const schedule = tokens.slice(0, fieldCount).join(' ');

  // Slice from the original text so internal spacing is preserved.
  const consumedLength = trimmed.indexOf(tokens[fieldCount]);
  const rest = consumedLength === -1 ? '' : trimmed.slice(consumedLength).trim();

  return { schedule, rest };
}

function localRunString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Analyses a job's schedule and fills in description, next runs and systemd. */
function analyseSchedule(job: CronJob, explicitUser: boolean): void {
  if (job.kind === 'shortcut' && job.schedule.toLowerCase() === '@reboot') {
    job.parseable = true;
    job.description = '系统启动后执行一次（不是按时间触发）';
    job.systemd = null;
    job.systemdNote =
      '这不是时间表而是事件。systemd 里对应的是在目标上挂 WantedBy= 的 service，' +
      '或用 OnBootSec=；没有任何 cron 表达式能表达它。';
    job.warnings.push(
      '`@reboot` 只在 cron 守护进程启动时触发一次，不是「机器每次启动」——' +
        '容器、重启守护进程等场景下行为与预期不同。',
    );
    return;
  }

  const expression = SHORTCUTS[job.schedule.toLowerCase()] ?? job.schedule;
  const parsed = parseCron(expression);

  if (!parsed.ok) {
    job.parseable = false;
    job.error = parsed.error;
    return;
  }

  job.parseable = true;
  job.description = describeCron(parsed.value);
  job.nextRuns = nextRuns(parsed.value, 5, new Date()).map((run) =>
    localRunString(run.date),
  );

  const sixField = expression.trim().split(/\s+/).length === 6;
  if (sixField) {
    job.warnings.push(
      '该任务有 6 个时间字段（含秒）。标准 Vixie cron 只接受 5 个字段，' +
        '这段在多数字符串下会被判为语法错误；只有部分实现支持秒。',
    );
  }

  // systemd cannot express a seconds field in the same way, and `toSystemd`
  // reports that itself.
  const systemd = toSystemd(expression);
  job.systemd = 'error' in systemd ? null : systemd.code;

  if (explicitUser) {
    job.warnings.push(
      '这一行有额外的「用户」字段（cron.d / 系统 crontab 格式）。' +
        '把它粘进普通用户 crontab 会让命令被当成用户名执行。',
    );
  }

  if (job.command.length === 0) {
    job.warnings.push('这一行没有命令，cron 会忽略它。');
  }
}

/** Account names that strongly suggest a system crontab's user field. */
const SYSTEM_ACCOUNTS = new Set([
  'root', 'nobody', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'lp',
  'mail', 'news', 'uucp', 'proxy', 'www-data', 'backup', 'list', 'irc',
  'gnats', 'systemd-network', 'systemd-timesync', 'messagebus', 'sshd',
  'postgres', 'mysql', 'redis', 'nginx', 'apache', 'cron',
]);

/** Parses a crontab file's contents. */
export function parseCrontab(
  source: string,
  options: CrontabOptions = DEFAULT_CRONTAB_OPTIONS,
): CrontabResult {
  const text = source.replace(/\r\n?/g, '\n');
  if (!text.trim()) return { ok: false, error: '请粘贴 crontab 内容' };
  if (text.length > 256 * 1024) return { ok: false, error: '内容过大' };

  // A trailing newline does not make an extra line; counting it would put the
  // reported line count one above what an editor shows.
  const lines = text.replace(/\n$/, '').split('\n');
  const jobs: CronJob[] = [];
  const env: CronEnvVar[] = [];
  const comments: Array<{ line: number; text: string }> = [];
  const warnings: string[] = [];

  // Dialect resolution.
  //
  // `auto` looks for a token that is a known system account name, which is a
  // strong signal. Failing that it assumes a user crontab — the far more common
  // thing to paste — and records the ambiguity so the result can say so.
  const explicit = options.dialect !== 'auto';
  let dialect: 'user-crontab' | 'system-crontab' =
    options.dialect === 'system' ? 'system-crontab' : 'user-crontab';
  const ambiguousLines: number[] = [];

  if (options.dialect === 'auto') {
    // A known account name in the user-field position, followed by anything at
    // all, is the signal. It must not require the command to look like a path:
    // real cron.d lines run things like `cd / && run-parts ...`, and tightening
    // it that way silently stopped detecting the actual Debian layout.
    const accountHit =
      /^\s*(?:[0-9*,\-/]+\s+){5}([a-z_][a-z0-9_-]*)\s+\S/m.exec(text);
    if (accountHit && SYSTEM_ACCOUNTS.has(accountHit[1].toLowerCase())) {
      dialect = 'system-crontab';
    }
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const { text: body, comment } = stripLeadingComment(rawLine);
    if (comment !== null) {
      comments.push({ line: lineNumber, text: comment });
      return;
    }
    if (!body.trim()) return;

    // `NAME=value` is an environment assignment, not a job. Matched only at the
    // start of the line, since `FOO=bar cmd` as a command is also legal.
    const envMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(body);
    if (envMatch && !body.trim().startsWith('@')) {
      const name = envMatch[1].toUpperCase();
      const value = envMatch[2].replace(/^["']|["']$/g, '').trim();
      const knownNote = KNOWN_ENV[name];
      env.push({
        line: lineNumber,
        name,
        value,
        known: Boolean(knownNote),
        note: knownNote,
      });
      if (name === 'CRON_TZ' || name === 'TZ') {
        warnings.push(
          `第 ${lineNumber} 行设置了 ${name}=${value}：该文件后续任务的触发时刻都按这个时区计算，` +
            '下面的「下次执行」是按本机时区换算的结果。',
        );
      }
      if (name === 'MAILTO' && value !== '') {
        warnings.push(
          `第 ${lineNumber} 行设置了 MAILTO=${value}：任务输出会发送到该地址，` +
            '调试时如果收不到邮件，记得 cron 只在有输出时才发信。',
        );
      }
      return;
    }

    const parts = splitJobLine(body);
    if (!parts) {
      warnings.push(
        `第 ${lineNumber} 行无法识别为任务或环境变量，已跳过：${body.trim().slice(0, 80)}`,
      );
      return;
    }

    const isShortcut = parts.schedule.startsWith('@');
    if (isShortcut && !SPECIAL_COMMANDS.has(parts.schedule.toLowerCase())) {
      warnings.push(`第 ${lineNumber} 行使用了未知的 @ 关键字 ${parts.schedule}`);
    }

    const tokenCount = parts.schedule.trim().split(/\s+/).length;
    const isShortcutJob = parts.schedule.startsWith('@');

    // In a system crontab the first token after the schedule is the user.
    let user: string | null = null;
    let command = parts.rest;

    if (!isShortcutJob && dialect === 'system-crontab') {
      const restTokens = parts.rest.split(/\s+/).filter(Boolean);
      if (restTokens.length > 1) {
        user = restTokens[0];
        command = parts.rest.slice(parts.rest.indexOf(restTokens[1])).trim();
      }
    } else if (!isShortcutJob && options.dialect === 'auto') {
      // Under auto the user-crontab reading is assumed, so anything shaped like
      // `<name> <path>` is reported: that is exactly the case where the
      // assumption may be wrong. Requiring the second token to start with `/` or
      // `.` keeps ordinary commands with word arguments (`echo hi`) out of it.
      const restTokens = parts.rest.split(/\s+/).filter(Boolean);
      if (
        restTokens.length > 1 &&
        /^[a-z_][a-z0-9_-]*$/i.test(restTokens[0]) &&
        /^[./]/.test(restTokens[1])
      ) {
        ambiguousLines.push(lineNumber);
      }
    }

    // Vixie cron: the first unescaped `%` ends the command and the rest becomes
    // standard input. Escaped `\%` is a literal percent sign.
    let commandBeforePercent: string | null = null;
    let stdin: string[] | null = null;

    const percentIndex = findUnescapedPercent(command);
    if (percentIndex !== -1) {
      commandBeforePercent = command.slice(0, percentIndex);
      stdin = command
        .slice(percentIndex + 1)
        .split(/(?<!\\)%/)
        .map((segment) => segment.replace(/\\%/g, '%'));
      command = commandBeforePercent;
    }

    const job: CronJob = {
      line: lineNumber,
      kind: isShortcutJob ? 'shortcut' : tokenCount === 6 ? 'interval' : 'standard',
      schedule: parts.schedule,
      user,
      command: command.replace(/\\%/g, '%'),
      commandBeforePercent,
      stdin,
      parseable: false,
      warnings: [],
    };

    if (stdin) {
      job.warnings.push(
        '命令里含有 `%`：在 Vixie cron 中它会结束命令，其后的内容作为该任务的' +
          '标准输入；需要字面量百分号时必须写成 `\\%`（例如 `date +\\%F`）。',
      );
    }

    analyseSchedule(job, user !== null);

    if (isShortcut && SPECIAL_COMMANDS.has(job.schedule.toLowerCase())) {
      const expanded = SHORTCUTS[job.schedule.toLowerCase()];
      if (expanded) {
        job.description = `${job.description ?? ''}（等价于 ${expanded}）`.trim();
      }
    }

    jobs.push(job);
  });

  if (jobs.length === 0 && env.length === 0) {
    return { ok: false, error: '没有解析到任何任务或环境变量，请检查内容是否为 crontab' };
  }

  const unparseable = jobs.filter((job) => !job.parseable).length;
  if (unparseable > 0) {
    warnings.push(`有 ${unparseable} 个任务的时间表达式无法解析，已在下方标注。`);
  }

  if (ambiguousLines.length > 0 && options.dialect === 'auto') {
    warnings.push(
      `第 ${ambiguousLines.join('、')} 行的第一个词看起来像系统账号名。` +
        '如果这份内容来自 /etc/crontab 或 /etc/cron.d，请把「格式」切换为系统 crontab，' +
        '否则它会被当作命令的一部分。',
    );
  }

  if (dialect === 'system-crontab' && options.dialect === 'auto') {
    warnings.push(
      '自动判断为系统 crontab（发现了系统账号名作为用户字段），因此每行多出的第一个词按用户名处理。' +
        '如果判断有误，请手动切换格式。',
    );
  }

  if (dialect === 'system-crontab') {
    warnings.push(
      '系统 crontab 与用户 crontab 的用户字段位置不同：把这份内容放进普通用户 crontab，' +
        '或反之，命令都会被重新解释。',
    );
  }

  return {
    ok: true,
    dialect,
    dialectSource: explicit ? 'explicit' : 'inferred',
    ambiguousLines,
    jobs,
    env,
    comments,
    warnings,
    stats: {
      lines: lines.length,
      jobs: jobs.length,
      comments: comments.length,
      envVars: env.length,
      unparseable,
    },
  };
}

/** Finds the first `%` that is not escaped with a backslash. */
function findUnescapedPercent(text: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '%') continue;
    // Count preceding backslashes: an odd count means it is escaped.
    let backslashes = 0;
    let cursor = index - 1;
    while (cursor >= 0 && text[cursor] === '\\') {
      backslashes += 1;
      cursor -= 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

/** Ready-made examples covering the dialects and the usual mistakes. */
export const CRONTAB_SAMPLES: Array<{ label: string; note: string; text: string }> = [
  {
    label: '用户 crontab',
    note: '带环境变量与注释的常见形态',
    text: `# 备份与清理
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=ops@example.com

# 每天凌晨 2:30 备份
30 2 * * * /opt/scripts/backup.sh --full

# 工作日每 15 分钟检查一次
*/15 9-18 * * 1-5 /opt/scripts/health-check.sh

# 每周日清理旧日志
@weekly /opt/scripts/cleanup.sh
`,
  },
  {
    label: '含 % 的命令',
    note: 'Vixie cron 会把 % 之后的内容当标准输入',
    text: `# 这个写法很危险：%F 之后的 %T 会变成标准输入
0 6 * * * /bin/date +%F >> /var/log/date.log

# 正确写法：转义百分号
0 7 * * * /bin/date +\\%F\\ \\%T >> /var/log/date.log
`,
  },
  {
    label: '系统 crontab（含用户字段）',
    note: '/etc/cron.d 格式，多一个用户字段',
    text: `# /etc/cron.d/example
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

17 *	* * *	root	cd / && run-parts --report /etc/cron.hourly
25 6	* * *	root	test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )
47 6	* * 7	root	test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.weekly )
`,
  },
  {
    label: '带时区设置',
    note: 'CRON_TZ 会改变后续任务的实际触发时刻',
    text: `CRON_TZ=UTC
# 这个 9 点是 UTC 的 9 点，不是本地的
0 9 * * * /opt/scripts/report.sh

CRON_TZ=Asia/Shanghai
# 这个才是北京时间的 9 点
0 9 * * * /opt/scripts/notify.sh
`,
  },
  {
    label: '@reboot 与其它简写',
    note: '@reboot 不是时间表，无法转成日历表达式',
    text: `@reboot /opt/scripts/on-boot.sh
@hourly /opt/scripts/hourly.sh
@daily /opt/scripts/daily.sh
@monthly /opt/scripts/monthly.sh
`,
  },
  {
    label: '有问题的行',
    note: '字段数不足、未知关键字、月份越界',
    text: `# 少一个字段
0 9 * * /opt/scripts/a.sh

# 未知的 @ 关键字
@fortnightly /opt/scripts/b.sh

# 月份 13 越界
0 0 1 13 * /opt/scripts/c.sh
`,
  },
];
