/**
 * Checks the XML <-> JSON tool.
 *
 * The claim under test is "this is a real XML parser, not a regular expression,
 * and the mapping it feeds is documented and honestly lossy". Three independent
 * oracles back that up:
 *
 *   1. `python3` with `xml.etree.ElementTree` parses the same documents
 *      independently and its element trees are compared node by node.
 *   2. Every XML string this tool generates is handed to ElementTree, which is
 *      the proof that the output is well formed rather than merely plausible.
 *   3. A deliberately naive regex "parser" is implemented in this file and shown
 *      to lose elements on nested tags, so the structural assertions above are
 *      demonstrably able to catch that class of bug.
 *
 * If python3 or its XML module is unavailable the oracle sections are skipped
 * with a printed notice instead of silently passing.
 *
 * Usage: node scripts/check-xml-json.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync('src/tools/xml-json/xmlJsonUtils.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/xml-json.mjs', compiled);
const M = await import(pathToFileURL('.verify/xml-json.mjs').href);

let passed = 0;
let failed = 0;

/** Key order is meaningless in JSON objects, so comparisons sort keys. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function report(ok, label, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n${detail}`}`);
}

function check(label, actual, expected) {
  const a = JSON.stringify(stable(actual));
  const e = JSON.stringify(stable(expected));
  report(a === e, label, `        got      ${a}\n        expected ${e}`);
}

function checkTrue(label, actual) {
  report(actual === true, label, `        got      ${JSON.stringify(actual)}\n        expected true`);
}

function checkContains(label, actual, needle) {
  const ok = typeof actual === 'string' && actual.includes(needle);
  report(ok, label, `        got      ${JSON.stringify(actual)}\n        expected to contain ${JSON.stringify(needle)}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/* ------------------------------------------------------------------ *
 * Oracles
 * ------------------------------------------------------------------ */

const PY_TREES = `
import sys, json
import xml.etree.ElementTree as ET

documents = json.load(sys.stdin)

def canon(el):
    texts = []
    if el.text:
        texts.append(el.text)
    for child in el:
        if child.tail:
            texts.append(child.tail)
    return {
        "tag": el.tag,
        "attrs": dict(el.attrib),
        "text": "".join(texts),
        "texts": texts,
        "children": [canon(child) for child in el],
    }

results = []
for document in documents:
    try:
        root = ET.fromstring(document.encode("utf-8"))
    except Exception as exc:
        results.append({"__error": str(exc)})
        continue
    results.append(canon(root))

print(json.dumps(results, ensure_ascii=False))
`;

const pythonAvailable =
  spawnSync('python3', ['-c', 'import xml.etree.ElementTree'], { encoding: 'utf8' }).status === 0;

if (!pythonAvailable) {
  console.log('注意：python3 或 xml.etree 不可用，跳过 ElementTree 交叉验证部分\n');
}

/**
 * Parses a batch of documents with ElementTree in a single child process.
 *
 * Batching matters: python3 costs ~0.3 s to start here, and this script would
 * otherwise spawn it sixty times.
 */
function pythonTrees(documents) {
  const out = execFileSync('python3', ['-c', PY_TREES], {
    input: Buffer.from(JSON.stringify(documents), 'utf8'),
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/** Same shape as the Python canon, derived from this tool's own tree. */
function myTree(element) {
  const texts = [];
  const children = [];
  for (const child of element.children) {
    if (child.type === 'text') texts.push(child.value);
    if (child.type === 'element') children.push(child);
  }
  return {
    tag: element.name,
    attrs: Object.fromEntries(element.attributes.map((attribute) => [attribute.name, attribute.value])),
    text: texts.join(''),
    texts,
    children: children.map(myTree),
  };
}

/**
 * Drops the `texts` split.
 *
 * ElementTree discards comments and processing instructions, so the text on
 * either side of one merges into a single run; this parser keeps the runs
 * separate. The concatenation is identical, so only that is compared.
 */
function flat(node) {
  return {
    tag: node.tag,
    attrs: node.attrs,
    text: node.text,
    children: node.children.map(flat),
  };
}

function myRootTree(xml) {
  const parsed = M.parseXml(xml);
  if (!parsed.ok) throw new Error(`本工具无法解析：${parsed.error}`);
  const root = M.rootElement(parsed.document);
  if (!root) throw new Error('没有根元素');
  return myTree(root);
}

/**
 * Applies the tool's text-trimming rule to a canonical tree.
 *
 * Used to compare pretty-printed round-trip output (which contains indentation
 * whitespace) with the compact original. Python does the parsing; this only
 * mirrors the documented mapping rule.
 */
function trimTree(node) {
  const hasElementChild = node.children.length > 0;
  let text = '';
  for (const raw of node.texts) {
    if (hasElementChild && raw.trim() === '') continue;
    text += raw.trim();
  }
  return {
    tag: node.tag,
    attrs: node.attrs,
    text,
    children: node.children.map(trimTree),
  };
}

/** Documents whose mapping is lossless enough to survive a round trip. */
const LOSSY_LABELS = new Set([
  '混合内容',
  '尾部文本混合',
  '文本两端空白',
  '注释',
  '处理指令与 xml 声明',
]);

/* ------------------------------------------------------------------ *
 * Corpus
 * ------------------------------------------------------------------ */

const CORPUS = [
  ['自闭合空元素', '<a/>'],
  ['显式空元素', '<a></a>'],
  ['纯文本', '<a>text</a>'],
  ['属性', '<a id="1" class="x">t</a>'],
  ['多属性自闭合', '<a x="1" y="2" z="3"/>'],
  ['两个不同子元素', '<a><b>1</b><c>2</c></a>'],
  ['重复子元素', '<a><b>1</b><b>2</b></a>'],
  ['同名嵌套', '<a><a>1</a></a>'],
  ['深层同名嵌套', '<root><item><item>deep</item></item></root>'],
  ['混合内容', '<a>x<b/>y</a>'],
  ['尾部文本混合', '<a><b>1</b>tail<c>2</c></a>'],
  ['命名空间前缀', '<a xmlns:ns="urn:x"><ns:b ns:k="v">中</ns:b></a>'],
  ['CDATA', '<a><![CDATA[<b>&amp;</b>]]></a>'],
  ['预定义实体与字符引用', '<a>&amp;&lt;&gt;&quot;&apos;&#65;&#x4e2d;</a>'],
  ['属性中的实体', '<a b="&lt;x&gt;&amp;&quot;"/>'],
  ['emoji 与中文', '<a>emoji 😀 中文</a>'],
  ['处理指令与 xml 声明', '<?xml version="1.0"?><a><?pi data?><b/></a>'],
  ['注释', '<!-- c --><a><!-- inner --><b/></a>'],
  ['多行文本', '<a>line1\nline2</a>'],
  ['三个重复子元素', '<a><b/><b/><b>3</b></a>'],
  ['文本两端空白', '<a> spaced </a>'],
  ['文档外层空白', '  <a/>  '],
  ['CRLF 归一化', '<a>x\r\ny</a>'],
  ['属性里的制表符与换行', '<a b="x\ty\nz"/>'],
  ['属性中的 CR 字符引用', '<a b="x&#13;y"/>'],
  ['文本中的 CR 字符引用', '<a>x&#13;y</a>'],
  ['带 encoding 的声明', '<?xml version="1.0" encoding="UTF-8"?><a>ok</a>'],
  ['BOM 开头', '\uFEFF<a/>'],
  ['缩进过的文档', '<a>\n  <b>1</b>\n  <c/>\n</a>'],
];

/* ------------------------------------------------------------------ *
 * 1. Independent structural comparison with ElementTree
 * ------------------------------------------------------------------ */

section('与 Python ElementTree 的结构交叉验证');
/**
 * ElementTree expands namespaces to `{uri}local`; this tool deliberately keeps
 * prefixes as written. That difference is asserted on its own below instead of
 * being compared node by node.
 */
const NAMESPACE_SAMPLE = ['命名空间前缀', '<a xmlns:ns="urn:x"><ns:b ns:k="v">中</ns:b></a>'];
const TREE_CORPUS = CORPUS.filter(([label]) => label !== NAMESPACE_SAMPLE[0]);

if (pythonAvailable) {
  const trees = pythonTrees(CORPUS.map(([, xml]) => xml));
  let agree = 0;
  const disagreements = [];
  CORPUS.forEach(([label, xml], index) => {
    if (label === NAMESPACE_SAMPLE[0]) return;
    const mine = flat(myRootTree(xml));
    const theirs = flat(trees[index]);
    if (JSON.stringify(stable(mine)) === JSON.stringify(stable(theirs))) {
      agree += 1;
    } else {
      disagreements.push(`${label}: 本工具=${JSON.stringify(mine)} ElementTree=${JSON.stringify(theirs)}`);
    }
  });
  check(
    `${TREE_CORPUS.length} 份文档的元素树与 ElementTree 完全一致（标签、属性、文本、子节点）`,
    disagreements,
    [],
  );
  check('一致的数量', agree, TREE_CORPUS.length);

  const nsMine = myRootTree(NAMESPACE_SAMPLE[1]);
  const nsTheirs = trees[CORPUS.findIndex(([label]) => label === NAMESPACE_SAMPLE[0])];
  check('本工具按字面保留前缀（子标签名）', nsMine.children[0].tag, 'ns:b');
  check('本工具把 xmlns 声明当作普通属性', nsMine.attrs, { 'xmlns:ns': 'urn:x' });
  check('ElementTree 相反：会解析命名空间，xmlns 不进入属性表', nsTheirs.attrs, {});
  check('ElementTree 的子标签是展开后的名字', nsTheirs.children[0].tag, '{urn:x}b');
  check('ElementTree 的属性名同样被展开', nsTheirs.children[0].attrs, { '{urn:x}k': 'v' });
  check('两种处理下文本完全一致', nsTheirs.children[0].text, nsMine.children[0].text);

  // A default namespace is the same story: ElementTree expands it, this tool
  // keeps the declaration as a plain attribute. Documented, deliberate, and
  // therefore asserted rather than hidden.
  const defaultNs = '<a xmlns="urn:x"><b/></a>';
  const defaultMine = myRootTree(defaultNs);
  const defaultTheirs = flat(pythonTrees([defaultNs])[0]);
  check('默认命名空间：本工具保留字面标签名', defaultMine.tag, 'a');
  check('默认命名空间：本工具把 xmlns 当属性', defaultMine.attrs, { xmlns: 'urn:x' });
  check('默认命名空间：ElementTree 展开标签名', defaultTheirs.tag, '{urn:x}a');
  check('默认命名空间：ElementTree 的子标签也展开', defaultTheirs.children[0].tag, '{urn:x}b');
} else {
  console.log('SKIP  与 ElementTree 的结构交叉验证');
}

/* ------------------------------------------------------------------ *
 * 2. Generated XML is well formed (ElementTree accepts it)
 * ------------------------------------------------------------------ */

section('生成的 XML 能被独立解析器接受（良构性证明）');
{
  const docs = [
    ['简单对象', { root: { '@id': '1', '#text': 'hi', child: 'x' } }, 'declaration 关闭'],
    ['数组展开', { r: { item: [1, 2, 3] } }, ''],
    ['null 变空元素', { r: { a: null } }, ''],
    ['特殊字符转义', { r: { t: 'a<b>&"c\'d', '@q': 'x<y&z' } }, ''],
    ['中文与 emoji 元素名和文本', { 根: { 标题: '小麦 😀' } }, ''],
    ['注释与处理指令', { r: { '#comment': 'hi', '#pi': 'target data', b: '1' } }, ''],
    ['深层嵌套', (() => {
      let node = 'leaf';
      for (let i = 0; i < 25; i += 1) node = { [`n${i}`]: node };
      return { root: node };
    })(), ''],
  ];

  if (pythonAvailable) {
    const generated = docs.map(([label, json]) => ({
      label,
      result: M.jsonToXml(JSON.stringify(json), { indent: 2, nameFix: 'sanitize' }),
    }));
    const failed = generated.filter((entry) => !entry.result.ok);
    for (const entry of failed) {
      console.log(`        ${entry.label}: 生成失败 ${entry.result.error}`);
    }
    const acceptable = generated.filter((entry) => entry.result.ok);
    const trees = pythonTrees(acceptable.map((entry) => entry.result.text));
    let mismatches = failed.length;
    acceptable.forEach((entry, index) => {
      const raw = trees[index];
      if (raw.__error) {
        mismatches += 1;
        console.log(`        ${entry.label}: ElementTree 拒绝 ${raw.__error}`);
        return;
      }
      const theirs = flat(raw);
      const mine = flat(myRootTree(entry.result.text));
      if (JSON.stringify(stable(mine)) !== JSON.stringify(stable(theirs))) {
        mismatches += 1;
        console.log(`        ${entry.label}: 两棵树不一致`);
      }
    });
    check(`${docs.length} 份生成的 XML 均被 ElementTree 接受且树结构一致`, mismatches, 0);
  } else {
    console.log('SKIP  良构性证明（无 ElementTree）');
  }

  const generated = M.jsonToXml(JSON.stringify({ r: { item: [1, 2] } }), {
    declaration: false,
    indent: 0,
  });
  checkTrue('紧凑模式生成成功', generated.ok);
  check('数组展开为重复元素', generated.text, '<r><item>1</item><item>2</item></r>');
}

/* ------------------------------------------------------------------ *
 * 3. Round trip
 * ------------------------------------------------------------------ */

section('XML → JSON → XML 往返（语义等价，用独立解析器复核）');
{
  const roundTrippable = CORPUS.filter(
    ([label, xml]) =>
      !LOSSY_LABELS.has(label) && !xml.includes('<!--') && !xml.includes('<?'),
  );

  let mismatches = 0;
  const rewritten = [];
  for (const [label, xml] of roundTrippable) {
    const first = M.xmlToJson(xml, { trimText: true }, 2);
    if (!first.ok) {
      mismatches += 1;
      rewritten.push(null);
      console.log(`        ${label}: 首次转换失败 ${first.error}`);
      continue;
    }
    const back = M.jsonToXml(first.text, { indent: 2, declaration: false, nameFix: 'sanitize' });
    rewritten.push(back.ok ? back.text : null);
    if (!back.ok) {
      mismatches += 1;
      console.log(`        ${label}: 回写失败 ${back.error}`);
      continue;
    }
    const second = M.xmlToJson(back.text, { trimText: true }, 2);
    if (!second.ok) {
      mismatches += 1;
      console.log(`        ${label}: 二次转换失败 ${second.error}`);
      continue;
    }
    if (JSON.stringify(stable(first.value)) !== JSON.stringify(stable(second.value))) {
      mismatches += 1;
      console.log(`        ${label}: ${JSON.stringify(first.value)} != ${JSON.stringify(second.value)}`);
    }
  }
  check(`往返 ${roundTrippable.length} 份文档后 JSON 语义不变`, mismatches, 0);

  if (pythonAvailable) {
    // Both the original and the rewritten document go through ElementTree, so
    // the round trip is confirmed by a parser that knows nothing about this
    // tool's own tree representation.
    const payload = [];
    const pairs = [];
    roundTrippable.forEach(([, xml], index) => {
      if (rewritten[index] === null) return;
      payload.push(xml, rewritten[index]);
      pairs.push(index);
    });
    const trees = pythonTrees(payload);
    let pythonMismatches = 0;
    pairs.forEach((pairIndex, position) => {
      const a = trimTree(trees[position * 2]);
      const b = trimTree(trees[position * 2 + 1]);
      if (a.__error || b.__error) {
        pythonMismatches += 1;
        console.log(`        ${roundTrippable[pairIndex][0]}: ElementTree 报错`);
        return;
      }
      if (JSON.stringify(stable(a)) !== JSON.stringify(stable(b))) {
        pythonMismatches += 1;
        console.log(`        ${roundTrippable[pairIndex][0]}: ElementTree 视角下往返不等价`);
      }
    });
    check('ElementTree 视角下往返同样等价', pythonMismatches, 0);
  }

  checkTrue('往返样本数足够（≥ 15）', roundTrippable.length >= 15);
}

/* ------------------------------------------------------------------ *
 * 4. Security: DTD and entities are refused
 * ------------------------------------------------------------------ */

section('安全：拒绝 DTD / 外部实体（XXE）');
{
  const attacks = [
    [
      '经典 XXE：外部文件实体',
      '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
      'DTD',
    ],
    ['外部 DTD 引用', '<!DOCTYPE r SYSTEM "http://attacker.example/x.dtd"><r/>', 'DTD'],
    ['内部实体声明', '<!DOCTYPE r [<!ENTITY x "y">]><r/>', 'DTD'],
    ['裸 ENTITY 声明', '<!ENTITY xxe SYSTEM "file:///etc/passwd">', 'ENTITY'],
    ['小写 doctype 也必须拒绝', '<!doctype r><r/>', 'DTD'],
    ['参数实体', '<!DOCTYPE r [<!ENTITY % p SYSTEM "http://evil/x"> %p;]><r/>', 'DTD'],
    ['元素内部的 DOCTYPE', '<a><!DOCTYPE x></a>', 'DTD'],
    ['未定义的实体引用', '<r>&xxe;</r>', '未定义的实体引用'],
    ['外部实体的属性引用', '<!DOCTYPE r [<!ENTITY e SYSTEM "file:///etc/passwd">]><r a="&e;"/>', 'DTD'],
  ];

  let rejected = 0;
  for (const [label, xml, needle] of attacks) {
    const parsed = M.parseXml(xml);
    if (!parsed.ok) rejected += 1;
    check(`${label}：拒绝解析`, parsed.ok, false);
    if (!parsed.ok) checkContains(`${label}：给出原因`, parsed.error, needle);
    const converted = M.xmlToJson(xml, { trimText: true }, 2);
    check(`${label}：转换也不产生任何输出`, converted.ok, false);
  }
  check('全部恶意样本都被拒绝', rejected, attacks.length);

  // The real property that matters: nothing from the file system can leak into
  // the output, because there is no output at all.
  const xxe = M.xmlToJson(
    '<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>',
    { trimText: true },
    2,
  );
  check('XXE 载荷没有输出文本', xxe.ok ? xxe.text : '', '');
  checkTrue('XXE 载荷结果是错误', xxe.ok === false);

  // A DOCTYPE that only declares an internal entity must not be "stripped and
  // continue": that would leave &x; dangling and silently change the document.
  const strippedCandidate = M.parseXml('<r>&x;</r>');
  checkTrue('没有 DTD 时自定义实体同样失败（不做静默剥离）', strippedCandidate.ok === false);
}

/* ------------------------------------------------------------------ *
 * 5. Boundaries and malformed input
 * ------------------------------------------------------------------ */

section('边界与非法输入');
{
  const bad = [
    ['空输入', '', '没有根元素'],
    ['只有空白', '   \n  ', '没有根元素'],
    ['裸文本', 'just text', '根元素之前'],
    ['结束标签不匹配', '<a></b>', '不匹配'],
    ['没有结束标签', '<a>', '没有结束标签'],
    ['开始标签未闭合', '<a', '没有闭合'],
    ['属性值没有引号', '<a b=1/>', '引号'],
    ['属性值没有闭合引号', '<a b="1/>', '没有闭合的引号'],
    ['重复属性', '<a b="1" b="2"/>', '重复属性'],
    ['只有大小写不同的属性', '<a b="1" B="2"/>', '大小写'],
    ['文本中出现 ]]>', '<a>]]></a>', ']]>'],
    ['注释里的双连字符', '<!-- a--b --><a/>', '两个连字符'],
    ['注释没有闭合', '<!-- x <a/>', '注释没有闭合'],
    ['CDATA 没有闭合', '<a><![CDATA[x</a>', 'CDATA 段没有闭合'],
    ['实体缺少分号', '<a>&amp</a>', '分号'],
    ['未知实体', '<a>&nope;</a>', '未定义'],
    ['字符引用超出范围', '<a>&#x110000;</a>', '不允许的码位'],
    ['字符引用指向 NUL', '<a>&#0;</a>', '不允许的码位'],
    ['文本里的 NUL 字符', '<a>\u0000</a>', '不允许的字符'],
    ['非法元素名', '<1a/>', '元素名'],
    ['两个根元素', '<a/><b/>', '只能有一个根元素'],
    ['根元素之后的文本', '<a/>tail', '根元素之后'],
    ['元素内部的 xml 声明', '<a><?xml version="1.0"?></a>', '最开头'],
    ['属性名带空格', '<a b c="1"/>', '期望'],
    ['未闭合的处理指令', '<a><?pi x</a>', '处理指令没有闭合'],
    ['属性值里的裸小于号', '<a b="x<y"/>', '不能出现'],
    ['属性之间没有空格', '<a b="1"c="2"/>', '必须有空格'],
  ];

  let count = 0;
  for (const [label, xml, needle] of bad) {
    const parsed = M.parseXml(xml);
    if (!parsed.ok) count += 1;
    check(`${label}：报错`, parsed.ok, false);
    if (!parsed.ok) {
      checkContains(`${label}：错误信息`, parsed.error, needle);
      checkTrue(`${label}：带行号`, parsed.line >= 1);
    }
  }
  check(`全部 ${bad.length} 个非法样本被拒绝`, count, bad.length);

  check('错误带行号与列号', M.parseXml('<a>\n  <b>\n</a>').line > 1, true);

  const deep = `${'<n>'.repeat(300)}${'</n>'.repeat(300)}`;
  const deepParsed = M.parseXml(deep);
  checkTrue('300 层嵌套可解析（不因递归深度崩溃）', deepParsed.ok);
  checkTrue('300 层嵌套可转 JSON', M.xmlToJson(deep, { trimText: true }, 0).ok);

  const big = `<r>${'<i>x</i>'.repeat(2000)}</r>`;
  const bigJson = M.xmlToJson(big, { trimText: true }, 0);
  checkTrue('2000 个子元素的文档可转换', bigJson.ok);
  if (bigJson.ok) {
    check('重复子元素数组长度', bigJson.value.r.i.length, 2000);
  }
}

/* ------------------------------------------------------------------ *
 * 6. JSON to XML specifics
 * ------------------------------------------------------------------ */

section('JSON → XML');
{
  check('非法 JSON 报错', M.jsonToXml('{oops').ok, false);
  checkContains('非法 JSON 的错误信息', M.jsonToXml('{oops').error, 'JSON 解析失败');
  check('顶层数组报错', M.jsonToXml('[1,2]').ok, false);
  checkContains('顶层数组的提示', M.jsonToXml('[1,2]').error, '根元素名');
  check('顶层多键对象报错', M.jsonToXml('{"a":1,"b":2}').ok, false);
  checkContains('顶层多键的提示', M.jsonToXml('{"a":1,"b":2}').error, '只能有一个根元素');
  check('空顶层对象报错', M.jsonToXml('{}').ok, false);
  checkContains('空顶层对象的提示', M.jsonToXml('{}').error, '根元素名');
  check('指定根元素名后顶层数组报错', M.jsonToXml('[1,2]', { rootName: 'r' }).ok, false);
  checkContains('顶层数组加根元素名的提示', M.jsonToXml('[1,2]', { rootName: 'r' }).error, '数组');
  check(
    '指定根元素名后对象可用',
    M.jsonToXml('{"a":1}', { rootName: 'r', indent: 0, declaration: false }).text,
    '<r><a>1</a></r>',
  );
  check('指定根元素名后空对象可用', M.jsonToXml('{}', { rootName: 'r', indent: 0, declaration: false }).text, '<r/>');

  check(
    '非法元素名（数字开头）报错',
    M.jsonToXml('{"1a":1}').ok,
    false,
  );
  checkContains('数字开头名称的提示', M.jsonToXml('{"1a":1}').error, '不是合法的 XML 元素名');
  const sanitized = M.jsonToXml('{"r":{"1a":1,"b c":2}}', { indent: 0, declaration: false, nameFix: 'sanitize' });
  checkTrue('清洗模式下可用', sanitized.ok);
  check('清洗结果', sanitized.text, '<r><_1a>1</_1a><b_c>2</b_c></r>');
  checkTrue('清洗会产生警告', sanitized.warnings.length === 2);

  check('含 @ 的键报错', M.jsonToXml('{"a":{"@1x":"1"}}').ok, false);
  checkContains('非法属性名的提示', M.jsonToXml('{"a":{"@1x":"1"}}').error, '不是合法的 XML 名称');

  check(
    'null 变成空元素',
    M.jsonToXml('{"r":{"a":null}}', { indent: 0, declaration: false }).text,
    '<r><a/></r>',
  );
  check('null 作为 #text 报错', M.jsonToXml('{"r":{"#text":null}}').ok, false);
  checkContains('null 作为 #text 的提示', M.jsonToXml('{"r":{"#text":null}}').error, 'XML 没有 null');
  check('未知标签对象作为属性值报错', M.jsonToXml('{"r":{"@a":{}}}').ok, false);

  check(
    '紧凑模式：文本与子元素',
    M.jsonToXml('{"root":{"@id":"1","#text":"hi","child":"x"}}', { indent: 0, declaration: false }).text,
    '<root id="1">hi<child>x</child></root>',
  );
  check(
    'pretty 模式的确切输出',
    M.jsonToXml('{"root":{"@id":"1","#text":"hi","child":"x"}}', { indent: 2, declaration: false }).text,
    '<root id="1">\n  hi\n  <child>x</child>\n</root>\n',
  );
  check(
    '带 XML 声明',
    M.jsonToXml('{"r":1}', { indent: 0, declaration: true }).text,
    '<?xml version="1.0" encoding="UTF-8"?>\n<r>1</r>',
  );
  check(
    '文本中的特殊字符被转义',
    M.jsonToXml('{"r":"a<b>&c"}', { indent: 0, declaration: false }).text,
    '<r>a&lt;b&gt;&amp;c</r>',
  );
  check(
    '属性中的引号与换行被转义',
    M.jsonToXml('{"r":{"@a":"x\\"y\\nz"}}', { indent: 0, declaration: false }).text,
    '<r a="x&quot;y&#10;z"/>',
  );
  check('文本中的控制字符报错', M.jsonToXml('{"r":"a\\u0001b"}').ok, false);
  checkContains('控制字符的提示', M.jsonToXml('{"r":"a\\u0001b"}').error, '不允许的字符');
  check('数组的数组报错', M.jsonToXml('{"r":{"a":[[1]]}}').ok, false);
  checkContains('嵌套数组的提示', M.jsonToXml('{"r":{"a":[[1]]}}').error, '数组的数组');
  check('注释含双连字符报错', M.jsonToXml('{"r":{"#comment":"a--b"}}').ok, false);
  check('注释以连字符结尾报错', M.jsonToXml('{"r":{"#comment":"a-"}}').ok, false);
  check(
    '注释与处理指令可写回',
    M.jsonToXml('{"r":{"#comment":"hi","#pi":"t d","b":1}}', { indent: 0, declaration: false }).text,
    '<r><!--hi--><?t d?><b>1</b></r>',
  );
  check('xml 目标名的处理指令报错', M.jsonToXml('{"r":{"#pi":"xml x"}}').ok, false);
  check(
    '布尔与数字写成文本',
    M.jsonToXml('{"r":{"a":true,"b":1.5}}', { indent: 0, declaration: false }).text,
    '<r><a>true</a><b>1.5</b></r>',
  );
  check(
    '数组中的 null 元素',
    M.jsonToXml('{"r":{"a":[null,1]}}', { indent: 0, declaration: false }).text,
    '<r><a/><a>1</a></r>',
  );
}

/* ------------------------------------------------------------------ *
 * 7. The mapping is lossy, and the losses are asserted
 * ------------------------------------------------------------------ */

section('诚实断言：映射的有损之处');
{
  const mixed = M.xmlToJson('<a>x<b/>y</a>', { trimText: true }, 0);
  check('混合内容：文本被拼接、顺序丢失', mixed.value, { a: { '#text': 'xy', b: '' } });
  checkTrue('混合内容会给出警告', mixed.warnings.some((warning) => warning.includes('混合内容')));

  check('注释默认被丢弃', M.xmlToJson('<a><!--c--><b/></a>', { trimText: true }, 0).value, { a: { b: '' } });
  check(
    '开启后注释进入 #comment',
    M.xmlToJson('<a><!--c--><b/></a>', { trimText: true, keepComments: true }, 0).value,
    { a: { '#comment': 'c', b: '' } },
  );
  check(
    '多个注释成为数组',
    M.xmlToJson('<a><!--1--><!--2--></a>', { keepComments: true }, 0).value,
    { a: { '#comment': ['1', '2'] } },
  );

  check('自闭合与显式空元素不可区分', M.xmlToJson('<a/>', {}, 0).value, M.xmlToJson('<a></a>', {}, 0).value);
  check('两者都得到空字符串（包在根元素名下）', M.xmlToJson('<a/>', {}, 0).value, { a: '' });

  check('单个子元素不是数组', M.xmlToJson('<a><b>1</b></a>', {}, 0).value, { a: { b: '1' } });
  check('两个子元素是数组', M.xmlToJson('<a><b>1</b><b>2</b></a>', {}, 0).value, { a: { b: ['1', '2'] } });

  check('CDATA 与转义文本不可区分', M.xmlToJson('<a><![CDATA[<b>]]></a>', {}, 0).value, { a: '<b>' });
  const cdataBack = M.jsonToXml('{"a":"<b>"}', { indent: 0, declaration: false });
  check('CDATA 回写时变成转义文本', cdataBack.text, '<a>&lt;b&gt;</a>');

  check(
    '命名空间前缀按字面保留',
    M.xmlToJson('<s:a xmlns:s="urn:x"><s:b/></s:a>', {}, 0).value,
    { 's:a': { '@xmlns:s': 'urn:x', 's:b': '' } },
  );

  const whitespaceKept = M.xmlToJson('<a>\n  <b/>\n</a>', { trimText: false }, 0);
  checkTrue('关闭修剪后缩进进入 #text', String(whitespaceKept.value.a['#text']).includes('\n'));
  check('开启修剪后缩进被丢弃', M.xmlToJson('<a>\n  <b/>\n</a>', { trimText: true }, 0).value, { a: { b: '' } });
  check(
    '关闭顶层包装后得到裸对象',
    M.xmlToJson('<a><b>1</b></a>', { wrapRoot: false }, 0).value,
    { b: '1' },
  );
  checkTrue(
    '关闭顶层包装会给出警告',
    M.xmlToJson('<a><b>1</b></a>', { wrapRoot: false }, 0).warnings.some((w) => w.includes('根元素名')),
  );

  check(
    '数字与布尔回写后变成字符串（类型丢失）',
    (() => {
      const back = M.jsonToXml('{"r":{"n":42,"b":true}}', { indent: 0, declaration: false });
      return M.xmlToJson(back.text, { trimText: true }, 0).value;
    })(),
    { r: { n: '42', b: 'true' } },
  );

  checkTrue(
    '映射说明常量存在且说明了有损',
    M.MAPPING_NOTES.length >= 6 && M.MAPPING_NOTES.some((note) => note.includes('有损')),
  );
}

/* ------------------------------------------------------------------ *
 * 8. Counter-example: the naive regex approach really is wrong
 * ------------------------------------------------------------------ */

section('反证：用正则解析 XML 在嵌套同名标签上会出错');
{
  /**
   * The naive "just use a regex" parser: match an open tag, capture text up to
   * the closing tag with the same name, and record it. This is what a
   * hand-rolled string hack tends to look like.
   */
  function naiveRegexTree(xml) {
    const map = {};
    const re = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
    let match;
    while ((match = re.exec(xml)) !== null) {
      map[match[1]] = match[2];
    }
    return map;
  }

  const nestedSameName = '<a><a>1</a></a>';
  const naiveSameName = naiveRegexTree(nestedSameName);
  const truthSameName = myRootTree(nestedSameName);
  check('朴素正则把同名嵌套压成一个元素', naiveSameName, { a: '1' });
  check('真实结构：外层无文本', trimTree(truthSameName).text, '');
  check('真实结构：外层有一个子元素', truthSameName.children.length, 1);
  check('真实结构：子元素文本', truthSameName.children[0].texts, ['1']);
  checkTrue('朴素正则的结果与真实结构不同（证明结构断言能抓到它）', naiveSameName.a !== trimTree(truthSameName).text);

  const siblings = '<r><item>1</item><item>2</item></r>';
  const naiveSiblings = naiveRegexTree(siblings);
  check('朴素正则在后一个同名兄弟上覆盖前一个', naiveSiblings.item, '2');
  checkTrue('朴素正则完全找不到根元素（因为根元素含子标签）', naiveSiblings.r === undefined);
  check('真实结构的根标签', myRootTree(siblings).tag, 'r');
  check('真实结构有两个 item', myRootTree(siblings).children.length, 2);

  const attributes = '<a id="1">x</a>';
  check('朴素正则忽略属性', naiveRegexTree(attributes), { a: 'x' });
  check('真实结构带属性', myRootTree(attributes).attrs, { id: '1' });
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
console.log(pythonAvailable ? '（python3 xml.etree 参照物已启用）' : '（python3 xml.etree 不可用，已跳过交叉验证）');
process.exit(failed === 0 ? 0 : 1);
