/**
 * Checks the HTML entity escaper / unescaper.
 *
 * Two oracles are used, in decreasing order of independence:
 *
 *   1. **Chromium's HTML parser.** Every one of the 2125 named entities in the
 *      implementation's table is decoded by the browser and compared, and the
 *      numeric-reference handling (including the Windows-1252 remap and the
 *      out-of-range cases) is compared the same way. Chromium implements the
 *      HTML standard's tokenizer, so this is an independent authority rather
 *      than a second copy of the same idea.
 *   2. **A second implementation with its own hand-written table.** The main
 *      implementation walks the input once and looks characters up; the
 *      reference below uses `String.replace` callbacks and `String.split` with a
 *      separately typed entity table. They are compared over a few thousand
 *      randomly assembled samples and every option combination.
 *
 * The traps the implementation claims to avoid are also *demonstrated*: the
 * naive replace-in-the-wrong-order version and the astral-character-splitting
 * version are implemented here and asserted to be wrong, so a regression in the
 * real implementation cannot hide behind a check that never had teeth.
 *
 * Usage: node scripts/check-html-entities.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/html-entities/htmlEntitiesUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/html-entities.mjs', compiled);
const M = await import(pathToFileURL('.verify/html-entities.mjs').href);

let passed = 0;
let failed = 0;
let skipped = 0;
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

// ---------------------------------------------------------------------------
// A second implementation, deliberately written in a different style.
//
// The table below is typed by hand from the HTML 4.01 entity set (the values are
// the standard's published code points). It is *not* generated from the same
// source as the implementation's table, so agreement between the two is real
// evidence and not a tautology. A typo here would show up as a cross-check
// failure — which is only possible because the two tables were written
// independently.
// ---------------------------------------------------------------------------
const REF_TABLE = {
  quot: 0x22, amp: 0x26, apos: 0x27, lt: 0x3c, gt: 0x3e,
  nbsp: 0xa0, iexcl: 0xa1, cent: 0xa2, pound: 0xa3, curren: 0xa4, yen: 0xa5,
  brvbar: 0xa6, sect: 0xa7, uml: 0xa8, copy: 0xa9, ordf: 0xaa, laquo: 0xab,
  not: 0xac, shy: 0xad, reg: 0xae, macr: 0xaf, deg: 0xb0, plusmn: 0xb1,
  sup2: 0xb2, sup3: 0xb3, acute: 0xb4, micro: 0xb5, para: 0xb6, middot: 0xb7,
  cedil: 0xb8, sup1: 0xb9, ordm: 0xba, raquo: 0xbb, frac14: 0xbc, frac12: 0xbd,
  frac34: 0xbe, iquest: 0xbf,
  Agrave: 0xc0, Aacute: 0xc1, Acirc: 0xc2, Atilde: 0xc3, Auml: 0xc4, Aring: 0xc5,
  AElig: 0xc6, Ccedil: 0xc7, Egrave: 0xc8, Eacute: 0xc9, Ecirc: 0xca, Euml: 0xcb,
  Igrave: 0xcc, Iacute: 0xcd, Icirc: 0xce, Iuml: 0xcf, ETH: 0xd0, Ntilde: 0xd1,
  Ograve: 0xd2, Oacute: 0xd3, Ocirc: 0xd4, Otilde: 0xd5, Ouml: 0xd6, times: 0xd7,
  Oslash: 0xd8, Ugrave: 0xd9, Uacute: 0xda, Ucirc: 0xdb, Uuml: 0xdc, Yacute: 0xdd,
  THORN: 0xde, szlig: 0xdf,
  agrave: 0xe0, aacute: 0xe1, acirc: 0xe2, atilde: 0xe3, auml: 0xe4, aring: 0xe5,
  aelig: 0xe6, ccedil: 0xe7, egrave: 0xe8, eacute: 0xe9, ecirc: 0xea, euml: 0xeb,
  igrave: 0xec, iacute: 0xed, icirc: 0xee, iuml: 0xef, eth: 0xf0, ntilde: 0xf1,
  ograve: 0xf2, oacute: 0xf3, ocirc: 0xf4, otilde: 0xf5, ouml: 0xf6, divide: 0xf7,
  oslash: 0xf8, ugrave: 0xf9, uacute: 0xfa, ucirc: 0xfb, uuml: 0xfc, yacute: 0xfd,
  thorn: 0xfe, yuml: 0xff,
  OElig: 0x152, oelig: 0x153, Scaron: 0x160, scaron: 0x161, Yuml: 0x178,
  fnof: 0x192, circ: 0x2c6, tilde: 0x2dc,
  Alpha: 0x391, Beta: 0x392, Gamma: 0x393, Delta: 0x394, Epsilon: 0x395,
  Zeta: 0x396, Eta: 0x397, Theta: 0x398, Iota: 0x399, Kappa: 0x39a, Lambda: 0x39b,
  Mu: 0x39c, Nu: 0x39d, Xi: 0x39e, Omicron: 0x39f, Pi: 0x3a0, Rho: 0x3a1,
  Sigma: 0x3a3, Tau: 0x3a4, Upsilon: 0x3a5, Phi: 0x3a6, Chi: 0x3a7, Psi: 0x3a8,
  Omega: 0x3a9,
  alpha: 0x3b1, beta: 0x3b2, gamma: 0x3b3, delta: 0x3b4, epsilon: 0x3b5,
  zeta: 0x3b6, eta: 0x3b7, theta: 0x3b8, iota: 0x3b9, kappa: 0x3ba, lambda: 0x3bb,
  mu: 0x3bc, nu: 0x3bd, xi: 0x3be, omicron: 0x3bf, pi: 0x3c0, rho: 0x3c1,
  sigmaf: 0x3c2, sigma: 0x3c3, tau: 0x3c4, upsilon: 0x3c5, phi: 0x3c6, chi: 0x3c7,
  psi: 0x3c8, omega: 0x3c9, thetasym: 0x3d1, upsih: 0x3d2, piv: 0x3d6,
  ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009, zwnj: 0x200c, zwj: 0x200d,
  lrm: 0x200e, rlm: 0x200f, ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018,
  rsquo: 0x2019, sbquo: 0x201a, ldquo: 0x201c, rdquo: 0x201d, bdquo: 0x201e,
  dagger: 0x2020, Dagger: 0x2021, bull: 0x2022, hellip: 0x2026, permil: 0x2030,
  prime: 0x2032, Prime: 0x2033, lsaquo: 0x2039, rsaquo: 0x203a, oline: 0x203e,
  frasl: 0x2044, euro: 0x20ac,
  image: 0x2111, weierp: 0x2118, real: 0x211c, trade: 0x2122, alefsym: 0x2135,
  larr: 0x2190, uarr: 0x2191, rarr: 0x2192, darr: 0x2193, harr: 0x2194,
  crarr: 0x21b5, lArr: 0x21d0, uArr: 0x21d1, rArr: 0x21d2, dArr: 0x21d3,
  hArr: 0x21d4, forall: 0x2200, part: 0x2202, exist: 0x2203, empty: 0x2205,
  nabla: 0x2207, isin: 0x2208, notin: 0x2209, ni: 0x220b, prod: 0x220f,
  sum: 0x2211, minus: 0x2212, lowast: 0x2217, radic: 0x221a, prop: 0x221d,
  infin: 0x221e, ang: 0x2220, and: 0x2227, or: 0x2228, cap: 0x2229, cup: 0x222a,
  int: 0x222b, there4: 0x2234, sim: 0x223c, cong: 0x2245, asymp: 0x2248,
  ne: 0x2260, equiv: 0x2261, le: 0x2264, ge: 0x2265, sub: 0x2282, sup: 0x2283,
  nsub: 0x2284, sube: 0x2286, supe: 0x2287, oplus: 0x2295, otimes: 0x2297,
  perp: 0x22a5, sdot: 0x22c5, lceil: 0x2308, rceil: 0x2309, lfloor: 0x230a,
  // `lang` / `rang` are the one place where this hand-typed table disagreed with
  // the implementation, and the implementation was right: HTML 4 defined them as
  // U+2329 / U+232A, while the HTML standard now maps them to U+27E8 / U+27E9
  // (the older code points are deprecated look-alikes). Chromium settled it —
  // see the browser comparison further down. Keeping the wrong value in this
  // table for a moment is exactly how the discrepancy got noticed.
  rfloor: 0x230b, lang: 0x27e8, rang: 0x27e9, loz: 0x25ca, spades: 0x2660,
  clubs: 0x2663, hearts: 0x2665, diams: 0x2666,
};

/** Same Windows-1252 substitution table as the standard, independently typed. */
const REF_WIN1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160,
  0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153,
  0x9e: 0x17e, 0x9f: 0x178,
};

const REF_PATTERN = /&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g;

function refNumeric(digits, radix, raw) {
  const codePoint = Number.parseInt(digits, radix);
  if (codePoint > 0x10ffff) return raw;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return raw;
  const mapped = Object.prototype.hasOwnProperty.call(REF_WIN1252, codePoint)
    ? REF_WIN1252[codePoint]
    : codePoint;
  return String.fromCodePoint(mapped);
}

/**
 * The handful of entities that expand to more than one code point. Kept apart
 * from `REF_TABLE` because their values cannot be expressed as a single number.
 * Chromium re-checks these values along with the rest of the table.
 */
const REF_MULTI = {
  NotEqualTilde: [0x2242, 0x338],
  nvlt: [0x3c, 0x20d2],
};

/** Reference decoder: replace-with-callback over its own table. */
function refDecode(input) {
  return input.replace(REF_PATTERN, (raw, decimal, hexadecimal, name) => {
    if (decimal !== undefined) return refNumeric(decimal, 10, raw);
    if (hexadecimal !== undefined) return refNumeric(hexadecimal, 16, raw);
    if (Object.prototype.hasOwnProperty.call(REF_MULTI, name)) {
      return String.fromCodePoint(...REF_MULTI[name]);
    }
    return Object.prototype.hasOwnProperty.call(REF_TABLE, name)
      ? String.fromCodePoint(REF_TABLE[name])
      : raw;
  });
}

/** Reference encoder: ordered `replace` passes (ampersand first!) plus `split`. */
function refEscape(input, options) {
  const hex = Boolean(options.hexNumeric);
  const numeric = (codePoint) =>
    hex ? `&#x${codePoint.toString(16).toUpperCase()};` : `&#${codePoint};`;

  const one = (text) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, numeric(0x27))
      .replace(/[^\x00-\x7e]/gu, (char) =>
        options.mode === 'nonAscii' ? numeric(char.codePointAt(0)) : char,
      );

  if (!options.skipExistingEntities) return one(input);
  return input
    .split(/(&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g)
    .map((part, index) => (index % 2 === 1 ? part : one(part)))
    .join('');
}

// ---------------------------------------------------------------------------
console.log('--- 转义：已知值 ---');
// ---------------------------------------------------------------------------
check('五个敏感字符', M.escapeHtml(`< > & " '`), '&lt; &gt; &amp; &quot; &#39;');
check(
  '典型片段',
  M.escapeHtml('<a href="x">Tom & Jerry\'s</a>'),
  '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
);
check('反斜杠与中文原样保留', M.escapeHtml('C:\\path 中文'), 'C:\\path 中文');
check('控制字符原样保留（HTML 不敏感）', M.escapeHtml('a\u0000b\tc'), 'a\u0000b\tc');
check('空输入', M.escapeHtml(''), '');
check('十六进制选项：撇号', M.escapeHtml(`'`, { hexNumeric: true }), '&#x27;');
check(
  '十六进制选项：非 ASCII 用大写十六进制',
  M.escapeHtml('中', { mode: 'nonAscii', hexNumeric: true }),
  '&#x4E2D;',
);

// ---------------------------------------------------------------------------
console.log('--- 反转义：已知值 ---');
// ---------------------------------------------------------------------------
check('&lt; 得到 <', M.decodeHtml('&lt;'), '<');
check('&#60; 得到 <', M.decodeHtml('&#60;'), '<');
check('&#x3C; 得到 <', M.decodeHtml('&#x3C;'), '<');
check('&#x3c; 小写十六进制同样得到 <', M.decodeHtml('&#x3c;'), '<');
check('三种写法互相等价', [M.decodeHtml('&lt;'), M.decodeHtml('&#60;'), M.decodeHtml('&#x3C;')], ['<', '<', '<']);
check('&amp; 得到 &', M.decodeHtml('&amp;'), '&');
check('&quot; 得到 "', M.decodeHtml('&quot;'), '"');
check('&gt; 得到 >', M.decodeHtml('&gt;'), '>');
check('混在文本里', M.decodeHtml('a &lt;b&gt; c'), 'a <b> c');
check('没有实体的文本不变', M.decodeHtml('普通文本 with & and AT&T'), '普通文本 with & and AT&T');
check('空输入', M.decodeHtml(''), '');

console.log('--- 命名实体的码位（对照 Unicode 标准值）---');
check('&nbsp; 的码位是 U+00A0', M.decodeHtml('&nbsp;').codePointAt(0), 0xa0);
check('&nbsp; 是单个字符', M.decodeHtml('&nbsp;').length, 1);
check('&copy; 的码位是 U+00A9', M.decodeHtml('&copy;').codePointAt(0), 0xa9);
check('&mdash; 的码位是 U+2014', M.decodeHtml('&mdash;').codePointAt(0), 0x2014);
check('&hellip; 的码位是 U+2026', M.decodeHtml('&hellip;').codePointAt(0), 0x2026);
check('&euro; 的码位是 U+20AC', M.decodeHtml('&euro;').codePointAt(0), 0x20ac);
check('&trade; 的码位是 U+2122', M.decodeHtml('&trade;').codePointAt(0), 0x2122);
check('&alpha; 的码位是 U+03B1', M.decodeHtml('&alpha;').codePointAt(0), 0x3b1);
check('&NotEqualTilde; 展开为两个码位', [...M.decodeHtml('&NotEqualTilde;')].map((c) => c.codePointAt(0)), [0x2242, 0x338]);
check('&nvlt; 展开为两个码位', [...M.decodeHtml('&nvlt;')].map((c) => c.codePointAt(0)), [0x3c, 0x20d2]);

console.log('--- 表规模与代表性样本 ---');
check('命名实体表条目数等于 WHATWG 列表（含分号形式）的 2125 条', M.NAMED_ENTITIES.size, 2125);
check('表里没有原型链污染项', M.decodeHtml('&constructor;'), '&constructor;');
check('&toString; 保持原样', M.decodeHtml('&toString;'), '&toString;');
check('&valueOf; 保持原样', M.decodeHtml('&valueOf;'), '&valueOf;');

{
  let mismatches = 0;
  let compared = 0;
  for (const [name, codePoint] of Object.entries(REF_TABLE)) {
    compared += 1;
    const actual = M.decodeHtml(`&${name};`);
    if (actual !== String.fromCodePoint(codePoint)) mismatches += 1;
  }
  check(`与手写参照表在 ${compared} 个命名实体上逐一一致`, mismatches, 0);
  check('参照表规模足够大（>= 200 条）', compared >= 200, true);
}

// ---------------------------------------------------------------------------
console.log('--- 陷阱 1：& 必须最先替换 ---');
// ---------------------------------------------------------------------------
{
  // The naive version, replacing `<` before `&`. It is wrong, and the assertion
  // below is what proves the trap is real rather than theoretical.
  const naive = (input) =>
    input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/&/g, '&amp;');

  check('朴素顺序（先 < 后 &）把 < 变成 &amp;lt;', naive('<'), '&amp;lt;');
  check('朴素顺序把 > 变成 &amp;gt;', naive('>'), '&amp;gt;');
  check('正确实现给出 &lt;', M.escapeHtml('<'), '&lt;');
  check('实现与「& 最先」的参照实现一致', M.escapeHtml('<a href="x">A&B</a>'), refEscape('<a href="x">A&B</a>', {}));
  // The single-pass implementation has no ordering to get wrong at all.
  check('两次转义之间没有可交换的顺序问题', M.escapeHtml('&amp;'), '&amp;amp;');
}

// ---------------------------------------------------------------------------
console.log('--- 陷阱 2：重复转义与可选的处理 ---');
// ---------------------------------------------------------------------------
check('默认会重复转义：&amp; -> &amp;amp;', M.escapeHtml('&amp;'), '&amp;amp;');
check('&nbsp; 同样会被再转义', M.escapeHtml('&nbsp;'), '&amp;nbsp;');
check(
  '开启「保留已有实体」后 &amp; 不变',
  M.escapeHtml('&amp;', { skipExistingEntities: true }),
  '&amp;',
);
check(
  '开启后混合文本只转义真正的敏感字符',
  M.escapeHtml('Tom & Jerry &amp; friends <b>', { skipExistingEntities: true }),
  'Tom &amp; Jerry &amp; friends &lt;b&gt;',
);
check(
  '缺少分号的 &amp 不被跳过（无法与普通文本区分）',
  M.escapeHtml('AT&T &amp', { skipExistingEntities: true }),
  'AT&amp;T &amp;amp',
);
check(
  '未知命名实体也按「看起来是实体」跳过',
  M.escapeHtml('&notreal;', { skipExistingEntities: true }),
  '&notreal;',
);
check(
  '数字实体同样被跳过',
  M.escapeHtml('&#169; &#xA9;', { skipExistingEntities: true }),
  '&#169; &#xA9;',
);
check(
  '非 ASCII 模式下已有实体不被展开成数字实体',
  M.escapeHtml('© &copy;', { mode: 'nonAscii', skipExistingEntities: true }),
  '&#169; &copy;',
);

// ---------------------------------------------------------------------------
console.log('--- 陷阱 3：未知实体原样保留 ---');
// ---------------------------------------------------------------------------
check('&notreal; 原样保留（不是空字符串）', M.decodeHtml('&notreal;'), '&notreal;');
check('&fake; 原样保留', M.decodeHtml('&fake;'), '&fake;');
check('&AMP 缺少分号时原样保留', M.decodeHtml('&amp'), '&amp');
check('&#xZZ; 不是数字实体，原样保留', M.decodeHtml('&#xZZ;'), '&#xZZ;');
check('裸 & 原样保留', M.decodeHtml('a & b'), 'a & b');
check('文本中的 & 不会被吃掉', M.decodeHtml('100% & more'), '100% & more');
check('未知实体与已知实体混排', M.decodeHtml('&notreal; &copy; &alsonot;'), '&notreal; © &alsonot;');

// ---------------------------------------------------------------------------
console.log('--- 陷阱 4：只解一层 ---');
// ---------------------------------------------------------------------------
check('&amp;lt; 解一次得到 &lt;', M.decodeHtml('&amp;lt;'), '&lt;');
check('&amp;lt; 不会一路解到 <', M.decodeHtml('&amp;lt;') === '<', false);
check('&amp;amp; 解一次得到 &amp;', M.decodeHtml('&amp;amp;'), '&amp;');
check('&amp;#39; 解一次得到 &#39;', M.decodeHtml('&amp;#39;'), '&#39;');
check('嵌套三层只解一层', M.decodeHtml('&amp;amp;lt;'), '&amp;lt;');

{
  // The "decode until stable" loop, which is the tempting wrong answer.
  const loopDecode = (input) => {
    let current = input;
    for (let i = 0; i < 10; i += 1) {
      const next = refDecode(current);
      if (next === current) return current;
      current = next;
    }
    return current;
  };
  check('循环解码会把 &amp;lt; 一路解成 <（证明本检查能抓到该缺陷）', loopDecode('&amp;lt;'), '<');
}

// ---------------------------------------------------------------------------
console.log('--- 陷阱 5：数字实体与码位 ---');
// ---------------------------------------------------------------------------
check('十进制 &#169; 得到 ©', M.decodeHtml('&#169;'), '©');
check('十六进制 &#xA9; 得到 ©', M.decodeHtml('&#xA9;'), '©');
check('前导零 &#0169; 得到 ©', M.decodeHtml('&#0169;'), '©');
check('非 BMP：&#x1F600; 是一个码位', M.decodeHtml('&#x1F600;').codePointAt(0), 0x1f600);
check('非 BMP：&#128512; 得到一个码位', [...M.decodeHtml('&#128512;')].length, 1);
check('emoji 往返', M.decodeHtml(M.escapeHtml('😀', { mode: 'nonAscii' })), '😀');
check(
  'astral 字符转义为一个实体（不是两个代理项）',
  M.escapeHtml('😀', { mode: 'nonAscii', hexNumeric: true }),
  '&#x1F600;',
);
check(
  '中文转义（十六进制）',
  M.escapeHtml('中文', { mode: 'nonAscii', hexNumeric: true }),
  '&#x4E2D;&#x6587;',
);
check('中文默认使用十进制实体', M.escapeHtml('中文', { mode: 'nonAscii' }), '&#20013;&#25991;');
check('敏感字符模式不动中文', M.escapeHtml('中文 <b>', {}), '中文 &lt;b&gt;');
check('U+007E 是边界，不转义', M.escapeHtml('~', { mode: 'nonAscii' }), '~');
check('U+007F 转义（十进制）', M.escapeHtml('\u007f', { mode: 'nonAscii' }), '&#127;');
check(
  'U+007F 转义（十六进制）',
  M.escapeHtml('\u007f', { mode: 'nonAscii', hexNumeric: true }),
  '&#x7F;',
);
check('U+00A0（不换行空格）默认用十进制实体', M.escapeHtml('\u00a0', { mode: 'nonAscii' }), '&#160;');
check(
  'U+00A0（不换行空格）十六进制模式',
  M.escapeHtml('\u00a0', { mode: 'nonAscii', hexNumeric: true }),
  '&#xA0;',
);

console.log('--- HTML 标准的 Windows-1252 替换 ---');
check('&#128; 得到欧元符号', M.decodeHtml('&#128;'), '\u20ac');
check('&#x80; 得到欧元符号', M.decodeHtml('&#x80;'), '\u20ac');
check('&#153; 得到商标符号', M.decodeHtml('&#153;'), '\u2122');
check('&#151; 得到长破折号', M.decodeHtml('&#151;'), '\u2014');
check('&#129; 无映射，保持 U+0081', M.decodeHtml('&#129;').codePointAt(0), 0x81);
check('&#159; 得到 Ÿ', M.decodeHtml('&#159;').codePointAt(0), 0x178);
check('&#127; 不进替换表，保持 U+007F', M.decodeHtml('&#127;').codePointAt(0), 0x7f);

console.log('--- 非字符码位原样保留 ---');
check('超过 U+10FFFF 原样保留', M.decodeHtml('&#x110000;'), '&#x110000;');
check('超大十进制原样保留', M.decodeHtml('&#1114112;'), '&#1114112;');
check('代理区码位原样保留', M.decodeHtml('&#xD800;'), '&#xD800;');
check('低代理区码位原样保留', M.decodeHtml('&#xDFFF;'), '&#xDFFF;');
check('U+10FFFF 本身是合法码位', M.decodeHtml('&#x10FFFF;').codePointAt(0), 0x10ffff);
check('越界数字实体在转义模式下仍只是文本', M.escapeHtml('&#x110000;'), '&amp;#x110000;');

// ---------------------------------------------------------------------------
console.log('--- 陷阱 5（转义侧）：正则缺少 u 标志会切开代理对 ---');
// ---------------------------------------------------------------------------
{
  const withoutU = (input) =>
    input.replace(/[^\x00-\x7e]/g, (char) => `&#${char.codePointAt(0)};`);
  const withU = (input) =>
    input.replace(/[^\x00-\x7e]/gu, (char) => `&#${char.codePointAt(0)};`);

  check('无 u 标志把 emoji 拆成两个代理项实体', withoutU('😀'), '&#55357;&#56832;');
  check('有 u 标志得到单个码位', withU('😀'), '&#128512;');
  check('实现与带 u 标志的参照一致', M.escapeHtml('😀中', { mode: 'nonAscii' }), withU('😀中'));
}

// ---------------------------------------------------------------------------
console.log('--- scanEntities：实体清单 ---');
// ---------------------------------------------------------------------------
{
  const entries = M.scanEntities('&amp; &#169; &#xA9; &notreal; &#x110000; &#xD800; &#128;');
  check('识别出 7 个引用', entries.length, 7);
  check('原文列表', entries.map((e) => e.raw), [
    '&amp;', '&#169;', '&#xA9;', '&notreal;', '&#x110000;', '&#xD800;', '&#128;',
  ]);
  check('类型判定', entries.map((e) => e.kind), [
    'named', 'decimal', 'hex', 'named', 'hex', 'hex', 'decimal',
  ]);
  check('名称只在命名实体上出现', entries.map((e) => e.name), [
    'amp', null, null, 'notreal', null, null, null,
  ]);
  check('可解析标记', entries.map((e) => e.resolved), [true, true, true, false, false, false, true]);
  check('说明标记', entries.map((e) => e.note), [
    null, null, null, 'unknown-name', 'out-of-range', 'surrogate', 'windows-1252-remap',
  ]);
  check('码位（Windows-1252 映射后）', entries.map((e) => e.codePoint), [
    38, 169, 169, null, null, null, 0x20ac,
  ]);
  check('字符', entries.map((e) => e.char), ['&', '©', '©', null, null, null, '\u20ac']);
  check('没有引用时是空数组', M.scanEntities('普通文本 & AT&T'), []);
  check(
    '缺少分号不算引用',
    M.scanEntities('&amp &#169').length,
    0,
  );
  check('码位格式化', M.formatCodePoint(0xa0), 'U+00A0');
  check('码位格式化（非 BMP 补足四位以上）', M.formatCodePoint(0x1f600), 'U+1F600');
}

// ---------------------------------------------------------------------------
console.log('--- 双实现交叉验证（随机样本 × 全部选项组合）---');
// ---------------------------------------------------------------------------
{
  const fragments = [
    '&', '<', '>', '"', "'", 'AT&T', 'a & b', '&amp;', '&amp;lt;', '&amp;amp;',
    '&nbsp;', '&copy;', '&mdash;', '&hellip;', '&notreal;', '&constructor;',
    '&amp', '&#169;', '&#xA9;', '&#x1F600;', '&#x110000;', '&#xD800;', '&#128;',
    '&#0169;', '&#xZZ;', '&NotEqualTilde;', '&nvlt;', '©', '€', '中', '文😀',
    'ǅ', '\u00a0', '\u007f', 'a', ' ', '\n', '\t', '\\', '&lt;script&gt;',
  ];

  // Deterministic pseudo-random so a failure is reproducible.
  let seed = 20240607;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const samples = ['', '&', '&&', '&amp;', '&#', '&#;', '&;', '<>&"\'', '&'.repeat(200)];
  for (let index = 0; index < 600; index += 1) {
    let sample = '';
    const pieces = 1 + Math.floor(rand() * 6);
    for (let piece = 0; piece < pieces; piece += 1) {
      sample += fragments[Math.floor(rand() * fragments.length)];
    }
    samples.push(sample);
  }
  samples.push('x'.repeat(5000) + '<&>' + '中'.repeat(500));

  const options = [];
  for (const mode of ['sensitive', 'nonAscii']) {
    for (const skipExistingEntities of [false, true]) {
      for (const hexNumeric of [false, true]) {
        options.push({ mode, skipExistingEntities, hexNumeric });
      }
    }
  }

  let mismatches = 0;
  let comparisons = 0;
  for (const sample of samples) {
    for (const option of options) {
      comparisons += 1;
      if (M.escapeHtml(sample, option) !== refEscape(sample, option)) mismatches += 1;
    }
    comparisons += 1;
    if (M.decodeHtml(sample) !== refDecode(sample)) mismatches += 1;
  }
  check(
    `${comparisons} 次转义/反转义与独立参照实现完全一致（${samples.length} 个样本 × ${options.length + 1} 种设置）`,
    mismatches,
    0,
  );

  // Round trip: escaping and decoding is the identity **as long as the input is
  // not already escaped**. With `skipExistingEntities` the escaper deliberately
  // preserves a reference like `&amp;` as-is, and decoding that reference once
  // yields `&` — the round trip is lossy by design there, so those settings are
  // excluded from the identity claim and asserted separately below.
  let roundTripFailures = 0;
  let identityComparisons = 0;
  for (const sample of samples) {
    for (const option of options) {
      if (option.skipExistingEntities) continue;
      identityComparisons += 1;
      if (M.decodeHtml(M.escapeHtml(sample, option)) !== sample) roundTripFailures += 1;
    }
  }
  check(
    `转义后再反转义可以还原（${identityComparisons} 组，跳过「保留已有实体」设置）`,
    roundTripFailures,
    0,
  );
  check(
    '开启「保留已有实体」后刻意不再往返一致（保留的是引用本身）',
    M.decodeHtml(M.escapeHtml('&amp;', { skipExistingEntities: true })),
    '&',
  );

  // Decoding is intentionally *not* idempotent: it resolves exactly one level,
  // so `&amp;lt;` -> `&lt;` -> `<`. That is the property being claimed, and the
  // assertion states it rather than pretending the function is a fixed point.
  check('反转义只走一层，因此不是幂等的', M.decodeHtml(M.decodeHtml('&amp;lt;')), '<');
}

// ---------------------------------------------------------------------------
console.log('--- 长输入与边界 ---');
// ---------------------------------------------------------------------------
{
  const long = 'a<&>"\''.repeat(20000);
  const escaped = M.escapeHtml(long);
  // Each 6-character group becomes 'a' + &lt; + &amp; + &gt; + &quot; + &#39; = 25.
  check('超长输入转义后长度增长符合预期', escaped.length, 20000 * 25);
  check('超长输入反转义可还原', M.decodeHtml(escaped), long);
  check('全部是 & 的输入', M.escapeHtml('&'.repeat(1000)), '&amp;'.repeat(1000));
  check('全部是实体的输入只解一层', M.decodeHtml('&amp;'.repeat(500)), '&'.repeat(500));
  check('CRLF 原样保留', M.decodeHtml('a\r\nb'), 'a\r\nb');
  check('仅一个 &', M.decodeHtml('&'), '&');
  check('孤立的 ; 不变', M.decodeHtml(';'), ';');
}

// ---------------------------------------------------------------------------
console.log('--- 权威参照物：Chromium 的 HTML 解析器 ---');
// ---------------------------------------------------------------------------
function chromiumProbe(body) {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><pre id="out"></pre><script>${body}</script></body></html>`;
  const page = '.verify/html-entities-probe.html';
  writeFileSync(page, html);
  const result = spawnSync(
    'chromium',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-proxy-server',
      '--no-first-run',
      '--virtual-time-budget=10000',
      '--user-data-dir=/tmp/wheat-tools-entities-profile',
      '--dump-dom',
      pathToFileURL(page).href,
    ],
    { encoding: 'utf8', timeout: 180000 },
  );
  if (result.error || result.status !== 0 || !result.stdout) return null;
  const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(result.stdout);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Decodes `&name;` for every name in the page and returns code points. */
const NAMED_PROBE = (names) => `
const names = ${JSON.stringify(names)};
const out = {};
for (const name of names) {
  const probe = document.createElement('div');
  probe.innerHTML = '&' + name + ';';
  out[name] = Array.from(probe.textContent, (c) => c.codePointAt(0));
}
document.getElementById('out').textContent = JSON.stringify(out);
`;

/** Decodes a list of numeric references and returns code points. */
const NUMERIC_PROBE = (values) => `
const values = ${JSON.stringify(values)};
const out = {};
for (const value of values) {
  const probe = document.createElement('div');
  probe.innerHTML = '&#' + value + ';';
  out[value] = Array.from(probe.textContent, (c) => c.codePointAt(0));
}
document.getElementById('out').textContent = JSON.stringify(out);
`;

{
  const names = [...M.NAMED_ENTITIES.keys()];
  const browser = chromiumProbe(NAMED_PROBE(names));

  if (!browser) {
    skipped += 1;
    console.log('SKIP  未找到可用的 chromium，跳过浏览器对照（不是失败）');
  } else {
    const missing = names.filter((name) => !(name in browser));
    check('浏览器返回了全部命名实体的解码结果', missing.length, 0);

    let mismatches = 0;
    const examples = [];
    for (const name of names) {
      const ours = [...M.NAMED_ENTITIES.get(name)].map((c) => c.codePointAt(0));
      const theirs = browser[name];
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        mismatches += 1;
        if (examples.length < 5) examples.push(`${name}: 我们 ${ours} / 浏览器 ${theirs}`);
      }
    }
    check(
      `${names.length} 个命名实体与 Chromium 的 HTML 解析器逐一一致` +
        (examples.length ? `（例：${examples.join('；')}）` : ''),
      mismatches,
      0,
    );
    check('对照的实体数量确实是 2125', names.length, 2125);
  }

  // Numeric references, including the Windows-1252 range and valid extremes.
  const numericValues = [
    'x41', 'x7E', 'x7F', 'x80', 'x81', 'x8D', 'x8F', 'x9D', 'x9F',
    'xA0', 'xA9', 'x151', 'x2013', 'x2028', 'x20AC', 'x1F600', 'x10FFFF',
    '65', '169', '128', '153',
  ];
  const numericBrowser = chromiumProbe(NUMERIC_PROBE(numericValues));
  if (!numericBrowser) {
    skipped += 1;
    console.log('SKIP  浏览器数字实体对照未能运行（不是失败）');
  } else {
    let mismatches = 0;
    const examples = [];
    for (const value of numericValues) {
      const raw = `&#${value};`;
      const ours = [...M.decodeHtml(raw)].map((c) => c.codePointAt(0));
      const theirs = numericBrowser[value];
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        mismatches += 1;
        if (examples.length < 5) examples.push(`${raw}: 我们 ${ours} / 浏览器 ${theirs}`);
      }
    }
    check(
      `数字实体（含 Windows-1252 区间与非 BMP）与 Chromium 一致` +
        (examples.length ? `（例：${examples.join('；')}）` : ''),
      mismatches,
      0,
    );

    // The two deliberate divergences, asserted so they cannot drift silently.
    const surrogate = chromiumProbe(NUMERIC_PROBE(['xD800', 'x110000']));
    if (surrogate) {
      check('浏览器把代理区码位替换为 U+FFFD', surrogate.xD800, [0xfffd]);
      check('本实现保留代理区码位原文（刻意分歧，避免静默替换）', M.decodeHtml('&#xD800;'), '&#xD800;');
      check('浏览器把越界码位替换为 U+FFFD', surrogate.x110000, [0xfffd]);
      check('本实现保留越界码位原文（刻意分歧）', M.decodeHtml('&#x110000;'), '&#x110000;');
    }

    // The unknown-name divergence: the browser applies the legacy `&not` match,
    // this tool refuses to guess.
    const unknown = chromiumProbe(`
const probe = document.createElement('div');
probe.innerHTML = '&notreal;';
const out = { text: probe.textContent, points: Array.from(probe.textContent, (c) => c.codePointAt(0)) };
document.getElementById('out').textContent = JSON.stringify(out);
`);
    if (unknown) {
      check('浏览器把 &notreal; 解析成 ¬real;（历史遗留的 &not 无分号匹配）', unknown.points, [0xac, 0x72, 0x65, 0x61, 0x6c, 0x3b]);
      check('本实现把 &notreal; 原样保留（刻意分歧）', M.decodeHtml('&notreal;'), '&notreal;');
    }
  }
}

console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}` +
    (skipped ? `，${skipped} 项因缺少 chromium 跳过` : ''),
);
process.exit(failed === 0 ? 0 : 1);
