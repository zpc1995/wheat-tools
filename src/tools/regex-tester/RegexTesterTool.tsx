import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
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
  Braces16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Search16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  DEFAULT_EXECUTE_OPTIONS,
  DEFAULT_FLAGS,
  PATTERN_PRESETS,
  assessRisk,
  compile,
  execute,
  flagsToString,
  replaceAll,
  segment,
  type RegexFlags,
} from './regexUtils';

const FLAG_LABELS: Array<{ key: keyof RegexFlags; flag: string; note: string }> = [
  { key: 'global', flag: 'g', note: '查找所有匹配' },
  { key: 'ignoreCase', flag: 'i', note: '忽略大小写' },
  { key: 'multiline', flag: 'm', note: '^ $ 匹配每行首尾' },
  { key: 'dotAll', flag: 's', note: '. 匹配换行' },
  { key: 'unicode', flag: 'u', note: 'Unicode 模式' },
  { key: 'sticky', flag: 'y', note: '从 lastIndex 精确匹配' },
];

const SAMPLE = `联系我：admin@example.com 或 support@test.org
官网 https://wheat.chat 与 http://example.com/path?q=1
IP 地址 192.168.1.1 和 10.0.0.254
日期 2026-10-01，颜色 #2f6fed
重复的 的 词，以及 中文内容`;

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  patternRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    flexWrap: 'wrap',
  },
  slash: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '18px',
    color: tokens.colorNeutralForeground3,
  },
  patternInput: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '15px',
  },
  flagsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    padding: '0 14px 12px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  highlight: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: '12px 14px',
    minHeight: '100px',
    userSelect: 'text',
  },
  mark: {
    backgroundColor: tokens.colorPaletteYellowBackground2,
    color: tokens.colorNeutralForeground1,
    borderRadius: '3px',
    padding: '0 1px',
    boxShadow: `inset 0 0 0 1px ${tokens.colorPaletteMarigoldBorder2}`,
  },
  zeroWidth: {
    display: 'inline-block',
    width: '2px',
    height: '1em',
    verticalAlign: 'text-bottom',
    backgroundColor: tokens.colorPaletteRedForeground1,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxHeight: '380px',
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowIndex: {
    flex: 'none',
    width: '36px',
    color: tokens.colorNeutralForeground4,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '12px',
  },
  rowPos: {
    flex: 'none',
    width: '52px',
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '12px',
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  groupChip: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    color: tokens.colorBrandForeground1,
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px 14px',
  },
});

export function RegexTesterTool() {
  const styles = useStyles();
  const toasterId = useId('regex-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [pattern, setPattern] = useState('[\\w.+-]+@[\\w-]+\\.[\\w.]+');
  const [subject, setSubject] = useState(SAMPLE);
  const [flags, setFlags] = useState<RegexFlags>(DEFAULT_FLAGS);
  const [replacement, setReplacement] = useState('');
  const [tab, setTab] = useState<'matches' | 'replace'>('matches');
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
      const ok = await copyText(value);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const risk = useMemo(() => assessRisk(pattern), [pattern]);

  /**
   * Subject is truncated before matching.
   *
   * There is no way to interrupt a synchronous regex in JavaScript, so the only
   * protection against a pathological pattern is to bound the input length.
   */
  const truncatedSubject = useMemo(() => {
    const limit = DEFAULT_EXECUTE_OPTIONS.maxSubjectLength;
    return subject.length > limit ? subject.slice(0, limit) : subject;
  }, [subject]);

  const compiled = useMemo(() => compile(pattern, flags), [pattern, flags]);

  const result = useMemo(() => {
    if (!compiled.ok) return null;
    if (!pattern) return null;
    return execute(compiled.regex, truncatedSubject);
  }, [compiled, pattern, truncatedSubject]);

  // Yield to the browser between keystrokes so a slow pattern does not make the
  // textarea feel frozen.
  const [debouncedSubject, setDebouncedSubject] = useState(truncatedSubject);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSubject(truncatedSubject), 120);
    return () => window.clearTimeout(timer);
  }, [truncatedSubject]);

  const stableResult = useMemo(() => {
    if (!compiled.ok || !pattern) return null;
    return execute(compiled.regex, debouncedSubject);
  }, [compiled, pattern, debouncedSubject]);

  const segments = useMemo(
    () => (stableResult?.ok ? segment(debouncedSubject, stableResult.matches) : []),
    [stableResult, debouncedSubject],
  );

  const replaced = useMemo(() => {
    if (!compiled.ok || !pattern || tab !== 'replace') return null;
    return replaceAll(compiled.regex, debouncedSubject, replacement);
  }, [compiled, pattern, tab, debouncedSubject, replacement]);

  const matchCount = stableResult?.ok ? stableResult.matches.length : 0;

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <section className="wt-surface" aria-label="正则表达式">
          <div className="wt-surface__header">
            <Braces16Regular />
            <Text as="h2" size={300} weight="semibold">
              正则表达式
            </Text>
            {compiled.ok ? (
              <Badge appearance="tint" color="success" size="small">
                语法有效
              </Badge>
            ) : (
              <Badge appearance="tint" color="danger" size="small">
                语法错误
              </Badge>
            )}
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              {matchCount} 个匹配
              {stableResult?.ok && stableResult.truncated && '（已达上限）'}
              {stableResult?.ok && ` · ${stableResult.elapsedMs.toFixed(1)} ms`}
            </Caption1>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.patternRow}>
              <span className={styles.slash}>/</span>
              <input
                className={`wt-inline-input ${styles.patternInput}`}
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                placeholder="输入正则表达式，不需要两侧的斜杠"
                aria-label="正则表达式"
                spellCheck={false}
              />
              <span className={styles.slash}>/{flagsToString(flags)}</span>
            </div>

            <div className={styles.flagsRow}>
              {FLAG_LABELS.map((item) => (
                <Tooltip
                  key={item.key}
                  content={item.note}
                  relationship="description"
                  withArrow
                >
                  <Checkbox
                    checked={flags[item.key]}
                    onChange={(_, data) =>
                      setFlags((current) => ({
                        ...current,
                        [item.key]: Boolean(data.checked),
                      }))
                    }
                    label={`${item.flag} — ${item.note}`}
                  />
                </Tooltip>
              ))}
            </div>
          </div>
        </section>

        {!compiled.ok && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>正则语法错误</MessageBarTitle>
              {compiled.error}
            </MessageBarBody>
          </MessageBar>
        )}

        {compiled.ok && risk.warnings.length > 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>
                <Warning16Regular /> 可能发生灾难性回溯
              </MessageBarTitle>
              {risk.warnings.join('；')}。JavaScript 的正则无法中途打断，
              输入较长时会冻结页面，建议改用更具体的模式（例如用 [^"]+ 代替 .+）。
              {risk.blocked && ' 当前模式已属于高风险形态，请谨慎用于长输入。'}
            </MessageBarBody>
          </MessageBar>
        )}

        <section className="wt-surface" aria-label="测试文本">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              测试文本
            </Text>
            <span className={styles.spacer} />
            <Button
              appearance="subtle"
              size="small"
              onClick={() => setSubject('')}
              disabled={!subject}
            >
              清空
            </Button>
          </div>
          <div className="wt-surface__body">
            <textarea
              className="wt-code-area"
              style={{ minHeight: '140px' }}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="在此粘贴要测试的文本…"
              aria-label="测试文本"
              spellCheck={false}
            />
          </div>
        </section>

        {compiled.ok && pattern && (
          <section className="wt-surface" aria-label="匹配结果">
            <div className="wt-surface__header">
              <Search16Regular />
              <Text as="h2" size={300} weight="semibold">
                匹配高亮
              </Text>
              <span className={styles.spacer} />
              <TabList
                size="small"
                selectedValue={tab}
                onTabSelect={(_, data) =>
                  setTab(data.value as 'matches' | 'replace')
                }
              >
                <Tab value="matches">匹配详情</Tab>
                <Tab value="replace">替换预览</Tab>
              </TabList>
            </div>

            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.highlight}>
                {segments.length === 0 ? (
                  <span className={styles.hint}>没有匹配</span>
                ) : (
                  segments.map((piece, index) =>
                    piece.match ? (
                      piece.text === '' ? (
                        // Zero-width match: show a caret-sized marker so the
                        // position is visible even though nothing was consumed.
                        <span
                          key={`z${index}`}
                          className={styles.zeroWidth}
                          title={`零宽匹配 @ ${stableResult?.ok ? stableResult.matches[piece.matchIndex ?? 0]?.index : ''}`}
                        />
                      ) : (
                        <mark key={`m${index}`} className={styles.mark}>
                          {piece.text}
                        </mark>
                      )
                    ) : (
                      <span key={`t${index}`}>{piece.text}</span>
                    ),
                  )
                )}
              </div>

              <Divider />

              {tab === 'matches' ? (
                <div className={styles.rows}>
                  {stableResult?.ok && stableResult.matches.length > 0 ? (
                    stableResult.matches.map((match, index) => (
                      <div key={`${match.index}-${index}`} className={styles.row}>
                        <span className={styles.rowIndex}>#{index + 1}</span>
                        <span className={styles.rowPos}>@{match.index}</span>
                        <span className={styles.rowValue}>
                          {match.text === '' ? '(零宽匹配)' : match.text}
                          {match.groups.length > 0 && (
                            <>
                              {'  '}
                              {match.groups.map((group) => (
                                <span key={group.index} className={styles.groupChip}>
                                  {group.name ? `$<${group.name}>` : `$${group.index}`}=
                                  {group.value === null ? 'null' : JSON.stringify(group.value)}
                                  {group.index < match.groups.length ? '  ' : ''}
                                </span>
                              ))}
                            </>
                          )}
                        </span>
                        <Tooltip content="复制该匹配" relationship="label" withArrow>
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={
                              copied === `m${index}` ? (
                                <Checkmark16Regular />
                              ) : (
                                <Copy16Regular />
                              )
                            }
                            onClick={() => copy(match.text, `m${index}`)}
                            aria-label="复制该匹配"
                          />
                        </Tooltip>
                      </div>
                    ))
                  ) : (
                    <div className={styles.row}>
                      <Caption1 className={styles.hint}>
                        没有匹配项。可尝试调整模式或标志。
                      </Caption1>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className={styles.patternRow}>
                    <Caption1 className={styles.hint}>替换为</Caption1>
                    <input
                      className="wt-inline-input"
                      value={replacement}
                      onChange={(event) => setReplacement(event.target.value)}
                      placeholder="支持 $1、$<name> 等反向引用"
                      aria-label="替换文本"
                      spellCheck={false}
                    />
                  </div>
                  {replaced && !replaced.ok && (
                    <div className={styles.patternRow}>
                      <Caption1 className={styles.hint}>{replaced.error}</Caption1>
                    </div>
                  )}
                  {replaced?.ok && (
                    <div className={styles.highlight}>{replaced.value}</div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        <section className="wt-surface" aria-label="常用正则">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              常用模式
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>点击填入</Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.presets}>
              {PATTERN_PRESETS.map((preset) => (
                <Tooltip
                  key={preset.label}
                  content={`${preset.pattern} — ${preset.note}`}
                  relationship="description"
                  withArrow
                >
                  <Button
                    appearance={
                      preset.label === '灾难性回溯示例' ? 'outline' : 'secondary'
                    }
                    size="small"
                    onClick={() => {
                      setPattern(preset.pattern);
                      setFlags({ ...DEFAULT_FLAGS, ...preset.flags });
                    }}
                  >
                    {preset.label}
                  </Button>
                </Tooltip>
              ))}
            </div>
            <Divider />
            <div className={styles.patternRow}>
              <Caption1 className={styles.hint}>
                匹配在浏览器本地完成，文本不会离开页面。输入超过{' '}
                {Math.round(DEFAULT_EXECUTE_OPTIONS.maxSubjectLength / 1000)}k
                字符会被截断，匹配数上限为 {DEFAULT_EXECUTE_OPTIONS.maxMatches}。
              </Caption1>
            </div>
          </div>
        </section>

        {result?.ok && result.matches.length > 0 && (
          <div className={styles.hint} />
        )}
      </div>
    </>
  );
}
