/**
 * Correctness checks for the OTP generator.
 *
 * The authoritative references are the IETF documents themselves, transcribed
 * from the RFC text:
 *
 *   - RFC 4226 Appendix D: the HOTP vectors for the ASCII secret
 *     "12345678901234567890". Both intermediate tables are asserted — the raw
 *     HMAC-SHA-1 digest for each counter, and the truncated 31-bit value in
 *     hexadecimal and decimal — so a failure names the step that is wrong
 *     instead of only reporting a mismatched six-digit code. Section 5.4's
 *     worked dynamic-truncation example is asserted the same way.
 *   - RFC 6238 Appendix B: all 18 TOTP vectors (6 timestamps times 3 hash
 *     functions), including the counter value each timestamp maps to.
 *   - RFC 4648 section 10: the Base32 vectors, plus the
 *     "Hello! 0xDE 0xAD 0xBE 0xEF" example that the widely used
 *     JBSWY3DPEHPK3PXP demo secret is the encoding of.
 *
 * Everything the RFCs do not cover is cross-checked against node:crypto, an
 * implementation that shares no code with this tool: every digest, and a few
 * hundred pseudo-random (algorithm, digits, counter, secret) combinations, are
 * recomputed there and must agree.
 *
 * Several counter-examples are included on purpose, each shown to disagree with
 * the published vectors:
 *
 *   - reading the truncation offset from byte 19 rather than the last byte is
 *     correct for SHA-1 and wrong for SHA-256 and SHA-512;
 *   - omitting the 0x7f mask turns the 31-bit value negative and changes the
 *     modulo result;
 *   - encoding the counter little-endian agrees for counter 0 and diverges for
 *     every other counter;
 *   - dropping the zero padding loses a digit on RFC 6238's own 07081804;
 *   - "helpfully" mapping the confusable Base32 characters 0, 1, 8 and 9 onto
 *     O, I, B and g would silently accept a typo as a valid secret.
 *
 * Usage: node scripts/check-otp-generator.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

if (typeof globalThis.crypto?.subtle !== 'object') {
  throw new Error('本检查需要 Node 的 WebCrypto（globalThis.crypto.subtle）');
}

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/otp-generator/otpUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/otp-generator.mjs', compiled);
const M = await import(pathToFileURL('.verify/otp-generator.mjs').href);

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
function checkTrue(label, value) {
  check(label, Boolean(value), true);
}

/* ---------- independent helpers: node:crypto is the second implementation ---------- */

const NODE_HASH = { 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-512': 'sha512' };

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function asciiBytes(text) {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/** The 8-byte big-endian counter, built with Buffer rather than by hand. */
function counterMessage(counter, littleEndian = false) {
  const buffer = Buffer.alloc(8);
  if (littleEndian) buffer.writeBigUInt64LE(BigInt(counter));
  else buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

/**
 * An independent HOTP implementation, written straight from RFC 4226 section
 * 5.3 and using node:crypto for the HMAC. This is the oracle the shipped code
 * is compared against, not a copy of it.
 */
function nodeHotp(secretBytes, counter, algorithm, digits, littleEndian = false) {
  const digest = createHmac(NODE_HASH[algorithm], Buffer.from(secretBytes))
    .update(counterMessage(counter, littleEndian))
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return {
    digest,
    offset,
    binary,
    code: String(binary % 10 ** digits).padStart(digits, '0'),
  };
}

function nodeTotp(secretBytes, timeSeconds, algorithm, digits, period = 30) {
  return nodeHotp(secretBytes, Math.floor(timeSeconds / period), algorithm, digits);
}

/** Naive truncation that keeps RFC 4226's literal byte 19 for every hash. */
function offsetAtByte19(digest, digits) {
  const offset = digest[19] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Naive truncation that forgets to mask the top bit away. */
function signedTruncate(digest, digits) {
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    (digest[offset] << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits);
}

/* ---------- RFC 4226 Appendix D ---------- */

const RFC4226_SECRET = '12345678901234567890';
const RFC4226_SEED = asciiBytes(RFC4226_SECRET);

const RFC4226 = [
  { counter: 0, digest: 'cc93cf18508d94934c64b65d8ba7667fb7cde4b0', offset: 0, binary: 0x4c93cf18, decimal: 1284755224, code: '755224' },
  { counter: 1, digest: '75a48a19d4cbe100644e8ac1397eea747a2d33ab', offset: 11, binary: 0x41397eea, decimal: 1094287082, code: '287082' },
  { counter: 2, digest: '0bacb7fa082fef30782211938bc1c5e70416ff44', offset: 4, binary: 0x082fef30, decimal: 137359152, code: '359152' },
  { counter: 3, digest: '66c28227d03a2d5529262ff016a1e6ef76557ece', offset: 14, binary: 0x66ef7655, decimal: 1726969429, code: '969429' },
  { counter: 4, digest: 'a904c900a64b35909874b33e61c5938a8e15ed1c', offset: 12, binary: 0x61c5938a, decimal: 1640338314, code: '338314' },
  { counter: 5, digest: 'a37e783d7b7233c083d4f62926c7a25f238d0316', offset: 6, binary: 0x33c083d4, decimal: 868254676, code: '254676' },
  { counter: 6, digest: 'bc9cd28561042c83f219324d3c607256c03272ae', offset: 14, binary: 0x7256c032, decimal: 1918287922, code: '287922' },
  { counter: 7, digest: 'a4fb960c0bc06e1eabb804e5b397cdc4b45596fa', offset: 10, binary: 0x04e5b397, decimal: 82162583, code: '162583' },
  { counter: 8, digest: '1b3c89f65e6c9e883012052823443f048b4332db', offset: 11, binary: 0x2823443f, decimal: 673399871, code: '399871' },
  { counter: 9, digest: '1637409809a679dc698207310c8c7fc07290d9e5', offset: 5, binary: 0x2679dc69, decimal: 645520489, code: '520489' },
];

/* ---------- RFC 6238 Appendix B ---------- */

/** The three seeds, in the hex form RFC 6238 Appendix A prints for them. */
const RFC6238_SEED_HEX = {
  'SHA-1': '3132333435363738393031323334353637383930',
  'SHA-256': '3132333435363738393031323334353637383930313233343536373839303132',
  'SHA-512':
    '31323334353637383930313233343536373839303132333435363738393031323334353637383930313233343536373839' +
    '303132333435363738393031323334',
};

/**
 * The same seeds as Base32, which is how an `otpauth` secret arrives. They are
 * constants rather than encoded here so the decoder is exercised on real input;
 * the assertion below ties each one back to the hex form the RFC prints.
 */
const RFC6238_SEED_BASE32 = {
  'SHA-1': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  'SHA-256': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====',
  'SHA-512':
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=',
};

const RFC6238 = [
  { time: 59, counter: 1, 'SHA-1': '94287082', 'SHA-256': '46119246', 'SHA-512': '90693936' },
  { time: 1111111109, counter: 0x23523ec, 'SHA-1': '07081804', 'SHA-256': '68084774', 'SHA-512': '25091201' },
  { time: 1111111111, counter: 0x23523ed, 'SHA-1': '14050471', 'SHA-256': '67062674', 'SHA-512': '99943326' },
  { time: 1234567890, counter: 0x273ef07, 'SHA-1': '89005924', 'SHA-256': '91819424', 'SHA-512': '93441116' },
  { time: 2000000000, counter: 0x3f940aa, 'SHA-1': '69279037', 'SHA-256': '90698825', 'SHA-512': '38618901' },
  { time: 20000000000, counter: 0x27bc86aa, 'SHA-1': '65353130', 'SHA-256': '77737706', 'SHA-512': '47863826' },
];

const ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'];

/* ================= 1. Base32（RFC 4648 第 10 节） ================= */

console.log('--- Base32 解码（RFC 4648 第 10 节官方向量） ---');

const RFC4648 = [
  ['', ''],
  ['f', 'MY======'],
  ['fo', 'MZXQ===='],
  ['foo', 'MZXW6==='],
  ['foob', 'MZXW6YQ='],
  ['fooba', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI======'],
];

for (const [plain, encoded] of RFC4648) {
  const decoded = M.decodeBase32(encoded);
  check(`解码 Base32("${plain}") = "${encoded}"`, bytesToHex(decoded.bytes), bytesToHex(asciiBytes(plain)));
  check(`规范化去掉尾部填充："${encoded}"`, decoded.normalized, encoded.replace(/=+$/, ''));
  check(`重新编码 "${plain}" 得到官方形式`, M.encodeBase32(asciiBytes(plain)), encoded);
}

{
  // The example every authenticator tutorial uses: the demo secret that apps
  // print is the Base32 of "Hello!" plus four high bytes.
  const greeting = Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]);
  const decoded = M.decodeBase32('JBSWY3DPEHPK3PXP');
  check('JBSWY3DPEHPK3PXP 解码为 Hello! 加 0xDEADBEEF', bytesToHex(decoded.bytes), bytesToHex(greeting));
  check('并编码回同一个字符串', M.encodeBase32(greeting), 'JBSWY3DPEHPK3PXP');
  check('得到 10 字节 / 80 位', decoded.bytes.length, 10);
}

console.log('--- Base32 规范化：大写、空格、连字符、填充 ---');
{
  const expected = bytesToHex(M.decodeBase32('JBSWY3DPEHPK3PXP').bytes);
  check('小写', bytesToHex(M.decodeBase32('jbswy3dpehpk3pxp').bytes), expected);
  check('分组空格', bytesToHex(M.decodeBase32('JBSW Y3DP EHPK 3PXP').bytes), expected);
  check('制表与换行', bytesToHex(M.decodeBase32(' JBSW\tY3DP\nEHPK 3PXP ').bytes), expected);
  check('连字符分组', bytesToHex(M.decodeBase32('JBSW-Y3DP-EHPK-3PXP').bytes), expected);
  check('规范化结果统一为大写无空格', M.decodeBase32(' jbsw y3dp ehpk 3pxp ').normalized, 'JBSWY3DPEHPK3PXP');
  check('带填充的密钥', bytesToHex(M.decodeBase32('MZXW6===').bytes), bytesToHex(asciiBytes('foo')));
  check('规范化去掉填充', M.decodeBase32('MZXW6===').normalized, 'MZXW6');
  check('空字符串是合法的空密钥', M.decodeBase32('').ok, true);
  check('空字符串解码为 0 字节', M.decodeBase32('').bytes.length, 0);
}

console.log('--- Base32 拒绝非法输入 ---');
{
  // 0, 1, 8 and 9 are deliberately absent from the RFC 4648 alphabet because
  // they resemble O, I, B and g. Mapping them back would turn a typo into a
  // valid-looking secret.
  for (const bad of ['0', '1', '8', '9']) {
    const result = M.decodeBase32(`JBSWY3DP${bad}HPK3PXP`);
    check(`拒绝字母表外的字符「${bad}」`, result.ok, false);
    checkTrue(`「${bad}」的错误信息里点名该字符`, result.error.includes(bad));
  }
  check('拒绝 8n+1 长度（余 1）', M.decodeBase32('A').ok, false);
  check('拒绝 8n+3 长度（余 3）', M.decodeBase32('ABC').ok, false);
  check('拒绝 8n+6 长度（余 6）', M.decodeBase32('ABCDEF').ok, false);
  check('接受余 2 的长度', M.decodeBase32('AB').bytes.length, 1);
  check('接受余 4 的长度', M.decodeBase32('ABCD').bytes.length, 2);
  check('接受余 5 的长度', M.decodeBase32('ABCDE').bytes.length, 3);
  check('接受余 7 的长度', M.decodeBase32('ABCDEFG').bytes.length, 4);
  check('拒绝非 Base32 的标点', M.decodeBase32('JBSW!3DP').ok, false);
  check('拒绝中文', M.decodeBase32('密钥').ok, false);
  check('拒绝 emoji', M.decodeBase32('JBSW😀').ok, false);
  // The counter-example: a "forgiving" decoder that folds 0/1/8/9 onto letters
  // would accept this and silently produce wrong codes forever.
  const forgivingAccepts = /^[A-Z2-7]+$/.test('JBSWY3DP1HPK3PXP'.replace(/[0189]/g, 'X'));
  checkTrue('反例：宽容映射会把 1 当成合法字符接受', forgivingAccepts);
  check('本实现拒绝它', M.decodeBase32('JBSWY3DP1HPK3PXP').ok, false);
}

/* ================= 2. RFC 4226 附录 D ================= */

console.log('--- RFC 4226 附录 D：HOTP 中间值与 6 位验证码 ---');
{
  const seedsMatch = M.decodeBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  check('HOTP 种子 Base32 解码为 ASCII 12345678901234567890', bytesToHex(seedsMatch.bytes), bytesToHex(RFC4226_SEED));

  for (const vector of RFC4226) {
    const trace = await M.hotpTrace(RFC4226_SEED, vector.counter, 'SHA-1', 6);
    check(`计数器 ${vector.counter} 的 HMAC-SHA-1 摘要`, trace.digestHex, vector.digest);
    check(`计数器 ${vector.counter} 的 8 字节大端计数器`, trace.counterHex, vector.counter.toString(16).padStart(16, '0'));
    check(`计数器 ${vector.counter} 的截断偏移`, trace.offset, vector.offset);
    check(`计数器 ${vector.counter} 的 31 位整数（hex）`, trace.binary, vector.binary);
    check(`计数器 ${vector.counter} 的 31 位整数（十进制）`, trace.binary, vector.decimal);
    check(`计数器 ${vector.counter} 的 HOTP`, trace.code, vector.code);
    checkTrue(`计数器 ${vector.counter} 的 31 位整数最高位为 0`, trace.binary <= 0x7fffffff);

    const oracle = nodeHotp(RFC4226_SEED, vector.counter, 'SHA-1', 6);
    check(`node:crypto 复算计数器 ${vector.counter} 的摘要`, bytesToHex(oracle.digest), vector.digest);
    check(`node:crypto 复算计数器 ${vector.counter} 的 HOTP`, oracle.code, vector.code);
  }
}

console.log('--- RFC 4226 第 5.4 节：动态截断的完整算例 ---');
{
  const digest = hexToBytes('1f8698690e02ca16618550ef7f19da8e945b555a');
  const result = M.dynamicTruncate(digest, 6);
  check('末字节 0x5a 的低 4 位给出偏移 10', result.offset, 10);
  check('从偏移 10 取 4 字节并屏蔽最高位 = 0x50ef7f19', result.binary, 0x50ef7f19);
  check('对 10 的 6 次方取模得到 872921', result.code, '872921');
  check('31 位整数的十进制值', result.binary, 1357872921);
}

/* ================= 3. RFC 6238 附录 B ================= */

console.log('--- RFC 6238 附录 B：全部 18 条 TOTP 官方向量 ---');
{
  for (const algorithm of ALGORITHMS) {
    const decoded = M.decodeBase32(RFC6238_SEED_BASE32[algorithm]);
    check(`${algorithm} 的种子 Base32 解码回 RFC 的十六进制种子`, bytesToHex(decoded.bytes), RFC6238_SEED_HEX[algorithm]);
    check(`${algorithm} 种子长度`, decoded.bytes.length, { 'SHA-1': 20, 'SHA-256': 32, 'SHA-512': 64 }[algorithm]);
  }

  for (const vector of RFC6238) {
    for (const algorithm of ALGORITHMS) {
      const secret = M.decodeBase32(RFC6238_SEED_BASE32[algorithm]).bytes;
      const outcome = await M.generateTotp(secret, vector.time * 1000, algorithm, 8, 30);
      checkTrue(`${algorithm} @ ${vector.time}s 生成成功`, outcome.ok);
      check(`${algorithm} @ ${vector.time}s 的 TOTP`, outcome.state.code, vector[algorithm]);
      check(`${algorithm} @ ${vector.time}s 的计数器`, outcome.state.counter, vector.counter);
      check(
        `${algorithm} @ ${vector.time}s 的计数器十六进制`,
        M.counterToHex(outcome.state.counter),
        vector.counter.toString(16).padStart(16, '0'),
      );
      const oracle = nodeTotp(hexToBytes(RFC6238_SEED_HEX[algorithm]), vector.time, algorithm, 8);
      check(`node:crypto 复算 ${algorithm} @ ${vector.time}s`, oracle.code, vector[algorithm]);
    }
  }
}

/* ================= 4. 动态截断的细节与反例 ================= */

console.log('--- 动态截断：掩码、偏移来源、字节序的反例 ---');
{
  // Offset comes from the last byte, not from the literal 19 that the RFC's
  // SHA-1-specific reference code uses.
  let sha1Mismatch = 0;
  let sha2Mismatch = 0;
  for (const vector of RFC6238) {
    for (const algorithm of ALGORITHMS) {
      const digest = nodeTotp(hexToBytes(RFC6238_SEED_HEX[algorithm]), vector.time, algorithm, 8).digest;
      const naive = offsetAtByte19(digest, 8);
      if (naive !== vector[algorithm]) {
        if (algorithm === 'SHA-1') sha1Mismatch += 1;
        else sha2Mismatch += 1;
      }
    }
  }
  check('反例：硬编码 byte 19 对 SHA-1 恰好全部碰对', sha1Mismatch, 0);
  checkTrue('反例：硬编码 byte 19 对 SHA-256/512 会算错（12 条里至少错一条）', sha2Mismatch > 0);
  check('反例：SHA-256/512 的 12 条向量全部被算错', sha2Mismatch, 12);

  // Omitting the 0x7f mask. Some counter in a small range must have the top bit
  // set, otherwise this counter-example would prove nothing.
  let highBitCases = 0;
  let signedMismatch = 0;
  let firstHighBitCounter = -1;
  for (let counter = 0; counter < 500; counter += 1) {
    const oracle = nodeHotp(RFC4226_SEED, counter, 'SHA-1', 6);
    if ((oracle.digest[oracle.offset] & 0x80) !== 0) {
      highBitCases += 1;
      if (firstHighBitCounter < 0) firstHighBitCounter = counter;
      if (signedTruncate(oracle.digest, 6) !== oracle.code) signedMismatch += 1;
    }
  }
  checkTrue('计数器 0-499 里存在最高位为 1 的截断窗口', highBitCases > 0);
  check('反例：这些计数器上忘记屏蔽最高位就会算错', signedMismatch, highBitCases);
  checkTrue(
    '且结果是负数而不是仅仅不同',
    signedTruncate(nodeHotp(RFC4226_SEED, firstHighBitCounter, 'SHA-1', 6).digest, 6).startsWith('-'),
  );

  // Little-endian counter.
  let littleEndianMismatch = 0;
  for (const vector of RFC4226) {
    const oracle = nodeHotp(RFC4226_SEED, vector.counter, 'SHA-1', 6, true);
    if (oracle.code !== vector.code) littleEndianMismatch += 1;
  }
  check('反例：小端计数器在计数器 0 上与官方值一致', nodeHotp(RFC4226_SEED, 0, 'SHA-1', 6, true).code, '755224');
  check('反例：小端计数器在 1-9 上全部与官方值不同', littleEndianMismatch, 9);

  // Zero padding.
  const zeroPadded = nodeTotp(hexToBytes(RFC6238_SEED_HEX['SHA-1']), 1111111109, 'SHA-1', 8);
  check('官方向量里确实有前导零（07081804）', zeroPadded.code, '07081804');
  check('反例：不补零就只剩 7 位', String(zeroPadded.binary % 10 ** 8), '7081804');
}

console.log('--- 计数器编码：8 字节大端，不做 32 位截断 ---');
{
  check('计数器 0', M.counterToHex(0), '0000000000000000');
  check('计数器 1', M.counterToHex(1), '0000000000000001');
  check('计数器 255', M.counterToHex(255), '00000000000000ff');
  check('计数器 256', M.counterToHex(256), '0000000000000100');
  check('计数器 2^32（小数一位都不能丢）', M.counterToHex(2 ** 32), '0000000100000000');
  check('计数器 2^32 的结果与 node:crypto 一致', (await M.hotpTrace(RFC4226_SEED, 2 ** 32, 'SHA-1', 6)).code, nodeHotp(RFC4226_SEED, 2 ** 32, 'SHA-1', 6).code);
  check('计数器 2^53-1', M.counterToHex(Number.MAX_SAFE_INTEGER), '001fffffffffffff');
  check(
    '计数器 2^53-1 的结果与 node:crypto 一致',
    (await M.hotpTrace(RFC4226_SEED, Number.MAX_SAFE_INTEGER, 'SHA-1', 6)).code,
    nodeHotp(RFC4226_SEED, Number.MAX_SAFE_INTEGER, 'SHA-1', 6).code,
  );
  check('字节序确实是大端（首字节在高位）', Array.from(M.counterToBytes(0x0102030405)).join(','), '0,0,0,1,2,3,4,5');
}

console.log('--- 动态截断对过短的摘要会报错，而不是读到越界字节 ---');
{
  let threw = false;
  try {
    M.dynamicTruncate(new Uint8Array(18), 6);
  } catch {
    threw = true;
  }
  check('18 字节摘要被拒绝', threw, true);
}

/* ================= 5. otpauth URI 解析 ================= */

console.log('--- otpauth:// URI 解析 ---');
{
  const sample =
    'otpauth://totp/Wheat%20Tools:demo%40example.com?secret=jbswy3dpehpk3pxp' +
    '&issuer=Wheat%20Tools&algorithm=SHA256&digits=8&period=60&image=https%3A%2F%2Fexample.com%2Fq.png';
  const outcome = M.parseOtpAuthUri(sample);
  checkTrue('示例 URI 解析成功', outcome.ok);
  check('类型', outcome.config.type, 'totp');
  check('签发方来自 issuer 参数', outcome.config.issuer, 'Wheat Tools');
  check('账号来自路径的 Issuer:account 后缀', outcome.config.label, 'demo@example.com');
  check('密钥被规范化为大写并去掉填充', outcome.config.secret, 'JBSWY3DPEHPK3PXP');
  check('密钥字节数', outcome.config.secretBytes, 10);
  check('算法', outcome.config.algorithm, 'SHA-256');
  check('位数', outcome.config.digits, 8);
  check('周期', outcome.config.periodSeconds, 60);
  check('未知参数被列出', outcome.config.ignoredParams, ['image']);

  const repeated = M.parseOtpAuthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&image=1&image=2');
  check('重复的未知参数只列一次', repeated.config.ignoredParams, ['image']);
  const repeatedSecret = M.parseOtpAuthUri('otpauth://totp/a?secret=MZXW6YTB&secret=JBSWY3DPEHPK3PXP');
  check('重复的 secret 取第一个（与主流解析器一致）', repeatedSecret.config.secretBytes, 5);
  checkTrue('非默认参数组合给出提示', outcome.config.warnings.some((w) => w.includes('Google Authenticator')));

  const defaults = M.parseOtpAuthUri('otpauth://totp/Acme:alice?secret=JBSWY3DPEHPK3PXP');
  checkTrue('只给 secret 时解析成功', defaults.ok);
  check('算法默认 SHA-1', defaults.config.algorithm, 'SHA-1');
  check('位数默认 6', defaults.config.digits, 6);
  check('周期默认 30 秒', defaults.config.periodSeconds, 30);
  check('计数器对 TOTP 是 0', defaults.config.counter, 0);
  check('issuer 回退到标签前缀', defaults.config.issuer, 'Acme');
  check('标签去掉前缀', defaults.config.label, 'alice');
  check('默认参数组合没有额外提示', defaults.config.warnings, []);

  const parameterWins = M.parseOtpAuthUri('otpauth://totp/Acme:alice?secret=JBSWY3DPEHPK3PXP&issuer=Other');
  check('issuer 参数优先于标签前缀', parameterWins.config.issuer, 'Other');
  check('标签仍然只去掉前缀', parameterWins.config.label, 'alice');

  const hotp = M.parseOtpAuthUri('otpauth://hotp/Acme:alice?secret=JBSWY3DPEHPK3PXP&counter=42');
  checkTrue('HOTP URI 解析成功', hotp.ok);
  check('类型', hotp.config.type, 'hotp');
  check('计数器', hotp.config.counter, 42);

  const upper = M.parseOtpAuthUri('OTPAUTH://TOTP/Acme:alice?Secret=JBSWY3DPEHPK3PXP&Algorithm=sha-256&DIGITS=8&Period=45');
  checkTrue('大写协议名与参数名被接受', upper.ok);
  check('参数名大小写不敏感：algorithm', upper.config.algorithm, 'SHA-256');
  check('参数名大小写不敏感：digits', upper.config.digits, 8);
  check('参数名大小写不敏感：period', upper.config.periodSeconds, 45);
  check('参数值 sha-256 也接受连字符写法', upper.config.algorithm, 'SHA-256');

  check('SHA1 无连字符写法', M.parseOtpAuthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1').config.algorithm, 'SHA-1');
  check('SHA512 无连字符写法', M.parseOtpAuthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=SHA512').config.algorithm, 'SHA-512');
  check('带填充的 secret 参数被接受', M.parseOtpAuthUri('otpauth://totp/a?secret=MZXW6%3D%3D%3D').config.secretBytes, 3);

  const ignoredCounter = M.parseOtpAuthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&counter=5');
  checkTrue('TOTP 里出现 counter 时给出提示', ignoredCounter.config.warnings.some((w) => w.includes('counter')));

  const lowercaseSecret = M.parseOtpAuthUri('otpauth://totp/a?secret=jbswy3dpehpk3pxp');
  checkTrue('密钥被规范化时给出提示', lowercaseSecret.config.warnings.some((w) => w.includes('规范化')));
}

console.log('--- otpauth:// URI 的错误输入 ---');
{
  const bad = [
    ['空字符串', ''],
    ['不是 URI', 'JBSWY3DPEHPK3PXP'],
    ['协议不对', 'https://example.com/?secret=JBSWY3DPEHPK3PXP'],
    ['类型不对', 'otpauth://foo/a?secret=JBSWY3DPEHPK3PXP'],
    ['缺少 secret', 'otpauth://totp/Acme:alice'],
    ['secret 为空', 'otpauth://totp/a?secret='],
    ['secret 含非法字符', 'otpauth://totp/a?secret=JBSWY3DP1HPK3PXP'],
    ['algorithm 不支持', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=SHA224'],
    ['digits 不支持', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=7'],
    ['digits 不是数字', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=six'],
    ['period 为 0', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=0'],
    ['period 为负', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=-30'],
    ['period 不是数字', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=abc'],
    ['counter 不是数字', 'otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&counter=abc'],
    ['counter 为负', 'otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&counter=-1'],
  ];
  for (const [label, uri] of bad) {
    const outcome = M.parseOtpAuthUri(uri);
    check(`拒绝：${label}`, outcome.ok, false);
    checkTrue(`拒绝：${label} 有可读的错误信息`, typeof outcome.error === 'string' && outcome.error.length > 0);
  }

  // Parsing must not be a silent fallback to defaults: a URI that asks for an
  // algorithm we cannot do has to fail, not produce a plausible SHA-1 code.
  const fallback = M.parseOtpAuthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=SHA224');
  checkTrue('反例：不支持的 algorithm 不会被静默降级为 SHA-1', fallback.ok === false && fallback.error.includes('SHA224'));
}

/* ================= 6. 边界 ================= */

console.log('--- 时间边界 ---');
{
  const secret = M.decodeBase32('JBSWY3DPEHPK3PXP').bytes;

  const epoch = await M.generateTotp(secret, 0, 'SHA-1', 6, 30);
  checkTrue('时间 0 可以生成（对应计数器 0）', epoch.ok);
  check('时间 0 的计数器', epoch.state.counter, 0);
  check('时间 0 的验证码等于 HOTP(K, 0)', epoch.state.code, (await M.hotpTrace(secret, 0, 'SHA-1', 6)).code);
  check('时间 0 时剩余整秒等于整个周期', epoch.state.secondsRemaining, 30);
  check('时间 0 时进度环是满的', epoch.state.remainingFraction, 1);
  check('时间 0 的失效时刻是 30000ms', epoch.state.expiresAtMs, 30000);
  check('时间 0 的下一个计数器', epoch.state.nextCounter, 1);

  const lastMs = await M.generateTotp(secret, 29999, 'SHA-1', 6, 30);
  check('29999ms 仍在第 0 步', lastMs.state.counter, 0);
  check('29999ms 时只剩 1 秒', lastMs.state.secondsRemaining, 1);
  check('29999ms 的步内已用毫秒', lastMs.state.elapsedMs, 29999);

  const boundary = await M.generateTotp(secret, 30000, 'SHA-1', 6, 30);
  check('30000ms 进入第 1 步', boundary.state.counter, 1);
  check('30000ms 时剩余整秒回到 30', boundary.state.secondsRemaining, 30);
  check('30000ms 的验证码变了', boundary.state.code !== lastMs.state.code, true);

  const floorCheck = await M.generateTotp(secret, 59999, 'SHA-1', 6, 30);
  check('59999ms 是第 1 步（向下取整，不四舍五入）', floorCheck.state.counter, 1);

  const far = await M.generateTotp(secret, 20000000000 * 1000, 'SHA-1', 8, 30);
  checkTrue('公元 2603 年的时间点仍可计算（T 超过 32 位）', far.ok);
  check('远未来时间的计数器', far.state.counter, 666666666);
  check('远未来时间的计数器十六进制', M.counterToHex(far.state.counter), '0000000027bc86aa');

  // The same instant with RFC 6238's own seed, so the code itself can be tied
  // back to the published table rather than to whatever this seed happens to be.
  const farOfficial = await M.generateTotp(hexToBytes(RFC6238_SEED_HEX['SHA-1']), 20000000000 * 1000, 'SHA-1', 8, 30);
  check('远未来时间与 RFC 6238 向量一致', farOfficial.state.code, '65353130');

  const maxTime = await M.generateTotp(secret, Number.MAX_SAFE_INTEGER, 'SHA-1', 6, 30);
  checkTrue('Number.MAX_SAFE_INTEGER 毫秒仍可计算', maxTime.ok);
  check('该时刻的计数器是安全整数', Number.isSafeInteger(maxTime.state.counter), true);

  for (const [label, timeMs] of [['负数', -1], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY]]) {
    const outcome = await M.generateTotp(secret, timeMs, 'SHA-1', 6, 30);
    check(`拒绝时间 ${label}`, outcome.ok, false);
  }

  check('timeStepCounter 向下取整', M.timeStepCounter(59999, 30), 1);
  check('timeStepCounter 恰好等于步长时进位', M.timeStepCounter(60000, 30), 2);
  check('timeStepElapsedMs 在步内', M.timeStepElapsedMs(60000, 30), 0);
  check('timeStepElapsedMs 到步尾', M.timeStepElapsedMs(89999, 30), 29999);
}

console.log('--- 密钥、位数、周期、计数器的非法取值 ---');
{
  const empty = new Uint8Array(0);
  check('空密钥的 HOTP 被拒绝', (await M.generateHotp(empty, 0, 'SHA-1', 6)).ok, false);
  check('空密钥的 TOTP 被拒绝', (await M.generateTotp(empty, 0, 'SHA-1', 6, 30)).ok, false);
  checkTrue('空密钥的错误信息说明原因', (await M.generateHotp(empty, 0, 'SHA-1', 6)).error.includes('密钥为空'));

  const secret = M.decodeBase32('JBSWY3DPEHPK3PXP').bytes;
  for (const digits of [5, 7, 9, 0, -6, 6.5]) {
    check(`拒绝位数 ${digits}`, (await M.generateHotp(secret, 0, 'SHA-1', digits)).ok, false);
    check(`TOTP 也拒绝位数 ${digits}`, (await M.generateTotp(secret, 0, 'SHA-1', digits, 30)).ok, false);
  }
  check('位数 6 可用', (await M.generateHotp(secret, 0, 'SHA-1', 6)).trace.code.length, 6);
  check('位数 8 可用', (await M.generateHotp(secret, 0, 'SHA-1', 8)).trace.code.length, 8);

  for (const period of [0, -1, -30, 0.5, 86401, Number.NaN]) {
    check(`拒绝周期 ${period}`, (await M.generateTotp(secret, 0, 'SHA-1', 6, period)).ok, false);
  }
  check('周期 1 可用', (await M.generateTotp(secret, 0, 'SHA-1', 6, 1)).ok, true);
  check('周期 86400 可用', (await M.generateTotp(secret, 0, 'SHA-1', 6, 86400)).ok, true);
  check('周期 1 时 999ms 后仍剩 1 秒', (await M.generateTotp(secret, 999, 'SHA-1', 6, 1)).state.secondsRemaining, 1);
  check('周期 1 时 1000ms 进入下一步', (await M.generateTotp(secret, 1000, 'SHA-1', 6, 1)).state.counter, 1);

  for (const counter of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
    check(`拒绝计数器 ${counter}`, (await M.generateHotp(secret, counter, 'SHA-1', 6)).ok, false);
  }
  check('计数器 0 可用', (await M.generateHotp(secret, 0, 'SHA-1', 6)).ok, true);

  check('拒绝未知算法', (await M.generateHotp(secret, 0, 'SHA-384', 6)).ok, false);
}

/* ================= 7. 与 node:crypto 的随机交叉验证 ================= */

console.log('--- 与 node:crypto 的随机交叉验证 ---');
{
  // Deterministic PRNG so a failure is reproducible.
  let seed = 20240613;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let mismatches = 0;
  let rounds = 0;
  let bigCounters = 0;
  for (let i = 0; i < 300; i += 1) {
    rounds += 1;
    const algorithm = ALGORITHMS[Math.floor(rand() * ALGORITHMS.length)];
    const digits = rand() < 0.5 ? 6 : 8;
    const counter = rand() < 0.25
      ? Math.floor(rand() * Number.MAX_SAFE_INTEGER)
      : Math.floor(rand() * 100000);
    if (counter > 2 ** 32) bigCounters += 1;
    const length = 10 + Math.floor(rand() * 31);
    const secret = Uint8Array.from({ length }, () => Math.floor(rand() * 256));

    const trace = await M.hotpTrace(secret, counter, algorithm, digits);
    const oracle = nodeHotp(secret, counter, algorithm, digits);
    if (trace.digestHex !== bytesToHex(oracle.digest)) mismatches += 1;
    if (trace.offset !== oracle.offset) mismatches += 1;
    if (trace.binary !== oracle.binary) mismatches += 1;
    if (trace.code !== oracle.code) mismatches += 1;
  }
  check(`300 组随机的（算法、位数、计数器、密钥）全部与 node:crypto 一致`, mismatches, 0);
  check('随机组合确实执行了', rounds, 300);
  checkTrue('随机组合里包含超过 2^32 的计数器（证明没有 32 位截断）', bigCounters > 0);

  let totpMismatches = 0;
  let leadingZeroCodes = 0;
  for (let i = 0; i < 200; i += 1) {
    const algorithm = ALGORITHMS[Math.floor(rand() * ALGORITHMS.length)];
    const digits = rand() < 0.5 ? 6 : 8;
    const period = [1, 30, 60, 90, 3600][Math.floor(rand() * 5)];
    const timeMs = Math.floor(rand() * 4_000_000_000_000);
    const secret = Uint8Array.from({ length: 20 }, () => Math.floor(rand() * 256));

    const outcome = await M.generateTotp(secret, timeMs, algorithm, digits, period);
    const oracle = nodeHotp(secret, Math.floor(timeMs / (period * 1000)), algorithm, digits);
    if (!outcome.ok || outcome.state.code !== oracle.code) totpMismatches += 1;
    if (outcome.ok && outcome.state.counter !== Math.floor(timeMs / (period * 1000))) totpMismatches += 1;
    if (outcome.ok && outcome.state.code.startsWith('0')) leadingZeroCodes += 1;
  }
  check('200 组随机的 TOTP 全部与 node:crypto 一致', totpMismatches, 0);
  checkTrue('随机样本里出现过前导零的验证码（补零逻辑确实被用上）', leadingZeroCodes > 0);
}

/* ================= 8. 显示辅助 ================= */

console.log('--- 显示辅助函数 ---');
{
  check('6 位分组', M.formatCode('123456'), '123 456');
  check('8 位分组', M.formatCode('12345678'), '1234 5678');
  check('其它长度原样返回', M.formatCode('12345'), '12345');
  check('保留前导零', M.formatCode('07081804'), '0708 1804');
  check('剩余秒数补零', M.formatSecondsRemaining(7), '07 秒');
  check('剩余秒数 30', M.formatSecondsRemaining(30), '30 秒');
  check('算法列表', M.OTP_ALGORITHMS, ['SHA-1', 'SHA-256', 'SHA-512']);
  check('位数列表只提供 6 与 8', M.OTP_DIGITS, [6, 8]);
  check('默认周期是 RFC 推荐的 30 秒', M.DEFAULT_PERIOD_SECONDS, 30);
  check('周期上限是一天', M.MAX_PERIOD_SECONDS, 86400);
  check('周期下限是 1 秒', M.MIN_PERIOD_SECONDS, 1);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
