import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
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
  Checkmark16Regular,
  Copy16Regular,
  DocumentText16Regular,
  TextBulletListSquare16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_DIFF_OPTIONS,
  DIFF_SAMPLE_AFTER,
  DIFF_SAMPLE_BEFORE,
  buildRows,
  diffLines,
  pairLines,
  toUnifiedText,
} from './diffUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
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
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    width: '100%',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  statValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '17px',
    fontVariantNumeric: 'tabular-nums',
  },
  diff: {
    width: '100%',
    maxHeight: '480px',
    overflow: 'auto',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    lineHeight: 1.65,
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    minWidth: 0,
  },
  rowModify: {
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  gutter: {
    flex: 'none',
    width: '46px',
    padding: '0 6px',
    textAlign: 'right',
    color: tokens.colorNeutralForeground4,
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'none',
  },
  marker: {
    flex: 'none',
    width: '18px',
    textAlign: 'center',
    userSelect: 'none',
    color: tokens.colorNeutralForeground3,
  },
  content: {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '0 8px 0 4px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  deleteRow: {
    backgroundColor: tokens.colorPaletteRedBackground1,
  },
  insertRow: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
  },
  wordDelete: {
    backgroundColor: tokens.colorPaletteRedBackground2,
    textDecoration: 'line-through',
  },
  wordInsert: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
  },
  gap: {
    padding: '2px 14px',
    color: tokens.colorNeutralForeground4,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'center',
    fontSize: '12px',
  },
});

export function TextDiffTool() {
  const styles = useStyles();
  const toasterId = useId('diff-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [context, setContext] = useState(3);
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
      ...DEFAULT_DIFF_OPTIONS,
      ignoreCase,
      ignoreWhitespace,
      contextLines: context,
    }),
    [ignoreCase, ignoreWhitespace, context],
  );

  const result = useMemo(() => diffLines(before, after, options), [before, after, options]);

  const rows = useMemo(() => {
    if (!result.ok) return [];
    return buildRows(pairLines(result.lines), context);
  }, [result, context]);

  const hasInput = before !== '' || after !== '';

  const copyUnified = useCallback(async () => {
    if (!result.ok) return;
    const ok = await copyText(toUnifiedText(result.lines));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制统一格式差异');
    } else {
      notify('复制失败');
    }
  }, [result, notify]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Button
            appearance="secondary"
            onClick={() => {
              setBefore(DIFF_SAMPLE_BEFORE);
              setAfter(DIFF_SAMPLE_AFTER);
            }}
          >
            载入示例
          </Button>
          <Button
            appearance="secondary"
            icon={<ArrowSwap16Regular />}
            onClick={() => {
              setBefore(after);
              setAfter(before);
            }}
            disabled={!hasInput}
          >
            交换两侧
          </Button>
          <Checkbox
            checked={ignoreWhitespace}
            onChange={(_, data) => setIgnoreWhitespace(Boolean(data.checked))}
            label="忽略空白差异"
          />
          <Checkbox
            checked={ignoreCase}
            onChange={(_, data) => setIgnoreCase(Boolean(data.checked))}
            label="忽略大小写"
          />
          <Caption1 className={styles.hint}>上下文</Caption1>
          <Dropdown
            style={{ minWidth: 84 }}
            value={`${context} 行`}
            selectedOptions={[String(context)]}
            onOptionSelect={(_, data) => setContext(Number(data.optionValue))}
            aria-label="上下文行数"
          >
            {[0, 1, 3, 5, 10].map((value) => (
              <Option key={value} value={String(value)} text={`${value} 行`}>
                {value} 行
              </Option>
            ))}
          </Dropdown>
          <span className={styles.spacer} />
          <Tooltip content="复制统一格式差异（+/- 前缀）" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
              onClick={() => void copyUnified()}
              disabled={!result.ok}
              aria-label="复制统一格式差异"
            />
          </Tooltip>
          <Button
            appearance="subtle"
            onClick={() => {
              setBefore('');
              setAfter('');
            }}
            disabled={!hasInput}
          >
            清空
          </Button>
        </div>

        <div className="wt-split">
          <section className="wt-surface" aria-label="原文">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                原文（before）
              </Text>
              {result.ok && result.stats.removed > 0 && (
                <Badge appearance="tint" color="danger" size="small">
                  −{result.stats.removed}
                </Badge>
              )}
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                value={before}
                onChange={(event) => setBefore(event.target.value)}
                placeholder="粘贴修改前的文本…"
                aria-label="原文"
                spellCheck={false}
              />
            </div>
          </section>

          <section className="wt-surface" aria-label="新文">
            <div className="wt-surface__header">
              <DocumentText16Regular />
              <Text as="h2" size={300} weight="semibold">
                新文（after）
              </Text>
              {result.ok && result.stats.added > 0 && (
                <Badge appearance="tint" color="success" size="small">
                  +{result.stats.added}
                </Badge>
              )}
            </div>
            <div className="wt-surface__body">
              <textarea
                className="wt-code-area"
                value={after}
                onChange={(event) => setAfter(event.target.value)}
                placeholder="粘贴修改后的文本…"
                aria-label="新文"
                spellCheck={false}
              />
            </div>
          </section>
        </div>

        {!result.ok && (
          <MessageBar intent="warning">
            <MessageBarBody>{result.error}</MessageBarBody>
          </MessageBar>
        )}

        {result.ok && (
          <>
            <section className="wt-surface" aria-label="差异统计">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  差异统计
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  相似度按保留行数计算
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.stats}`}>
                {[
                  ['新增行', `+${result.stats.added}`],
                  ['删除行', `−${result.stats.removed}`],
                  ['未变行', String(result.stats.unchanged)],
                  ['相似度', `${result.stats.similarity}%`],
                  [
                    '改动块',
                    String(rows.filter((row) => row.type === 'line' && row.pair.kind === 'modify').length),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className={styles.stat}>
                    <Caption1 className={styles.hint}>{label}</Caption1>
                    <span className={styles.statValue}>{value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="wt-surface" aria-label="差异预览">
              <div className="wt-surface__header">
                <TextBulletListSquare16Regular />
                <Text as="h2" size={300} weight="semibold">
                  差异预览
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  行内改动用词级高亮标出
                </Caption1>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.diff}>
                  {rows.length === 0 ? (
                    <div className={styles.gap}>两侧内容一致，没有差异</div>
                  ) : (
                    rows.map((row, index) => {
                      if (row.type === 'gap') {
                        return (
                          <div key={`g${index}`} className={styles.gap}>
                            ⋯ 省略 {row.hidden} 行未变内容 ⋯
                          </div>
                        );
                      }

                      const { pair } = row;

                      if (pair.kind === 'modify') {
                        return (
                          <div key={`m${index}`} className={styles.rowModify}>
                            <div className={`${styles.row} ${styles.deleteRow}`}>
                              <span className={styles.gutter}>
                                {pair.before?.beforeLine ?? ''}
                              </span>
                              <span className={styles.marker}>−</span>
                              <span className={styles.content}>
                                {pair.wordDiff?.map((segment, segIndex) =>
                                  segment.kind === 'insert' ? null : (
                                    <span
                                      key={segIndex}
                                      className={
                                        segment.kind === 'delete'
                                          ? styles.wordDelete
                                          : undefined
                                      }
                                    >
                                      {segment.text}
                                    </span>
                                  ),
                                )}
                              </span>
                            </div>
                            <div className={`${styles.row} ${styles.insertRow}`}>
                              <span className={styles.gutter}>
                                {pair.after?.afterLine ?? ''}
                              </span>
                              <span className={styles.marker}>+</span>
                              <span className={styles.content}>
                                {pair.wordDiff?.map((segment, segIndex) =>
                                  segment.kind === 'delete' ? null : (
                                    <span
                                      key={segIndex}
                                      className={
                                        segment.kind === 'insert'
                                          ? styles.wordInsert
                                          : undefined
                                      }
                                    >
                                      {segment.text}
                                    </span>
                                  ),
                                )}
                              </span>
                            </div>
                          </div>
                        );
                      }

                      const line = pair.after ?? pair.before;
                      const kindClass =
                        pair.kind === 'delete'
                          ? styles.deleteRow
                          : pair.kind === 'insert'
                            ? styles.insertRow
                            : undefined;
                      const marker =
                        pair.kind === 'delete' ? '−' : pair.kind === 'insert' ? '+' : ' ';

                      return (
                        <div key={`l${index}`} className={`${styles.row} ${kindClass ?? ''}`}>
                          <span className={styles.gutter}>
                            {pair.before?.beforeLine ?? ''}
                          </span>
                          <span className={styles.gutter}>
                            {pair.after?.afterLine ?? ''}
                          </span>
                          <span className={styles.marker}>{marker}</span>
                          <span className={styles.content}>{line?.text}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        <MessageBar intent="info">
          <MessageBarBody>
            采用最长公共子序列（LCS）计算，因此差异脚本是最小的——不会把一处改动
            报成整段重写。相邻的一删一增会配对成「修改」并做词级高亮。
            超大文本会明确拒绝而不是卡住页面（LCS 表格为 O(n×m)）。
          </MessageBarBody>
        </MessageBar>

        <Divider />
      </div>
    </>
  );
}
