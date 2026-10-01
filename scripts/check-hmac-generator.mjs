/**
 * Correctness checks for the HMAC tool.
 *
 * The authoritative reference is the IETF's own test-vector documents:
 *
 *   - RFC 4231 for HMAC-SHA-256 / SHA-384 / SHA-512 (test cases 1, 2, 3, 4, 5,
 *     6 and 7, transcribed from the RFC text, not from memory).
 *   - RFC 2202 for HMAC-SHA-1, which is not covered by RFC 4231.
 *
 * Every vector is additionally recomputed with node:crypto, an implementation
 * that shares no code with this tool, so a transcription error in the table
 * would be caught rather than silently enshrined.
 *
 * The remaining sections cover the things the RFCs do not: digest length per
 * algorithm, hex and Base64 being two views of one byte string, empty message
 * and empty key, UTF-8 encoding of Chinese and emoji, hex keys versus the
 * equivalent raw bytes, and key-length boundaries around the hash block size.
 *
 * Two counter-examples are included on purpose. A "simplified" HMAC that always
 * hashes the key is shown to disagree with RFC 4231 for a short key while
 * agreeing for a long one — which is exactly why that bug survives casual
 * testing. And feeding the hex *text* of a key instead of its bytes is shown to
 * produce a different digest, which is what makes the hex-key option necessary.
 *
 * Usage: node scripts/check-hmac-generator.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Node 22 exposes a full WebCrypto implementation as `globalThis.crypto`, and
// btoa/atob have been global since Node 16. Assert instead of polyfilling, so a
// future Node that drops them fails loudly instead of testing something else.
if (typeof globalThis.crypto?.subtle !== 'object') {
  throw new Error('本检查需要 Node 的 WebCrypto（globalThis.crypto.subtle）');
}
if (typeof globalThis.btoa !== 'function' || typeof globalThis.atob !== 'function') {
  throw new Error('本检查需要全局 btoa/atob');
}

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/hmac-generator/hmacUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/hmac-generator.mjs', compiled);
const M = await import(pathToFileURL('.verify/hmac-generator.mjs').href);

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

/** Independent hex decoder, used to build vector inputs without the tool code. */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Independent oracle: node:crypto, a different implementation entirely. */
const NODE_HASH = {
  'SHA-1': 'sha1',
  'SHA-256': 'sha256',
  'SHA-384': 'sha384',
  'SHA-512': 'sha512',
};
function nodeHmac(algorithm, keyBytes, messageBytes) {
  return createHmac(NODE_HASH[algorithm], Buffer.from(keyBytes))
    .update(Buffer.from(messageBytes))
    .digest('hex');
}

/** Digest hex of a computeHmac outcome, or a readable marker on failure. */
function hexOf(outcome) {
  return outcome.ok ? outcome.result.hex : `ERR:${outcome.error}`;
}

// ---------------------------------------------------------------------------
// RFC 4231, HMAC-SHA-224/256/384/512. Cases 1-7 as published.
//
// `text` is the quoted ASCII message where the RFC gives one; `dataHex` is the
// RFC's own hex. Cases 3 and 4 use binary data (0xdd and 0xcd repeats) that is
// not valid UTF-8, so they exercise the byte-level core only — the text
// pipeline cannot represent them, and pretending otherwise would be a lie.
// ---------------------------------------------------------------------------
const RFC4231 = [
  {
    case: 1,
    keyHex: '0b'.repeat(20),
    dataHex: '4869205468657265',
    text: 'Hi There',
    tags: {
      'SHA-256': 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
      'SHA-384':
        'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
      'SHA-512':
        '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
    },
  },
  {
    case: 2,
    keyHex: '4a656665',
    dataHex: '7768617420646f2079612077616e7420666f72206e6f7468696e673f',
    text: 'what do ya want for nothing?',
    tags: {
      'SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      'SHA-384':
        'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
      'SHA-512':
        '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    },
  },
  {
    case: 3,
    keyHex: 'aa'.repeat(20),
    dataHex: 'dd'.repeat(50),
    text: null,
    tags: {
      'SHA-256': '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
      'SHA-384':
        '88062608d3e6ad8a0aa2ace014c8a86f0aa635d947ac9febe83ef4e55966144b2a5ab39dc13814b94e3ab6e101a34f27',
      'SHA-512':
        'fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb',
    },
  },
  {
    case: 4,
    keyHex: '0102030405060708090a0b0c0d0e0f10111213141516171819',
    dataHex: 'cd'.repeat(50),
    text: null,
    tags: {
      'SHA-256': '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
      'SHA-384':
        '3e8a69b7783c25851933ab6290af6ca77a9981480850009cc5577c6e1f573b4e6801dd23c4a7d679ccf8a386c674cffb',
      'SHA-512':
        'b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd',
    },
  },
  {
    case: 6,
    keyHex: 'aa'.repeat(131),
    dataHex:
      '54657374205573696e67204c61726765' +
      '72205468616e20426c6f636b2d53697a' +
      '65204b6579202d2048617368204b6579' +
      '204669727374',
    text: 'Test Using Larger Than Block-Size Key - Hash Key First',
    tags: {
      'SHA-256': '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
      'SHA-384':
        '4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952',
      'SHA-512':
        '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
    },
  },
  {
    case: 7,
    keyHex: 'aa'.repeat(131),
    dataHex:
      '54686973206973206120746573742075' +
      '73696e672061206c6172676572207468' +
      '616e20626c6f636b2d73697a65206b65' +
      '7920616e642061206c61726765722074' +
      '68616e20626c6f636b2d73697a652064' +
      '6174612e20546865206b6579206e6565' +
      '647320746f2062652068617368656420' +
      '6265666f7265206265696e6720757365' +
      '642062792074686520484d414320616c' +
      '676f726974686d2e',
    text:
      'This is a test using a larger than block-size key and a larger than ' +
      'block-size data. The key needs to be hashed before being used by the ' +
      'HMAC algorithm.',
    tags: {
      'SHA-256': '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
      'SHA-384':
        '6617178e941f020d351e2f254e8fd32c602420feb0b8fb9adccebb82461e99c5a678cc31e799176d3860e6110c46523e',
      'SHA-512':
        'e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58',
    },
  },
];

// RFC 4231 test case 5 publishes only the first 128 bits (16 bytes) of each tag,
// because the case is about truncation. The full digest must be longer.
const RFC4231_TRUNCATED = {
  'SHA-256': 'a3b6167473100ee06e0c796c2955552b',
  'SHA-384': '3abf34c3503b2a23a46efc619baef897',
  'SHA-512': '415fad6271580a531d4179bc891d87a6',
};
const RFC4231_CASE5_KEY = '0c'.repeat(20);
const RFC4231_CASE5_TEXT = 'Test With Truncation';

// ---------------------------------------------------------------------------
// RFC 2202 section 3, HMAC-SHA-1. RFC 4231 does not cover SHA-1 at all.
// ---------------------------------------------------------------------------
const RFC2202_SHA1 = [
  {
    case: 1,
    keyHex: '0b'.repeat(20),
    dataHex: '4869205468657265',
    text: 'Hi There',
    tag: 'b617318655057264e28bc0b6fb378c8ef146be00',
  },
  {
    case: 2,
    keyHex: '4a656665',
    dataHex: '7768617420646f2079612077616e7420666f72206e6f7468696e673f',
    text: 'what do ya want for nothing?',
    tag: 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
  },
  { case: 3, keyHex: 'aa'.repeat(20), dataHex: 'dd'.repeat(50), text: null, tag: '125d7342b9ac11cd91a39af48aa17b4f63f175d3' },
  {
    case: 4,
    keyHex: '0102030405060708090a0b0c0d0e0f10111213141516171819',
    dataHex: 'cd'.repeat(50),
    text: null,
    tag: '4c9007f4026250c6bc8414f9bf50c86c2d7235da',
  },
  {
    case: 5,
    keyHex: '0c'.repeat(20),
    dataHex: Buffer.from('Test With Truncation', 'utf8').toString('hex'),
    text: 'Test With Truncation',
    tag: '4c1a03424b55e07fe7f27be1d58bb9324a9a5a04',
  },
  {
    case: 6,
    keyHex: 'aa'.repeat(80),
    dataHex: Buffer.from('Test Using Larger Than Block-Size Key - Hash Key First', 'utf8').toString('hex'),
    text: 'Test Using Larger Than Block-Size Key - Hash Key First',
    tag: 'aa4ae5e15272d00e95705637ce8a3b55ed402112',
  },
  {
    case: 7,
    keyHex: 'aa'.repeat(80),
    dataHex: Buffer.from(
      'Test Using Larger Than Block-Size Key and Larger Than One Block-Size Data',
      'utf8',
    ).toString('hex'),
    text: 'Test Using Larger Than Block-Size Key and Larger Than One Block-Size Data',
    tag: 'e8e99d0f45237d786d6bbaa7965c7808bbff1a91',
  },
];

console.log('--- RFC 4231 官方向量：HMAC-SHA-256 / 384 / 512 ---');
{
  let vectors = 0;
  for (const vector of RFC4231) {
    const keyBytes = hexToBytes(vector.keyHex);
    const dataBytes = hexToBytes(vector.dataHex);

    if (vector.text !== null) {
      // The RFC prints both the ASCII message and its hex; they must agree.
      check(
        `RFC 4231 case ${vector.case}：消息的 UTF-8 字节与 RFC 给出的十六进制一致`,
        M.bytesToHex(M.utf8Bytes(vector.text)),
        vector.dataHex,
      );
    }

    for (const algorithm of ['SHA-256', 'SHA-384', 'SHA-512']) {
      const expected = vector.tags[algorithm];
      check(
        `RFC 4231 case ${vector.case} HMAC-${algorithm}`,
        M.bytesToHex(await M.hmacBytes(algorithm, keyBytes, dataBytes)),
        expected,
      );
      check(
        `RFC 4231 case ${vector.case} HMAC-${algorithm}：node:crypto 独立复算一致`,
        nodeHmac(algorithm, keyBytes, dataBytes),
        expected,
      );

      if (vector.text !== null) {
        // Same vector through the full text + hex-key pipeline the UI uses.
        const outcome = await M.computeHmac({
          algorithm,
          message: vector.text,
          key: vector.keyHex,
          keyEncoding: 'hex',
        });
        check(
          `RFC 4231 case ${vector.case} HMAC-${algorithm}：computeHmac（十六进制密钥）`,
          hexOf(outcome),
          expected,
        );
      }
      vectors += 1;
    }
  }
  check('共覆盖 RFC 4231 的 6 个测试用例 × 3 种算法', vectors, 18);
}

console.log('--- RFC 4231 测试用例 5：截断到 128 位 ---');
{
  const keyBytes = hexToBytes(RFC4231_CASE5_KEY);
  const messageBytes = M.utf8Bytes(RFC4231_CASE5_TEXT);
  for (const [algorithm, truncated] of Object.entries(RFC4231_TRUNCATED)) {
    const hex = M.bytesToHex(await M.hmacBytes(algorithm, keyBytes, messageBytes));
    check(
      `HMAC-${algorithm} 前 128 位与 RFC 4231 case 5 的截断值一致`,
      hex.slice(0, 32),
      truncated,
    );
    check(
      `HMAC-${algorithm} 完整摘要长于 128 位（RFC 只公布前 16 字节）`,
      hex.length > 32,
      true,
    );
  }
}

console.log('--- RFC 2202 官方向量：HMAC-SHA-1（RFC 4231 不覆盖 SHA-1）---');
{
  let vectors = 0;
  for (const vector of RFC2202_SHA1) {
    const keyBytes = hexToBytes(vector.keyHex);
    const dataBytes = hexToBytes(vector.dataHex);
    if (vector.text !== null) {
      check(
        `RFC 2202 case ${vector.case}：消息的 UTF-8 字节与向量一致`,
        M.bytesToHex(M.utf8Bytes(vector.text)),
        vector.dataHex,
      );
    }
    check(
      `RFC 2202 case ${vector.case} HMAC-SHA-1`,
      M.bytesToHex(await M.hmacBytes('SHA-1', keyBytes, dataBytes)),
      vector.tag,
    );
    check(
      `RFC 2202 case ${vector.case} HMAC-SHA-1：node:crypto 独立复算一致`,
      nodeHmac('SHA-1', keyBytes, dataBytes),
      vector.tag,
    );
    vectors += 1;
  }
  check('共覆盖 RFC 2202 的 7 个 HMAC-SHA-1 测试用例', vectors, 7);
}

console.log('--- 整个文本 + 十六进制密钥管线（RFC 4231 case 2 文本密钥）---');
{
  const expected = RFC4231[1].tags['SHA-256'];
  const asText = await M.computeHmac({
    algorithm: 'SHA-256',
    message: 'what do ya want for nothing?',
    key: 'Jefe',
    keyEncoding: 'text',
  });
  check('文本密钥 "Jefe" 得到 RFC 4231 case 2 的 HMAC-SHA-256', hexOf(asText), expected);
  const asHex = await M.computeHmac({
    algorithm: 'SHA-256',
    message: 'what do ya want for nothing?',
    key: '4a656665',
    keyEncoding: 'hex',
  });
  check('十六进制密钥 "4a656665" 得到同一结果', hexOf(asHex), expected);
}

console.log('--- 摘要长度与算法匹配 ---');
{
  const key = hexToBytes('4a656665');
  const message = M.utf8Bytes('length check');
  check(
    '算法清单（现代算法在前，SHA-1 作为兼容项在后）',
    Array.from(M.HMAC_ALGORITHMS),
    ['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1'],
  );
  for (const algorithm of M.HMAC_ALGORITHMS) {
    const digest = await M.hmacBytes(algorithm, key, message);
    const hex = M.bytesToHex(digest);
    const base64 = M.bytesToBase64(digest);
    const bits = M.DIGEST_BITS[algorithm];
    check(`${algorithm} 摘要字节数`, digest.length, bits / 8);
    check(`${algorithm} hex 字符数 = 位数 / 4`, hex.length, bits / 4);
    check(`${algorithm} Base64 长度 = 4 × ceil(n / 3)`, base64.length, 4 * Math.ceil(digest.length / 3));
    check(`${algorithm} hex 输出为小写`, hex, hex.toLowerCase());
    check(`${algorithm} 与 node:crypto 长度一致`, digest.length, nodeHmac(algorithm, key, message).length / 2);
  }
}

console.log('--- hex 与 Base64 是同一份字节 ---');
{
  const key = hexToBytes('0b'.repeat(20));
  const message = M.utf8Bytes('same bytes');
  for (const algorithm of M.HMAC_ALGORITHMS) {
    const digest = await M.hmacBytes(algorithm, key, message);
    const hex = M.bytesToHex(digest);
    const base64 = M.bytesToBase64(digest);
    check(
      `${algorithm}：Base64 解码回来与摘要字节相同`,
      Array.from(M.base64ToBytes(base64) ?? []),
      Array.from(digest),
    );
    check(`${algorithm}：hex 解码回来与摘要字节相同`, Array.from(hexToBytes(hex)), Array.from(digest));
  }
  check('非法 Base64 返回 null 而不是抛异常', M.base64ToBytes('!!!not base64!!!'), null);
  check('空字符串解码为 0 字节', Array.from(M.base64ToBytes('') ?? [1]), []);
}

console.log('--- 空消息与空密钥 ---');
{
  const EMPTY = new Uint8Array(0);
  const refEmpty = nodeHmac('SHA-256', EMPTY, EMPTY);
  check(
    '参照值：node:crypto 对空密钥 + 空消息的 HMAC-SHA-256',
    refEmpty,
    'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad',
  );
  check(
    '空密钥 + 空消息与 node:crypto 一致',
    M.bytesToHex(await M.hmacBytes('SHA-256', EMPTY, EMPTY)),
    refEmpty,
  );

  // Web Crypto on its own refuses the zero-length key, which is why the
  // implementation substitutes one 0x00 byte (identical after zero padding).
  let zeroKeyError = 'no-error';
  try {
    await crypto.subtle.importKey('raw', new Uint8Array(0), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  } catch (error) {
    zeroKeyError = error?.name ?? String(error);
  }
  check('Web Crypto 原生拒绝零长度密钥（DataError），故实现里做了等价替换', zeroKeyError, 'DataError');

  for (const algorithm of M.HMAC_ALGORITHMS) {
    check(
      `${algorithm}：空密钥与 node:crypto 一致`,
      M.bytesToHex(await M.hmacBytes(algorithm, EMPTY, M.utf8Bytes('abc'))),
      nodeHmac(algorithm, EMPTY, Buffer.from('abc', 'utf8')),
    );
    check(
      `${algorithm}：空消息与 node:crypto 一致`,
      M.bytesToHex(await M.hmacBytes(algorithm, hexToBytes('4a656665'), EMPTY)),
      nodeHmac(algorithm, hexToBytes('4a656665'), EMPTY),
    );
  }

  const emptyBoth = await M.computeHmac({ algorithm: 'SHA-256', message: '', key: '', keyEncoding: 'text' });
  check('computeHmac：空密钥 + 空消息成功返回', emptyBoth.ok, true);
  check('computeHmac：结果与 node:crypto 一致', hexOf(emptyBoth), refEmpty);
  check('computeHmac：标记 emptyKey', emptyBoth.ok && emptyBoth.result.emptyKey, true);
  check('computeHmac：密钥长度记为 0', emptyBoth.ok && emptyBoth.result.keyLength, 0);
  check('computeHmac：消息长度记为 0', emptyBoth.ok && emptyBoth.result.messageLength, 0);

  const emptyHexKey = await M.computeHmac({ algorithm: 'SHA-256', message: '', key: '', keyEncoding: 'hex' });
  check('十六进制模式下的空密钥与文本模式等价', hexOf(emptyHexKey), refEmpty);

  const emptyKeyNonEmptyMsg = await M.computeHmac({
    algorithm: 'SHA-256',
    message: 'abc',
    key: '',
    keyEncoding: 'text',
  });
  check(
    '空密钥 + 非空消息与 node:crypto 一致',
    hexOf(emptyKeyNonEmptyMsg),
    nodeHmac('SHA-256', EMPTY, Buffer.from('abc', 'utf8')),
  );

  const nonEmptyKeyEmptyMsg = await M.computeHmac({
    algorithm: 'SHA-256',
    message: '',
    key: 'Jefe',
    keyEncoding: 'text',
  });
  check(
    '非空密钥 + 空消息与 node:crypto 一致',
    hexOf(nonEmptyKeyEmptyMsg),
    nodeHmac('SHA-256', hexToBytes('4a656665'), EMPTY),
  );
}

console.log('--- Unicode 消息按 UTF-8 编码 ---');
{
  const KEY = hexToBytes('4a656665');
  check('「中文」的 UTF-8 字节', M.bytesToHex(M.utf8Bytes('中文')), 'e4b8ade69687');
  check('「😀」的 UTF-8 字节（代理对合成 4 字节）', M.bytesToHex(M.utf8Bytes('😀')), 'f09f9880');

  const CASES = ['中文', '😀', 'a中😀b', '中文测试消息', 'naïve café', '组合 🎉👍🏽 结束', 'zero\u0000byte'];
  let mismatches = 0;
  for (const text of CASES) {
    const ours = M.bytesToHex(await M.hmacBytes('SHA-256', KEY, M.utf8Bytes(text)));
    if (ours !== nodeHmac('SHA-256', KEY, Buffer.from(text, 'utf8'))) mismatches += 1;
    const outcome = await M.computeHmac({ algorithm: 'SHA-256', message: text, key: 'Jefe', keyEncoding: 'text' });
    if (!outcome.ok || outcome.result.hex !== ours) mismatches += 1;
  }
  check(`${CASES.length} 条含中文 / emoji / 组合字符的消息与 node:crypto 的 UTF-8 结果一致`, mismatches, 0);

  // The classic alternative is to use UTF-16 code units directly (latin1
  // truncation), which is wrong for anything outside ASCII. Prove the difference
  // is observable, so these checks would catch that implementation.
  const text = '中文';
  const latin1 = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) latin1[i] = text.charCodeAt(i) & 0xff;
  const correct = M.bytesToHex(await M.hmacBytes('SHA-256', KEY, M.utf8Bytes(text)));
  const wrong = M.bytesToHex(await M.hmacBytes('SHA-256', KEY, latin1));
  check('按 UTF-16 码元截断会得到不同摘要（证明 UTF-8 编码确实参与计算）', correct !== wrong, true);
}

console.log('--- 十六进制密钥与等价原始字节 ---');
{
  const expected = RFC4231[1].tags['SHA-256'];
  const variants = ['4a656665', '4A656665', '4a 65 66 65', '4a:65:66:65', '0x4a656665', '4a-65-66-65', ' 4A:65 66-65 '];
  let mismatches = 0;
  for (const variant of variants) {
    const outcome = await M.computeHmac({
      algorithm: 'SHA-256',
      message: 'what do ya want for nothing?',
      key: variant,
      keyEncoding: 'hex',
    });
    if (!outcome.ok || outcome.result.hex !== expected) mismatches += 1;
  }
  check(`${variants.length} 种十六进制写法（大小写 / 空格 / 冒号 / 短横 / 0x 前缀）都得到 RFC 4231 case 2 的结果`, mismatches, 0);

  const asTextKey = await M.computeHmac({ algorithm: 'SHA-256', message: 'abc', key: 'abc', keyEncoding: 'text' });
  const asHexKey = await M.computeHmac({ algorithm: 'SHA-256', message: 'abc', key: '616263', keyEncoding: 'hex' });
  check('文本密钥 "abc" 与十六进制密钥 "616263" 结果相同', hexOf(asTextKey), hexOf(asHexKey));
  check(
    '两者都等于 node:crypto 对字节 61 62 63 的结果',
    hexOf(asHexKey),
    nodeHmac('SHA-256', hexToBytes('616263'), Buffer.from('abc', 'utf8')),
  );

  // The mistake the hex option exists to prevent: treat the hex text as the key.
  const hexTextAsKey = M.bytesToHex(
    await M.hmacBytes('SHA-256', M.utf8Bytes('4a656665'), M.utf8Bytes('what do ya want for nothing?')),
  );
  check('把十六进制密钥当作文本使用会得到不同的（错误的）摘要', hexTextAsKey !== expected, true);

  check('奇数位十六进制被拒绝', M.parseHexBytes('abc').ok, false);
  check('非十六进制字符被拒绝', M.parseHexBytes('zz').ok, false);
  check('拒绝时给出可读原因', M.parseHexBytes('abc').error.length > 0, true);
  check('空十六进制字符串解析为 0 字节', Array.from(M.parseHexBytes('').bytes), []);
  check('仅 "0x" 前缀也解析为 0 字节', Array.from(M.parseHexBytes('0x').bytes), []);
  const bad = await M.computeHmac({ algorithm: 'SHA-256', message: 'x', key: 'abc', keyEncoding: 'hex' });
  check('computeHmac 对非法十六进制密钥返回错误而不是抛异常', bad.ok, false);
  check('错误信息可通过 result 之外的 error 字段取得', !bad.ok && bad.error.length > 0, true);
}

console.log('--- 反例一：总是先哈希密钥的"简化"实现是错的 ---');
{
  const toBuffer = (bytes) => new Uint8Array(bytes).buffer;
  async function alwaysHashKey(algorithm, keyBytes, messageBytes) {
    const hashedKey = new Uint8Array(await crypto.subtle.digest(algorithm, toBuffer(keyBytes)));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toBuffer(hashedKey),
      { name: 'HMAC', hash: algorithm },
      false,
      ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, toBuffer(messageBytes)));
  }

  const shortKey = hexToBytes('4a656665');
  const shortMsg = M.utf8Bytes('what do ya want for nothing?');
  const naiveShort = M.bytesToHex(await alwaysHashKey('SHA-256', shortKey, shortMsg));
  check('反例：短密钥被先哈希，结果与 RFC 4231 case 2 不符', naiveShort !== RFC4231[1].tags['SHA-256'], true);

  const hashedKey = new Uint8Array(await crypto.subtle.digest('SHA-256', toBuffer(shortKey)));
  check(
    '反例的结果恰好等于"以 SHA-256(Jefe) 为密钥"的 HMAC',
    naiveShort,
    nodeHmac('SHA-256', hashedKey, shortMsg),
  );

  const longKey = hexToBytes('aa'.repeat(131));
  const longMsg = M.utf8Bytes('Test Using Larger Than Block-Size Key - Hash Key First');
  const naiveLong = M.bytesToHex(await alwaysHashKey('SHA-256', longKey, longMsg));
  check(
    '反例：对超长密钥（131 > 64 字节）结果反而与 RFC 一致 —— 这正是该缺陷容易漏掉的原因',
    naiveLong,
    RFC4231[4].tags['SHA-256'],
  );
  check(
    '正确实现在同一超长密钥上也与 RFC 一致',
    M.bytesToHex(await M.hmacBytes('SHA-256', longKey, longMsg)),
    RFC4231[4].tags['SHA-256'],
  );
}

console.log('--- 密钥长度边界与随机交叉验证 ---');
{
  const LENGTHS = [0, 1, 2, 31, 32, 33, 63, 64, 65, 127, 128, 129, 200, 1000];
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const randomBytes = (length) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(rand() * 256);
    return bytes;
  };

  let mismatches = 0;
  let comparisons = 0;
  for (const algorithm of M.HMAC_ALGORITHMS) {
    for (const keyLength of LENGTHS) {
      const key = randomBytes(keyLength);
      const message = randomBytes(1 + Math.floor(rand() * 300));
      const ours = M.bytesToHex(await M.hmacBytes(algorithm, key, message));
      const reference = nodeHmac(algorithm, key, message);
      comparisons += 1;
      if (ours !== reference) mismatches += 1;
    }
  }
  check(
    `4 种算法 × 14 种密钥长度（含 0 / 1 / 块边界 63、64、65、127、128、129）共 ${comparisons} 组与 node:crypto 完全一致`,
    mismatches,
    0,
  );
  check('比较组数', comparisons, 56);

  // A one-byte key, which the vector tables do not contain, checked against the
  // independent implementation on all four algorithms.
  let oneByteMismatches = 0;
  for (const byte of [0x00, 0x01, 0x0b, 0x41, 0xff]) {
    for (const algorithm of M.HMAC_ALGORITHMS) {
      const key = new Uint8Array([byte]);
      const message = M.utf8Bytes(`one byte key ${byte}`);
      if (M.bytesToHex(await M.hmacBytes(algorithm, key, message)) !== nodeHmac(algorithm, key, message)) {
        oneByteMismatches += 1;
      }
    }
  }
  check('1 字节密钥（含 0x00 与 0xff）× 4 种算法全部与 node:crypto 一致', oneByteMismatches, 0);
}

console.log('--- 密钥处理说明 ---');
{
  check('短密钥说明提到零填充', M.describeKeyHandling('SHA-256', 20).includes('零填充'), true);
  check('超长密钥说明提到先哈希', M.describeKeyHandling('SHA-256', 131).includes('先做一次 SHA-256'), true);
  check('SHA-384 的块大小为 128 字节', M.BLOCK_BYTES['SHA-384'], 128);
  check('SHA-256 的块大小为 64 字节', M.BLOCK_BYTES['SHA-256'], 64);
  check('空密钥说明指出不具备认证能力', M.describeKeyHandling('SHA-512', 0).includes('不具备'), true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
