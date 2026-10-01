import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowUndo16Regular,
  Checkmark16Regular,
  ClipboardRegular,
  TextChangeCase16Regular,
  TextGrammarWand16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  BREAK_LABELS,
  CASE_STYLES,
  MAX_INPUT_CHARS,
  SAMPLE_INPUT,
  convertCase,
  formatTokenization,
  tokenizeLines,
  wordCount,
  type InputLine,
  type Token,
} from './caseUtils';

const useStyles = makeStyles({
  body: {
    flexDirection: 'column',
    padding: '12px 14px 14px',
    gap: '10px',
  },
  inputArea: {
    minHeight: '110px',
    maxHeight: '260px',
    overflow: 'auto',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
  },
  lineBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  lineLabel: {
    color: tokens.colorNeutralForeground3,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    overflowWrap: 'anywhere',
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: '6px',
  },
  chip: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    padding: '5px 9px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground2,
    maxWidth: '100%',
  },
  chipText: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
  },
  chipReason: {
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    whiteSpace: 'nowrap',
  },
  dropped: {
    alignSelf: 'center',
    color: tokens.colorPaletteMarigoldForeground2,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '11.5px',
  },
  arrow: {
    alignSelf: 'center',
    color: tokens.colorNeutralForeground4,
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '190px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  rowValueEmpty: {
    color: tokens.colorNeutralForeground4,
  },
  copy: {
    flex: 'none',
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    padding: '6px 0',
  },
});

/** The one-line explanation shown under a word. */
function reasonOf(token: Token, position: number, leading: string): string {
  if (position === 0) {
    return leading === '' ? BREAK_LABELS.start : `${BREAK_LABELS.start}，丢弃 ${JSON.stringify(leading)}`;
  }
  if (token.break === 'separator') return `分隔符 ${JSON.stringify(token.separator)}`;
  return BREAK_LABELS[token.break];
}

/**
 * The transparency panel: every word the tokeniser produced, with the rule that
 * produced the boundary before it.
 *
 * This is the part that makes the tool worth having over a library import. When
 * `getHTTPResponseCode` comes back as `get_http_response_code` the reader has to
 * be able to see that HTTP stayed together on purpose; without that, a correct
 * answer and a wrong one look the same.
 */
function WordChips({ line, showLabel }: { line: InputLine; showLabel: boolean }) {
  const styles = useStyles();
  const { tokens, leading, trailing } = line.words;

  return (
    <div className={styles.lineBlock}>
      {showLabel && <span className={styles.lineLabel}>{`第 ${line.index} 行: ${line.text}`}</span>}
      <div className={styles.chips}>
        {tokens.length === 0 && <Caption1 className={styles.hint}>没有可切分的词</Caption1>}
        {tokens.map((token, position) => (
          <span className={styles.chip} key={`${position}-${token.text}`}>
            <span className={styles.chipText}>{token.text}</span>
            <span className={styles.chipReason}>{reasonOf(token, position, leading)}</span>
          </span>
        ))}
        {trailing !== '' && <span className={styles.dropped}>{`丢弃尾随 ${JSON.stringify(trailing)}`}</span>}
      </div>
    </div>
  );
}

export function CaseConverterTool() {
  const styles = useStyles();
  const [input, setInput] = useState('getHTTPResponseCode');
  const [copied, setCopied] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const lines = useMemo(() => tokenizeLines(input), [input]);
  const total = useMemo(() => wordCount(lines), [lines]);
  const results = useMemo(
    () => CASE_STYLES.map((style) => ({ style, value: convertCase(input, style.id) })),
    [input],
  );

  const onInput = useCallback((value: string) => {
    if (value.length > MAX_INPUT_CHARS) {
      setInput(value.slice(0, MAX_INPUT_CHARS));
      setTruncated(true);
    } else {
      setInput(value);
      setTruncated(false);
    }
    setCopied(null);
  }, []);

  const copy = useCallback(async (key: string, value: string) => {
    const ok = await copyText(value);
    // Leaving the button unflipped on failure is the honest outcome rather than
    // claiming a copy that did not happen.
    setCopied(ok ? key : null);
  }, []);

  const nonEmptyLines = lines.filter((line) => line.words.tokens.length > 0);
  const showLineLabels = lines.length > 1;

  return (
    <div className="wt-surface">
      <div className="wt-surface__header">
        <TextChangeCase16Regular />
        <Text as="h2" size={300} weight="semibold">
          输入
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.hint}>多行输入逐行转换；所有计算都在本地完成</Caption1>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <textarea
          className={`wt-code-area ${styles.inputArea}`}
          value={input}
          onChange={(event) => onInput(event.target.value)}
          placeholder="粘贴一个标识符、文件名或表格列名，例如 getHTTPResponseCode"
          aria-label="待转换的命名或标识符"
          spellCheck={false}
        />

        <div className={styles.toolbar}>
          <Button icon={<TextGrammarWand16Regular />} onClick={() => onInput(SAMPLE_INPUT)}>
            填入示例
          </Button>
          <Button icon={<ArrowUndo16Regular />} onClick={() => onInput('')} disabled={input === ''}>
            清空
          </Button>
          <span className={styles.spacer} />
          <Badge appearance="tint" color="informative">
            {`${lines.length} 行 · ${total} 个词`}
          </Badge>
        </div>

        {truncated && (
          <MessageBar intent="warning">
            <MessageBarBody>
              {`输入超过 ${MAX_INPUT_CHARS} 字符，已截断处理。`}
            </MessageBarBody>
          </MessageBar>
        )}
      </div>

      <div className="wt-surface__header">
        <TextChangeCase16Regular />
        <Text as="h2" size={300} weight="semibold">
          切词结果
        </Text>
        <span className={styles.spacer} />
        <Button
          appearance="subtle"
          size="small"
          icon={copied === 'tokens' ? <Checkmark16Regular /> : <ClipboardRegular />}
          onClick={() => copy('tokens', formatTokenization(lines))}
          disabled={nonEmptyLines.length === 0}
        >
          {copied === 'tokens' ? '已复制' : '复制切词说明'}
        </Button>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        {nonEmptyLines.length === 0 ? (
          <Caption1 className={styles.empty}>
            输入里还没有可切分的词。分隔符（空格、下划线、连字符、点、斜杠等）会被丢弃，不会出现在结果里。
          </Caption1>
        ) : (
          <div className={styles.lines}>
            {nonEmptyLines.map((line) => (
              <WordChips key={line.index} line={line} showLabel={showLineLabels} />
            ))}
          </div>
        )}
      </div>

      <div className="wt-surface__header">
        <TextChangeCase16Regular />
        <Text as="h2" size={300} weight="semibold">
          转换结果
        </Text>
        <span className={styles.spacer} />
        <Caption1 className={styles.hint}>点右侧按钮复制单个结果</Caption1>
      </div>

      <div className={`wt-surface__body ${styles.body}`}>
        <div className={styles.results}>
          {results.map(({ style, value }) => (
            <div className={styles.row} key={style.id}>
              <span className={styles.rowLabel} title={style.description}>
                {style.label}
              </span>
              <span className={`${styles.rowValue} ${value === '' ? styles.rowValueEmpty : ''}`}>
                {value === '' ? '（空）' : value}
              </span>
              <Button
                className={styles.copy}
                appearance="subtle"
                size="small"
                icon={copied === style.id ? <Checkmark16Regular /> : <ClipboardRegular />}
                onClick={() => copy(style.id, value)}
                disabled={value === ''}
                aria-label={`复制 ${style.label} 结果`}
              >
                {copied === style.id ? '已复制' : '复制'}
              </Button>
            </div>
          ))}
        </div>

        <Divider />

        <Caption1 className={styles.hint}>
          lower case 与 space case 的结果相同，它们是同一种写法的两个名字。数字与字母之间一定断开：
          PBKDF2_ITERATIONS 转成 snake_case 是 pbkdf_2_iterations，与 parse2DArray 拆成
          parse / 2 / D / Array 是同一条规则。camelCase 与 PascalCase 不保留分隔符，因此
          连续的单个字母词（如 a_B_c）会合并成 aBC 这样的形状，无法再还原成原来的词序列 —— 这是这两种
          写法本身固有的歧义，其他工具也一样。
        </Caption1>
      </div>
    </div>
  );
}
