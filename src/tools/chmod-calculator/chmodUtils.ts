/**
 * chmod permission arithmetic.
 *
 * A Unix mode is twelve bits: three "special" bits (setuid, setgid, sticky)
 * followed by three permission triads (user, group, other), each holding
 * read / write / execute. This module renders that value three ways — octal,
 * the nine-character symbolic form `ls -l` prints, and a `chmod` command — and
 * parses all three back.
 *
 * Everything here is a pure function of the number passed in: nothing reads the
 * filesystem, the clock or React. That is what makes the transform exhaustively
 * testable, which matters because the special bits are exactly where
 * hand-written implementations go wrong. `4755` and `4644` both have setuid
 * set, but only the first is executable by its owner; `ls -l` distinguishes
 * them as `rwsr-xr-x` versus `rwSr--r--`. A renderer that always prints a
 * lowercase `s` loses a real bit and reports a mode that behaves differently.
 *
 * ## The invariant the checks defend
 *
 * `parseSymbolic(formatSymbolic(mode)) === mode` for every mode from 0 to
 * 0o7777, and likewise through octal and through the generated `chmod` command.
 * The check script walks all 4096 values instead of sampling, and cross-checks
 * the symbolic output against CPython's `stat.filemode`, an independent
 * implementation of the same `ls -l` rules.
 */

/** Which permission triad a bit belongs to. */
export type Triad = 'user' | 'group' | 'other';

/** One permission inside a triad. */
export type Permission = 'read' | 'write' | 'execute';

/** The three bits that sit in front of the triads. */
export type SpecialFlag = 'setuid' | 'setgid' | 'sticky';

/** The three read / write / execute bits of one triad. */
export interface TriadBits {
  read: boolean;
  write: boolean;
  execute: boolean;
}

/** A complete mode, decomposed into named bits. */
export interface ModeBits {
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
  user: TriadBits;
  group: TriadBits;
  other: TriadBits;
}

export const READ_BIT = 0o4;
export const WRITE_BIT = 0o2;
export const EXECUTE_BIT = 0o1;
export const SETUID_BIT = 0o4000;
export const SETGID_BIT = 0o2000;
export const STICKY_BIT = 0o1000;

/**
 * Largest representable mode, 0o7777 (4095).
 *
 * A chmod mode is twelve bits wide, so anything above this is not a permission
 * value at all. The bound is stated once here and reused by every parser.
 */
export const MAX_MODE = 0o7777;

/** Triads in the order they appear in an octal mode (most significant first). */
export const TRIADS: Triad[] = ['user', 'group', 'other'];

/** Permissions in the order they appear inside a triad. */
export const PERMISSIONS: Permission[] = ['read', 'write', 'execute'];

/** The bit each permission contributes inside its own triad. */
export const PERMISSION_BITS: Record<Permission, number> = {
  read: READ_BIT,
  write: WRITE_BIT,
  execute: EXECUTE_BIT,
};

/** The bit each special flag contributes to the mode. */
export const SPECIAL_BITS: Record<SpecialFlag, number> = {
  setuid: SETUID_BIT,
  setgid: SETGID_BIT,
  sticky: STICKY_BIT,
};

/** How many bits each triad is shifted by, keyed by triad. */
const TRIAD_SHIFT: Record<Triad, number> = { user: 6, group: 3, other: 0 };

/** Which special bit belongs to which triad's execute slot. */
const TRIAD_SPECIAL: Record<Triad, SpecialFlag> = {
  user: 'setuid',
  group: 'setgid',
  other: 'sticky',
};

/** An all-clear mode: every bit off. */
export function emptyModeBits(): ModeBits {
  // Each triad is a fresh object. Sharing one frozen literal between the three
  // would be cheaper, but a later `setTriadBit` spread could then leak a change
  // from one triad into another before the copy happens.
  return {
    setuid: false,
    setgid: false,
    sticky: false,
    user: { read: false, write: false, execute: false },
    group: { read: false, write: false, execute: false },
    other: { read: false, write: false, execute: false },
  };
}

/** Collapses named bits into the octal value. */
export function bitsToMode(bits: ModeBits): number {
  let mode = 0;
  if (bits.setuid) mode |= SETUID_BIT;
  if (bits.setgid) mode |= SETGID_BIT;
  if (bits.sticky) mode |= STICKY_BIT;

  for (const who of TRIADS) {
    const triad = bits[who];
    let value = 0;
    if (triad.read) value |= READ_BIT;
    if (triad.write) value |= WRITE_BIT;
    if (triad.execute) value |= EXECUTE_BIT;
    mode |= value << TRIAD_SHIFT[who];
  }
  return mode;
}

/**
 * Expands an octal value into named bits.
 *
 * The input is masked to the twelve meaningful bits rather than rejected: this
 * is used on values the UI already validated, and masking is the same thing the
 * kernel does when it reads a mode.
 */
export function modeToBits(mode: number): ModeBits {
  const value = mode & MAX_MODE;
  const triad = (who: Triad): TriadBits => {
    const shift = TRIAD_SHIFT[who];
    return {
      read: (value & (READ_BIT << shift)) !== 0,
      write: (value & (WRITE_BIT << shift)) !== 0,
      execute: (value & (EXECUTE_BIT << shift)) !== 0,
    };
  };

  return {
    setuid: (value & SETUID_BIT) !== 0,
    setgid: (value & SETGID_BIT) !== 0,
    sticky: (value & STICKY_BIT) !== 0,
    user: triad('user'),
    group: triad('group'),
    other: triad('other'),
  };
}

/** Returns a copy with one triad bit changed. */
export function setTriadBit(
  bits: ModeBits,
  who: Triad,
  permission: Permission,
  value: boolean,
): ModeBits {
  const next: TriadBits = {
    read: permission === 'read' ? value : bits[who].read,
    write: permission === 'write' ? value : bits[who].write,
    execute: permission === 'execute' ? value : bits[who].execute,
  };
  if (who === 'user') return { ...bits, user: next };
  if (who === 'group') return { ...bits, group: next };
  return { ...bits, other: next };
}

/** Returns a copy with one special bit changed. */
export function setSpecialBit(
  bits: ModeBits,
  flag: SpecialFlag,
  value: boolean,
): ModeBits {
  if (flag === 'setuid') return { ...bits, setuid: value };
  if (flag === 'setgid') return { ...bits, setgid: value };
  return { ...bits, sticky: value };
}

/**
 * Octal rendering: three digits normally, four once a special bit is set.
 *
 * Forcing four digits always (`0755`) would be defensible, but every place
 * people read a mode — `stat -c %a`, `ls -l` cross-references, `chmod` examples
 * in man pages — drops the leading zero when there is nothing special to show.
 * Matching that convention means the big number on screen can be pasted into a
 * terminal command as-is.
 */
export function formatOctal(mode: number): string {
  const value = mode & MAX_MODE;
  return value.toString(8).padStart(value > 0o777 ? 4 : 3, '0');
}

/**
 * The character shown in an execute slot when the matching special bit is set.
 * `s`/`t` mean "special bit and executable"; the uppercase forms mean "special
 * bit but not executable" — that is `ls -l` behaviour, not an aesthetic choice.
 */
const SPECIAL_EXEC_CHAR: Record<Triad, { set: string; unset: string }> = {
  user: { set: 's', unset: 'S' },
  group: { set: 's', unset: 'S' },
  other: { set: 't', unset: 'T' },
};

/**
 * The nine-character symbolic form, without the leading file-type character.
 *
 * `formatSymbolic(0o755)` is `rwxr-xr-x`; `stat` and `ls -l` would prefix a
 * file type (`-rwxr-xr-x`), which the parsers below also accept.
 */
export function formatSymbolic(mode: number): string {
  const bits = modeToBits(mode);
  const special: Record<Triad, boolean> = {
    user: bits.setuid,
    group: bits.setgid,
    other: bits.sticky,
  };

  let out = '';
  for (const who of TRIADS) {
    const triad = bits[who];
    out += triad.read ? 'r' : '-';
    out += triad.write ? 'w' : '-';

    if (triad.execute) {
      out += special[who] ? SPECIAL_EXEC_CHAR[who].set : 'x';
    } else {
      // With no execute bit the special bit is still set, so it must still be
      // visible — as the uppercase form. Falling through to `-` here is the
      // classic bug that turns 4644 into a plain 0644 on screen.
      out += special[who] ? SPECIAL_EXEC_CHAR[who].unset : '-';
    }
  }
  return out;
}

/** The result of parsing text into a mode. */
export type ParseResult =
  | { ok: true; mode: number }
  | { ok: false; error: string };

/** A ten-character symbolic string is allowed to start with a file type. */
const FILE_TYPE_CHARS = '-dlbcpsD?';

/**
 * Parses a bare octal mode.
 *
 * Deliberately stricter than `parseInt`: `parseInt('19', 8)` returns 1 and
 * `parseInt('755abc', 8)` returns 755, so a validation layer built on it
 * silently accepts a mode the user never typed. Digits outside 0-7 and lengths
 * above four are rejected with an explanation instead.
 */
export function parseOctal(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: '请输入八进制或符号形式' };
  if (/^-[0-9]+$/.test(trimmed)) {
    return { ok: false, error: '权限值不能为负数' };
  }
  if (/[89]/.test(trimmed)) {
    return { ok: false, error: '八进制位只能是 0-7，8 和 9 不是合法的权限位' };
  }
  if (!/^[0-7]+$/.test(trimmed)) {
    return { ok: false, error: '不是合法的八进制：只允许数字 0-7' };
  }
  if (trimmed.length > 4) {
    return { ok: false, error: '八进制最多 4 位（第 1 位是特殊位，如 4755）' };
  }
  return { ok: true, mode: parseInt(trimmed, 8) };
}

/** Parses the nine-character (optionally ten) symbolic form. */
export function parseSymbolic(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: '请输入八进制或符号形式' };

  let body = trimmed;
  if (body.length === 10) {
    // `ls -l` and `stat` print ten characters. Accept that shape only when the
    // first character really is a file type, so a ten-character typo is
    // reported rather than silently reinterpreted as nine valid ones.
    if (!FILE_TYPE_CHARS.includes(body[0])) {
      return {
        ok: false,
        error: '符号形式为 9 个字符（如 rwxr-xr-x）；写成 10 个字符时第 1 位须是文件类型（如 -rwxr-xr-x）',
      };
    }
    body = body.slice(1);
  }
  if (body.length !== 9) {
    return {
      ok: false,
      error: `符号形式必须是 9 个字符（如 rwxr-xr-x），当前为 ${body.length} 个`,
    };
  }

  let mode = 0;
  for (let index = 0; index < TRIADS.length; index += 1) {
    const who = TRIADS[index];
    const offset = index * 3;
    const read = body[offset];
    const write = body[offset + 1];
    const execute = body[offset + 2];

    if (read !== 'r' && read !== '-') {
      return {
        ok: false,
        error: `第 ${offset + 1} 位应为 r 或 -，实际为 ${read}`,
      };
    }
    if (write !== 'w' && write !== '-') {
      return {
        ok: false,
        error: `第 ${offset + 2} 位应为 w 或 -，实际为 ${write}`,
      };
    }

    let value = 0;
    if (read === 'r') value |= READ_BIT;
    if (write === 'w') value |= WRITE_BIT;

    // `s` belongs to user / group and `t` to other. Accepting the wrong letter
    // in the wrong column would let `rwtr-xr-x` masquerade as a sticky bit.
    const lower = who === 'other' ? 't' : 's';
    const upper = who === 'other' ? 'T' : 'S';

    if (execute === 'x') {
      value |= EXECUTE_BIT;
    } else if (execute === lower) {
      // Lowercase: the special bit is set *and* the slot is executable.
      value |= EXECUTE_BIT;
      mode |= SPECIAL_BITS[TRIAD_SPECIAL[who]];
    } else if (execute === upper) {
      // Uppercase: the special bit is set and the slot is *not* executable.
      mode |= SPECIAL_BITS[TRIAD_SPECIAL[who]];
    } else if (execute !== '-') {
      return {
        ok: false,
        error: `第 ${offset + 3} 位应为 x、${lower}、${upper} 或 -，实际为 ${execute}`,
      };
    }

    mode |= value << TRIAD_SHIFT[who];
  }

  return { ok: true, mode };
}

/**
 * Parses whatever the user typed, octal or symbolic.
 *
 * The two alphabets do not overlap — octal is digits 0-7, symbolic uses
 * r/w/x/s/S/t/T and dashes — so a single digit decides the branch and neither
 * form can be mistaken for the other.
 */
export function parseMode(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: '请输入八进制或符号形式' };
  if (/[0-9]/.test(trimmed)) return parseOctal(trimmed);
  return parseSymbolic(trimmed);
}

/**
 * What a special bit actually does, and how much it should worry the reader.
 *
 * `warning` is true only for setuid: setgid and sticky change inheritance or
 * deletion rules, while setuid hands out the owner's identity and is the
 * mechanism behind most local privilege-escalation bugs.
 */
export interface SpecialBitNote {
  flag: SpecialFlag;
  label: string;
  detail: string;
  warning: boolean;
}

/** Notes for the special bits that are set in `mode`, in setuid/setgid/sticky order. */
export function describeSpecialBits(mode: number): SpecialBitNote[] {
  const bits = modeToBits(mode);
  const notes: SpecialBitNote[] = [];

  if (bits.setuid) {
    notes.push({
      flag: 'setuid',
      label: 'setuid (4)',
      warning: true,
      detail:
        '以文件所有者的身份执行：运行这个文件的人会临时获得所有者（例如 root）的权限。' +
        '这是 Unix 上提权后门最常用的手段；任何可被他人修改的可执行文件都不该带 setuid，' +
        '脚本本身也会被内核忽略这个位，所以它几乎只在确有必要时才设。',
    });
  }
  if (bits.setgid) {
    notes.push({
      flag: 'setgid',
      label: 'setgid (2)',
      warning: false,
      detail:
        '对可执行文件：以文件所属组的身份运行。' +
        '对目录：目录内新建的文件与子目录会继承该目录的组，而不是创建者的主组，' +
        '常用于共享目录。',
    });
  }
  if (bits.sticky) {
    notes.push({
      flag: 'sticky',
      label: 'sticky (1)',
      warning: false,
      detail:
        '只对目录有意义：目录内的文件只有其所有者、目录所有者或 root 能删除或改名，' +
        '其他人即使有写权限也不能动别人的文件。/tmp 就是典型例子（1777）。',
    });
  }

  return notes;
}

/** Default target shown in the generated command. */
export const DEFAULT_PATH = 'file.txt';

/**
 * Quotes a path so the generated command survives a paste into a shell.
 *
 * The parser below undoes this, which is what keeps the command round-trip
 * honest: whatever quoting is chosen here has to be readable back.
 */
function quotePath(path: string): string {
  const value = path.trim();
  if (value === '') return DEFAULT_PATH;
  // Unquoted only for the characters that never need it. `$`, backticks and
  // quotes are deliberately left out so nothing is expanded after a paste.
  if (/^[A-Za-z0-9._/@%+:,=^-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Builds the `chmod` command for a mode and a target path. */
export function buildChmodCommand(mode: number, path: string = DEFAULT_PATH): string {
  return `chmod ${formatOctal(mode)} ${quotePath(path)}`;
}

/**
 * Splits a shell-ish command line into tokens.
 *
 * Handles single quotes, double quotes and backslash escapes; returns `null`
 * for an unterminated quote rather than guessing. A regex over the whole string
 * would not do, because the path may itself contain digits or dashes.
 */
function tokenize(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let index = 0;

  const flush = () => {
    if (started) {
      tokens.push(current);
      current = '';
      started = false;
    }
  };

  while (index < command.length) {
    const char = command[index];

    if (char === ' ' || char === '\t' || char === '\n') {
      flush();
      index += 1;
    } else if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) return null;
      started = true;
      current += command.slice(index + 1, end);
      index = end + 1;
    } else if (char === '"') {
      started = true;
      index += 1;
      let closed = false;
      while (index < command.length) {
        const inner = command[index];
        if (inner === '\\' && index + 1 < command.length) {
          current += command[index + 1];
          index += 2;
        } else if (inner === '"') {
          closed = true;
          index += 1;
          break;
        } else {
          current += inner;
          index += 1;
        }
      }
      if (!closed) return null;
    } else if (char === '\\' && index + 1 < command.length) {
      started = true;
      current += command[index + 1];
      index += 2;
    } else {
      started = true;
      current += char;
      index += 1;
    }
  }

  flush();
  return tokens;
}

/** A parsed `chmod` command. */
export interface ParsedChmodCommand {
  ok: true;
  mode: number;
  path?: string;
}

export type ChmodCommandResult = ParsedChmodCommand | { ok: false; error: string };

/**
 * Parses a `chmod` command back into a mode.
 *
 * Only the absolute forms are accepted — an octal mode, or the nine-character
 * symbolic string. Relative symbolic edits such as `u+x` cannot be resolved
 * without knowing the mode they start from, so they are out of scope here;
 * silently assuming a base mode would produce a confident wrong answer.
 *
 * The mode is taken from the first non-flag token rather than by scanning the
 * whole line for digits, so a target called `2024-report.txt` cannot be
 * mistaken for the mode.
 */
export function parseChmodCommand(command: string): ChmodCommandResult {
  const trimmed = command.trim();
  if (trimmed === '') return { ok: false, error: '命令为空' };

  const tokens = tokenize(trimmed);
  if (tokens === null) return { ok: false, error: '命令中的引号没有闭合' };
  if (tokens.length === 0) return { ok: false, error: '命令为空' };

  let index = 0;
  if (tokens[index] === 'chmod') index += 1;

  let flagsEnded = false;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!flagsEnded && token === '--') {
      flagsEnded = true;
      index += 1;
      continue;
    }
    // `-R`, `-v`, `--recursive`. A bare `-755` is not a flag, so it falls
    // through and is rejected as a negative mode by the parser.
    if (!flagsEnded && /^-{1,2}[A-Za-z]/.test(token)) {
      index += 1;
      continue;
    }
    break;
  }

  if (index >= tokens.length) {
    return { ok: false, error: '命令里缺少权限值（如 chmod 755 file.txt）' };
  }

  const parsed = parseMode(tokens[index]);
  if (!parsed.ok) return parsed;

  index += 1;
  const path = tokens.slice(index).join(' ');
  return path === '' ? { ok: true, mode: parsed.mode } : { ok: true, mode: parsed.mode, path };
}
