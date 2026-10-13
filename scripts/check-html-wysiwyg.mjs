/**
 * Checks the HTML paste sanitiser.
 *
 * The claim that matters is "pasting cannot inject script". Asserting that with
 * string comparisons against our own output would only prove the sanitiser
 * agrees with itself, so the output is handed to an **independent parser**:
 * Python's `html.parser`, from the standard library, written in another language
 * by people who never saw this code.
 *
 * Three kinds of assertion are made against that oracle:
 *
 *   1. **Every sanitised output is clean** — no `script` (or `iframe`, `object`,
 *      `svg`, `math`, `template`, form controls), no `on*` attribute, no URL
 *      whose scheme is anything but http/https/mailto/tel, no `expression` in a
 *      kept style.
 *   2. **A negative control** — the naive implementation (assign the clipboard
 *      HTML to `innerHTML`, which is what a bare contentEditable box does) is
 *      run through the same oracle and *is* caught. Without this, an oracle that
 *      simply finds nothing would look like a pass.
 *   3. **The good parts survive** — bold, links, lists, headings, quotes and
 *      code are still present in the parsed output, so the sanitiser is not
 *      passing by deleting everything.
 *
 * Usage: node scripts/check-html-wysiwyg.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/html-wysiwyg/htmlSanitizerUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/html-wysiwyg.mjs', compiled);
const M = await import(pathToFileURL('.verify/html-wysiwyg.mjs').href);

let passed = 0;
let failed = 0;
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
// The independent parser
// ---------------------------------------------------------------------------

/**
 * Written with String.raw so the Python regular expressions keep their
 * backslashes; the JS template would otherwise eat `\x00` and `\u2028`.
 */
const PY_ORACLE = String.raw`
import json, re, sys
from html.parser import HTMLParser

# Elements that either execute, load a document, or carry form state.
DANGEROUS_TAGS = {
    'script', 'style', 'iframe', 'frame', 'frameset', 'noframes', 'object',
    'embed', 'applet', 'svg', 'math', 'template', 'form', 'input', 'button',
    'select', 'option', 'textarea', 'base', 'link', 'meta', 'title', 'noscript',
}

# Attributes whose value the browser treats as a URL.
URL_ATTRIBUTES = {
    'href', 'src', 'action', 'formaction', 'srcdoc', 'data', 'poster',
    'background', 'cite', 'xlink:href', 'dynsrc', 'lowsrc',
}

IGNORABLE = re.compile('[\x00-\x20\x7f\xa0\u2028\u2029]')
SCHEME = re.compile(r'^([a-z][a-z0-9+.\-]*):')
SAFE_SCHEMES = {'http', 'https', 'mailto', 'tel'}
STYLE_PAYLOAD = re.compile(r'expression|javascript|vbscript|url\s*\(|@import|behavior|-moz-binding', re.I)


class Inspector(HTMLParser):
    def __init__(self):
        # convert_charrefs=True decodes character references in text *and* in
        # attribute values, which is exactly what a browser does before it
        # decides whether an href is a javascript: URL.
        super().__init__(convert_charrefs=True)
        self.dangerous_tags = []
        self.event_attributes = []
        self.dangerous_urls = []
        self.style_payloads = []
        self.structure = []
        self.tags = []
        self.attributes = []
        self.text = []
        self.in_style = False
        self.style_text = []

    def _record_start(self, tag, attrs):
        self.tags.append(tag)
        if tag in DANGEROUS_TAGS:
            self.dangerous_tags.append(tag)
        if tag == 'style':
            self.in_style = True
        entry = {'kind': 'start', 'tag': tag, 'attrs': {}}
        for name, value in attrs:
            raw = value if value is not None else ''
            self.attributes.append(name)
            entry['attrs'][name] = raw
            if name.startswith('on'):
                self.event_attributes.append(name)
            if name == 'style' and STYLE_PAYLOAD.search(raw):
                self.style_payloads.append(raw)
            if name in URL_ATTRIBUTES:
                if name == 'srcdoc':
                    self.dangerous_urls.append('srcdoc')
                    continue
                normalized = IGNORABLE.sub('', raw).lower()
                match = SCHEME.match(normalized)
                if match and match.group(1) not in SAFE_SCHEMES:
                    self.dangerous_urls.append(name + '=' + raw)
        self.structure.append(entry)

    def handle_starttag(self, tag, attrs):
        self._record_start(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._record_start(tag, attrs)
        self.structure.append({'kind': 'end', 'tag': tag})

    def handle_endtag(self, tag):
        if tag == 'style':
            self.in_style = False
        self.structure.append({'kind': 'end', 'tag': tag})

    def handle_data(self, data):
        if self.in_style:
            self.style_text.append(data)
        stripped = data.strip()
        if stripped:
            self.text.append(stripped)
            self.structure.append({'kind': 'data', 'text': stripped})

    def handle_comment(self, data):
        self.structure.append({'kind': 'comment', 'text': data.strip()})


def inspect(html):
    parser = Inspector()
    parser.feed(html)
    parser.close()
    findings = []
    if parser.dangerous_tags:
        findings.append('dangerous-tags:' + ','.join(sorted(set(parser.dangerous_tags))))
    if parser.event_attributes:
        findings.append('event-attributes:' + ','.join(sorted(set(parser.event_attributes))))
    if parser.dangerous_urls:
        findings.append('dangerous-urls:' + ','.join(sorted(set(parser.dangerous_urls))))
    if parser.style_payloads:
        findings.append('style-payload')
    joined_style = ' '.join(parser.style_text)
    if STYLE_PAYLOAD.search(joined_style):
        findings.append('style-text-payload')
    return {
        'findings': findings,
        'tags': parser.tags,
        'attributes': parser.attributes,
        'text': ' '.join(parser.text),
        'structure': parser.structure,
    }


payload = json.load(sys.stdin)
print(json.dumps([inspect(case) for case in payload['cases']]))
`;

const oraclePath = '.verify/html-wysiwyg-oracle.py';
writeFileSync(oraclePath, PY_ORACLE);

function inspectBatch(htmlList) {
  const result = spawnSync('python3', [oraclePath], {
    input: JSON.stringify({ cases: htmlList }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`无法运行 python3：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`python3 解析器失败：\n${result.stderr}`);
    process.exit(1);
  }
  return JSON.parse(result.stdout);
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/**
 * `naive` marks the cases where assigning the raw HTML to innerHTML is
 * genuinely exploitable, so the oracle must flag the naive version. The cases
 * marked false are included because the sanitiser must still handle them, but a
 * browser would not execute them as written.
 */
const MALICIOUS = [
  { name: 'img onerror', html: '<img src=x onerror=alert(1)>', naive: true },
  { name: 'script 标签', html: '<script>alert(1)</script>', naive: true },
  { name: 'a href javascript:', html: '<a href="javascript:alert(1)">点我</a>', naive: true },
  { name: 'svg onload', html: '<svg onload=alert(1)></svg>', naive: true },
  { name: 'svg 内嵌 script', html: '<svg><script>alert(1)</script></svg>', naive: true },
  { name: '大小写混淆 script', html: '<ScRiPt>alert(1)</sCrIpT>', naive: true },
  { name: 'iframe 外部页面', html: '<iframe src="https://evil.example/x"></iframe>', naive: true },
  { name: 'style expression', html: '<style>div{width:expression(alert(1))}</style>', naive: true },
  { name: 'style @import javascript', html: "<style>@import 'javascript:alert(1)';</style>", naive: true },
  {
    name: '多个事件属性与空格变形',
    html: '<img src="x" onmouseover="alert(1)" onerror = "alert(2)" ONLOAD=alert(3)>',
    naive: true,
  },
  { name: 'href 十进制实体', html: '<a href="java&#115;cript:alert(1)">x</a>', naive: true },
  { name: 'href 十六进制实体加换行', html: '<a href="jav&#x0A;ascript:alert(1)">x</a>', naive: true },
  { name: 'href 前导空格与控制字符', html: '<a href="  \u0001javascript:alert(1)">x</a>', naive: true },
  { name: 'href 大小写混合', html: '<a href="JaVaScRiPt:alert(1)">x</a>', naive: true },
  { name: '未加引号的 javascript: 链接', html: '<a href=javascript:alert(1)>x</a>', naive: true },
  { name: '未加引号且大小写混淆', html: '<a href=JaVaScRiPt:alert(1)>x</a>', naive: true },
  { name: 'div onclick', html: '<div onclick="alert(1)">t</div>', naive: true },
  { name: 'body onload', html: '<body onload="alert(1)"><p>正文</p></body>', naive: true },
  { name: 'object data', html: '<object data="javascript:alert(1)"></object>', naive: true },
  { name: 'embed src', html: '<embed src="javascript:alert(1)">', naive: true },
  {
    name: 'form action 与 button formaction',
    html: '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>',
    naive: true,
  },
  {
    name: 'math 内嵌 script',
    html: '<math><mtext><script>alert(1)</script></mtext></math>',
    naive: true,
  },
  { name: 'input autofocus onfocus', html: '<input autofocus onfocus="alert(1)">', naive: true },
  { name: 'vbscript 协议', html: '<a href="vbscript:msgbox(1)">x</a>', naive: true },
  {
    name: 'data:text/html 链接',
    html: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    naive: true,
  },
  {
    name: 'img data:image/svg+xml',
    html: '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
    naive: true,
  },
  { name: 'template 内嵌 script', html: '<template><script>alert(1)</script></template>', naive: true },
  { name: 'img 大写属性', html: '<IMG SRC=x ONERROR=alert(1)>', naive: true },
  { name: 'href &colon; 命名实体', html: '<a href="javascript&colon;alert(1)">x</a>', naive: true },
  { name: 'href 单字符实体', html: '<a href="&#106;avascript:alert(1)">x</a>', naive: true },
  {
    name: 'iframe srcdoc 内联脚本',
    html: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    naive: true,
  },
  {
    name: '引号内含 > 的 title 与 javascript 链接',
    html: '<a title="a>b" href="javascript:alert(1)">x</a>',
    naive: true,
  },
  { name: 'noscript 包裹', html: '<noscript><img src=x onerror=alert(1)></noscript>', naive: true },
  { name: 'scr<script> 嵌套变形', html: '<scr<script>ipt>alert(1)</scr</script>ipt>', naive: false },
  { name: '未闭合的 script', html: '<script>alert(1)', naive: true },
  {
    name: 'style 属性内 expression（保留样式模式）',
    html: '<p style="width:expression(alert(1));color:red" onclick="x">t</p>',
    naive: true,
    keepStyles: true,
  },
  {
    name: 'style 属性内 url(javascript:)',
    html: '<p style="background-image:url(javascript:alert(1))">t</p>',
    naive: true,
    keepStyles: true,
  },
];

/** The naive implementation this tool exists to replace. */
const naiveInnerHtml = (html) => html;
/** A tempting but insufficient fix: strip only script elements. */
const naiveStripScriptsOnly = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, '');

const sanitised = MALICIOUS.map((entry) =>
  M.sanitizeHtml(entry.html, { keepInlineStyles: entry.keepStyles === true }),
);
const naive = MALICIOUS.map((entry) => naiveInnerHtml(entry.html));
const scriptsOnly = MALICIOUS.map((entry) => naiveStripScriptsOnly(entry.html));

const sanitisedResults = inspectBatch(sanitised);
const naiveResults = inspectBatch(naive);
const scriptsOnlyResults = inspectBatch(scriptsOnly);

console.log('--- 恶意输入：清理后必须干净（python3 html.parser 判定）---');
{
  const withFindings = [];
  sanitisedResults.forEach((result, index) => {
    if (result.findings.length > 0) {
      withFindings.push(`${MALICIOUS[index].name} → ${result.findings.join(' | ')}`);
    }
  });
  check(
    `${MALICIOUS.length} 个恶意输入清理后，独立解析器均未发现 script/on*/危险协议`,
    withFindings,
    [],
  );
}

console.log('--- 反证：不清理的朴素实现确实可执行 ---');
{
  const clean = [];
  naiveResults.forEach((result, index) => {
    if (MALICIOUS[index].naive && result.findings.length === 0) {
      clean.push(`${MALICIOUS[index].name}（朴素实现竟然未被判定为危险）`);
    }
  });
  // If these were empty the oracle would be useless, so the negative control is
  // asserted rather than assumed.
  check('朴素 innerHTML 实现的每一条可执行输入都被解析器判定为危险', clean, []);

  const naiveFlaggedCount = naiveResults.filter((result) => result.findings.length > 0).length;
  check('朴素实现被判定为危险的条数（应远大于 0）', naiveFlaggedCount > 25, true);

  const scriptsOnlyStillBad = scriptsOnlyResults.filter(
    (result) => result.findings.length > 0,
  ).length;
  check('仅删除 script 标签的“半吊子”实现仍被判定为危险（证明黑名单不够）', scriptsOnlyStillBad > 0, true);

  // A concrete pair, spelled out so a reader can see the difference.
  const imgIndex = MALICIOUS.findIndex((entry) => entry.name === 'img onerror');
  check('朴素实现下 <img onerror> 的事件属性被解析器看到', naiveResults[imgIndex].findings.length > 0, true);
  check('清理后同一输入没有任何发现', sanitisedResults[imgIndex].findings, []);
  check('清理后 onerror 被移除且 src 保留', sanitisedResults[imgIndex].structure, [
    { kind: 'start', tag: 'img', attrs: { src: 'x' } },
  ]);
}

console.log('--- 正常格式必须保留（同一解析器的结构判定）---');
{
  const GOOD = [
    { name: '粗体 b', html: '<b>粗体</b>', tags: ['b'], text: '粗体' },
    { name: '粗体 strong', html: '<strong>加粗</strong>', tags: ['strong'], text: '加粗' },
    { name: '斜体与下划线', html: '<i>斜</i><u>下划</u>', tags: ['i', 'u'], text: '斜 下划' },
    { name: '标题', html: '<h2>标题</h2>', tags: ['h2'], text: '标题' },
    { name: '无序列表', html: '<ul><li>一</li><li>二</li></ul>', tags: ['ul', 'li', 'li'], text: '一 二' },
    { name: '有序列表', html: '<ol><li>一</li></ol>', tags: ['ol', 'li'], text: '一' },
    { name: '引用', html: '<blockquote>引用</blockquote>', tags: ['blockquote'], text: '引用' },
    { name: '代码块', html: '<pre><code>a &lt; b</code></pre>', tags: ['pre', 'code'], text: 'a < b' },
    { name: '中文与 emoji', html: '<p>中文 😀 emoji</p>', tags: ['p'], text: '中文 😀 emoji' },
  ];

  const goodResults = inspectBatch(GOOD.map((entry) => M.sanitizeHtml(entry.html)));
  GOOD.forEach((entry, index) => {
    check(`保留 ${entry.name}：标签结构`, goodResults[index].tags, entry.tags);
    check(`保留 ${entry.name}：文本`, goodResults[index].text, entry.text);
    check(`保留 ${entry.name}：无危险发现`, goodResults[index].findings, []);
  });

  // The link case needs its attribute value checked, not just the tag name.
  const linkSource = '<a href="https://example.com/a?b=1&amp;c=2" title="说明">链接</a>';
  const linkResult = inspectBatch([M.sanitizeHtml(linkSource)])[0];
  check('链接标签保留', linkResult.tags, ['a']);
  check(
    '链接 href 保留且实体已归一',
    linkResult.structure[0].attrs.href,
    'https://example.com/a?b=1&c=2',
  );
  check('链接 title 保留', linkResult.structure[0].attrs.title, '说明');
  check('链接文本保留', linkResult.text, '链接');

  // A relative URL carries no scheme and must not be mistaken for a bad one.
  check('相对链接保留', M.sanitizeHtml('<a href="/docs/x.html">文档</a>'), '<a href="/docs/x.html">文档</a>');
  check('锚点链接保留', M.sanitizeHtml('<a href="#top">顶部</a>'), '<a href="#top">顶部</a>');
  check('mailto 保留', M.sanitizeHtml('<a href="mailto:a@b.c">邮件</a>'), '<a href="mailto:a@b.c">邮件</a>');
}

console.log('--- 属性与文本的转义不破坏正常内容 ---');
{
  check('裸 & 被转义', M.sanitizeHtml('<p>a & b</p>'), '<p>a &amp; b</p>');
  check('既有实体保持原样', M.sanitizeHtml('<p>a &amp; b &nbsp; c</p>'), '<p>a &amp; b &nbsp; c</p>');
  check('既有数值实体保持原样', M.sanitizeHtml('<p>&#169; 2024</p>'), '<p>&#169; 2024</p>');
  check('文本里的尖括号被转义', M.sanitizeHtml('<p>1 &lt; 2 &gt; 0</p>'), '<p>1 &lt; 2 &gt; 0</p>');
  check(
    '属性里的引号被转义后仍可被解析器读出',
    inspectBatch([M.sanitizeHtml('<p title=\'say "hi"\'>x</p>')])[0].structure[0].attrs.title,
    'say "hi"',
  );
  check(
    '未知标签去掉但保留文本',
    M.sanitizeHtml('<section><p>保留我</p></section>'),
    '<p>保留我</p>',
  );
  check('未知标签（含属性）不会漏出属性', M.sanitizeHtml('<section onclick="x()">t</section>'), 't');
  check('注释被移除', M.sanitizeHtml('<p>a<!-- <script>x</script> -->b</p>'), '<p>ab</p>');
  check('空输入', M.sanitizeHtml(''), '');
  check('纯文本输入', M.sanitizeHtml('没有标签'), '没有标签');
}

console.log('--- 选项：纯文本粘贴 ---');
{
  const escaped = M.sanitizeHtml('<script>alert(1)</script>', { plainText: true });
  const result = inspectBatch([escaped])[0];
  check('纯文本模式下 script 变成可见字符而非元素', result.tags, []);
  check('纯文本模式下的显示文本', result.text, '<script>alert(1)</script>');
  check('纯文本模式转义尖括号', escaped, '&lt;script&gt;alert(1)&lt;/script&gt;');
  check(
    '纯文本模式保留换行',
    M.sanitizeHtml('第一行\n第二行', { plainText: true }),
    '第一行<br>第二行',
  );
  check('纯文本模式为空时输出为空', M.sanitizeHtml('   ', { plainText: true }), '');
}

console.log('--- 选项：内联样式 ---');
{
  const source = '<p style="color: red; position: fixed; onclick: x">t</p>';
  check('默认不保留 style', M.sanitizeHtml(source), '<p>t</p>');
  check(
    '开启后只保留允许的属性',
    M.sanitizeHtml(source, { keepInlineStyles: true }),
    '<p style="color: red">t</p>',
  );
  check(
    '危险声明被丢弃（expression）',
    M.sanitizeHtml('<p style="width: expression(alert(1)); color: blue">t</p>', {
      keepInlineStyles: true,
    }),
    '<p style="color: blue">t</p>',
  );
  check(
    '危险声明被丢弃（url）',
    M.sanitizeHtml('<p style="background-image: url(javascript:alert(1))">t</p>', {
      keepInlineStyles: true,
    }),
    '<p>t</p>',
  );
  check(
    '输出关闭内联样式时整体剥离',
    M.stripInlineStyles('<p style="color: red" title="a">t</p><b style="font-weight: bold">x</b>'),
    '<p title="a">t</p><b>x</b>',
  );
  check(
    '剥离只影响 style，不影响其它属性',
    M.stripInlineStyles('<a href="https://e.com" style="color:red">x</a>'),
    '<a href="https://e.com">x</a>',
  );

  // Why this is tokenised rather than regex-replaced: an editor's live DOM can
  // hold `STYLE=color:red` with no quotes, which the obvious pattern misses and
  // therefore leaves inline styles in output that promised to have none.
  const stubborn = '<p STYLE=color:red onmouseover="alert(1)">t</p>';
  check(
    '朴素正则会漏掉无引号、大写的 style',
    /STYLE=color:red/.test(stubborn.replace(/\sstyle="[^"]*"/g, '')),
    true,
  );
  check(
    '令牌化剥离对无引号、大写同样生效',
    M.stripInlineStyles(stubborn),
    '<p onmouseover="alert(1)">t</p>',
  );
}

console.log('--- URL 判定 ---');
{
  check('http', M.isSafeUrl('http://example.com'), true);
  check('https', M.isSafeUrl('https://example.com'), true);
  check('mailto', M.isSafeUrl('mailto:a@b.c'), true);
  check('tel', M.isSafeUrl('tel:+8613800000000'), true);
  check('相对路径', M.isSafeUrl('/a/b?c=d:e'), true);
  check('协议相对', M.isSafeUrl('//example.com/x'), true);
  check('javascript', M.isSafeUrl('javascript:alert(1)'), false);
  check('大小写混淆', M.isSafeUrl('JaVaScRiPt:alert(1)'), false);
  check('十进制实体', M.isSafeUrl('java&#115;cript:alert(1)'), false);
  check('二次实体编码', M.isSafeUrl('java&amp;#115;cript:alert(1)'), false);
  check('前导控制字符', M.isSafeUrl('\u0009javascript:alert(1)'), false);
  check('空字符串', M.isSafeUrl(''), false);
  check('data:text/html', M.isSafeUrl('data:text/html,<b>x</b>'), false);
  check('data:image/png 默认也拒绝', M.isSafeUrl('data:image/png;base64,AAAA'), false);
  check('data:image/png 明确允许时通过', M.isSafeUrl('data:image/png;base64,AAAA', true), true);
  check('data:image/svg+xml 即使允许也拒绝', M.isSafeUrl('data:image/svg+xml;base64,AAAA', true), false);
  check(
    'img 的 data:image/png 保留',
    M.sanitizeHtml('<img src="data:image/png;base64,AAAA" alt="图">'),
    '<img src="data:image/png;base64,AAAA" alt="图">',
  );
}

console.log('--- 幂等性：清理两次等于清理一次 ---');
{
  let violations = 0;
  for (const entry of MALICIOUS) {
    const once = M.sanitizeHtml(entry.html, { keepInlineStyles: entry.keepStyles === true });
    const twice = M.sanitizeHtml(once, { keepInlineStyles: entry.keepStyles === true });
    if (once !== twice) violations += 1;
  }
  check(`${MALICIOUS.length} 条恶意输入上清理是幂等的`, violations, 0);

  // Idempotence of the parsed structure, not just the string: re-cleaning must
  // not change what the browser sees either. The second pass uses the same
  // options as the first, otherwise the style cases would differ by design.
  const structures = inspectBatch(sanitised).map((result) => result.structure);
  const reStructures = inspectBatch(
    sanitised.map((html, index) =>
      M.sanitizeHtml(html, { keepInlineStyles: MALICIOUS[index].keepStyles === true }),
    ),
  ).map((result) => result.structure);
  check('清理后再次清理的解析结构完全一致', reStructures, structures);
}

console.log('--- 清理报告 ---');
{
  const result = M.sanitizeHtmlDetailed(
    '<script>x</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">t</a>',
  );
  check('报告列出被移除的标签', result.report.removedTags.includes('script'), true);
  check('报告列出事件属性', result.report.removedAttributes.some((item) => item.includes('onerror')), true);
  check('报告统计被拦截的链接', result.report.blockedUrls, 1);
  check(
    '报告摘要不为空',
    typeof M.describeReport(result.report) === 'string' && M.describeReport(result.report).length > 0,
    true,
  );
  check('干净输入没有摘要', M.describeReport(M.sanitizeHtmlDetailed('<b>x</b>').report), null);
}

console.log('--- 大量构造输入的抽样扫描 ---');
{
  // Every combination of a dangerous element, a case permutation and an
  // attribute form, to catch a tokeniser that only handles the tidy spelling.
  const elements = ['script', 'SCRIPT', 'ScRiPt', 'iframe', 'svg', 'math', 'template', 'style'];
  const attributes = [
    'onerror=alert(1)',
    'onload="alert(1)"',
    'onclick=alert(1)',
    'href="javascript:alert(1)"',
    'src="javascript:alert(1)"',
    'style="width:expression(alert(1))"',
    'background="javascript:alert(1)"',
  ];
  const generated = [];
  for (const element of elements) {
    for (const attribute of attributes) {
      generated.push(`<${element} ${attribute}>payload</${element}>`);
      generated.push(`<div ${attribute}>payload</div>`);
      generated.push(`<a ${attribute}>payload</a>`);
    }
  }
  // Attribute-less forms, plus malformed closing tags.
  for (const element of elements) {
    generated.push(`<${element}>payload`);
    generated.push(`<div><${element}></div>`);
  }

  const cleaned = generated.map((html) => M.sanitizeHtml(html, { keepInlineStyles: true }));
  const results = inspectBatch(cleaned);
  const bad = [];
  results.forEach((result, index) => {
    if (result.findings.length > 0) bad.push(`${generated[index]} → ${result.findings.join(' | ')}`);
  });
  check(`${generated.length} 条构造输入（${elements.length} 种元素 × 属性变形）全部干净`, bad, []);

  // The naive version on the same corpus, as a second negative control at scale.
  const naiveGenerated = inspectBatch(generated.map((html) => html));
  const naiveBad = naiveGenerated.filter((result) => result.findings.length > 0).length;
  check('同一批输入交给朴素实现时绝大多数被判定为危险', naiveBad > generated.length * 0.5, true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
