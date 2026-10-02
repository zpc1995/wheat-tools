/**
 * Checks the SVG placeholder generator.
 *
 * The claim being defended is "the generated document is well-formed XML and the
 * caption survives a round trip". That is not something this script can assert by
 * re-reading its own strings, so the reference is CPython's XML parser: every
 * generated document is handed to `python3`, parsed with `xml.etree.ElementTree`,
 * and the text pulled back out of the resulting tree is compared to the input
 * character by character. If `python3` is not available the parser-backed
 * assertions are skipped with an explicit notice instead of being quietly
 * weakened.
 *
 * Escaping is also checked by counter-example. The naive unescaped concatenation
 * is built here, handed to the same parser, and shown to fail in two ways: an
 * outright parse error for a bare `<`, and a real injected `<script>` element for
 * a tag-balanced payload. A wrong-order escaper (`<` before `&`) is included for
 * the same reason: it looks equivalent until the input contains both characters.
 *
 * Usage: node scripts/check-svg-placeholder.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/svg-placeholder/svgPlaceholderUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/svg-placeholder.mjs', compiled);
const S = await import(pathToFileURL('.verify/svg-placeholder.mjs').href);

let passed = 0;
let failed = 0;
let skipped = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}
function checkTrue(label, actual) {
  check(label, actual, true);
}
function skip(label, why) {
  skipped += 1;
  console.log(`SKIP  ${label}  （${why}）`);
}

const options = (overrides) => ({ ...S.DEFAULT_OPTIONS, ...overrides });

/** The naive attribute concatenation a first implementation would write. */
const naiveAttributeSvg = (caption) =>
  `<svg xmlns="http://www.w3.org/2000/svg" aria-label="${caption}"><title>t</title></svg>`;

/** Escaping in the wrong order: `<` first, so the `&` it introduces gets escaped again. */
const wrongOrderEscape = (value) =>
  value
    .replace(/</g, '&lt;')
    .replace(/&/g, '&amp;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const SCRIPT_PAYLOAD = '</text><script>alert(1)</script><text>';

// ---------------------------------------------------------------------------
// The parser-backed reference: one python3 process for the whole batch.
// ---------------------------------------------------------------------------

const XML_SCRIPT = `
import sys, json, xml.etree.ElementTree as ET
NS = '{http://www.w3.org/2000/svg}'
docs = json.loads(sys.stdin.buffer.read().decode('utf-8'))
out = []
for item in docs:
    r = {'id': item['id']}
    try:
        root = ET.fromstring(item['svg'])
    except Exception as exc:
        r['ok'] = False
        r['error'] = type(exc).__name__ + ': ' + str(exc)
        out.append(r)
        continue
    r['ok'] = True
    r['rootTag'] = root.tag.replace(NS, '')
    r['width'] = root.get('width')
    r['height'] = root.get('height')
    r['viewBox'] = root.get('viewBox')
    r['aria'] = root.get('aria-label')
    r['tspans'] = [t.text or '' for t in root.iter(NS + 'tspan')]
    r['texts'] = [''.join(t.itertext()) for t in root.iter(NS + 'text')]
    r['titles'] = [''.join(t.itertext()) for t in root.iter(NS + 'title')]
    r['scripts'] = len(list(root.iter(NS + 'script')))
    r['tags'] = sorted({c.tag.replace(NS, '') for c in root.iter()})
    r['attrs'] = sorted({k for c in root.iter() for k in c.keys()})
    r['textCount'] = len(list(root.iter(NS + 'text')))
    r['rects'] = [{'fill': c.get('fill'), 'stroke': c.get('stroke')} for c in root.iter(NS + 'rect')]
    out.append(r)
print(json.dumps(out))
`;

function runPython(script, payload) {
  const res = spawnSync('python3', ['-c', script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (res.error) return { ok: false, error: res.error.message };
  if (res.status !== 0) return { ok: false, error: (res.stderr || '').trim().slice(0, 400) };
  try {
    return { ok: true, value: JSON.parse(res.stdout) };
  } catch (err) {
    return { ok: false, error: `无法解析 python3 的输出: ${String(err)}` };
  }
}

const HAVE_PY = spawnSync('python3', ['-c', 'import xml.etree.ElementTree'], { encoding: 'utf8' }).status === 0;

const CAPTIONS = [
  'hello',
  'a<b & c"d\'e',
  '中文 😀 <&',
  SCRIPT_PAYLOAD,
  'line1\nline2',
  '\u0000nul\u0007bell',
  '&lt;already&gt;',
  'a\n\nb',
  '  spaced  ',
];

const docs = CAPTIONS.map((caption, index) => ({
  id: `caption-${index}`,
  svg: S.buildPlaceholderSvg(options({ text: caption })),
}));
docs.push({ id: 'default', svg: S.buildPlaceholderSvg(S.DEFAULT_OPTIONS) });
docs.push({ id: 'empty-text', svg: S.buildPlaceholderSvg(options({ text: '' })) });
docs.push({ id: 'pattern', svg: S.buildPlaceholderSvg(options({ pattern: 'grid' })) });
docs.push({
  id: 'colour-injection',
  svg: S.buildPlaceholderSvg(
    options({
      background: 'red" onload="alert(1)',
      borderWidth: 2,
      borderColor: 'javascript:alert(1)',
      pattern: 'stripes',
      patternColor: 'x"><script>alert(1)</script>',
    }),
  ),
});
docs.push({ id: 'dimensions', svg: S.buildPlaceholderSvg(options({ showDimensions: true })) });
docs.push({ id: 'naive-lt', svg: S.naiveSvgForComparison('a<b') });
docs.push({ id: 'naive-script', svg: S.naiveSvgForComparison(SCRIPT_PAYLOAD) });
docs.push({ id: 'naive-attr', svg: naiveAttributeSvg('x" onload="alert(1)') });
docs.push({
  id: 'wrong-order',
  svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${wrongOrderEscape('&<')}</text></svg>`,
});
docs.push({
  id: 'right-order',
  svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${S.escapeXml('&<')}</text></svg>`,
});

const parsed = new Map();
if (HAVE_PY) {
  const batch = runPython(XML_SCRIPT, docs);
  if (batch.ok) for (const item of batch.value) parsed.set(item.id, item);
  else console.log(`WARN  python3 解析批次失败：${batch.error}`);
} else {
  console.log('WARN  未找到可用的 python3，无法以 CPython xml.etree 为参照物验证良构性与回读');
}
const R = (id) => parsed.get(id) ?? null;
const tspanText = (r) => (r && r.ok ? r.tspans.join('\n') : `PARSE ERROR ${r ? r.error : 'missing'}`);
const simpleText = (r) => (r && r.ok ? r.texts[0] ?? '' : `PARSE ERROR ${r ? r.error : 'missing'}`);
const titleText = (r) => (r && r.ok ? r.titles[0] : `PARSE ERROR ${r ? r.error : 'missing'}`);
const expectText = (caption) => S.stripInvalidXmlChars(caption);

// ---------------------------------------------------------------------------
// 转义：直接对函数断言
// ---------------------------------------------------------------------------

console.log('--- 转义 ---');
check('& 转义', S.escapeXml('&'), '&amp;');
check('< 转义', S.escapeXml('<'), '&lt;');
check('> 转义', S.escapeXml('>'), '&gt;');
check('双引号转义', S.escapeXml('"'), '&quot;');
check('单引号转义', S.escapeXml("'"), '&apos;');
check('五种保留字符一起转义', S.escapeXml('<&>"\''), '&lt;&amp;&gt;&quot;&apos;');
check('先转义 & 再转义 <（顺序正确）', S.escapeXml('&<'), '&amp;&lt;');
check('朴素顺序（先 < 后 &）把新引入的 & 又转义了一遍', wrongOrderEscape('&<'), '&amp;&amp;lt;');
checkTrue('两种顺序在没有任何保留字符时结果相同（这正是坑的隐蔽之处）', S.escapeXml('abc') === wrongOrderEscape('abc'));
checkTrue('两种顺序只要遇到保留字符就不同', S.escapeXml('<') !== wrongOrderEscape('<'));

// ---------------------------------------------------------------------------
// 良构性与回读：权威参照物是 CPython xml.etree
// ---------------------------------------------------------------------------

console.log('--- XML 解析回读（参照物：python3 xml.etree.ElementTree） ---');
if (!HAVE_PY) {
  skip('全部以 CPython xml.etree 为参照物的解析断言', 'python3 不可用');
} else {
  for (const [index, caption] of CAPTIONS.entries()) {
    const r = R(`caption-${index}`);
    const expected = expectText(caption);
    const tag = `caption ${JSON.stringify(caption)}`;
    checkTrue(`${tag} 生成的文档是良构 XML`, r ? r.ok === true : false);
    check(`${tag} 解析回读的 tspan 文本等于原文`, tspanText(r), expected);
    check(`${tag} 解析回读的 <title> 文本等于原文`, titleText(r), expected);
    check(`${tag} 未注入任何 script 元素`, r && r.ok ? r.scripts : -1, 0);
  }

  // XML attribute-value normalisation turns the newline into a space; this is the
  // parser's documented behaviour, so the check pins it rather than papering over.
  check(
    '多行标题在属性里按 XML 规则把换行规范成空格（元素文本仍保留换行）',
    R('caption-4') && R('caption-4').ok ? R('caption-4').aria : null,
    'line1 line2',
  );
  check(
    '属性中的换行规范化与独立实现一致',
    R('caption-4') && R('caption-4').ok ? R('caption-4').aria : null,
    'line1\nline2'.replace(/\n/g, ' '),
  );

  const injection = R('caption-3');
  check('注入型标题不会产生 <script> 元素', injection && injection.ok ? injection.scripts : -1, 0);
  checkTrue('注入型标题不会带出 onload 属性', injection && injection.ok ? !injection.attrs.includes('onload') : false);
  check(
    '注入型标题整体作为一个文本节点读回',
    tspanText(injection),
    SCRIPT_PAYLOAD,
  );

  const control = R('caption-5');
  check('C0 控制字符被替换为 U+FFFD 后仍可解析', tspanText(control), '\uFFFDnul\uFFFDbell');

  const def = R('default');
  check('默认文档根元素是 svg', def && def.ok ? def.rootTag : null, 'svg');
  check('默认文档宽度属性', def && def.ok ? def.width : null, '640');
  check('默认文档高度属性', def && def.ok ? def.height : null, '360');
  check('默认文档 viewBox', def && def.ok ? def.viewBox : null, '0 0 640 360');
  checkTrue('默认文档含 title', def && def.ok ? def.tags.includes('title') : false);
  checkTrue('默认文档含 rect', def && def.ok ? def.tags.includes('rect') : false);
  checkTrue('默认文档含 text 与 tspan', def && def.ok ? def.tags.includes('text') && def.tags.includes('tspan') : false);
  check('默认文档标题文本', titleText(def), S.DEFAULT_OPTIONS.text);

  const empty = R('empty-text');
  check('空文字不渲染 text 元素', empty && empty.ok ? empty.textCount : -1, 0);
  check('空文字时 <title> 回退为 宽 × 高', titleText(empty), '640 × 360');

  const pattern = R('pattern');
  checkTrue('网格底纹生成 defs/pattern 元素', pattern && pattern.ok ? pattern.tags.includes('defs') && pattern.tags.includes('pattern') : false);
  checkTrue('网格底纹生成描边路径', pattern && pattern.ok ? pattern.tags.includes('path') : false);
  checkTrue('网格底纹文档可解析', pattern ? pattern.ok === true : false);

  const dims = R('dimensions');
  checkTrue('尺寸标注文档可解析', dims ? dims.ok === true : false);
  checkTrue('尺寸标注增加了文本元素', dims && dims.ok ? dims.textCount >= 3 : false);

  // 反证一：不转义的朴素拼串直接不是良构 XML。
  const naiveLt = R('naive-lt');
  check('朴素拼串遇到 < 时被 XML 解析器拒绝（举反例证明断言有效）', naiveLt ? naiveLt.ok : null, false);
  checkTrue('拒绝原因是解析错误而非其它', naiveLt && naiveLt.ok === false && typeof naiveLt.error === 'string');

  // 反证二：标签配平的注入载荷在朴素拼串里变成真的 script 元素。
  const naiveScript = R('naive-script');
  checkTrue('朴素拼串对配平载荷可解析（更能说明问题）', naiveScript ? naiveScript.ok === true : false);
  checkTrue('朴素拼串产生了注入的 <script> 元素', naiveScript && naiveScript.ok ? naiveScript.scripts >= 1 : false);

  // 反证三：未转义的属性拼串把标题变成第二个属性。
  const naiveAttr = R('naive-attr');
  checkTrue('未转义的属性拼串可解析', naiveAttr ? naiveAttr.ok === true : false);
  checkTrue('未转义的属性拼串产生了 onload 属性', naiveAttr && naiveAttr.ok ? naiveAttr.attrs.includes('onload') : false);

  // 反证四：转义顺序写反时读回的不是原文。
  check('顺序写反时读回的是被二次转义后的文本', simpleText(R('wrong-order')), '&&lt;');
  checkTrue('顺序写反时读回的结果不等于原文（可被本检查抓到）', simpleText(R('wrong-order')) !== '&<');
  check('顺序正确时读回原文', simpleText(R('right-order')), '&<');

  // 颜色注入：白名单之外的值回退，而不是被"转义后"写进属性。
  const colour = R('colour-injection');
  checkTrue('颜色注入文档仍可解析', colour ? colour.ok === true : false);
  const colourRects = colour && colour.ok ? colour.rects : [];
  check(
    '非法背景色回退到默认值（文档中存在默认背景色矩形）',
    colourRects.some((rect) => rect.fill === S.DEFAULT_OPTIONS.background),
    true,
  );
  check(
    '非法底纹色回退到默认值',
    colourRects.some((rect) => rect.fill === S.DEFAULT_OPTIONS.patternColor),
    true,
  );
  check(
    '非法边框色回退到默认值',
    colourRects.some((rect) => rect.stroke === S.DEFAULT_OPTIONS.borderColor),
    true,
  );
  checkTrue(
    '注入的颜色字符串没有出现在任何矩形属性里',
    !JSON.stringify(colourRects).includes('onload') && !JSON.stringify(colourRects).includes('script'),
  );
  checkTrue('颜色注入不会带出 onload 属性', colour && colour.ok ? !colour.attrs.includes('onload') : false);
  check('颜色注入不产生 script 元素', colour && colour.ok ? colour.scripts : -1, 0);
}

// ---------------------------------------------------------------------------
// 颜色白名单
// ---------------------------------------------------------------------------

console.log('--- 颜色白名单 ---');
for (const value of ['#abc', '#ABCDEF', '#aabbccdd', 'red', 'RED', 'rgb(1,2,3)', 'rgba(1, 2, 3, 0.5)', 'hsl(1,2%,3%)', 'transparent']) {
  check(`接受合法颜色 ${JSON.stringify(value)}`, S.isValidColour(value), true);
}
for (const value of ['', '   ', '#12', '#gggggg', 'red" onload="x', 'url(#x)', 'var(--x)', 'javascript:alert(1)', 'rgb(1,2,3);x', 'rgb(1,2)', 'red blue']) {
  check(`拒绝非法颜色 ${JSON.stringify(value)}`, S.isValidColour(value), false);
}
check('safeColour 对合法值原样返回（并去掉首尾空白）', S.safeColour('  red  ', '#000'), 'red');
check('safeColour 对非法值返回回退色', S.safeColour('x"><script>', '#000'), '#000');

// ---------------------------------------------------------------------------
// 非法 XML 字符
// ---------------------------------------------------------------------------

console.log('--- XML 非法字符 ---');
check('NUL 替换为 U+FFFD', S.stripInvalidXmlChars('\u0000'), '\uFFFD');
check('BEL 替换为 U+FFFD', S.stripInvalidXmlChars('\u0007'), '\uFFFD');
check('U+FFFE / U+FFFF 替换为 U+FFFD', S.stripInvalidXmlChars('\uFFFE\uFFFF'), '\uFFFD\uFFFD');
check('孤立高代理项替换为 U+FFFD', S.stripInvalidXmlChars('\uD800'), '\uFFFD');
check('孤立低代理项替换为 U+FFFD', S.stripInvalidXmlChars('\uDFFF'), '\uFFFD');
check('合法空白（tab/LF/CR）保留', S.stripInvalidXmlChars('\t\n\r'), '\t\n\r');
check('emoji 原样保留（按码点迭代，不拆代理对）', S.stripInvalidXmlChars('😀'), '😀');
check('中文原样保留', S.stripInvalidXmlChars('中文'), '中文');
check('代理对不会被拆开', S.stripInvalidXmlChars('\uD83D\uDE00'), '😀');
check('替换后不再含孤立代理项', [...S.stripInvalidXmlChars('\uD800x\uDFFF')].every((c) => { const cp = c.codePointAt(0); return cp < 0xd800 || cp > 0xdfff; }), true);

// ---------------------------------------------------------------------------
// UTF-8 字节长度：参照物是 Node 自己的 Buffer.byteLength
// ---------------------------------------------------------------------------

console.log('--- UTF-8 字节长度（参照物：Buffer.byteLength） ---');
check('ASCII 三字节', S.utf8ByteLength('abc'), 3);
check('单个中文 3 字节', S.utf8ByteLength('中'), 3);
check('单个 emoji 4 字节', S.utf8ByteLength('😀'), 4);
check('空串 0 字节', S.utf8ByteLength(''), 0);
{
  const samples = ['', 'a', '中', '😀', 'a中😀\n\t', '\u0000\uFFFD', '\uD800', 'ß', '𠀀', 'x'.repeat(1000)];
  for (let i = 0; i < 400; i += 1) {
    samples.push(String.fromCodePoint(0x20 + (i * 7919) % 0x2000));
    samples.push('中'.repeat(i % 5) + '😀'.repeat(i % 3) + String.fromCharCode(0x30 + (i % 10)));
  }
  let mismatches = 0;
  for (const sample of samples) {
    if (S.utf8ByteLength(sample) !== Buffer.byteLength(sample, 'utf8')) mismatches += 1;
  }
  check(`${samples.length} 个样本的字节数与 Buffer.byteLength 完全一致`, mismatches, 0);
}

// ---------------------------------------------------------------------------
// 数值钳制与选项规范化
// ---------------------------------------------------------------------------

console.log('--- 选项钳制 ---');
check('clampInt 对 NaN 用回退值', S.clampInt(Number.NaN, 0, 10, 5), 5);
check('clampInt 对 Infinity 用回退值', S.clampInt(Number.POSITIVE_INFINITY, 0, 10, 5), 5);
check('clampInt 上限', S.clampInt(11, 0, 10, 5), 10);
check('clampInt 下限', S.clampInt(-1, 0, 10, 5), 0);
check('clampInt 四舍五入', S.clampInt(4.6, 0, 10, 5), 5);

check('宽度 0 被抬到最小值 1', S.normaliseOptions(options({ width: 0 })).width, 1);
check('宽度超出上限被压到 4096', S.normaliseOptions(options({ width: 99_999 })).width, 4096);
check('宽度 NaN 回退默认 640', S.normaliseOptions(options({ width: Number.NaN })).width, 640);
check('高度非整数四舍五入', S.normaliseOptions(options({ height: 360.4 })).height, 360);
check(
  '圆角不超过短边的一半',
  S.normaliseOptions(options({ width: 100, height: 40, radius: 999 })).radius,
  20,
);
check('负圆角归零', S.normaliseOptions(options({ width: 100, height: 40, radius: -5 })).radius, 0);
check('字号上限 512', S.normaliseOptions(options({ fontSize: 9999 })).fontSize, 512);
check('负字号归零（0 表示自动）', S.normaliseOptions(options({ fontSize: -3 })).fontSize, 0);
check('边框宽度上限 64', S.normaliseOptions(options({ borderWidth: 999 })).borderWidth, 64);
check('未知图案回退 none', S.normaliseOptions(options({ pattern: 'zigzag' })).pattern, 'none');
check('showDimensions 只接受 true', S.normaliseOptions(options({ showDimensions: 'yes' })).showDimensions, false);
check(
  '超长文字被截断到上限',
  S.normaliseOptions(options({ text: 'a'.repeat(5000) })).text.length,
  S.MAX_TEXT_LENGTH,
);
check(
  '超长文字截断发生在非法字符替换之后（长度按截断后计）',
  S.normaliseOptions(options({ text: '\u0000'.repeat(5000) })).text.length,
  S.MAX_TEXT_LENGTH,
);
check('非法颜色在规范化阶段被替换', S.normaliseOptions(options({ background: 'bad"' })).background, S.DEFAULT_OPTIONS.background);

console.log('--- 自动字号 ---');
checkTrue('自动字号落在允许区间内', S.autoFontSize(options({ text: 'x' }), ['x']) >= S.MIN_FONT_SIZE && S.autoFontSize(options({ text: 'x' }), ['x']) <= S.MAX_FONT_SIZE);
checkTrue('文字越多自动字号越小', S.autoFontSize(options({ text: 'x' }), ['x'.repeat(40)]) < S.autoFontSize(options({ text: 'x' }), ['x']));
checkTrue('自动字号不会低于下限 4', S.autoFontSize(options({ width: 20, height: 20 }), ['x'.repeat(500)]) >= S.MIN_FONT_SIZE);

// ---------------------------------------------------------------------------
// Data URL
// ---------------------------------------------------------------------------

console.log('--- Data URL ---');
{
  const svg = S.buildPlaceholderSvg(options({ text: '中文 😀 a<b' }));
  const dataUrl = S.svgToDataUrl(svg);
  const prefix = 'data:image/svg+xml,';
  check('Data URL 前缀', dataUrl.startsWith(prefix), true);
  check('编码结果与浏览器原生 encodeURIComponent 完全一致', dataUrl, prefix + encodeURIComponent(svg));
  check('decodeURIComponent 能还原出原始 SVG', decodeURIComponent(dataUrl.slice(prefix.length)), svg);
  checkTrue('非 ASCII 文本按 UTF-8 百分号编码', dataUrl.includes('%E4%B8%AD') && dataUrl.includes('%F0%9F%98%80'));
  check('中文的编码与 encodeURIComponent 一致', dataUrl.includes(encodeURIComponent('中')), true);

  // 反证：不编码的 data URL 里第一个 '#' 会开始 URL 片段，内容被截断。
  const raw = prefix + svg;
  checkTrue('未编码的 Data URL 里 # 被当作片段起点（内容会丢失）', new URL(raw).hash !== '');
  check('编码后的 Data URL 没有片段', new URL(dataUrl).hash, '');
  check(
    '编码后的 URL 路径恰好是编码后的完整文档',
    new URL(dataUrl).pathname,
    `image/svg+xml,${encodeURIComponent(svg)}`,
  );
}

// ---------------------------------------------------------------------------
// 生成入口与确定性
// ---------------------------------------------------------------------------

console.log('--- generatePlaceholder 与确定性 ---');
{
  const opts = options({ text: 'hello <world>', pattern: 'stripes', showDimensions: true, borderWidth: 3 });
  const first = S.generatePlaceholder(opts);
  const second = S.generatePlaceholder(opts);
  check('同样输入生成完全相同的 SVG（纯函数，无时钟无随机）', first.svg, second.svg);
  check('generatePlaceholder.svg 等于 buildPlaceholderSvg', first.svg, S.buildPlaceholderSvg(opts));
  check('generatePlaceholder.dataUrl 等于 svgToDataUrl', first.dataUrl, S.svgToDataUrl(first.svg));
  check('generatePlaceholder.byteLength 等于 utf8ByteLength', first.byteLength, S.utf8ByteLength(first.svg));
  check('byteLength 与 Buffer.byteLength 一致', first.byteLength, Buffer.byteLength(first.svg, 'utf8'));
  checkTrue('输出以 </svg> 结尾', first.svg.endsWith('</svg>\n'));
}

console.log(`\n${passed}/${passed + failed} passed${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
