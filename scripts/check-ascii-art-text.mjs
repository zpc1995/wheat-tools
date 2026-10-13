/**
 * Checks the ASCII art text renderer.
 *
 * The claim that matters here is "the artwork lines up". Every failure mode of
 * a FIGlet-style renderer is a misalignment: one glyph with five rows instead
 * of six, one glyph wider than its stored width, one character with no glyph
 * that silently renders as nothing, or letter spacing applied between some
 * pairs and not others. So the checks are mostly structural invariants over the
 * whole font, not spot checks of one nice-looking string.
 *
 * The independent reference is the upstream font itself. `scripts/fixtures/
 * figlet-standard-ascii.flf` is a frozen copy of the ASCII block of the FIGlet
 * `standard` face, in real FLF format (endmarks and hardblanks included), taken
 * from patorjk/figlet.js. This script runs its own FLF parser over that file
 * and compares every one of the 95 glyphs row by row and column by column
 * against the table the tool ships, then re-renders sample strings from the
 * reference glyphs and compares the full output. A hand-typed glyph, a dropped
 * row or an off-by-one width is therefore caught by data the implementation did
 * not produce.
 *
 * pyfiglet would be a second reference, but it is an optional dependency and is
 * not installed in this environment; the script says so explicitly rather than
 * skipping silently, and uses it when it is importable.
 *
 * Usage: node scripts/check-ascii-art-text.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const OUT_DIR = '.verify/ascii-art-text';
mkdirSync(OUT_DIR, { recursive: true });

const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };

function transpile(from, to) {
  writeFileSync(to, ts.transpileModule(readFileSync(from, 'utf8'), { compilerOptions }).outputText);
}

transpile('src/tools/ascii-art-text/figletStandardFont.ts', `${OUT_DIR}/figletStandardFont.mjs`);

// The import specifier has to be rewritten because Node's ESM resolver does not
// add extensions: the compiled utils ask for './figletStandardFont', and the
// compiled file next to it is '.mjs'.
const utilsSource = ts
  .transpileModule(readFileSync('src/tools/ascii-art-text/asciiArtUtils.ts', 'utf8'), {
    compilerOptions,
  })
  .outputText.replace(/from '\.\/figletStandardFont'/g, "from './figletStandardFont.mjs'");
writeFileSync(`${OUT_DIR}/asciiArtUtils.mjs`, utilsSource);

const M = await import(pathToFileURL(`${OUT_DIR}/asciiArtUtils.mjs`).href);
const F = await import(pathToFileURL(`${OUT_DIR}/figletStandardFont.mjs`).href);

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

/** Reports a count of collected problems, printing the first few. */
function checkNoProblems(label, problems) {
  if (problems.length > 0) {
    console.log(`        ${problems.slice(0, 5).join('\n        ')}`);
  }
  check(label, problems.length, 0);
}

console.log('--- 独立参照：解析上游 FLF 字体文件 ---');

const FIXTURE = 'scripts/fixtures/figlet-standard-ascii.flf';

/**
 * A minimal but real FLF parser.
 *
 * Deliberately written here rather than shared with the tool: a reference that
 * reuses the implementation's reader proves nothing about the data.
 */
function parseFlf(path) {
  if (!existsSync(path)) {
    console.log(`FAIL  找不到参照字体文件 ${path}`);
    process.exit(1);
  }
  const lines = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const header = /^flf2a(.?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(lines[0]);
  if (!header) throw new Error(`参照文件头不是合法的 FLF 头：${lines[0]}`);
  const hardblank = header[1] || ' ';
  const height = Number(header[2]);
  const commentLines = Number(header[6]);

  let cursor = 1 + commentLines;
  const endmark = lines[cursor][lines[cursor].length - 1];
  const glyphs = new Map();

  for (let code = 32; code <= 126; code += 1) {
    const rows = [];
    for (let row = 0; row < height; row += 1) {
      const line = lines[cursor];
      cursor += 1;
      if (line === undefined) throw new Error(`参照文件在码位 ${code} 处提前结束`);
      if (line[line.length - 1] !== endmark) {
        throw new Error(`参照文件码位 ${code} 第 ${row + 1} 行缺少结束标记 ${endmark}`);
      }
      let body = line.slice(0, -1);
      // The endmark is doubled on a glyph's final row.
      if (row === height - 1 && body[body.length - 1] === endmark) body = body.slice(0, -1);
      rows.push(body.split(hardblank).join(' '));
    }
    const width = rows[0].length;
    if (rows.some((row) => row.length !== width)) {
      throw new Error(`参照文件码位 ${code} 的各行宽度不一致`);
    }
    glyphs.set(code, { rows, width });
  }
  return { hardblank, height, endmark, glyphs };
}

const flf = parseFlf(FIXTURE);
check('参照字体为 6 行高', flf.height, 6);
check('参照字体共 95 个字形（U+0020–U+007E）', flf.glyphs.size, 95);
check('参照字体与工具声明的高度一致', flf.height, F.FONT_HEIGHT);
check('参照字体与工具声明的码位范围一致', [32, 126], [F.FONT_FIRST_CODE, F.FONT_LAST_CODE]);

console.log('--- 字形数据逐行对照上游 ---');
{
  const mismatch = [];
  for (const [code, glyph] of flf.glyphs) {
    const toolWidth = F.FONT_WIDTHS[code - 32];
    const toolRows = F.FONT_GLYPHS[code - 32];
    if (toolWidth !== glyph.width) {
      mismatch.push(`码位 ${code} 宽度：工具 ${toolWidth}，上游 ${glyph.width}`);
      continue;
    }
    if (toolRows.length !== glyph.rows.length) {
      mismatch.push(`码位 ${code} 行数：工具 ${toolRows.length}，上游 ${glyph.rows.length}`);
      continue;
    }
    for (let row = 0; row < glyph.rows.length; row += 1) {
      // The shipped table stores rows right-trimmed; padding back to the width
      // has to reproduce the upstream row exactly.
      const padded = toolRows[row].padEnd(toolWidth, ' ');
      if (padded !== glyph.rows[row]) {
        mismatch.push(`码位 ${code} 第 ${row + 1} 行不同：工具 ${JSON.stringify(padded)}，上游 ${JSON.stringify(glyph.rows[row])}`);
      }
    }
  }
  checkNoProblems('95 个字形与上游 Standard.flf 逐行逐列一致（含宽度）', mismatch);
}

console.log('--- 等高与等宽：错位的根源 ---');
{
  const badHeightTool = [];
  const badHeightRef = [];
  const badWidthTool = [];
  const trailing = [];
  for (let code = 32; code <= 126; code += 1) {
    const rows = F.FONT_GLYPHS[code - 32];
    if (rows.length !== F.FONT_HEIGHT) badHeightTool.push(`码位 ${code} 有 ${rows.length} 行`);
    if (flf.glyphs.get(code).rows.length !== flf.height) badHeightRef.push(`码位 ${code}`);
    rows.forEach((row, index) => {
      if (row.length > F.FONT_WIDTHS[code - 32]) badWidthTool.push(`码位 ${code} 第 ${index + 1} 行过长`);
      if (row !== row.replace(/ +$/, '')) trailing.push(`码位 ${code} 第 ${index + 1} 行有行尾空格`);
    });
  }
  checkNoProblems('工具内每个字形都恰好 6 行（少一行后面全部错位）', badHeightTool);
  checkNoProblems('参照字体每个字形都恰好 6 行', badHeightRef);
  checkNoProblems('没有字形行超过它声明的宽度', badWidthTool);
  checkNoProblems('字形数据不含行尾空格（否则会被格式化工具悄悄吃掉）', trailing);
  check('宽度表与字形表一一对应', [F.FONT_WIDTHS.length, F.FONT_GLYPHS.length], [95, 95]);

  // A naive renderer that forgets to restore each glyph's own width produces
  // rows of differing length, which is exactly the shearing this font data
  // exists to prevent. The assertion proves the invariant above has teeth.
  const naiveRows = [];
  const glyphs = ['A', 'B'].map((char) => flf.glyphs.get(char.codePointAt(0)));
  for (let row = 0; row < flf.height; row += 1) {
    naiveRows.push(glyphs.map((glyph) => glyph.rows[row].replace(/ +$/, '')).join(''));
  }
  const naiveWidths = new Set(naiveRows.map((row) => row.length));
  check('朴素拼接（不补齐字形宽度）会产生不等宽的行，说明该不变量有区分力', naiveWidths.size > 1, true);
  const realWidths = new Set(M.renderLine('AB', 0).map((row) => row.length));
  check('本实现拼接后的每一行等宽', realWidths.size, 1);
}

console.log('--- 字符覆盖与不支持字符的处理 ---');
{
  const missing = [];
  for (const char of M.supportedCharacters()) {
    const glyph = M.getGlyph(char);
    if (!glyph || glyph.rows.length !== F.FONT_HEIGHT) missing.push(JSON.stringify(char));
  }
  checkNoProblems('支持范围内 95 个字符全部有定义且为 6 行', missing);
  check('支持字符数是 95', M.supportedCharacters().length, 95);
  check('空格有字形且宽度为 2 列（为 0 会把单词粘在一起）', M.getGlyph(' ').width, 2);
  check('上游参照里空格宽度同样是 2', flf.glyphs.get(32).width, 2);

  check('中文没有字形', M.getGlyph('中'), null);
  check('emoji 没有字形', M.getGlyph('😀'), null);
  check('空字符串没有字形', M.getGlyph(''), null);
  check('换行符没有字形', M.getGlyph('\n'), null);

  check('不支持的字符被列出且去重、保持首次出现顺序', M.unsupportedCharacters('中文 ab 中文 😀'), ['中', '文', '😀']);
  check('制表符不算不支持的字符（按一个空格处理）', M.unsupportedCharacters('a\tb'), []);

  const withChinese = M.renderAsciiArt('AB中');
  const withoutChinese = M.renderAsciiArt('AB');
  check('掺入中文后画面与纯 AB 完全相同（是丢弃而不是画乱码）', withChinese.lines, withoutChinese.lines);
  check('同时把丢弃的字符报出来', withChinese.unsupported, ['中']);

  const onlyChinese = M.renderAsciiArt('中文');
  check('全是不支持字符时报告它们', onlyChinese.unsupported, ['中', '文']);
  check('全是不支持字符时不产出任何图形内容', onlyChinese.lines.every((row) => row === ''), true);
  check('全是不支持字符时仍占 1 行输入 * 6 行高', onlyChinese.lines.length, 6);
  check('两行全是中文时占 12 行', M.renderAsciiArt('中\n文').lines.length, 12);
  check('不会把不支持的字符替换成问号冒充正常输出', M.renderAsciiArt('中A').lines.join('\n').includes('?'), false);
}

console.log('--- 字距一致 ---');
{
  const width = (char) => F.FONT_WIDTHS[char.codePointAt(0) - 32];
  const problems = [];
  const spacingWidths = [];
  for (let spacing = 0; spacing <= M.MAX_SPACING; spacing += 1) {
    const rows = M.renderLine('ABC', spacing);
    if (new Set(rows.map((row) => row.length)).size !== 1) problems.push(`字距 ${spacing} 的行宽不一致`);
    const expected = width('A') + width('B') + width('C') + spacing * 2;
    if (rows[0].length !== expected) problems.push(`字距 ${spacing} 宽度 ${rows[0].length}，应为 ${expected}`);
    spacingWidths.push(rows[0].length);
  }
  checkNoProblems('字距 0–6 下渲染 ABC 的行宽都等于 宽度之和 + 字距 * 间隔数', problems);
  check(
    '字距 0 时宽度就是三个字形宽度之和',
    spacingWidths[0],
    width('A') + width('B') + width('C'),
  );
  check(
    '字距每加 1，宽度只增加 2 列（3 个字符之间只有 2 个间隔）',
    spacingWidths.slice(1).map((value, index) => value - spacingWidths[index]),
    [2, 2, 2, 2, 2, 2],
  );

  check('字距为负按 0 处理', M.renderLine('AB', -3), M.renderLine('AB', 0));
  check('字距超上限按上限处理', M.renderLine('AB', 99), M.renderLine('AB', M.MAX_SPACING));
  check('字距为 NaN 时回落到默认 1', M.renderLine('AB', Number.NaN), M.renderLine('AB', 1));
  check('单个字符的字距不影响宽度', M.renderLine('A', 5), M.renderLine('A', 0));
}

console.log('--- 多行与空输入 ---');
{
  check('空字符串不产出任何行', M.renderAsciiArt('').lines, []);
  check('空字符串的宽度为 0', M.renderAsciiArt('').width, 0);
  check('只有一个换行按两行处理', M.renderAsciiArt('\n').lines.length, 12);
  check('单行 6 行高', M.renderAsciiArt('A').lines.length, F.FONT_HEIGHT);
  check('三行文本得到 18 行', M.renderAsciiArt('A\nB\nC').lines.length, 18);
  check('CRLF 与 LF 结果一致', M.renderAsciiArt('A\r\nB').lines, M.renderAsciiArt('A\nB').lines);

  const blank = M.renderAsciiArt('A\n\nB');
  check('中间的空行照样占 6 行', blank.lines.length, 18);
  check('中间空行的 6 行确实是空的', blank.lines.slice(6, 12), Array.from({ length: 6 }, () => ''));
  check('空白输入不崩且只产出空行', M.renderAsciiArt('   ').lines, Array.from({ length: 6 }, () => ''));
}

console.log('--- 对齐、填充与宽度 ---');
{
  const art = M.renderAsciiArt('Hi');
  const natural = art.artWidth;
  check('不设宽度时不填充', art.lines.every((row) => row === row.replace(/ +$/, '')), true);
  check('不设宽度时宽度就是自然宽度', art.width, natural);

  const wide = M.renderAsciiArt('Hi', { width: 40, align: 'left' });
  check('左对齐后每行都是 40 列', [...new Set(wide.lines.map((row) => row.length))], [40]);
  check(
    '左对齐时每行就是原作右补空格到 40 列',
    wide.lines,
    art.lines.map((row) => row.padEnd(40, ' ')),
  );
  check('左对齐没有溢出标记', wide.overflow, false);

  const right = M.renderAsciiArt('Hi', { width: 40, align: 'right' });
  check('右对齐时每行右端对齐', [...new Set(right.lines.map((row) => row.length))], [40]);
  check('右对齐的补白在左侧', right.lines[0].slice(0, 40 - natural), ' '.repeat(40 - natural));

  const center = M.renderAsciiArt('Hi', { width: 41, align: 'center', padChar: '.' });
  const missing = 41 - natural;
  const leftFill = ' '.repeat(Math.floor(missing / 2)).replace(/ /g, '.');
  check('居中时左侧补白为向下取整的一半', center.lines[0].slice(0, Math.floor(missing / 2)), leftFill);
  check('居中时用指定填充字符', center.lines[0].includes('.'), true);
  check('居中且补白为奇数时行宽仍相等', [...new Set(center.lines.map((row) => row.length))], [41]);

  const tiny = M.renderAsciiArt('Hello', { width: 4 });
  check('宽度小于作品时不裁剪（截断会把字形切两半）', tiny.lines[0].length, tiny.artWidth);
  check('宽度小于作品时标记溢出', tiny.overflow, true);

  check('空填充字符按空格处理', M.renderAsciiArt('A', { width: 20, padChar: '' }).lines[0], M.renderAsciiArt('A', { width: 20, padChar: ' ' }).lines[0]);
  check('多码元填充字符（emoji）回退为空格，避免列宽错乱', M.renderAsciiArt('A', { width: 20, padChar: '😀' }).lines[0], M.renderAsciiArt('A', { width: 20, padChar: ' ' }).lines[0]);
  check('宽度为 0 或负数视为不限', M.renderAsciiArt('A', { width: 0 }).lines, M.renderAsciiArt('A').lines);
}

console.log('--- 上限 ---');
{
  check('恰好 200 个字符不算截断', M.renderAsciiArt('A'.repeat(200)).truncated, false);
  check('201 个字符被截断', M.renderAsciiArt('A'.repeat(201)).truncated, true);
  check(
    '截断后渲染的就是前 200 个字符',
    M.renderAsciiArt('A'.repeat(201)).artWidth,
    M.renderAsciiArt('A'.repeat(200)).artWidth,
  );
  check(
    '截断同时发生在字符数上限',
    M.renderAsciiArt('A'.repeat(1000)).artWidth,
    M.renderAsciiArt('A'.repeat(200)).artWidth,
  );

  const manyLines = M.renderAsciiArt(Array.from({ length: 30 }, () => 'A').join('\n'));
  check('超过 20 行时截断', manyLines.truncated, true);
  check('超过 20 行时输出正好 20 * 6 行', manyLines.lines.length, 20 * F.FONT_HEIGHT);
  check('恰好 20 行不算截断', M.renderAsciiArt(Array.from({ length: 20 }, () => 'A').join('\n')).truncated, false);
}

console.log('--- 与独立参照渲染逐字比对 ---');
{
  /** Renders from the upstream glyphs, with its own layout arithmetic. */
  function referenceRender(text, spacing) {
    const gap = ' '.repeat(spacing);
    const out = [];
    for (const line of text.split('\n')) {
      const pieces = [];
      for (const char of line) {
        const glyph = flf.glyphs.get((char === '\t' ? ' ' : char).codePointAt(0));
        if (glyph) pieces.push(glyph.rows.map((row) => row.padEnd(glyph.width, ' ')));
      }
      if (pieces.length === 0) {
        out.push(...Array.from({ length: flf.height }, () => ''));
        continue;
      }
      for (let row = 0; row < flf.height; row += 1) {
        out.push(pieces.map((piece) => piece[row]).join(gap).replace(/ +$/, ''));
      }
    }
    return out;
  }

  const samples = ['HELLO', 'Hi 42!', 'AZaz09', '!?.,;:', '~@#$%^&*()_+', '{}[]|<>', 'Wheat Tools', 'A\nBC', '  spaced  '];
  const mismatches = [];
  for (const sample of samples) {
    for (const spacing of [0, 1, 3, 6]) {
      const actual = M.renderAsciiArt(sample, { spacing }).lines;
      const expected = referenceRender(sample, spacing);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push(`输入 ${JSON.stringify(sample)} 字距 ${spacing} 与参照不一致`);
      }
    }
  }
  checkNoProblems(`${samples.length} 组输入 × 4 种字距的输出与参照渲染逐行相同`, mismatches);

  // The reference renders the same picture regardless of the implementation's
  // own width bookkeeping, so a wrong width table would show up here too. The
  // untrimmed row is the one that carries the arithmetic: trailing blanks are
  // dropped from the output on purpose, so a trimmed row is narrower.
  function referenceRowWidth(text, spacing) {
    const pieces = [];
    for (const char of text) {
      const glyph = flf.glyphs.get(char.codePointAt(0));
      if (glyph) pieces.push(glyph.width);
    }
    if (pieces.length === 0) return 0;
    return pieces.reduce((sum, width) => sum + width, 0) + spacing * (pieces.length - 1);
  }
  const widthProblems = [];
  for (const sample of samples) {
    for (const spacing of [0, 1, 3]) {
      const referenceWidth = referenceRowWidth(sample.split('\n')[0], spacing);
      const actualWidth = M.renderLine(sample.split('\n')[0], spacing)[0].length;
      if (referenceWidth !== actualWidth) {
        widthProblems.push(`${JSON.stringify(sample)} 字距 ${spacing}：参照宽 ${referenceWidth}，实现宽 ${actualWidth}`);
      }
    }
  }
  checkNoProblems('参照的列宽算术与实现未裁剪前的行宽一致', widthProblems);
}

console.log('--- pyfiglet 交叉参照（可选依赖）---');
{
  const probe = spawnSync('python3', ['-c', 'import pyfiglet, json; print("ok")'], {
    encoding: 'utf8',
    timeout: 20000,
  });
  if (probe.status === 0 && String(probe.stdout).trim() === 'ok') {
    const script = [
      'import json, pyfiglet',
      'from pyfiglet import FigletFont',
      'font = FigletFont.preloadFont("standard")',
      'out = {}',
      'for key, value in font.items():',
      '    name = key if isinstance(key, str) else chr(key)',
      '    if len(name) == 1 and 32 <= ord(name) <= 126:',
      '        out[str(ord(name))] = value',
      'print(json.dumps(out))',
    ].join('\n');
    const run = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 30000 });
    if (run.status === 0) {
      const parsed = JSON.parse(run.stdout);
      const problems = [];
      for (let code = 32; code <= 126; code += 1) {
        const rows = parsed[String(code)];
        if (!rows) {
          problems.push(`pyfiglet 没有码位 ${code}`);
          continue;
        }
        const reference = flf.glyphs.get(code);
        if (rows.length !== reference.rows.length) {
          problems.push(`码位 ${code} 行数不同`);
          continue;
        }
        for (let row = 0; row < rows.length; row += 1) {
          const theirs = String(rows[row]).split('$').join(' ').replace(/ +$/, '');
          const ours = reference.rows[row].replace(/ +$/, '');
          if (theirs !== ours) problems.push(`码位 ${code} 第 ${row + 1} 行不同`);
        }
      }
      checkNoProblems('pyfiglet 解析出的 standard 字形与冻结参照一致', problems);
    } else {
      console.log(`SKIP  pyfiglet 已安装但解析失败，跳过：${String(run.stderr).split('\n')[0]}`);
    }
  } else {
    console.log(
      'SKIP  pyfiglet 不可用（python3 -c "import pyfiglet" 失败），跳过交叉参照；' +
        '改用冻结的上游 Standard.flf 字形块作为独立参照，覆盖全部 95 个字形。',
    );
  }
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
