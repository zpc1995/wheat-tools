/**
 * Correctness checks for the clock/time-zone helpers.
 *
 * The offset sign convention was wrong on the first attempt (every zone
 * inverted), and DST is the other classic trap — both are asserted here against
 * known-correct values rather than against the implementation.
 *
 * Usage: node scripts/check-clock.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/online-clock/clockUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const M = await import(
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

const summer = new Date('2026-07-15T12:00:00Z');
const winter = new Date('2026-01-15T12:00:00Z');

console.log('--- UTC 偏移（东为正）---');
const offsets = [
  ['UTC', '+00:00'],
  ['Asia/Shanghai', '+08:00'],
  ['Asia/Tokyo', '+09:00'],
  ['Asia/Kolkata', '+05:30'],
  ['Asia/Dubai', '+04:00'],
  ['Europe/Paris', '+02:00'],
  ['Australia/Sydney', '+10:00'],
  ['America/Los_Angeles', '-07:00'],
  ['America/Sao_Paulo', '-03:00'],
];
for (const [zone, expected] of offsets) {
  check(`${zone} 偏移`, M.formatInZone(summer, zone, false).offset, `UTC${expected}`);
}

console.log('--- 夏令时（同一时区冬夏不同）---');
check('纽约 冬令时', M.formatInZone(winter, 'America/New_York', false).offset, 'UTC-05:00');
check('纽约 夏令时', M.formatInZone(summer, 'America/New_York', false).offset, 'UTC-04:00');
check('伦敦 冬令时', M.formatInZone(winter, 'Europe/London', false).offset, 'UTC+00:00');
check('伦敦 夏令时', M.formatInZone(summer, 'Europe/London', false).offset, 'UTC+01:00');
check('悉尼 夏令时标记（7 月为冬令时）', M.formatInZone(summer, 'Australia/Sydney', false).isDst, false);
check('悉尼 夏令时标记（1 月为夏令时）', M.formatInZone(winter, 'Australia/Sydney', false).isDst, true);
check('上海无夏令时', M.formatInZone(summer, 'Asia/Shanghai', false).isDst, false);

console.log('--- 时刻换算（同一瞬间）---');
check('同一瞬间 UTC 04:00', M.formatInZone(new Date('2026-10-01T04:00:00Z'), 'UTC', false).time, '04:00:00');
check('同一瞬间 上海 12:00', M.formatInZone(new Date('2026-10-01T04:00:00Z'), 'Asia/Shanghai', false).time, '12:00:00');
check('同一瞬间 纽约 00:00', M.formatInZone(new Date('2026-10-01T04:00:00Z'), 'America/New_York', false).time, '00:00:00');
check('同一瞬间 加德满都 :45 偏移', M.formatInZone(new Date('2026-10-01T04:00:00Z'), 'Asia/Kathmandu', false).time, '09:45:00');
// The formatter uses `en-GB`, which renders ISO-style `YYYY-MM-DD`.
check('日期按 ISO 形式', M.formatInZone(new Date('2026-10-01T04:00:00Z'), 'America/New_York', false).date, '2026-10-01');
check('跨日：UTC 22:00 → 上海次日', M.formatInZone(new Date('2026-10-01T22:00:00Z'), 'Asia/Shanghai', false).date, '2026-10-02');
check('跨日：UTC 04:00 → 洛杉矶前一日', M.formatInZone(new Date('2026-10-01T04:00:00Z'), 'America/Los_Angeles', false).date, '2026-09-30');

console.log('--- 12/24 小时制 ---');
check('24 小时制 13 点', M.formatInZone(new Date('2026-10-01T13:00:00Z'), 'UTC', false).time, '13:00:00');
check('12 小时制 13 点', M.formatInZone(new Date('2026-10-01T13:00:00Z'), 'UTC', true).time, '01:00:00 pm');
check('12 小时制午夜', M.formatInZone(new Date('2026-10-01T00:00:00Z'), 'UTC', true).time, '12:00:00 am');

console.log('--- ISO 周与年内天数 ---');
check('2026-01-01 是第 1 周', M.isoWeek(new Date(2026, 0, 1)), 1);
check('2026-01-04 是第 1 周', M.isoWeek(new Date(2026, 0, 4)), 1);
check('2026-01-05 是第 2 周', M.isoWeek(new Date(2026, 0, 5)), 2);
check('2025-12-29 属 2026 第 1 周', M.isoWeek(new Date(2025, 11, 29)), 1);
check('2026-12-31 周数', M.isoWeek(new Date(2026, 11, 31)), 53);
check('平年 3 月 1 日是第 60 天', M.dayOfYear(new Date(2026, 2, 1)), 60);
check('闰年 3 月 1 日是第 61 天', M.dayOfYear(new Date(2024, 2, 1)), 61);

console.log('--- 时长格式化与解析 ---');
check('0', M.formatDuration(0), '00:00:00');
check('1 秒', M.formatDuration(1000), '00:00:01');
check('1 分 1 秒', M.formatDuration(61_000), '00:01:01');
check('1 时 1 分 1 秒', M.formatDuration(3_661_000), '01:01:01');
check('超过 24 小时不回绕', M.formatDuration(90_000_000), '25:00:00');
check('负数截断为 0', M.formatDuration(-5000), '00:00:00');
check('带厘秒', M.formatDuration(3_661_234, true), '01:01:01.23');

check('解析纯数字为分钟', M.parseDuration('25'), 1_500_000);
check('解析 mm:ss', M.parseDuration('1:30'), 90_000);
check('解析 h:mm:ss', M.parseDuration('1:02:03'), 3_723_000);
check('解析带空段 h::s', M.parseDuration('1::3'), 3_603_000);
check('拒绝 99:99', M.parseDuration('99:99'), null);
check('拒绝乱码', M.parseDuration('abc'), null);
check('拒绝空串', M.parseDuration('  '), null);
check('拒绝四段', M.parseDuration('1:2:3:4'), null);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
