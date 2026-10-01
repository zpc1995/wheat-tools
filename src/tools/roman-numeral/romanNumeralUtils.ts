/**
 * Roman numeral arithmetic.
 *
 * Pure functions only — no React, no DOM, no clock — so a plain Node script can
 * transcribe this module and hammer it with all 3999 values.
 *
 * Three decisions shape everything below.
 *
 * 1. The domain is exactly 1–3999, and anything outside it is refused rather
 *    than approximated. Zero has no Roman symbol at all, and values from 4000
 *    up need an extra convention (a vinculum overline meaning "times 1000", or
 *    a medieval variant such as IIII for 4000). Those spellings have no single
 *    agreed plain-text form, so inventing one would produce a confidently wrong
 *    answer. Saying "cannot" is the correct output.
 *
 * 2. Decoding accepts the standard subtractive spelling only. A string such as
 *    IIII or VX does have an additive reading, but accepting it would make the
 *    decoder silently answer a different question than the encoder asks, and
 *    the round trip would stop being an identity. Instead the offending string
 *    is rejected together with the standard spelling it should have used.
 *
 * 3. One table drives both the encoded string and the step breakdown. If the
 *    explanation were computed separately it could drift away from the answer
 *    printed above it, which is the one bug a teaching tool must not have.
 */

/** Smallest value with a standard Roman spelling. */
export const MIN_VALUE = 1;

/** Largest value with a standard Roman spelling: 3999 = MMMCMXCIX. */
export const MAX_VALUE = 3999;

/**
 * Longest standard spelling, in characters.
 *
 * 3888 is the worst case: MMMDCCCLXXXVIII, fifteen characters. The checker
 * recomputes this maximum over 1–3999 rather than trusting the number, so a
 * change to the table cannot leave a stale limit behind.
 */
export const MAX_ROMAN_LENGTH = 15;

/** One symbol and the value it contributes to a breakdown. */
export interface RomanStep {
  /** The symbol as written, e.g. `CM`. */
  symbol: string;
  /** The value it contributes, e.g. 900. */
  value: number;
}

/**
 * Value table, largest first, with the six subtractive forms as single entries.
 *
 * Treating CM as one entry rather than "C before M" is what lets the encoder be
 * a simple greedy pass: it never needs to look ahead, and the same entries are
 * reused verbatim as the breakdown shown to the user.
 */
export const ROMAN_TABLE: readonly RomanStep[] = [
  { symbol: 'M', value: 1000 },
  { symbol: 'CM', value: 900 },
  { symbol: 'D', value: 500 },
  { symbol: 'CD', value: 400 },
  { symbol: 'C', value: 100 },
  { symbol: 'XC', value: 90 },
  { symbol: 'L', value: 50 },
  { symbol: 'XL', value: 40 },
  { symbol: 'X', value: 10 },
  { symbol: 'IX', value: 9 },
  { symbol: 'V', value: 5 },
  { symbol: 'IV', value: 4 },
  { symbol: 'I', value: 1 },
];

/**
 * Additive-only table, used solely for the optional non-standard spelling.
 *
 * The additive style writes 4 as IIII and 9 as VIIII. It is real — clock faces
 * and inscriptions use it — but it is not the standard numeral system, so the
 * UI always labels it as such. Offering both spellings without that label is
 * exactly how a converter teaches the wrong thing.
 */
export const ADDITIVE_TABLE: readonly RomanStep[] = [
  { symbol: 'M', value: 1000 },
  { symbol: 'D', value: 500 },
  { symbol: 'C', value: 100 },
  { symbol: 'L', value: 50 },
  { symbol: 'X', value: 10 },
  { symbol: 'V', value: 5 },
  { symbol: 'I', value: 1 },
];

const SYMBOL_VALUES: Readonly<Record<string, number>> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

/**
 * The only pairs allowed to express subtraction.
 *
 * Derived from the rule itself (I before V and X, X before L and C, C before D
 * and M) rather than from a hand-written blacklist, so a pair such as IC or XM
 * is rejected by the same logic that accepts CM.
 */
const SUBTRACTIVE_PAIRS: ReadonlySet<string> = new Set([
  'IV',
  'IX',
  'XL',
  'XC',
  'CD',
  'CM',
]);

const ROMAN_ONLY = /[IVXLCDM]/g;

/**
 * Shown wherever the range limit is explained.
 *
 * Kept in one place so the Arabic-side and Roman-side errors cannot drift into
 * telling the user two different stories about 4000.
 */
const RANGE_NOTE =
  '标准罗马数字只用 M、D、C、L、X、V、I 组合表示 1–3999，最大是 3999（MMMCMXCIX）。' +
  '4000 及以上需要额外约定：在符号上方加横线（vinculum，表示乘以 1000，例如带上划线的 V 表示 5000），' +
  '或使用 MMMM 这类中世纪变体。这些写法在纯文本里没有唯一、通行的形式，' +
  '本工具不臆造它们，因此明确报错而不是给出一个可能错误的答案。';

/** A conversion either succeeds with a value or explains why it could not. */
export type RomanResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): RomanResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): RomanResult<T> {
  return { ok: false, error };
}

/**
 * Guards the numeric entry points.
 *
 * `encodeRoman` and friends are the unchecked core: the string-facing
 * converters validate first, so reaching here with 0 or 4000 means a caller
 * skipped validation. Throwing makes that a loud programming error instead of a
 * quietly wrong string.
 */
function assertEncodable(value: number): void {
  if (!Number.isInteger(value) || value < MIN_VALUE || value > MAX_VALUE) {
    throw new RangeError(
      `标准罗马数字只表示 ${MIN_VALUE}–${MAX_VALUE} 的整数，收到 ${String(value)}`,
    );
  }
}

/**
 * Standard encoding, e.g. 1994 becomes MCMXCIV.
 *
 * Throws a RangeError outside 1–3999; use `convertArabic` for untrusted input.
 */
export function encodeRoman(value: number): string {
  assertEncodable(value);
  let text = '';
  let remaining = value;
  for (const entry of ROMAN_TABLE) {
    while (remaining >= entry.value) {
      text += entry.symbol;
      remaining -= entry.value;
    }
  }
  return text;
}

/**
 * The greedy steps behind `encodeRoman`, in written order.
 *
 * 1994 yields M, CM, XC, IV. The steps sum to the input by construction, which
 * the checker asserts for every value in range — a breakdown that does not add
 * up would be worse than none.
 */
export function decompose(value: number): RomanStep[] {
  assertEncodable(value);
  const steps: RomanStep[] = [];
  let remaining = value;
  for (const entry of ROMAN_TABLE) {
    while (remaining >= entry.value) {
      steps.push(entry);
      remaining -= entry.value;
    }
  }
  return steps;
}

/**
 * Non-standard additive spelling.
 *
 * 1994 becomes MDCCCCLXXXXIIII instead of MCMXCIV. Never present this without
 * saying that it is not the standard form.
 */
export function toAdditiveRoman(value: number): string {
  assertEncodable(value);
  let text = '';
  let remaining = value;
  for (const entry of ADDITIVE_TABLE) {
    while (remaining >= entry.value) {
      text += entry.symbol;
      remaining -= entry.value;
    }
  }
  return text;
}

/** `M + CM + XC + IV` */
export function formatBreakdown(steps: readonly RomanStep[]): string {
  return steps.map((step) => step.symbol).join(' + ');
}

/**
 * `1000 + 900 + 90 + 4 = 1994`
 *
 * The running-total form is spelled out because the symbol-only line does not
 * show *why* CM is one step rather than two; with the numbers beside them the
 * subtractive pairs become self-explanatory. The total is summed from the steps
 * rather than passed in, so this line cannot disagree with the list above it.
 */
export function formatBreakdownValues(steps: readonly RomanStep[]): string {
  const total = steps.reduce((sum, step) => sum + step.value, 0);
  return `${steps.map((step) => step.value).join(' + ')} = ${total}`;
}

/**
 * Plain subtractive accumulation, used only to compute what a non-standard
 * string would be read as.
 *
 * It deliberately does no legality checking: on IIII it returns 4, and on VX it
 * returns 5. That is useful for the error message ("reads as 4, the standard
 * spelling is IV") and dangerous as an answer — which is why the only caller
 * compares the result against a re-encoding before accepting it.
 */
function subtractiveSum(text: string): number {
  let total = 0;
  for (let index = 0; index < text.length; index += 1) {
    const current = SYMBOL_VALUES[text[index]];
    const next = SYMBOL_VALUES[text[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

/**
 * Names the first rule the string breaks, or null when it is well formed.
 *
 * Used to make rejection messages specific — "VX is not a legal subtractive
 * pair" teaches more than "invalid input". It is not itself the validity test;
 * the canonical round-trip check in `decodeRoman` is, because it is exhaustive
 * rather than a list of cases someone remembered to write down.
 */
export function romanRuleViolation(text: string): string | null {
  const run = /([IVXLCDM])\1{3,}/.exec(text);
  if (run) {
    return `符号“${run[1]}”连续出现了 ${run[0].length} 次，而标准写法中同一符号最多连续出现 3 次`;
  }

  for (let index = 0; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    const left = SYMBOL_VALUES[text[index]];
    const right = SYMBOL_VALUES[text[index + 1]];
    if (left < right && !SUBTRACTIVE_PAIRS.has(pair)) {
      return `“${pair}”不是合法的减法组合，只有 I 可在 V、X 之前，X 可在 L、C 之前，C 可在 D、M 之前表示减法`;
    }
  }

  return null;
}

/**
 * Strict decoder: returns the value only for the canonical spelling.
 *
 * The acceptance test is a round trip. The string is summed with the
 * subtractive rule, and the sum is re-encoded; a string is accepted only when
 * re-encoding reproduces it exactly. Since encoding is injective onto the set of
 * canonical strings, that test is equivalent to "is canonical" and is
 * exhaustive — unlike a regex or a blacklist, it cannot miss a malformed case
 * that no one thought of, and it can never answer with a value the encoder would
 * not produce.
 *
 * Lower case is accepted because users paste whatever they were given.
 */
export function decodeRoman(input: unknown): RomanResult<number> {
  if (typeof input !== 'string') return fail('请输入要解码的罗马数字。');

  const text = input.trim().toUpperCase();
  if (text === '') return fail('请输入要解码的罗马数字（例如 MCMXCIV）。');

  // Character check before the length check: a long run of junk should say why
  // it is junk, not merely that it is long.
  const alien = text.replace(ROMAN_ONLY, '');
  if (alien !== '') {
    const shown = alien.length > 20 ? `${alien.slice(0, 20)}…` : alien;
    return fail(`含有非罗马数字字符：“${shown}”。只接受 I、V、X、L、C、D、M（不区分大小写）。`);
  }

  if (text.length > MAX_ROMAN_LENGTH) {
    return fail(
      `输入过长：标准罗马数字最长 ${MAX_ROMAN_LENGTH} 位（3888 = MMMDCCCLXXXVIII），` +
        `而这里出现了 ${text.length} 个字符，必然不是标准写法。`,
    );
  }

  const value = subtractiveSum(text);
  if (value < MIN_VALUE || value > MAX_VALUE) {
    return fail(`“${text}”按减法规则读作 ${value}，超出标准罗马数字能表示的范围。${RANGE_NOTE}`);
  }

  const canonical = encodeRoman(value);
  if (text !== canonical) {
    const violation = romanRuleViolation(text);
    return fail(
      `“${text}”不是标准（减法制）写法` +
        (violation ? `：${violation}` : '') +
        `。它按规则读作 ${value}，而 ${value} 的标准写法是“${canonical}”。`,
    );
  }

  return ok(value);
}

/** Everything the UI needs after a successful number-to-numeral conversion. */
export interface ArabicConversion {
  /** Parsed integer, guaranteed to be within 1–3999. */
  value: number;
  /** Standard spelling. */
  roman: string;
  /** Greedy steps that spell `roman`. */
  steps: RomanStep[];
  /** `M + CM + XC + IV` */
  breakdown: string;
  /** `1000 + 900 + 90 + 4 = 1994` */
  breakdownValues: string;
  /** Non-standard additive spelling, for contrast only. */
  additive: string;
}

/**
 * Turns user input into a conversion, or into a reason why there is none.
 *
 * The input is a string rather than a number on purpose: `Number('')` is 0 and
 * `Number('1e3')` is 1000, so a numeric parameter would have already lost the
 * distinction between "empty", "1000" and "1000.4" before any check could run.
 * Trimming is allowed; every other convenience notation is refused, because
 * silently interpreting it would hide a misunderstanding of the format.
 */
export function convertArabic(input: unknown): RomanResult<ArabicConversion> {
  if (typeof input !== 'string') return fail('请输入阿拉伯数字。');

  const text = input.trim();
  if (text === '') return fail('请输入阿拉伯数字。');

  if (text.startsWith('-') || text.startsWith('−')) {
    return fail('负数没有标准罗马数字写法：罗马数字体系既没有负号，也不用来表示负数。');
  }

  if (/^[0-9]+\.[0-9]+$/.test(text)) {
    return fail('罗马数字只表示正整数，不接受小数。');
  }

  if (!/^[0-9]+$/.test(text)) {
    return fail('阿拉伯数字只能包含 0–9，不接受千分位分隔符、科学计数法、正号或其它字符。');
  }

  if (text.length > 4) {
    return fail(
      `输入过长：标准罗马数字最大为 ${MAX_VALUE}（4 位数），` +
        `而这里出现了 ${text.length} 位数字，必然超出范围。`,
    );
  }

  const value = Number(text);
  if (value === 0) {
    return fail('0 没有标准罗马数字写法：罗马数字体系里没有表示 0 的符号。');
  }
  if (value > MAX_VALUE) {
    return fail(`${value} 超出了标准罗马数字的范围。${RANGE_NOTE}`);
  }

  const steps = decompose(value);
  const roman = steps.map((step) => step.symbol).join('');
  return ok({
    value,
    roman,
    steps,
    breakdown: formatBreakdown(steps),
    breakdownValues: formatBreakdownValues(steps),
    additive: toAdditiveRoman(value),
  });
}

/** Everything the UI needs after a successful numeral-to-number conversion. */
export interface RomanConversion {
  /** The input as typed, trimmed but otherwise untouched. */
  original: string;
  /** Canonical upper-case spelling, identical to `original` up to case. */
  roman: string;
  /** Decoded integer. */
  value: number;
  /** Greedy steps that spell `roman`. */
  steps: RomanStep[];
  /** `M + CM + XC + IV` */
  breakdown: string;
  /** `1000 + 900 + 90 + 4 = 1994` */
  breakdownValues: string;
  /** Non-standard additive spelling of the same value, for contrast only. */
  additive: string;
}

/** Decodes strict Roman input and attaches the same explanation as the encoder. */
export function convertRoman(input: unknown): RomanResult<RomanConversion> {
  const decoded = decodeRoman(input);
  if (!decoded.ok) return { ok: false, error: decoded.error };

  const value = decoded.value;
  const steps = decompose(value);
  const roman = steps.map((step) => step.symbol).join('');

  return ok({
    original: typeof input === 'string' ? input.trim() : '',
    roman,
    value,
    steps,
    breakdown: formatBreakdown(steps),
    breakdownValues: formatBreakdownValues(steps),
    additive: toAdditiveRoman(value),
  });
}
