/**
 * Checks date arithmetic.
 *
 * The cases that matter are the ones JavaScript gets wrong by default: month
 * overflow (`Jan 31 + 1 month`), leap-year clamping, and DST (where "one day" is
 * not 24 hours). Each is asserted explicitly against a known-correct value.
 *
 * Usage: node scripts/check-date.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/date-calculator/dateUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/dateUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/dateUtils.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

const d = (text) => {
  const r = M.parseDate(text);
  if (!r.ok) throw new Error(`测试数据解析失败: ${text} — ${r.error}`);
  return r.date;
};
const s = (date) => M.toDateString(date);

console.log('--- 解析 ---');
check('日期格式', M.parseDate('2026-01-15').source, 'date-only');
check('日期为本地零点', M.parseDate('2026-01-15').date.getHours(), 0);
check(
  '日期只按本地解释（不按 UTC）',
  M.parseDate('2026-01-15').date.getDate(),
  15,
);
check('日期时间', M.parseDate('2026-01-15 08:30:00').source, 'date-time');
check('日期时间的小时正确', M.parseDate('2026-01-15 08:30:00').date.getHours(), 8);
check('T 分隔也可', M.parseDate('2026-01-15T08:30').date.getHours(), 8);
check('带 Z 视为绝对时刻', M.parseDate('2026-01-15T00:00:00Z').source, 'date-time');
check('秒级时间戳', M.parseDate('1767225600').source, 'timestamp');
check('毫秒级时间戳', M.parseDate('1767225600000').source, 'timestamp');
{
  const a = M.parseDate('1767225600').date.getTime();
  const b = M.parseDate('1767225600000').date.getTime();
  check('两种时间戳解析为同一时刻', a, b);
}
check('空输入被拒', M.parseDate('   ').ok, false);
check('非日期字符串被拒', M.parseDate('not a date').ok, false);
check('不存在的日期被拒（2 月 30 日）', M.parseDate('2026-02-30').ok, false);
check('不存在的日期被拒（13 月）', M.parseDate('2026-13-01').ok, false);
check('闰年 2 月 29 日可用', M.parseDate('2024-02-29').ok, true);
check('平年 2 月 29 日被拒', M.parseDate('2026-02-29').ok, false);
check('错误信息给出可用格式', /YYYY-MM-DD/.test(M.parseDate('xx').error ?? ''), true);

console.log('--- 月末溢出（JS setMonth 的经典坑）---');
check('1 月 31 日 + 1 个月 = 2 月 28 日', s(M.addMonths(d('2026-01-31'), 1)), '2026-02-28');
check('闰年 1 月 31 日 + 1 个月 = 2 月 29 日', s(M.addMonths(d('2024-01-31'), 1)), '2024-02-29');
check('3 月 31 日 − 1 个月 = 2 月 28 日', s(M.addMonths(d('2026-03-31'), -1)), '2026-02-28');
check('8 月 31 日 + 1 个月 = 9 月 30 日', s(M.addMonths(d('2026-08-31'), 1)), '2026-09-30');
check('5 月 31 日 + 3 个月 = 8 月 31 日', s(M.addMonths(d('2026-05-31'), 3)), '2026-08-31');
check('跨年 + 1 个月', s(M.addMonths(d('2026-12-15'), 1)), '2027-01-15');
check('跨年 − 1 个月', s(M.addMonths(d('2026-01-15'), -1)), '2025-12-15');
check('12 个月等于 1 年', s(M.addMonths(d('2026-03-15'), 12)), '2027-03-15');
check('保留时间部分', M.toDateTimeString(M.addMonths(d('2026-01-31 08:30:00'), 1)), '2026-02-28 08:30:00');
{
  // The bug this guards against: the naive implementation would give March.
  check('不会溢出到下个月', M.addMonths(d('2026-01-31'), 1).getMonth(), 1);
}

console.log('--- 年与闰年 ---');
check('2 月 29 日 + 1 年 = 2 月 28 日', s(M.addYears(d('2024-02-29'), 1)), '2025-02-28');
check('2 月 29 日 + 4 年 = 2 月 29 日', s(M.addYears(d('2024-02-29'), 4)), '2028-02-29');
check('普通日期加年', s(M.addYears(d('2026-06-15'), 3)), '2029-06-15');
check('世纪年 2000 是闰年', M.daysInMonth(2000, 2), 29);
check('世纪年 1900 不是闰年', M.daysInMonth(1900, 2), 28);
check('2100 不是闰年', M.daysInMonth(2100, 2), 28);

console.log('--- 天数与周数（跨 DST 仍算一天）---');
check('+1 天', s(M.addToDate(d('2026-03-07'), { ...M.ZERO_ADD, days: 1 })), '2026-03-08');
check('+1 周', s(M.addToDate(d('2026-03-07'), { ...M.ZERO_ADD, weeks: 1 })), '2026-03-14');
check('−1 天跨月', s(M.addToDate(d('2026-03-01'), { ...M.ZERO_ADD, days: -1 })), '2026-02-28');
check('跨年 +1 天', s(M.addToDate(d('2026-12-31'), { ...M.ZERO_ADD, days: 1 })), '2027-01-01');
{
  // In a DST zone, adding one calendar day must preserve the wall-clock hour.
  // Adding 24 hours would shift it. Both are correct for their own purpose, and
  // the difference is exactly why the two paths are separate.
  const start = new Date(2026, 2, 7, 9, 0, 0); // 7 March 2026, 09:00 local
  const nextDay = M.addToDate(start, { ...M.ZERO_ADD, days: 1 });
  check('加一天保留本地时刻（夏令时安全）', nextDay.getHours(), 9);

  const plus24h = new Date(start.getTime() + 86_400_000);
  const offsetChanged =
    start.getTimezoneOffset() !== nextDay.getTimezoneOffset();
  // Only assert the divergence when the machine's zone actually has DST.
  if (offsetChanged) {
    check('恰好 24 小时与「加一天」确实不同（已实测）', plus24h.getHours() !== 9, true);
  } else {
    check('本机时区无夏令时，两天路径一致', plus24h.getHours(), 9);
  }
}
check('加 90 分钟', M.toDateTimeString(M.addToDate(d('2026-01-01 23:00:00'), { ...M.ZERO_ADD, minutes: 90 })), '2026-01-02 00:30:00');
check('加 25 小时', M.toDateTimeString(M.addToDate(d('2026-01-01 10:00:00'), { ...M.ZERO_ADD, hours: 25 })), '2026-01-02 11:00:00');
check('组合偏移', s(M.addToDate(d('2026-01-31'), { ...M.ZERO_ADD, months: 1, days: 1 })), '2026-03-01');
check('零偏移不变', M.toDateTimeString(M.addToDate(d('2026-05-05 12:00:00'), M.ZERO_ADD)), '2026-05-05 12:00:00');

console.log('--- 日期差 ---');
{
  const diff = M.difference(d('2026-01-01'), d('2026-03-15'));
  check('日历天数', diff.calendarDays, 73);
  check('年', diff.years, 0);
  check('月', diff.months, 2);
  check('日', diff.days, 14);
  check('不为负', diff.negative, false);
  check('整周数', diff.totalWeeks, 10);
}
{
  const diff = M.difference(d('2026-03-15'), d('2026-01-01'));
  check('反向为负', diff.negative, true);
  check('反向日历天数为负', diff.calendarDays, -73);
}
check('同一日期差为 0', M.difference(d('2026-01-01'), d('2026-01-01')).calendarDays, 0);
{
  const diff = M.difference(d('2024-02-28'), d('2024-03-01'));
  check('闰年 2 月跨越', diff.calendarDays, 2);
}
{
  const diff = M.difference(d('2026-01-15 08:00:00'), d('2026-01-15 17:30:00'));
  check('同一天的小时差', diff.hours, 9);
  check('同一天的分钟差', diff.minutes, 30);
  check('小时为单位的总时长', M.formatDurationZh(diff.totalMs), '9 小时 30 分');
}
{
  const diff = M.difference(d('2026-01-01 23:00:00'), d('2026-01-02 01:00:00'));
  check('跨午夜借位正确', [diff.hours, diff.minutes], [2, 0]);
}
{
  // Borrowing must use the length of the month before the end date.
  const diff = M.difference(d('2026-01-31'), d('2026-03-01'));
  check('月末区间得到 1 个月 1 天', [diff.months, diff.days], [1, 1]);
}
{
  // The anchoring must be the exact inverse of addMonths, including at month
  // ends — this is what a single "borrow" got wrong.
  let inverseOk = true;
  const starts = ['2026-01-31', '2026-03-31', '2024-01-31', '2026-08-31', '2026-12-15'];
  for (const start of starts) {
    for (let n = 0; n <= 14; n += 1) {
      const base = d(start);
      const later = M.addMonths(base, n);
      const back = M.difference(base, later);
      if (back.months + back.years * 12 !== n || back.days !== 0) {
        inverseOk = false;
        console.log(`  ${start} +${n} 月 → ${s(later)}，差分为 ${back.years} 年 ${back.months} 月 ${back.days} 天`);
      }
    }
  }
  check('difference 是 addMonths 的精确逆运算（含月末）', inverseOk, true);
}

console.log('--- 工作日 ---');
check('一周内的工作日', M.countBusinessDays(d('2026-01-05'), d('2026-01-12')), 5);
check('含周末的区间', M.countBusinessDays(d('2026-01-05'), d('2026-01-19')), 10);
check('只含周末则为 0', M.countBusinessDays(d('2026-01-03'), d('2026-01-05')), 0);
check('同一天为 0', M.countBusinessDays(d('2026-01-05'), d('2026-01-05')), 0);
check('反向为负', M.countBusinessDays(d('2026-01-12'), d('2026-01-05')), -5);
check('加 1 个工作日跳过周末', s(M.addBusinessDays(d('2026-01-02'), 1)), '2026-01-05');
check('加 5 个工作日', s(M.addBusinessDays(d('2026-01-05'), 5)), '2026-01-12');
check('减 1 个工作日', s(M.addBusinessDays(d('2026-01-05'), -1)), '2026-01-02');
check('加 0 个工作日不变', s(M.addBusinessDays(d('2026-01-05'), 0)), '2026-01-05');
check('加 10 个工作日跨两周', s(M.addBusinessDays(d('2026-01-05'), 10)), '2026-01-19');
{
  // Business-day counting and adding must agree with each other.
  let consistent = true;
  for (let n = 0; n <= 20; n += 1) {
    const start = d('2026-01-05');
    const end = M.addBusinessDays(start, n);
    if (M.countBusinessDays(start, end) !== n) {
      consistent = false;
      console.log(`  不一致: +${n} 个工作日 → ${s(end)}，计数为 ${M.countBusinessDays(start, end)}`);
    }
  }
  check('加 N 个工作日与计数一致（0..20）', consistent, true);
}

console.log('--- 年龄 ---');
{
  const age = M.ageFrom(d('1995-06-15'), d('2026-10-01'));
  check('年龄年', age.years, 31);
  check('年龄月', age.months, 3);
  check('年龄日', age.days, 16);
  check('下次生日', s(age.nextBirthday), '2027-06-15');
  check('距下次生日天数', age.daysToNextBirthday > 0, true);
}
{
  const age = M.ageFrom(d('2000-02-29'), d('2026-03-01'));
  check('闰日出生不崩溃', typeof age.years, 'number');
  check('闰日的下次生日落在真实日期上', age.nextBirthday.getDate() <= 29, true);
}
{
  const age = M.ageFrom(d('1995-06-15'), d('2026-06-15'));
  check('生日当天年数已加', age.years, 31);
  // On the birthday itself the next birthday is today, so 0 — not 365.
  check('生日当天距下次生日为 0（就是今天）', age.daysToNextBirthday, 0);
  check('生日当天下次生日就是当天', s(age.nextBirthday), '2026-06-15');
}

console.log('--- 日期信息 ---');
{
  const info = M.describeDate(d('2026-10-01'));
  check('星期', info.weekday, '周四');
  check('年内第几天', info.dayOfYear, 274);
  check('当月天数', info.daysInMonth, 31);
  check('季度', info.quarter, 4);
  check('非闰年', info.isLeapYear, false);
  check('含时区名', info.timeZone.length > 0, true);
}
check('闰年标记', M.describeDate(d('2024-01-01')).isLeapYear, true);
check('时间戳为秒', M.describeDate(d('2026-01-01')).timestampSeconds, Math.floor(d('2026-01-01').getTime() / 1000));

console.log('--- 时长格式化 ---');
check('整秒', M.formatDurationZh(5000), '5 秒');
check('分钟', M.formatDurationZh(90_000), '1 分 30 秒');
check('小时', M.formatDurationZh(3_600_000), '1 小时');
check('天', M.formatDurationZh(90_000_000), '1 天 1 小时');
check('负数带符号', M.formatDurationZh(-90_000).startsWith('−'), true);
check('零', M.formatDurationZh(0), '0 秒');

console.log('--- 快速偏移 ---');
check('快速偏移非空', M.QUICK_OFFSETS.length >= 6, true);
check(
  '快速偏移都能应用',
  M.QUICK_OFFSETS.every((item) => {
    const out = M.addToDate(d('2026-06-15'), { ...M.ZERO_ADD, ...item.options });
    return !Number.isNaN(out.getTime());
  }),
  true,
);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
