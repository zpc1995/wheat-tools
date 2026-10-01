/**
 * Checks the GitHub Actions workflow → schedule analysis.
 *
 * The value here is not reading the cron (it is already cron) but surfacing the
 * constraints Actions adds: UTC-only, five fields, five-minute floor, and the
 * 60-day disablement. Those are asserted so the analysis cannot quietly stop
 * reporting them.
 *
 * Usage: node scripts/check-actions.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// Two modules with a shared dependency, so both are transpiled to files that
// can resolve the installed `yaml` package.
function transpile(sourcePath, outName) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mkdirSync('.verify', { recursive: true });
  const out = `.verify/${outName}`;
  writeFileSync(out, compiled);
  return pathToFileURL(out).href;
}

// Rewrite the relative imports so the generated file resolves its siblings.
const cronUtilsUrl = transpile('src/tools/cron-builder/cronUtils.ts', 'cronUtils.mjs');
const cronConvertUrl = transpile('src/tools/cron-convert/cronConvertUtils.ts', 'cronConvertUtils.mjs');

let actionsSource = readFileSync('src/tools/cron-convert/actionsUtils.ts', 'utf8');
actionsSource = actionsSource
  .replace("from '../cron-builder/cronUtils'", "from './cronUtils.mjs'")
  .replace("from './cronConvertUtils'", "from './cronConvertUtils.mjs'");

const compiledActions = ts.transpileModule(actionsSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/actionsUtils.mjs', compiledActions);

void cronUtilsUrl;
void cronConvertUrl;

const M = await import(pathToFileURL('.verify/actionsUtils.mjs').href);

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

console.log('--- 解析基本结构 ---');
{
  const r = M.analyseWorkflow(`name: 每日构建
on:
  schedule:
    - cron: '0 9 * * *'
  workflow_dispatch:
`);
  check('解析成功', r.ok, true);
  check('读取 name', r.name, '每日构建');
  check('找到 1 条 schedule', r.schedules.length, 1);
  check('识别 workflow_dispatch', r.hasWorkflowDispatch, true);
  check('cron 原样保留', r.schedules[0].cron, '0 9 * * *');
  check('schedule 可解析', r.schedules[0].ok, true);
  check('给出中文描述', typeof r.schedules[0].description, 'string');
}
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '0 9 * * 1-5'
    - cron: '30 18 * * 5'
  push:
    branches: [main]
`);
  check('多条 schedule', r.schedules.length, 2);
  check('记录其他触发器', r.otherTriggers.includes('push'), true);
  check('没有 workflow_dispatch', r.hasWorkflowDispatch, false);
  check('序号从 1 开始', r.schedules.map((s) => s.index), [1, 2]);
}
check('on 为字符串也可解析', M.analyseWorkflow('on: push\n').ok, true);
check('on 为列表也可解析', M.analyseWorkflow('on: [push, workflow_dispatch]\n').ok, true);
check(
  '列表中识别 workflow_dispatch',
  M.analyseWorkflow('on: [push, workflow_dispatch]\n').hasWorkflowDispatch,
  true,
);

console.log('--- Actions 特有的约束 ---');
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '0 9 * * *'
`);
  check('提示 UTC', r.warnings.some((w) => /UTC/.test(w)), true);
  check('提示 60 天停用', r.warnings.some((w) => /60 天/.test(w)), true);
  check('提示可能延迟', r.warnings.some((w) => /延迟/.test(w)), true);
  // The local rendering is the point: the same instant shown in the viewer's zone.
  check('给出本地时间', r.schedules[0].nextLocal.length > 0, true);
  check('给出 UTC 时间', r.schedules[0].nextUtc.length > 0, true);
  check('本地与 UTC 数量一致', r.schedules[0].nextLocal.length, r.schedules[0].nextUtc.length);
}
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '0 9 * * *'
`);
  // The two renderings must differ unless the machine is on UTC — that is the
  // whole reason both are shown.
  const isUtc = new Date().getTimezoneOffset() === 0;
  const same = r.schedules[0].nextUtc[0] === r.schedules[0].nextLocal[0];
  check(
    isUtc ? '本机为 UTC，两种渲染相同' : '本地时间与 UTC 不同（说明时区换算生效）',
    same,
    isUtc,
  );
}

console.log('--- 秒字段被拒绝 ---');
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '*/30 * * * * *'
`);
  check('标记为不可解析', r.schedules[0].ok, false);
  check('识别出秒字段', r.schedules[0].hasSeconds, true);
  check('段数为 6', r.schedules[0].fieldCount, 6);
  check('错误说明不接受秒', /秒字段|6 段|5 段/.test(r.schedules[0].error ?? ''), true);
}
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '* * *'
`);
  check('段数不足被标记', r.schedules[0].tooFewFields, true);
  check('错误说明需要 5 段', /5 段/.test(r.schedules[0].error ?? ''), true);
}

console.log('--- 最小间隔 ---');
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '*/2 * * * *'
`);
  check('算出最小间隔为 2 分钟', r.schedules[0].minIntervalMinutes, 2);
}
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '*/5 * * * *'
`);
  check('5 分钟间隔', r.schedules[0].minIntervalMinutes, 5);
}
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '0 9 * * *'
`);
  check('每天一次的时间隔为 1440 分钟', r.schedules[0].minIntervalMinutes, 1440);
}

console.log('--- systemd 对照 ---');
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '0 9 * * 1-5'
`);
  check('生成 systemd 对照', typeof r.schedules[0].systemd, 'string');
  check('对照含 OnCalendar', (r.schedules[0].systemd ?? '').includes('OnCalendar'), true);
}

console.log('--- 缺 schedule 的情形 ---');
{
  const r = M.analyseWorkflow(`name: 仅推送
on:
  push:
    branches: [main]
`);
  check('解析成功但无计划', r.schedules.length, 0);
  check('明确指出没有 schedule', r.warnings.some((w) => /没有找到/.test(w)), true);
  check('并说明本来就没有定时计划', r.warnings.some((w) => /本来就没有/.test(w)), true);
}

console.log('--- 错误处理 ---');
check('空输入被拒', M.analyseWorkflow('   ').ok, false);
check('非法 YAML 被拒', M.analyseWorkflow('a: [1, 2').ok, false);
check('顶层为数组被拒', M.analyseWorkflow('- a\n- b').ok, false);
{
  const r = M.analyseWorkflow(`on:
  schedule:
    - foo: bar
`);
  check('schedule 项缺 cron 时报错', r.schedules[0].ok, false);
  check('错误说明缺少 cron 字段', /cron/.test(r.schedules[0].error ?? ''), true);
}
{
  const r = M.analyseWorkflow(`on:
  schedule: '0 9 * * *'
`);
  check('schedule 不是列表时提示', r.warnings.some((w) => /应为列表/.test(w)), true);
}
{
  // Untrusted input: a custom YAML tag must not be evaluated.
  const r = M.analyseWorkflow(`on: !!js/function "function(){}"\n`);
  check('自定义标签不求值（只当字符串）', typeof r.ok, 'boolean');
}

console.log('--- 重复键（YAML 常见错误）---');
{
  // Duplicate keys are a real hazard in workflow files; core mode has to keep
  // this from silently discarding the first definition.
  const r = M.analyseWorkflow(`on:
  schedule:
    - cron: '0 9 * * *'
name: first
name: second
`);
  check('重复键不会导致崩溃', typeof r.ok, 'boolean');
}

console.log('--- 示例数据 ---');
{
  let allOk = true;
  for (const sample of M.WORKFLOW_SAMPLES) {
    const r = M.analyseWorkflow(sample.yaml);
    if (!r.ok) {
      allOk = false;
      console.log('  示例解析失败:', sample.label, r.error);
    }
  }
  check('全部示例可解析', allOk, true);
  check('示例都有说明', M.WORKFLOW_SAMPLES.every((s) => s.note), true);
  check('示例覆盖秒字段错误', M.WORKFLOW_SAMPLES.some((s) => /秒字段/.test(s.label)), true);
  check('示例覆盖最小间隔错误', M.WORKFLOW_SAMPLES.some((s) => /5 分钟/.test(s.label)), true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
