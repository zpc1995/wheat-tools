/**
 * Checks the token generator.
 *
 * A generator is only as good as the randomness and the encoding behind it, so
 * this script attacks both:
 *
 *   - **Encoding** is compared against an authority that has nothing to do with
 *     this implementation: RFC 4648's published Base64 test vectors, and Node's
 *     own `Buffer` encoder over hundreds of random byte arrays.
 *   - **Distribution** is checked with a chi-square test over a *fixed*,
 *     reproducible source (SHA-256 in counter mode, so the test does not depend
 *     on the OS entropy pool), per character position. A deliberately biased
 *     source is run through the same test to prove the test can actually fail.
 *   - **Uniqueness**: 10 000 tokens must come out distinct.
 *   - **`Math.random`** is banned structurally: the TypeScript AST is searched
 *     for a `Math.random` property access rather than the text, because the
 *     explanation on the page legitimately mentions the name.
 *   - A seeded LCG stands in for `Math.random` to show the actual failure mode:
 *     an attacker who can guess the seed recovers the token by brute force over
 *     a small window of candidate seeds.
 *
 * Usage: node scripts/check-token-generator.mjs
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/token-generator/tokenUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/token-generator.mjs', compiled);
const M = await import(pathToFileURL('.verify/token-generator.mjs').href);

let passed = 0;
let failed = 0;

function record(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        ${detail}`}`);
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(ok, label, `got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`);
}

function close(label, actual, expected, tolerance = 1e-9) {
  const ok = Math.abs(actual - expected) <= tolerance;
  record(ok, label, `got      ${actual}\n        expected ${expected} (±${tolerance})`);
}

function assert(label, condition, detail = '') {
  record(Boolean(condition), label, detail);
}

// ---------------------------------------------------------------------------
// Random sources. None of them comes from the OS: everything here is a function
// of a fixed seed, so a failure is reproducible.
// ---------------------------------------------------------------------------

/** SHA-256 in counter mode: deterministic, uniform, and independent of crypto. */
function hashedSource(label) {
  let counter = 0;
  return (count) => {
    const out = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const digest = createHash('sha256').update(`${label}:${counter}`).digest();
      counter += 1;
      const take = Math.min(digest.length, count - offset);
      out.set(digest.subarray(0, take), offset);
      offset += take;
    }
    return out;
  };
}

/** The same construction squeezed into 0..199 — a broken RNG's byte stream. */
function biasedSource(label) {
  const inner = hashedSource(label);
  return (count) => {
    const raw = inner(count);
    const out = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) out[index] = raw[index] % 200;
    return out;
  };
}

/** A tiny LCG, standing in for `Math.random`: predictable from its seed. */
function lcgSource(seed) {
  let state = seed >>> 0;
  return (count) => {
    const out = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out[index] = (state >>> 24) & 0xff;
    }
    return out;
  };
}

function fixedBytes(length, seed) {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) out[index] = (index * 37 + seed * 11) & 0xff;
  return out;
}

const cryptoSource = (count) => new Uint8Array(randomBytes(count));

// ---------------------------------------------------------------------------
// Chi-square helpers.
// ---------------------------------------------------------------------------

/**
 * Upper-tail critical values at alpha = 0.001, from the standard chi-square
 * table. The Wilson-Hilferty approximation is used beyond the table and is
 * itself validated against the tabulated rows below.
 */
const CHI2_CRITICAL_001 = {
  1: 10.8276,
  2: 13.8155,
  3: 16.2662,
  4: 18.4668,
  5: 20.5150,
  6: 22.4577,
  7: 24.3219,
  8: 26.1245,
  15: 37.6973,
  16: 39.2524,
};

function chiSquareCritical(df) {
  if (CHI2_CRITICAL_001[df] !== undefined) return CHI2_CRITICAL_001[df];
  // Wilson-Hilferty: chi2_p ~ df * (1 - 2/(9 df) + z_p sqrt(2/(9 df)))^3
  const z = 3.0902;
  const term = 1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df));
  return df * term ** 3;
}

function chiSquare(counts) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, value) => sum + (value - expected) ** 2 / expected, 0);
}

/** Counts how often each character appears at one position. */
function samplePosition({ format, length, samples, position, source, customCharset = '' }) {
  const alphabet = M.buildAlphabet(format, customCharset);
  const indexOf = new Map(alphabet.map((char, index) => [char, index]));
  const counts = new Array(alphabet.length).fill(0);
  const seen = new Set();

  for (let sample = 0; sample < samples; sample += 1) {
    const body =
      format === 'custom'
        ? M.randomChars(alphabet, length, source)
        : M.encodeBytes(source(M.byteCountFor(format, length)), format, length);
    const char = [...body][position];
    seen.add(char);
    const index = indexOf.get(char);
    if (index === undefined) throw new Error(`输出里出现了未请求的字符：${char}`);
    counts[index] += 1;
  }

  return { counts, alphabet, seen };
}

console.log('--- 卡方检验的临界值本身先与标准表核对 ---');
{
  close('df=6 的 Wilson-Hilferty 近似接近标准表值 22.4577', chiSquareCritical(6), 22.4577, 0.1);
  close('df=15 的近似接近标准表值 37.6973', chiSquareCritical(15), 37.6973, 0.1);
  const approximated = (1 - 2 / (9 * 15) + 3.0902 * Math.sqrt(2 / (9 * 15))) ** 3 * 15;
  close('df=15 的近似误差小于 1%', Math.abs(approximated - 37.6973) / 37.6973 < 0.01, true);
  assert('df=1 时不使用近似（近似在 df 很小时不可靠，表中已有精确值）', chiSquareCritical(1) === 10.8276);
}

console.log('--- Base64 / Hex 编码：RFC 4648 测试向量 + Node Buffer ---');
{
  const ascii = (text) => new Uint8Array(Buffer.from(text, 'utf8'));
  // RFC 4648 section 10 test vectors.
  check('RFC 4648: "" → ""', M.bytesToBase64(ascii('')), '');
  check('RFC 4648: "f" → "Zg"（去掉 = 填充）', M.bytesToBase64(ascii('f')), 'Zg');
  check('RFC 4648: "fo" → "Zm8"', M.bytesToBase64(ascii('fo')), 'Zm8');
  check('RFC 4648: "foo" → "Zm9v"', M.bytesToBase64(ascii('foo')), 'Zm9v');
  check('RFC 4648: "foob" → "Zm9vYg"', M.bytesToBase64(ascii('foob')), 'Zm9vYg');
  check('RFC 4648: "fooba" → "Zm9vYmE"', M.bytesToBase64(ascii('fooba')), 'Zm9vYmE');
  check('RFC 4648: "foobar" → "Zm9vYmFy"', M.bytesToBase64(ascii('foobar')), 'Zm9vYmFy');
  check('URL-safe 变体：0xffffff → "____"', M.bytesToBase64(new Uint8Array([255, 255, 255]), true), '____');
  check('标准变体：0xffffff → "////"', M.bytesToBase64(new Uint8Array([255, 255, 255])), '////');
  check('URL-safe 变体：0xfbff → "-_8"', M.bytesToBase64(new Uint8Array([0xfb, 0xff]), true), '-_8');
  check('标准变体：0xfbff → "+/8"', M.bytesToBase64(new Uint8Array([0xfb, 0xff])), '+/8');

  let hexMismatch = 0;
  let base64Mismatch = 0;
  let base64UrlMismatch = 0;
  for (let round = 0; round < 300; round += 1) {
    const bytes = new Uint8Array(randomBytes(1 + (round % 24)));
    if (M.bytesToHex(bytes) !== Buffer.from(bytes).toString('hex')) hexMismatch += 1;
    if (
      M.bytesToBase64(bytes) !==
      Buffer.from(bytes).toString('base64').replace(/=+$/, '')
    ) {
      base64Mismatch += 1;
    }
    if (
      M.bytesToBase64(bytes, true) !==
      Buffer.from(bytes).toString('base64url').replace(/=+$/, '')
    ) {
      base64UrlMismatch += 1;
    }
  }
  check('300 组随机字节的 Hex 编码与 Buffer 完全一致', hexMismatch, 0);
  check('300 组随机字节的 Base64 编码与 Buffer 完全一致（去掉填充）', base64Mismatch, 0);
  check('300 组随机字节的 Base64URL 编码与 Buffer 完全一致', base64UrlMismatch, 0);

  let sliceMismatch = 0;
  const bytes = new Uint8Array(randomBytes(64));
  for (const format of ['hex', 'base64', 'base64url']) {
    const full =
      format === 'hex'
        ? Buffer.from(bytes).toString('hex')
        : Buffer.from(bytes)
            .toString(format === 'base64url' ? 'base64url' : 'base64')
            .replace(/=+$/, '');
    for (let length = 1; length <= 40; length += 1) {
      if (M.encodeBytes(bytes, format, length) !== full.slice(0, length)) sliceMismatch += 1;
    }
  }
  check('截断编码等于完整编码的前缀（120 个长度组合）', sliceMismatch, 0);

  check('Hex 需要 ceil(n/2) 个字节', M.byteCountFor('hex', 9), 5);
  check('Base64 需要 ceil(6n/8) 个字节', M.byteCountFor('base64', 9), 7);
  assert(
    '字节数足够编出指定长度的字符',
    ['hex', 'base64', 'base64url'].every((format) => {
      for (let length = 1; length <= 64; length += 1) {
        const needed = M.byteCountFor(format, length);
        if (M.encodeBytes(fixedBytes(needed, 1), format, length).length !== length) return false;
      }
      return true;
    }),
  );
}

console.log('--- 生成路径与编码路径一致 ---');
{
  const options = (over) => ({
    format: 'hex',
    length: 9,
    count: 1,
    prefix: '',
    groupSize: 0,
    customCharset: '',
    ...over,
  });

  for (const format of ['hex', 'base64', 'base64url']) {
    for (const length of [1, 3, 9, 32, 33]) {
      const source = () => fixedBytes(M.byteCountFor(format, length), 2);
      const result = M.generateToken(options({ format, length }), source);
      check(
        `${format} 长度 ${length}：generateToken 等于 encodeBytes`,
        result.batch.tokens[0].body,
        M.encodeBytes(fixedBytes(M.byteCountFor(format, length), 2), format, length),
      );
    }
  }

  const custom = M.generateToken(
    options({ format: 'custom', length: 6, customCharset: 'ABCD' }),
    hashedSource('path'),
  );
  assert(
    '自定义字符集走 rejection sampling 路径且只用请求的字符',
    /^[ABCD]{6}$/.test(custom.batch.tokens[0].body),
    custom.batch.tokens[0].body,
  );
}

console.log('--- 长度精确、字符集封闭 ---');
{
  const lengths = [1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 100, 255, 256, 1000];
  let lengthMismatch = 0;
  let alphabetLeak = 0;
  const patterns = { hex: /^[0-9a-f]+$/, base64: /^[A-Za-z0-9+/]+$/, base64url: /^[A-Za-z0-9_-]+$/ };

  for (const format of ['hex', 'base64', 'base64url']) {
    const alphabet = new Set(M.buildAlphabet(format, ''));
    for (const length of lengths) {
      const result = M.generateToken(
        { format, length, count: 1, prefix: '', groupSize: 0, customCharset: '' },
        cryptoSource,
      );
      const body = result.batch.tokens[0].body;
      if ([...body].length !== length) lengthMismatch += 1;
      if (!patterns[format].test(body)) alphabetLeak += 1;
      if ([...body].some((char) => !alphabet.has(char))) alphabetLeak += 1;
    }
  }
  check(`19 个长度 × 3 种格式，长度全部精确`, lengthMismatch, 0);
  check('输出中不含任何未请求的字符', alphabetLeak, 0);

  for (const [charset, length] of [
    ['ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 20],
    ['甲乙丙丁', 10],
    ['😀😎🥳', 5],
    ['ab', 7],
  ]) {
    const result = M.generateToken(
      { format: 'custom', length, count: 1, prefix: '', groupSize: 0, customCharset: charset },
      cryptoSource,
    );
    const body = result.batch.tokens[0].body;
    check(`自定义字符集 ${charset} 的长度按码点精确`, [...body].length, length);
    assert(
      `自定义字符集 ${charset} 的每个字符都在集合内`,
      [...body].every((char) => [...charset].includes(char)),
      body,
    );
  }

  const emoji = M.generateToken(
    { format: 'custom', length: 6, count: 1, prefix: '', groupSize: 0, customCharset: '😀😎' },
    cryptoSource,
  );
  check('Emoji 字符集：6 个码点、UTF-16 长度 12', emoji.batch.tokens[0].body.length, 12);
}

console.log('--- 前缀与分组 ---');
{
  const result = M.generateToken(
    { format: 'hex', length: 13, count: 1, prefix: 'sk_', groupSize: 4, customCharset: '' },
    () => fixedBytes(7, 3),
  );
  const token = result.batch.tokens[0];
  check('value = 前缀 + 原始串', token.value, `sk_${M.encodeBytes(fixedBytes(7, 3), 'hex', 13)}`);
  check('display = 前缀 + 分组的原始串', token.display, `sk_${M.groupToken(token.body, 4)}`);
  check('value 里没有空格', token.value.includes(' '), false);
  check('display 去掉空格后等于 value', token.display.replace(/ /g, ''), token.value);
  check('前缀不出现在 body 里', token.body.startsWith('sk_'), false);
  check('分组后长度增加 3 个空格（13 位分 4 组）', token.display.length, token.value.length + 3);

  check('每 4 位分组', M.groupToken('abcdefgh', 4), 'abcd efgh');
  check('自定义分隔符', M.groupToken('abcdefgh', 4, '-'), 'abcd-efgh');
  check('不足一组时不补分隔符', M.groupToken('abc', 4), 'abc');
  check('分组长度为 0 时不分组', M.groupToken('abcdefgh', 0), 'abcdefgh');
  check('分组按码点而不是 UTF-16 码元', M.groupToken('😀😎🥳', 2), '😀😎 🥳');

  let groupReconstruct = 0;
  for (const size of [2, 3, 4, 5, 6, 8]) {
    const generated = M.generateToken(
      { format: 'hex', length: 33, count: 1, prefix: '', groupSize: size, customCharset: '' },
      cryptoSource,
    ).batch.tokens[0];
    if (generated.display.replace(/ /g, '') !== generated.body) groupReconstruct += 1;
  }
  check('6 种分组长度都能还原出原始串', groupReconstruct, 0);
}

console.log('--- 批量、熵与等效字节数 ---');
{
  const batch = M.generateTokens(
    { format: 'hex', length: 32, count: 25, prefix: 'sk_', groupSize: 4, customCharset: '' },
    cryptoSource,
  ).batch;
  check('批量生成 25 条', batch.tokens.length, 25);
  check('displayText 有 25 行', batch.displayText.split('\n').length, 25);
  check('rawText 有 25 行', batch.rawText.split('\n').length, 25);
  check('每一行都带前缀', batch.rawText.split('\n').every((line) => line.startsWith('sk_')), true);
  close('32 位 hex 的熵 = 128 位', batch.bitsPerToken, 128);
  close('每字符 4 位', batch.bitsPerChar, 4);
  check('等效随机字节数 = 16', batch.equivalentBytes, 16);
  close('整批总熵 = 128 × 25', batch.totalBits, 128 * 25);
  check('64 字符集每字符 6 位', M.entropyBits(1, 64), 6);
  close('22 位 Base64URL 的熵 = 132 位', M.entropyBits(22, 64), 132);
  check('熵为 0 的退化情形', M.entropyBits(10, 1), 0);
  check('等效字节数换算', M.equivalentBytes(132), 16.5);

  const noPrefix = M.generateTokens(
    { format: 'hex', length: 32, count: 1, prefix: '', groupSize: 0, customCharset: '' },
    cryptoSource,
  ).batch;
  close('前缀不增加熵', noPrefix.bitsPerToken, batch.bitsPerToken);
  assert('长 token 的碰撞概率可以忽略', noPrefix.log10CollisionChance < -9, `${noPrefix.log10CollisionChance}`);

  const shortBatch = M.generateTokens(
    { format: 'hex', length: 4, count: 1000, prefix: '', groupSize: 0, customCharset: '' },
    cryptoSource,
  ).batch;
  assert(
    '4 位 hex × 1000 条会明确警告重复概率高',
    shortBatch.log10CollisionChance > -3,
    `${shortBatch.log10CollisionChance}`,
  );
  close('生日界：log10(C(1000,2) / 2^17)', shortBatch.log10CollisionChance, Math.log10((1000 * 999) / 2) - 16 * Math.log10(2));

  const tokens = batch.tokens.slice(0, 3);
  check('tokensToText(未分组) 用原值', M.tokensToText(tokens, false), tokens.map((t) => t.value).join('\n'));
  check('tokensToText(分组) 用显示值', M.tokensToText(tokens, true), tokens.map((t) => t.display).join('\n'));
}

console.log('--- 分布：固定随机源上的卡方检验 ---');
{
  // Base64: 64 characters, no rejection, df = 63.
  {
    const { counts, seen } = samplePosition({
      format: 'base64',
      length: 1,
      samples: 64000,
      position: 0,
      source: hashedSource('base64-pos1'),
    });
    const statistic = chiSquare(counts);
    const critical = chiSquareCritical(63);
    check('Base64 的 64 个字符全部出现过', seen.size, 64);
    assert(
      `Base64 单字符位置卡方统计量 ${statistic.toFixed(1)} < 临界值 ${critical.toFixed(1)}`,
      statistic < critical,
      `statistic = ${statistic}`,
    );
    const expected = 64000 / 64;
    const sigma = Math.sqrt(expected * (1 - 1 / 64));
    const outside = counts.filter((count) => Math.abs(count - expected) > 5 * sigma).length;
    check('每个字符的出现次数都在期望值 ±5σ 内', outside, 0);
  }

  // Two positions of a longer token, to catch position-dependent bias.
  {
    const samples = 16000;
    for (const position of [0, 7]) {
      const { counts } = samplePosition({
        format: 'base64',
        length: 8,
        samples,
        position,
        source: hashedSource(`base64-pos-${position}`),
      });
      const statistic = chiSquare(counts);
      assert(
        `Base64 第 ${position + 1} 个字符位置的分布均匀（统计量 ${statistic.toFixed(1)}）`,
        statistic < chiSquareCritical(63),
        `statistic = ${statistic}`,
      );
    }
  }

  // Hex: 16 characters, df = 15.
  {
    const { counts, seen } = samplePosition({
      format: 'hex',
      length: 1,
      samples: 16000,
      position: 0,
      source: hashedSource('hex-pos1'),
    });
    const statistic = chiSquare(counts);
    check('Hex 的 16 个字符全部出现过', seen.size, 16);
    assert(
      `Hex 单字符位置卡方统计量 ${statistic.toFixed(1)} < 临界值 ${chiSquareCritical(15).toFixed(1)}`,
      statistic < chiSquareCritical(15),
      `statistic = ${statistic}`,
    );
  }

  // Custom alphabet of 7: the rejection-sampling path, df = 6.
  {
    const { counts, seen } = samplePosition({
      format: 'custom',
      length: 1,
      samples: 70000,
      position: 0,
      source: hashedSource('custom-7'),
      customCharset: 'ABCDEFG',
    });
    const statistic = chiSquare(counts);
    check('自定义 7 字符集全部出现过', seen.size, 7);
    assert(
      `拒绝采样路径的卡方统计量 ${statistic.toFixed(1)} < 临界值 ${chiSquareCritical(6).toFixed(1)}`,
      statistic < chiSquareCritical(6),
      `statistic = ${statistic}`,
    );
  }

  // Rejection sampling must not favour the first characters.
  {
    const { counts } = samplePosition({
      format: 'custom',
      length: 1,
      samples: 30001,
      position: 0,
      source: hashedSource('custom-3'),
      customCharset: 'XYZ',
    });
    const statistic = chiSquare(counts);
    assert(
      `3 字符集（256 不能被 3 整除，必须拒绝 1/256 的取值）分布均匀，统计量 ${statistic.toFixed(2)}`,
      statistic < chiSquareCritical(2),
      `counts = ${JSON.stringify(counts)}`,
    );
  }

  // Duplicated characters in the custom charset must not skew the output.
  {
    const alphabet = M.sanitiseCustomAlphabet('aabbcc');
    check('自定义字符集会去重', alphabet, ['a', 'b', 'c']);
    const { counts } = samplePosition({
      format: 'custom',
      length: 1,
      samples: 30000,
      position: 0,
      source: hashedSource('dedupe'),
      customCharset: 'aabbcc',
    });
    assert(
      '重复写出的字符不会让它的出现频率翻倍',
      chiSquare(counts) < chiSquareCritical(2),
      JSON.stringify(counts),
    );
  }

  // The same test must fail on a source that only ever yields 0..199.
  {
    const { counts } = samplePosition({
      format: 'base64',
      length: 1,
      samples: 64000,
      position: 0,
      source: biasedSource('biased'),
    });
    const statistic = chiSquare(counts);
    assert(
      `有偏随机源会被同一套检验抓住（统计量 ${statistic.toFixed(0)} ≫ 临界值 ${chiSquareCritical(63).toFixed(0)}）`,
      statistic > chiSquareCritical(63) * 3,
      `statistic = ${statistic}`,
    );
  }
}

console.log('--- 唯一性：10000 条不重复 ---');
{
  const batch = M.generateTokens(
    { format: 'hex', length: 32, count: 10000, prefix: '', groupSize: 0, customCharset: '' },
    cryptoSource,
  ).batch;
  const unique = new Set(batch.tokens.map((token) => token.value));
  check('10000 条 32 位 hex 全部互不相同', unique.size, 10000);
  check('每条长度都是 32', [...new Set(batch.tokens.map((token) => token.body.length))], [32]);

  const urlBatch = M.generateTokens(
    { format: 'base64url', length: 22, count: 10000, prefix: '', groupSize: 0, customCharset: '' },
    cryptoSource,
  ).batch;
  check('10000 条 22 位 Base64URL 全部互不相同', new Set(urlBatch.tokens.map((t) => t.value)).size, 10000);
  check(
    '这 10000 条只含 URL 安全字符',
    urlBatch.tokens.every((token) => /^[A-Za-z0-9_-]{22}$/.test(token.body)),
    true,
  );
}

console.log('--- Math.random 的结构性禁入与可预测性演示 ---');
{
  // Structural check: an AST search for `Math.random`, not a text search. The
  // page deliberately mentions the name in its explanation, so a substring test
  // would produce a false positive.
  const dir = 'src/tools/token-generator';
  const files = readdirSync(dir);
  check('工具目录包含所需的四个文件', files.sort(), [
    'TokenGeneratorTool.tsx',
    'index.ts',
    'manifest.ts',
    'tokenUtils.ts',
  ]);

  let mathRandomAccesses = 0;
  for (const file of files) {
    const path = `${dir}/${file}`;
    const text = readFileSync(path, 'utf8');
    const parsed = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.getText(parsed) === 'Math' &&
        node.name.getText(parsed) === 'random'
      ) {
        mathRandomAccesses += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  check('整个工具目录里没有一处 Math.random 属性访问（AST 检查）', mathRandomAccesses, 0);

  const component = readFileSync(`${dir}/TokenGeneratorTool.tsx`, 'utf8');
  assert(
    '页面文字确实提到了 Math.random（所以这里必须做 AST 检查而不是字符串检查）',
    component.includes('Math.random'),
  );
  assert('随机源用的是 crypto.getRandomValues', component.includes('crypto.getRandomValues'));
  assert('工具源码没有网络调用', !component.includes('fetch(') && !component.includes('XMLHttpRequest'));

  // Predictability demo: the failure mode of a seeded PRNG such as Math.random.
  const options = { format: 'hex', length: 16, count: 1, prefix: '', groupSize: 0, customCharset: '' };
  const trueSeed = 1_700_000_000_000 + 12345;
  const token = M.generateToken(options, lcgSource(trueSeed)).batch.tokens[0].value;
  const reproduced = M.generateToken(options, lcgSource(trueSeed)).batch.tokens[0].value;
  check('可预测的伪随机源：同一个 seed 必然复现同一个 token', reproduced, token);

  const window = 1 << 14;
  const start = trueSeed - (window >> 1);
  let recovered = -1;
  for (let seed = start; seed < start + window; seed += 1) {
    if (M.generateToken(options, lcgSource(seed)).batch.tokens[0].value === token) {
      recovered = seed;
      break;
    }
  }
  check(
    `攻击者只需搜索 ${window} 个候选种子就能还原 token（Math.random 的内部状态同理可被还原）`,
    recovered,
    trueSeed,
  );

  // The insecure path still passes a distribution test — which is exactly why
  // "it looks random" is not a security argument.
  const counts = new Array(16).fill(0);
  const lcg = lcgSource(42);
  for (let sample = 0; sample < 16000; sample += 1) {
    const body = M.encodeBytes(lcg(1), 'hex', 1);
    counts[parseInt(body, 16)] += 1;
  }
  assert(
    '可预测的 LCG 也能通过卡方检验：统计性质好 ≠ 密码学安全',
    chiSquare(counts) < chiSquareCritical(15),
    `statistic = ${chiSquare(counts)}`,
  );
}

console.log('--- 参数校验与边界 ---');
{
  const base = { format: 'hex', length: 16, count: 1, prefix: '', groupSize: 0, customCharset: '' };
  const errorOf = (over) => {
    const result = M.generateTokens({ ...base, ...over }, cryptoSource);
    return result.ok ? 'ok' : result.error;
  };

  check('长度为 0 被拒绝', errorOf({ length: 0 }), '长度必须是大于 0 的整数');
  check('长度超过 4096 被拒绝', errorOf({ length: 4097 }), '长度上限为 4096');
  check('长度不是整数被拒绝', errorOf({ length: 1.5 }), '长度必须是大于 0 的整数');
  check('数量为 0 被拒绝', errorOf({ count: 0 }), '数量必须是大于 0 的整数');
  check('数量超过 10000 被拒绝', errorOf({ count: 10001 }), '单批数量上限为 10000');
  check(
    '数量 × 长度 超过 50 万被拒绝',
    errorOf({ count: 1000, length: 4096 }),
    '单批总字符数（数量 × 长度）上限为 500000，当前为 4096000',
  );
  check('未知格式被拒绝', errorOf({ format: 'rot13' }), '未知的输出格式：rot13');
  check('前缀含空格被拒绝', errorOf({ prefix: 'sk _' }), '前缀不能包含空白或控制字符');
  check('前缀过长被拒绝', errorOf({ prefix: 'x'.repeat(65) }), '前缀不能超过 64 个字符');
  check('分组长度 7 不被接受', errorOf({ groupSize: 7 }), '分组长度只能是 0 / 2 / 3 / 4 / 5 / 6 / 8');
  check('自定义字符集为空被拒绝', errorOf({ format: 'custom', customCharset: '' }), '自定义字符集至少需要 2 个不同的字符');
  check('自定义字符集只有一个字符被拒绝', errorOf({ format: 'custom', customCharset: 'aaa' }), '自定义字符集至少需要 2 个不同的字符');
  const hugeCharset = Array.from({ length: 300 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');
  check('自定义字符集超过 256 个字符被拒绝', errorOf({ format: 'custom', customCharset: hugeCharset }), '自定义字符集最多 256 个字符');

  check('长度 1 合法', M.generateTokens({ ...base, length: 1 }, cryptoSource).ok, true);
  check('长度 4096 合法', M.validateOptions({ ...base, length: 4096 }).ok, true);
  check('数量 1000 合法', M.validateOptions({ ...base, count: 1000 }).ok, true);
  check('数量 10000（配合较短长度）合法', M.validateOptions({ ...base, count: 10000, length: 32 }).ok, true);
  check('自定义字符集的空白字符被忽略', M.sanitiseCustomAlphabet('a b\tc\nd'), ['a', 'b', 'c', 'd']);
  check('分组长度 1 不在允许列表中', M.GROUP_SIZES.includes(1), false);
  check('256 个字符的自定义字符集合法', M.validateOptions({ ...base, format: 'custom', customCharset: hugeCharset.slice(0, 256) }).ok, true);

  // A broken source must fail loudly rather than loop forever.
  let emptyError = '';
  try {
    M.randomChars(['a', 'b'], 4, () => new Uint8Array(0));
  } catch (cause) {
    emptyError = cause.message;
  }
  check('随机源返回空数组时抛出明确错误', emptyError, '随机源没有返回任何字节');

  let rejectionError = '';
  try {
    M.randomChars(['a', 'b', 'c'], 4, () => new Uint8Array([255]).fill(255));
  } catch (cause) {
    rejectionError = cause.message;
  }
  check('随机源永远只给出被拒绝的取值时抛出明确错误', rejectionError, '随机源拒绝了过多取值');

  check('单字符集在 randomChars 里被拒绝', (() => {
    try {
      M.randomChars(['a'], 3, cryptoSource);
      return 'no error';
    } catch (cause) {
      return cause.message;
    }
  })(), '字符集至少需要 2 个字符');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
