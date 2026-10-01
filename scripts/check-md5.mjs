/**
 * Correctness check for the hand-written MD5 (RFC 1321).
 *
 * MD5 is implemented from scratch because Web Crypto omits it, so it needs
 * independent verification. Vectors are the official RFC 1321 test suite plus
 * UTF-8 cases (including an astral-plane emoji) baselined against Node's
 * `crypto` module.
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
const { md5Hex } = await import(
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

console.log(`\n${passed}/${VECTORS.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
