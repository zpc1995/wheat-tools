import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Switch,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  ArrowSwap16Regular,
  Broom16Regular,
  Checkmark16Regular,
  CodeText16Regular,
  Copy16Regular,
  DocumentText16Regular,
  Table16Regular,
} from '@fluentui/react-icons';
import {
  ESCAPE_STYLES,
  describeText,
  escapeText,
  summariseText,
  unescapeText,
  type CharInfo,
  type EscapeStyle,
} from './textToUnicodeUtils';

type Direction = 'escape' | 'unescape';

const STYLE_LABELS: Record<EscapeStyle, string> = {
  js: '\\uXXXX（JS / JSON）',
  es6: '\\u{XXXXX}（ES6 码位）',
  codepoint: 'U+XXXX（Unicode 码位）',
  'html-decimal': '&#DDDD;（HTML 十进制）',
  'html-hex': '&#xHHHH;（HTML 十六进制）',
  list: '码位列表（空格分隔）',
};

const STYLE_NOTES: Record<EscapeStyle, string> = {
  js: 'JS / JSON 字符串字面量写法，固定 4 位十六进制。超出 U+FFFF 的字符必须写成一对代理转义，例如 😀 = \\uD83D\\uDE00 —— 两个转义，仍然只是一个字符。',
  es6: 'ES6 / ES2015 的码点写法，一个转义就是一个码位，😀 = \\u{1F600}，不需要代理对。',
  codepoint: 'Unicode 官方码位记法，一个字符一个 U+XXXX，😀 = U+1F600。转义之间不加分隔符，这样反转义能逐字符还原原文；需要人眼阅读时请用码位列表。',
  'html-decimal': 'HTML 数字实体（十进制），😀 = &#128512;。',
  'html-hex': 'HTML 数字实体（十六进制），😀 = &#x1F600;。',
  list: '每个字符单独列成 U+XXXX，空格分隔，包括空格本身（写作 U+0020），因此也能逐字符还原。',
};

const SAMPLE_TEXT = 'Hello, 世界！😀 𝄞\nTab\there';

const SAMPLE_ESCAPES =
  '\\u4F60\\u597D \\uD83D\\uDE00 U+1D11E &#x4E2D; &#128512;';

/** Rows rendered in the per-character table before it is truncated. */
const MAX_TABLE_ROWS = 500;

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '100%',
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
  styleSelect: {
    minWidth: '230px',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
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
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '6px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
  },
  numeric: {
    textAlign: 'right',
    color: tokens.colorNeutralForeground3,
  },
  charCell: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '16px',
    whiteSpace: 'pre',
  },
  // A character stored as a surrogate pair is the whole point of the table, so
  // the row is tinted rather than left to be discovered by counting columns.
  pairRow: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  tableScroll: {
    maxHeight: '360px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  callout: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
});

/** How a character is drawn in the table: control characters are shown as their code. */
function printableChar(info: CharInfo): string {
  if (info.codePoint < 0x20 || info.codePoint === 0x7f || info.loneSurrogate) {
    return info.codePointHex;
  }
  return info.char;
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard access can be denied (permissions, insecure context). Reporting
    // failure is better than flashing "copied" for a copy that did not happen.
    return false;
  }
}

export function TextToUnicodeTool() {
  const styles = useStyles();
  const toasterId = useId('text-to-unicode-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [direction, setDirection] = useState<Direction>('escape');
  const [style, setStyle] = useState<EscapeStyle>('js');
  const [escapeAscii, setEscapeAscii] = useState(false);
  const [uppercase, setUppercase] = useState(true);
  const [padTo4, setPadTo4] = useState(true);
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

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

  const options = useMemo(
    () => ({
      style,
      // The code point list always writes every character; listing only the
      // non-ASCII ones would leave the ASCII ones as opaque text and make the
      // list useless for checking a string character by character.
      escapeAscii: style === 'list' ? true : escapeAscii,
      uppercase,
      padTo4,
    }),
    [style, escapeAscii, uppercase, padTo4],
  );

  const escaped = useMemo(() => escapeText(input, options), [input, options]);
  const decoded = useMemo(
    () => (direction === 'unescape' ? unescapeText(input) : null),
    [direction, input],
  );

  const output = direction === 'escape' ? escaped.output : decoded?.ok ? decoded.text : '';
  const failure = decoded && !decoded.ok ? decoded : null;
  // The table always describes real text: the input when escaping, the decoded
  // result when unescaping. In the second case a surrogate pair written as two
  // escapes visibly collapses into one row.
  const analysed = direction === 'escape' ? input : output;
  const characters = useMemo(() => describeText(analysed), [analysed]);
  const summary = useMemo(() => summariseText(analysed), [analysed]);

  const handleCopy = useCallback(async () => {
    if (!output) return;
    const ok = await copyToClipboard(output);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1400);
    notify(ok ? '已复制结果' : '复制失败，请手动选择文本');
  }, [output, notify]);

  const handleSwap = useCallback(() => {
    setInput(output);
    setDirection((current) => (current === 'escape' ? 'unescape' : 'escape'));
  }, [output]);

  const handleClear = useCallback(() => {
    setInput('');
    setCopied(false);
  }, []);

  const visibleCharacters = characters.slice(0, MAX_TABLE_ROWS);
  const truncated = characters.length > MAX_TABLE_ROWS;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <TabList
          selectedValue={direction}
          onTabSelect={(_, data) => setDirection(data.value as Direction)}
        >
          <Tab value="escape">文本 → 转义</Tab>
          <Tab value="unescape">转义 → 文本</Tab>
        </TabList>

        <div className={styles.toolbar}>
          {direction === 'escape' && (
            <Dropdown
              className={styles.styleSelect}
              value={STYLE_LABELS[style]}
              selectedOptions={[style]}
              onOptionSelect={(_, data) => setStyle(data.optionValue as EscapeStyle)}
              aria-label="转义风格"
            >
              {ESCAPE_STYLES.map((value) => (
                <Option key={value} value={value} text={STYLE_LABELS[value]}>
                  {STYLE_LABELS[value]}
                </Option>
              ))}
            </Dropdown>
          )}

          {direction === 'escape' && (
            <>
              <Tooltip
                content={
                  '默认只转义非 ASCII 字符。ASCII 里少数会被误读成转义开头的字符（反斜杠、' +
                  '后面紧跟 # 的 &、U+ 形式的 U）仍会转义，否则结果无法原样还原。'
                }
                relationship="description"
                withArrow
              >
                <Switch
                  checked={style === 'list' || escapeAscii}
                  disabled={style === 'list'}
                  onChange={(_, data) => setEscapeAscii(Boolean(data.checked))}
                  label="转义 ASCII 可见字符"
                />
              </Tooltip>
              <Switch
                checked={uppercase}
                onChange={(_, data) => setUppercase(Boolean(data.checked))}
                label="大写十六进制"
              />
              <Switch
                checked={padTo4}
                onChange={(_, data) => setPadTo4(Boolean(data.checked))}
                label="补零到 4 位"
              />
            </>
          )}

          <span className={styles.spacer} />

          <Button
            appearance="secondary"
            icon={<ArrowSwap16Regular />}
            onClick={handleSwap}
            disabled={!output}
          >
            交换方向
          </Button>
          <Button
            appearance="subtle"
            icon={<Broom16Regular />}
            onClick={handleClear}
            disabled={!input}
          >
            清空
          </Button>
        </div>

        {direction === 'escape' && (
          <MessageBar intent="info">
            <MessageBarBody>
              <Badge appearance="tint" color="brand" size="small">
                当前风格
              </Badge>{' '}
              {STYLE_NOTES[style]}
            </MessageBarBody>
          </MessageBar>
        )}

        <div className="wt-split">
          <section className="wt-surface" aria-label="输入">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                输入
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                {direction === 'escape' ? '要转义的文本' : '要反转义的转义串'}
              </Caption1>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <textarea
                className="wt-code-area"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  direction === 'escape'
                    ? '在此输入或粘贴文本，例如：\nHello, 世界！😀 𝄞'
                    : '在此粘贴转义串，例如：\n\\u4F60\\u597D \\uD83D\\uDE00 U+1D11E &#x4E2D; &#128512;'
                }
                aria-label={direction === 'escape' ? '待转义的文本' : '待反转义的转义串'}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
              <Button
                appearance="subtle"
                size="small"
                onClick={() => setInput(direction === 'escape' ? SAMPLE_TEXT : SAMPLE_ESCAPES)}
                style={{ alignSelf: 'flex-start' }}
              >
                填入示例
              </Button>
            </div>
          </section>

          <section className="wt-surface" aria-label="输出">
            <div className="wt-surface__header">
              <CodeText16Regular />
              <Text as="h2" size={300} weight="semibold">
                {direction === 'escape' ? '转义结果' : '反转义结果'}
              </Text>
              <span className={styles.spacer} />
              {output && (
                <Tooltip content="复制结果" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={handleCopy}
                    aria-label="复制结果"
                  />
                </Tooltip>
              )}
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              {failure ? (
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>
                    <MessageBarTitle>
                      第 {failure.index + 1} 个 UTF-16 码元处无法解析
                    </MessageBarTitle>
                    <div className={styles.callout}>
                      {failure.message}
                      {failure.snippet ? `\n读到：${failure.snippet}` : ''}
                    </div>
                  </MessageBarBody>
                </MessageBar>
              ) : output ? (
                <textarea
                  className="wt-code-area"
                  value={output}
                  readOnly
                  aria-label="转换结果"
                  spellCheck={false}
                />
              ) : (
                <div className="wt-empty">
                  <CodeText16Regular />
                  <Text weight="semibold">
                    {input ? '没有可显示的转换结果' : '等待输入'}
                  </Text>
                  <Caption1>
                    {direction === 'escape'
                      ? '输入文本后即时转义，支持中文、emoji 与罕见汉字'
                      : '粘贴 \\uXXXX、\\u{XXXXX}、U+XXXX 或 HTML 数字实体'}
                  </Caption1>
                </div>
              )}
            </div>
          </section>
        </div>

        {direction === 'escape' && input && (
          <MessageBar intent={summary.loneSurrogateCount > 0 ? 'warning' : 'info'}>
            <MessageBarBody>
              共 {escaped.codePointCount} 个码位，其中 {escaped.escapedCount} 个被转义
              {summary.surrogatePairCount > 0 &&
                `；${summary.surrogatePairCount} 个字符是辅助平面字符（需要代理对，但只是 1 个码位）`}
              {summary.loneSurrogateCount > 0 &&
                `；输入里有 ${summary.loneSurrogateCount} 个孤立代理，它不是合法字符，反转义时会明确报错`}
            </MessageBarBody>
          </MessageBar>
        )}

        {analysed && (
          <section className="wt-surface" aria-label="逐字符编码信息">
            <div className="wt-surface__header">
              <Table16Regular />
              <Text as="h2" size={300} weight="semibold">
                逐字符编码
              </Text>
              <span className={styles.spacer} />
              <Caption1 className={styles.hint}>
                {summary.codePointCount} 个码位 · {summary.codeUnitCount} 个 UTF-16 码元 ·
                UTF-8 共 {summary.utf8ByteCount} 字节
              </Caption1>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.headCell}>#</th>
                    <th className={styles.headCell}>字符</th>
                    <th className={styles.headCell}>码位</th>
                    <th className={styles.headCell}>UTF-16 码元</th>
                    <th className={styles.headCell}>UTF-8 字节</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCharacters.map((info, index) => (
                    <tr
                      key={`${index}-${info.codePointHex}`}
                      className={info.codeUnits.length > 1 ? styles.pairRow : undefined}
                    >
                      <td className={`${styles.cell} ${styles.numeric}`}>{index + 1}</td>
                      <td className={`${styles.cell} ${styles.charCell}`}>{printableChar(info)}</td>
                      <td className={`${styles.cell} ${styles.mono}`}>{info.codePointHex}</td>
                      <td className={`${styles.cell} ${styles.mono}`}>{info.utf16Hex}</td>
                      <td className={`${styles.cell} ${styles.mono}`}>{info.utf8Hex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Caption1 className={styles.hint} style={{ display: 'block', padding: '8px 12px' }}>
              码位是字符在 Unicode 里的编号，UTF-16 码元是 JS 字符串内部的存储单位，UTF-8
              字节是文件与网络上的形式。😀 是 1 个码位（U+1F600），在 JS 里占 2
              个码元（D83D DE00），UTF-8 占 4 个字节（F0 9F 98 80）；把它当成两个字符会得到错误的
              U+D83D U+DE00。
              {truncated && `（字符过多，仅显示前 ${MAX_TABLE_ROWS} 个码位）`}
            </Caption1>
          </section>
        )}
      </div>
    </>
  );
}
