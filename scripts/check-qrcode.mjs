/**
 * Round-trip verification for QR generation.
 *
 * Generating a QR code is easy to get subtly wrong, so this does not trust the
 * encoder: it renders each QR to a real image and decodes it back with an
 * independent implementation (`jsqr`), asserting the payload survives intact —
 * across every error-correction level, content type and size.
 *
 * Usage: node scripts/check-qrcode.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');
const jsQR = require('jsqr').default ?? require('jsqr');
const { PNG } = require('pngjs');

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

/** Renders `text` and decodes the resulting PNG back to a string. */
async function roundTrip(text, options = {}) {
  const buffer = await QRCode.toBuffer(text, {
    type: 'png',
    width: 320,
    margin: 2,
    ...options,
  });
  const png = PNG.sync.read(buffer);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return decoded ? decoded.data : null;
}

const LEVELS = ['L', 'M', 'Q', 'H'];

console.log('--- 各纠错等级下的往返 ---');
for (const level of LEVELS) {
  const payload = `https://wheat.chat/#/tools/qrcode-generator?level=${level}`;
  check(`纠错等级 ${level}`, await roundTrip(payload, { errorCorrectionLevel: level }), payload);
}

console.log('\n--- 内容类型 ---');
const cases = [
  ['纯数字', '12345678901234567890'],
  ['字母数字', 'HELLO WORLD 123 $%*+-./:'],
  ['ASCII 网址', 'https://github.com/zpc1995/wheat-tools'],
  ['中文', '麦工具 · 二维码生成器'],
  ['emoji', '🌾 wheat tools 🚀'],
  ['多行文本', 'line1\nline2\nline3'],
  ['短文本', 'a'],
  ['JSON', '{"name":"wheat-tools","ok":true}'],
  ['vCard', 'BEGIN:VCARD\nVERSION:3.0\nFN:麦工具\nEND:VCARD'],
  ['长文本(500 字)', 'x'.repeat(500)],
  ['长文本(1500 字)', 'y'.repeat(1500)],
];
for (const [label, payload] of cases) {
  check(label, await roundTrip(payload), payload);
}

console.log('\n--- 编码模式与容量 ---');
check(
  '纯数字走 numeric 模式',
  await roundTrip('9'.repeat(100), { errorCorrectionLevel: 'M' }),
  '9'.repeat(100),
);
check(
  'H 等级下的长中文',
  await roundTrip('麦'.repeat(60), { errorCorrectionLevel: 'H' }),
  '麦'.repeat(60),
);

console.log('\n--- 颜色与尺寸不影响可解码性 ---');
{
  const payload = 'https://wheat.chat/';
  check(
    '深色前景 + 浅色背景（反色）',
    await roundTrip(payload, { color: { dark: '#1b3a1bff', light: '#f2fbf0ff' } }),
    payload,
  );
  check('小尺寸 120px', await roundTrip(payload, { width: 120 }), payload);
  check('大尺寸 800px', await roundTrip(payload, { width: 800 }), payload);
  check('无边距', await roundTrip(payload, { margin: 0 }), payload);
}

console.log('\n--- 应有的输入校验 ---');
{
  // An empty payload must be rejected rather than producing a useless code.
  let emptyRejected = false;
  try {
    await QRCode.toBuffer('', { type: 'png' });
  } catch {
    emptyRejected = true;
  }
  check('空字符串被拒绝', emptyRejected, true);

  // Capacity overflow for the chosen level must throw, not truncate.
  let overflowRejected = false;
  try {
    await QRCode.toBuffer('z'.repeat(5000), { errorCorrectionLevel: 'H' });
  } catch {
    overflowRejected = true;
  }
  check('超出容量时抛错', overflowRejected, true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
