/**
 * Checks the MIME type cheat sheet.
 *
 * The independent oracle is CPython's `mimetypes` module, which is a second,
 * separately maintained registry. The script feeds it every extension the tool
 * treats as primary and compares the answers:
 *
 *   - exact agreement is asserted to be at least 90 of 133;
 *   - disagreements that are purely a CPython version difference are listed
 *     separately in VERSION_DIVERGENCES, so the check tests the table rather
 *     than the interpreter's release;
 *   - every other disagreement must appear in DIVERGENCES below, together with the
 *     value Python produced and a reason. A new, undocumented disagreement
 *     fails the check, and so does a DIVERGENCES entry that no longer
 *     corresponds to a real disagreement (stale entry) — so the map cannot
 *     quietly turn into a rubber stamp.
 *
 * python3 is probed first; when it is missing the comparison is skipped with an
 * explicit message rather than silently passing.
 *
 * Usage: node scripts/check-mime-types.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/mime-types/mimeTypesUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/mime-types.mjs', compiled);
const M = await import(pathToFileURL('.verify/mime-types.mjs').href);

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

console.log('--- 表内结构不变量 ---');
{
  const types = M.MIME_ENTRIES.map((e) => e.type);
  check('MIME 类型无重复', types.length - new Set(types).size, 0);

  const invalid = M.MIME_ENTRIES.filter((e) => !M.isValidMimeType(e.type)).map((e) => e.type);
  check('所有类型都符合 type/subtype 格式', invalid, []);

  const badExt = [];
  for (const entry of M.MIME_ENTRIES) {
    for (const ext of entry.extensions) {
      if (ext !== M.normalizeExtension(ext) || ext === '' || ext.includes('.')) {
        badExt.push(`${entry.type}: ${ext}`);
      }
    }
    if (new Set(entry.extensions).size !== entry.extensions.length) {
      badExt.push(`${entry.type}: 扩展名重复`);
    }
  }
  check('扩展名都已规范（小写、无点、非空、不重复）', badExt, []);

  const missingZh = M.MIME_ENTRIES.filter((e) => !e.zh || e.zh.length === 0).map((e) => e.type);
  check('每条都有中文说明', missingZh, []);

  const validCategories = new Set(M.MIME_CATEGORY_ORDER);
  const badCategory = M.MIME_ENTRIES.filter((e) => !validCategories.has(e.category)).map((e) => e.type);
  check('所有 category 都是允许值', badCategory, []);

  const counts = M.categoryCounts();
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  check('分类计数之和等于表长', sum, M.MIME_ENTRIES.length);
  check('分类计数与逐条统计一致', counts.image, M.MIME_ENTRIES.filter((e) => e.category === 'image').length);
}

console.log('--- 双向查询必须对得上 ---');
{
  const broken = [];
  for (const entry of M.MIME_ENTRIES) {
    if (M.lookupByType(entry.type)?.type !== entry.type) broken.push(`按类型查不到 ${entry.type}`);
    const back = M.extensionsOfType(entry.type);
    if (JSON.stringify(back) !== JSON.stringify(entry.extensions)) {
      broken.push(`${entry.type} 的扩展名回环不一致`);
    }
    for (const ext of entry.extensions) {
      const all = M.entriesForExtension(ext).map((e) => e.type);
      if (!all.includes(entry.type)) broken.push(`${ext} 查不到 ${entry.type}`);
    }
  }
  check('每条类型都能被类型查到、扩展名原样返回', broken, []);

  // The primary extension must round-trip through the reverse lookup.
  const primaryBroken = [];
  for (const ext of M.allExtensions()) {
    const primary = M.lookupByExtension(ext);
    if (!primary || !primary.extensions.includes(ext)) primaryBroken.push(ext);
    if (!M.entriesForExtension(ext).includes(primary)) primaryBroken.push(ext);
  }
  check('主查询返回的条目确实声明了该扩展名', primaryBroken, []);
  check('扩展名索引非空', M.allExtensions().length > 100, true);
}

console.log('--- 规范化与校验 ---');
{
  check('去参数并小写', M.normalizeMimeType('  Text/HTML; charset=UTF-8  '), 'text/html');
  check('只有分号参数时为空', M.normalizeMimeType('; charset=x'), '');
  check('扩展名去点并小写', M.normalizeExtension('  .PNG '), 'png');
  check('多个点都去掉', M.normalizeExtension('..Jpg'), 'jpg');
  check('空扩展名安全', M.normalizeExtension('   '), '');

  check('合法：text/plain', M.isValidMimeType('text/plain'), true);
  check('合法：application/vnd.api+json', M.isValidMimeType('application/vnd.api+json'), true);
  check('合法：image/svg+xml（带加号后缀）', M.isValidMimeType('image/svg+xml'), true);
  check('带参数也合法（先规范化）', M.isValidMimeType('text/html; charset=utf-8'), true);
  check('非法：没有斜杠', M.isValidMimeType('text'), false);
  check('非法：缺子类型', M.isValidMimeType('text/'), false);
  check('非法：缺主类型', M.isValidMimeType('/plain'), false);
  check('非法：两段斜杠', M.isValidMimeType('text/plain/extra'), false);
  check('非法：空格', M.isValidMimeType('text plain'), false);
  check('非法：空字符串', M.isValidMimeType(''), false);
  check('非法：大写？不，规范化后合法', M.isValidMimeType('TEXT/PLAIN'), true);
  check('通配符默认非法', M.isValidMimeType('image/*'), false);
  check('通配符显式允许时合法', M.isValidMimeType('image/*', { allowWildcard: true }), true);
  check('非法：中文子类型', M.isValidMimeType('text/中文'), false);
}

console.log('--- 已知映射（题目要求的方向都能查） ---');
{
  check('html -> text/html', M.lookupByExtension('html').type, 'text/html');
  check('HTML 大写也认', M.lookupByExtension('HTML').type, 'text/html');
  check('.css 带点也认', M.lookupByExtension('.css').type, 'text/css');
  check('png -> image/png', M.lookupByExtension('png').type, 'image/png');
  check('jpg -> image/jpeg', M.lookupByExtension('jpg').type, 'image/jpeg');
  check('mp4 -> video/mp4', M.lookupByExtension('mp4').type, 'video/mp4');
  check('woff2 -> font/woff2', M.lookupByExtension('woff2').type, 'font/woff2');
  check(
    'docx -> 长 OOXML 类型',
    M.lookupByExtension('docx').type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  check('application/json -> json', M.primaryExtensionOfType('application/json'), 'json');
  check('font/woff2 -> woff2', M.primaryExtensionOfType('font/woff2'), 'woff2');
  check('未知扩展名返回 null', M.lookupByExtension('notarealext'), null);
  check('未知类型返回 null', M.lookupByType('nope/nope'), null);
  check('未知类型的扩展名是空表', M.extensionsOfType('nope/nope'), []);
}

console.log('--- 一个扩展名对应多个类型（不假装唯一） ---');
{
  const ts = M.entriesForExtension('ts').map((e) => e.type);
  check('.ts 同时是 TypeScript 与 MPEG 传输流', ts.sort(), ['text/typescript', 'video/mp2t']);
  const xml = M.entriesForExtension('xml').map((e) => e.type).sort();
  check('.xml 同时有 text 与 application 注册', xml, ['application/xml', 'text/xml']);
  check('主查询给出其中一个（不报错）', typeof M.lookupByExtension('ts').type, 'string');
  check('没有任何条目的扩展名是空表', M.entriesForExtension('nope'), []);

  // The naive "one type per extension" assumption would lose this information;
  // assert explicitly that collapsing to the first hit would drop a real type.
  check('只取第一条会丢掉 video/mp2t', M.entriesForExtension('ts').length > 1, true);
}

console.log('--- category 与 prefix 不是一回事 ---');
{
  check('image/png 是 image', M.categoryOfMimeType('image/png'), 'image');
  check('font/woff2 是 font', M.categoryOfMimeType('font/woff2'), 'font');
  check('multipart/form-data 是 multipart', M.categoryOfMimeType('multipart/form-data'), 'multipart');
  check('application/json 是 application', M.categoryOfMimeType('application/json'), 'application');
  check('未知前缀返回 null', M.categoryOfMimeType('nonsense/thing'), null);
  // eot is registered as application/vnd.ms-fontobject but is a font file; the
  // registry overrides the prefix. A naive prefix rule would file it under
  // "应用/二进制" and hide it from the font filter.
  const eot = M.lookupByType('application/vnd.ms-fontobject');
  check('eot 的前缀是 application', M.categoryOfMimeType(eot.type), 'application');
  check('但注册表把它归入 font（前缀规则会分错）', eot.category, 'font');
}

console.log('--- 可读性与压缩标记 ---');
{
  check('text/* 是文本', M.isTextType('text/html'), true);
  check('application/json 不是 text/*', M.isTextType('application/json'), false);
  check('但 JSON 标为可读', M.isReadableType('application/json'), true);
  check('SVG 是可读的 XML', M.isReadableType('image/svg+xml'), true);
  check('PNG 不可读', M.isReadableType('image/png'), false);
  check('未知类型不谎称可读', M.isReadableType('nope/nope'), false);
  check('zip 是压缩容器', M.isCompressedType('application/zip'), true);
  check('gzip 是压缩容器', M.isCompressedType('application/gzip'), true);
  check('docx 是 ZIP 容器', M.isCompressedType(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ), true);
  check('tar 也算归档（虽然本身不压缩）', M.isCompressedType('application/x-tar'), true);
  // PNG is compressed data, but it is not an archive: flagging it would tell the
  // user to unpack a file the browser decodes directly.
  check('PNG 不是归档', M.isCompressedType('image/png'), false);
  check('WOFF 不是归档', M.isCompressedType('font/woff'), false);
  check('未知类型不谎称压缩', M.isCompressedType('nope/nope'), false);
  const readableButNotText = M.MIME_ENTRIES.filter(
    (e) => e.readable && !M.isTextType(e.type),
  ).map((e) => e.type);
  check('确实存在「可读但不是 text/」的条目', readableButNotText.length > 0, true);
}

console.log('--- 搜索 ---');
{
  check('空查询返回全表', M.searchMimeEntries('').length, M.MIME_ENTRIES.length);
  check('按扩展名搜到 png', M.searchMimeEntries('png').some((e) => e.type === 'image/png'), true);
  check('带点的 .png 与不带点结果相同', M.searchMimeEntries('.png').length, M.searchMimeEntries('png').length);
  check('按类型搜到 image', M.searchMimeEntries('image/jpeg').some((e) => e.type === 'image/jpeg'), true);
  check('按中文说明搜到图片', M.searchMimeEntries('矢量').some((e) => e.type === 'image/svg+xml'), true);
  const multi = M.searchMimeEntries('image png');
  check(
    '多个词是与关系，且按子串命中（apng 也含 "png"）',
    multi.map((e) => e.type),
    ['image/png', 'image/apng'],
  );
  check('多词会收窄结果', M.searchMimeEntries('image png').length < M.searchMimeEntries('image').length, true);
  check('按类别筛选只返回该类', M.searchMimeEntries('', 'audio').every((e) => e.category === 'audio'), true);
  check('类别筛选数量等于计数', M.searchMimeEntries('', 'audio').length, M.categoryCounts().audio);
  check('搜不到的返回空表', M.searchMimeEntries('zzzz-not-here'), []);
  check('搜索大小写不敏感', M.searchMimeEntries('PNG').length, M.searchMimeEntries('png').length);
  check('搜索解释性字段（RFC）', M.searchMimeEntries('RFC 2046').length > 0, true);
}

console.log('--- 导出 ---');
{
  const png = M.lookupByExtension('png');
  check('单行导出使用制表符分隔', M.entryToLine(png).split('\t').length, 5);
  check('单行导出以扩展名开头', M.entryToLine(png).split('\t')[0], '.png');
  check('单行导出第二列是类型', M.entryToLine(png).split('\t')[1], 'image/png');
  const tsv = M.entriesToTsv([png]).split('\n');
  check('TSV 表头', tsv[0], '扩展名\tMIME 类型\t说明\t可读性\t压缩');
  check('TSV 数据行', tsv[1].split('\t')[1], 'image/png');
  check('无扩展名的类型也能导出', M.entryToLine(M.lookupByType('multipart/form-data')).startsWith('（无扩展名）'), true);
}

console.log('--- 畸形输入不崩 ---');
{
  check('null 类型安全', M.lookupByType(null), null);
  check('数字类型安全', M.lookupByExtension(123), null);
  check('undefined 安全', M.normalizeMimeType(undefined), '');
  check('超长类型安全（返回 null 而不是抛异常）', M.lookupByType('a/'.repeat(5000)), null);
  check('超长扩展名安全', M.lookupByExtension('x'.repeat(10000)), null);
  check('超长查询安全', M.searchMimeEntries('x'.repeat(10000)), []);
  check('emoji 查询安全', M.searchMimeEntries('😀'), []);
  check('emoji 扩展名安全', M.lookupByExtension('😀'), null);
  check('中文类型名不崩', M.isValidMimeType('文本/纯文本'), false);
}

console.log('--- 权威参照物：CPython mimetypes ---');
{
  const version = spawnSync('python3', ['-c', 'import sys; print(sys.version.split()[0])'], {
    encoding: 'utf8',
  });
  const available = version.status === 0 && version.stdout.trim() !== '';

  if (!available) {
    console.log('SKIP  python3 不可用，跳过与 CPython mimetypes 的比对（这一项没有通过，只是明确跳过）');
  } else {
    console.log(`      使用 CPython ${version.stdout.trim()} 的 mimetypes 模块作为独立参照`);

    // Primary extension -> type pairs: the mapping the reverse lookup reports.
    const pairs = [];
    for (const entry of M.MIME_ENTRIES) {
      for (const ext of entry.extensions) {
        if (M.lookupByExtension(ext).type === entry.type) pairs.push([ext, entry.type]);
      }
    }

    const probe = [
      'import mimetypes, json, sys',
      'mimetypes.init()',
      'out = []',
      'for e in sys.argv[1:]:',
      '    t, enc = mimetypes.guess_type("x." + e)',
      '    out.append([e, t, enc])',
      'print(json.dumps(out))',
    ].join('\n');
    const result = spawnSync('python3', ['-c', probe, ...pairs.map((p) => p[0])], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      check('python3 子进程正常退出', result.status, 0);
    } else {
      const answers = new Map(JSON.parse(result.stdout).map((row) => [row[0], row[1]]));

      /**
       * Every extension where the two tables disagree, with Python's answer and
       * why this table keeps its own. `python: null` means Python knows the
       * extension only as a compression encoding (gz/bz2/xz) or not at all.
       */
      const DIVERGENCES = {
        xml: {
          ours: 'text/xml',
          python: 'application/xml',
          reason: 'RFC 7303 两个都注册；本表把 text/xml 作为 .xml 的首选，Python 选 application/xml。',
        },
        c: { ours: 'text/x-c', python: 'text/x-csrc', reason: '两者都未注册，命名习惯不同。' },
        cpp: {
          ours: 'text/x-c++',
          python: 'text/x-c++src',
          reason: '两者都未注册，命名习惯不同。',
        },
        cc: {
          ours: 'text/x-c++',
          python: 'text/x-c++src',
          reason: '两者都未注册，命名习惯不同。',
        },
        cxx: {
          ours: 'text/x-c++',
          python: 'text/x-c++src',
          reason: '两者都未注册，命名习惯不同。',
        },
        hpp: {
          ours: 'text/x-c++',
          python: 'text/x-c++hdr',
          reason: '本表把 .hpp 并入 C++ 源码；Python 单列头文件类型。',
        },
        java: { ours: 'text/x-java-source', python: 'text/x-java', reason: '两者都未注册，命名习惯不同。' },
        rs: {
          ours: 'text/x-rust',
          python: 'application/rls-services+xml',
          reason: 'Python 的这一行是过时错误：application/rls-services+xml 是 RDF 词汇表，不是 Rust 源码。',
        },
        ts: {
          ours: 'text/typescript',
          python: 'text/vnd.trolltech.linguist',
          reason: '.ts 撞名：Python 选 Qt 翻译文件，本表选 TypeScript；两种解释都在本表中列出。',
        },
        mts: {
          ours: 'text/typescript',
          python: 'model/vnd.mts',
          reason: '.mts 同时是 IANA 注册的 model/vnd.mts 与 TypeScript 模块文件，本表按后者。',
        },
        wav: {
          ours: 'audio/wav',
          python: 'audio/x-wav',
          reason: 'audio/x-wav 是历史别名，IANA 现登记 audio/wav。',
        },
        mid: {
          ours: 'audio/midi',
          python: 'audio/sp-midi',
          reason: 'Python 把 .mid 指向 SP-MIDI 子集；通用类型是 audio/midi。',
        },
        '3gp': {
          ours: 'video/3gpp',
          python: 'audio/3gpp',
          reason: '.3gp 通常是视频容器，RFC 3839 注册 video/3gpp；Python 选了纯音频变体。',
        },
        xsl: {
          ours: 'application/xml',
          python: 'application/xslt+xml',
          reason: 'Python 为 .xsl 用 x- 后缀类型；本表归入 application/xml。',
        },
        xslt: {
          ours: 'application/xml',
          python: 'application/xslt+xml',
          reason: '同上。',
        },
        rss: {
          ours: 'application/rss+xml',
          python: 'application/x-rss+xml',
          reason: '两者都未在 IANA 注册，x- 前缀版本更旧。',
        },
        tgz: {
          ours: 'application/gzip',
          python: 'application/x-tar',
          reason: 'Python 把压缩后缀解析成编码，只返回基础类型；本表作为文件名给出压缩类型。',
        },
        tbz2: {
          ours: 'application/x-bzip2',
          python: 'application/x-tar',
          reason: '同 .tgz：Python 剥掉 bzip2 编码后只剩 tar。',
        },
        txz: {
          ours: 'application/x-xz',
          python: 'application/x-tar',
          reason: '同 .tgz：Python 剥掉 xz 编码后只剩 tar。',
        },
        dll: {
          ours: 'application/octet-stream',
          python: 'application/x-msdos-program',
          reason: 'nginx 等把 .dll 归为 octet-stream，Python 把它与 .exe 同类；两者都只是惯例。',
        },
        // Python reports these three as a Content-Encoding, not as a type.
        gz: {
          ours: 'application/gzip',
          python: null,
          reason: 'Python 把 .gz 解析为 gzip 编码而不是媒体类型；作为文件它应是 application/gzip。',
        },
        bz2: {
          ours: 'application/x-bzip2',
          python: null,
          reason: '同 .gz：Python 只给出 bzip2 编码。',
        },
        xz: {
          ours: 'application/x-xz',
          python: null,
          reason: '同 .gz：Python 只给出 xz 编码。',
        },
      };

      /**
       * Extensions CPython has no row for at all. Pinned so that a new
       * extension added to the table must either agree with Python or be
       * justified above; it cannot quietly fall through as "Python is silent".
       */
      const PYTHON_UNKNOWN = new Set([
        'log',
        'cjs',
        'bash',
        'cts',
        'm4b',
        'weba',
        'midi',
        'map',
        'xsd',
        'php',
        'dat',
      ]);

      const undocumented = [];
      /**
       * Divergences that exist only because CPython's own table changed between
       * releases — recorded with the Python answer each one is known to produce.
       *
       * This check ran green locally (CPython 3.13.5) and red in CI (3.12.3) on
       * exactly two extensions, because Python *gained* `application/toml` in
       * 3.13 and *changed* `mkv` to `video/matroska` — both times agreeing with
       * this table. Pinning "every divergence is documented" to one Python
       * release makes the check a test of the interpreter's version rather than
       * of the table, so these are listed as their own category.
       *
       * A disagreement that is not in this list and not in DIVERGENCES still
       * fails, which is what keeps the check meaningful.
       */
      const VERSION_DIVERGENCES = {
        mkv: {
          "video/x-matroska":
            'CPython 3.12 及更早用 video/x-matroska；3.13 起改为 video/matroska，与本表一致。',
        },
        toml: {
          null: 'CPython 3.13 起才收录 .toml（application/toml），与本表一致；更早版本不认识它。',
        },
      };

      const seenDivergences = new Set();
      const seenVersionDivergences = new Set();
      const unknowns = new Set();
      let matches = 0;
      for (const [ext, ours] of pairs) {
        const python = answers.get(ext) ?? null;
        if (python === ours) {
          matches += 1;
          continue;
        }
        const documented = DIVERGENCES[ext];
        if (documented && documented.ours === ours) {
          seenDivergences.add(ext);
          // Pin Python's answer too, so the justification cannot go stale if
          // the comparison silently starts disagreeing for a different reason.
          if (documented.python !== python) {
            undocumented.push(`${ext}: 记录的分歧是 Python ${documented.python}，实际 ${python}`);
          }
          continue;
        }
        if (python === null && PYTHON_UNKNOWN.has(ext)) {
          unknowns.add(ext);
          continue;
        }
        const byVersion = VERSION_DIVERGENCES[ext];
        if (byVersion && Object.prototype.hasOwnProperty.call(byVersion, String(python))) {
          seenVersionDivergences.add(ext);
          continue;
        }
        undocumented.push(`${ext}: 本表 ${ours} / Python ${python}`);
      }

      check(`与 CPython 完全一致的比例（${matches}/${pairs.length}）至少 90 条`, matches >= 90, true);
      check('每一处不一致都有记录且理由对得上', undocumented, []);
      const stale = Object.keys(DIVERGENCES).filter((ext) => !seenDivergences.has(ext));
      check('记录的分歧没有过时项（每个都仍是真实分歧）', stale, []);
      check(
        '一致 + 已记录分歧 + 版本导致的分歧 + Python 未收录 = 全部比对项',
        matches + seenDivergences.size + seenVersionDivergences.size + unknowns.size,
        pairs.length,
      );
      // Which version divergences actually appear depends on the running
      // interpreter — on 3.13 both of them agree with this table, so the set is
      // legitimately empty there. Asserting the set itself would just be a test
      // of the Python version again, so instead the table's own consistency is
      // asserted, and the observed set is reported for information.
      const recordedVersionKeys = Object.keys(VERSION_DIVERGENCES);
      check(
        '版本分歧记录的扩展名都在比对表里（没有拼错或失效的键）',
        recordedVersionKeys.filter((ext) => !pairs.some(([candidate]) => candidate === ext)),
        [],
      );
      check(
        '版本分歧与普通分歧不重叠（同一个扩展名只会走一条分支）',
        recordedVersionKeys.filter((ext) => DIVERGENCES[ext]),
        [],
      );
      console.log(
        `      本次实际出现的版本分歧：${seenVersionDivergences.size > 0 ? [...seenVersionDivergences].join(', ') : '（无，当前解释器与本表一致）'}`,
      );
      check(
        'Python 未收录的扩展名与预期清单一致',
        [...unknowns].sort(),
        [...PYTHON_UNKNOWN].sort(),
      );
      const knownToPython = pairs.filter(([ext]) => answers.get(ext) !== null).length;
      check(`Python 认识其中 ${knownToPython} 条扩展名（其余未注册）`, knownToPython >= 115, true);

      // Encoding-only answers: Python reports gz/bz2/xz as a Content-Encoding
      // rather than a type, which is exactly the distinction the tool explains.
      const encodingOnly = ['gz', 'bz2', 'xz'];
      const encodingShape = [];
      for (const ext of encodingOnly) {
        const row = spawnSync(
          'python3',
          ['-c', `import mimetypes; print(mimetypes.guess_type("x.${ext}")[1] or "")`],
          { encoding: 'utf8' },
        );
        encodingShape.push([ext, answers.get(ext), row.stdout.trim()]);
      }
      check(
        'gz/bz2/xz 在 Python 里是编码而不是类型（本表给出了文件类型）',
        encodingShape,
        [
          ['gz', null, 'gzip'],
          ['bz2', null, 'bzip2'],
          ['xz', null, 'xz'],
        ],
      );
    }
  }
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
