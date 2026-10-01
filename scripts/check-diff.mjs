/**
 * Correctness checks for the text diff.
 *
 * A diff is easy to get subtly wrong (off-by-one in the LCS walk, or an edit
 * script that is not minimal), so the LCS length and the reconstructed output
 * are both asserted exactly.
 *
 * Usage: node scripts/check-diff.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/text-diff/diffUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/diffUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/diffUtils.mjs').href);

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

const kinds = (before, after, options) =>
  M.diffLines(before, after, options).lines.map((l) => `${l.kind[0]}:${l.text}`);

console.log('--- 基本行为 ---');
check('相同文本全部 equal', kinds('a\nb', 'a\nb'), ['e:a', 'e:b']);
check('尾部新增', kinds('a', 'a\nb'), ['e:a', 'i:b']);
check('尾部删除', kinds('a\nb', 'a'), ['e:a', 'd:b']);
check('中间替换', kinds('a\nb\nc', 'a\nX\nc'), ['e:a', 'd:b', 'i:X', 'e:c']);
check('空 → 有', kinds('', 'a\nb'), ['i:a', 'i:b']);
check('有 → 空', kinds('a\nb', ''), ['d:a', 'd:b']);
check('两边都空', kinds('', ''), []);
check('完全相同含空行', kinds('a\n\nb', 'a\n\nb'), ['e:a', 'e:', 'e:b']);
check('CRLF 与 LF 视为相同行', kinds('a\r\nb', 'a\nb'), ['e:a', 'e:b']);

console.log('--- 最小编辑脚本 ---');
{
  // The LCS of "a b c d" and "a c d e" is "a c d" (length 3).
  const r = M.diffLines('a\nb\nc\nd', 'a\nc\nd\ne');
  const unchanged = r.lines.filter((l) => l.kind === 'equal').length;
  check('LCS 长度正确', unchanged, 3);
  check('删除数', r.stats.removed, 1);
  check('新增数', r.stats.added, 1);
}
{
  // Classic: one shared line in the middle.
  const r = M.diffLines('x\ny\nz', 'p\ny\nq');
  check('中间行保持 equal', r.lines.filter((l) => l.kind === 'equal').map((l) => l.text), ['y']);
  check('两侧各一删一增', [r.stats.removed, r.stats.added], [2, 2]);
}

console.log('--- 行号 ---');
{
  const r = M.diffLines('a\nb\nc', 'a\nX\nc');
  check('equal 行两侧都有行号', [r.lines[0].beforeLine, r.lines[0].afterLine], [1, 1]);
  check('删除行只有 before 行号', [r.lines[1].beforeLine, r.lines[1].afterLine], [2, null]);
  check('新增行只有 after 行号', [r.lines[2].beforeLine, r.lines[2].afterLine], [null, 2]);
  check('末行行号正确', [r.lines[3].beforeLine, r.lines[3].afterLine], [3, 3]);
}

console.log('--- 重建一致性（关键不变量）---');
{
  let ok = true;
  const cases = [
    ['a\nb\nc', 'a\nX\nc'],
    ['one\ntwo\nthree\nfour', 'one\nthree\nfour\nfive'],
    ['', 'a\nb\nc'],
    ['a\nb\nc', ''],
    ['same', 'same'],
    ['a\nb\nc\nd\ne', 'e\nd\nc\nb\na'],
  ];
  for (const [before, after] of cases) {
    const r = M.diffLines(before, after);
    const reconstructedBefore = r.lines
      .filter((l) => l.kind !== 'insert')
      .map((l) => l.text)
      .join('\n');
    const reconstructedAfter = r.lines
      .filter((l) => l.kind !== 'delete')
      .map((l) => l.text)
      .join('\n');
    const expectedBefore = M.splitLines(before).join('\n');
    const expectedAfter = M.splitLines(after).join('\n');
    if (reconstructedBefore !== expectedBefore || reconstructedAfter !== expectedAfter) {
      ok = false;
      console.log('  重建不一致:', { before, after, reconstructedBefore, reconstructedAfter });
    }
  }
  check('删除行重建 before、新增行重建 after', ok, true);
}

console.log('--- 忽略选项 ---');
{
  const options = { ...M.DEFAULT_DIFF_OPTIONS, ignoreCase: true };
  check('忽略大小写后视为相同', kinds('Hello', 'hello', options), ['e:Hello']);
  check('不忽略时视为改动', kinds('Hello', 'hello').length, 2);
}
{
  const options = { ...M.DEFAULT_DIFF_OPTIONS, ignoreWhitespace: true };
  check('忽略空白后视为相同', kinds('a  b', 'a b', options), ['e:a  b']);
  check('不忽略时为改动', kinds('a  b', 'a b').length, 2);
}

console.log('--- 相似度与统计 ---');
{
  const r = M.diffLines('a\nb\nc\nd', 'a\nb\nc\nd');
  check('完全相同相似度 100', r.stats.similarity, 100);
  check('无改动统计', [r.stats.added, r.stats.removed, r.stats.unchanged], [0, 0, 4]);
}
{
  const r = M.diffLines('a\nb', 'c\nd');
  check('完全不同相似度 0', r.stats.similarity, 0);
}

console.log('--- 修改配对 ---');
{
  const r = M.diffLines('const a = 1;', 'const a = 2;');
  const pairs = M.pairLines(r.lines);
  check('单行改动配对为 modify', pairs.length, 1);
  check('配对类型', pairs[0].kind, 'modify');
  check('含词级差异', Array.isArray(pairs[0].wordDiff), true);
  const changed = pairs[0].wordDiff.filter((s) => s.kind !== 'equal').map((s) => s.text);
  check('词级差异只标出变化的 token', changed, ['1', '2']);
}
{
  // A pure deletion with no matching insertion must not be paired.
  const r = M.diffLines('a\nb\nc', 'a\nc');
  const pairs = M.pairLines(r.lines);
  check('纯删除不成对', pairs.some((p) => p.kind === 'delete' && p.after === null), true);
}
{
  const r = M.diffLines('a', 'a\nb\nc');
  const pairs = M.pairLines(r.lines);
  check('纯新增不成对', pairs.filter((p) => p.kind === 'insert').length, 2);
  check('equal 配对自身', pairs[0].kind, 'equal');
}

console.log('--- 词级 diff 保真 ---');
{
  const before = 'the quick brown fox';
  const after = 'the slow brown fox jumps';
  const segments = M.diffWords(before, after);
  check(
    '删除段拼接等于 before',
    segments.filter((s) => s.kind !== 'insert').map((s) => s.text).join(''),
    before,
  );
  check(
    '新增段拼接等于 after',
    segments.filter((s) => s.kind !== 'delete').map((s) => s.text).join(''),
    after,
  );
  check('相邻同类型段已合并', segments.every((s, i) => i === 0 || s.kind !== segments[i - 1].kind), true);
}
{
  const segments = M.diffWords('a b c', 'a b c');
  check('完全相同只有 equal', segments.map((s) => s.kind), ['equal']);
}
{
  const segments = M.diffWords('中文内容', '中文修改内容');
  check(
    '中文按整块处理仍保真',
    segments.filter((s) => s.kind !== 'insert').map((s) => s.text).join(''),
    '中文内容',
  );
}

console.log('--- 上下文折叠 ---');
{
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 20', 'line 20 CHANGED');
  const r = M.diffLines(before, after, M.DEFAULT_DIFF_OPTIONS);
  const rows = M.buildRows(M.pairLines(r.lines), 3);
  check('产生了折叠标记', rows.some((row) => row.type === 'gap'), true);
  const hidden = rows
    .filter((row) => row.type === 'gap')
    .reduce((sum, row) => sum + row.hidden, 0);
  // A `modify` row displays two diff lines at once (a delete plus an insert),
  // so the displayed count has to be weighted accordingly.
  const shown = rows
    .filter((row) => row.type === 'line')
    .reduce((sum, row) => sum + (row.pair.kind === 'modify' ? 2 : 1), 0);
  check('折叠行数 + 显示行数 = diff 总行数', hidden + shown, r.lines.length);
}
{
  const r = M.diffLines('a\nb', 'a\nc', M.DEFAULT_DIFF_OPTIONS);
  const rows = M.buildRows(M.pairLines(r.lines), 3);
  check('短文本不折叠', rows.every((row) => row.type === 'line'), true);
}

console.log('--- 统一格式导出 ---');
{
  const r = M.diffLines('a\nb', 'a\nc');
  const text = M.toUnifiedText(r.lines);
  check('前缀标记正确', text.split('\n').map((l) => l[0]), [' ', '-', '+']);
}

console.log('--- 上限保护 ---');
{
  const big = 'x\n'.repeat(3000);
  check('超大输入被拒绝而不是卡死', M.diffLines(big, big).ok, false);
  check(
    '拒绝时说明分段建议',
    /分段|上限/.test(M.diffLines(big, big).error ?? ''),
    true,
  );
}

console.log('--- 示例数据可对比 ---');
check('示例可对比', M.diffLines(M.DIFF_SAMPLE_BEFORE, M.DIFF_SAMPLE_AFTER).ok, true);
check('示例确实有差异', M.diffLines(M.DIFF_SAMPLE_BEFORE, M.DIFF_SAMPLE_AFTER).stats.added > 0, true);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
