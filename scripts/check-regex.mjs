/**
 * Correctness checks for the safe regex layer.
 *
 * The critical case is zero-length matching: `/(?:)/g` matches the empty string
 * at every position without advancing `lastIndex`, so a naive loop hangs the
 * tab forever. That is asserted explicitly with a timeout guard.
 *
 * Usage: node scripts/check-regex.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/regex-tester/regexUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

// `performance` exists in Node 16+; the module uses it for timing.
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

const FLAGS = { ...M.DEFAULT_FLAGS };

console.log('--- 编译与标志 ---');
check('flagsToString 空', M.flagsToString({ ...FLAGS, global: false }), '');
check('flagsToString 全部', M.flagsToString({ global: true, ignoreCase: true, multiline: true, dotAll: true, unicode: true, sticky: true }), 'gimsuy');
check('合法模式编译成功', M.compile('a+', FLAGS).ok, true);
check('非法模式被拒', M.compile('a(', FLAGS).ok, false);
check('非法模式带错误信息', typeof M.compile('a(', FLAGS).error, 'string');
check('非法标志被拒', M.compile('a', { ...FLAGS, global: 'x' }).ok, false);

console.log('--- 基本匹配 ---');
const run = (pattern, subject, flags = FLAGS) => {
  const compiled = M.compile(pattern, flags);
  if (!compiled.ok) return { error: compiled.error };
  const result = M.execute(compiled.regex, subject);
  return result.ok ? result.matches.map((m) => [m.text, m.index]) : { error: result.error };
};

check('全局数字', run('\\d+', 'a1b22c333'), [['1', 1], ['22', 3], ['333', 6]]);
check('非全局只取首个', run('\\d+', 'a1b22', { ...FLAGS, global: false }), [['1', 1]]);
check('忽略大小写', run('abc', 'ABC abc', { ...FLAGS, ignoreCase: true }), [['ABC', 0], ['abc', 4]]);
check('多行 ^', run('^\\w+', 'one\ntwo', { ...FLAGS, multiline: true }), [['one', 0], ['two', 4]]);
check('无匹配返回空数组', run('zzz', 'abc'), []);
check('空 subject', run('a', ''), []);

console.log('--- 零宽匹配（防死循环）---');
{
  // If the loop did not advance past zero-length matches this would never return.
  const guard = setTimeout(() => {
    console.log('FAIL  零宽匹配导致死循环（超时）');
    process.exit(1);
  }, 5000);

  const empty = run('(?:)', 'abc');
  clearTimeout(guard);
  check('零宽匹配正常返回', Array.isArray(empty), true);
  check('零宽匹配数量 = 长度+1', empty.length, 4);
  check('零宽匹配位置', empty.map((m) => m[1]), [0, 1, 2, 3]);

  const anchors = run('^', 'abc');
  check('^ 单次零宽', anchors.length, 1);
  const lookahead = run('(?=b)', 'abc');
  check('前瞻零宽位置', lookahead.map((m) => m[1]), [1]);
}

console.log('--- 捕获组 ---');
{
  const compiled = M.compile('(\\d{4})-(\\d{2})', FLAGS);
  const result = M.execute(compiled.regex, '2026-10');
  check('捕获组数量', result.matches[0].groups.length, 2);
  check('捕获组值', result.matches[0].groups.map((g) => g.value), ['2026', '10']);
  check('捕获组序号', result.matches[0].groups.map((g) => g.index), [1, 2]);
}
{
  const compiled = M.compile('(?<year>\\d{4})-(?<month>\\d{2})', FLAGS);
  const result = M.execute(compiled.regex, '2026-10');
  check('命名分组', result.matches[0].namedGroups, { year: '2026', month: '10' });
  check('命名分组同时标注在位置组上', result.matches[0].groups.some((g) => g.name === 'year'), true);
}
{
  const compiled = M.compile('(a)|(b)', FLAGS);
  const result = M.execute(compiled.regex, 'ab');
  check('未参与匹配的组为 null', result.matches[0].groups.map((g) => g.value), ['a', null]);
}

console.log('--- 上限与截断 ---');
{
  const compiled = M.compile('a', FLAGS);
  const result = M.execute(compiled.regex, 'a'.repeat(50), { maxMatches: 10, maxSubjectLength: 100 });
  check('达到上限即停止', result.matches.length, 10);
  check('标记为已截断', result.truncated, true);
}
{
  const compiled = M.compile('a', FLAGS);
  const result = M.execute(compiled.regex, 'aaa', { maxMatches: 10, maxSubjectLength: 100 });
  check('未超上限时不标记截断', result.truncated, false);
  check('返回耗时字段', typeof result.elapsedMs, 'number');
}

console.log('--- lastIndex 重置（复用同一 RegExp）---');
{
  const compiled = M.compile('\\d', FLAGS);
  const first = M.execute(compiled.regex, '1');
  const second = M.execute(compiled.regex, '2');
  check('第一次匹配', first.matches.map((m) => m.text), ['1']);
  check('复用后第二次仍从头匹配', second.matches.map((m) => m.text), ['2']);
}

console.log('--- 风险识别 ---');
check('(a+)+ 被标记', M.assessRisk('(a+)+').warnings.length > 0, true);
check('(a+)+ 被判定为 block', M.assessRisk('(a+)+').blocked, true);
check('普通模式无警告', M.assessRisk('\\d{4}-\\d{2}').warnings.length, 0);
check('邮箱模式无警告', M.assessRisk('[\\w.+-]+@[\\w-]+\\.[\\w.]+').warnings.length, 0);
check('(a|a)+ 被标记', M.assessRisk('(a|a)+').warnings.length > 0, true);

console.log('--- 高亮分段 ---');
{
  const compiled = M.compile('\\d+', FLAGS);
  const matches = M.execute(compiled.regex, 'a1b22').matches;
  const segs = M.segment('a1b22', matches);
  check('分段文本', segs.map((s) => s.text), ['a', '1', 'b', '22']);
  check('分段匹配标记', segs.map((s) => s.match), [false, true, false, true]);
  check('分段携带匹配序号', segs.filter((s) => s.match).map((s) => s.matchIndex), [0, 1]);
}
{
  const compiled = M.compile('(?=b)', FLAGS);
  const matches = M.execute(compiled.regex, 'ab').matches;
  const segs = M.segment('ab', matches);
  check('零宽匹配产生空段', segs.some((s) => s.match && s.text === ''), true);
  check('零宽分段总文本仍等于原文', segs.map((s) => s.text).join(''), 'ab');
}
{
  check('无匹配时原样返回', M.segment('abc', []).map((s) => s.text), ['abc']);
}

console.log('--- 替换 ---');
{
  const compiled = M.compile('(\\d+)', FLAGS);
  check('反向引用替换', M.replaceAll(compiled.regex, 'a1b22', '[$1]').value, 'a[1]b[22]');
}
{
  const compiled = M.compile('(?<d>\\d+)', FLAGS);
  check('命名反向引用', M.replaceAll(compiled.regex, 'a1', '<$<d>>').value, 'a<1>');
}
{
  const compiled = M.compile('a', { ...FLAGS, global: false });
  check('非全局也替换全部（自动补 g）', M.replaceAll(compiled.regex, 'aaa', 'b').value, 'bbb');
}
{
  // Repeated execution must not inherit state from the matching pass.
  const compiled = M.compile('a', FLAGS);
  M.execute(compiled.regex, 'aaa');
  check('替换不受 lastIndex 影响', M.replaceAll(compiled.regex, 'aaa', 'b').value, 'bbb');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
