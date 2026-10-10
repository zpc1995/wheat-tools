/**
 * Pure logic behind the keycode tool.
 *
 * ## Why this file is mostly a table
 *
 * `KeyboardEvent.keyCode` and `KeyboardEvent.which` are deprecated, but they are
 * still how an enormous amount of existing code decides what was pressed, and
 * they are still the only thing some frameworks read. They are also *not*
 * derivable from the modern properties in any obvious way: for the physical key
 * `KeyA` the legacy value is 65 whether or not Shift is held, and `'a'` alone
 * would suggest 97. So the numbers are carried as data, and the check script
 * pins a few dozen of them against values published in the UI Events spec and on
 * MDN rather than re-deriving them from the implementation.
 *
 * The table below is the single source of truth: the reference list the UI shows
 * and the lookup the analysis uses are built from the same array, so the cheat
 * sheet can never disagree with the answer the live capture displays.
 *
 * ## The distinction the tool exists to explain
 *
 * `event.code` names the **physical** key — its position on a US QWERTY layout,
 * regardless of what is printed on the keycap or what character it produces.
 * `event.key` names the **character** that the key press produced, after the
 * active layout and the modifier state have been applied. On Dvorak the same
 * physical `KeyE` produces `'.'`; on French AZERTY `KeyQ` produces `'a'`. Legacy
 * `keyCode`, confusingly, follows the physical key (it is a Windows virtual key
 * code), which is why games that used keyCode kept working when the user
 * switched to Dvorak while games that used `key` did not.
 *
 * No DOM, no clock, no React: every function is a pure mapping, which is what
 * lets the check script assert the historical numbers with injected fake events.
 */

/** `KeyboardEvent.location` values, exactly as the UI Events spec numbers them. */
export const KEY_LOCATION_STANDARD = 0;
export const KEY_LOCATION_LEFT = 1;
export const KEY_LOCATION_RIGHT = 2;
export const KEY_LOCATION_NUMPAD = 3;

export const LOCATION_NAMES: Record<number, string> = {
  0: '标准（不区分左右）',
  1: '左侧',
  2: '右侧',
  3: '数字键盘',
};

export function locationName(location: number): string {
  return LOCATION_NAMES[location] ?? `未知（${location}）`;
}

/**
 * The codes whose `location` is left or right.
 *
 * Listed explicitly rather than derived from a `Left` / `Right` suffix, because
 * `ArrowLeft` and `ArrowRight` also end that way and their location is
 * *standard*, not left/right — a suffix rule would label the arrow keys as
 * side-specific modifiers. Everything not listed here is either on the numeric
 * keypad or standard.
 */
const SIDED_CODES: Record<string, number> = {
  ShiftLeft: KEY_LOCATION_LEFT,
  ShiftRight: KEY_LOCATION_RIGHT,
  ControlLeft: KEY_LOCATION_LEFT,
  ControlRight: KEY_LOCATION_RIGHT,
  AltLeft: KEY_LOCATION_LEFT,
  AltRight: KEY_LOCATION_RIGHT,
  MetaLeft: KEY_LOCATION_LEFT,
  MetaRight: KEY_LOCATION_RIGHT,
};

/**
 * Derives `location` from `code`.
 *
 * The reference list has no event to read, so it derives the location from the
 * code, where it is a function of the code for every entry: anything prefixed
 * `Numpad` is on the numeric keypad, the eight sided modifiers are left or
 * right, and everything else is standard. Deriving it means the reference list
 * cannot claim `ShiftLeft` is on the right.
 *
 * The live capture prefers the number the browser actually put on the event and
 * only falls back to this function, because a future or vendor-specific code
 * that is not in the table may legitimately report a location this rule cannot
 * guess. The two agree for every code the table knows, so the reference list
 * and the live capture cannot contradict each other.
 */
export function locationOfCode(code: string): number {
  if (code in SIDED_CODES) return SIDED_CODES[code];
  if (code.startsWith('Numpad')) return KEY_LOCATION_NUMPAD;
  return KEY_LOCATION_STANDARD;
}

export interface KeyReferenceEntry {
  /** `KeyboardEvent.code`: the physical key. */
  code: string;
  /** The character this physical key produces on a US QWERTY layout. */
  key: string;
  /** The legacy `keyCode` / `which` value for this physical key. */
  keyCode: number;
  /** Chinese label shown in the reference list. */
  zh: string;
}

/**
 * The reference list, also used as the lookup table.
 *
 * Ordered the way a keyboard is laid out rather than alphabetically: the lists
 * the user is scanning are "letters", "digits", "function row", "navigation",
 * "modifiers", "punctuation", "numpad".
 */
export const KEY_REFERENCE: KeyReferenceEntry[] = [
  // Letters. The legacy value is the *uppercase* ASCII code, which is why
  // pressed 'a' and pressed 'A' both report 65 and neither reports 97.
  { code: 'KeyA', key: 'a', keyCode: 65, zh: '字母 A' },
  { code: 'KeyB', key: 'b', keyCode: 66, zh: '字母 B' },
  { code: 'KeyC', key: 'c', keyCode: 67, zh: '字母 C' },
  { code: 'KeyD', key: 'd', keyCode: 68, zh: '字母 D' },
  { code: 'KeyE', key: 'e', keyCode: 69, zh: '字母 E' },
  { code: 'KeyF', key: 'f', keyCode: 70, zh: '字母 F' },
  { code: 'KeyG', key: 'g', keyCode: 71, zh: '字母 G' },
  { code: 'KeyH', key: 'h', keyCode: 72, zh: '字母 H' },
  { code: 'KeyI', key: 'i', keyCode: 73, zh: '字母 I' },
  { code: 'KeyJ', key: 'j', keyCode: 74, zh: '字母 J' },
  { code: 'KeyK', key: 'k', keyCode: 75, zh: '字母 K' },
  { code: 'KeyL', key: 'l', keyCode: 76, zh: '字母 L' },
  { code: 'KeyM', key: 'm', keyCode: 77, zh: '字母 M' },
  { code: 'KeyN', key: 'n', keyCode: 78, zh: '字母 N' },
  { code: 'KeyO', key: 'o', keyCode: 79, zh: '字母 O' },
  { code: 'KeyP', key: 'p', keyCode: 80, zh: '字母 P' },
  { code: 'KeyQ', key: 'q', keyCode: 81, zh: '字母 Q' },
  { code: 'KeyR', key: 'r', keyCode: 82, zh: '字母 R' },
  { code: 'KeyS', key: 's', keyCode: 83, zh: '字母 S' },
  { code: 'KeyT', key: 't', keyCode: 84, zh: '字母 T' },
  { code: 'KeyU', key: 'u', keyCode: 85, zh: '字母 U' },
  { code: 'KeyV', key: 'v', keyCode: 86, zh: '字母 V' },
  { code: 'KeyW', key: 'w', keyCode: 87, zh: '字母 W' },
  { code: 'KeyX', key: 'x', keyCode: 88, zh: '字母 X' },
  { code: 'KeyY', key: 'y', keyCode: 89, zh: '字母 Y' },
  { code: 'KeyZ', key: 'z', keyCode: 90, zh: '字母 Z' },

  // Digits. With Shift the key becomes '!' but the code and the legacy value do
  // not change, which is the whole point of "code is physical".
  { code: 'Digit0', key: '0', keyCode: 48, zh: '主键盘数字 0' },
  { code: 'Digit1', key: '1', keyCode: 49, zh: '主键盘数字 1' },
  { code: 'Digit2', key: '2', keyCode: 50, zh: '主键盘数字 2' },
  { code: 'Digit3', key: '3', keyCode: 51, zh: '主键盘数字 3' },
  { code: 'Digit4', key: '4', keyCode: 52, zh: '主键盘数字 4' },
  { code: 'Digit5', key: '5', keyCode: 53, zh: '主键盘数字 5' },
  { code: 'Digit6', key: '6', keyCode: 54, zh: '主键盘数字 6' },
  { code: 'Digit7', key: '7', keyCode: 55, zh: '主键盘数字 7' },
  { code: 'Digit8', key: '8', keyCode: 56, zh: '主键盘数字 8' },
  { code: 'Digit9', key: '9', keyCode: 57, zh: '主键盘数字 9' },

  // Function row.
  { code: 'F1', key: 'F1', keyCode: 112, zh: '功能键 F1' },
  { code: 'F2', key: 'F2', keyCode: 113, zh: '功能键 F2' },
  { code: 'F3', key: 'F3', keyCode: 114, zh: '功能键 F3' },
  { code: 'F4', key: 'F4', keyCode: 115, zh: '功能键 F4' },
  { code: 'F5', key: 'F5', keyCode: 116, zh: '功能键 F5' },
  { code: 'F6', key: 'F6', keyCode: 117, zh: '功能键 F6' },
  { code: 'F7', key: 'F7', keyCode: 118, zh: '功能键 F7' },
  { code: 'F8', key: 'F8', keyCode: 119, zh: '功能键 F8' },
  { code: 'F9', key: 'F9', keyCode: 120, zh: '功能键 F9' },
  { code: 'F10', key: 'F10', keyCode: 121, zh: '功能键 F10' },
  { code: 'F11', key: 'F11', keyCode: 122, zh: '功能键 F11' },
  { code: 'F12', key: 'F12', keyCode: 123, zh: '功能键 F12' },

  // Editing and navigation.
  { code: 'Escape', key: 'Escape', keyCode: 27, zh: 'Esc' },
  { code: 'Tab', key: 'Tab', keyCode: 9, zh: 'Tab' },
  { code: 'CapsLock', key: 'CapsLock', keyCode: 20, zh: 'Caps Lock' },
  { code: 'Backspace', key: 'Backspace', keyCode: 8, zh: '退格' },
  { code: 'Enter', key: 'Enter', keyCode: 13, zh: '主键盘回车' },
  { code: 'Space', key: ' ', keyCode: 32, zh: '空格（key 是一个空格字符）' },
  { code: 'Insert', key: 'Insert', keyCode: 45, zh: 'Insert' },
  { code: 'Delete', key: 'Delete', keyCode: 46, zh: 'Delete' },
  { code: 'Home', key: 'Home', keyCode: 36, zh: 'Home' },
  { code: 'End', key: 'End', keyCode: 35, zh: 'End' },
  { code: 'PageUp', key: 'PageUp', keyCode: 33, zh: 'Page Up' },
  { code: 'PageDown', key: 'PageDown', keyCode: 34, zh: 'Page Down' },
  { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37, zh: '方向键 ←' },
  { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38, zh: '方向键 ↑' },
  { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39, zh: '方向键 →' },
  { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40, zh: '方向键 ↓' },
  { code: 'PrintScreen', key: 'PrintScreen', keyCode: 44, zh: 'Print Screen' },
  { code: 'ScrollLock', key: 'ScrollLock', keyCode: 145, zh: 'Scroll Lock' },
  { code: 'Pause', key: 'Pause', keyCode: 19, zh: 'Pause' },
  { code: 'ContextMenu', key: 'ContextMenu', keyCode: 93, zh: '菜单键（右键菜单）' },

  // Modifiers. Left and right share a legacy value but not a code, which is the
  // clearest example of code being strictly more informative than keyCode.
  { code: 'ShiftLeft', key: 'Shift', keyCode: 16, zh: '左 Shift' },
  { code: 'ShiftRight', key: 'Shift', keyCode: 16, zh: '右 Shift' },
  { code: 'ControlLeft', key: 'Control', keyCode: 17, zh: '左 Ctrl' },
  { code: 'ControlRight', key: 'Control', keyCode: 17, zh: '右 Ctrl' },
  { code: 'AltLeft', key: 'Alt', keyCode: 18, zh: '左 Alt' },
  { code: 'AltRight', key: 'Alt', keyCode: 18, zh: '右 Alt（AltGr）' },
  { code: 'MetaLeft', key: 'Meta', keyCode: 91, zh: '左 Meta（Windows / Command）' },
  { code: 'MetaRight', key: 'Meta', keyCode: 92, zh: '右 Meta' },
  { code: 'NumLock', key: 'NumLock', keyCode: 144, zh: 'Num Lock' },

  // Punctuation, named after the US QWERTY position.
  { code: 'Backquote', key: '`', keyCode: 192, zh: '反引号键位' },
  { code: 'Minus', key: '-', keyCode: 189, zh: '减号键位' },
  { code: 'Equal', key: '=', keyCode: 187, zh: '等号键位' },
  { code: 'BracketLeft', key: '[', keyCode: 219, zh: '左方括号键位' },
  { code: 'BracketRight', key: ']', keyCode: 221, zh: '右方括号键位' },
  { code: 'Backslash', key: '\\', keyCode: 220, zh: '反斜杠键位' },
  { code: 'Semicolon', key: ';', keyCode: 186, zh: '分号键位' },
  { code: 'Quote', key: "'", keyCode: 222, zh: '引号键位' },
  { code: 'Comma', key: ',', keyCode: 188, zh: '逗号键位' },
  { code: 'Period', key: '.', keyCode: 190, zh: '句点键位' },
  { code: 'Slash', key: '/', keyCode: 191, zh: '斜杠键位' },

  // Numeric keypad. The codes are distinct from the main row, and the legacy
  // values are too, which is what makes it possible to tell Numpad1 from Digit1
  // at all in legacy code.
  { code: 'Numpad0', key: '0', keyCode: 96, zh: '小键盘 0' },
  { code: 'Numpad1', key: '1', keyCode: 97, zh: '小键盘 1' },
  { code: 'Numpad2', key: '2', keyCode: 98, zh: '小键盘 2' },
  { code: 'Numpad3', key: '3', keyCode: 99, zh: '小键盘 3' },
  { code: 'Numpad4', key: '4', keyCode: 100, zh: '小键盘 4' },
  { code: 'Numpad5', key: '5', keyCode: 101, zh: '小键盘 5' },
  { code: 'Numpad6', key: '6', keyCode: 102, zh: '小键盘 6' },
  { code: 'Numpad7', key: '7', keyCode: 103, zh: '小键盘 7' },
  { code: 'Numpad8', key: '8', keyCode: 104, zh: '小键盘 8' },
  { code: 'Numpad9', key: '9', keyCode: 105, zh: '小键盘 9' },
  { code: 'NumpadAdd', key: '+', keyCode: 107, zh: '小键盘加号' },
  { code: 'NumpadSubtract', key: '-', keyCode: 109, zh: '小键盘减号' },
  { code: 'NumpadMultiply', key: '*', keyCode: 106, zh: '小键盘乘号' },
  { code: 'NumpadDivide', key: '/', keyCode: 111, zh: '小键盘除号' },
  { code: 'NumpadDecimal', key: '.', keyCode: 110, zh: '小键盘小数点' },
  { code: 'NumpadEnter', key: 'Enter', keyCode: 13, zh: '小键盘回车' },
];

/**
 * The lookup table, derived from the reference list.
 *
 * Deriving instead of writing a second copy is deliberate: two hand-maintained
 * copies of 100-odd numbers will drift, and the drift would show up as the live
 * capture contradicting the cheat sheet right next to it.
 */
export const LEGACY_KEY_CODES: Record<string, number> = Object.fromEntries(
  KEY_REFERENCE.map((entry) => [entry.code, entry.keyCode]),
);

const CODE_LABELS: Record<string, string> = Object.fromEntries(
  KEY_REFERENCE.map((entry) => [entry.code, entry.zh]),
);

/** The Chinese label for a physical key, if the table knows it. */
export function describeCode(code: string): string | null {
  return CODE_LABELS[code] ?? null;
}

export type KeyCodeSource =
  /** Taken from the event because the browser reported a number itself. */
  | 'browser'
  /** Known position, looked up in the legacy table. */
  | 'table'
  /** Printable character not in the table; the code point is used. */
  | 'char'
  /** Nothing sensible to report. */
  | 'none';

export interface KeyEventLike {
  key: string;
  code: string;
  /** Whatever the browser itself put on the event, shown as-is when present. */
  keyCode?: number;
  which?: number;
  location?: number;
  repeat?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface KeyAnalysis {
  key: string;
  code: string;
  /** The legacy keyCode the tool reports, or null when there is none. */
  keyCode: number | null;
  keyCodeSource: KeyCodeSource;
  /** The legacy `which` value: the browser's if it reported one, else keyCode. */
  which: number | null;
  location: number;
  locationName: string;
  /** Chinese name of the physical key, when the table knows the code. */
  codeLabel: string | null;
  modifiers: ModifierState;
  /** Modifier names that are held, e.g. ['Ctrl', 'Shift']. */
  modifierNames: string[];
  /** True when `key` is exactly one Unicode code point. */
  printable: boolean;
  /** The code point of `key`, or null for named keys such as Enter. */
  codePoint: number | null;
  /** `U+0061` style rendering of the code point. */
  codePointHex: string | null;
  repeat: boolean;
  /** A one-line explanation of what is unusual about this particular event. */
  note: string;
}

/**
 * The legacy `keyCode` for a physical key.
 *
 * Falls back to the character code only when the code is unknown *and* the key is
 * a single BMP code point. Two consequences are worth spelling out because they
 * are exactly what people get wrong:
 *
 * - `KeyA` with `key === 'a'` reports 65, not 97. Legacy values for letters are
 *   the uppercase ASCII codes.
 * - `Digit1` with Shift held (`key === '!'`) still reports 49, because the value
 *   describes the key, not the character.
 */
export function resolveKeyCode(event: {
  code: string;
  key: string;
  keyCode?: number;
}): { value: number | null; source: KeyCodeSource } {
  if (typeof event.keyCode === 'number' && Number.isFinite(event.keyCode)) {
    return { value: event.keyCode, source: 'browser' };
  }

  const known = LEGACY_KEY_CODES[event.code];
  if (typeof known === 'number') return { value: known, source: 'table' };

  const key = event.key;
  if (typeof key === 'string' && [...key].length === 1) {
    const point = key.codePointAt(0) ?? 0;
    // Legacy browsers reported the *uppercase* code for Latin letters; for
    // everything else outside the ASCII range the value was platform- and
    // IME-dependent (229 is common), so no number is claimed.
    if (point >= 0x61 && point <= 0x7a) {
      return { value: point - 0x20, source: 'char' };
    }
    if (point > 0 && point <= 0x7f) return { value: point, source: 'char' };
    return { value: null, source: 'none' };
  }

  return { value: null, source: 'none' };
}

function modifierStateOf(event: KeyEventLike): ModifierState {
  return {
    ctrl: event.ctrlKey === true,
    shift: event.shiftKey === true,
    alt: event.altKey === true,
    meta: event.metaKey === true,
  };
}

const MODIFIER_NAMES: Array<[keyof ModifierState, string]> = [
  ['ctrl', 'Ctrl'],
  ['shift', 'Shift'],
  ['alt', 'Alt'],
  ['meta', 'Meta'],
];

/** Turns a raw event into everything the UI shows about it. */
export function analyseKeyEvent(event: KeyEventLike): KeyAnalysis {
  const resolved = resolveKeyCode(event);
  const key = typeof event.key === 'string' ? event.key : '';
  const code = typeof event.code === 'string' ? event.code : '';
  // Prefer the browser's own `location` and fall back to deriving it from the
  // code. Reading the reported value matters for codes the table has never
  // heard of; deriving matters when a synthetic event (or a test) omits it.
  const reportedLocation =
    typeof event.location === 'number' && Number.isFinite(event.location)
      ? event.location
      : null;
  const location = reportedLocation ?? locationOfCode(code);
  const modifiers = modifierStateOf(event);

  const characters = [...key];
  const printable = characters.length === 1;
  const codePoint = printable ? (key.codePointAt(0) ?? null) : null;
  const codePointHex =
    codePoint === null
      ? null
      : `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

  const which =
    typeof event.which === 'number' && Number.isFinite(event.which)
      ? event.which
      : resolved.value;

  const notes: string[] = [];
  if (printable) {
    notes.push(
      `key 是一个字符（码位 ${codePointHex}），code 指向产生它的物理键位。`,
    );
  } else if (key !== '') {
    notes.push(
      'key 是"键名"而不是字符，没有对应的码位；这类键（功能键、方向键、修饰键）只由 code 区分。',
    );
  } else {
    notes.push('浏览器没有给出 key，无法判断字符。');
  }
  if (resolved.source === 'browser') {
    notes.push(
      `keyCode = ${resolved.value} 直接取自事件本身（已废弃，且不同浏览器可能给出不同的值）。`,
    );
  } else if (resolved.source === 'table') {
    notes.push(
      `keyCode = ${resolved.value} 由物理键位 ${code || '(空)'} 查表得到，与是否按住 Shift 无关。`,
    );
  } else if (resolved.source === 'char') {
    notes.push(
      `keyCode = ${resolved.value} 是按字符码位推算的兜底值：该键位不在常见表里，历史浏览器对它的取值本就不一致。`,
    );
  } else {
    notes.push('该键位没有可用的历史 keyCode 值。');
  }
  if (code === 'Space') {
    notes.push('注意空格的 key 是一个空格字符 " "，而不是 "Space"。');
  }
  if (code.startsWith('Numpad')) {
    notes.push(
      '小键盘的 code 以 Numpad 开头，与主键盘的同名键不同；关闭 Num Lock 时 key 会变成方向键或编辑键名，但 code 不变。',
    );
  }

  return {
    key,
    code,
    keyCode: resolved.value,
    keyCodeSource: resolved.source,
    which,
    location,
    locationName: locationName(location),
    codeLabel: describeCode(code),
    modifiers,
    modifierNames: MODIFIER_NAMES.filter(([flag]) => modifiers[flag]).map(
      ([, name]) => name,
    ),
    printable,
    codePoint,
    codePointHex,
    repeat: event.repeat === true,
    note: notes.join(' '),
  };
}

/**
 * Whether the capture surface should call `preventDefault()` for this key.
 *
 * The tool has to stop the arrow keys and space from scrolling the page while it
 * is capturing, and it must not stop anything else:
 *
 * - **Ctrl / Meta / Alt combinations are never intercepted.** Ctrl+W, Cmd+L and
 *   friends belong to the browser; swallowing them from a page is user-hostile
 *   and, for some of them, impossible anyway.
 * - **Nothing is prevented while a text field has focus**, so typing keeps
 *   working.
 * - **Tab is never prevented.** It is the only way a keyboard-only user can
 *   leave the capture area, and trapping focus is a well-known accessibility
 *   failure. Escape, Enter and the function keys are also left alone.
 *
 * Takes a plain object so the decision can be asserted without a browser.
 */
export function shouldPreventDefault(event: {
  code: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  targetIsEditable?: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.targetIsEditable) return false;

  const scrollingKeys = new Set([
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'PageUp',
    'PageDown',
    'Home',
    'End',
  ]);
  return scrollingKeys.has(event.code);
}

/**
 * One row of the capture history.
 *
 * Only what is needed to redraw the list is stored: keeping the raw event would
 * pin a reference to an object the browser reuses, and the history would then
 * show the last key pressed on every row.
 */
export interface KeyHistoryEntry {
  /** Monotonic sequence number, used as the React key and shown to the user. */
  index: number;
  analysis: KeyAnalysis;
}

export const MAX_HISTORY = 40;

/** Prepends an event to the history, trimming to `MAX_HISTORY`. */
export function pushHistory(
  history: KeyHistoryEntry[],
  event: KeyEventLike,
): KeyHistoryEntry[] {
  const next = (history[0]?.index ?? 0) + 1;
  const entry: KeyHistoryEntry = { index: next, analysis: analyseKeyEvent(event) };
  return [entry, ...history].slice(0, MAX_HISTORY);
}

/** Renders the history as TSV, for the copy button and for pasting into a bug report. */
export function historyToTsv(history: KeyHistoryEntry[]): string {
  const header = ['序号', 'key', 'code', 'keyCode', 'which', 'location', '修饰键', '重复'];
  const rows = history.map((entry) => {
    const a = entry.analysis;
    return [
      String(entry.index),
      a.key,
      a.code,
      a.keyCode === null ? '' : String(a.keyCode),
      a.which === null ? '' : String(a.which),
      String(a.location),
      a.modifierNames.join('+'),
      a.repeat ? '是' : '否',
    ].join('\t');
  });
  return [header.join('\t'), ...rows].join('\n');
}

export interface CodeVsKeyExample {
  scenario: string;
  code: string;
  key: string;
  keyCode: number;
  note: string;
}

/**
 * Worked examples of the code-versus-key distinction.
 *
 * Every row is a real, documented behaviour rather than an invented one, and the
 * two layout rows are the reason the distinction matters at all: the same finger
 * movement produces a different character, while `code` and `keyCode` stay put.
 */
export const CODE_VS_KEY_EXAMPLES: CodeVsKeyExample[] = [
  {
    scenario: '美式 QWERTY，直接按 E',
    code: 'KeyE',
    key: 'e',
    keyCode: 69,
    note: 'code 指的是"QWERTY 键盘上 E 所在的那个位置"，与按出来的字符一致，所以这里看不出区别。',
  },
  {
    scenario: '同一物理键，切到 Dvorak 布局',
    code: 'KeyE',
    key: '.',
    keyCode: 69,
    note: '位置没变，字符变了：code 仍是 KeyE，key 变成句点。keyCode 跟着物理键走，仍是 69。',
  },
  {
    scenario: '同一物理键，切到法语 AZERTY',
    code: 'KeyQ',
    key: 'a',
    keyCode: 81,
    note: 'AZERTY 把 A 和 Q 对调了：QWERTY 上按 Q 的位置，在 AZERTY 上打出的是 a。',
  },
  {
    scenario: 'AZERTY 上按 A 所在位置',
    code: 'KeyA',
    key: 'q',
    keyCode: 65,
    note: '反过来的那一半：物理键 KeyA 在 AZERTY 上产生 q。',
  },
  {
    scenario: '按住 Shift 再按主键盘 1',
    code: 'Digit1',
    key: '!',
    keyCode: 49,
    note: '字符变成了感叹号，但位置没变，所以 keyCode 还是 49 而不是 33（感叹号的码位）。',
  },
  {
    scenario: '小键盘 1（Num Lock 打开）',
    code: 'Numpad1',
    key: '1',
    keyCode: 97,
    note: 'key 看起来和主键盘的 1 一样，靠 code 与 keyCode 才能区分：主键盘是 Digit1 / 49。',
  },
  {
    scenario: '小键盘 1（Num Lock 关闭）',
    code: 'Numpad1',
    key: 'End',
    keyCode: 35,
    note: '具体取值取决于操作系统与浏览器；code 始终是 Numpad1，这就是 code 比 key 可靠的地方。',
  },
  {
    scenario: '主键盘回车与小键盘回车',
    code: 'Enter / NumpadEnter',
    key: 'Enter',
    keyCode: 13,
    note: '两者的 key 与 keyCode 完全相同，只有 code 能区分。',
  },
  {
    scenario: '左 Shift 与右 Shift',
    code: 'ShiftLeft / ShiftRight',
    key: 'Shift',
    keyCode: 16,
    note: 'key 与 keyCode 都分不出左右，必须看 code（或 location）。',
  },
];

/**
 * Codes that old code commonly reads but that have no entry of their own.
 *
 * `OSLeft` / `OSRight` were renamed to `MetaLeft` / `MetaRight`; the deprecated
 * spelling still appears in the wild, and the legacy value is the same. Listed
 * so the tool can explain an unfamiliar code instead of shrugging.
 */
export const DEPRECATED_CODE_ALIASES: Record<string, string> = {
  OSLeft: 'MetaLeft',
  OSRight: 'MetaRight',
  NumpadComma: 'NumpadDecimal（部分键盘）',
  Hyper: '（已移除，无对应键位）',
  Super: '（已移除，MetaLeft / MetaRight 的旧名）',
};
