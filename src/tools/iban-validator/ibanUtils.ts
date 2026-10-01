/**
 * IBAN validation and parsing — pure logic. No React, no DOM, no clock, no
 * randomness, so everything here is directly testable from Node.
 *
 * What an IBAN is (ISO 13616):
 *
 *   DE 89 370400440532013000
 *   |  |  |
 *   |  |  +--- BBAN: country specific, up to 30 characters
 *   |  +------ check digits: exactly two digits
 *   +--------- country code: two letters, ISO 3166-1 alpha-2
 *
 * Three different things can be wrong with a typed-in IBAN, and people
 * routinely conflate them:
 *
 *   1. the prefix is not an IBAN country at all
 *   2. the total length is wrong for that country (the most common typo by far,
 *      because every country picks its own length between 15 and 32)
 *   3. the mod-97 check digits do not match
 *
 * They are computed and reported separately. Collapsing them into one "invalid"
 * flag is what makes most online validators useless: the user cannot tell a
 * missing digit from a mistyped one.
 *
 * Scope, stated plainly: passing here means the string is well formed. It says
 * nothing about whether the account exists, is open, or belongs to anyone —
 * that requires a bank interface, which a static page cannot have.
 */

/** Structure of one contiguous slice of the BBAN. */
export interface BbanField {
  /** Human readable role, e.g. 银行代码. Chinese because the UI is Chinese. */
  label: string;
  /** 0-based offset inside the BBAN (i.e. inside the IBAN after the first 4). */
  start: number;
  length: number;
}

/** Everything known about one IBAN country. */
export interface IbanCountry {
  /** ISO 3166-1 alpha-2 code. */
  code: string;
  name: string;
  /** Total IBAN length in characters, from the SWIFT IBAN Registry. */
  length: number;
  /**
   * BBAN slices, in the order the registry lists them.
   *
   * Optional because a country that is recognised but whose layout is not
   * tabulated here (or has not been typed in yet) must still be representable —
   * the UI shows the whole BBAN in that case rather than inventing boundaries.
   */
  fields?: BbanField[];
}

/**
 * Builds the slice list for one country.
 *
 * Taking alternating length/label arguments and accumulating the offset here,
 * rather than writing `start` by hand per field, removes the whole class of
 * off-by-one and overlapping-range mistakes: contiguous, gap-free slices that
 * start at 0 are guaranteed by construction. A test still asserts that the
 * lengths add up to the country's BBAN size, so a wrong number in the table
 * below cannot quietly misalign every following field.
 */
function bban(...parts: Array<number | string>): BbanField[] {
  const fields: BbanField[] = [];
  let start = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const length = parts[index] as number;
    const label = parts[index + 1] as string;
    fields.push({ label, start, length });
    start += length;
  }
  return fields;
}

/**
 * IBAN countries, their total IBAN length and their BBAN layout.
 *
 * Source: the SWIFT IBAN Registry (the "IBAN length", "BBAN structure" and
 * "IBAN fields" columns), which lists 89 countries as of the December 2024
 * release. Only officially registered countries appear here. A country that
 * merely uses IBAN-like numbering — Morocco, Senegal, Algeria and a dozen other
 * West and Central African countries publish one — is deliberately absent and
 * is reported to the user as "not in the registry" rather than validated
 * against a length that SWIFT never registered.
 *
 * The `fields` groupings follow the registry's own field breakdown, not a guess
 * at where a bank code "probably" ends: several countries (Finland, Iceland,
 * Costa Rica, Seychelles, Mauritius) split their BBAN in a place that the
 * obvious reading of the account number would get wrong. The check script
 * carries a second, independently transcribed copy of this same table and
 * asserts that the slice lengths agree country by country, so a wrong boundary
 * has to be wrong twice, in the same way, to slip through.
 *
 * Every entry's slices must sum to `length - 4`; the check script enforces that
 * as well.
 */
const IBAN_REGISTRY: readonly IbanCountry[] = [
  { code: 'AD', name: '安道尔', length: 24, fields: bban(4, '银行代码', 4, '分行代码', 12, '账号') },
  { code: 'AE', name: '阿联酋', length: 23, fields: bban(3, '银行代码', 16, '账号') },
  { code: 'AL', name: '阿尔巴尼亚', length: 28, fields: bban(3, '银行代码', 4, '分行代码', 1, '校验位', 16, '账号') },
  { code: 'AT', name: '奥地利', length: 20, fields: bban(5, '银行代码', 11, '账号') },
  { code: 'AZ', name: '阿塞拜疆', length: 28, fields: bban(4, '银行代码', 20, '账号') },
  { code: 'BA', name: '波斯尼亚和黑塞哥维那', length: 20, fields: bban(3, '银行代码', 3, '分行代码', 8, '账号', 2, '校验位') },
  { code: 'BE', name: '比利时', length: 16, fields: bban(3, '银行代码', 7, '账号', 2, '校验位') },
  { code: 'BG', name: '保加利亚', length: 22, fields: bban(4, '银行代码', 4, '分行代码', 2, '账户类型', 8, '账号') },
  { code: 'BH', name: '巴林', length: 22, fields: bban(4, '银行代码', 14, '账号') },
  { code: 'BI', name: '布隆迪', length: 27, fields: bban(5, '银行代码', 5, '分行代码', 13, '账号') },
  { code: 'BR', name: '巴西', length: 29, fields: bban(8, '银行代码', 5, '分行代码', 10, '账号', 1, '账户类型', 1, '所有者标识') },
  { code: 'BY', name: '白俄罗斯', length: 28, fields: bban(4, '银行代码', 4, '余额代码', 16, '账号') },
  { code: 'CH', name: '瑞士', length: 21, fields: bban(5, '银行代码', 12, '账号') },
  { code: 'CR', name: '哥斯达黎加', length: 22, fields: bban(1, '固定为 0', 3, '银行代码', 14, '账号') },
  { code: 'CY', name: '塞浦路斯', length: 28, fields: bban(3, '银行代码', 5, '分行代码', 16, '账号') },
  { code: 'CZ', name: '捷克', length: 24, fields: bban(4, '银行代码', 6, '账号前缀', 10, '账号') },
  { code: 'DE', name: '德国', length: 22, fields: bban(8, '银行代码', 10, '账号') },
  { code: 'DJ', name: '吉布提', length: 27, fields: bban(5, '银行代码', 5, '分行代码', 13, '账号') },
  { code: 'DK', name: '丹麦', length: 18, fields: bban(4, '银行代码', 9, '账号', 1, '校验位') },
  { code: 'DO', name: '多米尼加共和国', length: 28, fields: bban(4, '银行代码', 20, '账号') },
  { code: 'EE', name: '爱沙尼亚', length: 20, fields: bban(2, '银行代码', 2, '分行代码', 11, '账号', 1, '校验位') },
  { code: 'EG', name: '埃及', length: 29, fields: bban(4, '银行代码', 4, '分行代码', 17, '账号') },
  { code: 'ES', name: '西班牙', length: 24, fields: bban(4, '银行代码', 4, '分行代码', 2, '校验位', 10, '账号') },
  { code: 'FI', name: '芬兰', length: 18, fields: bban(6, '银行及分行代码', 7, '账号', 1, '校验位') },
  { code: 'FK', name: '福克兰群岛', length: 18, fields: bban(2, '银行代码', 12, '账号') },
  { code: 'FO', name: '法罗群岛', length: 18, fields: bban(4, '银行代码', 9, '账号', 1, '校验位') },
  { code: 'FR', name: '法国', length: 27, fields: bban(5, '银行代码', 5, '分行代码', 11, '账号', 2, 'RIB 校验位') },
  { code: 'GB', name: '英国', length: 22, fields: bban(4, '银行代码', 6, '分行代码 (sort code)', 8, '账号') },
  { code: 'GE', name: '格鲁吉亚', length: 22, fields: bban(2, '银行代码', 16, '账号') },
  { code: 'GI', name: '直布罗陀', length: 23, fields: bban(4, '银行代码', 15, '账号') },
  { code: 'GL', name: '格陵兰', length: 18, fields: bban(4, '银行代码', 9, '账号', 1, '校验位') },
  { code: 'GR', name: '希腊', length: 27, fields: bban(3, '银行代码', 4, '分行代码', 16, '账号') },
  { code: 'GT', name: '危地马拉', length: 28, fields: bban(4, '银行代码', 2, '货币代码', 2, '账户类型', 16, '账号') },
  { code: 'HN', name: '洪都拉斯', length: 28, fields: bban(4, '银行代码', 20, '账号') },
  { code: 'HR', name: '克罗地亚', length: 21, fields: bban(7, '银行代码', 10, '账号') },
  { code: 'HU', name: '匈牙利', length: 28, fields: bban(3, '银行代码', 4, '分行代码', 1, '校验位', 15, '账号', 1, '校验位') },
  { code: 'IE', name: '爱尔兰', length: 22, fields: bban(4, '银行代码', 6, '分行代码 (sort code)', 8, '账号') },
  { code: 'IL', name: '以色列', length: 23, fields: bban(3, '银行代码', 3, '分行代码', 13, '账号') },
  { code: 'IQ', name: '伊拉克', length: 23, fields: bban(4, '银行代码', 3, '分行代码', 12, '账号') },
  { code: 'IS', name: '冰岛', length: 26, fields: bban(2, '银行代码', 2, '分行代码', 2, '账户类型', 6, '账号', 10, '身份号') },
  { code: 'IT', name: '意大利', length: 27, fields: bban(1, 'CIN 校验字符', 5, '银行代码', 5, '分行代码', 12, '账号') },
  { code: 'JO', name: '约旦', length: 30, fields: bban(4, '银行代码', 4, '分行代码', 18, '账号') },
  { code: 'KW', name: '科威特', length: 30, fields: bban(4, '银行代码', 22, '账号') },
  { code: 'KZ', name: '哈萨克斯坦', length: 20, fields: bban(3, '银行代码', 13, '账号') },
  { code: 'LB', name: '黎巴嫩', length: 28, fields: bban(4, '银行代码', 20, '账号') },
  { code: 'LC', name: '圣卢西亚', length: 32, fields: bban(4, '银行代码', 24, '账号') },
  { code: 'LI', name: '列支敦士登', length: 21, fields: bban(5, '银行代码', 12, '账号') },
  { code: 'LT', name: '立陶宛', length: 20, fields: bban(5, '银行代码', 11, '账号') },
  { code: 'LU', name: '卢森堡', length: 20, fields: bban(3, '银行代码', 13, '账号') },
  { code: 'LV', name: '拉脱维亚', length: 21, fields: bban(4, '银行代码', 13, '账号') },
  { code: 'LY', name: '利比亚', length: 25, fields: bban(3, '银行代码', 3, '分行代码', 15, '账号') },
  { code: 'MC', name: '摩纳哥', length: 27, fields: bban(5, '银行代码', 5, '分行代码', 11, '账号', 2, 'RIB 校验位') },
  { code: 'MD', name: '摩尔多瓦', length: 24, fields: bban(2, '银行代码', 18, '账号') },
  { code: 'ME', name: '黑山', length: 22, fields: bban(3, '银行代码', 13, '账号', 2, '校验位') },
  { code: 'MK', name: '北马其顿', length: 19, fields: bban(3, '银行代码', 10, '账号', 2, '校验位') },
  { code: 'MN', name: '蒙古', length: 20, fields: bban(4, '银行代码', 12, '账号') },
  { code: 'MR', name: '毛里塔尼亚', length: 27, fields: bban(5, '银行代码', 5, '分行代码', 11, '账号', 2, '校验位') },
  { code: 'MT', name: '马耳他', length: 31, fields: bban(4, '银行代码', 5, '分行代码', 18, '账号') },
  { code: 'MU', name: '毛里求斯', length: 30, fields: bban(6, '银行代码', 2, '分行代码', 12, '账号', 3, '固定为 0', 3, '货币代码') },
  { code: 'NI', name: '尼加拉瓜', length: 28, fields: bban(4, '银行代码', 20, '账号') },
  { code: 'NL', name: '荷兰', length: 18, fields: bban(4, '银行代码', 10, '账号') },
  { code: 'NO', name: '挪威', length: 15, fields: bban(4, '银行代码', 6, '账号', 1, '校验位') },
  { code: 'OM', name: '阿曼', length: 23, fields: bban(3, '银行代码', 16, '账号') },
  { code: 'PK', name: '巴基斯坦', length: 24, fields: bban(4, '银行代码', 16, '账号') },
  { code: 'PL', name: '波兰', length: 28, fields: bban(8, '银行代码', 16, '账号') },
  { code: 'PS', name: '巴勒斯坦', length: 29, fields: bban(4, '银行代码', 21, '账号') },
  { code: 'PT', name: '葡萄牙', length: 25, fields: bban(4, '银行代码', 4, '分行代码', 11, '账号', 2, '校验位') },
  { code: 'QA', name: '卡塔尔', length: 29, fields: bban(4, '银行代码', 21, '账号') },
  { code: 'RO', name: '罗马尼亚', length: 24, fields: bban(4, '银行代码', 16, '账号') },
  { code: 'RS', name: '塞尔维亚', length: 22, fields: bban(3, '银行代码', 13, '账号', 2, '校验位') },
  { code: 'RU', name: '俄罗斯', length: 33, fields: bban(9, '银行代码', 5, '分行代码', 15, '账号') },
  { code: 'SA', name: '沙特阿拉伯', length: 24, fields: bban(2, '银行代码', 18, '账号') },
  { code: 'SC', name: '塞舌尔', length: 31, fields: bban(6, '银行代码', 2, '分行代码', 16, '账号', 3, '货币代码') },
  { code: 'SD', name: '苏丹', length: 18, fields: bban(2, '银行代码', 12, '账号') },
  { code: 'SE', name: '瑞典', length: 24, fields: bban(3, '银行代码', 16, '账号', 1, '校验位') },
  { code: 'SI', name: '斯洛文尼亚', length: 19, fields: bban(2, '银行代码', 3, '分行代码', 8, '账号', 2, '校验位') },
  { code: 'SK', name: '斯洛伐克', length: 24, fields: bban(4, '银行代码', 6, '账号前缀', 10, '账号') },
  { code: 'SM', name: '圣马力诺', length: 27, fields: bban(1, 'CIN 校验字符', 5, '银行代码', 5, '分行代码', 12, '账号') },
  { code: 'SO', name: '索马里', length: 23, fields: bban(4, '银行代码', 3, '分行代码', 12, '账号') },
  { code: 'ST', name: '圣多美和普林西比', length: 25, fields: bban(4, '银行代码', 4, '分行代码', 13, '账号') },
  { code: 'SV', name: '萨尔瓦多', length: 28, fields: bban(4, '银行代码', 20, '账号') },
  { code: 'TL', name: '东帝汶', length: 23, fields: bban(3, '银行代码', 14, '账号', 2, '校验位') },
  { code: 'TN', name: '突尼斯', length: 24, fields: bban(2, '银行代码', 3, '分行代码', 13, '账号', 2, '校验位') },
  { code: 'TR', name: '土耳其', length: 26, fields: bban(5, '银行代码', 1, '预留位', 16, '账号') },
  { code: 'UA', name: '乌克兰', length: 29, fields: bban(6, '银行代码', 19, '账号') },
  { code: 'VA', name: '梵蒂冈', length: 22, fields: bban(3, '银行代码', 15, '账号') },
  { code: 'VG', name: '英属维尔京群岛', length: 24, fields: bban(4, '银行代码', 16, '账号') },
  { code: 'XK', name: '科索沃', length: 20, fields: bban(4, '银行代码', 10, '账号', 2, '校验位') },
  { code: 'YE', name: '也门', length: 30, fields: bban(4, '银行代码', 4, '分行代码', 18, '账号') },
];

const COUNTRY_BY_CODE = new Map(IBAN_REGISTRY.map((country) => [country.code, country]));

/**
 * Official example IBANs, as published with the SWIFT IBAN Registry.
 *
 * They are shipped in the app so a visitor can see the parser handle a real
 * number without hunting for one, and the check script validates every entry
 * against an independently implemented mod-97. Only examples that are known to
 * be the registry's own are listed: an invented "example" would make the whole
 * test suite worth nothing, so a country whose example was not certain is
 * simply absent from this list.
 */
export const IBAN_EXAMPLES: ReadonlyArray<{ iban: string; note: string }> = [
  { iban: 'DE89370400440532013000', note: '德国' },
  { iban: 'GB29NWBK60161331926819', note: '英国' },
  { iban: 'GB82WEST12345698765432', note: '英国' },
  { iban: 'FR1420041010050500013M02606', note: '法国' },
  { iban: 'IT60X0542811101000000123456', note: '意大利' },
  { iban: 'ES9121000418450200051332', note: '西班牙' },
  { iban: 'NL91ABNA0417164300', note: '荷兰' },
  { iban: 'BE68539007547034', note: '比利时' },
  { iban: 'CH9300762011623852957', note: '瑞士' },
  { iban: 'AT611904300234573201', note: '奥地利' },
  { iban: 'IE29AIBK93115212345678', note: '爱尔兰' },
  { iban: 'LU280019400644750000', note: '卢森堡' },
  { iban: 'PL61109010140000071219812874', note: '波兰' },
  { iban: 'SE4550000000058398257466', note: '瑞典' },
  { iban: 'NO9386011117947', note: '挪威' },
  { iban: 'DK5000400440116243', note: '丹麦' },
  { iban: 'FI2112345600000785', note: '芬兰' },
  { iban: 'PT50000201231234567890154', note: '葡萄牙' },
  { iban: 'GR1601101250000000012300695', note: '希腊' },
  { iban: 'CZ6508000000192000145399', note: '捷克' },
  { iban: 'TR330006100519786457841326', note: '土耳其' },
  { iban: 'MT84MALT011000012345MTLCAST001S', note: '马耳他' },
  { iban: 'MU17BOMM0101101030300200000MUR', note: '毛里求斯' },
  { iban: 'SM86U0322509800000000270100', note: '圣马力诺' },
  { iban: 'BR9700360305000010009795493P1', note: '巴西' },
  { iban: 'SA0380000000608010167519', note: '沙特阿拉伯' },
  { iban: 'AE070331234567890123456', note: '阿联酋' },
];

/** Shortest total IBAN length allowed by ISO 13616. */
export const IBAN_MIN_LENGTH = 15;
/** Longest total IBAN length allowed by ISO 13616 (the registry's maximum is 32). */
export const IBAN_MAX_LENGTH = 34;

export type IbanIssue =
  | 'empty'
  | 'invalidCharacters'
  | 'tooShort'
  | 'tooLong'
  | 'unknownCountry'
  | 'notIbanCountry'
  | 'wrongLength'
  | 'checkDigitsNotNumeric'
  | 'badCheckDigits';

/**
 * `valid`         everything checks out.
 * `checksum-only` the mod-97 digits are right but the country is not in the
 *                 IBAN registry, so its length rule cannot be checked.
 * `invalid`       at least one hard problem.
 */
export type IbanStatus = 'valid' | 'checksum-only' | 'invalid';

export interface NormalizedIban {
  /** Uppercase, with separators removed; may still contain foreign characters. */
  value: string;
  /** Distinct characters that are neither alphanumeric nor an accepted separator. */
  invalidCharacters: string[];
  /** True when separators were actually stripped, so the UI can say so. */
  hadSeparators: boolean;
}

export interface IbanAnalysis {
  input: string;
  normalized: string;
  formatted: string;
  status: IbanStatus;
  /** Problems in the order they should be shown. */
  issues: IbanIssue[];
  invalidCharacters: string[];
  hadSeparators: boolean;
  /** First two characters, when there are two; the empty string otherwise. */
  countryCode: string;
  /** Registry name, else the ISO 3166 name, else an empty string. */
  countryName: string;
  /** Registry entry, or null when the country is unknown or not an IBAN country. */
  country: IbanCountry | null;
  expectedLength: number | null;
  actualLength: number;
  /** Characters 3-4 as typed, possibly not digits. */
  checkDigits: string;
  /** Recomputed check digits, or the empty string when they cannot be derived. */
  expectedCheckDigits: string;
  bban: string;
  /**
   * BBAN slices with their values, and the slice's own offset. The offset is
   * carried through instead of being recovered with `indexOf`, which would
   * report the wrong position for any repeated run of digits such as '0000'.
   */
  bbanFields: Array<{ label: string; value: string; start: number; length: number }>;
  /** mod-97 remainder of the rearranged IBAN, or -1 when not computable. */
  remainder: number;
  /** True when the mod-97 remainder is exactly 1. */
  checksumOk: boolean;
}

const ALPHANUMERIC = /^[0-9A-Za-z]$/;
/**
 * Separators that are stripped before validating. Hyphens and whitespace only:
 * people copy IBANs out of PDFs and emails, where they appear as groups of four
 * separated by spaces or dashes. Everything else is reported as an illegal
 * character instead of being silently deleted, because silently deleting a
 * character is how a validator ends up approving a corrupted number.
 */
const SEPARATOR = /^[\s\u00ad\u2010\u2011-]$/;

/**
 * Uppercases and strips separators from raw input.
 *
 * Mapping is done one source character at a time rather than by uppercasing the
 * whole string first. `'ß'.toUpperCase()` is `'SS'` — two characters from one —
 * which would turn an illegal character into two legal letters and could flip a
 * failing number into a passing one. Character-at-a-time means such a character
 * is reported as illegal and never enters the normalized value.
 */
export function normalizeIban(raw: string): NormalizedIban {
  let value = '';
  const invalidCharacters: string[] = [];
  let stripped = 0;

  if (typeof raw === 'string') {
    for (const character of raw) {
      if (ALPHANUMERIC.test(character)) {
        value += character.toUpperCase();
      } else if (SEPARATOR.test(character)) {
        stripped += 1;
      } else if (!invalidCharacters.includes(character)) {
        invalidCharacters.push(character);
      }
    }
  }

  return { value, invalidCharacters, hadSeparators: stripped > 0 };
}

/** Groups a normalized IBAN in fours, which is how it is printed on paper. */
export function formatIban(value: string): string {
  const groups = value.match(/.{1,4}/g);
  return groups ? groups.join(' ') : '';
}

/**
 * mod-97 over a string of digits and letters, letters expanded to two digits
 * (A = 10 ... Z = 35).
 *
 * Returns -1 for any other character, so a caller that forgot to validate first
 * gets an impossible remainder instead of a plausible wrong one.
 *
 * Why not the obvious `Number(...)` or `BigInt(...)`:
 *
 * The numeric expansion of a 32 character IBAN is 38 digits. Converting that to
 * a `Number` keeps only the top ~16 significant digits, and the remainder is
 * decided by the *low* digits — so the naive version returns a wrong answer for
 * long IBANs while looking perfectly reasonable. `BigInt` would be correct, but
 * folding the remainder after every digit instead keeps the running value below
 * 9700 and needs no big-integer support at all. The check script implements the
 * `BigInt` version independently and asserts the two agree, and separately
 * asserts that the `Number` version disagrees — so this claim is tested rather
 * than asserted in a comment.
 */
export function mod97(value: string): number {
  let remainder = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let mapped: number;
    if (code >= 48 && code <= 57) {
      mapped = code - 48;
    } else if (code >= 65 && code <= 90) {
      mapped = code - 55;
    } else {
      return -1;
    }

    if (mapped >= 10) {
      // Two digits at once: 10..35 is always below 100, so appending is a
      // multiply-and-add. The running remainder stays under 97.
      remainder = (remainder * 100 + mapped) % 97;
    } else {
      remainder = (remainder * 10 + mapped) % 97;
    }
  }
  return remainder;
}

/**
 * The check defined by the standard: move the first four characters to the end
 * and take mod 97. A well formed IBAN leaves a remainder of 1.
 */
export function ibanCheckRemainder(iban: string): number {
  if (iban.length < 4) return -1;
  return mod97(iban.slice(4) + iban.slice(0, 4));
}

/**
 * Recomputes the two check digits from the country code and BBAN.
 *
 * This is the definition of the check digits written backwards: with the digits
 * set to 00 the rearranged string has a known remainder r, and 98 - r is the
 * value that makes the remainder come out as 1. The check script uses it to
 * confirm that replacing the check digits of every official example with 00 and
 * recomputing reproduces the original digits — a property that does not depend
 * on the validation path at all.
 */
export function computeCheckDigits(countryCode: string, bban: string): string {
  const remainder = mod97(`${bban}${countryCode}00`);
  if (remainder < 0) return '';
  return String(98 - remainder).padStart(2, '0');
}

/** Registry lookup. Case-insensitive so it can be called with raw prefixes. */
export function findIbanCountry(code: string): IbanCountry | null {
  return COUNTRY_BY_CODE.get(code.toUpperCase()) ?? null;
}

/** All registry entries, sorted by country code. */
export function listIbanCountries(): IbanCountry[] {
  return [...IBAN_REGISTRY].sort((left, right) => left.code.localeCompare(right.code));
}

/**
 * Cached region-name formatter.
 *
 * Constructing `Intl.DisplayNames` is not free, and `analyzeIban` runs on every
 * keystroke — building one per character typed would be pointless work in the
 * middle of the input loop. The instance is pure: same input, same output.
 */
let regionNames: Intl.DisplayNames | null | undefined;

/**
 * ISO 3166-1 country name for a two-letter code, via the platform's own locale
 * data.
 *
 * A hand-written table of ~250 names would be a quarter of this file and would
 * go stale; `Intl.DisplayNames` is part of the language runtime and is what the
 * browser already uses to localise region names. It returns the code itself for
 * an unknown region, which is exactly the signal needed to tell "a real country
 * that is not an IBAN country" from "not a country code at all".
 */
export function regionName(code: string): string | null {
  if (!/^[A-Z]{2}$/.test(code.toUpperCase())) return null;
  const upper = code.toUpperCase();
  if (regionNames === undefined) {
    try {
      regionNames =
        typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
          ? new Intl.DisplayNames(['zh-CN'], { type: 'region' })
          : null;
    } catch {
      // Older engines can throw for an unsupported locale; the caller then
      // falls back to showing the bare code.
      regionNames = null;
    }
  }
  if (regionNames === null) return null;

  const name = regionNames.of(upper);
  // CLDR answers "未知地区" for ZZ and echoes the input for codes it does not
  // know; neither is a usable country name.
  if (!name || name === upper || name === '未知地区') return null;
  return name;
}

/**
 * Validates and parses one IBAN in a single pass.
 *
 * Every field of the result is filled in as far as the input allows, so the UI
 * can show partial information (e.g. the country name) even for a number that
 * fails, instead of an all-or-nothing verdict.
 */
export function analyzeIban(raw: string): IbanAnalysis {
  const input = typeof raw === 'string' ? raw : '';
  const normalized = normalizeIban(input);
  const value = normalized.value;

  const countryCode = value.length >= 2 ? value.slice(0, 2) : '';
  const country = countryCode.length === 2 ? findIbanCountry(countryCode) : null;
  const region = country ? country.name : regionName(countryCode);
  const checkDigits = value.length >= 4 ? value.slice(2, 4) : '';
  const bban = value.slice(4);
  const checkDigitsNumeric = /^[0-9]{2}$/.test(checkDigits);

  const remainder =
    value.length > 0 && normalized.invalidCharacters.length === 0
      ? ibanCheckRemainder(value)
      : -1;
  const checksumOk = remainder === 1;

  const issues: IbanIssue[] = [];
  const hasInvalid = normalized.invalidCharacters.length > 0;
  if (value.length === 0 && !hasInvalid) {
    issues.push('empty');
  } else {
    // Input made only of illegal characters is not "empty": saying so would
    // hide the one thing the user has to fix.
    if (hasInvalid) issues.push('invalidCharacters');
    if (value.length < 4) issues.push('tooShort');
    if (countryCode.length === 2 && !country) {
      issues.push(region ? 'notIbanCountry' : 'unknownCountry');
    }

    // Length complaints are suppressed while illegal characters are present.
    // The length is measured on the characters that could be kept, which is not
    // the length the user typed — "22 expected, 12 found" would describe a
    // string nobody entered.
    if (!hasInvalid) {
      if (value.length > IBAN_MAX_LENGTH) issues.push('tooLong');
      // Below four characters the country rule is not the interesting problem:
      // "not even a country prefix yet" is the actionable message.
      if (country && value.length >= 4 && value.length !== country.length) {
        issues.push('wrongLength');
      }
    }
    if (value.length >= 4 && !checkDigitsNumeric) issues.push('checkDigitsNotNumeric');

    // The checksum is only reported as a separate problem once the number is
    // otherwise the right shape. Mixed in with a length error it is noise: a
    // number missing a digit fails mod-97 too, and telling the user both "one
    // digit short" and "checksum wrong" buries the one they can act on.
    const shapeIsKnown = normalized.invalidCharacters.length === 0 && country !== null;
    const lengthOk = country !== null && value.length === country.length;
    if (shapeIsKnown && lengthOk && checkDigitsNumeric && !checksumOk) {
      issues.push('badCheckDigits');
    } else if (region !== null && !country && checkDigitsNumeric && value.length >= 8 && !checksumOk) {
      // Not an IBAN country, but a real region: the checksum is still a
      // meaningful signal and there is no length rule to satisfy first.
      issues.push('badCheckDigits');
    }
  }

  const onlyRegistryGap = issues.length === 1 && issues[0] === 'notIbanCountry';
  const status: IbanStatus =
    issues.length === 0 ? 'valid' : onlyRegistryGap && checksumOk ? 'checksum-only' : 'invalid';

  // Recomputed digits are only offered when the rest of the number is the right
  // shape; otherwise "the correct check digits are X" would be an instruction
  // to make a corrupt number pass.
  const canRecompute =
    countryCode.length === 2 &&
    bban.length > 0 &&
    normalized.invalidCharacters.length === 0 &&
    (country === null || value.length === country.length);

  return {
    input,
    normalized: value,
    formatted: formatIban(value),
    status,
    issues,
    invalidCharacters: normalized.invalidCharacters,
    hadSeparators: normalized.hadSeparators,
    countryCode,
    countryName: region ?? '',
    country,
    expectedLength: country ? country.length : null,
    actualLength: value.length,
    checkDigits,
    expectedCheckDigits: canRecompute ? computeCheckDigits(countryCode, bban) : '',
    bban,
    bbanFields:
      country && country.fields && value.length === country.length
        ? country.fields.map((field) => ({
            label: field.label,
            value: bban.slice(field.start, field.start + field.length),
            start: field.start,
            length: field.length,
          }))
        : [],
    remainder,
    checksumOk,
  };
}

/** Convenience predicate for callers that only need the verdict. */
export function isValidIban(raw: string): boolean {
  return analyzeIban(raw).status === 'valid';
}
