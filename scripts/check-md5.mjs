/**
 * Correctness check for the hand-written MD5 (RFC 1321).
 *
 * MD5 is implemented from scratch because Web Crypto omits it, so it needs
 * independent verification. Vectors are the official RFC 1321 test suite plus
 * UTF-8 cases (including an astral-plane emoji) baselined against Node's
 * `crypto` module.
 *
 * The SHA-1 / SHA-256 / SHA-384 / SHA-512 rows are the platform's own Web Crypto
 * output, and are compared against **Node's `crypto` module** — a different
 * implementation from the one the browser runs, so agreement is evidence rather
 * than a tautology. The four published "abc" and empty-string digests are
 * included as fixed points; they are also re-derived from `node:crypto` at run
 * time, so a mistyped literal fails loudly instead of silently becoming the
 * expected value.
 *
 * Usage: node scripts/check-md5.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// `typescript` is a direct dev dependency, so require() can resolve it; this
// avoids adding a bundler just to strip type annotations for a check script.
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/md5-generator/hashUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { md5Hex, subtleHash } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

const VECTORS = [
  // --- RFC 1321, appendix A.5 ---
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'd174ab98d277d9f5a5611c2c9f419d9f',
  ],
  [
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
  // --- UTF-8 paths (baselined against node:crypto) ---
  ['中文', 'a7bac2239fcdcb3a067903d8077c4a07'],
  ['😀', '2a02eac39d716a70ecf37579185927b6'],
  ['wheat tools', 'cfb1edc76c773504bf933e9a9232c1cc'],
  // --- length boundaries: padding must round up to the next 512-bit block ---
  ['a'.repeat(55), null],
  ['a'.repeat(56), null],
  ['a'.repeat(64), null],
  ['a'.repeat(1000), 'cabe45dcc9ae5b66ba86600cca6b8ba8'],
];

let passed = 0;
let failed = 0;

/**
 * Asserts deep equality and reports it in the same shape as the MD5 vectors
 * below, so the whole file reads as one report.
 */
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

for (const [input, expected] of VECTORS) {
  const actual = md5Hex(input);
  const label = JSON.stringify(
    input.length > 24 ? `${input.slice(0, 24)}…(${input.length} chars)` : input,
  ).padEnd(40);

  if (expected === null) {
    // Boundary cases are diffed against node:crypto at runtime.
    const { createHash } = await import('node:crypto');
    const reference = createHash('md5').update(input, 'utf8').digest('hex');
    if (actual === reference) {
      passed += 1;
      console.log(`PASS  ${label} ${actual}  (matches node:crypto)`);
    } else {
      failed += 1;
      console.log(`FAIL  ${label} ${actual}  expected ${reference}`);
    }
    continue;
  }

  if (actual === expected) {
    passed += 1;
    console.log(`PASS  ${label} ${actual}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label} ${actual}  expected ${expected}`);
  }
}


console.log('\n--- 平台算法（SHA-1/256/384/512）以 node:crypto 为参照 ---');
{
  const { createHash } = await import('node:crypto');

  // Published digests for the two canonical inputs. Kept as fixed points so a
  // broken platform call cannot define its own correctness.
  const PUBLISHED = {
    'SHA-1': {
      '': 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      abc: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    },
    'SHA-256': {
      '': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      abc: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    },
    'SHA-384': {
      '': '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
      abc: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    },
    'SHA-512': {
      '': 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
      abc: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    },
  };

  const ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
  const nodeName = { 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512' };

  let publishedOk = true;
  let literalBad = [];
  for (const algorithm of ALGORITHMS) {
    for (const input of ['', 'abc']) {
      // Confirm the literal against node:crypto first: if the two disagree, the
      // literal is what is wrong, and saying so beats a confusing mismatch.
      const derived = createHash(nodeName[algorithm]).update(input, 'utf8').digest('hex');
      if (derived !== PUBLISHED[algorithm][input]) {
        literalBad.push(`${algorithm}(${JSON.stringify(input)}) 字面值 ${PUBLISHED[algorithm][input]} 与 node:crypto ${derived} 不符`);
        publishedOk = false;
      }
      const actual = (await subtleHash(algorithm, input)).hex;
      if (actual !== PUBLISHED[algorithm][input]) {
        publishedOk = false;
        literalBad.push(`${algorithm}(${JSON.stringify(input)}) 得到 ${actual}`);
      }
    }
  }
  check('四个算法在 "" 与 "abc" 上与公布值一致', literalBad, []);

  // Broad agreement with a different implementation.
  const inputs = [
    'a', 'message digest', 'abcdefghijklmnopqrstuvwxyz',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    '1234567890'.repeat(8),
    '中文测试', '😀🎉', 'Ünïcödé', 'a'.repeat(55), 'a'.repeat(56),
    'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(111),
    'a'.repeat(112), 'a'.repeat(127), 'a'.repeat(128), 'a'.repeat(129),
    'a'.repeat(1000), '\n\t\r', '"quoted"', '<tag>&amp;',
  ];
  const mismatches = [];
  for (const algorithm of ALGORITHMS) {
    for (const input of inputs) {
      const expected = createHash(nodeName[algorithm]).update(input, 'utf8').digest('hex');
      const actual = (await subtleHash(algorithm, input)).hex;
      if (actual !== expected) {
        mismatches.push(`${algorithm}(${JSON.stringify(input.slice(0, 20))}) 得到 ${actual}，node 得到 ${expected}`);
      }
    }
  }
  check(
    `4 个算法 × ${inputs.length} 个输入（含长度边界 55/56/63/64/65/111/112/127/128/129）与 node:crypto 完全一致`,
    mismatches,
    [],
  );

  // Digest lengths, so a truncated digest cannot pass by accident.
  const lengths = { 'SHA-1': 40, 'SHA-256': 64, 'SHA-384': 96, 'SHA-512': 128 };
  const wrongLength = [];
  for (const algorithm of ALGORITHMS) {
    const result = await subtleHash(algorithm, 'length check');
    if (result.hex.length !== lengths[algorithm]) {
      wrongLength.push(`${algorithm}: ${result.hex.length} 位，应为 ${lengths[algorithm]}`);
    }
  }
  check('摘要长度与算法匹配', wrongLength, []);

  // The other representations must be the same bytes.
  const base64Mismatch = [];
  for (const algorithm of ALGORITHMS) {
    const result = await subtleHash(algorithm, 'representations');
    const fromHex = Buffer.from(result.hex, 'hex').toString('base64');
    const fromBase64 = Buffer.from(result.base64, 'base64').toString('hex');
    if (fromHex !== result.base64) base64Mismatch.push(`${algorithm}: base64 ${result.base64} != ${fromHex}`);
    if (fromBase64 !== result.hex) base64Mismatch.push(`${algorithm}: hex ${result.hex} != ${fromBase64}`);
  }
  check('hex 与 Base64 是同一份字节的两种表示', base64Mismatch, []);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
