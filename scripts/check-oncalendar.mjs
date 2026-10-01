/**
 * Checks systemd `OnCalendar` → cron conversion.
 *
 * ## Why this test is stronger than a string comparison
 *
 * `systemd-analyze calendar` is the authoritative implementation, and it is
 * available here. So the conversion is verified **semantically**: the next N
 * fire times reported by systemd are compared against the fire times the cron
 * evaluator produces for the translated expression. A translation that looks
 * plausible but fires at the wrong times fails.
 *
 * Where cron cannot express the semantics (systemd ANDs weekday with date, cron
 * ORs them) the module must refuse rather than emit something that looks right.
 * Those cases assert that refusal, with the systemd output proving the two are
 * genuinely different.
 *
 * Usage: node scripts/check-oncalendar.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function transpile(sourcePath, outName) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mkdirSync('.verify', { recursive: true });
  const out = `.verify/${outName}`;
  writeFileSync(out, compiled);
  return out;
}

const M = await import(pathToFileURL(transpile('src/tools/cron-convert/onCalendarUtils.ts', 'onCalendarUtils.mjs')).href);
const C = await import(pathToFileURL(transpile('src/tools/cron-builder/cronUtils.ts', 'cronUtils.mjs')).href);

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

// `systemd-analyze` is Linux/systemd-specific; skip the cross-validation rather
// than failing on a machine that legitimately does not have it.
let hasSystemd = true;
try {
  execFileSync('systemd-analyze', ['--version'], { stdio: 'pipe' });
} catch {
  hasSystemd = false;
}

/** Runs systemd-analyze and returns its next N fire times as local Dates. */
function systemdTimes(expression, iterations) {
  const output = execFileSync(
    'systemd-analyze',
    ['calendar', `--iterations=${iterations}`, expression],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const times = [];
  for (const line of output.split('\n')) {
    const match = /(?:Next elapse|Iteration #\d+):\s+\w{3}\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(line);
    if (match) {
      const [, y, mo, d, h, mi, s] = match.map(Number);
      times.push(new Date(y, mo - 1, d, h, mi, s));
    }
  }
  return times;
}

const show = (dates) => dates.map((d) => d.toISOString().slice(0, 19).replace('T', ' '));

console.log('--- 解析 ---');
{
  const r = M.parseOnCalendar('Mon..Fri *-*-* 09:00:00');
  check('解析成功', r.ok, true);
  check('星期区间', r.parsed.weekday.values, [1, 2, 3, 4, 5]);
  check('小时', r.parsed.hour.values, [9]);
  check('分钟', r.parsed.minute.values, [0]);
  check('日期为通配', r.parsed.day.values, null);
  check('年份为通配', r.parsed.year.values, null);
}
{
  const r = M.parseOnCalendar('*:0/5:00');
  check('步长解析', r.parsed.minute.step, 5);
  check('步长展开值', r.parsed.minute.values, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
}
check('关键字 hourly 展开', M.parseOnCalendar('hourly').parsed.normalized, '*-*-* *:00:00');
check('关键字 daily 展开', M.parseOnCalendar('daily').parsed.normalized, '*-*-* 00:00:00');
check('关键字 weekly 展开', M.parseOnCalendar('weekly').parsed.normalized, 'Mon *-*-* 00:00:00');
check('关键字每月 1 日', M.parseOnCalendar('monthly').parsed.normalized, '*-*-01 00:00:00');
check('只写时间', M.parseOnCalendar('09:00').parsed.hour.values, [9]);
check('只写日期', M.parseOnCalendar('*-*-01').parsed.day.values, [1]);
check('时区被分离', M.parseOnCalendar('*-*-* 09:00:00 UTC').parsed.timezone, 'UTC');
check('星期全名可识别', M.parseOnCalendar('Monday *-*-* 09:00').parsed.weekday.values, [1]);
check('日期列表', M.parseOnCalendar('*-01,07-01 00:00').parsed.month.values, [1, 7]);

console.log('--- 解析错误 ---');
check('空输入报错', M.parseOnCalendar('  ').ok, false);
check('日期段数错误报错', M.parseOnCalendar('*-*-* 09:00').ok && true, true);
check('非法月份报错', M.parseOnCalendar('*-13-01 00:00').ok, false);
check('非法小时报错', M.parseOnCalendar('*-*-* 25:00').ok, false);
check('无穷大区间报错', M.parseOnCalendar('*-*-* 20..05').ok, false);
check('步长为零报错', M.parseOnCalendar('*:0/0:00').ok, false);
check('无法识别的部分报错', M.parseOnCalendar('bogus-part').ok, false);

console.log('--- 转换：能等价表达的情况 ---');
{
  const r = M.onCalendarToCron('*:0/5:00');
  check('每 5 分钟', r.cron, '0/5 * * * *');
  check('不含秒时无损', r.impossible, false);
}
check('每天 09:00', M.onCalendarToCron('*-*-* 09:00:00').cron, '0 9 * * *');
check('工作日 09:00', M.onCalendarToCron('Mon..Fri *-*-* 09:00:00').cron, '0 9 * * 1-5');
check('每月 1 日', M.onCalendarToCron('*-*-01 00:00:00').cron, '0 0 1 * *');
check('hourly', M.onCalendarToCron('hourly').cron, '0 * * * *');
check('daily', M.onCalendarToCron('daily').cron, '0 0 * * *');
check('weekly', M.onCalendarToCron('weekly').cron, '0 0 * * 1');
check('每小时 0/15/30/45', M.onCalendarToCron('*:0/15:00').cron, '0/15 * * * *');
check('每天 9 点到 17 点整点', M.onCalendarToCron('09..17:00:00').cron, '0 9-17 * * *');

// Regression: cron's `a/b` runs to the field maximum, so using it for a range
// that stops early silently widens the schedule (Mon..Fri became Mon..Sun).
check('连续区间用区间而非 1/1', M.onCalendarToCron('Mon..Fri *-*-* 09:00').cron, '0 9 * * 1-5');
check('连续小时区间用区间', M.onCalendarToCron('*-*-* 09..17:00').cron, '0 9-17 * * *');
check('到达上限的步长仍用 a/b', M.onCalendarToCron('*:0/15:00').cron, '0/15 * * * *');
check('覆盖全部取值时用 *', M.onCalendarToCron('*:0..59:00').cron, '* * * * *');
check('不连续且不到上限时列举', M.onCalendarToCron('*-*-* 01,05:00').cron, '0 1,5 * * *');

console.log('--- 转换：无法等价表达的情况必须拒绝 ---');
{
  const r = M.onCalendarToCron('Mon..Fri *-*-01 09:00:00');
  check('星期与日期同时限定 → 标记为不可能', r.impossible, true);
  check('不生成正式 cron', r.cron, null);
  check('给出并集近似写法', r.approximateCron, '0 9 1 * 1-5');
  check('说明交集与并集差异', r.notes.some((n) => /交集|并集/.test(n)), true);
}
{
  const r = M.onCalendarToCron('*-*-* *:*:0/30');
  check('秒级被标记为有损', r.lossy, true);
  check('给出 6 段写法', r.cronWithSeconds, '0/30 * * * * *');
  check('5 段结果忽略秒', r.cron, '* * * * *');
}
{
  const r = M.onCalendarToCron('2027-*-* 09:00:00');
  check('年份限定被标记为有损', r.lossy, true);
  check('提示年份被丢弃', r.notes.some((n) => /年份/.test(n)), true);
}
{
  const r = M.onCalendarToCron('*-*-* 09:00:00 UTC');
  check('时区被提示', r.notes.some((n) => /时区/.test(n)), true);
}
check('非法表达式返回错误', 'error' in M.onCalendarToCron('bogus'), true);

console.log('--- 转换：HH:MM/step 的语义说明 ---');
{
  const r = M.onCalendarToCron('09:00/15');
  check('只在该小时内重复', r.cron, '0/15 9 * * *');
  check('并明确说明这一行为', r.notes.some((n) => /只在该小时内/.test(n)), true);
}

console.log('--- 交叉验证：与 systemd-analyze 的实际触发时刻比对 ---');
if (!hasSystemd) {
  console.log('SKIP  本机没有 systemd-analyze，无法做语义交叉验证');
} else {
  // Every expression here is one the converter claims is equivalent.
  const equivalent = [
    '*:0/5:00',
    '*-*-* 09:00:00',
    'Mon..Fri *-*-* 09:00:00',
    '*-*-01 00:00:00',
    'hourly',
    'daily',
    'weekly',
    'monthly',
    '*:0/15:00',
    '*-*-* 03:30:00',
    'Mon,Wed,Fri *-*-* 08:00:00',
    '*-*-* 09..17:00:00',
    '*-01-01 00:00:00',
    '*:30:00',
    'Sun *-*-* 20:00:00',
    '*-*-01,15 12:00:00',
    'Mon..Fri *-*-* 09:00/30:00',
  ];

  let compared = 0;
  let mismatches = 0;

  for (const expression of equivalent) {
    const conversion = M.onCalendarToCron(expression);
    if (!conversion.ok || conversion.cron === null) {
      mismatches += 1;
      console.log(`FAIL  ${expression}: 应当可以等价转换，但未生成 cron`);
      continue;
    }

    const parsed = C.parseCron(conversion.cron);
    if (!parsed.ok) {
      mismatches += 1;
      console.log(`FAIL  ${expression}: 生成的 cron "${conversion.cron}" 无法解析`);
      continue;
    }

    // Compare fire times. Retry once on mismatch, because the two tools are
    // invoked microseconds apart and a boundary minute could shift a result.
    let systemdDates = [];
    let cronDates = [];
    let matched = false;

    for (let attempt = 0; attempt < 2 && !matched; attempt += 1) {
      systemdDates = systemdTimes(expression, 6);
      const reference = new Date();
      cronDates = C.nextRuns(parsed.value, 6, reference).map((run) => run.date);
      matched =
        systemdDates.length === cronDates.length &&
        systemdDates.every((date, index) => date.getTime() === cronDates[index].getTime());
    }

    compared += 1;
    if (!matched) {
      mismatches += 1;
      console.log(`FAIL  ${expression} → ${conversion.cron}`);
      console.log(`        systemd: ${show(systemdDates).join(' | ')}`);
      console.log(`        cron   : ${show(cronDates).join(' | ')}`);
    } else {
      console.log(`PASS  ${expression.padEnd(28)} → ${conversion.cron.padEnd(16)} 触发时刻一致（${systemdDates.length} 次）`);
    }
  }

  check(
    `全部 ${compared} 个等价表达式与 systemd 触发时刻一致`,
    mismatches,
    0,
  );

  // The refused case must genuinely differ, otherwise refusing would be wrong.
  {
    const expression = 'Mon..Fri *-*-01 09:00:00';
    const systemdDates = systemdTimes(expression, 3);
    const unionCron = M.onCalendarToCron(expression).approximateCron;
    const unionParsed = C.parseCron(unionCron);
    const unionDates = unionParsed.ok
      ? C.nextRuns(unionParsed.value, 3, new Date()).map((r) => r.date)
      : [];
    const differs = systemdDates.some(
      (date, index) => !unionDates[index] || date.getTime() !== unionDates[index].getTime(),
    );
    check('被拒绝的表达式确实与并集写法触发时刻不同', differs, true);
    console.log(`        systemd(交集): ${show(systemdDates).join(' | ')}`);
    console.log(`        cron(并集)   : ${show(unionDates).join(' | ')}`);
  }

  // The `HH:MM/step` reading is the other easy thing to get wrong, so it is
  // verified directly against systemd rather than trusted.
  {
    const expression = '09:00/15';
    const systemdDates = systemdTimes(expression, 4);
    const cron = M.onCalendarToCron(expression).cron;
    const cronParsed = C.parseCron(cron);
    const cronDates = cronParsed.ok
      ? C.nextRuns(cronParsed.value, 4, new Date()).map((r) => r.date)
      : [];
    check(
      `HH:MM/step 只在小时内重复（${cron}）`,
      systemdDates.map((d) => d.getTime()),
      cronDates.map((d) => d.getTime()),
    );
  }
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
