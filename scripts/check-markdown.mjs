/**
 * Checks for the Markdown parser and its safety properties.
 *
 * The XSS defence here is architectural: token trees are rendered as React
 * elements, so no HTML string is ever parsed. That claim is asserted directly
 * by scanning the source for `dangerouslySetInnerHTML`.
 *
 * Usage: node scripts/check-markdown.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { globSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// Transpiled to a file (not a data: URL) because it imports `marked`.
const source = readFileSync(
  'src/tools/markdown-preview/markdownUtils.tsx',
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

mkdirSync('.verify', { recursive: true });
const modulePath = '.verify/markdownUtils.mjs';
writeFileSync(modulePath, compiled);

const M = await import(pathToFileURL(modulePath).href);

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

console.log('--- 架构层面的 XSS 防护 ---');
{
  // Walk the whole source tree: a single `dangerouslySetInnerHTML` would mean
  // raw HTML is being injected somewhere, which is the thing being avoided.
  const files = [];
  const walk = (dir) => {
    for (const entry of readFileSync ? [] : []) void entry;
  };
  void walk;
  void globSync;

  const { execSync } = require('node:child_process');
  // Match real prop usage (`dangerouslySetInnerHTML=`), not prose in comments —
  // this file's own doc comments mention the API by name.
  const hits = execSync(
    "grep -rn 'dangerouslySetInnerHTML *=' src/ || true",
    { encoding: 'utf8' },
  ).trim();

  check('源码中不存在 dangerouslySetInnerHTML 用法', hits, '');
  check(
    '渲染实现未使用 innerHTML 赋值',
    execSync("grep -rn 'innerHTML *=' src/ || true", { encoding: 'utf8' }).trim(),
    '',
  );
}

console.log('--- 链接协议白名单 ---');
check('https 允许', M.checkLink('https://example.com').ok, true);
check('http 允许', M.checkLink('http://example.com').ok, true);
check('mailto 允许', M.checkLink('mailto:a@b.com').ok, true);
check('tel 允许', M.checkLink('tel:+8613800138000').ok, true);
check('相对路径允许', M.checkLink('/docs/a').ok, true);
check('锚点允许', M.checkLink('#section').ok, true);
check('查询串允许', M.checkLink('?a=1').ok, true);
check('协议相对地址转 https', M.checkLink('//example.com/a').href, 'https://example.com/a');
check('javascript: 被拒', M.checkLink('javascript:alert(1)').ok, false);
check('JaVaScRiPt: 大小写混写被拒', M.checkLink('JaVaScRiPt:alert(1)').ok, false);
check('带空白的 javascript: 被拒', M.checkLink('  javascript:alert(1)').ok, false);
check('data: 被拒', M.checkLink('data:text/html,<script>alert(1)</script>').ok, false);
check('vbscript: 被拒', M.checkLink('vbscript:msgbox').ok, false);
check('file: 被拒', M.checkLink('file:///etc/passwd').ok, false);
check('空链接被拒', M.checkLink('   ').ok, false);
check('拒绝时给出原因', typeof M.checkLink('javascript:1').reason, 'string');

console.log('--- 解析与结构 ---');
{
  const parsed = M.parseMarkdown('# 标题一\n\n## 标题二\n\n正文');
  check('标题数量', parsed.headings.length, 2);
  check('标题层级', parsed.headings.map((h) => h.depth), [1, 2]);
  check('标题文本', parsed.headings.map((h) => h.text), ['标题一', '标题二']);
  check('标题 id 稳定', parsed.headings[0].id, '标题一');
  check('无解析错误', parsed.error, null);
}
{
  const parsed = M.parseMarkdown('# 重复\n\n# 重复');
  check('重复标题 id 唯一', new Set(parsed.headings.map((h) => h.id)).size, 2);
  check('第二个重复标题加后缀', parsed.headings[1].id, '重复-1');
}
{
  const parsed = M.parseMarkdown('- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |');
  const types = parsed.tokens.filter((t) => t.type !== 'space').map((t) => t.type);
  check('识别列表与表格', types, ['list', 'table']);
}
check('基础解析无错误', M.parseMarkdown('# t\n\ntext').error, null);
check('slugify 空格转连字符', M.slugify('Hello World'), 'hello-world');
check('slugify 去标点', M.slugify('a, b! c?'), 'a-b-c');
check('slugify 保留中文', M.slugify('中文标题'), '中文标题');
check('slugify 空串有兜底', M.slugify('!!!'), 'section');

console.log('--- 危险内容只作为 token 存在 ---');
{
  const parsed = M.parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">');
  const raw = parsed.tokens
    .map((t) => ('raw' in t ? t.raw : ''))
    .join('\n');
  check('原始 HTML 存在于 token 中', raw.includes('<script>'), true);
  // Token presence is expected; safety comes from never stringifying them into
  // innerHTML, which the source scan above asserts.
  check('token 类型为 html', parsed.tokens.some((t) => t.type === 'html'), true);
}
{
  const parsed = M.parseMarkdown('[点我](javascript:alert(1))');
  const link = parsed.tokens
    .flatMap((t) => ('tokens' in t && Array.isArray(t.tokens) ? t.tokens : []))
    .find((t) => t.type === 'link');
  check('javascript: 链接被解析出来', Boolean(link), true);
  check('该链接会被渲染层拒绝', M.checkLink(link.href).ok, false);
}
{
  const parsed = M.parseMarkdown('![图](javascript:alert(1))');
  const image = parsed.tokens
    .flatMap((t) => ('tokens' in t && Array.isArray(t.tokens) ? t.tokens : []))
    .find((t) => t.type === 'image');
  check('图片用 javascript: 同样被拒', image ? M.checkLink(image.href).ok : 'no-image', false);
}
{
  const parsed = M.parseMarkdown('[安全](https://wheat.chat)');
  const link = parsed.tokens
    .flatMap((t) => ('tokens' in t && Array.isArray(t.tokens) ? t.tokens : []))
    .find((t) => t.type === 'link');
  check('正常链接被允许', M.checkLink(link.href).ok, true);
}

console.log('--- 样例文档 ---');
check('示例文档可解析', M.parseMarkdown(M.SAMPLE_MARKDOWN).error, null);
check('示例含多个标题', M.parseMarkdown(M.SAMPLE_MARKDOWN).headings.length >= 5, true);
check('注入样例可解析', M.parseMarkdown(M.XSS_SAMPLE).error, null);

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
