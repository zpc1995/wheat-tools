/**
 * Checks the ETA calculator.
 *
 * The oracle is hand arithmetic: "100 items, 25 done in 10 minutes" must give
 * 30 minutes remaining and a finish 40 minutes after the start, and the same
 * answer is recomputed here as `(total - completed) * elapsed / completed`.
 * Formatting and civil-time handling are checked against the platform's own
 * `Date` implementation and against round-trip identities (parse → format →
 * parse), plus a fixed set of hand-computed instants at known UTC offsets.
 *
 * The suite also asserts the two claims that are easy to lose:
 *   1. `etaUtils.ts` contains no clock call, so tests are reproducible.
 *   2. "0 of 100 done" is an explicit error, not Infinity.
 *
 * Usage: node scripts/check-eta-calculator.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/eta-calculator/etaUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/eta-calculator.mjs', compiled);
const M = await import(pathToFileURL('.verify/eta-calculator.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok
        ? ''
        : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}
function checkNear(label, actual, expected, eps = 1e-6) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= eps;
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ~${JSON.stringify(expected)}`),
  );
}
/** The estimate of an ok result, or null. */
function estimate(result) {
  return result && result.ok ? result.value : null;
}
/** The error code of a failed result, or null. */
function code(result) {
  return result && result.ok === false ? result.code : null;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

console.log('--- 手算参照：100 项完成 25 项用时 10 分钟 ---');
{
  const start = 1_000_000;
  const now = start + 10 * MINUTE;
  const result = M.estimateEta(
    { total: 100, completed: 25, elapsedMs: 10 * MINUTE },
    { currentAtMs: now },
  );
  const e = estimate(result);
  check('估算成功', Boolean(e), true);
  check('剩余项目数 75', e.remainingItems, 75);
  check('剩余 30 分钟', e.remainingMs, 30 * MINUTE);
  check('与手算 (100−25)×600000÷25 一致', e.remainingMs, ((100 - 25) * (10 * MINUTE)) / 25);
  check('完成于开始后 40 分钟', e.finishAtMs, start + 40 * MINUTE);
  check('完成时刻 − 当前时刻 = 剩余时间', e.finishAtMs - now, e.remainingMs);
  check('速度 25 项 / 600000 毫秒', e.ratePerMs, 25 / (10 * MINUTE));
  check('速度换算为每分钟 2.5 项', e.ratePerMs * MINUTE, 2.5);
  check('依据是实测', e.basis, 'measured');
  check('置信度为高（25 项、10 分钟）', e.confidence.level, 'high');
  check('相对不确定度 1 ÷ √25 = 0.2', e.confidence.spreadRatio, 0.2);
  check('绝对不确定度 = 剩余时间 × 0.2 = 6 分钟', e.confidence.spreadMs, 6 * MINUTE);
  check('剩余时间可格式化为 30 分钟', M.formatDurationHuman(e.remainingMs), '30 分钟');
  check('完成时刻可格式化', typeof M.formatTimestamp(e.finishAtMs, 0), 'string');
}

console.log('--- 由开始时间与当前时间推导 ---');
{
  const start = Date.UTC(2024, 0, 31, 15, 0, 0);
  const now = start + 2 * HOUR;
  const result = M.estimateFromTimes(100, 50, start, now);
  const e = estimate(result);
  check('已用时间由两个时刻相减得到', e.elapsedMs, 2 * HOUR);
  check('剩余时间等于已用时间（完成一半）', e.remainingMs, 2 * HOUR);
  check('完成时刻 = 开始 + 4 小时', e.finishAtMs, start + 4 * HOUR);
  check('当前时刻早于开始时间时报错', code(M.estimateFromTimes(100, 50, now, start)), 'inconsistent');
  check('非法时刻被拒绝', code(M.estimateFromTimes(100, 50, Number.NaN, now)), 'invalid-input');
}

console.log('--- 边界：0 / 全部完成 / 超额 / 时间为 0 ---');
{
  check('已完成 0 时明确报「无法估计」', code(M.estimateEta({ total: 100, completed: 0, elapsedMs: MINUTE })), 'no-progress');
  check('已完成 0 的提示说明无法估计', /无法估计/.test(M.estimateEta({ total: 100, completed: 0, elapsedMs: MINUTE }).error), true);
  check('已完成 0 时不会返回 Infinity', estimate(M.estimateEta({ total: 100, completed: 0, elapsedMs: MINUTE })), null);

  const done = estimate(M.estimateEta({ total: 100, completed: 100, elapsedMs: 5 * MINUTE }, { currentAtMs: 999 }));
  check('已完成时剩余项目 0', done.remainingItems, 0);
  check('已完成时剩余时间 0', done.remainingMs, 0);
  check('已完成时速度仍然给出', done.ratePerMs, 100 / (5 * MINUTE));
  check('已完成时置信度为高', done.confidence.level, 'high');
  check('已完成时完成时刻就是当前时刻', done.finishAtMs, 999);

  const instant = estimate(M.estimateEta({ total: 5, completed: 5, elapsedMs: 0 }));
  check('瞬间全部完成时速度为 null 而不是 Infinity', instant.ratePerMs, null);
  check('瞬间全部完成时给出说明', instant.notes.length > 0, true);

  check('已完成大于总量时报数据不一致', code(M.estimateEta({ total: 100, completed: 101, elapsedMs: MINUTE })), 'inconsistent');
  check('已完成大于总量时不计算', estimate(M.estimateEta({ total: 100, completed: 101, elapsedMs: MINUTE })), null);
  check('已用时间为 0 且未完成时报错', code(M.estimateEta({ total: 100, completed: 1, elapsedMs: 0 })), 'zero-time');
  check('已用时间为 0 的提示提到除以 0', /除以 0/.test(M.estimateEta({ total: 100, completed: 1, elapsedMs: 0 }).error), true);

  check('总量为 0 被拒绝', code(M.estimateEta({ total: 0, completed: 0, elapsedMs: MINUTE })), 'invalid-input');
  check('总量为负被拒绝', code(M.estimateEta({ total: -1, completed: 0, elapsedMs: MINUTE })), 'invalid-input');
  check('已完成为负被拒绝', code(M.estimateEta({ total: 100, completed: -1, elapsedMs: MINUTE })), 'invalid-input');
  check('时间为负被拒绝', code(M.estimateEta({ total: 100, completed: 1, elapsedMs: -1 })), 'invalid-input');
  check('NaN 被拒绝', code(M.estimateEta({ total: 100, completed: Number.NaN, elapsedMs: MINUTE })), 'invalid-input');
  check('Infinity 被拒绝', code(M.estimateEta({ total: Number.POSITIVE_INFINITY, completed: 1, elapsedMs: MINUTE })), 'invalid-input');
}

console.log('--- 极值 ---');
{
  const huge = estimate(M.estimateEta({ total: 1e15, completed: 1e14, elapsedMs: 1e9 }));
  check('极大但可表示的输入仍能计算', Boolean(huge), true);
  check('极大输入的剩余时间与手算一致', huge.remainingMs, (9e14 * 1e9) / 1e14);
  check('极大输入的结果是有限数', Number.isFinite(huge.remainingMs), true);

  check(
    '剩余时间溢出时报错而不是 Infinity',
    code(M.estimateEta({ total: Number.MAX_VALUE, completed: 1, elapsedMs: 1000 })),
    'overflow',
  );
  check(
    '剩余时间有限但完成时刻溢出时报错',
    code(
      M.estimateEta(
        { total: 2, completed: 1, elapsedMs: 1e300 },
        { currentAtMs: Number.MAX_VALUE },
      ),
    ),
    'overflow',
  );

  // The naive rate-first form is what this ordering avoids; show the contrast
  // on a case found by brute force where the two really differ.
  check('先算速度再相除会引入浮点误差（朴素写法得到 32588.999999999996）', (3 - 2) / (2 / 65_178), 32588.999999999996);
  check('本实现取乘法形式，得到精确的 32589', estimate(M.estimateEta({ total: 3, completed: 2, elapsedMs: 65_178 })).remainingMs, 32_589);
  check('手算的 100/25/10 分钟同样精确', estimate(M.estimateEta({ total: 100, completed: 25, elapsedMs: 600_000 })).remainingMs, 1_800_000);
}

console.log('--- 剩余项目数 × 每项耗时 ---');
{
  const e = estimate(M.estimateFromPerItem(12, MINUTE, { currentAtMs: 5_000 }));
  check('12 项 × 1 分钟 = 12 分钟', e.remainingMs, 12 * MINUTE);
  check('与手算 12 × 60000 一致', e.remainingMs, 12 * 60_000);
  check('完成时刻 = 当前 + 12 分钟', e.finishAtMs, 5_000 + 12 * MINUTE);
  check('每项 1 分钟的速度是每分钟 1 项', e.ratePerMs * MINUTE, 1);
  check('每项 30 秒的速度是每分钟 2 项', estimate(M.estimateFromPerItem(4, 30_000)).ratePerMs * MINUTE, 2);
  check('依据标记为假设', e.basis, 'assumed');
  check('假设模式下没有统计上的不确定度', e.confidence.spreadRatio, null);
  check('假设模式给出说明', e.notes.length > 0, true);
  check('剩余项目为 0 时剩余时间为 0', estimate(M.estimateFromPerItem(0, MINUTE)).remainingMs, 0);
  check('剩余项目为 0 时不报错', Boolean(estimate(M.estimateFromPerItem(0, MINUTE))), true);
  check('每项耗时为 0 被拒绝', code(M.estimateFromPerItem(5, 0)), 'invalid-input');
  check('每项耗时为负被拒绝', code(M.estimateFromPerItem(5, -1)), 'invalid-input');
  check('剩余项目为负被拒绝', code(M.estimateFromPerItem(-1, MINUTE)), 'invalid-input');
  check('NaN 被拒绝', code(M.estimateFromPerItem(Number.NaN, MINUTE)), 'invalid-input');
  check('乘法溢出时报错', code(M.estimateFromPerItem(1e300, 1e300)), 'overflow');
  check('没有时间基准时不给出完成时刻', estimate(M.estimateFromPerItem(3, MINUTE)).finishAtMs, null);
}

console.log('--- 不确定性的表达 ---');
{
  const low = estimate(M.estimateEta({ total: 100, completed: 1, elapsedMs: 1000 }));
  check('只完成 1 项时为低置信度', low.confidence.level, 'low');
  check('低置信度的理由说明样本太少', /样本太少/.test(low.confidence.reason), true);
  check('低置信度同时给出短用时的提示', /已用时间只有/.test(low.confidence.reason), true);
  check('低置信度附带了数量级提醒', low.notes.some((n) => /数量级/.test(n)), true);
  check('低置信度的相对不确定度是 1（100%）', low.confidence.spreadRatio, 1);
  check('低置信度的绝对不确定度等于剩余时间', low.confidence.spreadMs, low.remainingMs);

  const shortElapsed = estimate(M.estimateEta({ total: 100_000, completed: 1000, elapsedMs: 500 }));
  check('已用时间极短时即使完成项很多也判为低置信度', shortElapsed.confidence.level, 'low');
  check('短用时的理由被明确写出', /短于/.test(shortElapsed.confidence.reason), true);
  check('短用时仍然返回估算值（只提示不阻止）', shortElapsed.remainingMs > 0, true);

  const medium = estimate(M.estimateEta({ total: 100, completed: 10, elapsedMs: MINUTE }));
  check('完成 10 项时为中等置信度', medium.confidence.level, 'medium');
  check('中等置信度的理由是样本量中等', /样本量中等/.test(medium.confidence.reason), true);

  const high = estimate(M.estimateEta({ total: 100, completed: 20, elapsedMs: MINUTE }));
  check('完成 20 项、用时 1 分钟即为高置信度', high.confidence.level, 'high');

  const boundary = estimate(M.estimateEta({ total: 100, completed: 19, elapsedMs: MINUTE }));
  check('完成 19 项还未达到高置信度', boundary.confidence.level, 'medium');
  const elapsedBoundary = estimate(M.estimateEta({ total: 100, completed: 30, elapsedMs: 9_999 }));
  check('用时 9999 毫秒（差 1 毫秒）仍未达到高置信度', elapsedBoundary.confidence.level, 'low');
  const elapsedJustOver = estimate(M.estimateEta({ total: 100, completed: 30, elapsedMs: 10_000 }));
  check('用时 10000 毫秒刚好达到高置信度', elapsedJustOver.confidence.level, 'high');

  check('常量与文档一致', [M.SHORT_ELAPSED_MS, M.MIN_SAMPLES_MEDIUM, M.MIN_SAMPLES_HIGH], [10_000, 5, 20]);
  {
    let mismatches = 0;
    for (const completed of [1, 2, 4, 9, 25, 100, 12345]) {
      const value = estimate(M.estimateEta({ total: completed * 4, completed, elapsedMs: HOUR }));
      if (value.confidence.spreadRatio !== 1 / Math.sqrt(completed)) mismatches += 1;
      if (value.confidence.spreadMs !== value.remainingMs * (1 / Math.sqrt(completed))) mismatches += 1;
    }
    check('相对不确定度与独立的 1 ÷ √n 在 7 组上一致', mismatches, 0);
  }
}

console.log('--- 单位换算与自动选择 ---');
{
  check('秒', M.toMs(1, 'second'), 1000);
  check('分钟', M.toMs(1, 'minute'), 60_000);
  check('小时', M.toMs(1, 'hour'), 3_600_000);
  check('天', M.toMs(1, 'day'), 86_400_000);
  check('反向换算', M.fromMs(90_000, 'minute'), 1.5);
  check('100 毫秒自动选择毫秒', M.autoUnit(100), 'millisecond');
  check('1500 毫秒自动选择秒', M.autoUnit(1500), 'second');
  check('90000 毫秒自动选择分钟', M.autoUnit(90_000), 'minute');
  check('1 小时自动选择小时', M.autoUnit(HOUR), 'hour');
  check('超过一天自动选择天', M.autoUnit(25 * HOUR), 'day');
  check('0 自动选择毫秒', M.autoUnit(0), 'millisecond');
  check('负值按绝对值选择单位', M.autoUnit(-90_000), 'minute');
  check('固定单位格式化：90000 毫秒 = 1.5 分钟', M.formatDurationIn(90_000, 'minute'), '1.5');
  check('固定单位格式化：1 小时 = 1 小时', M.formatDurationIn(HOUR, 'hour'), '1');
  check('固定单位格式化：1 天 = 1 天', M.formatDurationIn(DAY, 'day'), '1');
  check('固定单位格式化：0 分钟 = 0', M.formatDurationIn(0, 'minute'), '0');
  check('固定单位格式化：非有限输入返回占位符', M.formatDurationIn(Number.NaN, 'minute'), '—');
  {
    // Round trip: format in a fixed unit, convert back, and stay inside the
    // rounding tolerance of that unit (6 decimals of a unit).
    let worst = 0;
    let count = 0;
    const units = ['millisecond', 'second', 'minute', 'hour', 'day'];
    for (let ms = 0; ms <= 200 * HOUR; ms += 97_777) {
      for (const unit of units) {
        const text = M.formatDurationIn(ms, unit, 6);
        const back = M.toMs(Number(text), unit);
        worst = Math.max(worst, Math.abs(back - ms) / M.UNIT_MS[unit]);
        count += 1;
      }
    }
    check(`时间格式化的往返（${count} 组）误差不超过 1e-6 个所选单位`, worst <= 1e-6, true);
  }
}

console.log('--- 人类可读的时长 ---');
{
  check('0 毫秒', M.formatDurationHuman(0), '0 毫秒');
  check('500 毫秒', M.formatDurationHuman(500), '500 毫秒');
  check('1 秒', M.formatDurationHuman(1000), '1 秒');
  check('1.5 秒', M.formatDurationHuman(1500), '1.5 秒');
  check('45 秒', M.formatDurationHuman(45_000), '45 秒');
  check('1 分钟', M.formatDurationHuman(MINUTE), '1 分钟');
  check('1 分 30 秒', M.formatDurationHuman(90_000), '1 分钟 30 秒');
  check('30 分钟', M.formatDurationHuman(30 * MINUTE), '30 分钟');
  check('40 分钟', M.formatDurationHuman(40 * MINUTE), '40 分钟');
  check('1 小时', M.formatDurationHuman(HOUR), '1 小时');
  check('1 小时 1 分钟', M.formatDurationHuman(HOUR + MINUTE + 1000), '1 小时 1 分钟');
  check('1 天', M.formatDurationHuman(DAY), '1 天');
  check('25 小时 = 1 天 1 小时', M.formatDurationHuman(25 * HOUR), '1 天 1 小时');
  check('2 天 5 分钟（跳过为 0 的小时）', M.formatDurationHuman(2 * DAY + 5 * MINUTE), '2 天 5 分钟');
  check('负数保留符号', M.formatDurationHuman(-90_000), '-1 分钟 30 秒');
  check('非有限输入返回占位符', M.formatDurationHuman(Number.POSITIVE_INFINITY), '—');
  {
    const parts = M.durationParts(DAY + HOUR + MINUTE + 1000 + 1);
    check('时长拆分：天', parts.days, 1);
    check('时长拆分：小时', parts.hours, 1);
    check('时长拆分：分钟', parts.minutes, 1);
    check('时长拆分：秒', parts.seconds, 1);
    check('时长拆分：毫秒', parts.milliseconds, 1);
    check(
      '拆分后的各部分之和等于原值',
      parts.days * DAY + parts.hours * HOUR + parts.minutes * MINUTE + parts.seconds * 1000 + parts.milliseconds,
      DAY + HOUR + MINUTE + 1000 + 1,
    );
    check('负时长标记负数', M.durationParts(-1000).negative, true);
  }
}

console.log('--- 民用时间格式化 ---');
{
  check('纪元零点（UTC）', M.formatTimestamp(0, 0), '1970-01-01 00:00:00');
  check('纪元零点（UTC+8）', M.formatTimestamp(0, 480), '1970-01-01 08:00:00');
  check('纪元零点（UTC−5）落到前一天与上一年', M.formatTimestamp(0, -300), '1969-12-31 19:00:00');
  const y2024 = Date.UTC(2024, 0, 1, 0, 0, 0);
  check('2024-01-01T00:00:00Z', M.formatTimestamp(y2024, 0), '2024-01-01 00:00:00');
  check('加 8 小时偏移', M.formatTimestamp(y2024, 480), '2024-01-01 08:00:00');
  check('减 5 小时偏移跨月跨年', M.formatTimestamp(y2024, -300), '2023-12-31 19:00:00');
  check('闰日 2024-02-29 存在', M.formatTimestamp(Date.UTC(2024, 1, 29, 12, 0, 0), 0), '2024-02-29 12:00:00');
  check('2023-03-01 前一天是 02-28', M.formatTimestamp(Date.UTC(2023, 1, 28, 23, 59, 59), 0), '2023-02-28 23:59:59');
  check('跨月边界（+2 小时到次日）', M.formatTimestamp(Date.UTC(2024, 0, 31, 23, 30, 0), 120), '2024-02-01 01:30:00');
  check('跨年边界（+3 小时到次年）', M.formatTimestamp(Date.UTC(2023, 11, 31, 22, 30, 0), 180), '2024-01-01 01:30:00');
  check('NaN 时刻返回占位符', M.formatTimestamp(Number.NaN, 0), '—');
  check('超出 Date 范围的时刻返回占位符', M.formatTimestamp(M.MAX_DATE_MS + 1, 0), '—');
  check('非法偏移按 0 处理', M.formatTimestamp(0, Number.NaN), '1970-01-01 00:00:00');

  check('UTC 偏移显示', M.formatOffset(480), 'UTC+08:00');
  check('负偏移显示', M.formatOffset(-300), 'UTC-05:00');
  check('零偏移显示', M.formatOffset(0), 'UTC+00:00');
  check('半小时偏移显示', M.formatOffset(330), 'UTC+05:30');
  check('分钟级偏移显示', M.formatOffset(-45), 'UTC-00:45');

  {
    // Independent oracle: the platform Date at the shifted instant.
    let mismatches = 0;
    let count = 0;
    for (let ms = Date.UTC(1969, 11, 31, 12, 0, 0); ms < Date.UTC(2025, 0, 1, 0, 0, 0); ms += 3_600_123) {
      for (const offset of [-720, -300, -45, 0, 60, 330, 480, 840]) {
        const shifted = new Date(ms + offset * 60_000).toISOString();
        const expected = `${shifted.slice(0, 10)} ${shifted.slice(11, 19)}`;
        if (M.formatTimestamp(ms, offset) !== expected) mismatches += 1;
        count += 1;
      }
    }
    check(`与 Date 的原生 ISO 输出在 ${count} 个时刻/偏移组合上一致`, mismatches, 0);
  }
}

console.log('--- 解析与往返 ---');
{
  check('解析 UTC 零点', M.parseLocalDateTime('1970-01-01T00:00:00', 0), 0);
  check('解析带偏移的本地时间', M.parseLocalDateTime('2024-01-01T08:00:00', 480), Date.UTC(2024, 0, 1, 0, 0, 0));
  check('分钟精度可省略秒', M.parseLocalDateTime('2024-01-01T00:00', 0), Date.UTC(2024, 0, 1, 0, 0, 0));
  check('空格分隔符也可接受', M.parseLocalDateTime('2024-01-01 00:00:00', 0), Date.UTC(2024, 0, 1, 0, 0, 0));
  check('闰日合法', M.parseLocalDateTime('2024-02-29T12:00:00', 0), Date.UTC(2024, 1, 29, 12, 0, 0));
  check('平年 2 月 29 日被拒绝', M.parseLocalDateTime('2023-02-29T00:00:00', 0), null);
  check('2 月 30 日被拒绝', M.parseLocalDateTime('2024-02-30T00:00:00', 0), null);
  check('13 月被拒绝', M.parseLocalDateTime('2024-13-01T00:00:00', 0), null);
  check('0 月被拒绝', M.parseLocalDateTime('2024-00-01T00:00:00', 0), null);
  check('0 日被拒绝', M.parseLocalDateTime('2024-01-00T00:00:00', 0), null);
  check('24 时被拒绝', M.parseLocalDateTime('2024-01-01T24:00:00', 0), null);
  check('60 分被拒绝', M.parseLocalDateTime('2024-01-01T00:60:00', 0), null);
  check('非补零格式被拒绝', M.parseLocalDateTime('2024-1-1T00:00:00', 0), null);
  check('斜杠格式被拒绝', M.parseLocalDateTime('2024/01/01 00:00', 0), null);
  check('空字符串被拒绝', M.parseLocalDateTime('', 0), null);
  check('乱码被拒绝', M.parseLocalDateTime('abc', 0), null);

  {
    let mismatches = 0;
    const samples = [
      '1970-01-01T00:00:00',
      '2024-02-29T23:59:59',
      '2024-12-31T23:59:59',
      '2023-01-01T00:00:01',
      '2000-06-15T12:34:56',
      '0050-03-01T06:00:00',
    ];
    for (const text of samples) {
      for (const offset of [-480, -60, 0, 330, 480, 720]) {
        const parsed = M.parseLocalDateTime(text, offset);
        // The formatter prints a space between date and time; the samples use T.
        if (M.formatTimestamp(parsed, offset) !== text.replace('T', ' ')) mismatches += 1;
      }
    }
    check('解析 → 格式化往返完全一致（36 组，含公元 50 年）', mismatches, 0);
  }
}

console.log('--- 完成时刻跨天 / 跨月 / 跨年 ---');
{
  const offset = 480;
  const start = M.parseLocalDateTime('2024-01-31T23:00:00', offset);
  const now = start + 2 * HOUR;
  const e = estimate(M.estimateFromTimes(100, 50, start, now));
  check('跨月完成时刻 = 2024-02-01 03:00:00', M.formatTimestamp(e.finishAtMs, offset), '2024-02-01 03:00:00');

  const start2 = M.parseLocalDateTime('2023-12-31T22:00:00', offset);
  const now2 = start2 + 3 * HOUR;
  const e2 = estimate(M.estimateFromTimes(100, 50, start2, now2));
  check('跨年完成时刻 = 2024-01-01 04:00:00', M.formatTimestamp(e2.finishAtMs, offset), '2024-01-01 04:00:00');

  const start3 = M.parseLocalDateTime('2024-02-28T23:00:00', offset);
  const now3 = start3 + 2 * HOUR;
  const e3 = estimate(M.estimateFromTimes(10, 5, start3, now3));
  check('闰年 2 月 28 日跨到 2 月 29 日', M.formatTimestamp(e3.finishAtMs, offset), '2024-02-29 03:00:00');
}

console.log('--- 不读系统时钟 ---');
{
  // Comments are stripped first: the doc comment talks *about* Date.now, and a
  // plain regex would flag that discussion as a call.
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
  check('utils 的代码里没有 Date.now 调用', /Date\.now\s*\(/.test(code), false);
  check('utils 的代码里没有 performance.now 调用', /performance\.now\s*\(/.test(code), false);
  check('utils 的代码里没有无参数的 new Date()', /new Date\(\s*\)/.test(code), false);
  check('utils 的代码里没有 setTimeout / setInterval', /set(Timeout|Interval)\s*\(/.test(code), false);

  const args = { total: 100, completed: 25, elapsedMs: 600_000 };
  const first = M.estimateEta(args, { currentAtMs: 123_456 });
  const second = M.estimateEta(args, { currentAtMs: 123_456 });
  check('相同输入两次调用结果完全相同（时间基准由外部传入）', first, second);
  check('没有时间基准时不产生绝对时刻', estimate(M.estimateEta(args)).finishAtMs, null);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
