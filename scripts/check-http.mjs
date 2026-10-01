/**
 * Checks the HTTP client helpers.
 *
 * The error-explanation path gets the most attention: a CORS rejection is
 * indistinguishable from a network failure in JavaScript, so the tool must
 * report possibilities rather than assert a cause. These tests pin that
 * behaviour so it cannot regress into a confident wrong answer.
 *
 * Usage: node scripts/check-http.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/http-client/httpUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/httpUtils.mjs', compiled);
const M = await import(pathToFileURL('.verify/httpUtils.mjs').href);

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

console.log('--- URL 构建 ---');
check('无参数时原样返回', M.buildUrl('https://a.com/x', []), 'https://a.com/x');
check(
  '追加以启用的参数',
  M.buildUrl('https://a.com/x', [M.makeRow('a', '1'), M.makeRow('b', '2')]),
  'https://a.com/x?a=1&b=2',
);
check(
  '忽略未启用的行',
  M.buildUrl('https://a.com/x', [
    { ...M.makeRow('a', '1'), enabled: false },
    M.makeRow('b', '2'),
  ]),
  'https://a.com/x?b=2',
);
check(
  '忽略空键',
  M.buildUrl('https://a.com/x', [M.makeRow('', '1'), M.makeRow('b', '2')]),
  'https://a.com/x?b=2',
);
check(
  '特殊字符被编码',
  M.buildUrl('https://a.com/x', [M.makeRow('q', 'a b&c=d')]),
  'https://a.com/x?q=a+b%26c%3Dd',
);
check(
  '保留原有查询串',
  M.buildUrl('https://a.com/x?z=0', [M.makeRow('a', '1')]),
  'https://a.com/x?z=0&a=1',
);
check('非绝对地址不改写', M.buildUrl('/relative', [M.makeRow('a', '1')]), '/relative');
check('空字符串地址安全', M.buildUrl('', [M.makeRow('a', '1')]), '');

console.log('--- 请求头解析 ---');
{
  const r = M.parseHeaderBlock('Content-Type: application/json\nX-Token: abc123\n');
  check('解析两行', r.headers.length, 2);
  check('键值正确', r.headers[0], { key: 'Content-Type', value: 'application/json' });
  check('无拒绝项', r.rejected.length, 0);
}
check(
  '跳过空行与注释',
  M.parseHeaderBlock('\n# 注释\n// 也跳过\nA: 1\n').headers.length,
  1,
);
check('缺冒号被拒绝', M.parseHeaderBlock('BadHeader').rejected.length, 1);
check(
  '缺冒号的说明可读',
  /冒号/.test(M.parseHeaderBlock('BadHeader').rejected[0].reason),
  true,
);
check('禁止的请求头被拒绝', M.parseHeaderBlock('Host: evil.com').rejected.length, 1);
check(
  '拒绝原因说明是浏览器限制',
  /浏览器禁止/.test(M.parseHeaderBlock('Cookie: a=1').rejected[0].reason),
  true,
);
check('禁止头大小写不敏感', M.parseHeaderBlock('COOKIE: a=1').rejected.length, 1);
check('值中的冒号保留', M.parseHeaderBlock('A: b:c:d').headers[0].value, 'b:c:d');
{
  const r = M.collectHeaders(
    [M.makeRow('X-A', '1'), { ...M.makeRow('X-B', '2'), enabled: false }],
    'X-C: 3',
  );
  check('合并表格与文本块', Object.keys(r.headers).sort(), ['X-A', 'X-C']);
}
{
  const r = M.collectHeaders([M.makeRow('Host', 'x')], '');
  check('表格中的禁止头也被拒绝', r.rejected.length, 1);
  check('并且没有进入最终请求头', r.headers.Host, undefined);
}
check(
  '禁止头清单包含关键项',
  ['host', 'cookie', 'content-length', 'origin'].every((h) =>
    M.FORBIDDEN_HEADERS.includes(h),
  ),
  true,
);
check(
  '响应侧隐藏头包含 set-cookie',
  M.HIDDEN_RESPONSE_HEADERS.includes('set-cookie'),
  true,
);

console.log('--- 请求体准备 ---');
{
  const r = M.prepareBody(
    { ...M.DEFAULT_REQUEST, method: 'POST', bodyMode: 'json', body: '{"a":1}' },
    [],
  );
  check('JSON 请求体被规范化', r.body, '{"a":1}');
  check('自动带 Content-Type', r.contentType, 'application/json');
}
{
  const r = M.prepareBody(
    { ...M.DEFAULT_REQUEST, method: 'POST', bodyMode: 'json', body: '{a:1}' },
    [],
  );
  check('非法 JSON 被拒绝', r.error !== null, true);
  check('拒绝时不发送请求体', r.body, undefined);
}
{
  // Re-stringifying normalises formatting so the server sees canonical JSON.
  const r = M.prepareBody(
    { ...M.DEFAULT_REQUEST, method: 'POST', bodyMode: 'json', body: '{ "a" : 1 }' },
    [],
  );
  check('重新序列化去掉多余空白', r.body, '{"a":1}');
}
{
  const r = M.prepareBody(
    { ...M.DEFAULT_REQUEST, method: 'POST', bodyMode: 'form' },
    [M.makeRow('a', '1'), M.makeRow('b', 'x y')],
  );
  check('表单被 URL 编码', r.body, 'a=1&b=x+y');
  check('表单带正确 Content-Type', r.contentType, 'application/x-www-form-urlencoded;charset=UTF-8');
}
{
  const r = M.prepareBody(
    { ...M.DEFAULT_REQUEST, method: 'GET', bodyMode: 'json', body: '{"a":1}' },
    [],
  );
  check('GET 带请求体被拒绝', r.error !== null, true);
}
{
  const r = M.prepareBody({ ...M.DEFAULT_REQUEST, method: 'GET', bodyMode: 'none' }, []);
  check('GET 无请求体正常', r.error, null);
}
{
  const r = M.prepareBody(
    { ...M.DEFAULT_REQUEST, method: 'POST', bodyMode: 'text', body: 'raw' },
    [],
  );
  check('纯文本请求体原样传递', r.body, 'raw');
  check('纯文本不自动设置 Content-Type', r.contentType, null);
}
{
  const r = M.prepareBody(
    { ...M.DEFAULT_REQUEST, method: 'POST', bodyMode: 'json', body: '   ' },
    [],
  );
  check('空白 JSON 体视为无请求体', r.body, undefined);
  check('空白 JSON 体不报错', r.error, null);
}

console.log('--- 错误解释（核心：不武断断言原因）---');
{
  const error = new TypeError('Failed to fetch');
  const explanation = M.explainError(error, { method: 'GET', url: 'https://x.com/a' });

  check('标题不武断归因', /未告知|无法确定|没有告知/.test(explanation.title), true);
  check('把 CORS 列为首要可能', /跨域|CORS|Access-Control/.test(explanation.causes[0]), true);
  check('列出多种可能原因', explanation.causes.length >= 4, true);
  check('包含 DNS 可能', explanation.causes.some((c) => /解析|域名/.test(c)), true);
  check('包含连接层可能', explanation.causes.some((c) => /拒绝连接|端口|证书/.test(c)), true);
  check('给出排查方法', explanation.howToCheck.length >= 2, true);
  check('建议查看开发者工具', explanation.howToCheck.some((h) => /Network|开发者工具/.test(h)), true);
  check('给出 curl 对照命令', explanation.howToCheck.some((h) => /curl/.test(h)), true);
  check('curl 命令带目标地址', explanation.howToCheck.some((h) => h.includes('https://x.com/a')), true);
  check('保留了浏览器原始信息', explanation.causes.some((c) => c.includes('Failed to fetch')), true);
  // The critical property: the original causes must survive the addition of the
  // browser message, not be replaced by it.
  check('追加浏览器信息不会覆盖原因列表', explanation.causes.length >= 5, true);
}
{
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  const explanation = M.explainError(abort, { method: 'GET', url: 'https://x.com' });
  check('中止被单独识别', /中止/.test(explanation.title), true);
  check('中止不列 CORS 原因', explanation.causes.some((c) => /跨域/.test(c)), false);
}
{
  const explanation = M.explainError('plain string', { method: 'POST', url: 'https://y.com' });
  check('非 Error 输入也能处理', explanation.causes.length >= 4, true);
  check('curl 命令使用正确方法', explanation.howToCheck.some((h) => h.includes('POST')), true);
}

console.log('--- 状态码分类 ---');
check('200 为成功', M.describeStatus(200).tone, 'success');
check('204 为成功', M.describeStatus(204).tone, 'success');
check('301 为重定向', M.describeStatus(301).tone, 'redirect');
check('404 为客户端错误', M.describeStatus(404).tone, 'client');
check('500 为服务端错误', M.describeStatus(500).tone, 'server');
check('0 单独说明', M.describeStatus(0).tone, 'unknown');
check('0 的说明提到 opaque', /opaque/.test(M.describeStatus(0).label), true);

console.log('--- 响应体美化 ---');
check('JSON 被缩进', M.prettyBody('{"a":1}', 'application/json'), '{\n  "a": 1\n}');
check(
  '按内容识别 JSON（即使 Content-Type 不对）',
  M.prettyBody('{"a":1}', 'text/plain'),
  '{\n  "a": 1\n}',
);
check('HTML 保持不变', M.prettyBody('<html>', 'text/html'), '<html>');
check('非法 JSON 原样返回', M.prettyBody('{oops}', 'application/json'), '{oops}');
check('空串安全', M.prettyBody('', 'application/json'), '');
check('数组也被美化', M.prettyBody('[1,2]', 'application/json'), '[\n  1,\n  2\n]');

console.log('--- 格式化 ---');
check('毫秒', M.formatMs(250), '250 ms');
check('秒', M.formatMs(1500), '1.50 s');
check('字节', M.formatSize(512), '512 B');
check('KB', M.formatSize(2048), '2.0 KB');

console.log('--- curl 生成 ---');
{
  const spec = {
    ...M.DEFAULT_REQUEST,
    method: 'POST',
    bodyMode: 'json',
    body: '{"a":1}',
    headers: [
      M.makeRow('Content-Type', 'application/json'),
      { ...M.makeRow('X-Skip', 'x'), enabled: false },
    ],
  };
  const curl = M.toCurl(spec, [], 'https://a.com/x');
  check('包含方法', curl.includes('-X POST'), true);
  check('包含地址', curl.includes('https://a.com/x'), true);
  check('包含启用的请求头', curl.includes("Content-Type: application/json"), true);
  check('不包含未启用的请求头', curl.includes('X-Skip'), false);
  check('包含请求体', curl.includes('--data-raw'), true);
  check('使用换行续行', curl.includes(' \\\n'), true);
}
{
  // A single quote in the body must be escaped or the command breaks.
  const spec = { ...M.DEFAULT_REQUEST, method: 'POST', bodyMode: 'text', body: "it's" };
  const curl = M.toCurl(spec, [], 'https://a.com');
  check('单引号被转义', curl.includes("'\\''"), true);
}

console.log('--- 预设可用性 ---');
check('预设非空', M.REQUEST_PRESETS.length >= 5, true);
check('每个预设都有地址', M.REQUEST_PRESETS.every((p) => p.spec.url), true);
check('预设都标注了说明', M.REQUEST_PRESETS.every((p) => p.note), true);
check('含 CORS 受限示例', M.REQUEST_PRESETS.some((p) => /CORS/.test(p.label)), true);
check('方法清单含常用方法', ['GET', 'POST', 'PUT', 'DELETE'].every((m) => M.METHODS.includes(m)), true);
check('默认超时为 15 秒', M.DEFAULT_REQUEST.timeoutMs, 15000);
check('默认不携带请求体', M.DEFAULT_REQUEST.bodyMode, 'none');

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
