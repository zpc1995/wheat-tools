import { parseDocument } from 'yaml';
import { describeCron, nextRuns, parseCron } from '../cron-builder/cronUtils';
import { toSystemd } from './cronConvertUtils';

/**
 * GitHub Actions workflow → schedule analysis.
 *
 * This direction exists because the interesting question is not "what cron is
 * this" — it is already cron — but **"when does this actually run, and will it
 * behave the way I assume?"**. Actions adds constraints that cron does not have,
 * and each one bites people in practice:
 *
 * - `schedule:` entries are always **UTC**. A workflow written as `0 9 * * *`
 *   by someone in CST runs at 17:00 local, not 09:00. This is the single most
 *   common mistake, so local time is computed and shown explicitly.
 * - **Five fields only.** A six-field expression with seconds is rejected by
 *   GitHub, so it is reported rather than silently passed through.
 * - **Minimum interval is 5 minutes.** GitHub rejects anything more frequent.
 * - Scheduled workflows are **disabled after 60 days of repository inactivity**,
 *   and runs may be **delayed** during high load. Neither is visible in the
 *   expression, yet both change whether the schedule is met.
 *
 * Parsing the YAML itself uses the `yaml` package in core mode: a workflow file
 * is untrusted input as far as this tool is concerned, and `parseDocument`
 * surfaces duplicate keys instead of silently keeping the last one.
 */

export interface ActionSchedule {
  /** The raw cron string as written. */
  cron: string;
  /** 1-based position within `on.schedule`, for error messages. */
  index: number;
  ok: boolean;
  error?: string;
  /** Chinese description, when parseable. */
  description?: string;
  /** Cron field count as written. */
  fieldCount: number;
  /** True when the expression has fewer than 5 fields. */
  tooFewFields: boolean;
  /** True when the expression has more than 5 fields (seconds). */
  hasSeconds: boolean;
  /** Minimum gap between runs, in minutes, when computable. */
  minIntervalMinutes?: number;
  /** The next few runs in UTC, as ISO strings. */
  nextUtc?: string[];
  /** The same runs rendered in the viewer's local time zone. */
  nextLocal?: string[];
  /** systemd equivalent, for hosts that use timers. */
  systemd?: string | null;
}

export interface WorkflowAnalysis {
  ok: true;
  /** Workflow name if present. */
  name: string | null;
  schedules: ActionSchedule[];
  /** True when the workflow also has a manual trigger, which is worth knowing. */
  hasWorkflowDispatch: boolean;
  /** Other top-level `on:` triggers found. */
  otherTriggers: string[];
  warnings: string[];
}

export type AnalyzeResult = WorkflowAnalysis | { ok: false; error: string };

/** Reads a nested value defensively; workflow files are untrusted input. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Computes the smallest gap between consecutive runs, in minutes.
 *
 * Derived from actual fire times rather than from the expression, because step
 * and list forms interact and only the resulting times are authoritative.
 * GitHub's 5-minute floor is checked against this.
 */
function minIntervalFromRuns(expression: string): number | undefined {
  const parsed = parseCron(expression);
  if (!parsed.ok) return undefined;

  const runs = nextRuns(parsed.value, 20, new Date());
  if (runs.length < 2) return undefined;

  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < runs.length; index += 1) {
    const gap = (runs[index].date.getTime() - runs[index - 1].date.getTime()) / 60000;
    if (gap < smallest) smallest = gap;
  }
  return Number.isFinite(smallest) ? smallest : undefined;
}

/** Renders a Date in the viewer's local zone, including the offset. */
function localString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** UTC rendering, matching how Actions reports times. */
function utcString(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function analyseSchedule(cron: string, index: number): ActionSchedule {
  const fields = cron.trim().split(/\s+/).filter(Boolean);
  const base: ActionSchedule = {
    cron,
    index,
    ok: false,
    fieldCount: fields.length,
    tooFewFields: fields.length < 5,
    hasSeconds: fields.length > 5,
  };

  if (fields.length !== 5) {
    base.error =
      fields.length < 5
        ? `只有 ${fields.length} 段，GitHub Actions 需要 5 段（分 时 日 月 周）`
        : `${fields.length} 段：GitHub Actions 不接受秒字段，只支持 5 段`;
    return base;
  }

  const parsed = parseCron(cron);
  if (!parsed.ok) {
    base.error = parsed.error;
    return base;
  }

  const runs = nextRuns(parsed.value, 5, new Date());
  const minIntervalMinutes = minIntervalFromRuns(cron);

  const systemdConversion = toSystemd(cron);

  return {
    ...base,
    ok: true,
    description: describeCron(parsed.value),
    minIntervalMinutes,
    nextUtc: runs.map((run) => utcString(run.date)),
    nextLocal: runs.map((run) => localString(run.date)),
    systemd: 'error' in systemdConversion ? null : systemdConversion.code,
  };
}

/** Analyses a workflow YAML document. */
export function analyseWorkflow(source: string): AnalyzeResult {
  const text = source.trim();
  if (!text) return { ok: false, error: '请粘贴 GitHub Actions workflow 内容' };
  if (text.length > 512 * 1024) return { ok: false, error: '内容过大' };

  // `parseDocument` rather than `parse`: the latter silently repairs several
  // kinds of malformed YAML — `a: [1, 2` comes back as `{a: [1, 2]}` with no
  // indication that the input was broken. Since the point is to tell the user
  // whether their workflow file is valid, the errors have to be visible.
  //
  // `core` schema: no custom tags are evaluated, so a hostile workflow file
  // cannot turn into live values here.
  let parsedDocument;
  try {
    parsedDocument = parseDocument(text, { schema: 'core', logLevel: 'silent' });
  } catch (error) {
    return {
      ok: false,
      error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (parsedDocument.errors.length > 0) {
    const first = parsedDocument.errors[0];
    const line = first.linePos?.[0];
    const where = line ? `第 ${line.line} 行第 ${line.col} 列：` : '';
    return {
      ok: false,
      error: `YAML 语法错误 —— ${where}${first.message.split('\n')[0]}`,
    };
  }

  const document = parsedDocument.toJS() as unknown;

  const root = asRecord(document);
  if (!root) return { ok: false, error: 'YAML 顶层应为一个映射（workflow 定义）' };

  const warnings: string[] = [];
  const name = typeof root.name === 'string' ? root.name : null;

  // `on` may be a string, a list, or a mapping. YAML 1.1 would read a bare `on`
  // as the boolean true; the `yaml` package in core mode keeps it a string,
  // which is why no special-casing is needed here.
  const onValue = root.on ?? root.true;
  const on = asRecord(onValue);

  const otherTriggers: string[] = [];
  let hasWorkflowDispatch = false;
  let scheduleValue: unknown = null;

  if (typeof onValue === 'string') {
    otherTriggers.push(onValue);
    if (onValue === 'workflow_dispatch') hasWorkflowDispatch = true;
  } else if (Array.isArray(onValue)) {
    for (const item of onValue) if (typeof item === 'string') otherTriggers.push(item);
    hasWorkflowDispatch = otherTriggers.includes('workflow_dispatch');
  } else if (on) {
    for (const key of Object.keys(on)) {
      if (key === 'schedule') {
        scheduleValue = on[key];
        continue;
      }
      if (key === 'workflow_dispatch') hasWorkflowDispatch = true;
      otherTriggers.push(key);
    }
  }

  if (!on) {
    warnings.push(
      '这个文件没有 `on:` 触发器部分，或它的结构无法识别（`on` 应为字符串、列表或映射）。',
    );
  }

  // `schedule` is a list of `{ cron: '...' }` mappings.
  const schedules: ActionSchedule[] = [];
  if (Array.isArray(scheduleValue)) {
    scheduleValue.forEach((entry, index) => {
      const record = asRecord(entry);
      const cron = record && typeof record.cron === 'string' ? record.cron : null;
      if (cron === null) {
        schedules.push({
          cron: '',
          index: index + 1,
          ok: false,
          error: '该 schedule 项缺少字符串类型的 cron 字段',
          fieldCount: 0,
          tooFewFields: true,
          hasSeconds: false,
        });
        return;
      }
      schedules.push(analyseSchedule(cron, index + 1));
    });
  } else if (scheduleValue !== null) {
    warnings.push('`on.schedule` 应为列表，每个元素形如 `- cron: "0 9 * * *"`。');
  }

  if (schedules.length === 0 && scheduleValue === null) {
    warnings.push(
      '没有找到 `on.schedule`。如果这个 workflow 是靠 push / pull_request 触发的，' +
        '那它本来就没有定时计划。',
    );
  }

  // These apply to every scheduled workflow, so they are stated once.
  if (schedules.length > 0) {
    warnings.push(
      'Actions 的 schedule 一律按 UTC 解释，与仓库或你的本地时区无关；上表已同时列出 UTC 与本地时间。',
    );
    warnings.push(
      '仓库连续 60 天没有活动后，定时 workflow 会被自动停用；高负载时段的实际触发也可能延迟数分钟到数十分钟。',
    );
  }

  return { ok: true, name, schedules, hasWorkflowDispatch, otherTriggers, warnings };
}

/** Ready-made examples covering the common shapes and mistakes. */
export const WORKFLOW_SAMPLES: Array<{ label: string; note: string; yaml: string }> = [
  {
    label: '每天 09:00（本地已偏移）',
    note: 'cron 写的是 UTC，本地会是 17:00',
    yaml: `name: 每日构建
on:
  schedule:
    - cron: '0 9 * * *'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`,
  },
  {
    label: '多个计划',
    note: '同一个 workflow 可以有多条 schedule',
    yaml: `name: 多个计划
on:
  schedule:
    - cron: '0 9 * * 1-5'
    - cron: '30 18 * * 5'
  push:
    branches: [main]

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`,
  },
  {
    label: '错误：带秒字段',
    note: '6 段表达式会被 GitHub 拒绝',
    yaml: `on:
  schedule:
    - cron: '*/30 * * * * *'
`,
  },
  {
    label: '错误：间隔小于 5 分钟',
    note: 'GitHub 的最小间隔是 5 分钟',
    yaml: `on:
  schedule:
    - cron: '*/2 * * * *'
`,
  },
  {
    label: '没有定时计划',
    note: '只有 push 触发，本来就没有 schedule',
    yaml: `name: 仅推送触发
on:
  push:
    branches: [main]
`,
  },
];
