/**
 * Checks the Markdown to HTML tool.
 *
 * The tool's claim is that it emits **HTML source** whose every character went
 * through an escaping function, so nothing in the Markdown can become an
 * executable tag, an event-handler attribute or a `javascript:` URL. Three
 * independent things back that up:
 *
 *   1. **`marked.parse`** — the one-liner this tool deliberately does not use —
 *      is run on the same inputs and the assertions are re-run against its
 *      output. It must fail them, which is the proof that the assertions have
 *      discriminating power rather than merely passing.
 *   2. **CPython `html.parser`** reads the generated string back and hands over
 *      the tree a browser would build: the tag nesting, the text, and the
 *      attribute values *after* character-reference decoding. That last part is
 *      what turns `&#106;avascript:` into a checkable fact instead of a hope,
 *      because HTML decodes references exactly once.
 *   3. Exact-string assertions pin the serialisation itself, so a change in the
 *      markup cannot hide behind a tree comparison that ignores it.
 *
 * The tool is deliberately *not* a preview: `markdown-preview` renders React
 * nodes and cannot be copied anywhere. This one produces a string, which is
 * exactly why escaping is its own responsibility.
 *
 * Usage: node scripts/check-markdown-html.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { marked } from 'marked';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync('src/tools/markdown-html/markdownHtmlUtils.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/markdown-html.mjs', compiled);
const M = await import(pathToFileURL('.verify/markdown-html.mjs').href);

let passed = 0;
let failed = 0;
let skipped = 0;

function report(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n${detail}`}`);
}

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  report(a === e, label, `        got      ${a}\n        expected ${e}`);
}

function checkTrue(label, actual) {
  report(actual === true, label, `        got      ${JSON.stringify(actual)}\n        expected true`);
}

function checkFalse(label, actual) {
  report(actual === false, label, `        got      ${JSON.stringify(actual)}\n        expected false`);
}

function checkContains(label, actual, needle) {
  const ok = typeof actual === 'string' && actual.includes(needle);
  report(
    ok,
    label,
    `        got      ${JSON.stringify(actual)}\n        expected to contain ${JSON.stringify(needle)}`,
  );
}

function checkNotContains(label, actual, needle) {
  const ok = typeof actual === 'string' && !actual.includes(needle);
  report(
    ok,
    label,
    `        got      ${JSON.stringify(actual)}\n        expected NOT to contain ${JSON.stringify(needle)}`,
  );
}

function skip(label) {
  skipped += 1;
  console.log(`SKIP  ${label}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/** Render with the defaults every security assertion is made about. */
const render = (source, options = {}) => M.renderMarkdownToHtml(source, options).html;

/* ------------------------------------------------------------------ *
 * The CPython oracle
 * ------------------------------------------------------------------ */

const PY_READ = `
import sys, json
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"}

class Reader(HTMLParser):
    """Builds the tree a browser would build, with charrefs decoded once.

    convert_charrefs=True is the point: attribute values are handed back after
    exactly one decoding pass, which is how "&amp;#106;avascript:" is proven not
    to be "javascript:" rather than assumed not to be.
    """
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "#document", "attrs": [], "text": "", "children": []}
        self.stack = [self.root]
        self.errors = []
        self.runs = []

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": attrs, "text": "", "children": []}
        self.stack[-1]["children"].append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1]["children"].append(
            {"tag": tag, "attrs": attrs, "text": "", "children": []})

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                if index != len(self.stack) - 1:
                    self.errors.append("misnested </%s>" % tag)
                del self.stack[index:]
                return
        self.errors.append("unmatched </%s>" % tag)

    def handle_data(self, data):
        self.stack[-1]["text"] += data
        self.runs.append(data)

documents = json.load(sys.stdin)
results = []
for document in documents:
    reader = Reader()
    try:
        reader.feed(document)
        reader.close()
    except Exception as exc:
        results.append({"fatal": str(exc)})
        continue
    results.append({"errors": reader.errors,
                    "unclosed": [node["tag"] for node in reader.stack[1:]],
                    "runs": reader.runs,
                    "root": reader.root})
print(json.dumps(results, ensure_ascii=False))
`;

const pythonAvailable =
  spawnSync('python3', ['-c', 'from html.parser import HTMLParser'], { encoding: 'utf8' }).status === 0;

if (!pythonAvailable) {
  console.log('注意：python3 或 html.parser 不可用，跳过解析回读部分\n');
}

function pythonRead(documents) {
  const out = execFileSync('python3', ['-c', PY_READ], {
    input: Buffer.from(JSON.stringify(documents), 'utf8'),
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function flatten(node, out = []) {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

function tagsOf(root) {
  return flatten(root)
    .filter((node) => node.tag !== '#document')
    .map((node) => node.tag);
}

function attrsOf(root) {
  return flatten(root).flatMap((node) => node.attrs);
}

function nodesNamed(root, tag) {
  return flatten(root).filter((node) => node.tag === tag);
}

function textOf(root) {
  return flatten(root)
    .filter((node) => node.tag !== '#document')
    .map((node) => node.text)
    .join('');
}

/** Every text run of a document, in document order, concatenated. */
function orderedText(entry) {
  return entry.runs.join('');
}

/**
 * Everything a pasted HTML string must not contain.
 *
 * Schemes are re-checked after stripping the ASCII control characters and
 * spaces a browser removes while parsing a URL, so `java&#9;script:` counts as
 * `javascript:` even though the raw text does not.
 *
 * `meta` and `link` are deliberately absent: full-document mode emits them on
 * purpose and neither can run script by itself.
 */
const EXECUTABLE_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form'];

function securityScan(root) {
  const findings = [];
  for (const node of flatten(root)) {
    const tag = node.tag.toLowerCase();
    if (tag !== '#document' && EXECUTABLE_TAGS.includes(tag)) findings.push(`可执行/可嵌入标签 <${tag}>`);
    for (const [name, value] of node.attrs) {
      if (name.toLowerCase().startsWith('on')) findings.push(`事件属性 ${name}`);
      const probe = String(value).replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
      if (/^(javascript|data|vbscript|file):/.test(probe)) {
        findings.push(`危险协议 ${name}="${value}"`);
      }
    }
  }
  return [...new Set(findings)];
}

/* ------------------------------------------------------------------ *
 * The naive baseline, kept as the counter-example
 * ------------------------------------------------------------------ */

/**
 * "Just call `marked.parse`."
 *
 * This is the implementation the tool would have had by default, and the
 * counter-example every security assertion below is validated against: raw HTML
 * passes through verbatim and a `javascript:` href is left in place
 * (`encodeURI` does not remove a scheme).
 */
const naive = (source) => marked.parse(source, { gfm: true });

/* ------------------------------------------------------------------ *
 * 1. Exact output
 * ------------------------------------------------------------------ */

section('基本转换：精确输出');

check('一级标题带锚点 id', render('# 标题'), '<h1 id="标题">标题</h1>');
check(
  '行内格式',
  render('**粗** *斜* ~~删~~ `code` [x](https://a.b)'),
  '<p><strong>粗</strong> <em>斜</em> <del>删</del> <code>code</code> <a href="https://a.b">x</a></p>',
);
check(
  '无序列表与嵌套有序列表',
  render('- a\n- b\n  1. c\n'),
  '<ul>\n<li>a</li>\n<li>b\n<ol>\n<li>c</li>\n</ol></li>\n</ul>',
);
check(
  '任务列表',
  render('- [x] done\n- [ ] todo\n'),
  '<ul class="task-list">\n<li><input type="checkbox" disabled checked> done</li>\n<li><input type="checkbox" disabled> todo</li>\n</ul>',
);
check(
  '表格与列对齐',
  render('| a | b |\n| :- | -: |\n| 1 | 2 |\n'),
  '<table>\n<thead>\n<tr><th style="text-align: left">a</th><th style="text-align: right">b</th></tr>\n</thead>\n<tbody>\n<tr><td style="text-align: left">1</td><td style="text-align: right">2</td></tr>\n</tbody>\n</table>',
);
check('有序列表保留起始序号', render('3. a\n4. b\n'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
check('分隔线', render('a\n\n---\n\nb'), '<p>a</p>\n<hr>\n<p>b</p>');
check('围栏代码块带语言类名', render('```ts title=x\nlet a=1;\n```\n'), '<pre><code class="language-ts">let a=1;</code></pre>');
check('行内代码转义 & 而不解码', render('`<b>&amp;</b>`'), '<p><code>&lt;b&gt;&amp;amp;&lt;/b&gt;</code></p>');
check('图片', render('![alt *x*](https://a.b/i.png "t")'), '<p><img src="https://a.b/i.png" alt="alt x" title="t"></p>');
check('引用块', render('> quote **b**\n> more\n'), '<blockquote>\n<p>quote <strong>b</strong>\nmore</p>\n</blockquote>');
check('Setext 标题', render('Title\n=====\n'), '<h1 id="title">Title</h1>');
check('转义的反斜杠', render('\\*not em\\*'), '<p>*not em*</p>');
check('空输入产出空字符串', render(''), '');
check('纯空白输入产出空字符串', render('   \n\n  '), '');
check('协议相对地址被固定到 https', render('[x](//evil.com/a)'), '<p><a href="https://evil.com/a">x</a></p>');
check('自动链接', render('<https://a.b>'), '<p><a href="https://a.b">https://a.b</a></p>');
check('邮箱自动链接走 mailto', render('<a@b.c>'), '<p><a href="mailto:a@b.c">a@b.c</a></p>');
check('文本里的引号不需要转义', render('he said "hi"'), '<p>he said "hi"</p>');
check(
  'Tailwind 模式加类名（顺序：类名在前，id 在后）',
  render('# A', { style: 'tailwind' }),
  '<h1 class="text-3xl font-bold mt-8 mb-4" id="a">A</h1>',
);

section('压缩输出');
check('块之间不留换行', render('# A\n\npara one\n\npara two\n', { minify: true }), '<h1 id="a">A</h1><p>para one</p><p>para two</p>');
check('压缩不碰 pre 里的换行（那是内容）', render('```\n1\n2\n```', { minify: true }), '<pre><code>1\n2</code></pre>');
check('压缩后的列表', render('- a\n- b\n', { minify: true }), '<ul><li>a</li><li>b</li></ul>');
check('压缩后的表格', render('| a |\n| - |\n| 1 |\n', { minify: true }), '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');

section('单换行选项');
check('默认单个换行是空格（原样输出换行）', render('a\nb'), '<p>a\nb</p>');
check('打开后变成 <br>', render('a\nb', { breaks: true }), '<p>a<br>b</p>');

section('完整文档模式');
check(
  '默认语言与从一级标题取标题',
  render('# 标题\n\n正文', { document: true }),
  '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>标题</title>\n</head>\n<body>\n<main class="markdown-body">\n<h1 id="标题">标题</h1>\n<p>正文</p>\n</main>\n</body>\n</html>',
);
check(
  '标题与语言可覆盖，且标题按文本转义',
  render('# T\n', { document: true, title: 'X & Y <z>', lang: 'en-US' }),
  '<!DOCTYPE html>\n<html lang="en-US">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>X &amp; Y &lt;z&gt;</title>\n</head>\n<body>\n<main class="markdown-body">\n<h1 id="t">T</h1>\n</main>\n</body>\n</html>',
);
checkContains('没有一级标题时标题回退为 Markdown', render('正文', { document: true }), '<title>Markdown</title>');
checkContains('内嵌样式表只在 embedded 模式出现', render('# A', { style: 'embedded' }), '<style>');
checkNotContains('默认不注入样式表', render('# A'), '<style');
checkNotContains('tailwind 模式不注入 CDN 脚本', render('# A', { style: 'tailwind' }), '<script');

/* ------------------------------------------------------------------ *
 * 2. Security
 * ------------------------------------------------------------------ */

section('安全：默认模式下原始 HTML 被转义');

const RAW_HTML_CASES = [
  { label: 'script 标签', source: "<script>alert('xss')</script>" },
  { label: 'script 带属性', source: '<script src=//evil.com/x.js></script>' },
  { label: 'img onerror', source: '<img src=x onerror="alert(1)">' },
  { label: 'svg onload', source: '<svg onload="alert(1)"></svg>' },
  { label: 'iframe', source: '<iframe src="javascript:alert(1)"></iframe>' },
  { label: 'style 标签', source: '<style>body{background:url(javascript:alert(1))}</style>' },
  { label: 'object 标签', source: '<object data="x"></object>' },
  { label: '行内 span', source: 'a <span>s</span> b' },
  { label: '未闭合的 div', source: '<div class="x">' },
  { label: '注释里的条件注释', source: '<!--[if IE]><script>alert(1)</script><![endif]-->' },
];
{
  const outputs = RAW_HTML_CASES.map((item) => render(item.source));
  const withTags = RAW_HTML_CASES.map((item, index) => (outputs[index].includes('<script') ? item.label : null)).filter(Boolean);
  check('默认输出里没有一个是真正的 <script 标签', withTags, []);
  check(
    '原始 HTML 被转义成实体',
    RAW_HTML_CASES.map((item, index) => (outputs[index].includes('&lt;') ? null : item.label)).filter(Boolean),
    [],
  );
  check(
    '每个原始 HTML 片段都会产生一条「已转义」提示',
    M.renderMarkdownToHtml('<script>a</script>').warnings.length,
    1,
  );
  checkContains('提示说明不会执行', M.renderMarkdownToHtml('<script>a</script>').warnings[0], '不会执行');
  check('没有原始 HTML 时没有提示', M.renderMarkdownToHtml('# A').warnings, []);
  check(
    '转义后的 script 以实体形式留在文本里',
    render("<script>alert('xss')</script>"),
    "<p>&lt;script&gt;alert('xss')&lt;/script&gt;</p>",
  );
  check(
    '带属性的 img 整体变成文本（文本节点里引号不必转义）',
    render('<img src=x onerror="alert(1)">'),
    '<p>&lt;img src=x onerror="alert(1)"&gt;</p>',
  );
}

section('安全：危险协议被拦掉');
const BAD_SCHEMES = [
  { label: 'javascript:', source: '[x](javascript:alert(1))' },
  { label: '大写 JAVASCRIPT:', source: '[x](JAVASCRIPT:alert(1))' },
  { label: '混合大小写 JaVaScRiPt:', source: '[x](JaVaScRiPt:alert(1))' },
  { label: 'data: 文本 HTML', source: '[x](data:text/html,<script>alert(1)</script>)' },
  { label: 'data: 图片', source: '![a](data:image/svg+xml;base64,PHN2Zz4=)' },
  { label: 'vbscript:', source: '[x](vbscript:msgbox(1))' },
  { label: 'file:', source: '[x](file:///etc/passwd)' },
  { label: '制表符拆开的协议', source: '[x](<java\tscript:alert(1)>)' },
  { label: '前导空格', source: '[x]( javascript:alert(1))' },
  { label: '引用式链接里的 javascript:', source: '[x][r]\n\n[r]: javascript:alert(1)\n' },
  { label: '自动链接里的 javascript:', source: '<javascript:alert(1)>' },
  { label: '空地址', source: '[x]()' },
];
{
  const results = BAD_SCHEMES.map((item) => M.renderMarkdownToHtml(item.source));
  check(
    '全部被拦截（输出里出现 markdown-link-blocked / markdown-image-blocked）',
    BAD_SCHEMES.map((item, index) =>
      /markdown-(link|image)-blocked/.test(results[index].html) ? null : item.label,
    ).filter(Boolean),
    [],
  );
  check(
    '被拦掉的地址不会作为 URL 出现（连 href / src 都没有）',
    BAD_SCHEMES.map((item, index) =>
      /(href|src)\s*=/i.test(results[index].html) ? item.label : null,
    ).filter(Boolean),
    [],
  );
  if (pythonAvailable) {
    const parsed = pythonRead(results.map((result) => result.html));
    // The blocked label is rendered as visible text, so `javascript:` may still
    // appear between tags; what matters is that it never reaches an attribute.
    check(
      '独立解析器在这些输出里找不到任何危险协议属性或事件属性',
      parsed.flatMap((entry) => securityScan(entry.root)),
      [],
    );
    check(
      '自动链接那条会把攻击串显示成文字（只有阻断说明用的 class，没有 a 元素）',
      [nodesNamed(parsed[10].root, 'a').length, attrsOf(parsed[10].root)],
      [0, [['class', 'markdown-link-blocked']]],
    );
  } else {
    skip('危险协议的属性级验证（python3 不可用）');
  }
  check(
    '每一种都带一条说明原因的警告',
    BAD_SCHEMES.map((item, index) => (results[index].warnings.length > 0 ? null : item.label)).filter(Boolean),
    [],
  );
  checkContains('警告里写出被拒的协议', results[0].warnings[0], 'javascript:');
  checkContains('空地址得到专门的说明', results[results.length - 1].warnings[0], '空链接');
  check('图片被拦时不留 src', render('![a](javascript:alert(1))'), '<p><span class="markdown-image-blocked">a</span></p>');
}

section('安全：字符引用不会在解码后变成协议');
{
  const entity = M.renderMarkdownToHtml('[x](&#106;avascript:alert(1))');
  check(
    '& 被转义，浏览器拿到的仍然是一个实体而不是 javascript:',
    entity.html,
    '<p><a href="&amp;#106;avascript:alert(1)">x</a></p>',
  );
  check('这一条不会被当作「危险协议」拦掉（它确实是相对地址）', entity.warnings, []);
  check(
    '本工具自己的检查函数也认可它（判断的是转义后要写进 HTML 的字符串）',
    M.checkHref('&#106;avascript:alert(1)').ok,
    true,
  );

  if (pythonAvailable) {
    const [parsed] = pythonRead([entity.html]);
    const href = attrsOf(parsed.root).find(([name]) => name === 'href');
    check('把输出交给 HTML 解析器：href 只解码一次，仍是实体', href[1], '&#106;avascript:alert(1)');
    checkFalse('解码后的值不是 javascript: 协议', /^\s*javascript:/i.test(href[1]));
    check(
      '对照：朴素实现输出里的 href 解码后就是 javascript:',
      /^\s*javascript:/i.test(attrsOf(pythonRead([naive('[x](&#106;avascript:alert(1))')])[0].root).find(([name]) => name === 'href')[1]),
      true,
    );
  } else {
    skip('字符引用的解码回读（python3 不可用）');
  }
}

section('安全：属性位置的转义（链接 title / 图片 alt 与 title）');
{
  // The mistake this section exists to catch: escaping a value as if it were a
  // text node when it actually lands inside a double-quoted attribute. `<`, `>`
  // and `&` are not enough there — a single quote character closes the value and
  // whatever follows becomes attributes of its own. This tool did exactly that
  // for `title` and `alt` until the assertions below were written.
  const escapeTextOnly = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const HOSTILE_TITLE = 'a" onmouseover="alert(1)';
  const HOSTILE_ALT = 'x" onerror="alert(1)';
  const naiveMarkup =
    `<p><a href="https://a.b" title="${escapeTextOnly(HOSTILE_TITLE)}">x</a>` +
    `<img src="https://a.b/i.png" alt="${escapeTextOnly(HOSTILE_ALT)}"></p>`;

  const INJECTIONS = [
    { label: '链接 title 里的双引号', source: '[x](https://a.b "a\\" onmouseover=\\"alert(1)")' },
    { label: '图片 title 里的双引号', source: '![a](https://a.b/i.png "t\\" onerror=\\"alert(1)")' },
    { label: '图片 alt 里的双引号', source: '![x" onerror="alert(1)](https://a.b/i.png)' },
    { label: '图片 alt 里的双引号与尾巴', source: '![x" onerror="alert(1)" y="](https://a.b/i.png)' },
  ];
  const ours = INJECTIONS.map((item) => render(item.source));

  check('链接 title 里的引号被转义成 &quot;', ours[0].includes('title="a&quot; onmouseover=&quot;alert(1)"'), true);
  check('图片 title 里的引号被转义成 &quot;', ours[1].includes('title="t&quot; onerror=&quot;alert(1)"'), true);
  check('图片 alt 里的引号被转义成 &quot;', ours[2].includes('alt="x&quot; onerror=&quot;alert(1)"'), true);
  check('alt 里连引号带尾巴也被完整转义', ours[3].includes('alt="x&quot; onerror=&quot;alert(1)&quot; y=&quot;"'), true);
  check(
    '四个输出里都没有裸的 on* 属性写法（引号都被转义了）',
    INJECTIONS.map((item, index) => /\son[a-z]+\s*=\s*"/i.test(ours[index])).filter(Boolean),
    [],
  );

  if (pythonAvailable) {
    const parsedOurs = pythonRead(ours);
    const parsedNaive = pythonRead([naiveMarkup]);
    check(
      '独立解析器在本工具的输出里读到的属性名',
      parsedOurs.map((entry) => attrsOf(entry.root).map(([name]) => name)),
      [
        ['href', 'title'],
        ['src', 'alt', 'title'],
        ['src', 'alt'],
        ['src', 'alt'],
      ],
    );
    check(
      '独立解析器在本工具的输出里看不到任何事件属性',
      parsedOurs.flatMap((entry) => securityScan(entry.root)),
      [],
    );
    check(
      '同样的断言对「只转义文本」的写法会失败（证明有分辨力）',
      securityScan(parsedNaive[0].root).length > 0,
      true,
    );
    check(
      '只转义文本时会多出两个事件属性',
      attrsOf(parsedNaive[0].root)
        .map(([name]) => name)
        .filter((name) => name.startsWith('on')),
      ['onmouseover', 'onerror'],
    );
    const link = nodesNamed(parsedOurs[0].root, 'a')[0];
    check('链接 title 解码后就是原文那段文字，没有劈出第二个属性', link.attrs.find(([name]) => name === 'title')[1], HOSTILE_TITLE);
    check('链接上只有 href 与 title 两个属性', link.attrs.length, 2);
    const image = nodesNamed(parsedOurs[2].root, 'img')[0];
    check('图片 alt 解码后就是原文那段文字', image.attrs.find(([name]) => name === 'alt')[1], HOSTILE_ALT);
    check('图片上只有 src 与 alt 两个属性', image.attrs.length, 2);
  } else {
    skip('属性注入的解析器验证（python3 不可用）');
  }
}

section('安全：反证 —— 朴素实现真的会产出可执行内容');
{
  const VECTORS = [
    { label: 'script 标签', source: "<script>alert('xss')</script>", kind: 'tag' },
    { label: 'img onerror', source: '<img src=x onerror="alert(1)">', kind: 'tag' },
    { label: 'svg onload', source: '<svg onload="alert(1)"></svg>', kind: 'tag' },
    { label: 'javascript: 链接', source: '[x](javascript:alert(1))', kind: 'scheme' },
    { label: 'data: 链接', source: '[x](data:text/html,<script>alert(1)</script>)', kind: 'scheme' },
    { label: 'data: 图片', source: '![a](data:image/svg+xml;base64,PHN2Zz4=)', kind: 'scheme' },
    { label: 'vbscript: 链接', source: '[x](vbscript:msgbox(1))', kind: 'scheme' },
    { label: 'iframe 里的 javascript:', source: '<iframe src="javascript:alert(1)"></iframe>', kind: 'tag' },
  ];
  const naiveOutputs = VECTORS.map((item) => naive(item.source));
  const ourOutputs = VECTORS.map((item) => render(item.source));

  // The naive output must contain the raw, executable form: for the tag
  // vectors that is an actual element, for the scheme vectors a real protocol.
  check(
    '朴素实现原样输出了可执行标签或协议',
    VECTORS.map((item, index) =>
      item.kind === 'tag'
        ? /<\s*(script|img|svg|iframe)\b/i.test(naiveOutputs[index]) &&
          (/on[a-z]+\s*=/i.test(naiveOutputs[index]) ||
            /<\s*script/i.test(naiveOutputs[index]) ||
            /(javascript:|data:|vbscript:)/i.test(naiveOutputs[index]))
        : /(javascript:|data:|vbscript:)/i.test(naiveOutputs[index]),
    ),
    VECTORS.map(() => true),
  );

  if (pythonAvailable) {
    const parsedNaive = pythonRead(naiveOutputs);
    const parsedOurs = pythonRead(ourOutputs);
    const naiveFindings = parsedNaive.map((entry) => securityScan(entry.root));
    check(
      'HTML 解析器在朴素输出里找到了可执行的东西（逐个列出）',
      naiveFindings.map((findings) => findings.length > 0),
      VECTORS.map(() => true),
    );
    check(
      '同样的输入，本工具的输出里一个可执行的东西都没有',
      parsedOurs.flatMap((entry) => securityScan(entry.root)),
      [],
    );
    check(
      '朴素实现里的 script 是真正的 <script> 元素',
      nodesNamed(parsedNaive[0].root, 'script').length,
      1,
    );
    check('朴素实现里的 img 带着 onerror 属性', attrsOf(parsedNaive[1].root).some(([name]) => name === 'onerror'), true);
    check(
      '朴素实现里的 href 就是 javascript:',
      attrsOf(parsedNaive[3].root).find(([name]) => name === 'href')[1].startsWith('javascript:'),
      true,
    );
  } else {
    skip('反证的解析器验证（python3 不可用）');
  }
}

section('安全：危险开关打开后确实不再防护（反过来说明默认转义是关键）');
{
  const opened = M.renderMarkdownToHtml("<script>alert(1)</script>", { allowHtml: true });
  checkContains('打开后 script 原样出现在输出里', opened.html, '<script>alert(1)</script>');
  checkTrue('并且给出两条警告', opened.warnings.length >= 2);
  checkTrue(
    '其中一条说明不再提供防护',
    opened.warnings.some((warning) => warning.includes('不再提供任何 XSS 防护')),
  );
  check(
    '对照：默认模式下同样的输入被完全转义',
    render("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
}

section('安全：地址判定函数本身');
{
  const OK = ['http://a.b', 'https://a.b/x?y=1', 'mailto:a@b.c', 'tel:+8610', '/abs', './rel', '../up', '#frag', '?q=1', '//a.b/x'];
  check(
    '允许清单',
    OK.map((href) => M.checkHref(href).ok),
    OK.map(() => true),
  );
  check('协议相对地址补上 https', M.checkHref('//a.b/x').href, 'https://a.b/x');
  const BAD = ['javascript:alert(1)', 'JAVASCRIPT:x', 'data:text/html,x', 'vbscript:x', 'file:///x', 'java\tscript:x', 'java\nscript:x', '\u0000javascript:x', ' javascript:x ', 'java script:x'];
  check(
    '拒绝清单',
    BAD.map((href) => M.checkHref(href).ok),
    BAD.map(() => false),
  );
  check('空字符串被拒绝', M.checkHref('   ').ok, false);
  check('拒绝时给出原因', M.checkHref('javascript:x').reason, '不允许的协议 javascript:');
  check('大小写归一后再比对协议', M.checkHref('HTTPS://A.B').ok, true);
}

/* ------------------------------------------------------------------ *
 * 3. Read-back with an independent HTML parser
 * ------------------------------------------------------------------ */

section('用 CPython html.parser 回读：结构与文本');

const STRUCTURE_DOCS = [
  { label: '标题与段落', source: '# 标题\n\n正文' },
  { label: '行内格式', source: '**粗** *斜* ~~删~~ `code`' },
  { label: '嵌套列表', source: '- a\n  - b\n    - c\n' },
  { label: '任务列表', source: '- [x] done\n- [ ] todo' },
  { label: '表格', source: '| a | b |\n| :- | -: |\n| 1 | 2 |' },
  { label: '引用块里的标题', source: '> # Q\n>\n> 内容' },
  { label: '代码块里的标签是文本', source: '```\n<script>alert(1)</script>\n```' },
  { label: '链接与图片', source: '[x](https://a.b) ![i](https://a.b/i.png)' },
  { label: '完整文档', source: '# T\n\n正文', options: { document: true } },
  { label: '目录 + 正文', source: '# A\n\n## B\n\n### C\n', options: { toc: true } },
  { label: 'Unicode 与 emoji', source: '# 🚀 中文\n\n**粗体** 与 emoji 🎯' },
  { label: '原始 HTML 样例', source: M.XSS_SAMPLE },
  { label: '内置示例', source: M.SAMPLE_MARKDOWN },
];

if (pythonAvailable) {
  const outputs = STRUCTURE_DOCS.map((item) => render(item.source, item.options));
  const parsed = pythonRead(outputs);

  check(
    '每个输出都能被独立解析器读完，且没有致命错误',
    parsed.map((entry, index) => (entry.fatal || entry.errors.length > 0 ? STRUCTURE_DOCS[index].label : null)).filter(Boolean),
    [],
  );
  check(
    '每个输出的标签都正确闭合',
    parsed.map((entry, index) => (entry.unclosed.length > 0 ? `${STRUCTURE_DOCS[index].label} ${entry.unclosed}` : null)).filter(Boolean),
    [],
  );
  check(
    '默认模式下的每一个输出都不含可执行标签、事件属性或危险协议',
    parsed.flatMap((entry) => securityScan(entry.root)),
    [],
  );

  const byLabel = Object.fromEntries(STRUCTURE_DOCS.map((item, index) => [item.label, parsed[index].root]));

  check('标题渲染成 h1', tagsOf(byLabel['标题与段落']), ['h1', 'p']);
  check('行内标签的嵌套顺序', tagsOf(byLabel['行内格式']), ['p', 'strong', 'em', 'del', 'code']);
  check('三层列表的嵌套深度', tagsOf(byLabel['嵌套列表']), ['ul', 'li', 'ul', 'li', 'ul', 'li']);
  check(
    '任务列表渲染成禁用的复选框',
    nodesNamed(byLabel['任务列表'], 'input').map((node) => node.attrs),
    [
      [['type', 'checkbox'], ['disabled', null], ['checked', null]],
      [['type', 'checkbox'], ['disabled', null]],
    ],
  );
  check(
    '第一个复选框是勾选状态',
    nodesNamed(byLabel['任务列表'], 'input').map((node) => node.attrs.some(([name]) => name === 'checked')),
    [true, false],
  );
  check('表格的单元格嵌套', tagsOf(byLabel['表格']), ['table', 'thead', 'tr', 'th', 'th', 'tbody', 'tr', 'td', 'td']);
  check('对齐样式落在单元格上', attrsOf(byLabel['表格']).filter(([name]) => name === 'style').length, 4);
  check(
    '代码块里的 script 是一个文本节点，不是一个元素',
    [nodesNamed(byLabel['代码块里的标签是文本'], 'script').length, textOf(byLabel['代码块里的标签是文本'])],
    [0, '<script>alert(1)</script>'],
  );
  check('链接与图片的标签', tagsOf(byLabel['链接与图片']), ['p', 'a', 'img']);
  check(
    '完整文档的结构',
    tagsOf(byLabel['完整文档']),
    ['html', 'head', 'meta', 'meta', 'title', 'body', 'main', 'h1', 'p'],
  );
  check('完整文档的 title 文本', textOf(nodesNamed(byLabel['完整文档'], 'title')[0]), 'T');
  check('main 带 markdown-body 类', nodesNamed(byLabel['完整文档'], 'main')[0].attrs, [['class', 'markdown-body']]);
  check(
    '目录是一个 nav，里面是嵌套的 ul',
    tagsOf(byLabel['目录 + 正文']),
    ['nav', 'ul', 'li', 'a', 'ul', 'li', 'a', 'ul', 'li', 'a', 'h1', 'h2', 'h3'],
  );
  check('目录链接指向标题锚点', nodesNamed(byLabel['目录 + 正文'], 'a')[1].attrs, [['href', '#b']]);
  check('标题锚点 id 与目录一致', nodesNamed(byLabel['目录 + 正文'], 'h2')[0].attrs, [['id', 'b']]);
  check(
    'Unicode 文本按文档顺序原样回来',
    orderedText(parsed[STRUCTURE_DOCS.findIndex((item) => item.label === 'Unicode 与 emoji')]),
    '🚀 中文\n粗体 与 emoji 🎯',
  );
  check(
    '内置的注入样例在默认模式下是安全的（端到端）',
    securityScan(byLabel['原始 HTML 样例']),
    [],
  );
  checkTrue(
    '内置的注入样例确实包含那些攻击串（否则上一条等于没测）',
    M.XSS_SAMPLE.includes('<script>') && M.XSS_SAMPLE.includes('javascript:'),
  );
  check(
    '内置示例在默认模式下也是安全的',
    securityScan(byLabel['内置示例']),
    [],
  );
} else {
  skip('全部解析回读断言（python3 不可用）');
}

/* ------------------------------------------------------------------ *
 * 4. Headings, slugs and the table of contents
 * ------------------------------------------------------------------ */

section('标题、锚点与目录');
{
  check('slug 把空格换成连字符并转小写', M.slugify('Hello World'), 'hello-world');
  check('slug 保留中文', M.slugify('中文 标题!'), '中文-标题');
  check('slug 丢掉标点', M.slugify('a.b,c!d?'), 'abcd');
  check('slug 全是标点时回退为 section', M.slugify('!!!'), 'section');
  check('slug 为空时回退为 section', M.slugify(''), 'section');
  check('slug 保留连字符与下划线', M.slugify('a-b_c'), 'a-b_c');
  check('emoji 会被丢掉（它们不能当锚点）', M.slugify('🚀 发射'), '-发射');

  check(
    '重复标题自动编号',
    M.collectHeadings(marked.lexer('# 同名\n\n# 同名\n\n# 同名\n')).map((heading) => heading.id),
    ['同名', '同名-1', '同名-2'],
  );
  // Known limitation, inherited on purpose: the de-duplication counter is keyed
  // on the *base* slug, so a heading literally named `A-1` can collide with the
  // `a-1` generated for the second `A`. `markdown-preview` uses the same rule
  // and the two tools promise identical anchors, so this is pinned here rather
  // than fixed on one side only.
  check(
    '去重计数只认基础 slug（与 markdown-preview 共用的规则，已知会与字面量标题撞名）',
    M.collectHeadings(marked.lexer('# A\n\n## A\n\n# A-1\n')).map((heading) => heading.id),
    ['a', 'a-1', 'a-1'],
  );
  check(
    '重复的同一标题仍然得到互不相同的锚点',
    M.collectHeadings(marked.lexer('# B\n\n# B\n\n# B\n')).map((heading) => heading.id),
    ['b', 'b-1', 'b-2'],
  );
  check(
    '标题里的行内标记不影响锚点文本',
    M.collectHeadings(marked.lexer('# **粗** `码`')).map((heading) => [heading.text, heading.id]),
    [['粗 码', '粗-码']],
  );
  check(
    '引用块与列表里的标题也会进目录',
    M.collectHeadings(marked.lexer('> # Q\n\n- # L\n')).map((heading) => heading.id),
    ['q', 'l'],
  );
  check('depth 被原样带出', M.collectHeadings(marked.lexer('### 三')).map((heading) => heading.depth), [3]);

  check(
    '目录的精确输出',
    render('# A\n\n## B\n\n### C\n', { toc: true }),
    '<nav class="markdown-toc" aria-label="目录">\n<ul>\n<li><a href="#a">A</a><ul>\n<li><a href="#b">B</a><ul>\n<li><a href="#c">C</a></li>\n</ul></li>\n</ul></li>\n</ul>\n</nav>\n\n<h1 id="a">A</h1>\n<h2 id="b">B</h2>\n<h3 id="c">C</h3>',
  );
  check(
    '跳级（# 后跟 ###）被压成一层，而不是留空 li',
    render('# A\n\n### C\n', { toc: true }).startsWith(
      '<nav class="markdown-toc" aria-label="目录">\n<ul>\n<li><a href="#a">A</a><ul>\n<li><a href="#c">C</a></li>\n</ul></li>\n</ul>\n</nav>',
    ),
    true,
  );
  check(
    '两个同级标题是兄弟而不是嵌套',
    render('# A\n\n## B\n\n## C\n', { toc: true }).includes('<li><a href="#b">B</a></li>\n<li><a href="#c">C</a></li>'),
    true,
  );
  check(
    '回到一级标题会重新成为兄弟',
    render('# A\n\n## B\n\n# C\n', { toc: true }).includes('</ul></li>\n<li><a href="#c">C</a></li>'),
    true,
  );
  check('tocDepth 限制收录层级', M.renderMarkdownToHtml('# A\n\n## B\n\n### C\n', { toc: true, tocDepth: 2 }).headings.length, 3);
  check(
    'tocDepth=1 时目录只有一级标题',
    render('# A\n\n### C\n', { toc: true, tocDepth: 1 }),
    '<nav class="markdown-toc" aria-label="目录">\n<ul>\n<li><a href="#a">A</a></li>\n</ul>\n</nav>\n\n<h1 id="a">A</h1>\n<h3 id="c">C</h3>',
  );
  check(
    'tocDepth 越界时退回 3',
    render('# A\n\n## B\n\n### C\n\n#### D\n', { toc: true, tocDepth: 99 }).includes('#d'),
    false,
  );
  check(
    'tocDepth 为 0 时同样退回 3',
    render('# A\n\n## B\n\n### C\n\n#### D\n', { toc: true, tocDepth: 0 }).includes('#d'),
    false,
  );
  check('不开目录时没有 nav', render('# A\n\n## B\n').includes('<nav'), false);
  check('压缩模式下目录同样压缩', render('# A\n\n## B\n', { toc: true, minify: true }).startsWith('<nav class="markdown-toc" aria-label="目录"><ul><li><a href="#a">A</a><ul>'), true);
  check('目录标题的文本被转义（锚点里 & 被丢掉，所以是 a--b）', render('# a & b\n', { toc: true }).includes('<a href="#a--b">a &amp; b</a>'), true);
  check('headings 数组反映全文标题', M.renderMarkdownToHtml('# A\n\n## B').headings, [
    { depth: 1, text: 'A', id: 'a' },
    { depth: 2, text: 'B', id: 'b' },
  ]);
}

/* ------------------------------------------------------------------ *
 * 5. Escaping helpers
 * ------------------------------------------------------------------ */

section('转义函数');
{
  check('escapeText 转义尖括号', M.escapeText('a<b>c'), 'a&lt;b&gt;c');
  check('escapeText 转义裸 &', M.escapeText('a & b'), 'a &amp; b');
  check('escapeText 不重复转义已有实体（CommonMark 规则）', M.escapeText('&amp;'), '&amp;');
  check('escapeText 保留十进制字符引用', M.escapeText('&#38;'), '&#38;');
  check('escapeText 保留十六进制字符引用', M.escapeText('&#x26;'), '&#x26;');
  check('escapeText 不动引号', M.escapeText('"q" \'s\''), '"q" \'s\'');
  check('escapeCode 连 & 一起转义（原文里的实体要原样显示）', M.escapeCode('&amp;'), '&amp;amp;');
  check('escapeCode 转义尖括号', M.escapeCode('<a>'), '&lt;a&gt;');
  check('escapeAttr 转义双引号', M.escapeAttr('"'), '&quot;');
  check('escapeAttr 转义单引号', M.escapeAttr("'"), '&#39;');
  check('escapeAttr 连 & 一起转义（属性值必须逐字送达）', M.escapeAttr('&amp;'), '&amp;amp;');
  check('escapeAttr 转义全部五种', M.escapeAttr(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
}

/* ------------------------------------------------------------------ *
 * 6. Boundaries and invariants
 * ------------------------------------------------------------------ */

section('边界与不变量');
{
  checkTrue('超长输入不丢内容', render(`# ${'a'.repeat(20000)}`).length > 20000);
  checkTrue('超长正文不丢内容', render('x'.repeat(50000)).length > 50000);
  check('很深的引用不会崩', M.renderMarkdownToHtml('> '.repeat(40) + 'deep').html.includes('deep'), true);
  check('未闭合的行内标记原样保留', render('**未闭合'), '<p>**未闭合</p>');
  check('未闭合的代码围栏仍然产出 pre', render('```\ncode').startsWith('<pre><code>'), true);
  check(
    'NUL 字符只是文本，不会改变标签结构',
    (() => {
      const html = render('a\u0000b');
      return [html.includes('\u0000'), /<[^>]*$/.test(html) === false, html.startsWith('<p>')];
    })(),
    [true, true, true],
  );

  // A deterministic fuzz corpus: whatever the input, the output must parse and
  // must not contain anything executable under the default options.
  const PIECES = [
    '# 标题',
    '普通段落',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](javascript:alert(1))',
    '![a](data:text/html,x)',
    '**粗**',
    '`code`',
    '- 列表项',
    '1. 有序项',
    '> 引用',
    '| a | b |\n| - | - |\n| 1 | 2 |',
    '```\ncode\n```',
    '---',
    '[x](https://a.b "t\\" onmouseover=\\"alert(1)")',
    '![x" onerror="alert(1)](https://a.b/i.png)',
    '&amp; &#106;avascript:',
    '🚀 中文',
    '<div>',
    '</div>',
    '[x][r]\n\n[r]: javascript:alert(1)',
    '<svg onload=alert(1)>',
  ];
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const fuzz = [];
  let throws = 0;
  for (let i = 0; i < 120; i += 1) {
    const parts = [];
    const count = 1 + Math.floor(rand() * 6);
    for (let j = 0; j < count; j += 1) parts.push(PIECES[Math.floor(rand() * PIECES.length) % PIECES.length]);
    const source = parts.join('\n\n');
    try {
      const result = M.renderMarkdownToHtml(source, i % 3 === 0 ? { minify: true } : {});
      fuzz.push({ label: `fuzz #${i}`, source, html: result.html, error: result.error });
    } catch (error) {
      throws += 1;
    }
  }
  check('120 段随机 Markdown 都不抛异常', throws, 0);
  check(
    '随机输入不会产生解析错误（marked 的词法器不会失败）',
    fuzz.filter((item) => item.error !== null).map((item) => item.label),
    [],
  );

  if (pythonAvailable) {
    const parsed = pythonRead(fuzz.map((item) => item.html));
    check(
      '随机输出的标签都正确闭合',
      parsed.map((entry, index) => (entry.unclosed.length > 0 ? `${fuzz[index].label} ${entry.unclosed}` : null)).filter(Boolean),
      [],
    );
    check(
      '随机输出的解析都没有错误',
      parsed.map((entry, index) => (entry.errors.length > 0 ? `${fuzz[index].label} ${entry.errors}` : null)).filter(Boolean),
      [],
    );
    check(
      '随机输出里没有可执行标签、事件属性或危险协议',
      parsed.flatMap((entry) => securityScan(entry.root)),
      [],
    );
  } else {
    skip('随机输出的解析器验证（python3 不可用）');
  }
}

section('utils 不碰环境');
{
  const text = readFileSync('src/tools/markdown-html/markdownHtmlUtils.ts', 'utf8');
  const forbidden = [
    ['不 import React', /from 'react'/],
    ['不 import 组件库', /@fluentui/],
    ['不访问 DOM', /document\.(getElementById|querySelector|createElement|body|write)|window\.|localStorage|navigator\./],
    ['不执行外部命令', /child_process|execSync|spawnSync/],
    ['不读时钟或随机数', /Date\.now|Math\.random/],
  ];
  for (const [label, pattern] of forbidden) {
    checkFalse(label, pattern.test(text));
  }
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}` +
    (skipped ? `, ${skipped} skipped` : '') +
    (pythonAvailable
      ? '\n参照物：CPython html.parser（结构 / 文本 / 单次实体解码）+ marked.parse 朴素实现（反证）'
      : '\n警告：python3 不可用，CPython 解析器参照物已跳过'),
);
process.exit(failed === 0 ? 0 : 1);
