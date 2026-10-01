/**
 * Checks crontab file parsing.
 *
 * The parts that are easy to get wrong are not the time fields but the file
 * format around them: environment assignments that change later jobs, the `%`
 * rule that truncates commands, the extra user field in cron.d files, and the
 * fact that `@reboot` is an event rather than a schedule.
 *
 * Usage: node scripts/check-crontab.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const cronUtilsUrl = (() => {
  const compiled = ts.transpileModule(
    readFileSync('src/tools/cron-builder/cronUtils.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  mkdirSync('.verify', { recursive: true });
  writeFileSync('.verify/cronUtils.mjs', compiled);
  return pathToFileURL('.verify/cronUtils.mjs').href;
})();

const cronConvertUrl = (() => {
  const compiled = ts.transpileModule(
    readFileSync('src/tools/cron-convert/cronConvertUtils.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  writeFileSync('.verify/cronConvertUtils.mjs', compiled);
  return pathToFileURL('.verify/cronConvertUtils.mjs').href;
})();

// Point the generated module's relative imports at the transpiled siblings.
let source = readFileSync('src/tools/cron-convert/crontabUtils.ts', 'utf8');
source = source
  .replace("from '../cron-builder/cronUtils'", "from './cronUtils.mjs'")
  .replace("from './cronConvertUtils'", "from './cronConvertUtils.mjs'");

const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
writeFileSync('.verify/crontabUtils.mjs', compiled);
void cronUtilsUrl;
void cronConvertUrl;

const M = await import(pathToFileURL('.verify/crontabUtils.mjs').href);

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

console.log('--- 基本解析 ---');
{
  const r = M.parseCrontab('30 2 * * * /opt/backup.sh\n');
  check('解析成功', r.ok, true);
  check('得到一个任务', r.jobs.length, 1);
  check('行号', r.jobs[0].line, 1);
  check('计划', r.jobs[0].schedule, '30 2 * * *');
  check('命令', r.jobs[0].command, '/opt/backup.sh');
  check('可解析', r.jobs[0].parseable, true);
  check('有中文描述', typeof r.jobs[0].description, 'string');
  check('有下次执行时间', r.jobs[0].nextRuns.length, 5);
  check('给出 systemd 对照', typeof r.jobs[0].systemd, 'string');
}
{
  const r = M.parseCrontab('# 注释\n\n// 不是注释\n0 1 * * * /a.sh\n');
  check('只有 # 开头才是注释', r.comments.length, 1);
  check('空行被跳过', r.jobs.length, 1);
  // `//` is not a crontab comment, so that line is unparseable and reported.
  check('非注释的无效行会产生警告', r.warnings.some((w) => /无法识别/.test(w)), true);
}
check('空输入被拒', M.parseCrontab('   ').ok, false);
check('没有任何任务的输入被拒', M.parseCrontab('# 只有注释\n').ok, false);

console.log('--- 环境变量 ---');
{
  const r = M.parseCrontab('SHELL=/bin/bash\nPATH=/usr/bin\nMAILTO=ops@x.com\n0 1 * * * /a.sh\n');
  check('识别 3 个环境变量', r.env.length, 3);
  check('名称大写化', r.env.map((e) => e.name), ['SHELL', 'PATH', 'MAILTO']);
  check('PATH 被标为已知', r.env.find((e) => e.name === 'PATH').known, true);
  check('已知变量有说明', typeof r.env.find((e) => e.name === 'PATH').note, 'string');
  check('MAILTO 有说明', typeof r.env.find((e) => e.name === 'MAILTO').note, 'string');
  check('统计环境变量数', r.stats.envVars, 3);
  check('MAILTO 触发邮件提示', r.warnings.some((w) => /邮件|MAILTO/.test(w)), true);
}
{
  const r = M.parseCrontab('CRON_TZ=UTC\n0 9 * * * /a.sh\n');
  check('CRON_TZ 被识别', r.env[0].name, 'CRON_TZ');
  check('CRON_TZ 触发时区警告', r.warnings.some((w) => /时区/.test(w)), true);
  check('CRON_TZ 有说明', /时区/.test(r.env[0].note ?? ''), true);
}
{
  const r = M.parseCrontab('MAILTO=""\n0 1 * * * /a.sh\n');
  check('空 MAILTO 不触发邮件提示', r.warnings.some((w) => /任务输出会发送/.test(w)), false);
}
{
  const r = M.parseCrontab('CUSTOM_VAR=1\n0 1 * * * /a.sh\n');
  check('未知变量仍被记录', r.env[0].name, 'CUSTOM_VAR');
  check('未知变量标记为 known=false', r.env[0].known, false);
  check('未知变量无说明', r.env[0].note, undefined);
}
{
  // `FOO=bar` as part of a command must not be mistaken for an assignment when
  // it is not at the start of the line.
  const r = M.parseCrontab('0 1 * * * /usr/bin/env FOO=bar /a.sh\n');
  check('命令中的赋值不算环境变量', r.env.length, 0);
  check('命令完整保留', r.jobs[0].command, '/usr/bin/env FOO=bar /a.sh');
}

console.log('--- % 的特殊含义 ---');
{
  const r = M.parseCrontab('0 6 * * * /bin/date +%F >> /var/log/date.log\n');
  const job = r.jobs[0];
  check('命令在 % 处被截断', job.command, '/bin/date +');
  check('% 之后成为标准输入', Array.isArray(job.stdin), true);
  check('标准输入内容', job.stdin[0].startsWith('F >>'), true);
  check('给出 % 的警告', job.warnings.some((w) => /%/.test(w)), true);
  check('保留了截断前的原文', typeof job.commandBeforePercent, 'string');
}
{
  const r = M.parseCrontab('0 7 * * * /bin/date +\\%F >> /var/log/date.log\n');
  const job = r.jobs[0];
  check('转义的 %% 不作为分隔符', job.stdin, null);
  check('转义还原为字面量 %', job.command.includes('+%F'), true);
  check('未触发 % 警告', job.warnings.some((w) => /Vixie/.test(w)), false);
}
{
  const r = M.parseCrontab('0 6 * * * cmd a%one%two\n');
  check('多个 % 分成多段标准输入', r.jobs[0].stdin.length, 2);
}

console.log('--- 简写 ---');
{
  const r = M.parseCrontab('@reboot /opt/on-boot.sh\n');
  const job = r.jobs[0];
  check('@reboot 可解析', job.parseable, true);
  check('@reboot 描述为事件', /启动/.test(job.description ?? ''), true);
  check('@reboot 没有 systemd 日历对照', job.systemd, null);
  check('并解释原因', /没有|不是时间表/.test(job.systemdNote ?? ''), true);
  check('提示 @reboot 的真实语义', job.warnings.some((w) => /守护进程/.test(w)), true);
}
for (const [shortcut, expanded] of [
  ['@hourly', '0 * * * *'],
  ['@daily', '0 0 * * *'],
  ['@weekly', '0 0 * * 0'],
  ['@monthly', '0 0 1 * *'],
  ['@yearly', '0 0 1 1 *'],
]) {
  const r = M.parseCrontab(`${shortcut} /a.sh\n`);
  check(`${shortcut} 可解析`, r.jobs[0].parseable, true);
  check(`${shortcut} 描述含等价表达式 ${expanded}`, (r.jobs[0].description ?? '').includes(expanded), true);
}
check('@midnight 等价于 @daily', (M.parseCrontab('@midnight /a.sh\n').jobs[0].description ?? '').includes('0 0 * * *'), true);
{
  const r = M.parseCrontab('@fortnightly /a.sh\n');
  check('未知简写被警告', r.warnings.some((w) => /未知的 @/.test(w)), true);
}

console.log('--- 6 段（含秒）---');
{
  const r = M.parseCrontab('*/30 * * * * * /a.sh\n');
  const job = r.jobs[0];
  check('6 段被识别为 interval', job.kind, 'interval');
  check('可解析', job.parseable, true);
  check('警告标准 cron 不支持秒', job.warnings.some((w) => /秒|5 个字段/.test(w)), true);
}

console.log('--- 系统 crontab / cron.d 的用户字段 ---');
{
  // Auto-detect via a known system account name.
  const r = M.parseCrontab('17 *\t* * *\troot\tcd / && run-parts /etc/cron.hourly\n');
  check('识别用户字段', r.jobs[0].user, 'root');
  check('方言来源为自动判断', r.dialectSource, 'inferred');
  check('命令不含用户字段', r.jobs[0].command.startsWith('cd /'), true);
  check('方言识别为系统 crontab', r.dialect, 'system-crontab');
  check('警告方言差异', r.warnings.some((w) => /用户.*字段|cron\.d/.test(w)), true);
  check('任务上也有方言警告', r.jobs[0].warnings.some((w) => /用户/.test(w)), true);
}
{
  const r = M.parseCrontab('0 1 * * * /a.sh\n');
  check('用户 crontab 无用户字段', r.jobs[0].user, null);
  check('方言识别为用户 crontab', r.dialect, 'user-crontab');
}
{
  // `root` is a known system account, so auto-detection picks the system
  // reading — the more plausible one for a bare account name — and says so.
  const r = M.parseCrontab('0 1 * * * root /a.sh\n');
  check('已知账号名触发系统方言自动判断', r.dialect, 'system-crontab');
  check('该行按系统格式解释出用户', r.jobs[0].user, 'root');
  check('命令不含用户名', r.jobs[0].command, '/a.sh');
  check('明确说明是自动判断的', r.warnings.some((w) => /自动判断/.test(w)), true);
}
{
  // The genuinely ambiguous case: an account-like but unknown first word. Auto
  // mode keeps the user-crontab reading and reports that it could be wrong,
  // rather than silently choosing one interpretation.
  const r = M.parseCrontab('0 1 * * * webuser /a.sh\n');
  check('未知账号名不改变方言', r.dialect, 'user-crontab');
  check('该行被标记为歧义', r.ambiguousLines, [1]);
  check('命令保持完整', r.jobs[0].command, 'webuser /a.sh');
  check('给出切换格式的提示', r.warnings.some((w) => /切换|系统 crontab/.test(w)), true);
}
{
  const r = M.parseCrontab('0 1 * * * root /a.sh\n', { dialect: 'system' });
  check('显式指定系统格式后识别用户', r.jobs[0].user, 'root');
  check('命令不含用户名', r.jobs[0].command, '/a.sh');
  check('方言来源为显式指定', r.dialectSource, 'explicit');
  check('不再报告歧义', r.ambiguousLines.length, 0);
}
{
  const r = M.parseCrontab('17 *\t* * *\troot\tcd /\n', { dialect: 'user' });
  check('显式指定用户格式时不吞掉 root', r.jobs[0].user, null);
  check('root 留在命令里', r.jobs[0].command.startsWith('root'), true);
}
check('制表符分隔也可解析', M.parseCrontab('0\t1\t*\t*\t*\t/a.sh\n').jobs[0].command, '/a.sh');
{
  // A path must never be eaten as a sixth time field.
  const r = M.parseCrontab('30 2 * * * /opt/backup.sh --full\n');
  check('命令里的路径不被当作时间字段', r.jobs[0].schedule, '30 2 * * *');
  check('命令完整', r.jobs[0].command, '/opt/backup.sh --full');
}
{
  const r = M.parseCrontab('*/30 * * * * * /a.sh\n');
  check('真正的 6 段时间字段被保留', r.jobs[0].schedule, '*/30 * * * * *');
  check('其命令正确', r.jobs[0].command, '/a.sh');
}

console.log('--- 错误与边界 ---');
{
  const r = M.parseCrontab('0 9 * * /a.sh\n');
  check('字段不足被标记为不可解析', r.jobs.length > 0 && !r.jobs[0].parseable, true);
  check('统计不可解析数量', r.stats.unparseable, 1);
  check('总体警告提到不可解析', r.warnings.some((w) => /无法解析/.test(w)), true);
}
{
  const r = M.parseCrontab('0 0 1 13 * /a.sh\n');
  check('月份越界不可解析', r.jobs[0].parseable, false);
}
{
  const r = M.parseCrontab('0 25 * * * /a.sh\n');
  check('小时越界不可解析', r.jobs[0].parseable, false);
}
{
  const r = M.parseCrontab('0 1 * * *\n');
  check('没有命令的任务给出警告', r.jobs[0].warnings.some((w) => /没有命令/.test(w)), true);
}
{
  const r = M.parseCrontab('0 1 * * * /a.sh extra args here\n');
  check('命令参数完整保留', r.jobs[0].command, '/a.sh extra args here');
}
check('注释中的内容不产生任务', M.parseCrontab('# 0 1 * * * /a.sh\n0 1 * * * /b.sh\n').jobs.length, 1);

console.log('--- 统计与注释 ---');
{
  const r = M.parseCrontab('# 标题\nPATH=/usr/bin\n\n0 1 * * * /a.sh\n0 2 * * * /b.sh\n');
  check('总行数', r.stats.lines, 5);
  check('任务数', r.stats.jobs, 2);
  check('注释数', r.stats.comments, 1);
  check('注释内容去掉了 #', r.comments[0].text, '标题');
}

console.log('--- 示例数据 ---');
{
  let allOk = true;
  for (const sample of M.CRONTAB_SAMPLES) {
    const r = M.parseCrontab(sample.text);
    if (!r.ok) {
      allOk = false;
      console.log('  示例解析失败:', sample.label, r.error);
    }
  }
  check('全部示例可解析', allOk, true);
  check('示例都有说明', M.CRONTAB_SAMPLES.every((s) => s.note), true);
  check('示例覆盖 % 场景', M.CRONTAB_SAMPLES.some((s) => /%/.test(s.label)), true);
  check('示例覆盖系统 crontab', M.CRONTAB_SAMPLES.some((s) => /系统 crontab/.test(s.label)), true);
}
{
  // The system crontab sample is the real Debian /etc/cron.d layout, tabs and all.
  const sample = M.CRONTAB_SAMPLES.find((s) => /系统 crontab/.test(s.label));
  const r = M.parseCrontab(sample.text);
  check('真实 cron.d 的 3 个任务都解析出来', r.jobs.length, 3);
  check('用户字段都是 root', r.jobs.every((j) => j.user === 'root'), true);
  check('都用 run-parts 命令', r.jobs.every((j) => j.command.includes('run-parts')), true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
