/**
 * Checks the HTTP status code reference.
 *
 * The claim worth defending is "this table is accurate, not just plausible".
 * Two references that are independent of the implementation are used:
 *
 *   1. **The IANA HTTP Status Code Registry** (fetched 2025-09-15), transcribed
 *      below as `IANA_REFERENCE`. Every registered code must be present with the
 *      registered name, and the only codes allowed outside that registry are the
 *      two nonstandard ones the page itself labels nonstandard.
 *   2. **Node.js `http.STATUS_CODES`**, a platform-shipped table written by
 *      somebody else. It is used as a second, differently-maintained oracle:
 *      every code Node knows must exist here, and the two tables may disagree on
 *      the English name only in the three documented RFC 9110 renames.
 *
 * Neither reference can be satisfied by copying the implementation, which is the
 * point — a check that merely restates the data it is checking proves nothing.
 *
 * Usage: node scripts/check-http-status-codes.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { STATUS_CODES as NODE_STATUS_CODES } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/http-status-codes/httpStatusCodesUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/http-status-codes.mjs', compiled);
const M = await import(pathToFileURL('.verify/http-status-codes.mjs').href);

const { HTTP_STATUS_CODES, CATEGORY_ORDER, CATEGORY_META, KIND_LABELS } = M;
const byCode = new Map(HTTP_STATUS_CODES.map((entry) => [entry.code, entry]));
const codes = HTTP_STATUS_CODES.map((entry) => entry.code);

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

/**
 * The IANA registry as published at
 * https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml
 * (last updated 2025-09-15), transcribed verbatim. `(Unused)` and `(OBSOLETED)`
 * annotations are kept for 418 only, where the mismatch with this page is
 * intentional and asserted below; 510's name is recorded without its
 * registry status annotation.
 *
 * 104 is listed on purpose: it is the one registry entry this page excludes, and
 * the exclusion is asserted rather than left implicit.
 */
const IANA_REFERENCE = [
  [100, 'Continue'],
  [101, 'Switching Protocols'],
  [102, 'Processing'],
  [103, 'Early Hints'],
  [104, 'Upload Resumption Supported'],
  [200, 'OK'],
  [201, 'Created'],
  [202, 'Accepted'],
  [203, 'Non-Authoritative Information'],
  [204, 'No Content'],
  [205, 'Reset Content'],
  [206, 'Partial Content'],
  [207, 'Multi-Status'],
  [208, 'Already Reported'],
  [226, 'IM Used'],
  [300, 'Multiple Choices'],
  [301, 'Moved Permanently'],
  [302, 'Found'],
  [303, 'See Other'],
  [304, 'Not Modified'],
  [305, 'Use Proxy'],
  [306, '(Unused)'],
  [307, 'Temporary Redirect'],
  [308, 'Permanent Redirect'],
  [400, 'Bad Request'],
  [401, 'Unauthorized'],
  [402, 'Payment Required'],
  [403, 'Forbidden'],
  [404, 'Not Found'],
  [405, 'Method Not Allowed'],
  [406, 'Not Acceptable'],
  [407, 'Proxy Authentication Required'],
  [408, 'Request Timeout'],
  [409, 'Conflict'],
  [410, 'Gone'],
  [411, 'Length Required'],
  [412, 'Precondition Failed'],
  [413, 'Content Too Large'],
  [414, 'URI Too Long'],
  [415, 'Unsupported Media Type'],
  [416, 'Range Not Satisfiable'],
  [417, 'Expectation Failed'],
  [418, '(Unused)'],
  [421, 'Misdirected Request'],
  [422, 'Unprocessable Content'],
  [423, 'Locked'],
  [424, 'Failed Dependency'],
  [425, 'Too Early'],
  [426, 'Upgrade Required'],
  [428, 'Precondition Required'],
  [429, 'Too Many Requests'],
  [431, 'Request Header Fields Too Large'],
  [451, 'Unavailable For Legal Reasons'],
  [500, 'Internal Server Error'],
  [501, 'Not Implemented'],
  [502, 'Bad Gateway'],
  [503, 'Service Unavailable'],
  [504, 'Gateway Timeout'],
  [505, 'HTTP Version Not Supported'],
  [506, 'Variant Also Negotiates'],
  [507, 'Insufficient Storage'],
  [508, 'Loop Detected'],
  [510, 'Not Extended'],
  [511, 'Network Authentication Required'],
];

/** Codes this page adds on top of the registry, and why. */
const NONSTANDARD_CODES = [449, 509];

/** The registry entry this page deliberately leaves out, and why. */
const EXCLUDED_REGISTRY_CODE = 104;

console.log('--- 数据完整性 ---');
check(`条目总数（${HTTP_STATUS_CODES.length}）`, HTTP_STATUS_CODES.length, 65);
check('IANA 参照表抄录条数', IANA_REFERENCE.length, 64);
check('无重复条目', new Set(codes).size, codes.length);
check('按码值升序排列', codes, codes.slice().sort((a, b) => a - b));
check(
  '各类别条目数',
  M.countByCategory(HTTP_STATUS_CODES),
  { '1xx': 4, '2xx': 10, '3xx': 9, '4xx': 30, '5xx': 12 },
);
check(
  'countByCategory 合计等于总数',
  Object.values(M.countByCategory(HTTP_STATUS_CODES)).reduce((sum, n) => sum + n, 0),
  HTTP_STATUS_CODES.length,
);

console.log('--- 类别与首位数字一致（穷举） ---');
{
  // Every entry as stored, compared with the class derived from its own digits.
  const mismatches = HTTP_STATUS_CODES.filter(
    (entry) => entry.category !== M.categoryOf(entry.code),
  ).map((entry) => [entry.code, entry.category, M.categoryOf(entry.code)]);
  check('65 个条目的 category 都等于首位数字推导出的类别', mismatches, []);

  // And the derivation itself over the entire valid range, not just the codes
  // that happen to be in the table: a broken `categoryOf` could agree with a
  // broken table on exactly those values.
  let rangeMismatches = 0;
  for (let code = 100; code <= 599; code += 1) {
    if (M.categoryOf(code) !== `${Math.floor(code / 100)}xx`) rangeMismatches += 1;
  }
  check('categoryOf 在 100–599 全部 500 个取值上都正确', rangeMismatches, 0);

  check('99 不是合法状态码', M.categoryOf(99), null);
  check('600 不是合法状态码', M.categoryOf(600), null);
  check('0 不是合法状态码', M.categoryOf(0), null);
  check('负数不是合法状态码', M.categoryOf(-1), null);
  check('小数不是合法状态码', M.categoryOf(404.5), null);
  check('NaN 不是合法状态码', M.categoryOf(Number.NaN), null);
  check('Infinity 不是合法状态码', M.categoryOf(Number.POSITIVE_INFINITY), null);
}

console.log('--- 权威参照物 1：IANA HTTP 状态码注册表 ---');
{
  const ianaByCode = new Map(IANA_REFERENCE);
  check('参照表本身包含 104（用于断言"故意排除"）', ianaByCode.has(104), true);

  // Every registered code except the documented exclusion must be present, with
  // the registered name.
  const missing = [];
  const nameMismatches = [];
  for (const [code, name] of IANA_REFERENCE) {
    if (code === EXCLUDED_REGISTRY_CODE) continue;
    const entry = byCode.get(code);
    if (!entry) {
      missing.push(code);
      continue;
    }
    // 418 is the single intentional divergence: the registry holds the number
    // with the placeholder "(Unused)", this page shows the RFC 2324 joke name.
    if (entry.name !== name && code !== 418) {
      nameMismatches.push([code, name, entry.name]);
    }
  }
  check('IANA 注册表中除 104 外全部收录', missing, []);
  check('英文名与 IANA 注册表逐字一致（仅 418 按 RFC 2324 取名）', nameMismatches, []);
  check('418 在注册表中的登记名确实是 (Unused)', ianaByCode.get(418), '(Unused)');
  check('418 的取名确有 RFC 依据', byCode.get(418).source.includes('RFC 2324'), true);

  // Nothing outside the registry except the two explicitly nonstandard codes.
  const ianaCodes = new Set(IANA_REFERENCE.map(([code]) => code));
  const outside = codes.filter((code) => !ianaCodes.has(code)).sort((a, b) => a - b);
  check('注册表之外的码正好是标注为非标准的 449 与 509', outside, NONSTANDARD_CODES);
  check('449 与 509 的 kind 都是 nonstandard', [
    byCode.get(449).kind,
    byCode.get(509).kind,
  ], ['nonstandard', 'nonstandard']);
  check('104 确实未收录', byCode.has(104), false);

  const unassigned = codes.filter(
    (code) => !ianaCodes.has(code) && !NONSTANDARD_CODES.includes(code),
  );
  check('没有收录任何 IANA 未分配的码', unassigned, []);
}

console.log('--- 权威参照物 2：Node.js http.STATUS_CODES ---');
{
  const nodeEntries = Object.entries(NODE_STATUS_CODES).map(([code, name]) => [
    Number(code),
    name,
  ]);
  check('Node 参照表非空', nodeEntries.length > 40, true);
  check('Node 表收录 509，与"常见非标准码"的判断一致', NODE_STATUS_CODES[509], 'Bandwidth Limit Exceeded');

  const missingFromOurs = nodeEntries
    .map(([code]) => code)
    .filter((code) => !byCode.has(code));
  check('Node 认识的状态码本页全部收录（无遗漏）', missingFromOurs, []);

  // The two tables are maintained by different people. They may disagree on a
  // name only where RFC 9110 renamed the code or where Node still capitalises
  // the teapot joke; any other disagreement means one of them is wrong.
  const documentedRenames = [
    [413, 'Payload Too Large', 'Content Too Large'],
    [418, "I'm a Teapot", "I'm a teapot"],
    [422, 'Unprocessable Entity', 'Unprocessable Content'],
  ];
  const nameDiffs = [];
  for (const [code, nodeName] of nodeEntries) {
    const entry = byCode.get(code);
    if (!entry) continue;
    if (entry.name !== nodeName) nameDiffs.push([code, nodeName, entry.name]);
  }
  check(
    '与 Node 英文名的差异正好是 RFC 9110 改名与 418 的大小写',
    nameDiffs,
    documentedRenames,
  );
}

console.log('--- 关键码英文名逐字校验 ---');
{
  const required = [
    [200, 'OK'],
    [201, 'Created'],
    [204, 'No Content'],
    [301, 'Moved Permanently'],
    [302, 'Found'],
    [304, 'Not Modified'],
    [307, 'Temporary Redirect'],
    [308, 'Permanent Redirect'],
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [405, 'Method Not Allowed'],
    [408, 'Request Timeout'],
    [409, 'Conflict'],
    [410, 'Gone'],
    [418, "I'm a teapot"],
    [422, 'Unprocessable Content'],
    [429, 'Too Many Requests'],
    [500, 'Internal Server Error'],
    [502, 'Bad Gateway'],
    [503, 'Service Unavailable'],
    [504, 'Gateway Timeout'],
  ];
  for (const [code, name] of required) {
    check(`${code} ${name}`, byCode.get(code)?.name, name);
  }
}

console.log('--- 422 / 413 的改名说明 ---');
{
  const entry422 = byCode.get(422);
  check('422 采用 RFC 9110 的现行名称', entry422.name, 'Unprocessable Content');
  check('422 出处指向 RFC 9110', entry422.source.includes('RFC 9110'), true);
  check('422 说明了早期名称 Unprocessable Entity', entry422.note.includes('Unprocessable Entity'), true);
  check('422 说明了早期 RFC 4918', entry422.note.includes('RFC 4918'), true);

  const entry413 = byCode.get(413);
  check('413 采用 RFC 9110 的现行名称', entry413.name, 'Content Too Large');
  check('413 说明了旧名 Payload Too Large', entry413.note.includes('Payload Too Large'), true);
  check('413 说明了更早的 Request Entity Too Large', entry413.note.includes('Request Entity Too Large'), true);

  check('304 的说明指向 RFC 9111（缓存）', byCode.get(304).note.includes('RFC 9111'), true);
  check('308 的说明指向 RFC 7538（最初定义）', byCode.get(308).note.includes('RFC 7538'), true);
}

console.log('--- 每条都有中文说明与出处 ---');
{
  const noZh = HTTP_STATUS_CODES.filter(
    (entry) => typeof entry.zh !== 'string' || entry.zh.trim().length < 8 || !/[\u4e00-\u9fff]/.test(entry.zh),
  ).map((entry) => entry.code);
  check('每条都有非空且含中文的说明', noZh, []);

  const noSource = HTTP_STATUS_CODES.filter(
    (entry) => typeof entry.source !== 'string' || entry.source.trim().length < 5,
  ).map((entry) => entry.code);
  check('每条都标了出处', noSource, []);

  const noRfc = HTTP_STATUS_CODES.filter(
    (entry) => entry.kind === 'standard' && !/RFC\s?\d+/.test(entry.source),
  ).map((entry) => entry.code);
  check('所有标准码的出处都带 RFC 编号', noRfc, []);

  // A nonstandard code must either cite the document that defines it (418 has an
  // RFC, it is just a joke one) or say outright that no RFC exists.
  const unofficial = HTTP_STATUS_CODES.filter((entry) => entry.kind === 'nonstandard');
  check(
    '非标准码都写明了依据或"非标准"',
    unofficial.every((entry) => entry.source.includes('RFC') || entry.source.includes('非标准')),
    true,
  );
  check(
    '没有 RFC 依据的非标准码（449/509）显式写明"非标准"',
    [byCode.get(449).source.includes('非标准'), byCode.get(509).source.includes('非标准')],
    [true, true],
  );

  const unlabeled = HTTP_STATUS_CODES.filter(
    (entry) => entry.kind !== 'standard' && !(typeof entry.note === 'string' && entry.note.length > 10),
  ).map((entry) => entry.code);
  check('每个非标准／废弃／保留码都有说明原因的 note', unlabeled, []);

  const kinds = new Set(HTTP_STATUS_CODES.map((entry) => entry.kind));
  check(
    '四种标注都出现过',
    [...kinds].sort(),
    ['deprecated', 'nonstandard', 'reserved', 'standard'],
  );
  check('四种标注都有中文徽标', Object.values(KIND_LABELS), ['标准', '已废弃', '保留', '非标准']);

  check('305 标为已废弃', byCode.get(305).kind, 'deprecated');
  check('102 标为已废弃', byCode.get(102).kind, 'deprecated');
  check('510 标为已废弃（IANA 标注 OBSOLETED）', byCode.get(510).kind, 'deprecated');
  check('306 标为保留未使用', byCode.get(306).kind, 'reserved');
  check('418 标为非标准（愚人节 RFC）', byCode.get(418).kind, 'nonstandard');
}

console.log('--- 引用到的 RFC 集合 ---');
{
  const cited = new Set();
  for (const entry of HTTP_STATUS_CODES) {
    for (const match of entry.source.matchAll(/RFC\s?(\d+)/g)) cited.add(Number(match[1]));
  }
  check(
    '出处引用到的 RFC 编号集合',
    [...cited].sort((a, b) => a - b),
    [2295, 2324, 2518, 2774, 3229, 4918, 5842, 6585, 7725, 8297, 8470, 9110],
  );
  const rfc9110Count = HTTP_STATUS_CODES.filter((entry) => entry.source.includes('RFC 9110')).length;
  check('RFC 9110 是主要依据（引用它的条目数 > 30）', rfc9110Count > 30, true);
}

console.log('--- 分类元数据 ---');
check('类别顺序', CATEGORY_ORDER, ['1xx', '2xx', '3xx', '4xx', '5xx']);
check(
  '每个类别都有中文名与一句话说明',
  CATEGORY_ORDER.every(
    (key) => CATEGORY_META[key].label.length > 0 && CATEGORY_META[key].summary.length > 0,
  ),
  true,
);

console.log('--- 分类筛选 ---');
{
  for (const category of CATEGORY_ORDER) {
    const filtered = M.searchStatusCodes('', category);
    check(
      `${category} 筛选出 ${filtered.length} 条且类别全部正确`,
      [filtered.length, filtered.every((entry) => entry.category === category)],
      [M.countByCategory(HTTP_STATUS_CODES)[category], true],
    );
  }
  check('全部筛选不丢条目', M.searchStatusCodes('').length, HTTP_STATUS_CODES.length);
  check('筛选结果升序', M.searchStatusCodes('', '4xx').map((entry) => entry.code).slice(0, 4), [400, 401, 402, 403]);

  // Filter and query are combined with AND, which the UI explains.
  const combined = M.searchStatusCodes('206', '2xx');
  check('类别与关键词同时生效', combined.map((entry) => entry.code), [206]);
  check('关键词不在该类时为空', M.searchStatusCodes('206', '5xx'), []);
  check('关键词在全部类别中仍能找到', M.searchStatusCodes('206', 'all').map((entry) => entry.code), [206]);
}

console.log('--- 搜索：每个码都能被自己的数字搜到 ---');
{
  let unreachable = 0;
  let unreachableInOwnCategory = 0;
  for (const entry of HTTP_STATUS_CODES) {
    const byNumber = M.searchStatusCodes(String(entry.code)).map((hit) => hit.code);
    if (!byNumber.includes(entry.code)) unreachable += 1;
    const scoped = M.searchStatusCodes(String(entry.code), entry.category).map((hit) => hit.code);
    if (!scoped.includes(entry.code)) unreachableInOwnCategory += 1;
  }
  check('65 个码都能被自己的数字搜到', unreachable, 0);
  check('在自己的类别筛选下也都能搜到', unreachableInOwnCategory, 0);

  // The user-facing requirement stated as a plain number: a three-digit search
  // for a code should surface it, not require the exact name.
  check('搜 404 命中 404', M.searchStatusCodes('404').map((entry) => entry.code), [404]);
  check('数字支持部分匹配（40 命中 400–409）', M.searchStatusCodes('40').length, 10);
}

console.log('--- 搜索：英文名、中文说明与出处 ---');
{
  check('英文名大小写不敏感', M.searchStatusCodes('moved permanently').map((e) => e.code), [301]);
  check('大写英文名同样命中', M.searchStatusCodes('NOT FOUND').map((e) => e.code), [404]);
  check('多词是 AND，不是 OR', M.searchStatusCodes('moved found'), []);
  check('中文说明可搜（限流）', M.searchStatusCodes('限流').map((e) => e.code), [429]);
  check('中文说明可搜（茶壶）', M.searchStatusCodes('茶壶').map((e) => e.code), [418]);
  check('中文说明可搜（强制门户）', M.searchStatusCodes('强制门户').map((e) => e.code), [511]);
  check('出处可搜（RFC 8470）', M.searchStatusCodes('RFC 8470').map((e) => e.code), [425]);
  check('出处可搜（MS-WDV）', M.searchStatusCodes('MS-WDV').map((e) => e.code), [449]);
  check('出处小节号可搜（§15.4.9）', M.searchStatusCodes('§15.4.9').map((e) => e.code), [308]);
  check('类别名可搜（4xx）', M.searchStatusCodes('4xx').length, 30);
  check('标注徽标可搜（已废弃）', M.searchStatusCodes('已废弃').map((e) => e.code), [102, 305, 510]);
  check('WebDAV 相关码可被搜到', M.searchStatusCodes('WebDAV').map((e) => e.code).includes(507), true);
  check('RFC 4918 的 WebDAV 码可被搜到', M.searchStatusCodes('RFC 4918').map((e) => e.code).includes(423), true);
  check('空格分隔的多个词逐项生效', M.searchStatusCodes('404 found').map((e) => e.code), [404]);
}

console.log('--- 边界：空、无效、特殊字符 ---');
{
  check('不存在的码返回空', M.searchStatusCodes('9999'), []);
  check('只存在于未来的码返回空', M.searchStatusCodes('299'), []);
  check('无意义的中文返回空', M.searchStatusCodes('不存在的说明'), []);
  check('纯空白查询等于不筛选', M.searchStatusCodes('   ').length, HTTP_STATUS_CODES.length);
  check('查询两端空格被忽略', M.searchStatusCodes(' 404 ').map((e) => e.code), [404]);

  // No parenthesis in this list on purpose: `(` is a legitimate substring of
  // the entry named "(Unused)", so matching it is correct rather than a false
  // positive, and it is asserted separately below.
  const specials = ['.*+', '[]()', '\\', '^$', 'a/*b', '???', '|', '🍵', '<script>', '" OR 1=1 --', '%%%'];
  let crashed = null;
  let nonEmpty = [];
  for (const query of specials) {
    try {
      const result = M.searchStatusCodes(query);
      if (!Array.isArray(result)) crashed = `${query} 未返回数组`;
      if (result.length > 0) nonEmpty.push([query, result.map((e) => e.code)]);
    } catch (error) {
      crashed = `${query} 抛出 ${error.message}`;
    }
  }
  check('特殊字符不抛异常', crashed, null);
  check('特殊字符不会误命中条目', nonEmpty, []);
  // `(` is a real substring of the "(Unused)" name and note, so here a hit is
  // the correct answer, not a false positive.
  check('括号命中名称/说明里带括号的条目', M.searchStatusCodes('(').map((e) => e.code), [306, 418]);

  // The naive implementation this guards against: compiling the query into a
  // RegExp. It throws on perfectly ordinary input, which is why matching is done
  // with String.includes instead.
  let regexThrew = false;
  try {
    new RegExp('.*+');
  } catch {
    regexThrew = true;
  }
  check('朴素写法（把查询编译成正则）确实会崩，证明不能那么写', regexThrew, true);

  // Very long input must terminate quickly and match nothing.
  const longQuery = 'x'.repeat(20000);
  const started = Date.now();
  check('两万字符的查询返回空且不抛异常', M.searchStatusCodes(longQuery), []);
  check('超长查询耗时在 1 秒以内', Date.now() - started < 1000, true);

  check('emoji 查询返回空', M.searchStatusCodes('🍵').length, 0);
}

console.log('--- 边界：全角输入 ---');
{
  check('全角数字 ４０４ 命中 404', M.searchStatusCodes('４０４').map((e) => e.code), [404]);
  check('全角英文 ＯＫ 命中 200', M.searchStatusCodes('ＯＫ').map((e) => e.code), [200]);
  check('全角空格不破坏分词', M.searchStatusCodes('404　found').map((e) => e.code), [404]);
  check('normalizeWidth 只改全角', M.normalizeWidth('a１！'), 'a1!');

  // Without width folding, plain substring matching finds nothing — the reason
  // normalizeWidth exists at all.
  const naive = HTTP_STATUS_CODES.filter((entry) => String(entry.code).includes('４０４'));
  check('朴素写法（不做全角归一）确实找不到，证明这一步是必要的', naive.length, 0);
}

console.log('--- 返回值与复制文本 ---');
{
  const first = M.searchStatusCodes('');
  const lengthBefore = first.length;
  first.pop();
  check('返回值是副本，调用方改不动内部表', M.searchStatusCodes('').length, lengthBefore);

  check('copy 文本就是码值', M.statusCodeText(byCode.get(404)), '404');
  check('copy 文本是字符串', typeof M.statusCodeText(byCode.get(500)), 'string');
  check('queryTerms 忽略大小写与多余空格', M.queryTerms('  NOT   found '), ['not', 'found']);
  check('queryTerms 对空串返回空数组', M.queryTerms('   '), []);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
