/**
 * Checks cron parsing and cross-scheduler conversion.
 *
 * The semantic differences between schedulers are the point: cron ORs
 * day-of-month with day-of-week while systemd ANDs them, and that must be
 * reported rather than silently mistranslated.
 *
 * Usage: node scripts/check-cronconvert.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/cron-convert/cronConvertUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/cronConvertUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/cronConvertUtils.mjs').href);

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

const parse = (e) => M.parseCron(e);

console.log('--- 解析 ---');
{
  const r = parse('*/5 * * * *');
  check('解析成功', r.ok, true);
  check('分钟步长取值', r.cron.minute.values, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  check('步长记录', r.cron.minute.step, 5);
  check('小时为通配', r.cron.hour.isWildcard, true);
  check('5 段不含秒', r.cron.hasSeconds, false);
}
{
  const r = parse('0 9 * * 1-5');
  check('星期区间', r.cron.dayOfWeek.values, [1, 2, 3, 4, 5]);
  check('固定小时', r.cron.hour.values, [9]);
}
{
  const r = parse('30 9 * * *');
  check('固定分钟', r.cron.minute.values, [30]);
}
check('6 段含秒', parse('*/30 * * * * *').cron.hasSeconds, true);
check('6 段秒字段', parse('*/30 * * * * *').cron.second.values, [0, 30]);
check('月份别名解析', parse('0 0 1 JAN *').cron.month.values, [1]);
check('星期别名解析', parse('0 0 * * MON').cron.dayOfWeek.values, [1]);
check('星期 7 归一为 0', parse('0 0 * * 7').cron.dayOfWeek.values, [0]);
check('列表解析', parse('0 0 1,15 * *').cron.dayOfMonth.values, [1, 15]);
check('区间带步长', parse('0 0-12/6 * * *').cron.hour.values, [0, 6, 12]);
check('单值带步长（10/5）', parse('10/5 * * * *').cron.minute.values, [10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);

console.log('--- 解析错误 ---');
check('字段数不足被拒', parse('* * *').ok, false);
check('字段数过多被拒', parse('* * * * * * *').ok, false);
check('空输入被拒', parse('   ').ok, false);
check('分钟越界被拒', parse('60 * * * *').ok, false);
check('小时越界被拒', parse('* 24 * * *').ok, false);
check('月份 0 越界被拒', parse('* * * 0 *').ok, false);
check('日 0 越界被拒', parse('* * 0 * *').ok, false);
check('区间反向被拒', parse('* 12-6 * * *').ok, false);
check('步长为 0 被拒', parse('*/0 * * * *').ok, false);
check('步长非数字被拒', parse('*/x * * * *').ok, false);
check('无法识别的值被拒', parse('abc * * * *').ok, false);
check('错误信息提到字段名', /分钟/.test(parse('60 * * * *').error ?? ''), true);

console.log('--- systemd 转换 ---');
{
  const r = M.toSystemd('*/5 * * * *');
  check('转换成功', r.target, 'systemd');
  check('生成 OnCalendar', /OnCalendar=/.test(r.code), true);
  // systemd spells the minute step as `*:0/5:00` (hour wildcard, minute 0/5) —
  // the cron star-slash form cannot be copied verbatim.
  check('步长写成 a/b 形式', /OnCalendar=\*:0\/5:00/.test(r.code), true);
  check('包含验证命令', /systemd-analyze calendar/.test(r.code), true);
  check('包含 Persistent', /Persistent=true/.test(r.code), true);
  check('无通配日期时不写日期段', !/OnCalendar=\S+ \d{4}-/.test(r.code), true);
}
{
  const r = M.toSystemd('0 9 * * 1-5');
  check('星期写作名称', /Mon|Tue|Wed|Thu|Fri/.test(r.code), true);
}
{
  // Day-of-month AND day-of-week is the case that cannot be exact.
  const r = M.toSystemd('0 3 1 * 0');
  check('日与星期同时限定时标记为有损', r.lossy, true);
  check('并给出并集/交集差异说明', r.notes.some((n) => /并集|交集/.test(n)), true);
  check('代码顶部有注意注释', /注意/.test(r.code.split('\n')[0]), true);
}
check('6 段（含秒）标记为有损', M.toSystemd('*/30 * * * * *').lossy, true);
check('6 段的说明提到秒', M.toSystemd('*/30 * * * * *').notes.some((n) => /秒/.test(n)), true);
check('非法表达式返回错误', M.toSystemd('bad').error !== undefined, true);

console.log('--- GitHub Actions 转换 ---');
{
  const r = M.toGithubActions('0 9 * * 1-5');
  check('转换成功', r.target, 'github-actions');
  check('cron 为 5 段', /cron: '0 9 \* \* 1-5'/.test(r.code), true);
  check('包含 workflow_dispatch', /workflow_dispatch/.test(r.code), true);
  check('提示 UTC 时区', r.notes.some((n) => /UTC/.test(n)), true);
  check('提示 60 天停用', r.notes.some((n) => /60 天/.test(n)), true);
}
{
  const r = M.toGithubActions('*/30 * * * * *');
  check('6 段时标记有损', r.lossy, true);
  check('6 段时说明秒被忽略', r.notes.some((n) => /秒/.test(n)), true);
  check('输出仍为 5 段', /cron: '\* \* \* \* \*'/.test(r.code), true);
}

console.log('--- crontab 转换 ---');
{
  const r = M.toCrontab('0 9 * * 1-5', '/opt/job.sh');
  check('转换成功', r.target, 'crontab');
  check('含命令', /\/opt\/job\.sh/.test(r.code), true);
  check('含 cron.d 用户字段说明', /root/.test(r.code), true);
  check('含 @daily 等简写', /@daily/.test(r.code), true);
  check('5 段表达式无损', r.lossy, false);
}
check('6 段表达式在 crontab 中标记有损', M.toCrontab('*/30 * * * * *').lossy, true);

console.log('--- 中文说明 ---');
{
  check('每 5 分钟', M.toHuman('*/5 * * * *').code.includes('分'), true);
  check('每天固定时间', /09:30/.test(M.toHuman('30 9 * * *').code), true);
  check('工作日', /周一/.test(M.toHuman('0 9 * * 1-5').code), true);
  check('每月 1 日', /1 日/.test(M.toHuman('0 0 1 * *').code), true);
  check('每分钟', M.toHuman('* * * * *').code.includes('每分钟'), true);
  check('每小时固定分钟', /第 30 分钟/.test(M.toHuman('30 * * * *').code), true);
}
check(
  '日与星期同时限定时给出并集提示',
  M.toHuman('0 3 1 * 0').notes.some((n) => /并集/.test(n)),
  true,
);
check(
  '都未限定时说明每天触发',
  M.toHuman('0 3 * * *').notes.some((n) => /每天/.test(n)),
  true,
);
check('非法表达式返回错误', M.toHuman('bad').error !== undefined, true);

console.log('--- 示例数据全部可用 ---');
{
  let allOk = true;
  for (const sample of M.CRON_CONVERT_SAMPLES) {
    if (!M.parseCron(sample.expression).ok) {
      allOk = false;
      console.log('  示例解析失败:', sample.expression);
    }
    for (const fn of [M.toSystemd, M.toGithubActions, M.toCrontab, M.toHuman]) {
      const r = fn(sample.expression);
      if (!r.code) {
        allOk = false;
        console.log('  示例转换失败:', sample.expression, r.error);
      }
    }
  }
  check('所有示例均能解析并转换', allOk, true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
