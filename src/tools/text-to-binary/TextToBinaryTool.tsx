import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Caption1,
  Checkbox,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Radio,
  RadioGroup,
  Text,
  Toast,
  ToastTitle,
  Toaster,
  Tooltip,
  makeStyles,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Broom16Regular,
  Checkmark16Regular,
  Code16Regular,
  Copy16Regular,
  DocumentText16Regular,
} from '@fluentui/react-icons';
import {
  MAX_TABLE_BYTES,
  SEPARATOR_MODES,
  binaryToText,
  byteRows,
  naiveCodePointBinary,
  textToBinary,
  type SeparatorMode,
  type TextStats,
} from './binaryUtils';

/** Values that show the interesting parts of UTF-8 at a glance. */
const EXAMPLES = ['A', '中', '😀', 'Hi 世界', 'café'];

const MODE_LABELS: Record<SeparatorMode, string> = {
  none: '无分隔',
  byte: '每 8 位一组',
  group8: '每 8 位一组，每行 8 字节',
};

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  body: {
    flexDirection: 'column',
    gap: '12px',
    padding: '14px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  examples: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
  },
  exampleButton: {
    minWidth: 'auto',
    padding: '2px 8px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
  },
  inputArea: {
    minHeight: '120px',
    maxHeight: '260px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
  },
  outputArea: {
    minHeight: '150px',
    maxHeight: '360px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  stats: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '6px 14px',
    color: tokens.colorNeutralForeground2,
  },
  statValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
  byteLine: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '12px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
    padding: '8px 10px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  tableScroll: {
    maxHeight: '360px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
  },
  headCell: {
    position: 'sticky',
    top: 0,
    textAlign: 'left',
    padding: '6px 10px',
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '4px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  right: {
    textAlign: 'right',
  },
});

/** Byte / character counts, phrased so the distinction cannot be missed. */
function StatsLine({ stats, isText }: { stats: TextStats; isText: boolean }) {
  const styles = useStyles();
  return (
    <div className={styles.stats}>
      <Caption1>
        {isText ? '字节数（UTF-8）' : '字节数'}：
        <span className={styles.statValue}>{stats.byteCount}</span>
      </Caption1>
      <Caption1>
        字符数（码点）：<span className={styles.statValue}>{stats.charCount}</span>
      </Caption1>
      <Caption1>
        UTF-16 码元：<span className={styles.statValue}>{stats.utf16Length}</span>
      </Caption1>
      {stats.utf16Length !== stats.charCount && (
        <Caption1 className={styles.hint}>
          JavaScript 的 <code>.length</code> 会给出 {stats.utf16Length}，因为 BMP
          以外的字符在 UTF-16 里占 2 个码元。
        </Caption1>
      )}
    </div>
  );
}

export function TextToBinaryTool() {
  const styles = useStyles();
  const toasterId = useId('text-to-binary-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [text, setText] = useState('Hi 中😀');
  const [binaryInput, setBinaryInput] = useState('01001000 01101001 00100000 11100100 10111000 10101101');
  const [mode, setMode] = useState<SeparatorMode>('byte');
  const [showNaive, setShowNaive] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } catch {
        // Clipboard access can be denied (insecure context, permissions).
        // Saying so is better than claiming a copy that did not happen.
        notify('复制失败，请手动选择');
      }
    },
    [notify],
  );

  const encoded = useMemo(() => textToBinary(text, mode), [text, mode]);
  const naive = useMemo(() => naiveCodePointBinary(text), [text]);
  const table = useMemo(() => byteRows(encoded.bytes), [encoded.bytes]);
  const decoded = useMemo(() => binaryToText(binaryInput), [binaryInput]);

  // Swap keeps the round trip usable without copy-paste: the current output
  // becomes the input of the other direction.
  const swap = useCallback(() => {
    setBinaryInput(encoded.binary);
    setText(decoded.ok ? decoded.text : '');
  }, [encoded.binary, decoded]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>二进制是按 UTF-8 字节，不是按字符的码位</MessageBarTitle>
            中文一个字在 UTF-8 里占 <strong>3 个字节</strong>，所以是 24 位；
            emoji 占 <strong>4 个字节</strong>，是 32 位；ASCII 字符才是 1 个字节 8 位。
            本工具两边都以字节为单位，这样得到的二进制和文件、网络上传送的字节完全一致。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="文本转二进制">
          <div className="wt-surface__header">
            <Code16Regular />
            <Text as="h2" size={300} weight="semibold">
              文本 → 二进制
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>输出可切换分隔方式</Caption1>
          </div>

          <div className={`wt-surface__body ${styles.body}`}>
            <div className={styles.toolbar}>
              <Caption1 className={styles.hint}>示例</Caption1>
              <div className={styles.examples}>
                {EXAMPLES.map((example) => (
                  <Button
                    key={example}
                    className={styles.exampleButton}
                    appearance="subtle"
                    size="small"
                    onClick={() => setText(example)}
                    aria-label={`示例 ${example}`}
                  >
                    {example}
                  </Button>
                ))}
              </div>
              <span className={styles.spacer} />
              <Tooltip content="清空文本" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={() => setText('')}
                  disabled={text === ''}
                  aria-label="清空文本"
                />
              </Tooltip>
            </div>

            <textarea
              className={`wt-code-area ${styles.inputArea}`}
              style={{ fontSize: 15 }}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="输入任意文本，中文与 emoji 都可以"
              aria-label="文本输入"
              spellCheck={false}
            />

            <StatsLine stats={encoded} isText />

            <div className={styles.toolbar}>
              <RadioGroup
                layout="horizontal"
                value={mode}
                onChange={(_, data) => setMode(data.value as SeparatorMode)}
                aria-label="分隔方式"
              >
                {SEPARATOR_MODES.map((value) => (
                  <Radio key={value} value={value} label={MODE_LABELS[value]} />
                ))}
              </RadioGroup>
              <span className={styles.spacer} />
              <Tooltip content="复制二进制" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={copied === 'binary' ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={() => copy(encoded.binary, 'binary')}
                  disabled={encoded.binary === ''}
                  aria-label="复制二进制"
                />
              </Tooltip>
            </div>

            {encoded.binary === '' ? (
              <div className="wt-empty">
                <Code16Regular />
                <Text weight="semibold">空文本没有字节</Text>
                <Caption1>空字符串在 UTF-8 里是 0 个字节，不是 1 个。</Caption1>
              </div>
            ) : (
              <textarea
                className={`wt-code-area ${styles.outputArea}`}
                value={encoded.binary}
                readOnly
                aria-label="二进制结果"
                spellCheck={false}
              />
            )}

            <div className={styles.byteLine}>
              <Caption1 className={styles.hint}>
                十六进制（每字节两位，测一测和“文本 → 二进制”是否对得上）
              </Caption1>
              <div className={styles.mono}>{encoded.hex === '' ? '（无）' : encoded.hex}</div>
            </div>

            <div className={styles.byteLine}>
              <Caption1 className={styles.hint}>十进制字节</Caption1>
              <div className={styles.mono}>{encoded.decimal === '' ? '（无）' : encoded.decimal}</div>
            </div>

            <Checkbox
              checked={showNaive}
              onChange={(_, data) => setShowNaive(Boolean(data.checked))}
              label="对照：常见错误写法（按字符码位输出）会得到什么"
            />

            {showNaive && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>
                    把“一个字符”当成“一个字节”会得到不同的结果
                  </MessageBarTitle>
                  <div className={styles.mono} style={{ marginBottom: 8 }}>
                    {naive === '' ? '（空）' : naive}
                  </div>
                  这段输出把每个字符的码位直接补成 8 位：中文一个字是 16 位而不是 24
                  位，emoji 是 21 位而不是 32 位，ASCII 之外全都对不上。
                  上面的正确结果是 <strong>{encoded.byteCount} 字节</strong>，
                  而这段错误写法给出的是 {naive === '' ? 0 : naive.split(' ').length} 段。
                </MessageBarBody>
              </MessageBar>
            )}

            {table.rows.length > 0 && (
              <div className={styles.byteLine}>
                <Caption1 className={styles.hint}>
                  逐字节对照（最多显示 {MAX_TABLE_BYTES} 字节）
                </Caption1>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.headCell}>字节</th>
                        <th className={styles.headCell}>二进制</th>
                        <th className={styles.headCell}>十六进制</th>
                        <th className={`${styles.headCell} ${styles.right}`}>十进制</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr key={row.index}>
                          <td className={`${styles.cell} ${styles.right}`}>{row.index}</td>
                          <td className={styles.cell}>{row.binary}</td>
                          <td className={styles.cell}>0x{row.hex}</td>
                          <td className={`${styles.cell} ${styles.right}`}>{row.decimal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.truncated && (
                  <Caption1 className={styles.hint}>
                    仅显示前 {MAX_TABLE_BYTES} 字节，完整结果以上面的二进制、十六进制输出为准。
                  </Caption1>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="wt-surface" aria-label="二进制转文本">
          <div className="wt-surface__header">
            <DocumentText16Regular />
            <Text as="h2" size={300} weight="semibold">
              二进制 → 文本
            </Text>
            <span className={styles.spacer} />
            <Tooltip content="把上方结果填入这里并交换方向" relationship="description" withArrow>
              <Button
                appearance="secondary"
                size="small"
                icon={<ArrowSwap16Regular />}
                onClick={swap}
              >
                交换方向
              </Button>
            </Tooltip>
          </div>

          <div className={`wt-surface__body ${styles.body}`}>
            <div className={styles.toolbar}>
              <Tooltip content="清空二进制输入" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={() => setBinaryInput('')}
                  disabled={binaryInput === ''}
                  aria-label="清空二进制输入"
                />
              </Tooltip>
              <Caption1 className={styles.hint}>
                空格、制表符与换行都会被忽略；其它字符和长度不是 8 的倍数会报错。
              </Caption1>
            </div>

            <textarea
              className={`wt-code-area ${styles.inputArea}`}
              value={binaryInput}
              onChange={(event) => setBinaryInput(event.target.value)}
              placeholder="粘贴由 0 和 1 组成的二进制，例如 01001000 01101001"
              aria-label="二进制输入"
              spellCheck={false}
            />

            {!decoded.ok && (
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>无法解析</MessageBarTitle>
                  {decoded.error}
                </MessageBarBody>
              </MessageBar>
            )}

            {decoded.ok && (
              <>
                <div className={styles.byteLine}>
                  <Caption1 className={styles.hint}>还原的文本</Caption1>
                  <div className={styles.mono} style={{ fontSize: 15, userSelect: 'text' }}>
                    {decoded.text === '' ? '（空文本）' : decoded.text}
                  </div>
                </div>

                <StatsLine stats={decoded} isText={false} />

                <div className={styles.byteLine}>
                  <Caption1 className={styles.hint}>解析出的字节（十六进制）</Caption1>
                  <div className={styles.mono}>
                    {decoded.hex === '' ? '（无）' : decoded.hex}
                  </div>
                </div>

                <div className={styles.byteLine}>
                  <Caption1 className={styles.hint}>解析出的字节（十进制）</Caption1>
                  <div className={styles.mono}>
                    {decoded.decimal === '' ? '（无）' : decoded.decimal}
                  </div>
                </div>

                <div className={styles.toolbar}>
                  <Tooltip content="复制还原的文本" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={copied === 'text' ? <Checkmark16Regular /> : <Copy16Regular />}
                      onClick={() => copy(decoded.text, 'text')}
                      disabled={decoded.text === ''}
                      aria-label="复制还原的文本"
                    >
                      复制文本
                    </Button>
                  </Tooltip>
                </div>
              </>
            )}
          </div>
        </section>

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>本工具不做的事</MessageBarTitle>
            不做二进制 ↔ 十六进制字符串转换器（那是进制转换工具的活），
            也不猜测非 UTF-8 的二进制数据：字节序列不是合法 UTF-8 时会给出原因
            （过长编码、代理区码位、超出 U+10FFFF、被截断），而不是替换成 �
            后假装成功。
          </MessageBarBody>
        </MessageBar>
      </div>
    </>
  );
}
