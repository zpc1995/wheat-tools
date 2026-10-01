/**
 * Verifies the SafeLink decoder.
 *
 * The claim worth defending is the round trip: take a real destination URL,
 * build a SafeLink in the documented shape around it, decode, and get the
 * original URL back byte for byte — including query strings, fragments, Chinese
 * text, emoji and characters that were already percent-encoded.
 *
 * Two independent references are used rather than the implementation's own
 * opinion:
 *
 *   - the browser's `URLSearchParams`, which is the WHATWG reading of a query
 *     string and therefore the reference for the `+` decision;
 *   - `decodeURIComponent`, the platform's own percent decoder, for the strict
 *     reading.
 *
 * Naive approaches are implemented alongside and asserted to be wrong, so these
 * checks would catch the bugs they warn about instead of merely passing:
 * a single `decodeURIComponent` call loses doubly-encoded input, and treating a
 * bare `+` as a literal silently changes the destination.
 *
 * Usage: node scripts/check-safelink-decoder.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/safelink-decoder/safelinkUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/safelink-decoder.mjs', compiled);
const M = await import(pathToFileURL('.verify/safelink-decoder.mjs').href);

let passed = 0;
let failed = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else {
    failed += 1;
    failures.push(label);
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}

function checkTrue(label, condition) {
  check(label, condition, true);
}

const DATA = '05%7C01%7Cuser%40contoso.com%7C6e0bfede3fcb4518a16565dc14fe5620%7C0';
const SDATA = 'SYE9eiOYbZb5HG8EPKlo%2FGsvhL9sJQ%2BpSpVr4TjZJbI%3D';
const HOST = 'nam12.safelinks.protection.outlook.com';

/** Builds a SafeLink in the documented shape, with Microsoft-style data. */
function buildSafeLink(target, options = {}) {
  const host = options.host ?? HOST;
  const encodeFn = options.encodeFn ?? encodeURIComponent;
  const data = options.data ?? DATA;
  const sdata = options.sdata ?? SDATA;
  const reserved = options.reserved ?? '0';
  return `https://${host}/?url=${encodeFn(target)}&data=${data}&sdata=${sdata}&reserved=${reserved}`;
}

/** Form encoding: the variant that writes a space as a plus sign. */
function formEncode(value) {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

console.log('--- 往返：真实 URL 编成 SafeLink 再解回来 ---');
{
  const targets = [
    'https://example.com/',
    'https://example.com/path/to/page?q=hello&lang=zh-CN#frag',
    'https://example.com/中文/路径?关键词=值&x=1',
    'https://example.com/search?q=a+b&r=c%2Bd',
    'https://example.com/a%20b/c%3Fd',
    'https://example.com/emoji/🎉/x',
    'http://example.com:8080/p?x=1',
    'https://example.com/?redirect=https%3A%2F%2Fother.example%2F%3Fa%3D1%26b%3D2',
    'mailto:someone@example.com?subject=Hi%20there',
    'https://example.com/a b',
    'https://example.com/plus+sign?q=x+y',
  ];

  let mismatches = 0;
  let strictMismatches = 0;
  let formMismatches = 0;
  let passCountsWrong = 0;

  for (const target of targets) {
    const link = buildSafeLink(target);
    const result = M.decodeSafelink(link);
    if (!result.ok || result.target !== target) mismatches += 1;
    if (!result.ok || result.targetLiteral !== target) strictMismatches += 1;
    if (!result.ok || result.layers[0].passes !== 1) passCountsWrong += 1;

    const formResult = M.decodeSafelink(buildSafeLink(target, { encodeFn: formEncode }));
    if (!formResult.ok || formResult.target !== target) formMismatches += 1;
  }

  check(`11 个目标 URL 全部原样还原（含查询串、锚点、中文、emoji、已编码字符）`, mismatches, 0);
  check('严格读法下同样全部还原（这些链接没有裸 + 号歧义）', strictMismatches, 0);
  check('表单编码（空格写成 +）的目标也能原样还原', formMismatches, 0);
  check('单层编码时报告的解码次数都是 1', passCountsWrong, 0);

  const sample = M.decodeSafelink(buildSafeLink('https://example.com/docs?id=42&lang=zh-CN#section-3'));
  check('示例：目标', sample.ok ? sample.target : sample.error, 'https://example.com/docs?id=42&lang=zh-CN#section-3');
  check('示例：声明未验证签名', sample.signatureVerified, false);
  check('示例：四个参数都列出', sample.params.map((p) => p.key), ['url', 'data', 'sdata', 'reserved']);
}

console.log('--- 独立参照物：浏览器 URLSearchParams 与 decodeURIComponent ---');
{
  const link = buildSafeLink('https://example.com/a?b=1&c=中文#f');
  check(
    '普通链接：与 WHATWG URLSearchParams 一致',
    M.decodeSafelink(link).target,
    new URL(link).searchParams.get('url'),
  );

  // The classic ambiguity, spelled out.
  const plusLink = `https://${HOST}/?url=https%3A%2F%2Fex.com%2F%3Fq%3Da+b&data=x&sdata=y&reserved=0`;
  const formReading = M.decodeSafelink(plusLink).target;
  const strictReading = M.decodeSafelink(plusLink, { plusMode: 'literal' }).target;

  check('裸 + 号：默认按表单规则读作空格', formReading, 'https://ex.com/?q=a b');
  check('裸 + 号：与 URLSearchParams 的表单解读一字不差', formReading, new URL(plusLink).searchParams.get('url'));
  check('裸 + 号：严格读法保留字面加号', strictReading, 'https://ex.com/?q=a+b');
  check('裸 + 号：与 decodeURIComponent 的严格解读一致', strictReading, decodeURIComponent('https%3A%2F%2Fex.com%2F%3Fq%3Da+b'));

  // Counter-assertion: the folklore that decodeURIComponent turns + into a
  // space is wrong; it is the form decoder (URLSearchParams and friends) that
  // does. Knowing which API does what is the whole point of the warning.
  check('反证：decodeURIComponent 本身不会把 + 变成空格', decodeURIComponent('a+b'), 'a+b');
  check('反证：URLSearchParams 才会把 + 变成空格', new URL(plusLink).searchParams.get('url').includes('a b'), true);
  check('反证：两种读法确实不同，所以必须显式选择', formReading === strictReading, false);
  check(
    '裸 + 号会触发歧义告警',
    M.decodeSafelink(plusLink).warnings.some((w) => w.code === 'ambiguous-plus'),
    true,
  );

  // A conforming encoder never produces a bare plus for a literal one.
  check('参照：encodeURIComponent 把字面加号写成 %2B', encodeURIComponent('a+b'), 'a%2Bb');
}

console.log('--- 多层编码 ---');
{
  const target = 'https://example.com/a?b=1&c=2';
  const once = encodeURIComponent(target);
  const twice = encodeURIComponent(once);
  const thrice = encodeURIComponent(twice);

  const doubleLink = `https://${HOST}/?url=${twice}&data=${DATA}&sdata=${SDATA}&reserved=0`;
  const tripleLink = `https://${HOST}/?url=${thrice}&data=${DATA}&sdata=${SDATA}&reserved=0`;

  const double = M.decodeSafelink(doubleLink);
  check('双重编码：报告解码 2 次', double.layers[0].passes, 2);
  check('双重编码：目标正确', double.target, target);
  check('双重编码：触发提示', double.warnings.some((w) => w.code === 'double-encoded'), true);

  const triple = M.decodeSafelink(tripleLink);
  check('三重编码：报告解码 3 次', triple.layers[0].passes, 3);
  check('三重编码：目标正确', triple.target, target);

  // Counter-assertion: one pass leaves escape residue behind.
  check('反证：只解一次会留下 %xx 残渣', once, 'https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2');
  check('反证：只解一次得不到原 URL', decodeURIComponent(twice) === target, false);

  // A destination that legitimately contains an encoded character must not be
  // decoded a second time: %2520 in the wrapper is the site's literal %20.
  const literalPercent = 'https://example.com/literal%20percent';
  const onceLink = `https://${HOST}/?url=${encodeURIComponent(literalPercent)}&data=x&sdata=y&reserved=0`;
  const preserved = M.decodeSafelink(onceLink);
  check('目标里的字面 %20 不被过度解码', preserved.target, literalPercent);
  check('该情况只解一次', preserved.layers[0].passes, 1);
}

console.log('--- 域名与主机变体 ---');
{
  const hosts = [
    'nam12.safelinks.protection.outlook.com',
    'eur01.safelinks.protection.outlook.com',
    'apc01.safelinks.protection.outlook.com',
    'na01.safelinks.protection.outlook.com',
    'emea01.safelinks.protection.outlook.com',
    'nam01.safelinks.protection.outlook.com',
    'safelinks.protection.outlook.com',
    'xyz99.safelinks.protection.outlook.com',
  ];
  let bad = 0;
  for (const host of hosts) {
    const result = M.decodeSafelink(buildSafeLink('https://example.com/host-test', { host }));
    if (!result.ok || result.target !== 'https://example.com/host-test') bad += 1;
    if (result.ok && result.host !== host) bad += 1;
  }
  check('8 种主机（含无地区前缀与任意前缀）都识别且还原正确', bad, 0);

  checkTrue('识别函数对未知前缀按后缀匹配', M.isSafelinkHost('abc123.safelinks.protection.outlook.com'));
  checkTrue('尾随点也识别', M.isSafelinkHost('nam12.safelinks.protection.outlook.com.'));
  check('大小写混写的域名也识别', M.decodeSafelink(buildSafeLink('https://e.com', { host: 'NAM12.SafeLinks.Protection.Outlook.COM' })).ok, true);
  check(
    '仿冒域名（真正的域名在后）不算 SafeLink',
    M.decodeSafelink('https://nam12.safelinks.protection.outlook.com.evil.example/?url=https%3A%2F%2Fe.com&data=x').code,
    'not-safelink',
  );
  check(
    '前缀粘连的域名不算 SafeLink',
    M.decodeSafelink('https://notsafelinks.protection.outlook.com/?url=https%3A%2F%2Fe.com&data=x').code,
    'not-safelink',
  );
}

console.log('--- outlook.office.com 包装 ---');
{
  const wrapper =
    'https://outlook.office.com/mail/inbox/id/AAQkAD?url=https%3A%2F%2Fexample.com%2Fwrapped%3Fa%3D1&data=x';
  const result = M.decodeSafelink(wrapper);
  check('邮件包装：成功解析', result.ok, true);
  check('邮件包装：类别', result.kind, 'outlook-wrapper');
  check('邮件包装：目标', result.target, 'https://example.com/wrapped?a=1');
  check(
    '邮件包装：明确提示这是未文档化的包装而非 SafeLink 域名',
    result.warnings.some((w) => w.code === 'outlook-wrapper-unconfirmed'),
    true,
  );
  checkTrue('/mail 路径被认作邮件包装', M.isOutlookMailWrapper('outlook.office.com', '/mail/inbox'));
  check('/calendar 路径不算邮件包装', M.decodeSafelink('https://outlook.office.com/calendar?url=https%3A%2F%2Fe.com').code, 'not-safelink');
}

console.log('--- 递归包装：层数与上限 ---');
{
  let deep = 'https://example.com/deep';
  for (const host of ['nam04', 'eur01', 'nam12']) {
    deep = buildSafeLink(deep, { host: `${host}.safelinks.protection.outlook.com` });
  }

  const nested = M.decodeSafelink(deep);
  check('三层嵌套：层数', nested.layers.length, 3);
  check('三层嵌套：最终目标', nested.target, 'https://example.com/deep');
  check('三层嵌套：未被截断', nested.truncated, false);
  check('三层嵌套：层级编号从 1 递增', nested.layers.map((l) => l.layer), [1, 2, 3]);
  check(
    '三层嵌套：出现两次嵌套提示',
    nested.warnings.filter((w) => w.code === 'nested-safelink').length,
    2,
  );
  check('三层嵌套：最外层主机记录正确', nested.host, 'nam12.safelinks.protection.outlook.com');

  let tooDeep = 'https://example.com/too-deep';
  for (let i = 0; i < 8; i += 1) tooDeep = buildSafeLink(tooDeep, { host: `nam0${i % 9}.safelinks.protection.outlook.com` });
  const limited = M.decodeSafelink(tooDeep);
  check('八层嵌套：被限制在上限层数', limited.layers.length, M.MAX_WRAPPER_LAYERS);
  check('八层嵌套：标记为截断', limited.truncated, true);
  check('八层嵌套：给出递归上限告警', limited.warnings.some((w) => w.code === 'recursion-limit'), true);
  checkTrue('八层嵌套：目标仍落在 SafeLink 域名上', M.isSafelinkHost(new URL(limited.target).hostname));
}

console.log('--- 边界与错误 ---');
{
  check('空输入', M.decodeSafelink('').code, 'empty');
  check('纯空白输入', M.decodeSafelink('   \n ').code, 'empty');
  check('超长输入被拒绝', M.decodeSafelink('x'.repeat(M.MAX_INPUT_LENGTH + 1)).code, 'too-long');
  checkTrue('恰好等于上限则不被长度规则拒绝', M.decodeSafelink('x'.repeat(M.MAX_INPUT_LENGTH)).code !== 'too-long');
  check('无法解析的文本', M.decodeSafelink('这不是一个链接').code, 'not-url');
  check('非 SafeLink 的普通 URL', M.decodeSafelink('https://example.org/?url=https%3A%2F%2Fe.com').code, 'not-safelink');
  check('缺少 url 参数', M.decodeSafelink(`https://${HOST}/?data=x&sdata=y&reserved=0`).code, 'missing-url');
  check('url 参数为空', M.decodeSafelink(`https://${HOST}/?url=&data=x`).code, 'empty-url');
  check('url 参数没有等号', M.decodeSafelink(`https://${HOST}/?url&data=x`).code, 'empty-url');
  check('空输入返回结构化的失败对象', Object.keys(M.decodeSafelink('')).sort(), ['code', 'error', 'ok', 'warnings']);

  const second = 'https://second.example/';
  const multi = M.decodeSafelink(
    `https://${HOST}/?url=${encodeURIComponent('https://first.example/')}&url=${encodeURIComponent(second)}&data=x`,
  );
  check('多个 url 参数：使用第一个', multi.target, 'https://first.example/');
  check('多个 url 参数：参数全部保留', multi.params.filter((p) => p.key === 'url').length, 2);
  check('多个 url 参数：给出告警', multi.warnings.some((w) => w.code === 'multiple-url-params'), true);

  const upper = `https://${HOST}/?URL=${encodeURIComponent('https://case.example/')}&Data=x&SDATA=y&Reserved=0`;
  const upperResult = M.decodeSafelink(upper);
  check('参数名大小写不敏感', upperResult.target, 'https://case.example/');
  check('参数名归一化为小写 key', upperResult.params.map((p) => p.key), ['url', 'data', 'sdata', 'reserved']);

  const relative = M.decodeSafelink(`https://${HOST}/?url=%2Ffoo%2Fbar&data=x`);
  check('目标不是绝对 URL 时如实提示', relative.target, '/foo/bar');
  check(
    '非绝对目标给出提醒而不是假装正常',
    relative.warnings.some((w) => w.code === 'target-not-absolute'),
    true,
  );
}

console.log('--- 非法百分号编码 ---');
{
  const bad = M.decodeSafelink(`https://${HOST}/?url=https%3A%2F%2Fex.com%2F%zz&data=x`);
  check('非法转义：仍然成功还原可读部分', bad.ok, true);
  check('非法转义：坏位置原样保留', bad.target, 'https://ex.com/%zz');
  check('非法转义：给出告警', bad.warnings.some((w) => w.code === 'malformed-percent'), true);
  check('非法转义：记录位置数', bad.layers[0].invalidEscapes.length, 1);

  const truncatedPercent = M.decodeSafelink(`https://${HOST}/?url=https%3A%2F%2Fex.com%2F%2&data=x`);
  check('截断的 %2：不崩溃且前缀已解码', truncatedPercent.target, 'https://ex.com/%2');

  const truncatedUtf8 = M.decodeSafelink(`https://${HOST}/?url=https%3A%2F%2Fex.com%2F%E4%B8&data=x`);
  checkTrue('截断的 UTF-8：可读前缀仍被解码', truncatedUtf8.target.startsWith('https://ex.com/'));
  check('截断的 UTF-8：给出告警', truncatedUtf8.warnings.some((w) => w.code === 'malformed-percent'), true);
}

console.log('--- 复制粘贴的包装字符 ---');
{
  const target = 'https://example.com/enveloped?x=1';
  const link = buildSafeLink(target);
  check('尖括号包裹', M.decodeSafelink(`<${link}>`).target, target);
  check('引号包裹', M.decodeSafelink(`"${link}"`).target, target);
  check('句末句点', M.decodeSafelink(`${link}.`).target, target);
  check('去掉包装字符时给出提示', M.decodeSafelink(`<${link}>`).warnings.some((w) => w.code === 'trimmed-envelope'), true);

  const escaped = link.replace(/&/g, '&amp;');
  const htmlResult = M.decodeSafelink(escaped);
  check('HTML 转义的 &amp; 被还原后再解析', htmlResult.ok ? htmlResult.target : htmlResult.error, target);
  check('HTML 转义给出提示', htmlResult.warnings.some((w) => w.code === 'html-escaped'), true);
}

console.log('--- 参数展示与含义 ---');
{
  const result = M.decodeSafelink(buildSafeLink('https://example.com/x'));
  const data = result.params.find((p) => p.key === 'data');
  check('data 解码为竖线分隔的字段串', data.formValue, '05|01|user@contoso.com|6e0bfede3fcb4518a16565dc14fe5620|0');
  check('data 字段拆分', M.splitDataFields(data.formValue), ['05', '01', 'user@contoso.com', '6e0bfede3fcb4518a16565dc14fe5620', '0']);
  check('data 空值拆分为空数组', M.splitDataFields(''), []);

  const sdata = result.params.find((p) => p.key === 'sdata');
  checkTrue('sdata 里的 %2B 被解码为字面加号', sdata.formValue.includes('+'));
  checkTrue('sdata 的说明写明“不验证”', /不验证/.test(M.explainParam('sdata').detail));
  check('sdata 未被标记为已文档化', M.explainParam('sdata').documented, false);
  checkTrue('url 的说明非空', M.explainParam('url').detail.length > 0);
  checkTrue('reserved 的说明非空', M.explainParam('reserved').detail.length > 0);
  check('未知参数如实标注为未文档化', M.explainParam('foo').documented, false);
  checkTrue('未知参数也有说明文字', M.explainParam('foo').detail.length > 0);
  check('还原结果始终声明未验证签名', result.signatureVerified, false);
}

console.log('--- 随机往返（确定性伪随机） ---');
{
  // Deterministic so a failure is reproducible.
  let seed = 20240917;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pool = [
    'a', 'Z', '0', '+', '%', '%2F', '%E4%B8%AD', '中', '文', '🎉', ' ', '&', '=', '?', '#', '/', '.', '-', '_', '~', ':',
  ];
  const junk = () => {
    let out = '';
    const length = 1 + Math.floor(random() * 6);
    for (let i = 0; i < length; i += 1) out += pool[Math.floor(random() * pool.length)];
    return out;
  };

  let plainFails = 0;
  let formFails = 0;
  let cases = 0;
  let withPlus = 0;
  let withPercent = 0;

  for (let i = 0; i < 200; i += 1) {
    const target = `https://fuzz.example/${junk()}?a=${junk()}&b=${junk()}#${junk()}`;
    cases += 1;
    if (target.includes('+')) withPlus += 1;
    if (target.includes('%')) withPercent += 1;

    const plain = M.decodeSafelink(buildSafeLink(target));
    if (!plain.ok || plain.target !== target) plainFails += 1;

    const form = M.decodeSafelink(buildSafeLink(target, { encodeFn: formEncode }));
    if (!form.ok || form.target !== target) formFails += 1;
  }

  check('200 个随机目标全部原样还原', plainFails, 0);
  check('同一批目标用表单编码也全部原样还原', formFails, 0);
  check('随机样本确实覆盖了 200 例', cases, 200);
  checkTrue('随机样本里确实出现过字面加号', withPlus > 0);
  checkTrue('随机样本里确实出现过字面百分号', withPercent > 0);
}

console.log('--- 明确不做：不发网络请求、不执行命令 ---');
{
  const componentSource = readFileSync('src/tools/safelink-decoder/SafelinkDecoderTool.tsx', 'utf8');
  const forbidden = [
    ['utils 不调用 fetch', /fetch\s*\(/],
    ['utils 不使用 XMLHttpRequest', /XMLHttpRequest/],
    ['utils 不使用 sendBeacon', /sendBeacon/],
    ['utils 不执行外部命令', /child_process|execSync|spawnSync/],
    ['utils 不读取浏览器地址栏', /location\s*\./],
    ['utils 不打开新窗口', /window\.open/],
  ];
  for (const [label, pattern] of forbidden) {
    check(label, pattern.test(source), false);
  }
  check('组件不打开任何 URL', /window\.open|location\.href|fetch\s*\(/.test(componentSource), false);
  checkTrue('组件确实引用了工具栏', componentSource.includes('SafelinkDecoderTool'));
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
if (failures.length) console.log('失败项：\n  ' + failures.join('\n  '));
process.exit(failed === 0 ? 0 : 1);
