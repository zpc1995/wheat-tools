/**
 * Checks the percentage calculator's arithmetic.
 *
 * The oracle is deliberately boring: the check script computes the answers a
 * second time with the plain expressions a person would write on paper
 * (`a * b / 100`, `(to - from) / from * 100`) and compares. Percent change and
 * percent difference are additionally checked against their textbook
 * definitions, and the "round trip" of a rise and a fall is asserted to *fail*
 * to return the original, because that failure is the point of the card.
 *
 * Rounding is compared against the naive implementations as well — the suite
 * asserts that `Math.round(1.005 * 100) / 100` is 1 and that the tool's answer
 * is 1.01, so the reason the exponent-shifting implementation exists is
 * demonstrated rather than asserted in a comment.
 *
 * Usage: node scripts/check-percentage-calculator.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync(
  'src/tools/percentage-calculator/percentageUtils.ts',
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/percentage-calculator.mjs', compiled);
const M = await import(pathToFileURL('.verify/percentage-calculator.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok
        ? ''
        : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}
function checkNear(label, actual, expected, eps = 1e-9) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= eps;
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ~${expected}`),
  );
}
/** The value of an ok result, or null — so a broken result shows up as a FAIL. */
function val(result) {
  return result && result.ok ? result.value : null;
}
/** The warning of an ok result, or null. */
function warning(result) {
  return result && result.ok ? (result.warning ?? null) : null;
}
/** True when the result is an explicit, explained failure. */
function rejected(result) {
  return Boolean(result) && result.ok === false && typeof result.error === 'string' && result.error.length > 0;
}

console.log('--- X 的 Y% ---');
check('200 的 15%', val(M.percentOf(200, 15)), 30);
check('与朴素算式 a × b ÷ 100 一致', val(M.percentOf(1234.5, 7.25)), (1234.5 * 7.25) / 100);
check('0 的 50% 是 0', val(M.percentOf(0, 50)), 0);
check('0 的 0% 是 0', val(M.percentOf(0, 0)), 0);
check('200 的 −10% 是 −20（负百分比即减少）', val(M.percentOf(200, -10)), -20);
check('−200 的 10% 是 −20', val(M.percentOf(-200, 10)), -20);
check('超过 100%：50 的 150% 是 75', val(M.percentOf(50, 150)), 75);
check('超过 100%：80 的 250% 是 200', val(M.percentOf(80, 250)), 200);
check('NaN 输入被拒绝', rejected(M.percentOf(Number.NaN, 10)), true);
check('Infinity 输入被拒绝', rejected(M.percentOf(1, Number.POSITIVE_INFINITY)), true);
check('极大值溢出被拒绝而非返回 Infinity', rejected(M.percentOf(Number.MAX_VALUE, 200)), true);
check('朴素算式在同一输入下确实溢出', Number.MAX_VALUE * (200 / 100), Number.POSITIVE_INFINITY);
{
  const raw = val(M.percentOf(0.1 + 0.2, 100));
  check('浮点原样返回：(0.1+0.2) 的 100% 不等于 0.3', raw === 0.3, false);
  check('浮点原样返回：等于 0.1+0.2 本身', raw, 0.1 + 0.2);
  check('只在显示时舍入为 0.3', M.formatNumber(raw, 2), '0.3');
  const seven = val(M.percentOf(0.07, 10000));
  check('0.07 × 10000 ÷ 100 的二进制误差被保留', seven === 7, false);
  check('误差确实存在（7.000000000000001）', seven, 7.000000000000001);
  check('显示时给出干净的 7', M.formatNumber(seven, 6), '7');
}

console.log('--- X 是 Y 的百分之几 ---');
check('25 是 200 的 12.5%', val(M.whatPercent(25, 200)), 12.5);
check('0 是 200 的 0%', val(M.whatPercent(0, 200)), 0);
check('超过 100%：150 是 100 的 150%', val(M.whatPercent(150, 100)), 150);
check('−25 是 200 的 −12.5%', val(M.whatPercent(-25, 200)), -12.5);
check('除以 0 被明确拒绝', rejected(M.whatPercent(50, 0)), true);
check('拒绝信息说明了原因', /0/.test(M.whatPercent(50, 0).error), true);
check('整体为负时给出警告', typeof warning(M.whatPercent(25, -200)), 'string');
check('整体为负时仍按定义相除', val(M.whatPercent(25, -200)), -12.5);
{
  let mismatches = 0;
  for (let part = -50; part <= 50; part += 1) {
    for (const whole of [1, 3, 7, 99, -7, 12345]) {
      const expected = (part / whole) * 100;
      if (val(M.whatPercent(part, whole)) !== expected) mismatches += 1;
    }
  }
  check('与朴素算式 part ÷ whole × 100 在 606 组取值上一致', mismatches, 0);
}

console.log('--- 变化率（增减百分比）---');
check('100 → 120 是 +20%', val(M.percentChange(100, 120)), 20);
check('100 → 80 是 −20%', val(M.percentChange(100, 80)), -20);
check('50 → 50 是 0%', val(M.percentChange(50, 50)), 0);
check('50 → 50 不是负零', Object.is(val(M.percentChange(50, 50)), 0), true);
check('原值为 0 时变化率被拒绝（而非 Infinity）', rejected(M.percentChange(0, 50)), true);
check('原值为 0 的拒绝信息提到分母', /分母/.test(M.percentChange(0, 50).error), true);
check('负数原值给出方向性警告', typeof warning(M.percentChange(-100, -50)), 'string');
check('负数原值仍按 (新−旧)÷旧 计算', val(M.percentChange(-100, -50)), -50);
{
  let mismatches = 0;
  for (let from = -20; from <= 20; from += 1) {
    if (from === 0) continue;
    for (const to of [-50, -1, 0, 1, 20, 137]) {
      if (val(M.percentChange(from, to)) !== ((to - from) / from) * 100) mismatches += 1;
    }
  }
  check('与朴素算式 (新−原) ÷ 原 × 100 在 240 组取值上一致', mismatches, 0);
}

console.log('--- 增加 / 减少 ---');
check('100 增加 25% = 125', val(M.increaseBy(100, 25)), 125);
check('100 减少 25% = 75', val(M.decreaseBy(100, 25)), 75);
check('增加 0% 原样返回', val(M.increaseBy(100, 0)), 100);
check('0 增加 50% 仍是 0', val(M.increaseBy(0, 50)), 0);
check('增加 −10% 等于减少 10%', val(M.increaseBy(100, -10)), 90);
check('减少 150% 得到 −50', val(M.decreaseBy(100, 150)), -50);
check('减少超过 100% 时给出警告', typeof warning(M.decreaseBy(100, 150)), 'string');
check('增加 −100% 得到 0 并给出警告', val(M.increaseBy(100, -100)), 0);
check('增加 −100% 有警告', typeof warning(M.increaseBy(100, -100)), 'string');
check('增加导致溢出时报错', rejected(M.increaseBy(Number.MAX_VALUE, 100)), true);

console.log('--- 反推原值 ---');
check('125 是涨 25% 后的值，原值 100', val(M.reverseIncrease(125, 25)), 100);
check('75 是降 25% 后的值，原值 100', val(M.reverseDecrease(75, 25)), 100);
check('涨 −100% 后无法反推（被拒绝）', rejected(M.reverseIncrease(0, -100)), true);
check('降 100% 后无法反推（被拒绝）', rejected(M.reverseDecrease(0, 100)), true);
check('降 120% 反推出负数并警告', val(M.reverseDecrease(140, 120)), -700);
check('降超过 100% 反推有警告', typeof warning(M.reverseDecrease(140, 120)), 'string');
{
  let mismatches = 0;
  for (const value of [1, 99.5, 1000, -37]) {
    for (const percent of [-50, -1, 0, 7.5, 33, 120]) {
      const forward = val(M.increaseBy(value, percent));
      const back = val(M.reverseIncrease(forward, percent));
      if (Math.abs(back - value) > Math.abs(value) * 1e-9) mismatches += 1;
      const down = val(M.decreaseBy(value, percent));
      const up = val(M.reverseDecrease(down, percent));
      if (Math.abs(up - value) > Math.abs(value) * 1e-9) mismatches += 1;
    }
  }
  check('增加再反推、减少再反推都回到原值（48 组往返）', mismatches, 0);
}

console.log('--- 打折：原价 / 折扣 / 现价 ---');
check('原价 200 打 7 折（−30%）= 140', val(M.discountPrice(200, 30)), 140);
check('现价 140、折扣 30% 反推原价 200', val(M.originalPrice(140, 30)), 200);
check('原价 200、现价 140 的折扣率 30%', val(M.discountRate(200, 140)), 30);
check('没有折扣时折扣率为 0', val(M.discountRate(200, 200)), 0);
check('现价高于原价得到负折扣率 −25%', val(M.discountRate(200, 250)), -25);
check('原价为 0 时无法计算折扣率', rejected(M.discountRate(0, 10)), true);
check('原价与现价一致时往返自洽', val(M.discountPrice(val(M.originalPrice(88, 12)), 12)), 88);

console.log('--- 百分比差异（与变化率不同）---');
checkNear('100 与 110 的百分比差异 ≈ 9.5238%', val(M.percentageDifference(100, 110)), (10 / 105) * 100, 1e-12);
check('百分比差异与朴素定义一致', val(M.percentageDifference(100, 110)), (Math.abs(100 - 110) / ((Math.abs(100) + Math.abs(110)) / 2)) * 100);
check('百分比差异是对称的', val(M.percentageDifference(100, 110)), val(M.percentageDifference(110, 100)));
check('0 与 5 的差异是 200%', val(M.percentageDifference(0, 5)), 200);
check('−5 与 5 的差异是 200%', val(M.percentageDifference(-5, 5)), 200);
check('两个 0 的差异定义为 0', val(M.percentageDifference(0, 0)), 0);
check('相同的两个数差异为 0', val(M.percentageDifference(42, 42)), 0);
checkNear('变化率是有方向的：100 → 110 是 +10%', val(M.percentChange(100, 110)), 10, 1e-12);
checkNear('变化率反向是 −9.0909%，与差异不同', val(M.percentChange(110, 100)), -9.090909090909092, 1e-12);
check('同一对数上变化率不是对称的（证明两者不同）', val(M.percentChange(100, 110)) === val(M.percentChange(110, 100)), false);

console.log('--- 百分点 ---');
check('10% → 12% 是 +2 个百分点', val(M.percentagePointDiff(12, 10)), 2);
check('10% → 12% 的相对变化是 +20%', val(M.percentagePointRelative(12, 10)), 20);
check('50% → 25% 是 −25 个百分点', val(M.percentagePointDiff(25, 50)), -25);
check('50% → 25% 的相对变化是 −50%', val(M.percentagePointRelative(25, 50)), -50);
check('100% → 150% 是 +50 个百分点、+50% 相对变化', [
  val(M.percentagePointDiff(150, 100)),
  val(M.percentagePointRelative(150, 100)),
], [50, 50]);
check('基准为 0 时相对变化被拒绝', rejected(M.percentagePointRelative(12, 0)), true);
check('百分点是绝对差：2 个百分点对应 20% 相对变化', val(M.percentagePointDiff(12, 10)) * 100 / 10, val(M.percentagePointRelative(12, 10)));

console.log('--- 涨跌往返的常见误解 ---');
{
  const ten = val(M.increaseThenDecrease(100, 10));
  check('涨 10% 再降 10% 得到 99，不是 100', ten.after, 99);
  check('净损失 1', ten.lost, 1);
  check('净损失比例等于 10² ÷ 100 = 1%', ten.lostPercent, 1);
  check('闭式解是精确的 99（朴素连乘会得到 99.00000000000001）', 100 * 1.1 * 0.9, 99.00000000000001);
  check('朴素连乘确实不等于 99', 100 * 1.1 * 0.9 === 99, false);
  check('常见误解（涨跌抵消）被证伪', ten.after === 100, false);
  check('该结果带有说明性警告', typeof warning(M.increaseThenDecrease(100, 10)), 'string');

  const twenty = val(M.increaseThenDecrease(100, 20));
  check('涨 20% 再降 20% 损失 4%', twenty.lost, 4);
  check('闭式解与 loss = Y² ÷ 100 一致', twenty.lostPercent, (20 * 20) / 100);

  const zero = val(M.increaseThenDecrease(100, 0));
  check('涨跌 0% 时原样返回', zero.after, 100);
  check('涨跌 0% 时没有警告', warning(M.increaseThenDecrease(100, 0)), null);
  check('溢出被拒绝', rejected(M.increaseThenDecrease(Number.MAX_VALUE, 100000)), true);
}

console.log('--- 按比例分配（余数处理）---');
check('100 按 1:1:1 分配', val(M.ratioAllocation(100, [1, 1, 1])), [34, 33, 33]);
check('100 按 1:2:3 分配', val(M.ratioAllocation(100, [1, 2, 3])), [17, 33, 50]);
check('10 按 1:1:1 分配（余数逐个补）', val(M.ratioAllocation(10, [1, 1, 1])), [4, 3, 3]);
check('1 按 1:1:1 分配（只能给第一份）', val(M.ratioAllocation(1, [1, 1, 1])), [1, 0, 0]);
check('0 无论如何分都是 0', val(M.ratioAllocation(0, [1, 2])), [0, 0]);
check('权重为 0 的份额得到 0', val(M.ratioAllocation(7, [0, 1, 1])), [0, 4, 3]);
check('小数权重 0.5 : 0.5 也精确（并列时前者优先）', val(M.ratioAllocation(5, [0.5, 0.5])), [3, 2]);
check('小数权重 1.5 : 1 : 0.5 等价于 15:10:5', val(M.ratioAllocation(30, [1.5, 1, 0.5])), [15, 10, 5]);
// 57 × 8 ÷ 15 = 30.4 and 57 × 3 ÷ 15 = 11.4 — an exact tie for the single
// leftover unit. The larger remainder is [0.4, 0.4, 0.2]; the tie goes to the
// earlier share, which is where the float path gets it wrong.
check('并列余数时较早的权重优先（精确解）', val(M.ratioAllocation(57, [0, 8, 3, 4])), [0, 31, 11, 15]);
{
  // The same computation in floating point, to show what it does differently.
  const weights = [0, 8, 3, 4];
  const total = 57;
  const weightSum = 15;
  const exact = weights.map((w) => (total * w) / weightSum);
  const shares = exact.map((v) => Math.floor(v));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  for (let k = 0; left > 0; k += 1, left -= 1) shares[order[k % order.length].i] += 1;
  check('朴素浮点路径在同一输入上把余数给了另一份（ulp 打破了并列）', shares, [0, 30, 12, 15]);
}
check('非整数总数被拒绝', rejected(M.ratioAllocation(10.5, [1, 1])), true);
check('负总数被拒绝', rejected(M.ratioAllocation(-1, [1, 1])), true);
check('空权重被拒绝', rejected(M.ratioAllocation(10, [])), true);
check('全零权重被拒绝（避免除以 0）', rejected(M.ratioAllocation(10, [0, 0])), true);
check('负权重被拒绝', rejected(M.ratioAllocation(10, [1, -1])), true);
check('NaN 权重被拒绝', rejected(M.ratioAllocation(10, [1, Number.NaN])), true);
check('份额之和等于总数', M.allocationSum(val(M.ratioAllocation(100, [1, 2, 3]))), 100);
{
  // Deterministic pseudo-random so a failure is reproducible.
  let seed = 20240607;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let sumViolations = 0;
  let distanceViolations = 0;
  let orderViolations = 0;
  let nonTieMismatches = 0;
  let tieMismatches = 0;
  let cases = 0;

  // Independent float implementation of the same largest-remainder idea: a
  // second code path, not a copy of the BigInt one.
  const reference = (total, weights) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    const exact = weights.map((w) => (total * w) / sum);
    const shares = exact.map((v) => Math.floor(v));
    let left = total - shares.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ frac: v - Math.floor(v), i }))
      .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
    for (let k = 0; left > 0; k += 1, left -= 1) shares[order[k % order.length].i] += 1;
    return shares;
  };

  for (let run = 0; run < 3000; run += 1) {
    const total = Math.floor(rand() * 500);
    const n = 1 + Math.floor(rand() * 6);
    const weights = Array.from({ length: n }, () => Math.floor(rand() * 10));
    if (weights.every((w) => w === 0)) weights[0] = 1;

    const result = M.ratioAllocation(total, weights);
    if (!result.ok) {
      sumViolations += 1;
      continue;
    }
    cases += 1;
    const shares = result.value;
    const weightSum = weights.reduce((a, b) => a + b, 0);

    if (shares.reduce((a, b) => a + b, 0) !== total) sumViolations += 1;
    for (let i = 0; i < n; i += 1) {
      // Every share must be within one unit of the exact proportional share.
      if (Math.abs(shares[i] - (total * weights[i]) / weightSum) >= 1) distanceViolations += 1;
      for (let j = 0; j < n; j += 1) {
        if (weights[i] > weights[j] && shares[i] < shares[j]) orderViolations += 1;
      }
    }

    const fromFloat = reference(total, weights);
    if (JSON.stringify(shares) !== JSON.stringify(fromFloat)) {
      // The two implementations may legitimately disagree only when two exact
      // remainders are equal: the exact path prefers the earlier share on a
      // tie, while a float remainder can be off by an ulp and pick the later
      // one. With integer weights up to 9 and a total below 500 the exact
      // remainders are k/S with S <= 54, so distinct remainders can never be
      // confused by float error — a mismatch without a tie would be a real bug.
      const remainders = weights.map((w) => (total * w) % weightSum);
      if (new Set(remainders).size < n) tieMismatches += 1;
      else nonTieMismatches += 1;
    }
  }

  check('3000 组随机分配：份额之和恒等于总数', sumViolations, 0);
  check('3000 组随机分配：每份与精确比例之差都小于 1', distanceViolations, 0);
  check('3000 组随机分配：权重更大者份额不会更小', orderViolations, 0);
  check('3000 组随机分配：与独立浮点参照的分歧只发生在余数并列时', nonTieMismatches, 0);
  check('随机用例里确实出现过并列余数（否则上面那条断言是空转）', tieMismatches > 0, true);
  check('随机用例确实执行了', cases, 3000);
}

console.log('--- 千分比 / 基点 / ppm 换算 ---');
check('100% = 1000‰', val(M.convertRatio(100, 'percent', 'permille')), 1000);
check('100% = 10000 bp', val(M.convertRatio(100, 'percent', 'basisPoint')), 10000);
check('1% = 10000 ppm', val(M.convertRatio(1, 'percent', 'ppm')), 10000);
check('1 bp = 0.01%', val(M.convertRatio(1, 'basisPoint', 'percent')), 0.01);
check('1‰ = 0.1%', val(M.convertRatio(1, 'permille', 'percent')), 0.1);
check('1 bp = 100 ppm', val(M.convertRatio(1, 'basisPoint', 'ppm')), 100);
check('0.05% = 5 bp', val(M.convertRatio(0.05, 'percent', 'basisPoint')), 5);
check('25 bp = 0.25%', val(M.convertRatio(25, 'basisPoint', 'percent')), 0.25);
check('同单位换算是恒等', val(M.convertRatio(37.5, 'permille', 'permille')), 37.5);
check('NaN 输入被拒绝', rejected(M.convertRatio(Number.NaN, 'percent', 'permille')), true);
{
  const units = ['percent', 'permille', 'basisPoint', 'ppm'];
  const parts = M.RATIO_PARTS_PER_WHOLE;
  let mismatches = 0;
  let pairs = 0;
  for (const from of units) {
    for (const to of units) {
      pairs += 1;
      for (const value of [0, 0.5, 1, 7.25, -3, 12345]) {
        const expected = (value * parts[to]) / parts[from];
        if (val(M.convertRatio(value, from, to)) !== expected) mismatches += 1;
      }
    }
  }
  check(`与朴素算式 值 × 目标份数 ÷ 源份数 在 ${pairs * 6} 组组合上一致`, mismatches, 0);
  check('1% = 10‰ 的换算链自洽', val(M.convertRatio(val(M.convertRatio(1, 'percent', 'permille')), 'permille', 'percent')), 1);
}

console.log('--- 舍入：四舍五入 vs 截断 ---');
check('朴素写法 Math.round(1.005 × 100) ÷ 100 得到 1（错误）', Math.round(1.005 * 100) / 100, 1);
check('本实现得到 1.01', M.roundTo(1.005, 2), 1.01);
check('朴素写法 Math.round(1.015 × 100) ÷ 100 也会出错', Math.round(1.015 * 100) / 100, 1.01);
check('本实现得到 1.02', M.roundTo(1.015, 2), 1.02);
check('0.1 + 0.2 舍入到 2 位得到 0.3', M.roundTo(0.1 + 0.2, 2), 0.3);
check('朴素的 Math.round(-2.5) ÷ 10 得到 −0.2（四舍五入方向错误）', Math.round(-2.5) / 10, -0.2);
check('负数的四舍五入远离零：−0.25 → −0.3', M.roundTo(-0.25, 1), -0.3);
check('正数 0.25 → 0.3', M.roundTo(0.25, 1), 0.3);
check('2.5 → 3', M.roundTo(2.5, 0), 3);
check('−2.5 → −3', M.roundTo(-2.5, 0), -3);
check('截断与四舍五入不同：0.19 截断为 0.1', M.truncateTo(0.19, 1), 0.1);
check('截断与四舍五入不同：0.19 四舍五入为 0.2', M.roundTo(0.19, 1), 0.2);
check('负数截断朝向零：−0.19 → −0.1', M.truncateTo(-0.19, 1), -0.1);
check('截断 1.005 到 2 位得到 1', M.truncateTo(1.005, 2), 1);
check('大数不再做无意义的小数舍入', M.roundTo(1e21, 2), 1e21);
check('极大数舍入不产生 NaN', Number.isFinite(M.roundTo(Number.MAX_VALUE, 10)), true);

console.log('--- 负零 ---');
check('朴素写法会保留负零', Object.is(-1 * 0, -0), true);
check('roundTo 不产生负零', Object.is(M.roundTo(-0.0001, 2), 0), true);
check('roundTo(−0.0001, 2) 等于 0', M.roundTo(-0.0001, 2), 0);
check('normalizeZero 把 −0 变成 0', Object.is(M.normalizeZero(-0), 0), true);
check('formatNumber(−0) 显示为 0', M.formatNumber(-0), '0');
check('formatNumber(−0.0000001, 3) 显示为 0', M.formatNumber(-0.0000001, 3), '0');
check('变化率为 0 时不显示 −0', M.formatNumber(val(M.percentChange(5, 5)), 2), '0');

console.log('--- 数字格式化 ---');
check('去掉多余的 0', M.formatNumber(12.5, 4), '12.5');
check('整数不带小数点', M.formatNumber(30, 4), '30');
check('按位数舍入', M.formatNumber(1 / 3, 4), '0.3333');
check('百分比带 % 号', M.formatPercent(12.5), '12.5%');
check('百分比为 0 时显示 0%', M.formatPercent(0), '0%');
check('Infinity 显示为 ∞', M.formatNumber(Number.POSITIVE_INFINITY), '∞');
check('NaN 显示为占位符', M.formatNumber(Number.NaN), '—');
check('超过 1e21 使用科学计数法', M.formatNumber(1e21, 2), '1e+21');
check('极大值格式化不抛异常', typeof M.formatNumber(Number.MAX_VALUE, 6), 'string');

console.log('--- 权重列表解析 ---');
check('冒号分隔', val(M.parseNumberList('1:2:3')), [1, 2, 3]);
check('逗号与空格分隔', val(M.parseNumberList('0.5, 1.5')), [0.5, 1.5]);
check('中文逗号与顿号', val(M.parseNumberList('1，2、3')), [1, 2, 3]);
check('空字符串被拒绝', rejected(M.parseNumberList('  ')), true);
check('非数字被拒绝', rejected(M.parseNumberList('1,abc')), true);

console.log('--- 公式文案 ---');
{
  const names = Object.keys(M.FORMULAS);
  check('公式条数不少于 14', names.length >= 14, true);
  const empty = names.filter((key) => typeof M.FORMULAS[key] !== 'string' || M.FORMULAS[key].trim() === '');
  check('每条公式都非空', empty, []);
  const withBrokenComment = names.filter((key) => M.FORMULAS[key].includes('*' + '/'));
  check('公式里不含会截断块注释的字符序列', withBrokenComment, []);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
