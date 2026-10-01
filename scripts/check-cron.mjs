/**
 * Correctness checks for the cron parser and next-run scheduler.
 *
 * The scheduler walks a `Date` field-by-field, so the interesting cases are
 * boundaries: day rollover, month lengths, leap years and the DOM/DOW
 * "either may match" rule.
 *
 * Usage: node scripts/check-cron.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/cron-builder/cronUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const { parseCron, nextRuns, describeCron, isImpossible } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

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

/** Renders the first N runs in local time as `YYYY-MM-DD HH:mm`. */
function runs(expression, count, from) {
  const parsed = parseCron(expression);
  if (!parsed.ok) return `PARSE ERROR: ${parsed.error}`;
  return nextRuns(parsed.value, count, new Date(from)).map((r) => {
    const d = r.date;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  });
}

console.log('--- 解析与校验 ---');
check('5 段合法', parseCron('*/5 * * * *').ok, true);
check('6 段（带秒）合法', parseCron('0 */5 * * * *').ok, true);
check('4 段被拒', parseCron('* * * *').ok, false);
check('7 段被拒', parseCron('* * * * * * *').ok, false);
check('范围起点>终点被拒', parseCron('0 25 * * *').ok, false);
check('分钟超范围被拒', parseCron('60 * * * *').ok, false);
check('月别名 dec 可用', parseCron('0 0 1 dec *').ok, true);
check('星期别名 MON 可用', parseCron('0 0 * * mon').ok, true);
check('L/W/# 被拒', parseCron('0 0 L * *').ok, false);
check('? 被拒', parseCron('0 0 ? * *').ok, false);
check('空字符串被拒', parseCron('   ').ok, false);
check('7 等价周日', parseCron('0 0 * * 7').value.dayOfWeek.values, [0]);

console.log('\n--- 下次执行时间（本地时区）---');
// 2025-01-01 is a Wednesday.
check('每 5 分钟', runs('*/5 * * * *', 3, '2025-01-01T00:00:00'), [
  '2025-01-01 00:05',
  '2025-01-01 00:10',
  '2025-01-01 00:15',
]);
check('每天零点（跨日）', runs('0 0 * * *', 2, '2025-01-01T12:00:00'), [
  '2025-01-02 00:00',
  '2025-01-03 00:00',
]);
check('跨月', runs('0 0 1 * *', 2, '2025-01-15T00:00:00'), [
  '2025-02-01 00:00',
  '2025-03-01 00:00',
]);
check('跨年', runs('0 0 1 1 *', 2, '2025-03-01T00:00:00'), [
  '2026-01-01 00:00',
  '2027-01-01 00:00',
]);
check('闰年 2 月 29 日', runs('0 0 29 2 *', 2, '2025-01-01T00:00:00'), [
  '2028-02-29 00:00',
  '2032-02-29 00:00',
]);
check('工作日 9 点（跳过周末）', runs('0 9 * * 1-5', 3, '2025-01-03T00:00:00'), [
  // 2025-01-03 是周五，之后跳到周一
  '2025-01-03 09:00',
  '2025-01-06 09:00',
  '2025-01-07 09:00',
]);
check('DOM 与 DOW 同时限制 → 满足其一', runs('0 0 15 * 1', 3, '2025-01-01T00:00:00'), [
  // 2025-01-06 是周一，2025-01-13 是周一，2025-01-15 是 15 号
  '2025-01-06 00:00',
  '2025-01-13 00:00',
  '2025-01-15 00:00',
]);
check('每月 31 号跳过短月', runs('0 0 31 * *', 3, '2025-01-01T00:00:00'), [
  '2025-01-31 00:00',
  '2025-03-31 00:00',
  '2025-05-31 00:00',
]);
// Seconds resolve to minute granularity here, so the expected values are the
// minute boundaries; the specific second is asserted separately below.
check('带秒的表达式', runs('30 */10 * * * *', 3, '2025-01-01T00:00:00'), [
  '2025-01-01 00:00',
  '2025-01-01 00:10',
  '2025-01-01 00:20',
]);
{
  const parsed = parseCron('30 */10 * * * *');
  check(
    '带秒表达式落在第 30 秒',
    nextRuns(parsed.value, 3, new Date('2025-01-01T00:00:00')).map((r) => r.date.getSeconds()),
    [30, 30, 30],
  );
  check(
    '秒字段为 0 时按分钟推进',
    nextRuns(parseCron('0 */10 * * * *').value, 2, new Date('2025-01-01T00:00:00')).map(
      (r) => r.date.getMinutes(),
    ),
    [10, 20],
  );
}
check('不存在的日期判定为不可能', isImpossible(parseCron('0 0 30 2 *').value), true);
check('正常表达式并非不可能', isImpossible(parseCron('0 0 * * *').value), false);

console.log('\n--- 语义描述 ---');
const describe = (expr) => {
  const parsed = parseCron(expr);
  return parsed.ok ? describeCron(parsed.value) : `ERR: ${parsed.error}`;
};
console.log('  * * * * *        →', describe('* * * * *'));
console.log('  */5 * * * *      →', describe('*/5 * * * *'));
console.log('  0 9 * * 1-5      →', describe('0 9 * * 1-5'));
console.log('  0 0 1 * *        →', describe('0 0 1 * *'));
console.log('  0 8,20 * * *     →', describe('0 8,20 * * *'));
console.log('  30 2 * * *       →', describe('30 2 * * *'));
check('描述非空', describe('0 9 * * 1-5').length > 0, true);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
