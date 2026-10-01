/**
 * Correctness checks for colour parsing and conversion.
 *
 * Colour maths is easy to get subtly wrong (especially HSL/HSV round-trips),
 * so every conversion is checked against known values.
 *
 * Usage: node scripts/check-color.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/color-converter/colorUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const M = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

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

const rgb = (r, g, b, a = 1) => ({ r, g, b, a });

console.log('--- 解析 ---');
check('#f00 (3位)', M.parseColor('#f00').color, rgb(255, 0, 0));
check('#ff0000 (6位)', M.parseColor('#ff0000').color, rgb(255, 0, 0));
check('#ff000080 (8位含 alpha)', M.parseColor('#ff000080').color, rgb(255, 0, 0, 0.502));
check('#f008 (4位含 alpha)', M.parseColor('#f008').color, rgb(255, 0, 0, 0.533));
check('大小写与空格', M.parseColor('  #FF0000  ').color, rgb(255, 0, 0));
check('rgb()', M.parseColor('rgb(255, 0, 0)').color, rgb(255, 0, 0));
check('rgb(空格分隔)', M.parseColor('rgb(255 0 0)').color, rgb(255, 0, 0));
check('rgba()', M.parseColor('rgba(255,0,0,0.5)').color, rgb(255, 0, 0, 0.5));
check('rgb 百分比', M.parseColor('rgb(100%, 0%, 0%)').color, rgb(255, 0, 0));
check('hsl()', M.parseColor('hsl(0, 100%, 50%)').color, rgb(255, 0, 0));
check('hsl 绿色', M.parseColor('hsl(120, 100%, 50%)').color, rgb(0, 255, 0));
check('hsl 蓝色', M.parseColor('hsl(240, 100%, 50%)').color, rgb(0, 0, 255));
check('hsv()', M.parseColor('hsv(0, 100%, 100%)').color, rgb(255, 0, 0));
check('颜色名 red', M.parseColor('red').color, rgb(255, 0, 0));
check('颜色名 transparent', M.parseColor('transparent').color, rgb(0, 0, 0, 0));
check('非法：长度不符', M.parseColor('#ff00').ok, true);
check('非法：错长度', M.parseColor('#fffff').ok, false);
check('非法：非 hex 字符', M.parseColor('#gggggg').ok, false);
check('非法：任意文本', M.parseColor('不是颜色').ok, false);
check('空输入', M.parseColor('   ').ok, false);

console.log('--- 输出格式 ---');
check('toHex 补零', M.toHex(rgb(1, 2, 3)), '#010203');
check('toHex 带 alpha', M.toHex(rgb(255, 0, 0, 0.5), true), '#ff000080');
check('toRgbString 不透明', M.toRgbString(rgb(255, 0, 0)), 'rgb(255, 0, 0)');
check('toRgbString 半透明', M.toRgbString(rgb(255, 0, 0, 0.5)), 'rgba(255, 0, 0, 0.5)');
check('toHslString', M.toHslString(rgb(255, 0, 0)), 'hsl(0, 100%, 50%)');
check('toHsvString', M.toHsvString(rgb(255, 0, 0)), 'hsv(0, 100%, 100%)');

console.log('--- 转换数学 ---');
check('rgbToHsl 白', M.rgbToHsl(rgb(255, 255, 255)), { h: 0, s: 0, l: 100 });
check('rgbToHsl 黑', M.rgbToHsl(rgb(0, 0, 0)), { h: 0, s: 0, l: 0 });
check('rgbToHsl 灰', M.rgbToHsl(rgb(128, 128, 128)), { h: 0, s: 0, l: 50.2 });
check('rgbToHsl 青', M.rgbToHsl(rgb(0, 255, 255)), { h: 180, s: 100, l: 50 });
check('rgbToHsv 青', M.rgbToHsv(rgb(0, 255, 255)), { h: 180, s: 100, v: 100 });
check('rgbToCmyk 红', M.rgbToCmyk(rgb(255, 0, 0)), { c: 0, m: 100, y: 100, k: 0 });
check('rgbToCmyk 黑', M.rgbToCmyk(rgb(0, 0, 0)), { c: 0, m: 0, y: 0, k: 100 });
check('rgbToCmyk 白', M.rgbToCmyk(rgb(255, 255, 255)), { c: 0, m: 0, y: 0, k: 0 });

// Round-trip every hue at full saturation/lightness through HSL and HSV.
console.log('--- 往返一致（HSL / HSV）---');
let hslOk = true;
let hsvOk = true;
for (let h = 0; h < 360; h += 7) {
  const source = M.hslToRgb({ h, s: 73, l: 41 });
  const back = M.rgbToHsl(source);
  const again = M.hslToRgb(back);
  if (
    Math.abs(again.r - source.r) > 1 ||
    Math.abs(again.g - source.g) > 1 ||
    Math.abs(again.b - source.b) > 1
  ) {
    hslOk = false;
    console.log('  HSL 往返失败 h=' + h, source, again);
  }

  const source2 = M.hsvToRgb({ h, s: 66, v: 88 });
  const back2 = M.rgbToHsv(source2);
  const again2 = M.hsvToRgb(back2);
  if (
    Math.abs(again2.r - source2.r) > 1 ||
    Math.abs(again2.g - source2.g) > 1 ||
    Math.abs(again2.b - source2.b) > 1
  ) {
    hsvOk = false;
    console.log('  HSV 往返失败 h=' + h, source2, again2);
  }
}
check('HSL 全色相往返', hslOk, true);
check('HSV 全色相往返', hsvOk, true);

console.log('--- 对比度与可读色 ---');
check('黑白对比度 21', M.contrastWith(rgb(0, 0, 0), rgb(255, 255, 255)), 21);
check('同色对比度 1', M.contrastWith(rgb(120, 120, 120), rgb(120, 120, 120)), 1);
check('浅底选黑字', M.readableTextColor(rgb(255, 255, 0)), '#000000');
check('深底选白字', M.readableTextColor(rgb(0, 0, 128)), '#ffffff');

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
