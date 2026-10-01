import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
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
  BookLetter20Regular,
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  LocalLanguage16Regular,
} from '@fluentui/react-icons';
import {
  NATO_DIGITS,
  NATO_LETTERS,
  natoToText,
  officialAlphabet,
  tableToTsv,
  textToNato,
  type UnmappedMode,
} from './natoUtils';

/** Inputs that show the interesting cases at a glance. */
const EXAMPLES = ['ABC', 'SOS', 'W8', 'Callsign 42', '中文测试'];

/** Above this the per-character breakdown is cut off; the output stays whole. */
const MAX_CHIPS = 120;

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
    minHeight: '120px',
    maxHeight: '320px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    lineHeight: 1.7,
    overflowWrap: 'anywhere',
    userSelect: 'all',
    padding: '10px 12px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  chip: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
  },
  tableScroll: {
    maxHeight: '520px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
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
    padding: '5px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'top',
  },
  charCell: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontWeight: 600,
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  wordCell: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    whiteSpace: 'nowrap',
  },
  variantCell: {
    color: tokens.colorPaletteYellowForeground1,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    whiteSpace: 'nowrap',
  },
  noteCell: {
    color: tokens.colorNeutralForeground3,
    minWidth: '220px',
  },
});

export function NatoAlphabetTool() {
  const styles = useStyles();
  const toasterId = useId('nato-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [text, setText] = useState('ABC 123');
  const [codeInput, setCodeInput] = useState('Alfa Bravo Charlie One Two Three');
  const [unmapped, setUnmapped] = useState<UnmappedMode>('keep');
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
        // Clipboard access can be denied; saying so beats claiming a copy that
        // did not happen.
        notify('复制失败，请手动选择');
      }
    },
    [notify],
  );

  const spelled = useMemo(() => textToNato(text, { unmapped }), [text, unmapped]);
  const readBack = useMemo(() => natoToText(codeInput), [codeInput]);

  const swap = useCallback(() => {
    setCodeInput(spelled.output);
    setText(readBack.text);
  }, [spelled.output, readBack.text]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>官方拼写按 ICAO：Alfa、Juliett、Xray</MessageBarTitle>
            <strong>Alfa</strong> 用 f 拼写（Alpha 是英语常见变体）、
            <strong>Juliett</strong> 是双 t（Juliet 是非官方拼法）、
            <strong>Xray</strong> 不带连字符（X-ray 是旧拼法，本工具仍接受）。
            数字用英语名称 One、Two、Three…；ICAO 另外给出无线电里怎么读的改写
            （WUN、TREE、FOWER、FIFE、NINER…），读法不是另一套拼写，表里分列两栏。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="文本转北约读法">
          <div className="wt-surface__header">
            <LocalLanguage16Regular />
            <Text as="h2" size={300} weight="semibold">
              文本 → 北约读法
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>逐字符映射，不改变大小写之外的任何东西</Caption1>
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
              placeholder="输入任意文本，A–Z 与 0–9 会被逐字读出来"
              aria-label="文本输入"
              spellCheck={false}
            />

            <RadioGroup
              layout="horizontal"
              value={unmapped}
              onChange={(_, data) => setUnmapped(data.value as UnmappedMode)}
              aria-label="无法映射字符的处理方式"
            >
              <Radio
                value="keep"
                label="无法映射的字符原样透传"
              />
              <Radio value="skip" label="无法映射的字符跳过" />
            </RadioGroup>

            <div className={styles.block}>
              <div className={styles.toolbar}>
                <Caption1 className={styles.hint}>读法</Caption1>
                <span className={styles.spacer} />
                <Tooltip content="复制读法" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'words' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy(spelled.output, 'words')}
                    disabled={spelled.output === ''}
                    aria-label="复制读法"
                  >
                    复制
                  </Button>
                </Tooltip>
              </div>
              {spelled.output === '' ? (
                <div className="wt-empty">
                  <LocalLanguage16Regular />
                  <Text weight="semibold">等待输入</Text>
                  <Caption1>输入 A–Z 或 0–9 后，这里会逐字给出读法。</Caption1>
                </div>
              ) : (
                <div className={styles.mono} style={{ fontSize: 15, userSelect: 'text' }}>
                  {spelled.output}
                </div>
              )}
            </div>

            {spelled.unmappedChars.length > 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>
                    有 {spelled.unmappedChars.length} 种字符无法映射到北约字母表
                  </MessageBarTitle>
                  北约音标字母表只覆盖 26 个拉丁字母和 10 个阿拉伯数字。中文、
                  假名、西里尔字母、重音字母等都没有对应词，本工具不会为它们编一个
                  读音，只会按你上面的选择
                  {unmapped === 'keep' ? '原样透传（输出里保留原字符）' : '跳过'}。
                  涉及字符：
                  <span className={styles.chip}> {spelled.unmappedChars.join(' ')}</span>
                </MessageBarBody>
              </MessageBar>
            )}

            {spelled.items.length > 0 && (
              <div className={styles.block}>
                <Caption1 className={styles.hint}>
                  逐字符对照（最多显示 {MAX_CHIPS} 个字符）
                </Caption1>
                <div className={styles.chips}>
                  {spelled.items.slice(0, MAX_CHIPS).map((item, index) => (
                    <Badge
                      key={`${item.char}-${index}`}
                      className={styles.chip}
                      appearance="tint"
                      color={item.entry ? 'brand' : 'warning'}
                      size="small"
                    >
                      {item.char} → {item.entry?.word ?? '无映射'}
                    </Badge>
                  ))}
                </div>
                {spelled.items.length > MAX_CHIPS && (
                  <Caption1 className={styles.hint}>
                    仅显示前 {MAX_CHIPS} 个字符；完整读法以上面的输出为准。
                  </Caption1>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="wt-surface" aria-label="北约读法转文本">
          <div className="wt-surface__header">
            <DocumentText16Regular />
            <Text as="h2" size={300} weight="semibold">
              北约读法 → 文本
            </Text>
            <span className={styles.spacer} />
            <Tooltip content="把上方读法填入这里并交换方向" relationship="description" withArrow>
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
              <Tooltip content="清空读法输入" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  icon={<Broom16Regular />}
                  onClick={() => setCodeInput('')}
                  disabled={codeInput === ''}
                  aria-label="清空读法输入"
                />
              </Tooltip>
              <Caption1 className={styles.hint}>
                词之间用空格、逗号或换行分隔；大小写不敏感，Alpha / Juliet / X-ray / Wun
                等常见变体都能识别。
              </Caption1>
            </div>

            <textarea
              className={`wt-code-area ${styles.inputArea}`}
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="例如 Alfa Bravo Charlie One Two Three"
              aria-label="北约读法输入"
              spellCheck={false}
            />

            {readBack.unknown.length > 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>
                    有 {readBack.unknown.length} 个词不在字母表里，已按原样保留
                  </MessageBarTitle>
                  {readBack.unknown.join('、')}
                  {' '}——这些词不在 ICAO 字母表、常见变体或数字读法中，本工具不会替你
                  猜一个字母。
                </MessageBarBody>
              </MessageBar>
            )}

            <div className={styles.block}>
              <div className={styles.toolbar}>
                <Caption1 className={styles.hint}>
                  还原的文本（字母表不携带大小写，一律还原成大写）
                </Caption1>
                <span className={styles.spacer} />
                <Tooltip content="复制还原的文本" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied === 'text' ? <Checkmark16Regular /> : <Copy16Regular />}
                    onClick={() => copy(readBack.text, 'text')}
                    disabled={readBack.text === ''}
                    aria-label="复制还原的文本"
                  >
                    复制
                  </Button>
                </Tooltip>
              </div>
              <div className={styles.mono} style={{ fontSize: 15, userSelect: 'text' }}>
                {readBack.text === '' ? '（空）' : readBack.text}
              </div>
            </div>

            {readBack.items.length > 0 && (
              <div className={styles.block}>
                <Caption1 className={styles.hint}>逐词对照</Caption1>
                <div className={styles.chips}>
                  {readBack.items.slice(0, MAX_CHIPS).map((item, index) => (
                    <Badge
                      key={`${item.token}-${index}`}
                      className={styles.chip}
                      appearance="tint"
                      color={
                        item.kind === 'unknown'
                          ? 'warning'
                          : item.kind === 'official' || item.kind === 'literal'
                            ? 'brand'
                            : 'informative'
                      }
                      size="small"
                    >
                      {item.token} → {item.char ?? '未识别'}
                      {item.kind === 'variant' || item.kind === 'multi-word'
                        ? '（变体）'
                        : item.kind === 'pronunciation'
                          ? '（ICAO 读法）'
                          : item.kind === 'literal'
                            ? '（原样字符）'
                            : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="wt-surface" aria-label="完整映射表">
          <div className="wt-surface__header">
            <BookLetter20Regular />
            <Text as="h2" size={300} weight="semibold">
              映射表 · 26 个字母 + 10 个数字
            </Text>
            <span className={styles.spacer} />
            <Tooltip content="复制为 TSV" relationship="label" withArrow>
              <Button
                appearance="subtle"
                size="small"
                icon={copied === 'table' ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={() => copy(tableToTsv(), 'table')}
                aria-label="复制映射表"
              >
                复制 TSV
              </Button>
            </Tooltip>
          </div>

          <div className={`wt-surface__body ${styles.body}`}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.headCell}>字符</th>
                    <th className={styles.headCell}>ICAO 官方用词</th>
                    <th className={styles.headCell}>常见变体</th>
                    <th className={styles.headCell}>ICAO 读法</th>
                    <th className={styles.headCell}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {[...NATO_LETTERS, ...NATO_DIGITS].map((entry) => (
                    <tr key={entry.char}>
                      <td className={`${styles.cell} ${styles.charCell}`}>{entry.char}</td>
                      <td className={`${styles.cell} ${styles.wordCell}`}>{entry.word}</td>
                      <td className={`${styles.cell} ${styles.variantCell}`}>
                        {entry.variants.length > 0 ? entry.variants.join('、') : '—'}
                      </td>
                      <td className={`${styles.cell} ${styles.wordCell}`}>
                        {entry.pronunciation ?? '—'}
                      </td>
                      <td className={`${styles.cell} ${styles.noteCell}`}>
                        {entry.note ?? (entry.kind === 'digit' ? '英语名称即官方拼写。' : '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Caption1 className={styles.hint}>
              官方字母表：{officialAlphabet()}
            </Caption1>
          </div>
        </section>

        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>本工具不做的事</MessageBarTitle>
            不播放音频、不引入任何外部发音资源——点击词条不会发声，发音请以 ICAO
            公布的发音指南为准，数字读法已列在表中。也不为中文等非拉丁字符编造读音，
            更不做“翻译”或“音译”：中文没有北约字母表读法，工具只会原样透传或跳过。
          </MessageBarBody>
        </MessageBar>
      </div>
    </>
  );
}
