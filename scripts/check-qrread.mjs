/**
 * Checks QR decoding and content classification.
 *
 * Two layers are verified:
 *   1. Real decoding — QR codes are generated with the `qrcode` package, turned
 *      into RGBA pixels with `pngjs`, and decoded by the tool's own path. This
 *      is a genuine round trip, not a stub.
 *   2. Classification — WiFi/vCard/otpauth/URL payloads are parsed into fields,
 *      and the security notes that matter (Punycode, `@` in the authority,
 *      `javascript:`) are asserted so they cannot silently disappear.
 *
 * Usage: node scripts/check-qrread.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

let source = readFileSync('src/tools/qrcode-reader/qrReadUtils.ts', 'utf8');
// `jsQR` is a default export from a CJS package; the generated ESM file needs
// Node's interop to resolve it, which it does for the installed package.
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/qrReadUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/qrReadUtils.mjs').href);

const QRCode = require('qrcode');
const { PNG } = require('pngjs');

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

/** Generates a QR code and decodes it through the tool's own path. */
async function roundTrip(text, options = {}) {
  const png = await QRCode.toBuffer(text, {
    type: 'png',
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    width: options.width ?? 400,
    margin: 2,
    color: options.invert
      ? { dark: '#ffffff', light: '#000000' }
      : { dark: '#000000', light: '#ffffff' },
  });
  const image = PNG.sync.read(png);
  return M.decodeImage({
    data: new Uint8ClampedArray(image.data),
    width: image.width,
    height: image.height,
  });
}

console.log('--- 真实往返：生成后解码 ---');
{
  const text = 'https://wheat.chat/tools';
  const result = await roundTrip(text);
  check('解码成功', result.ok, true);
  check('内容一致', result.ok && result.text, text);
  check('返回定位框', result.ok && result.location !== null, true);
  check('返回估算尺寸', result.ok && result.width > 0, true);
  check('返回图像尺寸', result.ok && result.imageWidth > 0, true);
}
{
  const text = '中文与 emoji 😀 混合内容';
  const result = await roundTrip(text);
  check('中文与 emoji 往返正确', result.ok && result.text, text);
}
{
  // A version-23 code needs enough pixels per module; 400 px is genuinely not
  // enough while 600 px is. The width is raised here rather than loosening the
  // assertion, so the test keeps documenting the real limit.
  const text = 'x'.repeat(800);
  const result = await roundTrip(text, { width: 600 });
  check('较长内容往返正确（需足够分辨率）', result.ok && result.text === text, true);

  const tooSmall = await roundTrip(text, { width: 400 });
  check('密集码在低分辨率下解不出（已实测的特性）', tooSmall.ok, false);
  check('失败信息提示换更高分辨率', /分辨率/.test(tooSmall.error ?? ''), true);
}
{
  // Light-on-dark codes are common in designs and need the inversion attempt.
  const text = 'https://inverted.example.com';
  const result = await roundTrip(text, { invert: true });
  check('反色二维码可解码', result.ok && result.text, text);
}
{
  const result = await roundTrip('LOW-EC', { errorCorrectionLevel: 'L' });
  check('低纠错等级可解码', result.ok && result.text, 'LOW-EC');
}

console.log('--- 解码失败的处理 ---');
{
  const blank = new PNG({ width: 100, height: 100 });
  blank.data.fill(255);
  const result = M.decodeImage({
    data: new Uint8ClampedArray(blank.data),
    width: 100,
    height: 100,
  });
  check('空白图返回失败', result.ok, false);
  check('失败信息给出可操作建议', /分辨率|对比度|裁剪/.test(result.error ?? ''), true);
}
check('零尺寸被拒', M.decodeImage({ data: new Uint8ClampedArray(0), width: 0, height: 0 }).ok, false);

console.log('--- 分类：WiFi ---');
{
  const c = M.classify('WIFI:T:WPA;S:MyNetwork;P:s3cret\\;pass;H:true;;');
  check('识别为 WiFi', c.kind, 'wifi');
  check('SSID 正确', c.fields.find((f) => f.label.includes('SSID'))?.value, 'MyNetwork');
  check('密码中的分号被还原', c.fields.find((f) => f.label === '密码')?.value, 's3cret;pass');
  check('加密方式翻译为 WPA/WPA2', c.fields.find((f) => f.label === '加密方式')?.value, 'WPA/WPA2');
  check('标记隐藏网络', c.fields.some((f) => f.label === '隐藏网络' && f.value === '是'), true);
  check('密码被标记为敏感', c.fields.find((f) => f.label === '密码')?.sensitive, true);
  check('给出钓鱼提醒', c.notes.some((n) => /伪造|可信/.test(n)), true);
}
{
  const c = M.classify('WIFI:T:nopass;S:OpenNet;;');
  check('开放网络被特别提示', c.notes.some((n) => /不加密|可被/.test(n)), true);
}
{
  const c = M.classify('WIFI:T:WEP;S:OldNet;P:abc;;');
  check('WEP 被标记为不安全', c.notes.some((n) => /WEP/.test(n)), true);
}

console.log('--- 分类：联系人 ---');
{
  const c = M.classify(`BEGIN:VCARD
VERSION:3.0
FN:张伟
TEL:+8613800138000
EMAIL:zhang@example.com
ORG:示例公司
END:VCARD`);
  check('识别为名片', c.kind, 'vcard');
  check('姓名', c.fields.find((f) => f.label === '姓名')?.value, '张伟');
  check('电话', c.fields.find((f) => f.label === '电话')?.value, '+8613800138000');
  check('邮箱', c.fields.find((f) => f.label === '邮箱')?.value, 'zhang@example.com');
  check('提示替换账号风险', c.notes.some((n) => /收款|账号|可信/.test(n)), true);
}
{
  const c = M.classify('MECARD:N:李娜;TEL:13900139000;;');
  check('识别 MeCard', c.kind, 'vcard');
  check('MeCard 姓名', c.fields.find((f) => f.label === '姓名')?.value, '李娜');
}

console.log('--- 分类：两步验证 ---');
{
  const c = M.classify('otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30');
  check('识别为 2FA', c.kind, 'otpauth');
  check('类型 TOTP', c.fields.find((f) => f.label === '类型')?.value, 'TOTP');
  check('账号被解码', c.fields.find((f) => f.label === '账号')?.value, 'Example:alice@example.com');
  check('发行方', c.fields.find((f) => f.label === '发行方')?.value, 'Example');
  check('密钥被标记为敏感', c.fields.find((f) => f.label === '密钥')?.sensitive, true);
  check('提醒密钥等同第二因素', c.notes.some((n) => /第二因素|不要分享/.test(n)), true);
}
check('畸形 otpauth 不崩溃', M.classify('otpauth://totp/x?secret=').kind, 'otpauth');

console.log('--- 分类：URL 与安全提示 ---');
{
  const c = M.classify('https://wheat.chat/tools?x=1');
  check('识别为网址', c.kind, 'url');
  check('提取域名', c.fields.find((f) => f.label === '域名')?.value, 'wheat.chat');
  check('提示核对域名', c.notes.some((n) => /钓鱼|形近|域名/.test(n)), true);
}
{
  const c = M.classify('https://xn--80ak6aa92e.com/login');
  check('Punycode 被警示', c.notes.some((n) => /Punycode/.test(n)), true);
}
{
  const c = M.classify('https://example.com@evil.com/path');
  check('域名中的 @ 被警示', c.notes.some((n) => /@/.test(n)), true);
}
{
  const c = M.classify('http://plain.example.com');
  check('http 被提示不加密', c.notes.some((n) => /https/.test(n)), true);
}
check('https 不产生 http 提示', M.classify('https://a.com').notes.some((n) => /使用 http/.test(n)), false);

console.log('--- 分类：可执行协议必须被拦下 ---');
for (const dangerous of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:msgbox', 'file:///etc/passwd']) {
  const c = M.classify(dangerous);
  check(`${dangerous.slice(0, 18)}… 被判为危险`, c.kind, 'unknown-scheme');
  check(`  ${dangerous.slice(0, 12)}… 不给成可点击的网址`, c.fields.some((f) => f.label === '完整地址'), false);
  check(`  ${dangerous.slice(0, 12)}… 有明确警示`, c.notes.some((n) => /不会|建议不要/.test(n)), true);
}
{
  const c = M.classify('myapp://open?id=1');
  check('自定义协议单独标注', /自定义协议/.test(c.label), true);
}

console.log('--- 分类：邮件 / 电话 / 短信 / 位置 ---');
check('mailto', M.classify('mailto:a@b.com').kind, 'email');
check('tel', M.classify('tel:+8613800138000').kind, 'phone');
check('phone', M.classify('phone:12345').kind, 'phone');
check('sms', M.classify('smsto:10086:hello').kind, 'sms');
check('geo', M.classify('geo:39.9042,116.4074').kind, 'geo');
{
  const c = M.classify('smsto:10086:hi%20there');
  check('短信内容被解码', c.fields.find((f) => f.label === '内容')?.value, 'hi there');
}
check('陌生号码有费用提醒', M.classify('tel:123').notes.some((n) => /费用|话费/.test(n)), true);

console.log('--- 分类：JSON 与纯文本 ---');
{
  const c = M.classify('{"name":"wheat","count":3}');
  check('识别为 JSON', c.kind, 'json');
  check('JSON 字段被展开', c.fields.map((f) => f.label), ['name', 'count']);
}
check('数组 JSON 不展开字段但仍归类', M.classify('[1,2,3]').kind, 'json');
check('畸形 JSON 退化为文本', M.classify('{not json').kind, 'text');
check('普通文本', M.classify('just some text').kind, 'text');
check('空内容', M.classify('').kind, 'text');

console.log('--- 报告导出 ---');
{
  const text = 'WIFI:T:WPA;S:Net;P:pw;;';
  const report = M.toTextReport(text, M.classify(text));
  check('报告含类型', report.includes('类型：WiFi 配置'), true);
  check('报告含字段', report.includes('SSID'), true);
  check('报告含原始内容', report.includes(text), true);
  check('报告含提示', report.includes('提示：'), true);
}

console.log('--- 上限常量 ---');
check('图片大小上限', M.MAX_IMAGE_BYTES, 12 * 1024 * 1024);
check('解码边长上限放宽到 3000（避免密集码被降采样破坏）', M.MAX_DECODE_DIMENSION, 3000);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
