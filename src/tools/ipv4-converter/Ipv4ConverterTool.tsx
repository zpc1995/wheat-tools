import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  CheckmarkRegular,
  CopyRegular,
  DismissCircleRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  MAX_BATCH_LINES,
  Ipv4ParseError,
  batchConvert,
  classifyAddress,
  convertAll,
  parseAddress,
  type AddressClass,
  type ConversionRow,
  type ParsedAddress,
} from './ipv4ConverterUtils';

const EXAMPLES = ['192.168.1.10', '127.0.0.1', '0x7f000001', '2130706433', '127.1', '010.0.0.1', '8.8.8.8'];

const useStyles = makeStyles({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    width: '100%',
    boxSizing: 'border-box',
  },
  inputRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  examples: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  exampleButton: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    padding: '3px 9px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '999px',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontVariantNumeric: 'tabular-nums',
  },
  headCell: {
    textAlign: 'left',
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  labelCell: {
    padding: '7px 12px',
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
    width: '190px',
  },
  valueCell: {
    padding: '7px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    wordBreak: 'break-all',
  },
  noteCell: {
    padding: '7px 12px',
    color: tokens.colorNeutralForeground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    fontSize: '12px',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  unsafeRow: {
    backgroundColor: tokens.colorPaletteYellowBackground1,
  },
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  scroll: {
    maxHeight: '380px',
    overflow: 'auto',
    overscrollBehavior: 'contain',
  },
  rowError: {
    color: tokens.colorPaletteRedForeground1,
  },
  hazardCell: {
    color: tokens.colorPaletteDarkOrangeForeground1,
    fontWeight: 600,
  },
});

function ClassificationCard({ info, parsed }: { info: AddressClass; parsed: ParsedAddress }) {
  const styles = useStyles();
  return (
    <div className={styles.badges}>
      <Badge appearance="filled" color={info.isReserved ? 'warning' : 'success'}>
        {info.label}
      </Badge>
      <Badge appearance="tint" color="informative">
        {`类别 ${info.klass}`}
      </Badge>
      <Badge appearance="tint" color={info.isPrivate ? 'warning' : 'informative'}>
        {info.isPrivate ? '私有地址' : '非 RFC 1918 私有'}
      </Badge>
      <Badge appearance="tint" color={info.isReserved ? 'warning' : 'success'}>
        {info.isReserved ? '保留 / 特殊用途' : '公网可路由'}
      </Badge>
      <Caption1 className={styles.hint}>{`判定依据：${info.cidr}`}</Caption1>
      {parsed.shorthand && (
        <Badge appearance="tint" color="danger">
          非规范写法
        </Badge>
      )}
    </div>
  );
}

export function Ipv4ConverterTool() {
  const styles = useStyles();
  const [input, setInput] = useState('192.168.1.10');
  const [batch, setBatch] = useState('192.168.1.10\n10.0.0.1\n0x7f000001\n127.1\n010.0.0.1\n8.8.8.8');
  const [copied, setCopied] = useState<string | null>(null);
  const [copiedBatch, setCopiedBatch] = useState(false);

  /**
   * Parsing is done in a `useMemo` that returns either a result or the error
   * message. Rendering the error *inside* the flow (rather than hiding the
   * output) keeps the input on screen while the user fixes it, which is what
   * makes the shorthand warnings below discoverable.
   */
  const parsed = useMemo((): { ok: true; value: ParsedAddress } | { ok: false; error: string } => {
    try {
      return { ok: true, value: parseAddress(input) };
    } catch (error) {
      return { ok: false, error: error instanceof Ipv4ParseError ? error.message : String(error) };
    }
  }, [input]);

  const rows: ConversionRow[] = useMemo(
    () => (parsed.ok ? convertAll(parsed.value.value) : []),
    [parsed],
  );
  const info = useMemo(() => (parsed.ok ? classifyAddress(parsed.value.value) : null), [parsed]);

  const batchResult = useMemo(() => batchConvert(batch), [batch]);

  const onCopy = useCallback(async (key: string, text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? key : null);
  }, []);

  const failedCount = batchResult.rows.filter((row) => !row.ok).length;
  const shorthandCount = batchResult.rows.filter((row) => row.ok && row.shorthand).length;

  const copyBatchTsv = useCallback(async () => {
    const lines = ['输入\t规范点分十进制\t十进制\t十六进制\t形式'];
    for (const row of batchResult.rows) {
      lines.push(
        [row.input, row.dotted, row.decimal, row.hex, row.formLabel].join('\t'),
      );
    }
    const ok = await copyText(lines.join('\n'));
    setCopiedBatch(ok);
  }, [batchResult.rows]);

  return (
    <div className="wt-surface">
      <div className={`wt-surface__body ${styles.body}`}>
        <Text as="h2" size={300} weight="semibold">
          单个地址
        </Text>

        <div className={styles.inputRow}>
          <input
            className="wt-inline-input"
            style={{ flex: '1 1 320px' }}
            value={input}
            aria-label="IPv4 地址输入（支持点分十进制、整数、十六进制、八进制、二进制与简写）"
            placeholder="例如 192.168.1.10 / 0x7f000001 / 2130706433 / 127.1"
            onChange={(event) => setInput(event.target.value)}
          />
          <Button
            appearance="subtle"
            icon={copied === 'dotted' ? <CheckmarkRegular /> : <CopyRegular />}
            disabled={!parsed.ok}
            onClick={() => parsed.ok && onCopy('dotted', parsed.value.dotted)}
          >
            {copied === 'dotted' ? '已复制规范形式' : '复制规范形式'}
          </Button>
        </div>

        <div className={styles.examples}>
          <Caption1 className={styles.hint}>示例：</Caption1>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className={styles.exampleButton}
              onClick={() => setInput(example)}
            >
              {example}
            </button>
          ))}
        </div>

        {!parsed.ok && (
          <MessageBar intent="error">
            <MessageBarBody>{parsed.error}</MessageBarBody>
          </MessageBar>
        )}

        {parsed.ok && parsed.value.warning && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>
                {`输入被识别为${parsed.value.formLabel} —— 危险写法`}
              </MessageBarTitle>
              {parsed.value.warning}
            </MessageBarBody>
          </MessageBar>
        )}

        {parsed.ok && info && <ClassificationCard info={info} parsed={parsed.value} />}

        {parsed.ok && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.headCell}>表示形式</th>
                <th className={styles.headCell}>值</th>
                <th className={styles.headCell}>说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={row.unsafe ? styles.unsafeRow : undefined}>
                  <td className={styles.labelCell}>{row.label}</td>
                  <td className={`${styles.valueCell} ${styles.mono}`}>
                    {row.value}
                    <Button
                      appearance="subtle"
                      size="small"
                      style={{ marginLeft: 8 }}
                      icon={copied === row.key ? <CheckmarkRegular /> : <CopyRegular />}
                      aria-label={`复制${row.label}`}
                      onClick={() => onCopy(row.key, row.value)}
                    />
                  </td>
                  <td className={styles.noteCell}>
                    {row.note ?? (row.unsafe ? '非规范写法，仅用于解读' : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>为什么不给"可直接用于 URL 的简写"这类建议</MessageBarTitle>
            本工具会<strong>识别</strong>简写，因为安全审计时需要知道某段输入到底指向哪里；但绝不
            <strong>推荐</strong>使用。<code>http://2130706433/</code>、<code>http://0x7f.1/</code>、
            <code>http://127.1/</code> 都会落到回环地址，这正是 SSRF 防护与主机白名单被绕过的经典路径：
            过滤器只比对 <code>127.0.0.1</code> 字符串时，上面三种写法一律漏过。同理，
            <code>010.0.0.1</code> 是 <code>8.0.0.1</code> 而不是 <code>10.0.0.1</code>。
            唯一应当写进 URL、ACL 与配置文件的是规范点分十进制。
          </MessageBarBody>
        </MessageBar>

        <Divider />

        <div className={styles.inputRow}>
          <Text as="h2" size={300} weight="semibold">
            批量转换
          </Text>
          <Caption1 className={styles.hint}>
            {`每行一个地址，空行与 # 开头的注释行忽略，最多 ${MAX_BATCH_LINES} 行`}
          </Caption1>
        </div>

        <textarea
          className="wt-code-area"
          style={{ minHeight: '120px' }}
          value={batch}
          aria-label="批量 IPv4 地址列表，每行一个"
          onChange={(event) => setBatch(event.target.value)}
        />

        <div className={styles.badges}>
          <Badge appearance="tint" color="informative">{`共 ${batchResult.rows.length} 行`}</Badge>
          {failedCount > 0 && (
            <Badge appearance="tint" color="danger" icon={<DismissCircleRegular />}>
              {`${failedCount} 行无法解析`}
            </Badge>
          )}
          {shorthandCount > 0 && (
            <Badge appearance="tint" color="warning" icon={<WarningRegular />}>
              {`${shorthandCount} 行是非规范写法`}
            </Badge>
          )}
          {batchResult.truncated && (
            <Badge appearance="tint" color="warning">
              {`超过 ${MAX_BATCH_LINES} 行，已截断`}
            </Badge>
          )}
          <Button
            size="small"
            appearance="subtle"
            icon={copiedBatch ? <CheckmarkRegular /> : <CopyRegular />}
            disabled={batchResult.rows.length === 0}
            onClick={copyBatchTsv}
          >
            {copiedBatch ? '已复制 TSV' : '复制为 TSV'}
          </Button>
        </div>

        {batchResult.rows.length > 0 && (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.headCell}>#</th>
                  <th className={styles.headCell}>输入</th>
                  <th className={styles.headCell}>规范点分十进制</th>
                  <th className={styles.headCell}>十进制</th>
                  <th className={styles.headCell}>十六进制</th>
                  <th className={styles.headCell}>识别为</th>
                </tr>
              </thead>
              <tbody>
                {batchResult.rows.map((row) => (
                  <tr key={row.index} className={row.shorthand ? styles.unsafeRow : undefined}>
                    <td className={styles.labelCell}>{row.index}</td>
                    <td className={`${styles.valueCell} ${styles.mono}`}>{row.input}</td>
                    {row.ok ? (
                      <>
                        <td className={`${styles.valueCell} ${styles.mono}`}>{row.dotted}</td>
                        <td className={`${styles.valueCell} ${styles.mono}`}>{row.decimal}</td>
                        <td className={`${styles.valueCell} ${styles.mono}`}>{row.hex}</td>
                        <td
                          className={`${styles.noteCell} ${row.shorthand ? styles.hazardCell : ''}`}
                        >
                          {row.formLabel}
                        </td>
                      </>
                    ) : (
                      <td className={`${styles.valueCell} ${styles.rowError}`} colSpan={4}>
                        {row.warnings[0]}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Caption1 className={styles.hint}>
          不做的事：这里不计算子网（用 IPv4 子网计算器），不做任意进制转换（用进制转换），
          也不查询地址归属地。识别简写只是为了看清输入的真实含义。
        </Caption1>
      </div>
    </div>
  );
}
