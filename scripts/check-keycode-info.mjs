/**
 * Checks the keyboard event tool.
 *
 * The legacy `keyCode` values are not derived from the implementation: they are
 * pinned below as an independent literal table taken from what the UI Events
 * spec and MDN publish for US QWERTY, and every one of them is compared against
 * the table the app actually renders. If someone "simplifies" the table — say by
 * deriving `keyCode` from the character, which would give 97 for 'a' — these
 * assertions fail.
 *
 * Usage: node scripts/check-keycode-info.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync('src/tools/keycode-info/keycodeInfoUtils.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/keycode-info.mjs', compiled);
const M = await import(pathToFileURL('.verify/keycode-info.mjs').href);

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

console.log('--- 题目要求的已知映射 ---');
check('KeyA 的 keyCode 是 65', M.LEGACY_KEY_CODES.KeyA, 65);
check('KeyA 的 key 是 a', M.KEY_REFERENCE.find((e) => e.code === 'KeyA').key, 'a');
check('Enter 的 keyCode 是 13', M.LEGACY_KEY_CODES.Enter, 13);
check('Enter 的 code 是 Enter', M.KEY_REFERENCE.find((e) => e.code === 'Enter').code, 'Enter');
check('Space 的 key 是一个空格字符', M.KEY_REFERENCE.find((e) => e.code === 'Space').key, ' ');
check('Space 的 code 是 Space', M.KEY_REFERENCE.find((e) => e.code === 'Space').code, 'Space');
check('Space 的 keyCode 是 32', M.LEGACY_KEY_CODES.Space, 32);

{
  const left = M.KEY_REFERENCE.find((e) => e.code === 'ShiftLeft');
  const right = M.KEY_REFERENCE.find((e) => e.code === 'ShiftRight');
  check('ShiftLeft 与 ShiftRight 的 code 不同', left.code !== right.code, true);
  check('ShiftLeft 与 ShiftRight 的 key 相同', left.key === right.key, true);
  check('ShiftLeft 与 ShiftRight 的 key 都是 Shift', [left.key, right.key], ['Shift', 'Shift']);
  check('ShiftLeft 与 ShiftRight 的 keyCode 相同（分不出左右）', left.keyCode === right.keyCode, true);
}

{
  const numpad = M.KEY_REFERENCE.find((e) => e.code === 'Numpad1');
  const digit = M.KEY_REFERENCE.find((e) => e.code === 'Digit1');
  check('Numpad1 与 Digit1 的 code 不同', numpad.code !== digit.code, true);
  check('Numpad1 与 Digit1 的 key 相同', numpad.key === digit.key, true);
  check('Numpad1 的 keyCode 是 97', numpad.keyCode, 97);
  check('Digit1 的 keyCode 是 49', digit.keyCode, 49);
}

console.log('--- 独立参照表：规范公布的 keyCode 取值 ---');
{
  // Independently transcribed. Keyed by code, values are the Windows virtual
  // key codes the UI Events spec / MDN list for US QWERTY.
  const REFERENCE = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    ShiftLeft: 16,
    ControlLeft: 17,
    AltLeft: 18,
    Pause: 19,
    CapsLock: 20,
    Escape: 27,
    Space: 32,
    PageUp: 33,
    PageDown: 34,
    End: 35,
    Home: 36,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    PrintScreen: 44,
    Insert: 45,
    Delete: 46,
    Digit0: 48,
    Digit1: 49,
    Digit9: 57,
    KeyA: 65,
    KeyZ: 90,
    MetaLeft: 91,
    MetaRight: 92,
    ContextMenu: 93,
    Numpad0: 96,
    Numpad1: 97,
    Numpad9: 105,
    NumpadMultiply: 106,
    NumpadAdd: 107,
    NumpadSubtract: 109,
    NumpadDecimal: 110,
    NumpadDivide: 111,
    F1: 112,
    F12: 123,
    NumLock: 144,
    ScrollLock: 145,
    Semicolon: 186,
    Equal: 187,
    Comma: 188,
    Minus: 189,
    Period: 190,
    Slash: 191,
    Backquote: 192,
    BracketLeft: 219,
    Backslash: 220,
    BracketRight: 221,
    Quote: 222,
  };
  const mismatches = [];
  for (const [code, value] of Object.entries(REFERENCE)) {
    if (M.LEGACY_KEY_CODES[code] !== value) {
      mismatches.push(`${code}: 实现 ${M.LEGACY_KEY_CODES[code]} /= 规范 ${value}`);
    }
  }
  check(`52 个规范取值与实现完全一致`, mismatches, []);
}

console.log('--- 表本身的结构不变量 ---');
{
  const codes = M.KEY_REFERENCE.map((e) => e.code);
  check('code 无重复', codes.length - new Set(codes).size, 0);
  const badValue = M.KEY_REFERENCE.filter(
    (e) => !Number.isInteger(e.keyCode) || e.keyCode < 0 || e.keyCode > 255,
  );
  check('所有 keyCode 都是 0..255 的整数（Windows 虚拟键值域）', badValue, []);
  const emptyKey = M.KEY_REFERENCE.filter((e) => typeof e.key !== 'string' || e.key.length === 0);
  check('所有条目的 key 非空', emptyKey, []);
  check('每条都有中文说明', M.KEY_REFERENCE.every((e) => e.zh.length > 0), true);
  check('查表函数与表内容一致（抽查 KeyQ）', M.LEGACY_KEY_CODES.KeyQ, 81);
}

console.log('--- location 由 code 推导，后缀规则是错的 ---');
check('ShiftLeft 在左侧', M.locationOfCode('ShiftLeft'), M.KEY_LOCATION_LEFT);
check('ShiftRight 在右侧', M.locationOfCode('ShiftRight'), M.KEY_LOCATION_RIGHT);
check('ControlLeft 在左侧', M.locationOfCode('ControlLeft'), 1);
check('MetaRight 在右侧', M.locationOfCode('MetaRight'), 2);
check('Numpad1 在数字键盘', M.locationOfCode('Numpad1'), M.KEY_LOCATION_NUMPAD);
check('KeyA 是标准位置', M.locationOfCode('KeyA'), M.KEY_LOCATION_STANDARD);
// The counter-example: a naive "ends with Left" rule would put ArrowLeft on the
// left side, but the arrow keys are standard-location keys.
check('ArrowLeft 不是「左侧修饰键」（朴素后缀规则会判错）', M.locationOfCode('ArrowLeft'), 0);
check('ArrowRight 不是「右侧修饰键」', M.locationOfCode('ArrowRight'), 0);
check('NumpadEnter 在数字键盘而不是标准位置', M.locationOfCode('NumpadEnter'), 3);
check('locationName 覆盖 0..3', [0, 1, 2, 3].map((n) => M.locationName(n)).length, 4);
check('未知 location 不抛异常', M.locationName(9), '未知（9）');

console.log('--- resolveKeyCode 的优先级 ---');
{
  check(
    '浏览器自己报的 keyCode 优先于查表',
    M.resolveKeyCode({ code: 'KeyA', key: 'a', keyCode: 999 }),
    { value: 999, source: 'browser' },
  );
  check('表里有则查表', M.resolveKeyCode({ code: 'KeyA', key: 'a' }), {
    value: 65,
    source: 'table',
  });
  check('Shift 按下时字母仍是大写码', M.resolveKeyCode({ code: 'KeyA', key: 'A' }).value, 65);
  check(
    '不按 Shift 也是同一个码（key 是 a 却得到 65，不是 97）',
    M.resolveKeyCode({ code: 'KeyA', key: 'a' }).value,
    65,
  );
  check('表里没有的小写字母按大写码兜底', M.resolveKeyCode({ code: 'Unknown', key: 'a' }), {
    value: 65,
    source: 'char',
  });
  check('表里没有的 ASCII 标点按码位兜底', M.resolveKeyCode({ code: 'Unknown', key: '!' }), {
    value: 33,
    source: 'char',
  });
  check(
    '非 ASCII 字符不给历史值（历史上是平台相关的）',
    M.resolveKeyCode({ code: 'Unknown', key: '中' }),
    { value: null, source: 'none' },
  );
  check('非字符键且表里没有则无值', M.resolveKeyCode({ code: 'Mystery', key: 'Mystery' }), {
    value: null,
    source: 'none',
  });
  check('NaN 视为未提供', M.resolveKeyCode({ code: 'KeyA', key: 'a', keyCode: Number.NaN }).source, 'table');
  check('空事件不抛异常', M.resolveKeyCode({ code: '', key: '' }), { value: null, source: 'none' });
}

console.log('--- analyseKeyEvent 的字段 ---');
{
  const a = M.analyseKeyEvent({ key: 'a', code: 'KeyA' });
  check('key 原样保留', a.key, 'a');
  check('code 原样保留', a.code, 'KeyA');
  check('keyCode 为 65', a.keyCode, 65);
  check('which 缺省时等于 keyCode', a.which, 65);
  check('location 为 0', a.location, 0);
  check('printable 为真', a.printable, true);
  check('码位为 97', a.codePoint, 97);
  check('码位十六进制', a.codePointHex, 'U+0061');
  check('修饰键全为假', a.modifierNames, []);
  check('无重复', a.repeat, false);

  const spaced = M.analyseKeyEvent({ key: ' ', code: 'Space' });
  check('空格的码位是 0x20', spaced.codePointHex, 'U+0020');
  check('空格是可打印字符', spaced.printable, true);
  check('空格说明里点明了 key 是空格字符', spaced.note.includes('空格字符'), true);

  const enter = M.analyseKeyEvent({ key: 'Enter', code: 'Enter' });
  check('Enter 不是可打印字符', enter.printable, false);
  check('Enter 没有码位', enter.codePointHex, null);
  check('Enter 的说明指出它是键名', enter.note.includes('键名'), true);

  const ctrlShift = M.analyseKeyEvent({
    key: 'A',
    code: 'KeyA',
    shiftKey: true,
    ctrlKey: true,
  });
  check('同时按住 Ctrl 与 Shift', ctrlShift.modifierNames, ['Ctrl', 'Shift']);
  check('大写 A 仍是 KeyA / 65', [ctrlShift.code, ctrlShift.keyCode], ['KeyA', 65]);

  const browserWhich = M.analyseKeyEvent({ key: 'a', code: 'KeyA', keyCode: 65, which: 229 });
  check('which 有值时不回退到 keyCode', browserWhich.which, 229);

  const numpad = M.analyseKeyEvent({ key: '1', code: 'Numpad1' });
  check('小键盘 location 为 3', numpad.location, 3);
  check('小键盘说明提到 Numpad', numpad.note.includes('Numpad'), true);

  const emoji = M.analyseKeyEvent({ key: '😀', code: 'Unknown' });
  check('emoji 是单个码位', emoji.printable, true);
  check('emoji 码位', emoji.codePointHex, 'U+1F600');
  check('emoji 没有历史 keyCode', emoji.keyCode, null);

  const grapheme = M.analyseKeyEvent({ key: '👍🏽', code: 'Unknown' });
  check('带肤色修饰的 emoji 是两个码位，不算单个字符', grapheme.printable, false);

  const cjk = M.analyseKeyEvent({ key: '中', code: 'Unknown' });
  check('中文码位', cjk.codePointHex, 'U+4E2D');
  check('中文没有历史 keyCode', cjk.keyCode, null);

  const empty = M.analyseKeyEvent({ key: '', code: '' });
  check('空事件不崩', empty.keyCode, null);
  check('空事件给出「没有 key」的说明', empty.note.includes('没有给出 key'), true);
  check('空事件 codeLabel 为 null', empty.codeLabel, null);

  check('查得到的中文键名', M.analyseKeyEvent({ key: 'Escape', code: 'Escape' }).codeLabel, 'Esc');
}

console.log('--- preventDefault：只拦滚动键，绝不拦浏览器快捷键 ---');
{
  const base = { code: 'Space', key: ' ' };
  check('空格会被拦截（防止页面滚动）', M.shouldPreventDefault(base), true);
  check('方向键会被拦截', M.shouldPreventDefault({ code: 'ArrowDown' }), true);
  check('PageDown 会被拦截', M.shouldPreventDefault({ code: 'PageDown' }), true);
  check('普通字母不拦截', M.shouldPreventDefault({ code: 'KeyA', key: 'a' }), false);
  check('Enter 不拦截', M.shouldPreventDefault({ code: 'Enter' }), false);
  check('Escape 不拦截', M.shouldPreventDefault({ code: 'Escape' }), false);
  // Tab must stay usable or a keyboard-only user cannot leave the capture area.
  check('Tab 绝不拦截（否则键盘用户被困住）', M.shouldPreventDefault({ code: 'Tab' }), false);
  check('F5 不拦截', M.shouldPreventDefault({ code: 'F5' }), false);
  check('Ctrl+Space 不拦截（浏览器快捷键优先）', M.shouldPreventDefault({ ...base, ctrlKey: true }), false);
  check('Cmd+Space 不拦截', M.shouldPreventDefault({ ...base, metaKey: true }), false);
  check('Alt+Space 不拦截', M.shouldPreventDefault({ ...base, altKey: true }), false);
  check('Ctrl+ArrowLeft 不拦截', M.shouldPreventDefault({ code: 'ArrowLeft', ctrlKey: true }), false);
  check('输入框有焦点时不拦截', M.shouldPreventDefault({ ...base, targetIsEditable: true }), false);
  check('输入框有焦点时方向键也不拦截', M.shouldPreventDefault({ code: 'ArrowUp', targetIsEditable: true }), false);
}

console.log('--- 历史记录 ---');
{
  let history = [];
  history = M.pushHistory(history, { key: 'a', code: 'KeyA' });
  history = M.pushHistory(history, { key: 'b', code: 'KeyB' });
  history = M.pushHistory(history, { key: 'c', code: 'KeyC' });
  check('最新的一次排在最前', history.map((h) => h.analysis.key), ['c', 'b', 'a']);
  check('序号从 1 递增', history.map((h) => h.index), [3, 2, 1]);

  // Each row must keep its own values: storing the raw event would make every
  // row show the last key pressed, because the browser reuses the event object.
  check('历史各行保留各自的值，没有被最后一次覆盖', history.map((h) => h.analysis.code), ['KeyC', 'KeyB', 'KeyA']);

  let many = [];
  for (let i = 0; i < M.MAX_HISTORY + 25; i += 1) {
    many = M.pushHistory(many, { key: 'x', code: 'KeyX' });
  }
  check(`历史上限为 ${M.MAX_HISTORY}`, many.length, M.MAX_HISTORY);
  check('裁剪保留最新的一条', many[0].index, M.MAX_HISTORY + 25);

  const tsv = M.historyToTsv(history).split('\n');
  check('TSV 行数（含表头）', tsv.length, 4);
  check('TSV 表头', tsv[0], '序号\tkey\tcode\tkeyCode\twhich\tlocation\t修饰键\t重复');
  check('TSV 第一行数据', tsv[1], '3\tc\tKeyC\t67\t67\t0\t\t否');
  check('空历史只有表头', M.historyToTsv([]).split('\n').length, 1);
}

console.log('--- 对照例子与废弃别名 ---');
{
  check('对照例子非空', M.CODE_VS_KEY_EXAMPLES.length >= 8, true);
  check(
    'Dvorak 例子：同一个 KeyE，key 变成句点',
    M.CODE_VS_KEY_EXAMPLES.some((e) => e.code === 'KeyE' && e.key === '.'),
    true,
  );
  check(
    'AZERTY 例子：KeyQ 产生 a',
    M.CODE_VS_KEY_EXAMPLES.some((e) => e.code === 'KeyQ' && e.key === 'a'),
    true,
  );
  check(
    'Shift+Digit1 的例子保留 keyCode 49 而不是 33',
    M.CODE_VS_KEY_EXAMPLES.some((e) => e.code === 'Digit1' && e.key === '!' && e.keyCode === 49),
    true,
  );
  check('废弃别名包含 OSLeft', M.DEPRECATED_CODE_ALIASES.OSLeft, 'MetaLeft');
  check('废弃别名包含 OSRight', M.DEPRECATED_CODE_ALIASES.OSRight, 'MetaRight');
}

console.log('--- 畸形输入不崩 ---');
{
  const weird = M.analyseKeyEvent({
    key: 'x'.repeat(5000),
    code: 'y'.repeat(5000),
    keyCode: -1,
    which: 1e21,
    location: 99,
  });
  check('超长 key / code 不抛异常', typeof weird.note, 'string');
  check('超长 key 不算单个字符', weird.printable, false);
  check('非法 location 给出「未知」而不是崩溃', weird.locationName, '未知（99）');
  check('which 为 1e21 时仍按数字处理（有限值）', weird.which, 1e21);
  check('keyCode 为 -1 时按浏览器上报处理', weird.keyCode, -1);
  check('undefined 事件字段不抛异常', M.analyseKeyEvent({}).printable, false);
  check('code 为 null 不抛异常', M.analyseKeyEvent({ key: null, code: null }).note.length > 0, true);
  check('零宽字符算单个码位（这是浏览器给的事实）', M.analyseKeyEvent({ key: '\u200b', code: 'X' }).printable, true);
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
