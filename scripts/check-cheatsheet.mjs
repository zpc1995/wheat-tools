/**
 * Verifies the regex cheatsheet is actually correct.
 *
 * Every entry claims a `sample` matches its `pattern`. Documentation that is
 * never executed rots silently, so each claim is tested here — a wrong pattern
 * or a sample that does not match fails the build.
 *
 * Usage: node scripts/check-cheatsheet.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/regex-cheatsheet/cheatsheetData.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/cheatsheetData.mjs', compiled);
const M = await import(pathToFileURL('.verify/cheatsheetData.mjs').href);

let passed = 0;
let failed = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else {
    failed += 1;
    failures.push(label);
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

console.log('--- 每条速查项都能匹配其示例 ---');
{
  let compiledCount = 0;

  for (const group of M.CHEAT_GROUPS) {
    for (const entry of group.entries) {
      const flags = M.flagsForEntry(entry);
      let regex;
      try {
        regex = new RegExp(entry.pattern, flags);
      } catch (error) {
        failed += 1;
        failures.push(`${group.id}: ${entry.pattern} 无法编译`);
        console.log(`FAIL  [${group.id}] /${entry.pattern}/${flags} 无法编译：${error.message}`);
        continue;
      }

      compiledCount += 1;
      const matched = regex.test(entry.sample);
      if (matched) passed += 1;
      else {
        failed += 1;
        failures.push(`${group.id}: ${entry.pattern}`);
        console.log(
          `FAIL  [${group.id}] /${entry.pattern}/${flags} 未能匹配示例 ${JSON.stringify(entry.sample)}`,
        );
      }
    }
  }

  console.log(`      共编译 ${compiledCount} 条模式`);
}

console.log('--- 数据完整性 ---');
{
  const ids = M.CHEAT_GROUPS.map((g) => g.id);
  check('分组 id 唯一', new Set(ids).size, ids.length);
  check('分组数量至少 5', M.CHEAT_GROUPS.length >= 5, true);

  let allHaveFields = true;
  let allUnique = true;
  const seen = new Set();
  for (const group of M.CHEAT_GROUPS) {
    for (const entry of group.entries) {
      if (!entry.pattern || !entry.meaning || entry.sample === undefined) allHaveFields = false;
      const key = `${group.id}:${entry.pattern}`;
      if (seen.has(key)) allUnique = false;
      seen.add(key);
    }
  }
  check('每项都有 pattern/meaning/sample', allHaveFields, true);
  check('组内模式不重复', allUnique, true);
}

console.log('--- flagsForEntry 覆盖 ---');
{
  // The `i` flag example must actually need the flag; without it the sample
  // would not match and the entry would be misleading.
  const caseEntry = M.CHEAT_GROUPS.flatMap((g) => g.entries).find(
    (e) => e.pattern === 'a' && e.sample === 'A',
  );
  check('忽略大小写示例存在', Boolean(caseEntry), true);
  check('该示例确实需要 i 标志', new RegExp(caseEntry.pattern).test(caseEntry.sample), false);
  check('加上 i 后匹配', new RegExp(caseEntry.pattern, M.flagsForEntry(caseEntry)).test(caseEntry.sample), true);

  const multilineEntry = M.CHEAT_GROUPS.flatMap((g) => g.entries).find((e) => e.pattern === '^b');
  check('多行示例存在', Boolean(multilineEntry), true);
  check('该示例确实需要 m 标志', new RegExp(multilineEntry.pattern).test(multilineEntry.sample), false);

  const dotAllEntry = M.CHEAT_GROUPS.flatMap((g) => g.entries).find((e) => e.pattern === 'a.b');
  check('dotAll 示例存在', Boolean(dotAllEntry), true);
  check('该示例确实需要 s 标志', new RegExp(dotAllEntry.pattern).test(dotAllEntry.sample), false);
}

console.log('--- 陷阱条目 ---');
check('陷阱条目非空', M.PITFALLS.length >= 5, true);
check('陷阱条目都有标题与说明', M.PITFALLS.every((p) => p.title && p.detail), true);
check('包含灾难性回溯警示', M.PITFALLS.some((p) => /回溯/.test(p.title + p.detail)), true);
check('包含零宽匹配警示', M.PITFALLS.some((p) => /零宽/.test(p.title + p.detail)), true);
check('包含 lastIndex 警示', M.PITFALLS.some((p) => /lastIndex/.test(p.title + p.detail)), true);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
if (failures.length) console.log('失败项：\n  ' + failures.join('\n  '));
process.exit(failed === 0 ? 0 : 1);
