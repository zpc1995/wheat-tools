/**
 * Correctness checks for unit conversion.
 *
 * Values are asserted against authoritative definitions (NIST exact values
 * where they exist) rather than against the implementation's own output, so a
 * wrong factor cannot pass.
 *
 * Usage: node scripts/check-units.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/unit-converter/unitUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/unitUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/unitUtils.mjs').href);

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

const near = (actual, expected, tolerance = 1e-6) =>
  typeof actual === 'number' && Math.abs(actual - expected) <= Math.max(Math.abs(expected) * tolerance, tolerance);

const cat = (id) => M.findCategory(id);
const conv = (value, from, to, categoryId) => {
  const r = M.convert(value, from, to, cat(categoryId));
  return r.ok ? r.value : `ERR:${r.error}`;
};

console.log('--- 长度（NIST 精确值）---');
check('1 in = 2.54 cm', conv(1, 'in', 'cm', 'length'), 2.54);
// Ratio chains cannot be exact in binary floating point (0.3048/0.0254 is
// 12.000000000000002), so near-exact values are compared with a tolerance.
check('1 ft = 12 in', near(conv(1, 'ft', 'in', 'length'), 12), true);
check('1 mi = 1609.344 m', conv(1, 'mi', 'm', 'length'), 1609.344);
check('1 nmi = 1852 m', conv(1, 'nmi', 'm', 'length'), 1852);
check('1 yd = 3 ft', conv(1, 'yd', 'ft', 'length'), 3);
check('1 km = 1000 m', conv(1, 'km', 'm', 'length'), 1000);
check('1 市里 = 500 m', conv(1, 'li', 'm', 'length'), 500);
check('1 m = 100 cm', conv(1, 'm', 'cm', 'length'), 100);

console.log('--- 重量 ---');
check('1 lb = 453.59237 g', near(conv(1, 'lb', 'g', 'mass'), 453.59237), true);
check('1 oz = 28.349523125 g', near(conv(1, 'oz', 'g', 'mass'), 28.349523125), true);
check('1 市斤 = 500 g', conv(1, 'jin', 'g', 'mass'), 500);
check('1 市斤 = 10 市两', conv(1, 'jin', 'liang', 'mass'), 10);
check('1 t = 1000 kg', conv(1, 't', 'kg', 'mass'), 1000);
check('1 stone = 14 lb', near(conv(1, 'stone', 'lb', 'mass'), 14), true);

console.log('--- 温度（仿射变换，非比例）---');
check('0 °C = 32 °F', conv(0, 'c', 'f', 'temperature'), 32);
check('100 °C = 212 °F', conv(100, 'c', 'f', 'temperature'), 212);
check('-40 °C = -40 °F', conv(-40, 'c', 'f', 'temperature'), -40);
check('0 °C = 273.15 K', conv(0, 'c', 'k', 'temperature'), 273.15);
check('32 °F = 0 °C', conv(32, 'f', 'c', 'temperature'), 0);
check('212 °F = 100 °C', conv(212, 'f', 'c', 'temperature'), 100);
check('273.15 K = 0 °C', conv(273.15, 'k', 'c', 'temperature'), 0);
check('0 K = -273.15 °C', conv(0, 'k', 'c', 'temperature'), -273.15);
check('37 °C = 98.6 °F', near(conv(37, 'c', 'f', 'temperature'), 98.6), true);
// The bug this guards against: treating temperature as a ratio would give 0.
check('0 °C 不等于 0 °F', conv(0, 'c', 'f', 'temperature') !== 0, true);

console.log('--- 面积 ---');
check('1 公顷 = 10000 m²', conv(1, 'ha', 'm2', 'area'), 10000);
check('1 亩 ≈ 666.67 m²', near(conv(1, 'mu', 'm2', 'area'), 666.6666666667, 1e-9), true);
check('1 acre = 4046.8564224 m²', near(conv(1, 'acre', 'm2', 'area'), 4046.8564224), true);
check('1 km² = 100 公顷', conv(1, 'km2', 'ha', 'area'), 100);

console.log('--- 体积 ---');
check('1 L = 1000 mL', conv(1, 'l', 'ml', 'volume'), 1000);
check('1 m³ = 1000 L', conv(1, 'm3', 'l', 'volume'), 1000);
check('1 美制加仑 = 3.785411784 L', near(conv(1, 'gal-us', 'l', 'volume'), 3.785411784), true);
check('1 英制加仑 = 4.54609 L', near(conv(1, 'gal-uk', 'l', 'volume'), 4.54609), true);
check('1 杯 = 8 液盎司', near(conv(1, 'cup', 'floz-us', 'volume'), 8), true);
check('1 汤匙 = 3 茶匙', near(conv(1, 'tbsp', 'tsp', 'volume'), 3), true);

console.log('--- 速度 ---');
check('1 m/s = 3.6 km/h', near(conv(1, 'mps', 'kmh', 'speed'), 3.6), true);
check('1 mph = 1.609344 km/h', near(conv(1, 'mph', 'kmh', 'speed'), 1.609344), true);
check('1 kn = 1.852 km/h', near(conv(1, 'kn', 'kmh', 'speed'), 1.852), true);

console.log('--- 存储（十进制 vs 二进制）---');
check('1 kB = 1000 B', conv(1, 'kb', 'b', 'storage'), 1000);
check('1 KiB = 1024 B', conv(1, 'kib', 'b', 'storage'), 1024);
check('1 MiB = 1048576 B', conv(1, 'mib', 'b', 'storage'), 1048576);
check('1 GiB = 1073741824 B', conv(1, 'gib', 'b', 'storage'), 1073741824);
check('1 MiB = 1.048576 MB', near(conv(1, 'mib', 'mb', 'storage'), 1.048576), true);
check('1 B = 8 bit', near(conv(1, 'b', 'bit', 'storage'), 8), true);
check('1 TiB = 1024 GiB', conv(1, 'tib', 'gib', 'storage'), 1024);

console.log('--- 时间 ---');
check('1 h = 3600 s', conv(1, 'h', 's', 'time'), 3600);
check('1 d = 24 h', conv(1, 'd', 'h', 'time'), 24);
check('1 wk = 7 d', conv(1, 'wk', 'd', 'time'), 7);
check('1 yr = 365 d', conv(1, 'yr', 'd', 'time'), 365);

console.log('--- 压力 ---');
check('1 atm = 101325 Pa', conv(1, 'atm', 'pa', 'pressure'), 101325);
check('1 bar = 100000 Pa', conv(1, 'bar', 'pa', 'pressure'), 100000);
check('1 psi ≈ 6894.757 Pa', near(conv(1, 'psi', 'pa', 'pressure'), 6894.757293168), true);
check('1 atm ≈ 760 mmHg', near(conv(1, 'atm', 'mmhg', 'pressure'), 760, 1e-5), true);

console.log('--- 能量 ---');
check('1 kcal = 4184 J', conv(1, 'kcal', 'j', 'energy'), 4184);
check('1 kWh = 3600000 J', conv(1, 'kwh', 'j', 'energy'), 3600000);
check('1 Wh = 3600 J', conv(1, 'wh', 'j', 'energy'), 3600);

console.log('--- 双向与自洽 ---');
{
  let ok = true;
  for (const category of M.CATEGORIES) {
    for (const from of category.units) {
      for (const to of category.units) {
        const there = M.convert(123.456, from.id, to.id, category);
        if (!there.ok) { ok = false; console.log(`  ${category.id} ${from.id}→${to.id} 失败`); continue; }
        const back = M.convert(there.value, to.id, from.id, category);
        if (!back.ok || !near(back.value, 123.456, 1e-9)) {
          ok = false;
          console.log(`  ${category.id} ${from.id}→${to.id}→${from.id} = ${back.ok ? back.value : 'ERR'}`);
        }
      }
    }
  }
  check('全部类别内单位两两往返自洽', ok, true);
}
{
  let sameOk = true;
  for (const category of M.CATEGORIES) {
    for (const unit of category.units) {
      const r = M.convert(42, unit.id, unit.id, category);
      if (!r.ok || Math.abs(r.value - 42) > 1e-9) {
        sameOk = false;
        console.log(`  ${category.id} ${unit.id} 自转换异常:`, r.ok ? r.value : r.error);
      }
    }
  }
  check('同单位转换恒等', sameOk, true);
}

console.log('--- 输入解析 ---');
{
  const parsed = M.parseQuantity('12.5 cm', cat('length'));
  check('解析带单位的值', parsed && parsed.value, 12.5);
  check('识别单位', parsed && parsed.unit.id, 'cm');
  const kg = M.parseQuantity('3kg', cat('mass'));
  check('无空格也可解析', kg && kg.unit.id, 'kg');
  const plain = M.parseQuantity('42', cat('length'));
  check('无单位回退到基准单位', plain && plain.unit.id, 'm');
  check('无法解析时返回 null', M.parseQuantity('abc', cat('length')), null);
  check('空串返回 null', M.parseQuantity('   ', cat('length')), null);
}

console.log('--- 错误处理与格式化 ---');
check('未知单位被拒', M.convert(1, 'nope', 'm', cat('length')).ok, false);
check('NaN 被拒', M.convert(Number.NaN, 'm', 'cm', cat('length')).ok, false);
check('格式化整数', M.formatNumber(100), '100');
check('格式化小数去尾零', M.formatNumber(2.5), '2.5');
check('极小值用科学计数法', M.formatNumber(1e-9).includes('e'), true);
check('极大值用科学计数法', M.formatNumber(1e18).includes('e'), true);
check('零', M.formatNumber(0), '0');
{
  const all = M.convertAll(1, 'm', cat('length'));
  check('convertAll 覆盖全部单位', all.length, cat('length').units.length);
  check('convertAll 含基准单位自身', all.some((item) => item.unit.id === 'm' && item.value === 1), true);
}

console.log('--- 类别完整性 ---');
{
  let shapeOk = true;
  for (const category of M.CATEGORIES) {
    if (!category.units.some((unit) => unit.id === category.baseUnit)) {
      shapeOk = false;
      console.log(`  ${category.id} 缺少基准单位 ${category.baseUnit}`);
    }
    for (const unit of category.units) {
      const defined = typeof unit.factor === 'number' || (unit.toBase && unit.fromBase);
      if (!defined) {
        shapeOk = false;
        console.log(`  ${category.id}/${unit.id} 缺少换算定义`);
      }
      if (unit.factor !== undefined && unit.toBase) {
        shapeOk = false;
        console.log(`  ${category.id}/${unit.id} 同时定义了 factor 与 toBase`);
      }
    }
  }
  check('每个单位都有换算定义且基准单位存在', shapeOk, true);
  check('单位 id 在类别内唯一', M.CATEGORIES.every((c) => new Set(c.units.map((u) => u.id)).size === c.units.length), true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
