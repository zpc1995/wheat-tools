/**
 * Correctness and safety checks for the AES tool.
 *
 * Run under Node's WebCrypto so the same code path as the browser is exercised.
 * The cases that matter: password→key derivation must actually happen (a wrong
 * password must fail), GCM must detect tampering, and the IV/salt must be
 * random per message.
 *
 * Usage: node scripts/check-aes.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// Node 22 already exposes a full WebCrypto implementation as `globalThis.crypto`
// (and it is a read-only getter, so it must not be reassigned). `btoa`/`atob`
// are global since Node 16. Assert rather than polyfill, so a future Node that
// drops them fails loudly instead of silently testing something else.
if (typeof globalThis.crypto?.subtle !== 'object') {
  throw new Error('本检查需要 Node 的 WebCrypto（globalThis.crypto.subtle）');
}
if (typeof globalThis.btoa !== 'function' || typeof globalThis.atob !== 'function') {
  throw new Error('本检查需要全局 btoa/atob');
}

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/aes-crypto/aesUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
const modulePath = '.verify/aesUtils.mjs';
writeFileSync(modulePath, compiled);

const M = await import(pathToFileURL(modulePath).href);

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

// Keep iterations low in tests so the suite stays fast; the production default
// is asserted separately.
const FAST = { iterations: 1000 };

console.log('--- 往返（GCM）---');
for (const text of ['hello', '中文与 emoji 😀', '', 'a'.repeat(1000), 'line1\nline2\ttab']) {
  const label = text === '' ? '空串' : JSON.stringify(text.slice(0, 18));
  if (text === '') {
    // Empty plaintext is rejected by the API, which is intentional.
    const result = await M.encrypt(text, { password: 'pw', algorithm: 'AES-GCM', ...FAST });
    check(`${label}：拒绝空明文`, result.ok, false);
    continue;
  }
  const enc = await M.encrypt(text, { password: 'pw', algorithm: 'AES-GCM', ...FAST });
  const dec = enc.ok ? await M.decrypt(enc.text, 'pw') : { ok: false, error: 'encrypt failed' };
  check(`${label}：往返一致`, dec.ok && dec.plaintext, text);
}

console.log('--- 往返（CBC）---');
{
  const enc = await M.encrypt('cbc 测试内容', { password: 'pw', algorithm: 'AES-CBC', ...FAST });
  const dec = enc.ok ? await M.decrypt(enc.text, 'pw') : { ok: false };
  check('CBC 往返一致', dec.ok && dec.plaintext, 'cbc 测试内容');
  check('CBC 记录算法', enc.ok && enc.envelope.alg, 'AES-CBC');
  check('CBC IV 为 16 字节', enc.ok && M.parseEnvelope(enc.text).envelope.iv.length, 24);
}

console.log('--- 口令与密钥派生 ---');
{
  const enc = await M.encrypt('secret', { password: 'correct', algorithm: 'AES-GCM', ...FAST });
  const wrong = enc.ok ? await M.decrypt(enc.text, 'incorrect') : { ok: false, error: '' };
  check('错误口令解密失败', wrong.ok, false);
  check('错误口令给出可读原因', /口令不正确|篡改/.test(wrong.error ?? ''), true);

  const right = enc.ok ? await M.decrypt(enc.text, 'correct') : { ok: false };
  check('正确口令成功', right.ok && right.plaintext, 'secret');

  // If the password were used directly as a key (no KDF), these would be equal.
  const a = await M.encrypt('same', { password: 'pw', algorithm: 'AES-GCM', ...FAST });
  const b = await M.encrypt('same', { password: 'pw', algorithm: 'AES-GCM', ...FAST });
  check(
    '相同明文两次加密密文不同（随机 salt/IV）',
    a.ok && b.ok && a.envelope.data !== b.envelope.data,
    true,
  );
  check(
    '两次 salt 不同',
    a.ok && b.ok && a.envelope.salt !== b.envelope.salt,
    true,
  );
  check(
    '两次 IV 不同',
    a.ok && b.ok && a.envelope.iv !== b.envelope.iv,
    true,
  );
}

console.log('--- GCM 完整性校验 ---');
{
  const enc = await M.encrypt('tamper me', { password: 'pw', algorithm: 'AES-GCM', ...FAST });
  check('加密成功', enc.ok, true);

  // Flip one character of the ciphertext; GCM's tag must reject it.
  const parsed = M.parseEnvelope(enc.text);
  const data = parsed.envelope.data;
  const flipped = data[0] === 'A' ? `B${data.slice(1)}` : `A${data.slice(1)}`;
  const tampered = M.formatEnvelope({ ...parsed.envelope, data: flipped });
  const result = await M.decrypt(tampered, 'pw');
  check('篡改密文被拒绝（GCM）', result.ok, false);
  check('篡改给出校验失败说明', /校验|篡改|口令/.test(result.error ?? ''), true);

  // Tampering with the IV must also fail.
  const ivFlipped = `${parsed.envelope.iv[0] === 'A' ? 'B' : 'A'}${parsed.envelope.iv.slice(1)}`;
  const ivTampered = M.formatEnvelope({ ...parsed.envelope, iv: ivFlipped });
  check('篡改 IV 被拒绝', (await M.decrypt(ivTampered, 'pw')).ok, false);
}

console.log('--- 信封解析 ---');
{
  const enc = await M.encrypt('x', { password: 'pw', algorithm: 'AES-GCM', ...FAST });
  check('信封带 WTENC1 前缀', enc.ok && enc.text.startsWith('WTENC1:'), true);

  // Bare JSON without the prefix must still work.
  const bare = enc.text.replace(/^WTENC1:/, '');
  check('无前缀也可解析', (await M.decrypt(bare, 'pw')).ok, true);

  check('空输入被拒', M.parseEnvelope('  ').ok, false);
  check('非 JSON 被拒', M.parseEnvelope('not json').ok, false);
  check('缺字段被拒', M.parseEnvelope('WTENC1:{"salt":"a"}').ok, false);
  check(
    '缺字段错误列出缺失项',
    /iv|data/.test(M.parseEnvelope('WTENC1:{"salt":"a"}').error ?? ''),
    true,
  );
  check('裸 Base64 被拒并提示缺少元数据', M.parseEnvelope('YWJj').ok, false);
  check(
    '裸 Base64 的提示提到 salt/iv',
    /salt|iv/i.test(M.parseEnvelope('YWJj').error ?? ''),
    true,
  );

  // Defaults: a missing `iter` falls back to the production value.
  const noIter = M.parseEnvelope('WTENC1:{"alg":"AES-GCM","salt":"AA==","iv":"AA==","data":"AA=="}');
  check('缺少 iter 时使用默认迭代数', noIter.envelope.iter, M.PBKDF2_ITERATIONS);
  check('未知算法回退为 GCM', M.parseEnvelope('WTENC1:{"alg":"X","salt":"A","iv":"B","data":"C"}').envelope.alg, 'AES-GCM');
}

console.log('--- 参数与描述 ---');
check('默认迭代数为 210000', M.PBKDF2_ITERATIONS, 210_000);
check('盐为 16 字节', M.SALT_BYTES, 16);
{
  const enc = await M.encrypt('x', { password: 'pw', algorithm: 'AES-GCM', ...FAST });
  const rows = M.describeEnvelope(enc.envelope);
  check('描述包含算法', rows.some(([k, v]) => k === '算法' && v === 'AES-GCM'), true);
  check('描述标注 GCM 完整性', rows.some(([, v]) => v.includes('认证标签')), true);
  check('描述标注 CBC 无校验', (() => {
    const cbc = M.describeEnvelope({ ...enc.envelope, alg: 'AES-CBC' });
    return cbc.some(([, v]) => v.includes('无完整性'));
  })(), true);
}

console.log('--- 二进制（文件）模式 ---');
{
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 0x89, 0x50]);
  const enc = await M.encryptBytes(bytes, { password: 'pw', algorithm: 'AES-GCM', ...FAST });
  check('二进制加密成功', enc.ok, true);
  const dec = enc.ok ? await M.decryptBytes(enc.text, 'pw') : { ok: false };
  check('二进制往返一致', dec.ok && Array.from(dec.bytes), Array.from(bytes));
  check('空文件被拒', (await M.encryptBytes(new Uint8Array(0), { password: 'pw', algorithm: 'AES-GCM', ...FAST })).ok, false);
}

console.log('--- 口令校验 ---');
check('空口令拒绝加密', (await M.encrypt('x', { password: '', algorithm: 'AES-GCM', ...FAST })).ok, false);
check('空口令拒绝解密', (await M.decrypt('WTENC1:{}', '')).ok, false);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
