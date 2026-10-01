/**
 * Checks the hex dump, signature detection and byte analysis.
 *
 * Usage: node scripts/check-hex.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/hex-viewer/hexUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/hexUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/hexUtils.mjs').href);

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

const bytes = (...values) => new Uint8Array(values);

console.log('--- HEX 行构建 ---');
{
  const rows = M.buildHexRows(bytes(0x00, 0x1f, 0x20, 0x41, 0x7e, 0x7f, 0xff), 0, 7);
  check('单行', rows.length, 1);
  check('十六进制大写补零', rows[0].hex, ['00', '1F', '20', '41', '7E', '7F', 'FF']);
  // 0x20 (space) and 0x7E (~) are both printable, and a space renders as a
  // literal space — which is what xxd and hexdump do too.
  check('可打印范围正确（0x20 与 0x7E 可打印）', rows[0].ascii, '.. A~..');
  check('偏移从 0 开始', rows[0].offset, 0);
}
{
  const data = new Uint8Array(40);
  const rows = M.buildHexRows(data, 0, 40);
  check('每行 16 字节 → 3 行', rows.length, 3);
  check('第二行偏移为 16', rows[1].offset, 16);
  check('末行只有 8 字节', rows[2].hex.length, 8);
}
{
  const data = new Uint8Array(32).map((_, i) => i);
  const rows = M.buildHexRows(data, 8, 8);
  check('可只取片段', rows.length, 1);
  check('片段偏移正确', rows[0].offset, 8);
  check('片段内容正确', rows[0].hex, ['08', '09', '0A', '0B', '0C', '0D', '0E', '0F']);
}
check('超出长度返回空', M.buildHexRows(bytes(1, 2), 10, 16).length, 0);
check('空数据返回空', M.buildHexRows(new Uint8Array(0), 0, 16).length, 0);

console.log('--- 文件特征识别 ---');
{
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
  check('识别 PNG', M.detectSignature(png)?.name, 'PNG 图片');
  check('PNG 后缀提示', M.detectSignature(png)?.extension, '.png');
}
check('识别 JPEG', M.detectSignature(bytes(0xff, 0xd8, 0xff, 0xe0))?.name, 'JPEG 图片');
check('识别 PDF', M.detectSignature(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))?.name, 'PDF 文档');
check('识别 ZIP', M.detectSignature(bytes(0x50, 0x4b, 0x03, 0x04))?.name, 'ZIP / docx / xlsx');
check('识别 GZIP', M.detectSignature(bytes(0x1f, 0x8b, 0x08))?.name, 'GZIP 压缩');
check('识别 ELF', M.detectSignature(bytes(0x7f, 0x45, 0x4c, 0x46))?.name, 'ELF 可执行');
check('识别 SQLite', M.detectSignature(bytes(0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66))?.name, 'SQLite 数据库');
{
  // MP4 carries its signature at offset 4 (`ftyp`), not 0.
  const mp4 = bytes(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70);
  check('识别偏移 4 的 MP4 特征', M.detectSignature(mp4)?.name, 'MP4 / MOV');
}
check('未知数据返回 null', M.detectSignature(bytes(0x01, 0x02, 0x03, 0x04)) === null, true);
check('空数据返回 null', M.detectSignature(new Uint8Array(0)) === null, true);
check('短于特征的数据不误判', M.detectSignature(bytes(0x89, 0x50)) === null, true);
{
  // Every declared signature must be detectable from its own prefix, which
  // catches typos in the tables rather than trusting them.
  const selfConsistent = M.SIGNATURES.every((sig) => {
    const buffer = new Uint8Array((sig.offset ?? 0) + sig.bytes.length).fill(0xff);
    sig.bytes.forEach((b, i) => { buffer[(sig.offset ?? 0) + i] = b; });
    return M.detectSignature(buffer) !== null;
  });
  check('所有内置特征都能被自身前缀识别', selfConsistent, true);
  check('特征表无重复长度为零的项', M.SIGNATURES.every((s) => s.bytes.length > 0), true);
}

console.log('--- 字节统计 ---');
{
  const stats = M.analyseBytes(bytes(0, 0, 65, 65));
  check('总数', stats.total, 4);
  check('零字节计数', stats.nullBytes, 2);
  check('可打印占比（2/4）', stats.printableRatio, 0.5);
  check('直方图统计正确', stats.histogram[65], 2);
}
{
  // All 256 values once each → maximum entropy.
  const all = new Uint8Array(256).map((_, i) => i);
  const stats = M.analyseBytes(all);
  check('均匀分布熵为 8', Math.round(stats.entropy * 1000) / 1000, 8);
}
check('单一值熵为 0', M.analyseBytes(bytes(7, 7, 7, 7)).entropy, 0);
check('空数据熵为 0', M.analyseBytes(new Uint8Array(0)).entropy, 0);
check('空数据占比为 0', M.analyseBytes(new Uint8Array(0)).printableRatio, 0);

console.log('--- 文本判定与解码 ---');
check('纯文本判定为文本', M.looksLikeText(new TextEncoder().encode('hello world')), true);
check('二进制判定为非文本', M.looksLikeText(bytes(0, 1, 2, 3, 0, 5, 0, 7)), false);
check('空数据不是文本', M.looksLikeText(new Uint8Array(0)), false);
check('UTF-8 解码中文', M.decodeText(new TextEncoder().encode('中文'), 'utf-8'), '中文');
check('Latin-1 解码高字节', M.decodeText(bytes(0xe9), 'latin1'), 'é');

console.log('--- 字符串提取 ---');
{
  const data = new TextEncoder().encode('hi\x00https://wheat.chat\x00path/to/file.txt\x01');
  const hits = M.extractStrings(data, 4);
  check('提取到 2 条（排除过短的 hi）', hits.length, 2);
  check('包含 URL', hits[0].text.includes('https://wheat.chat'), true);
  check('包含路径', hits[1].text.includes('path/to/file.txt'), true);
  check('偏移正确', hits[0].offset, 3);
  check('标记为 ascii', hits[0].encoding, 'ascii');
}
check('过短字符串被过滤', M.extractStrings(new TextEncoder().encode('ab\x00cd\x00'), 4).length, 0);
check('空数据无结果', M.extractStrings(new Uint8Array(0)).length, 0);
{
  const many = new Uint8Array(20000);
  for (let i = 0; i < many.length; i += 10) {
    'abcdefgh'.split('').forEach((c, k) => { many[i + k] = c.charCodeAt(0); });
  }
  const hits = M.extractStrings(many, 4, 50);
  check('遵守条数上限', hits.length <= 50, true);
}
{
  const data = new TextEncoder().encode('中文内容测试\x00');
  const hits = M.extractStrings(data, 4);
  check('UTF-8 中文被正确提取', hits[0]?.text, '中文内容测试');
  check('标记为 utf-8', hits[0]?.encoding, 'utf-8');
}

console.log('--- 尺寸格式化 ---');
check('字节', M.formatSize(512), '512 B');
check('KiB', M.formatSize(2048), '2.0 KiB');
check('MiB', M.formatSize(5 * 1024 * 1024), '5.0 MiB');
check('GiB', M.formatSize(3 * 1024 * 1024 * 1024), '3.00 GiB');

console.log('--- 多宽度解读 ---');
{
  const data = bytes(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08);
  const widths = M.readWidths(data, 0);
  check('uint8', widths.little['uint8'], 1);
  check('小端 uint16', widths.little['uint16'], 0x0201);
  check('大端 uint16', widths.big['uint16'], 0x0102);
  check('小端 uint32', widths.little['uint32'], 0x04030201);
  check('大端 uint32', widths.big['uint32'], 0x01020304);
}
{
  const widths = M.readWidths(bytes(0x01), 0);
  check('数据不足时不产生 4 字节解读', widths.little['uint32'], undefined);
  check('仍能解读 1 字节', widths.little['uint8'], 1);
}
check('偏移越界返回 null', M.readWidths(bytes(1, 2), 5) === null, true);
check('上限常量为 32 MiB', M.MAX_FILE_BYTES, 32 * 1024 * 1024);
check('每行 16 字节', M.BYTES_PER_ROW, 16);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
