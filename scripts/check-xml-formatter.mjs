/**
 * Checks the XML formatter.
 *
 * The tool makes three claims and each one gets an independent oracle:
 *
 *   1. "Formatting only changes whitespace, never the tree." Checked against
 *      **CPython `xml.etree.ElementTree`**: the original and the formatted text
 *      are parsed by an implementation that shares no code with this one, and
 *      their element/attribute/text trees must be identical.
 *   2. "CDATA, comments and processing instructions survive." ElementTree
 *      throws comments and PIs away, so **`xml.dom.minidom`** (also CPython)
 *      reads those back and the CDATA sections are compared as sections, not as
 *      the text they happen to contain.
 *   3. "It is a parse tree, not a regular expression." A regex indenter and two
 *      regex minifiers are implemented below and the same assertions are run
 *      against them, proving they break on an attribute containing `>`, on
 *      CDATA containing `>`, on a comment containing `>`, and on whitespace
 *      that is content rather than formatting.
 *
 * `parseXml` lives in the sibling `xml-json` tool and is imported with a
 * TypeScript-style extensionless specifier, so it is compiled next to the
 * compiled formatter and the specifier is rewritten before importing.
 *
 * Usage: node scripts/check-xml-formatter.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const COMPILER = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };

mkdirSync('.verify', { recursive: true });

writeFileSync(
  '.verify/xml-formatter-parser.mjs',
  ts.transpileModule(readFileSync('src/tools/xml-json/xmlJsonUtils.ts', 'utf8'), {
    compilerOptions: COMPILER,
  }).outputText,
);

const SPECIFIER = "'../xml-json/xmlJsonUtils'";
const utilSource = readFileSync('src/tools/xml-formatter/xmlFormatterUtils.ts', 'utf8');
if (!utilSource.includes(SPECIFIER)) {
  console.log(`FAIL  无法在 xmlFormatterUtils.ts 里定位依赖说明符 ${SPECIFIER}，检查脚本需要更新`);
  process.exit(1);
}
const compiled = ts
  .transpileModule(utilSource, { compilerOptions: COMPILER })
  .outputText.replace(SPECIFIER, "'./xml-formatter-parser.mjs'");
writeFileSync('.verify/xml-formatter.mjs', compiled);

const M = await import(pathToFileURL('.verify/xml-formatter.mjs').href);
const PARSER = await import(pathToFileURL('.verify/xml-formatter-parser.mjs').href);

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

function skip(label) {
  skipped += 1;
  console.log(`SKIP  ${label}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

function countMismatches(items, same) {
  let n = 0;
  for (const item of items) if (!same(item)) n += 1;
  return n;
}

/* ------------------------------------------------------------------ *
 * The CPython oracle
 * ------------------------------------------------------------------ */

const PY_ANALYZE = `
import sys, json
import xml.etree.ElementTree as ET
from xml.dom import minidom

def canon(el):
    """Elements, attributes and the text runs that surround child elements.

    ElementTree drops comments and processing instructions, so the text on
    either side of one merges into a single run; that is fine, because only the
    concatenation is compared.
    """
    texts = []
    if el.text:
        texts.append(el.text)
    for child in el:
        if child.tail:
            texts.append(child.tail)
    return {"tag": el.tag, "attrs": dict(el.attrib), "texts": texts,
            "children": [canon(child) for child in el]}

def dom_info(text):
    """Comments, PIs and CDATA sections, which ElementTree cannot see."""
    dom = minidom.parseString(text.encode("utf-8"))
    out = {"comments": [], "pis": [], "cdata": []}
    def walk(node):
        for child in node.childNodes:
            if child.nodeType == child.COMMENT_NODE:
                out["comments"].append(child.data)
            elif child.nodeType == child.PROCESSING_INSTRUCTION_NODE:
                out["pis"].append([child.target, child.data])
            elif child.nodeType == child.CDATA_SECTION_NODE:
                out["cdata"].append(child.data)
            walk(child)
    walk(dom)
    return out

documents = json.load(sys.stdin)
results = []
for document in documents:
    entry = {}
    try:
        entry["tree"] = canon(ET.fromstring(document.encode("utf-8")))
    except Exception as exc:
        entry["treeError"] = str(exc)
    try:
        entry["dom"] = dom_info(document)
    except Exception as exc:
        entry["domError"] = str(exc)
    results.append(entry)
print(json.dumps(results, ensure_ascii=False))
`;

const pythonAvailable =
  spawnSync('python3', ['-c', 'import xml.etree.ElementTree, xml.dom.minidom'], {
    encoding: 'utf8',
  }).status === 0;

if (!pythonAvailable) {
  console.log('注意：python3 或 xml.etree / xml.dom 不可用，跳过 CPython 交叉验证部分\n');
}

/**
 * Parses a batch of documents in a single child process.
 *
 * Batching matters: python3 costs about 0.3 s to start here and this script
 * would otherwise spawn it a few hundred times.
 */
function pythonAnalyze(documents) {
  const out = execFileSync('python3', ['-c', PY_ANALYZE], {
    input: Buffer.from(JSON.stringify(documents), 'utf8'),
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/**
 * The rule the claim is made of.
 *
 * Whitespace that separates two child elements is layout. Whitespace inside an
 * element that has no child element is content, and so is *every* whitespace run
 * inside an element that also carries real text (mixed content). A whitespace
 * run is therefore dropped only when the element has child elements and no
 * non-whitespace text at all; everything else is compared exactly — which is
 * what catches indentation leaking into mixed content.
 *
 * The one shape this cannot judge is an element whose only children are
 * comments: ElementTree drops them, so the element looks childless and its
 * whitespace looks like content. The corpus assertion below refuses that shape
 * rather than pretending the oracle can see it.
 */
function normalize(node) {
  const hasChildElement = node.children.length > 0;
  const hasContentText = node.texts.some((text) => text.trim() !== '');
  // Mixed content — text and elements interleaved — makes every run content,
  // including the runs that happen to be whitespace only. Nothing is dropped
  // there, which is exactly what catches a minifier eating the meaningful space
  // between two inline tags.
  const texts = hasChildElement && !hasContentText ? [] : node.texts;
  return { tag: node.tag, attrs: node.attrs, texts, children: node.children.map(normalize) };
}

const sameTree = (a, b) =>
  Boolean(a && b && a.tree && b.tree) && JSON.stringify(normalize(a.tree)) === JSON.stringify(normalize(b.tree));
const sameCdata = (a, b) =>
  Boolean(a && b && a.dom && b.dom) && JSON.stringify(a.dom.cdata) === JSON.stringify(b.dom.cdata);
const sameComments = (a, b) =>
  Boolean(a && b && a.dom && b.dom) && JSON.stringify(a.dom.comments) === JSON.stringify(b.dom.comments);
const samePis = (a, b) =>
  Boolean(a && b && a.dom && b.dom) && JSON.stringify(a.dom.pis) === JSON.stringify(b.dom.pis);

/* ------------------------------------------------------------------ *
 * Naive implementations, kept only as the counter-examples
 * ------------------------------------------------------------------ */

/** Insert a line break after every `>` — the shortest "XML formatter" there is. */
function naiveIndentOnGt(xml) {
  return xml.replace(/>/g, '>\n').trim();
}

/** Collapse whitespace that sits between two tags — the usual one-line minifier. */
function naiveMinify(xml) {
  return xml.replace(/>\s+</g, '><').trim();
}

/** Squeeze every run of whitespace down to one space. */
function naiveSqueeze(xml) {
  return xml.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * 1. Exact output
 * ------------------------------------------------------------------ */

section('格式化：精确输出');
check('两层元素，默认 2 空格', M.formatXml('<a><b>1</b><c/></a>').text, '<a>\n  <b>1</b>\n  <c/>\n</a>\n');
check(
  '四层嵌套',
  M.formatXml('<a><b><c><d>t</d></c></b></a>').text,
  '<a>\n  <b>\n    <c>\n      <d>t</d>\n    </c>\n  </b>\n</a>\n',
);
check('缩进 4 空格', M.formatXml('<a><b>1</b></a>', { indent: 4 }).text, '<a>\n    <b>1</b>\n</a>\n');
check('缩进用制表符', M.formatXml('<a><b>1</b></a>', { indentUnit: 'tab' }).text, '<a>\n\t<b>1</b>\n</a>\n');
check('缩进 3.7 向下取整', M.formatXml('<a><b>1</b></a>', { indent: 3.7 }).text, '<a>\n   <b>1</b>\n</a>\n');
check(
  '缩进 100 被夹到 16',
  M.formatXml('<a><b>1</b></a>', { indent: 100 }).text,
  `<a>\n${' '.repeat(16)}<b>1</b>\n</a>\n`,
);
check('缩进 NaN 退回 2', M.formatXml('<a><b>1</b></a>', { indent: Number.NaN }).text, '<a>\n  <b>1</b>\n</a>\n');
check('缩进 0 等价于压缩', M.formatXml('<a><b>1</b></a>', { indent: 0 }).text, '<a><b>1</b></a>');
check('缩进 -5 夹到 0 后等价于压缩', M.formatXml('<a><b>1</b></a>', { indent: -5 }).text, '<a><b>1</b></a>');
check('压缩模式无换行', M.formatXml('<a>\n  <b>1</b>\n</a>', { mode: 'compact' }).text, '<a><b>1</b></a>');
check(
  '属性各占一行',
  M.formatXml('<a b="1" c="2"><d/></a>', { attributesOnNewLine: true }).text,
  '<a\n  b="1"\n  c="2"\n>\n  <d/>\n</a>\n',
);
check(
  '压缩模式下属性换行选项无效',
  M.formatXml('<a b="1" c="2"><d/></a>', { attributesOnNewLine: true, mode: 'compact' }).text,
  '<a b="1" c="2"><d/></a>',
);
check('自闭合标签不会被改写成空元素', M.formatXml('<a/>').text, '<a/>\n');
check('空元素不会被改写成自闭合标签', M.formatXml('<a></a>').text, '<a></a>\n');
check('pretty 末尾有换行', M.formatXml('<a/>').text.endsWith('\n'), true);
checkFalse('压缩末尾没有换行', M.formatXml('<a/>', { mode: 'compact' }).text.endsWith('\n'));
check(
  'XML 声明与处理指令保留',
  M.formatXml('<?xml version="1.0"?><?target data?><a/>').text,
  '<?xml version="1.0"?>\n<?target data?>\n<a/>\n',
);
check('顶层注释保留', M.formatXml('<!-- top --><a/>').text, '<!-- top -->\n<a/>\n');
check('缩进分支里的注释自带缩进', M.formatXml('<a><!-- x --><b/></a>').text, '<a>\n  <!-- x -->\n  <b/>\n</a>\n');
check('缩进分支里的处理指令自带缩进', M.formatXml('<a><?t d?></a>').text, '<a>\n  <?t d?>\n</a>\n');
check(
  '嵌套的混合内容不会被注入缩进（回归：曾把 "Hi " 变成 "Hi   "）',
  M.formatXml('<a><p>Hi <b>x</b> y</p></a>').text,
  '<a>\n  <p>Hi <b>x</b> y</p>\n</a>\n',
);
check('行内元素之间有意义的一个空格被保留', M.formatXml('<p>a <b>x</b> <i>y</i></p>', { mode: 'compact' }).text, '<p>a <b>x</b> <i>y</i></p>');
check('只有空白的文本内容是内容，不是缩进', M.formatXml('<a> </a>', { mode: 'compact' }).text, '<a> </a>');
check('纯空白元素的 pretty 输出也不动它', M.formatXml('<a> </a>').text, '<a> </a>\n');
check('文本首尾空格保留', M.formatXml('<a> lead </a>').text, '<a> lead </a>\n');
check('CDATA 保持为 CDATA', M.formatXml('<a><![CDATA[x > y & z]]></a>').text, '<a><![CDATA[x > y & z]]></a>\n');
check('CDATA 里的尖括号原样保留', M.formatXml('<a><![CDATA[1 > <b & c]]></a>').text, '<a><![CDATA[1 > <b & c]]></a>\n');
check('属性里的 > 不换行、只转义', M.formatXml('<a b="x > y"><c/></a>').text, '<a b="x &gt; y">\n  <c/>\n</a>\n');
check('文本里的 CR 以字符引用输出（否则会被解析器归一化掉）', M.formatXml('<a>x&#13;y</a>').text, '<a>x&#13;y</a>\n');
check('属性里的制表符以字符引用输出', M.formatXml('<a b="x&#9;y"/>').text, '<a b="x&#9;y"/>\n');
check('CRLF 输入被归一化后再格式化', M.formatXml('<a>\r\n<b/>\r\n</a>').text, '<a>\n  <b/>\n</a>\n');
check('Unicode 文本原样保留', M.formatXml('<a>🚀 中文</a>').text, '<a>🚀 中文</a>\n');

/* ------------------------------------------------------------------ *
 * 2. Only whitespace changes: the ElementTree comparison
 * ------------------------------------------------------------------ */

section('只改空白：与 CPython ElementTree 的树逐节点比对');

/** Hand-picked documents covering every node kind the serializer branches on. */
const CORPUS = [
  { label: '单层元素', doc: '<a><b>1</b><c/></a>' },
  { label: '深层嵌套', doc: '<a><b><c><d><e>t</e></d></c></b></a>' },
  { label: '文本与子元素混合', doc: '<p>Hi <b>x</b> y</p>' },
  { label: '混合内容嵌在别的元素里', doc: '<a><p>Hi <b>x</b> y</p><q>t</q></a>' },
  { label: '行内元素之间只有一个空格', doc: '<p>a <b>x</b> <i>y</i></p>' },
  { label: '纯文本元素', doc: '<a>text</a>' },
  { label: '首尾带空格的文本', doc: '<a>  lead and trail  </a>' },
  { label: '只有空白的文本内容是内容', doc: '<a>   </a>' },
  { label: '空元素与自闭合', doc: '<a><b/><c></c></a>' },
  { label: '属性里的 >', doc: '<a b="1>2"><c/></a>' },
  { label: '属性里的引号与实体', doc: '<a b="x &quot;q&quot; &amp; &lt;z&gt;"><c/></a>' },
  { label: '属性里的空白引用', doc: '<a b="x&#9;y&#10;z&#13;w"/>' },
  { label: 'CDATA 含 > 与 <', doc: '<a><![CDATA[1 > <b & c]]></a>' },
  { label: 'CDATA 与元素相邻', doc: '<a><![CDATA[a]]><b/><![CDATA[c]]></a>' },
  { label: '注释穿插在子元素之间', doc: '<a><!-- c --><b/><!-- d --></a>' },
  { label: '注释里含 >', doc: '<!-- a > b --><a/>' },
  { label: '处理指令', doc: '<?xml version="1.0"?><?t d?><a><b/></a>' },
  { label: '命名空间前缀', doc: '<a xmlns:p="u" xmlns="v"><p:b p:c="1"/></a>' },
  { label: '命名空间前缀下的混合内容', doc: '<a xmlns:p="u"><p:b>t1<p:c/>t2</p:b></a>' },
  { label: 'xml:space 保留', doc: '<a xml:space="preserve">  <b>x</b>  </a>' },
  { label: 'xml:space 在子树里恢复默认', doc: '<a xml:space="preserve"><b xml:space="default"><c/></b></a>' },
  { label: 'Unicode 与 emoji', doc: '<a n="🚀">中文 &amp; emoji 🎯</a>' },
  { label: '文本里的字符引用', doc: '<a>&#20013;&#x6587;&amp;&lt;&gt;&quot;&apos;</a>' },
  { label: 'CRLF 与制表符', doc: '<a>\r\n\t<b/>\r\n</a>' },
  { label: '较宽的分支', doc: `<r>${Array.from({ length: 8 }, (_, i) => `<i n="${i}">v${i}</i>`).join('')}</r>` },
];

/** Deterministic generator, so a failure is reproducible and the shapes vary. */
function generatedCorpus(count) {
  let seed = 20240607;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (list) => list[Math.floor(rand() * list.length) % list.length];
  const escapeText = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (value) =>
    escapeText(value).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;');
  const texts = ['', ' ', '  ', 'text', 'a & b', '<tag>', '中文', '🚀', ' x ', 'line\nbreak'];
  const attrValues = ['1', 'a & b', '1>2', 'x "q"', 'x\ty', '🚀'];
  const names = ['b', 'c', 'item'];

  const element = (depth) => {
    const name = pick(names);
    const attributes =
      rand() < 0.5 ? ` n="${escapeAttr(pick(attrValues))}"` : '';
    if (depth >= 3 || rand() < 0.25) {
      const body = pick(texts);
      return body === '' ? `<${name}${attributes}/>` : `<${name}${attributes}>${escapeText(body)}</${name}>`;
    }
    const kind = rand();
    if (kind < 0.2) {
      return `<${name}${attributes}><![CDATA[${pick(['a]]b', '1 > < 2', '中文 & 符号'])}]]></${name}>`;
    }
    if (kind < 0.3) {
      // A comment is always paired with an element child on purpose: an element
      // whose *only* children are comments is a shape ElementTree cannot see
      // (it drops comments), so it cannot be arbitrated by that oracle. The
      // assertion below keeps such a document out of the corpus.
      return `<${name}${attributes}><!-- ${pick(['note', 'a > b', 'keep me'])} -->${element(
        depth + 1,
      )}</${name}>`;
    }
    if (kind < 0.45) {
      // Mixed content: text and elements interleaved, where whitespace is content.
      const inline = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => `<${pick(names)}/>`).join(
        pick([' ', '', '  ']),
      );
      return `<${name}${attributes}>${escapeText(pick(['pre ', 'a ']))}${inline}${escapeText(
        pick([' post', ' end', '']),
      )}</${name}>`;
    }
    const children = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => element(depth + 1)).join('');
    return `<${name}${attributes}>${children}</${name}>`;
  };

  return Array.from({ length: count }, (_, i) => ({
    label: `随机文档 #${i + 1}`,
    doc: `<?xml version="1.0"?>${element(0)}`,
  }));
}

CORPUS.push(...generatedCorpus(12));

const MODES = [
  { label: 'pretty(2)', options: {} },
  { label: 'compact', options: { mode: 'compact' } },
  { label: 'indent 4', options: { indent: 4 } },
  { label: 'tab', options: { indentUnit: 'tab' } },
  { label: '属性换行', options: { attributesOnNewLine: true } },
];

const formatCases = [];
for (const entry of CORPUS) {
  for (const mode of MODES) {
    const result = M.formatXml(entry.doc, mode.options);
    formatCases.push({ label: `${entry.label} · ${mode.label}`, entry, mode, result });
  }
}

check(
  '语料里的每个文档本工具都能解析',
  CORPUS.filter((entry) => M.formatXml(entry.doc).ok !== true).map((entry) => entry.label),
  [],
);
check(
  '语料里的每种格式化组合都不报错',
  formatCases.filter((item) => item.result.ok !== true).map((item) => item.label),
  [],
);

/**
 * ElementTree throws comments and processing instructions away, so an element
 * whose only children are comments looks empty to it — and whitespace inside an
 * otherwise childless element is *content* under the rule above. Those two
 * readings cannot be told apart by this oracle, so no such document is allowed
 * in the corpus; the shape is covered by exact-output assertions instead.
 */
function loneCommentElements(doc) {
  const parsed = PARSER.parseXml(doc);
  if (!parsed.ok) return [];
  const found = [];
  const walk = (element) => {
    if (
      element.children.length > 0 &&
      element.children.every((child) => child.type === 'comment' || child.type === 'pi')
    ) {
      found.push(`<${element.name}>`);
    }
    for (const child of element.children) if (child.type === 'element') walk(child);
  };
  for (const node of parsed.document.children) if (node.type === 'element') walk(node);
  return found;
}

check(
  '语料里没有「只含注释或处理指令的元素」（那种形状 ElementTree 无法仲裁）',
  CORPUS.flatMap((entry) => loneCommentElements(entry.doc).map((name) => `${entry.label} ${name}`)),
  [],
);

if (pythonAvailable) {
  const documents = [
    ...CORPUS.map((entry) => entry.doc),
    ...formatCases.map((item) => (item.result.ok ? item.result.text : '')),
  ];
  const analysis = pythonAnalyze(documents);
  const originals = analysis.slice(0, CORPUS.length);
  const formatted = analysis.slice(CORPUS.length);

  check(
    'ElementTree 能解析全部原始文档（语料本身是合法 XML）',
    originals.map((item, index) => (item.tree === undefined ? CORPUS[index].label : null)).filter(Boolean),
    [],
  );
  check(
    'ElementTree 能解析全部格式化输出（输出确实良构）',
    formatted.map((item, index) => (item.tree === undefined ? formatCases[index].label : null)).filter(Boolean),
    [],
  );

  for (let m = 0; m < MODES.length; m += 1) {
    const mismatches = [];
    for (let i = 0; i < CORPUS.length; i += 1) {
      const produced = formatted[i * MODES.length + m];
      if (!sameTree(originals[i], produced)) mismatches.push(CORPUS[i].label);
    }
    check(`${MODES[m].label}：${CORPUS.length} 个文档的元素树与原文完全一致`, mismatches, []);
  }

  let total = 0;
  for (let i = 0; i < CORPUS.length; i += 1) {
    for (let m = 0; m < MODES.length; m += 1) {
      if (!sameTree(originals[i], formatted[i * MODES.length + m])) total += 1;
    }
  }
  check(`全部 ${formatCases.length} 组「文档 × 模式」的元素树都与原文一致`, total, 0);

  // The comparator above drops whitespace-only text runs, so it cannot see a
  // binary change to them; the CDATA / comment / PI oracles below and the
  // exact-output section cover those. This check makes the split explicit.
  const nonWhitespaceRuns = CORPUS.filter((entry) =>
    /<p>|pre | post|lead and trail/.test(entry.doc),
  ).length;
  checkTrue('语料里确实包含「文本空格是内容」的文档（否则上面的比对会偏弱）', nonWhitespaceRuns > 0);
} else {
  skip('ElementTree 树比对（python3 不可用）');
  skip('格式化输出良构性检查（python3 不可用）');
}

/* ------------------------------------------------------------------ *
 * 3. Counter-examples: the naive regex implementations really do break
 * ------------------------------------------------------------------ */

section('反证：正则缩进 / 朴素去空白会破坏内容');

const NAIVE_CASES = [
  {
    label: '属性里的 ">"：每遇一个 ">" 就换行会把属性值劈开',
    doc: '<a b="1>2"><c/></a>',
    naive: naiveIndentOnGt,
    compare: 'tree',
  },
  {
    label: 'CDATA 里的 ">"：每遇一个 ">" 就换行会改掉 CDATA 文本',
    doc: '<a><![CDATA[x > y]]></a>',
    naive: naiveIndentOnGt,
    compare: 'cdata',
  },
  {
    label: '注释里的 ">"：每遇一个 ">" 就换行会改掉注释文本',
    doc: '<!-- a > b --><a/>',
    naive: naiveIndentOnGt,
    compare: 'comments',
  },
  {
    label: '处理指令里的 ">"：同样是伪边界',
    doc: '<?t a > b ?><a/>',
    naive: naiveIndentOnGt,
    compare: 'pis',
  },
  {
    label: '混合内容：朴素压缩会吃掉两个行内元素之间有意义的一个空格',
    doc: '<p>a <b>x</b> <i>y</i></p>',
    naive: naiveMinify,
    compare: 'tree',
  },
  {
    label: 'CDATA 里的 "> <"：朴素压缩会把 CDATA 内部的空白删掉',
    doc: '<a><![CDATA[1 > <b]]></a>',
    naive: naiveMinify,
    compare: 'cdata',
  },
  {
    label: '朴素地压缩所有空白会改掉纯文本元素里的空格',
    doc: '<a>  two  spaces  </a>',
    naive: naiveSqueeze,
    compare: 'tree',
  },
  {
    label: '朴素地压缩所有空白会吃掉只由空白构成的文本内容',
    doc: '<a>   </a>',
    naive: naiveSqueeze,
    compare: 'tree',
  },
];

{
  const naiveTexts = NAIVE_CASES.map((item) => item.naive(item.doc));
  const ourTexts = NAIVE_CASES.map((item) => {
    const result = M.formatXml(item.doc, { mode: 'compact' });
    return result.ok ? result.text : '';
  });

  check(
    '每个反例文档本工具都能解析',
    NAIVE_CASES.map((item, index) => (ourTexts[index] === '' ? item.label : null)).filter(Boolean),
    [],
  );

  if (pythonAvailable) {
    const analysis = pythonAnalyze([
      ...NAIVE_CASES.map((item) => item.doc),
      ...naiveTexts,
      ...ourTexts,
    ]);
    const originals = analysis.slice(0, NAIVE_CASES.length);
    const naiveResults = analysis.slice(NAIVE_CASES.length, NAIVE_CASES.length * 2);
    const ours = analysis.slice(NAIVE_CASES.length * 2);

    const comparators = { tree: sameTree, cdata: sameCdata, comments: sameComments, pis: samePis };

    const naiveBroken = [];
    const naiveUnchanged = [];
    const oursOk = [];
    for (let i = 0; i < NAIVE_CASES.length; i += 1) {
      const same = comparators[NAIVE_CASES[i].compare];
      const original = originals[i];
      if (!same(original, naiveResults[i])) naiveBroken.push(NAIVE_CASES[i].label);
      else naiveUnchanged.push(NAIVE_CASES[i].label);
      if (same(original, ours[i])) oursOk.push(NAIVE_CASES[i].label);
    }

    check('每个反例：朴素实现确实破坏了内容（证明这些断言有分辨力）', naiveUnchanged, []);
    check(`朴素实现被证明会破坏全部 ${NAIVE_CASES.length} 个反例`, naiveBroken.length, NAIVE_CASES.length);
    check('同样的反例，本工具在压缩模式下全部保持内容不变', oursOk.length, NAIVE_CASES.length);
  } else {
    skip('朴素实现的反证比对（python3 不可用）');
  }
}

/* ------------------------------------------------------------------ *
 * 4. Malformed input, with a line and a column
 * ------------------------------------------------------------------ */

section('非法输入：位置与 CPython 的一致判定');

const INVALID = [
  { label: '结束标签与开始标签不匹配', doc: '<a><b></a>', line: 1, column: 11 },
  { label: '跨行的标签不匹配', doc: '<a>x\n<b>y</b></c>', line: 2, column: 13 },
  { label: '属性值没有引号', doc: '<a b=1/>', line: 1, column: 6 },
  { label: '同一元素上重复的属性', doc: '<a b="1" b="2"/>', line: 1, column: 11 },
  { label: '未定义的实体引用', doc: '<a>&nope;</a>', line: 1, column: 10 },
  { label: '裸 & 不是实体引用', doc: '<a>a & b</a>', line: 1, column: 9 },
  { label: 'XML 禁止的控制字符', doc: '<a>\u0001</a>', line: 1, column: 5 },
  { label: '两个根元素', doc: '<a/><b/>', line: 1, column: 5 },
  { label: '根元素之前出现文本', doc: 'just text', line: 1, column: 1 },
  { label: '没有根元素（空文档）', doc: '', line: 1, column: 1 },
  { label: '没有根元素（只有空白）', doc: '   \n ', line: 2, column: 2 },
  { label: '文本里直接出现 ]]>', doc: '<a>x]]>y</a>', line: 1, column: 9 },
  { label: '根元素没有闭合', doc: '<a><b>', line: 1, column: 7 },
];

{
  const results = INVALID.map((item) => M.formatXml(item.doc));
  const wrongVerdict = INVALID.filter((item, index) => results[index].ok !== false).map((item) => item.label);
  check('全部非法输入都被拒绝', wrongVerdict, []);

  const wrongPosition = INVALID.filter((item, index) => {
    const result = results[index];
    return result.line !== item.line || result.column !== item.column;
  }).map((item) => item.label);
  check('行列位置与用例一致', wrongPosition, []);

  check(
    '校验入口给出同样的判定与位置',
    INVALID.map((item, index) => {
      const result = M.validateXml(item.doc);
      return result.ok === false && result.line === results[index].line && result.column === results[index].column;
    }),
    INVALID.map(() => true),
  );

  check(
    '非法输入不会产出任何文本',
    results.map((result) => result.text ?? null),
    INVALID.map(() => null),
  );

  if (pythonAvailable) {
    const analysis = pythonAnalyze(INVALID.map((item) => item.doc));
    const divergent = INVALID.map((item, index) =>
      analysis[index].tree === undefined ? null : item.label,
    ).filter(Boolean);
    check('ElementTree 独立地把同一批文档全部判为非法（没有判定分歧）', divergent, []);
  } else {
    skip('非法文档与 ElementTree 的判定一致性（python3 不可用）');
  }
}

section('策略性拒绝：DTD 与实体声明');
{
  const dtd = M.formatXml('<!DOCTYPE a><a/>');
  checkFalse('拒绝 <!DOCTYPE', dtd.ok);
  checkContains('说明这是 XXE 防护', dtd.error, 'XXE');
  check('给出位置', [dtd.line, dtd.column], [1, 1]);

  const entity = M.formatXml('<!ENTITY x "y"><a/>');
  checkFalse('拒绝 <!ENTITY', entity.ok);
  checkContains('说明只支持 5 个预定义实体', entity.error, '实体声明');

  if (pythonAvailable) {
    const analysis = pythonAnalyze(['<!DOCTYPE a><a/>', '<!ENTITY x "y"><a/>']);
    checkTrue('ElementTree 接受带 DTD 的文档（说明这是策略性拒绝，不是语法错误）', analysis[0].tree !== undefined);
    checkTrue('ElementTree 也拒绝裸的 <!ENTITY 声明（这一条确实是语法问题）', analysis[1].tree === undefined);
  } else {
    skip('DTD 接受度对比（python3 不可用）');
  }
}

/* ------------------------------------------------------------------ *
 * 5. CDATA, comments, processing instructions, xml:space
 * ------------------------------------------------------------------ */

section('CDATA / 注释 / 处理指令 / xml:space');

if (pythonAvailable) {
  const DOCS = [
    { label: 'CDATA 含 > 与 <', doc: '<a><![CDATA[1 > <b & c]]></a>', options: {} },
    { label: '注释里含 >', doc: '<a><!-- a > b --><b/></a>', options: {} },
    { label: '顶层注释', doc: '<!-- top --><a/>', options: {} },
    { label: '处理指令', doc: '<?xml version="1.0"?><?t d?><a/>', options: {} },
    { label: 'CDATA 与元素相邻', doc: '<a><![CDATA[a]]><b/><![CDATA[c]]></a>', options: {} },
    { label: '压缩模式下的 CDATA', doc: '<a><![CDATA[1 > <b]]></a>', options: { mode: 'compact' } },
  ];
  const outputs = DOCS.map((item) => {
    const result = M.formatXml(item.doc, item.options);
    return result.ok ? result.text : '';
  });
  const analysis = pythonAnalyze([...DOCS.map((item) => item.doc), ...outputs]);
  const originals = analysis.slice(0, DOCS.length);
  const formatted = analysis.slice(DOCS.length);

  check(
    'minidom 能读出原始文档的 CDATA 段',
    originals.map((item) => (item.dom ? item.dom.cdata.length : -1)),
    [1, 0, 0, 0, 2, 1],
  );
  check(
    'CDATA 段的数量与内容在格式化后不变',
    formatted.map((item, index) => sameCdata(originals[index], item)),
    DOCS.map(() => true),
  );
  check(
    '注释的数量与内容在格式化后不变',
    formatted.map((item, index) => sameComments(originals[index], item)),
    DOCS.map(() => true),
  );
  check(
    '处理指令的数量与内容在格式化后不变',
    formatted.map((item, index) => samePis(originals[index], item)),
    DOCS.map(() => true),
  );
  check('CDATA 文本确实被读出来了（含 > 与 <）', originals[0].dom.cdata, ['1 > <b & c']);
  check('注释文本确实被读出来了（含 >）', originals[1].dom.comments, [' a > b ']);
} else {
  skip('CDATA / 注释 / 处理指令的 minidom 交叉验证（python3 不可用）');
}

check('默认保留注释', M.formatXml('<a><!-- x --><b/></a>').text, '<a>\n  <!-- x -->\n  <b/>\n</a>\n');
{
  const dropped = M.formatXml('<a><!-- x --><b/></a>', { preserveComments: false });
  check('关闭后注释被删除', dropped.text, '<a>\n  <b/>\n</a>\n');
  checkTrue('并且会说明这是有损操作', dropped.warnings.some((warning) => warning.includes('有损')));
  checkTrue('说明里带着被删掉的注释条数', dropped.warnings.some((warning) => warning.includes('1 处注释')));
  const onlyComment = M.formatXml('<a><!-- x --></a>', { preserveComments: false });
  check('只含注释的元素删注释后成为空元素', onlyComment.text, '<a></a>\n');
  check('没有注释时不会产生多余的警告', M.formatXml('<a/>', { preserveComments: false }).warnings, []);
}

check(
  'xml:space="preserve" 的子树逐字节保留',
  M.formatXml('<a xml:space="preserve">  <b>x</b>  </a>').text,
  '<a xml:space="preserve">  <b>x</b>  </a>\n',
);
check(
  'xml:space="preserve" 嵌在别的元素里时，只有它自己那行被缩进',
  M.formatXml('<a><b xml:space="preserve">  <c> x </c>  </b></a>').text,
  '<a>\n  <b xml:space="preserve">  <c> x </c>  </b>\n</a>\n',
);
check(
  'xml:space="default" 取消祖先的 preserve',
  M.formatXml('<a xml:space="preserve"><b xml:space="default"><c/></b></a>').text,
  '<a xml:space="preserve"><b xml:space="default">\n  <c/>\n</b></a>\n',
);
check(
  'xml:space="preserve" 在压缩模式下同样按内容处理',
  M.formatXml('<a xml:space="preserve">  <b>x</b>  </a>', { mode: 'compact' }).text,
  '<a xml:space="preserve">  <b>x</b>  </a>',
);

/* ------------------------------------------------------------------ *
 * 6. Escaping round trips
 * ------------------------------------------------------------------ */

section('转义：写出再读回必须得到同一个值');

const TEXT_VALUES = ['plain', 'a & b', 'a < b > c', '中文 🚀', '  spaces  ', 'quote"and\'apos', 'line\nbreak', 'tab\there', 'cr\rhere', ']]&gt;', '&amp;', '&'];
const ATTR_VALUES = [...TEXT_VALUES, 'x\ty', 'x\ny', 'x\ry', '&quot;', '"double"', "'single'"];

{
  const textDocs = TEXT_VALUES.map((value) => `<a>${M.escapeXmlText(value)}</a>`);
  const attrDocs = ATTR_VALUES.map((value) => `<a b="${M.escapeXmlAttribute(value)}"/>`);
  const back = [...textDocs, ...attrDocs].map((doc) => PARSER.parseXml(doc));

  check(
    'escapeXmlText 的输出全部能被解析回来',
    back.filter((result) => result.ok !== true).length,
    0,
  );
  check(
    '文本转义往返无损',
    TEXT_VALUES.map((value, index) => back[index].document.children[0].children[0].value),
    TEXT_VALUES,
  );
  check(
    '属性转义往返无损',
    ATTR_VALUES.map(
      (value, index) => back[TEXT_VALUES.length + index].document.children[0].attributes[0].value,
    ),
    ATTR_VALUES,
  );
}

check('escapeXmlText 转义尖括号与 &', M.escapeXmlText('a<b>&c'), 'a&lt;b&gt;&amp;c');
check('escapeXmlText 不转义引号（文本节点里没有意义）', M.escapeXmlText('"q" \'s\''), '"q" \'s\'');
check('escapeXmlText 把 CR 写成字符引用', M.escapeXmlText('a\rb'), 'a&#13;b');
check('escapeXmlAttribute 转义引号', M.escapeXmlAttribute('"q"'), '&quot;q&quot;');
check('escapeXmlAttribute 把制表符写成字符引用', M.escapeXmlAttribute('a\tb'), 'a&#9;b');
check('escapeXmlAttribute 把换行写成字符引用', M.escapeXmlAttribute('a\nb'), 'a&#10;b');
check('转义是幂等的输入：&amp; 会变成 &amp;amp;（读回来仍是 &amp;）', M.escapeXmlAttribute('&amp;'), '&amp;amp;');

/* ------------------------------------------------------------------ *
 * 7. Idempotence and stability
 * ------------------------------------------------------------------ */

section('幂等与稳定性');
{
  const MODE_SET = [{}, { mode: 'compact' }, { indent: 4 }, { indentUnit: 'tab' }, { attributesOnNewLine: true }];
  const notIdempotent = [];
  for (const entry of CORPUS) {
    for (const options of MODE_SET) {
      const once = M.formatXml(entry.doc, options);
      if (!once.ok) continue;
      const twice = M.formatXml(once.text, options);
      if (!twice.ok || twice.text !== once.text) notIdempotent.push(`${entry.label} ${JSON.stringify(options)}`);
    }
  }
  check(`格式化 ${CORPUS.length * MODE_SET.length} 次后再次格式化结果不变`, notIdempotent, []);

  const compactThenPretty = [];
  for (const entry of CORPUS) {
    const compact = M.formatXml(entry.doc, { mode: 'compact' });
    if (!compact.ok) continue;
    const pretty = M.formatXml(compact.text, {});
    if (!pretty.ok) compactThenPretty.push(entry.label);
  }
  check('压缩后的输出仍然是合法输入', compactThenPretty, []);

  if (pythonAvailable) {
    const analysis = pythonAnalyze(CORPUS.map((entry) => entry.doc));
    const roundTrips = [];
    for (const entry of CORPUS) {
      const pretty = M.formatXml(entry.doc, {});
      const compact = pretty.ok ? M.formatXml(pretty.text, { mode: 'compact' }) : null;
      roundTrips.push(compact && compact.ok ? compact.text : '');
    }
    const after = pythonAnalyze(roundTrips);
    let broken = 0;
    for (let i = 0; i < CORPUS.length; i += 1) {
      if (!sameTree(analysis[i], after[i])) broken += 1;
    }
    check('pretty → compact 之后元素树仍与最初一致', broken, 0);
  } else {
    skip('pretty → compact 的树回环（python3 不可用）');
  }
}

/* ------------------------------------------------------------------ *
 * 8. lineExcerpt
 * ------------------------------------------------------------------ */

section('错误位置代码片段');
{
  const short = M.lineExcerpt('<a>\n  <b></a>\n', 2, 9);
  check('短行：片段就是整行', short.text, '  <b></a>');
  check('短行：caret 落在第 9 列', short.caret.indexOf('^'), 8);
  check('行文本单独返回原文', short.lineText, '  <b></a>');

  const long = `<r>${'a'.repeat(300)}</r>`;
  const window = M.lineExcerpt(long, 1, 200);
  check('长行：窗口被截成 120 字符', window.text.length, 121);
  checkTrue('长行：被截断的一侧有省略号', window.text.startsWith('…'));
  check('长行：caret 仍然指向原来的列', window.caret.indexOf('^'), 61);

  const atEnd = M.lineExcerpt('<a>short</a>', 1, 90);
  checkTrue('列号越界时 caret 被夹在行尾而不是飞到屏幕外', atEnd.caret.indexOf('^') <= atEnd.text.length);

  const tabbed = M.lineExcerpt('<a>\t<b></a>', 1, 5);
  check('制表符被当成一个空格，caret 不会错位', [tabbed.caret.indexOf('^'), tabbed.text.indexOf('<b')], [4, 4]);

  const missing = M.lineExcerpt('a', 5, 1);
  check('行号越界时返回空片段而不是抛出', [missing.text, missing.caret, missing.lineText], ['', '^', '']);

  const noLineBreak = M.lineExcerpt('<a><b></a>', 1, 7);
  check('单行文档', [noLineBreak.text, noLineBreak.caret.indexOf('^')], ['<a><b></a>', 6]);

  // The caret must line up with the column in a document whose first line is
  // long, which is the case the windowing exists for.
  const source = `${'x'.repeat(500)}\n<bad>`;
  const excerpt = M.lineExcerpt(source, 2, 3);
  check('第二行很短时不做窗口化，caret 对准第 3 列', [excerpt.text, excerpt.caret], ['<bad>', '  ^']);
}

/* ------------------------------------------------------------------ *
 * 9. Statistics
 * ------------------------------------------------------------------ */

section('统计');
{
  const parsed = PARSER.parseXml('<a b="1"><c/>t<!--x--><![CDATA[q]]></a>');
  checkTrue('测试文档可解析', parsed.ok);
  check('元素、属性、注释、CDATA、深度与文本长度', M.xmlStats(parsed.document), {
    root: 'a',
    elements: 2,
    attributes: 1,
    comments: 1,
    cdata: 1,
    processingInstructions: 0,
    maxDepth: 1,
    textLength: 2,
  });

  const deeper = PARSER.parseXml('<?p d?><r a="1" b="2"><x><y>t</y></x><!--c--></r>');
  checkTrue('第二个测试文档可解析', deeper.ok);
  check('更深的结构与处理指令', M.xmlStats(deeper.document), {
    root: 'r',
    elements: 3,
    attributes: 2,
    comments: 1,
    cdata: 0,
    processingInstructions: 1,
    maxDepth: 2,
    textLength: 1,
  });

  check('校验结果里带着统计', M.validateXml('<a><b/></a>').stats.elements, 2);
}

/* ------------------------------------------------------------------ *
 * 10. Boundaries
 * ------------------------------------------------------------------ */

section('边界');
{
  check('空字符串没有根元素', M.formatXml('').error, '文档没有根元素');
  check('只有空白的文档同样没有根元素', M.formatXml('\n\n').ok, false);
  check('超长文本不截断', M.formatXml(`<a>${'x'.repeat(20000)}</a>`).text.length > 20000, true);

  const many = `<r>${Array.from({ length: 2000 }, (_, i) => `<i>${i}</i>`).join('')}</r>`;
  const manyResult = M.formatXml(many, { mode: 'compact' });
  checkTrue('2000 个子元素能被处理', manyResult.ok);

  let deep = 'x';
  for (let i = 0; i < 200; i += 1) deep = `<n>${deep}</n>`;
  const deepResult = M.formatXml(deep);
  checkTrue('200 层嵌套能被处理', deepResult.ok);
  check('200 层嵌套的统计深度（最外层元素记 0 层）', M.validateXml(deep).stats.maxDepth, 199);
  check('200 层嵌套的元素个数', M.validateXml(deep).stats.elements, 200);

  const warningsUnbound = M.formatXml('<a><p:b/></a>').warnings;
  checkTrue('未声明的前缀会被指出', warningsUnbound.some((warning) => warning.includes('xmlns:p')));
  check('声明过前缀就没有警告', M.formatXml('<a xmlns:p="u"><p:b/></a>').warnings, []);
  checkTrue(
    '以保留前缀 xml 开头的元素名会被告警',
    M.formatXml('<xmlfoo/>').warnings.some((warning) => warning.includes('xmlfoo')),
  );
  checkTrue(
    'xml:space 这类预定义名称不会被告警',
    M.formatXml('<a xml:space="preserve"><b/></a>').warnings.length === 0,
  );
  check('xmlns 声明本身不会被告警', M.formatXml('<a xmlns="u"><b/></a>').warnings, []);

  check('格式化不会改动输入字符串（纯函数）', '<a><b/></a>', '<a><b/></a>');
  const source = '<a><b/></a>';
  M.formatXml(source, { mode: 'compact' });
  check('调用后输入没被修改', source, '<a><b/></a>');
}

/* ------------------------------------------------------------------ *
 * 11. The utils module stays pure
 * ------------------------------------------------------------------ */

section('utils 不碰环境');
{
  const text = readFileSync('src/tools/xml-formatter/xmlFormatterUtils.ts', 'utf8');
  const forbidden = [
    ['不 import React', /from 'react'/],
    ['不 import 组件库', /@fluentui/],
    ['不访问 DOM', /document\.(getElementById|querySelector|createElement|body|write)|window\.|localStorage|navigator\./],
    ['不执行外部命令', /child_process|execSync|spawnSync/],
    ['不读时钟', /Date\.now|Math\.random/],
  ];
  for (const [label, pattern] of forbidden) {
    checkFalse(label, pattern.test(text));
  }
  const parsed = PARSER.parseXml('<a b="1"/>');
  checkTrue('依赖的解析器仍可用', parsed.ok);
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}` +
    (skipped ? `, ${skipped} skipped` : '') +
    (pythonAvailable
      ? '\n参照物：CPython xml.etree.ElementTree（结构）+ xml.dom.minidom（CDATA / 注释 / 处理指令）'
      : '\n警告：python3 不可用，CPython 参照物已跳过'),
);
process.exit(failed === 0 ? 0 : 1);
