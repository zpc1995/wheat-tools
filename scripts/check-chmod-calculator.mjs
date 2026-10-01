/**
 * Checks the chmod calculator.
 *
 * The claim that needs defending is "the symbolic form is exactly what `ls -l`
 * shows, including the special bits". Two independent oracles are used:
 *
 *   1. **Exhaustive round-trip.** Every mode from 0 to 0o7777 is rendered and
 *      parsed back through three representations (octal, symbolic, generated
 *      command). A sampled test would miss the rare uppercase `S`/`T` corner,
 *      which is precisely where implementations break.
 *   2. **CPython's `stat.filemode`.** An independent implementation of the same
 *      `ls -l` rules, from the standard library. Every symbolic string this
 *      implementation produces is compared against it character for character.
 *
 * The known-value assertions at the top come from the tool specification and
 * from `ls -l` behaviour: with an execute bit the special bit shows as `s`/`t`,
 * without one as the uppercase `S`/`T`.
 *
 * Usage: node scripts/check-chmod-calculator.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/chmod-calculator/chmodUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/chmod-calculator.mjs', compiled);
const M = await import(pathToFileURL('.verify/chmod-calculator.mjs').href);

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
function fail(label, detail) {
  failed += 1;
  console.log(`FAIL  ${label}\n        ${detail}`);
}

console.log('--- 固定已知值：八进制与符号 ---');
{
  // [mode, octal, symbolic]. The first eight are the spec's authoritative set;
  // the rest pin the boundaries of the same s/S/t/T rule.
  const cases = [
    [0o755, '755', 'rwxr-xr-x'],
    [0o644, '644', 'rw-r--r--'],
    [0o777, '777', 'rwxrwxrwx'],
    [0, '000', '---------'],
    [0o4755, '4755', 'rwsr-xr-x'],
    [0o2755, '2755', 'rwxr-sr-x'],
    [0o1777, '1777', 'rwxrwxrwt'],
    [0o4644, '4644', 'rwSr--r--'],
    // Uppercase when the special bit is set but the execute bit is not.
    [0o2644, '2644', 'rw-r-Sr--'],
    [0o1644, '1644', 'rw-r--r-T'],
    [0o7777, '7777', 'rwsrwsrwt'],
    [0o4000, '4000', '--S------'],
    [0o2000, '2000', '-----S---'],
    [0o1000, '1000', '--------T'],
    [0o4750, '4750', 'rwsr-x---'],
    [0o2750, '2750', 'rwxr-s---'],
    [0o1750, '1750', 'rwxr-x--T'],
    [0o6777, '6777', 'rwsrwsrwx'],
    [0o007, '007', '------rwx'],
    [0o040, '040', '---r-----'],
    [0o444, '444', 'r--r--r--'],
  ];
  for (const [mode, octal, symbolic] of cases) {
    check(`八进制 ${octal}`, M.formatOctal(mode), octal);
    check(`符号 ${symbolic}`, M.formatSymbolic(mode), symbolic);
  }
}

console.log('--- 权威参照物：CPython stat.filemode ---');
let pythonSymbolic = null;
{
  const PY_ORACLE = [
    'import stat, sys',
    'out = []',
    'for mode in range(0o10000):',
    '    out.append(stat.filemode(mode)[1:])',
    'sys.stdout.write("\\n".join(out))',
  ].join('\n');

  try {
    const output = execFileSync('python3', ['-c', PY_ORACLE], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    pythonSymbolic = output.replace(/\n$/, '').split('\n');
  } catch (error) {
    fail('运行 python3 参照实现 stat.filemode', String(error.message));
  }

  if (pythonSymbolic) {
    check('参照实现输出了全部 4096 个值', pythonSymbolic.length, 0o10000);

    let renderMismatch = 0;
    let parseMismatch = 0;
    for (let mode = 0; mode <= M.MAX_MODE; mode += 1) {
      if (M.formatSymbolic(mode) !== pythonSymbolic[mode]) renderMismatch += 1;
      const parsed = M.parseSymbolic(pythonSymbolic[mode]);
      if (!parsed.ok || parsed.mode !== mode) parseMismatch += 1;
    }
    check('formatSymbolic 与 stat.filemode 在全部 4096 个值上逐字符一致', renderMismatch, 0);
    check('stat.filemode 的输出能被 parseSymbolic 还原', parseMismatch, 0);

    // A specific disagreement would be far easier to debug than a count.
    if (renderMismatch > 0) {
      const first = Array.from({ length: 0o10000 }, (_, i) => i).find(
        (mode) => M.formatSymbolic(mode) !== pythonSymbolic[mode],
      );
      console.log(
        `        首个不一致：${M.formatOctal(first)} 本实现 ${M.formatSymbolic(first)} ` +
          `参照 ${pythonSymbolic[first]}`,
      );
    }
  }

  // Python prints a question mark for a mode with no file-type bits; it must be
  // accepted as the optional tenth character.
  check('问号文件类型前缀（python 的写法）可解析', M.parseSymbolic('?rwxr-xr-x'), {
    ok: true,
    mode: 0o755,
  });
}

console.log('--- 权威参照物（系统本体）：GNU chmod + stat ---');
{
  // The strongest oracle available: set the mode with the real chmod(1) and read
  // it back with stat(1). This is the source of truth the whole tool imitates,
  // including the uppercase S/T behaviour, so it is worth the subprocesses.
  //
  // The mode list is every special-bit combination crossed with a spread of
  // triad patterns, every 41st mode, and the interesting boundaries. Running all
  // 4096 values through subprocesses would take minutes; this covers the shape
  // of the space without doing that.
  const modes = new Set();
  for (let special = 0; special <= 7; special += 1) {
    for (const triad of [0, 0o007, 0o050, 0o111, 0o222, 0o444, 0o555, 0o640, 0o644, 0o700, 0o755, 0o777]) {
      modes.add((special << 9) | triad);
    }
  }
  for (let mode = 0; mode <= 0o7777; mode += 41) modes.add(mode);
  for (const mode of [0, 0o7777, 0o4000, 0o2000, 0o1000, 0o4644, 0o2644, 0o1644, 0o4755, 0o2755, 0o1777, 0o6777]) {
    modes.add(mode);
  }
  const list = [...modes].sort((a, b) => a - b);

  const file = '.verify/chmod-oracle.tmp';
  writeFileSync(file, '');
  const readStat = (format) =>
    execFileSync('stat', ['-c', format, file], { encoding: 'utf8' }).trim();

  // Removed even if a later assertion throws, so the temp file cannot linger.
  process.on('exit', () => {
    try {
      unlinkSync(file);
    } catch {
      // Already removed.
    }
  });

  let usable = false;
  try {
    execFileSync('chmod', ['4755', file]);
    usable = readStat('%a %A') === '4755 -rwsr-xr-x';
  } catch {
    usable = false;
  }

  if (!usable) {
    console.log('SKIP  当前文件系统不保留特殊位，跳过系统参照物（八进制与符号仍由 stat.filemode 校验）');
  } else {
    let octalMismatch = 0;
    let symbolicMismatch = 0;
    let parseMismatch = 0;

    for (const mode of list) {
      execFileSync('chmod', [M.formatOctal(mode), file]);

      // stat prints `0` rather than `000`, so the octal reading is compared
      // numerically; the symbolic reading carries the file type character,
      // which is why it is fed in whole (the parser accepts ten characters).
      const octal = readStat('%a');
      if (Number.parseInt(octal, 8) !== mode) octalMismatch += 1;

      const symbolic = readStat('%A');
      if (symbolic.slice(1) !== M.formatSymbolic(mode)) symbolicMismatch += 1;

      const parsed = M.parseSymbolic(symbolic);
      if (!parsed.ok || parsed.mode !== mode) parseMismatch += 1;
    }

    check(`系统 chmod/stat 在 ${list.length} 个取值上确认八进制`, octalMismatch, 0);
    check(`系统 stat -c %A 在 ${list.length} 个取值上与本实现逐字符一致`, symbolicMismatch, 0);
    check('系统输出的十字符号串（含文件类型）能被 parseSymbolic 还原', parseMismatch, 0);

    if (symbolicMismatch > 0) {
      execFileSync('chmod', ['4755', file]);
      console.log(`        例：系统 ${readStat('%A')} 对本实现 ${M.formatSymbolic(0o4755)}`);
    }
  }

  unlinkSync(file);
}

console.log('--- 穷举往返：0 到 7777 ---');
{
  let viaSymbolic = 0;
  let viaOctal = 0;
  let viaParseMode = 0;
  let viaBits = 0;
  let rendered = 0;

  for (let mode = 0; mode <= M.MAX_MODE; mode += 1) {
    const symbolic = M.formatSymbolic(mode);
    if (symbolic.length !== 9) rendered += 1;

    const symbolsBack = M.parseSymbolic(symbolic);
    if (!symbolsBack.ok || symbolsBack.mode !== mode) viaSymbolic += 1;

    const octal = M.formatOctal(mode);
    const octalBack = M.parseOctal(octal);
    if (!octalBack.ok || octalBack.mode !== mode) viaOctal += 1;

    const autoBack = M.parseMode(symbolic);
    const autoOctal = M.parseMode(octal);
    if (!autoBack.ok || autoBack.mode !== mode) viaParseMode += 1;
    if (!autoOctal.ok || autoOctal.mode !== mode) viaParseMode += 1;

    if (M.bitsToMode(M.modeToBits(mode)) !== mode) viaBits += 1;
  }

  check('4096 个值渲染出的符号串长度都是 9', rendered, 0);
  check('符号 → 八进制 往返全部一致', viaSymbolic, 0);
  check('八进制 → 八进制 往返全部一致', viaOctal, 0);
  check('parseMode 自动判别在两种形式上往返一致', viaParseMode, 0);
  check('位展开与合并（modeToBits / bitsToMode）往返一致', viaBits, 0);
}

console.log('--- 合法性边界 ---');
{
  const valid = [
    ['000', 0],
    ['0000', 0],
    ['777', 0o777],
    ['7777', 0o7777],
    ['0755', 0o755],
    ['  755  ', 0o755],
    ['rwxr-xr-x', 0o755],
    ['---------', 0],
    ['-rwxr-xr-x', 0o755],
    ['drwxr-xr-x', 0o755],
    ['rwSr--r--', 0o4644],
    ['rwxrwxrwt', 0o1777],
  ];
  for (const [text, mode] of valid) {
    const result = M.parseMode(text);
    check(`接受 ${JSON.stringify(text)}`, result, { ok: true, mode });
  }

  const invalid = [
    '8',
    '9',
    '18',
    '89',
    '7558',
    '128',
    '12345',
    '77777',
    '-755',
    '-0',
    '',
    '   ',
    '0o755',
    '0x1ff',
    'abc',
    '755abc',
    'rwxr-xr', // 8 个字符
    'rwxr-xr-x-', // 10 个字符，但首位不是文件类型
    'qwxr-xr-x',
    'rwxrwxrwq',
    'rwtr-xr-x', // t 出现在用户位
    'rwxr-xr-s', // s 出现在其他位
    'rwxrwxrwX', // 大写 X 不是显示形式
    'rwx r-xr-x',
    '１２３',
  ];
  for (const text of invalid) {
    const result = M.parseMode(text);
    check(`拒绝 ${JSON.stringify(text)}`, result.ok, false);
  }

  check(
    '8 的报错说明了非法八进制位',
    M.parseMode('8').error.includes('0-7'),
    true,
  );
  check(
    '超长八进制的报错提到了 4 位',
    M.parseMode('12345').error.includes('4 位'),
    true,
  );
  check(
    '长度不对的符号串报错给出实际长度',
    M.parseMode('rwxr-xr').error.includes('7'),
    true,
  );
  check(
    '10 个字符且首位不是文件类型的报错说明原因',
    M.parseMode('rwxr-xr-x-').error.includes('文件类型'),
    true,
  );
}

console.log('--- 特殊位语义 ---');
{
  check('4755 有 setuid', M.modeToBits(0o4755).setuid, true);
  check('4755 用户位可执行', M.modeToBits(0o4755).user.execute, true);
  check('4644 有 setuid', M.modeToBits(0o4644).setuid, true);
  check('4644 用户位不可执行（大写 S 的来源）', M.modeToBits(0o4644).user.execute, false);
  check('2755 有 setgid', M.modeToBits(0o2755).setgid, true);
  check('2755 组位可执行', M.modeToBits(0o2755).group.execute, true);
  check('2644 组位不可执行（大写 S 的来源）', M.modeToBits(0o2644).group.execute, false);
  check('1777 有 sticky', M.modeToBits(0o1777).sticky, true);
  check('1777 其他位可执行', M.modeToBits(0o1777).other.execute, true);
  check('1644 其他位不可执行（大写 T 的来源）', M.modeToBits(0o1644).other.execute, false);

  // 4644 must not be reported as executable anywhere: the uppercase form is
  // exactly the signal that setuid is present without the execute bit.
  check('4644 展开后没有执行位', M.modeToBits(0o4644).user.execute, false);
  check('4644 与 0644 的区别仅在特殊位', M.bitsToMode(M.modeToBits(0o4644)) - M.bitsToMode(M.modeToBits(0o644)), 0o4000);

  check('空权限位', M.bitsToMode(M.emptyModeBits()), 0);
  check(
    '勾上用户执行位：644 → 744',
    M.bitsToMode(M.setTriadBit(M.modeToBits(0o644), 'user', 'execute', true)),
    0o744,
  );
  check(
    '勾上 setuid：755 → 4755',
    M.bitsToMode(M.setSpecialBit(M.modeToBits(0o755), 'setuid', true)),
    0o4755,
  );
  check(
    '取消 setuid：4755 → 755',
    M.bitsToMode(M.setSpecialBit(M.modeToBits(0o4755), 'setuid', false)),
    0o755,
  );
  check(
    '设置特殊位不会连带修改任何读写执行位',
    M.formatSymbolic(M.bitsToMode(M.setSpecialBit(M.modeToBits(0o644), 'setgid', true))),
    'rw-r-Sr--',
  );

  const none = M.describeSpecialBits(0o755);
  check('普通权限没有特殊位说明', none, []);
  const setuidNotes = M.describeSpecialBits(0o4755);
  check('setuid 有一条说明', setuidNotes.length, 1);
  check('setuid 说明被标记为警告', setuidNotes[0].warning, true);
  check('setuid 说明的标识', setuidNotes[0].flag, 'setuid');
  const all = M.describeSpecialBits(0o7777);
  check('三个特殊位都有说明', all.map((note) => note.flag), ['setuid', 'setgid', 'sticky']);
  check('setgid 不是警告', all[1].warning, false);
  check('sticky 不是警告', all[2].warning, false);
  check('特殊位说明的文字非空', all.every((note) => note.detail.length > 10), true);
}

console.log('--- 生成 chmod 命令 ---');
{
  check('默认命令', M.buildChmodCommand(0o755), 'chmod 755 file.txt');
  check('带特殊位的命令', M.buildChmodCommand(0o4755, 'app'), 'chmod 4755 app');
  check('默认路径为空时回落到默认值', M.buildChmodCommand(0o644, ''), 'chmod 644 file.txt');
  check(
    '含空格的路径会加引号',
    M.buildChmodCommand(0o644, 'my file.txt'),
    "chmod 644 'my file.txt'",
  );
  check(
    '含单引号的路径按 shell 规则转义',
    M.buildChmodCommand(0o644, "it's.txt"),
    "chmod 644 'it'\\''s.txt'",
  );

  const known = [
    ['chmod 755 file.txt', 0o755, 'file.txt'],
    ['chmod 4755 /usr/local/bin/app', 0o4755, '/usr/local/bin/app'],
    ['chmod -R 2755 dir', 0o2755, 'dir'],
    ['chmod --recursive 1777 /tmp/shared', 0o1777, '/tmp/shared'],
    ['chmod 644 "my file.txt"', 0o644, 'my file.txt'],
    ['chmod 755', 0o755, undefined],
  ];
  for (const [command, mode, path] of known) {
    const parsed = M.parseChmodCommand(command);
    check(`解析 ${command}`, parsed, path === undefined ? { ok: true, mode } : { ok: true, mode, path });
  }

  const badCommands = [
    '',
    'chmod',
    'chmod -R',
    'chmod 999 file.txt',
    'chmod 12345 file.txt',
    'chmod rwxr-xr file.txt',
    'chmod u=rwx,go=rx file.txt',
    'chmod 755 "unterminated',
  ];
  for (const command of badCommands) {
    check(`拒绝命令 ${JSON.stringify(command)}`, M.parseChmodCommand(command).ok, false);
  }
}

console.log('--- 命令往返：全部 4096 个值 × 多种路径 ---');
{
  const paths = [
    'file.txt',
    '2024-report.txt',
    'my file.txt',
    "it's.txt",
    'a"b.txt',
    '$HOME/.ssh/id_rsa',
    '目录/文件.txt',
    '',
  ];
  let modeMismatch = 0;
  let pathMismatch = 0;
  let unparsed = 0;

  for (let mode = 0; mode <= M.MAX_MODE; mode += 1) {
    for (const path of paths) {
      const command = M.buildChmodCommand(mode, path);
      const parsed = M.parseChmodCommand(command);
      if (!parsed.ok) {
        unparsed += 1;
        continue;
      }
      if (parsed.mode !== mode) modeMismatch += 1;
      const expectedPath = path.trim() === '' ? M.DEFAULT_PATH : path;
      if (parsed.path !== expectedPath) pathMismatch += 1;
    }
  }

  check(`${0o10000 * paths.length} 条生成的命令都能解析`, unparsed, 0);
  check('解析出的权限与生成时一致', modeMismatch, 0);
  check('解析出的路径与生成时一致', pathMismatch, 0);
}

console.log('--- 朴素写法是错的（证明这些检查有效） ---');
{
  // Lowercase s/t even when the execute bit is clear: the classic bug this
  // whole tool exists to avoid.
  function naiveSymbolic(mode) {
    const bits = M.modeToBits(mode);
    let out = '';
    for (const who of ['user', 'group', 'other']) {
      const special =
        who === 'user' ? bits.setuid : who === 'group' ? bits.setgid : bits.sticky;
      const letter = who === 'other' ? 't' : 's';
      out += bits[who].read ? 'r' : '-';
      out += bits[who].write ? 'w' : '-';
      out += bits[who].execute ? (special ? letter : 'x') : special ? letter : '-';
    }
    return out;
  }
  check('朴素写法把 4644 写成小写 s（错误）', naiveSymbolic(0o4644), 'rwsr--r--');
  check('本实现按 ls 语义写成大写 S', M.formatSymbolic(0o4644), 'rwSr--r--');
  check('两者确实不同', naiveSymbolic(0o4644) === M.formatSymbolic(0o4644), false);
  check('朴素写法把 1644 写成小写 t（错误）', naiveSymbolic(0o1644), 'rw-r--r-t');

  // parseInt-based validation silently accepts junk.
  check('parseInt("19", 8) 悄悄截断成 1', Number.parseInt('19', 8), 1);
  check('parseInt("755abc", 8) 悄悄接受 755', Number.parseInt('755abc', 8), 0o755);
  check('本实现拒绝 "19"', M.parseMode('19').ok, false);
  check('本实现拒绝 "755abc"', M.parseMode('755abc').ok, false);

  // Reading a command by digit-scanning the whole line picks up the file name.
  const naiveDigits = 'chmod 755 2024-report.txt'.replace(/[^0-9]/g, '');
  check('用"抽出所有数字"的办法会得到 7552024', naiveDigits, '7552024');
  check('该结果不等于 755（证明必须分词）', Number.parseInt(naiveDigits, 8) === 0o755, false);
  check('本实现得到正确结果', M.parseChmodCommand('chmod 755 2024-report.txt').mode, 0o755);

  // Reading the mode as decimal forgets that it is octal.
  check('把 755 当十进制读会得到 755', Number('755'), 755);
  check('755 的实际八进制值是 493', 0o755, 493);
  check('本实现按八进制解析', M.parseChmodCommand('chmod 755 file.txt').mode, 493);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
