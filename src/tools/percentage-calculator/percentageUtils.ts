/**
 * Percentage arithmetic.
 *
 * Pure functions only: no React, no DOM, no clock, no randomness. Every
 * function is a plain number-in / number-out computation so the check script
 * can compare it against hand-written expressions such as `a * b / 100` and
 * against the textbook definitions of percent change and percent difference.
 *
 * ## Design notes
 *
 * Every scenario returns a `Result<T>` instead of a bare number. The two cases
 * that matter are not edge trivia — they are the ones users actually hit:
 *
 *   - "X is what percent of Y" with Y = 0, and "change from 0". Dividing by zero
 *     yields Infinity or NaN, which a naive UI then dresses up as a confident
 *     number. Here both are refused with an explanation.
 *   - Overflow. `Number.MAX_VALUE * 2 / 100` is Infinity; a percentage tool that
 *     prints Infinity is worse than one that says the result is out of range.
 *
 * Rounding is deliberately *not* applied inside the arithmetic. The raw double
 * is returned and formatting happens at the edge, because "25% of 0.3" landing
 * on 0.07500000000000001 is a display problem, while silently rounding in the
 * middle of a chain of conversions would corrupt exact results.
 */

/** Outcome of a scenario. `warning` carries a non-fatal caveat, e.g. a negative base. */
export type Result<T> =
  | { ok: true; value: T; warning?: string }
  | { ok: false; error: string };

/** Ratio units this tool converts between. */
export type RatioUnit = 'percent' | 'permille' | 'basisPoint' | 'ppm';

export const RATIO_UNITS: RatioUnit[] = [
  'percent',
  'permille',
  'basisPoint',
  'ppm',
];

export const RATIO_UNIT_LABEL: Record<RatioUnit, string> = {
  percent: '百分比 %（百分之一）',
  permille: '千分比 ‰（千分之一）',
  basisPoint: '基点 bp / 万分比（万分之一）',
  ppm: '百万分比 ppm（百万分之一）',
};

/**
 * How many parts make one whole in each unit.
 *
 * Stored as parts-per-whole rather than as the fraction (0.01, 0.001, …) so the
 * conversion between two units is an exact integer ratio: 100% to bp is
 * 100 * 10000 / 100 = 10000 with no binary fraction involved, whereas going
 * through 0.01 and 0.0001 can land on 9999.999999999998.
 */
export const RATIO_PARTS_PER_WHOLE: Record<RatioUnit, number> = {
  percent: 100,
  permille: 1000,
  basisPoint: 10_000,
  ppm: 1_000_000,
};

/**
 * The formula shown next to every scenario in the UI, kept here so the check
 * script can assert the page never loses its formula and so the two stay
 * worded identically. Written in plain text; the components render it in a
 * monospace caption.
 */
export const FORMULAS = {
  percentOf: 'X 的 Y% = X × Y ÷ 100',
  whatPercent: '占比 = X ÷ Y × 100%',
  percentChange: '变化率 = (新值 − 原值) ÷ 原值 × 100%',
  increaseBy: '增加后的值 = 原值 × (1 + Y ÷ 100)',
  decreaseBy: '减少后的值 = 原值 × (1 − Y ÷ 100)',
  reverseIncrease: '原值 = 增长后的值 ÷ (1 + Y ÷ 100)',
  reverseDecrease: '原值 = 减少后的值 ÷ (1 − Y ÷ 100)',
  discountPrice: '现价 = 原价 × (1 − 折扣率 ÷ 100)',
  discountRate: '折扣率 = (1 − 现价 ÷ 原价) × 100%',
  percentageDifference: '百分比差异 = |A − B| ÷ ((|A| + |B|) ÷ 2) × 100%',
  percentagePoint: '百分点差 = P₁ − P₂（绝对差）',
  roundTrip:
    '涨 Y% 再降 Y%：原值 × (1 + Y ÷ 100) × (1 − Y ÷ 100) = 原值 × (1 − Y² ÷ 10000)',
  ratioAllocation:
    '份额ᵢ = 总数 × 权重ᵢ ÷ 权重之和，整数余数按小数部分从大到小逐份补 1',
  unitConversion: '目标值 = 数值 × 目标单位份数 ÷ 源单位份数',
} as const;

/** Replaces negative zero with positive zero so it never reaches the display. */
export function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

const NOT_A_NUMBER = '请输入有效数字（不能为空、NaN 或无穷大）';

function requireFinite(entries: Array<[number, string]>): string | null {
  for (const [value, label] of entries) {
    if (!Number.isFinite(value)) return `${label}：${NOT_A_NUMBER}`;
  }
  return null;
}

/** Wraps a computed number, refusing a non-finite result. */
function finite(value: number, warning?: string): Result<number> {
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      error: '计算结果超出可表示范围（约 ±1.8e308），请检查输入数量级',
    };
  }
  const normalized = normalizeZero(value);
  return warning ? { ok: true, value: normalized, warning } : { ok: true, value: normalized };
}

// ---------------------------------------------------------------------------
// Rounding helpers
// ---------------------------------------------------------------------------

/**
 * Rounds half away from zero at `decimals` places.
 *
 * Implemented by shifting the decimal point through the exponent of the
 * number's own exponential form instead of multiplying by `10 ** decimals`.
 * The multiplication form is wrong for values users type every day:
 * `Math.round(1.005 * 100) / 100` is 1, because 1.005 * 100 is
 * 100.49999999999999 in binary. Going through the string "1.005e2" makes the
 * shift exact and the result 1.01.
 *
 * Half away from zero (rather than Math.round's half towards +Infinity) is what
 * people expect from "四舍五入": roundTo(-0.25, 1) is -0.3, not -0.2.
 */
export function roundTo(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  const digits = Math.min(300, Math.max(0, Math.trunc(decimals)));
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);

  // Past 2^53 every double is already an integer, and shifting a 1e300
  // magnitude by 10 decimal places would overflow the exponent range.
  if (magnitude >= 1e21) return value;

  const [mantissa, exponent] = magnitude.toExponential().split('e');
  const shifted = Number(`${mantissa}e${Number(exponent) + digits}`);
  if (!Number.isFinite(shifted)) return value;
  const rounded = sign * Number(`${Math.round(shifted)}e-${digits}`);
  return normalizeZero(rounded);
}

/** Truncates towards zero at `decimals` places (the opposite of rounding up). */
export function truncateTo(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  const digits = Math.min(300, Math.max(0, Math.trunc(decimals)));
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  if (magnitude >= 1e21) return value;

  const [mantissa, exponent] = magnitude.toExponential().split('e');
  const shifted = Number(`${mantissa}e${Number(exponent) + digits}`);
  if (!Number.isFinite(shifted)) return value;
  const truncated = sign * Number(`${Math.trunc(shifted)}e-${digits}`);
  return normalizeZero(truncated);
}

/**
 * Formats a number with at most `maxDecimals` decimals, trimming trailing
 * zeros, and never printing "-0".
 */
export function formatNumber(value: number, maxDecimals = 6): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const rounded = roundTo(value, maxDecimals);
  if (Math.abs(rounded) >= 1e21) return rounded.toExponential();
  let text = rounded.toFixed(Math.min(100, Math.max(0, Math.trunc(maxDecimals))));
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

/** Formats a percentage value, e.g. 12.5 becomes "12.5%". */
export function formatPercent(value: number, maxDecimals = 6): string {
  return `${formatNumber(value, maxDecimals)}%`;
}

/** Splits a list of numbers typed as "1:2:3", "0.5, 1.5" or "1 2 3". */
export function parseNumberList(text: string): Result<number[]> {
  const parts = text
    .split(/[,:;，、\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return { ok: false, error: '请输入至少一个权重' };
  const values: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value)) {
      return { ok: false, error: `“${part}” 不是有效数字` };
    }
    values.push(value);
  }
  return { ok: true, value: values };
}

// ---------------------------------------------------------------------------
// Scenario 1: X 的 Y% 是多少
// ---------------------------------------------------------------------------

/** Plain "percent of": X × Y ÷ 100. */
export function percentOf(base: number, percent: number): Result<number> {
  const bad = requireFinite([
    [base, '基数 X'],
    [percent, '百分比 Y'],
  ]);
  if (bad) return { ok: false, error: bad };
  return finite((base * percent) / 100);
}

// ---------------------------------------------------------------------------
// Scenario 2: X 是 Y 的百分之几
// ---------------------------------------------------------------------------

/** "X is what percent of Y": X ÷ Y × 100. */
export function whatPercent(part: number, whole: number): Result<number> {
  const bad = requireFinite([
    [part, '部分 X'],
    [whole, '整体 Y'],
  ]);
  if (bad) return { ok: false, error: bad };
  if (whole === 0) {
    return { ok: false, error: '整体 Y 为 0：不能除以 0，占比没有定义' };
  }
  return finite(
    (part / whole) * 100,
    whole < 0
      ? '整体 Y 为负数：按定义相除的结果符号会反转，占比不再有直观意义'
      : undefined,
  );
}

// ---------------------------------------------------------------------------
// Scenario 3: 变化率（增减百分比）
// ---------------------------------------------------------------------------

/**
 * Percent change, by definition: (new − old) ÷ old × 100.
 *
 * The denominator is the *signed* old value, not its magnitude. That is the
 * textbook definition, but it has a consequence worth surfacing: when the old
 * value is negative, a real increase produces a negative percentage. The UI
 * shows a warning instead of pretending the number means what it does for
 * positive bases.
 */
export function percentChange(from: number, to: number): Result<number> {
  const bad = requireFinite([
    [from, '原值'],
    [to, '新值'],
  ]);
  if (bad) return { ok: false, error: bad };
  if (from === 0) {
    return {
      ok: false,
      error: '原值为 0：变化率以原值为分母，从 0 出发的增长没有定义的百分比',
    };
  }
  return finite(
    ((to - from) / from) * 100,
    from < 0
      ? '原值为负数：按 (新值 − 原值) ÷ 原值 的定义，数值增大时算出的百分比是负的，方向与直觉相反'
      : undefined,
  );
}

// ---------------------------------------------------------------------------
// Scenario 4: 增加 / 减少后的值
// ---------------------------------------------------------------------------

/** Applies an increase: value × (1 + percent ÷ 100). Percent may be negative. */
export function increaseBy(value: number, percent: number): Result<number> {
  const bad = requireFinite([
    [value, '原值'],
    [percent, '增长百分比'],
  ]);
  if (bad) return { ok: false, error: bad };
  // The factor is built as (100 + percent) / 100 rather than 1 + percent / 100:
  // both are algebraically identical, but the first form stays exact for
  // values like 120 (where 1 - 120 / 100 lands on -0.19999999999999996) and
  // that precision is visible in results such as reverseDecrease(140, 120).
  return finite(
    value * ((100 + percent) / 100),
    percent <= -100
      ? '增长率不高于 −100%：结果为 0 或负数，“增长”名称在此已不成立'
      : undefined,
  );
}

/** Applies a decrease: value × (1 − percent ÷ 100). Percent may exceed 100. */
export function decreaseBy(value: number, percent: number): Result<number> {
  const bad = requireFinite([
    [value, '原值'],
    [percent, '减少百分比'],
  ]);
  if (bad) return { ok: false, error: bad };
  return finite(
    value * ((100 - percent) / 100),
    percent > 100
      ? '减少幅度超过 100%：结果为负数，现实中通常没有对应含义'
      : undefined,
  );
}

// ---------------------------------------------------------------------------
// Scenario 5: 反推原值（打折 / 涨价还原）
// ---------------------------------------------------------------------------

/** Recovers the pre-increase value: final ÷ (1 + percent ÷ 100). */
export function reverseIncrease(
  finalValue: number,
  percent: number,
): Result<number> {
  const bad = requireFinite([
    [finalValue, '增长后的值'],
    [percent, '增长百分比'],
  ]);
  if (bad) return { ok: false, error: bad };
  const factor = (100 + percent) / 100;
  if (factor === 0) {
    return {
      ok: false,
      error: '增长率为 −100% 时无法反推：增长后的值必然是 0，原值信息已经丢失',
    };
  }
  return finite(
    finalValue / factor,
    percent < -100
      ? '增长率低于 −100%：反推出的原值符号会反转，输入大概率有误'
      : undefined,
  );
}

/** Recovers the pre-discount (original) price: sale ÷ (1 − percent ÷ 100). */
export function reverseDecrease(
  finalValue: number,
  percent: number,
): Result<number> {
  const bad = requireFinite([
    [finalValue, '减少后的值'],
    [percent, '减少百分比'],
  ]);
  if (bad) return { ok: false, error: bad };
  const factor = (100 - percent) / 100;
  if (factor === 0) {
    return {
      ok: false,
      error: '减少 100% 时无法反推：减少后的值必然是 0，原值信息已经丢失',
    };
  }
  return finite(
    finalValue / factor,
    percent > 100
      ? '减少幅度超过 100%：反推出的原值是负数，输入大概率有误'
      : undefined,
  );
}

/** Sale price after a discount: original × (1 − discount ÷ 100). */
export function discountPrice(
  original: number,
  discountPercent: number,
): Result<number> {
  return decreaseBy(original, discountPercent);
}

/** Recovered original price from a sale price: sale ÷ (1 − discount ÷ 100). */
export function originalPrice(
  salePrice: number,
  discountPercent: number,
): Result<number> {
  return reverseDecrease(salePrice, discountPercent);
}

/**
 * The discount rate implied by two prices: (1 − sale ÷ original) × 100.
 *
 * A negative result means the "sale" price is higher than the original, which
 * is reported rather than clamped to zero.
 */
export function discountRate(
  original: number,
  salePrice: number,
): Result<number> {
  // Computed as (original - sale) / original rather than 1 - sale / original:
  // the two agree to within a few ulps, but this form returns exactly 30 for
  // the everyday 200 -> 140 case instead of 30.000000000000004.
  const bad = requireFinite([
    [original, '原价'],
    [salePrice, '现价'],
  ]);
  if (bad) return { ok: false, error: bad };
  if (original === 0) {
    return { ok: false, error: '原价为 0：无法计算折扣率' };
  }
  return finite(
    ((original - salePrice) / original) * 100,
    original < 0 ? '原价为负数：折扣率没有直观意义' : undefined,
  );
}

// ---------------------------------------------------------------------------
// Scenario 6: 百分比差异（与变化率不同）
// ---------------------------------------------------------------------------

/**
 * Percentage difference: |A − B| ÷ ((|A| + |B|) ÷ 2) × 100.
 *
 * This is *not* percent change. Percent change divides by one of the two
 * values (the "old" one) and therefore depends on which value is called old:
 * change(100, 110) is +10% while change(110, 100) is −9.09%. Percentage
 * difference divides by the mean of the two magnitudes, so it is symmetric —
 * diff(100, 110) equals diff(110, 100) — and is the right measure when neither
 * value is a baseline. Both are offered in the UI side by side so the
 * difference is visible rather than described.
 *
 * Two zeros are defined as 0 difference (the values are equal); otherwise the
 * mean is only zero when both are zero.
 */
export function percentageDifference(a: number, b: number): Result<number> {
  const bad = requireFinite([
    [a, '数值 A'],
    [b, '数值 B'],
  ]);
  if (bad) return { ok: false, error: bad };
  if (a === b) return { ok: true, value: 0 };
  const mean = (Math.abs(a) + Math.abs(b)) / 2;
  return finite((Math.abs(a - b) / mean) * 100);
}

// ---------------------------------------------------------------------------
// Scenario 7: 百分点
// ---------------------------------------------------------------------------

/**
 * Percentage-point difference: P1 − P2, an absolute subtraction.
 *
 * Going from 10% to 12% is +2 percentage points, which is a +20% relative
 * change. The two numbers answer different questions and are frequently
 * conflated in reporting; the card shows both.
 */
export function percentagePointDiff(p1: number, p2: number): Result<number> {
  const bad = requireFinite([
    [p1, '百分比 P₁'],
    [p2, '百分比 P₂'],
  ]);
  if (bad) return { ok: false, error: bad };
  return finite(p1 - p2);
}

/** The relative change behind a percentage-point move: (P1 − P2) ÷ P2 × 100. */
export function percentagePointRelative(p1: number, p2: number): Result<number> {
  const bad = requireFinite([
    [p1, '百分比 P₁'],
    [p2, '百分比 P₂'],
  ]);
  if (bad) return { ok: false, error: bad };
  if (p2 === 0) {
    return { ok: false, error: '基准百分比 P₂ 为 0：相对变化没有定义' };
  }
  return finite(((p1 - p2) / p2) * 100);
}

// ---------------------------------------------------------------------------
// Scenario 8: 涨跌往返（常见误解）
// ---------------------------------------------------------------------------

export interface RoundTripResult {
  /** Value after the increase then the decrease. */
  after: number;
  /** Absolute amount lost relative to the original. */
  lost: number;
  /** The loss as a percentage of the original value: exactly Y² ÷ 100. */
  lostPercent: number;
}

/**
 * What "up Y% then down Y%" actually does.
 *
 * The widespread belief is that the two cancel. They do not:
 * (1 + p)(1 − p) = 1 − p², so a 10% rise followed by a 10% fall loses 1% of the
 * original. The closed form is computed directly (rather than multiplying the
 * two factors) so the result is exact for values such as p = 10, and the check
 * script asserts the round trip does *not* return the original.
 */
export function increaseThenDecrease(
  value: number,
  percent: number,
): Result<RoundTripResult> {
  const bad = requireFinite([
    [value, '原值'],
    [percent, '涨跌百分比'],
  ]);
  if (bad) return { ok: false, error: bad };
  const after = value * (1 - (percent * percent) / 10_000);
  if (!Number.isFinite(after)) {
    return { ok: false, error: '计算结果超出可表示范围，请检查输入数量级' };
  }
  const lost = value - after;
  return {
    ok: true,
    value: {
      after: normalizeZero(after),
      lost: normalizeZero(lost),
      lostPercent: normalizeZero((percent * percent) / 100),
    },
    warning:
      percent !== 0
        ? `涨 ${formatNumber(percent, 6)}% 再降 ${formatNumber(percent, 6)}% 回不到原值：会净损失原值的 ${formatNumber((percent * percent) / 100, 6)}%`
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Scenario 9: 按比例分配（含余数处理）
// ---------------------------------------------------------------------------

/**
 * The largest-remainder method, computed exactly.
 *
 * Weights are scaled up to integers (0.5, 1.5 becomes 5, 15 with a factor of
 * 10) and the whole distribution runs in BigInt. The reason is the remainder
 * itself: with floating point, 100 × 1 / 3 is 33.333333333333336 and
 * 100 × 3 / 10 can be 30.000000000000004, so "floor and then hand out what is
 * left" can hand out the wrong count or a share off by one. Exact integers make
 * the invariant "the shares sum to the total" provable, and that invariant is
 * what the check script hammers.
 *
 * When the weights cannot be represented as integers within nine decimal places
 * (for example 1/3 expressed as a float), the function falls back to the same
 * algorithm in floating point — the sum is still forced to equal the total —
 * and says so in `warning`.
 */
export function ratioAllocation(
  total: number,
  weights: number[],
): Result<number[]> {
  if (!Number.isFinite(total)) return { ok: false, error: `总数：${NOT_A_NUMBER}` };
  if (!Number.isInteger(total)) {
    return {
      ok: false,
      error: '总数必须是整数：分配的最小单位是 1（例如以「分」为单位输入金额）',
    };
  }
  if (total < 0) return { ok: false, error: '总数不能为负数' };
  if (weights.length === 0) return { ok: false, error: '至少需要一个权重' };

  for (const weight of weights) {
    if (!Number.isFinite(weight)) return { ok: false, error: `权重：${NOT_A_NUMBER}` };
    if (weight < 0) return { ok: false, error: '权重不能为负数' };
  }
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(weightSum > 0)) {
    return { ok: false, error: '权重之和必须大于 0，否则无法按比例分配' };
  }

  const scaled = scaleToIntegers(weights);
  if (scaled) {
    const bigTotal = BigInt(total);
    const bigSum = scaled.reduce((sum, weight) => sum + weight, 0n);
    const bases = scaled.map((weight) => Number((bigTotal * weight) / bigSum));
    const remainders = scaled.map((weight) => (bigTotal * weight) % bigSum);
    return { ok: true, value: distribute(total, bases, remainders) };
  }

  // Floating-point fallback: the remainders are approximate, so the ordering of
  // nearly-tied shares may differ from the exact answer, but the total is still
  // conserved exactly because the leftover is measured, not assumed.
  const exact = weights.map((weight) => (total * weight) / weightSum);
  const bases = exact.map((value) => Math.floor(value));
  const remainders = exact.map((value, index) =>
    BigInt(Math.round((value - bases[index]) * 1e9)),
  );
  const value = distribute(total, bases, remainders);
  return {
    ok: true,
    value,
    warning: '权重精度过高，已改用浮点近似分配（总数仍然精确等于输入值）',
  };
}

/**
 * Finds the smallest power of ten (up to 1e9) that turns every weight into an
 * integer, so the allocation can run in exact BigInt arithmetic.
 */
function scaleToIntegers(weights: number[]): bigint[] | null {
  for (let power = 0; power <= 9; power += 1) {
    const scale = 10 ** power;
    const scaled: bigint[] = [];
    let ok = true;
    for (const weight of weights) {
      const value = weight * scale;
      if (Math.abs(value - Math.round(value)) > 1e-6) {
        ok = false;
        break;
      }
      scaled.push(BigInt(Math.round(value)));
    }
    if (ok) return scaled;
  }
  return null;
}

/** Floors, then hands the integer leftover to the largest remainders first. */
function distribute(
  total: number,
  bases: number[],
  remainders: bigint[],
): number[] {
  const shares = [...bases];
  let leftover = total - shares.reduce((sum, share) => sum + share, 0);

  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
      // A stable tie-break by position keeps the result deterministic: the
      // earlier share wins, so the same input always yields the same output.
      return a.index - b.index;
    })
    .map((entry) => entry.index);

  // Wrapping is a belt-and-braces guard for the floating-point path only: in
  // the exact path the leftover is always smaller than the number of entries.
  for (let i = 0; leftover > 0; i += 1) {
    shares[order[i % order.length]] += 1;
    leftover -= 1;
  }
  return shares.map(normalizeZero);
}

/** Sum of an allocation, for the UI's "shares add up" confirmation. */
export function allocationSum(shares: number[]): number {
  return shares.reduce((sum, share) => sum + share, 0);
}

// ---------------------------------------------------------------------------
// Scenario 10: 千分比 / 基点 / 百分比换算
// ---------------------------------------------------------------------------

/**
 * Converts a ratio between percent, permille, basis points and ppm.
 *
 * 1% = 10‰ = 100 bp = 10000 ppm; the conversion is value × parts(target) ÷
 * parts(source), using the integer parts-per-whole table so no binary fraction
 * creeps in.
 */
export function convertRatio(
  value: number,
  from: RatioUnit,
  to: RatioUnit,
): Result<number> {
  if (!Number.isFinite(value)) return { ok: false, error: `数值：${NOT_A_NUMBER}` };
  const fromParts = RATIO_PARTS_PER_WHOLE[from];
  const toParts = RATIO_PARTS_PER_WHOLE[to];
  if (!fromParts || !toParts) {
    return { ok: false, error: '未知的比例单位' };
  }
  return finite((value * toParts) / fromParts);
}
