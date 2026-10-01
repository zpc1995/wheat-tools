/**
 * Correctness checks for the Base64 helpers.
 *
 * The interesting cases are the ones `btoa`/`atob` get wrong on their own:
 * non-Latin-1 text, URL-safe alphabets, missing padding, and content sniffing.
 *
 * Usage: node scripts/check-base64.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync(
  'src/tools/base64-converter/base64Utils.ts',
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const { encodeBase64, decodeBase64, classify, detectMime } = await import(
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

const STD = { alphabet: 'standard', padding: true };
const URL_ = { alphabet: 'url', padding: false };

console.log('--- 编码（对照 node Buffer）---');
const encCases = ['', 'a', 'ab', 'abc', 'hello world', '中文', '😀 混合 émoji', 'line1\nline2'];
for (const text of encCases) {
  const expected = Buffer.from(text, 'utf8').toString('base64');
  check(`encode ${JSON.stringify(text).slice(0, 22)}`, encodeBase64(text, STD), expected);
}

console.log('\n--- 变体 ---');
check('URL-safe 无填充', encodeBase64('??>>??>>', URL_), Buffer.from('??>>??>>').toString('base64url'));
check('标准带填充保留 =', encodeBase64('a', STD), 'YQ==');
check('无填充去掉 =', encodeBase64('a', { alphabet: 'standard', padding: false }), 'YQ');

console.log('\n--- 解码 ---');
check('解码 ASCII', decodeBase64('aGVsbG8=').text, 'hello');
check('解码中文', decodeBase64('5Lit5paH').text, '中文');
check('解码 emoji', decodeBase64(Buffer.from('😀', 'utf8').toString('base64')).text, '😀');
check('无填充可解码', decodeBase64('5Lit5paH').ok, true);
check('URL-safe 可解码', decodeBase64(Buffer.from('??>>??>>').toString('base64url')).text, '??>>??>>');
check('含换行可解码', decodeBase64('aGVs\nbG8=').ok, true);
check('被识别为 url 字母表', decodeBase64('a-b_').alphabet, 'url');
check('非法字符被拒', decodeBase64('not base64!!!').ok, false);
check('空输入解码为零字节', decodeBase64('   ').ok && decodeBase64('   ').bytes.length === 0, true);
check('长度为 1 mod 4 被拒', decodeBase64('abcde').ok, false);

console.log('\n--- 内容识别 ---');
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const pngDecoded = decodeBase64(png.toString('base64'));
check('PNG 识别', detectMime(pngDecoded.bytes), 'image/png');
check('PNG 归类为 image', classify(pngDecoded.bytes, pngDecoded.text), 'image');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
check('JPEG 识别', detectMime(decodeBase64(jpeg.toString('base64')).bytes), 'image/jpeg');

const jsonText = '{"a":[1,2,3]}';
const jsonDecoded = decodeBase64(Buffer.from(jsonText, 'utf8').toString('base64'));
check('JSON 归类', classify(jsonDecoded.bytes, jsonDecoded.text), 'json');

const plain = decodeBase64(Buffer.from('just text', 'utf8').toString('base64'));
check('纯文本归类', classify(plain.bytes, plain.text), 'text');

const binary = decodeBase64(Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x01]).toString('base64'));
check('非法 UTF-8 归类为 binary', classify(binary.bytes, binary.text), 'binary');
check('非法 UTF-8 时 text 为 null', binary.text, null);

check('空内容归类', classify(new Uint8Array(0), ''), 'empty');

console.log('\n--- 往返一致性 ---');
let roundTripOk = true;
for (const text of [...encCases, '空格 与\n换行\t制表', '𝄞 音乐符号']) {
  const encoded = encodeBase64(text, STD);
  const decoded = decodeBase64(encoded);
  if (!decoded.ok || decoded.text !== text) {
    roundTripOk = false;
    console.log(`  往返失败: ${JSON.stringify(text)} → ${JSON.stringify(decoded.text)}`);
  }
}
check('全部往返一致', roundTripOk, true);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
