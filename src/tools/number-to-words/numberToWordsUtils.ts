/**
 * Number → words, in English and Chinese.
 *
 * ## Why the whole value stays a string
 *
 * Nothing here converts the user's number to a JavaScript `number`. That is
 * deliberate and it is the single most important design decision in the module:
 * `Number` cannot represent most of what a word-speller is asked about.
 *
 *   - `String(0.1 + 0.2)` is `"0.30000000000000004"`, so a value that travelled
 *     through floating point spells out digits the user never typed.
 *   - `String(1e21)` is `"1e+21"`, and a naive implementation then either
 *     chokes on the `e` or spells it as "one e twenty-one".
 *   - `Number` silently rounds past 2^53, so "one quintillion and one" comes
 *     back as "one quintillion".
 *
 * The input is therefore parsed as a *decimal string* — including scientific
 * notation, which is expanded by shifting the decimal point over the digit
 * string — and every formatting routine takes those digit strings. `Number` is
 * used only on groups of at most three digits, where it is exact.
 *
 * ## Why Chinese needs its own algorithm
 *
 * Chinese groups by 10^4 (万 / 亿 / 兆 / 京 / 垓), English by 10^3
 * (thousand / million / …). `100000000` is 一亿 in Chinese and "one hundred
 * million" in English; an implementation that reuses the English grouping and
 * swaps the unit names gets that wrong. Zero-filling is different too: Chinese
 * inserts 零 between non-adjacent non-zero places (10001 → 一万零一) and drops a
 * leading 一 before 十 (12 → 十二, but 112 → 一百一十二).
 *
 * The financial (大写) forms differ only in the digit and place characters
 * (壹佰贰拾叁), which is why they share the algorithm instead of duplicating it.
 */

/** Result of formatting something the user might not have given a valid value. */
export interface WordResult {
  ok: boolean;
  text: string;
  error: string;
}

function ok(text: string): WordResult {
  return { ok: true, text, error: '' };
}

function fail(error: string): WordResult {
  return { ok: false, text: '', error };
}

export interface ParsedNumber {
  ok: boolean;
  error: string;
  /** 1 or -1. */
  sign: 1 | -1;
  /** Integer digits with leading zeros removed; `"0"` when the value is 0. */
  integer: string;
  /** Fraction digits exactly as written, after scientific-notation expansion. */
  fraction: string;
  /** True when there is no fractional part (or only `.0…`? no — exactly none). */
  isInteger: boolean;
  /** The input re-expressed as a plain decimal string, e.g. `"-12.50"`. */
  canonical: string;
}

/** Upper bound on |value|: 10^21, i.e. just past 999 quintillion. */
export const MAX_ABS_EXCLUSIVE = 10n ** 21n;

/** Longest input accepted, in characters. Guards against pasted megabytes. */
export const MAX_INPUT_LENGTH = 200;

/** Largest number of fraction digits accepted. */
export const MAX_FRACTION_DIGITS = 30;

/** Largest decimal exponent accepted before range checking kicks in. */
const MAX_EXPONENT = 100;

function stripLeadingZeros(digits: string): string {
  const stripped = digits.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

/**
 * Parses a decimal string, an integer, or scientific notation.
 *
 * Accepted: `123`, `-123`, `+1`, `0.5`, `.5`, `5.`, `007`, `1e21`, `1.5e-3`.
 * Rejected with a specific message: empty input, letters, `1.2.3`, `1e`, a
 * thousands separator (`1,000`), and anything longer than
 * `MAX_INPUT_LENGTH`/`MAX_FRACTION_DIGITS`.
 *
 * Leading zeros in the integer part are dropped (`007` → `seven`), but zeros in
 * the fraction are kept (`0.05` → "zero point zero five") because there they
 * carry meaning.
 */
export function parseNumericInput(raw: string): ParsedNumber {
  const invalid = (error: string): ParsedNumber => ({
    ok: false,
    error,
    sign: 1,
    integer: '0',
    fraction: '',
    isInteger: true,
    canonical: '',
  });

  const trimmed = raw.trim();
  if (trimmed === '') return invalid('请输入要转换的数字');

  if (trimmed.length > MAX_INPUT_LENGTH) {
    return invalid(`输入过长（最多 ${MAX_INPUT_LENGTH} 个字符）`);
  }

  if (trimmed.includes(',')) {
    return invalid('不支持千分位逗号，请去掉逗号后再输入');
  }

  if (!/^[+-]?[0-9.eE+-]+$/.test(trimmed)) {
    return invalid('含有数字、正负号、小数点与科学计数法以外的字符');
  }

  let sign: 1 | -1 = 1;
  let body = trimmed;
  if (body.startsWith('+') || body.startsWith('-')) {
    if (body.startsWith('-')) sign = -1;
    body = body.slice(1);
  }

  const exponentParts = body.split(/[eE]/);
  if (exponentParts.length > 2) return invalid('科学计数法格式不合法');
  const mantissa = exponentParts[0];
  let exponent = 0;
  if (exponentParts.length === 2) {
    const exponentText = exponentParts[1];
    if (!/^[+-]?\d+$/.test(exponentText)) return invalid('科学计数法的指数不合法');
    exponent = Number(exponentText);
    if (!Number.isFinite(exponent) || Math.abs(exponent) > MAX_EXPONENT) {
      return invalid(`指数超出范围（最多 ±${MAX_EXPONENT}）`);
    }
  }

  const mantissaMatch = /^(\d*)(?:\.(\d*))?$/.exec(mantissa);
  if (!mantissaMatch) return invalid('数字格式不合法（只支持一个正负号与一个小数点）');
  const intPart = mantissaMatch[1] ?? '';
  const fracPart = mantissaMatch[2] ?? '';
  if (intPart === '' && fracPart === '') return invalid('没有可转换的数字');

  // Shift the decimal point: the digits themselves never change, only where
  // the point sits. This is what makes `1e21` and `1.5e-3` exact.
  const digits = intPart + fracPart;
  let pointPosition = intPart.length + exponent;

  let integer: string;
  let fraction: string;
  if (pointPosition <= 0) {
    integer = '';
    fraction = '0'.repeat(-pointPosition) + digits;
  } else if (pointPosition >= digits.length) {
    integer = digits + '0'.repeat(pointPosition - digits.length);
    fraction = '';
  } else {
    integer = digits.slice(0, pointPosition);
    fraction = digits.slice(pointPosition);
  }

  if (fraction.length > MAX_FRACTION_DIGITS) {
    return invalid(`小数位过多（最多 ${MAX_FRACTION_DIGITS} 位）`);
  }

  // `5.` parses as integer 5 with an empty fraction, and that is an integer.
  const normalisedInteger = stripLeadingZeros(integer);

  return {
    ok: true,
    error: '',
    sign,
    integer: normalisedInteger,
    fraction,
    isInteger: fraction === '',
    canonical: `${sign === -1 ? '-' : ''}${normalisedInteger}${fraction ? `.${fraction}` : ''}`,
  };
}

/**
 * Whether the value is genuinely negative.
 *
 * `-0` and `-0.00` parse with `sign === -1` but mean zero; saying "minus zero"
 * would be pedantic rather than precise.
 */
export function isNegativeValue(parsed: ParsedNumber): boolean {
  return parsed.sign === -1 && (parsed.integer !== '0' || /[1-9]/.test(parsed.fraction));
}

/** True when the parsed magnitude is inside the supported scale. */
export function isWithinRange(parsed: ParsedNumber): boolean {
  if (!parsed.ok) return false;
  return BigInt(parsed.integer) < MAX_ABS_EXCLUSIVE;
}

const RANGE_ERROR =
  '超出支持范围：绝对值需小于 10^21（即 999 quintillion / 999 垓）';

// --- English ---------------------------------------------------------------

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

/** Short scale names, one per group of three digits. */
const SCALES = [
  '', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion',
];

/**
 * Words for a group of at most three digits.
 *
 * `Number` is safe here and only here: the argument is at most 999, far below
 * the range where doubles lose integers.
 */
function threeDigitWords(group: string): string {
  const value = Number(group);
  if (value === 0) return '';
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      // British style hyphenates the tens–ones pair ("twenty-three"); it is the
      // convention every check-writing reference uses.
      parts.push(ones === 0 ? TENS[tens] : `${TENS[tens]}-${ONES[ones]}`);
    }
  }
  return parts.join(' ');
}

/**
 * Integer digits → English words.
 *
 * Zero groups are skipped rather than spelled, which is what stops
 * `1000000` from becoming "one thousand thousand".
 */
export function integerToEnglishWords(digits: string): string {
  const normalised = stripLeadingZeros(digits);
  if (normalised === '0') return 'zero';

  const groups: string[] = [];
  for (let end = normalised.length; end > 0; end -= 3) {
    groups.push(normalised.slice(Math.max(0, end - 3), end));
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const words = threeDigitWords(groups[i]);
    if (words === '') continue;
    parts.push(SCALES[i] ? `${words} ${SCALES[i]}` : words);
  }
  return parts.join(' ');
}

/** Fraction digits → "one four", i.e. read digit by digit. */
export function fractionToEnglishWords(fraction: string): string {
  return [...fraction].map((digit) => ONES[Number(digit)]).join(' ');
}

/** Integer part, fraction part, and minus sign for negatives. */
export function englishWordsFor(parsed: ParsedNumber): WordResult {
  if (!parsed.ok) return fail(parsed.error);
  if (!isWithinRange(parsed)) return fail(RANGE_ERROR);
  const words = integerToEnglishWords(parsed.integer);
  const withFraction = parsed.fraction
    ? `${words} point ${fractionToEnglishWords(parsed.fraction)}`
    : words;
  return ok(isNegativeValue(parsed) ? `minus ${withFraction}` : withFraction);
}

const ORDINAL_IRREGULAR: Record<string, string> = {
  zero: 'zeroth',
  one: 'first',
  two: 'second',
  three: 'third',
  four: 'fourth',
  five: 'fifth',
  six: 'sixth',
  seven: 'seventh',
  eight: 'eighth',
  nine: 'ninth',
  ten: 'tenth',
  eleven: 'eleventh',
  twelve: 'twelfth',
};

/** Turns one cardinal word into its ordinal form. */
function ordinalWord(word: string): string {
  const irregular = ORDINAL_IRREGULAR[word];
  if (irregular) return irregular;
  if (word.endsWith('y')) return `${word.slice(0, -1)}ieth`;
  return `${word}th`;
}

/**
 * Cardinal phrase → ordinal phrase.
 *
 * Only the *last* word changes: "one hundred twenty-three" →
 * "one hundred twenty-third", "one million" → "one millionth". A hyphenated
 * pair keeps its hyphen and ordinalises the tail.
 */
export function toOrdinalPhrase(cardinal: string): string {
  const words = cardinal.split(' ');
  const last = words[words.length - 1];
  const ordinal = last.includes('-')
    ? `${last.slice(0, last.lastIndexOf('-'))}-${ordinalWord(last.slice(last.lastIndexOf('-') + 1))}`
    : ordinalWord(last);
  words[words.length - 1] = ordinal;
  return words.join(' ');
}

/** `st` / `nd` / `rd` / `th` for the numeric form (1st, 2nd, 3rd, 4th). */
export function ordinalSuffix(digits: string): string {
  const normalised = stripLeadingZeros(digits);
  const lastTwo = Number(normalised.slice(-2));
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  switch (lastTwo % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * Ordinal words. Decimals and negatives have no sensible English ordinal, so
 * they are refused rather than mangled.
 */
export function englishOrdinalFor(parsed: ParsedNumber): WordResult {
  if (!parsed.ok) return fail(parsed.error);
  if (isNegativeValue(parsed)) {
    return fail('序数词不支持负数');
  }
  if (parsed.fraction !== '') {
    return fail('序数词只支持整数（小数没有公认的读法）');
  }
  if (!isWithinRange(parsed)) return fail(RANGE_ERROR);
  return ok(toOrdinalPhrase(integerToEnglishWords(parsed.integer)));
}

// --- Currency (check-writing style) ---------------------------------------

export interface CurrencyDefinition {
  id: string;
  label: string;
  /** Singular major unit, e.g. `dollar`. */
  major: string;
  /** Plural major unit, e.g. `dollars`. */
  majorPlural: string;
  /** Minor unit name, e.g. `cents`. Shown in the UI's explanation. */
  minor: string;
}

export const CURRENCIES: CurrencyDefinition[] = [
  { id: 'usd', label: '美元 USD（dollar / cents）', major: 'dollar', majorPlural: 'dollars', minor: 'cents' },
  { id: 'eur', label: '欧元 EUR（euro / cents）', major: 'euro', majorPlural: 'euros', minor: 'cents' },
  { id: 'gbp', label: '英镑 GBP（pound / pence）', major: 'pound', majorPlural: 'pounds', minor: 'pence' },
  { id: 'cny', label: '人民币 CNY（yuan / fen）', major: 'yuan', majorPlural: 'yuan', minor: 'fen' },
];

export const DEFAULT_CURRENCY_ID = 'usd';

export function getCurrency(id: string): CurrencyDefinition {
  return CURRENCIES.find((currency) => currency.id === id) ?? CURRENCIES[0];
}

/**
 * Rounds a decimal string to whole cents, half away from zero.
 *
 * Done with `BigInt` on the digit strings rather than by multiplying a double
 * by 100: `1.005 * 100` is `100.49999999999999` in binary floating point, which
 * truncates to $1.00 instead of $1.01.
 */
export function roundToCents(integer: string, fraction: string): { dollars: bigint; cents: bigint } {
  const centsDigits = (fraction + '00').slice(0, 2);
  const thirdDigit = Number(fraction[2] ?? '0');
  let total = BigInt(integer) * 100n + BigInt(centsDigits);
  if (thirdDigit >= 5) total += 1n;
  return { dollars: total / 100n, cents: total % 100n };
}

/**
 * Check-writing style: `one hundred twenty-three dollars and 45/100`.
 *
 * Zero still names the major unit ("zero dollars and 05/100") because that is
 * what a cheque requires; the singular form is used for exactly one unit.
 */
export function englishCurrencyFor(parsed: ParsedNumber, currencyId = DEFAULT_CURRENCY_ID): WordResult {
  if (!parsed.ok) return fail(parsed.error);
  if (!isWithinRange(parsed)) return fail(RANGE_ERROR);
  const currency = getCurrency(currencyId);
  const { dollars, cents } = roundToCents(parsed.integer, parsed.fraction);
  const words = integerToEnglishWords(dollars.toString());
  const unit = dollars === 1n ? currency.major : currency.majorPlural;
  const centsText = cents.toString().padStart(2, '0');
  const amount = `${words} ${unit} and ${centsText}/100`;
  return ok(isNegativeValue(parsed) ? `minus ${amount}` : amount);
}

// --- Chinese ---------------------------------------------------------------

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_FINANCIAL_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const CN_PLACES = ['', '十', '百', '千'];
const CN_FINANCIAL_PLACES = ['', '拾', '佰', '仟'];
/** Group units for 10^4, 10^8, … — the Chinese grouping, not the English one. */
const CN_GROUP_UNITS = ['', '万', '亿', '兆', '京', '垓'];

/**
 * Integer digits → Chinese words.
 *
 * `financial` switches the digit and place characters to the 大写 set used on
 * invoices and cheques (1234 → 壹仟贰佰叁拾肆). The grouping and zero rules are
 * identical, so the flag is threaded through rather than forking the algorithm.
 */
export function integerToChineseWords(digits: string, financial = false): string {
  const normalised = stripLeadingZeros(digits);
  if (normalised === '0') return '零';

  const digitChars = financial ? CN_FINANCIAL_DIGITS : CN_DIGITS;
  const placeChars = financial ? CN_FINANCIAL_PLACES : CN_PLACES;

  // Groups of four, low to high: 亿 = 10^8 = the third group.
  const groups: string[] = [];
  for (let end = normalised.length; end > 0; end -= 4) {
    groups.push(normalised.slice(Math.max(0, end - 4), end));
  }

  let result = '';
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const padded = groups[i].padStart(4, '0');
    if (padded === '0000') {
      // A whole empty group still needs one 零 if anything non-zero follows it:
      // 100000001 is 一亿零一, not 一亿一.
      const lowerNonZero = groups.slice(0, i).some((group) => stripLeadingZeros(group) !== '0');
      if (result !== '' && lowerNonZero && !result.endsWith('零')) result += '零';
      continue;
    }
    // A group that does not fill its four places is separated from the higher
    // group by 零: 10001 → 一万零一.
    if (result !== '' && padded.startsWith('0') && !result.endsWith('零')) result += '零';

    let section = '';
    let pendingZero = false;
    for (let position = 0; position < 4; position += 1) {
      const digit = padded[position];
      const place = 3 - position;
      if (digit === '0') {
        // 零 is only written between two non-zero digits, never twice and never
        // at the tail: 10010 → 一万零一十, 10000 → 一万.
        if (section !== '') pendingZero = true;
        continue;
      }
      if (pendingZero) {
        section += digitChars[0];
        pendingZero = false;
      }
      section += digitChars[Number(digit)] + placeChars[place];
    }
    result += section + (CN_GROUP_UNITS[i] ?? '');
  }

  // Spoken Chinese drops the leading 一 in 10–19 and in 十万/十一万: 12 → 十二.
  // Written financial Chinese never does: 10 → 壹拾.
  if (!financial && result.startsWith('一十')) result = result.slice(1);
  return result;
}

/** Fraction digits → 点 + one character per digit. */
export function fractionToChineseWords(fraction: string, financial = false): string {
  const digitChars = financial ? CN_FINANCIAL_DIGITS : CN_DIGITS;
  return [...fraction].map((digit) => digitChars[Number(digit)]).join('');
}

/**
 * Full Chinese reading, plain (`一百二十三`) or financial (`壹佰贰拾叁`).
 *
 * Decimals keep the 点 marker and read digit by digit in both modes; that is
 * the only reading in common use, and inventing a place-value decimal reading
 * would be wrong rather than merely different.
 */
export function chineseWordsFor(parsed: ParsedNumber, financial = false): WordResult {
  if (!parsed.ok) return fail(parsed.error);
  if (!isWithinRange(parsed)) return fail(RANGE_ERROR);
  const integerWords = integerToChineseWords(parsed.integer, financial);
  const withFraction = parsed.fraction
    ? `${integerWords}点${fractionToChineseWords(parsed.fraction, financial)}`
    : integerWords;
  return ok(isNegativeValue(parsed) ? `负${withFraction}` : withFraction);
}

// --- Convenience wrappers --------------------------------------------------

/** Parse-then-format for callers that only have the raw string. */
export function englishWordsOf(raw: string): WordResult {
  return englishWordsFor(parseNumericInput(raw));
}

export function englishOrdinalOf(raw: string): WordResult {
  return englishOrdinalFor(parseNumericInput(raw));
}

export function englishCurrencyOf(raw: string, currencyId = DEFAULT_CURRENCY_ID): WordResult {
  return englishCurrencyFor(parseNumericInput(raw), currencyId);
}

export function chineseWordsOf(raw: string, financial = false): WordResult {
  return chineseWordsFor(parseNumericInput(raw), financial);
}
