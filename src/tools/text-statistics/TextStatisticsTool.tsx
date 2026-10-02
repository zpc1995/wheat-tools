import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
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
  Checkmark16Regular,
  Copy16Regular,
  TextNumberFormatRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  READING_SPEED,
  analyseLines,
  categoryDistribution,
  charFrequency,
  codePointLabel,
  displayChar,
  editorMismatchNotes,
  estimateReadingTime,
  formatDuration,
  measureText,
  countWords,
} from './textStatisticsUtils';

const SAMPLE = [
  '文本统计示例 😀 line one',
  'cafe\u0301 — 组合重音（e + U+0301）；NFC 的 café 只占一个码点',
  '',
  '第二段：中英混排 mixed English and 中文，共 2 句。Do you see it?',
].join('\n');

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  inputArea: {
    width: '100%',
    minHeight: '160px',
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '10px',
    width: '100%',
    padding: '14px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    background: tokens.colorNeutralBackground2,
  },
  cardLabel: {
    color: tokens.colorNeutralForeground3,
  },
  cardValue: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    fontSize: '22px',
    fontWeight: 600,
    lineHeight: 1.2,
  },
  cardNote: {
    color: tokens.colorNeutralForeground4,
    fontSize: '11px',
  },
  scroll: {
    width: '100%',
    maxHeight: '340px',
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  headCell: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    textAlign: 'left',
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    background: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cell: {
    padding: '5px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: 'nowrap',
  },
  numeric: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  glyph: {
    fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
    fontSize: '17px',
  },
  mono: {
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
    fontVariantNumeric: 'tabular-nums',
  },
  barTrack: {
    position: 'relative',
    display: 'block',
    width: '100%',
    minWidth: '80px',
    height: '8px',
    borderRadius: '4px',
    background: tokens.colorNeutralBackground4,
    overflow: 'hidden',
  },
  barFill: {
    display: 'block',
    height: '100%',
    borderRadius: '4px',
    background: tokens.colorBrandBackground,
  },
  distribution: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  distributionRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(140px, 1.2fr) 64px minmax(80px, 1fr) 56px',
    alignItems: 'center',
    gap: '10px',
    padding: '7px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  linesBody: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  lineRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  lineText: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace',
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    margin: 0,
    padding: '12px 14px 12px 30px',
    color: tokens.colorNeutralForeground2,
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
});

export function TextStatisticsTool() {
  const styles = useStyles();
  const toasterId = useId('text-statistics-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [input, setInput] = useState(SAMPLE);
  const [topN, setTopN] = useState(20);
  const [copied, setCopied] = useState(false);

  const metrics = useMemo(() => measureText(input), [input]);
  const words = useMemo(() => countWords(input), [input]);
  const reading = useMemo(() => estimateReadingTime(words), [words]);
  const lines = useMemo(() => analyseLines(input), [input]);
  const frequency = useMemo(() => charFrequency(input, topN), [input, topN]);
  const distribution = useMemo(() => categoryDistribution(input), [input]);
  const notes = useMemo(() => editorMismatchNotes(), []);

  const copySummary = useCallback(async () => {
    const summary = [
      `码点数：${metrics.codePoints}`,
      `字素簇数：${metrics.graphemes}`,
      `UTF-16 码元数：${metrics.utf16Units}`,
      `UTF-8 字节数：${metrics.utf8Bytes}`,
      `码点数（不含空白）：${metrics.codePointsNoWhitespace}`,
      `行数：${metrics.lines}（非空 ${metrics.nonEmptyLines}）`,
      `段落数：${metrics.paragraphs}`,
      `句子数：${metrics.sentences}`,
      `词数：${words.total}（中文 ${words.chinese} + 西文 ${words.latin}）`,
      `阅读时间：${formatDuration(reading.totalSeconds)}`,
    ].join('\n');
    const ok = await copyText(summary);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      dispatchToast(
        <Toast>
          <ToastTitle>已复制统计摘要</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    }
  }, [metrics, words, reading, dispatchToast]);

  const cards = [
    {
      label: '码点数',
      value: metrics.codePoints,
      note: '[...text].length，多数人说的“字符”',
    },
    {
      label: '字素簇数',
      value: metrics.graphemes,
      note: 'Intl.Segmenter，人眼看到的一个字符',
    },
    {
      label: 'UTF-16 码元数',
      value: metrics.utf16Units,
      note: 'text.length，编辑器常显示这个',
    },
    {
      label: 'UTF-8 字节数',
      value: metrics.utf8Bytes,
      note: 'TextEncoder，存盘/传输的体积',
    },
    {
      label: '码点数（不含空白）',
      value: metrics.codePointsNoWhitespace,
      note: '按 Unicode 空白属性排除',
    },
    {
      label: '词数',
      value: words.total,
      note: `中文按字 ${words.chinese} + 西文按词 ${words.latin}`,
    },
    {
      label: '行数',
      value: metrics.lines,
      note: `非空 ${metrics.nonEmptyLines} 行`,
    },
    {
      label: '段落数',
      value: metrics.paragraphs,
      note: '以空行分隔',
    },
    {
      label: '句子数',
      value: metrics.sentences,
      note: '按 . ! ? 。！？ 估算',
    },
    {
      label: '阅读时间',
      value: formatDuration(reading.totalSeconds),
      note: `中文 ${READING_SPEED.chineseCharsPerMinute} 字/分，英文 ${READING_SPEED.latinWordsPerMinute} 词/分`,
    },
  ];

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="待统计文本">
          <div className="wt-surface__header">
            <TextNumberFormatRegular />
            <Text as="h2" size={300} weight="semibold">
              待统计文本
            </Text>
            <span className={styles.spacer} />
            <Tooltip content="复制统计摘要" relationship="label" withArrow>
              <Button
                appearance="subtle"
                icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={copySummary}
                aria-label="复制统计摘要"
              />
            </Tooltip>
            <Button appearance="subtle" onClick={() => setInput('')} disabled={!input}>
              清空
            </Button>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <textarea
              className={`wt-code-area ${styles.inputArea}`}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="在此粘贴或输入文本，统计结果实时更新"
              aria-label="待统计文本"
              spellCheck={false}
            />
          </div>
        </section>

        <section className="wt-surface" aria-label="基本计数">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              基本计数
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              右侧四张卡片是四个不同的量，不能互相换算
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.cards}>
              {cards.map((card) => (
                <div key={card.label} className={styles.card}>
                  <Caption1 className={styles.cardLabel}>{card.label}</Caption1>
                  <span className={styles.cardValue}>{card.value}</span>
                  <span className={styles.cardNote}>{card.note}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="行长统计">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              行长统计
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>长度按码点数计算</Caption1>
          </div>
          <div className={`wt-surface__body ${styles.linesBody}`}>
            <div className={styles.lineRow}>
              <Badge appearance="tint" color="brand" size="small">
                最长
              </Badge>
              <span className={styles.lineText}>
                {lines.longest
                  ? `第 ${lines.longest.index} 行 · ${lines.longest.length} 码点 · ${lines.longest.text}`
                  : '—'}
              </span>
            </div>
            <div className={styles.lineRow}>
              <Badge appearance="tint" color="informative" size="small">
                最短
              </Badge>
              <span className={styles.lineText}>
                {lines.shortest
                  ? `第 ${lines.shortest.index} 行 · ${lines.shortest.length} 码点 · ${lines.shortest.text}`
                  : '—（没有非空行）'}
              </span>
            </div>
            <div className={styles.lineRow}>
              <Badge appearance="tint" color="subtle" size="small">
                平均
              </Badge>
              <span className={styles.lineText}>
                {Math.round(lines.average * 100) / 100} 码点 / 行（共 {metrics.lines} 行）
              </span>
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="字符频率">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              字符频率（按码点）
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>显示前</Caption1>
            <Dropdown
              style={{ minWidth: 84 }}
              value={String(topN)}
              selectedOptions={[String(topN)]}
              onOptionSelect={(_, data) => setTopN(Number(data.optionValue))}
              aria-label="字符频率显示条数"
            >
              {[10, 20, 50, 100, 0].map((value) => (
                <Option key={value} value={String(value)} text={value === 0 ? '全部' : String(value)}>
                  {value === 0 ? '全部' : value}
                </Option>
              ))}
            </Dropdown>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {frequency.length === 0 ? (
              <div className={styles.lineRow}>
                <Caption1 className={styles.hint}>没有可统计的字符</Caption1>
              </div>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.headCell}>字符</th>
                      <th className={styles.headCell}>码点</th>
                      <th className={styles.headCell}>类别</th>
                      <th className={`${styles.headCell} ${styles.numeric}`}>次数</th>
                      <th className={`${styles.headCell} ${styles.numeric}`}>占比</th>
                      <th className={styles.headCell}>分布</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frequency.map((row) => (
                      <tr key={row.codePoint}>
                        <td className={`${styles.cell} ${styles.glyph}`}>
                          {displayChar(row.char)}
                        </td>
                        <td className={`${styles.cell} ${styles.mono}`}>{row.label}</td>
                        <td className={styles.cell}>{row.category}</td>
                        <td className={`${styles.cell} ${styles.numeric}`}>{row.count}</td>
                        <td className={`${styles.cell} ${styles.numeric}`}>
                          {(row.ratio * 100).toFixed(1)}%
                        </td>
                        <td className={styles.cell}>
                          <span className={styles.barTrack}>
                            <span
                              className={styles.barFill}
                              style={{ width: `${Math.max(2, row.ratio * 100)}%` }}
                            />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="wt-surface" aria-label="Unicode 类别分布">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              Unicode 类别分布
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>按码点归类，正则属性类 \p&#123;...&#125; 判定</Caption1>
          </div>
          <div className={`wt-surface__body ${styles.distribution}`}>
            {distribution.length === 0 ? (
              <div className={styles.lineRow}>
                <Caption1 className={styles.hint}>没有可归类的字符</Caption1>
              </div>
            ) : (
              distribution.map((bucket) => (
                <div key={bucket.id} className={styles.distributionRow}>
                  <Text size={200}>{bucket.label}</Text>
                  <Text size={200} className={styles.mono}>
                    {bucket.count}
                  </Text>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      style={{ width: `${Math.max(2, bucket.ratio * 100)}%` }}
                    />
                  </span>
                  <Text size={200} className={styles.mono}>
                    {(bucket.ratio * 100).toFixed(1)}%
                  </Text>
                </div>
              ))
            )}
          </div>
        </section>

        <MessageBar intent="info">
          <MessageBarBody>
            <Text weight="semibold">为什么这里和编辑器显示的字数不一样？</Text>
            <ul className={styles.notes}>
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </MessageBarBody>
        </MessageBar>

        <MessageBar intent="warning">
          <MessageBarBody>
            阅读时间是估算值：按中文 {READING_SPEED.chineseCharsPerMinute} 字/分钟、
            英文 {READING_SPEED.latinWordsPerMinute} 词/分钟分别计算后相加
            （中文本次 {formatDuration(reading.chineseSeconds)}、
            英文本次 {formatDuration(reading.latinSeconds)}）。
            实际速度随读者与文本难度变化，句子数同样只是按标点估算，缩写词不会特殊处理。
            码点 {metrics.codePoints} · 字素簇 {metrics.graphemes} · 码元 {metrics.utf16Units} ·
            字节 {metrics.utf8Bytes}（示例：😀 为 1 码点 / 2 码元 / 4 字节 / 1 字素簇，
            {codePointLabel(0x1f600)}）。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
