/**
 * Checks the RSA key pair generator.
 *
 * The interesting claims are "the PEM we write is exactly what every other tool
 * expects" and "the key really works", so nothing here is compared against the
 * implementation's own idea of correctness:
 *
 *   1. PEM layout is checked against a fixed key pair this script did not
 *      produce: `encodePem` must reproduce, byte for byte, the PEM that
 *      `node:crypto` wrote from the same DER.
 *   2. The DER reader and the JWK assembler are checked against
 *      `node:crypto`'s `export({ format: 'jwk' })` for that fixed pair.
 *   3. A generated pair is handed to `node:crypto`, which parses it and runs a
 *      real sign/verify or encrypt/decrypt round trip — including the
 *      cross-implementation direction (sign with Web Crypto, verify with Node).
 *   4. The fingerprint is checked against `createHash('sha256')` over the SPKI
 *      DER, and against the published SHA-256 vector for "abc".
 *
 * Generation is the one slow step, so the matrix is deliberately small: one
 * 2048-bit key per scheme, plus one 3072-bit key to exercise the larger modulus
 * path. A 4096-bit key takes roughly six seconds per generation here and would
 * turn this check into a multi-minute wait; the code path is identical, only the
 * parameter differs, and the accepted length list is covered separately.
 *
 * Usage: node scripts/check-rsa-key-pair.mjs
 */
import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  sign as signWith,
  verify as verifyWith,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/rsa-key-pair/rsaUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/rsa-key-pair.mjs', compiled);
const M = await import(pathToFileURL('.verify/rsa-key-pair.mjs').href);

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

/** Byte comparison through Buffer, an implementation independent of the module. */
const sameBytes = (left, right) => Buffer.from(left).equals(Buffer.from(right));
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/**
 * A fixed 2048-bit RSA key pair, exported by `node:crypto` as PKCS#8 and SPKI
 * PEM. It is the external reference for PEM layout and for the DER/JWK readers:
 * unlike a key generated below, it exists before the module under test runs.
 */
const FIXED_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjHYHO3h6Nu8NH8FBzdGx
IMoJlFlNILMDeDeRoMNg/G59VYcd8vLyNCSp6qIFU3UhmOvl6a8A+BSflUS6h2Fo
X4OnJJ1GIMblt+Xr+aLCkj/yfJtUoMrlfkETJWEQBSqW7d6+UZV7wtnvmzgnzRS2
xmxk2RLF732T9Bv4k3GonvN4O1K8lMeB1+PbddQOi3Cn3gbj4udAJmibGY7aodqp
P4U2Q/RpQbzBP188ka7xQ2P9dWe2xQav3PEOztWAhMH3JtCNFXI1+/3FLXLu+xht
6h+mKEjffcHKLGlFM5PLKCcg00JPGfUJ7sBh1WVmq6IsnRBiATu+vdWTrM9bchTj
1wIDAQAB
-----END PUBLIC KEY-----
`;

const FIXED_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCMdgc7eHo27w0f
wUHN0bEgygmUWU0gswN4N5Ggw2D8bn1Vhx3y8vI0JKnqogVTdSGY6+XprwD4FJ+V
RLqHYWhfg6cknUYgxuW35ev5osKSP/J8m1SgyuV+QRMlYRAFKpbt3r5RlXvC2e+b
OCfNFLbGbGTZEsXvfZP0G/iTcaie83g7UryUx4HX49t11A6LcKfeBuPi50AmaJsZ
jtqh2qk/hTZD9GlBvME/XzyRrvFDY/11Z7bFBq/c8Q7O1YCEwfcm0I0VcjX7/cUt
cu77GG3qH6YoSN99wcosaUUzk8soJyDTQk8Z9QnuwGHVZWaroiydEGIBO7691ZOs
z1tyFOPXAgMBAAECggEAFgKKuJV05TXJYy/33UYeEOrH3ICv1s9mXEis37mt8XBo
4GWXWlIahPQ30gYIep7woFNayCb9qmIk7ZGC/yLS5aCuKM0iR5GTPqFfPFN2VM+D
cmYuuTGCC6or02Al0AFv/B86yHL5nTtkUfjXN8omp+olVWSdMp2FeSuG5KfbSejW
frcpeBoC4qpMOWtdoX1JmGi26zEArZRP7GIIQxTy3WAJrMEaYBVEGCvw06+OaYix
zlwjCMMrKpvLLdTkjw9h4nvql6GQS+OP72MRkZIb9/DZnWcekgJwueVh+92sANe/
74G4olriq8r34ytQZfwqQMYjORGZ2mqBTzCIJ5c0TQKBgQDA8SPGk4gQWNXu2q+A
wuB7ccia++i5b6e58w3bP7iQAM9kEFPhqkGUv6ZKbxG6JG09N8TTeSqaN5n9seGK
9igxn1b9FX88q+vOBmdhwydgaw1nrfErw2dmz/VlboiGh0HxM+N4WKZoAFOS1l4F
9uZEu6eyran+CE3lEzwB+HrvNQKBgQC6Xfj2P2G+rpmv1pHAISj0zZrls/SrnjY9
x1d2r9EO9DotEfExrA5LqSPGjr43wR56XZ7dV0vzmXmsJpxgc0S0nma6M7iYCB5V
jov+xoBgWAz7mgufNXXtisqaLS15CiXxSIEZYuDyqCYlKDSFYV9g/uBz0VYgYg+/
Na4J/QnsWwKBgQCnxskiW5YdCPL3YijtIgkMr1QPGXE1F1fVxfpNpmp6pomxbNVU
TbX7gHA9F7plkFmBu2YnspyOQD1jM3R6XzVyeSmuqCvdeW5y2HS7uXUbTdv5RXOL
Z78Z00qEKosD2MhJ06JBO21w0J/b9xcJvrpcGIZqRMOmyFfcFE7BM+7K5QKBgQCC
WWPeZ+pnwhtAP2Vl6kuJHZ1vd/RzbI8nmpt0Kfig6vUdvOTkByFgjga1w/ULbglx
MLYCviIjWX8eh0rssvKlGf1j0vUTcOo2kSMdqZz0xeEewVnLm0rGQEMAnwSlGhH7
tuiE5wHK9wznBD3n5HkfkGVQ3GPO9odpB5SY6+Da7QKBgQCaaPvJaCEeD7TUwMGD
6HxKWubf2DSwIVWjH4OXC6Ys0ieQchnWTg9exyUSKZYyVbVqzgBLWlRXlNd6Ifqm
dSlzw40JE/r3VzRYmMNxA91HbnIsIefWKIMjTj5yrqDf/XSTqk9ip576ZYswC3TL
sMp9p4WN0xH/psmAI3hbk3SG7A==
-----END PRIVATE KEY-----
`;

/** SHA-256 of the fixed public key's SPKI DER, computed once with openssl-style tooling. */
const FIXED_FINGERPRINT_HEX = 'e79dfcde649387b20abc00c3f02c7e8f7fce0736cd9bacb893bfac126b34f142';

const decodedFixedPublic = M.decodePem(FIXED_PUBLIC_PEM);
const decodedFixedPrivate = M.decodePem(FIXED_PRIVATE_PEM);
if (!decodedFixedPublic.ok || !decodedFixedPrivate.ok) {
  console.error('固定密钥对无法用被测解码器读回，后续检查没有意义：');
  console.error(decodedFixedPublic.ok ? '' : `  公钥：${decodedFixedPublic.error}`);
  console.error(decodedFixedPrivate.ok ? '' : `  私钥：${decodedFixedPrivate.error}`);
  process.exit(1);
}
const fixedPublicDer = new Uint8Array(decodedFixedPublic.der);
const fixedPrivateDer = new Uint8Array(decodedFixedPrivate.der);
const fixedPublicKey = createPublicKey(FIXED_PUBLIC_PEM);
const fixedPrivateKey = createPrivateKey(FIXED_PRIVATE_PEM);

/** Re-wraps a PEM body at an arbitrary width, for the lenient-decoder checks. */
function rewrap(pem, width, newline = '\n') {
  const lines = pem.trimEnd().split('\n');
  const body = lines.slice(1, -1).join('');
  const wrapped = [];
  for (let index = 0; index < body.length; index += width) {
    wrapped.push(body.slice(index, index + width));
  }
  return `${lines[0]}${newline}${wrapped.join(newline)}${newline}${lines.at(-1)}${newline}`;
}

/** The final partial base64 line a `.match(/.{64}/g)` wrapper silently drops. */
function truncatedWrap(label, der) {
  const base64 = Buffer.from(der).toString('base64');
  return (
    `-----BEGIN ${label}-----\n` +
    `${base64.match(/.{64}/g).join('\n')}\n` +
    `-----END ${label}-----\n`
  );
}

console.log('--- PEM 格式：与 node:crypto 写出的固定密钥对逐字比对 ---');
{
  check('固定公钥能解码', M.decodePem(FIXED_PUBLIC_PEM).ok, true);
  check('固定公钥标签', M.decodePem(FIXED_PUBLIC_PEM).label, 'PUBLIC KEY');
  check('固定私钥标签', M.decodePem(FIXED_PRIVATE_PEM).label, 'PRIVATE KEY');
  check('公钥 DER 与 node 解析出的 SPKI 一致', sameBytes(fixedPublicDer, fixedPublicKey.export({ format: 'der', type: 'spki' })), true);
  check('私钥 DER 与 node 解析出的 PKCS#8 一致', sameBytes(fixedPrivateDer, fixedPrivateKey.export({ format: 'der', type: 'pkcs8' })), true);

  check('公钥 PEM 头逐字正确', FIXED_PUBLIC_PEM.split('\n')[0], '-----BEGIN PUBLIC KEY-----');
  check('公钥 PEM 尾逐字正确', FIXED_PUBLIC_PEM.split('\n').at(-2), '-----END PUBLIC KEY-----');
  check('私钥 PEM 头逐字正确', FIXED_PRIVATE_PEM.split('\n')[0], '-----BEGIN PRIVATE KEY-----');
  check('私钥 PEM 尾逐字正确', FIXED_PRIVATE_PEM.split('\n').at(-2), '-----END PRIVATE KEY-----');

  for (const [name, pem] of [['公钥', FIXED_PUBLIC_PEM], ['私钥', FIXED_PRIVATE_PEM]]) {
    const body = pem.split('\n').slice(1, -2);
    check(`${name} PEM 除末行外每行恰好 64 字符`, body.slice(0, -1).every((line) => line.length === 64), true);
    check(`${name} PEM 末行 1 到 64 字符`, body.at(-1).length > 0 && body.at(-1).length <= 64, true);
    check(`${name} PEM 恰好以一个换行结束`, pem.endsWith('\n') && !pem.endsWith('\n\n'), true);
    check(`${name} PEM 不含回车`, pem.includes('\r'), false);
  }

  // The strongest layout claim: our encoder reproduces what node:crypto wrote.
  check('encodePem 复现 node 写出的公钥 PEM', M.encodePem('PUBLIC KEY', fixedPublicDer), FIXED_PUBLIC_PEM);
  check('encodePem 复现 node 写出的私钥 PEM', M.encodePem('PRIVATE KEY', fixedPrivateDer), FIXED_PRIVATE_PEM);

  check('公钥 PEM 编解码往返逐字节一致', sameBytes(M.decodePem(M.encodePem('PUBLIC KEY', fixedPublicDer)).der, fixedPublicDer), true);
  check('私钥 PEM 编解码往返逐字节一致', sameBytes(M.decodePem(M.encodePem('PRIVATE KEY', fixedPrivateDer)).der, fixedPrivateDer), true);

  // Short, fully hand-checkable case: three bytes encode to four base64 chars.
  check(
    '短输入的确切 PEM 文本（可手算）',
    M.encodePem('TEST', new Uint8Array([0x00, 0x01, 0x02])),
    '-----BEGIN TEST-----\nAAEC\n-----END TEST-----\n',
  );

  // A body that is an exact multiple of 64 must not gain a blank line.
  const exactly128 = new Uint8Array(96);
  const pem128 = M.encodePem('TEST', exactly128);
  check('整行主体只有两行且没有多余空行', pem128.split('\n').length, 5);
  check('整行主体第二行仍为 64 字符', pem128.split('\n')[1].length, 64);
  check('整行主体解码回来仍是 96 字节', M.decodePem(pem128).der.length, 96);
  check('全零 96 字节往返一致', sameBytes(M.decodePem(pem128).der, exactly128), true);

  // Line width is not enforced, because RFC 7468 lets parsers accept other
  // widths and real files vary. The bytes must still match exactly.
  check('76 列换行的同一密钥可解码', sameBytes(M.decodePem(rewrap(FIXED_PUBLIC_PEM, 76)).der, fixedPublicDer), true);
  check('完全不换行的同一密钥可解码', sameBytes(M.decodePem(rewrap(FIXED_PUBLIC_PEM, 100000)).der, fixedPublicDer), true);
  check('CRLF 换行的同一密钥可解码', sameBytes(M.decodePem(rewrap(FIXED_PUBLIC_PEM, 64, '\r\n')).der, fixedPublicDer), true);
  check('主体中夹空行也能解码', sameBytes(M.decodePem(rewrap(FIXED_PUBLIC_PEM, 32).replace(/\n/g, '\n\n')).der, fixedPublicDer), true);
}

console.log('--- PEM 边界：非法输入必须被拒绝 ---');
{
  const rejected = [
    ['空字符串', ''],
    ['只有空白', '   \n\t  '],
    ['缺少头（只有主体与尾）', 'AAEC\n-----END PUBLIC KEY-----\n'],
    ['缺少尾', '-----BEGIN PUBLIC KEY-----\nAAEC\n'],
    ['头尾标签不一致', '-----BEGIN PUBLIC KEY-----\nAAEC\n-----END PRIVATE KEY-----\n'],
    ['头之前有内容', 'Bag Attributes\n-----BEGIN PUBLIC KEY-----\nAAEC\n-----END PUBLIC KEY-----\n'],
    ['主体为空', '-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----\n'],
    ['非 Base64 字符', '-----BEGIN PUBLIC KEY-----\nAA*C\n-----END PUBLIC KEY-----\n'],
    ['base64url 字符', '-----BEGIN PUBLIC KEY-----\nAA-C\n-----END PUBLIC KEY-----\n'],
    ['长度不是 4 的倍数', '-----BEGIN PUBLIC KEY-----\nAAE\n-----END PUBLIC KEY-----\n'],
    ['三个等号', '-----BEGIN PUBLIC KEY-----\nA===\n-----END PUBLIC KEY-----\n'],
    ['等号出现在中间', '-----BEGIN PUBLIC KEY-----\nAA=A\n-----END PUBLIC KEY-----\n'],
    ['END 之后还有内容', '-----BEGIN PUBLIC KEY-----\nAAEC\n-----END PUBLIC KEY-----\nAAAA\n'],
    ['只有头', '-----BEGIN PUBLIC KEY-----\n'],
  ];
  for (const [label, text] of rejected) {
    const decoded = M.decodePem(text);
    check(`拒绝：${label}`, decoded.ok === false && typeof decoded.error === 'string' && decoded.error.length > 0, true);
  }

  // The error messages must be actionable, not just "invalid".
  check('缺头错误提到 BEGIN', M.decodePem('AAEC\n').error.includes('BEGIN'), true);
  check('头尾不一致错误同时给出两个标签', (() => {
    const message = M.decodePem('-----BEGIN PUBLIC KEY-----\nAAEC\n-----END PRIVATE KEY-----\n').error;
    return message.includes('PUBLIC KEY') && message.includes('PRIVATE KEY');
  })(), true);
}

console.log('--- 朴素 PEM 写法的两种典型错误（证明本检查能抓到缺陷） ---');
{
  const base64 = Buffer.from(fixedPublicDer).toString('base64');
  check('固定公钥的 Base64 长 392 字符、末行仅 8 个（392 = 6 x 64 + 8）', [base64.length, base64.length % 64], [392, 8]);

  // Mistake 1: wrap with a replace and forget the newline before the footer, so
  // the final partial line is glued to the END line.
  const glued = `-----BEGIN PUBLIC KEY-----\n${base64.replace(/(.{64})/g, '$1\n')}-----END PUBLIC KEY-----\n`;
  check('漏掉末行换行 -> 整块 PEM 无法解析（与 END 行粘在一起）', M.decodePem(glued).ok, false);

  // Mistake 2: split on exactly 64 characters, which silently discards the
  // final partial line. The result still parses, so nothing warns you.
  const truncatedPem = truncatedWrap('PUBLIC KEY', fixedPublicDer);
  const decodedTruncated = M.decodePem(truncatedPem);
  check('截断后的 PEM 依然"看起来正常"并且能解码', decodedTruncated.ok, true);
  check('截断后少了 8 个 Base64 字符，即 6 个字节', fixedPublicDer.length - decodedTruncated.der.length, 6);

  let nodeRejected = false;
  try {
    createPublicKey(truncatedPem);
  } catch {
    nodeRejected = true;
  }
  check('node:crypto 直接拒绝被截断的 PEM（权威对照）', nodeRejected, true);

  const goodPem = M.encodePem('PUBLIC KEY', fixedPublicDer);
  const good = M.decodePem(goodPem);
  check('正确实现写出的 PEM 字节完整且能被 node 接受', good.ok && sameBytes(good.der, fixedPublicDer) && createPublicKey(goodPem).asymmetricKeyType === 'rsa', true);
}

console.log('--- Base64 / base64url ---');
{
  check('bytesToBase64 与 node 一致', M.bytesToBase64(fixedPublicDer), Buffer.from(fixedPublicDer).toString('base64'));
  check('base64ToBytes 与 node 一致', sameBytes(M.base64ToBytes(Buffer.from(fixedPublicDer).toString('base64')), fixedPublicDer), true);
  check('非法 Base64 返回 null', M.base64ToBytes('AA*C'), null);

  // 0xfb 0xff is the shortest input whose standard base64 contains both + and /.
  check('base64url 换掉 + 与 /', M.base64UrlEncode(new Uint8Array([0xfb, 0xff])), '-_8');
  check('标准 Base64 对同一输入是 +/8=', Buffer.from([0xfb, 0xff]).toString('base64'), '+/8=');
  check('base64url 去掉填充', M.base64UrlEncode(new Uint8Array([0xfb])), '-w');
  check('base64url 不含 = + /', /[=+/]/.test(M.base64UrlEncode(fixedPublicDer)), false);

  check('base64url 与 node 的 base64url 一致（SPKI DER）', M.base64UrlEncode(fixedPublicDer), Buffer.from(fixedPublicDer).toString('base64url'));

  // 256 bytes is the shape of a 2048-bit modulus: standard base64 pads it, JWK
  // must not, and the two encodings differ in exactly the two padding chars.
  const modulusLike = new Uint8Array(256).fill(0xab);
  check('256 字节的标准 Base64 带 == 填充', Buffer.from(modulusLike).toString('base64').endsWith('=='), true);
  check('同一输入的 base64url 没有填充', M.base64UrlEncode(modulusLike).endsWith('='), false);
  check('去掉填充后长度正好差 2', Buffer.from(modulusLike).toString('base64').length - M.base64UrlEncode(modulusLike).length, 2);
}

console.log('--- DER 解析与 JWK 组装：外部参照 node:crypto 的 JWK 导出 ---');
{
  const nodePublicJwk = fixedPublicKey.export({ format: 'jwk' });
  const nodePrivateJwk = fixedPrivateKey.export({ format: 'jwk' });

  const publicComponents = M.parseRsaPublicKeyDer(fixedPublicDer);
  const privateComponents = M.parseRsaPrivateKeyDer(fixedPrivateDer);
  check('SPKI 解析成功', publicComponents !== null, true);
  check('PKCS#8 解析成功', privateComponents !== null, true);

  check('公钥 n 与 node JWK 一致', M.base64UrlEncode(publicComponents.n), nodePublicJwk.n);
  check('公钥 e 与 node JWK 一致', M.base64UrlEncode(publicComponents.e), nodePublicJwk.e);
  check('公钥 e 是 65537', M.bytesToDecimalString(publicComponents.e), '65537');
  check('模长读回来是 2048 位', M.modulusBitLength(publicComponents.n), 2048);
  check('2048 位模数的无符号字节数是 256（DER 里多一个符号 0）', publicComponents.n.length, 256);

  for (const field of ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']) {
    check(`私钥 ${field} 与 node JWK 一致`, M.base64UrlEncode(privateComponents[field]), nodePrivateJwk[field]);
  }

  const publicJwk = M.assemblePublicJwk(publicComponents, 'RSASSA-PKCS1-v1_5', 'SHA-256');
  check('组装出的公钥 JWK（kty/n/e/alg/key_ops/ext）', publicJwk, {
    kty: 'RSA',
    n: nodePublicJwk.n,
    e: nodePublicJwk.e,
    alg: 'RS256',
    key_ops: ['verify'],
    ext: true,
  });

  const privateJwk = M.assemblePrivateJwk(privateComponents, 'RSASSA-PKCS1-v1_5', 'SHA-256');
  check('组装出的私钥 JWK 字段集合与 node 相同', Object.keys(privateJwk).sort(), [
    'alg', 'd', 'dp', 'dq', 'e', 'ext', 'key_ops', 'kty', 'n', 'p', 'q', 'qi',
  ]);
  check('私钥 JWK 的 d 与 node 一致', privateJwk.d, nodePrivateJwk.d);

  check('JWA 名称表：RSASSA', ['SHA-256', 'SHA-384', 'SHA-512'].map((hash) => M.jwaAlgorithm('RSASSA-PKCS1-v1_5', hash)), ['RS256', 'RS384', 'RS512']);
  check('JWA 名称表：PSS', ['SHA-256', 'SHA-384', 'SHA-512'].map((hash) => M.jwaAlgorithm('RSA-PSS', hash)), ['PS256', 'PS384', 'PS512']);
  check('JWA 名称表：OAEP', ['SHA-256', 'SHA-384', 'SHA-512'].map((hash) => M.jwaAlgorithm('RSA-OAEP', hash)), ['RSA-OAEP-256', 'RSA-OAEP-384', 'RSA-OAEP-512']);
  check('签名方案的密钥用途', [M.publicKeyOps('RSA-PSS'), M.privateKeyOps('RSA-PSS')], [['verify'], ['sign']]);
  check('加密方案的密钥用途', [M.publicKeyOps('RSA-OAEP'), M.privateKeyOps('RSA-OAEP')], [['encrypt'], ['decrypt']]);
}

console.log('--- DER 边界：损坏的输入必须解析失败而不是给出错误的密钥 ---');
{
  check('空输入', M.parseRsaPublicKeyDer(new Uint8Array(0)), null);
  check('私钥 DER 当作公钥解析', M.parseRsaPublicKeyDer(fixedPrivateDer), null);
  check('公钥 DER 当作私钥解析', M.parseRsaPrivateKeyDer(fixedPublicDer), null);
  check('截断的 SPKI', M.parseRsaPublicKeyDer(fixedPublicDer.subarray(0, 100)), null);
  check('外层标签被改坏', M.parseRsaPublicKeyDer(Uint8Array.from([0x31, ...fixedPublicDer.subarray(1)])), null);
  check('非最短长度形式被拒', M.parseRsaPublicKeyDer(new Uint8Array([0x30, 0x81, 0x00])), null);
  check('不定长形式被拒', M.parseRsaPublicKeyDer(new Uint8Array([0x30, 0x80, 0x00, 0x00])), null);

  // Locate the BIT STRING and flip its unused-bits count, which must be zero.
  const bitStringAt = fixedPublicDer.findIndex((byte, index) => byte === 0x03 && fixedPublicDer[index + 1] === 0x82);
  check('找到 SPKI 里的 BIT STRING', bitStringAt > 0, true);
  const brokenBitString = Uint8Array.from(fixedPublicDer);
  check('BIT STRING 的未用位计数原本是 0', brokenBitString[bitStringAt + 4], 0);
  brokenBitString[bitStringAt + 4] = 1;
  check('未用位计数非 0 时解析失败', M.parseRsaPublicKeyDer(brokenBitString), null);

  // A hand-built SPKI whose modulus INTEGER is zero: syntactically well formed,
  // semantically not a key.
  check(
    '模数为 0 的 SPKI 被拒',
    M.parseRsaPublicKeyDer(
      new Uint8Array([
        0x30, 0x1c,
        0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
        0x03, 0x0b, 0x00,
        0x30, 0x08,
        0x02, 0x01, 0x00,
        0x02, 0x03, 0x01, 0x00, 0x01,
      ]),
    ),
    null,
  );
  // And the same structure with a real modulus parses, so the case above fails
  // for the right reason.
  {
    const good = Uint8Array.from([
      0x30, 0x1c,
      0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
      0x03, 0x0b, 0x00,
      0x30, 0x08,
      0x02, 0x01, 0x7f,
      0x02, 0x03, 0x01, 0x00, 0x01,
    ]);
    const parsed = M.parseRsaPublicKeyDer(good);
    check('同一结构换成非零模数就能解析', parsed !== null && M.bytesToDecimalString(parsed.e), '65537');
  }

  // Different algorithms must not be walked as if they were RSA. Only the OID
  // separates an EC or Ed25519 SPKI from an RSA one at this level.
  const ecKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  check('EC 公钥的 SPKI 不被当成 RSA', M.parseRsaPublicKeyDer(ecKeys.publicKey.export({ format: 'der', type: 'spki' })), null);
  check('EC 私钥的 PKCS#8 不被当成 RSA', M.parseRsaPrivateKeyDer(ecKeys.privateKey.export({ format: 'der', type: 'pkcs8' })), null);
  const edKeys = generateKeyPairSync('ed25519');
  check('Ed25519 公钥的 SPKI 不被当成 RSA', M.parseRsaPublicKeyDer(edKeys.publicKey.export({ format: 'der', type: 'spki' })), null);
  check('Ed25519 私钥的 PKCS#8 不被当成 RSA', M.parseRsaPrivateKeyDer(edKeys.privateKey.export({ format: 'der', type: 'pkcs8' })), null);
}

console.log('--- 指纹：与 node:crypto 的 SHA-256 比对 ---');
{
  const digest = await M.sha256Bytes(fixedPublicDer);
  const nodeDigest = createHash('sha256').update(fixedPublicDer).digest();

  check('sha256 与 node createHash 一致（SPKI DER）', hex(digest), nodeDigest.toString('hex'));
  check('sha256 与已知常量一致（SPKI DER）', hex(digest), FIXED_FINGERPRINT_HEX);
  check('sha256 与 NIST 公布的 abc 向量一致', hex(await M.sha256Bytes(Buffer.from('abc', 'utf8'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  check('空输入的 sha256 与 node 一致', hex(await M.sha256Bytes(new Uint8Array(0))), createHash('sha256').update(Buffer.alloc(0)).digest('hex'));

  const expectedColon = Buffer.from(nodeDigest).toString('hex').toUpperCase().match(/../g).join(':');
  check('冒号大写指纹由同一摘要推出', M.formatFingerprintColon(digest), expectedColon);
  check('无分隔小写指纹', M.formatFingerprintHex(digest), nodeDigest.toString('hex'));

  const knownDigest = new Uint8Array(32).map((_, index) => index);
  check('指纹格式化（0x00 到 0x1f 的摘要）', M.formatFingerprintHex(knownDigest), '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  check('冒号格式（0x00 到 0x1f 的摘要）', M.formatFingerprintColon(knownDigest), '00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F');
  check('空摘要的两种格式', [M.formatFingerprintHex(new Uint8Array(0)), M.formatFingerprintColon(new Uint8Array(0))], ['', '']);

  // Hashing the PEM text instead of the DER is the classic mistake; the check
  // proves the two differ, so the assertion above really pins down the input.
  const pemDigest = await M.sha256Bytes(Buffer.from(FIXED_PUBLIC_PEM, 'utf8'));
  check('对 PEM 文本取哈希与对 DER 取哈希不同', hex(pemDigest) === FIXED_FINGERPRINT_HEX, false);

  check('bytesToDecimalString 对 0x010001', M.bytesToDecimalString(new Uint8Array([0x01, 0x00, 0x01])), '65537');
  check('模长计算：0x01 前缀零不影响位数', M.modulusBitLength(new Uint8Array([0x00, 0x80, 0x00])), 16);
  check('模长计算：全零为 0', M.modulusBitLength(new Uint8Array(4)), 0);
}

console.log('--- 密钥长度白名单 ---');
{
  check('允许的长度列表', M.ALLOWED_MODULUS_LENGTHS, [2048, 3072, 4096]);
  check('列表中不含 1024', M.ALLOWED_MODULUS_LENGTHS.includes(1024), false);
  for (const value of [2048, 3072, 4096]) {
    check(`${value} 位被接受`, M.validateModulusLength(value), null);
  }
  const reason = M.validateModulusLength(1024);
  check('1024 位被拒绝', typeof reason === 'string' && reason.length > 0, true);
  check('1024 位的理由明确写着不安全', reason.includes('不安全'), true);
  for (const value of [512, 1023, 2049, 0, -2048, 2048.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    check(`${value} 被拒绝`, typeof M.validateModulusLength(value) === 'string', true);
  }

  // The validator runs before any Web Crypto call, so these cost nothing.
  const rejected = await M.generateRsaKeyPair({ modulusLength: 1024, algorithm: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });
  check('生成入口直接拒绝 1024 位', rejected.ok, false);
  check('拒绝信息提到 1024', rejected.ok === false && rejected.error.includes('1024'), true);
  const badLength = await M.generateRsaKeyPair({ modulusLength: 2049, algorithm: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });
  check('生成入口拒绝非白名单长度', badLength.ok, false);
}

console.log('--- 真实生成：2048 位签名密钥（Web Crypto -> node:crypto） ---');
let generated = 0;
{
  const outcome = await M.generateRsaKeyPair({ modulusLength: 2048, algorithm: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });
  generated += 1;
  check('生成成功', outcome.ok, true);
  if (!outcome.ok) {
    console.log(`        ${outcome.error}`);
  } else {
    const result = outcome.result;
    check('读回的模长是 2048 位', result.modulusBits, 2048);
    check('公钥指数是 65537', result.publicExponent, '65537');
    check('JWA 名称是 RS256', result.jwa, 'RS256');

    // The PEM must be parseable by an independent implementation.
    const nodePrivate = createPrivateKey(result.privatePem);
    const nodePublic = createPublicKey(result.publicPem);
    check('node 能解析生成的私钥 PEM', nodePrivate.asymmetricKeyType, 'rsa');
    check('node 能解析生成的公钥 PEM', nodePublic.asymmetricKeyType, 'rsa');
    check('node 读到的模长与结果一致', nodePrivate.asymmetricKeyDetails.modulusLength, 2048);
    check('node 导出的公钥 PEM 与结果逐字一致', nodePublic.export({ format: 'pem', type: 'spki' }), result.publicPem);
    check('node 导出的私钥 PEM 与结果逐字一致', nodePrivate.export({ format: 'pem', type: 'pkcs8' }), result.privatePem);
    check('node 导出的 SPKI DER 与结果逐字节一致', sameBytes(nodePublic.export({ format: 'der', type: 'spki' }), result.publicDer), true);

    // JWK cross-check against node's own export.
    const nodePublicJwk = nodePublic.export({ format: 'jwk' });
    const nodePrivateJwk = nodePrivate.export({ format: 'jwk' });
    check('生成的公钥 n 与 node JWK 一致', result.publicJwk.n, nodePublicJwk.n);
    check('生成的公钥 e 与 node JWK 一致', result.publicJwk.e, nodePublicJwk.e);
    check('生成的私钥 d 与 node JWK 一致', result.privateJwk.d, nodePrivateJwk.d);
    check('生成的私钥 p/q 与 node JWK 一致', [result.privateJwk.p, result.privateJwk.q], [nodePrivateJwk.p, nodePrivateJwk.q]);
    check('生成的私钥 dp/dq/qi 与 node JWK 一致', [result.privateJwk.dp, result.privateJwk.dq, result.privateJwk.qi], [nodePrivateJwk.dp, nodePrivateJwk.dq, nodePrivateJwk.qi]);

    // Fingerprint from an independent hash.
    check('指纹与 node 对 SPKI DER 的 SHA-256 一致', result.fingerprintHex, createHash('sha256').update(nodePublic.export({ format: 'der', type: 'spki' })).digest('hex'));
    check('冒号指纹是同一摘要的另一种写法', result.fingerprintColon.replace(/:/g, '').toLowerCase(), result.fingerprintHex);

    // PEM round trip through our own decoder.
    check('生成公钥 PEM 往返一致', sameBytes(M.decodePem(result.publicPem).der, result.publicDer), true);
    check('生成私钥 PEM 往返一致', sameBytes(M.decodePem(result.privatePem).der, result.privateDer), true);

    // Real signature round trip, both directions across implementations.
    const message = Buffer.from(`wheat-tools 跨实现签名验证 ${'数据'.repeat(20)}`, 'utf8');
    const webSignature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', result.privateKey, message));
    check('Web Crypto 签名 -> node 验签通过', verifyWith('sha256', message, nodePublic, Buffer.from(webSignature)), true);
    const nodeSignature = signWith('sha256', message, nodePrivate);
    check('node 签名 -> Web Crypto 验签通过', await crypto.subtle.verify('RSASSA-PKCS1-v1_5', result.publicKey, nodeSignature, message), true);
    check('被改动的消息验签失败', await crypto.subtle.verify('RSASSA-PKCS1-v1_5', result.publicKey, nodeSignature, Buffer.concat([message, Buffer.from('!')])), false);

    // The exported JWK must be importable by a real implementation.
    const importedPublic = await crypto.subtle.importKey('jwk', result.publicJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['verify']);
    check('导出的公钥 JWK 可被重新导入并验签', await crypto.subtle.verify('RSASSA-PKCS1-v1_5', importedPublic, nodeSignature, message), true);
    const importedPrivate = await crypto.subtle.importKey('jwk', result.privateJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign']);
    const jwkSignature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', importedPrivate, message));
    check('导出的私钥 JWK 可被重新导入并签名（CRT 参数可用）', verifyWith('sha256', message, nodePublic, Buffer.from(jwkSignature)), true);
  }
}

console.log('--- 真实生成：3072 位 + SHA-512 ---');
{
  const outcome = await M.generateRsaKeyPair({ modulusLength: 3072, algorithm: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' });
  generated += 1;
  check('生成成功', outcome.ok, true);
  if (outcome.ok) {
    const result = outcome.result;
    check('读回的模长是 3072 位', result.modulusBits, 3072);
    check('JWA 名称是 RS512', result.jwa, 'RS512');
    const nodePrivate = createPrivateKey(result.privatePem);
    const nodePublic = createPublicKey(result.publicPem);
    check('node 读到的模长是 3072 位', nodePrivate.asymmetricKeyDetails.modulusLength, 3072);
    const message = Buffer.from('3072 位密钥的签名往返', 'utf8');
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', result.privateKey, message));
    check('Web Crypto 签名 -> node 验签通过', verifyWith('sha512', message, nodePublic, Buffer.from(signature)), true);
  }
}

console.log('--- 真实生成：RSA-PSS 签名 ---');
{
  const outcome = await M.generateRsaKeyPair({ modulusLength: 2048, algorithm: 'RSA-PSS', hash: 'SHA-384' });
  generated += 1;
  check('生成成功', outcome.ok, true);
  if (outcome.ok) {
    const result = outcome.result;
    check('JWA 名称是 PS384', result.jwa, 'PS384');
    check('JWK 的 alg 是 PS384', result.publicJwk.alg, 'PS384');
    check('私钥 JWK 的 key_ops 是 sign', result.privateJwk.key_ops, ['sign']);
    const nodePrivate = createPrivateKey(result.privatePem);
    const nodePublic = createPublicKey(result.publicPem);
    const message = Buffer.from('PSS 的概率性填充每次签名都不同', 'utf8');
    const saltLength = 48;
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength }, result.privateKey, message));
    check(
      'Web Crypto PSS 签名 -> node 验签通过',
      verifyWith('sha384', message, { key: nodePublic, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength }, Buffer.from(signature)),
      true,
    );
    const nodeSignature = signWith('sha384', message, { key: nodePrivate, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength });
    check(
      'node PSS 签名 -> Web Crypto 验签通过',
      await crypto.subtle.verify({ name: 'RSA-PSS', saltLength }, result.publicKey, nodeSignature, message),
      true,
    );
    const second = new Uint8Array(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength }, result.privateKey, message));
    check('PSS 的两次签名不同（填充带随机盐）', sameBytes(signature, second), false);
    check('两次签名都可验证', verifyWith('sha384', message, { key: nodePublic, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength }, Buffer.from(second)), true);
  }
}

console.log('--- 真实生成：RSA-OAEP 加密 ---');
{
  const outcome = await M.generateRsaKeyPair({ modulusLength: 2048, algorithm: 'RSA-OAEP', hash: 'SHA-256' });
  generated += 1;
  check('生成成功', outcome.ok, true);
  if (outcome.ok) {
    const result = outcome.result;
    check('JWA 名称是 RSA-OAEP-256', result.jwa, 'RSA-OAEP-256');
    check('公钥 JWK 的 key_ops 是 encrypt', result.publicJwk.key_ops, ['encrypt']);
    check('私钥 JWK 的 key_ops 是 decrypt', result.privateJwk.key_ops, ['decrypt']);
    const nodePrivate = createPrivateKey(result.privatePem);
    const nodePublic = createPublicKey(result.publicPem);
    const plain = Buffer.from('RSA-OAEP 适合加密短消息与对称密钥', 'utf8');
    const oaep = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

    const nodeCipher = publicEncrypt({ key: nodePublic, ...oaep }, plain);
    check('node 加密 -> node 解密', sameBytes(privateDecrypt({ key: nodePrivate, ...oaep }, nodeCipher), plain), true);

    const webCipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, result.publicKey, plain));
    check('Web Crypto 加密 -> node 解密', sameBytes(privateDecrypt({ key: nodePrivate, ...oaep }, Buffer.from(webCipher)), plain), true);
    check(
      'node 加密 -> Web Crypto 解密',
      sameBytes(new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, result.privateKey, nodeCipher)), plain),
      true,
    );

    const importedPublic = await crypto.subtle.importKey('jwk', result.publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
    const importedCipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, importedPublic, plain));
    check('导出的公钥 JWK 可加密且 node 能解密', sameBytes(privateDecrypt({ key: nodePrivate, ...oaep }, Buffer.from(importedCipher)), plain), true);
  }
}

console.log(`\n共生成 ${generated} 个密钥对（4096 位每次约 6 秒，故不在检查中生成；该路径与 3072 位完全相同）`);
console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
