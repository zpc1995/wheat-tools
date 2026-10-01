/**
 * Checks for JWT decoding and claim interpretation.
 *
 * The tests deliberately build tokens with known payloads so the decoded values
 * are asserted outright, and the "decode ≠ verify" boundary is asserted by the
 * absence of any verification logic in the module.
 *
 * Usage: node scripts/check-jwt.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/jwt-decoder/jwtUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Node provides atob/btoa/TextDecoder globally since v16.
if (typeof globalThis.atob !== 'function') throw new Error('需要全局 atob');

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/jwtUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/jwtUtils.mjs').href);

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

/** Builds a token with base64url-encoded segments. */
const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const token = (header, payload, signature = 'sig') =>
  `${b64url(header)}.${b64url(payload)}.${signature}`;

console.log('--- 解码 ---');
{
  const t = token({ alg: 'HS256', typ: 'JWT' }, { sub: 'user-1', admin: true });
  const r = M.decodeJwt(t);
  check('解码成功', r.ok, true);
  check('header.alg', r.parts.header.alg, 'HS256');
  check('payload.sub', r.parts.payload.sub, 'user-1');
  check('payload 布尔值保真', r.parts.payload.admin, true);
  check('签名段原样保留', r.parts.signature, 'sig');
}
{
  const t = token({ alg: 'RS256' }, { name: '中文名字', emoji: '😀', n: 3.14, nil: null });
  const r = M.decodeJwt(t);
  check('UTF-8 中文正确', r.parts.payload.name, '中文名字');
  check('emoji 正确', r.parts.payload.emoji, '😀');
  check('浮点数正确', r.parts.payload.n, 3.14);
  check('null 保真', r.parts.payload.nil, null);
}
check('示例令牌可解码', M.decodeJwt(M.SAMPLE_JWT).ok, true);

console.log('--- base64url 细节 ---');
check('无填充也能解码', M.base64UrlDecode(b64url({ a: 1 })).includes('"a"'), true);
{
  // Payload containing characters that exercise the url-safe alphabet.
  const t = token({ alg: 'HS256' }, { data: '????>>>>~~~~' });
  check('url-safe 字母表解码正确', M.decodeJwt(t).parts.payload.data, '????>>>>~~~~');
}

console.log('--- 错误处理 ---');
check('空输入被拒', M.decodeJwt('   ').ok, false);
check('两段被拒', M.decodeJwt('aaa.bbb').ok, false);
check('四段被拒', M.decodeJwt('a.b.c.d').ok, false);
check(
  'JWE（5 段）给出专门提示',
  /JWE|加密/.test(M.decodeJwt('a.b.c.d.e').error ?? ''),
  true,
);
check('非 JSON 的 header 被拒', M.decodeJwt('bm90anNvbg.eyJhIjoxfQ.sig').ok, false);
check(
  '错误信息指出是哪一段',
  /Header/.test(M.decodeJwt('bm90anNvbg.eyJhIjoxfQ.sig').error ?? ''),
  true,
);
check('payload 为数组时被拒', M.decodeJwt(`${b64url({ alg: 'none' })}.${b64url([1, 2])}.sig`).ok, false);
check('段数错误的信息含实际段数', /2 段/.test(M.decodeJwt('aaa.bbb').error ?? ''), true);

console.log('--- 时间声明 ---');
{
  const now = 1_700_000_000_000;
  const t = token(
    { alg: 'HS256' },
    { exp: now / 1000 + 3600, iat: now / 1000 - 60, nbf: now / 1000 - 10 },
  );
  const claims = M.extractTimeClaims(M.decodeJwt(t).parts.payload, now);
  check('提取到 3 个时间声明', claims.length, 3);
  check('exp 为未来', claims.find((c) => c.name.startsWith('exp')).state, 'future');
  check('iat 为过去', claims.find((c) => c.name.startsWith('iat')).state, 'past');
  check('含 ISO 时间', claims[0].iso.includes('T'), true);
  check('含相对时间描述', /后|前/.test(claims[0].relative), true);
}
{
  const now = 1_700_000_000_000;
  const onlyStrings = M.extractTimeClaims({ exp: '1700000000' }, now);
  check('字符串形式的时间戳被忽略', onlyStrings.length, 0);
}

console.log('--- 过期判定 ---');
{
  const now = 1_700_000_000_000;
  check('无 exp', M.checkExpiry({}, now).state, 'none');
  check('已过期', M.checkExpiry({ exp: now / 1000 - 10 }, now).state, 'expired');
  check('仍有效', M.checkExpiry({ exp: now / 1000 + 10 }, now).state, 'valid');
  check('nbf 在未来 → 尚未生效', M.checkExpiry({ nbf: now / 1000 + 10 }, now).state, 'not-yet-valid');
  check(
    '尚未生效优先于 exp 判断',
    M.checkExpiry({ nbf: now / 1000 + 10, exp: now / 1000 + 100 }, now).state,
    'not-yet-valid',
  );
  check(
    '措辞不含「有效」以避免与验签混淆',
    /时间上仍有效/.test(M.checkExpiry({ exp: now / 1000 + 10 }, now).message),
    true,
  );
  check(
    '无 exp 时说明不会过期',
    /不会过期/.test(M.checkExpiry({}, now).message),
    true,
  );
}

console.log('--- 算法风险提示 ---');
check('alg=none 被重点提示', M.auditHeader({ alg: 'none' })[0].includes('没有签名'), true);
check('HS256 提示对称密钥风险', /对称算法/.test(M.auditHeader({ alg: 'HS256' }).join('')), true);
check('RS256 提示需要公钥', /公钥/.test(M.auditHeader({ alg: 'RS256' }).join('')), true);
check('jku 被提示', /jku/.test(M.auditHeader({ alg: 'RS256', jku: 'https://x' }).join('')), true);
check('jwk 被提示', /jku\/jwk/.test(M.auditHeader({ alg: 'RS256', jwk: {} }).join('')), true);
check('缺 alg 被提示', /缺少 alg/.test(M.auditHeader({}).join('')), true);
check('正常 header 无多余提示', M.auditHeader({ alg: 'ES256' }).length, 0);

console.log('--- 边界：只解码不验签 ---');
{
  // A token with an obviously bogus signature must still decode: this tool does
  // not verify, and the tests should not imply otherwise.
  const t = `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'attacker' })}.NOT-A-REAL-SIGNATURE`;
  const r = M.decodeJwt(t);
  check('伪造签名的令牌仍可解码（本工具不验签）', r.ok, true);
  check('并且能读出被篡改的内容', r.parts.payload.sub, 'attacker');

  // Assert the module contains no verification API usage at all.
  const { execSync } = require('node:child_process');
  const hits = execSync(
    "grep -nE 'subtle\\.(verify|importKey|sign)|createHmac|verify\\(' src/tools/jwt-decoder/jwtUtils.ts || true",
    { encoding: 'utf8' },
  ).trim();
  check('实现中不存在验签调用', hits, '');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
