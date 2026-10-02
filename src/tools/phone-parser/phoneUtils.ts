/**
 * Phone number analysis and formatting for a curated subset of countries.
 *
 * The design constraint that shapes everything here: this tool has no carrier
 * database and no network access. It therefore knows exactly one kind of fact —
 * the published *shape* of a numbering plan (country calling code, trunk prefix,
 * national significant number lengths, and the digit patterns that split a
 * number into groups). Everything else a "phone lookup" usually claims —
 * which city, which operator, is it really in service — is deliberately absent.
 *
 * ## Why the leading zero is not simply stripped
 *
 * A very tempting implementation of "normalise to E.164" is to delete every
 * non-digit and then delete a leading zero. Both steps are wrong in ways this
 * module is built to avoid:
 *
 * - Deleting the `+` erases the only marker that says "the next digits are a
 *   country code". `+44 20 7946 0958` and the national-format digits
 *   `44 20 7946 0958` are not the same number, and the second one is not a valid
 *   GB number at all.
 * - Deleting a leading zero is wrong for Italy, where the leading `0` is part of
 *   the national significant number: Rome is `+39 06 6982 1234`, and the NSN
 *   recorded in E.164 starts with `0`. Only countries whose plan explicitly uses
 *   a trunk prefix (the UK `0`, Russia `8`, the US/Canada `1`) have it removed,
 *   and only after the digits without it validate.
 *
 * The parser therefore keeps three separate notions apart: the international
 * dialling prefix (`+` / `00`), the national trunk prefix, and the national
 * significant number.
 *
 * ## Why validity is pattern based rather than a single length
 *
 * Lengths alone are not enough: mainland China accepts 10- and 11-digit national
 * numbers, so an 11-digit number starting with `0` would pass a pure length
 * check while being nonsense. Every country below therefore validates against
 * anchored digit patterns, and the `lengths` field is the published summary that
 * the check script cross-checks against those patterns.
 *
 * Pure logic only: no React, no DOM, no clock, no randomness.
 */

export type PhoneNumberType =
  | 'mobile'
  | 'fixed'
  | 'tollFree'
  | 'service'
  | 'unknown';

/** Types a country rule is allowed to claim. `unknown` is an absence of a claim. */
export type ConcreteNumberType = Exclude<PhoneNumberType, 'unknown'>;

export const NUMBER_TYPE_LABEL: Record<PhoneNumberType, string> = {
  mobile: '手机',
  fixed: '固话',
  tollFree: '免费号',
  service: '服务号',
  unknown: '未知',
};

/**
 * One shape rule for a country's national significant numbers.
 *
 * `pattern` is anchored on both ends and its capture groups are what the two
 * templates interpolate, so a rule carries its own formatting. The first rule
 * that matches wins, which is why the order in each country matters: the more
 * specific claim (a mobile range) is listed before the general one.
 */
export interface NumberRule {
  pattern: string;
  /** Rendering without the country code, e.g. `138 0013 8000`. */
  intl: string;
  /** Domestic rendering, including the trunk prefix where one is dialled. */
  national: string;
  /**
   * Type inferred from this rule. Omitted means "no claim" — see the NANP and
   * Denmark, where mobile and fixed numbers are genuinely indistinguishable.
   */
  type?: ConcreteNumberType;
  /** The published basis for the type claim, shown in the UI so it can be audited. */
  basis?: string;
}

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code. */
  iso: string;
  /** Simplified Chinese display name, matching the rest of the app. */
  name: string;
  region: string;
  /** ITU-T E.164 country calling code, digits only. */
  callingCode: string;
  /**
   * National (trunk) prefix removed when a domestic number is converted to
   * E.164. Empty string for countries that have none, and for Italy, whose
   * leading `0` belongs to the number.
   */
  trunkPrefix: string;
  /** Published national significant number lengths, digits only. */
  lengths: number[];
  /** Ordered: the first matching pattern decides both validity and grouping. */
  formats: NumberRule[];
  /** Known-good E.164 examples, one per declared length; used by the tests. */
  samples: string[];
}

/** Small helper so the country table below stays readable. */
function rule(
  pattern: string,
  intl: string,
  national: string,
  type?: ConcreteNumberType,
  basis?: string,
): NumberRule {
  return type === undefined ? { pattern, intl, national } : { pattern, intl, national, type, basis };
}

/**
 * The covered subset — 38 countries and regions.
 *
 * This is intentionally a subset. A country that is not in this table is
 * reported as "未收录" rather than guessed at, because guessing produces a
 * confident wrong answer and the whole point of the format output is that it can
 * be dialled.
 */
export const COUNTRIES: PhoneCountry[] = [
  {
    iso: 'CN',
    name: '中国大陆',
    region: '东亚',
    callingCode: '86',
    trunkPrefix: '0',
    lengths: [5, 10, 11],
    formats: [
      rule(
        '^(1[3-9]\\d)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'mobile',
        '11 位、以 1 开头且第二位为 3-9 的号段为手机号',
      ),
      rule(
        '^(800)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'tollFree',
        '800 为受话人付费的免费电话',
      ),
      rule(
        '^(400)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'service',
        '400 为主被叫分摊付费的企业服务号码',
      ),
      rule('^(1\\d{4})$', '$1', '$1', 'service', '100xx / 123xx 等 5 位短号码'),
      rule('^(9\\d{4})$', '$1', '$1', 'service', '95xxx 等 5 位服务短号码'),
      rule(
        '^(10|2\\d)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '10（北京）与 2x 为两位区号，本地号码 8 位',
      ),
      rule(
        '^([3-9]\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '三位区号（如 311 石家庄）加 7 位本地号码',
      ),
      rule(
        '^([3-9]\\d{2})(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '三位区号加 8 位本地号码',
      ),
    ],
    samples: ['+8613800138000', '+861012345678', '+868001234567', '+8610086'],
  },
  {
    iso: 'US',
    name: '美国',
    region: '北美',
    callingCode: '1',
    trunkPrefix: '1',
    lengths: [10],
    formats: [
      rule(
        '^(8(?:00|33|44|55|66|77|88))([2-9]\\d{2})(\\d{4})$',
        '$1 $2 $3',
        '($1) $2-$3',
        'tollFree',
        'NANP 免费号段：800/833/844/855/866/877/888',
      ),
      rule(
        '^(900)([2-9]\\d{2})(\\d{4})$',
        '$1 $2 $3',
        '($1) $2-$3',
        'service',
        'NANP 900 为付费服务号段',
      ),
      rule(
        '^([2-9]\\d{2})([2-9]\\d{2})(\\d{4})$',
        '$1 $2 $3',
        '($1) $2-$3',
        undefined,
        'NANP 规定区号与局号的第二位不得为 0 或 1；手机与固话在号码上不可区分',
      ),
    ],
    samples: ['+12025550147', '+18005550147', '+19005550147'],
  },
  {
    iso: 'CA',
    name: '加拿大',
    region: '北美',
    callingCode: '1',
    trunkPrefix: '1',
    lengths: [10],
    formats: [
      rule(
        '^(8(?:00|33|44|55|66|77|88))([2-9]\\d{2})(\\d{4})$',
        '$1 $2 $3',
        '($1) $2-$3',
        'tollFree',
        'NANP 免费号段，加美共用',
      ),
      rule(
        '^(900)([2-9]\\d{2})(\\d{4})$',
        '$1 $2 $3',
        '($1) $2-$3',
        'service',
        'NANP 900 为付费服务号段',
      ),
      rule(
        '^([2-9]\\d{2})([2-9]\\d{2})(\\d{4})$',
        '$1 $2 $3',
        '($1) $2-$3',
        undefined,
        'NANP 区号与局号规则；加拿大号码需要区号表才能与美国区分',
      ),
    ],
    samples: ['+14165550147', '+16045550147'],
  },
  {
    iso: 'GB',
    name: '英国',
    region: '欧洲',
    callingCode: '44',
    trunkPrefix: '0',
    lengths: [7, 9, 10],
    formats: [
      rule(
        '^(7[1-9]\\d{2})(\\d{6})$',
        '$1 $2',
        '0$1 $2',
        'mobile',
        '07xxx 为手机号段；Ofcom 把 07700 900xxx 保留给影视作品使用',
      ),
      rule(
        '^(800)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'tollFree',
        '0800 为免费电话（10 位）',
      ),
      rule(
        '^(800)(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'tollFree',
        '0800 的 9 位国内号码',
      ),
      rule('^(800)(\\d{4})$', '$1 $2', '0$1 $2', 'tollFree', '0800 1111 等 7 位短号'),
      rule(
        '^(8[4-9]\\d)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'service',
        '084x / 087x 为非地理特殊服务号段',
      ),
      rule('^(8[4-9]\\d)(\\d{4})$', '$1 $2', '0$1 $2', 'service', '0845 46 47 等短号'),
      rule(
        '^(3\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'service',
        '03xx 为全国统一费率的非地理号码',
      ),
      rule(
        '^(9\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'service',
        '09xx 为付费服务号段',
      ),
      rule(
        '^(20)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '020 为伦敦；Ofcom 把 020 7946 0xxx 保留给影视作品使用',
      ),
      rule(
        '^(1\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '三位区号（如 0161 曼彻斯特）加 7 位本地号码',
      ),
      rule('^(1\\d{3})(\\d{6})$', '$1 $2', '0$1 $2', 'fixed', '四位区号加 6 位本地号码'),
      rule('^(1\\d{4})(\\d{4})$', '$1 $2', '0$1 $2', 'fixed', '五位区号加 4 位本地号码'),
    ],
    samples: ['+442079460958', '+447700900123', '+448001111', '+44800123456'],
  },
  {
    iso: 'DE',
    name: '德国',
    region: '欧洲',
    callingCode: '49',
    trunkPrefix: '0',
    lengths: [9, 10, 11],
    formats: [
      rule(
        '^(1[5-7]\\d{1,2})(\\d{7,8})$',
        '$1 $2',
        '0$1 $2',
        'mobile',
        '015x / 016x / 017x 为德国手机号段',
      ),
      rule('^(800)(\\d{7})$', '$1 $2', '0$1 $2', 'tollFree', '0800 为德国免费电话'),
      rule(
        '^(30|40|69|89)(\\d{7,8})$',
        '$1 $2',
        '0$1 $2',
        'fixed',
        '两位区号：030 柏林、040 汉堡、069 法兰克福、089 慕尼黑',
      ),
      rule('^([1-9]\\d{2})(\\d{6,8})$', '$1 $2', '0$1 $2', 'fixed', '三位区号加本地号码'),
      rule('^([1-9]\\d{3})(\\d{5,7})$', '$1 $2', '0$1 $2', 'fixed', '四位区号加本地号码'),
      rule('^([1-9]\\d{4})(\\d{4,6})$', '$1 $2', '0$1 $2', 'fixed', '五位区号加本地号码'),
    ],
    samples: ['+493012345678', '+49301234567', '+4915112345678'],
  },
  {
    iso: 'FR',
    name: '法国',
    region: '欧洲',
    callingCode: '33',
    trunkPrefix: '0',
    lengths: [9],
    formats: [
      rule(
        '^([67])(\\d{2})(\\d{2})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4 $5',
        '0$1 $2 $3 $4 $5',
        'mobile',
        '06 / 07 为法国手机号段',
      ),
      rule(
        '^(80[08])(\\d{2})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'tollFree',
        '0800 / 0808 为免费电话',
      ),
      rule(
        '^([1-9])(\\d{2})(\\d{2})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4 $5',
        '0$1 $2 $3 $4 $5',
        undefined,
        '法国国内号码去掉长途冠码 0 后统一为 9 位，按 1-2-2-2-2 分组',
      ),
    ],
    samples: ['+33123456789', '+33612345678', '+33800123456'],
  },
  {
    iso: 'JP',
    name: '日本',
    region: '东亚',
    callingCode: '81',
    trunkPrefix: '0',
    lengths: [9, 10],
    formats: [
      rule(
        '^([789]0)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '070 / 080 / 090 为手机号段',
      ),
      rule('^(120)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '0120 为免费电话'),
      rule(
        '^([36])(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '一位区号：03 东京、06 大阪',
      ),
      rule(
        '^([1-9]\\d)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '两位区号加本地号码；日本的区号长度为 1-5 位，精确分组需要区号表，此处按常见形态归组',
      ),
    ],
    samples: ['+81312345678', '+819012345678', '+81120123456'],
  },
  {
    iso: 'IT',
    name: '意大利',
    region: '欧洲',
    callingCode: '39',
    trunkPrefix: '',
    lengths: [9, 10],
    formats: [
      rule(
        '^(3\\d{2})(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'mobile',
        '意大利手机号码以 3 开头',
      ),
      rule(
        '^(3\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'mobile',
        '意大利手机号码以 3 开头（10 位）',
      ),
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为免费电话'),
      rule(
        '^(800)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'tollFree',
        '800 为免费电话（10 位）',
      ),
      rule(
        '^(0[26])(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '意大利固话的区号含前导 0：02 米兰、06 罗马；E.164 中同样保留这个 0',
      ),
      rule(
        '^(0[26])(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '02 / 06 区号加 7 位本地号码',
      ),
      rule(
        '^(0\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '三位区号（0xx）加 7 位本地号码',
      ),
      rule(
        '^(0\\d{2})(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '三位区号（0xx）加 6 位本地号码',
      ),
      rule(
        '^(0\\d{3})(\\d{2})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '四位区号（0xxx）加 6 位本地号码',
      ),
      rule(
        '^(0\\d{3})(\\d{2})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '四位区号（0xxx）加 5 位本地号码',
      ),
    ],
    samples: ['+390669821234', '+393471234567', '+39061234567'],
  },
  {
    iso: 'ES',
    name: '西班牙',
    region: '欧洲',
    callingCode: '34',
    trunkPrefix: '',
    lengths: [9],
    formats: [
      rule('^([67]\\d{2})(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'mobile', '6 / 7 开头为手机'),
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为免费电话'),
      rule('^(900)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '900 为免费电话'),
      rule(
        '^(80[2367])(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'service',
        '803 / 806 / 807 为付费服务号段',
      ),
      rule(
        '^([89]\\d{2})(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '8 / 9 开头为固话；西班牙号码自 1998 年起统一为 9 位，无长途冠码',
      ),
    ],
    samples: ['+34912345678', '+34612345678', '+34900123456'],
  },
  {
    iso: 'NL',
    name: '荷兰',
    region: '欧洲',
    callingCode: '31',
    trunkPrefix: '0',
    lengths: [7, 9],
    formats: [
      rule('^(6)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '06 为手机号段'),
      rule('^(800)(\\d{4})$', '$1 $2', '0$1 $2', 'tollFree', '0800 为免费电话'),
      rule(
        '^([1-9]\\d)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '固话为 9 位；020 阿姆斯特丹等两位区号',
      ),
    ],
    samples: ['+31201234567', '+31612345678', '+318001234'],
  },
  {
    iso: 'BE',
    name: '比利时',
    region: '欧洲',
    callingCode: '32',
    trunkPrefix: '0',
    lengths: [8, 9],
    formats: [
      rule(
        '^(4\\d{2})(\\d{2})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'mobile',
        '04xx 为手机号段',
      ),
      rule('^(800)(\\d{5})$', '$1 $2', '0$1 $2', 'tollFree', '0800 为免费电话'),
      rule(
        '^([1-9])(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'fixed',
        '固话去掉长途冠码 0 后为 8 位；02 布鲁塞尔',
      ),
    ],
    samples: ['+3221234567', '+32470123456', '+3280012345'],
  },
  {
    iso: 'CH',
    name: '瑞士',
    region: '欧洲',
    callingCode: '41',
    trunkPrefix: '0',
    lengths: [9],
    formats: [
      rule(
        '^(7[5-9]\\d)(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '075-079 为手机号段',
      ),
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '0800 为免费电话'),
      rule(
        '^(8[4-9]\\d)(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'service',
        '084x / 090x 为付费服务号段',
      ),
      rule(
        '^([1-9]\\d)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '固话为 9 位；044 苏黎世、021 洛桑',
      ),
    ],
    samples: ['+41441234567', '+41761234567', '+41800123456'],
  },
  {
    iso: 'AT',
    name: '奥地利',
    region: '欧洲',
    callingCode: '43',
    trunkPrefix: '0',
    lengths: [8, 9, 10],
    formats: [
      rule(
        '^(6\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '06xx 为手机号段',
      ),
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '0800 为免费电话'),
      rule('^(1)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '01 为维也纳'),
      rule('^([1-9]\\d{2})(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '三位区号加本地号码'),
      rule('^([1-9]\\d{2})(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '三位区号加本地号码'),
    ],
    samples: ['+4312345678', '+436641234567', '+43800123456'],
  },
  {
    iso: 'SE',
    name: '瑞典',
    region: '欧洲',
    callingCode: '46',
    trunkPrefix: '0',
    lengths: [8, 9],
    formats: [
      rule(
        '^(7\\d)(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'mobile',
        '07x 为手机号段',
      ),
      rule('^(20)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '020 为免费电话'),
      rule(
        '^(8)(\\d{3})(\\d{3})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'fixed',
        '08 为斯德哥尔摩',
      ),
      rule('^([1-9]\\d)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '两位区号加本地号码'),
    ],
    samples: ['+46701234567', '+46812345678', '+4620123456'],
  },
  {
    iso: 'NO',
    name: '挪威',
    region: '欧洲',
    callingCode: '47',
    trunkPrefix: '',
    lengths: [8],
    formats: [
      rule('^([49]\\d{2})(\\d{2})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'mobile', '4 / 9 开头为手机'),
      rule('^(800)(\\d{2})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为免费电话'),
      rule(
        '^([2-9]\\d)(\\d{2})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '$1 $2 $3 $4',
        'fixed',
        '挪威号码统一为 8 位，无长途冠码',
      ),
    ],
    samples: ['+4722123456', '+4740012345', '+4780012345'],
  },
  {
    iso: 'DK',
    name: '丹麦',
    region: '欧洲',
    callingCode: '45',
    trunkPrefix: '',
    lengths: [8],
    formats: [
      rule(
        '^(\\d{2})(\\d{2})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '$1 $2 $3 $4',
        undefined,
        '丹麦号码统一为 8 位；携号转网后号段无法可靠区分手机与固话，因此不做类型判断',
      ),
    ],
    samples: ['+4532123456'],
  },
  {
    iso: 'PL',
    name: '波兰',
    region: '欧洲',
    callingCode: '48',
    trunkPrefix: '',
    lengths: [9],
    formats: [
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为免费电话'),
      rule(
        '^(80[1-9])(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'service',
        '801 / 802 / 804 等为付费服务号段',
      ),
      rule('^([5-8]\\d{2})(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'mobile', '5-8 开头为手机'),
      rule(
        '^([1-9]\\d)(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '$1 $2 $3 $4',
        'fixed',
        '波兰号码统一为 9 位，无长途冠码；22 华沙',
      ),
    ],
    samples: ['+48512345678', '+48221234567', '+48800123456'],
  },
  {
    iso: 'RU',
    name: '俄罗斯',
    region: '欧洲',
    callingCode: '7',
    trunkPrefix: '8',
    lengths: [10],
    formats: [
      rule(
        '^(800)(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '8 ($1) $2-$3-$4',
        'tollFree',
        '8-800 为免费电话',
      ),
      rule(
        '^(9\\d{2})(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '8 ($1) $2-$3-$4',
        'mobile',
        '9xx 为手机号段',
      ),
      rule(
        '^([1-9]\\d{2})(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '8 ($1) $2-$3-$4',
        'fixed',
        '固话为三位区号加 7 位本地号码；495 莫斯科、812 圣彼得堡',
      ),
    ],
    samples: ['+79123456789', '+74951234567', '+78001234567'],
  },
  {
    iso: 'KZ',
    name: '哈萨克斯坦',
    region: '亚洲中部',
    callingCode: '7',
    trunkPrefix: '8',
    lengths: [10],
    formats: [
      rule(
        '^(7(?:0\\d|47|7[15678]))(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '8 ($1) $2-$3-$4',
        'mobile',
        '+7 之后的 700/701/702/705/707/708/747/771/775/776/777/778 为手机号段',
      ),
      rule(
        '^(6\\d{2}|7\\d{2})(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '8 ($1) $2-$3-$4',
        'fixed',
        '固话区号为 6xx / 7xx；727 阿拉木图',
      ),
    ],
    samples: ['+77071234567', '+77271234567'],
  },
  {
    iso: 'BR',
    name: '巴西',
    region: '南美',
    callingCode: '55',
    trunkPrefix: '0',
    lengths: [10, 11],
    formats: [
      rule(
        '^([1-9]\\d)(9\\d{4})(\\d{4})$',
        '$1 $2-$3',
        '($1) $2-$3',
        'mobile',
        '手机为两位区号加 9 开头的 9 位用户号，共 11 位',
      ),
      rule(
        '^(800)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'tollFree',
        '0800 为免费电话',
      ),
      rule(
        '^([1-9]\\d)(\\d{4})(\\d{4})$',
        '$1 $2-$3',
        '($1) $2-$3',
        'fixed',
        '固话为两位区号加 8 位用户号；11 圣保罗、21 里约',
      ),
    ],
    samples: ['+5511912345678', '+551134567890', '+558001234567'],
  },
  {
    iso: 'MX',
    name: '墨西哥',
    region: '北美',
    callingCode: '52',
    trunkPrefix: '',
    lengths: [10],
    formats: [
      rule('^(800)(\\d{3})(\\d{4})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为免费电话'),
      rule('^(900)(\\d{3})(\\d{4})$', '$1 $2 $3', '$1 $2 $3', 'service', '900 为付费服务号段'),
      rule(
        '^([1-9]\\d)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        undefined,
        '墨西哥自 2019 年起统一为 10 位且无长途冠码；手机与固话不可由号段区分',
      ),
    ],
    samples: ['+525512345678', '+528001234567'],
  },
  {
    iso: 'IN',
    name: '印度',
    region: '南亚',
    callingCode: '91',
    trunkPrefix: '0',
    lengths: [10, 11],
    formats: [
      rule(
        '^(1800)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'tollFree',
        '1800 为免费电话（11 位）',
      ),
      rule(
        '^(79|80)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        undefined,
        '080 班加罗尔、079 艾哈迈达巴德的固话与手机号段在本工具的信息范围内重叠，故不判断类型',
      ),
      rule(
        '^([6-9]\\d{4})(\\d{5})$',
        '$1 $2',
        '0$1 $2',
        'mobile',
        '6/7/8/9 开头的 10 位号码为手机；国内拨号加长途冠码 0',
      ),
      rule('^([1-9]\\d)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '两位区号（11 德里、22 孟买）'),
      rule('^([1-9]\\d{2})(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '三位区号加本地号码'),
      rule('^([1-9]\\d{3})(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '四位区号加本地号码'),
    ],
    samples: ['+919876543210', '+911123456789', '+9118001234567'],
  },
  {
    iso: 'AU',
    name: '澳大利亚',
    region: '大洋洲',
    callingCode: '61',
    trunkPrefix: '0',
    lengths: [6, 9, 10],
    formats: [
      rule('^(4\\d{2})(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '04xx 为手机号段'),
      rule(
        '^(1800)(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'tollFree',
        '1800 为免费电话，拨号时不加长途冠码',
      ),
      rule('^(1300)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'service', '1300 为本地费率服务号'),
      rule('^(13\\d{4})$', '$1', '$1', 'service', '13 xx xx 为 6 位短服务号'),
      rule(
        '^([2378])(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '02/03/07/08 为区号；去掉长途冠码 0 后固话为 9 位',
      ),
    ],
    samples: ['+61412345678', '+61212345678', '+611800123456', '+61131234'],
  },
  {
    iso: 'NZ',
    name: '新西兰',
    region: '大洋洲',
    callingCode: '64',
    trunkPrefix: '0',
    lengths: [8, 9],
    formats: [
      rule('^(2\\d)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '02x 为手机号段'),
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '0800 为免费电话'),
      rule(
        '^([1-9])(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '固话为 8 位；09 奥克兰、04 惠灵顿、03 基督城',
      ),
    ],
    samples: ['+64211234567', '+6491234567', '+64800123456'],
  },
  {
    iso: 'KR',
    name: '韩国',
    region: '东亚',
    callingCode: '82',
    trunkPrefix: '0',
    lengths: [9, 10],
    formats: [
      rule(
        '^(10)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '010 为韩国手机号段（去掉冠码 0 后为 10 位）',
      ),
      rule('^(80)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '080 为免费电话'),
      rule('^(2)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '02 为首尔'),
      rule(
        '^([1-9]\\d)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '地方区号 0xx（031 京畿、051 釜山等）',
      ),
    ],
    samples: ['+821012345678', '+82212345678', '+82801234567'],
  },
  {
    iso: 'SG',
    name: '新加坡',
    region: '东南亚',
    callingCode: '65',
    trunkPrefix: '',
    lengths: [8, 11],
    formats: [
      rule('^(1800)(\\d{3})(\\d{4})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '1800 为免费电话'),
      rule('^([89]\\d{3})(\\d{4})$', '$1 $2', '$1 $2', 'mobile', '8 / 9 开头为手机'),
      rule(
        '^([36]\\d{3})(\\d{4})$',
        '$1 $2',
        '$1 $2',
        'fixed',
        '新加坡固话为 8 位，6 开头；无长途冠码',
      ),
    ],
    samples: ['+6591234567', '+6561234567', '+6518001234567'],
  },
  {
    iso: 'HK',
    name: '中国香港',
    region: '东亚',
    callingCode: '852',
    trunkPrefix: '',
    lengths: [8, 9],
    formats: [
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为国际免费电话服务号段'),
      rule('^([4-9]\\d{3})(\\d{4})$', '$1 $2', '$1 $2', 'mobile', '4-9 开头为手机'),
      rule('^([23]\\d{3})(\\d{4})$', '$1 $2', '$1 $2', 'fixed', '2 / 3 开头为固话；香港无长途冠码'),
    ],
    samples: ['+85251234567', '+85221234567', '+852800123456'],
  },
  {
    iso: 'TW',
    name: '中国台湾',
    region: '东亚',
    callingCode: '886',
    trunkPrefix: '0',
    lengths: [9],
    formats: [
      rule('^(9\\d{2})(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '09xx 为手机号段'),
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '0800 为免费电话'),
      rule('^(2)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '02 为台北'),
      rule('^([3-8])(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '其他区域码（04 台中、07 高雄等）'),
    ],
    samples: ['+886912345678', '+886212345678', '+886800123456'],
  },
  {
    iso: 'IE',
    name: '爱尔兰',
    region: '欧洲',
    callingCode: '353',
    trunkPrefix: '0',
    lengths: [8, 9, 10],
    formats: [
      rule(
        '^(8[356789])(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '08x 为手机号段',
      ),
      rule(
        '^(1800)(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'tollFree',
        '1800 为免费电话，拨号时不加长途冠码',
      ),
      rule('^(1)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '01 为都柏林'),
      rule('^([1-9]\\d)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '两位区号加本地号码'),
    ],
    samples: ['+353871234567', '+35312345678', '+3531800123456'],
  },
  {
    iso: 'PT',
    name: '葡萄牙',
    region: '欧洲',
    callingCode: '351',
    trunkPrefix: '',
    lengths: [9],
    formats: [
      rule('^(9[1236]\\d)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'mobile', '91/92/93/96 为手机号段'),
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为免费电话'),
      rule(
        '^(2\\d{2})(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '葡萄牙号码统一为 9 位、无长途冠码；21 里斯本、22 波尔图',
      ),
    ],
    samples: ['+351912345678', '+351212345678', '+351800123456'],
  },
  {
    iso: 'GR',
    name: '希腊',
    region: '欧洲',
    callingCode: '30',
    trunkPrefix: '',
    lengths: [10],
    formats: [
      rule('^(69\\d)(\\d{3})(\\d{4})$', '$1 $2 $3', '$1 $2 $3', 'mobile', '69 开头为手机'),
      rule('^(800)(\\d{3})(\\d{4})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '800 为免费电话'),
      rule(
        '^(2\\d{2})(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '$1 $2 $3',
        'fixed',
        '希腊号码统一为 10 位、无长途冠码；21 雅典',
      ),
    ],
    samples: ['+306912345678', '+302101234567', '+308001234567'],
  },
  {
    iso: 'TR',
    name: '土耳其',
    region: '西亚',
    callingCode: '90',
    trunkPrefix: '0',
    lengths: [10],
    formats: [
      rule(
        '^(5\\d{2})(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'mobile',
        '5xx 为手机号段',
      ),
      rule(
        '^(800)(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'tollFree',
        '800 为免费电话',
      ),
      rule(
        '^([234]\\d{2})(\\d{3})(\\d{2})(\\d{2})$',
        '$1 $2 $3 $4',
        '0$1 $2 $3 $4',
        'fixed',
        '固话区号 2xx/3xx/4xx；212 伊斯坦布尔、312 安卡拉',
      ),
    ],
    samples: ['+905321234567', '+902121234567', '+908001234567'],
  },
  {
    iso: 'ZA',
    name: '南非',
    region: '非洲',
    callingCode: '27',
    trunkPrefix: '0',
    lengths: [9],
    formats: [
      rule('^(800)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'tollFree', '0800 为免费电话'),
      rule('^(86\\d)(\\d{3})(\\d{3})$', '$1 $2 $3', '0$1 $2 $3', 'service', '086x 为共享呼叫等服务号段'),
      rule(
        '^([67]\\d|8[1-4])(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '06x / 07x / 081-084 为手机号段',
      ),
      rule(
        '^([1-9]\\d)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '两位区号；011 约翰内斯堡、021 开普敦',
      ),
    ],
    samples: ['+27821234567', '+27111234567', '+27800123456'],
  },
  {
    iso: 'AE',
    name: '阿联酋',
    region: '西亚',
    callingCode: '971',
    trunkPrefix: '0',
    lengths: [8, 9],
    formats: [
      rule(
        '^(5[024568])(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '050/052/054/055/056/058 为手机号段',
      ),
      rule(
        '^([2-9])(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '固话为一位区号加 7 位本地号码；02 阿布扎比、04 迪拜',
      ),
    ],
    samples: ['+971501234567', '+97141234567'],
  },
  {
    iso: 'IL',
    name: '以色列',
    region: '西亚',
    callingCode: '972',
    trunkPrefix: '0',
    lengths: [8, 9, 10],
    formats: [
      rule('^(1800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '1800 为免费电话'),
      rule('^(5\\d)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '05x 为手机号段'),
      rule(
        '^([2-489])(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '固话为 8 位；02 耶路撒冷、03 特拉维夫、04 海法',
      ),
    ],
    samples: ['+972501234567', '+97221234567', '+9721800123456'],
  },
  {
    iso: 'TH',
    name: '泰国',
    region: '东南亚',
    callingCode: '66',
    trunkPrefix: '0',
    lengths: [8, 9, 10],
    formats: [
      rule('^(1800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '1800 为免费电话'),
      rule('^([689]\\d)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '06/08/09 开头为手机'),
      rule('^(2)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '02 为曼谷'),
      rule(
        '^([1-9]\\d)(\\d{3})(\\d{3})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '地方两位区号加 6 位本地号码',
      ),
    ],
    samples: ['+66812345678', '+6621234567', '+661800123456'],
  },
  {
    iso: 'VN',
    name: '越南',
    region: '东南亚',
    callingCode: '84',
    trunkPrefix: '0',
    lengths: [9, 10],
    formats: [
      rule('^(1800)(\\d{3})(\\d{3})$', '$1 $2 $3', '$1 $2 $3', 'tollFree', '1800 为免费电话'),
      rule('^(24)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '024 为河内'),
      rule('^(28)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '028 为胡志明市'),
      rule(
        '^([35789]\\d)(\\d{3})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '03/05/07/08/09 开头为手机',
      ),
      rule('^([1-9]\\d)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '两位区号加本地号码'),
    ],
    samples: ['+84912345678', '+842412345678', '+841800123456'],
  },
  {
    iso: 'MY',
    name: '马来西亚',
    region: '东南亚',
    callingCode: '60',
    trunkPrefix: '0',
    lengths: [9, 10],
    formats: [
      rule('^(11)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '011 为手机号段'),
      rule('^(1\\d)(\\d{3})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'mobile', '01x 为手机号段'),
      rule(
        '^([3-9])(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '固话区号一位；03 吉隆坡、04 槟城',
      ),
    ],
    samples: ['+60123456789', '+60312345678', '+601112345678'],
  },
  {
    iso: 'ID',
    name: '印度尼西亚',
    region: '东南亚',
    callingCode: '62',
    trunkPrefix: '0',
    lengths: [10, 11],
    formats: [
      rule(
        '^(8\\d{2})(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'mobile',
        '8xx 为手机号段',
      ),
      rule('^(21)(\\d{4})(\\d{4})$', '$1 $2 $3', '0$1 $2 $3', 'fixed', '021 为雅加达'),
      rule(
        '^([1-9]\\d)(\\d{4})(\\d{4})$',
        '$1 $2 $3',
        '0$1 $2 $3',
        'fixed',
        '两位区号加 8 位本地号码',
      ),
    ],
    samples: ['+6281234567890', '+622112345678', '+622212345678'],
  },
];

export const DEFAULT_COUNTRY_ISO = 'CN';

/** ITU-T E.164 caps a full international number at 15 digits. */
export const MAX_E164_DIGITS = 15;

/**
 * The formal E.164 representation: a plus sign, a non-zero leading digit, then
 * up to 14 more digits. Used as a post-condition on every E.164 this module
 * produces, so a formatting bug cannot silently emit an undiallable string.
 */
export const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

const BY_ISO = new Map(COUNTRIES.map((country) => [country.iso, country]));

/** Countries sharing one calling code, e.g. `1` for US and CA. */
const BY_CALLING_CODE = new Map<string, PhoneCountry[]>();
for (const country of COUNTRIES) {
  const list = BY_CALLING_CODE.get(country.callingCode) ?? [];
  list.push(country);
  BY_CALLING_CODE.set(country.callingCode, list);
}

/**
 * Distinct calling codes, longest first.
 *
 * Longest-first is what makes `+886` resolve to Taiwan rather than to a
 * hypothetical `+88`, and `+852` to Hong Kong rather than `+85`. E.164 country
 * codes are assigned so that no code is a prefix of another, but matching the
 * longest known code is the rule that stays correct when the table grows.
 */
const CALLING_CODES: string[] = [...BY_CALLING_CODE.keys()].sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

export function findCountryByIso(iso: string | undefined): PhoneCountry | undefined {
  return iso ? BY_ISO.get(iso.toUpperCase()) : undefined;
}

/** Every country that shares a calling code with the given one. */
export function countriesForCallingCode(callingCode: string): PhoneCountry[] {
  return BY_CALLING_CODE.get(callingCode) ?? [];
}

export function findCallingCodeMatch(
  digits: string,
): { callingCode: string; rest: string; owners: PhoneCountry[] } | null {
  for (const code of CALLING_CODES) {
    if (digits.startsWith(code)) {
      return {
        callingCode: code,
        rest: digits.slice(code.length),
        owners: BY_CALLING_CODE.get(code) ?? [],
      };
    }
  }
  return null;
}

const REGEX_CACHE = new Map<string, RegExp>();

/** Patterns are re-used across keys and renders, so compiling once is enough. */
function anchored(pattern: string): RegExp {
  const cached = REGEX_CACHE.get(pattern);
  if (cached) return cached;
  const compiled = new RegExp(pattern);
  REGEX_CACHE.set(pattern, compiled);
  return compiled;
}

export interface RuleMatch {
  rule: NumberRule;
  match: RegExpExecArray;
}

/** First rule whose anchored pattern accepts `nsn`, or `null` when invalid. */
export function findRule(country: PhoneCountry, nsn: string): RuleMatch | null {
  for (const rule of country.formats) {
    const match = anchored(rule.pattern).exec(nsn);
    if (match) return { rule, match };
  }
  return null;
}

function applyTemplate(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\d)/g, (whole, index: string) => match[Number(index)] ?? whole);
}

export interface PhoneOutputs {
  e164: string;
  international: string;
  national: string;
  telUri: string;
  /** Country code plus national number, no separators, no plus sign. */
  digits: string;
}

export interface PhoneParse {
  ok: true;
  input: string;
  country: PhoneCountry;
  /** Every country sharing the resolved calling code, in table order. */
  candidates: PhoneCountry[];
  /**
   * True when the calling code alone cannot decide the country. `+1` (US/CA)
   * always is; `+7` is unless the national prefix points at Kazakhstan.
   */
  ambiguous: boolean;
  /**
   * Plain-language warning for a shared calling code, or `null`.
   *
   * A shared code is the one place where this tool cannot honour "say 未收录
   * rather than guess" by rejecting: `+1` really is the US and Canada, and also
   * a dozen Caribbean territories this table does not cover. Saying so is more
   * honest than either pretending the country is known or refusing a valid
   * number.
   */
  sharedNote: string | null;
  callingCode: string;
  nationalNumber: string;
  /** Trunk prefix that was removed; `null` when the input was already national. */
  trunkPrefixStripped: string | null;
  internationalPrefix: '+' | '00' | null;
  formatKind: 'international' | 'national';
  extension: string | null;
  type: PhoneNumberType;
  typeBasis: string | null;
  /** The pattern that accepted the number, so the grouping can be audited. */
  matchedPattern: string;
  outputs: PhoneOutputs;
}

export interface ParseFailure {
  ok: false;
  input: string;
  error: string;
}

export type ParseResult = PhoneParse | ParseFailure;

export interface ParseOptions {
  /** Country assumed for a national-format number. Defaults to CN. */
  defaultCountry?: string;
}

function fail(input: string, error: string): ParseFailure {
  return { ok: false, input, error };
}

/**
 * Splits a trailing extension off the input.
 *
 * The markers are the ones people actually type: `ext`, `extension`, `x`, the
 * Chinese `转` and `分机`, and the RFC 3966 `;ext=`. Writing this as one regex
 * rather than a chain of `endsWith` checks keeps the "which part is the
 * extension" decision in one auditable place.
 */
export function splitExtension(raw: string): { body: string; extension: string | null } {
  const trimmed = raw.trim();
  const match =
    /^(.*?)[\s,;]*?(?:;ext=|ext(?:ension|n)?\.?|x|转|分机)\s*[:：.]?\s*(\d{1,10})$/i.exec(
      trimmed,
    );
  if (!match) return { body: trimmed, extension: null };
  return { body: match[1].trim(), extension: match[2] };
}

/** `tel:` is accepted so a tel URI can be pasted straight back in. */
function stripTelScheme(value: string): string {
  return value.replace(/^tel:/i, '');
}

const ALLOWED_INPUT = /^[0-9+\-()./\s]+$/;

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

/** Picks one owner of a shared calling code, recording why. */
function resolveOwner(
  owners: PhoneCountry[],
  rest: string,
  preferredIso: string | undefined,
): PhoneCountry {
  const preferred = owners.find((owner) => owner.iso === preferredIso?.toUpperCase());
  if (preferred) return preferred;

  // +7 is shared by Russia and Kazakhstan. Kazakh national numbers begin with
  // 6xx or 7xx; Russian ones never do, so this one distinction is safe.
  if (owners.length > 1 && owners.every((owner) => owner.callingCode === '7')) {
    const kazakhstan = owners.find((owner) => owner.iso === 'KZ');
    if (kazakhstan && /^[67]/.test(rest)) return kazakhstan;
  }

  return owners[0];
}

/**
 * Explains a shared calling code in the terms a user needs: which countries are
 * covered, which one was chosen, and that anything else sharing the code is out
 * of scope rather than silently mislabelled.
 */
function sharedCallingCodeNote(owners: PhoneCountry[], chosen: PhoneCountry): string {
  const covered = owners.map((owner) => owner.name).join(' / ');
  return (
    `国家码 +${chosen.callingCode} 由多个国家/地区共用，本工具只收录其中 ${owners.length} 个：${covered}。` +
    `已按 ${chosen.name} 解析；共用该国家码的其他地区不在收录范围内，不会被识别。`
  );
}

/**
 * Parses one number.
 *
 * Returns a discriminated result rather than throwing: a batch of pasted
 * numbers is expected to contain mistakes, and every line needs its own message.
 */
export function parsePhone(input: string, options: ParseOptions = {}): ParseResult {
  const raw = typeof input === 'string' ? input : '';
  if (!raw.trim()) return fail(raw, '输入为空');

  const { body: withoutExtension, extension } = splitExtension(stripTelScheme(raw));
  const body = withoutExtension.trim();
  if (!body) return fail(raw, '只有分机号，没有号码本体');

  if (!ALLOWED_INPUT.test(body)) {
    return fail(raw, '含非法字符：只允许数字、+ - ( ) . / 和空格');
  }

  const plusCount = (body.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !body.startsWith('+'))) {
    return fail(raw, '“+”只能出现一次，且只能位于号码开头');
  }

  const compact = digitsOnly(body);
  if (!compact) return fail(raw, '没有可解析的数字');

  let internationalPrefix: '+' | '00' | null = null;
  let digits = compact;
  if (body.startsWith('+')) {
    internationalPrefix = '+';
  } else if (/^00\d/.test(compact)) {
    // `00` is the international access code in most of the world. It is treated
    // as such even in countries whose own numbers can start with 00, because a
    // national number that begins with 00 is not dialable as an international
    // number and the ambiguity cannot be resolved without a plan lookup.
    internationalPrefix = '00';
    digits = compact.slice(2);
  }

  // Guard before any country logic runs: 16 digits can never become valid, and
  // saying so plainly is more useful than "no rule matched".
  if (digits.length > MAX_E164_DIGITS + 1) {
    return fail(
      raw,
      `号码共 ${digits.length} 位，超过 ITU-T E.164 规定的 15 位上限（含国家码）`,
    );
  }

  const preferredIso = options.defaultCountry ?? DEFAULT_COUNTRY_ISO;
  let country: PhoneCountry;
  let nsn: string;
  let candidates: PhoneCountry[] = [];
  let ambiguous = false;
  let trunkPrefixStripped: string | null = null;

  if (internationalPrefix !== null) {
    const codeMatch = findCallingCodeMatch(digits);
    if (!codeMatch || codeMatch.owners.length === 0) {
      const hint = digits.slice(0, 3);
      return fail(
        raw,
        `未收录国家码 +${hint}：本工具只覆盖下表列出的 ${COUNTRIES.length} 个国家和地区，` +
          '不会为未收录的国家码猜测解析结果。',
      );
    }
    if (codeMatch.rest.length === 0) {
      return fail(raw, `只有国家码 +${codeMatch.callingCode}，没有国内号码`);
    }

    country = resolveOwner(codeMatch.owners, codeMatch.rest, preferredIso);
    candidates = codeMatch.owners;
    // A shared calling code is inherently ambiguous from the number alone, even
    // when a default country was supplied: `+1 202 555 0147` could in principle
    // be Canadian, and only an area-code table could say otherwise.
    ambiguous = codeMatch.owners.length > 1;
    nsn = codeMatch.rest;
  } else {
    const fallback = findCountryByIso(preferredIso);
    if (!fallback) {
      return fail(raw, `默认国家/地区代码 "${preferredIso}" 不在已收录范围内`);
    }
    country = fallback;
    candidates = [fallback];
    digits = compact;

    // A national number may or may not still carry the trunk prefix. Trying the
    // digits unchanged first means a number that is already a valid national
    // significant number is never mangled by a speculative strip.
    if (findRule(country, digits)) {
      nsn = digits;
    } else if (
      country.trunkPrefix &&
      digits.startsWith(country.trunkPrefix) &&
      findRule(country, digits.slice(country.trunkPrefix.length))
    ) {
      nsn = digits.slice(country.trunkPrefix.length);
      trunkPrefixStripped = country.trunkPrefix;
    } else {
      nsn = digits;
    }
  }

  const found = findRule(country, nsn);
  if (!found) {
    const prefixNote =
      !internationalPrefix && country.trunkPrefix
        ? `（已尝试保留或去掉长途冠码 ${country.trunkPrefix}）`
        : '';
    return fail(
      raw,
      `不符合${country.name}（+${country.callingCode}）的编号规则${prefixNote}：` +
        `国内有效号码长度为 ${country.lengths.join(' / ')} 位，且号段需匹配已收录的号段模式。`,
    );
  }

  const e164 = `+${country.callingCode}${nsn}`;
  if (!E164_PATTERN.test(e164)) {
    return fail(raw, `生成的 E.164 形式 "${e164}" 不合法（超过 15 位或格式错误）`);
  }

  const intlBody = applyTemplate(found.rule.intl, found.match);
  const nationalBody = applyTemplate(found.rule.national, found.match);
  const suffix = extension ? ` ext. ${extension}` : '';

  return {
    ok: true,
    input: raw,
    country,
    candidates,
    ambiguous,
    sharedNote: ambiguous ? sharedCallingCodeNote(candidates, country) : null,
    callingCode: country.callingCode,
    nationalNumber: nsn,
    trunkPrefixStripped,
    internationalPrefix,
    formatKind: internationalPrefix ? 'international' : 'national',
    extension,
    type: found.rule.type ?? 'unknown',
    typeBasis: found.rule.basis ?? null,
    matchedPattern: found.rule.pattern,
    outputs: {
      e164,
      international: `+${country.callingCode} ${intlBody}${suffix}`,
      national: `${nationalBody}${suffix}`,
      telUri: `tel:+${country.callingCode}-${intlBody.split(' ').join('-')}${
        extension ? `;ext=${extension}` : ''
      }`,
      digits: `${country.callingCode}${nsn}`,
    },
  };
}

/** Convenience wrapper for callers that only need the E.164 string. */
export function toE164(input: string, options: ParseOptions = {}): string | null {
  const result = parsePhone(input, options);
  return result.ok ? result.outputs.e164 : null;
}

export interface BatchRow {
  /** 1-based line number in the pasted text, so a bad line is easy to find. */
  line: number;
  input: string;
  result: ParseResult;
}

export interface BatchSummary {
  total: number;
  ok: number;
  failed: number;
}

/** Parses one number per line; blank lines are skipped but line numbers are kept. */
export function parseBatch(text: string, options: ParseOptions = {}): BatchRow[] {
  const rows: BatchRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const input = lines[index];
    if (!input.trim()) continue;
    rows.push({ line: index + 1, input: input.trim(), result: parsePhone(input, options) });
  }
  return rows;
}

export function summariseBatch(rows: BatchRow[]): BatchSummary {
  const ok = rows.filter((row) => row.result.ok).length;
  return { total: rows.length, ok, failed: rows.length - ok };
}

const TSV_HEADER = ['行号', '输入', '状态', '国家/地区', 'E.164', '国际格式', '国内格式', '类型', '说明'];

/** The batch result as TSV, ready to paste into a spreadsheet. */
export function batchToTsv(rows: BatchRow[]): string {
  const lines = [TSV_HEADER.join('\t')];
  for (const row of rows) {
    if (row.result.ok) {
      const { result } = row;
      lines.push(
        [
          row.line,
          row.input,
          '成功',
          `${result.country.name} (${result.country.iso})`,
          result.outputs.e164,
          result.outputs.international,
          result.outputs.national,
          NUMBER_TYPE_LABEL[result.type],
          result.typeBasis ?? '',
        ].join('\t'),
      );
    } else {
      lines.push([row.line, row.input, '失败', '', '', '', '', '', row.result.error].join('\t'));
    }
  }
  return lines.join('\n');
}

/** Countries grouped by region, for the "what is covered" list in the UI. */
export function countriesByRegion(): { region: string; countries: PhoneCountry[] }[] {
  // Keyed by region name rather than by first-appearance index, so a country
  // added out of order still joins its own group.
  const byRegion = new Map<string, PhoneCountry[]>();
  for (const country of COUNTRIES) {
    const list = byRegion.get(country.region);
    if (list) list.push(country);
    else byRegion.set(country.region, [country]);
  }
  return [...byRegion.entries()].map(([region, countries]) => ({ region, countries }));
}

/** Sample numbers shown as one-click examples, taken from the country table. */
export const SAMPLE_NUMBERS: string[] = [
  '+86 138 0013 8000',
  '+1 202 555 0147',
  '+44 20 7946 0958',
  '+49 30 12345678',
  '+33 1 23 45 67 89',
  '+81 3 1234 5678',
  '+39 06 6982 1234',
  '020 7946 0958',
  '0044 7700 900123',
];
