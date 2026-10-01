/**
 * Correctness checks for arbitrary-radix conversion.
 *
 * The interesting parts are exactness: integers beyond 2^53 (where Number would
 * silently corrupt), negative values, and fractions (which need scaled-integer
 * arithmetic rather than floating point).
 *
 * Usage: node scripts/check-base.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/number-base/baseUtils.ts', 'utf8');
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

const conv = (input, from, to, extra = {}) =>
  M.convert(input, { from, to, precision: 10, uppercase: false, group: 0, prefix: false, ...extra });

console.log('--- 整数换算（对照 BigInt 权威值）---');
const intCases = [
  ['0', 10, 2, '0'],
  ['1', 10, 2, '1'],
  ['255', 10, 16, 'ff'],
  ['255', 10, 2, '11111111'],
  ['255', 10, 8, '377'],
  ['-255', 10, 16, '-ff'],
  ['ff', 16, 10, '255'],
  ['11111111', 2, 10, '255'],
  ['z', 36, 10, '35'],
  ['35', 10, 36, 'z'],
  ['deadbeef', 16, 2, '11011110101011011011111011101111'],
  ['100000000000000000000', 10, 16, '56bc75e2d63100000'],
  // 2^64 and 2^128 boundary values: Number would fail here, BigInt must not.
  ['18446744073709551616', 10, 16, '10000000000000000'],
  ['340282366920938463463374607431768211456', 10, 16, '100000000000000000000000000000000'],
  ['ffffffffffffffffffffffffffffffff', 16, 10, '340282366920938463463374607431768211455'],
];
for (const [input, from, to, expected] of intCases) {
  check(`${from}进制 ${input.slice(0, 24)} → ${to}进制`, conv(input, from, to).value, expected);
}

console.log('--- 大小写与前缀 ---');
check('大写十六进制', conv('255', 10, 16, { uppercase: true }).value, 'FF');
check('0x 前缀', conv('255', 10, 16, { prefix: true }).value, '0x' + 'ff');
check('输入带 0x 前缀', conv('0xff', 16, 10).value, '255');
check('输入带 0b 前缀', conv('0b1010', 2, 10).value, '10');
check('输入含下划线分隔', conv('1111_0000', 2, 10).value, '240');
check('输入含空格分隔', conv('1111 0000', 2, 10).value, '240');

console.log('--- 小数（缩放整数运算，非浮点）---');
check('十进制 0.5 → 二进制', conv('0.5', 10, 2).value, '0.1');
check('十进制 0.25 → 二进制', conv('0.25', 10, 2).value, '0.01');
check('十进制 0.1 → 二进制 10 位', conv('0.1', 10, 2).value, '0.000110011');
check('二进制 0.1 → 十进制', conv('0.1', 2, 10).value, '0.5');
check('十进制 3.75 → 二进制', conv('3.75', 10, 2).value, '11.11');
check('十六进制 0.8 → 十进制', conv('0.8', 16, 10).value, '0.5');
check('负数带小数', conv('-2.5', 10, 2).value, '-10.1');
check('纯小数结尾补零裁剪', conv('0.50', 10, 2).value, '0.1');
check('被截断时标记 rounded', conv('0.1', 10, 2).rounded, true);
check('能精确表示时不标记 rounded', conv('0.5', 10, 2).rounded, false);
check('精度 0 时丢弃小数', conv('3.75', 10, 2, { precision: 0 }).value, '11');

console.log('--- 分组显示 ---');
check('二进制每 4 位一组', M.groupDigits('11111111', 4), '1111 1111');
check('十进制每 3 位一组', M.groupDigits('1234567', 3), '1 234 567');
check('负数分组', M.groupDigits('-1234567', 3), '-1 234 567');
check('带小数只分组整数部分', M.groupDigits('1234567.89', 3), '1 234 567.89');

console.log('--- 错误处理 ---');
const bad = [
  ['字符不属于该进制', '2', 2],
  ['十六进制里的 g', 'g', 16],
  ['小数点过多', '1.2.3', 10],
  ['空输入', '   ', 10],
];
for (const [label, input, from] of bad) {
  check(`拒绝：${label}`, conv(input, from, 10).ok, false);
}
check('进制超范围被拒', M.convert('1', { from: 1, to: 10, precision: 4, uppercase: false, group: 0, prefix: false }).ok, false);
check('进制上界 36 可用', M.convert('1', { from: 36, to: 10, precision: 4, uppercase: false, group: 0, prefix: false }).ok, true);
check('小数位数超范围被拒', M.convert('1', { from: 10, to: 2, precision: 99, uppercase: false, group: 0, prefix: false }).ok, false);

console.log('--- 全进制往返（整数）---');
let roundTripOk = true;
const samples = ['0', '1', '42', '1000', '4294967295', '123456789012345678901234567890'];
for (const sample of samples) {
  for (let radix = 2; radix <= 36; radix += 1) {
    const there = conv(sample, 10, radix);
    if (!there.ok) {
      roundTripOk = false;
      console.log(`  ${sample} → ${radix} 进制失败: ${there.error}`);
      continue;
    }
    const back = conv(there.value, radix, 10);
    if (!back.ok || back.value !== sample) {
      roundTripOk = false;
      console.log(`  ${sample} → ${radix} → ${back.value} 不一致`);
    }
  }
}
check('2–36 进制整数往返一致', roundTripOk, true);

console.log('--- convertAll 对照 ---');
const all = M.convertAll('255', 10, 8);
check('对照包含 4 个进制', all.length, 4);
check('二进制值', all[0].value, '11111111');
check('十六进制值（大写）', all[3].value, 'FF');

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
