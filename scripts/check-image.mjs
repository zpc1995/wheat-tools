/**
 * Checks the pure helpers of the image tool.
 *
 * Canvas work needs a browser, but the maths and parsing do not — and those are
 * where mistakes actually hurt (wrong aspect ratio, wrong byte estimate).
 *
 * Usage: node scripts/check-image.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/image-tool/imageUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/imageUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/imageUtils.mjs').href);

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

console.log('--- 等比缩放 ---');
{
  const r = M.fitDimensions(4000, 3000, 1920);
  check('横图缩放后长边等于上限', Math.max(r.width, r.height), 1920);
  check('宽', r.width, 1920);
  check('高等比', r.height, 1440);
  check('比例记录', Math.round(r.scale * 1000) / 1000, 0.48);
}
{
  const r = M.fitDimensions(3000, 4000, 1920);
  check('竖图长边为高', r.height, 1920);
  check('竖图宽等比', r.width, 1440);
}
{
  const r = M.fitDimensions(800, 600, 1920);
  check('小于上限时不放大', [r.width, r.height, r.scale], [800, 600, 1]);
}
{
  const r = M.fitDimensions(800, 600, null);
  check('不缩放时原样返回', [r.width, r.height, r.scale], [800, 600, 1]);
}
{
  const r = M.fitDimensions(5000, 100, 1000);
  check('极扁图片长边归一', Math.max(r.width, r.height), 1000);
  check('极扁图片短边不小于 1', r.height >= 1, true);
}
{
  const r = M.fitDimensions(1, 4000, 100);
  check('极小宽度不塌陷为 0', r.width >= 1, true);
}
check('正方形等比', M.fitDimensions(1000, 1000, 500).width, 500);
check('无效上限视为不缩放', M.fitDimensions(4000, 3000, 0).scale, 1);
check('负数上限视为不缩放', M.fitDimensions(4000, 3000, -5).scale, 1);

console.log('--- 体积格式化 ---');
check('字节', M.formatBytes(512), '512 B');
check('KB', M.formatBytes(2048), '2.0 KB');
check('MB', M.formatBytes(3 * 1024 * 1024), '3.00 MB');

console.log('--- 压缩比计算 ---');
{
  const s = M.computeSavings(1000, 250);
  check('节省字节', s.savedBytes, 750);
  check('节省百分比', s.savedPercent, 75);
}
{
  const s = M.computeSavings(1000, 1500);
  check('变大时节省为负', s.savedBytes, -500);
  check('变大时百分比为负', s.savedPercent, -50);
}
check('原始为 0 时不除零', M.computeSavings(0, 100).savedPercent, 0);
check('相同大小节省 0', M.computeSavings(500, 500).savedPercent, 0);
check('比率标签（变小）', M.ratioLabel(1000, 500), '2.00× 更小');
check('比率标签（变大）', M.ratioLabel(500, 1000), '2.00× 更大');
check('比率为 0 时给出占位', M.ratioLabel(1000, 0), '—');

console.log('--- data URL 解析 ---');
{
  // 3 bytes encode to 4 base64 characters.
  const info = M.parseDataUrl('data:image/png;base64,AAAA');
  check('mime', info.mime, 'image/png');
  check('base64 长度', info.base64Length, 4);
  check('解码字节数', info.bytes, 3);
}
{
  const info = M.parseDataUrl('data:image/png;base64,AA==');
  check('带填充的字节数', info.bytes, 1);
}
{
  // "hello" is 5 bytes → base64 "aGVsbG8=" (8 chars incl. padding).
  const info = M.parseDataUrl('data:text/plain;base64,aGVsbG8=');
  check('5 字节文本', info.bytes, 5);
  check('mime 为 text/plain', info.mime, 'text/plain');
}
check('非 data URL 返回 null', M.parseDataUrl('https://example.com/a.png') === null, true);
check('空串返回 null', M.parseDataUrl('') === null, true);
check('无 mime 时回退', M.parseDataUrl('data:;base64,AAAA').mime, 'text/plain');
{
  const info = M.parseDataUrl('data:image/svg+xml,%3Csvg%3E');
  check('非 base64 的 data URL 得到解码后长度', info.base64Length, 0);
  check('URL 编码内容长度', info.bytes, 5);
}

console.log('--- Base64 体积估算 ---');
check('0 字节', M.base64Size(0), 0);
check('1 字节 → 4 字符', M.base64Size(1), 4);
check('3 字节 → 4 字符', M.base64Size(3), 4);
check('4 字节 → 8 字符', M.base64Size(4), 8);
check('估算与实际一致（1000 字节）', M.base64Size(1000), 1336);
{
  // Cross-check the estimate against a real encoding.
  const bytes = new Uint8Array(1000).fill(65);
  const real = Buffer.from(bytes).toString('base64').length;
  check('估算与真实编码长度一致', M.base64Size(1000), real);
}

console.log('--- 格式判断 ---');
check('JPEG 支持', M.isSupportedImage('image/jpeg'), true);
check('PNG 支持', M.isSupportedImage('image/png'), true);
check('WebP 支持', M.isSupportedImage('image/webp'), true);
check('GIF 支持', M.isSupportedImage('image/gif'), true);
check('PDF 不支持', M.isSupportedImage('application/pdf'), false);
check('SVG 不支持（canvas 无法直接绘制）', M.isSupportedImage('image/svg+xml'), false);
check('空类型不支持', M.isSupportedImage(''), false);

console.log('--- 输出文件名 ---');
check('JPEG 扩展名', M.outputFileName('photo.png', 'image/jpeg'), 'photo-compressed.jpg');
check('PNG 扩展名', M.outputFileName('photo.jpeg', 'image/png'), 'photo-compressed.png');
check('WebP 扩展名', M.outputFileName('a.b.c.webp', 'image/webp'), 'a.b.c-compressed.webp');
check('无扩展名', M.outputFileName('image', 'image/jpeg'), 'image-compressed.jpg');
// A name that is only an extension (a dotfile) leaves no base, so the generic
// fallback is used rather than emitting a name starting with a dash.
check('点文件回退为通用名', M.outputFileName('.gitignore', 'image/png'), 'image-compressed.png');
check('点文件带扩展名时保留前缀', M.outputFileName('.config.json', 'image/png'), '.config-compressed.png');
check('多重点号只去掉最后一段', M.outputFileName('archive.tar.gz', 'image/png'), 'archive.tar-compressed.png');

console.log('--- 嵌入片段 ---');
{
  const snippets = M.embedSnippets('data:image/png;base64,AAAA', 100, 50);
  check('给出 3 种片段', snippets.length, 3);
  check('片段都含宽度', snippets[0].code.includes('width="100"'), true);
  check('CSS 片段可用', snippets[1].code.includes('background-image'), true);
  check('Markdown 片段可用', snippets[2].code.startsWith('![图片]'), true);
}
{
  // Long data URLs are elided for display but the length is stated.
  const long = `data:image/png;base64,${'A'.repeat(500)}`;
  const snippets = M.embedSnippets(long, 10, 10);
  check('超长 data URL 会省略中间部分', snippets[0].code.includes('共'), true);
  check('省略后仍短于原文', snippets[0].code.length < long.length, true);
}

console.log('--- 默认值与预设 ---');
check('默认质量为 0.8', M.DEFAULT_COMPRESS_OPTIONS.quality, 0.8);
check('默认不输出 PNG（体积收益差）', M.DEFAULT_COMPRESS_OPTIONS.format, 'image/jpeg');
check('默认上限 1920', M.DEFAULT_COMPRESS_OPTIONS.maxDimension, 1920);
check('质量预设数量', M.QUALITY_PRESETS.length, 4);
check('质量预设都在 0-1 之间', M.QUALITY_PRESETS.every((p) => p.value > 0 && p.value <= 1), true);
check('尺寸预设含不缩放', M.DIMENSION_PRESETS.some((p) => p.value === null), true);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
