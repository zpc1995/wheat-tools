/**
 * Checks for password/passphrase generation.
 *
 * The two things worth asserting are statistical: that characters are actually
 * drawn uniformly (no modulo bias) and that the randomness is not repeated
 * across calls.
 *
 * Usage: node scripts/check-password.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/password-generator/passwordUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/passwordUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/passwordUtils.mjs').href);

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

console.log('--- 基本生成 ---');
{
  const r = M.generatePassword({ ...M.DEFAULT_PASSWORD_OPTIONS, length: 24 });
  check('生成成功', r.ok, true);
  check('长度正确', r.value.length, 24);
  // Derived from the source rather than hard-coded, so adding a symbol to
  // CHAR_SETS cannot make this assertion silently wrong.
  const expectedPool = new Set(
    M.CHAR_SETS.lowercase + M.CHAR_SETS.uppercase + M.CHAR_SETS.digits + M.CHAR_SETS.symbols,
  ).size;
  check(`池大小 = 4 类合并去重（${expectedPool}）`, r.poolSize, expectedPool);
}
for (const length of [1, 8, 20, 64, 512]) {
  const r = M.generatePassword({
    length,
    sets: ['lowercase'],
    excludeAmbiguous: false,
    requireEachSet: false,
  });
  check(`长度 ${length} 生效`, r.ok && r.value.length, length);
}

console.log('--- 字符集与排除歧义 ---');
{
  const r = M.generatePassword({
    length: 60,
    sets: ['digits'],
    excludeAmbiguous: false,
    requireEachSet: false,
  });
  check('仅数字集', /^[0-9]+$/.test(r.value), true);
}
{
  const r = M.generatePassword({
    length: 200,
    sets: ['lowercase', 'uppercase', 'digits'],
    excludeAmbiguous: true,
    requireEachSet: false,
  });
  const ambiguousPresent = [...r.value].some((c) => M.AMBIGUOUS.includes(c));
  check('排除歧义字符', ambiguousPresent, false);
}
{
  const r = M.generatePassword({
    length: 100,
    sets: ['symbols'],
    excludeAmbiguous: false,
    requireEachSet: false,
  });
  const allInSymbols = [...r.value].every((c) => M.CHAR_SETS.symbols.includes(c));
  check('仅符号集', allInSymbols, true);
}

console.log('--- 每种类型至少一个 ---');
{
  let ok = true;
  for (let i = 0; i < 200; i += 1) {
    const r = M.generatePassword({ ...M.DEFAULT_PASSWORD_OPTIONS, length: 8 });
    if (!r.ok) { ok = false; break; }
    const has = (set) => [...r.value].some((c) => M.CHAR_SETS[set].includes(c));
    if (!has('lowercase') || !has('uppercase') || !has('digits') || !has('symbols')) {
      ok = false;
      console.log('  缺少某类字符:', r.value);
      break;
    }
  }
  check('200 次生成均满足每类至少一个', ok, true);
}
check(
  '长度不足时给出明确错误',
  M.generatePassword({ length: 2, sets: ['lowercase', 'uppercase', 'digits'], excludeAmbiguous: false, requireEachSet: true }).ok,
  false,
);
check(
  '长度不足的错误提到类型数',
  /3 种字符类型/.test(
    M.generatePassword({ length: 2, sets: ['lowercase', 'uppercase', 'digits'], excludeAmbiguous: false, requireEachSet: true }).error ?? '',
  ),
  true,
);
check('未选字符类型时报错', M.generatePassword({ length: 8, sets: [], excludeAmbiguous: false, requireEachSet: false }).ok, false);
check('长度 0 报错', M.generatePassword({ length: 0, sets: ['lowercase'], excludeAmbiguous: false, requireEachSet: false }).ok, false);
check('长度超上限报错', M.generatePassword({ length: 999, sets: ['lowercase'], excludeAmbiguous: false, requireEachSet: false }).ok, false);

console.log('--- 随机性与唯一性 ---');
{
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const r = M.generatePassword({ ...M.DEFAULT_PASSWORD_OPTIONS, length: 16 });
    seen.add(r.value);
  }
  check('500 次生成互不相同', seen.size, 500);
}

console.log('--- 均匀性（取模偏差检测）---');
{
  // A biased implementation over-represents characters at the start of the
  // pool. With ~20k draws over 62 characters, each should land near 1/62.
  const counts = new Map();
  const total = 300;
  const length = 68;
  for (let i = 0; i < total; i += 1) {
    const r = M.generatePassword({
      length,
      sets: ['lowercase', 'uppercase', 'digits'],
      excludeAmbiguous: false,
      requireEachSet: false,
    });
    for (const char of r.value) counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  const draws = total * length;
  const expected = draws / 62;
  const values = [...counts.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Generous bounds: catches gross bias (e.g. first characters 2x) without
  // being flaky about normal sampling noise.
  const withinBounds = min > expected * 0.72 && max < expected * 1.3;
  check(`62 个字符分布均匀（期望 ${expected.toFixed(0)}，实际 ${min}–${max}）`, withinBounds, true);
  check('所有 62 个字符都出现过', counts.size, 62);
}

console.log('--- 熵计算 ---');
{
  const lower = M.generatePassword({ length: 10, sets: ['lowercase'], excludeAmbiguous: false, requireEachSet: false });
  check('小写 10 位熵 ≈ 47 bits', lower.entropyBits, Math.round(10 * Math.log2(26)));
  const full = M.generatePassword({ length: 20, sets: ['lowercase', 'uppercase', 'digits', 'symbols'], excludeAmbiguous: false, requireEachSet: false });
  check('四类 20 位熵 > 120', full.entropyBits > 120, true);
}
check('熵 < 40 判为弱', M.judgeStrength(30).label, '弱');
check('熵 60 判为强', M.judgeStrength(60).label, '强');
check('熵 100 判为很强', M.judgeStrength(100).label, '很强');
check('熵 200 判为极强', M.judgeStrength(200).label, '极强');
check('判定附带建议', M.judgeStrength(30).advice.length > 0, true);

console.log('--- 密码短语 ---');
{
  const r = M.generatePassphrase(M.DEFAULT_PASSPHRASE_OPTIONS);
  check('生成成功', r.ok, true);
  check('4 个单词用 - 连接', r.value.split('-').length, 4);
  check('首字母大写', /^[A-Z]/.test(r.value), true);
  check('含数字', /\d/.test(r.value), true);
  check('熵 ≈ 4×log2(128)+数字', r.entropyBits, Math.round(4 * Math.log2(M.WORD_LIST_SIZE) + Math.log2(10 * 4)));
}
check('单词数 < 2 报错', M.generatePassphrase({ words: 1, separator: '-', capitalize: false, includeNumber: false }).ok, false);
check('单词数超上限报错', M.generatePassphrase({ words: 99, separator: '-', capitalize: false, includeNumber: false }).ok, false);
{
  const r = M.generatePassphrase({ words: 6, separator: ' ', capitalize: false, includeNumber: false });
  check('可自定义分隔符', r.value.split(' ').length, 6);
  check('可关闭大写与数字', /^[a-z ]+$/.test(r.value), true);
}
{
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    seen.add(M.generatePassphrase(M.DEFAULT_PASSPHRASE_OPTIONS).value);
  }
  check('300 次短语互不相同', seen.size, 300);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
