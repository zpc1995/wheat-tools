import { Fragment, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  ShieldKeyholeRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_PATH,
  MAX_MODE,
  PERMISSIONS,
  TRIADS,
  bitsToMode,
  buildChmodCommand,
  describeSpecialBits,
  formatOctal,
  formatSymbolic,
  modeToBits,
  parseChmodCommand,
  parseMode,
  setSpecialBit,
  setTriadBit,
  type ModeBits,
  type Permission,
  type SpecialFlag,
  type Triad,
} from './chmodUtils';

const WHO_LABEL: Record<Triad, string> = {
  user: '用户 (u)',
  group: '组 (g)',
  other: '其他 (o)',
};

const PERMISSION_LABEL: Record<Permission, string> = {
  read: '读 r',
  write: '写 w',
  execute: '执行 x',
};

const SPECIAL_LABELS: { flag: SpecialFlag; label: string }[] = [
  { flag: 'setuid', label: 'setuid (4)' },
  { flag: 'setgid', label: 'setgid (2)' },
  { flag: 'sticky', label: 'sticky (1)' },
];

/** Common modes, so the everyday cases need no clicking at all. */
const PRESETS: { mode: number; label: string; hint: string }[] = [
  { mode: 0o644, label: '644', hint: '普通文件' },
  { mode: 0o755, label: '755', hint: '可执行文件与目录' },
  { mode: 0o600, label: '600', hint: '私钥、凭据' },
  { mode: 0o640, label: '640', hint: '组内只读' },
  { mode: 0o777, label: '777', hint: '所有人可读写执行' },
  { mode: 0o4755, label: '4755', hint: 'setuid 可执行文件' },
  { mode: 0o2755, label: '2755', hint: 'setgid 可执行文件' },
  { mode: 0o1777, label: '1777', hint: 'sticky 目录（/tmp）' },
];

const useStyles = makeStyles({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '16px',
    width: '100%',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  },
  grid: {
    display: 'grid',
    // The first column holds the row label; the three permission columns stay
    // equal so the checkboxes line up under their headers.
    gridTemplateColumns: 'minmax(88px, auto) repeat(3, minmax(56px, 1fr))',
    gap: '8px 12px',
    alignItems: 'center',
  },
  gridHead: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  rowLabel: {
    color: tokens.colorNeutralForeground2,
  },
  specialRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '18px',
    alignItems: 'center',
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  values: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  valueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    minHeight: '40px',
  },
  valueLabel: {
    flex: 'none',
    width: '72px',
    color: tokens.colorNeutralForeground3,
  },
  value: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: 'clamp(22px, 3vw, 30px)',
    fontWeight: 600,
    letterSpacing: '0.04em',
    userSelect: 'all',
    color: tokens.colorBrandForeground1,
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    width: '100%',
    flexWrap: 'wrap',
  },
  input: {
    flex: '1 1 260px',
    minWidth: 0,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  command: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    lineHeight: 1.6,
    overflowWrap: 'anywhere',
    userSelect: 'all',
    padding: '10px 12px',
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
  },
  spacer: {
    flex: '1 1 auto',
  },
});

interface ValueRowProps {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}

/** One read-only result with its copy button. */
function ValueRow({ label, value, copied, onCopy }: ValueRowProps) {
  const styles = useStyles();
  return (
    <div className={styles.valueRow}>
      <Caption1 className={styles.valueLabel}>{label}</Caption1>
      <Text className={styles.value}>{value}</Text>
      <Tooltip content={copied ? '已复制' : `复制${label}`} relationship="label" withArrow>
        <Button
          appearance="subtle"
          size="small"
          icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
          onClick={onCopy}
          aria-label={`复制${label}`}
        />
      </Tooltip>
    </div>
  );
}

export function ChmodCalculatorTool() {
  const styles = useStyles();

  // The named bits are the single source of truth; the octal value, the rwx
  // string and the command are all derived from them on every render. One
  // source means the checkbox grid and the two readings cannot disagree.
  const [bits, setBits] = useState<ModeBits>(() => modeToBits(0o755));
  // The reverse input keeps its own text so a half-typed value is not rewritten
  // under the cursor, while a value that does parse updates the grid live.
  const [input, setInput] = useState('rwxr-xr-x');
  const [inputError, setInputError] = useState<string | null>(null);
  const [path, setPath] = useState(DEFAULT_PATH);
  const [copied, setCopied] = useState<string | null>(null);

  const mode = useMemo(() => bitsToMode(bits), [bits]);
  const octal = formatOctal(mode);
  const symbolic = formatSymbolic(mode);
  const command = buildChmodCommand(mode, path);
  const notes = describeSpecialBits(mode);

  // The command is generated and parsed by two separate functions, and the
  // result is displayed rather than assumed: if they ever disagreed, the page
  // would say so instead of showing a command that reproduces another mode.
  const commandParsed = parseChmodCommand(command);
  const commandMatches = commandParsed.ok && commandParsed.mode === mode;

  /** Adopts a mode wholesale and mirrors it into the reverse input. */
  function applyMode(next: number) {
    setBits(modeToBits(next));
    setInput(formatSymbolic(next));
    setInputError(null);
  }

  function onTriadChange(who: Triad, permission: Permission, value: boolean) {
    applyMode(bitsToMode(setTriadBit(bits, who, permission, value)));
  }

  function onSpecialChange(flag: SpecialFlag, value: boolean) {
    applyMode(bitsToMode(setSpecialBit(bits, flag, value)));
  }

  function onInputChange(text: string) {
    setInput(text);
    if (text.trim() === '') {
      // Empty is not an error yet: the user is probably retyping from scratch.
      setInputError(null);
      return;
    }
    const result = parseMode(text);
    if (result.ok) {
      setBits(modeToBits(result.mode));
      setInputError(null);
    } else {
      setInputError(result.error);
    }
  }

  async function copy(value: string, key: string) {
    const ok = await copyText(value);
    // On failure the icon stays as it was: claiming a copy that did not happen
    // is worse than showing nothing at all.
    if (!ok) return;
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
  }

  const inputFilled = input.trim() !== '';

  return (
    <div className="wt-surface">
      <div className="wt-surface__header">
        <ShieldKeyholeRegular />
        <Text as="h2" size={300} weight="semibold">
          权限位
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.hint}>勾选即实时换算</Caption1>
      </div>

      {/* The shared body class is a flex row; the direction has to be set or the
          sections would lay out side by side. */}
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.content}>
          <section className={styles.section}>
            <div className={styles.grid} role="group" aria-label="读写执行权限位">
              <span className={styles.gridHead} aria-hidden="true" />
              {PERMISSIONS.map((permission) => (
                <span key={permission} className={styles.gridHead}>
                  {PERMISSION_LABEL[permission]}
                </span>
              ))}
              {TRIADS.map((who) => (
                <Fragment key={who}>
                  <span className={styles.rowLabel}>{WHO_LABEL[who]}</span>
                  {PERMISSIONS.map((permission) => (
                    <Checkbox
                      key={permission}
                      checked={bits[who][permission]}
                      onChange={(_, data) => onTriadChange(who, permission, Boolean(data.checked))}
                      aria-label={`${WHO_LABEL[who]} ${PERMISSION_LABEL[permission]}`}
                    />
                  ))}
                </Fragment>
              ))}
            </div>

            <div className={styles.specialRow} role="group" aria-label="特殊位">
              {SPECIAL_LABELS.map((item) => (
                <Checkbox
                  key={item.flag}
                  checked={bits[item.flag]}
                  onChange={(_, data) => onSpecialChange(item.flag, Boolean(data.checked))}
                  label={item.label}
                  aria-label={`特殊位 ${item.label}`}
                />
              ))}
            </div>

            <div className={styles.presets} role="group" aria-label="常用权限">
              <Caption1 className={styles.hint}>常用</Caption1>
              {PRESETS.map((preset) => (
                <Tooltip key={preset.label} content={preset.hint} relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    size="small"
                    onClick={() => applyMode(preset.mode)}
                    aria-label={`设为 ${preset.label}（${preset.hint}）`}
                  >
                    {preset.label}
                  </Button>
                </Tooltip>
              ))}
            </div>
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              结果
            </Text>
            <div className={styles.values}>
              <ValueRow
                label="八进制"
                value={octal}
                copied={copied === 'octal'}
                onCopy={() => copy(octal, 'octal')}
              />
              <ValueRow
                label="符号"
                value={symbolic}
                copied={copied === 'symbolic'}
                onCopy={() => copy(symbolic, 'symbolic')}
              />
            </div>
            <Caption1 className={styles.hint}>
              只有设了特殊位才有第 4 位；符号串就是 `ls -l` 里那 9 个字符（前面的文件类型不算）。
              特殊位落在执行位上：小写 s / t 表示特殊位已设且可执行，大写 S / T 表示已设但不可执行。
            </Caption1>
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              反向解析
            </Text>
            <div className={styles.inputRow}>
              <input
                className={`wt-inline-input ${styles.input}`}
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder={`八进制（如 4755，范围 0-${MAX_MODE.toString(8)}）或符号（如 rwsr-xr-x）`}
                aria-label="权限输入：八进制或符号形式"
                spellCheck={false}
                autoComplete="off"
              />
              <Button appearance="secondary" onClick={() => onInputChange(formatOctal(mode))}>
                用当前值
              </Button>
            </div>
            {inputError ? (
              <MessageBar intent="error">
                <MessageBarBody>{inputError}</MessageBarBody>
              </MessageBar>
            ) : inputFilled ? (
              <Caption1 className={styles.hint}>
                已识别为八进制 {octal}、符号 {symbolic}，复选框已同步。
              </Caption1>
            ) : (
              <Caption1 className={styles.hint}>
                接受 3 到 4 位八进制，或 9 位符号形式；`ls -l` 那种带文件类型的 10 个字符也可以。
              </Caption1>
            )}
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              chmod 命令
            </Text>
            <div className={styles.inputRow}>
              <Caption1 className={styles.hint}>目标路径</Caption1>
              <input
                className={`wt-inline-input ${styles.input}`}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={DEFAULT_PATH}
                aria-label="chmod 命令中的目标路径"
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                appearance="subtle"
                icon={copied === 'command' ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={() => copy(command, 'command')}
                aria-label="复制 chmod 命令"
              >
                {copied === 'command' ? '已复制' : '复制'}
              </Button>
            </div>
            <div className={styles.command}>{command}</div>
            <div className={styles.inputRow}>
              <Badge appearance="tint" color={commandMatches ? 'success' : 'danger'} size="small">
                {commandMatches ? `命令可独立解析回 ${octal}` : '命令无法解析回当前权限'}
              </Badge>
              {commandParsed.ok && commandParsed.path ? (
                <Caption1 className={styles.hint}>解析出的路径：{commandParsed.path}</Caption1>
              ) : null}
            </div>
          </section>

          <Divider />

          <section className={styles.section}>
            <Text as="h2" size={300} weight="semibold">
              特殊位含义
            </Text>
            {notes.length === 0 ? (
              <Caption1 className={styles.hint}>当前没有设置任何特殊位。</Caption1>
            ) : (
              notes.map((note) => (
                <MessageBar key={note.flag} intent={note.warning ? 'warning' : 'info'}>
                  <MessageBarBody>
                    <MessageBarTitle>{note.label}</MessageBarTitle>
                    {note.detail}
                  </MessageBarBody>
                </MessageBar>
              ))
            )}
            <MessageBar intent="info">
              <MessageBarBody>
                这里只算权限位，不读取也不修改任何文件，因此看不到 ACL（`getfacl` / `setfacl`
                那一套）、SELinux 上下文或挂载选项的影响：带 ACL 的文件用 `ls -l` 看到的权限后面
                还会多一个 `+`，实际权限以 ACL 为准；带 `nosuid` 的挂载点也会让 setuid / setgid 失效。
              </MessageBarBody>
            </MessageBar>
          </section>
        </div>
      </div>
    </div>
  );
}
